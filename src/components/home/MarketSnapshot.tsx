'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Live market snapshot strip for the homepage.
 *
 * Six tiles — S&P 500 index, QQQ ETF, Bitcoin, Ethereum, Gold front-month
 * futures, Crude Oil front-month futures. Sources `/api/market/{ticker}/detail`
 * which is yfinance-backed; auto-refresh every 30 s.
 */

interface TickerSpec {
  /** yfinance symbol — `^` is URL-encoded; `=` and `-` are URL-safe. */
  symbol: string;
  /** Display label shown on the tile. */
  label: string;
  /** Optional href for click-through to the stock detail page. Skip for
   *  futures/indices that don't have detail pages on the app. */
  href?: string;
}

const TICKERS: TickerSpec[] = [
  { symbol: '%5EGSPC', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'QQQ', href: '/stock/QQQ' },
  { symbol: 'BTC-USD', label: 'Bitcoin' },
  { symbol: 'ETH-USD', label: 'Ethereum' },
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: 'CL=F', label: 'Crude Oil' },
];

const REFRESH_INTERVAL_MS = 30_000;

interface Quote {
  symbol: string;
  label: string;
  href?: string;
  price: number | null;
  changePct: number | null;
  error?: string;
}

function formatPrice(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p >= 10_000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function formatChangePct(c: number | null): string {
  if (c == null || !Number.isFinite(c)) return '—';
  const sign = c >= 0 ? '+' : '';
  return `${sign}${c.toFixed(2)}%`;
}

export function MarketSnapshot() {
  const [quotes, setQuotes] = useState<Quote[]>(() =>
    TICKERS.map((t) => ({ symbol: t.symbol, label: t.label, href: t.href, price: null, changePct: null })),
  );
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOne(spec: TickerSpec): Promise<Quote> {
      try {
        const res = await fetch(`/api/market/${spec.symbol}/detail`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as { price?: number; changePercent?: number };
        return {
          symbol: spec.symbol,
          label: spec.label,
          href: spec.href,
          price: typeof d.price === 'number' ? d.price : null,
          changePct: typeof d.changePercent === 'number' ? d.changePercent : null,
        };
      } catch (err) {
        return {
          symbol: spec.symbol,
          label: spec.label,
          href: spec.href,
          price: null,
          changePct: null,
          error: err instanceof Error ? err.message : 'fetch failed',
        };
      }
    }

    async function fetchAll() {
      const results = await Promise.all(TICKERS.map(fetchOne));
      if (!cancelled) {
        setQuotes(results);
        setUpdatedAt(new Date());
      }
    }

    fetchAll();
    const id = window.setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div
      className="rv-card"
      style={{
        marginBottom: 14,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div
        className="rv-card-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--line)',
          marginBottom: 0,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-dim)' }}>
          Markets
        </h3>
        <span className="text-meta" suppressHydrationWarning>
          {updatedAt
            ? `Updated ${updatedAt.toLocaleTimeString('en-US', { hour12: false })} · refresh 30s`
            : 'Loading…'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 0,
        }}
      >
        {quotes.map((q, i) => (
          <Tile key={q.symbol} quote={q} isLast={i === quotes.length - 1} />
        ))}
      </div>
    </div>
  );
}

function Tile({ quote, isLast }: { quote: Quote; isLast: boolean }) {
  const isUp = (quote.changePct ?? 0) >= 0;
  const color = quote.changePct == null
    ? 'var(--ink-mute)'
    : isUp
      ? 'var(--green)'
      : 'var(--pink)';

  const inner = (
    <div
      style={{
        padding: '10px 14px',
        borderRight: isLast ? undefined : '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 64,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--ink-mute)',
        }}
      >
        {quote.label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--ink)',
          letterSpacing: '-0.01em',
        }}
      >
        {formatPrice(quote.price)}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: 11,
          color,
          fontWeight: 500,
        }}
      >
        {quote.error ? 'unavailable' : formatChangePct(quote.changePct)}
      </div>
    </div>
  );

  if (quote.href) {
    return (
      <Link
        href={quote.href}
        prefetch
        style={{
          textDecoration: 'none',
          color: 'inherit',
          transition: 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {inner}
      </Link>
    );
  }
  return inner;
}
