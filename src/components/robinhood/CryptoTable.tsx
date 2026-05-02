'use client';

import { useMemo, useState } from 'react';
import type { CryptoHolding } from '@/lib/robinhood-api';

const fmt = (n: number | null | undefined, fraction = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtMoney = (n: number | null | undefined, fraction = 2) =>
  n == null ? '—' : `$${fmt(n, fraction)}`;

const fmtSigned = (n: number | null | undefined) => {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const cls = (n: number | null | undefined) =>
  n == null ? '' : n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '';

type SortKey = 'symbol' | 'quantity' | 'avg_cost' | 'current_price' | 'market_value' | 'unrealized_pnl';
type SortDir = 'asc' | 'desc';

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'avg_cost', label: 'Avg cost', align: 'right' },
  { key: 'current_price', label: 'Current', align: 'right' },
  { key: 'market_value', label: 'Mkt value', align: 'right' },
  { key: 'unrealized_pnl', label: 'Unrealized', align: 'right' },
];

function getValue(h: CryptoHolding, key: SortKey): number | string | null | undefined {
  switch (key) {
    case 'symbol': return h.symbol;
    case 'quantity': return h.quantity;
    case 'avg_cost': return h.avg_cost;
    case 'current_price': return h.current_price;
    case 'market_value': return h.market_value;
    case 'unrealized_pnl': return h.unrealized_pnl;
  }
}

function compare(a: CryptoHolding, b: CryptoHolding, key: SortKey, dir: SortDir): number {
  const av = getValue(a, key);
  const bv = getValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  let cmp: number;
  if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
  else cmp = (av as number) - (bv as number);
  return dir === 'asc' ? cmp : -cmp;
}

export function CryptoTable({ holdings }: { holdings: CryptoHolding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const filtered = q ? holdings.filter((h) => h.symbol.toUpperCase().includes(q)) : holdings;
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [holdings, sortKey, sortDir, filter]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="rv-card">
      <div className="rv-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3>
          Crypto holdings ·{' '}
          {sorted.length}
          {filter ? ` of ${holdings.length}` : ''}
        </h3>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter symbol…"
            data-testid="crypto-filter"
            style={{
              fontSize: 11,
              padding: '4px 8px',
              background: 'var(--bg, #1E1E1E)',
              border: '1px solid var(--line)',
              borderRadius: 3,
              color: 'var(--ink)',
              fontFamily: "'JetBrains Mono', monospace",
              width: 130,
            }}
          />
          <span className="rv-sub" style={{ margin: 0 }}>
            live prices via Robinhood · 60s TTL
          </span>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 540, width: '100%' }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => onHeaderClick(col.key)}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{
                      textAlign: col.align,
                      cursor: 'pointer',
                      userSelect: 'none',
                      color: active ? 'var(--gold, #FFD700)' : undefined,
                    }}
                    title={`Sort by ${col.label}`}
                  >
                    {col.label}
                    {arrow(col.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  style={{ padding: 12, color: 'var(--ink-mute)', textAlign: 'center' }}
                >
                  {filter
                    ? `No symbols match "${filter}".`
                    : 'No open crypto positions. Run Sync RH to pull live data.'}
                </td>
              </tr>
            )}
            {sorted.map((h) => (
              <tr key={h.symbol}>
                <td>
                  <b style={{ fontFamily: "'JetBrains Mono', monospace" }}>{h.symbol}</b>
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmt(h.quantity, 8)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtMoney(h.avg_cost)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtMoney(h.current_price ?? null)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtMoney(h.market_value ?? null)}
                </td>
                <td
                  className={cls(h.unrealized_pnl)}
                  style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {fmtSigned(h.unrealized_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
