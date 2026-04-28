'use client';

type StrikeStripProps = {
  strikes: number[];
  selected: number;
  spot: number;
  optType: 'call' | 'put';
  onSelect: (k: number) => void;
};

function moneyness(k: number, spot: number, optType: 'call' | 'put'): 'ITM' | 'OTM' | 'ATM' {
  if (Math.abs(k - spot) < 0.3) return 'ATM';
  const itm = optType === 'call' ? k < spot : k > spot;
  return itm ? 'ITM' : 'OTM';
}

export function StrikeStrip({ strikes, selected, spot, optType, onSelect }: StrikeStripProps) {
  return (
    <div className="rv-expstrip" style={{ margin: '6px 0 12px' }}>
      {strikes.map((k) => {
        const m = moneyness(k, spot, optType);
        return (
          <div
            key={k}
            className={`rv-exp ${k === selected ? 'on' : ''}`}
            onClick={() => onSelect(k)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(k);
            }}
          >
            <div className="dte">${k.toFixed(2)}</div>
            <div className="date">{m}</div>
            <div className="iv" style={{ visibility: m === 'ATM' ? 'visible' : 'hidden' }}>
              ATM
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function buildStrikeWindow(spot: number, count = 11, step = 0.5): number[] {
  const center = Math.round(spot / step) * step;
  const half = Math.floor(count / 2);
  const out: number[] = [];
  for (let i = -half; i <= half; i++) {
    out.push(+(center + i * step).toFixed(2));
  }
  return out;
}
