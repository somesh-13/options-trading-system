'use client';

import { useMemo, useSyncExternalStore } from 'react';

interface QuoteSummaryProps {
  /** Last trade price. */
  price: number;
  /** Absolute price change vs. prior close. */
  change: number;
  /** Percent change vs. prior close (e.g. -2.17 for −2.17%). */
  changePercent: number;
  /**
   * Last-updated timestamp. Accepts a Date, an ISO string, a unix-ms number,
   * or a pre-formatted string (used as-is when not parseable).
   */
  lastUpdated: string | number | Date | null | undefined;
  /** When true, render the skeleton state instead of values. */
  loading?: boolean;
  /**
   * Update-age (ms) above which a "Delayed" badge appears. Defaults to 15 min.
   * Set to `Infinity` to suppress.
   */
  staleAfterMs?: number;
  /** Optional currency symbol; defaults to "$". */
  currency?: string;
  /** Optional class for outer card. */
  className?: string;
  /**
   * `'card'` (default) renders a self-contained card with border, padding, and
   * radius per spec. `'embedded'` strips the outer chrome so the component can
   * live inside an existing card wrapper without doubled borders.
   */
  variant?: 'card' | 'embedded';
}

const DEFAULT_STALE_MS = 15 * 60 * 1000;

// Shared clock store: every QuoteSummary instance subscribes to the same 30s
// tick instead of holding its own interval. `getClockSnapshot` is rounded to
// the tick so React's strict-equality check can de-dupe re-renders.
const CLOCK_TICK_MS = 30_000;
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockInterval: ReturnType<typeof setInterval> | null = null;

function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (clockInterval == null) {
    clockNow = Date.now();
    clockInterval = setInterval(() => {
      clockNow = Date.now();
      for (const fn of clockListeners) fn();
    }, CLOCK_TICK_MS);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockInterval != null) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  };
}
function getClockSnapshot(): number | null {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}
function getServerClockSnapshot(): number | null {
  return null;
}

function parseTimestamp(input: QuoteSummaryProps['lastUpdated']): {
  date: Date | null;
  rawString: string | null;
} {
  if (input == null) return { date: null, rawString: null };
  if (input instanceof Date) {
    return { date: Number.isFinite(input.getTime()) ? input : null, rawString: null };
  }
  if (typeof input === 'number') {
    const d = new Date(input);
    return { date: Number.isFinite(d.getTime()) ? d : null, rawString: null };
  }
  // string: try parse, else fall back to displaying as-is
  const parsed = new Date(input);
  if (Number.isFinite(parsed.getTime())) return { date: parsed, rawString: null };
  return { date: null, rawString: input };
}

function formatHumanET(date: Date): string {
  // "Updated 10:20 PM ET"
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return `Updated ${time} ET`;
}

function formatSignedAbs(change: number, currency: string): string {
  if (!Number.isFinite(change)) return '—';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const abs = Math.abs(change).toFixed(2);
  return `${sign}${currency}${abs} today`;
}

function formatSignedPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  const abs = Math.abs(pct).toFixed(2);
  return `${sign}${abs}%`;
}

export default function QuoteSummary({
  price,
  change,
  changePercent,
  lastUpdated,
  loading = false,
  staleAfterMs = DEFAULT_STALE_MS,
  currency = '$',
  className,
  variant = 'card',
}: QuoteSummaryProps) {
  const { date: tsDate, rawString: tsRaw } = useMemo(
    () => parseTimestamp(lastUpdated),
    [lastUpdated],
  );

  const moveColor =
    change > 0 ? 'var(--green)' : change < 0 ? 'var(--pink)' : 'var(--ink-mute)';

  // Subscribe to wall-clock time as an external store so render stays pure.
  // SSR snapshot returns null (badge hidden) so server + first client render
  // produce identical markup; on mount we transition to the live clock.
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot);

  const isStale =
    now != null && tsDate != null && Number.isFinite(staleAfterMs)
      ? now - tsDate.getTime() > staleAfterMs
      : false;

  const timestampText = tsDate
    ? formatHumanET(tsDate)
    : tsRaw
      ? `Updated ${tsRaw}`
      : 'Updated —';

  const cardStyle: React.CSSProperties =
    variant === 'embedded'
      ? {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6,
          fontVariantNumeric: 'tabular-nums',
        }
      : {
          background: 'var(--card, #0c0d10)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6,
          fontVariantNumeric: 'tabular-nums',
        };

  if (loading) {
    return (
      <div className={className} style={cardStyle} aria-busy="true">
        <div
          style={{
            height: 36,
            width: 160,
            borderRadius: 6,
            background: 'var(--line-soft)',
            opacity: 0.7,
          }}
        />
        <div
          style={{
            height: 16,
            width: 220,
            borderRadius: 6,
            background: 'var(--line-soft)',
            opacity: 0.5,
          }}
        />
        <div
          style={{
            height: 12,
            width: 140,
            borderRadius: 6,
            background: 'var(--line-soft)',
            opacity: 0.4,
          }}
        />
      </div>
    );
  }

  const hasPrice = Number.isFinite(price);
  const hasChange = Number.isFinite(change);
  const hasChangePct = Number.isFinite(changePercent);

  if (!hasPrice) {
    return (
      <div className={className} style={cardStyle} role="group" aria-label="Quote unavailable">
        <span
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontSize: 'clamp(24px, 3.5vw, 32px)',
            fontWeight: 700,
            color: 'var(--ink-mute)',
            lineHeight: 1.1,
          }}
        >
          {currency}—
        </span>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-mute)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          Quote unavailable
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={cardStyle} role="group" aria-label="Quote summary">
      {/* Price — single inline element, no wrap, no stacked currency. */}
      <span
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: 'clamp(28px, 4vw, 36px)',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 1.1,
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {currency}
        {price.toFixed(2)}
      </span>

      {/* Move row — only when we have real change data. */}
      {(hasChange || hasChangePct) && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 8,
            whiteSpace: 'nowrap',
            color: moveColor,
            fontWeight: 500,
            fontSize: 15,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {hasChange && (
            <span style={{ whiteSpace: 'nowrap' }}>{formatSignedAbs(change, currency)}</span>
          )}
          {hasChange && hasChangePct && (
            <span aria-hidden style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>
              ·
            </span>
          )}
          {hasChangePct && (
            <span style={{ whiteSpace: 'nowrap' }}>{formatSignedPct(changePercent)}</span>
          )}
        </div>
      )}

      {/* Timestamp + optional staleness badge. */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--ink-mute)',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
        }}
      >
        <span>{timestampText}</span>
        {isStale && (
          <span
            className="rv-pill"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              color: 'var(--gold)',
              borderColor: 'var(--gold-dim)',
              background: 'rgba(255,215,0,.08)',
            }}
          >
            Delayed
          </span>
        )}
      </div>
    </div>
  );
}
