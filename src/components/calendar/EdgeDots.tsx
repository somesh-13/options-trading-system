'use client';

interface EdgeDotsProps {
  score: number; // 0..5
  fontSize?: number;
}

/**
 * Unicode-bullet edge-score indicator. Filled = ● (green), empty = ○ (gray).
 * Score range 0..5; values outside are clamped.
 */
export default function EdgeDots({ score, fontSize = 12 }: EdgeDotsProps) {
  const s = Math.max(0, Math.min(5, Math.floor(score)));
  return (
    <span
      aria-label={`edge score ${s} of 5`}
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize,
        letterSpacing: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: '#22c55e' }}>{'●'.repeat(s)}</span>
      <span style={{ color: '#374151' }}>{'○'.repeat(5 - s)}</span>
    </span>
  );
}
