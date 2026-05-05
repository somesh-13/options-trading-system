#!/usr/bin/env python
"""1-year managed-vs-unmanaged covered-call backtest on the user's actual lots.

Pulls every 100+share lot from the live Robinhood snapshot, groups by ticker
(weighted-average cost basis if a ticker is held in multiple accounts), and
runs two strategies on each:

  managed_cc:   Always have a 35-DTE 0.30-delta CC open. At expiry ITM, roll
                for net credit unless the short has hit 2x entry premium at any
                point — in which case let assignment happen ("ride to expiry"
                trigger). At expiry OTM, keep credit, open the next cycle.

  unmanaged_cc: Same entry rules. Hold to expiry every cycle. Assigned at first
                ITM expiry. No rolls, no early management.

Writes:
  sweep-results/managed_cc_1y.json     full per-ticker results + summary
  sweep-results/managed_cc_trades.csv  every entry/exit row across both modes

Usage:
    python scripts/managed_cc_backtest.py
    python scripts/managed_cc_backtest.py --years 1 --dte 35 --delta 0.30
    python scripts/managed_cc_backtest.py --backend http://localhost:8000
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from urllib.error import URLError
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from covered_call_backtest import (  # noqa: E402
    annotate,
    backtest_continuous_cc_ticker,
    fetch_history,
    TIMEFRAME_SPECS,
)


def fetch_live_lots(backend_url: str, min_shares: int = 100) -> Dict[str, dict]:
    """Pull user's 100+share lots from the live RH snapshot.

    Returns a dict keyed by ticker with:
      - quantity: total shares across accounts
      - contracts: floor(quantity / 100)
      - avg_cost: share-weighted average cost basis
    """
    url = f"{backend_url.rstrip('/')}/api/robinhood/holdings?source=live&account=all&live_prices=true"
    with urlopen(url, timeout=15) as resp:
        body = json.loads(resp.read())
    equities = body.get("equities") or []
    by_ticker: Dict[str, dict] = defaultdict(lambda: {"qty": 0.0, "weighted_cost": 0.0})
    for e in equities:
        sym = (e.get("symbol") or "").upper().strip()
        qty = float(e.get("quantity") or 0)
        cost = float(e.get("avg_cost") or 0)
        if not sym or qty <= 0 or cost <= 0:
            continue
        by_ticker[sym]["qty"] += qty
        by_ticker[sym]["weighted_cost"] += qty * cost

    lots: Dict[str, dict] = {}
    for sym, agg in by_ticker.items():
        total_qty = agg["qty"]
        if total_qty < min_shares:
            continue
        contracts = int(total_qty // 100)
        if contracts < 1:
            continue
        lots[sym] = {
            "quantity": total_qty,
            "contracts": contracts,
            "avg_cost": agg["weighted_cost"] / total_qty,
        }
    return lots


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", default="http://localhost:8000",
                        help="Base URL of the FastAPI backend (default: localhost:8000)")
    parser.add_argument("--tickers", nargs="+", default=None,
                        help="Override the ticker list (else: pulled from live RH lots)")
    parser.add_argument("--years", type=int, default=1)
    parser.add_argument("--dte", type=int, default=35)
    parser.add_argument("--delta", type=float, default=0.30)
    parser.add_argument("--double-threshold", type=float, default=2.0)
    parser.add_argument("--r", type=float, default=0.04)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "sweep-results" / "managed_cc_1y.json")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    # 1) Resolve the lot universe.
    try:
        lots = fetch_live_lots(args.backend)
    except (URLError, OSError) as exc:
        print(f"WARN: could not reach backend at {args.backend}: {exc}", file=sys.stderr)
        lots = {}

    if args.tickers:
        # Honour explicit ticker list. If the live snapshot has a cost basis,
        # use it; otherwise fall back to an entry-day spot proxy later.
        lots = {t.upper(): lots.get(t.upper(), {"quantity": 100, "contracts": 1, "avg_cost": 0.0})
                for t in args.tickers}

    if not lots:
        print("No CC-eligible lots found. Pass --tickers explicitly or sync RH first.", file=sys.stderr)
        sys.exit(2)

    print(f"Found {len(lots)} tickers with 100+share lots:")
    for sym, info in sorted(lots.items(), key=lambda kv: -kv[1]["quantity"]):
        print(f"  {sym:<6} qty={info['quantity']:>6.0f}  contracts={info['contracts']:>3}  avg_cost=${info['avg_cost']:>8.2f}")

    # 2) Run the backtest pair (managed + unmanaged) per ticker.
    spec = TIMEFRAME_SPECS["daily"]
    fetch_days = args.years * 365 + 365
    backtest_start = datetime.utcnow().date() - timedelta(days=args.years * 365)

    out: dict = {
        "asof": datetime.utcnow().date().isoformat(),
        "config": {
            "years": args.years,
            "dte_target": args.dte,
            "delta_target": args.delta,
            "double_threshold": args.double_threshold,
            "r": args.r,
            "seed": args.seed,
            "iv_model": "synthetic (rolling HV * (1 + |N(0.10, 0.15)|))",
            "premium_model": "Black-Scholes daily MTM with rolling synthetic IV",
        },
        "tickers": {sym: info for sym, info in lots.items()},
        "results": {},
    }

    for sym, info in lots.items():
        cost_basis = info["avg_cost"]
        contracts = max(1, int(info["contracts"]))
        try:
            df_daily = fetch_history(sym, fetch_days)
            df = annotate(df_daily, hv_window=spec["hv_window"], bars_per_year=spec["bars_per_year"])
            df = df[df.index.date >= backtest_start]

            # Fallback cost basis: if live snapshot didn't have one, use the
            # first close of the backtest window. Lets --tickers overrides work.
            if cost_basis <= 0 and not df.empty:
                cost_basis = float(df.iloc[0]["close"])
                info["avg_cost"] = cost_basis
                info["cost_basis_source"] = "first-bar-close"
            else:
                info["cost_basis_source"] = "live-rh-avg"

            managed = backtest_continuous_cc_ticker(
                sym, df, cost_basis=cost_basis, contracts=contracts,
                dte_target=args.dte, delta_target=args.delta,
                manage=True, double_threshold=args.double_threshold, r=args.r,
            )
            unmanaged = backtest_continuous_cc_ticker(
                sym, df, cost_basis=cost_basis, contracts=contracts,
                dte_target=args.dte, delta_target=args.delta,
                manage=False, r=args.r,
            )
            out["results"][sym] = {
                "managed": asdict(managed),
                "unmanaged": asdict(unmanaged),
            }
        except Exception as exc:  # noqa: BLE001
            out["results"][sym] = {"error": str(exc)}
            print(f"  {sym}: ERROR {exc}", file=sys.stderr)

    # 3) Aggregate summary across the universe.
    def _accum(side: str) -> dict:
        prem_sum = 0.0
        realized_sum = 0.0
        unrealized_sum = 0.0
        capital_sum = 0.0
        cycles_opened = 0
        cycles_otm = 0
        cycles_rolled = 0
        cycles_assigned = 0
        for sym, r_ in out["results"].items():
            if "error" in r_:
                continue
            w = r_[side].get("wheel") or {}
            prem_sum += w.get("premium_total_usd", 0.0)
            realized_sum += w.get("realized_share_pnl_usd", 0.0)
            unrealized_sum += w.get("unrealized_share_pnl_usd", 0.0)
            capital_sum += w.get("max_capital_usd", 0.0)
            cycles_opened += w.get("cycles_opened", 0)
            cycles_otm += w.get("cycles_expired_otm", 0)
            cycles_rolled += w.get("cycles_rolled", 0)
            cycles_assigned += w.get("cycles_assigned", 0)
        total = prem_sum + realized_sum + unrealized_sum
        return {
            "tickers": len(out["results"]),
            "premium_total_usd": round(prem_sum, 2),
            "realized_share_pnl_usd": round(realized_sum, 2),
            "unrealized_share_pnl_usd": round(unrealized_sum, 2),
            "total_return_usd": round(total, 2),
            "max_capital_usd": round(capital_sum, 2),
            "return_pct_of_max_cap": round((total / capital_sum) * 100, 2) if capital_sum > 0 else 0.0,
            "cycles_opened": cycles_opened,
            "cycles_expired_otm": cycles_otm,
            "cycles_rolled": cycles_rolled,
            "cycles_assigned": cycles_assigned,
        }

    out["summary"] = {
        "managed": _accum("managed"),
        "unmanaged": _accum("unmanaged"),
    }

    # 4) Persist.
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, default=str))

    csv_path = args.out.with_name(args.out.stem + "_trades.csv")
    fields = [
        "ticker", "strategy", "entry_date", "exit_date", "exit_reason",
        "strike", "entry_spot", "exit_spot", "entry_premium", "exit_premium",
        "entry_delta", "days_held", "pnl_usd", "assigned",
    ]
    with csv_path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for sym, r_ in out["results"].items():
            if "error" in r_:
                continue
            for side in ("managed", "unmanaged"):
                for t in r_[side].get("trades") or []:
                    w.writerow({k: t.get(k) for k in fields})

    # 5) Console summary.
    m = out["summary"]["managed"]
    u = out["summary"]["unmanaged"]
    print()
    print(f"=== {len(out['results'])} tickers, {args.years}-year window ===")
    print(f"{'':<14}{'managed':>14}{'unmanaged':>14}{'delta':>14}")
    for label, key in [
        ("premium",        "premium_total_usd"),
        ("realized share", "realized_share_pnl_usd"),
        ("unrealized",     "unrealized_share_pnl_usd"),
        ("total return",   "total_return_usd"),
        ("max capital",    "max_capital_usd"),
    ]:
        mv, uv = m[key], u[key]
        delta = mv - uv
        print(f"{label:<14}{mv:>14,.0f}{uv:>14,.0f}{delta:>+14,.0f}")
    print(f"{'return %':<14}{m['return_pct_of_max_cap']:>14.2f}{u['return_pct_of_max_cap']:>14.2f}{m['return_pct_of_max_cap']-u['return_pct_of_max_cap']:>+14.2f}")
    print(f"{'cycles':<14}{m['cycles_opened']:>14}{u['cycles_opened']:>14}{m['cycles_opened']-u['cycles_opened']:>+14}")
    print(f"{'rolled':<14}{m['cycles_rolled']:>14}{'-':>14}")
    print(f"{'assigned':<14}{m['cycles_assigned']:>14}{u['cycles_assigned']:>14}")
    print()
    print(f"Wrote {args.out}")
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
