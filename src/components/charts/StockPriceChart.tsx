'use client';

import { useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  TooltipItem,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { HistoricalDataPoint, TimeRange } from '@/lib/types/historicalPrice';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

interface StockPriceChartProps {
  ticker: string;
  data: HistoricalDataPoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
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

export default function StockPriceChart({
  ticker,
  data,
  timeRange,
  onTimeRangeChange,
}: StockPriceChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  const firstPrice = data.length > 0 ? data[0].close : 0;
  const lastPrice = data.length > 0 ? data[data.length - 1].close : 0;
  const isPositive = lastPrice >= firstPrice;
  const changePercent = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  const lineColor = isPositive ? 'rgb(0, 200, 5)' : 'rgb(255, 0, 110)';
  const fillColor = isPositive ? 'rgba(0, 200, 5, 0.12)' : 'rgba(255, 0, 110, 0.12)';

  const formatTickLabel = (ts: number): string => {
    const d = new Date(ts);
    if (timeRange === '1D') {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    if (timeRange === '5D' || timeRange === '1M' || timeRange === '3M') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (timeRange === '6M' || timeRange === '1Y') {
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { year: 'numeric' });
  };

  const chartData = {
    labels: data.map((point) => formatTickLabel(point.timestamp)),
    datasets: [
      {
        label: `${ticker} Price`,
        data: data.map((point) => point.close),
        borderColor: lineColor,
        backgroundColor: fillColor,
        borderWidth: 1.5,
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
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
        cornerRadius: 4,
        displayColors: false,
        titleFont: { family: 'JetBrains Mono, monospace', size: 11 },
        bodyFont: { family: 'JetBrains Mono, monospace', size: 11 },
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => {
            const dp = data[items[0].dataIndex];
            if (!dp) return '';
            const d = new Date(dp.timestamp);
            return d.toLocaleDateString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: timeRange === '1D' ? 'numeric' : undefined,
              minute: timeRange === '1D' ? '2-digit' : undefined,
            });
          },
          label: (item: TooltipItem<'line'>) => {
            const value = item.parsed.y;
            if (value === null) return '';
            const dp = data[item.dataIndex];
            const lines = [`Close  $${value.toFixed(2)}`];
            if (dp) {
              lines.push(`Open   $${dp.open.toFixed(2)}`);
              lines.push(`High   $${dp.high.toFixed(2)}`);
              lines.push(`Low    $${dp.low.toFixed(2)}`);
              lines.push(`Vol    ${dp.volume.toLocaleString()}`);
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'category',
        grid: { display: false },
        ticks: {
          color: '#6b6b72',
          maxTicksLimit: 8,
          autoSkip: true,
          font: { family: 'JetBrains Mono, monospace', size: 10 },
        },
      },
      y: {
        position: 'right',
        grid: { color: 'rgba(38, 39, 45, 0.6)' },
        ticks: {
          color: '#6b6b72',
          font: { family: 'JetBrains Mono, monospace', size: 10 },
          callback: (value) => '$' + Number(value).toFixed(2),
        },
      },
    },
    elements: { point: { hoverRadius: 6 } },
  };

  const rangeButtons = (
    <div style={{ display: 'flex', gap: 4 }}>
      {TIME_RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onTimeRangeChange(opt.value)}
          className="rv-pill"
          style={{
            cursor: 'pointer',
            ...(timeRange === opt.value
              ? {
                  color: 'var(--ink)',
                  borderColor: 'var(--gold-dim)',
                  background: 'rgba(255,215,0,.1)',
                }
              : {}),
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (data.length === 0) {
    return (
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>{ticker} PRICE CHART</h3>
          {rangeButtons}
        </div>
        <div
          style={{
            height: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-mute)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
          }}
        >
          no data for this range
        </div>
      </div>
    );
  }

  const lowest = Math.min(...data.map((d) => d.low));
  const highest = Math.max(...data.map((d) => d.high));

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h3>{ticker} PRICE CHART</h3>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fontWeight: 600,
              color: isPositive ? 'var(--green)' : 'var(--pink)',
            }}
          >
            {isPositive ? '+' : ''}
            {changePercent.toFixed(2)}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>({timeRange})</span>
        </div>
        {rangeButtons}
      </div>

      <div style={{ height: 280 }}>
        <Line ref={chartRef} data={chartData} options={options} />
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          color: 'var(--ink-mute)',
        }}
      >
        <span>{data.length} data points</span>
        <span>
          range ${lowest.toFixed(2)} — ${highest.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
