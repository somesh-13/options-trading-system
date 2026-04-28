/**
 * 30-day sparkline SVG. Direct port of `RV.spark()` from the design source.
 * Deterministic given (seed, up): no randomness, just sin-driven walk.
 */
export function Sparkline({
  seed,
  color = 'var(--ink-dim)',
  up = true,
}: {
  seed: number;
  color?: string;
  up?: boolean;
}) {
  const n = 24;
  const pts: string[] = [];
  let y = 50;
  for (let i = 0; i < n; i++) {
    y += Math.sin(seed * (i + 1) * 0.3) * 5 + (up ? -0.6 : 0.6);
    y = Math.max(10, Math.min(90, y));
    pts.push(`${(i / (n - 1)) * 100},${y}`);
  }
  return (
    <svg className="rv-spark" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth={2} points={pts.join(' ')} />
    </svg>
  );
}
