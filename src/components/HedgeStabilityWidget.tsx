'use client';

import { useState, useEffect, useRef } from 'react';
import { getHedgeForecast, type HedgeForecastData, type OptionParams } from '@/lib/pricing-api';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface HedgeStabilityWidgetProps {
  params: OptionParams;
}

export default function HedgeStabilityWidget({ params }: HedgeStabilityWidgetProps) {
  const [data, setData] = useState<HedgeForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decayChartRef = useRef<HTMLCanvasElement>(null);
  const shockChartRef = useRef<HTMLCanvasElement>(null);
  const decayChartInstance = useRef<Chart | null>(null);
  const shockChartInstance = useRef<Chart | null>(null);

  const fetchForecast = async () => {
    setLoading(true);
    setError(null);
    try {
      const forecast = await getHedgeForecast({ ...params, days: 30 });
      setData(forecast);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, [params.S, params.K, params.T, params.r, params.sigma, params.option_type]);

  useEffect(() => {
    if (!data) return;

    // Delta Decay Chart
    if (decayChartRef.current) {
      if (decayChartInstance.current) decayChartInstance.current.destroy();
      decayChartInstance.current = new Chart(decayChartRef.current, {
        type: 'line',
        data: {
          labels: data.delta_decay.days.map(d => `Day ${d}`),
          datasets: [{
            label: 'Delta',
            data: data.delta_decay.deltas,
            borderColor: '#00C805',
            backgroundColor: 'rgba(0, 200, 5, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#ccc' } },
            title: { display: true, text: 'Delta Decay Over Time', color: '#ccc' }
          },
          scales: {
            x: { ticks: { color: '#888' }, grid: { color: '#333' } },
            y: { ticks: { color: '#888' }, grid: { color: '#333' } }
          }
        }
      });
    }

    // Vol Shock Chart
    if (shockChartRef.current) {
      if (shockChartInstance.current) shockChartInstance.current.destroy();
      shockChartInstance.current = new Chart(shockChartRef.current, {
        type: 'line',
        data: {
          labels: data.vol_shock.shocks.map(s => `${(s * 100).toFixed(0)}%`),
          datasets: [{
            label: 'Delta under Vol Shock',
            data: data.vol_shock.deltas,
            borderColor: '#FFD700',
            backgroundColor: 'rgba(255, 215, 0, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#ccc' } },
            title: { display: true, text: 'Delta Sensitivity to Vol Shock', color: '#ccc' }
          },
          scales: {
            x: { title: { display: true, text: 'Vol Shock', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } },
            y: { title: { display: true, text: 'Delta', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } }
          }
        }
      });
    }

    return () => {
      if (decayChartInstance.current) decayChartInstance.current.destroy();
      if (shockChartInstance.current) shockChartInstance.current.destroy();
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6 mt-6 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="h-64 bg-gray-700 rounded"></div>
      </div>
    );
  }

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6 mt-6">
      <h3 className="text-xl font-bold mb-4">Hedge Stability Forecast</h3>

      {error && (
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Rehedge Recommendation */}
          <div className={`rounded-lg p-4 mb-4 border ${
            data.rehedge.urgency === 'high' ? 'bg-[#FF006E] bg-opacity-10 border-[#FF006E]' :
            data.rehedge.urgency === 'medium' ? 'bg-[#FFD700] bg-opacity-10 border-[#FFD700]' :
            'bg-[#00C805] bg-opacity-10 border-[#00C805]'
          }`}>
            <p className="font-bold mb-1">Rehedge Frequency: {data.rehedge.frequency}</p>
            <p className="text-sm text-gray-300">
              Gamma: {data.rehedge.gamma.toFixed(4)} | Days to expiry: {data.rehedge.days_to_expiry}
            </p>
            {data.vol_shock.deltas.length > 0 && (
              <p className="text-sm text-gray-300 mt-1">
                If IV spikes 10%, delta changes by {(
                  data.vol_shock.deltas[data.vol_shock.shocks.indexOf(0.1)] - data.vol_shock.current_delta
                ).toFixed(4)}
              </p>
            )}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <canvas ref={decayChartRef}></canvas>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <canvas ref={shockChartRef}></canvas>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
