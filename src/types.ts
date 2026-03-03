export interface TranscriptionLine {
  timestamp: string;
  text: string;
}

export interface WordTimestamp {
  word: string;    // punctuated form ("Hello,")
  start: number;   // seconds (float)
  end: number;     // seconds (float)
}

export interface ReelSegment {
  inTimestamp: string;
  outTimestamp: string;
  wordsIn: string;
  wordsOut: string;
  transcriptExcerpt?: string;
}

export interface Reel {
  title: string;
  hookReason?: string;
  description: string;
  isMultiSegment: boolean;
  multiSegmentExplanation?: string;
  multiSegmentReason?: string;
  segments: ReelSegment[];
}

export interface VideoAnalysis {
  transcription: TranscriptionLine[];
  reels: Reel[];
}

export type Step = 'upload' | 'summary' | 'configure' | 'results';

export type CaptionPresetId = 'pop' | 'karaoke' | 'bounce' | 'outline';

export interface CaptionStyle {
  preset: CaptionPresetId;
  bgColor: string;
  highlightColor: string;
  fontSize: number;
  showBackground: boolean;
  captionPosition: number;   // % from bottom (5–85)
  wordsPerLine: number;       // words per caption group (2–6)
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  preset: 'pop',
  bgColor: 'rgba(0,0,0,0.6)',
  highlightColor: '#facc15',
  fontSize: 100,
  showBackground: true,
  captionPosition: 15,
  wordsPerLine: 3,
};

export const CAPTION_PRESETS: Record<CaptionPresetId, { label: string; description: string }> = {
  pop: { label: 'Pop', description: 'Word groups pop in' },
  karaoke: { label: 'Karaoke', description: 'Highlight current word' },
  bounce: { label: 'Bounce', description: 'One word at a time' },
  outline: { label: 'Outline', description: 'No background, outlined text' },
};

export interface TranscribeResponse {
  transcription: TranscriptionLine[];
  summary: string;
  wordTimestamps?: WordTimestamp[];
}

export interface GuidedConfig {
  numberOfReels: number; // 0 = auto
  duration: number | 'auto'; // seconds or 'auto'
  complexEdits?: boolean;
}

export interface GenerateReelsRequest {
  transcription: TranscriptionLine[];
  mode: 'guided' | 'custom';
  guided?: GuidedConfig;
  customPrompt?: string;
}

export interface InterpretPromptResponse {
  interpretation: string;
}

export interface GenerateReelsResponse {
  reels: Reel[];
}

export interface RegenerateReelRequest {
  transcription: TranscriptionLine[];
  originalReel: Reel;
  feedback: string;
  config?: {
    duration?: number | 'auto';
    customPrompt?: string;
  };
}

export interface RegenerateReelResponse {
  reel: Reel;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatContext {
  summary: string;
  transcription: { timestamp: string; text: string }[];
  reels: { title: string; description: string; inTimestamp: string; outTimestamp: string }[];
}

export interface ChatAction {
  type: 'generate' | 'modify' | 'delete';
  payload: {
    suggestion?: string;    // for generate
    reelIndex?: number;     // for modify/delete (0-based)
    feedback?: string;      // for modify
    reelTitle?: string;     // for display
  };
}
