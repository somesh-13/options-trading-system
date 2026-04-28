/**
 * Candle chart placeholder — direct port of `RV.candles(seed, h)` from the
 * design source (`design/stocks-revamp/project/pages/_rv.js`).
 *
 * Deterministic SVG: produces a synthetic OHLC series from `seed` so the
 * rendered curve is identical between the design prototype and the React app.
 *
 * TODO: replace with real equity curve once `/api/portfolio/equity` is wired.
 */
type CandlesProps = {
  seed?: number;
  height?: number;
};

export function Candles({ seed = 1, height = 160 }: CandlesProps) {
  const n = 40;
  let y = 50;
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < n; i++) {
    const drift = Math.sin(seed + i * 0.3) * 3;
    const o = y;
    y += drift;
    const c = y;
    const hh = Math.max(o, c) + Math.abs(Math.sin(seed * i)) * 2;
    const ll = Math.min(o, c) - Math.abs(Math.cos(seed * i)) * 2;
    const up = c > o;
    const x = (i / n) * 100;
    const w = (100 / n) * 0.7;
    const col = up ? 'var(--green)' : 'var(--pink)';

    elements.push(
      <line
        key={`wick-${i}`}
        x1={x + w / 2}
        x2={x + w / 2}
        y1={100 - hh}
        y2={100 - ll}
        stroke={col}
        strokeWidth={0.4}
      />
    );
    elements.push(
      <rect
        key={`body-${i}`}
        x={x}
        y={100 - Math.max(o, c)}
        width={w}
        height={Math.max(0.5, Math.abs(c - o))}
        fill={col}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: `${height}px` }}
    >
      {elements}
    </svg>
  );
}

export default Candles;
