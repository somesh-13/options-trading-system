/**
 * API client for the Robinhood real-portfolio endpoints on the Python backend.
 * Mirrors the fetch + error-handling pattern from pricing-api.ts.
 */

import { PRICING_API_URL } from './pricing-api';

export type RobinhoodAccount = 'brokerage' | 'roth_ira' | 'all';

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
}

export interface RobinhoodHoldingsResponse {
  equities: RobinhoodHolding[];
  options: RobinhoodOption[];
}

export interface RobinhoodSummary {
  cash_net_transfers: number;
  dividends_ytd: number;
  interest_ytd: number;
  fees_ytd: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_market_value: number;
  total_invested: number;
  unknown_basis_proceeds: number;
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

function qp(livePrices: boolean, account: RobinhoodAccount): string {
  const q = new URLSearchParams({ live_prices: String(livePrices) });
  if (account !== 'all') q.set('account', account);
  return q.toString();
}

export function getRobinhoodHoldings(
  livePrices = true,
  account: RobinhoodAccount = 'all',
): Promise<RobinhoodHoldingsResponse> {
  return getJson(`/api/robinhood/holdings?${qp(livePrices, account)}`);
}

export function getRobinhoodSummary(
  livePrices = true,
  account: RobinhoodAccount = 'all',
): Promise<RobinhoodSummary> {
  return getJson(`/api/robinhood/summary?${qp(livePrices, account)}`);
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
