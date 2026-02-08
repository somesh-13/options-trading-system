'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { getVolSurface, type VolSurfaceData } from '@/lib/pricing-api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface VolatilitySurface3DProps {
  initialTicker?: string;
}

export default function VolatilitySurface3D({ initialTicker = 'CIFR' }: VolatilitySurface3DProps) {
  const [ticker, setTicker] = useState(initialTicker);
  const [inputTicker, setInputTicker] = useState(initialTicker);
  const [data, setData] = useState<VolSurfaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSurface = async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const surface = await getVolSurface(t);
      setData(surface);
      setTicker(t);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load vol surface');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSurface(initialTicker);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      fetchSurface(inputTicker.trim().toUpperCase());
    }
  };

  // Prepare Plotly data
  const plotData = data ? [{
    type: 'surface' as const,
    x: data.strikes,
    y: data.expirations,
    z: data.iv_matrix.map(row => row.map(v => v !== null ? v * 100 : null)),
    colorscale: [
      [0, '#00C805'],
      [0.5, '#FFD700'],
      [1, '#FF006E']
    ],
    hovertemplate: 'Strike: %{x}<br>Expiry: %{y}<br>IV: %{z:.1f}%<extra></extra>',
    showscale: true,
    colorbar: {
      title: { text: 'IV %', font: { color: '#ccc' } },
      tickfont: { color: '#ccc' }
    }
  }] : [];

  const layout = {
    paper_bgcolor: '#1E1E1E',
    plot_bgcolor: '#1E1E1E',
    font: { color: '#ccc' },
    scene: {
      xaxis: { title: 'Strike', color: '#ccc', gridcolor: '#333' },
      yaxis: { title: 'Expiration', color: '#ccc', gridcolor: '#333' },
      zaxis: { title: 'IV (%)', color: '#ccc', gridcolor: '#333' },
      bgcolor: '#1E1E1E'
    },
    margin: { l: 0, r: 0, t: 30, b: 0 },
    height: 500,
    autosize: true
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">3D Volatility Surface</h2>
          <p className="text-sm text-gray-400">IV across strikes and expirations</p>
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            placeholder="Ticker"
            className="w-24 bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? '...' : 'Load'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="mb-2 text-sm text-gray-400">
            {ticker} | Spot: ${data.spot_price.toFixed(2)} | {data.expirations.length} expirations | {data.strikes.length} strikes
          </div>
          <div className="bg-[#1E1E1E] rounded-lg overflow-hidden">
            <Plot
              data={plotData}
              layout={layout}
              config={{ responsive: true, displayModeBar: true }}
              style={{ width: '100%', height: '500px' }}
            />
          </div>
        </>
      )}

      {loading && !data && (
        <div className="h-[500px] bg-[#1E1E1E] rounded-lg animate-pulse flex items-center justify-center">
          <p className="text-gray-500">Loading volatility surface...</p>
        </div>
      )}
    </div>
  );
}
