'use client';

import { useRef, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
import { PriceHistoryPoint } from '@/lib/pricing-api';

Chart.register(...registerables);

interface PriceChartProps {
  data: PriceHistoryPoint[];
  period: string;
  onPeriodChange: (period: string) => void;
}

const PERIODS = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

export default function PriceChart({ data, period, onPeriodChange }: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const closes = data.map((d) => d.close);
    const labels = data.map((d) => {
      const date = new Date(d.date);
      if (period === '1D') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });

    const isPositive = closes[closes.length - 1] >= closes[0];
    const lineColor = isPositive ? '#00C805' : '#FF006E';

    const gradient = ctx.createLinearGradient(0, 0, 0, canvasRef.current.height);
    gradient.addColorStop(0, isPositive ? 'rgba(0, 200, 5, 0.15)' : 'rgba(255, 0, 110, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: closes,
          borderColor: lineColor,
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { display: true, ticks: { maxTicksLimit: 8, color: '#666' }, grid: { display: false } },
          y: { display: true, ticks: { color: '#666' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [data, period]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 mb-4">
      <div className="flex gap-1 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
              period === p ? 'bg-[#00C805] text-white' : 'text-gray-400 hover:text-white hover:bg-[#333]'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div style={{ height: 300 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
