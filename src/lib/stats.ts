// Abramowitz & Stegun 26.2.17 rational approximation; |err| < 7.5e-8.
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function bsD1(S: number, K: number, T: number, r: number, sigma: number): number {
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

export function bsD2(S: number, K: number, T: number, r: number, sigma: number): number {
  return bsD1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
}

/**
 * Black-Scholes call price (no-dividend). Returns per-share price (not ×100
 * contract value). Falls back to intrinsic value when inputs are degenerate
 * (T → 0 or σ → 0) so the caller doesn't see NaN.
 */
export function bsCallPrice(
  S: number, K: number, T: number, r: number, sigma: number,
): number {
  if (!Number.isFinite(S) || !Number.isFinite(K) || S <= 0 || K <= 0) return 0;
  if (T <= 0 || sigma <= 0) return Math.max(0, S - K);
  const d1 = bsD1(S, K, T, r, sigma);
  const d2 = bsD2(S, K, T, r, sigma);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

/** Black-Scholes put price (no-dividend), same fallback semantics as bsCallPrice. */
export function bsPutPrice(
  S: number, K: number, T: number, r: number, sigma: number,
): number {
  if (!Number.isFinite(S) || !Number.isFinite(K) || S <= 0 || K <= 0) return 0;
  if (T <= 0 || sigma <= 0) return Math.max(0, K - S);
  const d1 = bsD1(S, K, T, r, sigma);
  const d2 = bsD2(S, K, T, r, sigma);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}
