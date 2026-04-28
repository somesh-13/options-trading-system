'use client';

import Link from 'next/link';
import type { RobinhoodActivityRow } from '@/lib/robinhood-api';

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}?from=robinhood`;
}

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const CODE_TONE: Record<string, string> = {
  Buy: 'rv-chip',
  Sell: 'rv-chip',
  BTO: 'rv-chip',
  STC: 'rv-chip',
  STO: 'rv-chip warn',
  BTC: 'rv-chip warn',
  CDIV: 'rv-chip',
  MDIV: 'rv-chip',
  ACH: 'rv-chip',
  INT: 'rv-chip',
  GOLD: 'rv-chip warn',
  MTCH: 'rv-chip warn',
  MISC: 'rv-chip warn',
  OEXP: 'rv-chip',
  OASGN: 'rv-chip',
  OEXCS: 'rv-chip',
};

export function ActivityTimeline({ rows }: { rows: RobinhoodActivityRow[] }) {
  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Recent activity · {rows.length}</h3>
        <span className="rv-sub" style={{ margin: 0 }}>most recent · from Robinhood CSV exports</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ minWidth: 560, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Date</th>
              <th style={{ textAlign: 'left' }}>Code</th>
              <th style={{ textAlign: 'left' }}>Instrument</th>
              <th style={{ textAlign: 'left' }}>Description</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.activity_date}-${i}`}>
                <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.activity_date}</td>
                <td>
                  <span className={CODE_TONE[r.trans_code] ?? 'rv-chip'} style={{ fontSize: 10 }}>
                    {r.trans_code}
                  </span>
                </td>
                <td>
                  {r.instrument ? (
                    <Link
                      href={stockHref(r.instrument)}
                      style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--line)' }}
                    >
                      <b>{r.instrument}</b>
                    </Link>
                  ) : (
                    ''
                  )}
                </td>
                <td style={{ color: 'var(--ink-dim)' }}>{r.description ?? ''}</td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {r.quantity != null ? r.quantity.toLocaleString('en-US') : '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                  {r.price != null ? `$${r.price.toFixed(2)}` : '—'}
                </td>
                <td
                  className={r.amount == null ? '' : r.amount > 0 ? 'rv-up' : 'rv-dn'}
                  style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {fmtMoney(r.amount ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
