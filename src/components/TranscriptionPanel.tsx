import React from 'react';
import { Download, Clock } from 'lucide-react';
import { TranscriptionLine } from '../types';

interface Props {
  transcription: TranscriptionLine[];
}

export function TranscriptionPanel({ transcription }: Props) {
  const handleExport = () => {
    const text = transcription.map(t => `[${t.timestamp}] ${t.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50/80">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-500" />
          Transcription
        </h2>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          Export .txt
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcription.map((line, i) => (
          <div key={i} className="flex gap-4 group">
            <span className="font-mono text-xs text-gray-400 pt-1 shrink-0 w-16">
              {line.timestamp}
            </span>
            <p className="text-gray-700 leading-relaxed group-hover:text-gray-900 transition-colors">
              {line.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
