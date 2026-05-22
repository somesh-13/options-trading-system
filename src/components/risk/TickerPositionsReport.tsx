'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTickerReport, type TickerReport } from '@/lib/robinhood-analytics-api';

const fmtUSD = (n: number | null | undefined, frac = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: frac,
        maximumFractionDigits: frac,
      });

const fmtNum = (n: number | null | undefined, frac = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: frac });

const pnlColor = (n: number | null | undefined) => {
  if (n == null) return 'var(--ink-mute, #888)';
  if (n > 0) return 'var(--green, #00C805)';
  if (n < 0) return 'var(--pink, #FF006E)';
  return 'var(--ink-mute, #888)';
};

interface Props {
  ticker: string;
}

export function TickerPositionsReport({ ticker }: Props) {
  const [report, setReport] = useState<TickerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getTickerReport(ticker, 'all');
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasEquity = (report?.equity?.quantity ?? 0) > 0;
  const hasOptions = (report?.options?.length ?? 0) > 0;
  const showEmpty = report && !hasEquity && !hasOptions && !loading;

  return (
    <div className="rv-card" style={{ marginBottom: 16 }}>
      <div className="rv-card-head">
        <h3>Ticker Positions Report — {ticker}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <span className="rv-chip warn" style={{ fontSize: 10 }}>loading…</span>}
          {report?.spot != null && (
            <span className="rv-sub" style={{ fontSize: 11 }}>spot {fmtUSD(report.spot)}</span>
          )}
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => void load()}
            disabled={loading}
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--pink, #FF006E)', fontSize: 12, padding: '8px 0' }}>
          {error}
        </div>
      )}

      {showEmpty && (
        <div style={{ color: 'var(--ink-mute, #888)', fontSize: 12, padding: '8px 0' }}>
          No positions for {ticker} in the current snapshot.
        </div>
      )}

      {report && hasEquity && (
        <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
          <div className="rv-sub" style={{ marginBottom: 4 }}>Equity</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{fmtNum(report.equity.quantity, 4)} sh</span>
            {' · avg '}{fmtUSD(report.equity.avg_cost, 4)}
            {' · mark '}{fmtUSD(report.equity.mark)}
            {' · MV '}{fmtUSD(report.equity.market_value)}
            {' · unrealized '}
            <span style={{ color: pnlColor(report.equity.unrealized_pnl), fontWeight: 600 }}>
              {fmtUSD(report.equity.unrealized_pnl)}
            </span>
          </div>
          {report.equity.by_account.length > 1 && (
            <div className="rv-sub" style={{ fontSize: 10, marginTop: 4 }}>
              {report.equity.by_account.map((row) => (
                <div key={row.account}>
                  · {row.account}: {fmtNum(row.quantity, 4)} sh @ {fmtUSD(row.avg_cost, 4)}
                  {' · MV '}{fmtUSD(row.market_value)}
                  {' · unr '}
                  <span style={{ color: pnlColor(row.unrealized_pnl) }}>
                    {fmtUSD(row.unrealized_pnl)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {report && hasOptions && (
        <div style={{ marginTop: 12 }}>
          <div className="rv-sub" style={{ marginBottom: 4 }}>Options</div>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
              }}
            >
              <thead>
                <tr style={{ color: 'var(--ink-mute, #888)', textAlign: 'left' }}>
                  <th style={th}>side</th>
                  <th style={th}>strike</th>
                  <th style={th}>expiry</th>
                  <th style={thRight}>qty</th>
                  <th style={th}>pos</th>
                  <th style={thRight}>avg</th>
                  <th style={thRight}>MV</th>
                  <th style={thRight}>unr</th>
                  <th style={thRight}>Δ</th>
                  <th style={thRight}>Γ</th>
                  <th style={thRight}>V</th>
                  <th style={thRight}>Θ</th>
                  <th style={th}>account</th>
                </tr>
              </thead>
              <tbody>
                {report.options.map((o, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={td}>{o.side}</td>
                    <td style={td}>{fmtNum(o.strike)}</td>
                    <td style={td}>{o.expiry}</td>
                    <td style={tdRight}>{fmtNum(o.quantity, 0)}</td>
                    <td style={{ ...td, color: o.position === 'long' ? 'var(--green)' : 'var(--pink)' }}>{o.position}</td>
                    <td style={tdRight}>{fmtNum(o.avg_cost)}</td>
                    <td style={tdRight}>{fmtUSD(o.market_value)}</td>
                    <td style={{ ...tdRight, color: pnlColor(o.unrealized_pnl) }}>{fmtUSD(o.unrealized_pnl)}</td>
                    <td style={tdRight}>{fmtNum(o.greeks?.delta ?? null, 2)}</td>
                    <td style={tdRight}>{fmtNum(o.greeks?.gamma ?? null, 2)}</td>
                    <td style={tdRight}>{fmtNum(o.greeks?.vega ?? null, 2)}</td>
                    <td style={tdRight}>{fmtNum(o.greeks?.theta ?? null, 2)}</td>
                    <td style={td}>{o.account}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (hasEquity || hasOptions) && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 6,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <span className="rv-sub" style={{ marginRight: 8 }}>Aggregate</span>
          <span>Δ {fmtNum(report.aggregate_greeks.delta, 2)}</span>
          <span style={{ marginLeft: 12 }}>Γ {fmtNum(report.aggregate_greeks.gamma, 2)}</span>
          <span style={{ marginLeft: 12 }}>V {fmtNum(report.aggregate_greeks.vega, 2)}</span>
          <span style={{ marginLeft: 12 }}>Θ {fmtNum(report.aggregate_greeks.theta, 2)}</span>
          <span style={{ marginLeft: 12 }}>ρ {fmtNum(report.aggregate_greeks.rho, 2)}</span>
        </div>
      )}

      {report && report.activity.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute, #888)' }}>
            Recent activity ({report.activity.length})
          </summary>
          <div
            style={{
              marginTop: 6,
              maxHeight: 200,
              overflowY: 'auto',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
            }}
          >
            {report.activity.slice(0, 25).map((r, i) => (
              <div
                key={i}
                style={{ padding: '2px 0', borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
              >
                <span style={{ color: 'var(--ink-mute, #888)' }}>{r.activity_date}</span>
                {' · '}
                <span style={{ color: 'var(--gold, #FFD700)' }}>{r.trans_code}</span>
                {r.quantity != null && ` · qty ${r.quantity}`}
                {r.price != null && ` · px ${r.price}`}
                {r.amount != null && ` · ${fmtUSD(r.amount)}`}
                {r.description && (
                  <div style={{ color: 'var(--ink-mute, #888)', paddingLeft: 12 }}>{r.description}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '4px 8px', fontWeight: 500, fontSize: 10 };
const thRight: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '4px 8px' };
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };
