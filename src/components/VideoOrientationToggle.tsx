import React from 'react';
import { Smartphone, Monitor } from 'lucide-react';

interface Props {
  orientation: 'horizontal' | 'vertical';
  onChange: (orientation: 'horizontal' | 'vertical') => void;
  label?: string;
}

export function VideoOrientationToggle({ orientation, onChange, label }: Props) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-sm text-gray-600">{label}</span>}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => onChange('vertical')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            orientation === 'vertical'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
          title="Vertical (9:16)"
        >
          <Smartphone className="w-3.5 h-3.5" />
          9:16
        </button>
        <button
          type="button"
          onClick={() => onChange('horizontal')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
            orientation === 'horizontal'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
          title="Horizontal (16:9)"
        >
          <Monitor className="w-3.5 h-3.5" />
          16:9
        </button>
      </div>
    </div>
  );
}
