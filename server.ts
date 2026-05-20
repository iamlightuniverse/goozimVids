import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

dotenv.config();

const app = express();
const PORT = 3001;

app.use(express.json({ limit: '5mb' }));

// ── AI clients ───────────────────────────────────────────────────────────────

let ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

let _deepgram: ReturnType<typeof createClient> | null = null;
function getDeepgram() {
  if (!_deepgram) {
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error('DEEPGRAM_API_KEY is not set in .env');
    }
    _deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  }
  return _deepgram;
}

let openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'missing',
});

const CLAUDE_MODEL = 'anthropic/claude-sonnet-4-6';

// ── File upload setup ────────────────────────────────────────────────────────

const uploadsDir = path.resolve('uploads');
const sessionsDir = path.join(uploadsDir, 'sessions');
const exportsDir = path.join(uploadsDir, 'exports');

for (const dir of [uploadsDir, sessionsDir, exportsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

// Sessions persist until the user explicitly deletes them.

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTranscriptText(text: string): { timestamp: string; text: string }[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const result: { timestamp: string; text: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.+)/);
    if (match) {
      result.push({ timestamp: match[1], text: match[2] });
    } else if (line.trim()) {
      if (result.length > 0) {
        result[result.length - 1].text += ' ' + line.trim();
      } else {
        result.push({ timestamp: '00:00:00', text: line.trim() });
      }
    }
  }

  return result;
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function writeEnvFile(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n') + '\n';
}

function maskKey(key: string | undefined): string | null {
  if (!key || key.length < 4) return null;
  return '••••' + key.slice(-4);
}

function sttEnvKey(provider: string): string {
  if (provider === 'soniox') return 'SONIOX_API_KEY';
  if (provider === 'elevenlabs') return 'ELEVENLABS_API_KEY';
  return 'DEEPGRAM_API_KEY';
}

function secondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function secondsToTimestampPrecise(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const whole = Math.floor(s);
  const decimal = Math.floor((s - whole) * 10);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${decimal}`;
}

function timestampToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatTranscriptForPrompt(
  transcription: { timestamp: string; text: string }[],
  wordTimestamps?: { word: string; start: number; end: number }[]
): string {
  if (!wordTimestamps || wordTimestamps.length === 0) {
    return transcription
      .map((t) => `[${t.timestamp}] ${t.text}`)
      .join('\n');
  }

  return transcription.map((line) => {
    const lineStartSec = timestampToSeconds(line.timestamp);
    const lineWords = line.text.split(/\s+/);

    // Find the closest word timestamp to this line's start
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < wordTimestamps.length; i++) {
      const diff = Math.abs(wordTimestamps[i].start - lineStartSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
      // Stop early once we're moving away
      if (wordTimestamps[i].start > lineStartSec + 5) break;
    }

    const startTime = wordTimestamps[bestIdx].start;
    const endIdx = Math.min(bestIdx + lineWords.length - 1, wordTimestamps.length - 1);
    const endTime = wordTimestamps[endIdx].end;

    return `[${secondsToTimestampPrecise(startTime)}→${secondsToTimestampPrecise(endTime)}] ${line.text}`;
  }).join('\n');
}

function extractAudio(videoPath: string): Promise<string> {
  const audioPath = videoPath + '.mp3';
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioFrequency(16000)
      .output(audioPath)
      .on('end', () => resolve(audioPath))
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

interface VideoMetadataResult {
  width: number;
  height: number;
  orientation: 'horizontal' | 'vertical';
  durationSeconds: number;
  fps?: number;
}

function probeVideo(videoPath: string): Promise<VideoMetadataResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err: Error | null, metadata: any) => {
      if (err) {
        // ffprobe not available — return safe defaults
        resolve({ width: 1080, height: 1920, orientation: 'vertical', durationSeconds: 0 });
        return;
      }
      const vStream = (metadata.streams || []).find((s: any) => s.codec_type === 'video');
      const width: number = vStream?.width || 1080;
      const height: number = vStream?.height || 1920;
      const orientation: 'horizontal' | 'vertical' = width > height ? 'horizontal' : 'vertical';
      const durationSeconds: number = parseFloat(metadata.format?.duration || '0');
      let fps: number | undefined;
      if (vStream?.r_frame_rate) {
        const parts = vStream.r_frame_rate.split('/').map(Number);
        if (parts.length === 2 && parts[1] > 0) fps = parts[0] / parts[1];
      }
      resolve({ width, height, orientation, durationSeconds, fps });
    });
  });
}

function createSession(videoSrcPath: string): { sessionId: string; sessionVideoPath: string } {
  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionVideoPath = path.join(sessionDir, 'video.mp4');
  fs.renameSync(videoSrcPath, sessionVideoPath);
  return { sessionId, sessionVideoPath };
}

// ── STT Provider Abstraction ─────────────────────────────────────────────────

interface TranscriptionResult {
  transcription: { timestamp: string; text: string }[];
  wordTimestamps: { word: string; start: number; end: number }[];
  speakerTimestamps?: { speaker: string; start: number; end: number }[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function wordsToTranscriptionLines(
  words: { word: string; start: number }[]
): { timestamp: string; text: string }[] {
  if (words.length === 0) return [];

  const lines: { timestamp: string; text: string }[] = [];
  let currentWords: string[] = [];
  let lineStart = words[0].start;

  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i].word);

    const endsWithPunctuation = /[.!?]$/.test(words[i].word);
    const nextWord = words[i + 1];
    const longPause = nextWord && (nextWord.start - words[i].start) > 1.0;
    const isLast = i === words.length - 1;

    if (endsWithPunctuation || longPause || isLast) {
      lines.push({
        timestamp: secondsToTimestamp(lineStart),
        text: currentWords.join(' '),
      });
      currentWords = [];
      if (nextWord) {
        lineStart = nextWord.start;
      }
    }
  }

  return lines;
}

async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  language?: string,
  diarize?: boolean
): Promise<TranscriptionResult> {
  console.log('Sending audio to Deepgram Nova-3...');

  const dgOptions: Record<string, any> = {
    model: 'nova-3',
    smart_format: true,
    utterances: true,
    paragraphs: true,
  };

  if (language) {
    dgOptions.language = language;
  }
  if (diarize) {
    dgOptions.diarize = true;
  }

  const { result } = await withTimeout(
    getDeepgram().listen.prerecorded.transcribeFile(audioBuffer, dgOptions),
    600_000,
    'Deepgram transcription'
  );

  const utterances = result?.results?.utterances || [];
  let transcription: { timestamp: string; text: string }[];

  if (utterances.length > 0) {
    transcription = utterances.map((u: any) => ({
      timestamp: secondsToTimestamp(u.start),
      text: u.transcript,
    }));
  } else {
    const paragraphs =
      result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs || [];
    transcription = [];
    for (const para of paragraphs) {
      for (const sentence of para.sentences || []) {
        transcription.push({
          timestamp: secondsToTimestamp(sentence.start),
          text: sentence.text,
        });
      }
    }
  }

  const words = result?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
  const wordTimestamps = words.map((w: any) => ({
    word: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
  }));

  if (transcription.length === 0) {
    throw new Error('Deepgram returned no transcription results.');
  }

  // Extract speaker timestamps if diarization was requested
  let speakerTimestamps: { speaker: string; start: number; end: number }[] | undefined;
  if (diarize && words.length > 0) {
    const turns: { speaker: string; start: number; end: number }[] = [];
    let currentSpeaker: string | null = null;
    let turnStart = 0;
    let turnEnd = 0;

    for (const w of words) {
      const speaker = `speaker_${w.speaker ?? 0}`;
      if (speaker !== currentSpeaker) {
        if (currentSpeaker !== null) {
          turns.push({ speaker: currentSpeaker, start: turnStart, end: turnEnd });
        }
        currentSpeaker = speaker;
        turnStart = w.start;
      }
      turnEnd = w.end;
    }
    if (currentSpeaker !== null) {
      turns.push({ speaker: currentSpeaker, start: turnStart, end: turnEnd });
    }
    speakerTimestamps = turns;
  }

  return { transcription, wordTimestamps, speakerTimestamps };
}

async function transcribeWithElevenLabs(
  audioPath: string,
  language?: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set in .env (required when STT_PROVIDER=elevenlabs)');
  }

  console.log('Sending audio to ElevenLabs Scribe v2...');

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('model_id', 'scribe_v2');
  form.append('language_code', language || 'heb');
  form.append('timestamps_granularity', 'word');

  const response = await withTimeout(
    fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        ...form.getHeaders(),
      },
      body: form as any,
    }),
    600_000,
    'ElevenLabs transcription'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const words: { text: string; start: number; end: number; type: string }[] = data.words || [];

  const wordTimestamps = words
    .filter((w) => w.type !== 'spacing')
    .map((w) => ({
      word: w.text,
      start: w.start,
      end: w.end,
    }));

  const transcription = wordsToTranscriptionLines(
    wordTimestamps.map((w) => ({ word: w.word, start: w.start }))
  );

  if (transcription.length === 0) {
    throw new Error('ElevenLabs returned no transcription results.');
  }

  return { transcription, wordTimestamps };
}

async function transcribeWithSoniox(
  audioPath: string,
  language?: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) {
    throw new Error('SONIOX_API_KEY is not set in .env (required when STT_PROVIDER=soniox)');
  }

  const headers = { 'Authorization': `Bearer ${apiKey}` };

  // Step 1: Upload file
  console.log('Uploading audio to Soniox...');
  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);
  const uploadForm = new globalThis.FormData();
  uploadForm.append('file', new Blob([fileBuffer]), fileName);

  const uploadRes = await withTimeout(
    fetch('https://api.soniox.com/v1/files', {
      method: 'POST',
      headers,
      body: uploadForm,
    }),
    120_000,
    'Soniox file upload'
  );

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Soniox file upload error (${uploadRes.status}): ${errorText}`);
  }

  const uploadData = await uploadRes.json() as any;
  const fileId: string = uploadData.id;

  // Step 2: Create transcription
  console.log('Starting Soniox transcription...');
  const transcribeBody: Record<string, any> = {
    model: 'stt-async-v4',
    file_id: fileId,
  };
  if (language) {
    transcribeBody.language_hints = [language];
  } else {
    transcribeBody.language_hints = ['he'];
  }

  const transcribeRes = await withTimeout(
    fetch('https://api.soniox.com/v1/transcriptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(transcribeBody),
    }),
    30_000,
    'Soniox create transcription'
  );

  if (!transcribeRes.ok) {
    const errorText = await transcribeRes.text();
    throw new Error(`Soniox transcription error (${transcribeRes.status}): ${errorText}`);
  }

  const transcribeData = await transcribeRes.json() as any;
  const transcriptionId: string = transcribeData.id;

  // Step 3: Poll until completed (max 10 minutes total)
  console.log('Waiting for Soniox transcription to complete...');
  let status = transcribeData.status;
  const TRANSIENT_CODES = new Set([502, 503, 504]);
  const MAX_POLL_RETRIES = 3;
  const pollDeadline = Date.now() + 600_000; // 10-minute ceiling

  while (status === 'queued' || status === 'processing') {
    if (Date.now() > pollDeadline) {
      throw new Error('Soniox transcription timed out after 10 minutes');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));

    let pollData: any;
    for (let attempt = 1; attempt <= MAX_POLL_RETRIES; attempt++) {
      const pollRes = await withTimeout(
        fetch(`https://api.soniox.com/v1/transcriptions/${transcriptionId}`, { headers }),
        15_000,
        'Soniox poll'
      );
      if (pollRes.ok) {
        pollData = await pollRes.json();
        break;
      }
      if (TRANSIENT_CODES.has(pollRes.status) && attempt < MAX_POLL_RETRIES) {
        console.warn(`Soniox poll returned ${pollRes.status}, retrying (${attempt}/${MAX_POLL_RETRIES})...`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      const errorText = await pollRes.text();
      throw new Error(`Soniox poll error (${pollRes.status}): ${errorText}`);
    }

    if (!pollData) {
      throw new Error('Soniox poll failed: all retry attempts exhausted with transient errors');
    }

    status = pollData.status;
    if (status === 'error') {
      throw new Error(`Soniox transcription failed: ${pollData.error_message || 'unknown error'}`);
    }
  }

  // Step 4: Fetch transcript
  const resultRes = await fetch(
    `https://api.soniox.com/v1/transcriptions/${transcriptionId}/transcript`,
    { headers },
  );

  if (!resultRes.ok) {
    const errorText = await resultRes.text();
    throw new Error(`Soniox transcript fetch error (${resultRes.status}): ${errorText}`);
  }

  const data = await resultRes.json() as any;
  const tokens: { text: string; start_ms: number; end_ms: number }[] = data.tokens || [];

  // Soniox returns sub-word tokens. A leading space means "new word".
  // Merge tokens into full words with correct start/end times.
  const wordTimestamps: { word: string; start: number; end: number }[] = [];
  let currentWord = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (const token of tokens) {
    const startsNewWord = token.text.startsWith(' ');
    const text = token.text.trimStart();

    if (startsNewWord && currentWord) {
      wordTimestamps.push({ word: currentWord, start: wordStart, end: wordEnd });
      currentWord = text;
      wordStart = token.start_ms / 1000;
      wordEnd = token.end_ms / 1000;
    } else if (!currentWord) {
      currentWord = text;
      wordStart = token.start_ms / 1000;
      wordEnd = token.end_ms / 1000;
    } else {
      currentWord += text;
      wordEnd = token.end_ms / 1000;
    }
  }
  if (currentWord) {
    wordTimestamps.push({ word: currentWord, start: wordStart, end: wordEnd });
  }

  const transcription = wordsToTranscriptionLines(
    wordTimestamps.map((w) => ({ word: w.word, start: w.start }))
  );

  if (transcription.length === 0) {
    throw new Error('Soniox returned no transcription results.');
  }

  return { transcription, wordTimestamps };
}

// ── Reel Generation ─────────────────────────────────────────────────────────

const REELS_JSON_SCHEMA = `{
  "reels": [
    {
      "title": "string",
      "hookReason": "string — ARCHETYPE label + why this clip grabs attention",
      "description": "string — 1-2 sentence description of the content and why it works as a reel",
      "isMultiSegment": false,
      "multiSegmentReason": "string — required if isMultiSegment: why these clips belong together",
      "segments": [
        {
          "inTimestamp": "[HH:MM:SS]",
          "outTimestamp": "[HH:MM:SS]"
        }
      ]
    }
  ]
}`;

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: CLAUDE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
  });
  return response.choices[0]?.message?.content || '';
}

const REELS_SYSTEM_PROMPT = `You are an elite short-form video editor. You'd rather output 3 great reels than 10 mediocre ones.

═══ THE THREE RULES ═══
These are the only things that matter. Get these right and everything else follows.

RULE 1 — HOOKS START BEFORE THE MOMENT, NOT AT IT
The biggest mistake: starting at the interesting statement. The hook is the sentence that CREATES tension or curiosity BEFORE the payoff. Read 3-5 lines before any moment you like — that's where the real IN point is.
Bad: Starting at "giving to get isn't real giving" (the insight itself)
Good: Starting at "it's kind of like going on a date and paying for dinner and then expecting sex" (the analogy that SETS UP the insight)
Bad: Starting at "I became exactly what I used to laugh at" (the punchline)
Good: Starting at "I remember having so much fear in my body during that period" (the emotional setup)

RULE 2 — EVERY REEL MUST LAND
Two types of landing:
• STORY reels (30-90s): setup → build → RESOLUTION. If someone asks "so what?" at the end, the reel failed. Extend OUT until there's a clear payoff — a realization, a transformation, a punchline. "I was afraid, and then it happened" is NOT a reel — what happened AFTER is the reel.
• HIGHLIGHT reels (15-30s): The statement IS the landing. It must be genuinely quotable — so sharp and complete that a stranger would screenshot it. Not every "interesting moment" is a highlight. If you have to explain why it's good, it's not one.

RULE 3 — DIG DEEPER THAN THE OBVIOUS
The biggest quality killer is surface-level moment picking — grabbing the 8-10 moments that "feel interesting" on a first skim. Every editor finds those. A great editor reads the transcript THREE times and finds the moments others miss:
• Quiet moments that build to something powerful
• Specific stories with vivid details (not just abstract insights)
• Emotional turns where the speaker's energy visibly shifts
• Surprising admissions or counterintuitive realizations buried in longer passages
• Moments in the SECOND HALF of long talks that a lazy read would skip

Spread your reels across the full timeline. If all your picks cluster in the same 10-minute window, you haven't read deeply enough.

═══ CLEAN CUTS ═══
• OUT point: After a complete, strong sentence. Never mid-thought. Never on trailing phrases ("so yeah…", "anyway…", "and that's kind of…"). End on a punchline, insight, or emotional peak.
• Multi-segment: Only when cutting filler from within one story or combining two moments that build ONE narrative. Default to single clips.
• Don't cut mid-sentence. Period.

═══ ARCHETYPES ═══
STORY types: MINI-STORY (30-90s arc), HOW-TO NUGGET (30-60s advice), EMOTIONAL PEAK (30-60s buildup)
HIGHLIGHT types: HOT TAKE (15-30s bold opinion), INSIGHT BOMB (15-30s reframe), QUOTABLE (15-25s soundbite)
Label each reel's archetype in hookReason. Diversify — don't make 5 INSIGHT BOMBs.

═══ QUALITY GATE ═══
For each reel, ask yourself:
1. Would a stranger stop scrolling at the FIRST sentence? (not the third — the first)
2. Does the reel feel COMPLETE? (Story: has payoff. Highlight: self-contained.)
3. Would you personally send this to a friend?
If any answer is no, drop it. Fewer > mediocre.

═══ FORMAT ═══
Transcript may use [HH:MM:SS] or [HH:MM:SS.s→HH:MM:SS.s] format. Output timestamps as [HH:MM:SS].
DO NOT output wordsIn, wordsOut, or transcriptExcerpt — system populates those.
Your ENTIRE response must be valid JSON. First character { last character }. No text, no markdown, no code fences.`;

async function callClaudeForReels(prompt: string): Promise<{ reels: any[] }> {
  const raw = await callClaude(REELS_SYSTEM_PROMPT, prompt);
  return parseClaudeReelsResponse(raw);
}

function parseClaudeReelsResponse(raw: string): { reels: any[] } {
  // Strip markdown code fences
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

  // 1. Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.reels) {
      validateReelSegments(parsed.reels);
      return parsed;
    }
  } catch {}

  // 2. Find the outermost JSON object containing "reels"
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.reels) {
        validateReelSegments(parsed.reels);
        return parsed;
      }
    } catch {}
  }

  // 3. Try to find JSON starting from {"reels" pattern (AI may have prefixed text)
  const reelsIdx = cleaned.indexOf('{"reels"');
  if (reelsIdx !== -1) {
    const fromReels = cleaned.slice(reelsIdx);
    const lastB = fromReels.lastIndexOf('}');
    if (lastB !== -1) {
      try {
        const parsed = JSON.parse(fromReels.slice(0, lastB + 1));
        if (parsed.reels) {
          validateReelSegments(parsed.reels);
          return parsed;
        }
      } catch {}
    }
  }

  // 4. Give up with a descriptive error
  const preview = raw.slice(0, 150).replace(/\n/g, ' ');
  throw new Error(`AI returned text instead of JSON. Preview: "${preview}..."`);
}

function validateReelSegments(reels: any[]): any[] {
  for (const reel of reels) {
    if (!reel.segments || !Array.isArray(reel.segments)) continue;
    for (const seg of reel.segments) {
      // Normalize shorthand field names the model sometimes emits
      if (!seg.inTimestamp && seg.in) seg.inTimestamp = seg.in;
      if (!seg.outTimestamp && seg.out) seg.outTimestamp = seg.out;

      const inSec = timestampToSeconds(
        (seg.inTimestamp || '').replace(/[\[\]]/g, '')
      );
      const outSec = timestampToSeconds(
        (seg.outTimestamp || '').replace(/[\[\]]/g, '')
      );

      if (outSec < inSec) {
        // Swap — AI returned timestamps in wrong order
        console.warn(
          `Fixing swapped timestamps: IN=${seg.inTimestamp} OUT=${seg.outTimestamp} (title: ${reel.title})`
        );
        const tmp = seg.inTimestamp;
        seg.inTimestamp = seg.outTimestamp;
        seg.outTimestamp = tmp;
      } else if (outSec === inSec) {
        // Same second — push OUT forward by 5 seconds as a minimum viable clip
        console.warn(
          `Fixing zero-length segment: IN=${seg.inTimestamp} OUT=${seg.outTimestamp} (title: ${reel.title})`
        );
        seg.outTimestamp = `[${secondsToTimestamp(inSec + 5)}]`;
      }
    }
  }
  return reels;
}

function populateSegmentText(
  reels: any[],
  transcription: { timestamp: string; text: string }[]
): void {
  for (const reel of reels) {
    if (!reel.segments || !Array.isArray(reel.segments)) continue;
    for (const seg of reel.segments) {
      const inSec = timestampToSeconds(
        (seg.inTimestamp || '').replace(/[\[\]]/g, '')
      );
      const outSec = timestampToSeconds(
        (seg.outTimestamp || '').replace(/[\[\]]/g, '')
      );

      // Collect transcript lines that fall within [inSec, outSec]
      const lines: string[] = [];
      for (const line of transcription) {
        const lineSec = timestampToSeconds(line.timestamp);
        if (lineSec >= inSec - 0.5 && lineSec <= outSec + 0.5) {
          lines.push(line.text);
        }
        if (lineSec > outSec + 1) break;
      }

      const fullText = lines.join(' ');
      const words = fullText.split(/\s+/);

      seg.transcriptExcerpt = fullText || seg.transcriptExcerpt || '';
      seg.wordsIn = seg.wordsIn || (words.length > 0
        ? words.slice(0, Math.min(8, words.length)).join(' ') + (words.length > 8 ? '' : '')
        : '');
      seg.wordsOut = seg.wordsOut || (words.length > 0
        ? (words.length > 8 ? '' : '') + words.slice(-Math.min(8, words.length)).join(' ')
        : '');
    }
  }
}

// ── Creative Brief Helpers ────────────────────────────────────────────────────

function buildCreativeBriefSection(brief?: {
  platform?: string;
  purpose?: string;
  tone?: string;
  contentFocus?: string;
}): string {
  if (!brief || (!brief.platform && !brief.purpose && !brief.tone && !brief.contentFocus)) {
    return '';
  }

  let section = '\n═══ CREATIVE BRIEF ═══\n';

  if (brief.platform) {
    const platformGuide: Record<string, string> = {
      tiktok: 'TikTok — Favor 15-30s clips. Fast-paced, punchy hooks, trend-friendly energy. Front-load the hook within 1 second.',
      instagram: 'Instagram Reels — Favor 20-45s clips. Polished feel, strong visual moments, clear value proposition.',
      youtube: 'YouTube Shorts — Favor 30-60s clips. Can go slightly deeper. Reward curiosity and payoff. Vertical format.',
      linkedin: 'LinkedIn — Favor 30-90s clips. Professional tone welcome, depth over flash. Thought leadership and actionable insights.',
    };
    section += `Platform: ${platformGuide[brief.platform] || brief.platform}\n`;
  }

  if (brief.purpose) {
    const purposeGuide: Record<string, string> = {
      grow: 'Goal: Grow followers — Prioritize shareable, relatable, and surprising moments. Hooks that make people tag a friend.',
      educate: 'Goal: Educate — Prioritize clear takeaways and actionable advice. Each clip should teach something specific.',
      entertain: 'Goal: Entertain — Prioritize humor, emotion, and energy. Moments that make people feel something.',
      traffic: 'Goal: Drive traffic — Prioritize clips that create curiosity gaps and leave viewers wanting more context.',
      authority: 'Goal: Build authority — Prioritize bold insights, unique perspectives, and expertise demonstrations.',
    };
    section += `${purposeGuide[brief.purpose] || brief.purpose}\n`;
  }

  if (brief.tone) {
    const toneGuide: Record<string, string> = {
      professional: 'Tone: Professional — Select polished, articulate moments. Avoid casual asides or unfinished thoughts.',
      casual: 'Tone: Casual — Embrace natural conversation, relatability. Authentic moments over polished delivery.',
      funny: 'Tone: Funny — Hunt for humor, wit, irony, and comedic timing. Punchlines and unexpected turns.',
      inspirational: 'Tone: Inspirational — Find passionate, uplifting, and motivating moments. Emotional crescendos.',
      provocative: 'Tone: Provocative — Bold opinions, contrarian views, debate-sparking statements. Lean into controversy.',
      storytelling: 'Tone: Storytelling — Favor narrative arcs, vivid descriptions, and moments with dramatic tension.',
    };
    section += `${toneGuide[brief.tone] || brief.tone}\n`;
  }

  if (brief.contentFocus) {
    section += `Content focus: ${brief.contentFocus}\n`;
  }

  return section + '\n';
}

function getPlatformDurationInstruction(
  duration: number | 'auto',
  platform?: string
): string {
  if (duration !== 'auto') {
    return `Each reel should target approximately ${duration} seconds in duration (this is an approximate target, not a hard limit).`;
  }

  if (platform) {
    const platformDefaults: Record<string, string> = {
      tiktok: 'Each reel should be 15-30 seconds, optimized for TikTok\'s fast-scroll environment.',
      instagram: 'Each reel should be 20-45 seconds, optimized for Instagram Reels.',
      youtube: 'Each reel should be 30-60 seconds, taking advantage of YouTube Shorts\' slightly longer format.',
      linkedin: 'Each reel should be 30-90 seconds, allowing depth appropriate for LinkedIn.',
    };
    return platformDefaults[platform] || 'Each reel should be between 20-60 seconds, choosing the best duration for the content.';
  }

  return 'Each reel should be between 20-60 seconds, choosing the best duration for the content.';
}

function getVarietyInstruction(reelCount: number): string {
  if (reelCount >= 5) {
    return 'Ensure at least 4 different archetypes are represented across your selections. ';
  }
  if (reelCount >= 3) {
    return 'Ensure at least 3 different archetypes are represented across your selections. ';
  }
  return '';
}

// ── GET /api/config/status ───────────────────────────────────────────────────

app.get('/api/config/status', (_req, res) => {
  const envPath = path.resolve('.env');
  let vars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    vars = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  }
  // Merge with already-loaded process.env so existing deployments work
  const orKey = vars.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  const gemKey = vars.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const provider = (vars.STT_PROVIDER || process.env.STT_PROVIDER || 'soniox') as string;
  const sttKey = vars[sttEnvKey(provider)] || process.env[sttEnvKey(provider)];

  res.json({
    hasOpenRouter: !!orKey,
    hasGemini: !!gemKey,
    sttProvider: provider,
    hasSttKey: !!sttKey,
    isConfigured: !!orKey && !!gemKey && !!sttKey,
    openRouterPreview: maskKey(orKey),
    geminiPreview: maskKey(gemKey),
    sttKeyPreview: maskKey(sttKey),
  });
});

// ── POST /api/config/save ────────────────────────────────────────────────────

app.post('/api/config/save', (req, res) => {
  try {
    const { openRouterKey, geminiKey, sttProvider, sttKey } = req.body as {
      openRouterKey?: string;
      geminiKey?: string;
      sttProvider?: string;
      sttKey?: string;
    };

    const envPath = path.resolve('.env');
    let vars: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
      vars = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
    }

    if (openRouterKey?.trim()) {
      vars.OPENROUTER_API_KEY = openRouterKey.trim();
      process.env.OPENROUTER_API_KEY = openRouterKey.trim();
      openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openRouterKey.trim() });
    }
    if (geminiKey?.trim()) {
      vars.GEMINI_API_KEY = geminiKey.trim();
      process.env.GEMINI_API_KEY = geminiKey.trim();
      ai = new GoogleGenAI({ apiKey: geminiKey.trim() });
    }
    if (sttProvider?.trim()) {
      vars.STT_PROVIDER = sttProvider.trim();
      process.env.STT_PROVIDER = sttProvider.trim();
    }
    if (sttKey?.trim()) {
      const envName = sttEnvKey(sttProvider || process.env.STT_PROVIDER || 'soniox');
      vars[envName] = sttKey.trim();
      process.env[envName] = sttKey.trim();
      if (envName === 'DEEPGRAM_API_KEY') _deepgram = null; // force lazy re-init
    }

    fs.writeFileSync(envPath, writeEnvFile(vars));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/transcribe ─────────────────────────────────────────────────────

const transcribeUpload = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'transcript', maxCount: 1 },
]);

app.post('/api/transcribe', transcribeUpload, async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const videoFile = files?.video?.[0];
  const transcriptFile = files?.transcript?.[0];

  if (!videoFile && !transcriptFile) {
    res.status(400).json({ error: 'Provide a video file or a transcript file.' });
    return;
  }

  const uploadMode: 'highlight' | 'interaction' | 'audio' =
    req.body?.mode === 'interaction' ? 'interaction' :
    req.body?.mode === 'audio' ? 'audio' : 'highlight';
  const language: string | undefined = req.body?.language || undefined;
  const diarize = uploadMode === 'interaction';

  // Validate MIME type for audio-only uploads
  if (uploadMode === 'audio' && videoFile && !videoFile.mimetype.startsWith('audio/')) {
    fs.unlink(videoFile.path, () => {});
    res.status(400).json({ error: 'Please upload an audio file (MP3, WAV, M4A, etc.).' });
    return;
  }

  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    let videoMeta: VideoMetadataResult | undefined;
    const pendingData: any = {
      sessionId,
      status: 'pending',
      uploadMode,
      originalFilename: videoFile?.originalname || transcriptFile?.originalname || 'upload',
      language,
      diarize,
      createdAt: new Date().toISOString(),
      summary: '',
    };

    if (uploadMode === 'audio' && videoFile) {
      // Save audio file to session dir (preserve extension)
      const ext = path.extname(videoFile.originalname).toLowerCase() || '.mp3';
      const audioFilename = `audio${ext}`;
      fs.renameSync(videoFile.path, path.join(sessionDir, audioFilename));
      (videoFile as any).__movedToSession = true;
      pendingData.audioFilename = audioFilename;
    } else if (videoFile) {
      // Video mode: probe metadata, move to session dir
      videoMeta = await probeVideo(videoFile.path);
      fs.renameSync(videoFile.path, path.join(sessionDir, 'video.mp4'));
      (videoFile as any).__movedToSession = true;
      pendingData.videoMetadata = videoMeta;
    }

    // If a transcript was provided, parse it now (fast — no AI needed yet)
    if (transcriptFile) {
      const raw = fs.readFileSync(transcriptFile.path, 'utf-8');
      let transcriptionParsed: { timestamp: string; text: string }[];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          transcriptionParsed = parsed;
        } else if (parsed.transcription && Array.isArray(parsed.transcription)) {
          transcriptionParsed = parsed.transcription;
        } else {
          throw new Error('not array');
        }
      } catch {
        transcriptionParsed = parseTranscriptText(raw);
      }
      pendingData.transcriptionParsed = transcriptionParsed;
    }

    // Write pending session.json
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(pendingData));

    res.json({ sessionId, videoMetadata: videoMeta });
  } catch (err: any) {
    console.error('Error in /api/transcribe Phase A:', err);
    res.status(500).json({ error: err.message || 'Failed to process upload.' });
  } finally {
    if (videoFile && !(videoFile as any).__movedToSession) {
      fs.unlink(videoFile.path, () => {});
    }
    if (transcriptFile) fs.unlink(transcriptFile.path, () => {});
  }
});

// ── GET /api/sessions/:sessionId/process — Phase B: transcribe + summarize ───

app.get('/api/sessions/:sessionId/process', async (req, res) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }

  const sessionDir = path.join(sessionsDir, sessionId);
  const sessionJsonPath = path.join(sessionDir, 'session.json');

  if (!fs.existsSync(sessionJsonPath)) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const pending = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));

  // If already complete, replay the complete event immediately
  if (pending.status === 'complete') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ phase: 'complete', data: {
      transcription: pending.transcription,
      summary: pending.summary,
      wordTimestamps: pending.wordTimestamps,
      speakerTimestamps: pending.speakerTimestamps,
      uploadMode: pending.uploadMode,
      videoMetadata: pending.videoMetadata,
    }})}\n\n`);
    res.end();
    return;
  }

  if (pending.status === 'processing') {
    const staleMs = 20 * 60 * 1000; // 20 minutes
    if (pending.processingStartedAt && Date.now() - pending.processingStartedAt < staleMs) {
      res.status(409).json({ error: 'Processing already in progress. Please wait a moment and try again.' });
      return;
    }
    // Stale lock — server likely crashed mid-processing; reset and retry
    console.warn(`[${sessionId}] Stale processing lock detected — resetting to pending`);
    pending.status = 'pending';
    delete pending.processingStartedAt;
  }

  // Mark as processing
  pending.status = 'processing';
  pending.processingStartedAt = Date.now();
  fs.writeFileSync(sessionJsonPath, JSON.stringify(pending));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendEvent(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') (res as any).flush();
  }

  // Keepalive pings every 30s — prevents proxies/browsers from closing the connection
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 30_000);

  let audioPath: string | null = null;

  try {
    const { uploadMode, language, diarize, transcriptionParsed } = pending;
    const provider = process.env.STT_PROVIDER || 'deepgram';

    let transcription: { timestamp: string; text: string }[];
    let wordTimestamps: { word: string; start: number; end: number }[] | undefined;
    let speakerTimestamps: { speaker: string; start: number; end: number }[] | undefined;

    if (transcriptionParsed) {
      // Fast path: transcript was provided, skip STT
      transcription = transcriptionParsed;
      sendEvent({ phase: 'summarizing' });
    } else if (uploadMode === 'audio') {
      // Audio-only: read audio file directly, no ffmpeg extraction needed
      const audioFilePath = path.join(sessionDir, pending.audioFilename);
      const audioBuffer = fs.readFileSync(audioFilePath);

      console.log(`[${sessionId}] Transcribing audio file (${provider})...`);
      sendEvent({ phase: 'transcribing' });

      let result: TranscriptionResult;
      switch (provider) {
        case 'elevenlabs':
          result = await transcribeWithElevenLabs(audioFilePath, language);
          break;
        case 'soniox':
          result = await transcribeWithSoniox(audioFilePath, language);
          break;
        default:
          result = await transcribeWithDeepgram(audioBuffer, language, false);
      }
      transcription = result.transcription;
      wordTimestamps = result.wordTimestamps;

      sendEvent({ phase: 'summarizing' });
    } else {
      // Video mode: extract audio, then transcribe
      const videoPath = path.join(sessionDir, 'video.mp4');

      console.log(`[${sessionId}] Extracting audio...`);
      sendEvent({ phase: 'extracting_audio' });
      audioPath = await extractAudio(videoPath);

      const audioBuffer = fs.readFileSync(audioPath);

      console.log(`[${sessionId}] Transcribing with ${provider}${diarize ? ' (diarize)' : ''}...`);
      sendEvent({ phase: 'transcribing' });

      let result: TranscriptionResult;
      switch (provider) {
        case 'elevenlabs':
          result = await transcribeWithElevenLabs(audioPath, language);
          break;
        case 'soniox':
          result = await transcribeWithSoniox(audioPath, language);
          break;
        default:
          result = await transcribeWithDeepgram(audioBuffer, language, diarize);
      }
      transcription = result.transcription;
      wordTimestamps = result.wordTimestamps;
      speakerTimestamps = result.speakerTimestamps;

      sendEvent({ phase: 'summarizing' });
    }

    // Generate AI summary with Gemini
    console.log(`[${sessionId}] Generating summary...`);
    const transcriptText = transcription.map((t) => `[${t.timestamp}] ${t.text}`).join('\n');
    const summaryResponse = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [{ text: uploadMode === 'audio'
            ? `Here is an audio recording transcript:\n\n${transcriptText}\n\nProvide a concise 2-4 sentence summary of what this recording covers, its main topics, and who might find it useful.`
            : `Here is a video transcript:\n\n${transcriptText}\n\nProvide a concise 2-4 sentence summary of what this video covers, its main topics, and who might find it useful.`
          }],
        }],
        config: { temperature: 0.3 },
      }),
      90_000,
      'Gemini summary'
    );
    const summary = summaryResponse.text || 'Summary could not be generated.';

    // Write complete session.json
    const completeData = {
      ...pending,
      status: 'complete',
      transcription,
      wordTimestamps: wordTimestamps || [],
      speakerTimestamps,
      summary,
      transcriptionParsed: undefined,  // don't persist the parsed cache
    };
    fs.writeFileSync(sessionJsonPath, JSON.stringify(completeData));

    sendEvent({ phase: 'complete', data: {
      transcription,
      summary,
      wordTimestamps,
      speakerTimestamps,
      uploadMode,
      videoMetadata: pending.videoMetadata,
    }});
    res.end();
  } catch (err: any) {
    console.error(`[${sessionId}] Error in process endpoint:`, err);
    // Reset to pending so the client can retry
    try {
      pending.status = 'pending';
      fs.writeFileSync(sessionJsonPath, JSON.stringify(pending));
    } catch {}
    sendEvent({ phase: 'error', message: err.message || 'Processing failed.' });
    res.end();
  } finally {
    clearInterval(keepalive);
    if (audioPath) fs.unlink(audioPath, () => {});
  }
});

// ── POST /api/interpret-prompt ───────────────────────────────────────────────

app.post('/api/interpret-prompt', async (req, res) => {
  const { prompt, transcription } = req.body;

  if (!prompt || !transcription) {
    res.status(400).json({ error: 'Both prompt and transcription are required.' });
    return;
  }

  try {
    const transcriptText = transcription
      .map((t: { timestamp: string; text: string }) => `[${t.timestamp}] ${t.text}`)
      .join('\n');

    const interpretation = await callClaude(
      'You are helping a video editor create short-form reels from a longer video.',
      `Here is the full transcript of the video:\n${transcriptText}\n\nThe user has given these instructions for what kind of reels they want:\n"${prompt}"\n\nSummarize in 2-4 sentences exactly what you understand the user wants. Be specific about the type of content, tone, number of reels, duration preferences, and any other details you can infer. If anything is ambiguous, state your best interpretation.`,
    );

    res.json({ interpretation: interpretation || 'Could not interpret the prompt.' });
  } catch (err: any) {
    console.error('Error in /api/interpret-prompt:', err);
    res.status(500).json({ error: err.message || 'Failed to interpret prompt.' });
  }
});

// ── POST /api/generate-reels (SSE streaming) ────────────────────────────────

app.post('/api/generate-reels', async (req, res) => {
  const { transcription, mode, guided, customPrompt, creativeBrief, wordTimestamps } = req.body;

  if (!transcription) {
    res.status(400).json({ error: 'Transcription is required.' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const transcriptText = formatTranscriptForPrompt(transcription, wordTimestamps);
    const briefSection = buildCreativeBriefSection(creativeBrief);

    let prompt: string;

    if (mode === 'custom' && customPrompt) {
      prompt = `TRANSCRIPT:
${transcriptText}
${briefSection}
USER INSTRUCTIONS: "${customPrompt}"

Read the entire transcript carefully. Find moments matching the user's criteria. For each: set the IN point at the sentence that CREATES tension (not the payoff sentence), and the OUT point after a complete resolution. Drop anything where a stranger would ask "so what?" at the end.

Respond with ONLY JSON (first char must be {):
${REELS_JSON_SCHEMA}`;
    } else {
      const numReels = guided?.numberOfReels || 0;
      const duration = guided?.duration || 'auto';
      const complexEdits = guided?.complexEdits || false;

      const reelCountInstruction =
        numReels > 0
          ? `up to ${numReels} reels (fewer is fine if quality isn't there)`
          : `up to 10 reels (fewer is fine — quality over quantity)`;

      const durationInstruction = getPlatformDurationInstruction(duration, creativeBrief?.platform);

      const complexEditsInstruction = complexEdits
        ? `\nCOMPLEX EDITS MODE: Create multi-segment reels combining clips from different parts. Look for setups in one section with payoffs in another. Aim for at least half multi-segment.`
        : '';

      const varietyInstruction = getVarietyInstruction(numReels || 7);

      prompt = `TRANSCRIPT:
${transcriptText}
${briefSection}
Find ${reelCountInstruction}. ${durationInstruction}${complexEditsInstruction}
${varietyInstruction}

Read the transcript THREE times before selecting moments. On the first read, note every interesting moment. On the second read, look for moments you MISSED — quieter stories, specific anecdotes, emotional turns buried in longer passages, strong moments in the second half. On the third read, choose your final picks.

For each reel:
- Set IN at the sentence that CREATES tension/curiosity (3-5 lines BEFORE the obvious moment)
- Set OUT AFTER the resolution lands — the insight, punchline, or emotional payoff
- If a reel would make someone ask "so what?" or "and then?", either extend it to include the answer or drop it
- End on a strong sentence, never mid-thought or on trailing filler

Respond with ONLY JSON (first char must be {):
${REELS_JSON_SCHEMA}`;
    }

    res.write(`data: ${JSON.stringify({ phase: 'sending' })}\n\n`);

    const stream = await openrouter.chat.completions.create({
      model: CLAUDE_MODEL,
      messages: [
        { role: 'system', content: REELS_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      stream: true,
    });

    let fullText = '';
    let lastEventTime = 0;
    let jsonLikely = false;
    const MAX_RESPONSE_CHARS = 60000;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;

        // Early detection: after 200 chars, check if response looks like JSON
        if (!jsonLikely && fullText.length > 200) {
          const trimmed = fullText.trimStart();
          if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
            jsonLikely = true;
          }
        }
        // After 600 chars with no JSON start, abort early
        if (!jsonLikely && fullText.length > 600) {
          const trimmed = fullText.trimStart();
          if (!trimmed.includes('{')) {
            const preview = fullText.slice(0, 120).replace(/\n/g, ' ');
            throw new Error(`AI returned text instead of JSON. Preview: "${preview}..."`);
          }
          jsonLikely = true; // found a brace somewhere, let it continue
        }

        // Safety cap to prevent runaway responses
        if (fullText.length > MAX_RESPONSE_CHARS) {
          throw new Error(`Response exceeded ${MAX_RESPONSE_CHARS} chars — aborting.`);
        }

        const now = Date.now();
        if (now - lastEventTime > 200) {
          res.write(`data: ${JSON.stringify({ phase: 'streaming', chars: fullText.length })}\n\n`);
          lastEventTime = now;
        }
      }
    }
    res.write(`data: ${JSON.stringify({ phase: 'streaming', chars: fullText.length })}\n\n`);

    res.write(`data: ${JSON.stringify({ phase: 'parsing' })}\n\n`);

    const parsed = parseClaudeReelsResponse(fullText);
    populateSegmentText(parsed.reels, transcription);

    res.write(`data: ${JSON.stringify({ phase: 'complete', reels: parsed.reels })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Error in /api/generate-reels:', err);
    res.write(`data: ${JSON.stringify({ phase: 'error', message: err.message || 'Failed to generate reels.' })}\n\n`);
    res.end();
  }
});

// ── POST /api/regenerate-reel ────────────────────────────────────────────────

app.post('/api/regenerate-reel', async (req, res) => {
  const { transcription, originalReel, feedback, config } = req.body;

  if (!transcription || !originalReel) {
    res.status(400).json({ error: 'Transcription and originalReel are required.' });
    return;
  }

  try {
    const transcriptText = transcription
      .map((t: { timestamp: string; text: string }) => `[${t.timestamp}] ${t.text}`)
      .join('\n');

    const durationInstruction = config?.duration && config.duration !== 'auto'
      ? `Target approximately ${config.duration} seconds duration.`
      : '';

    const customInstruction = config?.customPrompt
      ? `Additional instructions: "${config.customPrompt}"`
      : '';

    const prompt = `Here is a timestamped transcript of a solo speaker video:

${transcriptText}

Here is an existing reel the user wants improved:
Title: ${originalReel.title}
Description: ${originalReel.description}
Segments: ${JSON.stringify(originalReel.segments)}

User feedback: "${feedback || 'No specific feedback, just make it better.'}"

${durationInstruction}
${customInstruction}

Find a better version of this reel. Decide: is this a STORY reel (needs arc) or HIGHLIGHT (standalone moment)? Verify the clip starts with a strong hook and ends with a complete thought. Return exactly 1 reel.

IMPORTANT: Output ONLY valid JSON — no commentary, no explanation. First character must be {.

Use this JSON schema:
${REELS_JSON_SCHEMA}`;

    const parsed = await callClaudeForReels(prompt);
    populateSegmentText(parsed.reels, transcription);
    const reel = parsed.reels?.[0];

    if (!reel) {
      throw new Error('No reel returned from AI.');
    }

    res.json({ reel });
  } catch (err: any) {
    console.error('Error in /api/regenerate-reel:', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate reel.' });
  }
});

// ── POST /api/chat (SSE streaming) ───────────────────────────────────────────

interface ChatContext {
  summary: string;
  transcription: { timestamp: string; text: string }[];
  reels: { title: string; description: string; inTimestamp: string; outTimestamp: string }[];
  activeReel?: { index: number; title: string; description: string; inTimestamp: string; outTimestamp: string };
}

function buildChatSystemPrompt(context: ChatContext): string {
  const transcriptText = (context.transcription || [])
    .map((t) => `[${t.timestamp}] ${t.text}`)
    .join('\n');

  const reelsList = context.reels
    .map((r, i) => `${i + 1}. "${r.title}" (${r.inTimestamp} - ${r.outTimestamp}): ${r.description}`)
    .join('\n');

  return `You are Goozim, a sharp and friendly brainstorming assistant for short-form video creators.
You know the user's video inside and out — the full transcript is below.
Help them find hidden gems, craft scroll-stopping hooks, and turn raw footage into viral reels.
Keep it punchy, specific, and grounded in what was actually said.

FULL TRANSCRIPT:
${transcriptText || '(No transcript available)'}

VIDEO SUMMARY:
${context.summary}

CURRENT REELS (already created — don't duplicate these):
${reelsList || '(No reels generated yet)'}

ACTIVE REEL — currently in view on the user's screen:
${context.activeReel
  ? `Reel #${context.activeReel.index + 1}: "${context.activeReel.title}" (${context.activeReel.inTimestamp} → ${context.activeReel.outTimestamp})\n${context.activeReel.description}\n\nWhen the user says "this reel", "this clip", "this one", or similar, they are referring to the ACTIVE REEL above.`
  : '(None selected)'}

FORMAT FOR NEW REEL SUGGESTIONS:
When you suggest a reel, you MUST use this exact format (the ** bold markers are required — the app uses them to show a "Generate" button):

**Reel Idea: "Your Title Here"**
Hook: [first sentence that grabs attention]
Timestamps: [HH:MM:SS] - [HH:MM:SS]
Why it works: [1 sentence]

FORMAT FOR MODIFYING EXISTING REELS:
When the user wants to change or improve an existing reel, use this format:

**Modify Reel #N: "Reel Title"**
Feedback: [specific instructions for the change]

Where N is the reel number from the CURRENT REELS list above.

FORMAT FOR DELETING REELS:
When the user wants to remove a reel, use this format:

**Delete Reel #N: "Reel Title"**
Reason: [brief explanation]

Always confirm the reel title so the user knows which one will be deleted.

RULES:
- Always cite specific [HH:MM:SS] timestamps from the transcript above.
- Quote the actual words from the transcript when relevant.
- Be concise — short punchy answers, not essays.
- When the user asks for ideas, suggest 2-3 unless they ask for more.
- When the user references a reel by number, name, or description, match it to the CURRENT REELS list.
- You can suggest modifications and deletions proactively when reviewing reels.

MULTI-SEGMENT REELS:
- You can suggest "complex edit" reels that combine clips from different parts of the video.
- Example: a setup from minute 2 with a payoff from minute 15, contrasting viewpoints, or thematic compilations.
- When suggesting multi-segment ideas, list each timestamp range:
  Timestamps: [HH:MM:SS] - [HH:MM:SS] + [HH:MM:SS] - [HH:MM:SS]
- Briefly explain why combining them creates a stronger reel.`;
}

function convertHistoryToContents(history: { role: string; content: string }[]) {
  return history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
}

app.post('/api/chat', async (req, res) => {
  const { message, history, context } = req.body as {
    message: string;
    history: { role: string; content: string }[];
    context: ChatContext;
  };

  if (!message || !context) {
    res.status(400).json({ error: 'message and context are required.' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const systemPrompt = buildChatSystemPrompt(context);
    const contents = [
      ...convertHistoryToContents(history || []),
      { role: 'user', parts: [{ text: message }] },
    ];

    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        systemInstruction: systemPrompt,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Error in /api/chat:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Chat failed.' })}\n\n`);
    res.end();
  }
});

// ── POST /api/detect-interactions (SSE) ─────────────────────────────────────

const INTERACTION_SYSTEM_PROMPT = `You are an expert editor for Q&A and audience interaction videos.

YOUR ONLY JOB: Identify every distinct one-on-one exchange between MAIN_SPEAKER and each GUEST, and output one reel per exchange.

════ WHAT COUNTS AS ONE REEL ════
• One GUEST speaks → MAIN_SPEAKER responds (possibly multiple turns back and forth) → the exchange concludes.
• That entire back-and-forth = ONE reel, no matter if it's 2 minutes or 20 minutes.
• If the same GUEST has a second separate topic or question later in the video, that is a SECOND reel.
• !!HARD RULE!! Never combine two different GUESTs into one reel. EVER. The moment the labeled transcript shows a new GUEST label (e.g. [GUEST_2] appearing after [GUEST_1] lines), that is a MANDATORY OUT point for the current reel and MANDATORY IN point for the next reel.
• Never include lines from other GUESTs unless they are a very brief interjection (< 5 words) within an ongoing exchange.
• Skip any opening/intro section before the first real Q&A exchange begins.

════ MANDATORY REEL BOUNDARY SIGNALS ════
These signals ALWAYS indicate the end of one reel and the start of another. Do NOT ignore them:

1. GUEST LABEL CHANGE: Any place where the speaker label changes from GUEST_X to GUEST_Y (different guest) is a hard boundary. No exceptions.

2. TRANSITION PHRASES: If you see any of the following (in any language), the current reel MUST end and a new one MUST begin right after:
   - "who's next" / "who's first" / "who wants"
   - "מי הבא" / "מי רוצה" / "מי הראשון"
   - "יאללה" followed by a name or "הבא"
   - "next" (standalone, as a call to the audience)
   - "anyone else" / "עוד מישהו"
   - Calling out a new name to invite them to speak

3. PRONOUN / GENDER SHIFTS: In Hebrew (and other gendered languages), a shift in grammatical gender (e.g. feminine "את" ↔ masculine "אתה", or verb form changes) directed at the audience member indicates a new GUEST. This is a strong boundary signal.

4. DURATION OUTLIER SELF-CHECK (MANDATORY — perform before outputting):
   a. Calculate the duration of every reel you are about to output.
   b. Calculate the median duration.
   c. If ANY reel is 3× or more longer than the median, you have ALMOST CERTAINLY missed one or more GUEST transitions inside it.
   d. Go back, re-examine that reel's transcript section carefully for any of the signals above, and split it.
   e. Only output after this check passes (no reel is 3× the median).

════ VALIDATION (run mentally before outputting) ════
For each reel in your output, confirm:
✓ It contains exactly ONE GUEST (only one GUEST_X label appears as a primary speaker)
✓ No transition phrase listed above appears in the middle of the reel
✓ The reel is not 3× longer than the median reel duration

If any check fails, fix the reel before outputting.

════ SEGMENT BOUNDARIES ════
• IN point: 2–5 seconds BEFORE the GUEST starts speaking. Capture the "about to speak" moment.
• OUT point: After MAIN_SPEAKER finishes their COMPLETE response on that topic. Not mid-sentence, not mid-thought.
• Do NOT cut the clip short to hit a duration target. A 20-minute exchange is a 20-minute reel.

════ FORMAT ════
Your ENTIRE response must be valid JSON. First character { last character }. No text, no markdown, no code fences.`;

app.post('/api/detect-interactions', async (req, res) => {
  const { sessionId: _sid, transcription, speakerTimestamps, wordTimestamps } = req.body;

  if (!transcription) {
    res.status(400).json({ error: 'transcription is required.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const wtArr: { word: string; start: number; end: number }[] = wordTimestamps || [];
    const stArr: { speaker: string; start: number; end: number }[] = speakerTimestamps || [];

    function getSpeakerAtTime(t: number): string {
      for (const turn of stArr) {
        if (t >= turn.start && t <= turn.end) return turn.speaker;
      }
      return 'unknown';
    }

    // Identify main speaker = whichever raw speaker ID has the most diarized segments
    const speakerSegCounts: Record<string, number> = {};
    for (const turn of stArr) {
      speakerSegCounts[turn.speaker] = (speakerSegCounts[turn.speaker] || 0) + 1;
    }
    const mainSpeakerId = Object.entries(speakerSegCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'SPEAKER_0';

    // Map raw speaker IDs → clean labels for the prompt
    const speakerLabelMap: Record<string, string> = { [mainSpeakerId]: 'MAIN_SPEAKER' };
    let guestCount = 1;
    for (const id of Object.keys(speakerSegCounts)) {
      if (id !== mainSpeakerId) {
        speakerLabelMap[id] = `GUEST_${guestCount++}`;
      }
    }

    const getLabel = (t: number) => speakerLabelMap[getSpeakerAtTime(t)] || 'UNKNOWN';

    // Build labeled transcript
    const labeled = transcription.map((line: { timestamp: string; text: string }) => {
      const label = getLabel(timestampToSeconds(line.timestamp));
      return `[${label}] [${line.timestamp}] ${line.text}`;
    });

    const speakerLegend = Object.entries(speakerLabelMap)
      .map(([id, label]) => `  ${label} (raw id: ${id})`)
      .join('\n');

    const transcriptText = labeled.join('\n');
    const wtFormatted = formatTranscriptForPrompt(transcription, wtArr);

    const prompt = `SPEAKER LEGEND:
  MAIN_SPEAKER = the host/presenter (most speaking segments, auto-detected)
  GUEST_1, GUEST_2, … = audience members / secondary speakers
${speakerLegend}

TRANSCRIPT WITH SPEAKER LABELS:
${transcriptText}

TRANSCRIPT WITH WORD-LEVEL TIMESTAMPS (use these for precise IN/OUT points):
${wtFormatted}

Create one reel per distinct GUEST interaction exchange. For each reel:
- IN: 2-5 seconds before the GUEST starts speaking
- OUT: after MAIN_SPEAKER's complete response ends

Respond with ONLY JSON:
${REELS_JSON_SCHEMA}`;

    res.write(`data: ${JSON.stringify({ phase: 'sending' })}\n\n`);

    const stream = await openrouter.chat.completions.create({
      model: CLAUDE_MODEL,
      messages: [
        { role: 'system', content: INTERACTION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      stream: true,
    });

    let fullText = '';
    let lastEventTime = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        const now = Date.now();
        if (now - lastEventTime > 200) {
          res.write(`data: ${JSON.stringify({ phase: 'streaming', chars: fullText.length })}\n\n`);
          lastEventTime = now;
        }
      }
    }

    res.write(`data: ${JSON.stringify({ phase: 'parsing' })}\n\n`);

    const parsed = parseClaudeReelsResponse(fullText);
    // Mark all reels as interaction exchanges
    for (const reel of parsed.reels) {
      reel.interactionType = 'exchange';
    }
    populateSegmentText(parsed.reels, transcription);

    res.write(`data: ${JSON.stringify({ phase: 'complete', reels: parsed.reels })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Error in /api/detect-interactions:', err);
    res.write(`data: ${JSON.stringify({ phase: 'error', message: err.message || 'Failed to detect interactions.' })}\n\n`);
    res.end();
  }
});

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

function runFfmpeg(
  args: string[],
  onProgress?: (timemark: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, args);
    let stderrTail = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      const lines = text.split(/[\r\n]+/);
      for (const line of lines) {
        const m = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (m && onProgress) onProgress(m[1]);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg error (code ${code}): ${stderrTail.slice(-500)}`));
    });

    proc.on('error', (err) => reject(err));
  });
}

function buildExportArgs(opts: {
  videoPath: string;
  segs: { inSec: number; duration: number }[];
  filterComplex: string;
  videoMapLabel: string;
  outputPath: string;
  streamCopy?: boolean;
}): string[] {
  const args: string[] = ['-y'];
  for (const seg of opts.segs) {
    args.push('-ss', String(seg.inSec), '-t', String(seg.duration), '-i', opts.videoPath);
  }
  if (opts.streamCopy) {
    args.push('-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', opts.outputPath);
  } else {
    args.push(
      '-filter_complex', opts.filterComplex,
      '-map', opts.videoMapLabel,
      '-map', '[concata]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      opts.outputPath,
    );
  }
  return args;
}

// ── POST /api/export-reel (SSE) ───────────────────────────────────────────────

function secondsToAssTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const centisec = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}.${String(centisec).padStart(2, '0')}`;
}

interface ClientCaptionStyle {
  preset: 'pop' | 'karaoke' | 'bounce' | 'outline';
  bgColor: string;
  highlightColor: string;
  fontSize: number;
  showBackground: boolean;
  captionPosition: number;
  wordsPerLine: number;
}

const DEFAULT_CAPTION_STYLE_SERVER: ClientCaptionStyle = {
  preset: 'pop',
  bgColor: 'rgba(0,0,0,0.6)',
  highlightColor: '#facc15',
  fontSize: 100,
  showBackground: true,
  captionPosition: 15,
  wordsPerLine: 3,
};

function cssColorToAss(css: string): string {
  const rgba = css.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgba) {
    const r = +rgba[1], g = +rgba[2], b = +rgba[3];
    const a = rgba[4] !== undefined ? +rgba[4] : 1;
    const aa = Math.round((1 - a) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `&H${aa}${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  const hex = css.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `&H00${b.toString(16).padStart(2,'0').toUpperCase()}${g.toString(16).padStart(2,'0').toUpperCase()}${r.toString(16).padStart(2,'0').toUpperCase()}`;
  }
  return '&H00000000';
}

type Word = { word: string; start: number; end: number };

function isRTLText(text: string): boolean {
  let rtl = 0, ltr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (
      (c >= 0x0590 && c <= 0x05FF) || // Hebrew
      (c >= 0x0600 && c <= 0x06FF) || // Arabic
      (c >= 0x0700 && c <= 0x077F) || // Syriac + Arabic Supplement
      (c >= 0xFB50 && c <= 0xFEFF)    // Arabic/Hebrew Presentation Forms
    ) rtl++;
    else if (
      (c >= 0x0041 && c <= 0x005A) ||
      (c >= 0x0061 && c <= 0x007A) ||
      (c >= 0x00C0 && c <= 0x024F)
    ) ltr++;
  }
  return (rtl + ltr < 3) ? rtl > 0 : rtl > ltr;
}

function groupWordsForPop(words: Word[], wordsPerGroup: number): Word[][] {
  const groups: Word[][] = [];
  let current: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const endsWithPunctuation = /[.!?]$/.test(words[i].word);
    const hasLongPause = i < words.length - 1 && words[i + 1].start - words[i].end > 0.5;
    if (endsWithPunctuation || hasLongPause || current.length >= wordsPerGroup || i === words.length - 1) {
      groups.push([...current]);
      current = [];
    }
  }
  return groups;
}

function groupWordsForKaraoke(words: Word[]): Word[][] {
  const groups: Word[][] = [];
  let current: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const endsWithPunctuation = /[.!?]$/.test(words[i].word);
    const hasLongPause = i < words.length - 1 && words[i + 1].start - words[i].end > 0.8;
    if (endsWithPunctuation || hasLongPause || i === words.length - 1) {
      groups.push([...current]);
      current = [];
    }
  }
  return groups;
}

function buildStyledAssContent(words: Word[], style: ClientCaptionStyle, outWidth: number, outHeight: number): string {
  // Font size: 4.8% of output height matches the web preview's proportional size
  // (CSS uses clamp(1.1rem, 4vw, 1.6rem) ≈ 25px in a ~520px-tall player → 4.8%)
  const assSize = Math.round(outHeight * 0.048 * style.fontSize / 100);
  const primaryColor = '&H00FFFFFF'; // white — default text color
  const highlightAss = cssColorToAss(style.highlightColor); // used for active-word inline override
  const outlineColor = '&H00000000'; // black outline
  const backColor = cssColorToAss(style.bgColor);
  const isOutline = style.preset === 'outline' || !style.showBackground;
  // BorderStyle=3: opaque/semi-transparent box (BackColour used as background, Outline=padding)
  // BorderStyle=1: outline only (no box)
  const borderStyle = isOutline ? 1 : 3;
  const outlineSize = isOutline ? 4 : 10; // padding inside the box for BorderStyle=3
  const shadow = isOutline ? 2 : 0;
  const marginV = Math.round(style.captionPosition / 100 * outHeight);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${outWidth}
PlayResY: ${outHeight}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${assSize},${primaryColor},${highlightAss},${outlineColor},${backColor},1,0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadow},2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // cleanWord strips ASS control chars that would break the file
  const cleanWord = (w: string) => w.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

  // RTL mark: prepend U+202B (RIGHT-TO-LEFT EMBEDDING) for Hebrew/Arabic text
  const allText = words.map(w => w.word).join(' ');
  const rtl = isRTLText(allText);
  const rtlMark = rtl ? '\u202B' : '';

  const fade = '{\\fad(80,80)}';
  const dialogues: string[] = [];

  if (style.preset === 'bounce') {
    for (const w of words) {
      dialogues.push(`Dialogue: 0,${secondsToAssTime(w.start)},${secondsToAssTime(w.end)},Default,,0,0,0,,${fade}${rtlMark}${cleanWord(w.word)}`);
    }
  } else if (style.preset === 'karaoke') {
    // Karaoke: one dialogue per word, showing the full sentence but only
    // the active word in highlightColor — matches the web preview exactly.
    // Using inline {\c&H...&}word{\r} overrides instead of \k tags.
    for (const group of groupWordsForKaraoke(words)) {
      const cleaned = group.map(w => cleanWord(w.word));
      for (let i = 0; i < group.length; i++) {
        const w = group[i];
        const endTime = i < group.length - 1 ? group[i + 1].start : w.end;
        const parts = cleaned.map((wt, j) =>
          j === i ? `{\\c${highlightAss}&}${wt}{\\r}` : wt
        );
        const lineText = rtlMark + parts.join(' ');
        dialogues.push(`Dialogue: 0,${secondsToAssTime(w.start)},${secondsToAssTime(endTime)},Default,,0,0,0,,${lineText}`);
      }
    }
  } else {
    // pop and outline: word groups with fade
    for (const group of groupWordsForPop(words, style.wordsPerLine)) {
      const text = `${fade}${rtlMark}${group.map(w => cleanWord(w.word)).join(' ')}`;
      dialogues.push(`Dialogue: 0,${secondsToAssTime(group[0].start)},${secondsToAssTime(group[group.length - 1].end)},Default,,0,0,0,,${text}`);
    }
  }

  return header + dialogues.join('\n') + '\n';
}

interface ExportJob {
  args: string[];
  assFilePath: string | null;
  totalOutputDuration: number;
}

async function prepareExportJob(
  body: {
    sessionId: string;
    segments: { inTimestamp: string; outTimestamp: string }[];
    subtitleOverrides?: { word: string; start: number; end: number }[];
    wordTimestamps?: { word: string; start: number; end: number }[];
    orientation: string;
    burnSubtitles: boolean;
    captionStyle?: ClientCaptionStyle;
  },
  outputPath: string,
  sessionExportsDir: string,
  cacheKey: string,
): Promise<ExportJob> {
  const { sessionId, segments, subtitleOverrides, wordTimestamps, orientation, burnSubtitles, captionStyle } = body;
  const videoPath = path.join(sessionsDir, sessionId, 'video.mp4');

  const srcMeta = await probeVideo(videoPath);
  const srcOrientation = srcMeta.orientation;
  const targetOrientation = orientation;

  function tsToSec(ts: string): number {
    return timestampToSeconds(ts.replace(/[\[\]]/g, ''));
  }

  const segs = segments;
  const segCount = segs.length;

  let totalOutputDuration = 0;
  const segDefs: { inSec: number; duration: number }[] = [];
  for (const seg of segs) {
    const inSec = tsToSec(seg.inTimestamp);
    const outSec = tsToSec(seg.outTimestamp);
    const dur = Math.max(0, outSec - inSec);
    totalOutputDuration += dur;
    segDefs.push({ inSec, duration: dur });
  }

  // Concat filter
  const concatInputs = Array.from({ length: segCount }, (_, i) => `[${i}:v][${i}:a]`).join('');
  const filterParts: string[] = [
    `${concatInputs}concat=n=${segCount}:v=1:a=1[concatv][concata]`,
  ];

  const videoFilterChain: string[] = [];

  // Compute output frame dimensions (after any crop)
  let outWidth = srcMeta.width;
  let outHeight = srcMeta.height;
  if (srcOrientation === 'horizontal' && targetOrientation === 'vertical') {
    outWidth = Math.round(srcMeta.height * 9 / 16);
    outHeight = srcMeta.height;
    videoFilterChain.push('crop=ih*9/16:ih:(iw-ih*9/16)/2:0');
  } else if (srcOrientation === 'vertical' && targetOrientation === 'horizontal') {
    outWidth = srcMeta.width;
    outHeight = Math.round(srcMeta.width * 9 / 16);
    videoFilterChain.push('crop=iw:iw*9/16:0:(ih-iw*9/16)/2');
  }

  let assFilePath: string | null = null;

  if (burnSubtitles) {
    const wt = subtitleOverrides || wordTimestamps || [];
    if (wt.length > 0) {
      const adjusted: { word: string; start: number; end: number }[] = [];
      let outputOffset = 0;

      for (const seg of segs) {
        const inSec = tsToSec(seg.inTimestamp);
        const outSec = tsToSec(seg.outTimestamp);
        const segWords = wt.filter((w) => w.start >= inSec - 0.1 && w.start < outSec + 0.1);
        for (const w of segWords) {
          adjusted.push({
            ...w,
            start: Math.max(0, w.start - inSec + outputOffset),
            end: Math.max(0, w.end - inSec + outputOffset),
          });
        }
        outputOffset += Math.max(0, outSec - inSec);
      }

      const style = captionStyle || DEFAULT_CAPTION_STYLE_SERVER;
      const assContent = buildStyledAssContent(adjusted, style, outWidth, outHeight);
      assFilePath = path.join(sessionExportsDir, `${cacheKey}.ass`);
      fs.writeFileSync(assFilePath, assContent, 'utf-8');

      const escapedAss = assFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
      videoFilterChain.push(`ass=${escapedAss}`);
    }
  }

  let videoMapLabel: string;
  if (videoFilterChain.length > 0) {
    filterParts.push(`[concatv]${videoFilterChain.join(',')}[outv]`);
    videoMapLabel = '[outv]';
  } else {
    videoMapLabel = '[concatv]';
  }

  const filterComplex = filterParts.join(';');
  // Stream copy when there's only one segment and no video filters (no crop, no subtitle burn)
  const streamCopy = segCount === 1 && videoFilterChain.length === 0;
  const args = buildExportArgs({ videoPath, segs: segDefs, filterComplex, videoMapLabel, outputPath, streamCopy });

  return { args, assFilePath, totalOutputDuration };
}

app.post('/api/export-reel', async (req, res) => {
  const { sessionId, segments, subtitleOverrides, wordTimestamps, orientation, burnSubtitles, captionStyle } = req.body;

  if (!sessionId || !segments) {
    res.status(400).json({ error: 'sessionId and segments are required.' });
    return;
  }

  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }

  const videoPath = path.join(sessionsDir, sessionId, 'video.mp4');
  if (!fs.existsSync(videoPath)) {
    res.status(404).json({ error: 'Session video not found.' });
    return;
  }

  const cacheKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ segments, orientation, burnSubtitles, subtitleOverrides, wordTimestamps, captionStyle }))
    .digest('hex')
    .slice(0, 16);

  const sessionExportsDir = path.join(sessionsDir, sessionId, 'exports');
  if (!fs.existsSync(sessionExportsDir)) fs.mkdirSync(sessionExportsDir);

  const cachedPath = path.join(sessionExportsDir, `${cacheKey}.mp4`);
  const downloadPath = `/api/sessions/${sessionId}/export/${cacheKey}.mp4`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  function sendSSE(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') (res as any).flush();
  }

  if (fs.existsSync(cachedPath)) {
    console.log(`Export cache hit: ${cacheKey} for session ${sessionId}`);
    sendSSE({ phase: 'complete', downloadPath });
    res.end();
    return;
  }

  let assFilePath: string | null = null;

  try {
    const job = await prepareExportJob(
      { sessionId, segments, subtitleOverrides, wordTimestamps, orientation, burnSubtitles, captionStyle },
      cachedPath,
      sessionExportsDir,
      cacheKey,
    );
    assFilePath = job.assFilePath;

    sendSSE({ phase: 'encoding', percent: 0 });

    await runFfmpeg(job.args, (timemark) => {
      if (job.totalOutputDuration > 0) {
        const parts = timemark.split(':').map(Number);
        const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        const pct = Math.min(99, Math.round((sec / job.totalOutputDuration) * 100));
        sendSSE({ phase: 'encoding', percent: pct });
      }
    });

    sendSSE({ phase: 'complete', downloadPath });
    res.end();
  } catch (err: any) {
    console.error('Error in /api/export-reel:', err);
    sendSSE({ phase: 'error', message: err.message || 'Export failed.' });
    res.end();
    if (fs.existsSync(cachedPath)) fs.unlink(cachedPath, () => {});
  } finally {
    if (assFilePath && fs.existsSync(assFilePath)) fs.unlink(assFilePath, () => {});
  }
});

// ── POST /api/sessions/:sessionId/prerender ───────────────────────────────────

app.post('/api/sessions/:sessionId/prerender', async (req, res) => {
  const { sessionId } = req.params;
  const { segments, subtitleOverrides, wordTimestamps, orientation, burnSubtitles, captionStyle } = req.body;

  if (!segments) {
    res.status(400).json({ error: 'segments is required.' });
    return;
  }

  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }

  const videoPath = path.join(sessionsDir, sessionId, 'video.mp4');
  if (!fs.existsSync(videoPath)) {
    res.status(404).json({ error: 'Session video not found.' });
    return;
  }

  const cacheKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ segments, orientation, burnSubtitles, subtitleOverrides, wordTimestamps, captionStyle }))
    .digest('hex')
    .slice(0, 16);

  const sessionExportsDir = path.join(sessionsDir, sessionId, 'exports');
  if (!fs.existsSync(sessionExportsDir)) fs.mkdirSync(sessionExportsDir);

  const cachedPath = path.join(sessionExportsDir, `${cacheKey}.mp4`);

  if (fs.existsSync(cachedPath)) {
    res.status(200).json({ status: 'ready' });
    return;
  }

  res.status(202).json({ status: 'queued' });

  (async () => {
    let assFilePath: string | null = null;
    try {
      const job = await prepareExportJob(
        { sessionId, segments, subtitleOverrides, wordTimestamps, orientation, burnSubtitles: burnSubtitles ?? false, captionStyle },
        cachedPath,
        sessionExportsDir,
        cacheKey,
      );
      assFilePath = job.assFilePath;
      await runFfmpeg(job.args);
      console.log(`Pre-render complete: ${cacheKey} for session ${sessionId}`);
    } catch (err) {
      console.warn(`Pre-render failed: ${cacheKey}`, err);
      if (fs.existsSync(cachedPath)) fs.unlink(cachedPath, () => {});
    } finally {
      if (assFilePath && fs.existsSync(assFilePath)) fs.unlink(assFilePath, () => {});
    }
  })();
});

// ── GET /api/export-download/:filename ──────────────────────────────────────

app.get('/api/export-download/:filename', (req, res) => {
  const { filename } = req.params;
  // Basic sanitization: only allow uuid.mp4 pattern
  if (!/^[0-9a-f-]+\.mp4$/i.test(filename)) {
    res.status(400).json({ error: 'Invalid filename.' });
    return;
  }
  const filePath = path.join(exportsDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found or already downloaded.' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('end', () => {
    // Delete after serving
    fs.unlink(filePath, () => {});
  });
  stream.on('error', () => {
    res.status(500).end();
  });
});

// ── GET /api/sessions/:sessionId/export/:filename — serve cached export ──────
// Does NOT delete after serving; the file persists until the session is deleted.

app.get('/api/sessions/:sessionId/export/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId) || !/^[0-9a-f]+\.mp4$/i.test(filename)) {
    res.status(400).json({ error: 'Invalid path.' });
    return;
  }
  const filePath = path.join(sessionsDir, sessionId, 'exports', filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Export not found.' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', () => res.status(500).end());
});

// ── DELETE /api/sessions/:sessionId — permanently delete a session ────────────

app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }
  const sessionPath = path.join(sessionsDir, sessionId);
  if (!fs.existsSync(sessionPath)) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions — list all active sessions ─────────────────────────────

app.get('/api/sessions', (_req, res) => {
  try {
    const entries = fs.readdirSync(sessionsDir);
    const sessions: any[] = [];

    for (const entry of entries) {
      const sessionJsonPath = path.join(sessionsDir, entry, 'session.json');
      const videoPath = path.join(sessionsDir, entry, 'video.mp4');
      if (!fs.existsSync(sessionJsonPath)) continue;

      try {
        const data = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));

        // Skip sessions that haven't finished processing yet
        if (data.status === 'pending' || data.status === 'processing') continue;

        const isAudioOnly = data.uploadMode === 'audio';
        let videoExists: boolean;
        if (isAudioOnly) {
          videoExists = data.audioFilename
            ? fs.existsSync(path.join(sessionsDir, entry, data.audioFilename))
            : true;
        } else {
          videoExists = fs.existsSync(videoPath);
        }

        sessions.push({
          sessionId: data.sessionId,
          createdAt: data.createdAt,
          originalFilename: data.originalFilename,
          uploadMode: data.uploadMode,
          videoMetadata: data.videoMetadata,
          summary: data.summary,
          reelCount: data.reels?.length ?? 0,
          videoExists,
        });
      } catch {
        // skip malformed session.json
      }
    }

    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:sessionId — update session data (e.g. save reels) ──

app.patch('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }
  const sessionJsonPath = path.join(sessionsDir, sessionId, 'session.json');
  if (!fs.existsSync(sessionJsonPath)) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  try {
    const existing = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
    const updated = { ...existing, ...req.body };
    fs.writeFileSync(sessionJsonPath, JSON.stringify(updated));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:sessionId/data — load full session ───────────────────

app.get('/api/sessions/:sessionId/data', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }

  const sessionDir = path.join(sessionsDir, sessionId);
  const sessionJsonPath = path.join(sessionDir, 'session.json');
  const videoPath = path.join(sessionDir, 'video.mp4');

  if (!fs.existsSync(sessionJsonPath)) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));

    // For video sessions, check the video file still exists
    if (data.uploadMode !== 'audio' && !fs.existsSync(videoPath)) {
      res.json({ expired: true });
      return;
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:sessionId/video — stream session video ───────────────

app.get('/api/sessions/:sessionId/video', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]+$/i.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId.' });
    return;
  }

  const videoPath = path.join(sessionsDir, sessionId, 'video.mp4');
  if (!fs.existsSync(videoPath)) {
    res.status(404).json({ error: 'Video not found or expired.' });
    return;
  }

  const stat = fs.statSync(videoPath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
