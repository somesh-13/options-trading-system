/**
 * API client for the Robinhood real-portfolio endpoints on the Python backend.
 * Mirrors the fetch + error-handling pattern from pricing-api.ts.
 */

import { PRICING_API_URL } from './pricing-api';

export type RobinhoodAccount = 'brokerage' | 'roth_ira' | 'crypto' | 'sofi' | 'all';

export interface RobinhoodHolding {
  symbol: string;
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  realized_pnl: number;
  account: string;
  inferred_opening: boolean;
  current_price?: number | null;
  market_value?: number | null;
  unrealized_pnl?: number | null;
}

export interface RobinhoodOption {
  underlying: string;
  side: 'Call' | 'Put';
  strike: number;
  expiry: string;
  position: 'long' | 'short';
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  realized_pnl: number;
  account: string;
  market_value?: number | null;
  unrealized_pnl?: number | null;
}

export interface RobinhoodHoldingsResponse {
  equities: RobinhoodHolding[];
  options: RobinhoodOption[];
}

export interface RobinhoodSummary {
  cash_net_transfers: number;     // ACH net (CSV only; 0 in live mode)
  dividends_ytd: number;
  interest_ytd: number;
  fees_ytd: number;
  realized_pnl: number;
  unrealized_pnl: number;         // equity + option combined
  total_market_value: number;     // equity market value only
  total_invested: number;         // equity cost basis only
  unknown_basis_proceeds: number;
  cash_balance: number;           // current cash in account (live mode)
  option_market_value: number;    // sum of option leg market values
  option_cost_basis: number;      // gross option cost basis
  nav: number;                    // equity_mv + option_mv + cash_balance
}

export interface RobinhoodActivityRow {
  activity_date: string;
  process_date?: string | null;
  settle_date?: string | null;
  instrument?: string | null;
  description?: string | null;
  trans_code: string;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PRICING_API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* body was not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export type RobinhoodSource = 'csv' | 'live';

function qp(livePrices: boolean, account: RobinhoodAccount, source: RobinhoodSource = 'csv'): string {
  const q = new URLSearchParams({ live_prices: String(livePrices) });
  if (account !== 'all') q.set('account', account);
  if (source !== 'csv') q.set('source', source);
  return q.toString();
}

export function getRobinhoodHoldings(
  livePrices = true,
  account: RobinhoodAccount = 'all',
  source: RobinhoodSource = 'csv',
): Promise<RobinhoodHoldingsResponse> {
  return getJson(`/api/robinhood/holdings?${qp(livePrices, account, source)}`);
}

export function getRobinhoodSummary(
  livePrices = true,
  account: RobinhoodAccount = 'all',
  source: RobinhoodSource = 'csv',
): Promise<RobinhoodSummary> {
  return getJson(`/api/robinhood/summary?${qp(livePrices, account, source)}`);
}

export function getRobinhoodActivity(
  limit = 50,
  transCode?: string,
  account: RobinhoodAccount = 'all',
): Promise<RobinhoodActivityRow[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (transCode) q.set('trans_code', transCode);
  if (account !== 'all') q.set('account', account);
  return getJson(`/api/robinhood/activity?${q.toString()}`);
}

export function getRobinhoodAccounts(): Promise<{ accounts: string[] }> {
  return getJson('/api/robinhood/accounts');
}

export async function triggerRobinhoodIngest(): Promise<{ files_read: number; total_rows: number; inserted: number; skipped: number }> {
  const res = await fetch(`${PRICING_API_URL}/api/robinhood/ingest`, { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface RobinhoodSyncResponse {
  ok: boolean;
  fetched_at: string;
  account?: string | null;
  equities_count: number;
  options_count: number;
  snapshot_id?: number | null;
  stale: boolean;
  error?: string | null;
}

export interface RobinhoodSyncStatus {
  has_snapshot: boolean;
  fetched_at?: string | null;
  account?: string | null;
  stale: boolean;
  error?: string | null;
  configured: boolean;
}

export async function triggerRobinhoodSync(account: RobinhoodAccount = 'all'): Promise<RobinhoodSyncResponse> {
  const q = new URLSearchParams();
  if (account !== 'all') q.set('account', account);
  const url = `${PRICING_API_URL}/api/robinhood/sync${q.toString() ? `?${q}` : ''}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export function getRobinhoodSyncStatus(account: RobinhoodAccount = 'all'): Promise<RobinhoodSyncStatus> {
  const q = new URLSearchParams();
  if (account !== 'all') q.set('account', account);
  return getJson(`/api/robinhood/sync/status${q.toString() ? `?${q}` : ''}`);
}

// ============================
// Crypto interfaces + client
// ============================

export interface CryptoHolding {
  symbol: string;
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  current_price?: number | null;
  market_value?: number | null;
  unrealized_pnl?: number | null;
  account: string;
}

export interface CryptoQuote {
  symbol: string;
  mark_price?: number | null;
  error?: string | null;
}

export interface CryptoOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  notional_usd: number;
  dry_run: boolean;
  confirm: boolean;
}

export interface CryptoOrderResponse {
  order_id: string;
  symbol: string;
  side: string;
  notional_usd: number;
  quantity?: number | null;
  mark_price?: number | null;
  dry_run: boolean;
  status: string;
  message?: string | null;
}

export function getCryptoPositions(account = 'crypto'): Promise<CryptoHolding[]> {
  return getJson(`/api/robinhood/crypto/positions?account=${encodeURIComponent(account)}`);
}

export function getCryptoQuote(symbol: string): Promise<CryptoQuote> {
  return getJson(`/api/robinhood/crypto/quote/${encodeURIComponent(symbol.toUpperCase())}`);
}

export async function placeCryptoOrder(req: CryptoOrderRequest): Promise<CryptoOrderResponse> {
  const res = await fetch(`${PRICING_API_URL}/api/robinhood/crypto/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<CryptoOrderResponse>;
}
