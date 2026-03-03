import React, { useRef, useState } from 'react';
import { Upload, FileVideo, FileText, Loader2, AlertCircle, X, Globe } from 'lucide-react';
import { TranscriptionLine, TranscribeResponse, WordTimestamp } from '../types';

interface Props {
  onComplete: (data: {
    videoFile: File;
    transcription: TranscriptionLine[];
    summary: string;
    wordTimestamps?: WordTimestamp[];
  }) => void;
}

export function UploadStep({ onComplete }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState('');

  const videoInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!videoFile) {
      setError('Please upload a video file.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      setProcessingStatus(
        transcriptFile ? 'Processing transcript...' : 'Uploading and transcribing video...'
      );

      const formData = new FormData();
      formData.append('video', videoFile);
      if (transcriptFile) {
        formData.append('transcript', transcriptFile);
      }
      if (language) {
        formData.append('language', language);
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Server error: ${response.status}`);
      }

      const data = (await response.json()) as TranscribeResponse;
      onComplete({
        videoFile,
        transcription: data.transcription,
        summary: data.summary,
        wordTimestamps: data.wordTimestamps,
      });
    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message || 'An error occurred while processing.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  return (
    <div className="max-w-2xl w-full mx-auto mt-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h2 className="text-2xl font-semibold mb-2 text-center text-gray-900">
          Upload Your Video
        </h2>
        <p className="text-gray-500 text-center mb-8">
          Upload a video file and optionally provide an existing transcript to skip transcription.
        </p>

        <div className="space-y-6">
          {/* Video Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Video File <span className="text-rose-500">*</span>
            </label>
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                videoFile
                  ? 'border-indigo-500 bg-indigo-50/50'
                  : 'border-gray-300 hover:border-indigo-400 bg-gray-50'
              }`}
            >
              <input
                type="file"
                accept="video/*"
                className="hidden"
                ref={videoInputRef}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setVideoFile(e.target.files[0]);
                    setError(null);
                  }
                }}
              />
              {videoFile ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                    <FileVideo className="w-5 h-5 text-indigo-600" />
                  </div>
                  <p className="font-medium text-gray-900">{videoFile.name}</p>
                  <p className="text-sm text-gray-500">
                    {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  <button
                    onClick={() => setVideoFile(null)}
                    disabled={isProcessing}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:text-gray-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 bg-white rounded-full shadow-sm border border-gray-200 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="font-medium text-gray-900">Click to upload video</p>
                  <p className="text-sm text-gray-500">MP4, WebM, MOV</p>
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    className="mt-2 px-4 py-2 bg-white border border-gray-200 shadow-sm rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Select File
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Language Select — hidden when transcript is attached */}
          {!transcriptFile && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Globe className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                Transcription Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isProcessing}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">Auto-detect</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
                <option value="ar">Arabic</option>
                <option value="hi">Hindi</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
                <option value="ko">Korean</option>
                <option value="it">Italian</option>
                <option value="nl">Dutch</option>
                <option value="ru">Russian</option>
                <option value="tr">Turkish</option>
                <option value="pl">Polish</option>
                <option value="sv">Swedish</option>
                <option value="da">Danish</option>
                <option value="no">Norwegian</option>
                <option value="fi">Finnish</option>
                <option value="uk">Ukrainian</option>
                <option value="he">Hebrew</option>
              </select>
            </div>
          )}

          {/* Optional Transcript Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Existing Transcript{' '}
              <span className="text-gray-400 font-normal">(optional — skips transcription)</span>
            </label>
            <input
              type="file"
              accept=".json,.txt,.text"
              className="hidden"
              ref={transcriptInputRef}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setTranscriptFile(e.target.files[0]);
                }
              }}
            />
            {transcriptFile ? (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <FileText className="w-5 h-5 text-gray-500" />
                <span className="text-sm text-gray-700 flex-1">{transcriptFile.name}</span>
                <button
                  onClick={() => setTranscriptFile(null)}
                  disabled={isProcessing}
                  className="text-gray-400 hover:text-gray-600 disabled:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => transcriptInputRef.current?.click()}
                className="w-full p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
              >
                Upload .json or .txt transcript
              </button>
            )}
          </div>

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex gap-3 text-rose-700">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm leading-relaxed">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isProcessing || !videoFile}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {processingStatus}
              </>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
