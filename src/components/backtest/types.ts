/**
 * Shared types for the redesigned Backtest workspace.
 *
 * The wire shapes (BacktestApiResult, CompareApiResult, etc.) mirror what the
 * FastAPI backend already returns from /api/backtest/run and
 * /api/backtest/compare — keeping these aligned with backend/src/api/models.py
 * is the contract. The "domain" shapes (BacktestRun, StrategySummary, etc.)
 * are what the UI components consume after a small normalization step in
 * adapters.ts — see that file for the API → domain mapping.
 */

export type StrategyId =
  | 'iv_hv_arbitrage'
  | 'ev_filtered'
  | 'mean_reversion'
  | 'wheel';

export type BenchmarkId = 'SPY' | 'QQQ' | 'IWM' | 'BTC';

export type BacktestMode = 'comparison' | 'single' | 'wheel';

export type AssetType = 'options' | 'stocks' | 'multi-asset';
export type Cadence = 'daily' | 'weekly' | 'monthly';

/** One point on an equity curve. */
export interface EquityPoint {
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
  /** Portfolio value at close on this date. */
  equity: number;
}

/** A strategy or benchmark line on the chart. */
export interface ChartSeries {
  id: string;
  label: string;
  /** Hex color for the line stroke. */
  color: string;
  /** Dashed for benchmarks, solid for strategies. */
  dashed?: boolean;
  /** True if this is a benchmark (controls grouping in the legend). */
  isBenchmark?: boolean;
  /** Equity points, sorted ascending by date. */
  points: EquityPoint[];
}

/** Headline metrics surfaced in the KPI ribbon + comparison table. */
export interface StrategySummary {
  strategy: StrategyId | string;
  totalReturnPct: number;
  cagr: number | null;
  sharpe: number;
  sortino: number | null;
  maxDrawdownPct: number;
  calmar: number | null;
  volatility: number | null;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgPnl: number;
  finalEquity: number;
  exposure: number | null;
  avgHoldingDays: number | null;
  lastBarPctChange?: number | null;
}

/** One trade row. */
export interface TradeRow {
  ticker?: string;
  entryDate: string;
  exitDate: string;
  direction: string;
  entryPrice: number;
  exitPrice: number;
  optionPremiumAtEntry?: number;
  optionPremiumAtExit?: number;
  pnl: number;
  pnlPct: number;
  ivHvRatio: number;
  holdingDays: number;
  exitReason: string;
}

/** Per-ticker analytics. */
export interface TickerStat {
  ticker: string;
  trades: number;
  winRate: number | null;
  avgPnl: number | null;
  totalPnl: number | null;
  /** Share of portfolio return contributed by this ticker, 0..1. */
  contribution: number | null;
  worstDrawdownPct: number | null;
  finalCapital: number;
}

/** What the user configured for a run — read by ParameterDrawer + page. */
export interface StrategyParameters {
  tickers: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  ivHvSellThreshold: number;
  ivHvBuyThreshold: number;
  evThreshold: number;
  zEntry: number;
  zExit: number;
  feesBps: number;
  slippageBps: number;
  positionSizingMode: 'equal' | 'risk-parity' | 'kelly-frac';
  rebalance: 'daily' | 'weekly' | 'monthly';
  benchmark: BenchmarkId | null;
}

export const DEFAULT_PARAMETERS: StrategyParameters = {
  tickers: ['CIFR', 'WULF', 'ONDS', 'HOOD', 'CLSK'],
  startDate: '2022-01-01',
  endDate: '2025-12-31',
  initialCapital: 100_000,
  ivHvSellThreshold: 1.15,
  ivHvBuyThreshold: 0.85,
  evThreshold: 25,
  zEntry: 1.0,
  zExit: 0.3,
  feesBps: 5,
  slippageBps: 2,
  positionSizingMode: 'equal',
  rebalance: 'daily',
  benchmark: 'SPY',
};

/** A row in the strategy comparison table. */
export interface StrategyComparisonRow extends StrategySummary {
  label: string;
}

/** Full run results — what page.tsx hands to its child components. */
export interface BacktestRun {
  /** Multi-strategy comparison: array of summaries; Single: one-element array. */
  strategies: Array<{
    id: string;
    label: string;
    summary: StrategySummary;
    equity: EquityPoint[];
    trades: TradeRow[];
    perTicker: TickerStat[];
  }>;
  /** Benchmark equity curves the user has enabled, already normalized to the
   *  strategy's initial capital so they can co-plot on one axis. */
  benchmarks: ChartSeries[];
  /** Strategy id currently in focus (drives KPI ribbon + factsheet + tables). */
  focusedId: string;
  /** Parameter snapshot for the run. */
  parameters: StrategyParameters;
  /** When the run started (ms since epoch). */
  runAt: number;
}

/** Static metadata for the strategy factsheet — frontend authored, not API. */
export interface StrategyFactsheetMeta {
  id: string;
  title: string;
  family: string[];
  cadence: Cadence;
  assetType: AssetType;
  description: string;
  entryLogic: string;
  exitLogic: string;
  riskControls: string;
  assumptions: string;
  oosStart: string;
  walkForward: string;
}

export const STRATEGY_META: Record<string, StrategyFactsheetMeta> = {
  iv_hv_arbitrage: {
    id: 'iv_hv_arbitrage',
    title: 'IV/HV Arbitrage',
    family: ['Volatility', 'Options', 'Mean Reverting'],
    cadence: 'daily',
    assetType: 'options',
    description:
      'Sells calls when implied vol trades rich versus realized vol, buys when implied trades cheap. Captures the volatility risk premium without holding directional exposure.',
    entryLogic: 'Enter SELL_CALL when IV/HV ≥ sell threshold; BUY_CALL when IV/HV ≤ buy threshold.',
    exitLogic: 'Close when ratio reverts past mid-band, on adverse vol move, or at 30-day max hold.',
    riskControls: 'Per-ticker capital cap; max 1 open position per ticker; no leverage.',
    assumptions: 'Daily mark-to-model premiums, BSM with realized HV(20). 5 bps slippage, 2 bps fees.',
    oosStart: '2024-01-01',
    walkForward: 'Rolling 12m train / 3m test; parameters refit at each fold boundary.',
  },
  ev_filtered: {
    id: 'ev_filtered',
    title: 'EV-Filtered',
    family: ['Volatility', 'Options', 'EV Gate'],
    cadence: 'daily',
    assetType: 'options',
    description:
      'IV/HV arbitrage gated by expected value per contract — only fires trades whose modeled EV clears a configurable $/contract floor.',
    entryLogic: 'IV/HV signal AND modeled EV ≥ EV threshold ($/contract).',
    exitLogic: 'Same as IV/HV Arbitrage; also exits when modeled EV decays below 0.',
    riskControls: 'Per-ticker capital cap; rejects trades whose modeled max-loss > 2× expected gain.',
    assumptions: 'EV computed from forward-vol cone + analyst PT distribution; daily refit.',
    oosStart: '2024-01-01',
    walkForward: 'Rolling 12m train / 3m test; refit parameters per fold.',
  },
  mean_reversion: {
    id: 'mean_reversion',
    title: 'Mean Reversion',
    family: ['Stat-arb', 'Equity', 'Mean Reverting'],
    cadence: 'daily',
    assetType: 'stocks',
    description:
      'Z-score based long/short signals on residual price after 20-day moving average. Long when z ≤ −entry, exit when z reverts toward 0.',
    entryLogic: 'Long when z-score ≤ −zEntry; short when z ≥ zEntry.',
    exitLogic: 'Close when |z| ≤ zExit, on stop-loss, or at 10-day max hold.',
    riskControls: 'Beta-neutral basket; max 5 concurrent positions; 2% per-position stop.',
    assumptions: 'Stock prices only, no options. Slippage modeled at 2 bps.',
    oosStart: '2024-01-01',
    walkForward: 'Rolling 12m train / 3m test.',
  },
  wheel: {
    id: 'wheel',
    title: 'Wheel (CSP + CC)',
    family: ['Options', 'Income', 'Premium Selling'],
    cadence: 'weekly',
    assetType: 'options',
    description:
      'Cash-secured puts at Keltner channel bottom, covered calls at Keltner top. Held to expiry; assigned shares cycle into the call leg.',
    entryLogic: 'CSP when price tags lower Keltner band; CC after assignment when price tags upper band.',
    exitLogic: 'Hold to expiry; let options assign or expire.',
    riskControls: 'Per-ticker max-share cap; no margin; only enters on positive IV/HV gate.',
    assumptions: '7–14 DTE strikes, ~0.25 delta. Slippage 5 bps, commissions $0.65/contract.',
    oosStart: '2023-01-01',
    walkForward: 'Walk-forward by ticker; parameters fixed across the OOS window.',
  },
};

export const STRATEGY_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(STRATEGY_META).map((m) => [m.id, m.title]),
);

/** Visual color per strategy + benchmark — kept stable across the page. */
export const STRATEGY_COLORS: Record<string, string> = {
  iv_hv_arbitrage: '#22D3EE', // cyan — primary VegaEdge accent
  ev_filtered: '#A78BFA',     // violet
  mean_reversion: '#FBBF24',  // amber
  wheel: '#34D399',           // emerald
};

export const BENCHMARK_COLORS: Record<BenchmarkId, string> = {
  SPY: '#EC4899', // pink
  QQQ: '#F472B6',
  IWM: '#FB7185',
  BTC: '#F59E0B',
};

/** Date range preset → number of days back. */
export const RANGE_PRESETS: Array<{ id: string; label: string; days: number | 'ytd' | 'max' }> = [
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 180 },
  { id: 'YTD', label: 'YTD', days: 'ytd' },
  { id: '1Y', label: '1Y', days: 365 },
  { id: '3Y', label: '3Y', days: 365 * 3 },
  { id: 'MAX', label: 'MAX', days: 'max' },
];
