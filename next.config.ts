import type { NextConfig } from "next";

// Routes that are SAFE to expose through Next.js rewrites — and therefore
// publicly reachable through any ngrok tunnel that fronts port 3000 (e.g. the
// reserved domain `dashboard` tunnel).
//
// REMOVED for the public attack surface (still reachable on localhost:8000):
//   - execution, portfolio, robinhood — Alpaca/Robinhood trading + real account state
//   - journal              — trade journal (sensitive)
//   - risk                 — VaR / position limits (writes accepted)
//   - engine               — auto-engine controls (start/stop scans)
//   - hedge                — rebalance triggers
//   - strategy             — EV scan / hedging mutators
const BACKEND_PROXY_PREFIXES = [
  "agents",
  "backtest",
  "market",
  "mispricing",
  "pricing",
  "regime",
  "replay",
  "scanner",
  "sentiment",
  "signals",
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Hide the dev-mode watermark; this app embeds in trader screens.
  devIndicators: false,
  async rewrites() {
    return BACKEND_PROXY_PREFIXES.map((prefix) => ({
      source: `/api/${prefix}/:path*`,
      destination: `http://localhost:8000/api/${prefix}/:path*`,
    }));
  },
};

export default nextConfig;
