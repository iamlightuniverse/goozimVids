# Autoreel

Upload a video, get a full transcript, and let AI pick the best clips to turn into reels.

## What it does

1. **Upload** a video or audio file
2. **Transcribe** it automatically
3. **Review** an AI-generated summary
4. **Generate** reel suggestions with in/out timestamps
5. **Export** the clips

## Running it

Double-click `start.command` (Mac only).

- First run: installs dependencies automatically
- Opens the app at `http://localhost:3000`
- If Node.js isn't installed, it will tell you where to get it

## Setup

On first launch you'll be asked for two API keys:

**OpenRouter** — powers the AI (reel generation, summaries, chat)
Get a key at [openrouter.ai](https://openrouter.ai) → Keys

**Soniox** — handles transcription
Get a key at [soniox.com](https://soniox.com) → API Keys

Both have free tiers. Keys are saved locally to a `.env` file on your machine and never leave it.
