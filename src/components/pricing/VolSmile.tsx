'use client';

import { useRef, useState } from 'react';
import type { VolSurfaceData } from '@/lib/pricing-api';

type VolSmileProps = {
  surface: VolSurfaceData | null;
  selectedStrike?: number;
  selectedExpiration?: string;
};

const W = 420;
const H = 240;
const M = { left: 44, top: 14, right: 90, bottom: 30 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const OTHER_COLORS = [
  'rgba(150,150,160,0.55)',
  'rgba(120,180,255,0.55)',
  'rgba(180,140,255,0.55)',
  'rgba(255,140,180,0.55)',
  'rgba(140,220,200,0.55)',
  'rgba(220,200,120,0.55)',
];

function nearestIndex(arr: number[], target: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

export function VolSmile({ surface, selectedStrike, selectedExpiration }: VolSmileProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // hover.strikeIdx is the strike column closest to the mouse;
  // hover.px / hover.py are SVG-local coords used to position the tooltip.
  const [hover, setHover] = useState<{ strikeIdx: number; px: number; py: number } | null>(
    null,
  );

  if (!surface || !surface.iv_matrix.length) {
    return (
      <div
        style={{
          height: H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-mute)',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        loading vol surface…
      </div>
    );
  }

  const { strikes, expirations, iv_matrix } = surface;

  const minK = strikes[0];
  const maxK = strikes[strikes.length - 1];
  const kRange = Math.max(1e-6, maxK - minK);

  let minIv = Infinity;
  let maxIv = -Infinity;
  for (const row of iv_matrix) {
    for (const v of row) {
      if (v == null) continue;
      if (v < minIv) minIv = v;
      if (v > maxIv) maxIv = v;
    }
  }
  if (!isFinite(minIv) || !isFinite(maxIv) || maxIv === minIv) {
    minIv = 0;
    maxIv = 1;
  }
  const ivPad = (maxIv - minIv) * 0.08;
  const yMin = Math.max(0, minIv - ivPad);
  const yMax = maxIv + ivPad;
  const yRange = Math.max(1e-6, yMax - yMin);

  const x = (k: number) => M.left + ((k - minK) / kRange) * PLOT_W;
  const y = (iv: number) => M.top + (1 - (iv - yMin) / yRange) * PLOT_H;

  const selExpIdx = selectedExpiration != null ? expirations.indexOf(selectedExpiration) : -1;
  const selStrikeIdx = selectedStrike != null ? nearestIndex(strikes, selectedStrike) : -1;

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => yMin + (yRange * i) / yTickCount);

  const xTickEvery = Math.max(1, Math.ceil(strikes.length / 6));

  const buildPath = (rowIdx: number) => {
    const row = iv_matrix[rowIdx];
    const segments: string[] = [];
    let started = false;
    for (let j = 0; j < strikes.length; j++) {
      const iv = row[j];
      if (iv == null) {
        started = false;
        continue;
      }
      const px = x(strikes[j]);
      const py = y(iv);
      segments.push(`${started ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`);
      started = true;
    }
    return segments.join(' ');
  };

  const selIv = selExpIdx >= 0 && selStrikeIdx >= 0 ? iv_matrix[selExpIdx][selStrikeIdx] : null;

  // Convert a client-space mouse event into SVG viewBox coords. We need
  // viewBox coords (not pixel coords) because the SVG is responsively sized
  // via width="100%" while keeping a fixed viewBox.
  function svgCoordsFromEvent(e: React.MouseEvent<SVGRectElement>): { vx: number; vy: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const vy = ((e.clientY - rect.top) / rect.height) * H;
    return { vx, vy };
  }

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const c = svgCoordsFromEvent(e);
    if (!c) return;
    // Snap to the nearest strike by viewBox-x position (so the guide tracks
    // the actual data points, not arbitrary pixel positions).
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let j = 0; j < strikes.length; j++) {
      const d = Math.abs(x(strikes[j]) - c.vx);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = j;
      }
    }
    setHover({ strikeIdx: bestIdx, px: c.vx, py: c.vy });
  }

  // Tooltip placement: prefer right of cursor, but flip left near the
  // right edge so it never clips the legend column.
  const TT_W = 132;
  const TT_LINE_H = 12;
  let ttRows: { color: string; label: string; iv: number; dim: boolean }[] = [];
  let ttX = 0;
  let ttY = 0;
  let ttH = 0;
  if (hover) {
    ttRows = expirations
      .map((d, i) => {
        const iv = iv_matrix[i]?.[hover.strikeIdx];
        if (iv == null) return null;
        const isSel = i === selExpIdx;
        const color = isSel ? 'var(--gold)' : OTHER_COLORS[i % OTHER_COLORS.length];
        return { color, label: d, iv, dim: !isSel };
      })
      .filter((r): r is { color: string; label: string; iv: number; dim: boolean } => r != null);
    ttH = 18 + ttRows.length * TT_LINE_H + 14;
    const guideX = x(strikes[hover.strikeIdx]);
    ttX = guideX + 8;
    if (ttX + TT_W > M.left + PLOT_W) ttX = guideX - TT_W - 8;
    ttY = Math.min(Math.max(hover.py - ttH / 2, M.top), M.top + PLOT_H - ttH);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: 'block' }}
    >
      <g stroke="rgba(255,255,255,0.05)" strokeWidth={1}>
        {yTicks.map((tv, i) => (
          <line key={`gy-${i}`} x1={M.left} x2={M.left + PLOT_W} y1={y(tv)} y2={y(tv)} />
        ))}
      </g>

      <g
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fill="var(--ink-mute)"
        textAnchor="end"
      >
        {yTicks.map((tv, i) => (
          <text key={`yt-${i}`} x={M.left - 4} y={y(tv) + 3}>
            {(tv * 100).toFixed(0)}%
          </text>
        ))}
      </g>

      <g fill="none" strokeWidth={1.4}>
        {expirations.map((_, i) => {
          if (i === selExpIdx) return null;
          const color = OTHER_COLORS[i % OTHER_COLORS.length];
          return <path key={`p-${i}`} d={buildPath(i)} stroke={color} />;
        })}
        {selExpIdx >= 0 && (
          <path d={buildPath(selExpIdx)} stroke="var(--gold)" strokeWidth={2.2} />
        )}
      </g>

      {selStrikeIdx >= 0 && (
        <line
          x1={x(strikes[selStrikeIdx])}
          x2={x(strikes[selStrikeIdx])}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke="var(--gold)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}

      {selIv != null && selStrikeIdx >= 0 && (
        <g>
          <circle cx={x(strikes[selStrikeIdx])} cy={y(selIv)} r={3.5} fill="var(--gold)" />
          <text
            x={x(strikes[selStrikeIdx]) + 6}
            y={y(selIv) - 6}
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            fill="var(--gold)"
          >
            {(selIv * 100).toFixed(1)}%
          </text>
        </g>
      )}

      <line
        x1={M.left}
        x2={M.left + PLOT_W}
        y1={M.top + PLOT_H}
        y2={M.top + PLOT_H}
        stroke="var(--line)"
        strokeWidth={1}
      />
      <line
        x1={M.left}
        x2={M.left}
        y1={M.top}
        y2={M.top + PLOT_H}
        stroke="var(--line)"
        strokeWidth={1}
      />

      <g
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fill="var(--ink-mute)"
        textAnchor="middle"
      >
        {strikes.map((k, j) =>
          j % xTickEvery === 0 || j === strikes.length - 1 ? (
            <text key={`xt-${j}`} x={x(k)} y={H - M.bottom + 12}>
              ${k.toFixed(0)}
            </text>
          ) : null,
        )}
        <text x={M.left + PLOT_W / 2} y={H - 4} fill="var(--ink-dim)">
          strike →
        </text>
      </g>

      <text
        transform={`translate(10, ${M.top + PLOT_H / 2}) rotate(-90)`}
        textAnchor="middle"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fill="var(--ink-dim)"
      >
        IV %
      </text>

      <g fontFamily="'JetBrains Mono', monospace" fontSize={9}>
        {expirations.map((d, i) => {
          const isSel = i === selExpIdx;
          const color = isSel ? 'var(--gold)' : OTHER_COLORS[i % OTHER_COLORS.length];
          const yPos = M.top + 4 + i * 12;
          return (
            <g key={`lg-${i}`}>
              <line
                x1={W - M.right + 6}
                x2={W - M.right + 18}
                y1={yPos + 4}
                y2={yPos + 4}
                stroke={color}
                strokeWidth={isSel ? 2.2 : 1.4}
              />
              <text
                x={W - M.right + 22}
                y={yPos + 7}
                fill={isSel ? 'var(--ink)' : 'var(--ink-mute)'}
              >
                {d}
              </text>
            </g>
          );
        })}
      </g>

      {/* Hover capture: invisible rect over the plot area. SVG has no
          native mousemove tracking, so we render a transparent rect just
          for events. */}
      <rect
        x={M.left}
        y={M.top}
        width={PLOT_W}
        height={PLOT_H}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      />

      {hover && (
        <g pointerEvents="none">
          {/* Vertical guide at the snapped strike */}
          <line
            x1={x(strikes[hover.strikeIdx])}
            x2={x(strikes[hover.strikeIdx])}
            y1={M.top}
            y2={M.top + PLOT_H}
            stroke="var(--ink-dim)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
          />
          {/* Dot per expiration where its line crosses the guide */}
          {ttRows.map((r, idx) => {
            const expIdx = expirations.indexOf(r.label);
            const iv = iv_matrix[expIdx]?.[hover.strikeIdx];
            if (iv == null) return null;
            return (
              <circle
                key={`hd-${idx}`}
                cx={x(strikes[hover.strikeIdx])}
                cy={y(iv)}
                r={r.dim ? 2.5 : 3.5}
                fill={r.color}
                stroke="var(--bg, #1E1E1E)"
                strokeWidth={1}
              />
            );
          })}
          {/* Tooltip */}
          <g transform={`translate(${ttX.toFixed(1)}, ${ttY.toFixed(1)})`}>
            <rect
              width={TT_W}
              height={ttH}
              rx={3}
              fill="rgba(20,21,25,0.96)"
              stroke="var(--line)"
            />
            <text
              x={8}
              y={13}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              fill="var(--ink)"
              fontWeight={700}
            >
              ${strikes[hover.strikeIdx].toFixed(2)} strike
            </text>
            {ttRows.map((r, i) => (
              <g key={`ttr-${i}`} transform={`translate(8, ${22 + i * TT_LINE_H})`}>
                <circle cx={3} cy={-2} r={2.5} fill={r.color} />
                <text
                  x={10}
                  y={1}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  fill={r.dim ? 'var(--ink-mute)' : 'var(--ink)'}
                >
                  {r.label}
                </text>
                <text
                  x={TT_W - 10}
                  y={1}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  fill={r.dim ? 'var(--ink-mute)' : 'var(--gold)'}
                  textAnchor="end"
                  fontWeight={r.dim ? 400 : 700}
                >
                  {(r.iv * 100).toFixed(1)}%
                </text>
              </g>
            ))}
          </g>
        </g>
      )}
    </svg>
  );
}
