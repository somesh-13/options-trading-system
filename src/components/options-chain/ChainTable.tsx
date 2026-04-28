'use client';

import { parseOCC } from '@/lib/utils';

export interface ChainRow {
  occ: string;
  strike: number;
  type: string;
  bid: number;
  ask: number;
  last: number;
  iv: number;
  delta: number;
  volume: number;
}

interface ChainTableProps {
  rows: ChainRow[];
  optionType: 'call' | 'put';
  side: 'buy' | 'sell';
  onSelect: (occ: string, price: number) => void;
  spotPrice?: number;
}

// Delta targets per roadmap §6 — CSP -0.30, CC +0.30, LEAP +0.70
const DELTA_TARGETS: Record<'call' | 'put', Array<{ target: number; label: string }>> = {
  call: [
    { target: 0.3, label: 'CC' },
    { target: 0.7, label: 'LEAP' },
  ],
  put: [{ target: -0.3, label: 'CSP' }],
};

function _ivHeat(percentile: number): string {
  // Green (low IV, cheap) → Red (high IV, expensive). percentile ∈ [0, 1].
  const hue = 120 - 120 * Math.max(0, Math.min(1, percentile));
  return `hsla(${hue}, 70%, 45%, 0.25)`;
}

export default function ChainTable({ rows, optionType, side, onSelect, spotPrice }: ChainTableProps) {
  const filteredRows = rows
    .filter((r) => r.type === (optionType === 'call' ? 'Call' : 'Put'))
    .sort((a, b) => a.strike - b.strike);

  if (filteredRows.length === 0) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6 text-gray-500 text-center">
        No chain data available. Load an expiration to see the options chain.
      </div>
    );
  }

  // IV percentile within the visible set — gives a gradient that works
  // regardless of absolute IV level.
  const ivs = filteredRows.map((r) => r.iv).filter((v) => v > 0);
  const ivMin = ivs.length ? Math.min(...ivs) : 0;
  const ivMax = ivs.length ? Math.max(...ivs) : 0;
  const ivSpan = Math.max(ivMax - ivMin, 1e-6);

  // Find the row whose delta is closest to each target, so we can badge them.
  const targets = DELTA_TARGETS[optionType] ?? [];
  const bestByTarget = new Map<string, number>(); // target.label → row index
  targets.forEach((t) => {
    let bestIdx = -1;
    let bestGap = Infinity;
    filteredRows.forEach((r, idx) => {
      if (!r.delta) return;
      const gap = Math.abs(r.delta - t.target);
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) bestByTarget.set(t.label, bestIdx);
  });
  const targetByIdx = new Map<number, string>();
  bestByTarget.forEach((idx, label) => targetByIdx.set(idx, label));

  return (
    <div className="bg-[#2D2D2D] rounded-lg overflow-hidden relative">
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm min-w-[640px]">
          <thead className="text-gray-500 bg-[#1E1E1E]">
            <tr>
              <th className="text-left py-2 px-2 sm:px-3">Strike</th>
              <th className="text-right py-2 px-2 sm:px-3">Breakeven</th>
              <th className="text-right py-2 px-2 sm:px-3" title="IV (heat-mapped across visible rows)">IV</th>
              <th className="text-right py-2 px-2 sm:px-3">Price</th>
              <th className="text-right py-2 px-2 sm:px-3">Bid</th>
              <th className="text-right py-2 px-2 sm:px-3">Ask</th>
              <th className="text-right py-2 px-2 sm:px-3" title="Delta (target zones highlighted)">Delta</th>
              <th className="text-center py-2 px-2 sm:px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const mid = (row.bid + row.ask) / 2;
              const breakeven = optionType === 'call'
                ? row.strike + row.ask
                : row.strike - row.ask;
              const price = side === 'buy' ? row.ask : row.bid;
              const percentile = ivs.length ? (row.iv - ivMin) / ivSpan : 0;
              const ivBg = row.iv > 0 ? _ivHeat(percentile) : 'transparent';

              // ITM shading: relative to spot price (call strike < spot, put strike > spot)
              const isItm = spotPrice !== undefined
                ? optionType === 'call' ? row.strike < spotPrice : row.strike > spotPrice
                : false;

              const targetLabel = targetByIdx.get(idx);
              const accentBorder = targetLabel ? 'border-l-4 border-l-[#14b8a6]' : '';
              const rowBg = isItm ? 'bg-white/[0.03]' : '';

              return (
                <tr
                  key={row.occ}
                  className={`border-t border-gray-700/50 hover:bg-[#333] cursor-pointer transition-colors ${accentBorder} ${rowBg}`}
                  onClick={() => onSelect(row.occ, price)}
                >
                  <td className="py-2 px-3 font-bold text-[#FFD700]">
                    ${row.strike.toFixed(2)}
                    {targetLabel && (
                      <span className="ml-2 text-[10px] font-semibold text-[#14b8a6]">{targetLabel}</span>
                    )}
                    {isItm && <span className="ml-2 text-[10px] text-gray-400">ITM</span>}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">${breakeven.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-100" style={{ backgroundColor: ivBg }}>
                    {row.iv > 0 ? (row.iv * 100).toFixed(1) + '%' : '-'}
                  </td>
                  <td className="py-2 px-3 text-right text-white font-semibold">${mid.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-[#00C805]">{row.bid.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-[#FF006E]">{row.ask.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{row.delta ? row.delta.toFixed(3) : '-'}</td>
                  <td className="py-2 px-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(row.occ, price); }}
                      className="px-2 py-1 bg-[#00C805]/20 text-[#00C805] rounded text-xs font-bold hover:bg-[#00C805]/30"
                    >
                      +
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-[#2D2D2D] to-transparent sm:hidden" />
    </div>
  );
}

export function buildChainRows(chainData: Record<string, unknown> | null): ChainRow[] {
  if (!chainData) return [];
  const snapshots = (chainData.snapshots || {}) as Record<string, Record<string, unknown>>;
  const rows: ChainRow[] = [];

  for (const [occ, snap] of Object.entries(snapshots)) {
    const parsed = parseOCC(occ);
    if (!parsed) continue;
    const quote = (snap.latestQuote || {}) as Record<string, number>;
    const trade = (snap.latestTrade || {}) as Record<string, number>;
    const greeks = (snap.greeks || {}) as Record<string, number>;
    rows.push({
      occ,
      strike: parsed.strike,
      type: parsed.type,
      bid: quote.bp || quote.bidPrice || 0,
      ask: quote.ap || quote.askPrice || 0,
      last: trade.p || trade.price || 0,
      iv: greeks.impliedVolatility || greeks.iv || 0,
      delta: greeks.delta || 0,
      volume: (trade as Record<string, number>).s || 0,
    });
  }
  rows.sort((a, b) => a.strike - b.strike || (a.type === 'Call' ? -1 : 1));
  return rows;
}
