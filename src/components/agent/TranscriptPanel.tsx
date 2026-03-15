'use client';

import { useRef, useEffect } from 'react';
import type { TranscriptEntry } from '@/hooks/useVegaEdgeSession';

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
  liveUserText?: string;
  streamingModelText?: string;
  isAgentThinking?: boolean;
}

export default function TranscriptPanel({
  transcript,
  liveUserText,
  streamingModelText,
  isAgentThinking,
}: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length, liveUserText, streamingModelText, isAgentThinking]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 flex flex-col">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
        Conversation
      </h3>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {transcript.length === 0 && !liveUserText && !isAgentThinking && (
          <p className="text-gray-500 text-sm">Start a conversation with VegaEdge...</p>
        )}

        {transcript.map((t, i) => (
          <div
            key={i}
            className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                t.role === 'user'
                  ? 'bg-[#00C805]/10 text-[#00C805]'
                  : 'bg-[#1E1E1E] text-gray-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{t.text}</p>
            </div>
            <span className="text-[10px] text-gray-600 mt-1 px-1">
              {t.role === 'user' ? 'You' : 'VegaEdge'} &middot;{' '}
              {t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {/* Agent thinking indicator (before streaming text arrives) */}
        {isAgentThinking && !streamingModelText && (
          <div className="flex flex-col items-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2.5 bg-[#1E1E1E] text-gray-400">
              <div className="flex items-center gap-2">
                <span className="text-sm">VegaEdge is thinking</span>
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out infinite' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out 0.2s infinite' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out 0.4s infinite' }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming model text (partial response) */}
        {streamingModelText && (
          <div className="flex flex-col items-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2.5 bg-[#1E1E1E] text-gray-200">
              <p className="text-sm whitespace-pre-wrap">
                {streamingModelText}
                <span
                  className="inline-block w-[2px] h-[14px] bg-gray-300 ml-0.5 align-middle"
                  style={{ animation: 'blink-cursor 1s step-end infinite' }}
                />
              </p>
            </div>
            <span className="text-[10px] text-gray-600 mt-1 px-1">
              VegaEdge &middot; streaming...
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes thinking-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
