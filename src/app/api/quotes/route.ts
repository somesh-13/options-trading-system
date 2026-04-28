import { NextResponse } from 'next/server';
import alpaca from '@/lib/alpaca';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols');
  if (!raw) {
    return NextResponse.json({ success: false, error: 'symbols query param required' }, { status: 400 });
  }
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const trades = await alpaca.getLatestTrades(symbols);
    const out: Record<string, number> = {};
    for (const [sym, t] of trades.entries()) {
      if (t && typeof t.Price === 'number') out[sym] = t.Price;
    }
    return NextResponse.json({ success: true, data: out });
  } catch (error) {
    console.error('Error fetching latest trades:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
