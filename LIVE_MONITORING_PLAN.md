# Live Monitoring Dashboard - Implementation Plan

## Overview
Build a real-time monitoring dashboard for VegaEdge to track live positions, P&L, Greeks, and portfolio health from Alpaca paper trading account.

**Goal:** Go from backtest-only dashboard to live trading monitor with real-time updates.

---

## Phase 1: Backend API Endpoints (2-3 hours)

### 1.1 Live Positions Endpoint
**File:** `backend/src/api/live_positions.py`

**Functionality:**
- Fetch all open positions from Alpaca
- For each position, calculate:
  - Current P&L (unrealized)
  - Entry price vs current price
  - Position size & value
  - For options: Fetch current Greeks (Delta, Gamma, Theta, Vega)
  - Days held
  - % gain/loss
  
**Response format:**
```json
{
  "positions": [
    {
      "symbol": "HOOD260306P00060000",
      "asset_type": "option",
      "underlying": "HOOD",
      "strike": 60.0,
      "expiration": "2026-03-06",
      "side": "short",
      "qty": 1,
      "entry_price": 0.40,
      "current_price": 0.31,
      "market_value": -31.0,
      "unrealized_pl": 9.0,
      "unrealized_pl_pct": 22.5,
      "days_held": 1,
      "greeks": {
        "delta": -0.15,
        "gamma": 0.02,
        "theta": 0.10,
        "vega": -0.05
      },
      "underlying_price": 77.19,
      "iv": 0.934,
      "status": "winning"
    }
  ],
  "timestamp": "2026-02-11T15:13:00Z"
}
```

### 1.2 Portfolio Metrics Endpoint
**File:** `backend/src/api/live_portfolio.py`

**Functionality:**
- Fetch Alpaca account info
- Calculate portfolio-level Greeks (sum of all positions)
- Track daily P&L
- Buying power, cash, equity

**Response format:**
```json
{
  "account": {
    "equity": 100000.00,
    "cash": 93768.00,
    "buying_power": 93768.00,
    "portfolio_value": 100009.00,
    "day_pl": 45.00,
    "day_pl_pct": 0.045
  },
  "greeks": {
    "total_delta": -0.15,
    "total_gamma": 0.08,
    "total_theta": 0.45,
    "total_vega": -0.23,
    "beta": 0.02
  },
  "positions_summary": {
    "total_positions": 2,
    "winning": 1,
    "losing": 0,
    "total_unrealized_pl": 14.00
  },
  "timestamp": "2026-02-11T15:13:00Z"
}
```

### 1.3 Trade History Endpoint (Enhanced)
**File:** Enhance existing `/api/trades`

**Add:**
- Filter by date range
- Filter by symbol
- Filter by win/loss
- Include closed P&L per trade

---

## Phase 2: Frontend Components (3-4 hours)

### 2.1 Live Positions Table Component
**File:** `frontend/src/components/LivePositionsTable.tsx`

**Features:**
- Real-time position data
- Color-coded P&L (green = profit, red = loss)
- Greeks display for options
- Sortable columns (P&L, size, days held, etc.)
- Expandable rows for detailed Greeks/info
- Status indicators (winning/losing)

**Columns:**
1. Symbol (with underlying for options)
2. Type (Call/Put/Stock)
3. Strike & Expiration
4. Qty
5. Entry Price
6. Current Price
7. Unrealized P&L ($)
8. Unrealized P&L (%)
9. Days Held
10. Greeks (collapsible)
11. Status Badge

### 2.2 Portfolio Health Card
**File:** `frontend/src/components/PortfolioHealth.tsx`

**Display:**
- Total equity (large, prominent)
- Day P&L (green/red with arrow)
- Cash available
- Buying power
- Total positions count
- Win rate (winning positions / total)

**Visual:**
- Cards with icons
- Color-coded metrics
- Trend arrows (↑↓)

### 2.3 Greeks Summary Panel
**File:** `frontend/src/components/GreeksSummary.tsx`

**Display:**
- Portfolio-level Greeks
- Visual bars showing magnitude
- Tooltips explaining each Greek
- Color coding:
  - Delta: directional exposure (neutral ≈ 0)
  - Gamma: curvature risk
  - Theta: time decay (positive = good for sellers)
  - Vega: volatility exposure
  - Beta: market correlation

### 2.4 Live Chart (Optional for Phase 2)
**File:** `frontend/src/components/LiveEquityChart.tsx`

**Display:**
- Intraday equity curve
- Updates every 5 minutes
- Shows portfolio value over the trading day
- Comparison to previous close

---

## Phase 3: Real-Time Updates (1-2 hours)

### 3.1 Auto-Refresh System
**Implementation:**
- Frontend: `setInterval` every 30-60 seconds
- Or: React Query with `refetchInterval`
- Configurable refresh rate (user preference)

### 3.2 WebSocket (Future Enhancement)
**For true real-time:**
- Alpaca WebSocket API for live quotes
- Server-Sent Events (SSE) for pushing updates
- Only implement if polling becomes insufficient

---

## Phase 4: Alert Thresholds (1 hour)

### 4.1 Client-Side Alerts
**Triggers:**
- Position P&L crosses threshold (+/- 10%, 25%, 50%)
- Portfolio daily loss exceeds X%
- Large Greek exposure (delta > 0.5, vega > 1.0)

**Implementation:**
- Browser notifications API
- Visual alerts on dashboard (toast messages)
- Audio alerts (optional)

### 4.2 Server-Side Alerts (Future)
**For production:**
- WhatsApp notifications (via OpenClaw message tool)
- Email alerts
- SMS via Twilio
- Discord webhook

---

## Phase 5: UI/UX Polish (1 hour)

### 5.1 Dashboard Layout
**Main page sections:**
1. **Header:** Portfolio Health (equity, P&L, buying power)
2. **Row 1:** Greeks Summary Panel
3. **Row 2:** Live Positions Table (main focus)
4. **Row 3:** Recent Closed Trades (last 10)
5. **Footer:** Last refresh timestamp, auto-refresh toggle

### 5.2 Styling
- Dark theme (Robinhood-inspired)
- Smooth animations for P&L changes
- Loading states for data fetch
- Error handling UI (API failures)

### 5.3 Responsive Design
- Mobile-friendly tables (collapsible columns)
- Touch-friendly buttons
- Works on tablets/phones

---

## Technical Stack

### Backend
- **Language:** Python 3.12
- **Framework:** Flask or FastAPI (already using Flask routes)
- **API Client:** Alpaca Trade API SDK
- **Greeks Calculation:** Existing Black-Scholes module
- **Data Refresh:** Cached with TTL (30-60s)

### Frontend
- **Framework:** Next.js 14 (already in place)
- **State Management:** React Query or SWR
- **Styling:** Tailwind CSS
- **Charts:** Chart.js or Recharts
- **Components:** shadcn/ui or custom

---

## Data Flow

```
Alpaca API
    ↓
Backend API (Flask)
    ↓ (REST endpoints)
Frontend (Next.js)
    ↓ (Auto-refresh every 30s)
User Dashboard
```

---

## Implementation Timeline

**Day 1 (4-5 hours):**
- Phase 1: Backend endpoints (live positions, portfolio metrics)
- Phase 2: Basic frontend components (positions table, portfolio card)

**Day 2 (3-4 hours):**
- Phase 2: Greeks panel, UI polish
- Phase 3: Auto-refresh system
- Phase 4: Basic client-side alerts

**Day 3 (1-2 hours):**
- Phase 5: Final UI/UX polish
- Testing & bug fixes
- Documentation

**Total:** ~8-10 hours

---

## Testing Strategy

### Unit Tests
- Backend: Test API endpoints with mock Alpaca data
- Frontend: Test component rendering

### Integration Tests
- End-to-end flow: Alpaca → Backend → Frontend
- Test with real paper trading account

### Manual Testing
- Monitor during market hours
- Verify Greeks calculations
- Test auto-refresh behavior
- Test alert triggers

---

## Success Metrics

**Dashboard is successful when:**
1. ✅ Shows all live positions from Alpaca in <2s
2. ✅ Greeks calculated accurately for options positions
3. ✅ Auto-refreshes every 30-60s without user action
4. ✅ P&L updates reflect real-time market prices
5. ✅ Portfolio health metrics match Alpaca account
6. ✅ UI is responsive and intuitive
7. ✅ Works reliably during market hours

---

## Future Enhancements (Post-MVP)

1. **Risk Alerts:** Email/WhatsApp notifications for large losses
2. **Position Analytics:** IV percentile, HV comparison per position
3. **Trade Journal Integration:** Annotate trades with notes
4. **Performance Attribution:** Track which strategies are winning
5. **Multi-Account Support:** Manage multiple Alpaca accounts
6. **Backtesting Comparison:** Live vs backtest performance overlay
7. **Options Chain View:** Live options chain for new entries
8. **Greeks Hedging Suggestions:** "Add X shares to neutralize delta"

---

## Files to Create/Modify

### Backend (New)
- `backend/src/api/live_positions.py`
- `backend/src/api/live_portfolio.py`
- `backend/src/data/live_greeks.py` (Greeks fetcher)

### Backend (Modify)
- `backend/src/api/routes.py` (register new endpoints)
- `backend/src/execution/alpaca_client.py` (add Greeks fetch method)

### Frontend (New)
- `frontend/src/components/LivePositionsTable.tsx`
- `frontend/src/components/PortfolioHealth.tsx`
- `frontend/src/components/GreeksSummary.tsx`
- `frontend/src/app/live/page.tsx` (new page)

### Frontend (Modify)
- `frontend/src/app/page.tsx` (add link to live dashboard)

---

## Config & Environment

### Required Alpaca API Permissions
- ✅ Account info (read)
- ✅ Positions (read)
- ✅ Orders (read)
- ✅ Market data (options quotes, Greeks)

### Environment Variables (already set)
```bash
ALPACA_API_KEY=...
ALPACA_SECRET_KEY=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

---

## Risk Considerations

### API Rate Limits
- Alpaca: 200 requests/minute (paper trading)
- Mitigation: Cache responses (30-60s TTL)

### Data Accuracy
- Greeks from Alpaca vs calculated Greeks might differ
- Use Alpaca's provided Greeks when available
- Fallback to Black-Scholes calculation

### Market Hours
- Dashboard should indicate if market is closed
- Disable auto-refresh outside market hours (save API calls)

---

## Documentation

### User Guide
- How to read the dashboard
- What each Greek means
- How to set alert thresholds

### Developer Guide
- API endpoint documentation
- Component structure
- How to add new metrics

---

**Ready to start building?** Let me know when to begin Phase 1! 🚀
