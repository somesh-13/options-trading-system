#!/usr/bin/env node
// Fetches active US equity tickers from Alpaca once and writes public/us-tickers.json.
// Requires ALPACA_API_KEY and ALPACA_SECRET_KEY in env (paper keys work fine).
// Run: npm run fetch:tickers

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Best-effort .env / .env.local loader (no dotenv dep required).
for (const name of ['.env.local', '.env', 'backend/.env', 'backend/.env.local']) {
  const path = join(PROJECT_ROOT, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k]) continue;
    const v = rawV.replace(/^['"]|['"]$/g, '');
    process.env[k] = v;
  }
}

const source = (process.env.TICKER_SOURCE || 'alpaca').toLowerCase();

async function fetchAlpaca() {
  const keyId = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  let baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  baseUrl = baseUrl.replace(/\/v2\/?$/, '').replace(/\/$/, '');
  if (!keyId || !secret) throw new Error('alpaca-missing-env');

  const url = `${baseUrl}/v2/assets?status=active&asset_class=us_equity`;
  console.log(`[alpaca] fetching ${url}`);
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`alpaca-${res.status}`);
  const assets = await res.json();
  return assets
    .filter((a) => a.tradable === true && !a.symbol.includes('.'))
    .map((a) => ({ symbol: a.symbol, name: a.name, exchange: a.exchange }));
}

async function fetchSec() {
  const url = 'https://www.sec.gov/files/company_tickers.json';
  console.log(`[sec] fetching ${url}`);
  const res = await fetch(url, {
    headers: {
      // SEC requires a descriptive User-Agent. Override via TICKER_USER_AGENT env if you want.
      'User-Agent': process.env.TICKER_USER_AGENT || 'VegaEdge Dashboard (dev@example.com)',
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`sec-${res.status}`);
  const body = await res.json();
  // Body is keyed numerically: { "0": { cik_str, ticker, title }, ... }.
  return Object.values(body).map((row) => ({
    symbol: row.ticker,
    name: row.title,
    exchange: '',
  }));
}

let tickers;
try {
  if (source === 'sec') {
    tickers = await fetchSec();
  } else {
    try {
      tickers = await fetchAlpaca();
    } catch (err) {
      console.warn(`[alpaca] failed (${err.message}); falling back to SEC`);
      tickers = await fetchSec();
    }
  }
} catch (err) {
  console.error(`Fetch failed: ${err.message}`);
  process.exit(1);
}

console.log(`Received ${tickers.length} raw tickers.`);

tickers = tickers
  .filter((t) => t.symbol && !t.symbol.includes('.') && /^[A-Z0-9-]+$/.test(t.symbol))
  .sort((a, b) => a.symbol.localeCompare(b.symbol));

const outDir = join(PROJECT_ROOT, 'public');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'us-tickers.json');
const json = JSON.stringify(tickers);
writeFileSync(outPath, json);

const bytes = Buffer.byteLength(json, 'utf8');
const kb = (bytes / 1024).toFixed(1);
console.log(`Wrote ${tickers.length} tickers to ${outPath} (${kb} KB).`);
