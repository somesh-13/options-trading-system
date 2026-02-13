"""Portfolio monitoring helpers.

Parses OCC symbols, fetches spot/vol, and builds input for Greeks aggregation.
"""

import re
from datetime import datetime, date
from typing import Optional

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from data.market_data import get_ticker_price
from data.cifr_data import get_historical_volatility


def _parse_occ_symbol(occ: str) -> Optional[dict]:
    """Parse OCC symbol into components.

    Example: CIFR260220C00016000 -> {underlying, expiration, type, strike}
    """
    match = re.match(r'^([A-Z]{1,6})(\d{6})([CP])(\d{8})$', occ)
    if not match:
        return None
    underlying, date_str, opt_type, strike_str = match.groups()
    yy, mm, dd = date_str[:2], date_str[2:4], date_str[4:6]
    return {
        "underlying": underlying,
        "expiration": date(2000 + int(yy), int(mm), int(dd)),
        "type": "call" if opt_type == "C" else "put",
        "strike": int(strike_str) / 1000.0,
    }


def _get_spot_price(ticker: str) -> float:
    """Get spot price with fallback to 0."""
    try:
        return get_ticker_price(ticker)
    except Exception:
        return 0.0


def _estimate_sigma(ticker: str) -> float:
    """Get 30-day HV with fallback to 0.5."""
    try:
        return get_historical_volatility(ticker, 30)
    except Exception:
        return 0.5


def _build_greeks_input(option_positions: list) -> list[dict]:
    """Transform Alpaca option position objects into aggregate_portfolio_greeks input.

    Each Alpaca position has: symbol, qty, asset_class, etc.
    Returns list of {S, K, T, r, sigma, option_type, qty} dicts.
    """
    result = []
    spot_cache: dict[str, float] = {}
    sigma_cache: dict[str, float] = {}

    for pos in option_positions:
        occ = pos.get("symbol", "")
        parsed = _parse_occ_symbol(occ)
        if not parsed:
            continue

        ticker = parsed["underlying"]

        # Cache spot and sigma per underlying
        if ticker not in spot_cache:
            spot_cache[ticker] = _get_spot_price(ticker)
        if ticker not in sigma_cache:
            sigma_cache[ticker] = _estimate_sigma(ticker)

        S = spot_cache[ticker]
        if S <= 0:
            continue

        # Compute time to expiration in years
        today = date.today()
        days_to_exp = (parsed["expiration"] - today).days
        T = max(days_to_exp / 365.0, 0.001)

        qty_val = int(pos.get("qty", 0))
        if qty_val == 0:
            continue

        result.append({
            "S": S,
            "K": parsed["strike"],
            "T": T,
            "r": 0.05,
            "sigma": sigma_cache[ticker],
            "option_type": parsed["type"],
            "qty": qty_val,
        })

    return result
