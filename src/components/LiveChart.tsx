'use client';

import { useState } from 'react';
import type { ChartHistoryEntry } from '@/hooks/useVegaEdgeSession';

interface LiveChartProps {
  data: string | null;
  ticker?: string;
  caption?: string;
  history?: ChartHistoryEntry[];
}

export default function LiveChart({ data, ticker = '', caption, history }: LiveChartProps) {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const hasHistory = history && history.length > 1;
  const viewing = historyIndex != null && history ? history[historyIndex] : null;
  const displayData = viewing ? viewing.data : data;
  const displayTicker = viewing ? viewing.ticker : ticker;
  const displayTimestamp = viewing ? viewing.timestamp : null;

  const goTo = (idx: number) => {
    if (!history) return;
    if (idx < 0 || idx >= history.length) {
      setHistoryIndex(null);
      return;
    }
    setHistoryIndex(idx);
  };

  if (!displayData) {
    return (
      <div className="w-full aspect-video bg-[#2D2D2D] rounded-lg flex items-center justify-center text-gray-500">
        Chart will appear when the agent generates one
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg overflow-hidden bg-[#2D2D2D]">
      {/* Main chart */}
      <div className="relative">
        <img
          src={`data:image/png;base64,${displayData}`}
          alt={displayTicker ? `Keltner chart for ${displayTicker}` : 'Chart'}
          className="w-full h-auto max-h-[500px] object-contain"
        />

        {/* Navigation arrows */}
        {hasHistory && (
          <>
            <button
              type="button"
              onClick={() => goTo(historyIndex != null ? historyIndex - 1 : history!.length - 2)}
              disabled={historyIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed rounded-full flex items-center justify-center text-white transition-colors"
            >
              &#8249;
            </button>
            <button
              type="button"
              onClick={() => goTo(historyIndex != null ? historyIndex + 1 : history!.length)}
              disabled={historyIndex == null}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed rounded-full flex items-center justify-center text-white transition-colors"
            >
              &#8250;
            </button>
          </>
        )}
      </div>

      {/* Caption + timestamp */}
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-sm text-gray-400">
          {caption ?? (displayTicker ? `${displayTicker} – Keltner channel` : '')}
        </p>
        {displayTimestamp && (
          <span className="text-xs text-gray-600">
            {displayTimestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* History thumbnails */}
      {hasHistory && (
        <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
          {history!.map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i === history!.length - 1 && historyIndex == null ? history!.length : i)}
              className={`flex-shrink-0 w-16 h-10 rounded border overflow-hidden transition-all ${
                (historyIndex === i || (historyIndex == null && i === history!.length - 1))
                  ? 'border-[#00C805] ring-1 ring-[#00C805]'
                  : 'border-gray-600 hover:border-gray-400 opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={`data:image/png;base64,${h.data}`}
                alt={h.ticker}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Dot indicators */}
      {hasHistory && (
        <div className="flex justify-center gap-1 pb-2">
          {history!.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                (historyIndex === i || (historyIndex == null && i === history!.length - 1))
                  ? 'bg-[#00C805]'
                  : 'bg-gray-600'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
