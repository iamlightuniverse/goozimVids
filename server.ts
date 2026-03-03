import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'missing',
});

const CLAUDE_MODEL = 'anthropic/claude-sonnet-4-6';

// ── File upload setup ────────────────────────────────────────────────────────

const uploadsDir = path.resolve('uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const upload = multer({ dest: uploadsDir });

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

function secondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

// ── STT Provider Abstraction ─────────────────────────────────────────────────

interface TranscriptionResult {
  transcription: { timestamp: string; text: string }[];
  wordTimestamps: { word: string; start: number; end: number }[];
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
  language?: string
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

  const { result } = await getDeepgram().listen.prerecorded.transcribeFile(audioBuffer, dgOptions);

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

  return { transcription, wordTimestamps };
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

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      ...form.getHeaders(),
    },
    body: form as any,
  });

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

  const uploadRes = await fetch('https://api.soniox.com/v1/files', {
    method: 'POST',
    headers,
    body: uploadForm,
  });

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

  const transcribeRes = await fetch('https://api.soniox.com/v1/transcriptions', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(transcribeBody),
  });

  if (!transcribeRes.ok) {
    const errorText = await transcribeRes.text();
    throw new Error(`Soniox transcription error (${transcribeRes.status}): ${errorText}`);
  }

  const transcribeData = await transcribeRes.json() as any;
  const transcriptionId: string = transcribeData.id;

  // Step 3: Poll until completed
  console.log('Waiting for Soniox transcription to complete...');
  let status = transcribeData.status;
  while (status === 'queued' || status === 'processing') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`https://api.soniox.com/v1/transcriptions/${transcriptionId}`, {
      headers,
    });
    if (!pollRes.ok) {
      const errorText = await pollRes.text();
      throw new Error(`Soniox poll error (${pollRes.status}): ${errorText}`);
    }
    const pollData = await pollRes.json() as any;
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
      "hookReason": "string — why this clip grabs attention in the first 3 seconds",
      "description": "string — 1-2 sentence description of the content and why it works as a reel",
      "isMultiSegment": false,
      "multiSegmentReason": "string — required if isMultiSegment: why these clips belong together",
      "segments": [
        {
          "inTimestamp": "[HH:MM:SS]",
          "outTimestamp": "[HH:MM:SS]",
          "wordsIn": "first full sentence spoken in the clip",
          "wordsOut": "last full sentence spoken in the clip",
          "transcriptExcerpt": "the full spoken text between IN and OUT"
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
    temperature: 0.3,
  });
  return response.choices[0]?.message?.content || '';
}

async function callClaudeForReels(prompt: string): Promise<any> {
  const systemPrompt = `You are an expert short-form video editor specializing in solo-speaker content (monologues, vlogs, podcasts). Your job is to find the most compelling, self-contained moments from a transcript and turn them into reel recommendations.

WHAT MAKES A GREAT REEL:
- Strong hook: The first sentence must grab attention — a bold claim, surprising fact, emotional statement, provocative question, or a story opener.
- Complete thought: The clip must contain a full idea from start to finish. Never cut into the middle of a thought or leave an idea unresolved.
- Natural boundaries: Start at the very beginning of a sentence/idea. End at the natural conclusion — after the punchline, the insight, or the takeaway.
- Self-contained: A viewer with zero context should understand and enjoy the clip on its own.

MULTI-SEGMENT RULES:
- Default to single continuous clips. Only use multi-segment when:
  (a) Cutting out a brief tangent/filler from within the same topic to tighten the message
  (b) Combining two nearby moments that reference the same example or build on the same point
- By default, multi-segment clips should be from the same general topic area. Only combine distant or unrelated moments when the user explicitly requests complex edits.

CRITICAL: For each segment, you MUST include transcriptExcerpt containing the full spoken text between IN and OUT. This is how you verify your selection actually works as a standalone clip. Read it back — does it start strong? Does it end complete? If not, adjust your timestamps.

Respond with valid JSON only, no markdown, no code fences.`;

  const raw = await callClaude(systemPrompt, prompt);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

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

  let audioPath: string | null = null;

  try {
    let transcription: { timestamp: string; text: string }[];
    let summary: string;
    let wordTimestamps: { word: string; start: number; end: number }[] | undefined;

    if (transcriptFile) {
      // ── User provided a transcript — parse it and generate summary only ──
      const raw = fs.readFileSync(transcriptFile.path, 'utf-8');

      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          transcription = parsed;
        } else if (parsed.transcription && Array.isArray(parsed.transcription)) {
          transcription = parsed.transcription;
        } else {
          throw new Error('not array');
        }
      } catch {
        transcription = parseTranscriptText(raw);
      }

      // Generate summary from transcript text using Gemini (text-only, cheap)
      const transcriptText = transcription
        .map((t) => `[${t.timestamp}] ${t.text}`)
        .join('\n');

      const summaryResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Here is a video transcript:\n\n${transcriptText}\n\nProvide a concise 2-4 sentence summary of what this video covers, its main topics, and who might find it useful.`,
              },
            ],
          },
        ],
        config: { temperature: 0.3 },
      });

      summary = summaryResponse.text || 'Summary could not be generated.';
    } else {
      // ── No transcript provided — extract audio and transcribe with STT provider ──
      console.log('Extracting audio from video...');
      audioPath = await extractAudio(videoFile!.path);

      const audioBuffer = fs.readFileSync(audioPath);
      const language = req.body?.language;
      const provider = process.env.STT_PROVIDER || 'deepgram';

      console.log(`Using STT provider: ${provider}`);

      let result: TranscriptionResult;

      switch (provider) {
        case 'elevenlabs':
          result = await transcribeWithElevenLabs(audioPath, language);
          break;
        case 'soniox':
          result = await transcribeWithSoniox(audioPath, language);
          break;
        default:
          result = await transcribeWithDeepgram(audioBuffer, language);
      }

      transcription = result.transcription;
      wordTimestamps = result.wordTimestamps;

      // Generate summary using Gemini (text-only, cheap)
      const transcriptText = transcription
        .map((t) => `[${t.timestamp}] ${t.text}`)
        .join('\n');

      const summaryResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Here is a video transcript:\n\n${transcriptText}\n\nProvide a concise 2-4 sentence summary of what this video covers, its main topics, and who might find it useful.`,
              },
            ],
          },
        ],
        config: { temperature: 0.3 },
      });

      summary = summaryResponse.text || 'Summary could not be generated.';
    }

    res.json({ transcription, summary, wordTimestamps });
  } catch (err: any) {
    console.error('Error in /api/transcribe:', err);
    res.status(500).json({ error: err.message || 'Failed to transcribe video.' });
  } finally {
    if (videoFile) fs.unlink(videoFile.path, () => {});
    if (transcriptFile) fs.unlink(transcriptFile.path, () => {});
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

// ── POST /api/generate-reels ─────────────────────────────────────────────────

app.post('/api/generate-reels', async (req, res) => {
  const { transcription, mode, guided, customPrompt } = req.body;

  if (!transcription) {
    res.status(400).json({ error: 'Transcription is required.' });
    return;
  }

  try {
    const transcriptText = transcription
      .map((t: { timestamp: string; text: string }) => `[${t.timestamp}] ${t.text}`)
      .join('\n');

    let prompt: string;

    if (mode === 'custom' && customPrompt) {
      prompt = `Here is a timestamped transcript of a solo speaker video:

${transcriptText}

The user wants reels created with these specific instructions:
"${customPrompt}"

Follow these steps:
1. Analyze the full transcript for moments matching the user's criteria.
2. Select clips with strong hooks, complete thoughts, and natural boundaries.
3. For each reel, write out the full transcriptExcerpt and verify the clip is self-contained.

Use this JSON schema:
${REELS_JSON_SCHEMA}`;
    } else {
      const numReels = guided?.numberOfReels || 0;
      const duration = guided?.duration || 'auto';
      const complexEdits = guided?.complexEdits || false;

      const reelCountInstruction =
        numReels > 0
          ? `exactly ${numReels} best reels`
          : `5-10 reels`;

      const durationInstruction =
        duration !== 'auto'
          ? `Each reel should target approximately ${duration} seconds in duration (this is an approximate target, not a hard limit).`
          : `Each reel should be between 20-60 seconds, choosing the best duration for the content.`;

      const complexEditsInstruction = complexEdits
        ? `\n\nCOMPLEX EDITS MODE: You are encouraged to create multi-segment reels that combine clips from different parts of the video. Look for creative combinations — a setup in one section with a payoff in another, contrasting viewpoints, or a thematic compilation. Multi-segment reels do NOT need to be from the same topic area. Be creative with the editing. Aim for at least half of the reels to be multi-segment.`
        : '';

      prompt = `Here is a timestamped transcript of a solo speaker video:

${transcriptText}

STEP 1 — ANALYSIS: Scan the entire transcript. Identify the distinct topics, stories, insights, and emotional moments. Note where each topic naturally starts and ends.

STEP 2 — SELECTION: From your analysis, select the ${reelCountInstruction}. ${durationInstruction}${complexEditsInstruction} Pick moments with the strongest hooks and most complete thoughts. Prefer clips where the speaker:
- Makes a bold or surprising claim
- Tells a concise story with a clear payoff
- Shares specific actionable advice
- Has an emotional or passionate moment
- Delivers a memorable one-liner or insight

STEP 3 — VERIFICATION: For each reel, write out the full transcriptExcerpt between your chosen IN and OUT points. Read it back. Verify:
- Does it start with a strong opening sentence?
- Does it end with a complete thought (not mid-sentence or mid-idea)?
- Would a viewer with no context understand it?
- If not, adjust your IN/OUT timestamps until it works.

Use this JSON schema:
${REELS_JSON_SCHEMA}`;
    }

    const parsed = await callClaudeForReels(prompt);
    res.json({ reels: parsed.reels });
  } catch (err: any) {
    console.error('Error in /api/generate-reels:', err);
    res.status(500).json({ error: err.message || 'Failed to generate reels.' });
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

Find a better version of this reel. Write out the full transcriptExcerpt and verify the clip starts with a strong hook and ends with a complete thought. Return exactly 1 reel.

Use this JSON schema:
${REELS_JSON_SCHEMA}`;

    const parsed = await callClaudeForReels(prompt);
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
}

function buildChatSystemPrompt(context: ChatContext): string {
  const transcriptText = (context.transcription || [])
    .map((t) => `[${t.timestamp}] ${t.text}`)
    .join('\n');

  const reelsList = context.reels
    .map((r, i) => `${i + 1}. "${r.title}" (${r.inTimestamp} - ${r.outTimestamp}): ${r.description}`)
    .join('\n');

  return `You are Reely, a sharp and friendly brainstorming assistant for short-form video creators.
You know the user's video inside and out — the full transcript is below.
Help them find hidden gems, craft scroll-stopping hooks, and turn raw footage into viral reels.
Keep it punchy, specific, and grounded in what was actually said.

FULL TRANSCRIPT:
${transcriptText || '(No transcript available)'}

VIDEO SUMMARY:
${context.summary}

CURRENT REELS (already created — don't duplicate these):
${reelsList || '(No reels generated yet)'}

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
