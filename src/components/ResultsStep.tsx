import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Play, MessageCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TranscriptionLine, Reel, WordTimestamp, CaptionStyle, ChatContext, ChatAction, VideoMetadata } from '../types';
import { ReelCard } from './ReelCard';
import { FeedView } from './FeedView';
import { ExportReelsButton } from './ExportReelsButton';
import { ChatPanel } from './ChatPanel';
import { useChatState } from '../hooks/useChatState';

interface Props {
  transcription: TranscriptionLine[];
  reels: Reel[];
  videoFile: File | null;
  videoUrl?: string | null;
  wordTimestamps?: WordTimestamp[];
  captionStyle?: CaptionStyle;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
  onBack: () => void;
  onStartOver: () => void;
  onReelsChange: (reels: Reel[]) => void;
  summary: string;
  videoOrientation?: 'horizontal' | 'vertical';
  sessionId?: string | null;
  videoMetadata?: VideoMetadata;
}

export function ResultsStep({
  transcription,
  reels,
  videoFile,
  videoUrl: videoUrlProp,
  wordTimestamps,
  captionStyle,
  onCaptionStyleChange,
  onBack,
  onStartOver,
  onReelsChange,
  summary,
  videoOrientation = 'vertical',
  sessionId,
  videoMetadata,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedActiveIndex, setFeedActiveIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Chat state
  const activeReelIndex = showFeed ? feedActiveIndex : currentIndex;
  const activeReelData = reels[activeReelIndex];
  const chatContext: ChatContext = {
    summary,
    transcription,
    reels: reels.map((r) => ({
      title: r.title,
      description: r.description,
      inTimestamp: r.segments[0]?.inTimestamp || '',
      outTimestamp: r.segments[r.segments.length - 1]?.outTimestamp || '',
    })),
    activeReel: activeReelData ? {
      index: activeReelIndex,
      title: activeReelData.title,
      description: activeReelData.description,
      inTimestamp: activeReelData.segments[0]?.inTimestamp || '',
      outTimestamp: activeReelData.segments[activeReelData.segments.length - 1]?.outTimestamp || '',
    } : undefined,
  };
  const { messages: chatMessages, isStreaming: isChatStreaming, sendMessage: onChatSend, stopStreaming: onChatStop, clearChat: onChatClear } = useChatState(chatContext);

  const handleChatAction = useCallback(async (action: ChatAction) => {
    switch (action.type) {
      case 'generate': {
        const suggestion = action.payload.suggestion || '';
        const titleMatch = suggestion.match(/Reel Idea:\s*"(.+?)"/);
        const hookMatch = suggestion.match(/Hook:\s*(.+)/);
        const whyMatch = suggestion.match(/Why it works:\s*(.+)/);
        const timestampMatch = suggestion.match(/Timestamps?:\s*(.+)/);

        const title = titleMatch?.[1] || 'Untitled';
        const hook = hookMatch?.[1]?.trim() || '';
        const why = whyMatch?.[1]?.trim() || '';
        const timestamps = timestampMatch?.[1]?.trim() || '';

        let cleanPrompt = `Generate exactly 1 reel based on this idea:\n`;
        cleanPrompt += `Title: "${title}"\n`;
        if (hook) cleanPrompt += `Desired hook/opening: ${hook}\n`;
        if (why) cleanPrompt += `Why this works: ${why}\n`;
        if (timestamps) cleanPrompt += `Approximate location in transcript: ${timestamps} (use as a guide — find the actual best IN/OUT points from the transcript text)\n`;
        cleanPrompt += `\nFind the best matching content in the transcript. Ensure the reel starts with a strong hook and ends with a complete thought.`;

        const res = await fetch('/api/generate-reels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcription,
            mode: 'custom',
            customPrompt: cleanPrompt,
          }),
        });
        if (!res.ok) throw new Error('Failed to generate reel.');

        // Endpoint returns SSE stream — read until 'complete' event
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let generatedReels: Reel[] | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6));
            if (event.phase === 'complete' && event.reels) {
              generatedReels = event.reels;
            } else if (event.phase === 'error') {
              throw new Error(event.message || 'Generation failed.');
            }
          }
        }

        if (generatedReels?.length) {
          onReelsChange([...reels, ...generatedReels]);
        }
        break;
      }
      case 'modify': {
        const { reelIndex, feedback } = action.payload;
        if (reelIndex == null || reelIndex < 0 || reelIndex >= reels.length) {
          throw new Error(`Invalid reel index: ${(reelIndex ?? -1) + 1}`);
        }
        const res = await fetch('/api/regenerate-reel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcription,
            originalReel: reels[reelIndex],
            feedback: feedback || 'Improve this reel',
          }),
        });
        if (!res.ok) throw new Error('Failed to modify reel.');
        const data = await res.json();
        if (data.reel) {
          const updated = [...reels];
          updated[reelIndex] = data.reel;
          onReelsChange(updated);
        }
        break;
      }
      case 'delete': {
        const { reelIndex } = action.payload;
        if (reelIndex == null || reelIndex < 0 || reelIndex >= reels.length) {
          throw new Error(`Invalid reel index: ${(reelIndex ?? -1) + 1}`);
        }
        onReelsChange(reels.filter((_, i) => i !== reelIndex));
        break;
      }
    }
  }, [transcription, reels, onReelsChange]);

  useEffect(() => {
    if (videoUrlProp) {
      setVideoUrl(videoUrlProp);
      return;
    }
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile, videoUrlProp]);

  // Pre-render all reels in the background when the results page first loads
  useEffect(() => {
    if (!sessionId || !reels.length) return;
    reels.forEach((reel) => {
      fetch(`/api/sessions/${sessionId}/prerender`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: reel.segments,
          orientation: videoOrientation,
          burnSubtitles: false,
          subtitleOverrides: reel.subtitleOverrides,
          wordTimestamps,
        }),
      }).catch(() => {});
    });
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const goToPrev = () => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : reels.length - 1));
  };

  const goToNext = () => {
    setCurrentIndex((i) => (i < reels.length - 1 ? i + 1 : 0));
  };

  const handleReelUpdated = (newReel: Reel) => {
    const updated = [...reels];
    updated[currentIndex] = newReel;
    onReelsChange(updated);
  };

  const [showTranscriptDropdown, setShowTranscriptDropdown] = useState(false);
  const transcriptDropdownRef = useRef<HTMLDivElement>(null);

  // Close transcript dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (transcriptDropdownRef.current && !transcriptDropdownRef.current.contains(e.target as Node)) {
        setShowTranscriptDropdown(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleDownloadTranscriptTxt = () => {
    const text = transcription.map((t) => `[${t.timestamp}] ${t.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    a.click();
    URL.revokeObjectURL(url);
    setShowTranscriptDropdown(false);
  };

  const handleDownloadTranscriptJson = () => {
    const data = {
      transcription,
      wordTimestamps: wordTimestamps || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.json';
    a.click();
    URL.revokeObjectURL(url);
    setShowTranscriptDropdown(false);
  };

  const toggleCaptions = () => setCaptionsEnabled((v) => !v);

  if (reels.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">No reels generated.</p>
      </div>
    );
  }

  const currentReel = reels[currentIndex];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header bar */}
      <div className="flex items-center justify-between py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <button
            onClick={() => setShowFeed(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Feed
          </button>

          <button
            onClick={() => setShowChat(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Brainstorm
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={transcriptDropdownRef}>
            <button
              onClick={() => setShowTranscriptDropdown((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Transcript
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
            {showTranscriptDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                <button
                  onClick={handleDownloadTranscriptTxt}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  Plain Text (.txt)
                </button>
                <button
                  onClick={handleDownloadTranscriptJson}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  JSON with Word Timestamps (.json)
                </button>
              </div>
            )}
          </div>
          <ExportReelsButton reels={reels} />
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-center gap-4 py-3 shrink-0">
        <button
          onClick={goToPrev}
          className="p-2 rounded-full bg-white border border-gray-300 hover:bg-gray-50 shadow-sm transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </button>

        {/* Reel counter + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-900">
              {currentIndex + 1} / {reels.length}
            </span>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </button>

          {showDropdown && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-72 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg z-20">
              {reels.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setCurrentIndex(i);
                    setShowDropdown(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 ${
                    i === currentIndex ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  <span className="text-xs text-gray-400 mr-2">{i + 1}.</span>
                  {r.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={goToNext}
          className="p-2 rounded-full bg-white border border-gray-300 hover:bg-gray-50 shadow-sm transition-colors"
        >
          <ArrowRight className="w-5 h-5 text-gray-700" />
        </button>
      </div>

      {/* Single reel card */}
      <div className="flex-1 overflow-y-auto pb-6 max-w-6xl mx-auto w-full" key={currentIndex}>
        <ReelCard
          reel={currentReel}
          videoUrl={videoUrl}
          transcription={transcription}
          wordTimestamps={wordTimestamps}
          captionsEnabled={captionsEnabled}
          onToggleCaptions={toggleCaptions}
          captionStyle={captionStyle}
          onCaptionStyleChange={onCaptionStyleChange}
          onReelUpdated={handleReelUpdated}
          videoOrientation={videoOrientation}
          sessionId={sessionId}
        />
      </div>

      {/* Feed overlay */}
      {showFeed && (
        <FeedView
          reels={reels}
          videoUrl={videoUrl}
          transcription={transcription}
          wordTimestamps={wordTimestamps}
          captionsEnabled={captionsEnabled}
          onToggleCaptions={toggleCaptions}
          captionStyle={captionStyle}
          onCaptionStyleChange={onCaptionStyleChange}
          onClose={() => setShowFeed(false)}
          onActiveIndexChange={setFeedActiveIndex}
          onReelUpdated={(index, newReel) => {
            const updated = [...reels];
            updated[index] = newReel;
            onReelsChange(updated);
          }}
          onGenerateMore={(newReels) => onReelsChange([...reels, ...newReels])}
          summary={summary}
          chatMessages={chatMessages}
          isChatStreaming={isChatStreaming}
          onChatSend={onChatSend}
          onChatStop={onChatStop}
          onChatClear={onChatClear}
          onAction={handleChatAction}
        />
      )}

      {/* Slide-in chat panel */}
      <AnimatePresence>
        {showChat && !showFeed && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-30"
              onClick={() => setShowChat(false)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed top-0 right-0 w-96 h-full z-30 bg-white shadow-2xl flex flex-col"
            >
              <button
                onClick={() => setShowChat(false)}
                className="absolute top-3 right-3 z-10 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <ChatPanel
                messages={chatMessages}
                isStreaming={isChatStreaming}
                onSendMessage={onChatSend}
                onStopStreaming={onChatStop}
                onClearChat={onChatClear}
                onAction={handleChatAction}
                theme="light"
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
