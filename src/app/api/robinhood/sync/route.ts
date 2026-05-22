import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

// Robinhood sync can take 30–60s (multiple accounts × broker round-trips).
// The dev rewrite proxy hangs up at ~30s, so this route handler bypasses
// the rewrite with a longer fetch budget.
export async function POST(req: NextRequest) {
  const { search } = new URL(req.url);
  const target = `${BACKEND_URL}/api/robinhood/sync${search}`;

  try {
    const res = await fetch(target, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(110_000),
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
