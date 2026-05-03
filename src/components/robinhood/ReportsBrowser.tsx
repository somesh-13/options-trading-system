'use client';

/**
 * Browses persisted analytics report runs. Renders a date-grouped list of
 * saved "Run all" snapshots and lets the user load any run for read-only
 * inspection using the same grid layout as the live Analytics tab.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { InfoIcon } from '@/components/ui/InfoIcon';
import {
  getAnalyticsRuns,
  getAnalyticsRun,
  type AnalyticsRunMeta,
  type AnalyticsRunFull,
} from '@/lib/robinhood-analytics-api';
import { TickerVerdict, conviction } from './TickerVerdict';

// ---- formatters -------------------------------------------------------------

const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const s = n < 0 ? '−' : '';
  return `${s}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtPct = (n: number | null | undefined, digits = 2): string => {
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
};

const sign = (n: number) => (n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

const monoGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px 10px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
};

// ---- date grouping ----------------------------------------------------------

function groupByDate(runs: AnalyticsRunMeta[]): [string, AnalyticsRunMeta[]][] {
  const map = new Map<string, AnalyticsRunMeta[]>();
  for (const r of runs) {
    const day = r.created_at.slice(0, 10); // YYYY-MM-DD
    const bucket = map.get(day) ?? [];
    bucket.push(r);
    map.set(day, bucket);
  }
  // already newest-first from API, preserve order
  return Array.from(map.entries());
}

function timeFromIso(iso: string): string {
  // Extract HH:MM from ISO string (already UTC, show as-is)
  const t = iso.slice(11, 16);
  return t || iso;
}

// ---- read-only analytics grid ----------------------------------------------

interface PortfolioSnapshot {
  greeks?: Record<string, unknown> | null;
  hedge?: Record<string, unknown> | null;
  rebalance?: Record<string, unknown> | null;
  limits?: Record<string, unknown> | null;
  stress?: Record<string, unknown> | null;
  drawdown?: Record<string, unknown> | null;
}

interface ReportPayload {
  portfolio?: PortfolioSnapshot;
  perTicker?: Record<string, { status: string; data?: unknown; error?: string }>;
  tickers?: string[];
  timestamp?: string;
}

function ReadonlyGreeks({ data }: { data: Record<string, unknown> }) {
  const d = data as Record<string, number>;
  return (
    <div style={monoGrid}>
      <div>Δ delta<InfoIcon term="delta" /></div><div className={sign(d.total_delta)}>{fmtNum(d.total_delta)}</div>
      <div>Γ gamma<InfoIcon term="gamma" /></div><div>{fmtNum(d.total_gamma)}</div>
      <div>𝜈 vega<InfoIcon term="vega" /></div><div>{fmtNum(d.total_vega)}</div>
      <div>Θ theta<InfoIcon term="theta" /></div><div className={sign(d.total_theta)}>{fmtNum(d.total_theta)}</div>
      <div>ρ rho<InfoIcon term="rho" /></div><div>{fmtNum(d.total_rho)}</div>
      <div>legs</div><div>{d.position_count}</div>
    </div>
  );
}

function ReadonlyHedge({ data }: { data: Record<string, unknown> }) {
  const d = data as Record<string, unknown>;
  const dir = d.hedge_direction as string;
  const shares = d.hedge_shares as number;
  const notional = d.hedge_notional as number;
  const cur = d.current_delta as number;
  return (
    <div style={monoGrid}>
      <div>current Δ</div><div className={sign(cur)}>{fmtNum(cur)}</div>
      <div>target Δ</div><div>{fmtNum(d.target_delta as number)}</div>
      <div>shares</div>
      <div className={dir === 'BUY' ? 'rv-up' : dir === 'SELL' ? 'rv-dn' : ''}>
        {dir} {Math.abs(shares)}
      </div>
      <div>notional</div><div>{fmtMoney(notional)}</div>
    </div>
  );
}

function ReadonlyRebalance({ data }: { data: Record<string, unknown> }) {
  const d = data as { needs_rebalance: boolean; max_severity: string; breach_count: number; breaches: Array<{ greek: string; current: number; limit: number; severity: string }> };
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <span className={`rv-chip ${d.needs_rebalance ? 'sell' : 'buy'}`}>
          {d.needs_rebalance ? `REBALANCE · ${d.max_severity}` : 'within limits'}
        </span>
        <span className="rv-sub" style={{ marginLeft: 8, fontSize: 11 }}>{d.breach_count} breach(es)</span>
      </div>
      {d.breaches?.length > 0 && (
        <div style={monoGrid}>
          {d.breaches.map((b) => (
            <Fragment key={b.greek}>
              <div>{b.greek}</div>
              <div className="rv-dn">{fmtNum(b.current)} / {fmtNum(b.limit)} ({b.severity})</div>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

function ReadonlyLimits({ data }: { data: Record<string, unknown> }) {
  const d = data as { status: string; risk_score: number; action: string; violations: Array<{ greek: string; utilization_pct: number; level: string }>; warnings: Array<{ greek: string; utilization_pct: number; level: string }> };
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <span className={`rv-chip ${d.status === 'OK' ? 'buy' : d.status === 'WARNING' ? 'sell' : 'warn'}`}>
          {d.status} · score {d.risk_score}
        </span>
      </div>
      <div className="rv-sub" style={{ fontSize: 11 }}>{d.action}</div>
    </>
  );
}

function ReadonlyStress({ data }: { data: Record<string, unknown> }) {
  const d = data as { total_pnl: number; spot_shock_pct: number; vol_shock_pct: number; total_attribution: Record<string, number> };
  return (
    <div style={monoGrid}>
      <div>spot shock</div><div>{fmtPct((d.spot_shock_pct ?? 0) * 100)}</div>
      <div>vol shock</div><div>{fmtPct((d.vol_shock_pct ?? 0) * 100)}</div>
      <div>total P&L</div><div className={sign(d.total_pnl ?? 0)}>{fmtMoney(d.total_pnl)}</div>
      {d.total_attribution && Object.entries(d.total_attribution).slice(0, 5).map(([k, v]) => (
        <Fragment key={k}><div>{k}</div><div className={sign(v)}>{fmtMoney(v)}</div></Fragment>
      ))}
    </div>
  );
}

function ReadonlyDrawdown({ data }: { data: Record<string, unknown> }) {
  const d = data as { current_equity: number; peak_equity: number; drawdown_pct: number; breached: boolean; remaining_buffer_pct: number; action: string; inputs?: { total_invested: number; market_value: number; cash_flows: number } };
  const cost = d.inputs?.total_invested ?? 0;
  const market = d.inputs?.market_value ?? 0;
  const unrealized = market - cost;
  const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : 0;
  return (
    <div style={monoGrid}>
      <div>NAV</div><div>{fmtMoney(d.current_equity)}</div>
      <div>drawdown</div><div className={d.breached ? 'rv-dn' : ''}>{fmtPct(d.drawdown_pct)}</div>
      <div>cost basis</div><div>{fmtMoney(cost)}</div>
      <div>unrealized</div>
      <div className={sign(unrealized)}>
        {fmtMoney(unrealized)} ({unrealized >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
      </div>
      <div>peak</div><div>{fmtMoney(d.peak_equity)}</div>
      <div>buffer</div><div>{fmtPct(d.remaining_buffer_pct)}</div>
    </div>
  );
}

function StatCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rv-card" style={{ padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{title}</h3>
      {children}
    </div>
  );
}

function PortfolioGrid({ portfolio }: { portfolio: PortfolioSnapshot }) {
  const na = <div className="rv-sub" style={{ fontSize: 11 }}>no data in this run</div>;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <StatCard title={<>Portfolio Greeks</>}>
        {portfolio.greeks ? <ReadonlyGreeks data={portfolio.greeks as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Hedge ratio (Δ-neutral)<InfoIcon term="hedge-ratio" /></>}>
        {portfolio.hedge ? <ReadonlyHedge data={portfolio.hedge as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Rebalance triggers<InfoIcon term="rebalance" /></>}>
        {portfolio.rebalance ? <ReadonlyRebalance data={portfolio.rebalance as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Position limits<InfoIcon term="position-limits" /></>}>
        {portfolio.limits ? <ReadonlyLimits data={portfolio.limits as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Stress test</>}>
        {portfolio.stress ? <ReadonlyStress data={portfolio.stress as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Drawdown<InfoIcon term="drawdown" /></>}>
        {portfolio.drawdown ? <ReadonlyDrawdown data={portfolio.drawdown as Record<string, unknown>} /> : na}
      </StatCard>
    </div>
  );
}


type PerTickerEntry = { status: string; data?: unknown; error?: string };

function PerTickerGrid({
  tickers,
  perTicker,
}: {
  tickers: string[];
  perTicker: Record<string, PerTickerEntry>;
}) {
  // Normalise saved entries into the AsyncState shape TickerVerdict expects.
  const results: Record<string, { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: unknown } | { status: 'err'; error: string }> = {};
  for (const [key, entry] of Object.entries(perTicker)) {
    if (entry.status === 'ok') {
      results[key] = { status: 'ok', data: entry.data };
    } else if (entry.status === 'err') {
      results[key] = { status: 'err', error: entry.error ?? 'error' };
    } else if (entry.status === 'loading') {
      results[key] = { status: 'loading' };
    } else {
      results[key] = { status: 'idle' };
    }
  }

  // Sort tickers by conviction (highest first) for the compact read-only view.
  const sorted = [...tickers].sort(
    (a, b) => conviction(results, b) - conviction(results, a),
  );

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        marginBottom: 14,
      }}
    >
      {sorted.length === 0 ? (
        <div className="rv-sub" style={{ padding: 10 }}>no tickers in this run</div>
      ) : (
        sorted.map((t, idx) => (
          <div
            key={t}
            style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <TickerVerdict ticker={t} results={results} />
          </div>
        ))
      )}
    </div>
  );
}

// ---- main component ---------------------------------------------------------

export function ReportsBrowser() {
  const [runs, setRuns] = useState<AnalyticsRunMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [loadingRun, setLoadingRun] = useState<number | null>(null);
  const [openRun, setOpenRun] = useState<AnalyticsRunFull | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  useEffect(() => {
    setLoadingList(true);
    getAnalyticsRuns(100)
      .then((r) => {
        setRuns(r);
        setListErr(null);
      })
      .catch((e: Error) => setListErr(e.message))
      .finally(() => setLoadingList(false));
  }, []);

  const loadRun = useCallback(async (id: number) => {
    if (loadingRun === id) return;
    setLoadingRun(id);
    setRunErr(null);
    setOpenRun(null);
    try {
      const full = await getAnalyticsRun(id);
      setOpenRun(full);
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Failed to load run');
    } finally {
      setLoadingRun(null);
    }
  }, [loadingRun]);

  const groups = groupByDate(runs);

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Saved reports · {runs.length}</h3>
        <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
          auto-saved after each &quot;Run all&quot; · click Load to inspect
        </span>
      </div>

      {loadingList && (
        <div className="rv-sub" style={{ fontSize: 11, marginBottom: 10 }}>loading…</div>
      )}
      {listErr && (
        <div style={{ color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
          error: {listErr}
        </div>
      )}

      {!loadingList && runs.length === 0 && !listErr && (
        <div className="rv-sub" style={{ fontSize: 11 }}>
          No saved runs yet. Click ▶ Run all in the Analytics tab to create the first one.
        </div>
      )}

      {groups.map(([day, dayRuns]) => (
        <div key={day} style={{ marginBottom: 12 }}>
          <div
            className="rv-sub"
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 4,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            {day}
          </div>
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {dayRuns.map((run, idx) => {
              const isOpen = openRun?.run_id === run.run_id;
              return (
                <div key={run.run_id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                      background: isOpen ? 'rgba(255,215,0,0.04)' : undefined,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: 'var(--ink-dim)', minWidth: 40 }}>
                      {timeFromIso(run.created_at)}
                    </span>
                    <span style={{ color: 'var(--ink)' }}>
                      #{run.run_id}
                    </span>
                    {run.ticker_count != null && (
                      <span className="rv-sub" style={{ margin: 0 }}>
                        {run.ticker_count} ticker{run.ticker_count === 1 ? '' : 's'}
                      </span>
                    )}
                    {run.account && run.account !== 'all' && (
                      <span
                        className="rv-chip"
                        style={{ fontSize: 9 }}
                      >
                        {run.account}
                      </span>
                    )}
                    {run.notes && (
                      <span className="rv-sub" style={{ margin: 0, fontStyle: 'italic' }}>
                        {run.notes}
                      </span>
                    )}
                    <button
                      type="button"
                      className="rv-btn ghost"
                      style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px' }}
                      disabled={loadingRun === run.run_id}
                      onClick={() => isOpen ? setOpenRun(null) : loadRun(run.run_id)}
                    >
                      {loadingRun === run.run_id ? '…' : isOpen ? 'Close' : 'Load'}
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        borderTop: '1px solid var(--line)',
                        padding: '12px 12px 4px',
                        background: 'var(--surface-raised, #161616)',
                      }}
                    >
                      <div
                        className="rv-sub"
                        style={{ fontSize: 10, marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        snapshot · {openRun.created_at}
                        {(openRun.payload as ReportPayload)?.timestamp
                          ? ` · run at ${(openRun.payload as ReportPayload).timestamp}`
                          : ''}
                        {' '}· read-only
                      </div>

                      {(() => {
                        const payload = openRun.payload as ReportPayload;
                        const portfolio = payload?.portfolio ?? {};
                        const perTicker = payload?.perTicker ?? {};
                        const tickers = payload?.tickers ?? [];
                        return (
                          <>
                            <PortfolioGrid portfolio={portfolio} />
                            <div className="rv-sub" style={{ marginBottom: 8 }}>
                              Per-ticker · {tickers.length} ticker{tickers.length === 1 ? '' : 's'}
                            </div>
                            <PerTickerGrid tickers={tickers} perTicker={perTicker as Record<string, { status: string; data?: unknown; error?: string }>} />
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {runErr && (
        <div style={{ color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>
          load error: {runErr}
        </div>
      )}
    </div>
  );
}
