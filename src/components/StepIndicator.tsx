import React from 'react';
import { Check } from 'lucide-react';
import { Step } from '../types';

const steps: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'summary', label: 'Summary' },
  { key: 'configure', label: 'Configure' },
  { key: 'results', label: 'Results' },
];

interface Props {
  currentStep: Step;
}

export function StepIndicator({ currentStep }: Props) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {steps.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <div
                className={`h-px w-8 sm:w-12 ${
                  i <= currentIndex ? 'bg-indigo-500' : 'bg-gray-300'
                }`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isCompleted
                    ? 'bg-indigo-600 text-white'
                    : isCurrent
                      ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={`text-sm font-medium hidden sm:inline ${
                  isCurrent ? 'text-gray-900' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
