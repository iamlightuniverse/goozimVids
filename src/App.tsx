import React, { useState, useEffect } from 'react';
import { RotateCcw, Settings } from 'lucide-react';
import { Step, TranscriptionLine, Reel, WordTimestamp, CaptionStyle, DEFAULT_CAPTION_STYLE, VideoMetadata, SpeakerTimestamp, UploadMode } from './types';
import { StepIndicator } from './components/StepIndicator';
import { UploadStep } from './components/UploadStep';
import { SummaryStep } from './components/SummaryStep';
import { ConfigureStep } from './components/ConfigureStep';
import { ResultsStep } from './components/ResultsStep';
import { SetupStep } from './components/SetupStep';
import { SettingsModal } from './components/SettingsModal';
import type { ConfigStatus } from './components/ApiKeyForm';

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionLine[]>([]);
  const [summary, setSummary] = useState('');
  const [reels, setReels] = useState<Reel[]>([]);
  const [wordTimestamps, setWordTimestamps] = useState<WordTimestamp[] | undefined>();
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | undefined>();
  const [videoOrientation, setVideoOrientation] = useState<'horizontal' | 'vertical'>('vertical');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode>('highlight');
  const [speakerTimestamps, setSpeakerTimestamps] = useState<SpeakerTimestamp[] | undefined>();
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Persist reels to the session whenever they change
  useEffect(() => {
    if (!sessionId || !reels.length) return;
    fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reels }),
    }).catch(() => {});
  }, [reels, sessionId]);

  const fetchConfig = async () => {
    const res = await fetch('/api/config/status');
    const data = await res.json();
    setConfigStatus(data);
    setConfigLoading(false);
  };

  useEffect(() => { fetchConfig(); }, []);

  const handleStartOver = () => {
    setCurrentStep('upload');
    setVideoFile(null);
    setVideoUrl(null);
    setTranscription([]);
    setSummary('');
    setReels([]);
    setWordTimestamps(undefined);
    setVideoMetadata(undefined);
    setVideoOrientation('vertical');
    setSessionId(null);
    setUploadMode('highlight');
    setSpeakerTimestamps(undefined);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden shadow-sm">
              <img src="/goozim-avatar.png" alt="Goozim" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Goozim Videos</h1>
          </div>
          <div className="flex items-center gap-3">
            {currentStep !== 'upload' && (
              <button
                onClick={handleStartOver}
                className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Start Over
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="text-gray-400 hover:text-gray-700 transition-colors"
              title="API Keys"
              aria-label="API Keys settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <StepIndicator currentStep={currentStep} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 pb-6 flex flex-col">
        {configLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : configStatus && !configStatus.isConfigured ? (
          <SetupStep status={configStatus} onConfigured={fetchConfig} />
        ) : (
          <>
            {currentStep === 'upload' && (
              <UploadStep
                onComplete={({ videoFile: vf, videoUrl: vu, transcription: t, summary: s, wordTimestamps: wt, videoMetadata: vm, sessionId: sid, uploadMode: um, speakerTimestamps: st, reels: r }) => {
                  setVideoFile(vf ?? null);
                  setVideoUrl(vu ?? null);
                  setTranscription(t);
                  setSummary(s);
                  setWordTimestamps(wt);
                  if (vm) {
                    setVideoMetadata(vm);
                    setVideoOrientation(vm.orientation);
                  }
                  if (sid) setSessionId(sid);
                  if (um) setUploadMode(um);
                  if (st) setSpeakerTimestamps(st);
                  if (r?.length) {
                    setReels(r);
                    setCurrentStep('results');
                  } else {
                    setCurrentStep('summary');
                  }
                }}
                onImport={({ transcription: t, reels: r, wordTimestamps: wt, videoFile: vf }) => {
                  setTranscription(t);
                  setReels(r);
                  setSummary('Imported session');
                  setWordTimestamps(wt);
                  if (vf) setVideoFile(vf);
                  setCurrentStep('results');
                }}
              />
            )}

            {currentStep === 'summary' && (
              <SummaryStep
                summary={summary}
                transcription={transcription}
                uploadMode={uploadMode}
                onBack={() => setCurrentStep('upload')}
                onNext={() => setCurrentStep('configure')}
              />
            )}

            {currentStep === 'configure' && (
              <ConfigureStep
                transcription={transcription}
                wordTimestamps={wordTimestamps}
                uploadMode={uploadMode}
                speakerTimestamps={speakerTimestamps}
                sessionId={sessionId}
                onBack={() => setCurrentStep('summary')}
                onComplete={(r) => {
                  setReels(r);
                  setCurrentStep('results');
                }}
              />
            )}

            {currentStep === 'results' && (
              <ResultsStep
                transcription={transcription}
                reels={reels}
                videoFile={videoFile}
                videoUrl={videoUrl}
                wordTimestamps={wordTimestamps}
                captionStyle={captionStyle}
                onCaptionStyleChange={setCaptionStyle}
                onBack={() => setCurrentStep('configure')}
                onStartOver={handleStartOver}
                onReelsChange={setReels}
                summary={summary}
                videoOrientation={videoOrientation}
                sessionId={sessionId}
                videoMetadata={videoMetadata}
              />
            )}
          </>
        )}
      </main>

      {showSettings && configStatus && (
        <SettingsModal
          status={configStatus}
          onClose={() => setShowSettings(false)}
          onSaved={fetchConfig}
        />
      )}
    </div>
  );
}
