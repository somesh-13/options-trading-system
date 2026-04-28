'use client';

export type Side = 'long' | 'short';

const HELPERS: Record<Side, string> = {
  long: 'Buy the contract — pay premium, P&L = payoff − premium',
  short: 'Sell the contract — collect premium, P&L = premium − payoff',
};

export function SideToggle({
  side,
  onChange,
}: {
  side: Side;
  onChange: (s: Side) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="rv-sub" style={{ marginBottom: 0, fontSize: 11 }}>
          Perspective:
        </span>
        <button
          className={`rv-btn ${side === 'long' ? '' : 'ghost'}`}
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={() => onChange('long')}
        >
          Long
        </button>
        <button
          className={`rv-btn ${side === 'short' ? '' : 'ghost'}`}
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={() => onChange('short')}
        >
          Short
        </button>
      </div>
      <span className="rv-sub" style={{ marginBottom: 0, fontSize: 10 }}>
        {HELPERS[side]}
      </span>
    </div>
  );
}
