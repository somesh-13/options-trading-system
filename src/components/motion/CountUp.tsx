'use client';

import * as React from 'react';

export interface CountUpProps {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}

const defaultFormat = (n: number): string => n.toLocaleString();

/**
 * Animates a number from its previous render value to the new `value`
 * over `durationMs` (default ~400ms) using requestAnimationFrame.
 * No external animation lib.
 */
export function CountUp({
  value,
  format = defaultFormat,
  durationMs = 400,
  className,
}: CountUpProps) {
  const [display, setDisplay] = React.useState<number>(value);
  const previousRef = React.useRef<number>(value);
  const frameRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const from = previousRef.current;
    const to = value;

    if (from === to) {
      setDisplay(to);
      return;
    }

    if (durationMs <= 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
      previousRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        previousRef.current = to;
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      previousRef.current = to;
    };
  }, [value, durationMs]);

  return <span className={className}>{format(display)}</span>;
}

export default CountUp;
