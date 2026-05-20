import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { ApiKeyForm, ConfigStatus } from './ApiKeyForm';

interface Props {
  status: ConfigStatus;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal({ status, onClose, onSaved }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSaved = () => {
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-xl p-8 mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Leave a field blank to keep the existing key. Changes take effect immediately without restarting.
        </p>
        <ApiKeyForm status={status} onSaved={handleSaved} submitLabel="Save changes" />
      </div>
    </div>
  );
}
