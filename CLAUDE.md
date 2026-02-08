# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Options trading dashboard with a Python FastAPI backend (pricing engine) and Next.js frontend. Focused on CIFR (Cipher Mining) volatility arbitrage using IV vs HV analysis.

## Commands

### Frontend (Next.js, port 3000)
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint (flat config, eslint.config.mjs)
```

### Backend (Python FastAPI, port 8000)
```bash
cd backend
source venv/bin/activate
uvicorn src.api.routes:app --host 0.0.0.0 --port 8000 --reload
pip install -r requirements.txt   # Install Python deps
pytest                             # Run tests (tests/ dir is empty currently)
```

## Architecture

Two independent services that communicate over HTTP:

**Frontend (Next.js 16 / React 19 / TypeScript)** at `src/`:
- `src/app/page.tsx` - Main dashboard with CifrMispricing component
- `src/app/pricing/page.tsx` - Interactive Black-Scholes calculator
- `src/app/api/` - Next.js API routes that proxy to Alpaca Trade API (portfolio, positions, trades)
- `src/lib/alpaca.ts` - Alpaca SDK client (paper trading mode)
- `src/lib/pricing-api.ts` - HTTP client for the Python backend; defines TypeScript interfaces for `OptionParams`, `Greeks`, `MispricingData`
- `src/app/sentiment/` - NLP sentiment analysis page
- `src/app/backtest/` - Backtesting framework page
- `src/app/strategy/` - EV calculator + hedging page
- `src/app/risk-mgmt/` - VaR + risk management page
- `src/app/execution/` - Alpaca live trading page
- `src/components/` - 18+ client components including SentimentPanel, BacktestPanel, VaRPanel, EVCalculator, HedgingPanel

**Backend (Python FastAPI)** at `backend/src/`:
- `api/routes.py` - FastAPI app with CORS, 30+ endpoints across 7 phases
- `api/models.py` - Pydantic request/response models for all endpoints
- `pricing/` - Black-Scholes, Greeks (1st + 2nd order), IV solver, vol surface, hedge stability, P&L attribution
- `data/` - Yahoo Finance, CIFR data, HMM regime detection, IR scraper, NLP extractor, Bayesian updates
- `backtest/engine.py` - Walk-forward backtesting with performance metrics (Sharpe, Calmar, max DD)
- `strategy/` - EV calculator, dynamic hedging engine (delta-gamma neutrality)
- `risk/` - VaR (Historical/Parametric/Monte Carlo), position limits, drawdown protection
- `execution/alpaca_client.py` - Alpaca paper trading (orders, positions, account)

## Key Patterns

- Frontend components that fetch data are client components (`'use client'`) using `useState`/`useEffect`
- The pricing API client (`src/lib/pricing-api.ts`) uses `NEXT_PUBLIC_PRICING_API_URL` env var (defaults to `http://localhost:8000`)
- Alpaca credentials are server-side only (`ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL`) in `.env.local`
- Path alias `@/*` maps to `./src/*` (configured in tsconfig.json)
- Styling uses Tailwind CSS v4 with a dark theme (bg `#1E1E1E`, green `#00C805`, red `#FF006E`, gold `#FFD700`)
- Backend uses `sys.path.append` for relative imports from the `backend/src/` directory
- Python venv is at `backend/venv/`
