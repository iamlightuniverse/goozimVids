import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Sparkles,
  FileSearch,
  CheckCircle2,
  Scissors,
} from 'lucide-react';
import { GenerationProgress } from '../types';

const STEPS = [
  { label: 'Sending request to AI', icon: Send },
  { label: 'AI is generating reels', icon: Sparkles },
  { label: 'Processing results', icon: FileSearch },
  { label: 'Reels ready', icon: CheckCircle2 },
];

const TIPS = [
  'Great reels start with a hook in the first 3 seconds.',
  'Multi-segment edits can combine the best moments.',
  'Each reel is verified to be self-contained and complete.',
  'The AI looks for bold claims, stories, and emotional peaks.',
  'Clips are checked for strong openings and natural endings.',
];

function phaseToStepIndex(phase: GenerationProgress['phase']): number {
  switch (phase) {
    case 'sending': return 0;
    case 'streaming': return 1;
    case 'parsing': return 2;
    case 'complete': return 4;
  }
}

function formatChars(chars: number): string {
  if (chars >= 1000) {
    return `${(chars / 1000).toFixed(1)}k`;
  }
  return `${chars}`;
}

export function GeneratingProgress({ progress }: { progress: GenerationProgress }) {
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const activeStepIndex = phaseToStepIndex(progress.phase);
  const isComplete = progress.phase === 'complete';

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
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            >
              <Scissors className="w-8 h-8 text-indigo-600" />
            </motion.div>
          )}
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {isComplete ? 'Reels ready!' : 'Generating your reels'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {isComplete
            ? `${progress.reelCount} reel${progress.reelCount !== 1 ? 's' : ''} generated successfully.`
            : `${elapsed}s elapsed`}
        </p>
      </div>

      {/* Steps */}
      <div className="w-full space-y-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = i < activeStepIndex;
          const active = i === activeStepIndex && !isComplete;

          let subtitle = '';
          if (i === 1 && (active || done) && progress.charsReceived > 0) {
            subtitle = `${formatChars(progress.charsReceived)} chars received`;
          }
          if (i === 3 && isComplete && progress.reelCount > 0) {
            subtitle = `${progress.reelCount} reel${progress.reelCount !== 1 ? 's' : ''} found`;
          }

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
                  <Icon
                    className={`w-5 h-5 ${
                      active ? 'text-indigo-600' : 'text-gray-300'
                    }`}
                  />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-sm font-medium ${
                    done
                      ? 'text-emerald-700'
                      : active
                        ? 'text-indigo-700'
                        : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
                {subtitle && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`text-xs ${
                      done ? 'text-emerald-500' : 'text-indigo-400'
                    }`}
                  >
                    {subtitle}
                  </motion.span>
                )}
              </div>
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
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: dot * 0.2,
                      }}
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
