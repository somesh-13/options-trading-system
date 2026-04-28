"""
Gemini Live API session configuration for VegaEdge.
Session is created in the WebSocket handler via client.aio.live.connect().
"""

import os
from typing import Iterable, Optional

from vegaedge.tools import TOOL_DECLARATIONS, dispatch_tool

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
# Fallback for older env names
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

SYSTEM_INSTRUCTION = """You are VegaEdge, an AI options trading analyst. You help traders identify high-probability setups using IV vs HV (implied vs historical volatility) analysis.

You can analyze any stock ticker and provide:
- IV/HV ratio (cheap <0.8, expensive >1.3) and signal: BUY, SELL, or NEUTRAL
- Full 6-agent confluence analysis (analyze_confluence) — weighted consensus across Volatility, Technical, Sentiment, Earnings, Regime, and Macro agents
- Exact trade recommendations with strike + premium + risk metrics (get_trade_recommendation)
- Actionable ideas: when IV is high consider short premium; when IV is low consider long premium
- Tools: analyze_ticker, scan_watchlist, get_keltner_chart, get_signal_details, analyze_confluence, get_trade_recommendation

Speak naturally and concisely. When reporting signals, emphasize the actionable recommendation and key metrics. Always mention risk (position sizing, not financial advice).

CRITICAL — hallucination prevention: when a LIVE MARKET CONTEXT block is attached below, only reference strikes within the stated valid range. Never invent strikes outside current price ± range. If asked about a ticker without live context, call a tool first before quoting any number.

Watchlist: HOOD, CIFR, WULF, PYPL, GRAB (you can analyze any ticker on request)."""


def build_live_context(tickers: Iterable[str]) -> str:
    """Build the §4.4 anti-hallucination context block for the given tickers.

    Pulls current price and 30-day range from the existing detect_mispricing
    pipeline. Failures are swallowed per-ticker so one bad symbol doesn't
    poison the whole prompt.
    """
    # Deferred import so a missing yfinance at import time doesn't break config.
    from data.market_data import detect_mispricing

    blocks = []
    for t in tickers:
        try:
            d = detect_mispricing(t.upper())
        except Exception:
            continue
        spot = float(d["spot_price"])
        # 30d proxy: ±2 HV-sigma bounds on current spot (HV is already a daily stdev approximation)
        hv = float(d["historical_vol"])
        band = spot * hv * (30 / 365) ** 0.5
        low = max(0.0, spot - band)
        high = spot + band
        strike_min = round(low * 0.8, 2)
        strike_max = round(high * 1.2, 2)
        blocks.append(
            f"Ticker: {t.upper()}\n"
            f"Current Price: ${spot:.2f}\n"
            f"30-Day Low: ${low:.2f}\n"
            f"30-Day High: ${high:.2f}\n"
            f"Valid Strike Range: ${strike_min:.2f} - ${strike_max:.2f}"
        )
    if not blocks:
        return ""
    return "LIVE MARKET CONTEXT (do not hallucinate outside these values):\n\n" + "\n\n".join(blocks)


def get_live_config(context_tickers: Optional[Iterable[str]] = None):
    """Build config for client.aio.live.connect().

    If ``context_tickers`` is provided, a live market context block is appended
    to the system instruction to keep the model from inventing strikes.
    """
    instruction = SYSTEM_INSTRUCTION
    if context_tickers:
        ctx = build_live_context(context_tickers)
        if ctx:
            instruction = f"{instruction}\n\n{ctx}"
    return {
        "response_modalities": ["AUDIO"],
        "system_instruction": instruction,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
    }


def execute_tool(name: str, args: dict) -> dict:
    """Run VegaEdge tool and return result. Used by WebSocket handler."""
    return dispatch_tool(name, args or {})
