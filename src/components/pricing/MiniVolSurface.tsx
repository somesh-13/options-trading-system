'use client';

import { useRef, useState } from 'react';
import type { VolSurfaceData } from '@/lib/pricing-api';

type MiniVolSurfaceProps = {
  surface: VolSurfaceData | null;
  selectedStrike?: number;
  selectedExpiration?: string;
};

const W = 360;
const H = 240;
const M = { left: 56, top: 14, right: 44, bottom: 30 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

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

export function MiniVolSurface({
  surface,
  selectedStrike,
  selectedExpiration,
}: MiniVolSurfaceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Snapped (row=expiry, col=strike) cell under the cursor, plus viewBox-x of
  // the cursor so the tooltip can flip across the cell when near the edge.
  const [hover, setHover] = useState<{ i: number; j: number; vx: number; vy: number } | null>(
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
  const rows = expirations.length;
  const cols = strikes.length;
  const cellW = PLOT_W / cols;
  const cellH = PLOT_H / rows;

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

  const selStrikeIdx = selectedStrike != null ? nearestIndex(strikes, selectedStrike) : -1;
  const selExpIdx = selectedExpiration != null ? expirations.indexOf(selectedExpiration) : -1;

  const xLabelEvery = Math.max(1, Math.ceil(cols / 7));
  const legendX = W - M.right + 12;

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
    const j = Math.max(0, Math.min(cols - 1, Math.floor((c.vx - M.left) / cellW)));
    const i = Math.max(0, Math.min(rows - 1, Math.floor((c.vy - M.top) / cellH)));
    setHover({ i, j, vx: c.vx, vy: c.vy });
  }

  // Tooltip placement: prefer right of cursor; flip left near the right
  // edge of the plot so it never crosses into the legend strip.
  const TT_W = 160;
  const TT_H = 50;
  let ttX = 0;
  let ttY = 0;
  let ttIv: number | null = null;
  if (hover) {
    ttIv = iv_matrix[hover.i]?.[hover.j] ?? null;
    ttX = hover.vx + 10;
    if (ttX + TT_W > M.left + PLOT_W) ttX = hover.vx - TT_W - 10;
    ttY = hover.vy + 10;
    if (ttY + TT_H > M.top + PLOT_H) ttY = hover.vy - TT_H - 10;
    ttY = Math.max(M.top, ttY);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: 'block' }}
    >
      <g>
        {iv_matrix.map((row, i) =>
          row.map((iv, j) => {
            const x = M.left + j * cellW;
            const y = M.top + i * cellH;
            if (iv == null) {
              return (
                <rect
                  key={`${i}-${j}`}
                  x={x}
                  y={y}
                  width={cellW}
                  height={cellH}
                  fill="#1a1b1f"
                  stroke="#1d1e23"
                />
              );
            }
            const norm = (iv - minIv) / (maxIv - minIv);
            const opacity = 0.1 + 0.85 * norm;
            return (
              <rect
                key={`${i}-${j}`}
                x={x}
                y={y}
                width={cellW}
                height={cellH}
                fill={`rgba(255,215,0,${opacity.toFixed(2)})`}
                stroke="#1d1e23"
              />
            );
          }),
        )}
      </g>

      {selStrikeIdx >= 0 && selExpIdx >= 0 && (
        <rect
          x={M.left + selStrikeIdx * cellW}
          y={M.top + selExpIdx * cellH}
          width={cellW}
          height={cellH}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={2}
          pointerEvents="none"
        />
      )}

      <g
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fill="var(--ink-mute)"
        textAnchor="middle"
      >
        {strikes.map((k, j) =>
          j % xLabelEvery === 0 ? (
            <text key={j} x={M.left + (j + 0.5) * cellW} y={H - M.bottom + 12}>
              ${k.toFixed(0)}
            </text>
          ) : null,
        )}
        <text x={M.left + PLOT_W / 2} y={H - 4} fill="var(--ink-dim)">
          strike →
        </text>
      </g>

      <g
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fill="var(--ink-mute)"
        textAnchor="end"
      >
        {expirations.map((d, i) => (
          <text key={i} x={M.left - 6} y={M.top + (i + 0.5) * cellH + 3}>
            {d}
          </text>
        ))}
        <text
          transform={`translate(12, ${M.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle"
          fill="var(--ink-dim)"
        >
          ← DTE
        </text>
      </g>

      <defs>
        <linearGradient id="iv-legend" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="rgba(255,215,0,0.10)" />
          <stop offset="100%" stopColor="rgba(255,215,0,0.95)" />
        </linearGradient>
      </defs>
      <rect x={legendX} y={M.top} width={10} height={PLOT_H} fill="url(#iv-legend)" stroke="#1d1e23" />
      <g fontFamily="'JetBrains Mono', monospace" fontSize={9} fill="var(--ink-mute)">
        <text x={legendX + 14} y={M.top + 8}>{`${(maxIv * 100).toFixed(0)}%`}</text>
        <text x={legendX + 14} y={M.top + PLOT_H}>{`${(minIv * 100).toFixed(0)}%`}</text>
      </g>

      {/* Hover capture: invisible rect over the heatmap area for mousemove. */}
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
          {/* Outline the hovered cell so the user sees what the tooltip refers to */}
          <rect
            x={M.left + hover.j * cellW}
            y={M.top + hover.i * cellH}
            width={cellW}
            height={cellH}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={1.5}
          />
          {/* Tooltip box */}
          <g transform={`translate(${ttX.toFixed(1)}, ${ttY.toFixed(1)})`}>
            <rect
              width={TT_W}
              height={TT_H}
              rx={3}
              fill="rgba(20,21,25,0.96)"
              stroke="var(--line)"
            />
            <text
              x={8}
              y={14}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              fill="var(--ink)"
              fontWeight={700}
            >
              ${strikes[hover.j].toFixed(2)} · {expirations[hover.i]}
            </text>
            <text
              x={8}
              y={30}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              fill="var(--ink-mute)"
            >
              IV
            </text>
            <text
              x={TT_W - 8}
              y={30}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fill={ttIv == null ? 'var(--ink-mute)' : 'var(--gold)'}
              textAnchor="end"
              fontWeight={700}
            >
              {ttIv == null ? 'n/a' : `${(ttIv * 100).toFixed(1)}%`}
            </text>
            <text
              x={8}
              y={44}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              fill="var(--ink-dim)"
            >
              row {hover.i + 1}/{rows} · col {hover.j + 1}/{cols}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
