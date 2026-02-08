'use client';

import { useState, useEffect, useRef } from 'react';
import { getPnLAttribution, type PnLAttributionData } from '@/lib/pricing-api';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface GreeksPnLChartProps {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  option_type: 'call' | 'put';
  qty?: number;
}

export default function GreeksPnLChart({
  S = 100, K = 100, T = 0.25, r = 0.05, sigma = 0.3,
  option_type = 'call', qty = 1
}: GreeksPnLChartProps) {
  const [deltaS, setDeltaS] = useState(1.0);
  const [deltaSigma, setDeltaSigma] = useState(0.01);
  const [deltaT, setDeltaT] = useState(1.0);
  const [data, setData] = useState<PnLAttributionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  const fetchAttribution = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPnLAttribution({
        S, K, T, r, sigma, option_type, qty,
        delta_S: deltaS, delta_sigma: deltaSigma, delta_t: deltaT
      });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttribution();
  }, [S, K, T, r, sigma, option_type, qty, deltaS, deltaSigma, deltaT]);

  useEffect(() => {
    if (!data || !chartRef.current) return;

    if (chartInstance.current) chartInstance.current.destroy();

    const a = data.attribution;
    const labels = ['Delta', 'Gamma', 'Vega', 'Theta', 'Vanna', 'Charm'];
    const values = [
      a.delta_pnl || 0,
      a.gamma_pnl || 0,
      a.vega_pnl || 0,
      a.theta_pnl || 0,
      a.vanna_pnl || 0,
      a.charm_pnl || 0
    ];
    const colors = ['#00C805', '#FFD700', '#FF006E', '#4488FF', '#888888', '#AA66CC'];

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'P&L Contribution ($)',
          data: values,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'P&L Attribution by Greek', color: '#ccc' }
        },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#333' } },
          y: { ticks: { color: '#888' }, grid: { color: '#333' }, title: { display: true, text: 'P&L ($)', color: '#888' } }
        }
      }
    });

    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
    };
  }, [data]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Greeks P&L Attribution</h3>

      {/* Scenario Inputs */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Spot Change ($)</label>
          <input
            type="number"
            step="0.5"
            value={deltaS}
            onChange={(e) => setDeltaS(parseFloat(e.target.value) || 0)}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Vol Change (abs)</label>
          <input
            type="number"
            step="0.01"
            value={deltaSigma}
            onChange={(e) => setDeltaSigma(parseFloat(e.target.value) || 0)}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Days Passed</label>
          <input
            type="number"
            step="1"
            value={deltaT}
            onChange={(e) => setDeltaT(parseFloat(e.target.value) || 0)}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
      </div>

      {error && (
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="bg-[#1E1E1E] rounded-lg p-4 mb-4">
            <canvas ref={chartRef}></canvas>
          </div>

          {/* Summary Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-400">Total P&L</p>
              <p className={`text-xl font-bold ${(data.attribution.total_pnl || 0) >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                ${(data.attribution.total_pnl || 0).toFixed(2)}
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-400">Delta P&L</p>
              <p className="text-lg font-bold">${(data.attribution.delta_pnl || 0).toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-400">Theta P&L</p>
              <p className="text-lg font-bold">${(data.attribution.theta_pnl || 0).toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-400">Vega P&L</p>
              <p className="text-lg font-bold">${(data.attribution.vega_pnl || 0).toFixed(2)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
