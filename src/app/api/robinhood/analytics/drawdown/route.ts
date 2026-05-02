import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    account: searchParams.get('account') ?? 'all',
    limit: searchParams.get('limit') ?? '0.10',
  });
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/robinhood/analytics/drawdown?${qs.toString()}`,
      { cache: 'no-store' },
    );
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
