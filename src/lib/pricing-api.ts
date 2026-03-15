/**
 * API Client for Python Pricing Engine
 * Connects Next.js frontend to FastAPI backend (port 8000)
 */

const PRICING_API_URL = process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000';

export interface OptionParams {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  option_type: 'call' | 'put';
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
  vanna?: number;
  charm?: number;
  volga?: number;
}

export interface PricingResponse {
  price: number;
  greeks: Greeks;
  parameters: OptionParams;
}

export interface ImpliedVolResponse {
  implied_volatility: number;
  market_price: number;
}

export interface MispricingData {
  ticker: string;
  spot_price: number;
  historical_vol: number;
  implied_vol_atm: number;
  iv_hv_ratio: number;
  signal: 'SELL' | 'BUY' | 'NEUTRAL';
  expiration: string;
  atm_strike: number;
  atm_call_price: number;
  bid: number;
  ask: number;
  volume: number;
  open_interest: number;
}

export async function calculatePriceAndGreeks(params: OptionParams): Promise<PricingResponse> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/greeks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Pricing calculation failed');
  }

  return response.json();
}

export async function calculateImpliedVol(
  market_price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  option_type: 'call' | 'put'
): Promise<number> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/implied-vol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market_price, S, K, T, r, option_type }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'IV solver failed');
  }

  const data: ImpliedVolResponse = await response.json();
  return data.implied_volatility;
}

export async function getCifrMispricing(): Promise<MispricingData> {
  const response = await fetch(`${PRICING_API_URL}/api/mispricing/cifr`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Mispricing detection failed');
  }

  return response.json();
}

export async function getCifrPrice(): Promise<number> {
  const response = await fetch(`${PRICING_API_URL}/api/market/cifr/price`);

  if (!response.ok) {
    throw new Error('Failed to fetch CIFR price');
  }

  const data = await response.json();
  return data.price;
}

// === NEW TYPES ===

export interface IVCompareResult {
  newton_raphson: {
    iv: number | null;
    iterations: number | null;
    time_ms: number;
    converged: boolean;
  };
  bisection: {
    iv: number | null;
    iterations: number | null;
    time_ms: number;
    converged: boolean;
  };
}

export interface VolSurfaceData {
  strikes: number[];
  expirations: string[];
  iv_matrix: (number | null)[][];
  spot_price: number;
  ticker: string;
}

export interface HedgeForecastData {
  delta_decay: {
    days: number[];
    deltas: number[];
    gammas: number[];
    thetas: number[];
    initial_delta: number;
  };
  vol_shock: {
    shocks: number[];
    deltas: number[];
    gammas: number[];
    vegas: number[];
    current_delta: number;
    current_sigma: number;
  };
  rehedge: {
    frequency: string;
    urgency: string;
    gamma: number;
    estimated_daily_delta_change: number;
    days_to_expiry: number;
  };
}

export interface RegimeData {
  ticker: string;
  regime: string;
  probability: number;
  regime_means: number[];
  regime_vols: number[];
  regime_probs: number[];
  regime_labels: string[];
  n_regimes: number;
  lookback_days: number;
  error?: string;
}

export interface HVConfidenceData {
  ticker: string;
  hv: number;
  ci_lower: number;
  ci_upper: number;
  confidence: number;
  parkinson_hv: number;
  ci_width: number;
  reliable: boolean;
  window: number;
}

export interface StressTestResult {
  positions: Array<{
    current: { price: number; greeks: Record<string, number> };
    stressed: { price: number; greeks: Record<string, number>; spot: number; sigma: number };
    pnl: number;
    attribution: Record<string, number>;
    qty: number;
  }>;
  total_pnl: number;
  total_attribution: Record<string, number>;
  spot_shock_pct: number;
  vol_shock_pct: number;
}

export interface PnLAttributionData {
  attribution: Record<string, number>;
  greeks: Record<string, number>;
}

export interface TCAData {
  ticker: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spread_pct: number;
  slippage_estimate: number;
  tca_per_contract: number;
  iv: number;
  hv: number;
  edge_dollars: number;
  edge_survives_tca: boolean;
  atm_strike: number;
  expiration: string;
}

// === NEW API FUNCTIONS ===

export async function compareIVSolvers(
  market_price: number, S: number, K: number, T: number, r: number, option_type: 'call' | 'put'
): Promise<IVCompareResult> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/implied-vol/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market_price, S, K, T, r, option_type }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'IV comparison failed');
  }
  return response.json();
}

export async function getVolSurface(ticker: string): Promise<VolSurfaceData> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/vol-surface/${ticker}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Vol surface fetch failed');
  }
  return response.json();
}

export async function getHedgeForecast(params: OptionParams & { days?: number }): Promise<HedgeForecastData> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/hedge-forecast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Hedge forecast failed');
  }
  return response.json();
}

export async function getMispricing(ticker: string): Promise<MispricingData> {
  const response = await fetch(`${PRICING_API_URL}/api/market/${ticker}/mispricing`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Mispricing detection failed');
  }
  return response.json();
}

export async function getRegime(ticker: string): Promise<RegimeData> {
  const response = await fetch(`${PRICING_API_URL}/api/market/${ticker}/regime`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Regime detection failed');
  }
  return response.json();
}

export async function getHVConfidence(ticker: string, window: number = 30): Promise<HVConfidenceData> {
  const response = await fetch(`${PRICING_API_URL}/api/market/${ticker}/hv-confidence?window=${window}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'HV confidence fetch failed');
  }
  return response.json();
}

export async function runStressTest(
  positions: Array<Record<string, unknown>>,
  spot_shock_pct: number,
  vol_shock_pct: number
): Promise<StressTestResult> {
  const response = await fetch(`${PRICING_API_URL}/api/risk/stress-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions, spot_shock_pct, vol_shock_pct }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Stress test failed');
  }
  return response.json();
}

export async function getPnLAttribution(params: {
  S: number; K: number; T: number; r: number; sigma: number;
  option_type: 'call' | 'put'; qty?: number;
  delta_S: number; delta_sigma: number; delta_t: number;
}): Promise<PnLAttributionData> {
  const response = await fetch(`${PRICING_API_URL}/api/risk/pnl-attribution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'P&L attribution failed');
  }
  return response.json();
}

export async function getTCA(ticker: string): Promise<TCAData> {
  const response = await fetch(`${PRICING_API_URL}/api/risk/tca/${ticker}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'TCA fetch failed');
  }
  return response.json();
}

// === Phase 2-7 API Functions ===

export async function getSentimentAnalysis(ticker: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/sentiment/${ticker}`);
  if (!response.ok) throw new Error('Sentiment analysis failed');
  return response.json();
}

export async function runBacktest(params: {
  ticker: string; start_date: string; end_date: string;
  initial_capital?: number; iv_hv_sell_threshold?: number;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Backtest failed');
  return response.json();
}

export async function calculateEV(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/strategy/ev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('EV calculation failed');
  return response.json();
}

export async function getHedgeRatio(positions: Array<Record<string, unknown>>, targetDelta: number = 0): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/hedge/ratio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions, target_delta: targetDelta }),
  });
  if (!response.ok) throw new Error('Hedge calculation failed');
  return response.json();
}

export async function getVaR(ticker: string, portfolioValue: number = 100000, confidence: number = 0.95): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/risk/var/${ticker}?portfolio_value=${portfolioValue}&confidence=${confidence}&method=all`);
  if (!response.ok) throw new Error('VaR calculation failed');
  return response.json();
}

// === Options Trading API Functions ===

export async function getOptionsContracts(
  underlyingSymbol: string,
  filters?: {
    expiration_date?: string;
    expiration_date_gte?: string;
    expiration_date_lte?: string;
    strike_price_gte?: number;
    strike_price_lte?: number;
    option_type?: string;
  }
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ underlying_symbol: underlyingSymbol });
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
  }
  const response = await fetch(`${PRICING_API_URL}/api/execution/options/contracts?${params}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Contracts fetch failed');
  }
  return response.json();
}

export async function getOptionsChainSnapshot(
  underlying: string,
  filters?: {
    expiration_date?: string;
    option_type?: string;
    strike_price_gte?: number;
    strike_price_lte?: number;
  }
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
  }
  const qs = params.toString() ? `?${params}` : '';
  const response = await fetch(`${PRICING_API_URL}/api/execution/options/chain/${underlying}${qs}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Chain snapshot failed');
  }
  return response.json();
}

export async function submitOptionsOrder(params: {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  limit_price?: number;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/execution/options/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Options order failed');
  }
  return response.json();
}

// === Trade Journal Types & API ===

export interface TradeRecord {
  id: number;
  order_id: string | null;
  timestamp: string;
  symbol: string;
  asset_class: string;
  side: string;
  qty: number;
  order_type: string;
  limit_price: number | null;
  filled_price: number | null;
  filled_qty: number | null;
  status: string;
  signal_source: string;
  signal_data: Record<string, unknown> | null;
  related_trade_id: number | null;
  realized_pnl: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PnLSummary {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  breakeven_trades: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
  win_rate: number;
  profit_factor: number | string;
  gross_profit: number;
  gross_loss: number;
}

export interface SignalStats {
  signal_source: string;
  total_trades: number;
  winners: number;
  losers: number;
  total_pnl: number;
  avg_pnl: number;
  win_rate: number;
}

export interface EngineStatus {
  state: string;
  config: Record<string, unknown>;
  stats: {
    scans_completed: number;
    trades_executed: number;
    trades_skipped: number;
    errors: number;
    last_scan_time: string | null;
    last_trade_time: string | null;
    started_at: string | null;
    stopped_at: string | null;
  };
}

export interface EngineLogEntry {
  id: number;
  timestamp: string;
  event_type: string;
  ticker: string | null;
  details: Record<string, unknown> | null;
  trade_id: number | null;
}

export async function getTradeHistory(filters?: {
  symbol?: string;
  status?: string;
  signal_source?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ trades: TradeRecord[]; count: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
  }
  const qs = params.toString() ? `?${params}` : '';
  const response = await fetch(`${PRICING_API_URL}/api/journal/trades${qs}`);
  if (!response.ok) throw new Error('Failed to fetch trade history');
  return response.json();
}

export async function getPnLSummary(): Promise<PnLSummary> {
  const response = await fetch(`${PRICING_API_URL}/api/journal/pnl`);
  if (!response.ok) throw new Error('Failed to fetch P&L summary');
  return response.json();
}

export async function getPnLBySignal(): Promise<{ signal_stats: SignalStats[] }> {
  const response = await fetch(`${PRICING_API_URL}/api/journal/pnl/by-signal`);
  if (!response.ok) throw new Error('Failed to fetch P&L by signal');
  return response.json();
}

export async function syncOrderStatuses(): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/journal/sync`, { method: 'POST' });
  if (!response.ok) throw new Error('Sync failed');
  return response.json();
}

export async function getActivityLog(filters?: {
  event_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: EngineLogEntry[]; count: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
  }
  const qs = params.toString() ? `?${params}` : '';
  const response = await fetch(`${PRICING_API_URL}/api/journal/activity-log${qs}`);
  if (!response.ok) throw new Error('Failed to fetch activity log');
  return response.json();
}

// === Auto Engine API ===

export async function startEngine(): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/engine/start`, { method: 'POST' });
  if (!response.ok) throw new Error('Engine start failed');
  return response.json();
}

export async function stopEngine(): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/engine/stop`, { method: 'POST' });
  if (!response.ok) throw new Error('Engine stop failed');
  return response.json();
}

export async function getEngineStatus(): Promise<EngineStatus> {
  const response = await fetch(`${PRICING_API_URL}/api/engine/status`);
  if (!response.ok) throw new Error('Engine status failed');
  return response.json();
}

export async function updateEngineConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${PRICING_API_URL}/api/engine/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error('Config update failed');
  return response.json();
}

export async function getEngineLogs(filters?: {
  event_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: EngineLogEntry[]; count: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
  }
  const qs = params.toString() ? `?${params}` : '';
  const response = await fetch(`${PRICING_API_URL}/api/engine/logs${qs}`);
  if (!response.ok) throw new Error('Failed to fetch engine logs');
  return response.json();
}

// === Portfolio Monitoring Types & API ===

export interface PositionWithGreeks {
  symbol: string;
  qty: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  avg_entry_price: string;
  asset_class: string;
  parsed_symbol: string;
  position_type: 'stock' | 'option';
  greeks: {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    rho: number;
  };
  bs_price: number | null;
  bs_params: Record<string, unknown> | null;
}

export interface PortfolioGreeks {
  total_delta: number;
  total_gamma: number;
  total_vega: number;
  total_theta: number;
  total_rho: number;
}

export interface PositionsGreeksResponse {
  positions: PositionWithGreeks[];
  portfolio_greeks: PortfolioGreeks;
  position_count: number;
  timestamp: string;
}

export interface PortfolioSummaryResponse {
  account: Record<string, string>;
  portfolio_greeks: PortfolioGreeks;
  pnl_summary: PnLSummary | Record<string, never>;
  position_count: number;
  timestamp: string;
}

export interface EquityHistoryResponse {
  equity: (number | null)[];
  timestamp: number[];
  profit_loss: (number | null)[];
  profit_loss_pct: (number | null)[];
  base_value: number;
  timeframe: string;
}

export async function getPositionsWithGreeks(): Promise<PositionsGreeksResponse> {
  const response = await fetch(`${PRICING_API_URL}/api/portfolio/positions-greeks`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Positions-Greeks fetch failed');
  }
  return response.json();
}

export async function getPortfolioSummary(): Promise<PortfolioSummaryResponse> {
  const response = await fetch(`${PRICING_API_URL}/api/portfolio/summary`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Portfolio summary failed');
  }
  return response.json();
}

export async function getEquityHistory(period: string = '1M', timeframe: string = '1D'): Promise<EquityHistoryResponse> {
  const response = await fetch(`${PRICING_API_URL}/api/portfolio/equity-history?period=${period}&timeframe=${timeframe}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Equity history failed');
  }
  return response.json();
}

// === Market Status ===

export interface MarketStatus {
  status: 'open' | 'extended' | 'closed';
  current_time_et: string;
  next_open: string | null;
  next_close: string | null;
}

export async function getMarketStatus(): Promise<MarketStatus> {
  const response = await fetch(`${PRICING_API_URL}/api/portfolio/market-status`);
  if (!response.ok) throw new Error('Market status fetch failed');
  return response.json();
}

// === Price History ===

export interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistoryData {
  ticker: string;
  period: string;
  interval: string;
  data: PriceHistoryPoint[];
}

export async function getPriceHistory(ticker: string, period: string = '1M'): Promise<PriceHistoryData> {
  const response = await fetch(`${PRICING_API_URL}/api/market/${ticker}/price-history?period=${period}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Price history fetch failed');
  }
  return response.json();
}

// === Multi-Strategy Backtesting ===

export interface ComparativeBacktestResult {
  config: Record<string, unknown>;
  comparison: Array<{
    strategy: string;
    total_return_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate: number;
    profit_factor: number;
    total_trades: number;
    avg_pnl: number;
    final_equity: number;
  }>;
  strategies: Record<string, {
    strategy: string;
    metrics: Record<string, number>;
    trades: Array<Record<string, unknown>>;
    equity_curve: Array<{ date: string; equity: number }>;
    monthly_returns: Array<{ month: string; return_pct: number }>;
    per_ticker: Record<string, { trades: number; final_capital: number }>;
  }>;
}

export async function runComparativeBacktest(params: {
  tickers?: string[];
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
  strategies?: string[];
  iv_hv_sell_threshold?: number;
  iv_hv_buy_threshold?: number;
  ev_threshold?: number;
  mean_reversion_z_entry?: number;
  mean_reversion_z_exit?: number;
}): Promise<ComparativeBacktestResult> {
  const response = await fetch(`${PRICING_API_URL}/api/backtest/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Comparative backtest failed');
  return response.json();
}
