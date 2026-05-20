import React, { useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';

export interface ConfigStatus {
  isConfigured: boolean;
  sttProvider: 'deepgram' | 'soniox' | 'elevenlabs';
  openRouterPreview: string | null;
  sttKeyPreview: string | null;
  hasOpenRouter: boolean;
  hasSttKey: boolean;
}

interface Props {
  status: ConfigStatus | null;
  onSaved: () => void;
  submitLabel?: string;
}

const STT_LABELS: Record<string, string> = {
  deepgram: 'Deepgram API Key',
  soniox: 'Soniox API Key',
  elevenlabs: 'ElevenLabs API Key',
};

const STT_LINKS: Record<string, string> = {
  deepgram: 'https://console.deepgram.com/signup',
  soniox: 'https://soniox.com/dashboard/api-keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
};

export function ApiKeyForm({ status, onSaved, submitLabel = 'Save & continue' }: Props) {
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [sttProvider, setSttProvider] = useState<'deepgram' | 'soniox' | 'elevenlabs'>(
    status?.sttProvider ?? 'soniox'
  );
  const [sttKey, setSttKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (!openRouterKey.trim() && !sttKey.trim()) {
        setError('Please fill in at least one field.');
        return;
      }
      const res = await fetch('/api/config/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterKey, sttProvider, sttKey }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="or-key" className="text-sm font-medium text-gray-700">
            OpenRouter API Key
          </label>
          <a
            href="https://openrouter.ai/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Get a key <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <input
          id="or-key"
          type="password"
          value={openRouterKey}
          onChange={e => setOpenRouterKey(e.target.value)}
          placeholder={status?.openRouterPreview ?? 'sk-or-...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="stt-provider" className="block text-sm font-medium text-gray-700 mb-1">
          Speech-to-text provider
        </label>
        <select
          id="stt-provider"
          value={sttProvider}
          onChange={e => setSttProvider(e.target.value as typeof sttProvider)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
        >
          <option value="soniox">Soniox</option>
          <option value="deepgram">Deepgram</option>
          <option value="elevenlabs">ElevenLabs</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="stt-key" className="text-sm font-medium text-gray-700">
            {STT_LABELS[sttProvider]}
          </label>
          <a
            href={STT_LINKS[sttProvider]}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Get a key <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <input
          id="stt-key"
          type="password"
          value={sttKey}
          onChange={e => setSttKey(e.target.value)}
          placeholder={sttProvider === (status?.sttProvider ?? 'soniox') ? (status?.sttKeyPreview ?? 'Paste key here...') : 'Paste key here...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}
