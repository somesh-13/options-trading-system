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
}

export default function ChainTable({ rows, optionType, side, onSelect }: ChainTableProps) {
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

  return (
    <div className="bg-[#2D2D2D] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-500 bg-[#1E1E1E]">
            <tr>
              <th className="text-left py-2 px-3">Strike</th>
              <th className="text-right py-2 px-3">Breakeven</th>
              <th className="text-right py-2 px-3">IV</th>
              <th className="text-right py-2 px-3">Price</th>
              <th className="text-right py-2 px-3">Bid</th>
              <th className="text-right py-2 px-3">Ask</th>
              <th className="text-right py-2 px-3">Delta</th>
              <th className="text-center py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const mid = (row.bid + row.ask) / 2;
              const breakeven = optionType === 'call'
                ? row.strike + row.ask
                : row.strike - row.ask;
              const price = side === 'buy' ? row.ask : row.bid;

              return (
                <tr
                  key={row.occ}
                  className="border-t border-gray-700/50 hover:bg-[#333] cursor-pointer transition-colors"
                  onClick={() => onSelect(row.occ, price)}
                >
                  <td className="py-2 px-3 font-bold text-[#FFD700]">${row.strike.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">${breakeven.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{row.iv > 0 ? (row.iv * 100).toFixed(1) + '%' : '-'}</td>
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
