import React, { useState } from 'react';
import { MessageSquare, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

const durationOptions: { label: string; value: number | 'auto' }[] = [
  { label: '15s', value: 15 },
  { label: '20s', value: 20 },
  { label: '30s', value: 30 },
  { label: '45s', value: 45 },
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: 'Auto', value: 'auto' },
];

interface Props {
  onRegenerate: (feedback: string, config?: { duration?: number | 'auto'; customPrompt?: string }) => void;
  isRegenerating: boolean;
}

export function ReelFeedback({ onRegenerate, isRegenerating }: Props) {
  const [feedback, setFeedback] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [duration, setDuration] = useState<number | 'auto'>('auto');
  const [customPrompt, setCustomPrompt] = useState('');

  const handleRegenerate = () => {
    const config: { duration?: number | 'auto'; customPrompt?: string } = {};
    if (duration !== 'auto') config.duration = duration;
    if (customPrompt.trim()) config.customPrompt = customPrompt.trim();

    onRegenerate(feedback, Object.keys(config).length > 0 ? config : undefined);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <MessageSquare className="w-4 h-4" />
        Feedback
      </div>

      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="What would you change? e.g., 'Make it shorter', 'Focus more on the intro', 'Include the part about...'"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
        rows={2}
        disabled={isRegenerating}
      />

      <button
        onClick={() => setShowConfig(!showConfig)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        {showConfig ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Advanced options
      </button>

      {showConfig && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Duration override
            </label>
            <div className="flex flex-wrap gap-1.5">
              {durationOptions.map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() => setDuration(opt.value)}
                  disabled={isRegenerating}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
                    duration === opt.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Additional instructions
            </label>
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g., 'Make it more dramatic'"
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              disabled={isRegenerating}
            />
          </div>
        </div>
      )}

      <button
        onClick={handleRegenerate}
        disabled={isRegenerating}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
        {isRegenerating ? 'Regenerating...' : 'Try Again'}
      </button>
    </div>
  );
}
