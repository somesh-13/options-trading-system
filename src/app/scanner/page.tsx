'use client';

import { useState } from 'react';
import { getMispricing, type MispricingData } from '@/lib/pricing-api';
import Link from 'next/link';

interface ScanResult extends MispricingData {
  loading?: boolean;
  error?: string;
}

export default function ScannerPage() {
  const [tickers, setTickers] = useState<string[]>(['CIFR', 'MARA', 'RIOT', 'COIN']);
  const [newTicker, setNewTicker] = useState('');
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState(false);
  const [sortKey, setSortKey] = useState<'iv_hv_ratio' | 'signal' | 'spot_price' | 'implied_vol_atm'>('iv_hv_ratio');
  const [sortAsc, setSortAsc] = useState(false);

  const addTicker = (e: React.FormEvent) => {
    e.preventDefault();
    const t = newTicker.trim().toUpperCase();
    if (t && !tickers.includes(t)) {
      setTickers([...tickers, t]);
      setNewTicker('');
    }
  };

  const removeTicker = (t: string) => {
    setTickers(tickers.filter(x => x !== t));
    const newResults = { ...results };
    delete newResults[t];
    setResults(newResults);
  };

  const scanAll = async () => {
    setScanning(true);
    const newResults: Record<string, ScanResult> = {};

    await Promise.all(
      tickers.map(async (t) => {
        try {
          const data = await getMispricing(t);
          newResults[t] = data;
        } catch (err: unknown) {
          newResults[t] = {
            ticker: t,
            spot_price: 0,
            historical_vol: 0,
            implied_vol_atm: 0,
            iv_hv_ratio: 0,
            signal: 'NEUTRAL',
            expiration: '',
            atm_strike: 0,
            atm_call_price: 0,
            bid: 0,
            ask: 0,
            volume: 0,
            open_interest: 0,
            error: err instanceof Error ? err.message : 'Failed'
          };
        }
      })
    );

    setResults(newResults);
    setScanning(false);
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortedTickers = [...tickers].sort((a, b) => {
    const ra = results[a];
    const rb = results[b];
    if (!ra || !rb) return 0;
    const va = ra[sortKey] ?? 0;
    const vb = rb[sortKey] ?? 0;
    if (typeof va === 'string' && typeof vb === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });

  const signalColors: Record<string, string> = {
    'SELL': 'text-[#FFD700]',
    'BUY': 'text-[#00C805]',
    'NEUTRAL': 'text-gray-400'
  };

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">Dashboard</Link>
            <span className="text-gray-600">/</span>
            <h1 className="text-4xl font-bold">Multi-Ticker Scanner</h1>
          </div>
          <p className="text-gray-400">Scan multiple tickers for IV/HV mispricing opportunities</p>
        </header>

        {/* Ticker Management */}
        <div className="bg-[#2D2D2D] rounded-lg p-6 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {tickers.map(t => (
              <span key={t} className="flex items-center gap-1 px-3 py-1 bg-[#1E1E1E] rounded-full text-sm">
                {t}
                <button onClick={() => removeTicker(t)} className="text-gray-500 hover:text-[#FF006E] ml-1">x</button>
              </span>
            ))}
          </div>
          <div className="flex gap-3">
            <form onSubmit={addTicker} className="flex gap-2">
              <input
                type="text"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                placeholder="Add ticker"
                className="w-28 bg-[#1E1E1E] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
              />
              <button type="submit" className="px-4 py-2 bg-[#2D2D2D] border border-gray-600 hover:border-[#00C805] rounded-lg transition-colors">
                Add
              </button>
            </form>
            <button
              onClick={scanAll}
              disabled={scanning || tickers.length === 0}
              className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Scan All'}
            </button>
          </div>
        </div>

        {/* Results Table */}
        {Object.keys(results).length > 0 && (
          <div className="bg-[#2D2D2D] rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left px-4 py-3 text-sm text-gray-400">Ticker</th>
                  <th className="text-right px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('spot_price')}>
                    Spot {sortKey === 'spot_price' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('implied_vol_atm')}>
                    IV {sortKey === 'implied_vol_atm' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right px-4 py-3 text-sm text-gray-400">HV</th>
                  <th className="text-right px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('iv_hv_ratio')}>
                    IV/HV {sortKey === 'iv_hv_ratio' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-center px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('signal')}>
                    Signal {sortKey === 'signal' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="text-right px-4 py-3 text-sm text-gray-400">Volume</th>
                </tr>
              </thead>
              <tbody>
                {sortedTickers.map(t => {
                  const r = results[t];
                  if (!r) return null;
                  if (r.error) {
                    return (
                      <tr key={t} className="border-b border-gray-800">
                        <td className="px-4 py-3 font-bold">{t}</td>
                        <td colSpan={6} className="px-4 py-3 text-[#FF006E] text-sm">{r.error}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={t} className="border-b border-gray-800 hover:bg-[#1E1E1E] transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/?ticker=${t}`} className="font-bold text-[#00C805] hover:underline">{t}</Link>
                      </td>
                      <td className="text-right px-4 py-3">${r.spot_price.toFixed(2)}</td>
                      <td className="text-right px-4 py-3">{(r.implied_vol_atm * 100).toFixed(1)}%</td>
                      <td className="text-right px-4 py-3">{(r.historical_vol * 100).toFixed(1)}%</td>
                      <td className="text-right px-4 py-3 font-bold">{r.iv_hv_ratio.toFixed(2)}x</td>
                      <td className={`text-center px-4 py-3 font-bold ${signalColors[r.signal] || ''}`}>{r.signal}</td>
                      <td className="text-right px-4 py-3">{r.volume.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
