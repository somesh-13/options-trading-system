/**
 * Inline "suggested hedge" card — gold-tinted callout shown beneath
 * the aggregate Greeks panel when delta has drifted from neutral.
 *
 * Direct port of design line 134-137 in
 * `design/stocks-revamp/project/pages/05-portfolio.js`.
 *
 * TODO: wire POST /api/strategy/hedging — server returns the suggestion
 * string; clicking the card sends to the trade ticket.
 */
type HedgeCardProps = {
  delta: number;
  suggestion: string;
};

function fmtDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '\u2212' : '';
  return `${sign}${Math.abs(d)}`;
}

export function HedgeCard({ delta, suggestion }: HedgeCardProps) {
  return (
    <div
      className="rv-card"
      style={{
        background: 'rgba(255,215,0,.04)',
        borderColor: 'rgba(255,215,0,.2)',
        padding: '8px 10px',
        marginTop: 6,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>
        Δ drift {fmtDelta(delta)} · suggested hedge
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-dim)',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 2,
        }}
      >
        {suggestion}
      </div>
    </div>
  );
}

export default HedgeCard;
