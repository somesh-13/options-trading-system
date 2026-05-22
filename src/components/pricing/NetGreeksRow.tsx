'use client';

import { GreekBigCell } from './GreekBigCell';
import { thetaVegaRatioColor } from '@/lib/calendar';
import type { Greeks } from '@/lib/pricing-api';

interface NetGreeksRowProps {
  net: Greeks | null;
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

const RATIO_COLOR_CSS: Record<'green' | 'gold' | 'mute', string> = {
  green: 'var(--green)',
  gold: 'var(--gold)',
  mute: 'var(--ink-dim)',
};

export default function NetGreeksRow({ net }: NetGreeksRowProps) {
  const thetaPositive = typeof net?.theta === 'number' && net.theta > 0;
  const thetaVegaRatio =
    typeof net?.theta === 'number' && typeof net?.vega === 'number' && net.vega !== 0
      ? Math.abs(net.theta) / Math.abs(net.vega)
      : NaN;
  const tvBucket = thetaVegaRatioColor(thetaVegaRatio);

  return (
    <div className="rv-greek-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      <GreekBigCell
        sym="∑Δ"
        ord={1}
        name="Net Delta"
        val={fmt(net?.delta)}
        unit="per $1 spot"
        desc="combined directional exposure"
        sparkColor="var(--green)"
        sparkSeed={2}
      />
      <GreekBigCell
        sym="∑Γ"
        ord={1}
        name="Net Gamma"
        val={fmt(net?.gamma)}
        unit="Δ per $1 spot"
        desc="combined curvature"
        sparkColor="var(--green)"
        sparkSeed={3}
      />
      {/* Net Theta — when positive, dress the card with a green surround. */}
      <div style={{ position: 'relative' }}>
        {thetaPositive && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 4,
              border: '1px solid rgba(0,200,5,.35)',
              background: 'rgba(0,200,5,.04)',
              pointerEvents: 'none',
            }}
          />
        )}
        <GreekBigCell
          sym="∑Θ"
          ord={1}
          name="Net Theta"
          val={fmt(net?.theta)}
          unit="$/share/day"
          desc={thetaPositive ? 'time decay works FOR you' : 'net theta'}
          sparkColor={thetaPositive ? 'var(--green)' : 'var(--pink)'}
          sparkSeed={5}
        />
      </div>
      <GreekBigCell
        sym="∑V"
        ord={1}
        name="Net Vega"
        val={fmt(net?.vega)}
        unit="$/share per 1% IV"
        desc="IV expansion helps"
        sparkColor="var(--blue)"
        sparkSeed={7}
      />
      {/* Θ/V Ratio — second-order treatment + threshold color. */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 4,
            border: '1px solid rgba(255,215,0,.35)',
            background: 'rgba(255,215,0,.03)',
            pointerEvents: 'none',
          }}
        />
        <GreekBigCell
          sym="Θ/V"
          ord={2}
          name="Theta/Vega"
          val={Number.isFinite(thetaVegaRatio) ? thetaVegaRatio.toFixed(3) : '—'}
          unit={`color: ${tvBucket}`}
          desc="your edge"
          sparkColor={RATIO_COLOR_CSS[tvBucket]}
          sparkSeed={9}
        />
      </div>
    </div>
  );
}
