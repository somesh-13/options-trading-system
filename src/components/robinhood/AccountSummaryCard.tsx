'use client';

import type { RobinhoodSummary } from '@/lib/robinhood-api';

const fmt = (n: number | null | undefined, opts: Intl.NumberFormatOptions = {}) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts });

const fmtSigned = (n: number | null | undefined) => {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
};

export function AccountSummaryCard({
  summary,
  accountLabel = 'All accounts',
  fetchedAt = null,
}: {
  summary: RobinhoodSummary | null;
  accountLabel?: string;
  fetchedAt?: string | null;
}) {
  const cls = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

  const nav =
    summary == null
      ? null
      : summary.total_market_value + summary.cash_net_transfers - summary.total_invested;

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>NAV · {summary ? fmt(summary.total_market_value) : '—'}</h3>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="rv-chip">{accountLabel}</span>
          <span
            data-testid="summary-source-chip"
            className="rv-chip"
            style={{
              background: 'rgba(0,200,5,0.12)',
              color: 'var(--green, #00C805)',
              borderColor: 'var(--green, #00C805)',
            }}
            title={
              fetchedAt
                ? `Last live sync: ${new Date(fetchedAt).toLocaleString()}`
                : 'Live snapshot'
            }
          >
            LIVE
            {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString()}` : ''}
          </span>
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginTop: 4,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Invested</div>
          <div><b>{fmt(summary?.total_invested)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>equity cost basis</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Unrealized</div>
          <div className={cls(summary?.unrealized_pnl)}>
            <b>{fmtSigned(summary?.unrealized_pnl)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>mark-to-market</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Transfers</div>
          <div><b>{fmtSigned(summary?.cash_net_transfers)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>ACH net</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>NAV est.</div>
          <div className={cls(nav)}>
            <b>{fmtSigned(nav)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>market + transfers − cost</div>
        </div>
      </div>
    </div>
  );
}
