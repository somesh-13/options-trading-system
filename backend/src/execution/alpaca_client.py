"""Alpaca Trading Client - Paper trading execution engine.

Wraps Alpaca Trade API for order submission, position management,
and account monitoring. Defaults to paper trading mode.
"""

import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY", "")
_raw_url = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
# Strip trailing /v2 if present — we add it in each endpoint
ALPACA_BASE_URL = _raw_url.rstrip("/").removesuffix("/v2")
ALPACA_DATA_URL = "https://data.alpaca.markets"


def _get_headers() -> dict:
    """Get Alpaca API headers."""
    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
        "Content-Type": "application/json",
    }


def _is_configured() -> bool:
    """Check if Alpaca credentials are configured."""
    return bool(ALPACA_API_KEY and ALPACA_SECRET_KEY)


def get_account() -> dict:
    """Get Alpaca account information."""
    if not _is_configured():
        return {
            "status": "not_configured",
            "message": "Alpaca API keys not set. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env",
            "paper_trading": True,
        }

    import requests
    resp = requests.get(f"{ALPACA_BASE_URL}/v2/account", headers=_get_headers(), timeout=10)
    if resp.status_code != 200:
        return {"error": f"Alpaca API error: {resp.status_code}", "detail": resp.text}
    return resp.json()


def get_positions() -> list[dict]:
    """Get all open positions."""
    if not _is_configured():
        return []

    import requests
    resp = requests.get(f"{ALPACA_BASE_URL}/v2/positions", headers=_get_headers(), timeout=10)
    if resp.status_code != 200:
        return []
    return resp.json()


def get_orders(status: str = "open") -> list[dict]:
    """Get orders with given status."""
    if not _is_configured():
        return []

    import requests
    resp = requests.get(
        f"{ALPACA_BASE_URL}/v2/orders",
        headers=_get_headers(),
        params={"status": status},
        timeout=10,
    )
    if resp.status_code != 200:
        return []
    return resp.json()


def submit_order(
    symbol: str,
    qty: int,
    side: str,
    order_type: str = "market",
    time_in_force: str = "day",
    limit_price: Optional[float] = None,
    signal_source: str = "manual",
    signal_data: Optional[dict] = None,
) -> dict:
    """Submit an order to Alpaca.

    Args:
        symbol: Stock ticker
        qty: Number of shares
        side: 'buy' or 'sell'
        order_type: 'market', 'limit', 'stop', 'stop_limit'
        time_in_force: 'day', 'gtc', 'opg', 'ioc'
        limit_price: Required for limit orders
    """
    if not _is_configured():
        return {
            "status": "not_configured",
            "message": "Alpaca API keys not set. Cannot submit orders.",
            "simulated": True,
            "order": {
                "symbol": symbol, "qty": qty, "side": side,
                "type": order_type, "time_in_force": time_in_force,
            },
        }

    import requests
    order_data = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": order_type,
        "time_in_force": time_in_force,
    }
    if limit_price is not None and order_type in ("limit", "stop_limit"):
        order_data["limit_price"] = str(limit_price)

    resp = requests.post(
        f"{ALPACA_BASE_URL}/v2/orders",
        headers=_get_headers(),
        json=order_data,
        timeout=10,
    )
    if resp.status_code not in (200, 201):
        return {"error": f"Order failed: {resp.status_code}", "detail": resp.text}

    result = resp.json()
    try:
        from journal.database import log_trade
        log_trade(
            order_id=result.get("id", ""),
            symbol=symbol,
            side=side,
            qty=qty,
            order_type=order_type,
            limit_price=limit_price,
            asset_class="stock",
            signal_source=signal_source,
            signal_data=signal_data,
        )
    except Exception:
        pass  # Never block trading on journal failures
    return result


def cancel_order(order_id: str) -> dict:
    """Cancel a specific order."""
    if not _is_configured():
        return {"status": "not_configured"}

    import requests
    resp = requests.delete(
        f"{ALPACA_BASE_URL}/v2/orders/{order_id}",
        headers=_get_headers(),
        timeout=10,
    )
    return {"status": "cancelled" if resp.status_code == 204 else "failed"}


def get_portfolio_history(period: str = "1M", timeframe: str = "1D") -> dict:
    """Get portfolio equity history."""
    if not _is_configured():
        return {"status": "not_configured", "equity": [], "timestamps": []}

    import requests
    resp = requests.get(
        f"{ALPACA_BASE_URL}/v2/account/portfolio/history",
        headers=_get_headers(),
        params={"period": period, "timeframe": timeframe},
        timeout=10,
    )
    if resp.status_code != 200:
        return {"error": f"History fetch failed: {resp.status_code}"}
    return resp.json()


# =============================================
# Options Trading Functions
# =============================================


def get_options_contracts(
    underlying_symbol: str,
    expiration_date: Optional[str] = None,
    expiration_date_gte: Optional[str] = None,
    expiration_date_lte: Optional[str] = None,
    strike_price_gte: Optional[float] = None,
    strike_price_lte: Optional[float] = None,
    option_type: Optional[str] = None,
) -> dict:
    """Get available options contracts for an underlying symbol.

    Args:
        underlying_symbol: e.g. 'CIFR'
        expiration_date: Exact expiration date (YYYY-MM-DD)
        expiration_date_gte/lte: Expiration date range filters
        strike_price_gte/lte: Strike price range filters
        option_type: 'call' or 'put'
    """
    if not _is_configured():
        return {"error": "Alpaca API keys not set"}

    import requests

    params: dict = {"underlying_symbols": underlying_symbol, "status": "active", "limit": 100}
    if expiration_date:
        params["expiration_date"] = expiration_date
    if expiration_date_gte:
        params["expiration_date_gte"] = expiration_date_gte
    if expiration_date_lte:
        params["expiration_date_lte"] = expiration_date_lte
    if strike_price_gte is not None:
        params["strike_price_gte"] = str(strike_price_gte)
    if strike_price_lte is not None:
        params["strike_price_lte"] = str(strike_price_lte)
    if option_type:
        params["type"] = option_type

    resp = requests.get(
        f"{ALPACA_BASE_URL}/v2/options/contracts",
        headers=_get_headers(),
        params=params,
        timeout=10,
    )
    if resp.status_code != 200:
        return {"error": f"Contracts fetch failed: {resp.status_code}", "detail": resp.text}
    return resp.json()


def get_options_chain_snapshot(
    underlying_symbol: str,
    expiration_date: Optional[str] = None,
    option_type: Optional[str] = None,
    strike_price_gte: Optional[float] = None,
    strike_price_lte: Optional[float] = None,
) -> dict:
    """Get live options chain snapshot with bid/ask and greeks.

    Uses the Alpaca Data API with indicative feed (free for paper trading).
    """
    if not _is_configured():
        return {"error": "Alpaca API keys not set"}

    import requests

    params: dict = {"feed": "indicative", "limit": 100}
    if expiration_date:
        params["expiration_date"] = expiration_date
    if option_type:
        params["type"] = option_type
    if strike_price_gte is not None:
        params["strike_price_gte"] = str(strike_price_gte)
    if strike_price_lte is not None:
        params["strike_price_lte"] = str(strike_price_lte)

    resp = requests.get(
        f"{ALPACA_DATA_URL}/v1beta1/options/snapshots/{underlying_symbol}",
        headers=_get_headers(),
        params=params,
        timeout=15,
    )
    if resp.status_code != 200:
        return {"error": f"Chain snapshot failed: {resp.status_code}", "detail": resp.text}
    return resp.json()


def submit_option_order(
    symbol: str,
    qty: int,
    side: str,
    order_type: str = "limit",
    limit_price: Optional[float] = None,
    signal_source: str = "manual",
    signal_data: Optional[dict] = None,
) -> dict:
    """Submit an options order to Alpaca.

    Args:
        symbol: OCC-format symbol e.g. 'CIFR260220C00016000'
        qty: Number of contracts (integer, no fractional)
        side: 'buy' or 'sell'
        order_type: 'market' or 'limit' (limit recommended for options)
        limit_price: Required for limit orders
    """
    if not _is_configured():
        return {
            "status": "not_configured",
            "message": "Alpaca API keys not set. Cannot submit options orders.",
        }

    import requests

    order_data = {
        "symbol": symbol,
        "qty": str(int(qty)),
        "side": side,
        "type": order_type,
        "time_in_force": "day",
    }
    if limit_price is not None and order_type == "limit":
        order_data["limit_price"] = str(limit_price)

    resp = requests.post(
        f"{ALPACA_BASE_URL}/v2/orders",
        headers=_get_headers(),
        json=order_data,
        timeout=10,
    )
    if resp.status_code not in (200, 201):
        return {"error": f"Options order failed: {resp.status_code}", "detail": resp.text}

    result = resp.json()
    try:
        from journal.database import log_trade
        log_trade(
            order_id=result.get("id", ""),
            symbol=symbol,
            side=side,
            qty=qty,
            order_type=order_type,
            limit_price=limit_price,
            asset_class="option",
            signal_source=signal_source,
            signal_data=signal_data,
        )
    except Exception:
        pass  # Never block trading on journal failures
    return result


def exercise_option(symbol_or_contract_id: str) -> dict:
    """Exercise an options position.

    Args:
        symbol_or_contract_id: OCC symbol or Alpaca contract UUID
    """
    if not _is_configured():
        return {"status": "not_configured"}

    import requests

    resp = requests.post(
        f"{ALPACA_BASE_URL}/v2/positions/{symbol_or_contract_id}/exercise",
        headers=_get_headers(),
        timeout=10,
    )
    if resp.status_code == 204:
        return {"status": "exercised", "symbol": symbol_or_contract_id}
    return {"status": "failed", "code": resp.status_code, "detail": resp.text}


def close_option_position(symbol_or_contract_id: str) -> dict:
    """Close an options position by selling it.

    Args:
        symbol_or_contract_id: OCC symbol or Alpaca contract UUID
    """
    if not _is_configured():
        return {"status": "not_configured"}

    import requests

    resp = requests.delete(
        f"{ALPACA_BASE_URL}/v2/positions/{symbol_or_contract_id}",
        headers=_get_headers(),
        timeout=10,
    )
    if resp.status_code in (200, 204):
        return {"status": "closed", "symbol": symbol_or_contract_id}
    return {"status": "failed", "code": resp.status_code, "detail": resp.text}
