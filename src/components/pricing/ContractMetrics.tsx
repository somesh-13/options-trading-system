'use client';

import { bsD2, normCdf } from '@/lib/stats';

type ContractMetricsProps = {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  optType: 'call' | 'put';
  theoretical: number;
  premium: number;
  side?: 'long' | 'short';
  premiumSource?: 'mid' | 'market';
};

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function ContractMetrics({
  S,
  K,
  T,
  r,
  sigma,
  optType,
  theoretical,
  premium,
  side = 'long',
  premiumSource = 'mid',
}: ContractMetricsProps) {
  const intrinsicShare = optType === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const extrinsicShare = Math.max(0, premium - intrinsicShare);
  const breakeven = optType === 'call' ? K + premium : K - premium;
  const breakevenPct = ((breakeven - S) / S) * 100;
  const modelExtrinsic = Math.max(0, theoretical - intrinsicShare);

  const d2 = bsD2(S, K, T, r, sigma);
  const probItm = optType === 'call' ? normCdf(d2) : normCdf(-d2);
  const probTouch = Math.min(1, probItm * 2);

  const expMoveDollar = S * sigma * Math.sqrt(T);
  const expMovePct = sigma * Math.sqrt(T) * 100;

  const breakevenSign = optType === 'call' ? breakevenPct >= 0 : breakevenPct <= 0;
  const sourceLabel = premiumSource === 'mid' ? 'market mid' : 'market';
  const probTouchDisplay = probTouch >= 0.99 ? '>99%' : `${fmt(probTouch * 100, 1)}%`;
  const probSideNote = side === 'short' ? ' · prob of loss' : '';

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px dashed var(--line)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px 12px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      }}
    >
      <Row
        label="Intrinsic"
        value={`$${fmt(intrinsicShare)}/sh`}
        sub={`$${fmt(intrinsicShare * 100)}/contract`}
      />
      <Row
        label="Extrinsic (time)"
        value={`$${fmt(extrinsicShare)}/sh`}
        sub={
          <>
            ${fmt(extrinsicShare * 100)}/contract
            <span style={{ color: 'var(--ink-dim)', marginLeft: 6 }}>
              · model ${fmt(modelExtrinsic)}/sh
            </span>
          </>
        }
      />
      <Row
        label="Breakeven (expiry)"
        value={`$${fmt(breakeven)}`}
        sub={
          <>
            <span className={`rv-chip ${breakevenSign ? 'sell' : 'buy'}`}>
              {breakevenPct >= 0 ? '+' : ''}
              {fmt(breakevenPct, 1)}% vs spot
            </span>
            <div style={{ fontSize: 9, color: 'var(--ink-dim)', marginTop: 2 }}>
              K {optType === 'call' ? '+' : '−'} premium · uses {sourceLabel} ${fmt(premium)}
            </div>
          </>
        }
      />
      <Row
        label="Expected move (1σ)"
        value={`±$${fmt(expMoveDollar)}`}
        sub={`±${fmt(expMovePct, 1)}% by expiry`}
      />
      <Row
        label="Prob ITM"
        value={`${fmt(probItm * 100, 1)}%`}
        sub={`risk-neutral · N(d₂)${probSideNote}`}
      />
      <Row
        label="Prob touch"
        value={probTouchDisplay}
        sub={`approx · 2 × N(d₂)${probSideNote}`}
        title="Approximation: 2 × N(d₂). Saturates near ATM with high IV — interpret as 'near-certain to touch', not literally 100%."
      />
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className="rv-sub" style={{ marginBottom: 0, fontSize: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 9.5, color: 'var(--ink-mute)', marginTop: 1 }}>{sub}</div>
    </div>
  );
}
