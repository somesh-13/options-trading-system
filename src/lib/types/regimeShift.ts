// Mirrors backend/src/scanner/regime_shift.py::RegimeShiftResult.

export type RegimeShiftClassification =
  | 'HIGH-CONVICTION REGIME SHIFT'
  | 'EARLY WATCHLIST CANDIDATE'
  | 'NO REGIME SHIFT DETECTED';

export interface RegimeShiftResult {
  ticker: string;
  classification: RegimeShiftClassification;
  fundamental_inflection: boolean;
  strategic_mix_shift: boolean;
  guidance_underestimation: boolean;
  tape_confirmation: boolean;
  key_reasons: string[];
  suggested_actions: string[];
  inputs_echo: RegimeShiftInputsEcho;
  data_gaps: string[];
  model: string | null;
  as_of: string | null;
}

// Best-effort echo of what the LLM saw — the panel renders a collapsible
// "Inputs" section so the user can sanity-check the booleans against the
// numbers that fed them. Fields are optional because aggregation is
// failure-tolerant (any single data source can flake without voiding the run).
export interface RegimeShiftInputsEcho {
  ticker?: string;
  company_name?: string | null;
  fundamentals_quarterly_8q?: {
    periods?: string[];
    revenue_M?: (number | null)[];
    revenue_yoy_chg?: (number | null)[];
    gross_margin?: (number | null)[];
    operating_margin?: (number | null)[];
    eps_diluted?: (number | null)[];
    operating_profit_M?: (number | null)[];
  };
  ttm_aggregates?: {
    revenue?: number | null;
    revenue_growth_1y?: number | null;
    revenue_cagr?: number | null;
    operating_income?: number | null;
    operating_margin?: number | null;
    gross_margins?: number | null;
    profit_margins?: number | null;
    ebitda_margins?: number | null;
    earnings_growth?: number | null;
    return_on_equity?: number | null;
    forward_pe?: number | null;
    trailing_pe?: number | null;
    analyst_upside_pct?: number | null;
    recommendation?: string | null;
  };
  latest_earnings_release?: Record<string, string | number | null>;
  price_context?: {
    latest_close?: number | null;
    '52w_high'?: number | null;
    '52w_low'?: number | null;
    pct_off_52w_high?: number | null;
    perf_1m?: number | null;
    perf_3m?: number | null;
    perf_6m?: number | null;
    perf_12m?: number | null;
    recent_volume_vs_3mo_avg_ratio?: number | null;
  };
  iv_context?: {
    implied_vol_atm?: number | null;
    historical_vol_30d?: number | null;
    iv_hv_ratio?: number | null;
    atm_strike?: number | null;
    expiration?: string | null;
    spot_price?: number | null;
    regime?: string | null;
    regime_probability?: number | null;
  };
  news_headlines?: Array<{ title: string; date: string; publisher: string }>;
}
