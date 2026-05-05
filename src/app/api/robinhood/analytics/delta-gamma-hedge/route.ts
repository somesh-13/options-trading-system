import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    account: searchParams.get('account') ?? 'all',
    hedge_dte: searchParams.get('hedge_dte') ?? '30',
    hedge_type: searchParams.get('hedge_type') ?? 'call',
    top_n: searchParams.get('top_n') ?? '10',
  });
  const underlying = searchParams.get('underlying');
  if (underlying) qs.set('underlying', underlying);
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/robinhood/analytics/delta-gamma-hedge?${qs.toString()}`,
      { cache: 'no-store' },
    );
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
