import React from 'react';
import { KeyRound } from 'lucide-react';
import { ApiKeyForm, ConfigStatus } from './ApiKeyForm';

interface Props {
  status: ConfigStatus;
  onConfigured: () => void;
}

export function SetupStep({ status, onConfigured }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-gray-700" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Set up API keys</h2>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Goozim Videos needs a few API keys to transcribe and process your videos. These are saved locally to a <code className="font-mono bg-gray-100 px-1 rounded">.env</code> file on this machine.
        </p>
        <ApiKeyForm status={status} onSaved={onConfigured} />
      </div>
    </div>
  );
}
