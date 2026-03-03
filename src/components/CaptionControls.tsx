import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { CaptionStyle } from '../types';
import { CaptionSettings } from './CaptionSettings';

interface Props {
  captionsEnabled: boolean;
  onToggleCaptions: () => void;
  captionStyle?: CaptionStyle;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
}

export function CaptionControls({ captionsEnabled, onToggleCaptions, captionStyle, onCaptionStyleChange }: Props) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          onClick={onToggleCaptions}
          className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
            captionsEnabled
              ? 'bg-indigo-600 text-white'
              : 'bg-black/50 text-white/70 line-through'
          }`}
        >
          CC
        </button>
        {captionsEnabled && onCaptionStyleChange && (
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-1.5 rounded-full bg-black/50 text-white/70 hover:text-white transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showSettings && captionStyle && onCaptionStyleChange && (
        <CaptionSettings
          style={captionStyle}
          onChange={onCaptionStyleChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
