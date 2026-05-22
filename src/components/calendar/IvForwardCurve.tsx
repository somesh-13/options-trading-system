'use client';

import { useId } from 'react';
import type { CalendarPair, IvTermPoint } from '@/lib/calendar';

interface IvForwardCurveProps {
  termStructure: IvTermPoint[];
  hv: number;
  /** Pair to highlight with SHORT (red) + LONG (green) markers. Prop name
   *  kept as "best" for backwards-compat with the stock-page card; the
   *  /calendar page passes the currently-selected pair instead. */
  best?: CalendarPair | null;
  height?: number;
  xMaxDte?: number;
}

function formatExpiration(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

export default function IvForwardCurve({
  termStructure,
  hv,
  best,
  height = 80,
  xMaxDte = 35,
}: IvForwardCurveProps) {
  const uid = useId();
  const greenClipId = `iv-curve-green-clip-${uid}`;
  const redClipId = `iv-curve-red-clip-${uid}`;

  const W = 600;
  const H = height;
  const padL = 6;
  const padR = 20;
  const padT = 6;
  const padB = 6;

  const points = termStructure
    .filter((p): p is IvTermPoint & { atm_iv: number } =>
      typeof p.atm_iv === 'number' && Number.isFinite(p.atm_iv) && p.atm_iv > 0,
    )
    .filter((p) => p.dte >= 0 && p.dte <= xMaxDte)
    .sort((a, b) => a.dte - b.dte);

  if (points.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-mute)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          background: '#0c0d10',
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        no IV term data
      </div>
    );
  }

  const ivs = points.map((p) => p.atm_iv);
  const yMin = Math.max(0, Math.min(...ivs, hv) * 0.9);
  const yMax = Math.max(...ivs, hv) * 1.1 || 1;
  const yRange = yMax - yMin || 1;

  const xAt = (dte: number) => padL + (dte / xMaxDte) * (W - padL - padR);
  const yAt = (iv: number) => padT + (1 - (iv - yMin) / yRange) * (H - padT - padB);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.dte).toFixed(2)} ${yAt(p.atm_iv).toFixed(2)}`)
    .join(' ');

  const hvY = hv > 0 ? yAt(hv) : null;

  // Closed area: along the curve, then back along the HV line (or chart
  // bottom if no HV). Used by two render passes — one clipped to "above HV"
  // (green tint), one clipped to "below HV" (red tint). Each pass shows only
  // its half of the area, so the cross-overs split colors automatically.
  let areaPath: string | null = null;
  if (hvY !== null && points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    areaPath =
      `M ${xAt(first.dte).toFixed(2)} ${hvY.toFixed(2)} ` +
      points
        .map((p) => `L ${xAt(p.dte).toFixed(2)} ${yAt(p.atm_iv).toFixed(2)}`)
        .join(' ') +
      ` L ${xAt(last.dte).toFixed(2)} ${hvY.toFixed(2)} Z`;
  }

  // Short/long markers, drawn distinctly so the trader can read off each
  // leg's expiry and IV at a glance.
  const markers: Array<{
    x: number; y: number; color: string; label: string; tooltip: string;
  }> = [];
  if (best) {
    if (typeof best.short.atm_iv === 'number') {
      markers.push({
        x: xAt(best.short.dte),
        y: yAt(best.short.atm_iv),
        color: '#ef4444',
        label: 'SHORT',
        tooltip: `SHORT: ${formatExpiration(best.short.expiration)} · ${(best.short.atm_iv * 100).toFixed(1)}%`,
      });
    }
    if (typeof best.long.atm_iv === 'number') {
      markers.push({
        x: xAt(best.long.dte),
        y: yAt(best.long.atm_iv),
        color: '#22c55e',
        label: 'LONG',
        tooltip: `LONG: ${formatExpiration(best.long.expiration)} · ${(best.long.atm_iv * 100).toFixed(1)}%`,
      });
    }
  }

  return (
    <div
      style={{
        background: '#0c0d10',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 6,
        position: 'relative',
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        style={{ display: 'block' }}
      >
        {hvY !== null && (
          <defs>
            {/* "Above HV" = lower SVG y. */}
            <clipPath id={greenClipId}>
              <rect x={0} y={0} width={W} height={hvY} />
            </clipPath>
            <clipPath id={redClipId}>
              <rect x={0} y={hvY} width={W} height={Math.max(0, H - hvY)} />
            </clipPath>
          </defs>
        )}

        {areaPath && (
          <>
            <path d={areaPath} fill="rgba(34,197,94,0.10)" clipPath={`url(#${greenClipId})`} />
            <path d={areaPath} fill="rgba(239,68,68,0.10)" clipPath={`url(#${redClipId})`} />
          </>
        )}

        {hvY !== null && (
          <>
            <line
              x1={padL}
              y1={hvY}
              x2={W - padR}
              y2={hvY}
              stroke="#6b7280"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={W - padR + 2}
              y={hvY + 3}
              fill="#6b7280"
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
            >
              HV
            </text>
          </>
        )}

        <path
          d={linePath}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {markers.map((m, i) => (
          <g key={i}>
            <circle
              cx={m.x}
              cy={m.y}
              r={5}
              fill={m.color}
              stroke="#0c0d10"
              strokeWidth={1.4}
            >
              <title>{m.tooltip}</title>
            </circle>
            <text
              x={m.x}
              y={m.y - 10}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              fill={m.color}
              textAnchor="middle"
            >
              {m.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
