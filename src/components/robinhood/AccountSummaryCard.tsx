'use client';

import type { RobinhoodSummary } from '@/lib/robinhood-api';
import { InfoIcon } from '@/components/ui/InfoIcon';

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

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>NAV<InfoIcon term="nav" /> · {summary ? fmt(summary.nav || summary.total_market_value) : '—'}</h3>
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
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginTop: 4,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {/* Row 1 */}
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            NAV<InfoIcon term="nav" />
          </div>
          <div className={cls(summary?.nav)}>
            <b>{fmt(summary?.nav)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>equity + options + cash</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            Equity MV<InfoIcon term="market-value" />
          </div>
          <div><b>{fmt(summary?.total_market_value)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>equity market value</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            Option MV<InfoIcon term="market-value" />
          </div>
          <div><b>{fmt(summary?.option_market_value)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>option legs mark</div>
        </div>
        {/* Row 2 */}
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            Cash<InfoIcon term="cash-balance" />
          </div>
          <div><b>{fmt(summary?.cash_balance)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>account cash</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            Invested<InfoIcon term="cost-basis" />
          </div>
          <div><b>{fmt(summary?.total_invested)}</b></div>
          <div className="rv-sub" style={{ margin: 0 }}>equity cost basis</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0 }}>
            Unrealized<InfoIcon term="unrealized-pnl" />
          </div>
          <div className={cls(summary?.unrealized_pnl)}>
            <b>{fmtSigned(summary?.unrealized_pnl)}</b>
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>equity + options</div>
        </div>
      </div>
    </div>
  );
}
