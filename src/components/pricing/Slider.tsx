'use client';

type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange?: (v: number) => void;
};

export function Slider({ value, min, max, step = 0.01, disabled, onChange }: SliderProps) {
  const clamped = Math.max(min, Math.min(max, value));
  const leftPct = ((clamped - min) / (max - min)) * 100;

  return (
    <div className="rv-slider" style={{ position: 'relative', opacity: disabled ? 0.55 : 1 }}>
      <i style={{ left: `${leftPct}%` }} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        disabled={disabled}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          opacity: 0,
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
    </div>
  );
}
