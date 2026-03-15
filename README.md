# VegaEdge

**AI options analyst — chat, voice, alerts via WhatsApp & web**

VegaEdge is an AI-powered options trading assistant that helps you find overpriced options and premium opportunities in fundamentally good stocks you select. Chat on WhatsApp or web, get real-time notifications when IV/HV signals trigger, and ask questions about any stock via text, voice, or images.

---

## What It Does

- **Mispricing Alerts** — Scans your watchlist for IV vs HV divergence and notifies you when options are overpriced or underpriced
- **Chat Interface** — Ask about any stock via WhatsApp (OpenClaw bot) or the web dashboard and get instant analysis
- **Voice & Vision** — Talk to the Gemini-powered AI agent about trades, or share chart screenshots for analysis
- **Full Options Chain** — Browse strikes, view Greeks, and submit orders in one click
- **Portfolio Tracking** — Real-time P&L, Greeks aggregation, equity curves, and position management
- **Automated Trading** — Auto-engine scans every 5 minutes and executes when signals trigger (with risk controls)
- **Backtesting** — Validate strategies with regime-aware walk-forward backtesting before going live

---

## Architecture

```
                  WhatsApp (OpenClaw)
                        |
                   HTTPS REST
                        |
  Next.js Frontend <--> FastAPI Backend <--> Alpaca Paper Trading
   (port 3000)          (port 8000)          Yahoo Finance
        |                    |               Google Gemini
     Tailwind            Black-Scholes
     Chart.js            HMM Regime
     Plotly.js           NLP Sentiment
                         Bayesian Updates
```

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Charts | Chart.js, Plotly.js, react-chartjs-2 |
| Backend | Python FastAPI, NumPy, SciPy, Pandas |
| AI Agent | Google Gemini 2.5 Flash (WebSocket, voice + vision) |
| Broker | Alpaca Trade API (paper trading) |
| Market Data | Yahoo Finance, SEC EDGAR |
| Regime Detection | Hidden Markov Model (hmmlearn) |
| NLP | Custom sentiment extractor (bullish/bearish/dilution/guidance) |
| Risk | VaR (Historical / Parametric / Monte Carlo), position limits, drawdown protection |
| Database | SQLite (trade journal) |
| Deploy | Docker, Google Cloud Run |
| WhatsApp | OpenClaw bot on AWS EC2 |

---

## Capabilities

### Quantitative Analysis Engine (Backend API)

**IV/HV Mispricing Detection**
- Real-time IV vs HV ratio for any ticker — signals BUY (underpriced), SELL (overpriced), or NEUTRAL
- HV confidence intervals with statistical bounds
- Multi-ticker watchlist scanning with EV (expected value) ranking

**Regime Detection**
- Hidden Markov Model classifies market into Normal / High Volatility / Crash regimes
- Regime-aware strategy adjustment — different behavior per regime
- Historical regime analysis for backtesting accuracy

**Options Pricing & Greeks**
- Black-Scholes pricing with Newton-Raphson + Bisection IV solver
- First-order Greeks: Delta, Gamma, Vega, Theta, Rho
- Second-order Greeks: Vanna, Charm, Volga
- 3D volatility surface across strikes and expirations
- Hedge stability forecasting and rehedge timing

**NLP Sentiment Pipeline**
- News sentiment extraction (bullish/bearish/dilution/guidance keywords)
- SEC EDGAR filing scraper for IR data
- Bayesian fair value updates: Posterior = Prior x (1 + sentiment x weight)

**Risk Management**
- VaR: Historical, Parametric (normal), Monte Carlo simulation
- Portfolio Greeks aggregation and limits (max delta/gamma/vega)
- Position sizing limits (max 10% NAV per trade)
- Drawdown protection (10% daily max)
- Stress testing and P&L attribution

**Backtesting**
- Walk-forward backtesting with rolling train/test windows
- No look-ahead bias — point-in-time data only
- Metrics: Sharpe Ratio, Calmar Ratio, max drawdown, win rate, monthly returns
- Multi-strategy comparison (IV/HV arbitrage vs Keltner Channel vs Combined)

---

## Web Dashboard (15 Pages)

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | System overview, ticker analyzer, CIFR mispricing widget |
| Options Pricing | `/pricing` | Black-Scholes calculator with 1st + 2nd order Greeks |
| Vol Surface | `/vol-surface` | 3D implied volatility surface |
| Opportunity Scanner | `/scanner` | Multi-ticker IV/HV scan with customizable watchlist |
| Sentiment | `/sentiment` | NLP news sentiment + Bayesian fair value updates |
| Backtest | `/backtest` | Regime-aware walk-forward backtesting with performance metrics |
| Strategy | `/strategy` | EV calculator + delta-gamma hedging recommendations |
| Risk Management | `/risk-mgmt` | VaR analysis (3 methods) with position limits |
| Portfolio | `/portfolio` | Live positions, aggregated Greeks, equity curve, alerts |
| Execution | `/execution` | Alpaca paper trading — stocks & options order submission |
| Journal | `/journal` | Trade history with P&L breakdown by signal source |
| Auto Engine | `/auto-engine` | Autonomous scan + execute with configurable risk limits |
| Positions | `/positions` | Individual ticker deep-dive — Greeks, price chart, option positions |
| Options Chain | `/options-chain` | Interactive chain with IV/HV display and one-click trading |
| AI Agent | `/agent` | Voice + vision Gemini analyst — ask about any ticker |

---

## WhatsApp Integration

The backend is deployed on Google Cloud Run and accessible over HTTPS. The OpenClaw WhatsApp bot on AWS EC2 calls these endpoints to answer trading questions in chat.

**Example conversations:**

```
You: "What's the IV/HV signal for CIFR?"
Bot: CIFR IV/HV ratio is 1.45 — SELL signal. Options are overpriced,
     good premium selling opportunity.

You: "What regime is CIFR in?"
Bot: CIFR is in a High Volatility regime (HMM detection).
     Consider selling premium strategies.

You: "Calculate VaR for my $10k CIFR position"
Bot: 1-day 95% VaR: $320 (Historical), $290 (Parametric), $310 (Monte Carlo)
```

---

## API Endpoints

```
GET  /health                              Health check
GET  /api/market/{ticker}/mispricing      IV/HV signal (BUY/SELL/NEUTRAL)
GET  /api/market/{ticker}/price-history   OHLCV price data
GET  /api/market/{ticker}/regime          HMM volatility regime
GET  /api/market/{ticker}/hv-confidence   HV with confidence intervals
GET  /api/risk/var/{ticker}               Value at Risk
POST /api/pricing/calculate               Black-Scholes pricing
POST /api/pricing/greeks                  Option Greeks
POST /api/pricing/implied-vol             IV solver (Newton-Raphson + Bisection)
GET  /api/pricing/vol-surface/{ticker}    Volatility surface
POST /api/pricing/hedge-forecast          Delta decay + rehedge recommendations
GET  /api/sentiment/{ticker}              NLP sentiment analysis
POST /api/data/bayesian-update            Bayesian fair value update
POST /api/backtest/run                    Walk-forward backtest
POST /api/backtest/compare                Multi-strategy comparison
POST /api/strategy/ev                     Single trade expected value
POST /api/strategy/ev/scan                Multi-ticker EV scanner
POST /api/hedge/ratio                     Optimal hedge ratio
POST /api/hedge/rebalance-check           Rehedge trigger detection
GET  /api/risk/var/{ticker}               VaR (3 methods)
POST /api/risk/limits-check               Position limit enforcement
POST /api/risk/stress-test                Stress testing
POST /api/risk/pnl-attribution            Greeks P&L breakdown
POST /api/execution/order                 Submit stock order
POST /api/execution/options/order         Submit options order
GET  /api/execution/positions             Open positions
GET  /api/execution/options/chain/{sym}   Options chain with Greeks
GET  /api/portfolio/summary               Portfolio overview
GET  /api/portfolio/positions-greeks      All positions with Greeks
GET  /api/portfolio/equity-history        Equity curve
POST /api/engine/start                    Start auto trading engine
GET  /api/engine/status                   Engine state + stats
GET  /api/journal/trades                  Trade history
GET  /api/journal/pnl/by-signal           P&L by signal source
```

50+ endpoints across pricing, data, backtest, strategy, risk, execution, journal, and auto-engine modules.

---

## Trading Strategies

### Keltner Channel + LEAP
- **Sell Put:** Price at lower Keltner band + IV spike (IV/HV > 1.3)
- **Sell Call:** Price at upper band + IV spike
- **Buy LEAP:** IV extremely cheap (IV/HV < 0.8) — GTC limit orders at 10-25% discount

### IV/HV Arbitrage
- Scan for mispricing across watchlist (HOOD, CIFR, WULF, PYPL, GRAB)
- Auto-execute when IV/HV ratio exceeds thresholds
- Regime-aware: adjusts behavior for Normal / High Vol / Crash regimes

### Auto Engine Risk Controls
| Parameter | Default |
|-----------|---------|
| Min EV per contract | $50 |
| Max contracts/trade | 5 |
| Max total open | 20 |
| Max daily trades | 10 |
| Max daily loss | $1,000 |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Alpaca paper trading account
- Google Gemini API key

### Frontend

```bash
npm install
npm run dev    # http://localhost:3000
```

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn src.api.routes:app --host 0.0.0.0 --port 8000 --reload
```

### Environment Variables

Create `.env.local` in the project root:

```env
ALPACA_API_KEY=your_paper_key
ALPACA_SECRET_KEY=your_paper_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
NEXT_PUBLIC_PRICING_API_URL=http://localhost:8000
GEMINI_API_KEY=your_gemini_key
```

---

## Docker

```bash
# Frontend
docker build -t vegaedge:latest \
  --build-arg NEXT_PUBLIC_PRICING_API_URL=http://api:8000 .

# Backend
cd backend
docker build -t vegaedge-api:latest .

# Deploy to Cloud Run
gcloud run deploy vegaedge-api \
  --source backend/ \
  --allow-unauthenticated \
  --region us-east1
```

---

## Project Structure

```
src/
├── app/
│   ├── api/                    # Next.js API routes (proxy to Alpaca)
│   ├── agent/                  # AI voice + vision agent page
│   ├── options-chain/          # Options chain viewer
│   ├── positions/              # Position analysis
│   ├── pricing/                # Black-Scholes calculator
│   ├── portfolio/              # Portfolio monitor
│   ├── execution/              # Live trading
│   └── ...                     # 15 total pages
├── components/
│   ├── agent/                  # Voice, signals, watchlist, transcript
│   ├── options-chain/          # Chain table, IV/HV panel, trade panel
│   ├── positions/              # Ticker header, price chart, trade sidebar
│   └── ...                     # 20+ components
├── hooks/                      # useVegaEdgeSession (Gemini WebSocket)
├── lib/
│   ├── alpaca.ts               # Alpaca SDK client
│   └── pricing-api.ts          # Backend HTTP client
└── types/

backend/src/
├── api/                        # FastAPI routes + models (50+ endpoints)
├── pricing/                    # Black-Scholes, Greeks, IV solver, vol surface
├── data/                       # Yahoo Finance, HMM regime, NLP sentiment
├── backtest/                   # Walk-forward engine, Keltner strategy
├── strategy/                   # EV calculator, hedging engine
├── risk/                       # VaR, position limits, drawdown
├── execution/                  # Alpaca paper trading client
├── journal/                    # SQLite trade database
├── engine/                     # Autonomous scanner + executor
└── vegaedge/                   # Gemini AI agent (tools, charts, session)
```

---

## License

Private project by [Somesh Dubey](https://github.com/somesh-13).
