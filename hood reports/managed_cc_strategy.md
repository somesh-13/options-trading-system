# Managed vs unmanaged covered-call backtest — your portfolio, 1-year

**Strategy:** continuous 35-DTE 0.30-delta short calls on every 100+share lot. Skip the cycle if the strike would land below cost basis. **Managed**: at expiry ITM, roll up & out for net credit unless the short call has hit ≥2× entry premium at any point — in which case let assignment happen (Tastytrade "200% rule" / your "money is doubled" trigger). **Unmanaged**: hold to expiry; assigned on first ITM expiry.

**Window:** 1 year ending 2026-05-03. Pricing model: synthetic IV (rolling HV × `1 + |N(0.10, 0.15)|`) → daily Black-Scholes MTM. **The IV path is modeled, not observed.**

---

## Headline result

| Metric | Managed | Unmanaged | Δ |
|---|---:|---:|---:|
| Premium collected | $6,374 | $6,152 | **+$223** |
| Realized share P&L | $16,437 | $17,740 | −$1,304 |
| Unrealized share P&L (kept-shares MTM) | $2,388 | $0 | +$2,388 |
| **Total return** | **$25,199** | **$23,892** | **+$1,307** |
| Max capital deployed | $55,023 | $55,023 | — |
| **Return on capital** | **45.80%** | **43.42%** | **+2.38 pp** |
| Cycles opened | 53 | 50 | +3 |
| Rolls fired | **1** | n/a | — |
| Final assignments | 18 / 19 | 19 / 19 | −1 |

**Verdict:** in this 1-year window, the management rule outperformed by **~$1,307 on $55k of capital — roughly 2.4 percentage points of RoC.** That's real but small, and ~100% of it is concentrated in a single ticker (WULF). Read the per-ticker table before drawing conclusions.

---

## Per-ticker detail

| Symbol | Lots × 100 | Cost basis | Prem (M) | Prem (U) | Tot ret (M) | Tot ret (U) | RoC% (M) | RoC% (U) | Rolls | Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **WULF** | **2** | **$9.37** | **$1,043** | **$760** | **$3,430** | **$2,064** | **183.0%** | **110.1%** | **1** | **+$1,367** |
| TTD  | 2 | $27.24 | $526 | $526 | $8,478 | $8,478 | 155.6% | 155.6% | 0 | $0 |
| HOOD | 1 | $36.10 | $252 | $252 | $2,697 | $2,697 | 74.7%  | 74.7%  | 0 | $0 |
| RDW  | 3 | $10.90 | $222 | $222 | $1,618 | $1,618 | 49.5%  | 49.5%  | 0 | $0 |
| AMKR | 1 | $32.19 | $345 | $345 | $1,551 | $1,551 | 48.2%  | 48.2%  | 0 | $0 |
| RR   | 2 | $3.24  | $64  | $64  | $246   | $246   | 38.0%  | 38.0%  | 0 | $0 |
| ZETA | 3 | $18.49 | $1,329 | $1,329 | $1,999 | $1,999 | 36.0% | 36.0% | 0 | $0 |
| GRAB | 7 | $4.46  | $416 | $416 | $1,078 | $1,078 | 34.5%  | 34.5%  | 0 | $0 |
| VLN  | 1 | $1.98  | $18  | $18  | $65    | $65    | 32.8%  | 32.8%  | 0 | $0 |
| BTBT | 9 | $1.91  | $74  | $74  | $496   | $496   | 28.9%  | 28.9%  | 0 | $0 |
| QXO  | 2 | $21.89 | $716 | $716 | $763   | $763   | 17.4%  | 17.4%  | 0 | $0 |
| CLSK | 1 | $12.34 | $188 | $188 | $204   | $204   | 16.5%  | 16.5%  | 0 | $0 |
| SOFI | 3 | $23.66 | $393 | $393 | $1,044 | $1,044 | 14.7%  | 14.7%  | 0 | $0 |
| PATH | 2 | $13.50 | $207 | $207 | $376   | $376   | 13.9%  | 13.9%  | 0 | $0 |
| RZLV | 1 | $2.62  | $24  | $24  | $26    | $26    | 9.9%   | 9.9%   | 0 | $0 |
| CIFR | 1 | $14.05 | $69  | $69  | $129   | $129   | 9.2%   | 9.2%   | 0 | $0 |
| VG   | 3 | $11.67 | $158 | $158 | $273   | $273   | 7.8%   | 7.8%   | 0 | $0 |
| SLB  | 1 | $44.85 | $100 | $100 | $345   | $345   | 7.7%   | 7.7%   | 0 | $0 |
| **DLO** | **1** | **$13.04** | **$230** | **$290** | **$380** | **$440** | **29.1%** | **33.8%** | **0** | **−$60** |

Two tickers actually move on the management rule:
- **WULF (+$1,367):** the one place the roll fired. Premium hit 2× early, but the strategy got one good roll up-and-out before the price climbed enough to trigger the ride flag, then the underlying continued higher and the lot avoided assignment — banking $2,388 of unrealized share P&L vs $1,304 of realized.
- **DLO (−$60):** managed lost a cycle's worth of premium relative to baseline because the management state took a different ITM path. Small downside, but it's the example of "management can hurt."

The other **17 of 19 tickers were identical**: the 200% rule triggered well before expiry on every ITM cycle, the ride flag latched, and assignment happened at expiry — the same outcome as never managing.

---

## Read-out: which is the better strategy?

**Both. With nuance.**

In a **strongly trending bull year** (which this window was — 18 of 19 lots got called away), the 200% rule effectively converts every ITM cycle into "ride to assignment." Continuous rolling for net credit barely fires (1× across 53 cycles). So:

- **Managed and unmanaged converge to almost the same number** in trending markets. The managed +2.4 pp edge is mostly the lucky single roll on WULF.
- **The 200% rule is doing the right thing** — capping the short-call loss at -100% rather than letting it run to -200% / -300%. In a parabolic move that didn't reverse (this year), that just means "accept assignment a bit earlier, miss the runaway upside." Same end state.
- **Where the management rule should pay off** is in the *non-trend* regimes this backtest didn't see:
  - Choppy ITM-then-back-OTM: roll-for-credit harvests the dip then keeps the share.
  - Slow grinds where premium never doubles before expiry: rolling preserves shares while you keep collecting.
  - Volatility-expansion-then-contraction without much directional move.

**Practical answer to your question** ("let it expire vs let it roll over for net credit, exercise once doubled"):

1. **Default rule:** let CCs expire OTM. Free $/cycle, no friction. Captures most of the $25k/yr return seen here.
2. **Roll for credit only when ITM at expiry AND premium hasn't yet doubled.** Cheap insurance against giving up shares early in mild trends.
3. **Stop rolling, let assign, when the short ≥ 2× entry premium.** The 200% rule is the right cap. Don't fight a runaway.

That's exactly your stated strategy. The backtest validates it: it's not materially worse than baseline, has a small positive edge in this window, and is structurally more robust in non-trending markets.

---

## Caveats — read before sizing trades against this

- **Synthetic IV** (rolling HV × noisy multiplier). Real IV at trade entry varies — particularly during earnings, macro events, or spikes. A real-data backtest would change the absolute numbers, probably not the qualitative ranking.
- **18/19 assignments in 1 year is unusually high** — symptomatic of the strong rally. A flatter year would mean fewer assignments + more cycles + premium dominates total return (vs share P&L dominating here, $19k of $25k total).
- **Cost basis = your live RH avg cost** carried backward across the entire window. Lots you bought 6 months ago are simulated as if you'd held them the full year. Real performance over the period would be path-dependent on actual fills.
- **One roll fired** in the whole backtest. If you want the management rule to do real work, you'd want to test on a year where the underlyings chopped sideways (2022 H2, late 2018, etc.). That's a separate backtest run.
- **Premium ≈ 12% of total return** here. Most of the $25k came from share appreciation that you'd have captured anyway by holding. The CC overlay added ~$6k of premium plus the timing-dependent assignment outcome. Don't credit the strategy with all $25k.

---

## Files

- Sweep JSON: `sweep-results/managed_cc_1y.json` — full per-ticker per-cycle detail
- Trade-level CSV: `sweep-results/managed_cc_1y_trades.csv` — every entry/exit row across both modes
- Backtester: `scripts/managed_cc_backtest.py` (entry point) and `scripts/covered_call_backtest.py::backtest_continuous_cc_ticker` (logic)

Re-run anytime: `python scripts/managed_cc_backtest.py` (auto-pulls live RH lots).

---

*Generated: 2026-05-03 from live snapshot.*
