import React from 'react';
import { GuidedConfig } from '../types';

interface Props {
  config: GuidedConfig;
  onChange: (config: GuidedConfig) => void;
}

const durationOptions: { label: string; value: number | 'auto' }[] = [
  { label: '15s', value: 15 },
  { label: '20s', value: 20 },
  { label: '30s', value: 30 },
  { label: '45s', value: 45 },
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '120s', value: 120 },
  { label: 'Auto', value: 'auto' },
];

export function ConfigureGuided({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      {/* Number of Reels */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Number of Reels</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={20}
            value={config.numberOfReels}
            onChange={(e) =>
              onChange({ ...config, numberOfReels: Math.max(0, parseInt(e.target.value) || 0) })
            }
            className="w-24 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm"
          />
          <span className="text-sm text-gray-500">
            {config.numberOfReels === 0 ? '(Auto — AI decides)' : `reel${config.numberOfReels !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {/* Duration */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Target Duration per Reel
        </label>
        <div className="flex flex-wrap gap-2">
          {durationOptions.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => onChange({ ...config, duration: opt.value })}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                config.duration === opt.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Duration is an approximate target, not a hard limit.
        </p>
      </div>

      {/* Complex Edits */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700">Complex Edits</label>
            <p className="text-xs text-gray-400 mt-0.5">
              Combine clips from different parts of the video into creative, multi-segment reels.
            </p>
          </div>
          <button
            onClick={() => onChange({ ...config, complexEdits: !config.complexEdits })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${
              config.complexEdits ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              config.complexEdits ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>
    </div>
  );
}
