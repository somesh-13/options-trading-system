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
  hedgeByUnderlying?: Record<string, unknown> | null;
  deltaGammaHedge?: Record<string, unknown> | null;
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

type HedgeRow = {
  underlying: string;
  spot: number | null;
  share_qty: number;
  option_legs: number;
  option_delta: number;
  option_gamma: number;
  total_delta: number;
  hedge_shares: number;
  hedge_direction: string;
  hedge_notional: number | null;
};

function ReadonlyHedgeByUnderlying({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows as HedgeRow[]) ?? [];
  const totals = data.totals as
    | { underlyings: number; total_delta: number; total_gamma: number; total_hedge_notional: number; total_hedge_shares_abs: number }
    | undefined;
  if (rows.length === 0) {
    return <div className="rv-sub" style={{ fontSize: 11 }}>no rows</div>;
  }
  const top = rows.slice(0, 8);
  return (
    <>
      {totals && (
        <div style={{ ...monoGrid, marginBottom: 6 }}>
          <div>underlyings</div><div>{totals.underlyings}</div>
          <div>Σ Δ</div><div className={sign(totals.total_delta)}>{fmtNum(totals.total_delta)}</div>
          <div>Σ Γ</div><div>{fmtNum(totals.total_gamma)}</div>
          <div>Σ |shares|</div><div>{fmtNum(totals.total_hedge_shares_abs, 0)}</div>
          <div>Σ notional</div><div>{fmtMoney(totals.total_hedge_notional)}</div>
        </div>
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          borderTop: '1px solid var(--line)',
          paddingTop: 6,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 1fr 0.9fr 1.1fr', gap: 4, color: 'var(--ink-dim)' }}>
          <div>sym</div><div style={{ textAlign: 'right' }}>Δ</div><div style={{ textAlign: 'right' }}>Γ</div><div style={{ textAlign: 'right' }}>shares</div><div style={{ textAlign: 'right' }}>notional</div>
        </div>
        {top.map((r) => (
          <div
            key={r.underlying}
            style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 1fr 0.9fr 1.1fr', gap: 4 }}
          >
            <div>{r.underlying}</div>
            <div className={sign(r.total_delta)} style={{ textAlign: 'right' }}>{fmtNum(r.total_delta, 0)}</div>
            <div style={{ textAlign: 'right' }}>{fmtNum(r.option_gamma, 0)}</div>
            <div
              className={r.hedge_direction === 'BUY' ? 'rv-up' : r.hedge_direction === 'SELL' ? 'rv-dn' : ''}
              style={{ textAlign: 'right' }}
            >
              {r.hedge_direction === 'NONE' ? '—' : `${r.hedge_direction[0]} ${Math.abs(r.hedge_shares)}`}
            </div>
            <div style={{ textAlign: 'right' }}>{fmtMoney(r.hedge_notional)}</div>
          </div>
        ))}
        {rows.length > top.length && (
          <div className="rv-sub" style={{ fontSize: 10, marginTop: 2 }}>
            +{rows.length - top.length} more
          </div>
        )}
      </div>
    </>
  );
}

type DeltaGammaRow = {
  underlying: string;
  spot: number;
  delta_book: number;
  gamma_book: number;
  hedge_option: {
    type: string;
    strike: number;
    dte_days: number;
    iv_used: number;
    delta_per_contract: number;
    gamma_per_contract: number;
  } | null;
  hedge_contracts: number;
  hedge_contracts_action: string;
  hedge_shares: number;
  hedge_shares_action: string;
  residual_gamma: number;
  residual_delta: number;
  note?: string;
};

function ReadonlyDeltaGammaHedge({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows as DeltaGammaRow[]) ?? [];
  const params = data.params as { hedge_dte: number; hedge_option_type: string } | undefined;
  if (rows.length === 0) {
    return <div className="rv-sub" style={{ fontSize: 11 }}>no rows</div>;
  }
  return (
    <>
      {params && (
        <div className="rv-sub" style={{ fontSize: 10, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
          ATM {params.hedge_option_type.toUpperCase()} · DTE {params.hedge_dte}d · 2-step: kill Γ with options, then flatten Δ with shares
        </div>
      )}
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rows.slice(0, 6).map((r) => {
          const cAct = r.hedge_contracts_action;
          const sAct = r.hedge_shares_action;
          const ho = r.hedge_option;
          // Show the working: Δ_book − (n_contracts × Δ_per_contract) = residual_after_options.
          // n_shares is the round of that residual, with sign flipped.
          // Sign convention: SELL contracts = negative qty, so we *add* in the formula
          // when contracts are sold (their delta contribution to the book is −Δ_per_contract).
          const deltaShift = ho ? r.hedge_contracts * ho.delta_per_contract : 0;
          const afterOptions = r.delta_book + deltaShift;
          return (
            <div
              key={r.underlying}
              style={{ borderTop: '1px solid var(--line)', paddingTop: 4 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.underlying}</strong>
                <span className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
                  Δ {fmtNum(r.delta_book, 0)} · Γ {fmtNum(r.gamma_book, 0)}
                </span>
              </div>
              {ho ? (
                <div>
                  <div>
                    <span className={cAct === 'BUY' ? 'rv-up' : cAct === 'SELL' ? 'rv-dn' : ''}>
                      {cAct === 'NONE' ? 'no option' : `${cAct} ${Math.abs(r.hedge_contracts)}`}
                    </span>
                    {' '}
                    <span className="rv-sub" style={{ margin: 0 }}>
                      {ho.type.toUpperCase()} K=${fmtNum(ho.strike)} (Δ/ct {fmtNum(ho.delta_per_contract, 0)}, Γ/ct {fmtNum(ho.gamma_per_contract, 0)})
                    </span>
                  </div>
                  <div className="rv-sub" style={{ fontSize: 9, margin: '2px 0 0 0' }}>
                    math · Δ_book {r.delta_book >= 0 ? '+' : ''}{fmtNum(r.delta_book, 0)}
                    {deltaShift !== 0 && (
                      <> {deltaShift >= 0 ? '+' : '−'} ({Math.abs(r.hedge_contracts)} × {fmtNum(Math.abs(ho.delta_per_contract), 1)}) </>
                    )}
                    {' = '}{fmtNum(afterOptions, 0)} → {sAct === 'NONE' ? 'flat' : `${sAct} ${Math.abs(r.hedge_shares)} sh`}
                  </div>
                  <div className="rv-sub" style={{ fontSize: 9, margin: 0 }}>
                    residual after both legs · Δ {fmtNum(r.residual_delta, 1)} · Γ {fmtNum(r.residual_gamma, 1)}
                  </div>
                </div>
              ) : (
                <div className="rv-sub" style={{ fontSize: 10 }}>
                  share-only · {sAct === 'NONE' ? 'flat' : `${sAct} ${Math.abs(r.hedge_shares)} sh`}
                  {' '}{r.note ? `(${r.note})` : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ExplainButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="rv-btn ghost"
      onClick={onClick}
      style={{
        marginTop: 6,
        fontSize: 10,
        padding: '2px 8px',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      Explain ▾
    </button>
  );
}

function ReadonlyRebalance({
  data,
  onExplain,
}: {
  data: Record<string, unknown>;
  onExplain?: () => void;
}) {
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
      {onExplain && d.breach_count > 0 && <ExplainButton onClick={onExplain} />}
    </>
  );
}

function ReadonlyLimits({
  data,
  onExplain,
}: {
  data: Record<string, unknown>;
  onExplain?: () => void;
}) {
  const d = data as {
    status: string;
    risk_score: number;
    action: string;
    violations: Array<{ greek: string; utilization_pct: number; level: string; current?: number; limit?: number }>;
    warnings: Array<{ greek: string; utilization_pct: number; level: string; current?: number; limit?: number }>;
  };
  const hasIssues = (d.violations?.length ?? 0) + (d.warnings?.length ?? 0) > 0;
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <span className={`rv-chip ${d.status === 'OK' ? 'buy' : d.status === 'WARNING' ? 'sell' : 'warn'}`}>
          {d.status} · score {d.risk_score}
        </span>
      </div>
      <div className="rv-sub" style={{ fontSize: 11 }}>{d.action}</div>
      {onExplain && hasIssues && <ExplainButton onClick={onExplain} />}
    </>
  );
}

// ---- BreachDetailOverlay ----------------------------------------------------
//
// Modal that explains *why* a Greek is breaching limits — lists the per-leg
// contributors sorted by absolute contribution, then prescribes concrete
// trades pulled from the same snapshot's hedgeByUnderlying / deltaGammaHedge
// data. Shared by both Rebalance triggers and Position limits cards.

type Breach = { greek: string; current: number; limit: number; severity: string };

type PerPositionLeg = {
  underlying?: string;
  expiry?: string;
  strike?: number;
  type?: string;
  qty?: number;
  greeks?: { delta?: number; gamma?: number; vega?: number; theta?: number; rho?: number };
};

const GREEK_ADVICE: Record<string, { what: string; how: string[] }> = {
  delta: {
    what: 'Δ measures directional exposure: how much $ the book moves per $1 move in the basket. Excess long Δ = book moves up with market; excess short = inverse.',
    how: [
      'Per-underlying share hedge — see "Hedge per underlying" card. Sells the right share count *per ticker* using each name\'s own spot.',
      'Δ-Γ hedge — also kills Γ in the same trade.',
      'Or close the highest-Δ option legs (esp. deep ITM long calls / long puts).',
    ],
  },
  gamma: {
    what: 'Γ measures how fast Δ changes when the underlying moves. High Γ means your Δ hedge needs constant re-balancing — share-only hedges drift quickly.',
    how: [
      'Shares carry Γ=0, so you must trade *another option* to neutralize Γ. See "Δ-Γ hedge" card.',
      'Sell ATM short-dated calls/puts on the highest-Γ underlyings — max Γ per contract sits at ATM, decays toward expiry.',
      'Or close long ATM legs (they\'re your Γ source).',
    ],
  },
  vega: {
    what: 'ν measures sensitivity to implied vol. Long ν = you make money if IV rises; short ν = you make money if IV falls.',
    how: [
      'Reduce vega: close longest-DTE long options (vega is highest at long expiries).',
      'Or sell options with offsetting vega on the same underlying.',
      'If you want short vol exposure (IV-crush thesis), this isn\'t a breach — adjust your limit.',
    ],
  },
  theta: {
    what: 'Θ is daily decay from time. Long Θ = collecting decay; short Θ = paying decay.',
    how: [
      'Roll long calls/puts to longer expiries to slow decay.',
      'Close ATM short-dated longs first — they bleed the most Θ.',
      'Sell some ATM short-dated options to collect decay (also kills Γ — see Δ-Γ hedge).',
    ],
  },
};

function BreachDetailOverlay({
  open,
  onClose,
  title,
  breaches,
  portfolio,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  breaches: Breach[];
  portfolio: PortfolioSnapshot;
}) {
  if (!open) return null;

  const greeksData = portfolio.greeks as { per_position?: PerPositionLeg[]; position_count?: number } | null | undefined;
  const perPositions: PerPositionLeg[] = greeksData?.per_position ?? [];

  const hbu = portfolio.hedgeByUnderlying as
    | { rows?: HedgeRow[]; totals?: { total_hedge_shares_abs: number; total_hedge_notional: number; underlyings: number } }
    | null
    | undefined;
  const dgh = portfolio.deltaGammaHedge as
    | { rows?: DeltaGammaRow[]; params?: { hedge_dte: number; hedge_option_type: string } }
    | null
    | undefined;

  function topContributors(greek: string, limit = 8) {
    const key = greek as keyof NonNullable<PerPositionLeg['greeks']>;
    const enriched = perPositions
      .map((leg) => {
        const v = leg.greeks?.[key];
        return { leg, v: typeof v === 'number' ? v : 0 };
      })
      .filter((x) => Number.isFinite(x.v) && Math.abs(x.v) > 0)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .slice(0, limit);
    return enriched;
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '4vh 12px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={stop}
        className="rv-card"
        style={{
          width: 'min(820px, 96vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 16,
          background: 'var(--surface-raised, #161616)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
          <button
            type="button"
            className="rv-btn ghost"
            onClick={onClose}
            style={{ fontSize: 11, padding: '2px 10px' }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>

        {breaches.length === 0 && (
          <div className="rv-sub" style={{ fontSize: 12 }}>No breaches in this report.</div>
        )}

        {breaches.map((b, i) => {
          const advice = GREEK_ADVICE[b.greek] ?? {
            what: '',
            how: ['No specific guidance for this Greek — close exposure or widen the limit.'],
          };
          const contribs = topContributors(b.greek);
          const utilization = b.limit !== 0 ? (Math.abs(b.current) / Math.abs(b.limit)) * 100 : 0;

          return (
            <div key={`${b.greek}-${i}`} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)', paddingTop: i === 0 ? 0 : 14, marginTop: i === 0 ? 0 : 14 }}>
              {/* Headline */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <strong style={{ fontSize: 13, textTransform: 'uppercase' }}>{b.greek}</strong>
                <span className={b.severity === 'HIGH' ? 'rv-dn' : 'rv-sub'} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                  {fmtNum(b.current)} / {fmtNum(b.limit)} ({utilization.toFixed(0)}% of limit) · {b.severity}
                </span>
              </div>

              {/* Plain-English what-it-means */}
              {advice.what && (
                <div className="rv-sub" style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
                  {advice.what}
                </div>
              )}

              {/* Top contributing positions */}
              <div style={{ marginBottom: 10 }}>
                <div className="rv-sub" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                  Top contributors
                </div>
                {contribs.length === 0 ? (
                  <div className="rv-sub" style={{ fontSize: 11 }}>No per-leg breakdown available.</div>
                ) : (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 0.7fr 0.6fr 0.6fr 0.6fr 0.6fr',
                        gap: 4,
                        color: 'var(--ink-dim)',
                      }}
                    >
                      <div>leg</div>
                      <div>expiry</div>
                      <div style={{ textAlign: 'right' }}>strike</div>
                      <div style={{ textAlign: 'right' }}>type</div>
                      <div style={{ textAlign: 'right' }}>qty</div>
                      <div style={{ textAlign: 'right' }}>{b.greek} contrib</div>
                    </div>
                    {contribs.map((c, idx) => (
                      <div
                        key={idx}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 0.6fr 0.6fr 0.6fr 0.6fr', gap: 4 }}
                      >
                        <div>{c.leg.underlying ?? '?'}</div>
                        <div>{c.leg.expiry ?? '?'}</div>
                        <div style={{ textAlign: 'right' }}>{fmtNum(c.leg.strike, 0)}</div>
                        <div style={{ textAlign: 'right' }}>{(c.leg.type ?? '?').toUpperCase()}</div>
                        <div style={{ textAlign: 'right' }}>{fmtNum(c.leg.qty, 0)}</div>
                        <div className={sign(c.v)} style={{ textAlign: 'right' }}>{fmtNum(c.v, 1)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Possible solutions */}
              <div style={{ marginBottom: 10 }}>
                <div className="rv-sub" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                  Possible solutions
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
                  {advice.how.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              </div>

              {/* Concrete prescription pulled from the snapshot */}
              {b.greek === 'delta' && hbu?.rows && hbu.rows.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="rv-sub" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                    Concrete fix from this report (per-underlying share hedge)
                  </div>
                  <div className="rv-sub" style={{ fontSize: 11, marginBottom: 4 }}>
                    Total: {hbu.totals?.total_hedge_shares_abs ?? 0} shares across {hbu.totals?.underlyings ?? 0} tickers · {fmtMoney(hbu.totals?.total_hedge_notional)} notional
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                    {hbu.rows.slice(0, 6).map((r) => (
                      <div key={r.underlying} style={{ display: 'grid', gridTemplateColumns: '0.6fr 0.6fr 0.6fr 0.8fr', gap: 4 }}>
                        <div>{r.underlying}</div>
                        <div className={sign(r.total_delta)} style={{ textAlign: 'right' }}>Δ {fmtNum(r.total_delta, 0)}</div>
                        <div
                          className={r.hedge_direction === 'BUY' ? 'rv-up' : r.hedge_direction === 'SELL' ? 'rv-dn' : ''}
                          style={{ textAlign: 'right' }}
                        >
                          {r.hedge_direction === 'NONE' ? '—' : `${r.hedge_direction[0]} ${Math.abs(r.hedge_shares)}`}
                        </div>
                        <div style={{ textAlign: 'right' }}>{fmtMoney(r.hedge_notional)}</div>
                      </div>
                    ))}
                    {hbu.rows.length > 6 && (
                      <div className="rv-sub" style={{ fontSize: 10, marginTop: 2 }}>+{hbu.rows.length - 6} more in Hedge per underlying card</div>
                    )}
                  </div>
                </div>
              )}

              {b.greek === 'gamma' && dgh?.rows && dgh.rows.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="rv-sub" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                    Concrete fix from this report (Δ-Γ hedge)
                  </div>
                  <div className="rv-sub" style={{ fontSize: 11, marginBottom: 4 }}>
                    {dgh.params ? `ATM ${dgh.params.hedge_option_type.toUpperCase()} · DTE ${dgh.params.hedge_dte}d ·` : ''} kills Γ via options, then flattens Δ with shares.
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                    {dgh.rows.slice(0, 6).map((r) => {
                      const cAct = r.hedge_contracts_action;
                      const sAct = r.hedge_shares_action;
                      const ho = r.hedge_option;
                      return (
                        <div key={r.underlying} style={{ borderTop: '1px solid var(--line)', paddingTop: 3, marginTop: 3 }}>
                          <strong>{r.underlying}</strong>{' '}
                          <span className="rv-sub">Γ {fmtNum(r.gamma_book, 0)} · Δ {fmtNum(r.delta_book, 0)}</span>
                          <div>
                            {ho ? (
                              <>
                                <span className={cAct === 'BUY' ? 'rv-up' : cAct === 'SELL' ? 'rv-dn' : ''}>
                                  {cAct === 'NONE' ? '—' : `${cAct} ${Math.abs(r.hedge_contracts)}`}
                                </span>{' '}
                                {ho.type.toUpperCase()} K=${fmtNum(ho.strike)} ·{' '}
                                <span className={sAct === 'BUY' ? 'rv-up' : sAct === 'SELL' ? 'rv-dn' : ''}>
                                  {sAct === 'NONE' ? 'flat' : `${sAct} ${Math.abs(r.hedge_shares)} sh`}
                                </span>
                              </>
                            ) : (
                              <span className="rv-sub">share-only · {sAct === 'NONE' ? 'flat' : `${sAct} ${Math.abs(r.hedge_shares)} sh`}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {dgh.rows.length > 6 && (
                      <div className="rv-sub" style={{ fontSize: 10, marginTop: 2 }}>+{dgh.rows.length - 6} more in Δ-Γ hedge card</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="rv-sub" style={{ fontSize: 10, marginTop: 14, paddingTop: 8, borderTop: '1px solid var(--line)', lineHeight: 1.5 }}>
          Contributions are computed from this report&apos;s saved per-leg Greeks. Reduction trades are pulled from the same report&apos;s
          {' '}<em>Hedge per underlying</em> and <em>Δ-Γ hedge</em> sections — they reflect the prices/IV at the time the report ran.
          Re-run analytics for fresh prescriptions.
        </div>
      </div>
    </div>
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

  // Overlay state — both Rebalance and Position-limits cards open the same
  // BreachDetailOverlay. The overlay receives the breach list and the rest
  // of the snapshot (greeks per_position, hedgeByUnderlying, deltaGammaHedge)
  // so it can both *explain* what's contributing and *prescribe* a concrete fix.
  const [overlay, setOverlay] = useState<
    | { kind: 'rebalance' | 'limits'; title: string; breaches: Breach[] }
    | null
  >(null);

  const rebalance = portfolio.rebalance as
    | { breaches?: Breach[]; needs_rebalance?: boolean }
    | null
    | undefined;
  const limits = portfolio.limits as
    | { violations?: Array<{ greek: string; current?: number; limit?: number; level: string }>; warnings?: Array<{ greek: string; current?: number; limit?: number; level: string }> }
    | null
    | undefined;

  const openRebalance = () => {
    if (!rebalance?.breaches?.length) return;
    setOverlay({ kind: 'rebalance', title: 'Rebalance triggers — explained', breaches: rebalance.breaches });
  };

  const openLimits = () => {
    // Limits payload uses utilization_pct + level rather than current/limit/severity.
    // We synthesise current/limit from the saved portfolio_greeks total when missing,
    // then map level → severity for the overlay's shared shape.
    const portfolioGreeks = (portfolio.greeks as Record<string, number> | null) ?? {};
    const merged: Breach[] = [];
    for (const v of [...(limits?.violations ?? []), ...(limits?.warnings ?? [])]) {
      const totalKey = `total_${v.greek}` as keyof typeof portfolioGreeks;
      const cur = typeof v.current === 'number' ? v.current : Number(portfolioGreeks[totalKey] ?? 0);
      // Reverse-engineer the limit from utilization_pct if needed.
      const lim =
        typeof v.limit === 'number'
          ? v.limit
          : (() => {
              const util = (v as unknown as { utilization_pct?: number }).utilization_pct ?? 0;
              return util > 0 ? (Math.abs(cur) / (util / 100)) * Math.sign(cur || 1) : 0;
            })();
      merged.push({
        greek: v.greek,
        current: cur,
        limit: lim,
        severity: v.level === 'VIOLATION' ? 'HIGH' : v.level === 'WARNING' ? 'MEDIUM' : v.level,
      });
    }
    if (merged.length === 0) return;
    setOverlay({ kind: 'limits', title: 'Position limits — explained', breaches: merged });
  };

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
      <StatCard title={<>Hedge per underlying</>}>
        {portfolio.hedgeByUnderlying ? (
          <ReadonlyHedgeByUnderlying data={portfolio.hedgeByUnderlying as Record<string, unknown>} />
        ) : na}
      </StatCard>
      <StatCard title={<>Δ-Γ hedge (top Γ)</>}>
        {portfolio.deltaGammaHedge ? (
          <ReadonlyDeltaGammaHedge data={portfolio.deltaGammaHedge as Record<string, unknown>} />
        ) : na}
      </StatCard>
      <StatCard title={<>Rebalance triggers<InfoIcon term="rebalance" /></>}>
        {portfolio.rebalance ? (
          <ReadonlyRebalance
            data={portfolio.rebalance as Record<string, unknown>}
            onExplain={openRebalance}
          />
        ) : na}
      </StatCard>
      <StatCard title={<>Position limits<InfoIcon term="position-limits" /></>}>
        {portfolio.limits ? (
          <ReadonlyLimits
            data={portfolio.limits as Record<string, unknown>}
            onExplain={openLimits}
          />
        ) : na}
      </StatCard>
      <StatCard title={<>Stress test</>}>
        {portfolio.stress ? <ReadonlyStress data={portfolio.stress as Record<string, unknown>} /> : na}
      </StatCard>
      <StatCard title={<>Drawdown<InfoIcon term="drawdown" /></>}>
        {portfolio.drawdown ? <ReadonlyDrawdown data={portfolio.drawdown as Record<string, unknown>} /> : na}
      </StatCard>

      <BreachDetailOverlay
        open={overlay !== null}
        onClose={() => setOverlay(null)}
        title={overlay?.title ?? ''}
        breaches={overlay?.breaches ?? []}
        portfolio={portfolio}
      />
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
