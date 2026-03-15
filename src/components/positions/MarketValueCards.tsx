'use client';

interface MarketValueCardsProps {
  marketValue: number;
  todayReturn: number;
  todayReturnPct: number;
  totalReturn: number;
  totalReturnPct: number;
  avgCost: number;
  shares: number;
  portfolioValue: number;
}

export default function MarketValueCards({
  marketValue,
  todayReturn,
  todayReturnPct,
  totalReturn,
  totalReturnPct,
  avgCost,
  shares,
  portfolioValue,
}: MarketValueCardsProps) {
  const diversity = portfolioValue > 0 ? (marketValue / portfolioValue) * 100 : 0;

  const cards = [
    { label: 'Market Value', value: `$${marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    {
      label: "Today's Return",
      value: `${todayReturn >= 0 ? '+' : ''}$${todayReturn.toFixed(2)}`,
      sub: `${todayReturnPct >= 0 ? '+' : ''}${todayReturnPct.toFixed(2)}%`,
      color: todayReturn >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]',
    },
    {
      label: 'Total Return',
      value: `${totalReturn >= 0 ? '+' : ''}$${totalReturn.toFixed(2)}`,
      sub: `${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%`,
      color: totalReturn >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]',
    },
    { label: 'Average Cost', value: `$${avgCost.toFixed(2)}` },
    { label: 'Shares', value: shares.toString() },
    { label: 'Portfolio Diversity', value: `${diversity.toFixed(1)}%` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-[#2D2D2D] rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">{card.label}</p>
          <p className={`text-lg font-bold ${card.color || 'text-white'}`}>{card.value}</p>
          {card.sub && <p className={`text-xs ${card.color || 'text-gray-400'}`}>{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}
