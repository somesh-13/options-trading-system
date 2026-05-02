'use client';

import { InfoIcon } from '@/components/ui/InfoIcon';
import type { RobinhoodSummary } from '@/lib/robinhood-api';
import type { LimitsCheckResult, DrawdownResult } from '@/lib/robinhood-analytics-api';

const fmt = (n: number | null | undefined, opts: Intl.NumberFormatOptions = {}) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts });

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '' : ''}${n.toFixed(2)}%`;

function statusColor(status: string) {
  if (status === 'OK') return 'var(--green, #00C805)';
  if (status === 'WARNING') return 'var(--gold, #FFD700)';
  return 'var(--pink, #FF006E)';
}

function drawdownColor(pct: number) {
  if (pct <= 5) return 'var(--green, #00C805)';
  if (pct <= 10) return 'var(--gold, #FFD700)';
  return 'var(--pink, #FF006E)';
}

interface Props {
  summary: RobinhoodSummary | null;
  limits: LimitsCheckResult | null;
  drawdown: DrawdownResult | null;
  loading: boolean;
}

export function PortfolioRiskSummary({ summary, limits, drawdown, loading }: Props) {
  return (
    <div className="rv-card" style={{ marginBottom: 16 }}>
      <div className="rv-card-head">
        <h3>
          Portfolio Risk Summary
          <InfoIcon term="nav" />
        </h3>
        {loading && <span className="rv-chip warn" style={{ fontSize: 10 }}>loading…</span>}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginTop: 8,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {/* NAV block */}
        <div>
          <div className="rv-sub" style={{ margin: '0 0 4px' }}>
            NAV
            <InfoIcon term="nav" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {fmt(summary?.nav)}
          </div>
          <div className="rv-sub" style={{ margin: '2px 0 0' }}>
            equity {fmt(summary?.total_market_value)} + options {fmt(summary?.option_market_value)} + cash {fmt(summary?.cash_balance)}
          </div>
        </div>

        {/* Limits check block */}
        <div>
          <div className="rv-sub" style={{ margin: '0 0 4px' }}>
            Risk Limits
            <InfoIcon term="position-limits" />
          </div>
          {limits ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: statusColor(limits.status),
                  }}
                >
                  {limits.risk_score}/100
                </span>
                <span
                  className="rv-chip"
                  style={{
                    fontSize: 10,
                    background: `${statusColor(limits.status)}22`,
                    color: statusColor(limits.status),
                    borderColor: statusColor(limits.status),
                  }}
                >
                  {limits.status}
                </span>
              </div>
              {limits.violations.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--pink, #FF006E)' }}>
                  {limits.violations.map((v) => (
                    <div key={v.greek}>
                      {v.greek.toUpperCase()}: {v.current.toFixed(0)} / {v.limit.toFixed(0)} ({v.utilization_pct.toFixed(0)}%)
                    </div>
                  ))}
                </div>
              )}
              {limits.violations.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{limits.action}</div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--ink-mute)', fontSize: 12 }}>—</div>
          )}
        </div>

        {/* Drawdown block */}
        <div>
          <div className="rv-sub" style={{ margin: '0 0 4px' }}>
            Drawdown
            <InfoIcon term="drawdown" />
          </div>
          {drawdown ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: drawdownColor(drawdown.drawdown_pct),
                  }}
                >
                  {fmtPct(drawdown.drawdown_pct)}
                </span>
                <span
                  className="rv-chip"
                  style={{
                    fontSize: 10,
                    background: drawdown.breached ? 'rgba(255,0,110,0.12)' : 'rgba(0,200,5,0.12)',
                    color: drawdown.breached ? 'var(--pink)' : 'var(--green)',
                    borderColor: drawdown.breached ? 'var(--pink)' : 'var(--green)',
                  }}
                >
                  {drawdown.breached ? 'BREACHED' : 'OK'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                peak {fmt(drawdown.peak_equity)} · current {fmt(drawdown.current_equity)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>
                limit {drawdown.limit_pct.toFixed(0)}% · buffer {drawdown.remaining_buffer_pct.toFixed(1)}% · {drawdown.action}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--ink-mute)', fontSize: 12 }}>—</div>
          )}
        </div>
      </div>
    </div>
  );
}
