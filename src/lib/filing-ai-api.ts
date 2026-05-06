// Frontend client for the SEC-filing AI summary endpoints.

import { PRICING_API_URL } from './pricing-api';

export interface FilingAISummary {
  summary_bullets: string[];
  financial_highlights: {
    revenue: string | null;
    ebitda: string | null;
    net_income: string | null;
    cash: string | null;
    capex: string | null;
    guidance: string | null;
  };
  operational_highlights: string[];
  physical_ai: {
    sites: string[];
    capacity_mw: string[];
    customers_or_partners: string[];
    build_phases: string[];
  };
  risks: string[];
  evidence: Array<{ bullet_index: number; quote: string }>;
  missing_fields: string[];
  _model?: string;
  _generated_at?: number;
  _elapsed_sec?: number;
  _filing_form?: string;
  _filing_date?: string | null;
  _title?: string | null;
}

export interface SecFiling {
  type: string;
  date: string;
  link: string;
  title: string;
  accession: string | null;
  body_excerpt: string | null;
}

export async function listSecFilings(
  ticker: string,
  limit = 15,
): Promise<{ ticker: string; count: number; filings: SecFiling[] }> {
  const res = await fetch(
    `${PRICING_API_URL}/api/sec/filings/${encodeURIComponent(ticker)}?limit=${limit}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    let detail = `Filings fetch failed: ${res.status}`;
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

export async function getFilingAISummary(
  ticker: string,
  accession: string,
  options: { force?: boolean } = {},
): Promise<FilingAISummary> {
  const qs = options.force ? '?force=true' : '';
  const res = await fetch(
    `${PRICING_API_URL}/api/sec/filings/${encodeURIComponent(ticker)}/${encodeURIComponent(accession)}/ai-summary${qs}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    let detail = `AI summary fetch failed: ${res.status}`;
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
