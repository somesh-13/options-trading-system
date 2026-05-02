import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const eventType = searchParams.get('event_type');
  const limit = searchParams.get('limit') ?? '100';
  const offset = searchParams.get('offset') ?? '0';
  if (eventType) qs.set('event_type', eventType);
  qs.set('limit', limit);
  qs.set('offset', offset);

  try {
    const res = await fetch(`${BACKEND_URL}/api/engine/logs?${qs.toString()}`, {
      cache: 'no-store',
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
