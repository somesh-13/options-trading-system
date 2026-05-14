'use client';

import { useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  ChartData,
  TooltipItem,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import type { HistoricalDataPoint, TimeRange } from '@/lib/types/historicalPrice';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Title,
  Tooltip,
  Legend,
);

type ChartStyle = 'line' | 'candles';
type Interval = 'hourly' | 'daily' | 'weekly' | 'monthly';

interface StockPriceChartProps {
  ticker: string;
  data: HistoricalDataPoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  /** Optional initial chart style. Defaults to candles. */
  initialChartStyle?: ChartStyle;
  /** When true, render the loading skeleton instead of a chart. */
  loading?: boolean;
}

const TIME_RANGE_OPTIONS: { label: string; value: TimeRange }[] = [
  { label: '1D', value: '1D' },
  { label: '5D', value: '5D' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '2Y', value: '2Y' },
  { label: '5Y', value: '5Y' },
];

const CHART_STYLE_OPTIONS: { label: string; value: ChartStyle }[] = [
  { label: 'Line', value: 'line' },
  { label: 'Candles', value: 'candles' },
];

const INTERVAL_OPTIONS: { label: string; value: Interval }[] = [
  { label: 'H', value: 'hourly' },
  { label: 'D', value: 'daily' },
  { label: 'W', value: 'weekly' },
  { label: 'M', value: 'monthly' },
];

const UP_COLOR = 'rgb(0, 200, 5)';
const DOWN_COLOR = 'rgb(255, 0, 110)';
const WICK_COLOR = 'rgba(190, 190, 200, 0.95)';

/** ISO-week key (YYYY-Www) for grouping. Monday-week. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function hourKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
}

/**
 * Aggregate raw daily candles into the requested interval bucket.
 * - 'daily' is a passthrough.
 * - 'hourly' only meaningfully aggregates intraday data; with daily candles
 *   this is also a passthrough so the user still sees a chart instead of an
 *   empty plot area.
 */
function aggregate(data: HistoricalDataPoint[], interval: Interval): HistoricalDataPoint[] {
  if (interval === 'daily' || data.length === 0) return data;

  const keyer =
    interval === 'weekly' ? isoWeekKey :
    interval === 'monthly' ? monthKey :
    hourKey;

  // Detect whether we actually have intraday data; if not, hourly degrades to
  // the original (daily) candles so the chart still renders.
  if (interval === 'hourly') {
    const sample = data.slice(0, Math.min(10, data.length));
    const allMidnight = sample.every((p) => {
      const d = new Date(p.timestamp);
      return d.getHours() === 0 && d.getMinutes() === 0;
    });
    if (allMidnight) return data;
  }

  const buckets = new Map<string, HistoricalDataPoint[]>();
  for (const p of data) {
    const k = keyer(new Date(p.timestamp));
    const arr = buckets.get(k);
    if (arr) arr.push(p);
    else buckets.set(k, [p]);
  }

  const out: HistoricalDataPoint[] = [];
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp);
    const first = arr[0];
    const last = arr[arr.length - 1];
    out.push({
      timestamp: last.timestamp,
      date: last.date,
      open: first.open,
      close: last.close,
      high: Math.max(...arr.map((x) => x.high)),
      low: Math.min(...arr.map((x) => x.low)),
      volume: arr.reduce((s, x) => s + x.volume, 0),
    });
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

function formatTickLabel(ts: number, range: TimeRange, interval: Interval): string {
  const d = new Date(ts);
  if (range === '1D' && interval === 'hourly') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (interval === 'monthly') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  if (range === '1D') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (range === '5D' || range === '1M' || range === '3M') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (range === '6M' || range === '1Y') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { year: 'numeric' });
}

/** Segmented control — single button. 36px hit area, clear active state. */
function SegButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        position: 'relative',
        minWidth: 38,
        height: 36,
        padding: '0 12px',
        border: '1px solid transparent',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? '#0c0d10' : 'var(--ink-mute)',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        fontFamily: 'var(--font-jetbrains-mono), monospace',
        letterSpacing: '0.02em',
        borderRadius: 6,
        cursor: 'pointer',
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background 0.12s ease-out, color 0.12s ease-out',
        zIndex: 1,
      }}
    >
      <span style={{ position: 'relative', zIndex: 2 }}>{children}</span>
    </button>
  );
}

function SegmentedControl({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        border: '1px solid var(--line)',
        background: '#0c0d10',
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

export default function StockPriceChart({
  ticker,
  data,
  timeRange,
  onTimeRangeChange,
  initialChartStyle = 'candles',
  loading = false,
}: StockPriceChartProps) {
  const [chartStyle, setChartStyle] = useState<ChartStyle>(initialChartStyle);
  const [interval, setInterval] = useState<Interval>('daily');

  const aggregated = useMemo(() => aggregate(data, interval), [data, interval]);

  const firstPrice = aggregated.length > 0 ? aggregated[0].close : 0;
  const lastPrice = aggregated.length > 0 ? aggregated[aggregated.length - 1].close : 0;
  const isPositive = lastPrice >= firstPrice;
  const changePercent = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const rangeColor = isPositive ? 'var(--green)' : 'var(--pink)';

  const labels = aggregated.map((p) => formatTickLabel(p.timestamp, timeRange, interval));

  const chartData = useMemo<ChartData<'bar' | 'line', Array<number | [number, number] | null>, string>>(() => {
    if (chartStyle === 'line') {
      const closes = aggregated.map((p) => p.close);
      const lineColor = isPositive ? UP_COLOR : DOWN_COLOR;
      const fillColor = isPositive ? 'rgba(0, 200, 5, 0.10)' : 'rgba(255, 0, 110, 0.10)';
      return {
        labels,
        datasets: [
          {
            type: 'line' as const,
            label: 'close',
            data: closes,
            borderColor: lineColor,
            backgroundColor: fillColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: lineColor,
            pointHoverBorderColor: '#0c0d10',
            pointHoverBorderWidth: 2,
            fill: true,
            tension: 0.18,
          },
        ],
      };
    }

    // candles
    const bodyColors = aggregated.map((p) => (p.close >= p.open ? UP_COLOR : DOWN_COLOR));
    const volumeColor = 'rgba(140, 142, 156, 0.32)';
    const wickData: [number, number][] = aggregated.map((p) => [p.low, p.high]);
    const bodyData: [number, number][] = aggregated.map((p) => [
      Math.min(p.open, p.close),
      Math.max(p.open, p.close),
    ]);
    const volumeData = aggregated.map((p) => p.volume);

    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'volume',
          data: volumeData,
          backgroundColor: volumeColor,
          borderColor: volumeColor,
          borderWidth: 0,
          barPercentage: 0.55,
          categoryPercentage: 1,
          grouped: false,
          yAxisID: 'yVol',
          order: 2,
        },
        {
          type: 'bar' as const,
          label: 'wick',
          data: wickData,
          backgroundColor: WICK_COLOR,
          borderColor: WICK_COLOR,
          borderWidth: 0,
          barPercentage: 0.15,
          categoryPercentage: 1,
          grouped: false,
          order: 1,
        },
        {
          type: 'bar' as const,
          label: 'body',
          data: bodyData,
          backgroundColor: bodyColors,
          borderColor: bodyColors,
          borderWidth: 1,
          barPercentage: 0.55,
          categoryPercentage: 1,
          grouped: false,
          order: 0,
        },
      ],
    };
  }, [chartStyle, aggregated, labels, isPositive]);

  const maxVolume = useMemo(
    () => (aggregated.length > 0 ? Math.max(...aggregated.map((p) => p.volume), 1) : 1),
    [aggregated],
  );

  const options = useMemo<ChartOptions<'bar' | 'line'>>(() => {
    const base: ChartOptions<'bar' | 'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          backgroundColor: '#0c0d10',
          titleColor: '#e8e8ea',
          bodyColor: '#e8e8ea',
          borderColor: '#26272d',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          displayColors: false,
          titleFont: { family: 'JetBrains Mono, monospace', size: 11 },
          bodyFont: { family: 'JetBrains Mono, monospace', size: 11 },
          // Suppress duplicate items when in candles mode.
          filter: (item) =>
            chartStyle === 'line' ? true : item.dataset.label === 'body',
          callbacks: {
            title: (items: TooltipItem<'bar' | 'line'>[]) => {
              const dp = aggregated[items[0].dataIndex];
              if (!dp) return '';
              const d = new Date(dp.timestamp);
              return d.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: timeRange === '1D' || interval === 'hourly' ? 'numeric' : undefined,
                minute: timeRange === '1D' || interval === 'hourly' ? '2-digit' : undefined,
              });
            },
            label: (item: TooltipItem<'bar' | 'line'>) => {
              const dp = aggregated[item.dataIndex];
              if (!dp) return '';
              const change = dp.close - dp.open;
              const pct = dp.open > 0 ? (change / dp.open) * 100 : 0;
              const sign = change >= 0 ? '+' : '';
              return [
                `Open   $${dp.open.toFixed(2)}`,
                `High   $${dp.high.toFixed(2)}`,
                `Low    $${dp.low.toFixed(2)}`,
                `Close  $${dp.close.toFixed(2)}  (${sign}${change.toFixed(2)} / ${sign}${pct.toFixed(2)}%)`,
                `Vol    ${dp.volume.toLocaleString()}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#6b6b72',
            maxTicksLimit: 8,
            autoSkip: true,
            font: { family: 'JetBrains Mono, monospace', size: 10 },
          },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(38, 39, 45, 0.45)', drawTicks: false },
          border: { display: false },
          ticks: {
            color: '#6b6b72',
            font: { family: 'JetBrains Mono, monospace', size: 10 },
            padding: 8,
            callback: (value) => '$' + Number(value).toFixed(2),
          },
        },
      },
    };

    if (chartStyle === 'candles') {
      base.scales = {
        ...base.scales,
        // Hidden secondary axis for volume bars
        yVol: {
          type: 'linear',
          display: false,
          position: 'left',
          beginAtZero: true,
          max: maxVolume * 6,
          grid: { display: false },
        },
      };
    }
    return base;
  }, [chartStyle, aggregated, timeRange, interval, maxVolume]);

  // ---- card chrome ---------------------------------------------------------

  const subtitle = `${ticker} · ${timeRange}`;

  const headerLeft = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <h3
        className="rv-card-head-title"
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          letterSpacing: '0.01em',
          textTransform: 'none',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        Price chart
      </h3>
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-mute)',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '0.04em',
        }}
      >
        {subtitle}
      </span>
    </div>
  );

  const performanceBadge = (
    <span
      className="rv-pill"
      style={{
        color: isPositive ? 'var(--green)' : 'var(--pink)',
        borderColor: isPositive ? 'rgba(0,200,5,.35)' : 'rgba(255,0,110,.35)',
        background: isPositive ? 'rgba(0,200,5,.08)' : 'rgba(255,0,110,.08)',
        fontWeight: 600,
        padding: '4px 10px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {isPositive ? '+' : ''}
      {changePercent.toFixed(2)}%
    </span>
  );

  // ---- empty / loading -----------------------------------------------------

  const cardStyle: React.CSSProperties = {
    // Reserve enough vertical space so re-loads don't shift the page.
    minHeight: 460,
  };

  if (loading) {
    return (
      <div className="rv-card" style={cardStyle}>
        <div
          className="rv-card-head"
          style={{ alignItems: 'flex-start', gap: 12 }}
        >
          {headerLeft}
        </div>
        <div
          style={{
            minHeight: 320,
            borderRadius: 8,
            background:
              'linear-gradient(90deg, rgba(38,39,45,.25) 0%, rgba(38,39,45,.55) 50%, rgba(38,39,45,.25) 100%)',
            backgroundSize: '200% 100%',
            animation: 'rv-shimmer 1.4s linear infinite',
          }}
        />
        <style>{`@keyframes rv-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
    );
  }

  if (aggregated.length === 0) {
    return (
      <div className="rv-card" style={cardStyle}>
        <div
          className="rv-card-head"
          style={{ alignItems: 'flex-start', gap: 12 }}
        >
          {headerLeft}
        </div>
        <div
          style={{
            minHeight: 320,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-mute)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            border: '1px dashed var(--line)',
            borderRadius: 8,
          }}
        >
          No historical data available for this range
        </div>
      </div>
    );
  }

  // ---- render --------------------------------------------------------------

  const lowest = Math.min(...aggregated.map((d) => d.low));
  const highest = Math.max(...aggregated.map((d) => d.high));
  const priceChange = lastPrice - firstPrice;
  const spanLabel = `${priceChange >= 0 ? '+' : '−'}$${Math.abs(priceChange).toFixed(2)} · ${timeRange}`;

  return (
    <div className="rv-card" style={cardStyle}>
      {/* Header: title/subtitle left, performance badge right */}
      <div
        className="rv-card-head"
        style={{ alignItems: 'flex-start', gap: 12, marginBottom: 14 }}
      >
        {headerLeft}
        {performanceBadge}
      </div>

      {/* Controls row: timeframe + chart-style + interval */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <SegmentedControl ariaLabel="Timeframe">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <SegButton
              key={opt.value}
              active={timeRange === opt.value}
              onClick={() => onTimeRangeChange(opt.value)}
            >
              {opt.label}
            </SegButton>
          ))}
        </SegmentedControl>

        <SegmentedControl ariaLabel="Chart style">
          {CHART_STYLE_OPTIONS.map((opt) => (
            <SegButton
              key={opt.value}
              active={chartStyle === opt.value}
              onClick={() => setChartStyle(opt.value)}
            >
              {opt.label}
            </SegButton>
          ))}
        </SegmentedControl>

        <SegmentedControl ariaLabel="Interval">
          {INTERVAL_OPTIONS.map((opt) => (
            <SegButton
              key={opt.value}
              active={interval === opt.value}
              onClick={() => setInterval(opt.value)}
              title={`${opt.value.charAt(0).toUpperCase()}${opt.value.slice(1)}`}
            >
              {opt.label}
            </SegButton>
          ))}
        </SegmentedControl>
      </div>

      {/* Plot area — responsive, fixed min-height */}
      <div className="rv-chart-plot">
        <Chart type={chartStyle === 'line' ? 'line' : 'bar'} data={chartData} options={options} />
      </div>

      {/* Footer: range only */}
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          color: 'var(--ink-mute)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>
          Range{' '}
          <span style={{ color: 'var(--ink-dim)' }}>
            ${lowest.toFixed(2)} — ${highest.toFixed(2)}
          </span>
        </span>
        <span style={{ color: rangeColor, fontWeight: 600 }}>
          {spanLabel}
        </span>
      </div>

      <style>{`
        .rv-chart-plot { height: 320px; }
        @media (max-width: 720px) {
          .rv-chart-plot { height: 260px; }
        }
      `}</style>
    </div>
  );
}
