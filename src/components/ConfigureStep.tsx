import React, { useState } from 'react';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { TranscriptionLine, GuidedConfig, Reel } from '../types';
import { ConfigureGuided } from './ConfigureGuided';
import { ConfigureCustomPrompt } from './ConfigureCustomPrompt';

type Tab = 'guided' | 'custom';

interface Props {
  transcription: TranscriptionLine[];
  onBack: () => void;
  onComplete: (reels: Reel[]) => void;
}

export function ConfigureStep({ transcription, onBack, onComplete }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('guided');
  const [guidedConfig, setGuidedConfig] = useState<GuidedConfig>({
    numberOfReels: 0,
    duration: 'auto',
    complexEdits: false,
  });
  const [confirmedCustomPrompt, setConfirmedCustomPrompt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate =
    activeTab === 'guided' || (activeTab === 'custom' && confirmedCustomPrompt !== null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const body =
        activeTab === 'guided'
          ? { transcription, mode: 'guided', guided: guidedConfig }
          : { transcription, mode: 'custom', customPrompt: confirmedCustomPrompt };

      const response = await fetch('/api/generate-reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      onComplete(data.reels);
    } catch (err: any) {
      console.error('Error generating reels:', err);
      setError(err.message || 'Failed to generate reels.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-2xl w-full mx-auto flex flex-col gap-6">
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
