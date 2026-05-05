#!/usr/bin/env python
"""1-year SELL_COVERED_CALL backtest with 60% premium-decay exit.

Entry gate per daily bar: Keltner=TOP AND IV/HV > 1.3.
On entry: short a 28-DTE call at the strike whose BS delta is closest to +0.30.
Daily mark-to-market with Black-Scholes using rolling synthetic IV.
Exit when modeled mid <= (1 - decay_pct) * entry_premium, or at expiry.

Reuses calculate_keltner_channel from backend/src/backtest/keltner_strategy.py.
The IV used is *synthetic* (rolling realized vol + small noise) because the repo
has no historical option chain data — same model the existing backtest engine
uses. Numbers are modeled, not observed.

Usage:
    python scripts/covered_call_backtest.py
    python scripts/covered_call_backtest.py --tickers RDW WULF CIFR --years 1
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm
from zoneinfo import ZoneInfo

NY_TZ = ZoneInfo("America/New_York")


def market_close_iso(d: date) -> str:
    """Stamp a daily-bar date with the 16:00 America/New_York close."""
    return datetime(d.year, d.month, d.day, 16, 0, tzinfo=NY_TZ).isoformat()

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend" / "src"))
from backtest.keltner_strategy import calculate_keltner_channel  # noqa: E402


# ---------------------------------------------------------------------------
# Pricing primitives
# ---------------------------------------------------------------------------


def bs_call(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0:
        return max(S - K, 0.0)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)


def bs_call_delta(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0:
        return 1.0 if S > K else 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return float(norm.cdf(d1))


def bs_put(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0:
        return max(K - S, 0.0)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def bs_put_delta(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0:
        return -1.0 if S < K else 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return float(norm.cdf(d1) - 1.0)


def pick_put_strike_for_delta(spot: float, iv: float, dte_days: int, target_delta: float, r: float) -> float:
    """Search OTM puts (strikes below spot). target_delta should be negative, e.g. -0.30."""
    T = dte_days / 365.0
    grid = 0.5 if spot >= 20 else 0.10
    candidates = np.arange(max(grid, spot * 0.5), spot + grid, grid)
    best = None
    best_diff = math.inf
    for K in candidates:
        if K <= 0:
            continue
        d = bs_put_delta(spot, float(K), T, r, iv)
        diff = abs(d - target_delta)
        if diff < best_diff:
            best_diff = diff
            best = float(K)
    return best if best is not None else round(spot * 0.95, 2)


def pick_strike_for_delta(spot: float, iv: float, dte_days: int, target_delta: float, r: float) -> float:
    """Sweep candidate strikes from 1.00x to 1.50x spot, return the one whose BS
    delta is closest to target. 0.5-cent grid for low-priced names, 0.50-dollar
    grid for higher-priced names — keeps the search bounded and realistic.
    """
    T = dte_days / 365.0
    grid = 0.5 if spot >= 20 else 0.10
    candidates = np.arange(spot, spot * 1.6 + grid, grid)
    best = None
    best_diff = math.inf
    for K in candidates:
        if K <= 0:
            continue
        d = bs_call_delta(spot, float(K), T, r, iv)
        diff = abs(d - target_delta)
        if diff < best_diff:
            best_diff = diff
            best = float(K)
    return best if best is not None else round(spot * 1.05, 2)


# ---------------------------------------------------------------------------
# Data + indicators
# ---------------------------------------------------------------------------


def fetch_history(ticker: str, calendar_days: int) -> pd.DataFrame:
    end = datetime.utcnow().date()
    start = end - timedelta(days=calendar_days)
    df = yf.Ticker(ticker).history(start=start.isoformat(), end=end.isoformat(), auto_adjust=False)
    if df.empty:
        raise RuntimeError(f"yfinance returned no rows for {ticker}")
    df = df.rename(columns={c: c.lower() for c in df.columns})
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    return df[["open", "high", "low", "close", "volume"]].copy()


def compute_realized_vol(close: pd.Series, window: int, bars_per_year: int) -> pd.Series:
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(window).std() * math.sqrt(bars_per_year)


def to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample daily OHLCV to weekly bars (Friday close)."""
    out = df.resample("W-FRI").agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
    }).dropna()
    return out


def compute_synthetic_iv(hv: pd.Series, noise_factor: float = 0.15, seed: int = 42) -> pd.Series:
    """Mirrors backend/src/backtest/engine.py:75-83 but seed-pinned for repro."""
    rng = np.random.default_rng(seed)
    premium = 1.0 + np.abs(rng.normal(0.10, noise_factor, len(hv)))
    return hv * premium


def annotate(df: pd.DataFrame, *, hv_window: int, bars_per_year: int) -> pd.DataFrame:
    df = calculate_keltner_channel(df.copy())
    df["hv_30"] = compute_realized_vol(df["close"], window=hv_window, bars_per_year=bars_per_year)
    df["iv_synth"] = compute_synthetic_iv(df["hv_30"].bfill())
    df["iv_hv"] = df["iv_synth"] / df["hv_30"]
    return df


# ---------------------------------------------------------------------------
# Strategy state machine
# ---------------------------------------------------------------------------


@dataclass
class Trade:
    ticker: str
    strategy: str            # "covered_call" or "csp"
    entry_date: str
    entry_time: str          # ISO datetime, America/New_York 16:00 ET
    entry_spot: float
    strike: float
    entry_dte: int
    entry_iv: float
    entry_premium: float
    entry_delta: float
    exit_date: Optional[str] = None
    exit_time: Optional[str] = None        # ISO datetime
    exit_spot: Optional[float] = None
    exit_premium: Optional[float] = None
    exit_reason: Optional[str] = None
    days_held: Optional[int] = None
    pnl_usd: Optional[float] = None        # cash P&L on the option leg, per contract
    opp_cost_usd: Optional[float] = None   # upside/downside surrendered (covered_call: above strike; csp: below strike)
    assigned: Optional[bool] = None        # CSP only — was the put exercised against us?
    shares_after: Optional[int] = None     # CSP only — running share inventory after this trade


@dataclass
class TickerResult:
    ticker: str
    strategy: str
    bar_count: int
    keltner_top_bars: int
    keltner_bottom_bars: int
    gate_fires: int
    fired_no_position: int
    fired_capped: int           # CSP only — gate fired but inventory at cap
    trade_count: int
    wins: int
    losses: int
    exercised_count: int        # covered_call: shares called away; csp: shares assigned to us
    total_pnl_usd: float
    avg_pnl_per_trade: float
    avg_holding_days: float
    win_rate: float
    total_opp_cost_usd: float
    final_share_inventory: int  # CSP/wheel: ending share count; covered_call: 0
    trades: List[dict] = field(default_factory=list)
    wheel: Optional[dict] = None  # wheel-only aggregates


def backtest_ticker(
    ticker: str,
    df: pd.DataFrame,
    *,
    decay_pct: float,
    dte_target: int,
    delta_target: float,
    iv_hv_gate: float,
    r: float,
) -> TickerResult:
    df = df.dropna(subset=["hv_30", "iv_synth", "keltner_position"]).copy()
    trades: List[Trade] = []
    state = "FLAT"
    open_trade: Optional[Trade] = None
    open_expiry: Optional[date] = None
    fires = 0
    fired_no_position = 0

    bars = list(df.itertuples())
    for i, bar in enumerate(bars):
        bar_date = bar.Index.date()
        spot = float(bar.close)
        iv_now = float(bar.iv_synth)
        keltner = bar.keltner_position
        iv_hv = float(bar.iv_hv)

        if state == "FLAT":
            if keltner == "TOP" and iv_hv > iv_hv_gate:
                fires += 1
                strike = pick_strike_for_delta(spot, iv_now, dte_target, delta_target, r)
                T = dte_target / 365.0
                entry_premium = bs_call(spot, strike, T, r, iv_now)
                entry_delta = bs_call_delta(spot, strike, T, r, iv_now)
                if entry_premium <= 0.01:
                    continue
                open_trade = Trade(
                    ticker=ticker,
                    strategy="covered_call",
                    entry_date=bar_date.isoformat(),
                    entry_time=market_close_iso(bar_date),
                    entry_spot=spot,
                    strike=strike,
                    entry_dte=dte_target,
                    entry_iv=iv_now,
                    entry_premium=entry_premium,
                    entry_delta=entry_delta,
                )
                open_expiry = bar_date + timedelta(days=dte_target)
                state = "OPEN"
        else:
            if keltner == "TOP" and iv_hv > iv_hv_gate:
                fired_no_position += 1
            assert open_trade is not None and open_expiry is not None
            days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
            dte_now = (open_expiry - bar_date).days

            exit_reason: Optional[str] = None
            exit_premium: float = 0.0
            opp_cost: float = 0.0

            if dte_now <= 0:
                if spot > open_trade.strike:
                    # Let it exercise. Shares called away at strike — we keep the full
                    # entry premium. Cash P&L on the option leg is unambiguously positive.
                    exit_reason = "EXERCISED"
                    exit_premium = 0.0
                    opp_cost = (spot - open_trade.strike) * 100.0
                else:
                    exit_reason = "EXPIRED_OTM"
                    exit_premium = 0.0
            else:
                T_now = dte_now / 365.0
                mtm = bs_call(spot, open_trade.strike, T_now, r, iv_now)
                if mtm <= open_trade.entry_premium * (1.0 - decay_pct):
                    exit_reason = "DECAY"
                    exit_premium = mtm
                else:
                    exit_reason = None  # keep holding

            if exit_reason is not None:
                pnl = (open_trade.entry_premium - exit_premium) * 100.0
                open_trade.exit_date = bar_date.isoformat()
                open_trade.exit_time = market_close_iso(bar_date)
                open_trade.exit_spot = spot
                open_trade.exit_premium = exit_premium
                open_trade.exit_reason = exit_reason
                open_trade.days_held = days_held
                open_trade.pnl_usd = pnl
                open_trade.opp_cost_usd = opp_cost if opp_cost > 0 else None
                trades.append(open_trade)
                state = "FLAT"
                open_trade = None
                open_expiry = None

    # Force-close any open trade at the last bar so totals are honest.
    if state == "OPEN" and open_trade is not None and len(bars) > 0:
        last = bars[-1]
        bar_date = last.Index.date()
        spot = float(last.close)
        iv_now = float(last.iv_synth)
        days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
        dte_now = max(0, (open_expiry - bar_date).days) if open_expiry else 0
        opp_cost = 0.0
        if dte_now <= 0:
            if spot > open_trade.strike:
                exit_premium = 0.0
                reason = "EOD_EXERCISED"
                opp_cost = (spot - open_trade.strike) * 100.0
            else:
                exit_premium = 0.0
                reason = "EOD_EXPIRED_OTM"
        else:
            exit_premium = bs_call(spot, open_trade.strike, dte_now / 365.0, r, iv_now)
            reason = "EOD_OPEN"
        pnl = (open_trade.entry_premium - exit_premium) * 100.0
        open_trade.exit_date = bar_date.isoformat()
        open_trade.exit_time = market_close_iso(bar_date)
        open_trade.exit_spot = spot
        open_trade.exit_premium = exit_premium
        open_trade.exit_reason = reason
        open_trade.days_held = days_held
        open_trade.pnl_usd = pnl
        open_trade.opp_cost_usd = opp_cost if opp_cost > 0 else None
        trades.append(open_trade)

    wins = sum(1 for t in trades if (t.pnl_usd or 0) > 0)
    losses = sum(1 for t in trades if (t.pnl_usd or 0) <= 0)
    exercised = sum(1 for t in trades if (t.exit_reason or "").endswith("EXERCISED"))
    total = sum((t.pnl_usd or 0.0) for t in trades)
    total_opp = sum((t.opp_cost_usd or 0.0) for t in trades)
    avg_pnl = (total / len(trades)) if trades else 0.0
    avg_days = (sum((t.days_held or 0) for t in trades) / len(trades)) if trades else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0

    return TickerResult(
        ticker=ticker,
        strategy="covered_call",
        bar_count=len(df),
        keltner_top_bars=int((df["keltner_position"] == "TOP").sum()),
        keltner_bottom_bars=int((df["keltner_position"] == "BOTTOM").sum()),
        gate_fires=fires,
        fired_no_position=fired_no_position,
        fired_capped=0,
        trade_count=len(trades),
        wins=wins,
        losses=losses,
        exercised_count=exercised,
        total_pnl_usd=round(total, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        avg_holding_days=round(avg_days, 1),
        win_rate=round(win_rate, 3),
        total_opp_cost_usd=round(total_opp, 2),
        final_share_inventory=0,
        trades=[asdict(t) for t in trades],
    )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def backtest_csp_ticker(
    ticker: str,
    df: pd.DataFrame,
    *,
    dte_target: int,
    delta_target: float,
    iv_hv_gate: float,
    r: float,
    max_shares: int,
) -> TickerResult:
    """Sell cash-secured puts when Keltner=BOTTOM AND IV/HV>gate. Hold to expiry.
    Assigned (buy 100 shares at strike) if ITM at expiry. Capped at max_shares
    per ticker — gate fires while at cap are counted but skipped.
    """
    df = df.dropna(subset=["hv_30", "iv_synth", "keltner_position"]).copy()
    trades: List[Trade] = []
    state = "FLAT"
    open_trade: Optional[Trade] = None
    open_expiry: Optional[date] = None
    fires = 0
    fired_no_position = 0
    fired_capped = 0
    shares = 0

    bars = list(df.itertuples())
    for bar in bars:
        bar_date = bar.Index.date()
        spot = float(bar.close)
        iv_now = float(bar.iv_synth)
        keltner = bar.keltner_position
        iv_hv = float(bar.iv_hv)

        gate_on = (keltner == "BOTTOM") and (iv_hv > iv_hv_gate)

        if state == "FLAT":
            if gate_on:
                fires += 1
                if shares + 100 > max_shares:
                    fired_capped += 1
                    continue
                strike = pick_put_strike_for_delta(spot, iv_now, dte_target, delta_target, r)
                T = dte_target / 365.0
                entry_premium = bs_put(spot, strike, T, r, iv_now)
                entry_delta = bs_put_delta(spot, strike, T, r, iv_now)
                if entry_premium <= 0.01:
                    continue
                open_trade = Trade(
                    ticker=ticker,
                    strategy="csp",
                    entry_date=bar_date.isoformat(),
                    entry_time=market_close_iso(bar_date),
                    entry_spot=spot,
                    strike=strike,
                    entry_dte=dte_target,
                    entry_iv=iv_now,
                    entry_premium=entry_premium,
                    entry_delta=entry_delta,
                )
                open_expiry = bar_date + timedelta(days=dte_target)
                state = "OPEN"
        else:
            if gate_on:
                fired_no_position += 1
            assert open_trade is not None and open_expiry is not None
            days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
            dte_now = (open_expiry - bar_date).days
            if dte_now > 0:
                continue  # hold to expiry — no early exit per "let them be exercised"

            # Expiry processing
            if spot < open_trade.strike:
                # Assigned: buy 100 shares at strike. Trade-level cash P&L = entry premium kept.
                # Opportunity cost = (strike - spot) * 100 — what you "overpaid" relative to spot.
                pnl = open_trade.entry_premium * 100.0
                opp_cost = (open_trade.strike - spot) * 100.0
                shares += 100
                exit_reason = "ASSIGNED"
                assigned = True
            else:
                pnl = open_trade.entry_premium * 100.0
                opp_cost = 0.0
                exit_reason = "EXPIRED_OTM"
                assigned = False

            open_trade.exit_date = bar_date.isoformat()
            open_trade.exit_time = market_close_iso(bar_date)
            open_trade.exit_spot = spot
            open_trade.exit_premium = 0.0
            open_trade.exit_reason = exit_reason
            open_trade.days_held = days_held
            open_trade.pnl_usd = pnl
            open_trade.opp_cost_usd = opp_cost if opp_cost > 0 else None
            open_trade.assigned = assigned
            open_trade.shares_after = shares
            trades.append(open_trade)
            state = "FLAT"
            open_trade = None
            open_expiry = None

    # Force-close any open trade at the last bar.
    if state == "OPEN" and open_trade is not None and len(bars) > 0:
        last = bars[-1]
        bar_date = last.Index.date()
        spot = float(last.close)
        iv_now = float(last.iv_synth)
        days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
        dte_now = max(0, (open_expiry - bar_date).days) if open_expiry else 0
        if dte_now <= 0:
            if spot < open_trade.strike:
                pnl = open_trade.entry_premium * 100.0
                opp_cost = (open_trade.strike - spot) * 100.0
                shares += 100
                reason = "EOD_ASSIGNED"
                assigned = True
            else:
                pnl = open_trade.entry_premium * 100.0
                opp_cost = 0.0
                reason = "EOD_EXPIRED_OTM"
                assigned = False
            exit_premium = 0.0
        else:
            exit_premium = bs_put(spot, open_trade.strike, dte_now / 365.0, r, iv_now)
            pnl = (open_trade.entry_premium - exit_premium) * 100.0
            opp_cost = 0.0
            reason = "EOD_OPEN"
            assigned = False
        open_trade.exit_date = bar_date.isoformat()
        open_trade.exit_time = market_close_iso(bar_date)
        open_trade.exit_spot = spot
        open_trade.exit_premium = exit_premium
        open_trade.exit_reason = reason
        open_trade.days_held = days_held
        open_trade.pnl_usd = pnl
        open_trade.opp_cost_usd = opp_cost if opp_cost > 0 else None
        open_trade.assigned = assigned
        open_trade.shares_after = shares
        trades.append(open_trade)

    wins = sum(1 for t in trades if (t.pnl_usd or 0) > 0)
    losses = sum(1 for t in trades if (t.pnl_usd or 0) <= 0)
    assigned_count = sum(1 for t in trades if t.assigned)
    total = sum((t.pnl_usd or 0.0) for t in trades)
    total_opp = sum((t.opp_cost_usd or 0.0) for t in trades)
    avg_pnl = (total / len(trades)) if trades else 0.0
    avg_days = (sum((t.days_held or 0) for t in trades) / len(trades)) if trades else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0

    return TickerResult(
        ticker=ticker,
        strategy="csp",
        bar_count=len(df),
        keltner_top_bars=int((df["keltner_position"] == "TOP").sum()),
        keltner_bottom_bars=int((df["keltner_position"] == "BOTTOM").sum()),
        gate_fires=fires,
        fired_no_position=fired_no_position,
        fired_capped=fired_capped,
        trade_count=len(trades),
        wins=wins,
        losses=losses,
        exercised_count=assigned_count,
        total_pnl_usd=round(total, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        avg_holding_days=round(avg_days, 1),
        win_rate=round(win_rate, 3),
        total_opp_cost_usd=round(total_opp, 2),
        final_share_inventory=shares,
        trades=[asdict(t) for t in trades],
    )


def backtest_wheel_ticker(
    ticker: str,
    df: pd.DataFrame,
    *,
    csp_dte: int,
    csp_delta_target: float,
    cc_dte: int,
    cc_delta_target: float,
    cc_iv_hv_gate: float,
    csp_iv_hv_gate: float,
    r: float,
    max_shares: int,
    skip_cc_below_basis: bool = True,
) -> TickerResult:
    """Wheel: at most one open option per ticker (CSP or CC).

    Entry rules:
      - CSP at Keltner=BOTTOM and iv_hv > csp_iv_hv_gate (default 0 = no IV gate)
        Only fires if shares + 100 <= max_shares (cap-aware).
      - CC at Keltner=TOP and iv_hv > cc_iv_hv_gate, only if shares >= 100.
        Skipped if strike <= avg_cost_basis (don't lock in a share-leg loss).

    Hold both legs to expiry. ITM CSP -> assigned (shares +100, premium kept,
    cost basis updated). ITM CC -> exercised (shares -100, premium kept, share
    P&L realized at strike vs basis).

    Tracks max capital deployed = peak of (open CSP cash-secured + shares*basis).
    """
    df = df.dropna(subset=["hv_30", "iv_synth", "keltner_position"]).copy()
    trades: List[Trade] = []
    open_csp: Optional[Trade] = None
    open_csp_expiry: Optional[date] = None
    open_cc: Optional[Trade] = None
    open_cc_expiry: Optional[date] = None
    shares = 0
    total_cost = 0.0  # dollars paid for current share inventory
    realized_share_pnl = 0.0
    csp_premium_total = 0.0
    cc_premium_total = 0.0
    fires_csp = 0
    fires_cc = 0
    fires_csp_capped = 0
    fires_cc_below_basis = 0
    max_capital = 0.0

    bars = list(df.itertuples())
    for bar in bars:
        bar_date = bar.Index.date()
        spot = float(bar.close)
        iv_now = float(bar.iv_synth)
        keltner = bar.keltner_position
        iv_hv = float(bar.iv_hv)

        # 1) Process expirations first.
        if open_csp is not None and open_csp_expiry is not None and bar_date >= open_csp_expiry:
            days_held = (bar_date - date.fromisoformat(open_csp.entry_date)).days
            if spot < open_csp.strike:
                pnl = open_csp.entry_premium * 100.0
                opp = (open_csp.strike - spot) * 100.0
                shares += 100
                total_cost += open_csp.strike * 100.0  # cost basis at strike (premium kept separately)
                reason = "ASSIGNED"
                assigned = True
            else:
                pnl = open_csp.entry_premium * 100.0
                opp = 0.0
                reason = "EXPIRED_OTM"
                assigned = False
            csp_premium_total += pnl
            open_csp.exit_date = bar_date.isoformat()
            open_csp.exit_time = market_close_iso(bar_date)
            open_csp.exit_spot = spot
            open_csp.exit_premium = 0.0
            open_csp.exit_reason = reason
            open_csp.days_held = days_held
            open_csp.pnl_usd = pnl
            open_csp.opp_cost_usd = opp if opp > 0 else None
            open_csp.assigned = assigned
            open_csp.shares_after = shares
            trades.append(open_csp)
            open_csp = None
            open_csp_expiry = None

        if open_cc is not None and open_cc_expiry is not None and bar_date >= open_cc_expiry:
            days_held = (bar_date - date.fromisoformat(open_cc.entry_date)).days
            avg_basis = (total_cost / shares) if shares > 0 else 0.0
            if spot > open_cc.strike and shares >= 100:
                # Shares called away. Realize share-leg P&L = (strike - avg_basis) * 100.
                share_pnl = (open_cc.strike - avg_basis) * 100.0
                realized_share_pnl += share_pnl
                # Adjust running cost basis proportionally.
                total_cost -= avg_basis * 100.0
                shares -= 100
                pnl = open_cc.entry_premium * 100.0
                opp = (spot - open_cc.strike) * 100.0
                reason = "EXERCISED"
                assigned = True
            else:
                pnl = open_cc.entry_premium * 100.0
                opp = 0.0
                reason = "EXPIRED_OTM"
                assigned = False
            cc_premium_total += pnl
            open_cc.exit_date = bar_date.isoformat()
            open_cc.exit_time = market_close_iso(bar_date)
            open_cc.exit_spot = spot
            open_cc.exit_premium = 0.0
            open_cc.exit_reason = reason
            open_cc.days_held = days_held
            open_cc.pnl_usd = pnl
            open_cc.opp_cost_usd = opp if opp > 0 else None
            open_cc.assigned = assigned
            open_cc.shares_after = shares
            trades.append(open_cc)
            open_cc = None
            open_cc_expiry = None

        # 2) Try entries (one option position at a time).
        avg_basis = (total_cost / shares) if shares > 0 else 0.0
        no_open = (open_csp is None) and (open_cc is None)

        if no_open and keltner == "BOTTOM" and iv_hv > csp_iv_hv_gate:
            fires_csp += 1
            if shares + 100 > max_shares:
                fires_csp_capped += 1
            else:
                strike = pick_put_strike_for_delta(spot, iv_now, csp_dte, csp_delta_target, r)
                T = csp_dte / 365.0
                premium = bs_put(spot, strike, T, r, iv_now)
                if premium > 0.01:
                    open_csp = Trade(
                        ticker=ticker, strategy="wheel_csp",
                        entry_date=bar_date.isoformat(),
                        entry_time=market_close_iso(bar_date),
                        entry_spot=spot, strike=strike, entry_dte=csp_dte,
                        entry_iv=iv_now, entry_premium=premium,
                        entry_delta=bs_put_delta(spot, strike, T, r, iv_now),
                    )
                    open_csp_expiry = bar_date + timedelta(days=csp_dte)

        if no_open and open_csp is None and shares >= 100 and keltner == "TOP" and iv_hv > cc_iv_hv_gate:
            fires_cc += 1
            strike = pick_strike_for_delta(spot, iv_now, cc_dte, cc_delta_target, r)
            if skip_cc_below_basis and strike <= avg_basis:
                fires_cc_below_basis += 1
            else:
                T = cc_dte / 365.0
                premium = bs_call(spot, strike, T, r, iv_now)
                if premium > 0.01:
                    open_cc = Trade(
                        ticker=ticker, strategy="wheel_cc",
                        entry_date=bar_date.isoformat(),
                        entry_time=market_close_iso(bar_date),
                        entry_spot=spot, strike=strike, entry_dte=cc_dte,
                        entry_iv=iv_now, entry_premium=premium,
                        entry_delta=bs_call_delta(spot, strike, T, r, iv_now),
                    )
                    open_cc_expiry = bar_date + timedelta(days=cc_dte)

        # 3) Capital deployed today.
        cap = (open_csp.strike * 100.0) if open_csp is not None else 0.0
        cap += total_cost  # share inventory at cost basis
        if cap > max_capital:
            max_capital = cap

    # End-of-period: close any open positions at the last bar's mark.
    if len(bars) > 0 and (open_csp is not None or open_cc is not None):
        last = bars[-1]
        bar_date = last.Index.date()
        spot = float(last.close)
        iv_now = float(last.iv_synth)
        if open_csp is not None and open_csp_expiry is not None:
            days_held = (bar_date - date.fromisoformat(open_csp.entry_date)).days
            dte_now = max(0, (open_csp_expiry - bar_date).days)
            mtm = bs_put(spot, open_csp.strike, dte_now / 365.0, r, iv_now) if dte_now > 0 else max(open_csp.strike - spot, 0.0)
            pnl = (open_csp.entry_premium - mtm) * 100.0
            csp_premium_total += pnl
            open_csp.exit_date = bar_date.isoformat()
            open_csp.exit_time = market_close_iso(bar_date)
            open_csp.exit_spot = spot
            open_csp.exit_premium = mtm
            open_csp.exit_reason = "EOD_OPEN"
            open_csp.days_held = days_held
            open_csp.pnl_usd = pnl
            open_csp.shares_after = shares
            trades.append(open_csp)
        if open_cc is not None and open_cc_expiry is not None:
            days_held = (bar_date - date.fromisoformat(open_cc.entry_date)).days
            dte_now = max(0, (open_cc_expiry - bar_date).days)
            mtm = bs_call(spot, open_cc.strike, dte_now / 365.0, r, iv_now) if dte_now > 0 else max(spot - open_cc.strike, 0.0)
            pnl = (open_cc.entry_premium - mtm) * 100.0
            cc_premium_total += pnl
            open_cc.exit_date = bar_date.isoformat()
            open_cc.exit_time = market_close_iso(bar_date)
            open_cc.exit_spot = spot
            open_cc.exit_premium = mtm
            open_cc.exit_reason = "EOD_OPEN"
            open_cc.days_held = days_held
            open_cc.pnl_usd = pnl
            open_cc.shares_after = shares
            trades.append(open_cc)

    # Mark-to-market the share inventory at the last close.
    final_spot = float(bars[-1].close) if bars else 0.0
    avg_basis = (total_cost / shares) if shares > 0 else 0.0
    unrealized_share_pnl = (final_spot - avg_basis) * shares if shares > 0 else 0.0
    total_return = csp_premium_total + cc_premium_total + realized_share_pnl + unrealized_share_pnl
    return_pct = (total_return / max_capital) if max_capital > 0 else 0.0

    wins = sum(1 for t in trades if (t.pnl_usd or 0) > 0)
    losses = sum(1 for t in trades if (t.pnl_usd or 0) <= 0)
    assigned_count = sum(1 for t in trades if t.exit_reason in {"ASSIGNED", "EXERCISED"})
    avg_pnl = (sum((t.pnl_usd or 0.0) for t in trades) / len(trades)) if trades else 0.0
    avg_days = (sum((t.days_held or 0) for t in trades) / len(trades)) if trades else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0
    total_opp = sum((t.opp_cost_usd or 0.0) for t in trades)

    return TickerResult(
        ticker=ticker,
        strategy="wheel",
        bar_count=len(df),
        keltner_top_bars=int((df["keltner_position"] == "TOP").sum()),
        keltner_bottom_bars=int((df["keltner_position"] == "BOTTOM").sum()),
        gate_fires=fires_csp + fires_cc,
        fired_no_position=0,
        fired_capped=fires_csp_capped + fires_cc_below_basis,
        trade_count=len(trades),
        wins=wins,
        losses=losses,
        exercised_count=assigned_count,
        total_pnl_usd=round(csp_premium_total + cc_premium_total, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        avg_holding_days=round(avg_days, 1),
        win_rate=round(win_rate, 3),
        total_opp_cost_usd=round(total_opp, 2),
        final_share_inventory=shares,
        trades=[asdict(t) for t in trades],
        wheel={
            "csp_fires": fires_csp,
            "csp_capped": fires_csp_capped,
            "cc_fires": fires_cc,
            "cc_skipped_below_basis": fires_cc_below_basis,
            "csp_premium_usd": round(csp_premium_total, 2),
            "cc_premium_usd": round(cc_premium_total, 2),
            "realized_share_pnl_usd": round(realized_share_pnl, 2),
            "unrealized_share_pnl_usd": round(unrealized_share_pnl, 2),
            "final_spot": round(final_spot, 2),
            "avg_cost_basis": round(avg_basis, 2),
            "max_capital_usd": round(max_capital, 2),
            "total_return_usd": round(total_return, 2),
            "return_pct_of_max_cap": round(return_pct * 100, 2),
        },
    )


def backtest_continuous_cc_ticker(
    ticker: str,
    df: pd.DataFrame,
    *,
    cost_basis: float,
    contracts: int = 1,
    dte_target: int = 35,
    delta_target: float = 0.30,
    manage: bool = True,
    double_threshold: float = 2.0,
    r: float = 0.04,
    skip_below_basis: bool = True,
    entry_gate: str = "always",  # "always" | "keltner_top"
    iv_hv_gate: float = 1.3,
) -> TickerResult:
    """Continuous covered-call writer on N×100-share lots already owned.

    Strategy:
      Always try to have a CC open against the lot. Entry = `dte_target` DTE,
      strike chosen for `delta_target` (default 0.30). Entry skipped if
      `strike <= cost_basis` (would lock in a share-leg loss).

      manage=True (user's spec):
        - Daily MTM the short call. Track running peak option price.
        - If peak / entry_premium >= double_threshold, flag "ride_to_expiry"
          for this cycle (no more rolls — let assignment happen).
        - At expiry:
            ITM + ride flag set:  assigned at strike, share gain locked,
                                  shares called away, BACKTEST ENDS.
            ITM + no ride flag:   try to roll for net credit (close current
                                  at mtm, open a fresh 35-DTE 0.30Δ call).
                                  If new_premium - mtm <= 0, take assignment
                                  instead. ride flag carries over if peak
                                  on the new cycle eventually doubles.
            OTM:                  keep full credit, open next cycle next bar.

      manage=False (baseline):
        - At expiry ITM:  assigned, shares called away, BACKTEST ENDS.
        - At expiry OTM: keep full credit, open next.

    Output mirrors wheel_ticker's `wheel` dict shape so the two strategies
    compare apples-to-apples.

    `contracts` multiplies dollar P&L (each contract = 100 shares of cost
    basis collateral). Capital deployed = contracts × 100 × cost_basis.

    `entry_gate`:
        "always"      — open a new cycle whenever the prior one closes
                        (default; what 'continuous' means).
        "keltner_top" — only open when keltner_position=='TOP' AND
                        iv_hv > iv_hv_gate. Stays FLAT through other bars.
                        Mirrors the gated entry rule of the original
                        `backtest_ticker` function.
    """
    needed_cols = ["hv_30", "iv_synth"]
    if entry_gate == "keltner_top":
        needed_cols.append("keltner_position")
    df = df.dropna(subset=needed_cols).copy()
    trades: List[Trade] = []
    open_trade: Optional[Trade] = None
    open_expiry: Optional[date] = None
    peak_premium = 0.0
    ride_flag = False
    cumulative_credit = 0.0  # cycle-net credit (entry - exits across rolls)
    premium_total_usd = 0.0
    realized_share_pnl_usd = 0.0
    cycles_opened = 0
    cycles_expired_otm = 0
    cycles_rolled = 0
    cycles_assigned = 0
    cycles_skipped_below_basis = 0
    shares_alive = True
    final_spot = 0.0
    equity_curve: list = []  # (iso_date, equity_usd) — daily MTM

    bars = list(df.itertuples())
    if not bars:
        return TickerResult(
            ticker=ticker, strategy="managed_cc" if manage else "unmanaged_cc",
            bar_count=0, keltner_top_bars=0, keltner_bottom_bars=0,
            gate_fires=0, fired_no_position=0, fired_capped=0,
            trade_count=0, wins=0, losses=0, exercised_count=0,
            total_pnl_usd=0.0, avg_pnl_per_trade=0.0, avg_holding_days=0.0,
            win_rate=0.0, total_opp_cost_usd=0.0, final_share_inventory=100 * contracts,
            wheel={"premium_total_usd": 0.0, "equity_curve": []},
        )

    contract_mult = 100.0 * contracts

    def _open_cycle(bar_date: date, spot: float, iv_now: float) -> Optional[Trade]:
        """Try to open a new CC. Returns the trade or None if skipped."""
        nonlocal cycles_skipped_below_basis
        strike = pick_strike_for_delta(spot, iv_now, dte_target, delta_target, r)
        if skip_below_basis and strike <= cost_basis:
            cycles_skipped_below_basis += 1
            return None
        T = dte_target / 365.0
        prem = bs_call(spot, strike, T, r, iv_now)
        if prem <= 0.01:
            return None
        return Trade(
            ticker=ticker,
            strategy="managed_cc" if manage else "unmanaged_cc",
            entry_date=bar_date.isoformat(),
            entry_time=market_close_iso(bar_date),
            entry_spot=spot, strike=strike, entry_dte=dte_target,
            entry_iv=iv_now, entry_premium=prem,
            entry_delta=bs_call_delta(spot, strike, T, r, iv_now),
        )

    for i, bar in enumerate(bars):
        bar_date = bar.Index.date()
        spot = float(bar.close)
        iv_now = float(bar.iv_synth)
        final_spot = spot

        try:
            if not shares_alive:
                continue  # keep stamping equity post-assignment

            # 1) Open a cycle if we have none.
            if open_trade is None:
                gate_ok = True
                if entry_gate == "keltner_top":
                    kpos = getattr(bar, "keltner_position", None)
                    ivhv = float(getattr(bar, "iv_hv", 0.0) or 0.0)
                    gate_ok = (kpos == "TOP") and (ivhv > iv_hv_gate)
                if not gate_ok:
                    continue
                t = _open_cycle(bar_date, spot, iv_now)
                if t is not None:
                    open_trade = t
                    open_expiry = bar_date + timedelta(days=dte_target)
                    peak_premium = t.entry_premium
                    cumulative_credit = t.entry_premium
                    cycles_opened += 1
                continue

            assert open_expiry is not None

            # 2) Daily MTM + peak tracking.
            days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
            dte_now = (open_expiry - bar_date).days
            T_now = max(dte_now, 0) / 365.0
            if dte_now > 0:
                mtm = bs_call(spot, open_trade.strike, T_now, r, iv_now)
            else:
                mtm = max(spot - open_trade.strike, 0.0)
            if manage and mtm > peak_premium:
                peak_premium = mtm
                if peak_premium >= double_threshold * open_trade.entry_premium:
                    ride_flag = True

            # 3) Handle expiry.
            if dte_now <= 0:
                itm = spot > open_trade.strike
                if itm:
                    if (not manage) or ride_flag:
                        # Assignment: shares called away at strike.
                        share_pnl = (open_trade.strike - cost_basis) * contract_mult
                        realized_share_pnl_usd += share_pnl
                        # Cycle-net credit was already collected via cumulative_credit
                        # (entry - any prior roll exit costs). Final exit_premium = 0.
                        premium_total_usd += cumulative_credit * contract_mult
                        open_trade.exit_date = bar_date.isoformat()
                        open_trade.exit_time = market_close_iso(bar_date)
                        open_trade.exit_spot = spot
                        open_trade.exit_premium = 0.0
                        open_trade.exit_reason = "ASSIGNED_RIDE" if ride_flag else "ASSIGNED_OTM_END"
                        open_trade.days_held = days_held
                        open_trade.pnl_usd = open_trade.entry_premium * contract_mult
                        open_trade.assigned = True
                        trades.append(open_trade)
                        cycles_assigned += 1
                        open_trade = None
                        open_expiry = None
                        shares_alive = False
                    else:
                        # Roll for net credit.
                        new_t = _open_cycle(bar_date, spot, iv_now)
                        if new_t is None or (new_t.entry_premium - mtm) <= 0:
                            # Can't roll for credit → take assignment.
                            share_pnl = (open_trade.strike - cost_basis) * contract_mult
                            realized_share_pnl_usd += share_pnl
                            premium_total_usd += (cumulative_credit - mtm) * contract_mult
                            open_trade.exit_date = bar_date.isoformat()
                            open_trade.exit_time = market_close_iso(bar_date)
                            open_trade.exit_spot = spot
                            open_trade.exit_premium = mtm
                            open_trade.exit_reason = "ASSIGNED_NO_CREDIT"
                            open_trade.days_held = days_held
                            open_trade.pnl_usd = (open_trade.entry_premium - mtm) * contract_mult
                            open_trade.assigned = True
                            trades.append(open_trade)
                            cycles_assigned += 1
                            open_trade = None
                            open_expiry = None
                            shares_alive = False
                        else:
                            # Roll: close current at mtm (debit), open new at credit.
                            cumulative_credit = cumulative_credit - mtm + new_t.entry_premium
                            open_trade.exit_date = bar_date.isoformat()
                            open_trade.exit_time = market_close_iso(bar_date)
                            open_trade.exit_spot = spot
                            open_trade.exit_premium = mtm
                            open_trade.exit_reason = "ROLLED"
                            open_trade.days_held = days_held
                            open_trade.pnl_usd = (open_trade.entry_premium - mtm) * contract_mult
                            trades.append(open_trade)
                            cycles_rolled += 1
                            # Continue with the new trade — peak/ride reset for the new strike.
                            open_trade = new_t
                            open_expiry = bar_date + timedelta(days=dte_target)
                            peak_premium = new_t.entry_premium
                            cycles_opened += 1
                else:
                    # OTM at expiry: keep full credit, open next bar.
                    premium_total_usd += cumulative_credit * contract_mult
                    open_trade.exit_date = bar_date.isoformat()
                    open_trade.exit_time = market_close_iso(bar_date)
                    open_trade.exit_spot = spot
                    open_trade.exit_premium = 0.0
                    open_trade.exit_reason = "EXPIRED_OTM"
                    open_trade.days_held = days_held
                    open_trade.pnl_usd = open_trade.entry_premium * contract_mult
                    open_trade.assigned = False
                    trades.append(open_trade)
                    cycles_expired_otm += 1
                    open_trade = None
                    open_expiry = None
                    peak_premium = 0.0
                    ride_flag = False
                    cumulative_credit = 0.0
        finally:
            # Stamp end-of-bar equity (mark-to-market the wheel-overlay P&L).
            #   premium_realized = closed-cycle net + open-cycle (credit - mtm)
            #   share_value      = (spot - cost_basis) * contracts × 100  while alive
            #   realized_share_pnl_usd locked at assignment, share_value=0 thereafter
            if shares_alive and open_trade is not None and open_expiry is not None:
                _dte = max((open_expiry - bar_date).days, 0)
                _T = _dte / 365.0
                _mtm = bs_call(spot, open_trade.strike, _T, r, iv_now) if _dte > 0 \
                    else max(spot - open_trade.strike, 0.0)
                _prem_marked = premium_total_usd + (cumulative_credit - _mtm) * contract_mult
                _share_val = (spot - cost_basis) * contract_mult
            elif shares_alive:
                _prem_marked = premium_total_usd
                _share_val = (spot - cost_basis) * contract_mult
            else:
                _prem_marked = premium_total_usd
                _share_val = 0.0
            equity_curve.append((bar_date.isoformat(),
                                 _prem_marked + realized_share_pnl_usd + _share_val))

    # End-of-window: close any open trade at last spot.
    if open_trade is not None and open_expiry is not None and bars:
        last = bars[-1]
        bar_date = last.Index.date()
        spot = float(last.close)
        iv_now = float(last.iv_synth)
        days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
        dte_now = max(0, (open_expiry - bar_date).days)
        if dte_now > 0:
            mtm = bs_call(spot, open_trade.strike, dte_now / 365.0, r, iv_now)
        else:
            mtm = max(spot - open_trade.strike, 0.0)
        # Pretend we close the open call at mtm at the cutoff. Net credit so far
        # minus mtm is realized cash on the option leg. Shares stay alive.
        premium_total_usd += (cumulative_credit - mtm) * contract_mult
        open_trade.exit_date = bar_date.isoformat()
        open_trade.exit_time = market_close_iso(bar_date)
        open_trade.exit_spot = spot
        open_trade.exit_premium = mtm
        open_trade.exit_reason = "EOD_OPEN"
        open_trade.days_held = days_held
        open_trade.pnl_usd = (open_trade.entry_premium - mtm) * contract_mult
        open_trade.assigned = False
        trades.append(open_trade)

    # Mark-to-market remaining shares against final close.
    if shares_alive:
        unrealized_share_pnl_usd = (final_spot - cost_basis) * contract_mult
        final_share_inventory = int(100 * contracts)
    else:
        unrealized_share_pnl_usd = 0.0
        final_share_inventory = 0

    max_capital_usd = cost_basis * contract_mult
    total_return_usd = premium_total_usd + realized_share_pnl_usd + unrealized_share_pnl_usd
    return_pct = (total_return_usd / max_capital_usd) if max_capital_usd > 0 else 0.0

    # Drawdown from the daily equity curve.
    max_drawdown_usd = 0.0
    peak = float("-inf")
    for _, eq in equity_curve:
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_drawdown_usd:
            max_drawdown_usd = dd
    max_drawdown_pct = (max_drawdown_usd / max_capital_usd * 100) if max_capital_usd > 0 else 0.0

    wins = sum(1 for t in trades if (t.pnl_usd or 0) > 0)
    losses = sum(1 for t in trades if (t.pnl_usd or 0) <= 0)
    avg_pnl = (sum((t.pnl_usd or 0.0) for t in trades) / len(trades)) if trades else 0.0
    avg_days = (sum((t.days_held or 0) for t in trades) / len(trades)) if trades else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0

    return TickerResult(
        ticker=ticker,
        strategy="managed_cc" if manage else "unmanaged_cc",
        bar_count=len(df),
        keltner_top_bars=0,
        keltner_bottom_bars=0,
        gate_fires=cycles_opened,
        fired_no_position=0,
        fired_capped=cycles_skipped_below_basis,
        trade_count=len(trades),
        wins=wins,
        losses=losses,
        exercised_count=cycles_assigned,
        total_pnl_usd=round(premium_total_usd, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        avg_holding_days=round(avg_days, 1),
        win_rate=round(win_rate, 3),
        total_opp_cost_usd=0.0,
        final_share_inventory=final_share_inventory,
        trades=[asdict(t) for t in trades],
        wheel={
            "mode": "managed" if manage else "unmanaged",
            "contracts": contracts,
            "cost_basis": round(cost_basis, 4),
            "cycles_opened": cycles_opened,
            "cycles_expired_otm": cycles_expired_otm,
            "cycles_rolled": cycles_rolled,
            "cycles_assigned": cycles_assigned,
            "cycles_skipped_below_basis": cycles_skipped_below_basis,
            "premium_total_usd": round(premium_total_usd, 2),
            "realized_share_pnl_usd": round(realized_share_pnl_usd, 2),
            "unrealized_share_pnl_usd": round(unrealized_share_pnl_usd, 2),
            "final_spot": round(final_spot, 2),
            "max_capital_usd": round(max_capital_usd, 2),
            "total_return_usd": round(total_return_usd, 2),
            "return_pct_of_max_cap": round(return_pct * 100, 2),
            "max_drawdown_usd": round(max_drawdown_usd, 2),
            "max_drawdown_pct_of_max_cap": round(max_drawdown_pct, 2),
            "equity_curve": [[d, round(e, 2)] for d, e in equity_curve],
        },
    )


def backtest_continuous_csp_ticker(
    ticker: str,
    df: pd.DataFrame,
    *,
    dte_target: int = 35,
    delta_target: float = -0.30,
    r: float = 0.04,
    max_simultaneous: int = 1,
    entry_gate: str = "always",  # "always" | "keltner_bottom"
    iv_hv_gate: float = 1.3,
) -> TickerResult:
    """Continuous cash-secured-put writer.

    Always tries to have one CSP open. At entry: short put at `dte_target` DTE,
    strike chosen for `delta_target` (default -0.30). Hold to expiry.

      ITM at expiry:  assigned (buy 100 shares at strike). Premium kept.
                      Backtest stops opening new CSPs after assignment
                      (capital tied up in shares).
      OTM at expiry:  premium kept, open next cycle next bar.

    Capital deployed = strike × 100 while a put is open, plus 100 × strike of
    cost basis after assignment. `max_capital_usd` is the peak.

    `max_simultaneous` reserved for future use (1 today). Output mirrors
    wheel_ticker's `wheel` dict for direct comparability.

    `entry_gate`:
        "always"          — open a new cycle whenever the prior one closes.
        "keltner_bottom"  — only open when keltner_position=='BOTTOM' AND
                            iv_hv > iv_hv_gate. Stays FLAT through other bars.
                            Standard wheel rule: sell puts on oversold dips.
    """
    needed_cols = ["hv_30", "iv_synth"]
    if entry_gate == "keltner_bottom":
        needed_cols.append("keltner_position")
    df = df.dropna(subset=needed_cols).copy()
    trades: List[Trade] = []
    open_trade: Optional[Trade] = None
    open_expiry: Optional[date] = None
    shares = 0
    share_cost_total = 0.0
    realized_share_pnl = 0.0
    premium_total_usd = 0.0
    cycles_opened = 0
    cycles_expired_otm = 0
    cycles_assigned = 0
    max_capital = 0.0
    final_spot = 0.0
    equity_curve: list = []

    bars = list(df.itertuples())
    if not bars:
        return TickerResult(
            ticker=ticker, strategy="continuous_csp",
            bar_count=0, keltner_top_bars=0, keltner_bottom_bars=0,
            gate_fires=0, fired_no_position=0, fired_capped=0,
            trade_count=0, wins=0, losses=0, exercised_count=0,
            total_pnl_usd=0.0, avg_pnl_per_trade=0.0, avg_holding_days=0.0,
            win_rate=0.0, total_opp_cost_usd=0.0, final_share_inventory=0,
            wheel={"premium_total_usd": 0.0, "dte_target": dte_target, "equity_curve": []},
        )

    for bar in bars:
        bar_date = bar.Index.date()
        spot = float(bar.close)
        iv_now = float(bar.iv_synth)
        final_spot = spot

        # 1) Settle expiry first.
        if open_trade is not None and open_expiry is not None and bar_date >= open_expiry:
            days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
            assigned = spot < open_trade.strike
            premium_total_usd += open_trade.entry_premium * 100.0
            if assigned:
                shares += 100
                share_cost_total += open_trade.strike * 100.0
                cycles_assigned += 1
                reason = "ASSIGNED"
            else:
                cycles_expired_otm += 1
                reason = "EXPIRED_OTM"
            open_trade.exit_date = bar_date.isoformat()
            open_trade.exit_time = market_close_iso(bar_date)
            open_trade.exit_spot = spot
            open_trade.exit_premium = 0.0
            open_trade.exit_reason = reason
            open_trade.days_held = days_held
            open_trade.pnl_usd = open_trade.entry_premium * 100.0
            open_trade.assigned = assigned
            open_trade.shares_after = shares
            trades.append(open_trade)
            open_trade = None
            open_expiry = None

        # 2) Open a new CSP if no open and we still have CSP capacity (no shares).
        if open_trade is None and shares == 0:
            gate_ok = True
            if entry_gate == "keltner_bottom":
                kpos = getattr(bar, "keltner_position", None)
                ivhv = float(getattr(bar, "iv_hv", 0.0) or 0.0)
                gate_ok = (kpos == "BOTTOM") and (ivhv > iv_hv_gate)
            if gate_ok:
                strike = pick_put_strike_for_delta(spot, iv_now, dte_target, delta_target, r)
                T = dte_target / 365.0
                prem = bs_put(spot, strike, T, r, iv_now)
                if prem > 0.01 and strike > 0:
                    open_trade = Trade(
                        ticker=ticker, strategy="continuous_csp",
                        entry_date=bar_date.isoformat(),
                        entry_time=market_close_iso(bar_date),
                        entry_spot=spot, strike=strike, entry_dte=dte_target,
                        entry_iv=iv_now, entry_premium=prem,
                        entry_delta=bs_put_delta(spot, strike, T, r, iv_now),
                    )
                    open_expiry = bar_date + timedelta(days=dte_target)
                    cycles_opened += 1

        # 3) Capital deployed today.
        cap = (open_trade.strike * 100.0) if open_trade is not None else 0.0
        cap += share_cost_total
        if cap > max_capital:
            max_capital = cap

        # 4) Stamp daily equity (mark-to-market the wheel-overlay P&L).
        #    open put: short — its mark is a liability against us.
        #    shares (assigned): mark to current spot vs avg basis.
        if open_trade is not None and open_expiry is not None:
            _dte = max((open_expiry - bar_date).days, 0)
            _T = _dte / 365.0
            _put_mtm = bs_put(spot, open_trade.strike, _T, r, iv_now) if _dte > 0 \
                else max(open_trade.strike - spot, 0.0)
            _open_mark = (open_trade.entry_premium - _put_mtm) * 100.0
        else:
            _open_mark = 0.0
        if shares > 0:
            _avg_basis = share_cost_total / shares
            _share_val = (spot - _avg_basis) * shares
        else:
            _share_val = 0.0
        equity_curve.append((bar_date.isoformat(),
                             premium_total_usd + _open_mark + realized_share_pnl + _share_val))

    # End-of-window: close any open CSP at last mark.
    if open_trade is not None and open_expiry is not None and bars:
        last = bars[-1]
        bar_date = last.Index.date()
        spot = float(last.close)
        iv_now = float(last.iv_synth)
        days_held = (bar_date - date.fromisoformat(open_trade.entry_date)).days
        dte_now = max(0, (open_expiry - bar_date).days)
        mtm = bs_put(spot, open_trade.strike, dte_now / 365.0, r, iv_now) if dte_now > 0 else max(open_trade.strike - spot, 0.0)
        pnl = (open_trade.entry_premium - mtm) * 100.0
        premium_total_usd += pnl
        open_trade.exit_date = bar_date.isoformat()
        open_trade.exit_time = market_close_iso(bar_date)
        open_trade.exit_spot = spot
        open_trade.exit_premium = mtm
        open_trade.exit_reason = "EOD_OPEN"
        open_trade.days_held = days_held
        open_trade.pnl_usd = pnl
        open_trade.assigned = False
        trades.append(open_trade)

    # Mark assigned shares to final close.
    avg_basis = (share_cost_total / shares) if shares > 0 else 0.0
    unrealized_share_pnl = (final_spot - avg_basis) * shares if shares > 0 else 0.0
    total_return_usd = premium_total_usd + realized_share_pnl + unrealized_share_pnl
    return_pct = (total_return_usd / max_capital) if max_capital > 0 else 0.0

    # Drawdown from the daily equity curve.
    max_drawdown_usd = 0.0
    peak = float("-inf")
    for _, eq in equity_curve:
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_drawdown_usd:
            max_drawdown_usd = dd
    max_drawdown_pct = (max_drawdown_usd / max_capital * 100) if max_capital > 0 else 0.0

    wins = sum(1 for t in trades if (t.pnl_usd or 0) > 0)
    losses = sum(1 for t in trades if (t.pnl_usd or 0) <= 0)
    avg_pnl = (sum((t.pnl_usd or 0.0) for t in trades) / len(trades)) if trades else 0.0
    avg_days = (sum((t.days_held or 0) for t in trades) / len(trades)) if trades else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0

    return TickerResult(
        ticker=ticker,
        strategy="continuous_csp",
        bar_count=len(df),
        keltner_top_bars=0,
        keltner_bottom_bars=0,
        gate_fires=cycles_opened,
        fired_no_position=0,
        fired_capped=0,
        trade_count=len(trades),
        wins=wins,
        losses=losses,
        exercised_count=cycles_assigned,
        total_pnl_usd=round(premium_total_usd, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        avg_holding_days=round(avg_days, 1),
        win_rate=round(win_rate, 3),
        total_opp_cost_usd=0.0,
        final_share_inventory=shares,
        trades=[asdict(t) for t in trades],
        wheel={
            "leg": "csp",
            "dte_target": dte_target,
            "delta_target": delta_target,
            "cycles_opened": cycles_opened,
            "cycles_expired_otm": cycles_expired_otm,
            "cycles_assigned": cycles_assigned,
            "premium_total_usd": round(premium_total_usd, 2),
            "realized_share_pnl_usd": round(realized_share_pnl, 2),
            "unrealized_share_pnl_usd": round(unrealized_share_pnl, 2),
            "final_spot": round(final_spot, 2),
            "avg_cost_basis": round(avg_basis, 2),
            "max_capital_usd": round(max_capital, 2),
            "total_return_usd": round(total_return_usd, 2),
            "return_pct_of_max_cap": round(return_pct * 100, 2),
            "max_drawdown_usd": round(max_drawdown_usd, 2),
            "max_drawdown_pct_of_max_cap": round(max_drawdown_pct, 2),
            "equity_curve": [[d, round(e, 2)] for d, e in equity_curve],
        },
    )


TIMEFRAME_SPECS = {
    # bars_per_year used for HV annualization; hv_window in bars
    "daily":  {"bars_per_year": 252, "hv_window": 30},
    "weekly": {"bars_per_year": 52,  "hv_window": 8},
}


def run(tickers: List[str], years: int, decay_pct: float, dte_target: int,
        delta_target: float, iv_hv_gate: float, r: float, out_path: Path,
        timeframe: str, strategy: str = "covered_call", max_shares: int = 500,
        seed: int = 42) -> dict:
    np.random.seed(seed)

    # BS smoke-test before doing real work.
    sanity = bs_call(S=10, K=10, T=30 / 365, r=r, sigma=1.0)
    assert sanity > 0, f"BS smoke test failed: {sanity}"

    if timeframe not in TIMEFRAME_SPECS:
        raise ValueError(f"timeframe must be one of {list(TIMEFRAME_SPECS)}")
    spec = TIMEFRAME_SPECS[timeframe]

    fetch_days = years * 365 + 365  # extra lead-in for HV + Keltner warmup (esp. weekly: 20w EMA = ~5 months)
    backtest_start = (datetime.utcnow().date() - timedelta(days=years * 365))

    if strategy == "csp":
        exit_rules = "Hold to expiry. ASSIGNED if ITM (buy 100 shares at strike, premium kept). EXPIRED_OTM otherwise. No early decay close."
    else:
        exit_rules = "DECAY (mid <= (1-decay_pct)*entry); EXPIRY -> EXERCISED if ITM (premium kept) or EXPIRED_OTM"

    out: dict = {
        "asof": datetime.utcnow().date().isoformat(),
        "timeframe": timeframe,
        "strategy": strategy,
        "config": {
            "years": years,
            "decay_pct": decay_pct,
            "dte_target": dte_target,
            "delta_target": delta_target,
            "iv_hv_gate": iv_hv_gate,
            "r": r,
            "seed": seed,
            "max_shares_per_ticker": max_shares,
            "hv_window_bars": spec["hv_window"],
            "bars_per_year": spec["bars_per_year"],
            "iv_model": "synthetic (rolling HV * (1 + |N(0.10, 0.15)|))",
            "premium_model": "Black-Scholes daily MTM with rolling synthetic IV",
            "exit_rules": exit_rules,
        },
        "results": {},
    }

    for ticker in tickers:
        try:
            df_daily = fetch_history(ticker, fetch_days)
            df = to_weekly(df_daily) if timeframe == "weekly" else df_daily
            df = annotate(df, hv_window=spec["hv_window"], bars_per_year=spec["bars_per_year"])
            df = df[df.index.date >= backtest_start]
            if strategy == "csp":
                res = backtest_csp_ticker(
                    ticker, df,
                    dte_target=dte_target, delta_target=delta_target,
                    iv_hv_gate=iv_hv_gate, r=r, max_shares=max_shares,
                )
            elif strategy == "wheel":
                res = backtest_wheel_ticker(
                    ticker, df,
                    csp_dte=35, csp_delta_target=-0.30,
                    cc_dte=28, cc_delta_target=0.30,
                    cc_iv_hv_gate=iv_hv_gate, csp_iv_hv_gate=0.0,
                    r=r, max_shares=max_shares, skip_cc_below_basis=True,
                )
            else:
                res = backtest_ticker(
                    ticker, df,
                    decay_pct=decay_pct, dte_target=dte_target,
                    delta_target=delta_target, iv_hv_gate=iv_hv_gate, r=r,
                )
            out["results"][ticker] = asdict(res)
        except Exception as exc:  # noqa: BLE001
            out["results"][ticker] = {"error": str(exc)}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, default=str))

    csv_path = out_path.with_name(out_path.stem + "_trades.csv")
    fieldnames = [
        "ticker", "strategy", "entry_date", "entry_time", "exit_date", "exit_time",
        "exit_reason", "strike", "entry_spot", "exit_spot", "entry_premium",
        "exit_premium", "entry_delta", "days_held", "pnl_usd", "opp_cost_usd",
        "assigned", "shares_after",
    ]
    with csv_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for ticker, payload in out["results"].items():
            if "trades" not in payload:
                continue
            for t in payload["trades"]:
                w.writerow({k: t.get(k) for k in fieldnames})

    return out


def _print_summary(label: str, out: dict) -> None:
    print(f"\n=== {label} ===")
    if out.get("strategy") == "wheel":
        print(
            f"{'TKR':<6}{'CSP_F':>6}{'CC_F':>6}{'TRD':>5}{'PREM$':>10}{'RLZD$':>10}"
            f"{'UNRZD$':>10}{'TOTAL$':>11}{'MAXCAP$':>11}{'RET%':>7}{'SHRS':>6}"
        )
        for tk, r_ in out["results"].items():
            if "error" in r_:
                print(f"{tk:<6}  ERROR  {r_['error'][:60]}")
                continue
            w = r_.get("wheel") or {}
            prem = (w.get("csp_premium_usd", 0.0) + w.get("cc_premium_usd", 0.0))
            print(
                f"{tk:<6}{w.get('csp_fires', 0):>6}{w.get('cc_fires', 0):>6}{r_['trade_count']:>5}"
                f"{prem:>10.2f}{w.get('realized_share_pnl_usd', 0):>10.2f}"
                f"{w.get('unrealized_share_pnl_usd', 0):>10.2f}"
                f"{w.get('total_return_usd', 0):>11.2f}{w.get('max_capital_usd', 0):>11.2f}"
                f"{w.get('return_pct_of_max_cap', 0):>7.2f}{r_['final_share_inventory']:>6}"
            )
        return
    is_csp = out.get("strategy") == "csp"
    exc_label = "ASGN" if is_csp else "EXC"
    print(
        f"{'TKR':<6}{'FIRES':>7}{'CAP':>5}{'TRD':>5}{'WIN':>5}{'LOSS':>6}{exc_label:>5}"
        f"{'WIN%':>7}{'TOT$':>10}{'AVG$':>9}{'OPP$':>10}{'DAYS':>7}{'SHRS':>6}"
    )
    for tk, r_ in out["results"].items():
        if "error" in r_:
            print(f"{tk:<6}  ERROR  {r_['error'][:60]}")
            continue
        print(
            f"{tk:<6}{r_['gate_fires']:>7}{r_['fired_capped']:>5}{r_['trade_count']:>5}"
            f"{r_['wins']:>5}{r_['losses']:>6}{r_['exercised_count']:>5}"
            f"{r_['win_rate']:>7.2f}{r_['total_pnl_usd']:>10.2f}"
            f"{r_['avg_pnl_per_trade']:>9.2f}{r_['total_opp_cost_usd']:>10.2f}"
            f"{r_['avg_holding_days']:>7.1f}{r_['final_share_inventory']:>6}"
        )


DEFAULT_TICKERS = {
    "covered_call": ["RDW", "WULF", "CIFR"],
    "csp": ["CIFR", "WULF", "RDW", "AAL", "CRWV"],
    "wheel": ["CIFR", "WULF", "RDW", "CRWV"],
}

DEFAULT_DTE = {"covered_call": 28, "csp": 35, "wheel": 35}
DEFAULT_DELTA = {"covered_call": 0.30, "csp": -0.30, "wheel": -0.30}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strategy", choices=["covered_call", "csp", "wheel"], default="covered_call")
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--years", type=int, default=1)
    parser.add_argument("--decay-pct", type=float, default=0.60)
    parser.add_argument("--dte-target", type=int, default=None)
    parser.add_argument("--delta-target", type=float, default=None)
    parser.add_argument("--iv-hv-gate", type=float, default=1.3)
    parser.add_argument("--max-shares", type=int, default=500, help="CSP only: per-ticker share cap")
    parser.add_argument("--r", type=float, default=0.04)
    parser.add_argument("--timeframe", choices=["daily", "weekly", "both"], default="daily")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    tickers = args.tickers or DEFAULT_TICKERS[args.strategy]
    dte_target = args.dte_target if args.dte_target is not None else DEFAULT_DTE[args.strategy]
    delta_target = args.delta_target if args.delta_target is not None else DEFAULT_DELTA[args.strategy]
    out_default = REPO_ROOT / "sweep-results" / f"{args.strategy}_1y.json"
    out_path = args.out or out_default

    timeframes = ["daily", "weekly"] if args.timeframe == "both" else [args.timeframe]

    for tf in timeframes:
        tf_out = out_path.with_name(f"{out_path.stem}_{tf}.json") if args.timeframe == "both" else out_path
        out = run(
            tickers=tickers, years=args.years, decay_pct=args.decay_pct,
            dte_target=dte_target, delta_target=delta_target,
            iv_hv_gate=args.iv_hv_gate, r=args.r, out_path=tf_out, timeframe=tf,
            strategy=args.strategy, max_shares=args.max_shares, seed=args.seed,
        )
        print(f"\nWrote {tf_out}")
        print(f"Wrote {tf_out.with_name(tf_out.stem + '_trades.csv')}")
        _print_summary(f"{args.strategy.upper()} / {tf.upper()} timeframe", out)


if __name__ == "__main__":
    main()
