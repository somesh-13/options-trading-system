import type { FinancialStatementHistory, StatementRow } from '@/lib/pricing-api';

/** Synthetic row key for the FCF/Share derived row. Underscore-prefixed so
 *  it can never collide with a real SEC XBRL-derived row key. */
export const FCF_PER_SHARE_KEY = '_derived_fcf_per_share';

const SHARES_DILUTED_KEY = 'shares_diluted_was';
const CFO_KEY = 'cf_from_operations';
const CAPEX_KEY = 'cf_capex';
const ACQ_KEY = 'cf_acquisitions';

export interface FcfPerShareTooltipPayload {
  cfo: number | null;
  capex: number | null;
  fcf: number | null;
  shares: number | null;
}

let positionalFallbackWarned = false;

/** Look up diluted shares for each cash-flow column. ISO-date match via
 *  year_ends is the primary path (robust to length mismatches). Falls back
 *  to positional alignment when year_ends is absent on either side. */
export function alignSharesToCashFlow(
  cashFlow: FinancialStatementHistory,
  income: FinancialStatementHistory | null,
): Array<number | null> {
  const n = cashFlow.years.length;
  if (!income) return new Array(n).fill(null);
  const sharesRow = income.rows.find((r) => r.key === SHARES_DILUTED_KEY);
  if (!sharesRow) return new Array(n).fill(null);

  const cfEnds = cashFlow.year_ends;
  const incEnds = income.year_ends;
  if (cfEnds && incEnds && cfEnds.length === cashFlow.years.length) {
    const byDate = new Map<string, number | null>();
    incEnds.forEach((iso, i) => {
      if (iso) byDate.set(iso, sharesRow.values[i] ?? null);
    });
    return cfEnds.map((iso) => (iso ? byDate.get(iso) ?? null : null));
  }

  if (!positionalFallbackWarned) {
    positionalFallbackWarned = true;
    console.warn(
      'FCF/Share: year_ends missing on income or cash-flow response; falling back to positional alignment.',
    );
  }
  return Array.from({ length: n }, (_, i) => sharesRow.values[i] ?? null);
}

/** Build the derived row aligned with cashFlow.years[] (most-recent-first,
 *  matches cashFlow.rows[].values ordering). Returns null only when the
 *  cash-flow response lacks the two source rows. When income is null or
 *  still loading, the row is returned with all-null values so the table
 *  shows '—' cells until income arrives.
 *
 *  CapEx sign: backend (sec_statements.py:344) stores cf_capex as a positive
 *  magnitude, so FCF = cfo - capex. If that convention ever changes, this
 *  formula must flip. */
export function buildFcfPerShareRow(
  cashFlow: FinancialStatementHistory,
  income: FinancialStatementHistory | null,
): { row: StatementRow; tooltips: FcfPerShareTooltipPayload[] } | null {
  const cfoRow = cashFlow.rows.find((r) => r.key === CFO_KEY);
  const capexRow = cashFlow.rows.find((r) => r.key === CAPEX_KEY);
  if (!cfoRow || !capexRow) return null;

  const shares = alignSharesToCashFlow(cashFlow, income);
  const n = cashFlow.years.length;
  const values: Array<number | null> = new Array(n);
  const tooltips: FcfPerShareTooltipPayload[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const cfo = cfoRow.values[i] ?? null;
    const capex = capexRow.values[i] ?? null;
    const s = shares[i];
    const fcf = cfo != null && capex != null ? cfo - capex : null;
    const fcfps =
      fcf != null && s != null && s > 0 ? fcf / s : null;
    values[i] = fcfps;
    tooltips[i] = { cfo, capex, fcf, shares: s };
  }

  return {
    row: {
      key: FCF_PER_SHARE_KEY,
      label: 'FCF per Share',
      format: 'per_share',
      bold: false,
      italic: true,
      values,
    },
    tooltips,
  };
}

/** Non-mutating: returns a new rows[] with the derived row inserted
 *  immediately after `cf_capex`. If `cf_acquisitions` follows, the derived
 *  row lands between them; otherwise it lands directly after CapEx. */
export function injectFcfPerShareRow(
  rows: StatementRow[],
  derived: StatementRow,
): StatementRow[] {
  const out: StatementRow[] = [];
  let inserted = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out.push(r);
    if (!inserted && r.key === CAPEX_KEY) {
      out.push(derived);
      inserted = true;
    }
  }
  if (!inserted) {
    const acqIdx = out.findIndex((r) => r.key === ACQ_KEY);
    if (acqIdx >= 0) out.splice(acqIdx, 0, derived);
    else out.push(derived);
  }
  return out;
}
