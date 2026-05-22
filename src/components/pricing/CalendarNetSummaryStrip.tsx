'use client';

interface CalendarNetSummaryStripProps {
  shortPrice: number | null;
  longPrice: number | null;
  strike: number;
}

function fmtUsd(n: number, signed = false): string {
  const a = Math.abs(n);
  const s = `$${a.toFixed(2)}`;
  if (!signed) return s;
  return n >= 0 ? `+${s}` : `−${s}`;
}

function Divider() {
  return <span style={{ color: '#374151', fontFamily: "'JetBrains Mono', monospace" }}>·</span>;
}

/**
 * Trade-economics strip: net debit, max profit, max loss, breakeven.
 * "× 100" assumes standard equity option contracts (100 shares/contract).
 */
export default function CalendarNetSummaryStrip({
  shortPrice,
  longPrice,
  strike,
}: CalendarNetSummaryStripProps) {
  const hasData = shortPrice != null && longPrice != null;
  // Convention: short = SOLD (we collect premium), long = BOUGHT (we pay).
  // Net debit per share = long - short. Per contract = × 100.
  const netDebitPerShare = hasData ? longPrice - shortPrice : 0;
  const netDebitContract = netDebitPerShare * 100;
  const isDebit = netDebitPerShare > 0;
  const maxProfit = hasData ? (shortPrice as number) * 100 : 0;
  // Max loss bounded by net debit when we paid (debit) — unbounded if net credit
  // (calendar opened for a credit is unusual but possible if back-month IV is much
  // lower than front; flag that case rather than displaying a fake max-loss).
  const maxLossLabel = hasData
    ? isDebit
      ? fmtUsd(netDebitContract)
      : 'unlimited (credit)'
    : '—';
  const breakeven = hasData ? strike + netDebitPerShare : NaN;

  return (
    <div
      style={{
        background: '#181818',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '8px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        alignItems: 'center',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1 }}>
          Net {isDebit ? 'Debit' : 'Credit'}
        </span>
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {hasData ? `${fmtUsd(netDebitContract)} ${isDebit ? '(debit paid)' : '(net credit)'}` : '—'}
        </span>
      </div>
      <Divider />
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
        title="Estimated if short leg expires worthless"
      >
        <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>
          Max Profit
        </span>
        <span style={{ color: '#22c55e', fontWeight: 600 }}>
          {hasData ? fmtUsd(maxProfit) : '—'}
        </span>
      </div>
      <Divider />
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>
          Max Loss
        </span>
        <span style={{ color: '#ef4444', fontWeight: 600 }}>
          {maxLossLabel}
        </span>
      </div>
      <Divider />
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>
          Breakeven
        </span>
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {hasData && Number.isFinite(breakeven) ? `$${breakeven.toFixed(2)}` : '—'}
        </span>
      </div>
    </div>
  );
}
