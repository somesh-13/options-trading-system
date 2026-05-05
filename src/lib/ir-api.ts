/**
 * Client wrapper for the per-ticker investor-relations feed.
 *
 * Backend lives at /api/ir/{ticker} (FastAPI). All paths go through
 * `PRICING_API_URL` so they work the same in localhost / LAN / ngrok.
 */

import { PRICING_API_URL } from './pricing-api';

export type ThesisLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INFORMATIVE';

export interface IRFilingItem {
  item_hash: string;
  ticker: string;
  source: 'yahoo_news' | 'sec_edgar' | string;
  item_type: string | null;
  title: string;
  publisher: string | null;
  link: string | null;
  published_at: string | null;
  thesis: ThesisLabel | null;
  confidence: number | null;
  rationale: string | null;
  classifier: string | null;
  fetched_at: string;
}

export interface IRFilingList {
  ticker: string;
  items: IRFilingItem[];
  counts: Partial<Record<ThesisLabel, number>> & { TOTAL?: number };
  last_refreshed_at: string | null;
}

export interface IRFilingRefreshResult {
  ticker: string;
  new_items: number;
  classified: number;
  total: number;
  errors: string[];
}

async function detail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail || body?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function getIRFilings(ticker: string, limit = 25): Promise<IRFilingList> {
  const res = await fetch(
    `${PRICING_API_URL}/api/ir/${encodeURIComponent(ticker)}?limit=${limit}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(await detail(res, `IR fetch failed: ${res.status}`));
  }
  return res.json();
}

export async function refreshIRFilings(
  ticker: string,
  forceReclassify = false,
): Promise<IRFilingRefreshResult> {
  const qs = forceReclassify ? '?force_reclassify=true' : '';
  const res = await fetch(
    `${PRICING_API_URL}/api/ir/${encodeURIComponent(ticker)}/refresh${qs}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    throw new Error(await detail(res, `IR refresh failed: ${res.status}`));
  }
  return res.json();
}
