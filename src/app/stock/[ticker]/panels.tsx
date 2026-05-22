'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import QuoteSummary from '@/components/QuoteSummary';

/**
 * Stock-detail Overview panel registry.
 *
 * Each entry is the body of one rv-card (PanelHost provides the wrapper). The
 * `body(ctx)` closure receives a frozen context object holding the parent's
 * state — keeps the registry free of internal helpers from StockDetailClient
 * so it stays portable.
 *
 * Adding a panel:
 *   1. Add a new entry to STOCK_OVERVIEW_PANELS keyed by a stable id.
 *   2. Append the id to a default layout in DEFAULT_OVERVIEW_LAYOUT.
 * The layout hook auto-appends new ids to existing users' visible lists, so
 * shipping a new panel won't strand it for anyone.
 */

interface StockData {
  ticker: string;
  price: number;
  change: number;
  open: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  marketCap: string;
  pe?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  avgVolume?: number | null;
  lastUpdated: string;
}

export interface StockOverviewContext {
  stockData: StockData;
  isPositive: boolean;
  changeColor: string;
}

export interface StockPanelDef {
  id: string;
  title: string;
  body: (ctx: StockOverviewContext) => ReactNode;
}

const Icons = {
  BarChart3: ({ size = 14 }: { size?: number }) => (
    <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>▦</span>
  ),
  LineChart: ({ size = 14 }: { size?: number }) => (
    <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>⎍</span>
  ),
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '6px 0',
        borderBottom: '1px solid var(--line-soft)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--ink-mute)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          color: 'var(--ink)',
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export const STOCK_OVERVIEW_PANELS: Record<string, StockPanelDef> = {
  'price-overview': {
    id: 'price-overview',
    title: 'Current Price',
    body: ({ stockData }) => {
      // Reconstruct percent from absolute change since panels.tsx receives a
      // narrower StockData shape than the parent's full record.
      const prev = stockData.previousClose || stockData.price - stockData.change;
      const changePercent = prev > 0 ? (stockData.change / prev) * 100 : 0;
      return (
        <QuoteSummary
          variant="embedded"
          price={stockData.price}
          change={stockData.change}
          changePercent={changePercent}
          lastUpdated={stockData.lastUpdated}
        />
      );
    },
  },

  'key-statistics': {
    id: 'key-statistics',
    title: 'Key Statistics',
    body: ({ stockData }) => (
      <>
        <div className="rv-card-head">
          <h3>KEY STATISTICS</h3>
        </div>
        <StatRow label="Open" value={`$${stockData.open.toFixed(2)}`} />
        <StatRow label="Previous Close" value={`$${stockData.previousClose.toFixed(2)}`} />
        <StatRow label="Day High" value={`$${stockData.dayHigh.toFixed(2)}`} />
        <StatRow label="Day Low" value={`$${stockData.dayLow.toFixed(2)}`} />
        {stockData.yearHigh != null && (
          <StatRow label="52W High" value={`$${stockData.yearHigh.toFixed(2)}`} />
        )}
        {stockData.yearLow != null && (
          <StatRow label="52W Low" value={`$${stockData.yearLow.toFixed(2)}`} />
        )}
      </>
    ),
  },

  'trading-info': {
    id: 'trading-info',
    title: 'Trading Info',
    body: ({ stockData }) => (
      <>
        <div className="rv-card-head">
          <h3>TRADING INFO</h3>
        </div>
        <StatRow label="Volume" value={stockData.volume.toLocaleString()} />
        {stockData.avgVolume != null && (
          <StatRow label="Avg Volume" value={stockData.avgVolume.toLocaleString()} />
        )}
        <StatRow label="Market Cap" value={stockData.marketCap} />
        {stockData.pe != null && <StatRow label="P/E Ratio" value={stockData.pe.toFixed(2)} />}
      </>
    ),
  },

  'quick-actions': {
    id: 'quick-actions',
    title: 'Quick Actions',
    body: ({ stockData }) => (
      <>
        <div className="rv-card-head">
          <h3>QUICK ACTIONS</h3>
        </div>
        <Link
          href={`/options-chain?ticker=${stockData.ticker}`}
          className="rv-btn"
          prefetch
          style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 8 }}
        >
          <Icons.LineChart /> Options Chain →
        </Link>
        <Link
          href={`/pricing?ticker=${stockData.ticker}`}
          className="rv-btn"
          prefetch
          style={{ width: '100%', justifyContent: 'flex-start' }}
        >
          <Icons.BarChart3 /> Pricing Calculator →
        </Link>
      </>
    ),
  },
};

export const DEFAULT_OVERVIEW_LAYOUT = {
  /** Customisable panels in the main column (above the externally-rendered
   *  chart / mispricing / IR-filings sections). */
  main: ['price-overview'],
  /** Customisable panels in the sidebar column. */
  sidebar: ['key-statistics', 'trading-info', 'quick-actions'],
} as const;

export type OverviewSection = keyof typeof DEFAULT_OVERVIEW_LAYOUT;
