"""
Gemini Live API session configuration for VegaEdge.
Session is created in the WebSocket handler via client.aio.live.connect().
"""

import os
from vegaedge.tools import TOOL_DECLARATIONS, dispatch_tool

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
# Fallback for older env names
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

SYSTEM_INSTRUCTION = """You are VegaEdge, an AI options trading analyst. You help traders identify high-probability setups using IV vs HV (implied vs historical volatility) analysis.

You can analyze any stock ticker and provide:
- IV/HV ratio (cheap <0.8, expensive >1.3) and signal: BUY, SELL, or NEUTRAL
- Actionable ideas: when IV is high (SELL) consider selling options; when IV is low (BUY) consider buying
- Use the tools: analyze_ticker for one stock, scan_watchlist for the full watchlist, get_keltner_chart for a chart, get_signal_details for details.

Speak naturally and concisely. When reporting signals, emphasize the actionable recommendation and key metrics. Always mention risk (position sizing, not financial advice).

Watchlist: HOOD, CIFR, WULF, PYPL, GRAB (you can analyze any ticker on request)."""


def get_live_config():
    """Build config for client.aio.live.connect()."""
    return {
        "response_modalities": ["AUDIO"],
        "system_instruction": SYSTEM_INSTRUCTION,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
    }


def execute_tool(name: str, args: dict) -> dict:
    """Run VegaEdge tool and return result. Used by WebSocket handler."""
    return dispatch_tool(name, args or {})
