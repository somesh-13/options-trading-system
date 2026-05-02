'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import StockPriceChart from '@/components/charts/StockPriceChart';
import MispricingDetector from '@/components/MispricingDetector';
import DCFValuation from '@/components/DCFValuation';
import { StockPositionCard } from '@/components/robinhood/StockPositionCard';
import type { HistoricalDataPoint, TimeRange } from '@/lib/types/historicalPrice';

const Icon = {
  ArrowLeft:      () => <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>←</span>,
  TrendingUp:     ({ color }: { color: string }) => <span aria-hidden style={{ fontSize: 20, lineHeight: 1, color }}>↗</span>,
  TrendingDown:   ({ color }: { color: string }) => <span aria-hidden style={{ fontSize: 20, lineHeight: 1, color }}>↘</span>,
  BarChart3:      ({ size = 14 }: { size?: number }) => <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>▦</span>,
  LineChart:      ({ size = 14 }: { size?: number }) => <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>⎍</span>,
};

type TabType = 'overview' | 'dcf';

export interface Fundamentals {
  revenue?: number | null;           // $ absolute (TTM)
  operatingMargin?: number | null;   // decimal (0.25 = 25%)
  profitMargin?: number | null;
  sharesOutstanding?: number | null; // shares
  totalDebt?: number | null;
  totalCash?: number | null;
  netDebt?: number | null;
  ebitda?: number | null;
  revenueGrowth?: number | null;     // decimal
  beta?: number | null;
}

interface StockDetailData {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
  marketCapValue?: number | null;
  dayHigh: number;
  dayLow: number;
  open: number;
  previousClose: number;
  pe?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  avgVolume?: number | null;
  lastUpdated: string;
  historicalData?: HistoricalDataPoint[];
  fundamentals?: Fundamentals;
}

interface StockDetailClientProps {
  ticker: string;
}

interface PriceHistoryResponse {
  ticker: string;
  period: string;
  interval: string;
  data: HistoricalDataPoint[];
}

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '1D': 1 * 24 * 60 * 60 * 1000,
  '5D': 5 * 24 * 60 * 60 * 1000,
  '1M': 31 * 24 * 60 * 60 * 1000,
  '3M': 93 * 24 * 60 * 60 * 1000,
  '6M': 186 * 24 * 60 * 60 * 1000,
  '1Y': 366 * 24 * 60 * 60 * 1000,
  '2Y': 2 * 366 * 24 * 60 * 60 * 1000,
  '5Y': 5 * 366 * 24 * 60 * 60 * 1000,
};

function filterByRange(data: HistoricalDataPoint[], range: TimeRange): HistoricalDataPoint[] {
  if (!data || data.length === 0) return [];
  const cutoff = Date.now() - TIME_RANGE_MS[range];
  const filtered = data.filter((p) => p.timestamp >= cutoff);
  return filtered.length > 0 ? filtered : data.slice(-Math.min(data.length, 30));
}

export default function StockDetailClient({ ticker }: StockDetailClientProps) {
  const [stockData, setStockData] = useState<StockDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [fullHistoricalData, setFullHistoricalData] = useState<HistoricalDataPoint[] | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, historyRes] = await Promise.all([
        fetch(`/api/market/${ticker}/detail`, { cache: 'no-store' }),
        fetch(`/api/market/${ticker}/price-history?period=5Y`, { cache: 'no-store' }),
      ]);

      if (!detailRes.ok) {
        throw new Error(`Detail fetch failed: ${detailRes.status}`);
      }

      const detail: StockDetailData = await detailRes.json();
      let history: HistoricalDataPoint[] = [];
      if (historyRes.ok) {
        const body = (await historyRes.json()) as PriceHistoryResponse;
        history = body.data ?? [];
      }

      setFullHistoricalData(history);
      setStockData({ ...detail, historicalData: filterByRange(history, '1M') });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStockData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    if (ticker) fetchDetail();
  }, [ticker, fetchDetail]);

  useEffect(() => {
    if (!fullHistoricalData) return;
    const filtered = filterByRange(fullHistoricalData, timeRange);
    setStockData((prev) => (prev ? { ...prev, historicalData: filtered } : prev));
  }, [timeRange, fullHistoricalData]);

  if (loading && !stockData) {
    return (
      <div style={{ padding: '18px 22px' }}>
        <div className="rv-card" style={{ height: 80, opacity: 0.6 }} />
        <div className="rv-card" style={{ height: 320, opacity: 0.6 }} />
        <div className="rv-card" style={{ height: 240, opacity: 0.6 }} />
      </div>
    );
  }

  if (error || !stockData) {
    return (
      <div style={{ padding: '18px 22px' }}>
        <div className="rv-card" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <h1 className="rv-h1" style={{ marginBottom: 8 }}>Stock not found</h1>
          <p className="rv-sub">
            {error ? error : `We couldn't load data for "${ticker}".`}
          </p>
          <Link href="/" className="rv-btn primary" prefetch>
            <Icon.ArrowLeft /> Back to Today
          </Link>
        </div>
      </div>
    );
  }

  const isPositive = stockData.changePercent >= 0;
  const changeColor = isPositive ? 'var(--green)' : 'var(--pink)';

  return (
    <div style={{ padding: '18px 22px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link href="/" className="rv-btn ghost" prefetch style={{ padding: '6px 8px' }}>
          <Icon.ArrowLeft />
        </Link>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1 }}>
          <h1 className="rv-h1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
            {stockData.ticker}
          </h1>
          <span
            className="rv-pill"
            style={{
              color: changeColor,
              borderColor: isPositive ? 'rgba(0,200,5,.35)' : 'rgba(255,0,110,.35)',
              background: isPositive ? 'rgba(0,200,5,.08)' : 'rgba(255,0,110,.08)',
              fontWeight: 600,
            }}
          >
            {isPositive ? '+' : ''}
            {stockData.changePercent.toFixed(2)}%
          </span>
          <span className="rv-sub" style={{ margin: 0 }}>
            {stockData.name}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
        {(['overview', 'dcf'] as TabType[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="rv-btn ghost"
            style={{
              borderRadius: 0,
              border: 0,
              borderBottom: activeTab === tab ? '2px solid var(--pink)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--ink)' : 'var(--ink-mute)',
              padding: '10px 14px',
              textTransform: 'capitalize',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.04em',
            }}
          >
            {tab === 'dcf' ? 'DCF Valuation' : 'Overview'}
          </button>
        ))}
      </div>

      {/* Position card — always shown, handles "no position" empty state gracefully */}
      <StockPositionCard ticker={ticker} />

      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, alignItems: 'start' }}>
          {/* Main column */}
          <div>
            {/* Price overview */}
            <div className="rv-card" style={{ marginTop: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="text-meta">CURRENT PRICE</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-jetbrains-mono), monospace',
                      fontSize: 34,
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                      color: 'var(--ink)',
                      marginTop: 4,
                    }}
                  >
                    ${stockData.price.toFixed(2)}
                  </div>
                </div>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: isPositive ? 'rgba(0,200,5,.08)' : 'rgba(255,0,110,.08)',
                    border: `1px solid ${isPositive ? 'rgba(0,200,5,.3)' : 'rgba(255,0,110,.3)'}`,
                  }}
                >
                  {isPositive ? <Icon.TrendingUp color={changeColor} /> : <Icon.TrendingDown color={changeColor} />}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'baseline' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-jetbrains-mono), monospace',
                    color: changeColor,
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  {isPositive ? '+' : ''}
                  ${stockData.change.toFixed(2)}
                </span>
                <span className="text-meta">LAST UPDATE {stockData.lastUpdated}</span>
              </div>
            </div>

            {/* Price chart */}
            {stockData.historicalData && stockData.historicalData.length > 0 ? (
              <StockPriceChart
                ticker={stockData.ticker}
                data={stockData.historicalData}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
              />
            ) : (
              <div className="rv-card">
                <div className="rv-card-head">
                  <h3>PRICE CHART</h3>
                </div>
                <div
                  style={{
                    height: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--ink-mute)',
                    gap: 6,
                  }}
                >
                  <Icon.BarChart3 size={32} />
                  <span className="text-meta">NO HISTORICAL DATA AVAILABLE</span>
                </div>
              </div>
            )}

            {/* Mispricing */}
            <div style={{ marginTop: 14 }}>
              <MispricingDetector ticker={stockData.ticker} />
            </div>

            {/* News stub */}
            <div className="rv-card">
              <div className="rv-card-head">
                <h3>LATEST NEWS</h3>
              </div>
              <div className="rv-sub" style={{ marginBottom: 0 }}>
                News feed coming soon — sentiment surfaces today on <Link href="/sentiment">/sentiment</Link>.
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            {/* Key stats */}
            <div className="rv-card" style={{ marginTop: 0 }}>
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
            </div>

            {/* Trading info */}
            <div className="rv-card">
              <div className="rv-card-head">
                <h3>TRADING INFO</h3>
              </div>
              <StatRow label="Volume" value={stockData.volume.toLocaleString()} />
              {stockData.avgVolume != null && (
                <StatRow label="Avg Volume" value={stockData.avgVolume.toLocaleString()} />
              )}
              <StatRow label="Market Cap" value={stockData.marketCap} />
              {stockData.pe != null && (
                <StatRow label="P/E Ratio" value={stockData.pe.toFixed(2)} />
              )}
            </div>

            {/* Quick actions */}
            <div className="rv-card">
              <div className="rv-card-head">
                <h3>QUICK ACTIONS</h3>
              </div>
              <Link
                href={`/options-chain?ticker=${stockData.ticker}`}
                className="rv-btn"
                prefetch
                style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 8 }}
              >
                <Icon.LineChart /> Options Chain →
              </Link>
              <Link
                href={`/pricing?ticker=${stockData.ticker}`}
                className="rv-btn"
                prefetch
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <Icon.BarChart3 /> Pricing Calculator →
              </Link>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dcf' && (
        <DCFValuation
          ticker={stockData.ticker}
          currentPrice={stockData.price}
          companyName={stockData.name}
          fundamentals={stockData.fundamentals}
        />
      )}
    </div>
  );
}

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
