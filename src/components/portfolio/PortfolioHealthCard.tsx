'use client';

import { useRef, useState, useEffect } from 'react';
import type { PortfolioSummaryResponse } from '@/lib/pricing-api';

interface PortfolioHealthCardProps {
  data: PortfolioSummaryResponse | null;
  loading: boolean;
}

export default function PortfolioHealthCard({ data, loading }: PortfolioHealthCardProps) {
  const prevDayPLRef = useRef<number | null>(null);
  const [flashClass, setFlashClass] = useState('');

  const equity = data ? parseFloat(data.account.equity || '0') : 0;
  const lastEquity = data ? parseFloat(data.account.last_equity || '0') : 0;
  const dayPL = equity - lastEquity;

  useEffect(() => {
    if (!data) return;
    const prev = prevDayPLRef.current;
    if (prev !== null && prev !== dayPL) {
      setFlashClass(dayPL > prev ? 'flash-up' : 'flash-down');
      const timer = setTimeout(() => setFlashClass(''), 1200);
      return () => clearTimeout(timer);
    }
    prevDayPLRef.current = dayPL;
  }, [data, dayPL]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-[#2D2D2D] rounded-lg p-5 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-3"></div>
            <div className="h-8 bg-gray-700 rounded w-3/4"></div>
          </div>
        ))}
      </div>
    );
  }

  const acct = data.account;
  const pnl = data.pnl_summary;

  const portfolioValue = parseFloat(acct.portfolio_value || '0');
  const cash = parseFloat(acct.cash || '0');
  const buyingPower = parseFloat(acct.buying_power || '0');
  const dayPLPct = lastEquity > 0 ? (dayPL / lastEquity) * 100 : 0;

  const winRate = typeof pnl?.win_rate === 'number' ? pnl.win_rate : 0;
  const totalPnl = typeof pnl?.total_pnl === 'number' ? pnl.total_pnl : 0;

  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const stats = [
    {
      label: 'Portfolio Value',
      value: `$${fmt(portfolioValue)}`,
      sub: dayPLPct !== 0 ? `${dayPLPct >= 0 ? '+' : ''}${dayPLPct.toFixed(2)}% today` : undefined,
      subColor: dayPLPct >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]',
    },
    {
      label: 'Equity',
      value: `$${fmt(equity)}`,
    },
    {
      label: 'Cash',
      value: `$${fmt(cash)}`,
    },
    {
      label: 'Buying Power',
      value: `$${fmt(buyingPower)}`,
    },
    {
      label: 'Daily P&L',
      value: `${dayPL >= 0 ? '+' : ''}$${fmt(dayPL)}`,
      valueColor: dayPL >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]',
      flash: true,
    },
    {
      label: 'Win Rate',
      value: `${(winRate * 100).toFixed(1)}%`,
      sub: totalPnl !== 0 ? `Total P&L: ${totalPnl >= 0 ? '+' : ''}$${fmt(totalPnl)}` : undefined,
      subColor: totalPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {stats.map((stat, i) => (
        <div
          key={i}
          className={`bg-[#2D2D2D] rounded-lg p-5 hover:bg-[#333333] transition-colors ${
            stat.flash ? flashClass : ''
          }`}
        >
          <p className="text-gray-400 text-sm mb-1">{stat.label}</p>
          <p className={`text-2xl font-bold ${stat.valueColor || ''}`}>{stat.value}</p>
          {stat.sub && <p className={`text-sm mt-1 ${stat.subColor || 'text-gray-400'}`}>{stat.sub}</p>}
        </div>
      ))}
    </div>
  );
}
