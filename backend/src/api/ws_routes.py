"""WebSocket routes for VegaEdge Live Agent (Gemini Live API bridge)."""

import asyncio
import base64
import json
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from vegaedge.gemini_session import execute_tool, get_live_config, MODEL

router = APIRouter()


async def _producer(websocket: WebSocket, session) -> None:
    """Read audio (and optional text) from client; send to Gemini session."""
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = data.get("type")
            if msg_type == "audio" and data.get("data"):
                chunk = base64.b64decode(data["data"])
                await session.send_realtime_input(
                    audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                )
            elif msg_type == "text" and data.get("text"):
                await session.send_realtime_input(text=data["text"])
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _consumer(websocket: WebSocket, session) -> None:
    """Receive from Gemini session; forward audio, transcript, chart, signal to client."""
    try:
        async for response in session.receive():
            # Audio
            if response.server_content and response.server_content.model_turn:
                for part in response.server_content.model_turn.parts:
                    if part.inline_data and part.inline_data.data:
                        b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                        await websocket.send_json({"type": "audio", "data": b64})
            # Transcript
            if response.server_content:
                if getattr(response.server_content, "input_transcription", None) and response.server_content.input_transcription.text:
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "user",
                        "text": response.server_content.input_transcription.text,
                    })
                if getattr(response.server_content, "output_transcription", None) and response.server_content.output_transcription.text:
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "model",
                        "text": response.server_content.output_transcription.text,
                    })
            # Tool call
            if response.tool_call:
                function_responses = []
                for fc in response.tool_call.function_calls:
                    name = fc.name
                    args = fc.args or {}
                    try:
                        result = execute_tool(name, args)
                    except Exception as e:
                        result = {"error": str(e)}
                    if name == "get_keltner_chart" and isinstance(result, dict) and result.get("image_b64"):
                        await websocket.send_json({
                            "type": "chart",
                            "data": result["image_b64"],
                            "ticker": result.get("ticker", ""),
                        })
                    if name in ("analyze_ticker", "scan_watchlist") and isinstance(result, dict):
                        await websocket.send_json({"type": "signal", "data": result})
                    function_responses.append(
                        types.FunctionResponse(
                            name=name,
                            id=fc.id,
                            response={"result": result},
                        )
                    )
                await session.send_tool_response(function_responses=function_responses)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """VegaEdge Live: bridge browser audio to Gemini Live API."""
    await websocket.accept()
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        await websocket.send_json({"type": "error", "message": "Missing GEMINI_API_KEY"})
        await websocket.close(code=1011)
        return
    client = genai.Client(api_key=api_key)
    config = get_live_config()
    prod = cons = None
    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            prod = asyncio.create_task(_producer(websocket, session))
            cons = asyncio.create_task(_consumer(websocket, session))
            done, pending = await asyncio.wait(
                [prod, cons],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            for t in done:
                if t.exception():
                    try:
                        t.result()
                    except Exception:
                        pass
    except asyncio.CancelledError:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
