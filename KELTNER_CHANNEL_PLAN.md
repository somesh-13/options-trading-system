# Keltner Channel + VegaEdge Integration Plan
**Branch:** `add_technicalAnalysis`  
**Created:** 2026-02-14  
**Status:** PLANNING PHASE

---

## 🎯 Objective

Integrate **Keltner Channel** technical analysis (weekly timeframe) with VegaEdge IV/HV system to automate:
1. **Cash-Secured Put** signals at channel bottom (buy opportunities)
2. **Covered Call** signals at channel top (sell opportunities)
3. Only execute when **IV spike detected** (VegaEdge confirmation)

---

## 📊 Keltner Channel Overview

**What it is:**
- Volatility-based channel indicator
- 3 lines: Middle (20-day EMA), Upper band, Lower band
- Bands = Middle ± (2 × ATR) — Average True Range

**Weekly timeframe:**
- Each candle = 1 week of price action
- Smooths out daily noise
- Better for swing/position trading

**Signals:**
- **Bottom of channel** = potential support, oversold → BUY PUTS or BUY STOCK
- **Top of channel** = potential resistance, overbought → SELL CALLS

---

## 🏗️ Implementation Plan

### 1. Data Collection Module
**File:** `lib/keltner_channel.py`

**Functions:**
```python
def get_weekly_data(symbol, weeks=52):
    """Fetch weekly OHLC data from Alpaca (1 year)"""
    # Use Alpaca Bars API with timeframe='1W'
    pass

def calculate_ema(prices, period=20):
    """Calculate Exponential Moving Average"""
    pass

def calculate_atr(high, low, close, period=20):
    """Calculate Average True Range"""
    pass

def calculate_keltner_channel(symbol, multiplier=2.0):
    """
    Calculate Keltner Channel for weekly data
    Returns: {
        'middle': EMA-20,
        'upper': EMA + (2 × ATR),
        'lower': EMA - (2 × ATR),
        'current_price': latest close,
        'position': 'BOTTOM'|'TOP'|'MIDDLE'
    }
    """
    pass
```

**Dependencies:**
- `pandas` (data manipulation)
- `numpy` (calculations)
- Alpaca API (weekly bars)

---

### 2. Position Detection Logic
**File:** `lib/channel_signals.py`

**Functions:**
```python
def detect_channel_position(price, upper, lower, threshold=0.05):
    """
    Determine if price is at top, bottom, or middle of channel
    
    Args:
        price: Current stock price
        upper: Upper Keltner band
        lower: Lower Keltner band
        threshold: % from band to trigger (default 5%)
    
    Returns:
        'BOTTOM' if within 5% of lower band
        'TOP' if within 5% of upper band
        'MIDDLE' otherwise
    """
    band_width = upper - lower
    bottom_zone = lower + (band_width * threshold)
    top_zone = upper - (band_width * threshold)
    
    if price <= bottom_zone:
        return 'BOTTOM'
    elif price >= top_zone:
        return 'TOP'
    else:
        return 'MIDDLE'

def should_sell_put(position, iv_hv_ratio, iv_percentile):
    """
    Determine if we should SELL cash-secured puts
    
    Criteria:
    - Price at BOTTOM of channel (support)
    - IV spike detected (IV/HV > 1.3 or IV > 80th percentile)
    
    Returns: bool, reason
    """
    if position != 'BOTTOM':
        return False, "Not at channel bottom"
    
    if iv_hv_ratio < 1.3 and iv_percentile < 80:
        return False, "No IV spike detected"
    
    return True, f"Bottom + IV spike (IV/HV={iv_hv_ratio:.2f})"

def should_sell_call(position, iv_hv_ratio, iv_percentile, has_shares=True):
    """
    Determine if we should SELL covered calls
    
    Criteria:
    - Price at TOP of channel (resistance)
    - IV spike detected (IV/HV > 1.3 or IV > 80th percentile)
    - Must own shares (covered call requirement)
    
    Returns: bool, reason
    """
    if position != 'TOP':
        return False, "Not at channel top"
    
    if not has_shares:
        return False, "No shares to cover the call"
    
    if iv_hv_ratio < 1.3 and iv_percentile < 80:
        return False, "No IV spike detected"
    
    return True, f"Top + IV spike (IV/HV={iv_hv_ratio:.2f})"

def should_buy_leaps(iv_hv_ratio, iv_percentile, position=None):
    """
    Determine if we should BUY long-dated calls (LEAPs)
    
    Criteria:
    - IV extremely cheap (IV/HV < 0.8)
    - IV in bottom 20% historically (IV percentile < 20)
    - Bonus: Price at Keltner bottom (technical support)
    
    Returns: bool, reason, suggested_discount (%)
    """
    if iv_hv_ratio >= 0.8:
        return False, "IV not cheap enough (need <0.8)", None
    
    if iv_percentile >= 20:
        return False, "IV not in bottom 20%", None
    
    # Determine discount for limit orders based on how cheap IV is
    if iv_hv_ratio < 0.6:
        discount = 0.20  # 20% below ask if IV super cheap
    elif iv_hv_ratio < 0.7:
        discount = 0.15  # 15% below ask
    else:
        discount = 0.10  # 10% below ask
    
    reason = f"IV extremely cheap (IV/HV={iv_hv_ratio:.2f}, {iv_percentile}th percentile)"
    
    if position == 'BOTTOM':
        reason += " + Price at Keltner support"
        discount += 0.05  # Extra 5% discount if at support
    
    return True, reason, discount
```

---

### 3. Integration with Existing VegaEdge Alerts
**File:** `vegaedge_daily_alerts.py` (UPDATE)

**New logic flow:**
```python
# For each stock in watchlist:
for symbol in ['HOOD', 'CIFR', 'WULF', 'PYPL', 'GRAB']:
    # 1. Existing VegaEdge checks
    iv_hv_ratio = get_iv_hv_ratio(symbol)
    iv_percentile = get_iv_percentile(symbol)
    hv_percentile = get_hv_percentile(symbol)
    
    # 2. NEW: Keltner Channel analysis
    keltner = calculate_keltner_channel(symbol)
    position = keltner['position']  # 'BOTTOM'|'TOP'|'MIDDLE'
    
    # 3. Check for actionable signals
    sell_put, put_reason = should_sell_put(position, iv_hv_ratio, iv_percentile)
    sell_call, call_reason = should_sell_call(position, iv_hv_ratio, iv_percentile)
    buy_leap, leap_reason, discount = should_buy_leaps(iv_hv_ratio, iv_percentile, position)
    
    # 4. Add to alerts
    if sell_put:
        alerts.append({
            'type': 'SELL_PUT_SIGNAL',
            'symbol': symbol,
            'reason': put_reason,
            'keltner_lower': keltner['lower'],
            'current_price': keltner['current_price']
        })
    
    if sell_call:
        alerts.append({
            'type': 'SELL_CALL_SIGNAL',
            'symbol': symbol,
            'reason': call_reason,
            'keltner_upper': keltner['upper'],
            'current_price': keltner['current_price']
        })
    
    if buy_leap:
        # Get LEAP pricing for 1.5-2 year expirations
        leap_data = get_leap_pricing(symbol, years_out=[1.5, 2.0])
        alerts.append({
            'type': 'BUY_LEAP_SIGNAL',
            'symbol': symbol,
            'reason': leap_reason,
            'iv_hv_ratio': iv_hv_ratio,
            'discount_pct': discount * 100,
            'leap_options': leap_data,
            'keltner_position': position
        })
```

---

### 4. Alert Message Format
**WhatsApp output:**

```
🚨 VEGAEDGE ALERT - 2026-02-XX

📊 HOOD - $75.00
Keltner Position: BOTTOM 🟢
Lower Band: $72.00 | Middle: $85.00 | Upper: $98.00

🎯 SIGNAL: SELL CASH-SECURED PUT
• Price at channel support (-4.2% from lower band)
• IV spike detected: IV/HV = 1.85
• Premium opportunity: High IV + Technical support

Suggested strikes: $70, $65, $60 (weekly or monthly)

----------------------------------------

📊 CIFR - $22.50
Keltner Position: TOP 🔴
Lower Band: $14.00 | Middle: $18.25 | Upper: $22.50

🎯 SIGNAL: SELL COVERED CALL
• Price at channel resistance (at upper band)
• IV spike detected: IV/HV = 2.10
• Premium opportunity: High IV + Technical resistance

⚠️ Requires: Must own CIFR shares for covered call
Suggested strikes: $23, $24, $25 (weekly or monthly)
```

---

## 🔧 Technical Specifications

### Keltner Channel Parameters
- **Timeframe:** Weekly (1W bars)
- **EMA Period:** 20 weeks
- **ATR Period:** 20 weeks
- **Multiplier:** 2.0 (default, can adjust to 1.5 or 2.5)
- **Threshold:** 5% proximity to bands triggers signal

### IV Spike Criteria
**Combined with Keltner for confirmation:**
- IV/HV ratio > 1.3, OR
- IV percentile > 80th

**Why combine?**
- Keltner alone = just price position
- VegaEdge alone = just volatility mispricing
- **Together = high-probability setup:**
  - Price at support/resistance (Keltner)
  - Options overpriced (VegaEdge IV spike)
  - Perfect for selling premium

---

## 📈 Strategy Logic

### Sell Cash-Secured Put (at channel BOTTOM)
**When:**
- Price touches/bounces off lower Keltner band
- IV spike present (IV/HV > 1.3)

**Why it works:**
- Lower band = technical support
- IV spike = puts are overpriced
- If assigned, buying at support level (good entry)
- If expires worthless, keep premium

**Risk:**
- Price breaks through support (rare on weekly TF)
- Mitigation: Only sell 25-30% OTM puts

---

### Sell Covered Call (at channel TOP)
**When:**
- Price touches/bounces off upper Keltner band
- IV spike present (IV/HV > 1.3)
- **Must own shares** (covered requirement)

**Why it works:**
- Upper band = technical resistance
- IV spike = calls are overpriced
- If called away, selling at resistance (good exit)
- If expires worthless, keep premium + shares

**Risk:**
- Price breaks through resistance (bull run)
- Mitigation: Only sell slightly OTM calls, or accept assignment

---

## 🛠️ Implementation Steps

### Phase 1: Core Functions (Week 1)
- [ ] Create `lib/keltner_channel.py`
- [ ] Implement weekly data fetching (Alpaca)
- [ ] Calculate EMA-20, ATR-20, bands
- [ ] Test on historical data (HOOD, PYPL)

### Phase 2: Signal Logic (Week 1)
- [ ] Create `lib/channel_signals.py`
- [ ] Implement position detection
- [ ] Implement `should_sell_put()` logic
- [ ] Implement `should_sell_call()` logic
- [ ] Implement `should_buy_leaps()` logic (IV < 0.8 trigger)
- [ ] Add LEAP pricing fetcher (1.5-2 year expirations)
- [ ] Calculate limit order prices (discount logic)
- [ ] Unit tests for edge cases

### Phase 3: VegaEdge Integration (Week 2)
- [ ] Update `vegaedge_daily_alerts.py`
- [ ] Add Keltner checks to main loop
- [ ] Format new alert messages
- [ ] Test with mock data

### Phase 4: Backtesting (Week 2)
- [ ] Create `backtest_keltner_vegaedge.py`
- [ ] Test on HOOD crash ($153→$78)
- [ ] Test on PYPL crash ($93→$40)
- [ ] Measure signal accuracy

### Phase 5: Production Deploy (Week 3)
- [ ] Run on paper trading first
- [ ] Monitor alerts for 1 week
- [ ] Tune threshold parameters
- [ ] Deploy to live cron jobs

---

## 📊 Expected Outcomes

### Signals per month (estimate):
- **5 stocks monitored**
- **Weekly timeframe** = ~4 candles/month
- **Estimated signals:**
  - 2-4 premium selling signals/month (puts/calls at bands)
  - 1-3 LEAP buying signals/month (when IV < 0.8)
  - Total: 3-7 actionable setups/month

### Signal quality:
- **High conviction:** Both technical + volatility confirmation
- **Reduced noise:** Weekly TF filters out daily chop
- **Actionable:** Clear entry/exit levels (Keltner bands)
- **LEAP timing:** Only triggers during extreme IV cheapness (rare but high-value)

### Signal types breakdown:
1. **Sell CSP:** Bottom of channel + IV spike (premium collection)
2. **Sell Covered Call:** Top of channel + IV spike (premium collection)
3. **Buy LEAP:** IV extremely cheap (long-term positioning with limit orders)

---

## ⚠️ Risks & Mitigations

### Risk 1: False breakouts
**Problem:** Price briefly touches band, then reverses
**Mitigation:** 
- Require 5% proximity (not exact touch)
- Check volume confirmation
- Require IV spike (not just channel position)

### Risk 2: Trending markets
**Problem:** Strong trend ignores channel bounds
**Mitigation:**
- Don't fight the trend (check ADX/trend strength)
- Use wider channels in high volatility (adjust multiplier)

### Risk 3: Data quality
**Problem:** Weekly bars require clean data
**Mitigation:**
- Use Alpaca (reliable source)
- Validate data before calculations
- Log errors for debugging

---

### Sell Covered Call (at channel TOP)
**When:**
- Price touches/bounces off upper Keltner band
- IV spike present (IV/HV > 1.3)
- **Must own shares** (covered requirement)

**Why it works:**
- Upper band = technical resistance
- IV spike = calls are overpriced
- If called away, selling at resistance (good exit)
- If expires worthless, keep premium + shares

**Risk:**
- Price breaks through resistance (bull run)
- Mitigation: Only sell slightly OTM calls, or accept assignment

---

### Buy LEAPs (when IV is CHEAPEST)
**When:**
- IV/HV ratio < 0.8 (options severely underpriced)
- IV percentile < 20th (IV in bottom 20% historically)
- Optional: Price near Keltner bottom (double confirmation)

**Why it works:**
- Buying options when they're historically cheap
- Long time horizon (1.5-2 years) absorbs volatility
- Profit from IV expansion + price movement

**Execution Strategy:**
1. **Monitor cheapest IV moments:**
   - Track IV/HV daily for all 5 stocks
   - Alert when IV/HV < 0.8 (like Feb 13: HOOD, CIFR, PYPL all < 0.8)

2. **Place "abnormally cheap" limit orders:**
   - **1.5-2 year expiration** (Jan 2026 or Jan 2027 LEAPs)
   - **Strike selection:** ATM or slightly OTM for best leverage
   - **Limit price:** Set BELOW current ask (e.g., -10% to -20%)
   - **Good-til-canceled (GTC):** Leave orders open for fills during dips

3. **Example:**
   - HOOD at $73, Jan 2028 $75 calls trading at $12
   - Place limit order at $10.80 (10% below ask)
   - If filled during a panic sell-off, you got an even better deal

**Benefits of Limit Orders:**
- **Patient capital:** Only fill at your price
- **Catch flash crashes:** Filled during brief liquidity events
- **No FOMO:** Systematic, unemotional entries
- **Better cost basis:** -10-20% cheaper than market price

**Risk Management:**
- **Position sizing:** Only allocate 10-20% of capital to LEAPs
- **Diversification:** Spread across multiple stocks
- **Time decay:** LEAPs lose value slowly, but still decay
- **Mitigation:** 1.5-2 years gives plenty of time for thesis to play out

**Alert Logic:**
```python
def should_buy_leaps(iv_hv_ratio, iv_percentile, keltner_position=None):
    """
    Determine if we should BUY long-dated calls (LEAPs)
    
    Criteria:
    - IV extremely cheap (IV/HV < 0.8)
    - IV in bottom 20% historically
    - Bonus: Price at Keltner bottom (technical support)
    
    Returns: bool, reason, limit_order_price
    """
    if iv_hv_ratio >= 0.8:
        return False, "IV not cheap enough", None
    
    if iv_percentile >= 20:
        return False, "IV not in bottom 20%", None
    
    # Calculate limit order price (15% below current ask)
    current_ask = get_leap_ask_price(symbol, expiration='2026-01-16', strike='ATM')
    limit_price = current_ask * 0.85  # 15% discount
    
    reason = f"IV extremely cheap (IV/HV={iv_hv_ratio:.2f}, {iv_percentile}th percentile)"
    
    if keltner_position == 'BOTTOM':
        reason += " + Price at technical support (Keltner bottom)"
    
    return True, reason, limit_price
```

**WhatsApp Alert Example:**
```
🚨 LEAP BUY SIGNAL - HOOD

Current Price: $73.44
IV/HV: 0.65 (extremely cheap!)
IV Percentile: 12th (bottom 12% historically)
Keltner Position: BOTTOM 🟢

🎯 RECOMMENDED LEAP:
Jan 2028 $75 Call (ATM)
Current Ask: $12.00
Suggested Limit: $10.20 (15% discount)

📋 ACTION:
Place GTC limit order at $10.20
Expiration: Jan 21, 2028 (2 years)
Profit if HOOD > $85.20 at expiration

💡 Why: Options are cheap + price at support
⏰ Time Value: 2 years to work out
```

---

## 🔄 Future Enhancements

1. **Dynamic channel width:**
   - Adjust multiplier based on volatility regime
   - Tighter bands in low vol, wider in high vol

2. **Multiple timeframes:**
   - Check daily + weekly alignment
   - Stronger signals when both agree

3. **Position sizing:**
   - Larger positions when signal stronger
   - Factor in IV percentile rank

4. **Stop-loss integration:**
   - Auto-close if price breaks channel by X%

5. **Earnings calendar:**
   - Avoid signals before earnings (IV spike from event risk)

---

## 📝 Notes

- **Keltner vs Bollinger:** Using Keltner (ATR-based) instead of Bollinger (StdDev-based) because it's more stable and less reactive to outliers
- **Weekly TF rationale:** Reduces noise, better for swing trading options (20-60 DTE)
- **IV spike requirement:** Prevents selling premium when options are already cheap
- **Covered call limitation:** Only suggests if user owns shares (can't determine programmatically without portfolio API)
- **LEAP limit orders:** "Abnormally cheap" orders (10-25% below ask) placed GTC for 1.5-2 years out. Catch panic sells and flash crashes. Patient capital only fills at desired price.
- **LEAP expiration targets:** Jan 2026 (1.5 years) or Jan 2027/2028 (2+ years) - maximize time value while keeping costs reasonable
- **Discount tiers:** 10% discount (IV/HV 0.7-0.8), 15% (0.6-0.7), 20% (< 0.6), +5% if at Keltner bottom

---

## ✅ Success Criteria

1. **Accuracy:** >70% of signals result in profitable trades
2. **Frequency:** 2-4 actionable signals/month
3. **Integration:** Seamless addition to existing VegaEdge alerts
4. **Performance:** <5s additional runtime for Keltner calculations
5. **User feedback:** Clear, actionable alert messages

---

**Status:** PLAN COMPLETE — Ready for implementation approval
**Next Step:** Review plan, then begin Phase 1 (Core Functions)
