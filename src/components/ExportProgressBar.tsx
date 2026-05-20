import React, { useEffect, useState } from 'react';
import { Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { ExportProgressEvent, CaptionStyle } from '../types';

interface Props {
  sessionId: string;
  segments: any[];
  subtitleOverrides?: any[];
  wordTimestamps?: any[];
  orientation: 'horizontal' | 'vertical';
  burnSubtitles: boolean;
  captionStyle?: CaptionStyle;
  reelTitle: string;
  onComplete: (downloadPath: string) => void;
  onError: (message: string) => void;
}

export function ExportProgressBar({
  sessionId,
  segments,
  subtitleOverrides,
  wordTimestamps,
  orientation,
  burnSubtitles,
  captionStyle,
  reelTitle,
  onComplete,
  onError,
}: Props) {
  const [percent, setPercent] = useState(0);
  const [status, setStatus] = useState<'encoding' | 'complete' | 'error'>('encoding');
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let controller: AbortController | null = new AbortController();

    (async () => {
      try {
        const response = await fetch('/api/export-reel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            segments,
            subtitleOverrides,
            wordTimestamps,
            orientation,
            burnSubtitles,
            captionStyle,
            reelTitle,
          }),
          signal: controller!.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Export failed.' }));
          throw new Error(err.error || 'Export failed.');
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event: ExportProgressEvent = JSON.parse(line.slice(6));

            if (event.phase === 'encoding') {
              setPercent(event.percent ?? 0);
            } else if (event.phase === 'complete' && event.downloadPath) {
              setStatus('complete');
              setDownloadPath(event.downloadPath);
              setPercent(100);
              onComplete(event.downloadPath);
            } else if (event.phase === 'error') {
              throw new Error(event.message || 'Export failed.');
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setStatus('error');
        setErrorMsg(err.message || 'Export failed.');
        onError(err.message || 'Export failed.');
      }
    })();

    return () => {
      controller?.abort();
      controller = null;
    };
  }, []);

  return (
    <div className="space-y-2">
      {status === 'encoding' && (
        <>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            Encoding… {percent}%
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      )}
      {status === 'complete' && downloadPath && (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <span className="text-sm text-emerald-700 font-medium">Export complete!</span>
          <a
            href={downloadPath}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download MP4
          </a>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}
    </div>
  );
}
