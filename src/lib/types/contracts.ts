// Mirrors backend/src/data/contract_extract.py::Contract (and friends).

export type ContractType =
  | 'hpc_hosting'
  | 'hpc_lease'
  | 'ppa'
  | 'colocation'
  | 'btc_hosting'
  | 'energy_supply'
  | 'joint_venture'
  | 'other';

export type Confidence = 'high' | 'medium' | 'low';

export interface ContractSource {
  accession?: string | null;
  filing_form?: string | null;
  filing_date?: string | null;
  url?: string | null;
  title?: string | null;
}

export interface Contract {
  id: string;
  counterparty?: string | null;
  contract_type: ContractType;
  capacity_mw?: number | null;
  term_years?: number | null;
  energization_date?: string | null;
  annual_revenue_M_stated?: number | null;
  annual_revenue_M_estimated?: number | null;
  currency?: string | null;
  confidence: Confidence;
  notes?: string | null;
  source: ContractSource;
}

export interface ContractExtractResult {
  ticker: string;
  contracts: Contract[];
  data_gaps: string[];
  model?: string | null;
  as_of: string;
  inputs_echo?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers used by the DCF projection math.
// ---------------------------------------------------------------------------

/** Contract types where the issuer is BUYING (not earning revenue). These
 *  are cost commitments — never count them as revenue in the DCF layer. */
const COST_CONTRACT_TYPES: ReadonlySet<ContractType> = new Set([
  'energy_supply', // issuer purchases electricity under a long-term agreement
]);

/** Effective annual revenue for the DCF layer.
 *  Prefers a stated number, else the LLM's estimate, else MW × default. 0 when
 *  none of those are available. The default is overridable from a slider in
 *  the DCFValuation Contract Layer accordion.
 *
 *  Cost-type contracts (`energy_supply` — issuer is the buyer) always
 *  return 0: they're a P&L expense, not a revenue line, and counting MW ×
 *  $2M default for them would falsely inflate the projection.
 */
export function effectiveAnnualRevenueM(
  c: Contract,
  defaultRevPerMW_M = 2,
): number {
  if (COST_CONTRACT_TYPES.has(c.contract_type)) return 0;
  if (c.annual_revenue_M_stated != null && Number.isFinite(c.annual_revenue_M_stated)) {
    return c.annual_revenue_M_stated;
  }
  if (c.annual_revenue_M_estimated != null && Number.isFinite(c.annual_revenue_M_estimated)) {
    return c.annual_revenue_M_estimated;
  }
  if (c.capacity_mw != null && Number.isFinite(c.capacity_mw)) {
    return c.capacity_mw * defaultRevPerMW_M;
  }
  return 0;
}

/** Ramp factor for a given calendar year:
 *    - 1.0 when the contract is already energized (date null or in the past)
 *    - 0.0 if year < energization year
 *    - 0.5 if year === energization year (partial-year contribution)
 *    - 1.0 if year > energization year
 *  Year-only and YYYY-MM dates work the same as YYYY-MM-DD because we only
 *  compare year components (the LLM rarely has month-level certainty anyway).
 */
export function rampFactor(c: Contract, projectionYearAbsolute: number): number {
  const raw = (c.energization_date || '').trim();
  if (!raw) return 1;
  const yearMatch = raw.match(/^(\d{4})/);
  if (!yearMatch) return 1;
  const energizationYear = Number(yearMatch[1]);
  if (!Number.isFinite(energizationYear)) return 1;
  // Already-energized at the time of asking.
  const today = new Date();
  if (energizationYear < today.getUTCFullYear()) return 1;
  if (energizationYear === today.getUTCFullYear()) {
    // Compare to today's date if the field was YYYY-MM(-DD).
    const md = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (md) {
      const month = Number(md[2]);
      const day = md[3] ? Number(md[3]) : 1;
      if (Number.isFinite(month) && Number.isFinite(day)) {
        const dt = new Date(Date.UTC(energizationYear, month - 1, day));
        if (dt.getTime() <= today.getTime()) return 1;
      }
    }
  }
  if (projectionYearAbsolute < energizationYear) return 0;
  if (projectionYearAbsolute === energizationYear) return 0.5;
  return 1;
}

/** Sum total contracted capacity across a list, in MW. NaN-safe. */
export function totalCapacityMW(contracts: Contract[]): number {
  return contracts.reduce((sum, c) => {
    const v = c.capacity_mw;
    return v != null && Number.isFinite(v) ? sum + v : sum;
  }, 0);
}

/** Sum effective annual revenue across a list, in $M. */
export function totalEffectiveAnnualRevenueM(
  contracts: Contract[],
  defaultRevPerMW_M = 2,
): number {
  return contracts.reduce(
    (sum, c) => sum + effectiveAnnualRevenueM(c, defaultRevPerMW_M),
    0,
  );
}

/** Capacity-weighted average term in years (skips contracts missing MW or term). */
export function weightedAvgTermYears(contracts: Contract[]): number | null {
  let totalMw = 0;
  let weightedSum = 0;
  for (const c of contracts) {
    if (
      c.capacity_mw != null && c.term_years != null &&
      Number.isFinite(c.capacity_mw) && Number.isFinite(c.term_years)
    ) {
      totalMw += c.capacity_mw;
      weightedSum += c.capacity_mw * c.term_years;
    }
  }
  return totalMw > 0 ? weightedSum / totalMw : null;
}
