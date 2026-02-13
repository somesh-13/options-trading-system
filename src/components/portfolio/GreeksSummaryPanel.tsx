'use client';

import type { PortfolioGreeks } from '@/lib/pricing-api';

interface GreeksSummaryPanelProps {
  greeks: PortfolioGreeks | null;
  limits?: { delta: number; gamma: number; vega: number; theta: number };
}

const DEFAULT_LIMITS = { delta: 500, gamma: 100, vega: 1000, theta: 500 };

export default function GreeksSummaryPanel({ greeks, limits }: GreeksSummaryPanelProps) {
  const lim = limits || DEFAULT_LIMITS;

  if (!greeks) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-[#2D2D2D] rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-3"></div>
            <div className="h-6 bg-gray-700 rounded w-3/4"></div>
          </div>
        ))}
      </div>
    );
  }

  const items = [
    { label: 'Delta', value: greeks.total_delta, limit: lim.delta },
    { label: 'Gamma', value: greeks.total_gamma, limit: lim.gamma },
    { label: 'Theta', value: greeks.total_theta, limit: lim.theta },
    { label: 'Vega', value: greeks.total_vega, limit: lim.vega },
    { label: 'Rho', value: greeks.total_rho, limit: null as number | null },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      {items.map((item) => {
        const absVal = Math.abs(item.value);
        const ratio = item.limit ? absVal / item.limit : 0;
        const barColor = ratio > 1 ? '#FF006E' : ratio > 0.75 ? '#FFD700' : '#00C805';
        const barWidth = item.limit ? Math.min(ratio * 100, 100) : 0;

        return (
          <div key={item.label} className="bg-[#2D2D2D] rounded-lg p-4">
            <p className="text-gray-400 text-xs mb-1">{item.label}</p>
            <p className="text-xl font-bold mb-2">{item.value.toFixed(2)}</p>
            {item.limit !== null && (
              <div className="w-full h-2 bg-[#1E1E1E] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
