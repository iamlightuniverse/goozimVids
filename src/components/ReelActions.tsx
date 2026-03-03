import React, { useState } from 'react';
import { Heart, MessageCircle, Share2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Reel, TranscriptionLine } from '../types';
import { ReelFeedback } from './ReelFeedback';

interface Props {
  reel: Reel;
  reelIndex: number;
  transcription: TranscriptionLine[];
  onReelUpdated?: (index: number, newReel: Reel) => void;
  isFavorited: boolean;
  onToggleFavorite: () => void;
}

export function ReelActions({ reel, reelIndex, transcription, onReelUpdated, isFavorited, onToggleFavorite }: Props) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleShare = async () => {
    const text = `${reel.title}\n${reel.description}`;
    try {
      await navigator.clipboard.writeText(text);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch {
      // Fallback: do nothing
    }
  };

  const handleRegenerate = async (
    feedback: string,
    config?: { duration?: number | 'auto'; customPrompt?: string },
  ) => {
    if (!onReelUpdated) return;
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/regenerate-reel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcription,
          originalReel: reel,
          feedback,
          config,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate reel.');
      }

      const data = await res.json();
      onReelUpdated(reelIndex, data.reel);
      setShowFeedback(false);
    } catch (err: any) {
      console.error('Regeneration failed:', err);
      alert(err.message || 'Failed to regenerate reel.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const buttons = [
    {
      icon: <Heart className={`w-6 h-6 ${isFavorited ? 'fill-red-500 text-red-500' : 'text-white'}`} />,
      label: 'Like',
      onClick: onToggleFavorite,
    },
    {
      icon: <MessageCircle className="w-6 h-6 text-white" />,
      label: 'Edit',
      onClick: () => setShowFeedback(true),
    },
    {
      icon: <Share2 className="w-6 h-6 text-white" />,
      label: 'Share',
      onClick: handleShare,
    },
  ];

  return (
    <>
      <div className="flex flex-col items-center gap-4">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.onClick}
            className="flex flex-col items-center gap-1 group"
          >
            <div className="w-10 h-10 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center group-hover:bg-black/50 transition-colors">
              {btn.icon}
            </div>
            <span className="text-[10px] text-white/80 font-medium">{btn.label}</span>
          </button>
        ))}
      </div>

      {/* Share toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-white/90 text-gray-900 text-sm font-medium shadow-lg backdrop-blur-sm"
          >
            Copied to clipboard!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback slide-up sheet */}
      <AnimatePresence>
        {showFeedback && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setShowFeedback(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto"
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-gray-900">Edit Reel</h3>
                  <button
                    onClick={() => setShowFeedback(false)}
                    className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
                <ReelFeedback
                  onRegenerate={handleRegenerate}
                  isRegenerating={isRegenerating}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
