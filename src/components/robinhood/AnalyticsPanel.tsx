'use client';

/**
 * Analytics panel for the Robinhood page. Each "Run" button fires one of the
 * project's existing analytics endpoints against the user's actual holdings.
 *
 * Three sections:
 *   1. Portfolio-level (Greeks, Hedge ratio, Rebalance, Limits, Stress, Drawdown)
 *   2. Per-ticker (VaR, IV/HV, Regime, HV CI, Sentiment, Confluence, Trade rec, Backtest)
 *   3. Wheel backtest (cached)
 *
 * "Run all" fires every portfolio-level test plus the cheap per-ticker tests
 * (IV/HV, Regime, HV CI) for each ticker concurrently. Heavy per-ticker tests
 * (Sentiment, Confluence, Trade rec, Backtest) stay click-to-run to avoid
 * hammering the backend.
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import type { RobinhoodAccount, RobinhoodHolding } from '@/lib/robinhood-api';
import { InfoIcon } from '@/components/ui/InfoIcon';
import { RecommendedActionsCard } from './RecommendedActionsCard';
import {
  getPortfolioGreeks,
  getHedgeRatio,
  getRebalanceCheck,
  getLimitsCheck,
  getStressTest,
  getDrawdown,
  getVaR,
  getMispricing,
  getRegime,
  getHVConfidence,
  getSentiment,
  getConfluence,
  getTradeRecommendation,
  runBacktest,
  getWheelBacktest,
  saveAnalyticsRun,
  type PortfolioGreeksResult,
  type HedgeRatioResult,
  type RebalanceCheckResult,
  type LimitsCheckResult,
  type StressTestResult,
  type DrawdownResult,
  type WheelBacktestResult,
} from '@/lib/robinhood-analytics-api';

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'err'; error: string };

const idle = <T,>(): AsyncState<T> => ({ status: 'idle' });

async function run<T>(
  setter: (s: AsyncState<T>) => void,
  fn: () => Promise<T>,
) {
  setter({ status: 'loading' });
  try {
    setter({ status: 'ok', data: await fn() });
  } catch (e) {
    setter({ status: 'err', error: e instanceof Error ? e.message : 'Failed' });
  }
}

// --- formatters ----------------------------------------------------------

const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtPct = (n: number | null | undefined, digits = 2): string => {
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
};

const sign = (n: number) => (n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

// --- per-card rendering --------------------------------------------------

function CardShell({
  title,
  state,
  onRun,
  children,
}: {
  title: React.ReactNode;
  state: AsyncState<unknown>;
  onRun: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rv-card" style={{ padding: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13 }}>{title}</h3>
        <button
          type="button"
          className="rv-btn ghost"
          style={{ fontSize: 11 }}
          disabled={state.status === 'loading'}
          onClick={onRun}
        >
          {state.status === 'loading' ? '…' : 'Run'}
        </button>
      </div>
      {state.status === 'idle' && (
        <div className="rv-sub" style={{ fontSize: 11 }}>not run yet</div>
      )}
      {state.status === 'loading' && (
        <div className="rv-sub" style={{ fontSize: 11 }}>running…</div>
      )}
      {state.status === 'err' && (
        <div style={{ color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          error: {state.error}
        </div>
      )}
      {state.status === 'ok' && children}
    </div>
  );
}

const monoGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px 10px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
};

function GreeksCard({
  state,
  onRun,
}: {
  state: AsyncState<PortfolioGreeksResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title="Portfolio Greeks" state={state} onRun={onRun}>
      {state.status === 'ok' && state.data.error ? (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>
          {state.data.message ?? state.data.error}
        </div>
      ) : state.status === 'ok' ? (
        <>
          <div style={monoGrid}>
            <div>Δ delta<InfoIcon term="delta" /></div><div className={sign(state.data.total_delta)}>{fmtNum(state.data.total_delta)}</div>
            <div>Γ gamma<InfoIcon term="gamma" /></div><div>{fmtNum(state.data.total_gamma)}</div>
            <div>𝜈 vega<InfoIcon term="vega" /></div><div>{fmtNum(state.data.total_vega)}</div>
            <div>Θ theta<InfoIcon term="theta" /></div><div className={sign(state.data.total_theta)}>{fmtNum(state.data.total_theta)}</div>
            <div>ρ rho<InfoIcon term="rho" /></div><div>{fmtNum(state.data.total_rho)}</div>
            <div>legs</div><div>{state.data.position_count}</div>
          </div>
          {state.data.skipped && state.data.skipped.length > 0 && (
            <div className="rv-sub" style={{ fontSize: 10, marginTop: 6 }}>
              {state.data.skipped.length} legs skipped (expired or no spot price)
            </div>
          )}
        </>
      ) : null}
    </CardShell>
  );
}

function HedgeRatioCard({
  state,
  onRun,
}: {
  state: AsyncState<HedgeRatioResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title={<>Hedge ratio (Δ-neutral)<InfoIcon term="hedge-ratio" /></>} state={state} onRun={onRun}>
      {state.status === 'ok' && !state.data.error && (
        <div style={monoGrid}>
          <div>current Δ</div><div className={sign(state.data.current_delta)}>{fmtNum(state.data.current_delta)}</div>
          <div>target Δ</div><div>{fmtNum(state.data.target_delta)}</div>
          <div>shares</div>
          <div className={state.data.hedge_direction === 'BUY' ? 'rv-up' : state.data.hedge_direction === 'SELL' ? 'rv-dn' : ''}>
            {state.data.hedge_direction} {Math.abs(state.data.hedge_shares)}
          </div>
          <div>notional</div><div>{fmtMoney(state.data.hedge_notional)}</div>
        </div>
      )}
      {state.status === 'ok' && state.data.error && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>{state.data.message}</div>
      )}
    </CardShell>
  );
}

function RebalanceCard({
  state,
  onRun,
}: {
  state: AsyncState<RebalanceCheckResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title={<>Rebalance triggers<InfoIcon term="rebalance" /></>} state={state} onRun={onRun}>
      {state.status === 'ok' && !state.data.error && (
        <>
          <div style={{ marginBottom: 6 }}>
            <span className={`rv-chip ${state.data.needs_rebalance ? 'sell' : 'buy'}`}>
              {state.data.needs_rebalance ? `REBALANCE · ${state.data.max_severity}` : 'within limits'}
            </span>
            <span className="rv-sub" style={{ marginLeft: 8, fontSize: 11 }}>
              {state.data.breach_count} breach(es)
            </span>
          </div>
          {state.data.breaches.length > 0 && (
            <div style={monoGrid}>
              {state.data.breaches.map((b) => (
                <Fragment key={b.greek}>
                  <div>{b.greek}</div>
                  <div className="rv-dn">
                    {fmtNum(b.current)} / {fmtNum(b.limit)} ({b.severity})
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}
      {state.status === 'ok' && state.data.error && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>{state.data.message}</div>
      )}
    </CardShell>
  );
}

function LimitsCard({
  state,
  onRun,
}: {
  state: AsyncState<LimitsCheckResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title={<>Position limits<InfoIcon term="position-limits" /></>} state={state} onRun={onRun}>
      {state.status === 'ok' && !state.data.error && (
        <>
          <div style={{ marginBottom: 6 }}>
            <span className={`rv-chip ${state.data.status === 'OK' ? 'buy' : state.data.status === 'WARNING' ? 'sell' : 'warn'}`}>
              {state.data.status} · score {state.data.risk_score}
            </span>
          </div>
          <div className="rv-sub" style={{ fontSize: 11 }}>{state.data.action}</div>
          {(state.data.violations.length > 0 || state.data.warnings.length > 0) && (
            <div style={{ ...monoGrid, marginTop: 6 }}>
              {[...state.data.violations, ...state.data.warnings].map((v) => (
                <Fragment key={`${v.level}-${v.greek}`}>
                  <div>{v.greek}</div>
                  <div className={v.level === 'VIOLATION' ? 'rv-dn' : ''}>
                    {fmtPct(v.utilization_pct)}
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}
      {state.status === 'ok' && state.data.error && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>{state.data.message}</div>
      )}
    </CardShell>
  );
}

function StressCard({
  state,
  onRun,
}: {
  state: AsyncState<StressTestResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title={<>Stress test (±10% spot, ±20% vol)<InfoIcon term="stress-test" /></>} state={state} onRun={onRun}>
      {state.status === 'ok' && !state.data.error && (
        <div style={monoGrid}>
          <div>spot shock</div><div>{fmtPct((state.data.spot_shock_pct ?? 0) * 100)}</div>
          <div>vol shock</div><div>{fmtPct((state.data.vol_shock_pct ?? 0) * 100)}</div>
          <div>total P&amp;L</div>
          <div className={sign(state.data.total_pnl ?? 0)}>{fmtMoney(state.data.total_pnl)}</div>
          {state.data.total_attribution &&
            Object.entries(state.data.total_attribution).slice(0, 5).map(([k, v]) => (
              <Fragment key={k}>
                <div>{k}</div>
                <div className={sign(v)}>{fmtMoney(v)}</div>
              </Fragment>
            ))}
        </div>
      )}
      {state.status === 'ok' && state.data.error && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>{state.data.message}</div>
      )}
    </CardShell>
  );
}

function DrawdownCard({
  state,
  onRun,
}: {
  state: AsyncState<DrawdownResult>;
  onRun: () => void;
}) {
  return (
    <CardShell title={<>Drawdown (snapshot)<InfoIcon term="drawdown" /></>} state={state} onRun={onRun}>
      {state.status === 'ok' && state.data.error && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--pink)' }}>
          {state.data.message}
        </div>
      )}
      {state.status === 'ok' && !state.data.error && (() => {
        const inputs = state.data.inputs;
        const cost = inputs?.total_invested ?? 0;
        const market = inputs?.market_value ?? 0;
        const cash = inputs?.cash_flows ?? 0;
        const unrealized = market - cost;
        const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : 0;
        const inProfit = !state.data.breached && state.data.drawdown_pct === 0 && unrealized > 0;
        const peakIsCostBasis = state.data.peak_equity <= state.data.current_equity + 0.01;
        const status = state.data.breached
          ? `⚠ DRAWDOWN ${fmtPct(state.data.drawdown_pct)} · ${state.data.action}`
          : inProfit
            ? '✓ in profit · no drawdown vs peak invested'
            : `${fmtPct(state.data.drawdown_pct)} drawdown vs approx peak`;

        return (
          <>
            <div
              style={{
                fontSize: 11,
                marginBottom: 6,
                fontFamily: "'JetBrains Mono', monospace",
                color: state.data.breached ? 'var(--pink)' : inProfit ? 'var(--green)' : undefined,
              }}
            >
              {status}
            </div>
            <div style={monoGrid}>
              <div>NAV</div>
              <div>{fmtMoney(state.data.current_equity)}</div>
              {inputs && (
                <>
                  <div style={{ paddingLeft: 10, color: 'var(--ink-mute)' }}>· market</div>
                  <div style={{ color: 'var(--ink-mute)' }}>{fmtMoney(market)}</div>
                  <div style={{ paddingLeft: 10, color: 'var(--ink-mute)' }}>· cash flows</div>
                  <div style={{ color: 'var(--ink-mute)' }}>{fmtMoney(cash)}</div>
                </>
              )}
              <div>cost basis</div><div>{fmtMoney(cost)}</div>
              <div>unrealized</div>
              <div className={sign(unrealized)}>
                {fmtMoney(unrealized)} ({unrealized >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
              </div>
              <div>peak {peakIsCostBasis ? '(approx)' : ''}</div>
              <div>{fmtMoney(state.data.peak_equity)}</div>
              <div>buffer</div><div>{fmtPct(state.data.remaining_buffer_pct)}</div>
            </div>
            <div className="rv-sub" style={{ fontSize: 10, marginTop: 6 }}>
              snapshot only · no daily equity history, peak ≈ max(NAV, cost basis + flows)
            </div>
          </>
        );
      })()}
    </CardShell>
  );
}

// --- per-ticker -----------------------------------------------------------

type TickerTestKey =
  | 'mispricing'
  | 'regime'
  | 'hv'
  | 'var'
  | 'sentiment'
  | 'confluence'
  | 'rec'
  | 'backtest';

const PER_TICKER_TESTS: Array<{ key: TickerTestKey; label: string; heavy?: boolean; infoSlug?: string }> = [
  { key: 'mispricing', label: 'IV/HV',       infoSlug: 'iv-hv' },
  { key: 'regime',     label: 'Regime',       infoSlug: 'regime' },
  { key: 'hv',         label: 'HV CI',        infoSlug: 'hv-confidence' },
  { key: 'var',        label: 'VaR',          infoSlug: 'var' },
  { key: 'sentiment',  label: 'Sentiment',    infoSlug: 'sentiment',   heavy: true },
  { key: 'confluence', label: 'Confluence',   infoSlug: 'confluence',  heavy: true },
  { key: 'rec',        label: 'Trade rec',                             heavy: true },
  { key: 'backtest',   label: 'Backtest 1y',                          heavy: true },
];

const TICKER_RUNNERS: Record<TickerTestKey, (t: string) => Promise<unknown>> = {
  mispricing: getMispricing,
  regime: getRegime,
  hv: getHVConfidence,
  var: getVaR,
  sentiment: getSentiment,
  confluence: getConfluence,
  rec: (t) => getTradeRecommendation(t),
  backtest: (t) => {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return runBacktest(t, fmt(start), fmt(end));
  },
};

function summarizeTickerResult(test: TickerTestKey, data: unknown): string {
  if (!data || typeof data !== 'object') return JSON.stringify(data).slice(0, 120);
  const d = data as Record<string, unknown>;

  if (test === 'mispricing') {
    const ratio = d.iv_hv_ratio as number | undefined;
    const sig = d.signal as string | undefined;
    return `IV/HV ${ratio?.toFixed(2) ?? '—'} · ${sig ?? '—'}`;
  }
  if (test === 'regime') {
    const regime = d.regime as string | undefined;
    const prob = d.probability as number | undefined;
    return `${regime ?? '—'} (${prob != null ? (prob * 100).toFixed(0) + '%' : '—'})`;
  }
  if (test === 'hv') {
    const hv = d.hv as number | undefined;
    const lo = d.ci_lower as number | undefined;
    const hi = d.ci_upper as number | undefined;
    const r = d.reliable as boolean | undefined;
    return `HV ${hv != null ? (hv * 100).toFixed(1) : '—'}% [${lo != null ? (lo * 100).toFixed(1) : '—'}, ${hi != null ? (hi * 100).toFixed(1) : '—'}]${r === false ? ' (low confidence)' : ''}`;
  }
  if (test === 'var') {
    const h = d.historical as { var_pct?: number; cvar_pct?: number; var_dollars?: number } | undefined;
    if (h?.var_pct != null) {
      return `VaR 95% ${h.var_pct.toFixed(2)}% · CVaR ${h.cvar_pct?.toFixed(2) ?? '—'}%`;
    }
    return 'no data';
  }
  if (test === 'sentiment') {
    const c = d.article_count as number | undefined;
    const ds = (d.data_sources as string[] | undefined) ?? [];
    return `${c ?? 0} articles from ${ds.join(', ') || 'no sources'}`;
  }
  if (test === 'confluence') {
    const score = d.confluence_score as number | undefined;
    const strat = d.recommended_strategy as string | undefined;
    return `confluence ${score?.toFixed(2) ?? '—'} · ${strat ?? '—'}`;
  }
  if (test === 'rec') {
    const strat = d.strategy as string | undefined;
    const r = d.recommendation as string | undefined;
    const strikes = d.strikes as unknown[] | undefined;
    return `${strat ?? '—'} · ${r ?? '—'} · ${strikes?.length ?? 0} candidates`;
  }
  if (test === 'backtest') {
    const m = d.metrics as Record<string, number> | undefined;
    if (!m) return 'no metrics';
    return `Sharpe ${m.sharpe_ratio?.toFixed(2) ?? '—'} · MaxDD ${m.max_drawdown_pct != null ? m.max_drawdown_pct.toFixed(1) + '%' : '—'} · ret ${m.total_return_pct != null ? m.total_return_pct.toFixed(1) + '%' : '—'}`;
  }
  return JSON.stringify(d).slice(0, 120);
}

// --- top-level component --------------------------------------------------

const PORTFOLIO_TESTS = [
  'greeks',
  'hedge',
  'rebalance',
  'limits',
  'stress',
  'drawdown',
] as const;

export function AnalyticsPanel({
  account,
  tickers: tickersProp,
  holdings: holdingsProp,
  totalNAV,
}: {
  account: RobinhoodAccount;
  tickers: string[];
  holdings?: RobinhoodHolding[];
  totalNAV?: number;
}) {
  // Dedupe incoming tickers so duplicate keys never reach the render tree,
  // regardless of which caller passed the raw (potentially duplicated) list.
  const tickers = Array.from(new Set(tickersProp));

  const [greeks, setGreeks] = useState<AsyncState<PortfolioGreeksResult>>(idle);
  const [hedge, setHedge] = useState<AsyncState<HedgeRatioResult>>(idle);
  const [rebalance, setRebalance] = useState<AsyncState<RebalanceCheckResult>>(idle);
  const [limits, setLimits] = useState<AsyncState<LimitsCheckResult>>(idle);
  const [stress, setStress] = useState<AsyncState<StressTestResult>>(idle);
  const [drawdown, setDrawdown] = useState<AsyncState<DrawdownResult>>(idle);
  const [wheel, setWheel] = useState<AsyncState<WheelBacktestResult>>(idle);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Ref to hold the latest ticker results — updated synchronously inside
  // setTickerResult so the save snapshot sees settled data even before React re-renders.
  const tickerResultsRef = useRef<Record<string, AsyncState<unknown>>>({});

  // Per-ticker results, keyed by `${ticker}:${test}`
  const [tickerResults, setTickerResults] = useState<
    Record<string, AsyncState<unknown>>
  >({});

  // Filter / sort toolbar state
  type SortMode = 'signal' | 'symbol' | 'iv-hv';
  const [sortMode, setSortMode] = useState<SortMode>('signal');
  const [hideHold, setHideHold] = useState(false);
  const [hideNoData, setHideNoData] = useState(false);

  const setTickerResult = useCallback(
    (ticker: string, test: TickerTestKey, state: AsyncState<unknown>) => {
      setTickerResults((prev) => {
        const next = { ...prev, [`${ticker}:${test}`]: state };
        tickerResultsRef.current = next;
        return next;
      });
    },
    [],
  );

  const resetAll = useCallback(() => {
    setGreeks(idle);
    setHedge(idle);
    setRebalance(idle);
    setLimits(idle);
    setStress(idle);
    setDrawdown(idle);
    setWheel(idle);
    setTickerResults({});
  }, []);

  const runPortfolio = useMemo(
    () => ({
      greeks: () => run(setGreeks, () => getPortfolioGreeks(account)),
      hedge: () => run(setHedge, () => getHedgeRatio(account)),
      rebalance: () => run(setRebalance, () => getRebalanceCheck(account)),
      limits: () => run(setLimits, () => getLimitsCheck(account)),
      stress: () => run(setStress, () => getStressTest(account)),
      drawdown: () => run(setDrawdown, () => getDrawdown(account)),
    }),
    [account],
  );

  const runTickerTest = useCallback(
    (ticker: string, test: TickerTestKey) => {
      run(
        (s) => setTickerResult(ticker, test, s),
        () => TICKER_RUNNERS[test](ticker),
      );
    },
    [setTickerResult],
  );

  // Quick: portfolio-level + the 3 cheap per-ticker tests (IV/HV, Regime, HV CI).
  // Fast (~seconds), safe to spam.
  const runQuick = useCallback(() => {
    PORTFOLIO_TESTS.forEach((k) => runPortfolio[k]());
    tickers.forEach((t) => {
      runTickerTest(t, 'mispricing');
      runTickerTest(t, 'regime');
      runTickerTest(t, 'hv');
    });
  }, [runPortfolio, runTickerTest, tickers]);

  // Filter + sort the tickers list for the per-ticker grid
  const visibleTickers = useMemo(() => {
    let result = [...tickers];

    // Hide HOLD: filter out tickers that are NEUTRAL/HOLD with no tradable signal
    if (hideHold) {
      result = result.filter((t) => {
        const mispState = tickerResults[`${t}:mispricing`];
        const recState = tickerResults[`${t}:rec`];
        const signal = mispState?.status === 'ok'
          ? (mispState.data as Record<string, unknown>).signal as string | undefined
          : undefined;
        const strategy = recState?.status === 'ok'
          ? (recState.data as Record<string, unknown>).strategy as string | undefined
          : undefined;
        // Keep if signal is BUY or SELL (actionable)
        if (signal === 'BUY' || signal === 'SELL') return true;
        // Keep if rec strategy is not HOLD
        if (strategy && strategy !== 'HOLD') return true;
        // Keep if neither mispricing nor rec have run yet (not enough info to hide)
        if (mispState == null && recState == null) return true;
        return false;
      });
    }

    // Hide no-data: filter out tickers where mispricing errored or regime errored with "insufficient"
    if (hideNoData) {
      result = result.filter((t) => {
        const mispState = tickerResults[`${t}:mispricing`];
        const regimeState = tickerResults[`${t}:regime`];
        if (mispState?.status === 'err') return false;
        if (
          regimeState?.status === 'err' &&
          regimeState.error.toLowerCase().includes('insufficient')
        ) return false;
        return true;
      });
    }

    // Sort
    if (sortMode === 'symbol') {
      result.sort((a, b) => a.localeCompare(b));
    } else if (sortMode === 'iv-hv') {
      result.sort((a, b) => {
        const getRatio = (t: string) => {
          const s = tickerResults[`${t}:mispricing`];
          if (s?.status !== 'ok') return -Infinity;
          return (s.data as Record<string, unknown>).iv_hv_ratio as number ?? 0;
        };
        return getRatio(b) - getRatio(a);
      });
    } else {
      // signal: SELL (ratio desc) → BUY (ratio asc) → NEUTRAL/HOLD → no-data last
      const signalOrder = (t: string): number => {
        const s = tickerResults[`${t}:mispricing`];
        if (s?.status !== 'ok') return 3;
        const sig = (s.data as Record<string, unknown>).signal as string | undefined;
        if (sig === 'SELL') return 0;
        if (sig === 'BUY') return 1;
        return 2;
      };
      const getRatio = (t: string): number => {
        const s = tickerResults[`${t}:mispricing`];
        if (s?.status !== 'ok') return 0;
        return (s.data as Record<string, unknown>).iv_hv_ratio as number ?? 0;
      };
      result.sort((a, b) => {
        const so = signalOrder(a) - signalOrder(b);
        if (so !== 0) return so;
        const sga = signalOrder(a);
        if (sga === 0) return getRatio(b) - getRatio(a); // SELL: higher ratio first
        if (sga === 1) return getRatio(a) - getRatio(b); // BUY: lower ratio first
        return 0;
      });
    }

    return result;
  }, [tickers, tickerResults, sortMode, hideHold, hideNoData]);

  // Everything: also fires the 5 heavy tests (VaR + Sentiment + Confluence +
  // Trade rec + Backtest) per ticker. 8 tests × N tickers can take minutes
  // and hit external APIs (news, LLM). Confirm before kicking off.
  const runEverything = useCallback(() => {
    const heavyCount = tickers.length * 5;
    const totalCount = tickers.length * 8 + PORTFOLIO_TESTS.length;
    const ok = window.confirm(
      `Run all ${totalCount} analytics across ${tickers.length} tickers?\n\n` +
      `This includes ${heavyCount} heavy calls (Backtest, Sentiment, Confluence, ` +
      `Trade rec, VaR) that hit external APIs and may take several minutes.`,
    );
    if (!ok) return;

    setSaveToast(null);

    // Collect promises from every runner so we can save after all settle.
    // We also write final states eagerly to a local map so the snapshot is
    // correct even if React hasn't flushed re-renders yet.
    const portfolioResultMap: Partial<Record<typeof PORTFOLIO_TESTS[number], AsyncState<unknown>>> = {};

    const portfolioPromises = PORTFOLIO_TESTS.map((k) => {
      return new Promise<void>((resolve) => {
        const origSetter = {
          greeks: setGreeks,
          hedge: setHedge,
          rebalance: setRebalance,
          limits: setLimits,
          stress: setStress,
          drawdown: setDrawdown,
        }[k] as (s: AsyncState<unknown>) => void;
        const wrappedSetter = (s: AsyncState<unknown>) => {
          origSetter(s);
          portfolioResultMap[k] = s;
          if (s.status === 'ok' || s.status === 'err') resolve();
        };
        run(wrappedSetter, () => {
          const fn = {
            greeks: () => getPortfolioGreeks(account),
            hedge: () => getHedgeRatio(account),
            rebalance: () => getRebalanceCheck(account),
            limits: () => getLimitsCheck(account),
            stress: () => getStressTest(account),
            drawdown: () => getDrawdown(account),
          }[k] as () => Promise<unknown>;
          return fn();
        });
      });
    });

    const tickerPromises: Promise<void>[] = [];
    tickers.forEach((t) => {
      PER_TICKER_TESTS.forEach((test) => {
        tickerPromises.push(
          new Promise<void>((resolve) => {
            const wrappedSetter = (s: AsyncState<unknown>) => {
              setTickerResult(t, test.key, s);
              if (s.status === 'ok' || s.status === 'err') resolve();
            };
            run(wrappedSetter, () => TICKER_RUNNERS[test.key](t));
          }),
        );
      });
    });

    const allPromises = [...portfolioPromises, ...tickerPromises];
    Promise.allSettled(allPromises).then(() => {
      // Only save if at least some portfolio tests succeeded (not a 100%-failed run).
      const portfolioOk = PORTFOLIO_TESTS.some((k) => portfolioResultMap[k]?.status === 'ok');
      if (!portfolioOk) return;

      const getPortData = (k: typeof PORTFOLIO_TESTS[number]) => {
        const s = portfolioResultMap[k];
        return s?.status === 'ok' ? (s as { status: 'ok'; data: unknown }).data : null;
      };

      const snapshot = {
        portfolio: {
          greeks: getPortData('greeks'),
          hedge: getPortData('hedge'),
          rebalance: getPortData('rebalance'),
          limits: getPortData('limits'),
          stress: getPortData('stress'),
          drawdown: getPortData('drawdown'),
        },
        perTicker: tickerResultsRef.current,
        tickers,
        timestamp: new Date().toISOString(),
      };

      saveAnalyticsRun({
        account: String(account),
        ticker_count: tickers.length,
        payload: snapshot,
      }).then((res) => {
        setSaveToast(`Run saved as report #${res.run_id}`);
        setTimeout(() => setSaveToast(null), 6000);
      }).catch(() => {
        // swallow — don't surface a save error over the analytics results
      });
    });
  }, [tickers, account, setTickerResult]);

  return (
    <div className="rv-card">
      {saveToast && (
        <div
          role="status"
          style={{
            marginBottom: 8,
            padding: '6px 12px',
            borderRadius: 4,
            background: 'rgba(0,200,5,0.10)',
            border: '1px solid var(--green, #00C805)',
            color: 'var(--green, #00C805)',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ✓ {saveToast}
        </div>
      )}
      <div
        className="rv-card-head"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <h3>Analytics · {account === 'all' ? 'all accounts' : account.replace('_', ' ')}</h3>
        <span style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={runQuick}
            title="Portfolio-level + IV/HV, Regime, HV CI per ticker (~seconds)"
          >
            ▶ Run quick
          </button>
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11 }}
            onClick={runEverything}
            title="Includes heavy tests: Backtest, Sentiment, Confluence, Trade rec, VaR. Several minutes."
          >
            ▶ Run all
          </button>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={resetAll}
          >
            reset
          </button>
        </span>
      </div>

      <div className="rv-sub" style={{ marginBottom: 8, marginTop: 4 }}>
        Portfolio-level — runs on every option leg in this account
      </div>
      <div
        className="rv-analytics-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <GreeksCard state={greeks} onRun={runPortfolio.greeks} />
        <HedgeRatioCard state={hedge} onRun={runPortfolio.hedge} />
        <RebalanceCard state={rebalance} onRun={runPortfolio.rebalance} />
        <LimitsCard state={limits} onRun={runPortfolio.limits} />
        <StressCard state={stress} onRun={runPortfolio.stress} />
        <DrawdownCard state={drawdown} onRun={runPortfolio.drawdown} />
      </div>

      {/* Recommended Actions card — synthesised from latest analytics run */}
      <RecommendedActionsCard
        greeks={greeks}
        hedge={hedge}
        rebalance={rebalance}
        limits={limits}
        tickerResults={tickerResults}
        tickers={tickers}
        holdings={holdingsProp?.map((h) => ({
          symbol: h.symbol,
          market_value: h.market_value ?? null,
          quantity: h.quantity,
        }))}
        totalNAV={totalNAV}
      />

      {/* Per-ticker header + filter toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div className="rv-sub" style={{ margin: 0 }}>
          Per-ticker · {tickers.length} equity holding{tickers.length === 1 ? '' : 's'}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginLeft: 'auto',
          }}
        >
          {/* Sort select */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--ink-dim)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Sort:
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as 'signal' | 'symbol' | 'iv-hv')}
              style={{
                fontSize: 11,
                background: 'var(--surface, #1E1E1E)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '1px 4px',
              }}
            >
              <option value="signal">signal</option>
              <option value="symbol">symbol</option>
              <option value="iv-hv">iv-hv</option>
            </select>
          </label>
          {/* Hide HOLD */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--ink-dim)',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hideHold}
              onChange={(e) => setHideHold(e.target.checked)}
              style={{ accentColor: 'var(--green, #00C805)' }}
            />
            Hide HOLD
          </label>
          {/* Hide no-data */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--ink-dim)',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hideNoData}
              onChange={(e) => setHideNoData(e.target.checked)}
              style={{ accentColor: 'var(--green, #00C805)' }}
            />
            Hide no-data
          </label>
          {/* Count label */}
          <span
            className="rv-sub"
            style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
          >
            {visibleTickers.length} of {tickers.length} shown
          </span>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: 14,
        }}
      >
        {tickers.length === 0 ? (
          <div className="rv-sub" style={{ padding: 10 }}>no equity holdings in this account</div>
        ) : visibleTickers.length === 0 ? (
          <div className="rv-sub" style={{ padding: 10 }}>all tickers filtered — adjust toolbar above</div>
        ) : (
          visibleTickers.map((t, idx) => (
            <div
              key={t}
              style={{
                padding: '8px 10px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ minWidth: 60, fontWeight: 700 }}>{t}</span>
                {PER_TICKER_TESTS.map((test) => {
                  const state = tickerResults[`${t}:${test.key}`] ?? idle();
                  return (
                    <button
                      key={test.key}
                      type="button"
                      className="rv-btn ghost"
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        opacity: state.status === 'loading' ? 0.6 : 1,
                      }}
                      disabled={state.status === 'loading'}
                      onClick={() => runTickerTest(t, test.key)}
                      title={test.heavy ? 'heavy — runs only on click' : 'cheap'}
                    >
                      {state.status === 'loading' ? '…' : test.label}
                    </button>
                  );
                })}
              </div>
              {/* Inline result strip — show whichever test was last run */}
              {PER_TICKER_TESTS.map((test) => {
                const state = tickerResults[`${t}:${test.key}`];
                if (!state || state.status === 'idle' || state.status === 'loading') return null;
                return (
                  <div
                    key={`${t}-${test.key}-row`}
                    style={{
                      marginTop: 4,
                      marginLeft: 66,
                      fontSize: 10,
                      color: state.status === 'err' ? 'var(--pink)' : 'var(--ink-dim)',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 2,
                    }}
                  >
                    <span style={{ color: 'var(--ink-mute)' }}>{test.label}:</span>
                    {test.infoSlug && <InfoIcon term={test.infoSlug} />}
                    <span style={{ marginLeft: 2 }}>
                      {state.status === 'err' ? state.error : summarizeTickerResult(test.key, state.data)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="rv-sub" style={{ marginBottom: 8 }}>
        Wheel backtest · cached aggregate over the watchlist
      </div>
      <CardShell
        title={<>Wheel 1y<InfoIcon term="wheel" /></>}
        state={wheel}
        onRun={() => run(setWheel, getWheelBacktest)}
      >
        {wheel.status === 'ok' && wheel.data.summary && (
          <div style={monoGrid}>
            <div>tickers</div><div>{wheel.data.summary.ticker_count}</div>
            <div>trades</div><div>{wheel.data.summary.total_trades}</div>
            <div>premium</div><div className="rv-up">{fmtMoney(wheel.data.summary.total_premium_usd)}</div>
            <div>realized</div>
            <div className={sign(wheel.data.summary.total_realized_share_pnl_usd)}>
              {fmtMoney(wheel.data.summary.total_realized_share_pnl_usd)}
            </div>
            <div>unrealized</div>
            <div className={sign(wheel.data.summary.total_unrealized_share_pnl_usd)}>
              {fmtMoney(wheel.data.summary.total_unrealized_share_pnl_usd)}
            </div>
            <div>total return</div>
            <div className={sign(wheel.data.summary.total_return_usd)}>
              {fmtMoney(wheel.data.summary.total_return_usd)}
            </div>
            <div>weighted ret</div>
            <div className={sign(wheel.data.summary.weighted_return_pct_of_max_cap)}>
              {fmtPct(wheel.data.summary.weighted_return_pct_of_max_cap * 100)}
            </div>
          </div>
        )}
        {wheel.status === 'ok' && !wheel.data.summary && (
          <div className="rv-sub" style={{ fontSize: 11 }}>no summary in response</div>
        )}
      </CardShell>
    </div>
  );
}
