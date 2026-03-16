'use client';

import { useRef, useEffect } from 'react';
import type { TranscriptEntry } from '@/hooks/useVegaEdgeSession';

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
  liveUserText?: string;
  streamingModelText?: string;
  isAgentThinking?: boolean;
  minimal?: boolean;
}

export default function TranscriptPanel({
  transcript,
  liveUserText,
  streamingModelText,
  isAgentThinking,
  minimal,
}: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length, liveUserText, streamingModelText, isAgentThinking]);

  const isEmpty = transcript.length === 0 && !liveUserText && !isAgentThinking && !streamingModelText;

  return (
    <div className="flex flex-col">
      <div className="space-y-3">
        {isEmpty && (
          <div className={`text-center ${minimal ? 'py-8' : 'py-12'}`}>
            <p className="text-gray-600 text-sm">
              {minimal ? 'Tap the mic to start talking' : 'Start a conversation with VegaEdge...'}
            </p>
          </div>
        )}

        {transcript.map((t, i) => (
          <div
            key={i}
            className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                t.role === 'user'
                  ? 'bg-[#00C805]/10 text-[#00C805]'
                  : 'bg-[#2D2D2D] text-gray-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{t.text}</p>
            </div>
            {!minimal && (
              <span className="text-[10px] text-gray-600 mt-1 px-1">
                {t.role === 'user' ? 'You' : 'VegaEdge'} &middot;{' '}
                {t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        ))}

        {/* Agent thinking indicator */}
        {isAgentThinking && !streamingModelText && (
          <div className="flex flex-col items-start">
            <div className="rounded-2xl px-4 py-3 bg-[#2D2D2D] text-gray-400">
              <div className="flex items-center gap-2">
                <span className="flex gap-1">
                  <span className="w-2 h-2 bg-[#00C805] rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out infinite' }} />
                  <span className="w-2 h-2 bg-[#00C805] rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out 0.2s infinite' }} />
                  <span className="w-2 h-2 bg-[#00C805] rounded-full" style={{ animation: 'thinking-dot 1.4s ease-in-out 0.4s infinite' }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming model text */}
        {streamingModelText && (
          <div className="flex flex-col items-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-[#2D2D2D] text-gray-200">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {streamingModelText}
                <span
                  className="inline-block w-[2px] h-[14px] bg-[#00C805] ml-0.5 align-middle"
                  style={{ animation: 'blink-cursor 1s step-end infinite' }}
                />
              </p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

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
