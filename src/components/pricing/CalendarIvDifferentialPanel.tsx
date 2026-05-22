'use client';

interface LegMeta {
  expiration: string;
  dte: number;
  iv: number | null;
}

interface CalendarIvDifferentialPanelProps {
  shortLeg: LegMeta | null;
  longLeg: LegMeta | null;
  hv30: number | null; // decimal fraction (0.30 = 30%)
}

function formatExpiration(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

// Spec-defined signal: stricter than the ratio-only classifier in calendar.ts
// because the panel also factors in absolute IV/HV richness.
function signal(
  ratio: number,
  ivHv: number,
): { label: 'FAVORABLE' | 'NEUTRAL' | 'WEAK'; color: string; border: string; bg: string } {
  if (ratio > 1.2 && ivHv > 1.15) {
    return { label: 'FAVORABLE', color: '#22c55e', border: 'rgba(34,197,94,.45)', bg: 'rgba(34,197,94,.10)' };
  }
  if ((ratio >= 1.05 && ratio <= 1.2) || (ivHv >= 1.0 && ivHv <= 1.15)) {
    return { label: 'NEUTRAL', color: '#fbbf24', border: 'rgba(251,191,36,.45)', bg: 'rgba(251,191,36,.10)' };
  }
  return { label: 'WEAK', color: '#9ca3af', border: 'rgba(156,163,175,.35)', bg: 'rgba(156,163,175,.08)' };
}

function diffColor(diffPp: number): string {
  if (diffPp > 5) return '#22c55e';
  if (diffPp >= 2) return '#fbbf24';
  return '#ef4444';
}

function ratioColor(ratio: number): string {
  if (ratio > 1.15) return '#22c55e';
  if (ratio >= 1.05) return '#fbbf24';
  return '#ef4444';
}

function LegCard({
  side,
  meta,
  hv,
}: {
  side: 'short' | 'long';
  meta: LegMeta | null;
  hv: number | null;
}) {
  const accent = side === 'short' ? '#ef4444' : '#22c55e';
  const label = side === 'short' ? 'FRONT MONTH' : 'BACK MONTH';
  const iv = meta?.iv;
  const ivAboveHv = typeof iv === 'number' && hv != null && hv > 0 && iv > hv;
  return (
    <div
      style={{
        background: '#181818',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: accent,
          textTransform: 'uppercase',
          letterSpacing: 2,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: '#9ca3af',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}
      >
        {meta ? formatExpiration(meta.expiration) : '—'}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: ivAboveHv ? '#22c55e' : '#9ca3af',
          marginTop: 4,
          lineHeight: 1.05,
        }}
      >
        {typeof iv === 'number' ? `${(iv * 100).toFixed(1)}%` : '—'}
      </div>
      <div
        style={{
          fontSize: 10,
          color: '#6b7280',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 2,
        }}
      >
        {meta ? `${meta.dte}d` : '—'}
      </div>
    </div>
  );
}

export default function CalendarIvDifferentialPanel({
  shortLeg,
  longLeg,
  hv30,
}: CalendarIvDifferentialPanelProps) {
  const ready =
    shortLeg && longLeg && typeof shortLeg.iv === 'number' && typeof longLeg.iv === 'number';

  const ratio = ready ? (shortLeg.iv as number) / (longLeg.iv as number) : NaN;
  const diffPp = ready ? ((shortLeg.iv as number) - (longLeg.iv as number)) * 100 : NaN;
  const overallIv = ready ? ((shortLeg.iv as number) + (longLeg.iv as number)) / 2 : NaN;
  const ivHv = ready && hv30 != null && hv30 > 0 ? overallIv / hv30 : NaN;
  const sig = ready && Number.isFinite(ivHv) ? signal(ratio, ivHv) : null;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="rv-sub" style={{ marginBottom: 6 }}>
        IV Differential <span style={{ color: 'var(--gold)' }}>· calendar edge</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <LegCard side="short" meta={shortLeg} hv={hv30} />
        <LegCard side="long" meta={longLeg} hv={hv30} />
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '10px 12px',
          background: '#0f0f0f',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
        }}
      >
        <span>
          <span style={{ color: '#9ca3af' }}>IV Differential (F−B):&nbsp;</span>
          <b style={{ color: Number.isFinite(diffPp) ? diffColor(diffPp) : '#6b7280' }}>
            {Number.isFinite(diffPp) ? `${diffPp >= 0 ? '+' : ''}${diffPp.toFixed(1)}pp` : '—'}
          </b>
        </span>
        <span>
          <span style={{ color: '#9ca3af' }}>IV Ratio (F÷B):&nbsp;</span>
          <b style={{ color: Number.isFinite(ratio) ? ratioColor(ratio) : '#6b7280' }}>
            {Number.isFinite(ratio) ? `${ratio.toFixed(2)}×` : '—'}
          </b>
        </span>
        <span>
          <span style={{ color: '#9ca3af' }}>HV(30D):&nbsp;</span>
          <b style={{ color: '#9ca3af' }}>
            {hv30 != null && hv30 > 0 ? `${(hv30 * 100).toFixed(1)}%` : '—'}
          </b>
        </span>
        {sig && (
          <span
            style={{
              marginLeft: 'auto',
              color: sig.color,
              borderColor: sig.border,
              background: sig.bg,
              border: `1px solid ${sig.border}`,
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {sig.label}
          </span>
        )}
      </div>
    </div>
  );
}
