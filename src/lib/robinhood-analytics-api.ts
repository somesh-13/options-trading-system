/**
 * Client wrappers for Robinhood-aware analytics endpoints.
 *
 * Two layers:
 *   1. `/api/robinhood/analytics/*` and `/api/risk/var/{ticker}` go through
 *      Next.js server-side route handlers (because `risk/hedge/strategy` are
 *      excluded from BACKEND_PROXY_PREFIXES in next.config.ts for security).
 *   2. Per-ticker endpoints (`sentiment`, `market`, `agents`, `backtest`) are
 *      already in BACKEND_PROXY_PREFIXES — calls land on the same-origin
 *      rewrite directly.
 *
 * All wrappers use `PRICING_API_URL` (same-origin by default) so they work in
 * dev, LAN IP, and ngrok unchanged.
 */

import { PRICING_API_URL } from './pricing-api';
import type { RobinhoodAccount } from './robinhood-api';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PRICING_API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
      else if (body?.error) detail = body.error;
    } catch {
      /* body was not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PRICING_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
      else if (j?.error) detail = j.error;
    } catch {
      /* body was not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// ---- Portfolio-level analytics (server-side proxy → backend adapter) ------

export interface SkippedLeg {
  underlying: string;
  side: string;
  strike: number;
  expiry: string;
  position: string;
  qty: number;
  reason: string;
}

export interface AnalyticsAssumptions {
  risk_free_rate: number;
  hv_window_days: number;
  vol_fallback: number;
  vol_source: string;
}

export interface PortfolioGreeksResult {
  total_delta: number;
  total_gamma: number;
  total_vega: number;
  total_theta: number;
  total_rho: number;
  position_count: number;
  per_position: Array<{
    strike: number;
    type: string;
    qty: number;
    price: number;
    greeks: { delta: number; gamma: number; vega: number; theta: number; rho: number };
  }>;
  skipped?: SkippedLeg[];
  assumptions?: AnalyticsAssumptions;
  error?: string;
  message?: string;
}

export function getPortfolioGreeks(account: RobinhoodAccount): Promise<PortfolioGreeksResult> {
  return getJson(`/api/robinhood/analytics/portfolio-greeks?account=${account}`);
}

export interface HedgeRatioResult {
  current_delta: number;
  target_delta: number;
  hedge_shares: number;
  hedge_direction: 'BUY' | 'SELL' | 'NONE';
  hedge_notional: number;
  portfolio_greeks: PortfolioGreeksResult;
  skipped?: SkippedLeg[];
  assumptions?: AnalyticsAssumptions;
  error?: string;
  message?: string;
}

export function getHedgeRatio(
  account: RobinhoodAccount,
  targetDelta = 0,
): Promise<HedgeRatioResult> {
  return getJson(
    `/api/robinhood/analytics/hedge-ratio?account=${account}&target_delta=${targetDelta}`,
  );
}

export interface RebalanceCheckResult {
  needs_rebalance: boolean;
  breaches: Array<{ greek: string; current: number; limit: number; severity: string }>;
  breach_count: number;
  max_severity: string;
  hedge_recommendation: HedgeRatioResult | null;
  portfolio_greeks: PortfolioGreeksResult;
  skipped?: SkippedLeg[];
  assumptions?: AnalyticsAssumptions;
  error?: string;
  message?: string;
}

export function getRebalanceCheck(
  account: RobinhoodAccount,
  deltaLimit = 100,
  gammaLimit = 50,
  vegaLimit = 500,
): Promise<RebalanceCheckResult> {
  const qs = new URLSearchParams({
    account,
    delta_limit: String(deltaLimit),
    gamma_limit: String(gammaLimit),
    vega_limit: String(vegaLimit),
  });
  return getJson(`/api/robinhood/analytics/rebalance-check?${qs.toString()}`);
}

export interface StressTestResult {
  positions?: Array<Record<string, unknown>>;
  total_pnl?: number;
  total_attribution?: Record<string, number>;
  spot_shock_pct?: number;
  vol_shock_pct?: number;
  skipped?: SkippedLeg[];
  assumptions?: AnalyticsAssumptions;
  error?: string;
  message?: string;
  [k: string]: unknown;
}

export function getStressTest(
  account: RobinhoodAccount,
  spotShock = 0.10,
  volShock = 0.20,
): Promise<StressTestResult> {
  const qs = new URLSearchParams({
    account,
    spot_shock: String(spotShock),
    vol_shock: String(volShock),
  });
  return getJson(`/api/robinhood/analytics/stress-test?${qs.toString()}`);
}

export interface LimitsCheckResult {
  status: 'OK' | 'WARNING' | 'VIOLATION';
  risk_score: number;
  violations: Array<{ greek: string; current: number; limit: number; utilization_pct: number; level: string }>;
  warnings: Array<{ greek: string; current: number; limit: number; utilization_pct: number; level: string }>;
  total_checks: number;
  action: string;
  portfolio_greeks?: Record<string, number>;
  error?: string;
  message?: string;
}

export function getLimitsCheck(
  account: RobinhoodAccount,
  maxDelta = 10000,
  maxGamma = 500,
  maxVega = 10000,
): Promise<LimitsCheckResult> {
  const qs = new URLSearchParams({
    account,
    max_delta: String(maxDelta),
    max_gamma: String(maxGamma),
    max_vega: String(maxVega),
  });
  return getJson(`/api/robinhood/analytics/limits-check?${qs.toString()}`);
}

export interface DrawdownResult {
  current_equity: number;
  peak_equity: number;
  drawdown_pct: number;
  limit_pct: number;
  breached: boolean;
  action: string;
  remaining_buffer_pct: number;
  inputs?: { market_value: number; cash_flows: number; total_invested: number };
  caveat?: string;
  error?: string;
  message?: string;
}

export function getDrawdown(
  account: RobinhoodAccount,
  limit = 0.10,
): Promise<DrawdownResult> {
  return getJson(`/api/robinhood/analytics/drawdown?account=${account}&limit=${limit}`);
}

// ---- Per-ticker endpoints (already in public rewrite or own proxy) --------

export interface VaRResult {
  ticker?: string;
  historical?: Record<string, number>;
  parametric?: Record<string, number>;
  monte_carlo?: Record<string, number>;
  recommended?: { method: string; var_95: number; var_99: number };
  [k: string]: unknown;
}

export function getVaR(ticker: string): Promise<VaRResult> {
  return getJson(`/api/risk/var/${encodeURIComponent(ticker)}?method=all`);
}

export interface MispricingResult {
  ticker: string;
  spot_price: number;
  historical_vol: number;
  implied_vol_atm: number;
  iv_hv_ratio: number;
  signal: string;
  atm_strike?: number;
  atm_call_price?: number;
  [k: string]: unknown;
}

export function getMispricing(ticker: string): Promise<MispricingResult> {
  return getJson(`/api/market/${encodeURIComponent(ticker)}/mispricing`);
}

export interface RegimeResult {
  ticker: string;
  regime: string;
  probability: number;
  regime_means: number[];
  regime_vols: number[];
  regime_probs: number[];
  regime_labels: string[];
  n_regimes: number;
  lookback_days: number;
  [k: string]: unknown;
}

export function getRegime(ticker: string): Promise<RegimeResult> {
  return getJson(`/api/market/${encodeURIComponent(ticker)}/regime`);
}

export interface HVConfidenceResult {
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

export function getHVConfidence(ticker: string): Promise<HVConfidenceResult> {
  return getJson(`/api/market/${encodeURIComponent(ticker)}/hv-confidence`);
}

export interface SentimentResult {
  ticker: string;
  company?: { name?: string; current_price?: number; [k: string]: unknown };
  sentiment?: Record<string, number>;
  bayesian_update?: Record<string, unknown>;
  data_sources?: string[];
  article_count?: number;
  [k: string]: unknown;
}

export function getSentiment(ticker: string): Promise<SentimentResult> {
  return getJson(`/api/sentiment/${encodeURIComponent(ticker)}`);
}

export interface ConfluenceResult {
  ticker: string;
  confluence?: number;
  signals?: Record<string, unknown>;
  recommendation?: string;
  [k: string]: unknown;
}

export function getConfluence(ticker: string): Promise<ConfluenceResult> {
  return getJson(`/api/agents/confluence/${encodeURIComponent(ticker)}`);
}

export interface TradeRecommendation {
  ticker: string;
  strategy?: string;
  recommendation?: string;
  strikes?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export function getTradeRecommendation(
  ticker: string,
  strategyOverride?: string,
): Promise<TradeRecommendation> {
  const body: Record<string, string> = { ticker: ticker.toUpperCase() };
  if (strategyOverride) body.strategy_override = strategyOverride;
  return postJson('/api/agents/trade-recommendation', body);
}

export interface BacktestResult {
  config?: Record<string, unknown>;
  metrics?: Record<string, number>;
  trades?: Array<Record<string, unknown>>;
  equity_curve?: number[];
  monthly_returns?: Record<string, number>;
  [k: string]: unknown;
}

export function runBacktest(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<BacktestResult> {
  return postJson('/api/backtest/run', {
    ticker: ticker.toUpperCase(),
    start_date: startDate,
    end_date: endDate,
    initial_capital: 100000,
  });
}

export interface WheelBacktestResult {
  results?: Record<string, unknown>;
  summary?: {
    ticker_count: number;
    total_csp_fires: number;
    total_cc_fires: number;
    total_trades: number;
    total_assignments: number;
    total_premium_usd: number;
    total_csp_premium_usd: number;
    total_cc_premium_usd: number;
    total_realized_share_pnl_usd: number;
    total_unrealized_share_pnl_usd: number;
    total_return_usd: number;
    total_max_capital_usd: number;
    weighted_return_pct_of_max_cap: number;
    final_share_inventory: Record<string, number>;
  };
  caveats?: string[];
}

export function getWheelBacktest(): Promise<WheelBacktestResult> {
  return getJson('/api/backtest/wheel');
}

// ---- Analytics report run API --------------------------------------------

export interface AnalyticsRunCreateRequest {
  account?: string;
  ticker_count?: number;
  payload: unknown;
  notes?: string;
}

export interface AnalyticsRunCreateResponse {
  run_id: number;
  created_at: string;
}

export interface AnalyticsRunMeta {
  run_id: number;
  created_at: string;
  account?: string | null;
  ticker_count?: number | null;
  notes?: string | null;
}

export interface AnalyticsRunFull extends AnalyticsRunMeta {
  payload: unknown;
}

export function saveAnalyticsRun(req: AnalyticsRunCreateRequest): Promise<AnalyticsRunCreateResponse> {
  return postJson('/api/analytics/runs', req);
}

export function getAnalyticsRuns(limit = 50): Promise<AnalyticsRunMeta[]> {
  return getJson(`/api/analytics/runs?limit=${limit}`);
}

export function getAnalyticsRun(id: number): Promise<AnalyticsRunFull> {
  return getJson(`/api/analytics/runs/${id}`);
}
