'use client';

import { useMemo, useState } from 'react';
import type { FlowContractRow } from '@/lib/flow-api';

type ContractFilter = 'all' | 'calls' | 'puts' | 'oi-buildup' | 'big-premium';

const FILTERS: { id: ContractFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'calls', label: 'Calls only' },
  { id: 'puts', label: 'Puts only' },
  { id: 'oi-buildup', label: 'vol/OI ≥ 1' },
  { id: 'big-premium', label: 'Premium ≥ $100K' },
];

function applyFilter(c: FlowContractRow, f: ContractFilter): boolean {
  if (f === 'calls') return c.side === 'call';
  if (f === 'puts') return c.side === 'put';
  if (f === 'oi-buildup') return (c.vol_oi_ratio ?? 0) >= 1;
  if (f === 'big-premium') return (c.premium_dollars ?? 0) >= 100_000;
  return true;
}

function fmtDollars(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

interface Props {
  ticker: string;
  contracts: FlowContractRow[];
}

export function FlowContractTable({ ticker, contracts }: Props) {
  const [filter, setFilter] = useState<ContractFilter>('all');

  const visible = useMemo(
    () => contracts.filter((c) => applyFilter(c, filter)),
    [contracts, filter],
  );

  if (contracts.length === 0) {
    return (
      <div className="rv-card p-6 text-sm" style={{ color: 'var(--ink-mute)' }}>
        No contracts to display for {ticker}.
      </div>
    );
  }

  return (
    <div className="rv-card">
      <div className="flex flex-wrap gap-2 px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="rv-pill"
            style={{
              cursor: 'pointer',
              background: filter === f.id ? 'rgba(0, 200, 5, 0.18)' : undefined,
              borderColor: filter === f.id ? 'var(--green, #00C805)' : undefined,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: 'var(--ink-mute)' }}>
              <th className="px-3 py-2 font-normal">Contract</th>
              <th className="px-3 py-2 font-normal text-right">Vol</th>
              <th className="px-3 py-2 font-normal text-right">OI prior</th>
              <th className="px-3 py-2 font-normal text-right">Vol/OI</th>
              <th className="px-3 py-2 font-normal text-right">Mid</th>
              <th className="px-3 py-2 font-normal text-right">Premium</th>
              <th className="px-3 py-2 font-normal text-right">IV</th>
              <th className="px-3 py-2 font-normal text-right">DTE</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const sideColor = c.side === 'call' ? 'var(--green, #00C805)' : 'var(--red, #FF006E)';
              return (
                <tr key={`${c.expiration}-${c.strike}-${c.side}-${i}`}
                    className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2 font-mono">
                    <span style={{ color: sideColor, fontWeight: 600 }}>
                      {c.side === 'call' ? 'C' : 'P'}
                    </span>{' '}
                    {c.strike} <span style={{ color: 'var(--ink-mute)' }}>{c.expiration}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.volume?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--ink-mute)' }}>
                    {c.prior_oi?.toLocaleString() ?? c.oi?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{
                    color: (c.vol_oi_ratio ?? 0) >= 1 ? 'var(--gold, #FFD700)' : undefined,
                  }}>
                    {c.vol_oi_ratio !== null && c.vol_oi_ratio !== undefined
                      ? `${c.vol_oi_ratio.toFixed(2)}×`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.mid?.toFixed(2) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtDollars(c.premium_dollars)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.iv !== null && c.iv !== undefined ? `${(c.iv * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.days_to_expiry ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <div className="px-3 py-4 text-sm" style={{ color: 'var(--ink-mute)' }}>
          No contracts match this filter.
        </div>
      )}
    </div>
  );
}
