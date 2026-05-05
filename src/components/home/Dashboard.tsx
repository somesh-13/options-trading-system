'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IvHvScale } from '@/components/charts/IvHvScale';
import { getMispricing, getEngineLogs, type MispricingData } from '@/lib/pricing-api';
import {
  getRobinhoodHoldings,
  getRobinhoodSummary,
  type RobinhoodHoldingsResponse,
  type RobinhoodSummary,
} from '@/lib/robinhood-api';
import {
  getPortfolioGreeks,
  type PortfolioGreeksResult,
} from '@/lib/robinhood-analytics-api';

/**
 * Home dashboard — wired to live data.
 *
 *   KPIs           ← /api/robinhood/summary?source=live
 *   Opportunities  ← getMispricing(ticker) fanned out over held tickers
 *   Greeks         ← /api/robinhood/analytics/portfolio-greeks
 *   Recent signals ← /api/engine/logs?limit=6
 */

type Signal = 'BUY' | 'SELL' | 'NEUTRAL';

type Opportunity = {
  ticker: string;
  spot: number;
  iv: number;
  hv: number;
  ratio: number;
  signal: Signal;
};

const MAG7 = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA']);

type OppFilter = 'watchlist' | 'mag7' | 'mispriced';

function filterOpportunities(opps: Opportunity[], f: OppFilter): Opportunity[] {
  if (f === 'mag7') return opps.filter((o) => MAG7.has(o.ticker));
  if (f === 'mispriced') return opps.filter((o) => o.ratio > 1.3 || o.ratio < 0.8);
  return opps;
}

type SignalKind = 'EXEC' | 'SIGNAL' | 'SKIP' | 'SCAN';
type SignalRow = {
  time: string;
  kind: SignalKind;
  cls: 'exec' | 'signal' | 'skip' | 'scan';
  sym: string;
  msg: string;
};

const KIND_FROM_EVENT: Record<string, { kind: SignalKind; cls: SignalRow['cls'] }> = {
  trade_executed: { kind: 'EXEC', cls: 'exec' },
  exec: { kind: 'EXEC', cls: 'exec' },
  signal_generated: { kind: 'SIGNAL', cls: 'signal' },
  signal: { kind: 'SIGNAL', cls: 'signal' },
  trade_skipped: { kind: 'SKIP', cls: 'skip' },
  skip: { kind: 'SKIP', cls: 'skip' },
  scan_completed: { kind: 'SCAN', cls: 'scan' },
  scan: { kind: 'SCAN', cls: 'scan' },
};

function classifyEvent(eventType: string): { kind: SignalKind; cls: SignalRow['cls'] } {
  return KIND_FROM_EVENT[eventType] ?? { kind: 'SCAN', cls: 'scan' };
}

type SignalFilter = 'all' | 'exec-signal';
type GreeksMode = 'aggregate' | 'by-ticker';

type PerTickerGreeks = {
  ticker: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

function aggregateGreeksByTicker(greeks: PortfolioGreeksResult | null): PerTickerGreeks[] {
  if (!greeks?.per_position) return [];
  const acc = new Map<string, PerTickerGreeks>();
  for (const p of greeks.per_position) {
    const ticker = (p as Record<string, unknown>).underlying as string | undefined;
    if (!ticker) continue;
    const qty = Number(p.qty ?? 0);
    const g = p.greeks ?? { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    // greeks come per-contract; multiply by 100 for option-share equivalent
    const contractMult = 100;
    const dDelta = qty * (g.delta ?? 0) * contractMult;
    const dGamma = qty * (g.gamma ?? 0) * contractMult;
    const dTheta = qty * (g.theta ?? 0) * contractMult;
    const dVega = qty * (g.vega ?? 0) * contractMult;
    const cur = acc.get(ticker) ?? { ticker, delta: 0, gamma: 0, theta: 0, vega: 0 };
    cur.delta += dDelta;
    cur.gamma += dGamma;
    cur.theta += dTheta;
    cur.vega += dVega;
    acc.set(ticker, cur);
  }
  // Sort by abs delta contribution
  return Array.from(acc.values()).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function deriveSignal(ratio: number): Signal {
  if (ratio > 1.3) return 'SELL';
  if (ratio < 0.8) return 'BUY';
  return 'NEUTRAL';
}

function signalChipClass(s: Signal): string {
  return s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : 'neutral';
}

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const chipBtnStyle: React.CSSProperties = {
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function fmtUsd(n: number | null | undefined, opts?: { signed?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const compact = abs >= 10_000;
  const formatted = compact
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (!opts?.signed) return n < 0 ? `-${formatted}` : formatted;
  return n < 0 ? `−${formatted}` : `+${formatted}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso.slice(0, 8);
  }
}

export function Dashboard() {
  const [oppFilter, setOppFilter] = useState<OppFilter>('watchlist');
  const [greeksMode, setGreeksMode] = useState<GreeksMode>('aggregate');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('exec-signal');

  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [greeks, setGreeks] = useState<PortfolioGreeksResult | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [signalRows, setSignalRows] = useState<SignalRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oppsLoading, setOppsLoading] = useState(false);

  const fetchHeavy = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, h, g, logs] = await Promise.all([
        getRobinhoodSummary(true, 'all', 'live').catch(() => null),
        getRobinhoodHoldings(true, 'all', 'live').catch(() => null),
        getPortfolioGreeks('all').catch(() => null),
        getEngineLogs({ limit: 6 }).catch(() => ({ logs: [], count: 0 })),
      ]);
      setSummary(s);
      setHoldings(h);
      setGreeks(g);
      setSignalRows(
        (logs.logs ?? []).map((l): SignalRow => {
          const { kind, cls } = classifyEvent(l.event_type);
          const detailMsg =
            l.details && typeof l.details === 'object'
              ? (l.details.message as string) ||
                (l.details.reason as string) ||
                JSON.stringify(l.details).slice(0, 80)
              : '';
          return {
            time: fmtTime(l.timestamp),
            kind,
            cls,
            sym: l.ticker || '—',
            msg: detailMsg || l.event_type,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mispricing fan-out runs after we know the held tickers. Cap at the top
  // 20 by market value so a 70+ ticker portfolio doesn't fire a flood of
  // backend calls on every page load. Tickers held only as options (no
  // equity row) still get included because they're often the most relevant.
  const heldTickers = useMemo(() => {
    if (!holdings) return [] as string[];
    const equityMV = new Map<string, number>();
    for (const e of holdings.equities ?? []) {
      if (!e.symbol) continue;
      equityMV.set(e.symbol.toUpperCase(), Math.abs(e.market_value ?? 0));
    }
    const optionUnderlyings = new Set<string>();
    for (const o of holdings.options ?? []) {
      if (o.underlying) optionUnderlyings.add(o.underlying.toUpperCase());
    }
    // Tickers only-in-options bubble to the top regardless of equity MV.
    const all = new Set<string>([...equityMV.keys(), ...optionUnderlyings]);
    return Array.from(all)
      .sort((a, b) => {
        const aOpt = optionUnderlyings.has(a) ? 1 : 0;
        const bOpt = optionUnderlyings.has(b) ? 1 : 0;
        if (aOpt !== bOpt) return bOpt - aOpt;
        return (equityMV.get(b) ?? 0) - (equityMV.get(a) ?? 0);
      })
      .slice(0, 20);
  }, [holdings]);

  useEffect(() => {
    if (heldTickers.length === 0) {
      setOpportunities([]);
      return;
    }
    let cancelled = false;
    setOppsLoading(true);
    Promise.allSettled(heldTickers.map((t) => getMispricing(t)))
      .then((results) => {
        if (cancelled) return;
        const opps: Opportunity[] = [];
        results.forEach((r, idx) => {
          if (r.status !== 'fulfilled') return;
          const m = r.value as MispricingData & { error?: string };
          // Backend returns 200 with `{ticker, error}` for unpriceable
          // tickers (delisted ADRs, BRK.A, etc.). Skip those silently.
          if (m.error || typeof m.spot_price !== 'number') return;
          opps.push({
            ticker: heldTickers[idx],
            spot: m.spot_price,
            iv: m.implied_vol_atm,
            hv: m.historical_vol,
            ratio: m.iv_hv_ratio,
            signal: deriveSignal(m.iv_hv_ratio),
          });
        });
        opps.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
        setOpportunities(opps);
      })
      .finally(() => {
        if (!cancelled) setOppsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [heldTickers]);

  useEffect(() => {
    fetchHeavy();
    const id = setInterval(fetchHeavy, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHeavy]);

  const visibleOpps = useMemo(() => filterOpportunities(opportunities, oppFilter), [opportunities, oppFilter]);

  const visibleSignals = useMemo(() => {
    if (signalFilter === 'all') return signalRows;
    return signalRows.filter((r) => r.kind === 'EXEC' || r.kind === 'SIGNAL');
  }, [signalRows, signalFilter]);

  const equityCount = holdings?.equities.length ?? 0;
  const optionCount = holdings?.options.length ?? 0;

  const unrealized = summary?.unrealized_pnl ?? 0;
  const unrealizedPct = summary?.total_invested && summary.total_invested > 0
    ? (unrealized / summary.total_invested) * 100
    : null;

  const byTicker = useMemo(() => aggregateGreeksByTicker(greeks), [greeks]);

  return (
    <>
      <h2 className="rv-h1">Today</h2>
      <div className="rv-sub">
        {TODAY} · live portfolio · ranked by IV/HV mispricing
      </div>

      {error && (
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          Error loading dashboard: {error}
          <button
            type="button"
            onClick={fetchHeavy}
            className="rv-btn ghost"
            style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px' }}
          >
            Retry
          </button>
        </div>
      )}

      <div className="rv-grid-4" style={{ marginBottom: 14 }}>
        <div className="rv-kpi">
          <div className="k">NAV</div>
          <div className="v">{fmtUsd(summary?.nav ?? null)}</div>
          <div className="d">
            invested {fmtUsd(summary?.total_invested ?? null)}
          </div>
        </div>
        <div className="rv-kpi">
          <div className="k">Unrealized P&amp;L</div>
          <div className={`v ${unrealized >= 0 ? 'rv-up' : 'rv-dn'}`}>
            {fmtUsd(unrealized, { signed: true })}
          </div>
          <div className="d">
            {unrealizedPct !== null ? `${fmtPct(unrealizedPct)} on cost · ` : ''}
            {equityCount} stocks · {optionCount} legs
          </div>
        </div>
        <div className="rv-kpi">
          <div className="k">Cash</div>
          <div className="v">{fmtUsd(summary?.cash_balance ?? null)}</div>
          <div className="d">available · live snapshot</div>
        </div>
        <div className="rv-kpi">
          <div className="k">Net delta (options)</div>
          <div className="v">
            {greeks?.total_delta !== undefined && greeks?.total_delta !== null
              ? `${greeks.total_delta >= 0 ? '+' : ''}${greeks.total_delta.toFixed(0)}`
              : '—'}
          </div>
          <div className="d">
            {greeks?.position_count
              ? `${greeks.position_count} legs · vega ${greeks.total_vega !== undefined ? greeks.total_vega.toFixed(0) : '—'}`
              : 'no option positions'}
          </div>
        </div>
      </div>

      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Top opportunities — your positions, ranked by IV/HV</h3>
          <div className="tools">
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'watchlist' ? 'on' : ''}
              onClick={() => setOppFilter('watchlist')}
            >
              My positions
            </button>
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'mag7' ? 'on' : ''}
              onClick={() => setOppFilter('mag7')}
            >
              Mag 7
            </button>
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'mispriced' ? 'on' : ''}
              onClick={() => setOppFilter('mispriced')}
            >
              Mispriced
            </button>
          </div>
        </div>
        <div className="rv-table-wrap">
        <table className="rv-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="r">Spot</th>
              <th>IV / HV</th>
              <th className="r">Ratio</th>
              <th>Signal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {oppsLoading && opportunities.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-mute)', fontSize: 12 }}>
                  loading {heldTickers.length} tickers…
                </td>
              </tr>
            ) : visibleOpps.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-mute)', fontSize: 12 }}>
                  {heldTickers.length === 0
                    ? 'No positions yet — sync Robinhood to populate.'
                    : 'No tickers match this filter.'}
                </td>
              </tr>
            ) : (
              visibleOpps.map((o) => (
                <tr key={o.ticker}>
                  <td>
                    <Link href={`/stock/${o.ticker}`} prefetch className="rv-ticker-link">
                      {o.ticker}
                    </Link>
                  </td>
                  <td className="r">{o.spot.toFixed(2)}</td>
                  <td><IvHvScale iv={o.iv} hv={o.hv} ratio={o.ratio} /></td>
                  <td className={`r ${o.ratio > 1.3 ? 'rv-up' : o.ratio < 0.8 ? 'rv-dn' : ''}`}>
                    {o.ratio.toFixed(2)}x
                  </td>
                  <td><span className={`rv-chip ${signalChipClass(o.signal)}`}>{o.signal}</span></td>
                  <td>
                    <Link
                      href={`/options-chain?ticker=${o.ticker}`}
                      className="rv-btn ghost"
                      style={{ fontSize: 11, padding: '3px 8px', textDecoration: 'none' }}
                    >
                      chain →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rv-grid-2" style={{ marginTop: 14 }}>
        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Portfolio Greeks — live</h3>
            <div className="tools">
              <button
                type="button"
                style={chipBtnStyle}
                className={greeksMode === 'aggregate' ? 'on' : ''}
                onClick={() => setGreeksMode('aggregate')}
              >
                Aggregate
              </button>
              <button
                type="button"
                style={chipBtnStyle}
                className={greeksMode === 'by-ticker' ? 'on' : ''}
                onClick={() => setGreeksMode('by-ticker')}
              >
                By ticker
              </button>
            </div>
          </div>
          {!greeks || greeks.position_count === 0 ? (
            <div style={{ padding: 12, color: 'var(--ink-mute)', fontSize: 12 }}>
              {loading ? 'loading…' : 'No option positions to aggregate.'}
            </div>
          ) : greeksMode === 'aggregate' ? (
            <>
              <div className="rv-greeks cols-4">
                <div className="rv-greek">
                  <div className="sym">Δ<span className="ord">1</span></div>
                  <div className="val">{greeks.total_delta >= 0 ? '+' : ''}{greeks.total_delta.toFixed(1)}</div>
                  <div className="sub">net option delta</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">Γ<span className="ord">1</span></div>
                  <div className="val">{greeks.total_gamma >= 0 ? '+' : ''}{greeks.total_gamma.toFixed(2)}</div>
                  <div className="sub">per $1 move</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">Θ<span className="ord">1</span></div>
                  <div className={`val ${greeks.total_theta >= 0 ? 'rv-up' : 'rv-dn'}`}>
                    {greeks.total_theta >= 0 ? '+' : ''}{greeks.total_theta.toFixed(0)}
                  </div>
                  <div className="sub">/ day</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">V<span className="ord">1</span></div>
                  <div className={`val ${greeks.total_vega >= 0 ? 'rv-up' : 'rv-dn'}`}>
                    {greeks.total_vega >= 0 ? '+' : ''}{greeks.total_vega.toFixed(0)}
                  </div>
                  <div className="sub">per 1 vol pt</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                {greeks.position_count} option legs · {greeks.skipped?.length ? `${greeks.skipped.length} skipped` : 'all priced'}
              </div>
            </>
          ) : byTicker.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--ink-mute)', fontSize: 12 }}>
              No per-ticker breakdown available.
            </div>
          ) : (
            <div className="rv-table-wrap">
            <table className="rv-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="r">Δ</th>
                  <th className="r">Γ</th>
                  <th className="r">Θ ($/d)</th>
                  <th className="r">V ($/vol pt)</th>
                </tr>
              </thead>
              <tbody>
                {byTicker.map((g) => (
                  <tr key={g.ticker}>
                    <td>
                      <Link href={`/stock/${g.ticker}`} prefetch className="rv-ticker-link">
                        {g.ticker}
                      </Link>
                    </td>
                    <td className="r">{g.delta.toFixed(1)}</td>
                    <td className="r">{g.gamma.toFixed(2)}</td>
                    <td className={`r ${g.theta >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {g.theta >= 0 ? '+' : ''}{g.theta.toFixed(0)}
                    </td>
                    <td className={`r ${g.vega >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {g.vega >= 0 ? '+' : ''}{g.vega.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Recent signals — from auto-engine</h3>
            <div className="tools">
              <button
                type="button"
                style={chipBtnStyle}
                className={signalFilter === 'all' ? 'on' : ''}
                onClick={() => setSignalFilter('all')}
              >
                all
              </button>
              <button
                type="button"
                style={chipBtnStyle}
                className={signalFilter === 'exec-signal' ? 'on' : ''}
                onClick={() => setSignalFilter('exec-signal')}
              >
                exec + signal
              </button>
            </div>
          </div>
          <div className="rv-log">
            {visibleSignals.length === 0 ? (
              <div style={{ padding: 10, color: 'var(--ink-mute)', fontSize: 11 }}>
                {loading ? 'loading…' : 'No engine activity yet — start the auto-engine to populate.'}
              </div>
            ) : (
              visibleSignals.map((row, i) => (
                <div className="row" key={`${row.time}-${row.kind}-${i}`}>
                  <span className="t">{row.time}</span>
                  <span className={`ev ${row.cls}`}>{row.kind}</span>
                  <span className="sym">{row.sym}</span>
                  <span className="msg">{row.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
