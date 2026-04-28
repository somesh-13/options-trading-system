'use client';

import * as React from 'react';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

const toCss = (v: string | number | undefined, fallback: string): string => {
  if (v === undefined) return fallback;
  return typeof v === 'number' ? `${v}px` : v;
};

/**
 * Pulse-animated rectangle for loading states.
 * Matches the design's "Loading — skeleton" card: bg `var(--line)`,
 * 2px border-radius, opacity pulse 0.4 → 1 → 0.4 over ~1.4s.
 */
export function Skeleton({ width, height, className }: SkeletonProps) {
  const style: React.CSSProperties = {
    width: toCss(width, '100%'),
    height: toCss(height, '10px'),
    background: 'var(--line)',
    borderRadius: '2px',
    animation: 'rv-skeleton-pulse 1.4s ease-in-out infinite',
  };

  return (
    <>
      <span
        aria-hidden="true"
        className={className}
        style={style}
      />
      <style>{`
        @keyframes rv-skeleton-pulse {
          0%   { opacity: 0.4; }
          50%  { opacity: 1;   }
          100% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}

export default Skeleton;
