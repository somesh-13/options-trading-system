"""
Gemini Live API session configuration for VegaEdge.
Session is created in the WebSocket handler via client.aio.live.connect().
"""

import os
from vegaedge.tools import TOOL_DECLARATIONS, dispatch_tool

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
TEXT_MODEL = "gemini-2.5-flash"
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
    from google.genai import types

    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=TOOL_DECLARATIONS)],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=os.getenv("GEMINI_VOICE", "Kore"),
                )
            ),
        ),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_MEDIUM,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                prefix_padding_ms=20,
                silence_duration_ms=600,
            ),
        ),
    )


def get_text_config():
    """Build config for text-mode Gemini (generate_content)."""
    return {
        "system_instruction": SYSTEM_INSTRUCTION,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
    }


def execute_tool(name: str, args: dict) -> dict:
    """Run VegaEdge tool and return result. Used by WebSocket handler."""
    return dispatch_tool(name, args or {})
