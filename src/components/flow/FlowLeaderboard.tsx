'use client';

import { useMemo, useState } from 'react';
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

type SortKey = 'ticker' | 'today_premium' | 'multiplier' | 'top_contract' | 'iv_percentile';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'today_premium', label: 'Premium today', align: 'right' },
  { key: 'multiplier', label: 'vs avg', align: 'right' },
  { key: 'top_contract', label: 'Top contract' },
  { key: 'iv_percentile', label: 'IV rank', align: 'right' },
];

// Sort-key extractor: returns a value usable by the comparator.
// `-Infinity` for null sinks them to the bottom of desc sorts (and top of asc).
function sortValue(r: FlowLeaderboardRow, k: SortKey): number | string {
  switch (k) {
    case 'ticker':
      return r.ticker;
    case 'today_premium':
      return r.today_premium_dollars ?? -Infinity;
    case 'multiplier':
      return r.premium_multiplier ?? -Infinity;
    case 'top_contract':
      return r.top_contract?.premium_dollars ?? -Infinity;
    case 'iv_percentile':
      return r.iv_percentile ?? -Infinity;
  }
}

export function FlowLeaderboard({ rows, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('today_premium');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const visibleRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const filtered = q ? rows.filter((r) => r.ticker.toUpperCase().includes(q)) : rows;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Numeric columns feel right starting on desc (biggest first); string
      // columns start asc (alphabetical).
      setSortDir(k === 'ticker' || k === 'top_contract' ? 'asc' : 'desc');
    }
  };

  const arrow = (k: SortKey) => (k === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  if (rows.length === 0) {
    return (
      <div className="rv-card p-6 text-sm" style={{ color: 'var(--ink-mute)' }}>
        No flow data yet. The 16:05 ET snapshot job populates this leaderboard;
        first row appears after the first cron run.
      </div>
    );
  }

  return (
    <div className="rv-card">
      {/* Search bar: case-insensitive substring match on ticker. Sits above the
          scrollable table so it stays visible regardless of horizontal scroll. */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker…"
          aria-label="Search ticker"
          style={{
            flex: 1,
            minWidth: 0,
            background: '#0d0e11',
            border: '1px solid var(--line, var(--border))',
            borderRadius: 4,
            padding: '6px 10px',
            color: 'var(--ink)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            style={{
              background: 'transparent',
              border: '1px solid var(--line, var(--border))',
              borderRadius: 4,
              color: 'var(--ink-mute)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '5px 8px',
            }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
          {visibleRows.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: 'var(--ink-mute)' }}>
              {COLUMNS.map((c) => {
                const isTicker = c.key === 'ticker';
                const className = [
                  'px-3 py-2 font-normal',
                  c.align === 'right' ? 'text-right' : '',
                  'rv-sortable',
                  isTicker ? 'rv-sticky-col' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <th
                    key={c.key}
                    className={className}
                    onClick={() => toggleSort(c.key)}
                    style={{ color: sortKey === c.key ? 'var(--gold)' : undefined }}
                  >
                    {c.label}
                    {arrow(c.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
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
                  <td className="px-3 py-2 font-bold rv-sticky-col">{r.ticker}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtDollars(r.today_premium_dollars)}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    style={{
                      color:
                        r.premium_multiplier && r.premium_multiplier >= 3
                          ? 'var(--green, #00C805)'
                          : undefined,
                    }}
                  >
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
        {visibleRows.length === 0 && (
          <div className="px-3 py-4 text-sm" style={{ color: 'var(--ink-mute)' }}>
            No tickers match &ldquo;{search}&rdquo;.
          </div>
        )}
      </div>
    </div>
  );
}
