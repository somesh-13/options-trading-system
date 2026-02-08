# Quantitative Systematic Trading System - SIG Preparation Project

## 🎯 Project Vision
Build an institutional-grade quantitative trading system that demonstrates the hybrid QST skillset required at Susquehanna International Group: bridging quantitative research, systematic execution, and real-time risk management.

---

## 📊 Paradigm Shift: From Retail to Institutional

| Aspect | Previous (Retail) | New (SIG-Grade) |
|--------|------------------|-----------------|
| **Strategy** | Sell at Keltner Bands | Volatility Arbitrage: IV vs RV spread capture |
| **LLM Role** | AI makes final decision | Bayesian Factor Extractor: NLP sentiment → alpha signal |
| **Options** | Basic covered calls | Greeks-based dynamic hedging (Delta-Gamma neutrality) |
| **Execution** | Market orders | Limit Order Book analysis + TCA (Transaction Cost Analysis) |
| **Risk** | Position limits | Multi-dimensional: Delta, Gamma, Vega, Theta exposure |
| **Backtesting** | Simple P&L | Regime-aware with bias mitigation (look-ahead, survivorship) |
| **Edge** | Technical indicators | Expected Value (EV) calculation per trade + Information asymmetry |

---

## 🏗️ System Architecture

### Core Modules

```
┌─────────────────────────────────────────────────────────────┐
│                    QUANTITATIVE ENGINE                       │
├─────────────────────────────────────────────────────────────┤
│  1. Alternative Data Pipeline (OpenClaw + Claude NLP)       │
│  2. Options Pricing Engine (Black-Scholes + Greeks)         │
│  3. Volatility Regime Detector (HMM)                        │
│  4. Expected Value Calculator                               │
│  5. Dynamic Hedging Engine (Delta-Gamma Neutrality)         │
│  6. Execution & Microstructure (Alpaca + TCA)               │
│  7. Backtesting Framework (Bias-Free)                       │
│  8. Risk & Performance Analytics (Sharpe, MaxDD, Greeks)    │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack Evolution

| Layer | Current | SIG Upgrade |
|-------|---------|-------------|
| Core Logic | Node.js | **Python** (research) + **C++** simulation (low-latency prototype) |
| Research | Manual | **Jupyter Notebooks** with vectorized NumPy/Pandas |
| Options Pricing | None | **QuantLib** or custom Black-Scholes vectorized |
| ML/Stats | None | **scikit-learn** (HMM), **statsmodels** (time series) |
| Data | Alpaca only | **Alternative data** (IR scraping) + market data |
| Backtesting | None | **Backtrader** or custom event-driven engine |

---

## 📋 Implementation Phases

### Phase 1: Options Pricing & Greeks Engine
**Goal:** Build the mathematical foundation for derivatives trading.

#### 1.1 Black-Scholes Implementation
- [ ] Vectorized Black-Scholes formula (NumPy)
- [ ] Greeks calculation:
  - **Delta** (∂V/∂S): Directional exposure
  - **Gamma** (∂²V/∂S²): Delta sensitivity
  - **Vega** (∂V/∂σ): Volatility exposure
  - **Theta** (∂V/∂t): Time decay
- [ ] Implied Volatility solver (Newton-Raphson or bisection)
- [ ] Support for American options (Binomial Tree or Monte Carlo)

**Output:** `pricing_engine.py` module with Greeks dashboard

#### 1.2 Volatility Analysis
- [ ] Historical Volatility (HV) calculator (rolling window)
- [ ] Implied Volatility (IV) extraction from options chain
- [ ] **IV-HV Spread**: Primary signal for volatility arbitrage
- [ ] Volatility surface visualization (strike vs expiry)

**Edge Identification:** Sell options when IV/HV ratio > 1.2 (overpriced volatility)

---

### Phase 2: Alternative Data Pipeline (NLP Feature Extraction)
**Goal:** Use Claude as a Bayesian information processor, not decision maker.

#### 2.1 IR Data Scraper
- [ ] Automated scraping of Investor Relations pages (BeautifulSoup/Playwright)
- [ ] Earnings call transcript extraction
- [ ] SEC filing parser (10-K, 10-Q, 8-K)

#### 2.2 Claude NLP Feature Extractor
- [ ] **Sentiment Score** (-1 to +1): Overall tone of management commentary
- [ ] **Dilution Risk** (0-100): Share issuance / buyback signals
- [ ] **Guidance Change** (-1 to +1): Forward-looking statement shifts
- [ ] **Competitive Threats** (0-100): Mentions of market pressure

**SIG Principle:** These become **alpha factors** in a linear or ensemble model, NOT direct buy/sell signals.

#### 2.3 Bayesian Update Module
- [ ] Prior belief: Fair value based on technical analysis
- [ ] Likelihood: NLP sentiment score as "information edge"
- [ ] Posterior: Updated fair value = Prior × (1 + sentiment × weight)

**Example:**
```
Fair Value (Technical): $50
Sentiment Score: +0.3 (bullish)
Weight: 0.05 (5% adjustment cap)
Adjusted Fair Value: $50 × 1.015 = $50.75
```

---

### Phase 3: Volatility Arbitrage Strategy
**Goal:** Implement the core SIG-style strategy with Expected Value calculations.

#### 3.1 Strategy Logic
**Entry Conditions (Covered Call):**
1. IV/HV ratio > 1.2 (IV overpriced)
2. Stock position exists OR can acquire at fair value
3. Delta of selected call < 0.3 (low probability of assignment)
4. EV of premium > Transaction costs + Assignment risk

**Exit Conditions:**
1. Option expires worthless → Keep premium
2. Underlying hits stop loss → Close position
3. IV/HV ratio drops below 1.0 → Buy back option early

#### 3.2 Expected Value Calculator
For every potential trade:

```
EV = P(expire worthless) × Premium - P(assigned) × (Assignment Cost + Opp Cost)
```

**Only execute if EV > $X threshold (e.g., $50/contract)**

#### 3.3 Dynamic Delta Hedging
- [ ] Target portfolio delta: ±0.1 (nearly market-neutral)
- [ ] Rebalance when delta exceeds thresholds
- [ ] Use stock or futures to hedge directional risk

---

### Phase 4: Market Microstructure & Execution
**Goal:** Understand and minimize transaction costs.

#### 4.1 Limit Order Book (LOB) Analysis
- [ ] Parse Alpaca order book data
- [ ] Calculate bid-ask spread
- [ ] Estimate market impact for order size

#### 4.2 Transaction Cost Analysis (TCA)
**Metrics:**
- **Implementation Shortfall:** (Execution Price - Decision Price) / Decision Price
- **Slippage:** Expected fill price vs actual fill
- **Market Impact:** Price movement caused by your order

#### 4.3 Smart Order Router
- [ ] Use limit orders when spread is wide
- [ ] Aggress (market orders) only when spread is tight
- [ ] Time orders to avoid low-liquidity periods

---

### Phase 5: Backtesting Framework (Bias-Free)
**Goal:** Prove statistical edge without data mining.

#### 5.1 Bias Mitigation
**Look-Ahead Bias:**
- Use point-in-time data only
- Decision timestamp < Execution timestamp
- No future data in indicator calculations

**Survivorship Bias:**
- Include delisted stocks in universe
- Use historical index constituents (not current)

**Overfitting:**
- Walk-forward optimization (rolling 6-month train, 1-month test)
- Out-of-sample validation on 2023-2024 data

#### 5.2 Regime Analysis (Hidden Markov Model)
- [ ] Identify 3 market regimes:
  1. **Bull** (low volatility, uptrend)
  2. **Bear** (high volatility, downtrend)
  3. **Panic** (extreme volatility, no trend)
- [ ] Adapt strategy parameters per regime
- [ ] Stress test: 2008 crisis, COVID crash, 2022 bear market

#### 5.3 Performance Metrics
- **Sharpe Ratio:** Risk-adjusted returns
- **Max Drawdown:** Largest peak-to-trough decline
- **Calmar Ratio:** Return / Max Drawdown
- **Greeks Exposure:** Time-series of Delta, Gamma, Vega
- **Win Rate:** % of profitable trades
- **Profit Factor:** Gross Profit / Gross Loss

---

### Phase 6: Risk Management System
**Goal:** Multi-dimensional risk control.

#### 6.1 Position Limits
- Max portfolio delta: ±10,000
- Max single-stock delta: ±2,000
- Max portfolio gamma: ±500
- Max portfolio vega: ±10,000

#### 6.2 Automated Hedging
- [ ] Real-time Greeks calculation
- [ ] Auto-rebalance when limits breached
- [ ] Emergency liquidation triggers

#### 6.3 VaR (Value at Risk)
- [ ] Historical VaR (95th/99th percentile)
- [ ] Parametric VaR (assuming normal distribution)
- [ ] Stress scenarios (market crashes)

---

### Phase 7: Dashboard & Visualization
**Goal:** Real-time monitoring for live trading.

#### 7.1 Core Dashboards
1. **Greeks Dashboard**
   - Real-time portfolio Greeks
   - Per-position Greeks breakdown
   - Greeks exposure over time

2. **Volatility Dashboard**
   - IV vs HV charts (per stock)
   - Volatility surface 3D plot
   - IV percentile rankings

3. **P&L Attribution**
   - P&L from delta (directional)
   - P&L from gamma (realized vol)
   - P&L from theta (time decay)
   - P&L from vega (IV changes)

4. **Execution Quality**
   - TCA metrics per trade
   - Slippage analysis
   - Fill rate statistics

#### 7.2 Alerts & Monitoring
- Slack/WhatsApp alerts for:
  - Greeks limit breaches
  - High IV/HV opportunities
  - Execution failures
  - P&L drawdowns

---

## 🎓 SIG Interview Preparation Alignment

### Technical Deep-Dives to Showcase

#### 1. Expected Value Mastery
**Example Question:** "You're selling a $50 strike call for $2 premium. Stock is at $48. What's the EV?"

**Your Answer:**
```
Delta = 0.35 → ~35% prob of ITM at expiry
EV = 0.65 × $200 (keep premium) - 0.35 × ($200 + assignment risk)
```

#### 2. Greeks Intuition
**Question:** "Your portfolio gamma is +200. What does this mean for delta as the stock moves?"

**Answer:** "For every $1 move in the underlying, my delta changes by 200 shares. Positive gamma means I'm long realized volatility – I profit from price swings."

#### 3. Market Microstructure
**Question:** "The bid-ask spread suddenly widens. What do you do?"

**Answer:** "I switch from market orders to limit orders inside the spread. Wide spread = liquidity crisis → Higher transaction costs. Wait for normalization or pay the cost if alpha is strong enough."

#### 4. Bayesian Thinking
**Question:** "Your NLP model says 'bullish' but price is falling. What's your play?"

**Answer:** "I don't trade on single signals. Bayesian update: My prior (price action) is bearish. NLP provides +0.2 sentiment. Weight is 5%. New fair value barely changes. I stay sidelined until signals align or one becomes dominant."

---

## 📊 Success Metrics (SIG-Level)

### Research Quality
- [ ] Documented theoretical edge (Why does IV-HV spread exist?)
- [ ] Bias-free backtesting (10+ years, multiple regimes)
- [ ] Out-of-sample Sharpe Ratio > 1.5

### Technical Execution
- [ ] Sub-10ms Greeks calculation (vectorized Python or C++)
- [ ] Automated hedging maintains delta ±0.1
- [ ] Average slippage < 2 bps

### Portfolio Performance
- [ ] Annualized return > 15%
- [ ] Max drawdown < 10%
- [ ] Correlation to S&P 500 < 0.3 (market-neutral proof)

---

## 🚀 Implementation Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Options Pricing | 1 week | Black-Scholes + Greeks library |
| 2. NLP Pipeline | 1 week | Claude IR feature extractor |
| 3. Strategy Core | 2 weeks | Volatility arb + EV calculator |
| 4. Execution | 1 week | TCA + Smart router |
| 5. Backtesting | 2 weeks | Regime-aware backtest results |
| 6. Risk Mgmt | 1 week | Greeks-based hedging |
| 7. Dashboard | 1 week | Live monitoring UI |
| **Total** | **9 weeks** | **Production-ready QST system** |

---

## 📁 Project Structure (New)

```
sig-quant-trader/
├── research/                    # Jupyter notebooks
│   ├── volatility_analysis.ipynb
│   ├── regime_detection.ipynb
│   └── strategy_backtest.ipynb
├── src/
│   ├── pricing/                # Options pricing engine
│   │   ├── black_scholes.py
│   │   ├── greeks.py
│   │   └── implied_vol.py
│   ├── data/                   # Alternative data pipeline
│   │   ├── ir_scraper.py
│   │   ├── nlp_extractor.py
│   │   └── bayesian_update.py
│   ├── strategy/               # Core trading logic
│   │   ├── volatility_arb.py
│   │   ├── ev_calculator.py
│   │   └── hedging.py
│   ├── execution/              # Market interface
│   │   ├── alpaca_client.py
│   │   ├── order_router.py
│   │   └── tca.py
│   ├── risk/                   # Risk management
│   │   ├── limits.py
│   │   ├── var.py
│   │   └── rebalancer.py
│   └── backtest/               # Testing framework
│       ├── engine.py
│       ├── metrics.py
│       └── regime_stress.py
├── dashboard/                  # Next.js UI (existing)
│   └── [current dashboard files]
├── tests/                      # Unit + integration tests
├── docs/                       # Research documentation
│   ├── THEORETICAL_FOUNDATION.md
│   ├── ARCHITECTURE.md
│   └── PERFORMANCE_REPORT.md
└── data/                       # Historical data cache
```

---

## 🎯 Next Steps (Immediate)

1. **Acknowledge:** Confirm this is the direction you want
2. **Priority Module:** Which to build first?
   - Option A: Pricing engine + Greeks (mathematical foundation)
   - Option B: NLP pipeline (alternative data edge)
   - Option C: Backtesting framework (validate existing ideas)
3. **Tech Stack:** Stay Python-focused or hybrid Python + C++ for pricing?

**This is a 9-week professional project that will put you in the top 5% of SIG candidates for experienced hire roles.**

Ready to start building?
