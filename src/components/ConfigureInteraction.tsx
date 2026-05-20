import React, { useState } from 'react';
import { MessageSquare, Users, AlertCircle, Loader2 } from 'lucide-react';
import { TranscriptionLine, WordTimestamp, SpeakerTimestamp, Reel, GenerationProgress } from '../types';
import { GeneratingProgress } from './GeneratingProgress';

interface Props {
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  speakerTimestamps?: SpeakerTimestamp[];
  sessionId?: string | null;
  onComplete: (reels: Reel[]) => void;
}

export function ConfigureInteraction({
  transcription,
  wordTimestamps,
  speakerTimestamps,
  sessionId,
  onComplete,
}: Props) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>({
    phase: 'sending',
    charsReceived: 0,
    reelCount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Unique speakers detected from diarization
  const speakers = speakerTimestamps
    ? Array.from(new Set(speakerTimestamps.map((s) => s.speaker))).sort()
    : [];

  const handleDetect = async () => {
    setIsDetecting(true);
    setError(null);
    setProgress({ phase: 'sending', charsReceived: 0, reelCount: 0 });

    try {
      const response = await fetch('/api/detect-interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          transcription,
          speakerTimestamps,
          wordTimestamps,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Server error: ${response.status}`;
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.error || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastChars = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.phase === 'sending') {
            setProgress({ phase: 'sending', charsReceived: 0, reelCount: 0 });
          } else if (data.phase === 'streaming') {
            lastChars = data.chars;
            setProgress({ phase: 'streaming', charsReceived: data.chars, reelCount: 0 });
          } else if (data.phase === 'parsing') {
            setProgress({ phase: 'parsing', charsReceived: lastChars, reelCount: 0 });
          } else if (data.phase === 'complete') {
            const reelCount = data.reels?.length || 0;
            setProgress({ phase: 'complete', charsReceived: lastChars, reelCount });
            await new Promise((r) => setTimeout(r, 800));
            onComplete(data.reels);
            return;
          } else if (data.phase === 'error') {
            throw new Error(data.message);
          }
        }
      }

      throw new Error('Connection lost before interactions were detected.');
    } catch (err: any) {
      console.error('Error detecting interactions:', err);
      setError(err.message || 'Failed to detect interactions.');
      setIsDetecting(false);
    }
  };

  if (isDetecting) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <GeneratingProgress progress={progress} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Interaction Mode</h2>
          <p className="text-sm text-gray-500 mt-1">
            Automatically splits the video into individual Q&A exchanges. Each reel will contain one
            complete audience question and the presenter's full response.
          </p>
        </div>
      </div>

      {speakers.length > 0 && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} detected
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {speakers.map((speaker) => (
              <span
                key={speaker}
                className="px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600 font-medium"
              >
                {speaker.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            ))}
          </div>
        </div>
      )}

      {speakers.length === 0 && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
          <p className="text-sm text-amber-700">
            No diarization data available. Interaction detection will use transcript patterns to
            identify speaker exchanges. For best results, upload in Interaction Mode from the Upload
            step (enables speaker diarization).
          </p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm leading-relaxed">{error}</p>
        </div>
      )}

      <button
        onClick={handleDetect}
        className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
      >
        <MessageSquare className="w-5 h-5" />
        Detect Interactions
      </button>
    </div>
  );
}
