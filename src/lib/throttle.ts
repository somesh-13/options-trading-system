/**
 * Run a list of async tasks with bounded concurrency, returning the same
 * shape as `Promise.allSettled` (one result per input, no failure cascades).
 *
 * Used by pages that fan out one HTTP call per portfolio ticker (risk-mgmt
 * VaR, scanner mispricing) so the backend is never hit with N parallel
 * requests at once.
 */
export async function throttledAllSettled<T>(
  fns: Array<() => Promise<T>>,
  concurrency = 6,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(fns.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < fns.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { status: 'fulfilled', value: await fns[idx]() };
      } catch (e) {
        results[idx] = { status: 'rejected', reason: e };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, fns.length) }, () => worker()),
  );
  return results;
}
