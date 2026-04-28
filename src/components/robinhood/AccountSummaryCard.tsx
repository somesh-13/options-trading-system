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
}: {
  summary: RobinhoodSummary | null;
  accountLabel?: string;
}) {
  const cls = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');
  const nav =
    summary == null
      ? null
      : summary.total_market_value + summary.cash_net_transfers + summary.dividends_ytd + summary.interest_ytd + summary.fees_ytd + summary.realized_pnl - summary.total_invested;

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>NAV · {summary ? fmt(summary.total_market_value) : '—'}</h3>
        <span className="rv-chip">{accountLabel}</span>
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
          <div className="rv-sub" style={{ margin: 0 }}>Realized</div>
          <div className={cls(summary?.realized_pnl)}>
            <b>{fmtSigned(summary?.realized_pnl)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>YTD P&amp;L</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Dividends</div>
          <div className={cls(summary?.dividends_ytd)}>
            <b>{fmtSigned(summary?.dividends_ytd)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>YTD</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Transfers</div>
          <div><b>{fmtSigned(summary?.cash_net_transfers)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>ACH net</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Interest</div>
          <div className={cls(summary?.interest_ytd)}>
            <b>{fmtSigned(summary?.interest_ytd)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>YTD</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>Fees</div>
          <div className={cls(summary?.fees_ytd)}>
            <b>{fmtSigned(summary?.fees_ytd)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>YTD</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>NAV est.</div>
          <div className={cls(nav)}>
            <b>{fmtSigned(nav)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>cost + pnl + cash</div>
        </div>
      </div>
      {summary && summary.unknown_basis_proceeds > 0 && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px dashed var(--line)',
            fontSize: 11,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
          data-testid="unknown-basis-note"
        >
          ⚠ {fmt(summary.unknown_basis_proceeds)} of sale proceeds came from pre-CSV shares
          (e.g. shares called away via option assignment before the earliest CSV date).
          The original cost basis is not in the exports, so Realized P&amp;L above does
          <em> not</em> include gain/loss on those shares.
        </div>
      )}
    </div>
  );
}
