import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    portfolio_value: searchParams.get('portfolio_value') ?? '100000',
    confidence: searchParams.get('confidence') ?? '0.95',
    holding_period: searchParams.get('holding_period') ?? '1',
    method: searchParams.get('method') ?? 'all',
  });
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/risk/var/${encodeURIComponent(ticker)}?${qs.toString()}`,
      { cache: 'no-store' },
    );
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
