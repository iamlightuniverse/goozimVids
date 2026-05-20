import React, { useRef, useState, useEffect } from 'react';
import { Upload, FileVideo, FileText, Loader2, AlertCircle, X, Globe, FolderOpen, Clapperboard, MessageSquare, Trash2, History, Mic } from 'lucide-react';
import { TranscriptionLine, WordTimestamp, Reel, ReelSegment, VideoMetadata, SpeakerTimestamp, SessionSummary, UploadMode, TranscribePhase, UploadResponse } from '../types';
import { TranscribeProgress } from './TranscribeProgress';

interface Props {
  onComplete: (data: {
    videoFile?: File;
    videoUrl?: string;
    transcription: TranscriptionLine[];
    summary: string;
    wordTimestamps?: WordTimestamp[];
    videoMetadata?: VideoMetadata;
    sessionId?: string;
    uploadMode?: UploadMode;
    speakerTimestamps?: SpeakerTimestamp[];
    reels?: Reel[];
  }) => void;
  onImport?: (data: {
    transcription: TranscriptionLine[];
    reels: Reel[];
    wordTimestamps?: WordTimestamp[];
    videoFile?: File;
  }) => void;
}

function parseReelsExport(data: any): Reel[] {
  const rawReels = data.reels || data;
  if (!Array.isArray(rawReels)) throw new Error('Invalid reels format');

  return rawReels.map((r: any) => ({
    title: r.title || 'Untitled',
    hookReason: r.hookReason,
    description: r.description || '',
    isMultiSegment: r.isMultiSegment || (r.segments?.length > 1) || false,
    multiSegmentReason: r.multiSegmentReason,
    multiSegmentExplanation: r.multiSegmentExplanation,
    segments: (r.segments || []).map((s: any): ReelSegment => ({
      inTimestamp: s.inTimestamp || s.in || '',
      outTimestamp: s.outTimestamp || s.out || '',
      wordsIn: s.wordsIn || '',
      wordsOut: s.wordsOut || '',
      transcriptExcerpt: s.transcriptExcerpt,
    })),
  }));
}

type Tab = 'new' | 'sessions' | 'continue';

export function UploadStep({ onComplete, onImport }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('new');

  // Previous sessions state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'sessions') {
      setSessionsLoading(true);
      setSessionsError(null);
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((data) => setSessions(data.sessions || []))
        .catch((e) => setSessionsError(e.message || 'Failed to load sessions'))
        .finally(() => setSessionsLoading(false));
    }
  }, [activeTab]);

  const handleDelete = async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const handleResume = async (sessionId: string) => {
    setResumingId(sessionId);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/data`);
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      const data = await r.json();
      if (data.expired) throw new Error('This session\'s video has expired.');
      onComplete({
        videoUrl: data.uploadMode === 'audio' ? undefined : `/api/sessions/${sessionId}/video`,
        transcription: data.transcription,
        summary: data.summary,
        wordTimestamps: data.wordTimestamps,
        videoMetadata: data.videoMetadata,
        sessionId: data.sessionId,
        uploadMode: data.uploadMode,
        speakerTimestamps: data.speakerTimestamps,
        reels: data.reels,
      });
    } catch (e: any) {
      setSessionsError(e.message || 'Failed to resume session');
    } finally {
      setResumingId(null);
    }
  };

  const [uploadMode, setUploadMode] = useState<UploadMode>('highlight');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'processing' | 'done'>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [processPhase, setProcessPhase] = useState<TranscribePhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState('');

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      abortControllerRef.current?.abort();
    };
  }, []);

  // Import state
  const [importTranscriptFile, setImportTranscriptFile] = useState<File | null>(null);
  const [importReelsFile, setImportReelsFile] = useState<File | null>(null);
  const [importVideoFile, setImportVideoFile] = useState<File | null>(null);
  const importTranscriptRef = useRef<HTMLInputElement>(null);
  const importReelsRef = useRef<HTMLInputElement>(null);
  const importVideoRef = useRef<HTMLInputElement>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const openProcessingSSE = async (sessionId: string, videoMetadata?: VideoMetadata) => {
    setUploadPhase('processing');
    setProcessPhase(uploadMode === 'audio' ? 'transcribing' : 'extracting_audio');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 15-minute absolute watchdog — prevents infinite hang if server stalls
    const watchdogId = setTimeout(() => {
      controller.abort();
      setError('Processing is taking too long. Please try again.');
      setUploadPhase('idle');
      setProcessPhase(null);
    }, 15 * 60 * 1000);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/process`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Processing failed: ${response.status}`);
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
          let event: any;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.phase === 'error') {
            setError(event.message || 'Processing failed.');
            setUploadPhase('idle');
            setProcessPhase(null);
            return;
          }
          if (event.phase === 'complete') {
            const d = event.data;
            onComplete({
              videoFile: uploadMode !== 'audio' ? videoFile ?? undefined : undefined,
              transcription: d.transcription,
              summary: d.summary,
              wordTimestamps: d.wordTimestamps,
              videoMetadata: d.videoMetadata ?? videoMetadata,
              sessionId,
              uploadMode: d.uploadMode,
              speakerTimestamps: d.speakerTimestamps,
            });
            setUploadPhase('done');
            return;
          }
          setProcessPhase(event.phase as TranscribePhase);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Processing failed.');
      setUploadPhase('idle');
      setProcessPhase(null);
    } finally {
      clearTimeout(watchdogId);
    }
  };

  const handleSubmit = () => {
    if (!videoFile) {
      setError(`Please upload a ${uploadMode === 'audio' ? 'audio' : 'video'} file.`);
      return;
    }

    setUploadPhase('uploading');
    setUploadPercent(0);
    setError(null);

    const formData = new FormData();
    formData.append('video', videoFile);
    if (transcriptFile) formData.append('transcript', transcriptFile);
    if (language) formData.append('language', language);
    formData.append('mode', uploadMode);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadPercent(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        let data: UploadResponse;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          setError('Invalid response from server.');
          setUploadPhase('idle');
          return;
        }
        openProcessingSSE(data.sessionId, data.videoMetadata);
      } else {
        let message = `Server error: ${xhr.status}`;
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData.error) message = errData.error;
        } catch {}
        setError(message);
        setUploadPhase('idle');
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setError('Network error during upload.');
      setUploadPhase('idle');
    };

    xhr.open('POST', '/api/transcribe');
    xhr.send(formData);
  };

  const handleImport = async () => {
    if (!importTranscriptFile || !importReelsFile) {
      setError('Both transcript and reels files are required for import.');
      return;
    }
    setError(null);
    try {
      const transcriptRaw = await importTranscriptFile.text();
      const transcriptData = JSON.parse(transcriptRaw);
      const transcription: TranscriptionLine[] = transcriptData.transcription || transcriptData;
      const wordTimestamps: WordTimestamp[] | undefined = transcriptData.wordTimestamps;

      const reelsRaw = await importReelsFile.text();
      const reelsData = JSON.parse(reelsRaw);
      const reels = parseReelsExport(reelsData);

      onImport?.({
        transcription,
        reels,
        wordTimestamps,
        videoFile: importVideoFile || undefined,
      });
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to parse import files.');
    }
  };

  return (
    <div className="max-w-2xl w-full mx-auto mt-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {[
            { id: 'new' as Tab, icon: Upload, label: 'New Upload' },
            { id: 'sessions' as Tab, icon: History, label: 'Previous Sessions' },
            ...(onImport ? [{ id: 'continue' as Tab, icon: FolderOpen, label: 'Import Files' }] : []),
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setError(null); setSessionsError(null); }}
              className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${
                activeTab === id ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Icon className="w-4 h-4" />
                {label}
              </div>
              {activeTab === id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          ))}
        </div>

        <div className="p-8">
          {/* ─── New Session Tab ─── */}
          {activeTab === 'new' && (
            <>
              {uploadPhase === 'uploading' && (
                <div className="flex flex-col items-center gap-6 py-6">
                  <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center">
                    <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-gray-900 mb-1">Uploading file…</p>
                    <p className="text-sm text-gray-500">{uploadPercent}% complete</p>
                  </div>
                  <div className="w-full max-w-sm">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {uploadPhase === 'processing' && (
                <TranscribeProgress
                  phase={processPhase ?? (uploadMode === 'audio' ? 'transcribing' : 'extracting_audio')}
                  isAudioOnly={uploadMode === 'audio'}
                />
              )}

              {(uploadPhase === 'idle' || uploadPhase === 'done') && (
                <>
                  <h2 className="text-2xl font-semibold mb-2 text-center text-gray-900">
                    {uploadMode === 'audio' ? 'Upload Audio' : 'Upload Your Video'}
                  </h2>
                  <p className="text-gray-500 text-center mb-8">
                    {uploadMode === 'audio'
                      ? 'Upload an audio file to get a transcript and summary.'
                      : 'Upload a video file and optionally provide an existing transcript to skip transcription.'}
                  </p>

                  <div className="space-y-6">
                    {/* Mode selector */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">What are you creating?</label>
                      <div className="grid grid-cols-3 gap-3">
                        <button
                          type="button"
                          onClick={() => { setUploadMode('highlight'); setVideoFile(null); }}
                          className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 transition-colors ${
                            uploadMode === 'highlight'
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-gray-200 bg-white hover:border-indigo-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Clapperboard className={`w-4 h-4 ${uploadMode === 'highlight' ? 'text-indigo-600' : 'text-gray-500'}`} />
                            <span className={`text-sm font-medium ${uploadMode === 'highlight' ? 'text-indigo-700' : 'text-gray-700'}`}>
                              Highlight Reels
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 text-left">Extract the best moments as standalone clips</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setUploadMode('interaction'); setVideoFile(null); }}
                          className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 transition-colors ${
                            uploadMode === 'interaction'
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-gray-200 bg-white hover:border-indigo-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <MessageSquare className={`w-4 h-4 ${uploadMode === 'interaction' ? 'text-indigo-600' : 'text-gray-500'}`} />
                            <span className={`text-sm font-medium ${uploadMode === 'interaction' ? 'text-indigo-700' : 'text-gray-700'}`}>
                              Interaction Mode
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 text-left">Split Q&A / speaker exchanges by conversation</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setUploadMode('audio'); setVideoFile(null); setTranscriptFile(null); }}
                          className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 transition-colors ${
                            uploadMode === 'audio'
                              ? 'border-teal-500 bg-teal-50'
                              : 'border-gray-200 bg-white hover:border-teal-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Mic className={`w-4 h-4 ${uploadMode === 'audio' ? 'text-teal-600' : 'text-gray-500'}`} />
                            <span className={`text-sm font-medium ${uploadMode === 'audio' ? 'text-teal-700' : 'text-gray-700'}`}>
                              Audio Only
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 text-left">Transcribe an audio file — no video needed</p>
                        </button>
                      </div>
                    </div>

                    {/* File Upload */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {uploadMode === 'audio' ? 'Audio File' : 'Video File'}{' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <div
                        onDragOver={e => { e.preventDefault(); setIsDraggingOver(true); }}
                        onDragLeave={() => setIsDraggingOver(false)}
                        onDrop={e => {
                          e.preventDefault();
                          setIsDraggingOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) { setVideoFile(file); setError(null); }
                        }}
                        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                          isDraggingOver
                            ? 'border-indigo-400 bg-indigo-50'
                            : videoFile
                            ? uploadMode === 'audio'
                              ? 'border-teal-500 bg-teal-50/50'
                              : 'border-indigo-500 bg-indigo-50/50'
                            : 'border-gray-300 hover:border-indigo-400 bg-gray-50'
                        }`}
                      >
                        <input
                          type="file"
                          accept={uploadMode === 'audio' ? 'audio/*' : 'video/*'}
                          className="hidden"
                          ref={videoInputRef}
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              setVideoFile(e.target.files[0]);
                              setError(null);
                            }
                          }}
                        />
                        {videoFile ? (
                          <div className="flex flex-col items-center gap-2">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${uploadMode === 'audio' ? 'bg-teal-100' : 'bg-indigo-100'}`}>
                              {uploadMode === 'audio'
                                ? <Mic className="w-5 h-5 text-teal-600" />
                                : <FileVideo className="w-5 h-5 text-indigo-600" />
                              }
                            </div>
                            <p className="font-medium text-gray-900">{videoFile.name}</p>
                            <p className="text-sm text-gray-500">
                              {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                            <button
                              onClick={() => setVideoFile(null)}
                              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-10 h-10 bg-white rounded-full shadow-sm border border-gray-200 flex items-center justify-center">
                              <Upload className="w-5 h-5 text-gray-400" />
                            </div>
                            <p className="font-medium text-gray-900">
                              {isDraggingOver ? 'Drop to upload' : `Drag & drop or select a ${uploadMode === 'audio' ? 'audio' : 'video'} file`}
                            </p>
                            <p className="text-sm text-gray-500">
                              {uploadMode === 'audio' ? 'MP3, WAV, M4A, OGG, FLAC' : 'MP4, WebM, MOV'}
                            </p>
                            <button
                              onClick={() => videoInputRef.current?.click()}
                              className="mt-2 px-4 py-2 bg-white border border-gray-200 shadow-sm rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              Select File
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Language Select — hidden when transcript is attached or audio mode */}
                    {!transcriptFile && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <Globe className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                          Transcription Language
                        </label>
                        <select
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                          className="w-full p-3 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="">Auto-detect</option>
                          <option value="en">English</option>
                          <option value="es">Spanish</option>
                          <option value="fr">French</option>
                          <option value="de">German</option>
                          <option value="pt">Portuguese</option>
                          <option value="ar">Arabic</option>
                          <option value="hi">Hindi</option>
                          <option value="ja">Japanese</option>
                          <option value="zh">Chinese</option>
                          <option value="ko">Korean</option>
                          <option value="it">Italian</option>
                          <option value="nl">Dutch</option>
                          <option value="ru">Russian</option>
                          <option value="tr">Turkish</option>
                          <option value="pl">Polish</option>
                          <option value="sv">Swedish</option>
                          <option value="da">Danish</option>
                          <option value="no">Norwegian</option>
                          <option value="fi">Finnish</option>
                          <option value="uk">Ukrainian</option>
                          <option value="he">Hebrew</option>
                        </select>
                      </div>
                    )}

                    {/* Optional Transcript Upload — hidden for audio mode */}
                    {uploadMode !== 'audio' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Existing Transcript{' '}
                          <span className="text-gray-400 font-normal">(optional — skips transcription)</span>
                        </label>
                        <input
                          type="file"
                          accept=".json,.txt,.text"
                          className="hidden"
                          ref={transcriptInputRef}
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              setTranscriptFile(e.target.files[0]);
                            }
                          }}
                        />
                        {transcriptFile ? (
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <FileText className="w-5 h-5 text-gray-500" />
                            <span className="text-sm text-gray-700 flex-1">{transcriptFile.name}</span>
                            <button
                              onClick={() => setTranscriptFile(null)}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => transcriptInputRef.current?.click()}
                            className="w-full p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                          >
                            Upload .json or .txt transcript
                          </button>
                        )}
                      </div>
                    )}

                    {error && (
                      <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <p className="text-sm leading-relaxed">{error}</p>
                      </div>
                    )}

                    <button
                      onClick={handleSubmit}
                      disabled={!videoFile}
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium shadow-sm transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ─── Previous Sessions Tab ─── */}
          {activeTab === 'sessions' && (
            <>
              <h2 className="text-2xl font-semibold mb-2 text-center text-gray-900">
                Previous Sessions
              </h2>
              <p className="text-gray-500 text-center mb-6">
                Resume any saved session without re-transcribing.
              </p>

              {sessionsLoading && (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              )}

              {sessionsError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700 mb-4">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p className="text-sm">{sessionsError}</p>
                </div>
              )}

              {!sessionsLoading && sessions.length === 0 && !sessionsError && (
                <div className="py-12 text-center text-gray-400">
                  <History className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No previous sessions found.</p>
                  <p className="text-xs mt-1">Sessions are kept until you delete them.</p>
                </div>
              )}

              <div className="space-y-3">
                {sessions.map((s) => {
                  const noVideo = s.videoExists === false;
                  const isResuming = resumingId === s.sessionId;
                  const isDeleting = deletingId === s.sessionId;
                  const busy = isResuming || isDeleting || !!resumingId || !!deletingId;

                  return (
                    <div
                      key={s.sessionId}
                      className={`p-4 rounded-xl border transition-colors ${
                        noVideo
                          ? 'border-gray-200 bg-gray-50 opacity-60'
                          : 'border-gray-200 bg-white hover:border-indigo-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-sm text-gray-900 truncate">
                              {s.originalFilename}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              s.uploadMode === 'interaction'
                                ? 'bg-purple-100 text-purple-700'
                                : s.uploadMode === 'audio'
                                  ? 'bg-teal-100 text-teal-700'
                                  : 'bg-indigo-100 text-indigo-700'
                            }`}>
                              {s.uploadMode === 'interaction' ? 'Interaction' : s.uploadMode === 'audio' ? 'Audio' : 'Highlight'}
                            </span>
                            {noVideo && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-medium">
                                Video file missing
                              </span>
                            )}
                            {s.reelCount > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                                {s.reelCount} reel{s.reelCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mb-2">
                            {new Date(s.createdAt).toLocaleString()} &middot;{' '}
                            {s.videoMetadata
                              ? `${Math.floor(s.videoMetadata.durationSeconds / 60)}m ${Math.floor(s.videoMetadata.durationSeconds % 60)}s · ${s.videoMetadata.orientation}`
                              : ''}
                          </p>
                          {s.summary && (
                            <p className="text-xs text-gray-500 line-clamp-2">
                              {s.summary.slice(0, 150)}{s.summary.length > 150 ? '…' : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!noVideo && (
                            <button
                              onClick={() => handleResume(s.sessionId)}
                              disabled={busy}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
                            >
                              {isResuming ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Loading…
                                </>
                              ) : (
                                'Resume'
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(s.sessionId)}
                            disabled={busy}
                            className="p-1.5 text-gray-400 hover:text-rose-600 disabled:opacity-40 rounded-lg hover:bg-rose-50 transition-colors"
                            title="Delete session"
                          >
                            {isDeleting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ─── Continue Session Tab ─── */}
          {activeTab === 'continue' && (
            <>
              <h2 className="text-2xl font-semibold mb-2 text-center text-gray-900">
                Continue a Session
              </h2>
              <p className="text-gray-500 text-center mb-8">
                Upload a transcript and reels export to pick up where you left off.
              </p>

              <div className="space-y-4">
                {/* Hidden file inputs */}
                <input type="file" accept=".json" className="hidden" ref={importTranscriptRef}
                  onChange={(e) => { if (e.target.files?.[0]) { setImportTranscriptFile(e.target.files[0]); setError(null); } }} />
                <input type="file" accept=".json" className="hidden" ref={importReelsRef}
                  onChange={(e) => { if (e.target.files?.[0]) { setImportReelsFile(e.target.files[0]); setError(null); } }} />
                <input type="file" accept="video/*" className="hidden" ref={importVideoRef}
                  onChange={(e) => { if (e.target.files?.[0]) { setImportVideoFile(e.target.files[0]); setError(null); } }} />

                {/* Transcript JSON */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Transcript JSON <span className="text-rose-500">*</span>
                  </label>
                  {importTranscriptFile ? (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <FileText className="w-5 h-5 text-gray-500" />
                      <span className="text-sm text-gray-700 flex-1 truncate">{importTranscriptFile.name}</span>
                      <button onClick={() => setImportTranscriptFile(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => importTranscriptRef.current?.click()}
                      className="w-full p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                    >
                      Upload transcript .json
                    </button>
                  )}
                </div>

                {/* Reels JSON */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reels Export JSON <span className="text-rose-500">*</span>
                  </label>
                  {importReelsFile ? (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <FileText className="w-5 h-5 text-indigo-500" />
                      <span className="text-sm text-gray-700 flex-1 truncate">{importReelsFile.name}</span>
                      <button onClick={() => setImportReelsFile(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => importReelsRef.current?.click()}
                      className="w-full p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                    >
                      Upload reels export .json
                    </button>
                  )}
                </div>

                {/* Optional video for import */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Video File{' '}
                    <span className="text-gray-400 font-normal">(optional — for playback)</span>
                  </label>
                  {importVideoFile ? (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <FileVideo className="w-5 h-5 text-gray-500" />
                      <span className="text-sm text-gray-700 flex-1 truncate">{importVideoFile.name}</span>
                      <button onClick={() => setImportVideoFile(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => importVideoRef.current?.click()}
                      className="w-full p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Upload video for playback
                    </button>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm leading-relaxed">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleImport}
                  disabled={!importTranscriptFile || !importReelsFile}
                  className="w-full py-3 px-4 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-300 text-white rounded-xl font-medium shadow-sm transition-colors"
                >
                  Import & View Reels
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
