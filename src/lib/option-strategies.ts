/**
 * Detect option strategies from a flat list of Robinhood legs.
 *
 * Robinhood's holdings API returns each leg as an independent row keyed by
 * `(underlying, side, strike, expiry, position, account)` with no order_id /
 * strategy_id linking the legs of a multi-leg ticket. We re-derive the
 * strategy heuristically by grouping legs that share `(underlying, expiry,
 * account)` and matching the resulting leg pattern against the common
 * vertical / straddle / strangle / condor / butterfly templates.
 *
 * Caveats: this misclassifies if the user happens to hold two unrelated
 * single-leg trades on the same underlying + expiry (rare in practice, but
 * possible). Anything that doesn't fit a template falls through to the
 * "Multi-leg" label so we never silently invent a strategy.
 */

import type { RobinhoodOption } from './robinhood-api';

export type StrategyType =
  // Singles
  | 'long_call'
  | 'short_call'
  | 'long_put'
  | 'short_put'
  // Verticals (call/put × bull/bear × debit/credit collapses to four labels)
  | 'long_call_spread'   // bull call (debit)
  | 'short_call_spread'  // bear call (credit)
  | 'long_put_spread'    // bear put (debit)
  | 'short_put_spread'   // bull put (credit)
  // Straddles / strangles
  | 'long_straddle'
  | 'short_straddle'
  | 'long_strangle'
  | 'short_strangle'
  // Four-leg
  | 'iron_condor'
  | 'iron_butterfly'
  // Catch-all
  | 'multi_leg';

export interface StrategyGroup {
  /** Stable id derived from underlying + expiry + account so React keys are stable. */
  id: string;
  type: StrategyType;
  /** Display label, e.g. "Long Call Spread (300/310)". */
  label: string;
  /** Concise sub-label, e.g. "debit" / "credit" / "1 contract". */
  subLabel?: string;
  underlying: string;
  expiry: string;
  account: string;
  legs: RobinhoodOption[];
  /** Sum of cost_basis across legs — net debit (negative) / net credit (positive). */
  netCostBasis: number;
  /** Sum of realized_pnl across legs. */
  netRealized: number;
  /** Sum of market_value across legs (null if any leg lacks a quote). */
  netMarketValue: number | null;
  /** Sum of unrealized_pnl across legs (null if any leg lacks a quote). */
  netUnrealized: number | null;
  /** Min qty across legs — for spreads with mismatched qty, this is the spread count. */
  spreadCount: number;
}

const STRATEGY_LABELS: Record<StrategyType, string> = {
  long_call: 'Long Call',
  short_call: 'Short Call',
  long_put: 'Long Put',
  short_put: 'Short Put',
  long_call_spread: 'Long Call Spread',
  short_call_spread: 'Short Call Spread',
  long_put_spread: 'Long Put Spread',
  short_put_spread: 'Short Put Spread',
  long_straddle: 'Long Straddle',
  short_straddle: 'Short Straddle',
  long_strangle: 'Long Strangle',
  short_strangle: 'Short Strangle',
  iron_condor: 'Iron Condor',
  iron_butterfly: 'Iron Butterfly',
  multi_leg: 'Multi-leg',
};

function fmtStrike(s: number): string {
  return s % 1 === 0 ? String(s) : s.toFixed(1);
}

function sumCost(legs: RobinhoodOption[]): number {
  return legs.reduce((s, l) => s + l.cost_basis, 0);
}

function sumRealized(legs: RobinhoodOption[]): number {
  return legs.reduce((s, l) => s + l.realized_pnl, 0);
}

function sumMv(legs: RobinhoodOption[]): number | null {
  if (legs.some((l) => l.market_value == null)) return null;
  return legs.reduce((s, l) => s + (l.market_value ?? 0), 0);
}

function sumUnrealized(legs: RobinhoodOption[]): number | null {
  if (legs.some((l) => l.unrealized_pnl == null)) return null;
  return legs.reduce((s, l) => s + (l.unrealized_pnl ?? 0), 0);
}

function classifyOne(leg: RobinhoodOption): StrategyType {
  if (leg.position === 'long') return leg.side === 'Call' ? 'long_call' : 'long_put';
  return leg.side === 'Call' ? 'short_call' : 'short_put';
}

/**
 * Match a 2-leg group. Returns null if the legs don't fit a known pattern
 * (e.g. ratio spread with qty mismatch or two same-direction legs).
 */
function classifyTwo(legs: RobinhoodOption[]): { type: StrategyType; label: string } | null {
  const [a, b] = legs;
  const sameQty = a.quantity === b.quantity;
  const sameSide = a.side === b.side;
  const oppositePosition = a.position !== b.position;

  // Vertical spread: same side, opposite position, equal qty.
  if (sameSide && oppositePosition && sameQty) {
    const long = a.position === 'long' ? a : b;
    const short = a.position === 'long' ? b : a;
    const lo = Math.min(a.strike, b.strike);
    const hi = Math.max(a.strike, b.strike);
    if (a.side === 'Call') {
      // Long call spread (bull call, debit): long lower, short higher.
      if (long.strike < short.strike) {
        return { type: 'long_call_spread', label: `Long Call Spread (${fmtStrike(lo)}/${fmtStrike(hi)})` };
      }
      return { type: 'short_call_spread', label: `Short Call Spread (${fmtStrike(lo)}/${fmtStrike(hi)})` };
    }
    // Puts
    if (long.strike > short.strike) {
      return { type: 'long_put_spread', label: `Long Put Spread (${fmtStrike(hi)}/${fmtStrike(lo)})` };
    }
    return { type: 'short_put_spread', label: `Short Put Spread (${fmtStrike(hi)}/${fmtStrike(lo)})` };
  }

  // Straddle / strangle: 1 call + 1 put, same direction.
  if (!sameSide && a.position === b.position && sameQty) {
    const call = a.side === 'Call' ? a : b;
    const put = a.side === 'Put' ? a : b;
    const sameStrike = call.strike === put.strike;
    if (a.position === 'long') {
      if (sameStrike) return { type: 'long_straddle', label: `Long Straddle (${fmtStrike(call.strike)})` };
      return { type: 'long_strangle', label: `Long Strangle (P${fmtStrike(put.strike)}/C${fmtStrike(call.strike)})` };
    }
    if (sameStrike) return { type: 'short_straddle', label: `Short Straddle (${fmtStrike(call.strike)})` };
    return { type: 'short_strangle', label: `Short Strangle (P${fmtStrike(put.strike)}/C${fmtStrike(call.strike)})` };
  }

  return null;
}

/**
 * Match a 4-leg group as an iron condor / iron butterfly.
 * Pattern: short put + long put (lower wing) + short call + long call (upper wing),
 * all same qty.
 */
function classifyFour(legs: RobinhoodOption[]): { type: StrategyType; label: string } | null {
  const calls = legs.filter((l) => l.side === 'Call');
  const puts = legs.filter((l) => l.side === 'Put');
  if (calls.length !== 2 || puts.length !== 2) return null;

  const qtys = new Set(legs.map((l) => l.quantity));
  if (qtys.size !== 1) return null;

  const longCall = calls.find((l) => l.position === 'long');
  const shortCall = calls.find((l) => l.position === 'short');
  const longPut = puts.find((l) => l.position === 'long');
  const shortPut = puts.find((l) => l.position === 'short');
  if (!longCall || !shortCall || !longPut || !shortPut) return null;

  // Iron condor: short call below long call (short upper wing buys protection above);
  // short put above long put (short lower wing buys protection below).
  const callsOk = shortCall.strike < longCall.strike;
  const putsOk = shortPut.strike > longPut.strike;
  if (!callsOk || !putsOk) return null;

  // Iron butterfly: short call strike == short put strike (body at one strike).
  const isFly = shortCall.strike === shortPut.strike;
  const fmt = `${fmtStrike(longPut.strike)}/${fmtStrike(shortPut.strike)}/${fmtStrike(shortCall.strike)}/${fmtStrike(longCall.strike)}`;
  if (isFly) return { type: 'iron_butterfly', label: `Iron Butterfly (${fmt})` };
  return { type: 'iron_condor', label: `Iron Condor (${fmt})` };
}

function classify(legs: RobinhoodOption[]): { type: StrategyType; label: string } {
  if (legs.length === 1) {
    const t = classifyOne(legs[0]);
    return { type: t, label: `${STRATEGY_LABELS[t]} ${fmtStrike(legs[0].strike)}` };
  }
  if (legs.length === 2) {
    const m = classifyTwo(legs);
    if (m) return m;
  }
  if (legs.length === 4) {
    const m = classifyFour(legs);
    if (m) return m;
  }
  return { type: 'multi_leg', label: `Multi-leg (${legs.length} legs)` };
}

function buildSubLabel(type: StrategyType, netCostBasis: number, spreadCount: number): string {
  const isCredit = netCostBasis > 0;
  const isDebit = netCostBasis < 0;
  const flow =
    type === 'long_call_spread' || type === 'long_put_spread' || type === 'long_straddle' || type === 'long_strangle' || type === 'long_call' || type === 'long_put'
      ? 'debit'
      : type === 'short_call_spread' || type === 'short_put_spread' || type === 'short_straddle' || type === 'short_strangle' || type === 'short_call' || type === 'short_put' || type === 'iron_condor' || type === 'iron_butterfly'
        ? 'credit'
        : isCredit ? 'credit' : isDebit ? 'debit' : '';
  const ct = `${spreadCount} ${spreadCount === 1 ? 'contract' : 'contracts'}`;
  return flow ? `${flow} · ${ct}` : ct;
}

export function groupStrategies(options: RobinhoodOption[]): StrategyGroup[] {
  // Group by (underlying, expiry, account).
  const buckets = new Map<string, RobinhoodOption[]>();
  for (const o of options) {
    const key = `${o.underlying}|${o.expiry}|${o.account}`;
    const arr = buckets.get(key) ?? [];
    arr.push(o);
    buckets.set(key, arr);
  }

  const groups: StrategyGroup[] = [];
  for (const [key, legs] of buckets) {
    // Sort legs so output is stable: puts before calls, then by strike asc,
    // then long before short.
    const sortedLegs = [...legs].sort((a, b) => {
      if (a.side !== b.side) return a.side === 'Put' ? -1 : 1;
      if (a.strike !== b.strike) return a.strike - b.strike;
      return a.position === 'long' ? -1 : 1;
    });

    const { type, label } = classify(sortedLegs);
    const netCostBasis = sumCost(sortedLegs);
    const netRealized = sumRealized(sortedLegs);
    const netMarketValue = sumMv(sortedLegs);
    const netUnrealized = sumUnrealized(sortedLegs);
    const spreadCount = Math.min(...sortedLegs.map((l) => l.quantity));

    groups.push({
      id: key,
      type,
      label,
      subLabel: buildSubLabel(type, netCostBasis, spreadCount),
      underlying: sortedLegs[0].underlying,
      expiry: sortedLegs[0].expiry,
      account: sortedLegs[0].account,
      legs: sortedLegs,
      netCostBasis,
      netRealized,
      netMarketValue,
      netUnrealized,
      spreadCount,
    });
  }

  // Stable sort: by underlying, then expiry, then account.
  groups.sort((a, b) => {
    if (a.underlying !== b.underlying) return a.underlying.localeCompare(b.underlying);
    if (a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
    return a.account.localeCompare(b.account);
  });

  return groups;
}
