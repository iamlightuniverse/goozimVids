import React, { useState } from 'react';
import { Loader2, Check, Pencil, RotateCcw } from 'lucide-react';
import { TranscriptionLine } from '../types';

type Phase = 'enter' | 'reviewing' | 'confirmed';

interface Props {
  transcription: TranscriptionLine[];
  confirmedPrompt: string | null;
  onConfirm: (prompt: string) => void;
  onReset: () => void;
}

export function ConfigureCustomPrompt({
  transcription,
  confirmedPrompt,
  onConfirm,
  onReset,
}: Props) {
  const [userPrompt, setUserPrompt] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [editableInterpretation, setEditableInterpretation] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase: Phase = confirmedPrompt ? 'confirmed' : interpretation ? 'reviewing' : 'enter';

  const handleInterpret = async () => {
    if (!userPrompt.trim()) return;

    setIsInterpreting(true);
    setError(null);

    try {
      const response = await fetch('/api/interpret-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, transcription }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      setInterpretation(data.interpretation);
      setEditableInterpretation(data.interpretation);
    } catch (err: any) {
      setError(err.message || 'Failed to interpret prompt.');
    } finally {
      setIsInterpreting(false);
    }
  };

  const handleConfirm = () => {
    onConfirm(isEditing ? editableInterpretation : interpretation);
  };

  const handleStartOver = () => {
    setInterpretation('');
    setEditableInterpretation('');
    setIsEditing(false);
    setError(null);
    onReset();
  };

  // Phase: confirmed
  if (phase === 'confirmed') {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-800">Prompt Confirmed</span>
          </div>
          <p className="text-sm text-emerald-900/80 leading-relaxed">{confirmedPrompt}</p>
        </div>
        <button
          onClick={handleStartOver}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Start over with a new prompt
        </button>
      </div>
    );
  }

  // Phase: reviewing interpretation
  if (phase === 'reviewing') {
    return (
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">AI Interpretation</label>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Pencil className="w-3 h-3" />
              {isEditing ? 'Preview' : 'Edit'}
            </button>
          </div>
          {isEditing ? (
            <textarea
              value={editableInterpretation}
              onChange={(e) => setEditableInterpretation(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm text-sm resize-none"
            />
          ) : (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
              <p className="text-sm text-indigo-900/80 leading-relaxed">{interpretation}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Confirm
          </button>
          <button
            onClick={handleStartOver}
            className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
          >
            Start Over
          </button>
        </div>
      </div>
    );
  }

  // Phase: enter prompt
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Describe the reels you want
        </label>
        <textarea
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          rows={4}
          placeholder='e.g. "Give me 3 reels around 60 seconds each, focusing on the most controversial takes in the video"'
          className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm text-sm resize-none"
        />
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {error}
        </div>
      )}

      <button
        onClick={handleInterpret}
        disabled={isInterpreting || !userPrompt.trim()}
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
      >
        {isInterpreting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Interpreting...
          </>
        ) : (
          'Interpret Prompt'
        )}
      </button>
    </div>
  );
}
