import React from 'react';
import { Sparkles, ArrowLeft, ArrowRight } from 'lucide-react';
import { TranscriptionLine, UploadMode } from '../types';
import { TranscriptionPanel } from './TranscriptionPanel';

interface Props {
  summary: string;
  transcription: TranscriptionLine[];
  uploadMode?: UploadMode;
  onBack: () => void;
  onNext: () => void;
}

export function SummaryStep({ summary, transcription, uploadMode, onBack, onNext }: Props) {
  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      {/* Summary Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-indigo-500" />
          AI Summary
        </h2>
        <p className="text-gray-700 leading-relaxed">{summary}</p>
      </div>

      {/* Navigation — above transcript so user doesn't have to scroll */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        {uploadMode !== 'audio' && (
          <button
            onClick={onNext}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm transition-colors"
          >
            Configure Reels
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Transcription */}
      <div className="flex-1 min-h-0">
        <TranscriptionPanel transcription={transcription} />
      </div>
    </div>
  );
}
