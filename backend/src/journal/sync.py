"""Alpaca order status sync — fetches Alpaca orders and updates local journal."""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from execution.alpaca_client import get_orders
from journal.database import get_trades, update_trade_by_order_id


# Map Alpaca order status to our simplified status
_STATUS_MAP = {
    "new": "submitted",
    "accepted": "submitted",
    "pending_new": "submitted",
    "accepted_for_bidding": "submitted",
    "partially_filled": "partial",
    "filled": "filled",
    "done_for_day": "filled",
    "canceled": "cancelled",
    "expired": "cancelled",
    "replaced": "cancelled",
    "pending_cancel": "submitted",
    "pending_replace": "submitted",
    "stopped": "cancelled",
    "rejected": "rejected",
    "suspended": "submitted",
    "calculated": "submitted",
}


def sync_order_statuses() -> dict:
    """Fetch Alpaca orders and update local trade journal statuses.

    Returns summary of sync results.
    """
    # Get all trades that are not in terminal state
    open_trades = get_trades(status="submitted", limit=500)
    partial_trades = get_trades(status="partial", limit=500)
    pending_trades = open_trades + partial_trades

    if not pending_trades:
        return {"synced": 0, "updated": 0, "message": "No pending trades to sync"}

    # Fetch closed/all orders from Alpaca
    alpaca_orders = get_orders("all")
    if not alpaca_orders:
        return {"synced": 0, "updated": 0, "message": "No orders returned from Alpaca"}

    # Build lookup by order ID
    order_map = {}
    for order in alpaca_orders:
        oid = order.get("id")
        if oid:
            order_map[oid] = order

    updated = 0
    for trade in pending_trades:
        order_id = trade.get("order_id")
        if not order_id or order_id not in order_map:
            continue

        alpaca_order = order_map[order_id]
        alpaca_status = alpaca_order.get("status", "")
        new_status = _STATUS_MAP.get(alpaca_status, trade["status"])

        filled_price = None
        filled_qty = None

        if new_status in ("filled", "partial"):
            avg_price = alpaca_order.get("filled_avg_price")
            if avg_price:
                filled_price = float(avg_price)
            fq = alpaca_order.get("filled_qty")
            if fq:
                filled_qty = int(fq)

        if new_status != trade["status"] or filled_price or filled_qty:
            update_trade_by_order_id(
                order_id=order_id,
                status=new_status,
                filled_price=filled_price,
                filled_qty=filled_qty,
            )
            updated += 1

    return {
        "synced": len(pending_trades),
        "updated": updated,
        "alpaca_orders_checked": len(alpaca_orders),
        "message": f"Synced {updated} trade(s) from Alpaca",
    }
