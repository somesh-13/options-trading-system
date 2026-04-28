"""
VegaEdge tool declarations and runners for Gemini Live API.
Wraps existing detect_mispricing, scan_ticker, and chart generator.
"""

import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).parent.parent))

from data.market_data import detect_mispricing
from engine.scanner import scan_ticker
from engine.config import EngineConfig

# Lazy import chart generator to avoid matplotlib at import time if needed
def _get_chart_generator():
    from vegaedge.chart_generator import generate_keltner_chart
    return generate_keltner_chart


WATCHLIST = ["HOOD", "CIFR", "WULF", "PYPL", "GRAB"]

DEFAULT_CONFIG = EngineConfig(
    tickers=WATCHLIST,
    iv_hv_sell_threshold=1.3,
    iv_hv_buy_threshold=0.8,
    min_ev_per_contract=50.0,
)

TOOL_DECLARATIONS = [
    {
        "name": "analyze_ticker",
        "description": "Run full VegaEdge analysis on a stock ticker. Returns IV/HV ratio, volatility signal (BUY/SELL/NEUTRAL), spot price, ATM option details, and optional EV opportunity.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"ticker": {"type": "STRING", "description": "Stock ticker symbol (e.g. HOOD, CIFR)"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "scan_watchlist",
        "description": "Scan all watched tickers (HOOD, CIFR, WULF, PYPL, GRAB) for IV/HV signals and alerts. Returns summary of which stocks have BUY, SELL, or NEUTRAL signals.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "get_keltner_chart",
        "description": "Generate a Keltner-style channel chart for a ticker showing price, upper/lower bands, and current position (BOTTOM/MIDDLE/TOP). Returns a chart image.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"ticker": {"type": "STRING", "description": "Stock ticker symbol"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "get_signal_details",
        "description": "Get detailed signal information for a ticker including spot, IV/HV ratio, ATM strike, expiration, and opportunity summary.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"ticker": {"type": "STRING", "description": "Stock ticker symbol"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "analyze_confluence",
        "description": (
            "Run the full 6-agent VegaEdge confluence pipeline on a ticker. "
            "Returns a weighted consensus score (0..1), a recommended strategy "
            "(BUY_LEAP / SELL_CSP / SELL_COVERED_CALL / HOLD), and each agent's "
            "signal and reasoning. Use this whenever the user asks 'what's the "
            "confluence on X' or 'analyze X with all agents'."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {"ticker": {"type": "STRING", "description": "Stock ticker symbol"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "get_trade_recommendation",
        "description": (
            "Produce the final trade recommendation for a ticker: exact strike, "
            "expiry, premium, Greeks, and risk metrics (max profit, max loss, "
            "breakeven, probability of profit, annualized return). Selects the "
            "strike closest to the delta target for the strategy the "
            "ConfluenceEngine picks (SELL_CSP -0.30d / 30-45 DTE, BUY_LEAP "
            "+0.70d / 60-90 DTE, SELL_COVERED_CALL +0.30d / 21-35 DTE). Call "
            "when the user asks 'what should I trade?' or 'give me the exact contract'."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "ticker": {"type": "STRING", "description": "Stock ticker symbol"},
                "strategy_override": {
                    "type": "STRING",
                    "description": "Optional: force SELL_CSP, BUY_LEAP, or SELL_COVERED_CALL",
                },
            },
            "required": ["ticker"],
        },
    },
]


def _serialize_opportunity(opp: dict | None) -> dict | None:
    if opp is None:
        return None
    return {
        "direction": opp.get("direction"),
        "option_type": opp.get("option_type"),
        "strike": opp.get("strike"),
        "ev_per_contract": opp.get("ev_per_contract"),
        "premium_estimate": opp.get("premium_estimate"),
    }


def run_analyze_ticker(ticker: str) -> dict[str, Any]:
    """Run mispricing + optional scanner for one ticker. Return JSON for Gemini."""
    ticker = ticker.upper().strip()
    mispricing = detect_mispricing(ticker)
    result = {
        "ticker": mispricing["ticker"],
        "spot_price": mispricing["spot_price"],
        "historical_vol": mispricing["historical_vol"],
        "implied_vol_atm": mispricing["implied_vol_atm"],
        "iv_hv_ratio": mispricing["iv_hv_ratio"],
        "signal": mispricing["signal"],
        "expiration": mispricing["expiration"],
        "atm_strike": mispricing["atm_strike"],
        "atm_call_price": mispricing["atm_call_price"],
    }
    scan_result = scan_ticker(ticker, DEFAULT_CONFIG)
    if scan_result and scan_result.get("opportunity"):
        result["opportunity"] = _serialize_opportunity(scan_result["opportunity"])
    else:
        result["opportunity"] = None
    return result


def run_scan_watchlist() -> dict[str, Any]:
    """Scan WATCHLIST and return list of signals + summary."""
    results = []
    for t in WATCHLIST:
        try:
            mp = detect_mispricing(t)
            results.append({
                "ticker": mp["ticker"],
                "signal": mp["signal"],
                "iv_hv_ratio": round(mp["iv_hv_ratio"], 4),
                "spot_price": mp["spot_price"],
            })
        except Exception as e:
            results.append({
                "ticker": t,
                "signal": "ERROR",
                "iv_hv_ratio": None,
                "error": str(e),
            })
    sell_count = sum(1 for r in results if r.get("signal") == "SELL")
    buy_count = sum(1 for r in results if r.get("signal") == "BUY")
    neutral_count = sum(1 for r in results if r.get("signal") == "NEUTRAL")
    summary = f"{sell_count} SELL, {buy_count} BUY, {neutral_count} NEUTRAL"
    return {"watchlist": results, "summary": summary}


def run_get_keltner_chart(ticker: str) -> dict[str, Any]:
    """Generate Keltner-style chart; return dict with image_b64 and channel_position."""
    ticker = ticker.upper().strip()
    generate = _get_chart_generator()
    image_b64, channel_position = generate(ticker)
    return {"image_b64": image_b64, "ticker": ticker, "channel_position": channel_position}


def run_get_signal_details(ticker: str) -> dict[str, Any]:
    """Alias to analyze_ticker for richer detail narrative."""
    return run_analyze_ticker(ticker)


def run_analyze_confluence(ticker: str) -> dict[str, Any]:
    """Run the 6-agent ConfluenceEngine for `ticker` synchronously from Gemini."""
    import asyncio

    from agents.service import get_service

    ticker = ticker.upper().strip()
    svc = get_service()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Fallback for the Gemini Live code path which already runs inside an event loop.
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            result = ex.submit(lambda: asyncio.run(svc.analyze(ticker))).result()
    else:
        result = asyncio.run(svc.analyze(ticker))

    return {
        "ticker": result.ticker,
        "confluence_score": result.confluence_score,
        "recommended_strategy": result.recommended_strategy,
        "reasoning": result.reasoning,
        "agent_signals": [
            {
                "agent_id": s.agent_id,
                "signal_type": s.signal_type,
                "confidence": s.confidence,
                "reasoning": s.reasoning,
                "metadata": s.metadata,
            }
            for s in result.agent_signals
        ],
    }


def dispatch_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute a tool by name and return result dict."""
    if name == "analyze_ticker":
        return run_analyze_ticker(arguments.get("ticker", ""))
    if name == "scan_watchlist":
        return run_scan_watchlist()
    if name == "get_keltner_chart":
        return run_get_keltner_chart(arguments.get("ticker", ""))
    if name == "get_signal_details":
        return run_get_signal_details(arguments.get("ticker", ""))
    if name == "analyze_confluence":
        return run_analyze_confluence(arguments.get("ticker", ""))
    if name == "get_trade_recommendation":
        return run_get_trade_recommendation(
            arguments.get("ticker", ""),
            arguments.get("strategy_override"),
        )
    return {"error": f"Unknown tool: {name}"}


def run_get_trade_recommendation(ticker: str, strategy_override: Any = None) -> dict[str, Any]:
    """Run P2 trade recommendation synchronously from a Gemini tool call."""
    import asyncio

    from vegaedge.trade_rec import get_trade_recommendation

    override = strategy_override if isinstance(strategy_override, str) and strategy_override else None

    async def _go():
        return await get_trade_recommendation(ticker, strategy_override=override)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            rec = ex.submit(lambda: asyncio.run(_go())).result()
    else:
        rec = asyncio.run(_go())

    payload = rec.model_dump(mode="json")
    # Strip infinities so JSON serialization is safe; the API already normalized.
    return payload
