'use client';

import Link from 'next/link';

interface TradeSidebarProps {
  ticker: string;
  buyingPower: number;
  equity: number;
}

export default function TradeSidebar({ ticker, buyingPower, equity }: TradeSidebarProps) {
  return (
    <div className="space-y-4">
      <Link
        href={`/options-chain?ticker=${ticker}`}
        className="block w-full text-center px-6 py-3 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
      >
        Trade {ticker} Options
      </Link>

      <div className="bg-[#2D2D2D] rounded-lg p-4">
        <h3 className="text-sm font-bold mb-3 text-gray-400">Account Overview</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">Buying Power</span>
            <span className="text-white font-bold">${buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="border-t border-gray-700" />
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">Total Equity</span>
            <span className="text-white font-bold">${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      <div className="bg-[#2D2D2D] rounded-lg p-4">
        <h3 className="text-sm font-bold mb-3 text-gray-400">Quick Links</h3>
        <div className="space-y-2">
          <Link href="/execution" className="block text-sm text-[#00C805] hover:underline">
            Live Trading
          </Link>
          <Link href="/portfolio" className="block text-sm text-[#00C805] hover:underline">
            Portfolio Monitor
          </Link>
          <Link href="/risk-mgmt" className="block text-sm text-[#00C805] hover:underline">
            Risk Management
          </Link>
        </div>
      </div>
    </div>
  );
}
