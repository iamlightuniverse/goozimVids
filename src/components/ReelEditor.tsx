import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, RotateCcw } from 'lucide-react';
import { Reel, ReelSegment, WordTimestamp, TranscriptionLine, CaptionStyle } from '../types';
import { ReelPlayer } from './ReelPlayer';

type Tab = 'segments' | 'subtitles';

interface Props {
  reel: Reel;
  videoUrl: string | null;
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  captionStyle?: CaptionStyle;
  videoOrientation: 'horizontal' | 'vertical';
  onSave: (updatedReel: Reel) => void;
  onClose: () => void;
}

function timestampToSeconds(ts: string): number {
  const cleaned = ts.replace(/[\[\]]/g, '').trim();
  const parts = cleaned.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function secondsToTimestamp(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${parseFloat(sec) < 10 ? '0' : ''}${sec}`;
}

export function ReelEditor({ reel, videoUrl, transcription, wordTimestamps, captionStyle, videoOrientation, onSave, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('segments');

  // Segments state
  const [editedSegments, setEditedSegments] = useState<ReelSegment[]>(() =>
    reel.segments.map((s) => ({ ...s }))
  );
  const [segmentErrors, setSegmentErrors] = useState<string[]>([]);

  // Subtitle state
  const [editedWordTimestamps, setEditedWordTimestamps] = useState<WordTimestamp[]>(() =>
    reel.subtitleOverrides ? [...reel.subtitleOverrides] : []
  );

  // Word timestamps covering the reel's full range
  const reelWordTimestamps = useMemo(() => {
    if (!wordTimestamps || editedSegments.length === 0) return [];
    const minStart = Math.min(...editedSegments.map((s) => timestampToSeconds(s.inTimestamp))) - 1;
    const maxEnd = Math.max(...editedSegments.map((s) => timestampToSeconds(s.outTimestamp))) + 1;
    return wordTimestamps.filter((w) => w.start >= minStart && w.end <= maxEnd);
  }, [wordTimestamps, editedSegments]);

  const validateSegments = useCallback((segs: ReelSegment[]): string[] => {
    const errors: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const inSec = timestampToSeconds(segs[i].inTimestamp);
      const outSec = timestampToSeconds(segs[i].outTimestamp);
      if (inSec >= outSec) errors.push(`Segment ${i + 1}: IN must be before OUT`);
    }
    return errors;
  }, []);

  const updateSegmentSeconds = (idx: number, field: 'inTimestamp' | 'outTimestamp', seconds: number) => {
    const updated = editedSegments.map((s, i) =>
      i === idx ? { ...s, [field]: secondsToTimestamp(Math.max(0, seconds)) } : s
    );
    setEditedSegments(updated);
    setSegmentErrors(validateSegments(updated));
  };

  const addSegment = () => {
    const lastSeg = editedSegments[editedSegments.length - 1];
    const lastEnd = lastSeg ? timestampToSeconds(lastSeg.outTimestamp) : 0;
    setEditedSegments([
      ...editedSegments,
      { inTimestamp: secondsToTimestamp(lastEnd + 1), outTimestamp: secondsToTimestamp(lastEnd + 11), wordsIn: '', wordsOut: '' },
    ]);
  };

  const removeSegment = (idx: number) => {
    if (editedSegments.length <= 1) return;
    const updated = editedSegments.filter((_, i) => i !== idx);
    setEditedSegments(updated);
    setSegmentErrors(validateSegments(updated));
  };

  const handleSave = () => {
    const errors = validateSegments(editedSegments);
    if (errors.length > 0) { setSegmentErrors(errors); return; }
    onSave({
      ...reel,
      segments: editedSegments,
      isMultiSegment: editedSegments.length > 1,
      subtitleOverrides: editedWordTimestamps.length > 0 ? editedWordTimestamps : undefined,
    });
  };

  const previewSubtitles = activeTab === 'subtitles' && editedWordTimestamps.length > 0
    ? editedWordTimestamps
    : reel.subtitleOverrides;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch">
      <div className="flex flex-col w-full h-full bg-white">
        {/* Tab bar + actions */}
        <div className="flex items-center border-b border-gray-200 shrink-0">
          <div className="flex">
            {(['segments', 'subtitles'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3.5 text-sm font-medium capitalize transition-colors relative ${
                  activeTab === tab ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
                {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 px-4">
            <button
              onClick={handleSave}
              disabled={segmentErrors.length > 0}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Save Changes
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-2 border-b border-gray-100 shrink-0">
          <p className="text-sm text-gray-500">
            Editing: <span className="font-medium text-gray-900">{reel.title}</span>
          </p>
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: editor controls */}
          <div className="w-1/2 border-r border-gray-200 overflow-y-auto p-6">

            {/* ── Segments tab ── */}
            {activeTab === 'segments' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Cut Points</h3>
                  <button
                    onClick={addSegment}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Segment
                  </button>
                </div>

                {segmentErrors.length > 0 && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                    {segmentErrors.map((e, i) => (
                      <p key={i} className="text-xs text-rose-700">{e}</p>
                    ))}
                  </div>
                )}

                {editedSegments.map((seg, i) => {
                  const inSec = timestampToSeconds(seg.inTimestamp);
                  const outSec = timestampToSeconds(seg.outTimestamp);
                  return (
                    <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">
                          {editedSegments.length > 1 ? `Segment ${i + 1}` : 'Clip'}
                        </span>
                        {editedSegments.length > 1 && (
                          <button onClick={() => removeSegment(i)} className="p-1 rounded text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">IN (seconds)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={inSec.toFixed(1)}
                            onChange={(e) => updateSegmentSeconds(i, 'inTimestamp', parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <p className="text-xs text-emerald-600 font-mono mt-1">{seg.inTimestamp}</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">OUT (seconds)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={outSec.toFixed(1)}
                            onChange={(e) => updateSegmentSeconds(i, 'outTimestamp', parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <p className="text-xs text-rose-600 font-mono mt-1">{seg.outTimestamp}</p>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        Duration: {formatDuration(Math.max(0, outSec - inSec))}s
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Subtitles tab ── */}
            {activeTab === 'subtitles' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Subtitle Words</h3>
                  {editedWordTimestamps.length > 0 && (
                    <button
                      onClick={() => setEditedWordTimestamps([])}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}
                </div>

                {reelWordTimestamps.length === 0 && (
                  <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
                    No word timestamps available for this reel's time range.
                  </div>
                )}

                {reelWordTimestamps.length > 0 && editedWordTimestamps.length === 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs text-amber-700">
                      Showing original words. Edit any word to create overrides.
                    </p>
                  </div>
                )}

                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {(editedWordTimestamps.length > 0 ? editedWordTimestamps : reelWordTimestamps).map((w, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                      <input
                        type="text"
                        value={w.word}
                        onChange={(e) => {
                          const base = editedWordTimestamps.length > 0 ? editedWordTimestamps : reelWordTimestamps;
                          const updated = base.map((ww, j) => j === i ? { ...ww, word: e.target.value } : ww);
                          setEditedWordTimestamps(updated);
                        }}
                        className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-gray-400 font-mono shrink-0">{w.start.toFixed(2)}s</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="w-1/2 flex items-center justify-center bg-gray-900 p-6">
            {videoUrl ? (
              <ReelPlayer
                videoUrl={videoUrl}
                segments={editedSegments}
                transcription={transcription}
                wordTimestamps={wordTimestamps}
                subtitleOverrides={previewSubtitles}
                captionsEnabled={true}
                captionStyle={captionStyle}
                orientation={videoOrientation}
              />
            ) : (
              <p className="text-gray-400 text-sm">No video available for preview.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
