'use client';

/**
 * Shared client-side cache for the Robinhood live-snapshot endpoints
 * (summary, holdings, portfolio-greeks). Populated by the /robinhood page
 * and any page that successfully fetches; consumed by /risk-mgmt and the
 * Home dashboard so those pages render real numbers on first paint instead
 * of dashes while their own fetches are in flight.
 *
 * SSR-safe: every getter returns null when `window` isn't available so the
 * server-rendered HTML stays deterministic.
 */

import type {
  RobinhoodHoldingsResponse,
  RobinhoodSummary,
} from './robinhood-api';
import type { PortfolioGreeksResult } from './robinhood-analytics-api';

const KEY_SUMMARY = 'vegaedge.rh.summary.v1';
const KEY_HOLDINGS = 'vegaedge.rh.holdings.v1';
const KEY_GREEKS = 'vegaedge.rh.greeks.v1';

// Cache entries older than this are treated as expired and ignored.
const TTL_MS = 10 * 60_000; // 10 minutes

interface Cached<T> {
  value: T;
  ts: number;
}

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ value, ts: Date.now() } as Cached<T>),
    );
  } catch {
    // Quota exceeded or storage unavailable — silently no-op.
  }
}

export function getCachedSummary(): RobinhoodSummary | null {
  return read<RobinhoodSummary>(KEY_SUMMARY);
}

export function setCachedSummary(value: RobinhoodSummary): void {
  write(KEY_SUMMARY, value);
}

export function getCachedHoldings(): RobinhoodHoldingsResponse | null {
  return read<RobinhoodHoldingsResponse>(KEY_HOLDINGS);
}

export function setCachedHoldings(value: RobinhoodHoldingsResponse): void {
  write(KEY_HOLDINGS, value);
}

export function getCachedGreeks(): PortfolioGreeksResult | null {
  return read<PortfolioGreeksResult>(KEY_GREEKS);
}

export function setCachedGreeks(value: PortfolioGreeksResult): void {
  write(KEY_GREEKS, value);
}
