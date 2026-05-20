import React, { useState } from 'react';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { TranscriptionLine, GuidedConfig, Reel, GenerationProgress, CreativeBrief, WordTimestamp, SpeakerTimestamp } from '../types';
import { ConfigureGuided } from './ConfigureGuided';
import { ConfigureCustomPrompt } from './ConfigureCustomPrompt';
import { GeneratingProgress } from './GeneratingProgress';
import { ConfigureInteraction } from './ConfigureInteraction';

type Tab = 'guided' | 'custom';

interface Props {
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  uploadMode?: 'highlight' | 'interaction';
  speakerTimestamps?: SpeakerTimestamp[];
  sessionId?: string | null;
  onBack: () => void;
  onComplete: (reels: Reel[]) => void;
}

const platformOptions: { value: CreativeBrief['platform']; label: string }[] = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube Shorts' },
  { value: 'linkedin', label: 'LinkedIn' },
];

const purposeOptions: { value: CreativeBrief['purpose']; label: string }[] = [
  { value: 'grow', label: 'Grow Followers' },
  { value: 'educate', label: 'Educate' },
  { value: 'entertain', label: 'Entertain' },
  { value: 'traffic', label: 'Drive Traffic' },
  { value: 'authority', label: 'Build Authority' },
];

const toneOptions: { value: CreativeBrief['tone']; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'funny', label: 'Funny' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'provocative', label: 'Provocative' },
  { value: 'storytelling', label: 'Storytelling' },
];

export function ConfigureStep({ transcription, wordTimestamps, uploadMode, speakerTimestamps, sessionId, onBack, onComplete }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('guided');
  const [guidedConfig, setGuidedConfig] = useState<GuidedConfig>({
    numberOfReels: 0,
    duration: 'auto',
    complexEdits: false,
  });
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>({});
  const [confirmedCustomPrompt, setConfirmedCustomPrompt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>({
    phase: 'sending',
    charsReceived: 0,
    reelCount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const canGenerate =
    activeTab === 'guided' || (activeTab === 'custom' && confirmedCustomPrompt !== null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress({ phase: 'sending', charsReceived: 0, reelCount: 0 });

    try {
      const hasBrief = creativeBrief.platform || creativeBrief.purpose || creativeBrief.tone || creativeBrief.contentFocus;
      const body =
        activeTab === 'guided'
          ? { transcription, mode: 'guided', guided: guidedConfig, ...(hasBrief && { creativeBrief }), ...(wordTimestamps && { wordTimestamps }) }
          : { transcription, mode: 'custom', customPrompt: confirmedCustomPrompt, ...(hasBrief && { creativeBrief }), ...(wordTimestamps && { wordTimestamps }) };

      const response = await fetch('/api/generate-reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

      throw new Error('Connection lost before reels were generated.');
    } catch (err: any) {
      console.error('Error generating reels:', err);
      setError(err.message || 'Failed to generate reels.');
      setIsGenerating(false);
    }
  };

  if (isGenerating) {
    return (
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <GeneratingProgress progress={progress} />
        </div>
      </div>
    );
  }

  // Interaction mode — show ConfigureInteraction instead of the standard configure UI
  if (uploadMode === 'interaction') {
    return (
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-6">
        <div className="flex items-center gap-3 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
        <ConfigureInteraction
          transcription={transcription}
          wordTimestamps={wordTimestamps}
          speakerTimestamps={speakerTimestamps}
          sessionId={sessionId}
          onComplete={onComplete}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl w-full mx-auto flex flex-col gap-6">
      {/* Creative Brief */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Style & Context <span className="text-gray-400 font-normal">(optional)</span></h3>

        <div className="space-y-4">
          {/* Platform */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Platform</label>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCreativeBrief((b) => ({ ...b, platform: b.platform === opt.value ? undefined : opt.value }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                    creativeBrief.platform === opt.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Goal</label>
            <div className="flex flex-wrap gap-2">
              {purposeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCreativeBrief((b) => ({ ...b, purpose: b.purpose === opt.value ? undefined : opt.value }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                    creativeBrief.purpose === opt.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Tone</label>
            <div className="flex flex-wrap gap-2">
              {toneOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCreativeBrief((b) => ({ ...b, tone: b.tone === opt.value ? undefined : opt.value }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                    creativeBrief.tone === opt.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content Focus */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Content Focus</label>
            <input
              type="text"
              value={creativeBrief.contentFocus || ''}
              onChange={(e) => setCreativeBrief((b) => ({ ...b, contentFocus: e.target.value || undefined }))}
              placeholder="e.g. Focus on the marketing tips, skip the personal stories"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('guided')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'guided'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Guided
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'custom'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Custom Prompt
          </button>
        </div>

        {/* Tab Content — both stay mounted, CSS hidden */}
        <div className="p-6">
          <div className={activeTab === 'guided' ? '' : 'hidden'}>
            <ConfigureGuided config={guidedConfig} onChange={setGuidedConfig} />
          </div>
          <div className={activeTab === 'custom' ? '' : 'hidden'}>
            <ConfigureCustomPrompt
              transcription={transcription}
              confirmedPrompt={confirmedCustomPrompt}
              onConfirm={setConfirmedCustomPrompt}
              onReset={() => setConfirmedCustomPrompt(null)}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm leading-relaxed">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !canGenerate}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating Reels...
            </>
          ) : (
            'Generate Reels'
          )}
        </button>
      </div>
    </div>
  );
}
