/**
 * API → domain adapters.
 *
 * The backend at /api/backtest/run and /api/backtest/compare returns snake_case
 * shapes (matching backend/src/api/models.py). The redesigned UI consumes
 * camelCase domain types from `./types`. These adapters bridge the two and
 * fill in defaults for newly-added fields (CAGR, Sortino, etc.) that the
 * backend doesn't yet emit — UI displays "—" when the underlying field is null.
 */

import {
  BacktestRun,
  ChartSeries,
  EquityPoint,
  StrategyParameters,
  StrategySummary,
  TickerStat,
  TradeRow,
  BENCHMARK_COLORS,
  BenchmarkId,
  STRATEGY_COLORS,
  STRATEGY_LABELS,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: any, fallback: number | null = null): number | null => {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const reqNum = (v: any, fallback = 0): number => num(v, fallback) ?? fallback;

function buildSummary(strategyId: string, m: any): StrategySummary {
  const totalReturnPct = reqNum(m?.total_return_pct);
  const maxDdPct = reqNum(m?.max_drawdown_pct);
  const calmar = m?.calmar_ratio != null ? reqNum(m.calmar_ratio) : null;
  return {
    strategy: strategyId,
    totalReturnPct,
    cagr: num(m?.cagr_pct ?? m?.annualized_return_pct),
    sharpe: reqNum(m?.sharpe_ratio),
    sortino: num(m?.sortino_ratio),
    maxDrawdownPct: maxDdPct,
    calmar,
    volatility: num(m?.volatility_pct ?? m?.annualized_vol_pct),
    winRate: reqNum(m?.win_rate),
    profitFactor: reqNum(m?.profit_factor),
    totalTrades: reqNum(m?.total_trades),
    avgPnl: reqNum(m?.avg_pnl),
    finalEquity: reqNum(m?.final_equity),
    exposure: num(m?.exposure_pct),
    avgHoldingDays: num(m?.avg_holding_days),
    lastBarPctChange: num(m?.last_bar_pct_change),
  };
}

function tradeRow(t: any): TradeRow {
  return {
    ticker: t.ticker ?? undefined,
    entryDate: t.entry_date,
    exitDate: t.exit_date,
    direction: t.direction,
    entryPrice: reqNum(t.entry_price),
    exitPrice: reqNum(t.exit_price),
    optionPremiumAtEntry: t.option_premium_at_entry ?? undefined,
    optionPremiumAtExit: t.option_premium_at_exit ?? undefined,
    pnl: reqNum(t.pnl),
    pnlPct: reqNum(t.pnl_pct),
    ivHvRatio: reqNum(t.iv_hv_ratio),
    holdingDays: reqNum(t.holding_days),
    exitReason: t.exit_reason ?? '',
  };
}

function tickerStatsFromMap(
  perTicker: Record<string, { trades: number; final_capital: number }>,
  trades: TradeRow[],
  initialCapital: number,
): TickerStat[] {
  const out: TickerStat[] = [];
  for (const [ticker, info] of Object.entries(perTicker || {})) {
    const tt = trades.filter((tr) => tr.ticker === ticker);
    const wins = tt.filter((tr) => tr.pnl > 0).length;
    const total = tt.reduce((s, tr) => s + tr.pnl, 0);
    const avg = tt.length ? total / tt.length : null;
    out.push({
      ticker,
      trades: info?.trades ?? tt.length,
      winRate: tt.length ? (100 * wins) / tt.length : null,
      avgPnl: avg,
      totalPnl: tt.length ? total : null,
      contribution: initialCapital
        ? (info?.final_capital - initialCapital / Math.max(Object.keys(perTicker).length, 1)) /
          initialCapital
        : null,
      worstDrawdownPct: null, // backend doesn't currently emit per-ticker DD
      finalCapital: info?.final_capital ?? 0,
    });
  }
  return out.sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0));
}

/** Convert /api/backtest/run response → single-strategy BacktestRun. */
export function adaptSingleRun(
  api: any,
  strategyId: string,
  parameters: StrategyParameters,
): BacktestRun {
  const trades: TradeRow[] = (api?.trades ?? []).map(tradeRow);
  const equity: EquityPoint[] = (api?.equity_curve ?? []).map((p: any) => ({
    date: p.date,
    equity: reqNum(p.equity),
  }));
  // Single-strategy run is one ticker — derive a trivial per-ticker stat.
  const ticker = (api?.config?.ticker as string) || parameters.tickers[0] || '';
  const tradesWithTicker: TradeRow[] = trades.map((t: TradeRow) => ({ ...t, ticker }));
  const tickerStats: TickerStat[] = ticker
    ? tickerStatsFromMap(
        { [ticker]: { trades: trades.length, final_capital: reqNum(api?.metrics?.final_equity) } },
        tradesWithTicker,
        parameters.initialCapital,
      )
    : [];

  return {
    strategies: [
      {
        id: strategyId,
        label: STRATEGY_LABELS[strategyId] ?? strategyId,
        summary: buildSummary(strategyId, api?.metrics),
        equity,
        trades: tradesWithTicker,
        perTicker: tickerStats,
      },
    ],
    benchmarks: [],
    focusedId: strategyId,
    parameters,
    runAt: Date.now(),
  };
}

/** Convert /api/backtest/compare response → multi-strategy BacktestRun. */
export function adaptCompareRun(api: any, parameters: StrategyParameters): BacktestRun {
  const strategies = (api?.comparison ?? []).map((row: any) => {
    const sid: string = row.strategy;
    const detail = api?.strategies?.[sid] ?? {};
    const trades = (detail.trades ?? []).map(tradeRow);
    const equity: EquityPoint[] = (detail.equity_curve ?? []).map((p: any) => ({
      date: p.date,
      equity: reqNum(p.equity),
    }));
    return {
      id: sid,
      label: STRATEGY_LABELS[sid] ?? sid,
      summary: buildSummary(sid, { ...row, ...(detail.metrics ?? {}) }),
      equity,
      trades,
      perTicker: tickerStatsFromMap(detail.per_ticker ?? {}, trades, parameters.initialCapital),
    };
  });

  return {
    strategies,
    benchmarks: [],
    focusedId: strategies[0]?.id ?? '',
    parameters,
    runAt: Date.now(),
  };
}

/** Normalize a benchmark price history to a synthetic equity curve that
 *  starts at `initialCapital` so it can be co-plotted with strategy lines. */
export function normalizeBenchmark(
  id: BenchmarkId,
  prices: Array<{ date: string; close: number }>,
  initialCapital: number,
): ChartSeries | null {
  if (!prices?.length) return null;
  const base = prices[0].close;
  if (!Number.isFinite(base) || base === 0) return null;
  return {
    id: `bench:${id}`,
    label: id,
    color: BENCHMARK_COLORS[id],
    dashed: true,
    isBenchmark: true,
    points: prices.map((p) => ({
      date: p.date,
      equity: initialCapital * (p.close / base),
    })),
  };
}

export function strategyColor(strategyId: string): string {
  return STRATEGY_COLORS[strategyId] ?? '#22D3EE';
}
