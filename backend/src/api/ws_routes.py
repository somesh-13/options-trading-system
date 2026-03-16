"""WebSocket routes for VegaEdge Live Agent (Gemini Live API bridge)."""

import asyncio
import base64
import json
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from vegaedge.gemini_session import execute_tool, get_live_config, get_text_config, MODEL, TEXT_MODEL

logger = logging.getLogger("vegaedge.ws")
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
            elif msg_type == "interrupt":
                logger.info("Producer: client requested interrupt (manual stop)")
    except WebSocketDisconnect:
        logger.info("Producer: client disconnected")
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.exception("Producer error: %s", e)


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
            # Interruption / turn-complete signals
            if response.server_content:
                if getattr(response.server_content, "interrupted", False):
                    await websocket.send_json({"type": "interrupted"})
                if getattr(response.server_content, "turn_complete", False):
                    await websocket.send_json({"type": "turn_complete"})
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
        logger.exception("Consumer error: %s", e)
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
    logger.info("Connecting to Gemini Live model=%s", MODEL)
    prod = cons = None
    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            logger.info("Gemini Live session established")
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
                    logger.error("Task ended with error: %s", t.exception())
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.exception("ws_live session error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        logger.info("ws_live closing")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    """VegaEdge Chat: text-mode Gemini with tool loop and streaming."""
    await websocket.accept()
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        await websocket.send_json({"type": "error", "message": "Missing GEMINI_API_KEY"})
        await websocket.close(code=1011)
        return

    client = genai.Client(api_key=api_key)
    config = get_text_config()
    history: list[types.Content] = []

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if data.get("type") != "text" or not data.get("text"):
                continue

            user_text = data["text"]
            history.append(types.Content(role="user", parts=[types.Part.from_text(text=user_text)]))

            # Tool loop: keep calling generate_content until we get a text response
            max_tool_rounds = 10
            for _ in range(max_tool_rounds):
                response = await client.aio.models.generate_content(
                    model=TEXT_MODEL,
                    contents=history,
                    config=types.GenerateContentConfig(
                        system_instruction=config["system_instruction"],
                        tools=config["tools"],
                    ),
                )

                # Check for tool calls
                has_tool_calls = False
                if response.candidates and response.candidates[0].content:
                    candidate_parts = response.candidates[0].content.parts or []
                    function_calls = [p for p in candidate_parts if p.function_call]

                    if function_calls:
                        has_tool_calls = True
                        # Append model's tool call message to history
                        history.append(response.candidates[0].content)

                        tool_response_parts = []
                        for part in function_calls:
                            fc = part.function_call
                            name = fc.name
                            args = dict(fc.args) if fc.args else {}
                            try:
                                result = execute_tool(name, args)
                            except Exception as e:
                                result = {"error": str(e)}

                            # Send charts/signals to client as they occur
                            if name == "get_keltner_chart" and isinstance(result, dict) and result.get("image_b64"):
                                await websocket.send_json({
                                    "type": "chart",
                                    "data": result["image_b64"],
                                    "ticker": result.get("ticker", ""),
                                })
                            if name in ("analyze_ticker", "scan_watchlist") and isinstance(result, dict):
                                await websocket.send_json({"type": "signal", "data": result})

                            tool_response_parts.append(
                                types.Part.from_function_response(
                                    name=name,
                                    response={"result": result},
                                )
                            )

                        history.append(types.Content(role="user", parts=tool_response_parts))
                        continue  # Loop again to get model's text response

                # No tool calls — extract text and stream to client
                if not has_tool_calls:
                    text = response.text or ""
                    if text:
                        # Send the full response as a single streamed message
                        # (Gemini generate_content doesn't support true SSE streaming in
                        # the same way, so we send the complete text at once)
                        history.append(types.Content(role="model", parts=[types.Part.from_text(text=text)]))
                        await websocket.send_json({
                            "type": "transcript",
                            "role": "model",
                            "text": text,
                            "done": True,
                        })
                    break

    except WebSocketDisconnect:
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
