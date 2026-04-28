/**
 * Day P&L attribution — horizontal stacked bar with labeled segments.
 *
 * Decomposes daily P&L into Δ (direction), Γ (convexity), Θ (decay),
 * V (vol), and residual. Negative segments swap to pink.
 *
 * Direct port of the attribution block from design line 122-132 in
 * `design/stocks-revamp/project/pages/05-portfolio.js`.
 *
 * TODO: wire GET /api/portfolio/attribution
 */
type PnlAttributionProps = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  residual: number;
};

type Segment = {
  label: string;
  value: number;
  posColor: string;
};

function fmt(n: number): string {
  const sign = n < 0 ? '\u2212' : '';
  return `${sign}$${Math.abs(n)}`;
}

export function PnlAttribution({ delta, gamma, theta, vega, residual }: PnlAttributionProps) {
  const segs: Segment[] = [
    { label: 'Δ', value: delta,    posColor: 'var(--green)' },
    { label: 'Γ', value: gamma,    posColor: '#5fce5f' },
    { label: 'Θ', value: theta,    posColor: 'var(--blue)' },
    { label: 'V', value: vega,     posColor: 'var(--blue)' },
    { label: 'res', value: residual, posColor: 'var(--ink-mute)' },
  ];

  const total = segs.reduce((acc, s) => acc + Math.abs(s.value), 0) || 1;

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-mute)',
          marginBottom: 6,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Day P&amp;L attribution
      </div>
      <div
        style={{
          display: 'flex',
          height: 16,
          border: '1px solid var(--line)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {segs.map((s) => {
          const pct = (Math.abs(s.value) / total) * 100;
          const color = s.value < 0 ? 'var(--pink)' : s.posColor;
          return (
            <div
              key={s.label}
              style={{
                width: `${pct}%`,
                background: color,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--ink-mute)',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}
      >
        {segs.map((s) => (
          <span key={`lab-${s.label}`}>
            {s.label} {fmt(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default PnlAttribution;
