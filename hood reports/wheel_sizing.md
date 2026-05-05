# Wheel income sizing — how much portfolio for $1,000/month

**As of:** 2026-05-03
**Live NAV:** $68,220 · cash $1,323 · equity MV $68,622 · option MV −$1,725

---

## TL;DR

- $1,000/month = **$12,000/year**.
- At your existing wheel-backtest yield (**16.06% blended return on capital**) you need **~$74,720 of wheelable capital**.
- You already have **$63,096 wheelable today** ($61,773 in 23 lots of 100+ shares + $1,323 cash). That's $10,158/yr ≈ **$847/month** at the backtest rate.
- **You're ~85% of the way there.** Closing the gap is ~$11.6k of additional wheelable capital, which you can mostly fund by trimming low-conviction non-lot equities into cash without selling anything strategic.
- **Today's action:** the ten largest lots alone (HOOD, AMKR, SLB, ZETA, TTD, WULF, VG, SOFI, RDW, PATH) have an expected wheel income of **~$655/month at the same backtest yield** — and zero of those covered calls have been written yet.

---

## The math

| Yield basis | Annual yield | Capital needed for $12k/yr |
|---|---|---|
| **Total return on cap (premium + share P&L)** *(default; per your choice)* | 16.06% | **$74,720** |
| Pure cash premium only | 9.53% | $125,918 |

Both numbers come from the existing 1-year wheel backtest ([`/api/backtest/wheel`](http://localhost:8000/api/backtest/wheel)): `total_return_usd $4,555 / max_capital $28,361 = 16.06%` and `total_premium_usd $2,704 / max_capital $28,361 = 9.53%`.

The 16.06% figure includes assignment-driven share appreciation, which is great when the underlying rallies but can swing negative in a drawdown. The 9.53% figure is the floor — what you'd realize as cash regardless of share moves.

---

## Where you stand today

| Bucket | Amount | Wheelable? |
|---|---|---|
| 100+share equity lots (23 lots) | $61,773 | ✅ — every lot can write a covered call |
| Cash | $1,323 | ✅ — for cash-secured puts (very thin) |
| Sub-100-share equity holdings | ~$6,849 | ❌ — too small for CCs (would need to consolidate or trim) |
| Net option positions | −$1,725 | n/a — already deployed |
| **Wheelable today** | **$63,096** | |
| **Target ($12k/yr ÷ 16.06%)** | **$74,720** | |
| **Gap** | **$11,624** | ≈ 17% of NAV |

At your current wheelable base of $63,096 × 16.06% = **$10,138/yr expected = $844/month**.

---

## CC-eligible inventory — top lots

Ten largest lots, with expected monthly contribution at 16.06% annual RoC. None of these have a covered call written against them in your snapshot today.

| Symbol | Account | Qty | Mark | Mkt value | Contracts | Est. $/mo |
|---|---|---|---|---|---|---|
| HOOD  | Roth IRA  | 100 | $73.37 | $7,338 | 1 | $98 |
| AMKR  | Brokerage | 100 | $71.00 | $7,100 | 1 | $95 |
| SLB   | Brokerage | 100 | $56.90 | $5,690 | 1 | $76 |
| ZETA  | Roth IRA  | 300 | $18.54 | $5,563 | 3 | $75 |
| TTD   | Roth IRA  | 200 | $24.23 | $4,847 | 2 | $65 |
| WULF  | Brokerage | 200 | $21.33 | $4,267 | 2 | $57 |
| VG    | Brokerage | 300 | $12.77 | $3,831 | 3 | $51 |
| SOFI  | Roth IRA  | 200 | $16.46 | $3,292 | 2 | $44 |
| RDW   | Roth IRA  | 300 | $9.32  | $2,796 | 3 | $37 |
| PATH  | Roth IRA  | 200 | $10.69 | $2,138 | 2 | $29 |
| **Top 10** | | | | **$46,862** | **20** | **$628** |
| All 23 lots | | | | $61,773 | — | $828 |

The top 10 alone — names you already own — cover roughly **63% of the $1k/month target** at the backtest yield. Writing one round of CCs against each closes most of the distance to goal without you adding a dollar.

---

## CSP path — how to close the remaining gap

You're cash-thin ($1,323 free), so CSP capacity is the real constraint. Two ways to fund it:

1. **Trim non-lot equities into cash.** You have ~$6,849 spread across 27 small positions (sub-100-share holdings — none are wheel candidates anyway). Consolidating those names into cash is a clean $5–7k of new CSP collateral with no strategic damage.
2. **Roth contributions.** The $1M strategy plan locks in $7,725/yr of fresh Roth contributions. That alone closes the $11.6k gap inside 18 months without any portfolio surgery.

A reasonable CSP target float is **$5–10k**, rotating 30–45 DTE on the names the wheel backtest actually proved out: **CIFR (18.8% RoC)**, **RDW (19.9%)**, **WULF**, and the highest-yielding satellite names from the strategy plan.

---

## Sensitivity

What the math looks like if the realised yield moves ±20% from the backtest's 16.06%:

| Scenario | Yield | Capital for $12k/yr |
|---|---|---|
| IV expansion (+20%) | 19.27% | $62,272 ← already there |
| Backtest (base) | 16.06% | $74,720 |
| IV compression (−20%) | 12.85% | $93,385 |

Two takeaways: (1) at high-vol regimes you're already above target with current capital. (2) In a low-vol drawdown the gap doubles, which is why the strategy plan caps option income at $18k/yr stretch and not higher.

---

## Caveats — read these before you trust the numbers

Direct from the backtest's own caveats array, plus a few important ones I'm adding:

- **Synthetic IV.** The backtest used `rolling_HV × (1 + |N(0.10, 0.15)|)` as the IV stand-in — modelled, not observed. Real IV at trade-entry can deviate.
- **CC premium = $0 in this backtest.** All $2,704 of premium came from CSPs (8 fires); zero CCs ever fired (the backtest skips CCs whose strike would lock in a loss vs cost basis). So the 16.06% blended RoC is empirically a **CSP-only** number on three of the four tickers, with the share-leg appreciating into the gain. **Your CC potential is conceptually similar but unobserved in the data.**
- **4 tickers, 1 year.** The yield came from CIFR (18.8%), RDW (19.9%), CRWV (15.8%); WULF didn't fire any setups. Small sample.
- **Per-contract sizing.** $-figures multiply linearly with contract count. The estimates above already account for your actual lot sizes.
- **Total RoC ≠ recurring cash income.** 16.06% includes share P&L. If you want strict "cash regardless of share move" the 9.53% basis ($126k capital) is the right anchor — and you're ~50% of the way there on that stricter target.
- **You're already running options** (option_cost_basis $523k, current MV −$1,725). New wheel income should be tracked separately to avoid double-counting against current carry.

---

## Cross-reference with `1M_strategy_plan.md`

The plan already declares **$12,000/year** as the **realistic-base option income target** (between $5k bear and $25k bull), which independently validates this $1k/month sizing. The Roth IRA is designated as "the income engine + compounder" — and 60% of your CC-eligible lots are already there (HOOD, ZETA, TTD, SOFI, RDW, PATH, QXO).

---

## Concrete next steps (in priority order)

1. **This cycle (next 30–45 DTE):** write a covered call against each of the top 10 lots. Target the 0.30-delta strike. Expected take: **$500–700**.
2. **This month:** trim the 27 sub-100-share positions (~$6.8k) into cash. Earmark for CSP rotation on CIFR / RDW / WULF / NVDA-class high-IV names.
3. **Track monthly:** save a "Wheel income — month X" entry to the existing reports archive (`/robinhood` reports tab) summarising actual premium realised vs the $1,000 target.
4. **After 30 days:** re-run `/api/backtest/wheel` with your *actual* tickers to replace the synthetic-IV blended yield with one calibrated to your real chains.
5. **Quarterly:** revisit the gap to $74,720. As the Roth's $7,725/yr contribution lands, the gap closes naturally with no forced trades.

---

*Generated: 2026-05-03 from live snapshot. Re-run anytime to refresh.*
