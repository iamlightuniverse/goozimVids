import React, { useState } from 'react';
import { Scissors, RotateCcw } from 'lucide-react';
import { Step, TranscriptionLine, Reel, WordTimestamp, CaptionStyle, DEFAULT_CAPTION_STYLE } from './types';
import { StepIndicator } from './components/StepIndicator';
import { UploadStep } from './components/UploadStep';
import { SummaryStep } from './components/SummaryStep';
import { ConfigureStep } from './components/ConfigureStep';
import { ResultsStep } from './components/ResultsStep';

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionLine[]>([]);
  const [summary, setSummary] = useState('');
  const [reels, setReels] = useState<Reel[]>([]);
  const [wordTimestamps, setWordTimestamps] = useState<WordTimestamp[] | undefined>();
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);

  const handleStartOver = () => {
    setCurrentStep('upload');
    setVideoFile(null);
    setTranscription([]);
    setSummary('');
    setReels([]);
    setWordTimestamps(undefined);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
              <Scissors className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Video to Reels AI</h1>
          </div>
          {currentStep !== 'upload' && (
            <button
              onClick={handleStartOver}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Start Over
            </button>
          )}
        </div>
      </header>

      <StepIndicator currentStep={currentStep} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 pb-6 flex flex-col">
        {currentStep === 'upload' && (
          <UploadStep
            onComplete={({ videoFile: vf, transcription: t, summary: s, wordTimestamps: wt }) => {
              setVideoFile(vf);
              setTranscription(t);
              setSummary(s);
              setWordTimestamps(wt);
              setCurrentStep('summary');
            }}
          />
        )}

        {currentStep === 'summary' && (
          <SummaryStep
            summary={summary}
            transcription={transcription}
            onBack={() => setCurrentStep('upload')}
            onNext={() => setCurrentStep('configure')}
          />
        )}

        {currentStep === 'configure' && (
          <ConfigureStep
            transcription={transcription}
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
            wordTimestamps={wordTimestamps}
            captionStyle={captionStyle}
            onCaptionStyleChange={setCaptionStyle}
            onBack={() => setCurrentStep('configure')}
            onStartOver={handleStartOver}
            onReelsChange={setReels}
            summary={summary}
          />
        )}
      </main>
    </div>
  );
}
