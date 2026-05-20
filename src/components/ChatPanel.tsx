import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Sparkles, Download, Trash2, SendHorizonal, Square, Loader2, Check, RefreshCw } from 'lucide-react';
import { ChatMessage, ChatAction } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onClearChat: () => void;
  onAction?: (action: ChatAction) => Promise<void>;
  theme: 'light' | 'dark';
}

// Lightweight markdown: **bold**, `code`, - bullets, newlines
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^[-*]\s+/.test(line);
    const content = isBullet ? line.replace(/^[-*]\s+/, '') : line;

    // Inline formatting
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIdx) {
        parts.push(content.slice(lastIdx, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={`b-${i}-${match.index}`}>{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(
          <code key={`c-${i}-${match.index}`} className="px-1 py-0.5 rounded bg-black/10 text-[0.85em] font-mono">
            {match[3]}
          </code>
        );
      }
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < content.length) {
      parts.push(content.slice(lastIdx));
    }

    if (isBullet) {
      nodes.push(
        <div key={`line-${i}`} className="flex gap-1.5 ml-1">
          <span className="shrink-0">&#8226;</span>
          <span>{parts}</span>
        </div>
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={`line-${i}`} className="h-2" />);
    } else {
      nodes.push(
        <span key={`line-${i}`}>
          {parts}
          {i < lines.length - 1 && <br />}
        </span>
      );
    }
  }

  return nodes;
}

function extractReelIdeas(content: string): { title: string; fullBlock: string }[] {
  const ideas: { title: string; fullBlock: string }[] = [];
  const pattern = /\*{0,2}Reel Idea:\s*"(.+?)"\*{0,2}/g;
  let match: RegExpExecArray | null;
  const matches: { title: string; startIndex: number }[] = [];

  while ((match = pattern.exec(content)) !== null) {
    matches.push({ title: match[1], startIndex: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].startIndex;
    const end = i + 1 < matches.length ? matches[i + 1].startIndex : content.length;
    ideas.push({ title: matches[i].title, fullBlock: content.slice(start, end).trim() });
  }

  return ideas;
}

function extractModifyActions(content: string): { reelIndex: number; title: string; feedback: string }[] {
  const actions: { reelIndex: number; title: string; feedback: string }[] = [];
  const pattern = /\*{0,2}Modify Reel #(\d+):\s*"(.+?)"\*{0,2}/g;
  let match: RegExpExecArray | null;
  const matches: { reelIndex: number; title: string; startIndex: number }[] = [];

  while ((match = pattern.exec(content)) !== null) {
    matches.push({ reelIndex: parseInt(match[1], 10) - 1, title: match[2], startIndex: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].startIndex;
    const end = i + 1 < matches.length ? matches[i + 1].startIndex : content.length;
    const block = content.slice(start, end);
    const feedbackMatch = block.match(/Feedback:\s*(.+)/);
    actions.push({
      reelIndex: matches[i].reelIndex,
      title: matches[i].title,
      feedback: feedbackMatch?.[1]?.trim() || 'Improve this reel',
    });
  }

  return actions;
}

function extractDeleteActions(content: string): { reelIndex: number; title: string }[] {
  const actions: { reelIndex: number; title: string }[] = [];
  const pattern = /\*{0,2}Delete Reel #(\d+):\s*"(.+?)"\*{0,2}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    actions.push({ reelIndex: parseInt(match[1], 10) - 1, title: match[2] });
  }

  return actions;
}

const SUGGESTION_CHIPS = [
  { text: 'What are the key moments?', icon: '🎯' },
  { text: 'Suggest 3 new reel ideas', icon: '💡' },
  { text: 'Which part makes the best hook?', icon: '🪝' },
  { text: 'How can I improve my reels?', icon: '✨' },
  { text: 'Find the funniest moment', icon: '😂' },
  { text: 'Suggest a reel under 15 seconds', icon: '⚡' },
];

export function ChatPanel({
  messages,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onClearChat,
  onAction,
  theme,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [buttonStates, setButtonStates] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const isDark = theme === 'dark';

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput('');
  }, [input, isStreaming, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleActionClick = useCallback(async (key: string, action: ChatAction) => {
    if (!onAction || buttonStates[key] === 'loading') return;
    setButtonStates(prev => ({ ...prev, [key]: 'loading' }));
    try {
      await onAction(action);
      setButtonStates(prev => ({ ...prev, [key]: 'success' }));
      setTimeout(() => setButtonStates(prev => ({ ...prev, [key]: 'idle' })), 3000);
    } catch {
      setButtonStates(prev => ({ ...prev, [key]: 'error' }));
      setTimeout(() => setButtonStates(prev => ({ ...prev, [key]: 'idle' })), 3000);
    }
  }, [onAction, buttonStates]);

  const handleExport = () => {
    const md = messages
      .map((m) => `## ${m.role === 'user' ? 'User' : 'Assistant'}\n${m.content}\n\n---`)
      .join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brainstorm-notes.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${isDark ? 'bg-transparent' : 'bg-white'}`}>
      {/* Header */}
      <div className={`h-12 shrink-0 flex items-center justify-between px-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Goozim</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <>
              <button
                onClick={handleExport}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="Export as notes"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onClearChat}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="Clear chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 px-4">
            <div className={`text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="w-12 h-12 rounded-2xl mx-auto mb-3 overflow-hidden">
                <img src="/goozim-avatar.png" alt="Goozim" className="w-full h-full object-cover" />
              </div>
              <p className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Hey, I'm Goozim!
              </p>
              <p className="text-xs leading-relaxed max-w-[220px] mx-auto">
                I know your video inside and out. Ask me anything or pick a prompt below.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[260px]">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.text}
                  onClick={() => onSendMessage(chip.text)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    isDark
                      ? 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10 hover:border-white/20'
                      : 'bg-gray-50 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 border border-gray-200 hover:border-indigo-200'
                  }`}
                >
                  <span className="mr-2">{chip.icon}</span>
                  {chip.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const reelIdeas = !isUser && !msg.isStreaming ? extractReelIdeas(msg.content) : [];
            const modifyActions = !isUser && !msg.isStreaming ? extractModifyActions(msg.content) : [];
            const deleteActions = !isUser && !msg.isStreaming ? extractDeleteActions(msg.content) : [];
            const hasActions = reelIdeas.length > 0 || modifyActions.length > 0 || deleteActions.length > 0;

            return (
              <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start gap-1.5'}`}>
                {!isUser && (
                  <div className="w-5 h-5 rounded-full shrink-0 overflow-hidden mt-0.5">
                    <img src="/goozim-avatar.png" alt="Goozim" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className={`max-w-[80%] px-3 py-2 text-xs leading-relaxed ${
                  isUser
                    ? isDark
                      ? 'bg-indigo-600/40 text-white rounded-2xl rounded-br-md'
                      : 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
                    : isDark
                      ? 'bg-white/5 text-gray-200 rounded-2xl rounded-bl-md'
                      : 'bg-gray-50 text-gray-800 rounded-2xl rounded-bl-md'
                }`}>
                  <div>{renderMarkdown(msg.content)}</div>
                  {msg.isStreaming && (
                    <span className="inline-block w-0.5 h-3.5 bg-current ml-0.5 animate-pulse" />
                  )}
                  {hasActions && onAction && (
                    <div className={`mt-2 pt-2 flex flex-wrap gap-1.5 ${
                      isDark ? 'border-t border-white/10' : 'border-t border-gray-200'
                    }`}>
                      {/* Generate buttons */}
                      {reelIdeas.map((idea, idx) => {
                        const key = `${msg.id}-generate-${idx}`;
                        const state = buttonStates[key] || 'idle';
                        return (
                          <button
                            key={key}
                            onClick={() => handleActionClick(key, {
                              type: 'generate',
                              payload: { suggestion: idea.fullBlock, reelTitle: idea.title },
                            })}
                            disabled={state === 'loading'}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                              state === 'success'
                                ? 'bg-emerald-500/30 text-emerald-300'
                                : state === 'error'
                                  ? 'bg-red-500/30 text-red-300'
                                  : state === 'loading'
                                    ? isDark
                                      ? 'bg-indigo-500/20 text-indigo-400 cursor-not-allowed'
                                      : 'bg-indigo-50 text-indigo-400 cursor-not-allowed'
                                    : isDark
                                      ? 'bg-indigo-500/30 text-indigo-300 hover:bg-indigo-500/50'
                                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            }`}
                          >
                            {state === 'loading' ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : state === 'success' ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <Sparkles className="w-2.5 h-2.5" />
                            )}
                            {state === 'loading'
                              ? 'Generating...'
                              : state === 'success'
                                ? 'Created!'
                                : state === 'error'
                                  ? 'Failed'
                                  : `Generate "${idea.title.length > 25 ? idea.title.slice(0, 25) + '...' : idea.title}"`}
                          </button>
                        );
                      })}

                      {/* Modify buttons */}
                      {modifyActions.map((action, idx) => {
                        const key = `${msg.id}-modify-${idx}`;
                        const state = buttonStates[key] || 'idle';
                        return (
                          <button
                            key={key}
                            onClick={() => handleActionClick(key, {
                              type: 'modify',
                              payload: { reelIndex: action.reelIndex, feedback: action.feedback, reelTitle: action.title },
                            })}
                            disabled={state === 'loading'}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                              state === 'success'
                                ? 'bg-emerald-500/30 text-emerald-300'
                                : state === 'error'
                                  ? 'bg-red-500/30 text-red-300'
                                  : state === 'loading'
                                    ? isDark
                                      ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed'
                                      : 'bg-amber-50 text-amber-400 cursor-not-allowed'
                                    : isDark
                                      ? 'bg-amber-500/30 text-amber-300 hover:bg-amber-500/50'
                                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                            }`}
                          >
                            {state === 'loading' ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : state === 'success' ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <RefreshCw className="w-2.5 h-2.5" />
                            )}
                            {state === 'loading'
                              ? 'Modifying...'
                              : state === 'success'
                                ? 'Updated!'
                                : state === 'error'
                                  ? 'Failed'
                                  : `Modify "${action.title.length > 25 ? action.title.slice(0, 25) + '...' : action.title}"`}
                          </button>
                        );
                      })}

                      {/* Delete buttons */}
                      {deleteActions.map((action, idx) => {
                        const key = `${msg.id}-delete-${idx}`;
                        const state = buttonStates[key] || 'idle';
                        return (
                          <button
                            key={key}
                            onClick={() => handleActionClick(key, {
                              type: 'delete',
                              payload: { reelIndex: action.reelIndex, reelTitle: action.title },
                            })}
                            disabled={state === 'loading'}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                              state === 'success'
                                ? 'bg-emerald-500/30 text-emerald-300'
                                : state === 'error'
                                  ? 'bg-red-500/30 text-red-300'
                                  : state === 'loading'
                                    ? isDark
                                      ? 'bg-red-500/20 text-red-400 cursor-not-allowed'
                                      : 'bg-red-50 text-red-400 cursor-not-allowed'
                                    : isDark
                                      ? 'bg-red-500/30 text-red-300 hover:bg-red-500/50'
                                      : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {state === 'loading' ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : state === 'success' ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <Trash2 className="w-2.5 h-2.5" />
                            )}
                            {state === 'loading'
                              ? 'Deleting...'
                              : state === 'success'
                                ? 'Deleted!'
                                : state === 'error'
                                  ? 'Failed'
                                  : `Delete "${action.title.length > 25 ? action.title.slice(0, 25) + '...' : action.title}"`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className={`shrink-0 p-2 ${
        isDark ? 'border-t border-white/10' : 'border-t border-gray-100'
      }`}>
        <div className={`flex items-end gap-1.5 rounded-2xl px-2 py-1.5 ${
          isDark ? 'bg-white/8' : 'bg-gray-50 border border-gray-200'
        }`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your video..."
            rows={1}
            className={`flex-1 resize-none text-xs py-1 px-1 focus:outline-none bg-transparent ${
              isDark
                ? 'text-white placeholder-gray-500'
                : 'text-gray-900 placeholder-gray-400'
            }`}
            style={{ maxHeight: '96px' }}
          />
          {isStreaming ? (
            <button
              onClick={onStopStreaming}
              className="shrink-0 p-1.5 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
              title="Stop generating"
            >
              <Square className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                input.trim()
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : isDark
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-300 cursor-not-allowed'
              }`}
              title="Send message"
            >
              <SendHorizonal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
