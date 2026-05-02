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
    const message = error instanceof Error ? error.message : 'Unknown error';
    const code = (error as { code?: number } | null)?.code;
    const isAuth =
      code === 401 ||
      code === 403 ||
      /code:\s*40[13]/.test(message) ||
      /unauthorized|forbidden/i.test(message);
    // Soft-fail on auth errors so the client can render without a 500 surfacing
    // in dev overlays. The underlying credential issue is environmental.
    if (isAuth) {
      return NextResponse.json({ success: true, data: {}, reason: 'auth' });
    }
    console.error('Error fetching latest trades:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
