'use client';

import { TickerStat } from './types';

interface Props {
  stats: TickerStat[];
}

const fmtCurrency = (v: number | null): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${v.toFixed(0)}`;
};

const fmtPct = (v: number | null): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;

const tonePnl = (v: number | null): string =>
  v == null
    ? 'text-gray-500'
    : v > 0
      ? 'text-[#34D399]'
      : v < 0
        ? 'text-[#FF006E]'
        : 'text-gray-300';

export default function TickerBreakdown({ stats }: Props) {
  if (stats.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#16171c]">
        <h3 className="text-sm font-semibold text-white tracking-tight">Per-Ticker Analytics</h3>
        <p className="text-[11px] text-gray-500">{stats.length} symbols · sorted by total P&L</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-[#0b0b0d]">
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-right">Trades</th>
              <th className="px-3 py-2 text-right">Win Rate</th>
              <th className="px-3 py-2 text-right">Avg P&L</th>
              <th className="px-3 py-2 text-right">Total P&L</th>
              <th className="px-3 py-2 text-right">Contribution</th>
              <th className="px-3 py-2 text-right">Final Capital</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.ticker} className="border-t border-[#16171c] hover:bg-white/[0.025]">
                <td className="px-3 py-2 font-mono text-white">{s.ticker}</td>
                <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{s.trades}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-300">
                  {fmtPct(s.winRate)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${tonePnl(s.avgPnl)}`}>
                  {fmtCurrency(s.avgPnl)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${tonePnl(s.totalPnl)}`}>
                  {fmtCurrency(s.totalPnl)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-300">
                  {s.contribution == null ? '—' : `${(s.contribution * 100).toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-300">
                  ${s.finalCapital.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
