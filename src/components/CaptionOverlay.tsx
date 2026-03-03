import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WordTimestamp, TranscriptionLine, CaptionStyle, DEFAULT_CAPTION_STYLE } from '../types';

interface CaptionGroup {
  text: string;
  startTime: number;
  endTime: number;
}

interface KaraokeSentence {
  words: WordTimestamp[];
  startTime: number;
  endTime: number;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  wordTimestamps: WordTimestamp[];
  segmentStartTime: number;
  segmentEndTime: number;
  captionStyle?: CaptionStyle;
}

/**
 * Detect text direction by counting RTL vs LTR Unicode characters.
 * Returns 'rtl' if the text is predominantly RTL, 'ltr' otherwise.
 */
function detectDirection(text: string): 'rtl' | 'ltr' {
  let rtlCount = 0;
  let ltrCount = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Arabic: \u0600-\u06FF, Arabic Supplement: \u0750-\u077F, Arabic Extended: \u08A0-\u08FF
    // Hebrew: \u0590-\u05FF
    // Thaana (Maldivian): \u0780-\u07BF
    // Syriac: \u0700-\u074F
    if (
      (code >= 0x0590 && code <= 0x05FF) || // Hebrew
      (code >= 0x0600 && code <= 0x06FF) || // Arabic
      (code >= 0x0700 && code <= 0x074F) || // Syriac
      (code >= 0x0750 && code <= 0x077F) || // Arabic Supplement
      (code >= 0x0780 && code <= 0x07BF) || // Thaana
      (code >= 0x08A0 && code <= 0x08FF) || // Arabic Extended-A
      (code >= 0xFB50 && code <= 0xFDFF) || // Arabic Presentation Forms-A
      (code >= 0xFE70 && code <= 0xFEFF)    // Arabic Presentation Forms-B
    ) {
      rtlCount++;
    } else if (
      (code >= 0x0041 && code <= 0x005A) || // A-Z
      (code >= 0x0061 && code <= 0x007A) || // a-z
      (code >= 0x00C0 && code <= 0x024F)    // Latin Extended
    ) {
      ltrCount++;
    }
  }

  // For very short text (< 3 alphabetic chars), any RTL char triggers RTL
  if (rtlCount + ltrCount < 3) {
    return rtlCount > 0 ? 'rtl' : 'ltr';
  }

  return rtlCount > ltrCount ? 'rtl' : 'ltr';
}

/**
 * Pre-compute caption groups from word timestamps.
 * Breaks on sentence-ending punctuation or speech pauses > 0.5s.
 */
function buildCaptionGroups(
  words: WordTimestamp[],
  segStart: number,
  segEnd: number,
  wordsPerGroup: number = 3,
): CaptionGroup[] {
  const filtered = words.filter((w) => w.start >= segStart - 0.05 && w.end <= segEnd + 0.05);
  if (filtered.length === 0) return [];

  const groups: CaptionGroup[] = [];
  let current: WordTimestamp[] = [];

  for (let i = 0; i < filtered.length; i++) {
    current.push(filtered[i]);

    const endsWithPunctuation = /[.!?]$/.test(filtered[i].word);
    const hasLongPause =
      i < filtered.length - 1 && filtered[i + 1].start - filtered[i].end > 0.5;
    const atGroupLimit = current.length >= wordsPerGroup;

    if (endsWithPunctuation || hasLongPause || atGroupLimit || i === filtered.length - 1) {
      groups.push({
        text: current.map((w) => w.word).join(' '),
        startTime: current[0].start,
        endTime: current[current.length - 1].end,
      });
      current = [];
    }
  }

  return groups;
}

/**
 * Group words into sentences for karaoke mode.
 * Breaks on sentence-ending punctuation or pauses > 0.8s.
 */
function buildKaraokeSentences(
  words: WordTimestamp[],
  segStart: number,
  segEnd: number,
): KaraokeSentence[] {
  const filtered = words.filter((w) => w.start >= segStart - 0.05 && w.end <= segEnd + 0.05);
  if (filtered.length === 0) return [];

  const sentences: KaraokeSentence[] = [];
  let current: WordTimestamp[] = [];

  for (let i = 0; i < filtered.length; i++) {
    current.push(filtered[i]);

    const endsWithPunctuation = /[.!?]$/.test(filtered[i].word);
    const hasLongPause =
      i < filtered.length - 1 && filtered[i + 1].start - filtered[i].end > 0.8;

    if (endsWithPunctuation || hasLongPause || i === filtered.length - 1) {
      sentences.push({
        words: [...current],
        startTime: current[0].start,
        endTime: current[current.length - 1].end,
      });
      current = [];
    }
  }

  return sentences;
}

/**
 * Binary search for the active caption group at a given time.
 */
function findActiveGroup(groups: CaptionGroup[], time: number): CaptionGroup | null {
  if (groups.length === 0) return null;

  let lo = 0;
  let hi = groups.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const g = groups[mid];

    if (time < g.startTime) {
      hi = mid - 1;
    } else if (time > g.endTime) {
      lo = mid + 1;
    } else {
      return g;
    }
  }

  return null;
}

/**
 * Find the active karaoke sentence at a given time.
 */
function findActiveSentence(sentences: KaraokeSentence[], time: number): KaraokeSentence | null {
  for (const s of sentences) {
    if (time >= s.startTime - 0.05 && time <= s.endTime + 0.05) return s;
  }
  return null;
}

/**
 * Find the active single word at a given time (for bounce mode).
 */
function findActiveWord(words: WordTimestamp[], time: number): WordTimestamp | null {
  for (const w of words) {
    if (time >= w.start - 0.02 && time <= w.end + 0.02) return w;
  }
  return null;
}

/**
 * Generate approximate word timestamps from transcription lines
 * when real word-level data isn't available.
 */
export function approximateWordTimestamps(transcription: TranscriptionLine[]): WordTimestamp[] {
  const result: WordTimestamp[] = [];

  const parseTimestamp = (ts: string): number => {
    const parts = ts.replace(/[\[\]]/g, '').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  for (let i = 0; i < transcription.length; i++) {
    const line = transcription[i];
    const lineStart = parseTimestamp(line.timestamp);
    const nextStart =
      i < transcription.length - 1 ? parseTimestamp(transcription[i + 1].timestamp) : lineStart + 5;

    const words = line.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const duration = nextStart - lineStart;
    const wordDuration = duration / words.length;

    for (let j = 0; j < words.length; j++) {
      result.push({
        word: words[j],
        start: lineStart + j * wordDuration,
        end: lineStart + (j + 1) * wordDuration,
      });
    }
  }

  return result;
}

export function CaptionOverlay({ videoRef, wordTimestamps, segmentStartTime, segmentEndTime, captionStyle }: Props) {
  const style = captionStyle || DEFAULT_CAPTION_STYLE;
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number>(0);

  const captionPosition = style.captionPosition ?? 15;
  const wordsPerLine = style.wordsPerLine ?? 3;

  const groups = useMemo(
    () => buildCaptionGroups(wordTimestamps, segmentStartTime, segmentEndTime, wordsPerLine),
    [wordTimestamps, segmentStartTime, segmentEndTime, wordsPerLine],
  );

  const sentences = useMemo(
    () => buildKaraokeSentences(wordTimestamps, segmentStartTime, segmentEndTime),
    [wordTimestamps, segmentStartTime, segmentEndTime],
  );

  const filteredWords = useMemo(
    () => wordTimestamps.filter((w) => w.start >= segmentStartTime - 0.05 && w.end <= segmentEndTime + 0.05),
    [wordTimestamps, segmentStartTime, segmentEndTime],
  );

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTime(video.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  const scaleFactor = style.fontSize / 100;
  const baseFontSize = `clamp(${1.1 * scaleFactor}rem, ${4 * scaleFactor}vw, ${1.6 * scaleFactor}rem)`;

  const positionStyle = { bottom: `${captionPosition}%` };

  if (style.preset === 'karaoke') {
    const activeSentence = findActiveSentence(sentences, currentTime);
    const sentenceText = activeSentence ? activeSentence.words.map((w) => w.word).join(' ') : '';
    const dir = useMemo(() => detectDirection(sentenceText), [sentenceText]);

    return (
      <div
        className="absolute left-0 right-0 flex justify-center pointer-events-none px-4 z-[6]"
        style={positionStyle}
      >
        <AnimatePresence mode="popLayout">
          {activeSentence && (
            <motion.div
              key={activeSentence.startTime}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.08 }}
              className="rounded-lg px-4 py-2"
              style={{
                backgroundColor: style.showBackground ? style.bgColor : 'transparent',
                backdropFilter: style.showBackground ? 'blur(4px)' : 'none',
              }}
            >
              <p
                className="text-white font-bold leading-snug"
                style={{
                  fontSize: baseFontSize,
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                  direction: dir,
                  textAlign: dir === 'rtl' ? 'right' : 'center',
                }}
              >
                {activeSentence.words.map((w, i) => {
                  const isActive = currentTime >= w.start - 0.02 && currentTime <= w.end + 0.02;
                  return (
                    <span
                      key={i}
                      style={{
                        color: isActive ? style.highlightColor : 'white',
                        transform: isActive ? 'scale(1.1)' : 'scale(1)',
                        display: 'inline-block',
                        transition: 'color 0.08s, transform 0.08s',
                        marginRight: '0.25em',
                      }}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (style.preset === 'bounce') {
    const activeWord = findActiveWord(filteredWords, currentTime);
    const wordText = activeWord ? activeWord.word : '';
    const dir = useMemo(() => detectDirection(wordText), [wordText]);

    return (
      <div
        className="absolute left-0 right-0 flex justify-center pointer-events-none px-4 z-[6]"
        style={positionStyle}
      >
        <AnimatePresence mode="popLayout">
          {activeWord && (
            <motion.div
              key={activeWord.start}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.05, ease: 'easeOut' }}
              className="rounded-lg px-5 py-2"
              style={{
                backgroundColor: style.showBackground ? style.bgColor : 'transparent',
                backdropFilter: style.showBackground ? 'blur(4px)' : 'none',
              }}
            >
              <p
                className="text-white font-bold"
                style={{
                  fontSize: baseFontSize,
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                  direction: dir,
                  textAlign: dir === 'rtl' ? 'right' : 'center',
                }}
              >
                {activeWord.word}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Pop (default) and Outline modes use the same group logic
  const activeGroup = findActiveGroup(groups, currentTime);
  const isOutline = style.preset === 'outline';
  const groupText = activeGroup ? activeGroup.text : '';
  const dir = useMemo(() => detectDirection(groupText), [groupText]);

  return (
    <div
      className="absolute left-0 right-0 flex justify-center pointer-events-none px-4 z-[6]"
      style={positionStyle}
    >
      <AnimatePresence mode="popLayout">
        {activeGroup && (
          <motion.div
            key={activeGroup.startTime}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.08 }}
            className="rounded-lg px-4 py-2"
            style={{
              backgroundColor: !isOutline && style.showBackground ? style.bgColor : 'transparent',
              backdropFilter: !isOutline && style.showBackground ? 'blur(4px)' : 'none',
            }}
          >
            <p
              className="text-white font-bold leading-snug"
              style={{
                fontSize: baseFontSize,
                textShadow: isOutline ? 'none' : '0 2px 8px rgba(0,0,0,0.6)',
                WebkitTextStroke: isOutline ? '2px black' : 'unset',
                paintOrder: isOutline ? 'stroke fill' : 'unset',
                direction: dir,
                textAlign: dir === 'rtl' ? 'right' : 'center',
              }}
            >
              {activeGroup.text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
