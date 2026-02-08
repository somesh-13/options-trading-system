'use client';

import { useState, useEffect, useRef } from 'react';
import { runStressTest, type StressTestResult } from '@/lib/pricing-api';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export default function StressTestPanel() {
  const [spotShock, setSpotShock] = useState(0);
  const [volShock, setVolShock] = useState(0);
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heatmapData, setHeatmapData] = useState<{labels: string[], datasets: {label: string, data: number[], backgroundColor: string}[]} | null>(null);
  const heatmapRef = useRef<HTMLCanvasElement>(null);
  const heatmapInstance = useRef<Chart | null>(null);

  // Default sample positions for demo
  const samplePositions = [
    { S: 15.50, K: 16, T: 0.0822, r: 0.05, sigma: 0.8, option_type: 'call', qty: 10 },
    { S: 15.50, K: 15, T: 0.0822, r: 0.05, sigma: 0.8, option_type: 'put', qty: -5 },
  ];

  const handleStressTest = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await runStressTest(samplePositions, spotShock / 100, volShock / 100);
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  // Generate heatmap data
  const generateHeatmap = async () => {
    const spotShocks = [-30, -20, -10, 0, 10, 20, 30];
    const volShocks = [-30, -20, -10, 0, 10, 20, 30];
    const results: number[][] = [];

    for (const vs of volShocks) {
      const row: number[] = [];
      for (const ss of spotShocks) {
        try {
          const res = await runStressTest(samplePositions, ss / 100, vs / 100);
          row.push(res.total_pnl);
        } catch {
          row.push(0);
        }
      }
      results.push(row);
    }

    // Create bar chart datasets for the heatmap approximation
    const datasets = volShocks.map((vs, i) => ({
      label: `Vol ${vs}%`,
      data: results[i],
      backgroundColor: vs < 0 ? '#00C805' : vs === 0 ? '#FFD700' : '#FF006E'
    }));

    setHeatmapData({ labels: spotShocks.map(s => `${s}%`), datasets });
  };

  useEffect(() => {
    if (!heatmapData || !heatmapRef.current) return;

    if (heatmapInstance.current) heatmapInstance.current.destroy();

    heatmapInstance.current = new Chart(heatmapRef.current, {
      type: 'bar',
      data: {
        labels: heatmapData.labels,
        datasets: heatmapData.datasets,
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#ccc' } },
          title: { display: true, text: 'P&L Heatmap (Spot vs Vol Shocks)', color: '#ccc' }
        },
        scales: {
          x: { title: { display: true, text: 'Spot Shock', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } },
          y: { title: { display: true, text: 'P&L ($)', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#333' } }
        }
      }
    });

    return () => {
      if (heatmapInstance.current) heatmapInstance.current.destroy();
    };
  }, [heatmapData]);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Stress Test Panel</h3>

      {/* Sliders */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Spot Shock: <span className={`font-bold ${spotShock >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>{spotShock}%</span>
          </label>
          <input
            type="range"
            min="-50"
            max="50"
            value={spotShock}
            onChange={(e) => setSpotShock(parseInt(e.target.value))}
            className="w-full accent-[#00C805]"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>-50%</span><span>0%</span><span>+50%</span>
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Vol Shock: <span className={`font-bold ${volShock >= 0 ? 'text-[#FFD700]' : 'text-[#00C805]'}`}>{volShock}%</span>
          </label>
          <input
            type="range"
            min="-50"
            max="50"
            value={volShock}
            onChange={(e) => setVolShock(parseInt(e.target.value))}
            className="w-full accent-[#FFD700]"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>-50%</span><span>0%</span><span>+50%</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <button
          onClick={handleStressTest}
          disabled={loading}
          className="flex-1 px-6 py-3 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Stress Test'}
        </button>
        <button
          onClick={generateHeatmap}
          className="px-6 py-3 bg-[#FFD700] hover:bg-[#E6C200] text-black font-bold rounded-lg transition-colors"
        >
          Generate Heatmap
        </button>
      </div>

      {error && (
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className={`rounded-lg p-4 ${result.total_pnl >= 0 ? 'bg-[#00C805] bg-opacity-10' : 'bg-[#FF006E] bg-opacity-10'}`}>
            <p className="text-sm text-gray-400">Portfolio P&L under stress</p>
            <p className={`text-3xl font-bold ${result.total_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
              ${result.total_pnl.toFixed(2)}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              Spot: {(result.spot_shock_pct * 100).toFixed(0)}% | Vol: {(result.vol_shock_pct * 100).toFixed(0)}%
            </p>
          </div>

          {/* Position Details */}
          {result.positions.map((pos, i) => (
            <div key={i} className="bg-[#1E1E1E] rounded-lg p-4">
              <div className="flex justify-between mb-2">
                <span className="font-bold">Position {i + 1} ({pos.qty > 0 ? 'Long' : 'Short'} {Math.abs(pos.qty)}x)</span>
                <span className={`font-bold ${pos.pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                  ${pos.pnl.toFixed(2)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-400">Current Price:</span> ${pos.current.price.toFixed(4)}
                </div>
                <div>
                  <span className="text-gray-400">Stressed Price:</span> ${pos.stressed.price.toFixed(4)}
                </div>
                <div>
                  <span className="text-gray-400">Current Delta:</span> {pos.current.greeks.delta?.toFixed(4)}
                </div>
                <div>
                  <span className="text-gray-400">Stressed Delta:</span> {pos.stressed.greeks.delta?.toFixed(4)}
                </div>
              </div>
            </div>
          ))}

          {/* Attribution */}
          {result.total_attribution && (
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <h4 className="font-bold mb-2">P&L Attribution</h4>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {Object.entries(result.total_attribution).filter(([k]) => k !== 'total_pnl').map(([key, value]) => (
                  <div key={key} className="text-center">
                    <p className="text-xs text-gray-400">{key.replace('_pnl', '')}</p>
                    <p className={`font-bold ${value >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                      ${value.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Heatmap */}
      {heatmapData && (
        <div className="mt-6 bg-[#1E1E1E] rounded-lg p-4">
          <canvas ref={heatmapRef}></canvas>
        </div>
      )}
    </div>
  );
}
