import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, ChevronUp, Heart, Download, Loader2, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Reel, TranscriptionLine, WordTimestamp, CaptionStyle, ChatMessage, ChatAction } from '../types';
import { ReelPlayer, ReelPlayerHandle } from './ReelPlayer';
import { CaptionControls } from './CaptionControls';
import { ReelActions } from './ReelActions';
import { ChatPanel } from './ChatPanel';

interface Props {
  reels: Reel[];
  videoUrl: string | null;
  transcription: TranscriptionLine[];
  wordTimestamps?: WordTimestamp[];
  captionsEnabled: boolean;
  onToggleCaptions: () => void;
  captionStyle?: CaptionStyle;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
  onClose: () => void;
  onReelUpdated?: (index: number, newReel: Reel) => void;
  onGenerateMore?: (newReels: Reel[]) => void;
  summary?: string;
  chatMessages?: ChatMessage[];
  isChatStreaming?: boolean;
  onChatSend?: (text: string) => void;
  onChatStop?: () => void;
  onChatClear?: () => void;
  onAction?: (action: ChatAction) => Promise<void>;
  onActiveIndexChange?: (index: number) => void;
}

export function FeedView({
  reels,
  videoUrl,
  transcription,
  wordTimestamps,
  captionsEnabled,
  onToggleCaptions,
  captionStyle,
  onCaptionStyleChange,
  onClose,
  onReelUpdated,
  onGenerateMore,
  summary,
  chatMessages,
  isChatStreaming,
  onChatSend,
  onChatStop,
  onChatClear,
  onAction,
  onActiveIndexChange,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const playerRefs = useRef<(ReelPlayerHandle | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [expandedOverlay, setExpandedOverlay] = useState<number | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const prevReelsLength = useRef(reels.length);

  const [sideTab, setSideTab] = useState<'details' | 'brainstorm'>('details');

  // Generate more state
  const [genTab, setGenTab] = useState<'prompt' | 'quick'>('prompt');
  const [genPrompt, setGenPrompt] = useState('');
  const [genCount, setGenCount] = useState(3);
  const [genDuration, setGenDuration] = useState<number | 'auto'>('auto');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Collapse overlay when scrolling to new reel
  useEffect(() => {
    setExpandedOverlay(null);
  }, [activeIndex]);

  // Swipe hint on first load
  useEffect(() => {
    if (reels.length > 1) {
      setShowSwipeHint(true);
      const timer = setTimeout(() => setShowSwipeHint(false), 2500);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss swipe hint on first scroll
  useEffect(() => {
    if (!showSwipeHint) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const dismiss = () => setShowSwipeHint(false);
    container.addEventListener('scroll', dismiss, { once: true });
    return () => container.removeEventListener('scroll', dismiss);
  }, [showSwipeHint]);

  // Auto-scroll to first new reel when reels are appended
  useEffect(() => {
    if (reels.length > prevReelsLength.current) {
      const firstNewIndex = prevReelsLength.current;
      prevReelsLength.current = reels.length;
      // Wait for DOM to update
      requestAnimationFrame(() => {
        scrollToReel(firstNewIndex);
      });
    } else {
      prevReelsLength.current = reels.length;
    }
  }, [reels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver for active reel detection
  useEffect(() => {
    const cards = cardRefs.current;
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idx = cards.indexOf(entry.target as HTMLDivElement);
            if (idx !== -1) {
              setActiveIndex(idx);
              onActiveIndexChange?.(idx);
            }
          }
        }
      },
      { threshold: 0.6 },
    );

    cards.forEach((card) => {
      if (card) observer.observe(card);
    });

    return () => observer.disconnect();
  }, [reels.length]);

  const scrollToReel = useCallback((index: number) => {
    const card = cardRefs.current[index];
    if (card) {
      card.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const toggleFavorite = useCallback((index: number) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleExportFavorites = useCallback(() => {
    const favReels = reels.filter((_, i) => favorites.has(i));
    const data = JSON.stringify(favReels, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'favorite-reels.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [reels, favorites]);

  const handleGenerateMore = useCallback(async () => {
    if (!onGenerateMore) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const body: any = { transcription };
      if (genTab === 'prompt') {
        body.mode = 'custom';
        body.customPrompt = genPrompt || 'Generate more reels from this transcript';
      } else {
        body.mode = 'guided';
        body.guided = { numberOfReels: genCount, duration: genDuration };
      }
      const res = await fetch('/api/generate-reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate reels.');
      }
      const data = await res.json();
      onGenerateMore(data.reels);
      setGenPrompt('');
    } catch (err: any) {
      setGenError(err.message || 'Generation failed.');
    } finally {
      setIsGenerating(false);
    }
  }, [onGenerateMore, transcription, genTab, genPrompt, genCount, genDuration]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(activeIndex + 1, reels.length - 1);
          scrollToReel(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(activeIndex - 1, 0);
          scrollToReel(prev);
          break;
        }
        case ' ': {
          e.preventDefault();
          playerRefs.current[activeIndex]?.togglePlayPause();
          break;
        }
        case 'm':
        case 'M': {
          e.preventDefault();
          setIsMuted((v) => !v);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          onClose();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, reels.length, scrollToReel, onClose]);

  if (!videoUrl) {
    return null;
  }

  const activeReel = reels[activeIndex];
  const favoritedReels = reels
    .map((r, i) => ({ reel: r, index: i }))
    .filter(({ index }) => favorites.has(index));

  return (
    <div className="fixed inset-0 z-40 bg-black flex">
      {/* Main scroll area — scroll snap on the outer container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-scroll hide-scrollbar"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {reels.map((reel, i) => (
          <div
            key={i}
            ref={(el) => { cardRefs.current[i] = el; }}
            className="h-screen flex items-center justify-center"
            style={{ scrollSnapAlign: 'start' }}
          >
            {/* Centering flex parent */}
            <div className="relative flex items-center justify-center h-full">
              {/* Aspect-ratio constrained container */}
              <div className="relative w-full max-w-sm mx-auto max-h-full" style={{ aspectRatio: '9/16' }}>
                {/* Video — fills the card */}
                <ReelPlayer
                  ref={(el) => { playerRefs.current[i] = el; }}
                  videoUrl={videoUrl}
                  segments={reel.segments}
                  transcription={transcription}
                  wordTimestamps={wordTimestamps}
                  captionsEnabled={captionsEnabled}
                  captionStyle={captionStyle}
                  isActive={i === activeIndex}
                  fillScreen
                  showSegmentCounter={false}
                  isMuted={isMuted}
                  onMuteToggle={() => setIsMuted((v) => !v)}
                />

                {/* Bottom gradient for text readability */}
                <motion.div
                  className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent z-[4] pointer-events-none"
                  animate={{ height: expandedOverlay === i ? '12rem' : '8rem' }}
                  transition={{ duration: 0.2 }}
                />

                {/* Title/description overlay (TikTok-style) */}
                <div
                  className="absolute bottom-4 left-4 right-16 z-[8] cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedOverlay(expandedOverlay === i ? null : i);
                  }}
                >
                  <h3
                    className="text-base font-bold text-white leading-tight"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)' }}
                  >
                    {reel.title}
                  </h3>
                  <p
                    className={`text-xs text-white/80 mt-1 ${expandedOverlay === i ? '' : 'line-clamp-2'}`}
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
                  >
                    {reel.description}
                  </p>
                </div>

                {/* Action buttons — right side */}
                <div className="absolute right-3 bottom-24 z-10 md:right-3 md:bottom-24 lg:-right-14 lg:bottom-1/4">
                  <ReelActions
                    reel={reel}
                    reelIndex={i}
                    transcription={transcription}
                    onReelUpdated={onReelUpdated}
                    isFavorited={favorites.has(i)}
                    onToggleFavorite={() => toggleFavorite(i)}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Fixed caption controls at bottom of screen, outside scroll */}
      <div className="absolute bottom-6 left-0 right-0 z-50 flex justify-center pointer-events-none lg:right-80">
        <div className="pointer-events-auto">
          <CaptionControls
            captionsEnabled={captionsEnabled}
            onToggleCaptions={onToggleCaptions}
            captionStyle={captionStyle}
            onCaptionStyleChange={onCaptionStyleChange}
          />
        </div>
      </div>

      {/* Swipe hint overlay */}
      <AnimatePresence>
        {showSwipeHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-[45] flex items-end justify-center pb-32 pointer-events-none lg:right-80"
          >
            <motion.div
              className="flex flex-col items-center gap-2 text-white/80"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              <ChevronUp className="w-6 h-6" />
              <span className="text-sm font-medium">Swipe up for next reel</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side panel — desktop only */}
      <div className="hidden lg:flex w-80 bg-gray-900/80 backdrop-blur-md flex-col border-l border-white/10">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          {/* Tab toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setSideTab('details')}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                sideTab === 'details'
                  ? 'bg-white/15 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setSideTab('brainstorm')}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                sideTab === 'brainstorm'
                  ? 'bg-indigo-600/40 text-indigo-300'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Brainstorm
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {sideTab === 'brainstorm' && onChatSend ? (
          <ChatPanel
            messages={chatMessages || []}
            isStreaming={isChatStreaming || false}
            onSendMessage={onChatSend}
            onStopStreaming={onChatStop || (() => {})}
            onClearChat={onChatClear || (() => {})}
            onAction={onAction}
            theme="dark"
          />
        ) : (
          <>
            {/* Active reel info */}
            {activeReel && (
              <div className="p-4 border-b border-white/10 space-y-3">
                <h3 className="text-white font-bold text-sm leading-tight">{activeReel.title}</h3>
                <p className="text-gray-400 text-xs leading-relaxed">{activeReel.description}</p>
                {activeReel.segments.map((seg, j) => (
                  <div key={j} className="text-xs space-y-1">
                    <div className="flex gap-2">
                      <span className="font-mono text-emerald-400">IN</span>
                      <span className="text-gray-300">{seg.inTimestamp}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="font-mono text-rose-400">OUT</span>
                      <span className="text-gray-300">{seg.outTimestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scrollable section: reel list + favorites + generate more */}
            <div className="flex-1 overflow-y-auto hide-scrollbar">
              {/* Reel list */}
              <div className="p-2">
                {reels.map((reel, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToReel(i)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      i === activeIndex
                        ? 'bg-indigo-600/30 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="text-xs text-gray-500 w-5 shrink-0">{i + 1}.</span>
                    <span className="truncate flex-1">{reel.title}</span>
                    {favorites.has(i) && <Heart className="w-3 h-3 shrink-0 fill-red-500 text-red-500" />}
                    {i === activeIndex && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-indigo-400" />}
                  </button>
                ))}
              </div>

              {/* Favorites section */}
              {favoritedReels.length > 0 && (
                <div className="border-t border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Favorites ({favoritedReels.length})
                    </h3>
                    <button
                      onClick={handleExportFavorites}
                      className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Export
                    </button>
                  </div>
                  <div className="space-y-1">
                    {favoritedReels.map(({ reel, index }) => (
                      <button
                        key={index}
                        onClick={() => scrollToReel(index)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                      >
                        <Heart className="w-3 h-3 shrink-0 fill-red-500 text-red-500" />
                        <span className="truncate">{reel.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Generate More section */}
              {onGenerateMore && (
                <div className="border-t border-white/10 p-3">
                  <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    Generate More
                  </h3>

                  {/* Tabs */}
                  <div className="flex gap-1 mb-3">
                    <button
                      onClick={() => setGenTab('prompt')}
                      className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                        genTab === 'prompt'
                          ? 'bg-indigo-600/40 text-indigo-300'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      Free Prompt
                    </button>
                    <button
                      onClick={() => setGenTab('quick')}
                      className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                        genTab === 'quick'
                          ? 'bg-indigo-600/40 text-indigo-300'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      Quick
                    </button>
                  </div>

                  {genTab === 'prompt' ? (
                    <textarea
                      value={genPrompt}
                      onChange={(e) => setGenPrompt(e.target.value)}
                      placeholder="e.g. Find funny moments, focus on tips..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 p-2 resize-none h-20 focus:outline-none focus:border-indigo-500/50"
                    />
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Count</label>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              onClick={() => setGenCount(n)}
                              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                                genCount === n
                                  ? 'bg-indigo-600/40 text-indigo-300'
                                  : 'bg-white/5 text-gray-400 hover:text-white'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Duration</label>
                        <div className="flex gap-1">
                          {([15, 30, 45, 60, 'auto'] as const).map((d) => (
                            <button
                              key={String(d)}
                              onClick={() => setGenDuration(d)}
                              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                                genDuration === d
                                  ? 'bg-indigo-600/40 text-indigo-300'
                                  : 'bg-white/5 text-gray-400 hover:text-white'
                              }`}
                            >
                              {d === 'auto' ? 'Auto' : `${d}s`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {genError && (
                    <p className="text-xs text-red-400 mt-2">{genError}</p>
                  )}

                  <button
                    onClick={handleGenerateMore}
                    disabled={isGenerating}
                    className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        Generate
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Mobile close button */}
      <button
        onClick={onClose}
        className="lg:hidden absolute top-4 right-4 z-50 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
