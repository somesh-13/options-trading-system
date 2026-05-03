'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RobinhoodOption } from '@/lib/robinhood-api';

const COLLAPSE_KEY = 'rv:robinhood:option-legs-collapsed';

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}?from=robinhood`;
}

const fmt = (n: number, fraction = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtSigned = (n: number) => {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const cls = (n: number) => (n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

function groupByUnderlying(options: RobinhoodOption[]): Map<string, RobinhoodOption[]> {
  const map = new Map<string, RobinhoodOption[]>();
  for (const o of options) {
    const list = map.get(o.underlying) ?? [];
    list.push(o);
    map.set(o.underlying, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.expiry !== b.expiry ? a.expiry.localeCompare(b.expiry) : a.strike - b.strike,
    );
  }
  return map;
}

export function OptionsTable({ options }: { options: RobinhoodOption[] }) {
  const groups = [...groupByUnderlying(options).entries()].sort(([a], [b]) => a.localeCompare(b));
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div className="rv-card">
      <div className="rv-card-head">
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
          {' '}Open option legs · {options.length}
        </h3>
        <span className="rv-sub" style={{ margin: 0 }}>
          grouped by underlying · from activity replay
        </span>
      </div>
      {!collapsed && <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 680, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Underlying</th>
              <th style={{ textAlign: 'left' }}>Leg</th>
              <th style={{ textAlign: 'left' }}>Expiry</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Avg premium</th>
              <th style={{ textAlign: 'right' }}>Cost basis</th>
              <th style={{ textAlign: 'right' }}>Realized</th>
            </tr>
          </thead>
          <tbody>
            {options.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: 'var(--ink-mute)', textAlign: 'center' }}>
                  No open option legs.
                </td>
              </tr>
            )}
            {groups.map(([underlying, legs]) =>
              legs.map((o, idx) => (
                <tr key={`${underlying}-${o.expiry}-${o.side}-${o.strike}-${o.position}`}>
                  <td>
                    <Link
                      href={stockHref(underlying)}
                      data-testid={`option-link-${underlying}`}
                      style={{
                        color: idx === 0 ? 'var(--ink)' : 'var(--ink-mute)',
                        textDecoration: 'none',
                        borderBottom: idx === 0 ? '1px dotted var(--line)' : 'none',
                      }}
                    >
                      {idx === 0 ? <b>{underlying}</b> : underlying}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`rv-chip ${o.position === 'long' ? '' : 'warn'}`}
                      style={{ fontSize: 10, marginRight: 6 }}
                    >
                      {o.position === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    {o.side} ${fmt(o.strike)}
                  </td>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{o.expiry}</td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmt(o.quantity, 0)}</td>
                  <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>${fmt(o.avg_cost)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: o.cost_basis < 0 ? 'var(--ink-dim)' : undefined,
                    }}
                  >
                    {fmtSigned(o.cost_basis)}
                  </td>
                  <td
                    className={cls(o.realized_pnl)}
                    style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {o.realized_pnl === 0 ? '—' : fmtSigned(o.realized_pnl)}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
