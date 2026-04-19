import type { NextConfig } from "next";

const BACKEND_PROXY_PREFIXES = [
  "pricing",
  "mispricing",
  "market",
  "risk",
  "sentiment",
  "backtest",
  "hedge",
  "strategy",
  "execution",
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return BACKEND_PROXY_PREFIXES.map((prefix) => ({
      source: `/api/${prefix}/:path*`,
      destination: `http://localhost:8000/api/${prefix}/:path*`,
    }));
  },
};

export default nextConfig;
