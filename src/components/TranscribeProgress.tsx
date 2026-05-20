import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Sparkles, CheckCircle2, FileAudio } from 'lucide-react';
import { TranscribePhase } from '../types';

const VIDEO_STEPS = [
  { label: 'Extracting audio', icon: FileAudio },
  { label: 'Transcribing', icon: Mic },
  { label: 'Generating summary', icon: Sparkles },
  { label: 'Done', icon: CheckCircle2 },
];

const AUDIO_STEPS = [
  { label: 'Transcribing', icon: Mic },
  { label: 'Done', icon: CheckCircle2 },
];

const TIPS = [
  'Stay on this page while your audio is being processed.',
  'Transcription accuracy improves with clear, noise-free audio.',
  'Longer recordings may take a few extra moments — hang tight.',
  'Word-level timestamps are extracted for precise editing later.',
  'Summaries are generated after transcription completes.',
];

function phaseToStepIndex(phase: TranscribePhase, isAudioOnly: boolean): number {
  if (isAudioOnly) {
    switch (phase) {
      case 'transcribing': return 0;
      case 'summarizing': return 1;  // summary runs but step isn't shown — treated as "done with transcribing"
      case 'complete': return 4;
      default: return 0;
    }
  }
  switch (phase) {
    case 'extracting_audio': return 0;
    case 'transcribing': return 1;
    case 'summarizing': return 2;
    case 'complete': return 4;
    default: return 0;
  }
}

interface Props {
  phase: TranscribePhase;
  isAudioOnly?: boolean;
}

export function TranscribeProgress({ phase, isAudioOnly = false }: Props) {
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const isComplete = phase === 'complete';
  const steps = isAudioOnly ? AUDIO_STEPS : VIDEO_STEPS;
  const activeStepIndex = phaseToStepIndex(phase, isAudioOnly);

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % TIPS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isComplete]);

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isComplete]);

  return (
    <div className="max-w-md w-full mx-auto flex flex-col items-center gap-8 py-4">
      {/* Animated icon */}
      <div className="relative w-20 h-20">
        <motion.div
          className="absolute inset-0 rounded-full bg-indigo-100"
          animate={isComplete ? { scale: 1 } : { scale: [1, 1.15, 1] }}
          transition={isComplete ? {} : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          {isComplete ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </motion.div>
          ) : (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            >
              <Mic className="w-8 h-8 text-indigo-600" />
            </motion.div>
          )}
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {isComplete ? 'Transcription complete!' : 'Processing your file'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {isComplete ? 'Ready to continue.' : `${elapsed}s elapsed`}
        </p>
      </div>

      {/* Steps */}
      <div className="w-full space-y-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const done = i < activeStepIndex;
          const active = i === activeStepIndex && !isComplete;

          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors duration-300 ${
                done
                  ? 'bg-emerald-50 border border-emerald-200'
                  : active
                    ? 'bg-indigo-50 border border-indigo-200'
                    : 'bg-gray-50 border border-gray-100'
              }`}
            >
              <div className="shrink-0">
                {done ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  >
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  </motion.div>
                ) : (
                  <Icon className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                )}
              </div>
              <span
                className={`text-sm font-medium ${
                  done ? 'text-emerald-700' : active ? 'text-indigo-700' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
              {active && (
                <motion.div
                  className="ml-auto flex gap-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {[0, 1, 2].map((dot) => (
                    <motion.span
                      key={dot}
                      className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
                    />
                  ))}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Rotating tip */}
      {!isComplete && (
        <div className="w-full px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
          <AnimatePresence mode="wait">
            <motion.p
              key={tipIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="text-xs text-amber-700 text-center leading-relaxed"
            >
              💡 {TIPS[tipIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
