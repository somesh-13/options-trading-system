'use client';

import Link from 'next/link';
import type { RobinhoodHolding } from '@/lib/robinhood-api';

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

export function HoldingsTable({ equities }: { equities: RobinhoodHolding[] }) {
  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Equity holdings · {equities.length}</h3>
        <span className="rv-sub" style={{ margin: 0 }}>
          live prices via yfinance · 60s TTL
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 640, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Symbol</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Avg cost</th>
              <th style={{ textAlign: 'right' }}>Current</th>
              <th style={{ textAlign: 'right' }}>Mkt value</th>
              <th style={{ textAlign: 'right' }}>Unrealized</th>
              <th style={{ textAlign: 'right' }}>Realized</th>
            </tr>
          </thead>
          <tbody>
            {equities.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: 'var(--ink-mute)', textAlign: 'center' }}>
                  No open equity positions.
                </td>
              </tr>
            )}
            {equities.map((h) => (
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
      </div>
    </div>
  );
}
