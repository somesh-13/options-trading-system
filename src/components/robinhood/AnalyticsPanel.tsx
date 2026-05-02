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

import { Fragment, useCallback, useMemo, useState } from 'react';
import type { RobinhoodAccount } from '@/lib/robinhood-api';
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
  title: string;
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
            <div>Δ delta</div><div className={sign(state.data.total_delta)}>{fmtNum(state.data.total_delta)}</div>
            <div>Γ gamma</div><div>{fmtNum(state.data.total_gamma)}</div>
            <div>𝜈 vega</div><div>{fmtNum(state.data.total_vega)}</div>
            <div>Θ theta</div><div className={sign(state.data.total_theta)}>{fmtNum(state.data.total_theta)}</div>
            <div>ρ rho</div><div>{fmtNum(state.data.total_rho)}</div>
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
    <CardShell title="Hedge ratio (Δ-neutral)" state={state} onRun={onRun}>
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
    <CardShell title="Rebalance triggers" state={state} onRun={onRun}>
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
    <CardShell title="Position limits" state={state} onRun={onRun}>
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
    <CardShell title="Stress test (±10% spot, ±20% vol)" state={state} onRun={onRun}>
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
    <CardShell title="Drawdown (snapshot)" state={state} onRun={onRun}>
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

const PER_TICKER_TESTS: Array<{ key: TickerTestKey; label: string; heavy?: boolean }> = [
  { key: 'mispricing', label: 'IV/HV' },
  { key: 'regime', label: 'Regime' },
  { key: 'hv', label: 'HV CI' },
  { key: 'var', label: 'VaR' },
  { key: 'sentiment', label: 'Sentiment', heavy: true },
  { key: 'confluence', label: 'Confluence', heavy: true },
  { key: 'rec', label: 'Trade rec', heavy: true },
  { key: 'backtest', label: 'Backtest 1y', heavy: true },
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
    const rec = d.recommended as { method?: string; var_95?: number; var_99?: number } | undefined;
    if (rec) return `${rec.method ?? '?'}: 95% ${fmtMoney(rec.var_95)} · 99% ${fmtMoney(rec.var_99)}`;
    const hist = d.historical as { var_95?: number } | undefined;
    return hist?.var_95 != null ? `historical 95% ${fmtMoney(hist.var_95)}` : 'see raw response';
  }
  if (test === 'sentiment') {
    const c = d.article_count as number | undefined;
    const ds = (d.data_sources as string[] | undefined) ?? [];
    return `${c ?? 0} articles from ${ds.join(', ') || 'no sources'}`;
  }
  if (test === 'confluence') {
    const conf = d.confluence as number | undefined;
    const rec = d.recommendation as string | undefined;
    return `confluence ${conf?.toFixed(2) ?? '—'} · ${rec ?? '—'}`;
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
    return `Sharpe ${m.sharpe?.toFixed(2) ?? '—'} · MaxDD ${m.max_drawdown != null ? (m.max_drawdown * 100).toFixed(1) + '%' : '—'} · ret ${m.total_return != null ? (m.total_return * 100).toFixed(1) + '%' : '—'}`;
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
  tickers,
}: {
  account: RobinhoodAccount;
  tickers: string[];
}) {
  const [greeks, setGreeks] = useState<AsyncState<PortfolioGreeksResult>>(idle);
  const [hedge, setHedge] = useState<AsyncState<HedgeRatioResult>>(idle);
  const [rebalance, setRebalance] = useState<AsyncState<RebalanceCheckResult>>(idle);
  const [limits, setLimits] = useState<AsyncState<LimitsCheckResult>>(idle);
  const [stress, setStress] = useState<AsyncState<StressTestResult>>(idle);
  const [drawdown, setDrawdown] = useState<AsyncState<DrawdownResult>>(idle);
  const [wheel, setWheel] = useState<AsyncState<WheelBacktestResult>>(idle);

  // Per-ticker results, keyed by `${ticker}:${test}`
  const [tickerResults, setTickerResults] = useState<
    Record<string, AsyncState<unknown>>
  >({});

  const setTickerResult = useCallback(
    (ticker: string, test: TickerTestKey, state: AsyncState<unknown>) => {
      setTickerResults((prev) => ({ ...prev, [`${ticker}:${test}`]: state }));
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

  const runAll = useCallback(() => {
    PORTFOLIO_TESTS.forEach((k) => runPortfolio[k]());
    tickers.forEach((t) => {
      runTickerTest(t, 'mispricing');
      runTickerTest(t, 'regime');
      runTickerTest(t, 'hv');
    });
  }, [runPortfolio, runTickerTest, tickers]);

  return (
    <div className="rv-card">
      <div
        className="rv-card-head"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <h3>Analytics · {account === 'all' ? 'all accounts' : account.replace('_', ' ')}</h3>
        <span style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11 }}
            onClick={runAll}
          >
            ▶ Run all (cheap tests)
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

      <div className="rv-sub" style={{ marginBottom: 8 }}>
        Per-ticker · {tickers.length} equity holding{tickers.length === 1 ? '' : 's'}
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
        ) : (
          tickers.map((t, idx) => (
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
                    }}
                  >
                    <span style={{ color: 'var(--ink-mute)' }}>{test.label}: </span>
                    {state.status === 'err' ? state.error : summarizeTickerResult(test.key, state.data)}
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
        title="Wheel 1y"
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
