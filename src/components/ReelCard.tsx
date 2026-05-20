import React, { useState } from 'react';
import { Scissors, Info, ChevronDown, ChevronUp, Clock, Pencil, MessageSquare, Film, Download, AlertCircle } from 'lucide-react';
import { Reel, TranscriptionLine, WordTimestamp, CaptionStyle } from '../types';
import { ReelPlayer } from './ReelPlayer';
import { CaptionControls } from './CaptionControls';
import { ReelFeedback } from './ReelFeedback';
import { ReelEditor } from './ReelEditor';
import { VideoOrientationToggle } from './VideoOrientationToggle';
import { ExportProgressBar } from './ExportProgressBar';

function timeToSeconds(ts: string): number {
  const parts = ts.replace(/[\[\]]/g, '').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function findSegStartTime(inTimestamp: string, wordTimestamps: WordTimestamp[]): number {
  const inSec = timeToSeconds(inTimestamp);
  if (wordTimestamps.length === 0) return inSec;
  for (const w of wordTimestamps) {
    if (w.start >= inSec - 0.1) return w.start;
  }
  return inSec;
}

function findSegEndTime(outTimestamp: string, wordTimestamps: WordTimestamp[]): number {
  const outSec = timeToSeconds(outTimestamp);
  if (wordTimestamps.length === 0) return outSec + 0.5;
  let lastWord: WordTimestamp | null = null;
  for (const w of wordTimestamps) {
    if (w.start <= outSec + 0.8) lastWord = w;
    else break;
  }
  return lastWord ? lastWord.end - 0.05 : outSec + 0.5;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function generateSRT(wordTimestamps: WordTimestamp[], segments: { inTimestamp: string; outTimestamp: string }[]): string {
  if (!wordTimestamps.length || !segments.length) return '';
  const segWords: WordTimestamp[] = [];
  let timeOffset = 0;
  for (const seg of segments) {
    const inSec = timeToSeconds(seg.inTimestamp);
    const outSec = timeToSeconds(seg.outTimestamp);
    const segDuration = outSec - inSec;
    const inSeg = wordTimestamps.filter((w) => w.start >= inSec - 0.1 && w.end <= outSec + 0.1);
    for (const w of inSeg) {
      segWords.push({ ...w, start: w.start - inSec + timeOffset, end: w.end - inSec + timeOffset });
    }
    timeOffset += segDuration;
  }
  const groups: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < segWords.length; i += 5) {
    const grp = segWords.slice(i, i + 5);
    groups.push({ start: grp[0].start, end: grp[grp.length - 1].end, text: grp.map((w) => w.word).join(' ') });
  }
  function toSRTTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }
  return groups.map((g, i) => `${i + 1}\n${toSRTTime(g.start)} --> ${toSRTTime(g.end)}\n${g.text}\n`).join('\n');
}

interface Props {
  reel: Reel;
  videoUrl: string | null;
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  captionsEnabled: boolean;
  onToggleCaptions: () => void;
  captionStyle?: CaptionStyle;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
  onReelUpdated: (newReel: Reel) => void;
  videoOrientation?: 'horizontal' | 'vertical';
  sessionId?: string | null;
}

export function ReelCard({ reel, videoUrl, transcription, wordTimestamps, captionsEnabled, onToggleCaptions, captionStyle, onCaptionStyleChange, onReelUpdated, videoOrientation = 'vertical', sessionId }: Props) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<number>>(new Set());
  const [showEditor, setShowEditor] = useState(false);

  // Export panel state
  const [showExport, setShowExport] = useState(false);
  const [exportOrientation, setExportOrientation] = useState<'horizontal' | 'vertical'>(
    reel.orientationOverride || videoOrientation
  );
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportDownloadPath, setExportDownloadPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const toggleExcerpt = (index: number) => {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const wt = wordTimestamps || [];
  const totalDuration = reel.segments.reduce((sum, seg) => {
    const start = findSegStartTime(seg.inTimestamp, wt);
    const end = findSegEndTime(seg.outTimestamp, wt);
    return sum + Math.max(0, end - start);
  }, 0);

  const handleRegenerate = async (
    feedback: string,
    config?: { duration?: number | 'auto'; customPrompt?: string },
  ) => {
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/regenerate-reel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription, originalReel: reel, feedback, config }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate reel.');
      }
      const data = await res.json();
      onReelUpdated(data.reel);
    } catch (err: any) {
      console.error('Regeneration failed:', err);
      alert(err.message || 'Failed to regenerate reel.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDownloadSRT = () => {
    const wts = reel.subtitleOverrides || wordTimestamps || [];
    const srt = generateSRT(wts, reel.segments);
    if (!srt) return;
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reel.title.replace(/[^a-z0-9]/gi, '_')}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetExport = () => {
    setIsExporting(false);
    setExportDownloadPath(null);
    setExportError(null);
  };

  const multiSegmentText = reel.multiSegmentReason || reel.multiSegmentExplanation;

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Reel Editor modal */}
      {showEditor && (
        <ReelEditor
          reel={reel}
          videoUrl={videoUrl}
          transcription={transcription}
          wordTimestamps={wordTimestamps}
          captionStyle={captionStyle}
          videoOrientation={videoOrientation}
          onSave={(updatedReel) => {
            onReelUpdated(updatedReel);
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* Left side — video player + caption controls + export panel */}
      <div className="lg:w-1/2 flex-shrink-0 space-y-2">
        {videoUrl && (
          <ReelPlayer
            videoUrl={videoUrl}
            segments={reel.segments}
            transcription={transcription}
            wordTimestamps={wordTimestamps}
            subtitleOverrides={reel.subtitleOverrides}
            captionsEnabled={captionsEnabled}
            captionStyle={captionStyle}
            orientation={reel.orientationOverride || videoOrientation}
          />
        )}
        <div className="px-1">
          <CaptionControls
            captionsEnabled={captionsEnabled}
            onToggleCaptions={onToggleCaptions}
            captionStyle={captionStyle}
            onCaptionStyleChange={onCaptionStyleChange}
          />
        </div>

        {/* ── Export to MP4 panel ── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowExport((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-500" />
              Export to MP4
            </div>
            {showExport ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showExport && (
            <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
              {/* Orientation */}
              <VideoOrientationToggle
                orientation={exportOrientation}
                onChange={(o) => { setExportOrientation(o); resetExport(); }}
                label="Output"
              />

              {/* Subtitle options */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={burnSubtitles}
                    onChange={(e) => { setBurnSubtitles(e.target.checked); resetExport(); }}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  Burn subtitles
                </label>
                <button
                  onClick={handleDownloadSRT}
                  disabled={!wordTimestamps?.length && !reel.subtitleOverrides?.length}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 disabled:text-gray-400 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download SRT
                </button>
              </div>

              {/* No session warning */}
              {!sessionId && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    Video export requires a server session. Upload the video in a new session (not imported) to enable export.
                  </p>
                </div>
              )}

              {/* Export button */}
              {sessionId && !isExporting && !exportDownloadPath && (
                <button
                  onClick={() => setIsExporting(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Film className="w-4 h-4" />
                  Export as MP4
                </button>
              )}

              {/* Progress bar */}
              {sessionId && isExporting && (
                <ExportProgressBar
                  sessionId={sessionId}
                  segments={reel.segments}
                  subtitleOverrides={reel.subtitleOverrides}
                  wordTimestamps={wordTimestamps}
                  orientation={exportOrientation}
                  burnSubtitles={burnSubtitles}
                  captionStyle={captionStyle}
                  reelTitle={reel.title}
                  onComplete={(path) => {
                    setExportDownloadPath(path);
                    setIsExporting(false);
                  }}
                  onError={(msg) => {
                    setExportError(msg);
                    setIsExporting(false);
                  }}
                />
              )}

              {exportError && (
                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-rose-700">{exportError}</p>
                    <button onClick={resetExport} className="text-xs text-rose-500 hover:text-rose-700 mt-1">Try again</button>
                  </div>
                </div>
              )}

              {exportDownloadPath && !isExporting && (
                <button onClick={resetExport} className="text-xs text-gray-500 hover:text-gray-700">
                  Export again
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right side — reel info, segments, feedback */}
      <div className="lg:w-1/2 space-y-4 min-w-0">
        {/* Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900 leading-tight">{reel.title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowEditor(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
              title="Edit cut points and subtitles"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <Clock className="w-3 h-3" />
              {formatDuration(totalDuration)}
            </span>
            {reel.interactionType === 'exchange' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                <MessageSquare className="w-3 h-3" />
                Q&A Exchange
              </span>
            ) : reel.isMultiSegment ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                <Scissors className="w-3 h-3" />
                Multi-segment
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                Single Clip
              </span>
            )}
          </div>
        </div>

        {reel.hookReason && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-1.5 border border-amber-100">
            Hook: {reel.hookReason}
          </p>
        )}

        <p className="text-sm text-gray-600">{reel.description}</p>

        {reel.isMultiSegment && multiSegmentText && (
          <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100/50 flex gap-2">
            <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <p className="text-xs text-indigo-900/80 leading-relaxed">{multiSegmentText}</p>
          </div>
        )}

        {/* Edit points */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <Scissors className="w-4 h-4" />
            Edit Points ({reel.segments.length} segment{reel.segments.length !== 1 ? 's' : ''})
          </div>
          <div className="space-y-2">
            {reel.segments.map((segment, j) => {
              const segDuration = Math.max(0, findSegEndTime(segment.outTimestamp, wt) - findSegStartTime(segment.inTimestamp, wt));
              const isExpanded = expandedExcerpts.has(j);
              return (
                <div key={j} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  {reel.isMultiSegment && (
                    <div className="text-xs font-medium text-gray-400 mb-2">Segment {j + 1}</div>
                  )}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <div className="font-mono text-xs text-emerald-600 font-medium pt-0.5">IN {segment.inTimestamp}</div>
                    <div className="text-gray-700 italic">"{segment.wordsIn}..."</div>
                    <div className="font-mono text-xs text-rose-600 font-medium pt-0.5">OUT {segment.outTimestamp}</div>
                    <div className="text-gray-700 italic">"...{segment.wordsOut}"</div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400 font-mono">Duration: {formatDuration(segDuration)}</div>
                  {segment.transcriptExcerpt && (
                    <button
                      onClick={() => toggleExcerpt(j)}
                      className="mt-2 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {isExpanded ? 'Hide transcript' : 'Show transcript'}
                    </button>
                  )}
                  {isExpanded && segment.transcriptExcerpt && (
                    <div className="mt-2 p-2.5 bg-white rounded border border-gray-200 text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                      {segment.transcriptExcerpt}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Feedback + retry */}
        <div className="border-t border-gray-200 pt-4">
          <ReelFeedback onRegenerate={handleRegenerate} isRegenerating={isRegenerating} />
        </div>
      </div>

      {/* Loading overlay */}
      {isRegenerating && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white rounded-xl px-6 py-4 shadow-lg flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-700">Regenerating reel...</span>
          </div>
        </div>
      )}
    </div>
  );
}
