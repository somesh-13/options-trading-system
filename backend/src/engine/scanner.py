"""Mispricing scanner — reuses existing detection and EV analysis modules."""

import sys
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

sys.path.append(str(Path(__file__).parent.parent))

from data.market_data import detect_mispricing
from strategy.ev_calculator import scan_opportunities
from execution.alpaca_client import get_positions
from journal.database import get_trades, get_pnl_summary
from engine.config import EngineConfig


ET = ZoneInfo("America/New_York")


def is_market_hours(config: EngineConfig) -> bool:
    """Check if current time is within market hours (Eastern Time)."""
    now = datetime.now(ET)
    # Weekend check
    if now.weekday() >= 5:
        return False
    open_time = now.replace(
        hour=config.market_open_hour, minute=config.market_open_minute,
        second=0, microsecond=0,
    )
    close_time = now.replace(
        hour=config.market_close_hour, minute=config.market_close_minute,
        second=0, microsecond=0,
    )
    return open_time <= now <= close_time


def scan_ticker(ticker: str, config: EngineConfig) -> Optional[dict]:
    """Run mispricing detection + EV scan for a ticker.

    Returns the best opportunity dict or None if nothing qualifies.
    """
    # Step 1: IV/HV mispricing detection
    mispricing = detect_mispricing(ticker)
    signal = mispricing.get("signal", "NEUTRAL")
    iv_hv_ratio = mispricing.get("iv_hv_ratio", 1.0)

    # Only proceed on actionable signals
    if signal == "SELL" and iv_hv_ratio < config.iv_hv_sell_threshold:
        return None
    if signal == "BUY" and iv_hv_ratio > config.iv_hv_buy_threshold:
        return None
    if signal == "NEUTRAL":
        return None

    # Step 2: EV scan across strikes
    spot = mispricing.get("spot_price", 0)
    hv = mispricing.get("historical_vol", 0.5)
    if spot <= 0 or hv <= 0:
        return None

    # Use ~30 days to expiry
    T = 30 / 365
    r = 0.05  # Assume 5% risk-free rate

    opportunities = scan_opportunities(
        S=spot, T=T, r=r, sigma=hv,
        strike_range_pct=0.15,
        num_strikes=8,
        min_ev_per_contract=config.min_ev_per_contract,
    )

    if not opportunities:
        return None

    # Pick the best opportunity
    best = opportunities[0]

    # Determine direction from signal
    if signal == "SELL":
        # IV overpriced → sell options
        sell_opps = [o for o in opportunities if o["direction"] == "sell"]
        if sell_opps:
            best = sell_opps[0]
    elif signal == "BUY":
        # IV underpriced → buy options
        buy_opps = [o for o in opportunities if o["direction"] == "buy"]
        if buy_opps:
            best = buy_opps[0]

    return {
        "mispricing": mispricing,
        "opportunity": best,
        "signal": signal,
        "iv_hv_ratio": iv_hv_ratio,
        "ticker": ticker,
    }


def check_risk_limits(config: EngineConfig) -> dict:
    """Check portfolio risk limits + daily trade/loss limits from journal.

    Returns dict with 'allowed' bool and reason if blocked.
    """
    # Check daily trade count
    today_str = datetime.now(ET).strftime("%Y-%m-%d")
    today_trades = get_trades(
        signal_source="auto_engine",
        date_from=today_str + "T00:00:00",
        limit=500,
    )
    daily_trade_count = len(today_trades)
    if daily_trade_count >= config.max_daily_trades:
        return {"allowed": False, "reason": f"Daily trade limit reached ({daily_trade_count}/{config.max_daily_trades})"}

    # Check daily P&L loss
    daily_pnl = sum(t.get("realized_pnl", 0) or 0 for t in today_trades)
    if daily_pnl <= -config.max_daily_loss:
        return {"allowed": False, "reason": f"Daily loss limit reached (${daily_pnl:.2f}/${-config.max_daily_loss:.2f})"}

    # Check total open contracts
    positions = get_positions()
    total_option_contracts = 0
    for pos in positions:
        if pos.get("asset_class") == "option" or len(pos.get("symbol", "")) > 10:
            total_option_contracts += abs(int(pos.get("qty", 0)))
    if total_option_contracts >= config.max_total_contracts:
        return {"allowed": False, "reason": f"Max total contracts reached ({total_option_contracts}/{config.max_total_contracts})"}

    return {
        "allowed": True,
        "daily_trades": daily_trade_count,
        "daily_pnl": round(daily_pnl, 2),
        "total_option_contracts": total_option_contracts,
    }
