/**
 * Client wrappers for the /flow page.
 *
 * Backed by /api/flow/scan + /api/flow/{ticker} (FastAPI). The /api/flow/*
 * prefix is included in next.config.ts BACKEND_PROXY_PREFIXES, so callers
 * use the same-origin path.
 */

import { PRICING_API_URL } from './pricing-api';

export interface FlowContractRow {
  expiration: string;
  strike: number;
  side: 'call' | 'put' | string;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  iv?: number | null;
  oi?: number | null;
  prior_oi?: number | null;
  volume?: number | null;
  vol_oi_ratio?: number | null;
  premium_dollars?: number | null;
  spot?: number | null;
  days_to_expiry?: number | null;
}

export interface FlowLeaderboardRow {
  ticker: string;
  today_premium_dollars: number;
  avg_prior_premium_dollars?: number | null;
  premium_multiplier?: number | null;
  top_contract?: FlowContractRow | null;
  iv_percentile?: number | null;
  spot?: number | null;
  snapshot_at: string;
}

export interface FlowScanResponse {
  snapshot_at: string | null;
  rows: FlowLeaderboardRow[];
  tickers_scanned: number;
  tickers_with_data: number;
}

export interface FlowTickerResponse {
  ticker: string;
  snapshot_at: string | null;
  spot?: number | null;
  today_premium_dollars: number;
  iv_percentile?: number | null;
  contracts: FlowContractRow[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PRICING_API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function getFlowScan(opts: { minPremium?: number; top?: number } = {}): Promise<FlowScanResponse> {
  const params = new URLSearchParams();
  if (opts.minPremium !== undefined) params.set('min_premium', String(opts.minPremium));
  if (opts.top !== undefined) params.set('top', String(opts.top));
  const qs = params.toString();
  return getJson<FlowScanResponse>(`/api/flow/scan${qs ? `?${qs}` : ''}`);
}

export function getTickerFlow(ticker: string, top = 20): Promise<FlowTickerResponse> {
  return getJson<FlowTickerResponse>(`/api/flow/${encodeURIComponent(ticker)}?top=${top}`);
}
