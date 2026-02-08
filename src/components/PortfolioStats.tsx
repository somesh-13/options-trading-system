interface PortfolioStatsProps {
  portfolio: any;
}

export default function PortfolioStats({ portfolio }: PortfolioStatsProps) {
  if (!portfolio) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-[#2D2D2D] rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-4"></div>
            <div className="h-8 bg-gray-700 rounded w-3/4"></div>
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    {
      label: 'Portfolio Value',
      value: `$${portfolio.portfolioValue?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: portfolio.dayPLPercent,
      changeValue: portfolio.dayPL,
    },
    {
      label: 'Equity',
      value: `$${portfolio.equity?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      label: 'Cash',
      value: `$${portfolio.cash?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      label: 'Buying Power',
      value: `$${portfolio.buyingPower?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, index) => (
        <div
          key={index}
          className="bg-[#2D2D2D] rounded-lg p-6 hover:bg-[#333333] transition-all duration-300"
        >
          <p className="text-gray-400 text-sm mb-2">{stat.label}</p>
          <p className="text-3xl font-bold mb-2">{stat.value}</p>
          {stat.change !== undefined && (
            <div className={`text-sm ${stat.change >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
              {stat.change >= 0 ? '+' : ''}
              {stat.change.toFixed(2)}% (${stat.changeValue >= 0 ? '+' : ''}
              {stat.changeValue.toFixed(2)})
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
