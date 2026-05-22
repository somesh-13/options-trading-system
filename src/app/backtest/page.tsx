'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRICING_API_URL } from '@/lib/pricing-api';
import WheelResultsTable from '@/components/WheelResultsTable';
import BacktestHeader from '@/components/backtest/BacktestHeader';
import StrategyModeTabs from '@/components/backtest/StrategyModeTabs';
import StrategyToolbar from '@/components/backtest/StrategyToolbar';
import HeroPerformanceChart from '@/components/backtest/HeroPerformanceChart';
import KpiRibbon from '@/components/backtest/KpiRibbon';
import StrategyFactsheet from '@/components/backtest/StrategyFactsheet';
import ParameterDrawer from '@/components/backtest/ParameterDrawer';
import StrategyComparisonTable from '@/components/backtest/StrategyComparisonTable';
import TickerBreakdown from '@/components/backtest/TickerBreakdown';
import TradeHistoryTable from '@/components/backtest/TradeHistoryTable';
import { adaptCompareRun, adaptSingleRun, normalizeBenchmark, strategyColor } from '@/components/backtest/adapters';
import {
  BacktestMode,
  BacktestRun,
  ChartSeries,
  DEFAULT_PARAMETERS,
  STRATEGY_META,
  StrategyComparisonRow,
  StrategyParameters,
} from '@/components/backtest/types';

function paramsEqual(a: StrategyParameters, b: StrategyParameters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function BacktestPage() {
  const [mode, setMode] = useState<BacktestMode>('comparison');

  // Form state (live), committed state (last-run snapshot).
  const [parameters, setParameters] = useState<StrategyParameters>(DEFAULT_PARAMETERS);
  const [committed, setCommitted] = useState<StrategyParameters | null>(null);

  // Run results + UI state.
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [benchmarks, setBenchmarks] = useState<ChartSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const benchmarkCache = useRef<Map<string, ChartSeries>>(new Map());

  // Reset run state when switching modes — different shape per mode.
  useEffect(() => {
    setRun(null);
    setBenchmarks([]);
    setError(null);
  }, [mode]);

  const dirty = Boolean(committed) && !paramsEqual(parameters, committed!);

  const setFocusedId = (id: string) => {
    if (!run) return;
    setRun({ ...run, focusedId: id });
  };

  const focused = useMemo(() => {
    if (!run) return null;
    return run.strategies.find((s) => s.id === run.focusedId) ?? run.strategies[0] ?? null;
  }, [run]);

  // -------- benchmark fetch --------
  const fetchBenchmark = useCallback(
    async (
      symbol: string,
      startDate: string,
      endDate: string,
      initialCapital: number,
    ): Promise<ChartSeries | null> => {
      const cacheKey = `${symbol}:${startDate}:${endDate}:${initialCapital}`;
      const cached = benchmarkCache.current.get(cacheKey);
      if (cached) return cached;

      // Pull a generous window so the slice covers the strategy window.
      // The endpoint returns OHLC; we use close.
      const resp = await fetch(`${PRICING_API_URL}/api/market/${symbol}/price-history?period=MAX`);
      if (!resp.ok) return null;
      const data = await resp.json();
      const rows: Array<{ date: string; close: number }> = (data?.data ?? [])
        .map((r: { date: string; close: number }) => ({ date: r.date, close: r.close }))
        .filter((r: { date: string; close: number }) => r.date >= startDate && r.date <= endDate);
      const series = normalizeBenchmark(symbol as 'SPY' | 'QQQ' | 'IWM' | 'BTC', rows, initialCapital);
      if (series) benchmarkCache.current.set(cacheKey, series);
      return series;
    },
    [],
  );

  // -------- run handlers --------
  const runComparison = useCallback(async () => {
    if (parameters.tickers.length === 0) {
      setError('Select at least one ticker');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${PRICING_API_URL}/api/backtest/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers: parameters.tickers,
          start_date: parameters.startDate,
          end_date: parameters.endDate,
          initial_capital: parameters.initialCapital,
          strategies: ['iv_hv_arbitrage', 'ev_filtered', 'mean_reversion'],
          iv_hv_sell_threshold: parameters.ivHvSellThreshold,
          iv_hv_buy_threshold: parameters.ivHvBuyThreshold,
          ev_threshold: parameters.evThreshold,
          mean_reversion_z_entry: parameters.zEntry,
          mean_reversion_z_exit: parameters.zExit,
        }),
      });
      if (!resp.ok) throw new Error(`Comparative backtest failed (${resp.status})`);
      const apiData = await resp.json();
      const nextRun = adaptCompareRun(apiData, parameters);
      setRun(nextRun);
      setCommitted(parameters);

      // Fire benchmark fetch in background; don't block the UI.
      if (parameters.benchmark) {
        const series = await fetchBenchmark(
          parameters.benchmark,
          parameters.startDate,
          parameters.endDate,
          parameters.initialCapital,
        );
        setBenchmarks(series ? [series] : []);
      } else {
        setBenchmarks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [parameters, fetchBenchmark]);

  const runSingle = useCallback(async () => {
    const ticker = parameters.tickers[0];
    if (!ticker) {
      setError('Enter a ticker');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${PRICING_API_URL}/api/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          start_date: parameters.startDate,
          end_date: parameters.endDate,
          initial_capital: parameters.initialCapital,
          iv_hv_sell_threshold: parameters.ivHvSellThreshold,
          iv_hv_buy_threshold: parameters.ivHvBuyThreshold,
        }),
      });
      if (!resp.ok) throw new Error(`Backtest failed (${resp.status})`);
      const apiData = await resp.json();
      const nextRun = adaptSingleRun(apiData, 'iv_hv_arbitrage', parameters);
      setRun(nextRun);
      setCommitted(parameters);

      if (parameters.benchmark) {
        const series = await fetchBenchmark(
          parameters.benchmark,
          parameters.startDate,
          parameters.endDate,
          parameters.initialCapital,
        );
        setBenchmarks(series ? [series] : []);
      } else {
        setBenchmarks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [parameters, fetchBenchmark]);

  const primaryRun = mode === 'comparison' ? runComparison : runSingle;

  // -------- derived: chart series --------
  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!run) return [];
    const out: ChartSeries[] = run.strategies
      .filter((s) => s.equity.length > 0)
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: strategyColor(s.id),
        points: s.equity,
      }));
    out.push(...benchmarks);
    return out;
  }, [run, benchmarks]);

  // -------- derived: comparison rows --------
  const comparisonRows: StrategyComparisonRow[] = useMemo(() => {
    if (!run) return [];
    return run.strategies.map((s) => ({ ...s.summary, label: s.label }));
  }, [run]);

  // -------- title + tags for toolbar --------
  const focusedMeta = focused ? STRATEGY_META[focused.id] ?? null : null;
  const toolbarTitle =
    mode === 'comparison'
      ? focused
        ? `${focused.label} — focused`
        : 'Strategy Comparison'
      : focused?.label ?? 'Single Strategy Deep Dive';
  const toolbarSubtitle =
    mode === 'comparison'
      ? `${parameters.tickers.length} symbols · ${parameters.startDate} → ${parameters.endDate}`
      : `${parameters.tickers[0] ?? '—'} · ${parameters.startDate} → ${parameters.endDate}`;
  const toolbarTags = focusedMeta?.family ?? ['Volatility', 'Walk-forward', 'Options'];

  const ranAt = run ? new Date(run.runAt).toLocaleTimeString() : null;

  // -------- render --------
  return (
    <main className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="max-w-[1400px] mx-auto p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
        <BacktestHeader dirty={dirty} ranAt={ranAt} />

        <div className="flex flex-wrap items-center gap-3">
          <StrategyModeTabs mode={mode} onChange={setMode} />
          {mode !== 'wheel' && (
            <div className="ml-auto text-[11px] text-gray-500">
              Default landing emphasizes <span className="text-gray-300">outcomes first</span>.
              Adjust parameters below the chart.
            </div>
          )}
        </div>

        {mode === 'wheel' ? (
          // Wheel mode keeps the existing renderer — already a finished sub-feature.
          <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] p-1">
            <WheelResultsTable />
          </section>
        ) : (
          <>
            <StrategyToolbar
              title={toolbarTitle}
              subtitle={toolbarSubtitle}
              tags={toolbarTags}
              primaryAction={{
                label: mode === 'comparison' ? 'Run Comparison' : 'Run Backtest',
                onClick: primaryRun,
                disabled: loading,
                loading,
              }}
              secondaryActions={[
                { label: 'Save Preset', onClick: () => console.info('Save preset (TODO)') },
                { label: 'Clone', onClick: () => setCommitted(null) },
                {
                  label: 'Compare',
                  onClick: () => setMode(mode === 'comparison' ? 'single' : 'comparison'),
                },
              ]}
            />

            {error && (
              <div className="rounded-lg bg-[#FF006E]/10 ring-1 ring-inset ring-[#FF006E]/30 text-[#FF006E] px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <HeroPerformanceChart
              series={chartSeries}
              focusedId={focused?.id}
              initialCapital={parameters.initialCapital}
              title={
                run
                  ? mode === 'comparison'
                    ? 'Strategy Performance'
                    : `${focused?.label ?? ''} Equity Curve`
                  : 'Equity Curve'
              }
              subtitle={
                run
                  ? `Net of ${parameters.feesBps} bps fees · ${parameters.slippageBps} bps slippage${
                      parameters.benchmark ? ` · vs ${parameters.benchmark}` : ''
                    }`
                  : 'Configure parameters below and run a backtest'
              }
            />

            <KpiRibbon summary={focused?.summary ?? null} loading={loading} />

            <ParameterDrawer
              parameters={parameters}
              onChange={setParameters}
              disabled={loading}
              multiTicker={mode === 'comparison'}
              defaultOpen={!run}
            />

            {mode === 'comparison' && comparisonRows.length > 0 && (
              <StrategyComparisonTable
                rows={comparisonRows}
                focusedId={focused?.id}
                onFocus={setFocusedId}
              />
            )}

            <StrategyFactsheet
              meta={focusedMeta}
              parameters={parameters}
              universe={
                mode === 'comparison' ? parameters.tickers : parameters.tickers.slice(0, 1)
              }
            />

            {focused && focused.perTicker.length > 0 && (
              <TickerBreakdown stats={focused.perTicker} />
            )}

            {focused && focused.trades.length > 0 && (
              <TradeHistoryTable
                trades={focused.trades}
                title={`${focused.label} — Trades`}
              />
            )}

            {!run && !loading && (
              <section className="rounded-2xl border border-dashed border-[#1f2027] bg-[#0f1014]/50 p-8 text-center">
                <div className="text-sm text-gray-400 max-w-md mx-auto">
                  Pick a universe, set your date window, and click{' '}
                  <span className="text-[#22D3EE] font-medium">Run</span> to see the equity curve,
                  KPIs, and ranked strategy comparison.
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
