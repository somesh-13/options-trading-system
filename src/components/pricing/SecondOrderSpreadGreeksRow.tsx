'use client';

import { GreekBigCell } from './GreekBigCell';
import type { Greeks } from '@/lib/pricing-api';

interface SecondOrderSpreadGreeksRowProps {
  net: Greeks | null;
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/**
 * Vanna (∂Δ/∂σ), Vomma (∂V/∂σ — backend labels this `volga`, mathematically
 * identical), and Charm (∂Δ/∂t) of the net calendar position. These three
 * second-order Greeks are the ones most useful for diagnosing a calendar:
 * Vomma captures the vega-of-vega edge, Vanna shows how vol shifts skew
 * delta exposure across legs, Charm shows how delta migrates with time.
 */
export default function SecondOrderSpreadGreeksRow({ net }: SecondOrderSpreadGreeksRowProps) {
  return (
    <div className="rv-greek-grid">
      <GreekBigCell
        sym="∂Δ/∂σ"
        ord={2}
        name="Net Vanna"
        val={fmt(net?.vanna)}
        unit="Δ per 1% IV"
        desc="cross-leg skew sensitivity"
        sparkColor="var(--gold)"
        sparkSeed={11}
      />
      <GreekBigCell
        sym="∂V/∂σ"
        ord={2}
        name="Net Vomma"
        val={fmt(net?.volga)}
        unit="Vega per 1% IV"
        desc="vol-of-vol edge"
        sparkColor="var(--gold)"
        sparkSeed={13}
      />
      <GreekBigCell
        sym="∂Δ/∂t"
        ord={2}
        name="Net Charm"
        val={fmt(net?.charm)}
        unit="Δ per day"
        desc="delta migration with time"
        sparkColor="var(--gold)"
        sparkSeed={15}
      />
    </div>
  );
}
