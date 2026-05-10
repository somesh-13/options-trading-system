'use client';

import type { FlowLeaderboardRow } from '@/lib/flow-api';

function fmtDollars(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPercentile(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  return `${Math.round(p * 100)}`;
}

function fmtMultiplier(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return `${m.toFixed(1)}×`;
}

interface Props {
  rows: FlowLeaderboardRow[];
  selected?: string;
  onSelect?: (ticker: string) => void;
}

export function FlowLeaderboard({ rows, selected, onSelect }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rv-card p-6 text-sm" style={{ color: 'var(--ink-mute)' }}>
        No flow data yet. The 16:05 ET snapshot job populates this leaderboard;
        first row appears after the first cron run.
      </div>
    );
  }

  return (
    <div className="rv-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ color: 'var(--ink-mute)' }}>
            <th className="px-3 py-2 font-normal">Ticker</th>
            <th className="px-3 py-2 font-normal text-right">Premium today</th>
            <th className="px-3 py-2 font-normal text-right">vs avg</th>
            <th className="px-3 py-2 font-normal">Top contract</th>
            <th className="px-3 py-2 font-normal text-right">IV rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selected === r.ticker;
            const top = r.top_contract;
            return (
              <tr
                key={r.ticker}
                onClick={() => onSelect?.(r.ticker)}
                className="border-t cursor-pointer hover:bg-white/5"
                style={{
                  borderColor: 'var(--border)',
                  background: isSelected ? 'rgba(0, 200, 5, 0.08)' : undefined,
                }}
              >
                <td className="px-3 py-2 font-bold">{r.ticker}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtDollars(r.today_premium_dollars)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{
                  color:
                    r.premium_multiplier && r.premium_multiplier >= 3
                      ? 'var(--green, #00C805)'
                      : undefined,
                }}>
                  {fmtMultiplier(r.premium_multiplier)}
                </td>
                <td className="px-3 py-2">
                  {top ? (
                    <span>
                      <span className="font-mono">
                        {top.side === 'call' ? 'C' : 'P'} {top.strike}
                      </span>{' '}
                      <span style={{ color: 'var(--ink-mute)' }}>
                        {top.expiration} · vol {top.volume?.toLocaleString() ?? '—'}
                        {top.vol_oi_ratio ? ` · vol/OI ${top.vol_oi_ratio.toFixed(1)}×` : ''}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ink-mute)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtPercentile(r.iv_percentile)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
