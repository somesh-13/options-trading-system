/**
 * Shared types for the multi-leg options order panel + simulator.
 *
 * The order panel keeps inputs as strings (HTML inputs) so partially-typed
 * values render. Validation and conversion to numbers happens at submit /
 * simulate time.
 */

export type Leg = {
  /** Stable React key. crypto.randomUUID(). */
  id: string;
  /** YYYY-MM-DD */
  expiration: string;
  /** Numeric strike as string. */
  strike: string;
  optionType: 'call' | 'put';
  side: 'buy' | 'sell';
  /** Integer contracts, kept as string for the input. */
  quantity: string;
  /** Premium per share — used as limit_price for single-leg place AND as
   *  cost basis when computing simulator P&L. */
  entryPrice: string;
};

export const MAX_LEGS = 4;

export function newLeg(seed?: Partial<Leg>): Leg {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `leg-${Math.random().toString(36).slice(2, 10)}`,
    expiration: '',
    strike: '',
    optionType: 'call',
    side: 'buy',
    quantity: '1',
    entryPrice: '',
    ...seed,
  };
}

export function isLegComplete(l: Leg): boolean {
  const strike = parseFloat(l.strike);
  const qty = parseInt(l.quantity, 10);
  const entry = parseFloat(l.entryPrice);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(l.expiration) &&
    !isNaN(strike) && strike > 0 &&
    !isNaN(qty) && qty >= 1 &&
    !isNaN(entry) && entry >= 0
  );
}
