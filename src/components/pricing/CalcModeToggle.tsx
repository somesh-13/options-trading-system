'use client';

export type CalcMode = 'price-from-iv' | 'iv-from-price';

const HELPERS: Record<CalcMode, string> = {
  'price-from-iv': 'Enter σ → solve theoretical price + Greeks',
  'iv-from-price': 'Enter market price → solve implied volatility',
};

export function CalcModeToggle({
  mode,
  onChange,
}: {
  mode: CalcMode;
  onChange: (m: CalcMode) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="rv-sub" style={{ marginBottom: 0, fontSize: 11 }}>
          Solve for:
        </span>
        <button
          className={`rv-btn ${mode === 'price-from-iv' ? '' : 'ghost'}`}
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={() => onChange('price-from-iv')}
        >
          Price
        </button>
        <button
          className={`rv-btn ${mode === 'iv-from-price' ? '' : 'ghost'}`}
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={() => onChange('iv-from-price')}
        >
          IV
        </button>
      </div>
      <span className="rv-sub" style={{ marginBottom: 0, fontSize: 10 }}>
        {HELPERS[mode]}
      </span>
    </div>
  );
}
