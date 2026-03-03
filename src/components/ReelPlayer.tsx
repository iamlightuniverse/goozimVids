import React, { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ReelSegment, TranscriptionLine, WordTimestamp, CaptionStyle } from '../types';
import { CaptionOverlay, approximateWordTimestamps } from './CaptionOverlay';

export interface ReelPlayerHandle {
  togglePlayPause: () => void;
}

interface Props {
  videoUrl: string;
  segments: ReelSegment[];
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  captionsEnabled: boolean;
  captionStyle?: CaptionStyle;
  /** When provided, controls play/pause externally (used by FeedView). */
  isActive?: boolean;
  /** When true, video fills parent with no maxHeight or rounded corners */
  fillScreen?: boolean;
  /** Whether to show the "Part X / Y" segment counter (default: true) */
  showSegmentCounter?: boolean;
  /** Controlled mute state (lifted from FeedView) */
  isMuted?: boolean;
  /** Callback when mute is toggled (lifted from FeedView) */
  onMuteToggle?: () => void;
}

const timeToSeconds = (timeStr: string) => {
  const cleaned = timeStr.replace(/[\[\]]/g, '').trim();
  const parts = cleaned.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

function findSegmentEndTime(outTimestamp: string, wordTimestamps: WordTimestamp[]): number {
  const outSec = timeToSeconds(outTimestamp);

  if (wordTimestamps.length === 0) return outSec + 0.5;

  let lastWord: WordTimestamp | null = null;
  for (const w of wordTimestamps) {
    if (w.start <= outSec + 0.1) {
      lastWord = w;
    } else {
      break;
    }
  }

  return lastWord ? lastWord.end : outSec + 0.5;
}

export const ReelPlayer = forwardRef<ReelPlayerHandle, Props>(function ReelPlayer({
  videoUrl,
  segments,
  transcription,
  wordTimestamps,
  captionsEnabled,
  captionStyle,
  isActive,
  fillScreen = false,
  showSegmentCounter = true,
  isMuted: isMutedProp,
  onMuteToggle: onMuteToggleProp,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const segmentIndexRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [localMuted, setLocalMuted] = useState(true);
  const [showPlayIndicator, setShowPlayIndicator] = useState<'play' | 'pause' | null>(null);
  const playIndicatorTimeout = useRef<ReturnType<typeof setTimeout>>();
  const prevIsActiveRef = useRef<boolean | undefined>(undefined);

  // Controlled vs uncontrolled mute
  const isMuted = isMutedProp !== undefined ? isMutedProp : localMuted;

  // Progress bar state
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    segmentIndexRef.current = currentSegmentIndex;
  }, [currentSegmentIndex]);

  useEffect(() => {
    setCurrentSegmentIndex(0);
    segmentIndexRef.current = 0;
  }, [segments]);

  const resolvedWordTimestamps = useMemo(() => {
    if (wordTimestamps && wordTimestamps.length > 0) return wordTimestamps;
    return approximateWordTimestamps(transcription);
  }, [wordTimestamps, transcription]);

  const segmentEndTimes = useMemo(() => {
    return segments.map((seg) => findSegmentEndTime(seg.outTimestamp, resolvedWordTimestamps));
  }, [segments, resolvedWordTimestamps]);

  // Total duration across all segments (for progress bar)
  const totalDuration = useMemo(() => {
    return segments.reduce((sum, seg, i) => {
      const start = timeToSeconds(seg.inTimestamp);
      const end = segmentEndTimes[i];
      return sum + (end - start);
    }, 0);
  }, [segments, segmentEndTimes]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;

    const idx = segmentIndexRef.current;
    if (idx >= segments.length) return;

    const endTime = segmentEndTimes[idx];

    // Update progress bar
    if (fillScreen && totalDuration > 0) {
      let completed = 0;
      for (let i = 0; i < idx; i++) {
        completed += segmentEndTimes[i] - timeToSeconds(segments[i].inTimestamp);
      }
      const segStart = timeToSeconds(segments[idx].inTimestamp);
      const currentInSegment = Math.max(0, video.currentTime - segStart);
      setProgress(Math.min(1, (completed + currentInSegment) / totalDuration));
    }

    if (video.currentTime >= endTime) {
      if (idx < segments.length - 1) {
        const nextIndex = idx + 1;
        segmentIndexRef.current = nextIndex;
        setCurrentSegmentIndex(nextIndex);
        video.currentTime = timeToSeconds(segments[nextIndex].inTimestamp);
      } else {
        segmentIndexRef.current = 0;
        setCurrentSegmentIndex(0);
        video.currentTime = timeToSeconds(segments[0].inTimestamp);
        setProgress(0);
      }
    }
  }, [segments, segmentEndTimes, fillScreen, totalDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [handleTimeUpdate]);

  useEffect(() => {
    if (videoRef.current && segments.length > 0) {
      videoRef.current.currentTime = timeToSeconds(segments[0].inTimestamp);
    }
  }, [segments, videoUrl]);

  const handlePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const idx = segmentIndexRef.current;
    const seg = segments[idx];
    if (!seg) return;

    const inTime = timeToSeconds(seg.inTimestamp);
    const endTime = segmentEndTimes[idx];

    if (video.currentTime < inTime - 0.5 || video.currentTime > endTime) {
      video.currentTime = inTime;
    }
  }, [segments, segmentEndTimes]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('play', handlePlay);
    return () => video.removeEventListener('play', handlePlay);
  }, [handlePlay]);

  // Sync isPlaying state from video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  // External play/pause control via isActive prop + replay on swipe-back
  useEffect(() => {
    if (isActive === undefined) return;
    const video = videoRef.current;
    if (!video) return;

    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (isActive) {
      // Replay from beginning when re-activated (swipe back)
      if (wasActive === false) {
        segmentIndexRef.current = 0;
        setCurrentSegmentIndex(0);
        video.currentTime = timeToSeconds(segments[0].inTimestamp);
        setProgress(0);
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isActive, segments]);

  // Click-to-play/pause handler
  const handleVideoClick = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setShowPlayIndicator('play');
    } else {
      video.pause();
      setShowPlayIndicator('pause');
    }

    if (playIndicatorTimeout.current) clearTimeout(playIndicatorTimeout.current);
    playIndicatorTimeout.current = setTimeout(() => setShowPlayIndicator(null), 600);
  }, []);

  // Expose togglePlayPause for keyboard nav
  useImperativeHandle(ref, () => ({
    togglePlayPause: handleVideoClick,
  }), [handleVideoClick]);

  // Mute toggle
  const handleMuteToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMuteToggleProp) {
      onMuteToggleProp();
    } else {
      setLocalMuted((v) => !v);
    }
  }, [onMuteToggleProp]);

  // Keep muted state in sync with video element
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
    }
  }, [isMuted]);

  const currentSegment = segments[currentSegmentIndex];
  const segStartTime = currentSegment ? timeToSeconds(currentSegment.inTimestamp) : 0;
  const segEndTime = currentSegment ? segmentEndTimes[currentSegmentIndex] : 0;

  const containerClass = fillScreen
    ? 'overflow-hidden bg-black relative w-full h-full'
    : 'rounded-xl overflow-hidden bg-black relative';

  const containerStyle = fillScreen
    ? undefined
    : { aspectRatio: '9 / 16', maxHeight: '70vh' };

  return (
    <div className={containerClass} style={containerStyle}>
      {/* Progress bar — only in feed (fillScreen) mode */}
      {fillScreen && (
        <div className="absolute top-0 left-0 right-0 z-10 h-0.5 bg-white/20">
          <div
            className="h-full bg-white transition-[width] duration-200 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      <video
        ref={videoRef}
        src={videoUrl}
        className={`w-full h-full ${fillScreen ? 'object-contain' : 'object-cover'}`}
        muted
        playsInline
      />

      {/* Click overlay for play/pause */}
      <div
        className="absolute inset-0 z-[5] cursor-pointer"
        onClick={handleVideoClick}
      />

      {/* Play/Pause indicator flash */}
      <AnimatePresence>
        {showPlayIndicator && (
          <motion.div
            key={showPlayIndicator}
            initial={{ opacity: 0.8, scale: 1 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 flex items-center justify-center z-[5] pointer-events-none"
          >
            <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center">
              {showPlayIndicator === 'play' ? (
                <Play className="w-8 h-8 text-white fill-white" />
              ) : (
                <Pause className="w-8 h-8 text-white fill-white" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mute/unmute button */}
      <button
        onClick={handleMuteToggle}
        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 text-white/80 hover:text-white transition-colors"
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      {/* Segment counter */}
      {showSegmentCounter && segments.length > 1 && (
        <div className="absolute top-3 left-3 bg-black/70 text-white text-xs font-medium px-2.5 py-1 rounded-full pointer-events-none">
          Part {currentSegmentIndex + 1} / {segments.length}
        </div>
      )}

      {/* Caption overlay */}
      {captionsEnabled && resolvedWordTimestamps.length > 0 && (
        <CaptionOverlay
          videoRef={videoRef}
          wordTimestamps={resolvedWordTimestamps}
          segmentStartTime={segStartTime}
          segmentEndTime={segEndTime}
          captionStyle={captionStyle}
        />
      )}
    </div>
  );
});
