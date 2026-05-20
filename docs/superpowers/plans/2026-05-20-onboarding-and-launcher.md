# Onboarding & Mac Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run onboarding screen that writes `.env`, a gear-icon settings modal for editing keys later, and a double-clickable `start.command` Mac launcher.

**Architecture:** Two new Express endpoints read/write `.env`; a `SetupStep` component replaces `UploadStep` until all required keys are present; a `SettingsModal` is always accessible from the header via a gear icon; `ApiKeyForm` is shared between both. A `start.command` shell script bootstraps the app on Mac.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Express, Node.js fs module, `concurrently` (new dev dep)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server.ts` | Modify | Add `parseEnvFile`, `writeEnvFile`, `maskKey` helpers; change `const ai`/`const openrouter` to `let`; add `GET /api/config/status` and `POST /api/config/save` |
| `src/components/ApiKeyForm.tsx` | Create | Shared form: OR key, Gemini key, STT provider dropdown, STT key |
| `src/components/SetupStep.tsx` | Create | Full-screen first-run onboarding wrapping `ApiKeyForm` |
| `src/components/SettingsModal.tsx` | Create | Modal wrapping `ApiKeyForm`, opened from gear icon |
| `src/App.tsx` | Modify | Mount-time config check, conditional render of `SetupStep`, gear icon in header |
| `package.json` | Modify | Add `concurrently` dev dep; add `dev:all` script |
| `start.command` | Create | Mac launcher: Node check, npm install, open browser, start app |

---

## Task 1: Server helpers and config endpoints

**Files:**
- Modify: `server.ts:23-41` (AI clients section — change `const` to `let`)
- Modify: `server.ts:59` (Helpers section — add three helpers)
- Modify: `server.ts:849` (just before first route — add two endpoints)

- [ ] **Step 1: Change `const ai` and `const openrouter` to `let`**

In `server.ts`, find lines 25 and 38 and change:
```ts
// line 25
let ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// line 38
let openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'missing',
});
```

- [ ] **Step 2: Add env file helpers to the Helpers section**

After the `parseTranscriptText` function (around line 80 in `server.ts`), add:

```ts
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function writeEnvFile(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n';
}

function maskKey(key: string | undefined): string | null {
  if (!key || key.length < 4) return null;
  return '••••' + key.slice(-4);
}

function sttEnvKey(provider: string): string {
  if (provider === 'soniox') return 'SONIOX_API_KEY';
  if (provider === 'elevenlabs') return 'ELEVENLABS_API_KEY';
  return 'DEEPGRAM_API_KEY';
}
```

- [ ] **Step 3: Add `GET /api/config/status` just before `app.post('/api/transcribe'...`** (line 850)

```ts
app.get('/api/config/status', (_req, res) => {
  const envPath = path.resolve('.env');
  let vars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    vars = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  }
  // Merge with already-loaded process.env so existing deployments work
  const orKey = vars.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  const gemKey = vars.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const provider = (vars.STT_PROVIDER || process.env.STT_PROVIDER || 'soniox') as string;
  const sttKey = vars[sttEnvKey(provider)] || process.env[sttEnvKey(provider)];

  res.json({
    hasOpenRouter: !!orKey,
    hasGemini: !!gemKey,
    sttProvider: provider,
    hasSttKey: !!sttKey,
    isConfigured: !!orKey && !!gemKey && !!sttKey,
    openRouterPreview: maskKey(orKey),
    geminiPreview: maskKey(gemKey),
    sttKeyPreview: maskKey(sttKey),
  });
});
```

- [ ] **Step 4: Add `POST /api/config/save` immediately after the status endpoint**

```ts
app.post('/api/config/save', (req, res) => {
  try {
    const { openRouterKey, geminiKey, sttProvider, sttKey } = req.body as {
      openRouterKey?: string;
      geminiKey?: string;
      sttProvider?: string;
      sttKey?: string;
    };

    const envPath = path.resolve('.env');
    let vars: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
      vars = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
    }

    if (openRouterKey?.trim()) {
      vars.OPENROUTER_API_KEY = openRouterKey.trim();
      process.env.OPENROUTER_API_KEY = openRouterKey.trim();
      openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openRouterKey.trim() });
    }
    if (geminiKey?.trim()) {
      vars.GEMINI_API_KEY = geminiKey.trim();
      process.env.GEMINI_API_KEY = geminiKey.trim();
      ai = new GoogleGenAI({ apiKey: geminiKey.trim() });
    }
    if (sttProvider?.trim()) {
      vars.STT_PROVIDER = sttProvider.trim();
      process.env.STT_PROVIDER = sttProvider.trim();
    }
    if (sttKey?.trim()) {
      const envName = sttEnvKey(sttProvider || process.env.STT_PROVIDER || 'soniox');
      vars[envName] = sttKey.trim();
      process.env[envName] = sttKey.trim();
      if (envName === 'DEEPGRAM_API_KEY') _deepgram = null; // force lazy re-init
    }

    fs.writeFileSync(envPath, writeEnvFile(vars));
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 5: Verify the server still starts**

Run: `npm run dev:server`
Expected: Server starts on port 3001 with no TypeScript errors.

Then in another terminal: `curl http://localhost:3001/api/config/status`
Expected: JSON response with `isConfigured`, `sttProvider`, preview fields.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: add config status and save endpoints"
```

---

## Task 2: `ApiKeyForm` shared component

**Files:**
- Create: `src/components/ApiKeyForm.tsx`

- [ ] **Step 1: Create `src/components/ApiKeyForm.tsx`**

```tsx
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

export interface ConfigStatus {
  isConfigured: boolean;
  sttProvider: 'deepgram' | 'soniox' | 'elevenlabs';
  openRouterPreview: string | null;
  geminiPreview: string | null;
  sttKeyPreview: string | null;
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

export function ApiKeyForm({ status, onSaved, submitLabel = 'Save & continue' }: Props) {
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
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
      const res = await fetch('/api/config/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterKey, geminiKey, sttProvider, sttKey }),
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          OpenRouter API Key
        </label>
        <input
          type="password"
          value={openRouterKey}
          onChange={e => setOpenRouterKey(e.target.value)}
          placeholder={status?.openRouterPreview ?? 'sk-or-...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gemini API Key
        </label>
        <input
          type="password"
          value={geminiKey}
          onChange={e => setGeminiKey(e.target.value)}
          placeholder={status?.geminiPreview ?? 'AIza...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Speech-to-text provider
        </label>
        <select
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {STT_LABELS[sttProvider]}
        </label>
        <input
          type="password"
          value={sttKey}
          onChange={e => setSttKey(e.target.value)}
          placeholder={status?.sttKeyPreview ?? 'Paste key here...'}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ApiKeyForm.tsx
git commit -m "feat: add ApiKeyForm shared component"
```

---

## Task 3: `SetupStep` component

**Files:**
- Create: `src/components/SetupStep.tsx`

- [ ] **Step 1: Create `src/components/SetupStep.tsx`**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SetupStep.tsx
git commit -m "feat: add SetupStep onboarding component"
```

---

## Task 4: `SettingsModal` component

**Files:**
- Create: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Create `src/components/SettingsModal.tsx`**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: add SettingsModal component"
```

---

## Task 5: Wire everything into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports at the top of `src/App.tsx`**

Add to the existing import block:
```tsx
import { Settings } from 'lucide-react';
import { SetupStep } from './components/SetupStep';
import { SettingsModal } from './components/SettingsModal';
import type { ConfigStatus } from './components/ApiKeyForm';
```

- [ ] **Step 2: Add config state inside the `App()` function, after the existing `useState` declarations**

```tsx
const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
const [configLoading, setConfigLoading] = useState(true);
const [showSettings, setShowSettings] = useState(false);
```

- [ ] **Step 3: Add a `fetchConfig` helper and call it on mount, after the existing `useEffect`**

```tsx
const fetchConfig = async () => {
  const res = await fetch('/api/config/status');
  const data = await res.json();
  setConfigStatus(data);
  setConfigLoading(false);
};

useEffect(() => { fetchConfig(); }, []);
```

- [ ] **Step 4: Add the gear icon button to the header**

Find the closing `</div>` of the header's inner `max-w-7xl` div (around line 69 in the original). The header currently has a conditional "Start Over" button. Add the gear icon alongside it:

Replace:
```tsx
          {currentStep !== 'upload' && (
            <button
              onClick={handleStartOver}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Start Over
            </button>
          )}
```

With:
```tsx
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
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
```

- [ ] **Step 5: Replace the `<main>` block in `src/App.tsx`**

Replace this exact block (lines 74-151):
```tsx
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 pb-6 flex flex-col">
        {currentStep === 'upload' && (
```

...through the closing `</main>` with:

```tsx
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
```

- [ ] **Step 6: Add the settings modal just before the closing `</div>` of the outermost div**

```tsx
        {showSettings && configStatus && (
          <SettingsModal
            status={configStatus}
            onClose={() => setShowSettings(false)}
            onSaved={fetchConfig}
          />
        )}
```

- [ ] **Step 7: Verify the app in the browser**

Start both processes: `npm run dev` and `npm run dev:server` in separate terminals.
Open `http://localhost:3000`.

**Scenario A — keys already in .env:** App should load normally, show gear icon in header. Clicking gear should open the modal with masked previews as placeholders.

**Scenario B — test setup screen:** Temporarily rename `.env` to `.env.bak`, reload. App should show the SetupStep card. Fill in the form and submit — `.env` should be recreated and app should advance to the upload screen.

Restore `.env.bak` → `.env` after testing.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire config status check, SetupStep, and SettingsModal into App"
```

---

## Task 6: `package.json` + `start.command` launcher

**Files:**
- Modify: `package.json`
- Create: `start.command`

- [ ] **Step 1: Install `concurrently`**

```bash
npm install --save-dev concurrently
```

- [ ] **Step 2: Add `dev:all` script to `package.json`**

In the `"scripts"` section, add:
```json
"dev:all": "concurrently --names \"client,server\" --prefix-colors \"cyan,yellow\" \"npm run dev\" \"npm run dev:server\""
```

Verify it works: `npm run dev:all` — both Vite and tsx should start together with labeled output.

- [ ] **Step 3: Create `start.command`**

```bash
#!/bin/bash

BOLD='\033[1m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  printf "${BOLD}${RED}✖  Node.js is required to run this app.${RESET}\n"
  echo ""
  printf "${BOLD}Install it here  ➜  \e]8;;https://nodejs.org/en/download/current\e\\https://nodejs.org/en/download/current\e]8;;\e\\${RESET}\n"
  echo ""
  printf "${BOLD}Once installed, double-click start.command again.${RESET}\n"
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
  exit 0
fi

# cd to the directory containing this script
cd "$(dirname "$0")"

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
  printf "${BOLD}Installing dependencies (first run only)...${RESET}\n"
  npm install
  echo ""
fi

# Open browser after a short delay
(sleep 2 && open http://localhost:3000) &

printf "${BOLD}Starting Goozim Videos...${RESET}\n"
echo ""

npm run dev:all
```

- [ ] **Step 4: Make the script executable**

```bash
chmod +x start.command
```

- [ ] **Step 5: Test the launcher**

Double-click `start.command` in Finder. Terminal should open, install deps if needed, and open the browser. Verify the app loads at `http://localhost:3000`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json start.command
git commit -m "feat: add dev:all script and start.command Mac launcher"
```
