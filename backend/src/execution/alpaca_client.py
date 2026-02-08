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
    return resp.json()


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
