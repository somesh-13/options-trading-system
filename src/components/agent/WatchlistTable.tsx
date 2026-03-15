'use client';

import type { WatchlistEntry } from '@/hooks/useVegaEdgeSession';

interface WatchlistTableProps {
  data: WatchlistEntry[] | null;
  summary: string | null;
}

function ratioColor(ratio?: number): string {
  if (ratio == null) return 'text-gray-400';
  if (ratio < 0.8) return 'text-[#00C805]';
  if (ratio > 1.3) return 'text-[#FF006E]';
  return 'text-gray-200';
}

function signalPill(signal: string) {
  const color =
    signal === 'BUY' ? 'bg-[#00C805]/20 text-[#00C805]'
    : signal === 'SELL' ? 'bg-[#FF006E]/20 text-[#FF006E]'
    : 'bg-gray-500/20 text-gray-400';
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{signal}</span>;
}

export default function WatchlistTable({ data, summary }: WatchlistTableProps) {
  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-[#FFD700] uppercase tracking-wider mb-3">
        Watchlist Overview
      </h3>

      {!data ? (
        <p className="text-gray-500 text-sm">Run a watchlist scan to see overview</p>
      ) : (
        <>
          {summary && <p className="text-sm text-gray-400 mb-3">{summary}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 pr-4">Ticker</th>
                  <th className="text-left py-2 pr-4">Signal</th>
                  <th className="text-right py-2 pr-4">IV/HV</th>
                  <th className="text-right py-2">Spot Price</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-[#1E1E1E] transition-colors">
                    <td className="py-2 pr-4 font-mono font-bold text-gray-200">{row.ticker}</td>
                    <td className="py-2 pr-4">{signalPill(row.signal)}</td>
                    <td className={`py-2 pr-4 text-right font-mono ${ratioColor(row.iv_hv_ratio)}`}>
                      {row.iv_hv_ratio != null ? row.iv_hv_ratio.toFixed(2) : '—'}
                    </td>
                    <td className="py-2 text-right text-gray-300">
                      {row.spot_price != null ? `$${row.spot_price.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
