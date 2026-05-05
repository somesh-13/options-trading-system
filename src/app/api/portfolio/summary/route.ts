import { NextResponse } from 'next/server';

/**
 * Server-side proxy to the backend's /api/portfolio/summary.
 *
 * The `portfolio` prefix is intentionally excluded from
 * `BACKEND_PROXY_PREFIXES` in next.config.ts because it surfaces real
 * Alpaca account state — we don't want it reachable via any ngrok tunnel
 * fronting port 3000. This handler keeps the LAN dashboard working
 * (server-to-server fetch never touches the public surface).
 */

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.PRICING_API_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/portfolio/summary`, {
      cache: 'no-store',
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
