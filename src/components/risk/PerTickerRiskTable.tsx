'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { RobinhoodHolding } from '@/lib/robinhood-api';
import type { VaRResult } from '@/lib/robinhood-analytics-api';

const fmt = (n: number | null | undefined, fraction = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtMoney = (n: number | null | undefined) => (n == null ? '—' : `$${fmt(n, 2)}`);
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)}%`);

function navStatusClass(pct: number) {
  if (pct > 20) return 'sell';   // rv-chip sell → red
  if (pct > 10) return 'warn';   // rv-chip warn → gold
  return 'buy';                  // rv-chip buy  → green
}

// Dedupe holdings to one row per symbol (sum qty, use last market_value & price)
export interface EquityRow {
  symbol: string;
  quantity: number;
  market_value: number | null;
  current_price: number | null;
  account: string; // comma-joined if multiple
}

function dedupeHoldings(equities: RobinhoodHolding[]): EquityRow[] {
  const map = new Map<string, EquityRow>();
  for (const h of equities) {
    const existing = map.get(h.symbol);
    if (existing) {
      existing.quantity += h.quantity;
      existing.market_value = (existing.market_value ?? 0) + (h.market_value ?? 0);
      if (!existing.account.split(',').includes(h.account)) {
        existing.account = `${existing.account},${h.account}`;
      }
    } else {
      map.set(h.symbol, {
        symbol: h.symbol,
        quantity: h.quantity,
        market_value: h.market_value ?? null,
        current_price: h.current_price ?? null,
        account: h.account,
      });
    }
  }
  return Array.from(map.values());
}

type SortKey = 'symbol' | 'quantity' | 'market_value' | 'nav_pct' | 'var95' | 'var99';
type SortDir = 'asc' | 'desc';

function getVar95(v: VaRResult | null | undefined): number | null {
  if (!v) return null;
  return (v.parametric as Record<string, number> | undefined)?.var_pct
    ?? (v.historical as Record<string, number> | undefined)?.var_pct
    ?? null;
}
// Use CVaR (Expected Shortfall) at 95% as a proxy for 99% VaR —
// ES@95 ≈ VaR@99 and is more conservative / informative.
function getVar99(v: VaRResult | null | undefined): number | null {
  if (!v) return null;
  return (v.parametric as Record<string, number> | undefined)?.cvar_pct
    ?? (v.historical as Record<string, number> | undefined)?.cvar_pct
    ?? null;
}

interface Props {
  equities: RobinhoodHolding[];
  varMap: Map<string, VaRResult | null>;
  totalMarketValue: number;
  loading: boolean;
}

export function PerTickerRiskTable({ equities, varMap, totalMarketValue, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo(() => dedupeHoldings(equities), [equities]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av: number | string | null = null;
      let bv: number | string | null = null;
      switch (sortKey) {
        case 'symbol':
          av = a.symbol; bv = b.symbol; break;
        case 'quantity':
          av = a.quantity; bv = b.quantity; break;
        case 'market_value':
          av = a.market_value; bv = b.market_value; break;
        case 'nav_pct':
          av = totalMarketValue > 0 ? (a.market_value ?? 0) / totalMarketValue * 100 : 0;
          bv = totalMarketValue > 0 ? (b.market_value ?? 0) / totalMarketValue * 100 : 0;
          break;
        case 'var95':
          av = getVar95(varMap.get(a.symbol)); bv = getVar95(varMap.get(b.symbol)); break;
        case 'var99':
          av = getVar99(varMap.get(a.symbol)); bv = getVar99(varMap.get(b.symbol)); break;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
      else cmp = (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, varMap, totalMarketValue]);

  const onHeader = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const thStyle = (key: SortKey): React.CSSProperties => ({
    cursor: 'pointer',
    userSelect: 'none',
    textAlign: 'right',
    color: sortKey === key ? 'var(--gold, #FFD700)' : undefined,
  });

  const COLS: Array<{ key: SortKey; label: string }> = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'quantity', label: 'Qty' },
    { key: 'market_value', label: 'Mkt value' },
    { key: 'nav_pct', label: '% of NAV' },
    { key: 'var95', label: 'VaR 95% (1d)' },
    { key: 'var99', label: 'CVaR 95% (1d)' },
  ];

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Per-ticker risk · {sorted.length} positions</h3>
        {loading && <span className="rv-chip warn" style={{ fontSize: 10 }}>fetching VaR…</span>}
        <span className="rv-sub" style={{ margin: 0, marginLeft: 'auto', fontSize: 10 }}>
          VaR 95% = parametric 1-day · CVaR 95% = expected shortfall · % of NAV = equity MV / total
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 700, width: '100%', fontSize: 11.5 }}>
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onHeader(col.key)}
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={{
                    ...thStyle(col.key),
                    textAlign: col.key === 'symbol' ? 'left' : 'right',
                  }}
                  title={`Sort by ${col.label}`}
                >
                  {col.label}{arrow(col.key)}
                </th>
              ))}
              <th style={{ textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} style={{ padding: 16, textAlign: 'center', color: 'var(--ink-mute)' }}>
                  No equity positions.
                </td>
              </tr>
            )}
            {sorted.map((row) => {
              const navPct = totalMarketValue > 0
                ? (row.market_value ?? 0) / totalMarketValue * 100
                : null;
              const varData = varMap.get(row.symbol);
              const var95 = getVar95(varData);
              const var99 = getVar99(varData);
              const statusCls = navPct != null ? navStatusClass(navPct) : 'neutral';
              const isVarLoading = varData === undefined;

              return (
                <tr key={row.symbol}>
                  <td>
                    <Link
                      href={`/stock/${encodeURIComponent(row.symbol)}?from=risk`}
                      style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--line)' }}
                    >
                      <b>{row.symbol}</b>
                    </Link>
                    {row.account.includes(',') && (
                      <span className="rv-chip" style={{ fontSize: 9, marginLeft: 6 }} title={row.account}>
                        multi
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmt(row.quantity, 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtMoney(row.market_value)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtPct(navPct)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-mute)' }}>
                    {isVarLoading
                      ? <span style={{ color: 'var(--ink-mute)', fontSize: 10 }}>…</span>
                      : varData === null
                        ? <span style={{ color: 'var(--ink-mute)', fontSize: 10 }}>err</span>
                        : var95 != null
                          ? <span style={{ color: 'var(--gold)' }}>{var95.toFixed(2)}%</span>
                          : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-mute)' }}>
                    {isVarLoading
                      ? <span style={{ fontSize: 10 }}>…</span>
                      : varData === null
                        ? <span style={{ fontSize: 10 }}>err</span>
                        : var99 != null
                          ? <span style={{ color: 'var(--pink)' }}>{var99.toFixed(2)}%</span>
                          : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`rv-chip ${statusCls}`} style={{ fontSize: 10 }}>
                      {navPct == null ? '—' : navPct > 20 ? 'HIGH' : navPct > 10 ? 'MED' : 'OK'}
                    </span>
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
