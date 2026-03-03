import React, { useState } from 'react';
import { Download, X, FileJson } from 'lucide-react';
import { Reel } from '../types';

interface Props {
  reels: Reel[];
}

export function ExportReelsButton({ reels }: Props) {
  const [showModal, setShowModal] = useState(false);

  const handleExport = () => {
    const exportData = {
      reels: reels.map(r => ({
        title: r.title,
        ...(r.hookReason && { hookReason: r.hookReason }),
        description: r.description,
        isMultiSegment: r.isMultiSegment,
        ...(r.multiSegmentReason && { multiSegmentReason: r.multiSegmentReason }),
        ...(r.multiSegmentExplanation && { multiSegmentExplanation: r.multiSegmentExplanation }),
        segments: r.segments.map(s => ({
          in: s.inTimestamp,
          out: s.outTimestamp,
          wordsIn: s.wordsIn,
          wordsOut: s.wordsOut,
          ...(s.transcriptExcerpt && { transcriptExcerpt: s.transcriptExcerpt })
        }))
      }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reels_export.json';
    a.click();
    URL.revokeObjectURL(url);
    setShowModal(false);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm"
      >
        <Download className="w-4 h-4" />
        Export Reels
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileJson className="w-5 h-5 text-indigo-500" />
                Export Reels Data
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                This will download a <strong>.json</strong> file containing all your recommended reels, including titles, descriptions, and precise IN/OUT timestamps.
              </p>
              
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">How to use this file:</h4>
                <ul className="text-sm text-gray-600 space-y-2 list-disc pl-4 marker:text-gray-400">
                  <li><strong>Premiere Pro / After Effects:</strong> Use a script like <a href="https://aescripts.com/json-to-markers/" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">JSON to Markers</a> to automatically create markers on your timeline.</li>
                  <li><strong>DaVinci Resolve:</strong> You can convert this JSON to an EDL or CSV marker list using free online converter tools, then import it via <em>Timeline &gt; Import &gt; Timeline Markers</em>.</li>
                  <li><strong>Custom Workflows:</strong> Pass this JSON to Python scripts or automation tools (like FFmpeg) to auto-cut the video.</li>
                </ul>
              </div>

              <button
                onClick={handleExport}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download JSON
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
