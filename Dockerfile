# VegaEdge Next.js frontend
# Standalone build (next.config.ts already sets output: 'standalone').

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
# `npm install` tolerates lockfile drift (this repo currently has playwright
# version skew between package.json and package-lock.json). Switch back to
# `npm ci` after running `npm install` locally to refresh the lockfile.
RUN npm install --no-audit --no-fund

COPY . .

# BACKEND_URL is the hostname NPM is reachable at on the compose network.
# It's used at runtime by next.config.ts for server-side rewrites; we still
# pass NEXT_PUBLIC_PRICING_API_URL for browser-side fallback consumers.
ARG NEXT_PUBLIC_PRICING_API_URL=
ENV NEXT_PUBLIC_PRICING_API_URL=$NEXT_PUBLIC_PRICING_API_URL

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# Default to the NPM hostname inside compose; override per-env if needed.
ENV BACKEND_URL=npm

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

# Wget is in node:20-alpine; curl is not. Use 127.0.0.1 to avoid busybox
# wget resolving `localhost` to IPv6, which Next.js standalone doesn't bind.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
