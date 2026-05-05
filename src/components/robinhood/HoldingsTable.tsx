'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { RobinhoodHolding } from '@/lib/robinhood-api';

const COLLAPSE_KEY = 'rv:robinhood:equity-holdings-collapsed';
const COLLAPSE_EVENT = 'rv:robinhood:equity-holdings-collapsed-changed';

function subscribeCollapsed(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}

function getCollapsedSnapshot(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function getCollapsedServerSnapshot(): boolean {
  return false;
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  } catch {
    /* ignore */
  }
}

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}?from=robinhood`;
}

const fmt = (n: number | null | undefined, fraction = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtMoney = (n: number | null | undefined, fraction = 2) =>
  n == null ? '—' : `$${fmt(n, fraction)}`;

const fmtSigned = (n: number | null | undefined) => {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const cls = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

type SortKey = 'symbol' | 'quantity' | 'avg_cost' | 'current_price' | 'market_value' | 'unrealized_pnl' | 'realized_pnl';
type SortDir = 'asc' | 'desc';

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'avg_cost', label: 'Avg cost', align: 'right' },
  { key: 'current_price', label: 'Current', align: 'right' },
  { key: 'market_value', label: 'Mkt value', align: 'right' },
  { key: 'unrealized_pnl', label: 'Unrealized', align: 'right' },
  { key: 'realized_pnl', label: 'Realized', align: 'right' },
];

function getValue(h: RobinhoodHolding, key: SortKey): number | string | null | undefined {
  switch (key) {
    case 'symbol': return h.symbol;
    case 'quantity': return h.quantity;
    case 'avg_cost': return h.avg_cost;
    case 'current_price': return h.current_price;
    case 'market_value': return h.market_value;
    case 'unrealized_pnl': return h.unrealized_pnl;
    case 'realized_pnl': return h.realized_pnl;
  }
}

function compare(a: RobinhoodHolding, b: RobinhoodHolding, key: SortKey, dir: SortDir): number {
  const av = getValue(a, key);
  const bv = getValue(b, key);
  // nulls last
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  let cmp: number;
  if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
  else cmp = (av as number) - (bv as number);
  return dir === 'asc' ? cmp : -cmp;
}

export function HoldingsTable({ equities }: { equities: RobinhoodHolding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );
  const setCollapsed = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof updater === 'function' ? updater(getCollapsedSnapshot()) : updater;
    writeCollapsed(next);
  }, []);

  const sorted = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const filtered = q ? equities.filter((h) => h.symbol.toUpperCase().includes(q)) : equities;
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [equities, sortKey, sortDir, filter]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // numeric defaults to desc, symbol defaults to asc
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="rv-card">
      <div className="rv-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3
          onClick={() => setCollapsed((c) => !c)}
          role="button"
          aria-expanded={!collapsed}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCollapsed((c) => !c);
            }
          }}
          style={{ cursor: 'pointer', userSelect: 'none', margin: 0 }}
          title={collapsed ? 'Click to expand' : 'Click to collapse'}
        >
          <span style={{ display: 'inline-block', width: 14, color: 'var(--ink-mute)' }}>
            {collapsed ? '▶' : '▼'}
          </span>
          {' '}Equity holdings · {sorted.length}{filter ? ` of ${equities.length}` : ''}
        </h3>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          {!collapsed && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter symbol…"
              data-testid="holdings-filter"
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
          )}
          <span className="rv-sub" style={{ margin: 0 }}>
            live prices via yfinance · 60s TTL
          </span>
        </span>
      </div>
      {!collapsed && <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 640, width: '100%' }}>
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
                    {col.label}{arrow(col.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 12, color: 'var(--ink-mute)', textAlign: 'center' }}>
                  {filter ? `No symbols match "${filter}".` : 'No open equity positions.'}
                </td>
              </tr>
            )}
            {sorted.map((h) => (
              <tr key={`${h.symbol}-${h.account}`}>
                <td>
                  <Link
                    href={stockHref(h.symbol)}
                    data-testid={`equity-link-${h.symbol}`}
                    style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--line)' }}
                  >
                    <b>{h.symbol}</b>
                  </Link>
                  {h.inferred_opening && (
                    <span
                      className="rv-chip warn"
                      style={{ fontSize: 9, marginLeft: 6 }}
                      title="Opening balance inferred from a dividend row — this position was purchased before the CSV start date, so the original cost basis is unknown."
                    >
                      pre-CSV
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmt(h.quantity, 2)}</td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {h.inferred_opening ? '—' : fmtMoney(h.avg_cost)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtMoney(h.current_price ?? null)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtMoney(h.market_value ?? null)}
                </td>
                <td className={cls(h.unrealized_pnl)} style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtSigned(h.unrealized_pnl)}
                </td>
                <td className={cls(h.realized_pnl)} style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtSigned(h.realized_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
