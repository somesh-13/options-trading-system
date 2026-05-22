/**
 * Calendar Spread analytics — shared types and pure functions.
 *
 * Consumed by the stock-page CALENDAR SIGNALS card, the /calendar analyzer
 * page, the /pricing calendar tab, and (future Phases B/C) the Scanner
 * predicate and the Positions Θ/V column.
 *
 * Convention: implied vol is stored as a decimal fraction (0.45 = 45%).
 */

import type { Greeks } from './pricing-api';

// --- Types -------------------------------------------------------------------

export interface IvTermPoint {
  expiration: string; // YYYY-MM-DD
  dte: number;
  atm_iv: number | null; // decimal fraction (0.45 = 45%); null if backend couldn't compute
}

export interface CalendarPair {
  short: IvTermPoint; // front-month leg (we SELL)
  long: IvTermPoint;  // back-month leg (we BUY)
  ratio: number;        // short.atm_iv / long.atm_iv
  differential: number; // (short.atm_iv - long.atm_iv) * 100  — percentage points
  edgeScore: 0 | 1 | 2 | 3 | 4 | 5; // min(5, floor(ratio * 2.5))
}

export type CalendarStatus = 'FAVORABLE' | 'NEUTRAL' | 'WEAK';

export interface CalendarSignalsBundle {
  ticker: string;
  hv: number; // HV30 as decimal fraction
  lastUpdated: string; // ISO timestamp
  termStructure: IvTermPoint[];
  best: CalendarPair | null;
  all: CalendarPair[];
  status: CalendarStatus;
  atmStrike?: number | null; // used as the deep-link strike default
}

// DTE windows for the 6 buckets shown on the IV term structure table.
// Half-open ranges [lo, hi). Last bucket is open-ended.
export const TERM_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: '0–1d', lo: 0, hi: 2 },
  { label: '4–5d', lo: 3, hi: 6 },
  { label: '7–8d', lo: 6, hi: 9 },
  { label: '14d', lo: 9, hi: 16 },
  { label: '21d', lo: 16, hi: 23 },
  { label: '28d+', lo: 23, hi: Number.POSITIVE_INFINITY },
];

// Best-pair search window. Front leg ≤ 7 DTE, back leg ≤ 21 DTE.
export const BEST_PAIR_FRONT_MAX_DTE = 7;
export const BEST_PAIR_BACK_MAX_DTE = 21;

// --- Pure functions ----------------------------------------------------------

export function edgeScoreFromRatio(ratio: number): CalendarPair['edgeScore'] {
  // Spec formula: floor((ratio - 0.70) / 0.10), clamped to [0, 5].
  // 1.09× → 3, 1.20× → 5 capped, 0.96× → 2.
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const raw = Math.floor((ratio - 0.70) / 0.10);
  const score = Math.max(0, Math.min(5, raw));
  return score as CalendarPair['edgeScore'];
}

/**
 * Compute every viable (front, back) calendar pair from a term structure
 * and return the highest-ratio one as `best`, plus the full sorted list.
 *
 * Filters:
 *   - both legs need a numeric atm_iv
 *   - front.dte ≤ BEST_PAIR_FRONT_MAX_DTE
 *   - back.dte ≤ BEST_PAIR_BACK_MAX_DTE
 *   - back.dte > front.dte (back strictly later)
 */
export function computeBestPair(pts: IvTermPoint[]): {
  best: CalendarPair | null;
  all: CalendarPair[];
} {
  const valid = pts.filter(
    (p) => typeof p.atm_iv === 'number' && Number.isFinite(p.atm_iv) && (p.atm_iv as number) > 0,
  );
  const pairs: CalendarPair[] = [];
  for (const s of valid) {
    if (s.dte > BEST_PAIR_FRONT_MAX_DTE) continue;
    for (const l of valid) {
      if (l.dte <= s.dte) continue;
      if (l.dte > BEST_PAIR_BACK_MAX_DTE) continue;
      const sIv = s.atm_iv as number;
      const lIv = l.atm_iv as number;
      const ratio = sIv / lIv;
      pairs.push({
        short: s,
        long: l,
        ratio,
        differential: (sIv - lIv) * 100,
        edgeScore: edgeScoreFromRatio(ratio),
      });
    }
  }
  pairs.sort((a, b) => b.ratio - a.ratio);
  return { best: pairs[0] ?? null, all: pairs };
}

export function classifyStatus(
  best: CalendarPair | null,
  hv: number,
): CalendarStatus {
  if (!best) return 'WEAK';
  // Without a valid HV reference we can't trust the IV signal — never
  // upgrade past WEAK in that case, since "front IV high vs back IV" alone
  // could just be a roll-driven artifact rather than real selling opportunity.
  if (!Number.isFinite(hv) || hv <= 0) return 'WEAK';
  if (best.ratio >= 1.2 && best.differential >= 10) return 'FAVORABLE';
  if (best.ratio >= 1.05) return 'NEUTRAL';
  return 'WEAK';
}

/**
 * Place each term-structure point into the closest DTE bucket. Returns one
 * point (or null) per TERM_BUCKETS entry. If multiple points fall into the
 * same bucket, pick the one whose DTE is closest to the bucket's midpoint
 * (open-ended last bucket: pick the smallest DTE in that range).
 */
export function bucketizeTermStructure(
  pts: IvTermPoint[],
): (IvTermPoint | null)[] {
  return TERM_BUCKETS.map(({ lo, hi }) => {
    const candidates = pts.filter((p) => p.dte >= lo && p.dte < hi);
    if (candidates.length === 0) return null;
    if (!Number.isFinite(hi)) {
      return [...candidates].sort((a, b) => a.dte - b.dte)[0];
    }
    const mid = (lo + hi) / 2;
    return [...candidates].sort(
      (a, b) => Math.abs(a.dte - mid) - Math.abs(b.dte - mid),
    )[0];
  });
}

export function ivVsHvColor(iv: number | null | undefined, hv: number): 'green' | 'mute' {
  if (typeof iv !== 'number' || !Number.isFinite(iv) || !Number.isFinite(hv) || hv <= 0) {
    return 'mute';
  }
  return iv > hv ? 'green' : 'mute';
}

/**
 * Net Greeks for a (LONG back-month, SHORT front-month) calendar.
 * net = long - short, applied to each numeric field present on both inputs.
 */
export function aggregateCalendarGreeks(longLeg: Greeks, shortLeg: Greeks): Greeks {
  const out: Greeks = {
    delta: longLeg.delta - shortLeg.delta,
    gamma: longLeg.gamma - shortLeg.gamma,
    vega: longLeg.vega - shortLeg.vega,
    theta: longLeg.theta - shortLeg.theta,
    rho: longLeg.rho - shortLeg.rho,
  };
  if (typeof longLeg.vanna === 'number' && typeof shortLeg.vanna === 'number') {
    out.vanna = longLeg.vanna - shortLeg.vanna;
  }
  if (typeof longLeg.charm === 'number' && typeof shortLeg.charm === 'number') {
    out.charm = longLeg.charm - shortLeg.charm;
  }
  if (typeof longLeg.volga === 'number' && typeof shortLeg.volga === 'number') {
    out.volga = longLeg.volga - shortLeg.volga;
  }
  return out;
}

/**
 * Color bucket for the Θ/V ratio card.
 *   > 0.15 → 'green' (strong edge)
 *   0.08 – 0.15 → 'gold' (decent)
 *   < 0.08 → 'mute'
 */
export function thetaVegaRatioColor(ratio: number): 'green' | 'gold' | 'mute' {
  if (!Number.isFinite(ratio)) return 'mute';
  if (ratio > 0.15) return 'green';
  if (ratio >= 0.08) return 'gold';
  return 'mute';
}
