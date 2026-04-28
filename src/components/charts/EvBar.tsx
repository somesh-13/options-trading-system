/**
 * EV-per-contract bar. Negative = pink growing left from center,
 * positive = green growing right from center. Direct port of the
 * inline `evBar` snippet from `scannerAfter()`.
 */
export function EvBar({ ev, max = 100 }: { ev: number; max?: number }) {
  const evPct = Math.min(100, (Math.abs(ev) / max) * 50);
  return (
    <div className="rv-ev-bar">
      {ev >= 0 ? (
        <i className="pos" style={{ width: `${evPct}%` }} />
      ) : (
        <i className="neg" style={{ width: `${evPct}%` }} />
      )}
    </div>
  );
}
