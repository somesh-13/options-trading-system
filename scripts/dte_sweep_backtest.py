#!/usr/bin/env python
"""DTE optimization sweep — find the best expiry length for CC and CSP.

Pulls every 100+share lot from the live Robinhood snapshot, then runs a
1-year backtest for each ticker at four DTE buckets:
    7  days  (weeklies)
    14 days  (bi-weekly)
    21 days  (TastyTrade sweet spot)
    28 days  (monthlies / standard wheel)

For each ticker × DTE × leg ∈ {CC, CSP}, the script captures premium,
realized + unrealized share P&L, total return, and return on capital. Then
aggregates portfolio-wide and identifies the optimal DTE per leg.

Hold-to-expiry only (no roll, no early close, no 200% rule). Apples-to-apples
across DTEs. Layer your management rule on top once the optimal DTE is set.

Writes:
  sweep-results/dte_sweep_1y.json     full per-ticker per-DTE per-leg results
  sweep-results/dte_sweep_summary.csv  portfolio-aggregate-by-DTE table
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
from typing import Dict, List
from urllib.error import URLError
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from covered_call_backtest import (  # noqa: E402
    annotate,
    backtest_continuous_cc_ticker,
    backtest_continuous_csp_ticker,
    fetch_history,
    TIMEFRAME_SPECS,
)

DTE_BUCKETS: List[int] = [7, 14, 21, 28, 35, 42, 45]
CC_GATES: List[str] = ["always", "keltner_top"]
CSP_GATES: List[str] = ["always", "keltner_bottom"]


def fetch_live_lots(backend_url: str, min_shares: int = 100) -> Dict[str, dict]:
    """Pull user's 100+share lots from RH live snapshot, weighted-avg cost basis."""
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
    parser.add_argument("--backend", default="http://localhost:8000")
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--years", type=int, default=1)
    parser.add_argument("--cc-delta", type=float, default=0.30)
    parser.add_argument("--csp-delta", type=float, default=-0.30)
    parser.add_argument("--r", type=float, default=0.04)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "sweep-results" / "dte_sweep_1y.json")
    parser.add_argument("--plot", type=Path, default=REPO_ROOT / "hood reports" / "dte_optimization.png",
                        help="Path to write the matplotlib comparison chart (PNG). Pass /dev/null to skip.")
    args = parser.parse_args()

    try:
        lots = fetch_live_lots(args.backend)
    except (URLError, OSError) as exc:
        print(f"WARN: backend unreachable at {args.backend}: {exc}", file=sys.stderr)
        lots = {}

    if args.tickers:
        lots = {t.upper(): lots.get(t.upper(), {"quantity": 100, "contracts": 1, "avg_cost": 0.0})
                for t in args.tickers}
    if not lots:
        print("No CC-eligible lots found.", file=sys.stderr)
        sys.exit(2)

    print(f"Sweeping {len(lots)} tickers × {len(DTE_BUCKETS)} DTE buckets × 2 legs = {len(lots) * len(DTE_BUCKETS) * 2} backtests")

    spec = TIMEFRAME_SPECS["daily"]
    fetch_days = args.years * 365 + 365
    backtest_start = datetime.utcnow().date() - timedelta(days=args.years * 365)

    out: dict = {
        "asof": datetime.utcnow().date().isoformat(),
        "config": {
            "years": args.years,
            "dte_buckets": DTE_BUCKETS,
            "cc_delta": args.cc_delta,
            "csp_delta": args.csp_delta,
            "r": args.r,
            "iv_model": "synthetic (rolling HV * (1 + |N(0.10, 0.15)|))",
            "premium_model": "Black-Scholes daily MTM",
            "exit_rules": "Hold-to-expiry. No rolls, no early close. CC: skip cycle if strike <= cost basis.",
        },
        "tickers": dict(lots),
        "results": {},
    }

    for sym, info in lots.items():
        cost_basis = info["avg_cost"]
        contracts = max(1, int(info["contracts"]))
        try:
            df_daily = fetch_history(sym, fetch_days)
            df = annotate(df_daily, hv_window=spec["hv_window"], bars_per_year=spec["bars_per_year"])
            df = df[df.index.date >= backtest_start]

            if cost_basis <= 0 and not df.empty:
                cost_basis = float(df.iloc[0]["close"])

            ticker_out: dict = {"cost_basis": round(cost_basis, 4), "contracts": contracts, "by_dte": {}}
            for dte in DTE_BUCKETS:
                cc_always = backtest_continuous_cc_ticker(
                    sym, df, cost_basis=cost_basis, contracts=contracts,
                    dte_target=dte, delta_target=args.cc_delta,
                    manage=False, r=args.r, entry_gate="always",
                )
                cc_keltner = backtest_continuous_cc_ticker(
                    sym, df, cost_basis=cost_basis, contracts=contracts,
                    dte_target=dte, delta_target=args.cc_delta,
                    manage=False, r=args.r, entry_gate="keltner_top",
                )
                csp_always = backtest_continuous_csp_ticker(
                    sym, df,
                    dte_target=dte, delta_target=args.csp_delta, r=args.r,
                    entry_gate="always",
                )
                csp_keltner = backtest_continuous_csp_ticker(
                    sym, df,
                    dte_target=dte, delta_target=args.csp_delta, r=args.r,
                    entry_gate="keltner_bottom",
                )
                ticker_out["by_dte"][str(dte)] = {
                    "cc_always": asdict(cc_always),
                    "cc_keltner": asdict(cc_keltner),
                    "csp_always": asdict(csp_always),
                    "csp_keltner": asdict(csp_keltner),
                }
            out["results"][sym] = ticker_out
            print(f"  {sym} ✓")
        except Exception as exc:  # noqa: BLE001
            out["results"][sym] = {"error": str(exc)}
            print(f"  {sym} ERROR: {exc}", file=sys.stderr)

    # Aggregate portfolio totals per DTE per leg, including portfolio-level
    # max drawdown computed by date-aligning per-ticker equity curves.
    import pandas as pd

    summary: dict = {}
    LEG_KEYS = ["cc_always", "cc_keltner", "csp_always", "csp_keltner"]

    def _portfolio_drawdown(curves_by_ticker: Dict[str, List[List]]) -> tuple:
        """Sum per-ticker equity curves on a shared date index; return (max_dd_usd, max_dd_pct_of_total_cap_assumed_caller_supplies)."""
        if not curves_by_ticker:
            return 0.0, 0.0
        series = {}
        for sym, ec in curves_by_ticker.items():
            if not ec:
                continue
            ts = [pd.Timestamp(d) for d, _ in ec]
            vals = [float(v) for _, v in ec]
            series[sym] = pd.Series(vals, index=pd.DatetimeIndex(ts))
        if not series:
            return 0.0, 0.0
        df = pd.DataFrame(series).sort_index()
        # Forward-fill so a ticker that already started counts at its last value
        # on days another ticker is missing (e.g. holidays in different exchanges).
        df = df.ffill().fillna(0.0)
        portfolio = df.sum(axis=1)
        peak = portfolio.cummax()
        dd = portfolio - peak
        return float(abs(dd.min())), 0.0  # pct filled by caller

    for dte in DTE_BUCKETS:
        for leg in LEG_KEYS:
            agg = {
                "dte": dte, "leg": leg,
                "premium_total_usd": 0.0,
                "realized_share_pnl_usd": 0.0,
                "unrealized_share_pnl_usd": 0.0,
                "total_return_usd": 0.0,
                "max_capital_usd": 0.0,
                "cycles_opened": 0,
                "cycles_assigned": 0,
                "tickers_priced": 0,
            }
            curves: Dict[str, List[List]] = {}
            for sym, r_ in out["results"].items():
                if "error" in r_:
                    continue
                bucket = r_["by_dte"].get(str(dte), {})
                wheel = (bucket.get(leg) or {}).get("wheel") or {}
                agg["premium_total_usd"] += wheel.get("premium_total_usd", 0.0)
                agg["realized_share_pnl_usd"] += wheel.get("realized_share_pnl_usd", 0.0)
                agg["unrealized_share_pnl_usd"] += wheel.get("unrealized_share_pnl_usd", 0.0)
                agg["total_return_usd"] += wheel.get("total_return_usd", 0.0)
                agg["max_capital_usd"] += wheel.get("max_capital_usd", 0.0)
                agg["cycles_opened"] += wheel.get("cycles_opened", 0)
                agg["cycles_assigned"] += wheel.get("cycles_assigned", 0)
                agg["tickers_priced"] += 1
                ec = wheel.get("equity_curve") or []
                if ec:
                    curves[sym] = ec
            cap = agg["max_capital_usd"]
            agg["return_pct_of_max_cap"] = round((agg["total_return_usd"] / cap) * 100, 2) if cap > 0 else 0.0
            agg["premium_pct_of_max_cap"] = round((agg["premium_total_usd"] / cap) * 100, 2) if cap > 0 else 0.0

            # Portfolio-level max drawdown.
            dd_usd, _ = _portfolio_drawdown(curves)
            agg["max_drawdown_usd"] = round(dd_usd, 2)
            agg["max_drawdown_pct_of_max_cap"] = round((dd_usd / cap) * 100, 2) if cap > 0 else 0.0
            agg["return_to_dd_ratio"] = (
                round(agg["total_return_usd"] / dd_usd, 2) if dd_usd > 0 else 0.0
            )

            for k in ("premium_total_usd", "realized_share_pnl_usd", "unrealized_share_pnl_usd",
                      "total_return_usd", "max_capital_usd"):
                agg[k] = round(agg[k], 2)
            summary[f"{leg}_{dte}d"] = agg
    out["summary_by_dte"] = summary

    # Drop the per-ticker equity curves from the persisted JSON to keep file
    # size reasonable (each curve is ~250 daily floats × 28 variant×DTE per
    # ticker × 19 tickers ≈ 130k lines). Keep them only in-memory for the
    # drawdown computation above; the chart re-reads from sweep.summary_by_dte.
    for sym, r_ in out["results"].items():
        if "error" in r_:
            continue
        for dte_str, bucket in (r_.get("by_dte") or {}).items():
            for leg, leg_dict in bucket.items():
                w = (leg_dict or {}).get("wheel") or {}
                if "equity_curve" in w:
                    w["equity_curve_points"] = len(w["equity_curve"])
                    del w["equity_curve"]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2, default=str))

    csv_path = args.out.with_name("dte_sweep_summary.csv")
    with csv_path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "leg", "dte", "tickers", "premium_usd", "realized_share_usd",
            "unrealized_share_usd", "total_return_usd", "max_capital_usd",
            "premium_pct", "return_pct", "max_dd_usd", "max_dd_pct",
            "return_to_dd", "cycles_opened", "cycles_assigned",
        ])
        w.writeheader()
        for _, a in summary.items():
            w.writerow({
                "leg": a["leg"], "dte": a["dte"], "tickers": a["tickers_priced"],
                "premium_usd": a["premium_total_usd"],
                "realized_share_usd": a["realized_share_pnl_usd"],
                "unrealized_share_usd": a["unrealized_share_pnl_usd"],
                "total_return_usd": a["total_return_usd"],
                "max_capital_usd": a["max_capital_usd"],
                "premium_pct": a["premium_pct_of_max_cap"],
                "return_pct": a["return_pct_of_max_cap"],
                "max_dd_usd": a["max_drawdown_usd"],
                "max_dd_pct": a["max_drawdown_pct_of_max_cap"],
                "return_to_dd": a["return_to_dd_ratio"],
                "cycles_opened": a["cycles_opened"],
                "cycles_assigned": a["cycles_assigned"],
            })

    # Console summary.
    print()
    print(f"=== Portfolio aggregate by DTE ({len(out['results'])} tickers, {args.years}y) ===")
    print(f"{'leg':<14}{'dte':>5}{'cyc':>5}{'asgn':>5}{'prem$':>10}{'total$':>10}{'ret%':>7}{'maxDD$':>10}{'DD%':>7}{'ret/DD':>8}")
    for leg in LEG_KEYS:
        for dte in DTE_BUCKETS:
            a = summary[f"{leg}_{dte}d"]
            print(
                f"{leg:<14}{dte:>5}{a['cycles_opened']:>5}{a['cycles_assigned']:>5}"
                f"{a['premium_total_usd']:>10,.0f}{a['total_return_usd']:>10,.0f}"
                f"{a['return_pct_of_max_cap']:>7.2f}{a['max_drawdown_usd']:>10,.0f}"
                f"{a['max_drawdown_pct_of_max_cap']:>7.2f}{a['return_to_dd_ratio']:>8.2f}"
            )

    print()
    print(f"Wrote {args.out}")
    print(f"Wrote {csv_path}")

    # Generate the comparison chart.
    if str(args.plot) != "/dev/null":
        try:
            _plot_sweep(summary, args.plot, len(out["results"]), args.years)
            print(f"Wrote {args.plot}")
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: chart generation failed: {exc}", file=sys.stderr)


def _plot_sweep(summary: dict, plot_path: Path, n_tickers: int, years: int) -> None:
    """2x3 chart: each row = one leg (CC top, CSP bottom).
    Columns: premium | total return | max drawdown.

    Each panel overlays 'always-on' (solid) vs 'Keltner-gated' (hatched).
    Best DTE per panel marked with gold dashed line. For drawdown panels,
    the 'best' is the LOWEST drawdown (smallest is best).
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    dtes = DTE_BUCKETS
    n = len(dtes)

    def _series(leg: str, key: str) -> List[float]:
        return [float(summary[f"{leg}_{d}d"][key]) for d in dtes]

    cc_a_prem = _series("cc_always", "premium_total_usd")
    cc_k_prem = _series("cc_keltner", "premium_total_usd")
    cc_a_tot  = _series("cc_always", "total_return_usd")
    cc_k_tot  = _series("cc_keltner", "total_return_usd")
    cc_a_dd   = _series("cc_always", "max_drawdown_usd")
    cc_k_dd   = _series("cc_keltner", "max_drawdown_usd")
    csp_a_prem = _series("csp_always", "premium_total_usd")
    csp_k_prem = _series("csp_keltner", "premium_total_usd")
    csp_a_tot  = _series("csp_always", "total_return_usd")
    csp_k_tot  = _series("csp_keltner", "total_return_usd")
    csp_a_dd   = _series("csp_always", "max_drawdown_usd")
    csp_k_dd   = _series("csp_keltner", "max_drawdown_usd")

    plt.style.use("dark_background")
    fig, axes = plt.subplots(2, 3, figsize=(20, 9.5))
    fig.patch.set_facecolor("#1E1E1E")
    fig.suptitle(
        f"DTE optimization · {n_tickers} tickers · {years}-year window\n"
        f"Solid = always-on   ·   Hatched = Keltner-gated (TOP for CC, BOTTOM for CSP) on daily timeframe",
        color="white", fontsize=12, y=0.99,
    )

    x = np.arange(n)
    w = 0.4

    def _style(ax) -> None:
        ax.set_facecolor("#0c0d10")
        ax.grid(True, axis="y", alpha=0.15)
        ax.set_axisbelow(True)
        ax.tick_params(colors="#cccccc", labelsize=8)
        ax.set_xticks(x, [f"{d}d" for d in dtes])
        for spine in ax.spines.values():
            spine.set_color("#333")

    def _annotate_pair(ax, xs_a, ys_a, xs_k, ys_k, fmt: str = "${:,.0f}") -> None:
        for xi, yi in zip(xs_a, ys_a):
            ax.annotate(fmt.format(yi), (xi, yi), ha="center",
                        va="bottom" if yi >= 0 else "top",
                        fontsize=7, color="#cccccc",
                        xytext=(0, 2 if yi >= 0 else -2), textcoords="offset points")
        for xi, yi in zip(xs_k, ys_k):
            ax.annotate(fmt.format(yi), (xi, yi), ha="center",
                        va="bottom" if yi >= 0 else "top",
                        fontsize=7, color="#bbbbbb",
                        xytext=(0, 2 if yi >= 0 else -2), textcoords="offset points")

    def _highlight_best(ax, ys_a: List[float], ys_k: List[float], dtes: List[int],
                        higher_is_better: bool = True) -> None:
        all_pairs = [(v, "always", i, dtes[i]) for i, v in enumerate(ys_a)] + \
                    [(v, "gated", i, dtes[i]) for i, v in enumerate(ys_k)]
        chooser = max if higher_is_better else min
        v_best, kind, idx, dte_best = chooser(all_pairs, key=lambda t: t[0])
        ax.axvline(idx, color="#FFD700", alpha=0.35, linewidth=1, linestyle="--")
        label = f"  best: {dte_best}d {kind}"
        ymax = ax.get_ylim()[1]
        ax.text(idx, ymax * 0.95, label,
                color="#FFD700", fontsize=9, fontweight="bold")

    # === Top row: CC ===
    # [0,0] CC premium
    ax = axes[0, 0]
    ax.bar(x - w/2, cc_a_prem, w, color="#00C805", label="always-on")
    ax.bar(x + w/2, cc_k_prem, w, color="#00C805", alpha=0.45,
           hatch="//", edgecolor="#00C805", label="Keltner-Top")
    ax.set_title("CC · premium collected ($)", color="white")
    _annotate_pair(ax, x - w/2, cc_a_prem, x + w/2, cc_k_prem)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, cc_a_prem, cc_k_prem, dtes)

    # [0,1] CC total return
    ax = axes[0, 1]
    ax.bar(x - w/2, cc_a_tot, w, color="#00C805", label="always-on")
    ax.bar(x + w/2, cc_k_tot, w, color="#00C805", alpha=0.45,
           hatch="//", edgecolor="#00C805", label="Keltner-Top")
    ax.set_title("CC · total return ($)", color="white")
    _annotate_pair(ax, x - w/2, cc_a_tot, x + w/2, cc_k_tot)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, cc_a_tot, cc_k_tot, dtes)

    # [0,2] CC max drawdown — lower is better
    ax = axes[0, 2]
    ax.bar(x - w/2, cc_a_dd, w, color="#FF006E", label="always-on")
    ax.bar(x + w/2, cc_k_dd, w, color="#FF006E", alpha=0.45,
           hatch="//", edgecolor="#FF006E", label="Keltner-Top")
    ax.set_title("CC · max drawdown ($)  (lower is better)", color="white")
    _annotate_pair(ax, x - w/2, cc_a_dd, x + w/2, cc_k_dd)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, cc_a_dd, cc_k_dd, dtes, higher_is_better=False)

    # === Bottom row: CSP ===
    # [1,0] CSP premium
    ax = axes[1, 0]
    ax.bar(x - w/2, csp_a_prem, w, color="#FFD700", label="always-on")
    ax.bar(x + w/2, csp_k_prem, w, color="#FFD700", alpha=0.45,
           hatch="//", edgecolor="#FFD700", label="Keltner-Bottom")
    ax.set_title("CSP · premium collected ($)", color="white")
    _annotate_pair(ax, x - w/2, csp_a_prem, x + w/2, csp_k_prem)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, csp_a_prem, csp_k_prem, dtes)

    # [1,1] CSP total return
    ax = axes[1, 1]
    a_colors = ["#FFD700" if v >= 0 else "#FF006E" for v in csp_a_tot]
    k_colors = ["#FFD700" if v >= 0 else "#FF006E" for v in csp_k_tot]
    ax.bar(x - w/2, csp_a_tot, w, color=a_colors, label="always-on")
    ax.bar(x + w/2, csp_k_tot, w, color=k_colors, alpha=0.55,
           hatch="//", edgecolor="#FFD700", label="Keltner-Bottom")
    ax.axhline(0, color="#666", linewidth=0.7)
    ax.set_title("CSP · total return ($)", color="white")
    _annotate_pair(ax, x - w/2, csp_a_tot, x + w/2, csp_k_tot)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, csp_a_tot, csp_k_tot, dtes)

    # [1,2] CSP max drawdown — lower is better
    ax = axes[1, 2]
    ax.bar(x - w/2, csp_a_dd, w, color="#FF006E", label="always-on")
    ax.bar(x + w/2, csp_k_dd, w, color="#FF006E", alpha=0.45,
           hatch="//", edgecolor="#FF006E", label="Keltner-Bottom")
    ax.set_title("CSP · max drawdown ($)  (lower is better)", color="white")
    _annotate_pair(ax, x - w/2, csp_a_dd, x + w/2, csp_k_dd)
    ax.legend(facecolor="#0c0d10", edgecolor="#333", fontsize=8, loc="upper left")
    _style(ax)
    _highlight_best(ax, csp_a_dd, csp_k_dd, dtes, higher_is_better=False)

    plt.tight_layout(rect=(0, 0, 1, 0.94))
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(plot_path, dpi=140, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    main()
