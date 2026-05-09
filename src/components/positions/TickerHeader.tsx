'use client';

interface TickerHeaderProps {
  ticker: string;
  price?: number;
  change?: number;
  changePct?: number;
}

export default function TickerHeader({ ticker, price, change, changePct }: TickerHeaderProps) {
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  const hasChange = typeof change === 'number' && Number.isFinite(change);
  const hasChangePct = typeof changePct === 'number' && Number.isFinite(changePct);
  const isPositive = (change ?? 0) >= 0;
  const color = isPositive ? 'text-[#00C805]' : 'text-[#FF006E]';
  const sign = isPositive ? '+' : '';

  return (
    <div className="mb-4">
      <h2 className="text-3xl font-bold">{ticker}</h2>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-4xl font-bold">{hasPrice ? `$${price!.toFixed(2)}` : '—'}</span>
        <span className={`text-xl font-semibold ${color}`}>
          {hasChange ? `${sign}$${change!.toFixed(2)}` : '—'}
          {hasChangePct ? ` (${sign}${changePct!.toFixed(2)}%)` : ''}
        </span>
      </div>
    </div>
  );
}
