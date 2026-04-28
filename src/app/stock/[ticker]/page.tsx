import StockDetailClient from './StockDetailClient';

interface StockDetailPageProps {
  params: Promise<{ ticker: string }>;
}

export default async function StockDetailPage({ params }: StockDetailPageProps) {
  const { ticker } = await params;
  return <StockDetailClient ticker={ticker.toUpperCase()} />;
}

export async function generateMetadata({ params }: StockDetailPageProps) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  return {
    title: `${ticker} — VegaEdge`,
    description: `Price, chart, and mispricing snapshot for ${ticker}.`,
  };
}
