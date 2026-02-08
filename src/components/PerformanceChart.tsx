'use client';

import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { useState } from 'react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function PerformanceChart() {
  const [period, setPeriod] = useState<'1M' | '3M' | '6M' | '1Y' | 'ALL'>('1M');

  // Sample data - replace with real historical portfolio data
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const dataValues = [100000, 102000, 101500, 105000, 107000, 106500, 110000];

  const data = {
    labels,
    datasets: [
      {
        label: 'Portfolio Value',
        data: dataValues,
        borderColor: '#00C805',
        backgroundColor: 'rgba(0, 200, 5, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#00C805',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: '#2D2D2D',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#00C805',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: function (context: any) {
            return `$${context.parsed.y.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
        ticks: {
          color: '#9CA3AF',
        },
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
        ticks: {
          color: '#9CA3AF',
          callback: function (value: any) {
            return '$' + (value / 1000).toFixed(0) + 'k';
          },
        },
      },
    },
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Performance</h2>
        <div className="flex gap-2">
          {(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? 'bg-[#00C805] text-white'
                  : 'bg-[#1E1E1E] text-gray-400 hover:bg-[#333333]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[400px]">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
