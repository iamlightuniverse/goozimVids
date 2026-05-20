# Onboarding & Mac Launcher Design

**Date:** 2026-05-20
**Status:** Approved

## Overview

Add a first-run onboarding screen that collects API keys and writes a `.env` file, a settings modal accessible from the header for changing keys later, and a double-clickable Mac launcher (`start.command`) that handles prerequisites and starts both client and server.

---

## 1. Server: Config Endpoints

### `GET /api/config/status`

Reads the current `.env` file (if it exists) and returns the configuration state.

**Response:**
```json
{
  "hasOpenRouter": true,
  "hasGemini": false,
  "sttProvider": "soniox",
  "hasSttKey": true,
  "isConfigured": false,
  "openRouterPreview": "••••3730",
  "geminiPreview": null,
  "sttKeyPreview": "••••9bc"
}
```

Preview fields are `null` when the key is absent. The last 4 characters of each key are exposed; the rest is masked with `••••`.

`isConfigured` is `true` only when `hasOpenRouter`, `hasGemini`, and `hasSttKey` are all `true`.

### `POST /api/config/save`

Accepts API key values and writes them to `.env` in the project root. Also reloads the relevant `process.env` values in memory so no server restart is needed.

**Request body:**
```json
{
  "openRouterKey": "sk-or-...",
  "geminiKey": "AIza...",
  "sttProvider": "soniox",
  "sttKey": "..."
}
```

**Behaviour:**
- Writes (or overwrites) `.env` preserving any existing keys not covered by the form
- Updates `process.env.OPENROUTER_API_KEY`, `process.env.GEMINI_API_KEY`, `process.env.STT_PROVIDER`, and the relevant STT key in memory
- Returns `{ ok: true }` on success, or `{ ok: false, error: string }` on failure

---

## 2. Client: Setup Flow

### App-level detection

`App.tsx` calls `GET /api/config/status` on mount. While loading, show a minimal spinner. If `isConfigured` is `false`, render `<SetupStep>` instead of `<UploadStep>`. Once the user saves, re-fetch status and advance to `<UploadStep>`.

### `SetupStep` component

Full-screen form that matches the app's existing visual style (white card, Tailwind, same header/footer layout).

Fields:
- **OpenRouter API key** — text input, required
- **Gemini API key** — text input, required
- **STT provider** — dropdown: `deepgram | soniox | elevenlabs`
- **STT API key** — single text input whose label changes based on the selected provider; only shown when a provider is selected

On submit: POST to `/api/config/save`. On success: re-fetch `/api/config/status` and proceed. On error: show inline error message.

### `SettingsModal` component

Triggered by a gear icon added to the right side of the existing app header (always visible, not just during onboarding).

Reuses the same form fields as `SetupStep`, pre-filled with masked values from the `*Preview` fields in the status endpoint response (e.g. `••••3730`). Saving does the same POST and closes the modal. No step navigation change on save from here.

---

## 3. Mac Launcher (`start.command`)

A shell script placed in the project root. On macOS, files with the `.command` extension and execute permissions open in Terminal.app when double-clicked.

### Script behaviour

1. **Check for Node.js.** If `node` is not found on PATH:
   - Print a bold, coloured message using ANSI escape codes
   - Include the install URL as an OSC 8 clickable hyperlink
   - Exit cleanly (no error code noise)

   Terminal output:
   ```
   ✖  Node.js is required to run this app.

   Install it here  ➜  https://nodejs.org/en/download/current

   Once installed, double-click start.command again.
   ```
   The URL is wrapped in an OSC 8 hyperlink so it is clickable in Terminal.app and iTerm2.

2. **`cd` to the script's own directory** using `$(dirname "$0")` so the script works regardless of where it is saved or launched from.

3. **Run `npm install`** only if `node_modules` does not exist (skip on subsequent launches to keep startup fast).

4. **Start both processes** via `npm run dev:all`.

5. **Open the browser** at `http://localhost:3000` after a 2-second delay (`sleep 2 && open http://localhost:3000 &`).

### `package.json` changes

Add `concurrently` as a dev dependency and a new script:
```json
"dev:all": "concurrently \"npm run dev\" \"npm run dev:server\""
```

---

## 4. File Checklist

| File | Change |
|---|---|
| `server.ts` | Add `GET /api/config/status` and `POST /api/config/save` endpoints |
| `src/App.tsx` | Add config status check on mount; conditionally render `SetupStep`; add gear icon to header |
| `src/components/SetupStep.tsx` | New component — full-screen onboarding form |
| `src/components/SettingsModal.tsx` | New component — modal wrapping the same form, opened from gear icon |
| `src/components/ApiKeyForm.tsx` | Shared form fields used by both `SetupStep` and `SettingsModal` |
| `package.json` | Add `concurrently` dev dep; add `dev:all` script |
| `start.command` | New launcher script in project root |

---

## 5. Out of Scope

- Windows/Linux launcher (deferred)
- Validating API keys against the provider APIs (just save what the user enters)
- Auto-installing Node.js (user is directed to nodejs.org instead)
