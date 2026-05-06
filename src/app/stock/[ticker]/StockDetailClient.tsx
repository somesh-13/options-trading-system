'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import StockPriceChart from '@/components/charts/StockPriceChart';
import MispricingDetector from '@/components/MispricingDetector';
import DCFValuation from '@/components/DCFValuation';
import FinancialsTabs from '@/components/financials/FinancialsTabs';
import { PanelHost } from '@/components/ui/PanelHost';
import { AddPanelButton } from '@/components/ui/AddPanelButton';
import { usePanelLayout } from '@/lib/usePanelLayout';
import {
  STOCK_OVERVIEW_PANELS,
  DEFAULT_OVERVIEW_LAYOUT,
  type StockOverviewContext,
} from './panels';
import IRFilingsPanel from '@/components/IRFilingsPanel';
import { EarningsAIPanel } from '@/components/EarningsAIPanel';
import RegimeShiftPanel from '@/components/scanner/RegimeShiftPanel';
import { StockPositionCard } from '@/components/robinhood/StockPositionCard';
import { EquityTradePanel } from '@/components/robinhood/EquityTradePanel';
import type { HistoricalDataPoint, TimeRange } from '@/lib/types/historicalPrice';

const Icon = {
  ArrowLeft:      () => <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>←</span>,
  TrendingUp:     ({ color }: { color: string }) => <span aria-hidden style={{ fontSize: 20, lineHeight: 1, color }}>↗</span>,
  TrendingDown:   ({ color }: { color: string }) => <span aria-hidden style={{ fontSize: 20, lineHeight: 1, color }}>↘</span>,
  BarChart3:      ({ size = 14 }: { size?: number }) => <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>▦</span>,
  LineChart:      ({ size = 14 }: { size?: number }) => <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>⎍</span>,
};

type TabType = 'overview' | 'financials' | 'dcf' | 'regime-shift' | 'earnings-ir';

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

  // Layout hooks must run on every render — keep above the early returns.
  const overviewMain = usePanelLayout(
    'stock-detail',
    'overview-main',
    [...DEFAULT_OVERVIEW_LAYOUT.main],
  );
  const overviewSidebar = usePanelLayout(
    'stock-detail',
    'overview-sidebar',
    [...DEFAULT_OVERVIEW_LAYOUT.sidebar],
  );

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

  const panelCtx: StockOverviewContext = { stockData, isPositive, changeColor };

  const renderPanel = (
    panelId: string,
    layout: ReturnType<typeof usePanelLayout>,
  ) => {
    const def = STOCK_OVERVIEW_PANELS[panelId];
    if (!def) return null;
    const idx = layout.visible.indexOf(panelId);
    return (
      <PanelHost
        key={panelId}
        cardId={`stock-detail:${panelId}`}
        onRemove={() => layout.removePanel(panelId)}
        onMoveUp={() => layout.movePanel(panelId, 'up')}
        onMoveDown={() => layout.movePanel(panelId, 'down')}
        canMoveUp={idx > 0}
        canMoveDown={idx >= 0 && idx < layout.visible.length - 1}
      >
        {def.body(panelCtx)}
      </PanelHost>
    );
  };

  return (
    <div className="rv-stock-detail" style={{ padding: '18px 22px' }}>
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
        {(['overview', 'financials', 'dcf', 'regime-shift', 'earnings-ir'] as TabType[]).map((tab) => (
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
            {tab === 'dcf'
              ? 'DCF Valuation'
              : tab === 'financials'
                ? 'Financials'
                : tab === 'regime-shift'
                  ? 'Regime Shift'
                  : tab === 'earnings-ir'
                    ? 'Earnings & IR'
                    : 'Overview'}
          </button>
        ))}
      </div>

      {/* Position + Trade row — Overview only. Other tabs (Financials / DCF /
          Regime Shift / Earnings & IR) are analytical views; the trade panels
          are noise there and waste vertical space. */}
      {activeTab === 'overview' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 14,
            alignItems: 'start',
            marginBottom: 14,
          }}
        >
          <StockPositionCard ticker={ticker} />
          <EquityTradePanel equities={[]} lockedSymbol={stockData.ticker} />
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="rv-stock-overview">
          {/* Main column */}
          <div>
            {/* Customisable panels (price-overview etc.) */}
            {overviewMain.visible.map((id) => renderPanel(id, overviewMain))}
            <AddPanelButton
              hidden={overviewMain.hidden.map((id) => ({
                id,
                title: STOCK_OVERVIEW_PANELS[id]?.title ?? id,
              }))}
              onAdd={overviewMain.restorePanel}
            />

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
          </div>

          {/* Sidebar */}
          <div>
            {overviewSidebar.visible.map((id) => renderPanel(id, overviewSidebar))}
            <AddPanelButton
              hidden={overviewSidebar.hidden.map((id) => ({
                id,
                title: STOCK_OVERVIEW_PANELS[id]?.title ?? id,
              }))}
              onAdd={overviewSidebar.restorePanel}
            />
          </div>
        </div>
      )}

      {activeTab === 'financials' && (
        <FinancialsTabs ticker={stockData.ticker} />
      )}

      {activeTab === 'dcf' && (
        <DCFValuation
          ticker={stockData.ticker}
          currentPrice={stockData.price}
          companyName={stockData.name}
          fundamentals={stockData.fundamentals}
        />
      )}

      {activeTab === 'regime-shift' && (
        <RegimeShiftPanel ticker={stockData.ticker} />
      )}

      {activeTab === 'earnings-ir' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <EarningsAIPanel ticker={stockData.ticker} />
          <IRFilingsPanel ticker={stockData.ticker} />
        </div>
      )}
    </div>
  );
}

