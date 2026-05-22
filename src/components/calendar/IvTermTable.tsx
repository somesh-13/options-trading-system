'use client';

import { TERM_BUCKETS, bucketizeTermStructure, type IvTermPoint } from '@/lib/calendar';

interface IvTermTableProps {
  termStructure: IvTermPoint[];
  hv: number;
  size?: 'sm' | 'lg';
}

const SIZE_TOKENS = {
  sm: { ivFont: 18, dteFont: 10, dateFont: 10, padding: '8px 6px' },
  lg: { ivFont: 24, dteFont: 12, dateFont: 11, padding: '12px 10px' },
};

function formatExpiration(iso: string): string {
  // YYYY-MM-DD → "May 22"
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

export default function IvTermTable({ termStructure, hv, size = 'sm' }: IvTermTableProps) {
  const buckets = bucketizeTermStructure(termStructure);
  const tokens = SIZE_TOKENS[size];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 4,
        background: '#0c0d10',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 8,
      }}
    >
      {TERM_BUCKETS.map((bucket, i) => {
        const pt = buckets[i];
        const iv = pt?.atm_iv;
        const ivAboveHv = typeof iv === 'number' && hv > 0 && iv > hv;
        const ivPct = typeof iv === 'number' ? `${(iv * 100).toFixed(0)}%` : '—';

        return (
          <div
            key={bucket.label}
            style={{
              padding: tokens.padding,
              textAlign: 'center',
              borderRight: i < TERM_BUCKETS.length - 1 ? '1px solid var(--line-soft)' : 'none',
              opacity: pt ? 1 : 0.45,
            }}
          >
            <div
              style={{
                fontSize: tokens.dateFont,
                color: 'var(--ink-mute)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {pt ? formatExpiration(pt.expiration) : bucket.label}
            </div>
            <div
              style={{
                fontSize: tokens.ivFont,
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                color: ivAboveHv ? 'var(--green)' : 'var(--ink-dim)',
                marginTop: 2,
                lineHeight: 1.1,
              }}
            >
              {ivPct}
            </div>
            <div
              style={{
                fontSize: tokens.dteFont,
                color: 'var(--ink-mute)',
                fontFamily: 'JetBrains Mono, monospace',
                marginTop: 2,
              }}
            >
              {pt ? `${pt.dte}d` : bucket.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
