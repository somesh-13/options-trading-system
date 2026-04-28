/**
 * Single guardrail bar — port of the `limit()` helper from the design source
 * (design/stocks-revamp/project/pages/06-auto-engine.js).
 *
 * Color thresholds (per spec): <70% green, 70-90% gold, >90% pink.
 */

type Props = {
  label: string;
  used: number;
  cap: number;
  unit?: string;
};

function barColor(pct: number): string {
  if (pct > 90) return 'var(--pink)';
  if (pct > 70) return 'var(--gold)';
  return 'var(--green)';
}

export function LimitBar({ label, used, cap, unit = '' }: Props) {
  const pct = Math.min(100, (used / cap) * 100);
  const color = barColor(pct);
  return (
    <div className="rv-limit">
      <div className="hd">
        <span>{label}</span>
        <span>
          <b>
            {unit}
            {used.toLocaleString()}
          </b>{' '}
          / {unit}
          {cap.toLocaleString()}
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
