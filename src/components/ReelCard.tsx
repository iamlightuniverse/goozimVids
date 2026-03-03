import React, { useState } from 'react';
import { Scissors, Info, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { Reel, TranscriptionLine, WordTimestamp, CaptionStyle } from '../types';
import { ReelPlayer } from './ReelPlayer';
import { CaptionControls } from './CaptionControls';
import { ReelFeedback } from './ReelFeedback';

function timeToSeconds(ts: string): number {
  const parts = ts.replace(/[\[\]]/g, '').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
}

export function ReelCard({ reel, videoUrl, transcription, wordTimestamps, captionsEnabled, onToggleCaptions, captionStyle, onCaptionStyleChange, onReelUpdated }: Props) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<number>>(new Set());

  const toggleExcerpt = (index: number) => {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const totalDuration = reel.segments.reduce((sum, seg) => {
    return sum + Math.max(0, timeToSeconds(seg.outTimestamp) - timeToSeconds(seg.inTimestamp));
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
        body: JSON.stringify({
          transcription,
          originalReel: reel,
          feedback,
          config,
        }),
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

  const multiSegmentText = reel.multiSegmentReason || reel.multiSegmentExplanation;

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Left side — video player + caption controls below */}
      <div className="lg:w-1/2 flex-shrink-0 space-y-2">
        {videoUrl && <ReelPlayer videoUrl={videoUrl} segments={reel.segments} transcription={transcription} wordTimestamps={wordTimestamps} captionsEnabled={captionsEnabled} captionStyle={captionStyle} />}
        <div className="px-1">
          <CaptionControls
            captionsEnabled={captionsEnabled}
            onToggleCaptions={onToggleCaptions}
            captionStyle={captionStyle}
            onCaptionStyleChange={onCaptionStyleChange}
          />
        </div>
      </div>

      {/* Right side — reel info, segments, feedback */}
      <div className="lg:w-1/2 space-y-4 min-w-0">
        {/* Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900 leading-tight">{reel.title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <Clock className="w-3 h-3" />
              {formatDuration(totalDuration)}
            </span>
            {reel.isMultiSegment ? (
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
            <p className="text-xs text-indigo-900/80 leading-relaxed">
              {multiSegmentText}
            </p>
          </div>
        )}

        {/* Edit points — always visible */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <Scissors className="w-4 h-4" />
            Edit Points ({reel.segments.length} segment{reel.segments.length !== 1 ? 's' : ''})
          </div>
          <div className="space-y-2">
            {reel.segments.map((segment, j) => {
              const segDuration = Math.max(0, timeToSeconds(segment.outTimestamp) - timeToSeconds(segment.inTimestamp));
              const isExpanded = expandedExcerpts.has(j);

              return (
                <div key={j} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  {reel.isMultiSegment && (
                    <div className="text-xs font-medium text-gray-400 mb-2">Segment {j + 1}</div>
                  )}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <div className="font-mono text-xs text-emerald-600 font-medium pt-0.5">
                      IN {segment.inTimestamp}
                    </div>
                    <div className="text-gray-700 italic">"{segment.wordsIn}..."</div>

                    <div className="font-mono text-xs text-rose-600 font-medium pt-0.5">
                      OUT {segment.outTimestamp}
                    </div>
                    <div className="text-gray-700 italic">"...{segment.wordsOut}"</div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400 font-mono">
                    Duration: {formatDuration(segDuration)}
                  </div>
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
