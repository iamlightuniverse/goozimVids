import React, { useRef, useEffect } from 'react';
import { CaptionStyle, CaptionPresetId, CAPTION_PRESETS } from '../types';

interface Props {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  onClose: () => void;
}

const BG_SWATCHES = [
  'rgba(0,0,0,0.6)',
  'rgba(0,0,0,0.85)',
  'rgba(30,30,80,0.7)',
  'rgba(80,0,0,0.7)',
];

const HIGHLIGHT_SWATCHES = [
  '#facc15',
  '#38bdf8',
  '#4ade80',
  '#fb923c',
  '#f472b6',
  '#ffffff',
];

const POSITION_PRESETS = [
  { label: 'Bottom', value: 10 },
  { label: 'Middle', value: 45 },
  { label: 'Top', value: 80 },
];

export function CaptionSettings({ style, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const update = (patch: Partial<CaptionStyle>) => onChange({ ...style, ...patch });

  const showWordsPerLine = style.preset === 'pop' || style.preset === 'outline';

  return (
    <div
      ref={ref}
      className="absolute bottom-14 left-3 z-20 w-64 bg-gray-900/95 backdrop-blur-md rounded-xl shadow-2xl p-4 text-white max-h-[80vh] overflow-y-auto"
    >
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Style</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(Object.keys(CAPTION_PRESETS) as CaptionPresetId[]).map((id) => (
          <button
            key={id}
            onClick={() => update({ preset: id })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              style.preset === id
                ? 'bg-indigo-600 text-white'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            {CAPTION_PRESETS[id].label}
          </button>
        ))}
      </div>

      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Background</div>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => update({ showBackground: !style.showBackground })}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            style.showBackground ? 'bg-indigo-600' : 'bg-white/20'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              style.showBackground ? 'translate-x-4' : ''
            }`}
          />
        </button>
        <div className="flex gap-1.5">
          {BG_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => update({ bgColor: c })}
              className={`w-6 h-6 rounded-full border-2 transition-colors ${
                style.bgColor === c ? 'border-indigo-400' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Highlight</div>
      <div className="flex gap-1.5 mb-4">
        {HIGHLIGHT_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => update({ highlightColor: c })}
            className={`w-6 h-6 rounded-full border-2 transition-colors ${
              style.highlightColor === c ? 'border-indigo-400' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Size ({style.fontSize}%)
      </div>
      <input
        type="range"
        min={60}
        max={150}
        value={style.fontSize}
        onChange={(e) => update({ fontSize: Number(e.target.value) })}
        className="w-full accent-indigo-500 mb-4"
      />

      {/* Caption Position */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Position</div>
      <div className="flex gap-1.5 mb-2">
        {POSITION_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => update({ captionPosition: p.value })}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              style.captionPosition === p.value
                ? 'bg-indigo-600 text-white'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={5}
        max={85}
        value={style.captionPosition ?? 15}
        onChange={(e) => update({ captionPosition: Number(e.target.value) })}
        className="w-full accent-indigo-500 mb-4"
      />

      {/* Words per line — only for pop/outline */}
      {showWordsPerLine && (
        <>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Words per line
          </div>
          <div className="flex gap-1.5">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => update({ wordsPerLine: n })}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                  (style.wordsPerLine ?? 3) === n
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
