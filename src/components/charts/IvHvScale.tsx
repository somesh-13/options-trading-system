/**
 * IV/HV mispricing scale (0.5 → 2.0) with shaded BUY (<0.8) / SELL (>1.3) zones.
 * Direct port of `RV.ivhvScale()` from the design source.
 */
export function IvHvScale({
  iv,
  hv,
  ratio,
}: {
  iv: number;
  hv: number;
  ratio: number;
}) {
  const min = 0.5;
  const max = 2.0;
  const span = max - min;
  const pct = Math.max(0, Math.min(1, (ratio - min) / span)) * 100;
  const buyZone = ((0.8 - min) / span) * 100;
  const sellZone = ((max - 1.3) / span) * 100;
  const center = ((1.0 - min) / span) * 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          position: 'relative',
          width: 110,
          height: 10,
          border: '1px solid var(--line)',
          borderRadius: 2,
          background: '#0c0d10',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: 0,  top: 0, bottom: 0, width: `${buyZone}%`,  background: 'rgba(0,200,5,.15)' }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${sellZone}%`, background: 'rgba(255,215,0,.15)' }} />
        <div style={{ position: 'absolute', left: `${center}%`, top: 0, bottom: 0, width: 1, background: 'var(--ink-mute)' }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: -2, bottom: -2, width: 2, background: 'var(--ink)', transform: 'translateX(-1px)' }} />
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--ink-mute)' }}>
        {(iv * 100).toFixed(0)}/{(hv * 100).toFixed(0)}
      </span>
    </div>
  );
}
