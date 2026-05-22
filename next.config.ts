import type { NextConfig } from "next";

// Routes that are SAFE to expose through Next.js rewrites — and therefore
// publicly reachable through any ngrok tunnel that fronts port 3000 (e.g. the
// reserved domain `dashboard` tunnel).
//
// `robinhood` is read-only holdings/summary/activity. Re-exposed for the
// LAN-only setup so /robinhood can render. **Remove from this list before
// fronting port 3000 with a public tunnel** — it carries real account state.
//
// STILL REMOVED for the public attack surface (reachable on localhost:8000 only):
//   - execution, portfolio — Alpaca trading + real account state
//   - journal              — trade journal (sensitive)
//   - risk                 — VaR / position limits (writes accepted)
//   - engine               — auto-engine controls (start/stop scans)
//   - hedge                — rebalance triggers
//   - strategy             — EV scan / hedging mutators
const BACKEND_PROXY_PREFIXES = [
  "agents",
  "analytics",
  "auth",
  "backtest",
  "calendar",
  "flow",
  "ir",
  "macro-news",
  "market",
  "mispricing",
  "notifications",
  "pricing",
  "regime",
  "replay",
  "robinhood",
  "scanner",
  "sec",
  "sentiment",
  "signals",
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Hide the dev-mode watermark; this app embeds in trader screens.
  devIndicators: false,
  async rewrites() {
    // BACKEND_URL is the host (and optional port) that fronts every backend
    // service. In Docker compose this is the Nginx Proxy Manager container,
    // which routes by /api/<prefix>/ to the owning service. For local dev
    // (no compose), it falls back to the FastAPI monolith on :8000.
    const backendUrl = process.env.BACKEND_URL || 'localhost:8000';
    return BACKEND_PROXY_PREFIXES.map((prefix) => ({
      source: `/api/${prefix}/:path*`,
      destination: `http://${backendUrl}/api/${prefix}/:path*`,
    }));
  },
};

export default nextConfig;
