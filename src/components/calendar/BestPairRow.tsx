'use client';

import Link from 'next/link';
import type { CalendarPair } from '@/lib/calendar';
import EdgeDots from './EdgeDots';

interface BestPairRowProps {
  ticker: string;
  pair: CalendarPair;
  strike?: number | null;
}

function formatExpiration(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

function diffColor(differential: number): string {
  if (differential > 10) return 'var(--green)';
  if (differential >= 5) return 'var(--gold)';
  return 'var(--ink-dim)';
}

function ratioColor(ratio: number): string {
  if (ratio > 1.2) return 'var(--green)';
  if (ratio >= 1.05) return 'var(--gold)';
  return 'var(--ink-dim)';
}

export default function BestPairRow({ ticker, pair, strike }: BestPairRowProps) {
  const params = new URLSearchParams({
    ticker,
    short_expiry: pair.short.expiration,
    long_expiry: pair.long.expiration,
  });
  if (typeof strike === 'number') params.set('strike', String(strike));

  return (
    <div
      style={{
        background: '#0c0d10',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="text-meta" style={{ letterSpacing: 1 }}>BEST PAIR</div>

        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
          <span style={{ color: 'var(--ink-mute)' }}>Short:&nbsp;</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {formatExpiration(pair.short.expiration)} ({pair.short.dte}d)
          </span>
          <span style={{ color: 'var(--ink-dim)' }}>
            &nbsp;·&nbsp;{(pair.short.atm_iv! * 100).toFixed(0)}% IV
          </span>
        </div>

        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
          <span style={{ color: 'var(--ink-mute)' }}>Long:&nbsp;</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {formatExpiration(pair.long.expiration)} ({pair.long.dte}d)
          </span>
          <span style={{ color: 'var(--ink-dim)' }}>
            &nbsp;·&nbsp;{(pair.long.atm_iv! * 100).toFixed(0)}% IV
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={{ color: 'var(--ink-mute)' }}>Differential&nbsp;</span>
          <span style={{ color: diffColor(pair.differential), fontWeight: 600 }}>
            {pair.differential >= 0 ? '+' : ''}{pair.differential.toFixed(1)}pp
          </span>
        </span>
        <span>
          <span style={{ color: 'var(--ink-mute)' }}>Ratio&nbsp;</span>
          <span style={{ color: ratioColor(pair.ratio), fontWeight: 600 }}>
            {pair.ratio.toFixed(2)}×
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--ink-mute)' }}>Edge</span>
          <EdgeDots score={pair.edgeScore} />
        </span>
      </div>

      <Link
        href={`/calendar?${params.toString()}`}
        className="rv-btn ghost"
        style={{
          width: '100%',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        open in calendar analyser
      </Link>
    </div>
  );
}
