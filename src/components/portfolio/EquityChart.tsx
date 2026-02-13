'use client';

import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { EquityHistoryResponse } from '@/lib/pricing-api';

Chart.register(...registerables);

interface EquityChartProps {
  data: EquityHistoryResponse | null;
  period: string;
  onPeriodChange: (period: string) => void;
  loading: boolean;
}

const PERIODS = ['1D', '1W', '1M', '3M', '1A'];

export default function EquityChart({ data, period, onPeriodChange, loading }: EquityChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!data || !chartRef.current) return;

    if (chartInstance.current) chartInstance.current.destroy();

    const timestamps = data.timestamp || [];
    const equity = data.equity || [];

    const labels = timestamps.map((ts: number) => {
      const d = new Date(ts * 1000);
      return period === '1D'
        ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const ctx = chartRef.current.getContext('2d');
    let gradient: CanvasGradient | undefined;
    if (ctx) {
      gradient = ctx.createLinearGradient(0, 0, 0, 300);
      gradient.addColorStop(0, 'rgba(0, 200, 5, 0.3)');
      gradient.addColorStop(1, 'rgba(0, 200, 5, 0.0)');
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Equity',
          data: equity,
          borderColor: '#00C805',
          backgroundColor: gradient || 'rgba(0, 200, 5, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `$${(ctx.raw as number)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888', maxTicksLimit: 8 },
            grid: { color: '#333' },
          },
          y: {
            ticks: {
              color: '#888',
              callback: (val) => `$${Number(val).toLocaleString()}`,
            },
            grid: { color: '#333' },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
    };
  }, [data, period]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Equity Curve</h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                period === p
                  ? 'bg-[#00C805] text-white'
                  : 'bg-[#1E1E1E] text-gray-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[300px]">
        {loading && !data ? (
          <div className="h-full bg-[#1E1E1E] rounded-lg animate-pulse" />
        ) : (
          <canvas ref={chartRef} />
        )}
      </div>
    </div>
  );
}
