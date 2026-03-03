# Video to Reels AI - Local Setup Guide

This application allows you to process large videos (up to 2GB) using the Gemini 1.5 Pro model to generate transcriptions and reel recommendations.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- A Gemini API Key (Get one at [aistudio.google.com](https://aistudio.google.com/app/apikey))

## Installation

1. **Download the source code** from this project.
2. **Open your terminal** and navigate to the project directory.
3. **Install dependencies**:
   ```bash
   npm install
   ```

## Configuration

1. Create a `.env` file in the root directory (or rename `.env.example` to `.env`).
2. Add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   ```

## Running the App

1. **Start the development server**:
   ```bash
   npm run dev
   ```
2. **Open your browser** to `http://localhost:3000`.

## Handling Large Videos (> 0.5GB)

The app uses the **Gemini File API**, which supports video files up to **2GB**. 

### Tips for Large Files:
- **Browser Stability**: For files over 500MB, ensure you have a stable internet connection. The upload happens directly from your browser to Google's servers.
- **Processing Time**: Gemini needs time to "index" large videos after the upload completes. The app includes a polling mechanism that waits for the video to become `ACTIVE` before starting the analysis.
- **Timeout**: If your browser tab hibernates, the upload might fail. Keep the tab active during the upload process.

## Project Structure

- `src/App.tsx`: Main logic for file uploading and Gemini API calls.
- `src/components/`: UI components for the transcription and reels panels.
- `src/types.ts`: TypeScript interfaces for the data structures.
