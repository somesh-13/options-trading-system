'use client';

import { useRef, useEffect } from 'react';
import type { TranscriptEntry } from '@/hooks/useVegaEdgeSession';

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
}

export default function TranscriptPanel({ transcript }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
        Transcript
      </h3>

      <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1">
        {transcript.length === 0 && (
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

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
