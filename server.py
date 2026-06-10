"""
ARIA Backend Proxy Server
=========================
Proxies chat completion requests to the Mistral AI API using the
official Mistral Python SDK.  Handles both streaming (SSE) and
non-streaming calls, and transparently maps the front-end's plain
JSON body into the strongly-typed SDK models — avoiding 422 errors
that raw `fetch` requests would trigger due to API schema changes.

Usage
-----
    # Start the server (port 8080 by default)
    python server.py

    # Or via uvicorn directly
    uvicorn server:app --host 0.0.0.0 --port 8080 --reload

Environment variables
---------------------
    MISTRAL_API_KEY     Optional.  If set, the server will use this key
                        for every request.  Otherwise the client must
                        provide one via the Authorization header.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mistralai.client import Mistral

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("aria-proxy")

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
# The server holds NO API key.  The client must send a Mistral API key
# on every request via the ``Authorization: Bearer <key>`` header.
# The key is stored client-side (localStorage) and is the user's own.

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

STATE = {"client": None, "key": None}


async def run_in_thread(fn, *args, **kwargs):
    """Run a sync call in a thread-pool so the async event loop stays responsive."""
    import asyncio
    import concurrent.futures
    loop = asyncio.get_running_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        return await loop.run_in_executor(
            ex, lambda: fn(*args, **kwargs)
        )


def _get_client(auth_header: str) -> Mistral:
    """Return a (cached) Mistral client keyed by the request's bearer token.

    If the ``Authorization`` header is missing or empty, fall back to the
    ``MISTRAL_API_KEY`` environment variable. This makes local testing
    easier – the client can set the key once in the environment instead of
    sending it on every request.
    """
    if not auth_header:
        # Fallback to environment variable when header is absent.
        env_key = os.getenv("MISTRAL_API_KEY")
        if not env_key:
            raise HTTPException(status_code=401, detail="Missing Authorization header and no MISTRAL_API_KEY env var.")
        key = env_key.strip()
    else:
        prefix = "Bearer "
        if not auth_header.startswith(prefix):
            raise HTTPException(
                status_code=401,
                detail="Authorization header must use the Bearer scheme.",
            )
        key = auth_header[len(prefix):].strip()
        if not key:
            raise HTTPException(status_code=401, detail="Empty API key.")

    if key == STATE["key"] and STATE["client"]:
        return STATE["client"]
    client = Mistral(api_key=key)
    STATE["key"] = key
    STATE["client"] = client
    return client


# ---------------------------------------------------------------------------
# Message / tool builders  (both stream and non-stream use the same TypedDicts)
# ---------------------------------------------------------------------------

# The Mistral SDK v2.x uses TypedDict unions discriminated by ``role``.
# Both ChatCompletionRequestMessage and ChatCompletionStreamRequestMessage
# accept the same SystemMessageTypedDict / UserMessageTypedDict / etc.


def _build_messages(
    raw: List[Dict[str, Any]],
) -> List[Any]:
    """Convert JSON messages into SDK TypedDicts."""
    from mistralai.client.models.assistantmessage import (
        AssistantMessageTypedDict,
    )
    from mistralai.client.models.systemmessage import SystemMessageTypedDict
    from mistralai.client.models.toolmessage import ToolMessageTypedDict
    from mistralai.client.models.usermessage import UserMessageTypedDict

    out: List[Any] = []
    for msg in raw:
        role = msg.get("role", "")
        content = msg.get("content")

        if role == "system":
            out.append(SystemMessageTypedDict(
                content=content or "", role="system"
            ))
        elif role == "user":
            out.append(UserMessageTypedDict(
                content=content or "", role="user"
            ))
        elif role == "assistant":
            d: Dict[str, Any] = {"role": "assistant"}
            if content is not None:
                d["content"] = content
            if msg.get("tool_calls"):
                d["tool_calls"] = msg["tool_calls"]
            out.append(AssistantMessageTypedDict(**d))
        elif role == "tool":
            d: Dict[str, Any] = {"role": "tool", "content": content or ""}
            if msg.get("tool_call_id"):
                d["tool_call_id"] = msg["tool_call_id"]
            if msg.get("name"):
                d["name"] = msg["name"]
            out.append(ToolMessageTypedDict(**d))
        else:
            log.warning("Unknown message role %r – sending as user", role)
            out.append(UserMessageTypedDict(
                content=content or "", role="user"
            ))
    return out


def _build_tools(raw: List[Dict[str, Any]]) -> List[Any]:
    """Convert raw JSON tool definitions into SDK Tool TypedDicts."""
    from mistralai.client.models.tool import ToolTypedDict

    out: List[Any] = []
    for t in raw:
        if t.get("type") == "function":
            fn = t.get("function", {})
            out.append(
                ToolTypedDict(
                    type="function",
                    function={
                        "name": fn.get("name", ""),
                        "description": fn.get("description", ""),
                        "parameters": fn.get(
                            "parameters",
                            {"type": "object", "properties": {}},
                        ),
                    },
                )
            )
        else:
            log.warning("Unknown tool type %r – skipping", t.get("type"))
    return out


def _build_tool_choice(raw: Any) -> Any:
    """Map tool_choice to SDK-compatible value."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw  # "auto" | "none" | "any" | "required"
    return raw  # ToolChoice object


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("ARIA proxy ready.  Awaiting client requests.")
    yield
    STATE["client"] = None
    STATE["key"] = None


app = FastAPI(
    title="ARIA Mistral Proxy",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Static frontend (served from the project root)
# ---------------------------------------------------------------------------
#
# Strategy:
#   - /js/* is mounted as a static sub-app so all modules in js/ are served.
#   - Top-level static files (styles.css, index.html) are served by
#     individual routes.
#   - /v1/* is reserved for API routes (defined below).
#   - Any other GET path falls through to index.html (SPA-style fallback).

# Serve the entire js/ directory at /js/*.
app.mount(
    "/js",
    StaticFiles(directory=os.path.join(_PROJECT_ROOT, "js"), check_dir=True),
    name="js-assets",
)

_NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate"}


@app.get("/")
async def index():
    return FileResponse(
        os.path.join(_PROJECT_ROOT, "index.html"),
        headers=_NO_CACHE,
    )


@app.get("/styles.css")
async def styles_css():
    return FileResponse(
        os.path.join(_PROJECT_ROOT, "styles.css"),
        media_type="text/css",
        headers=_NO_CACHE,
    )


@app.get("/favicon.ico")
async def favicon():
    f = os.path.join(_PROJECT_ROOT, "favicon.ico")
    if os.path.isfile(f):
        return FileResponse(f, headers=_NO_CACHE)
    raise HTTPException(status_code=404)


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """
    SPA fallback: any GET that didn't match an API route or a static asset
    serves index.html so the front-end can take over.
    """
    # Only fall back for paths that look like frontend routes (no file extension).
    # Requests for missing static files will 404 instead of loading the SPA.
    if "." in full_path:
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(os.path.join(_PROJECT_ROOT, "index.html"))


# ---------------------------------------------------------------------------
# Route: POST /v1/chat/completions
# ---------------------------------------------------------------------------


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """
    Proxy to Mistral Chat Completions API.

    Accepts the same JSON body as ``POST /v1/chat/completions`` on
    ``api.mistral.ai``.  Supports both streaming (``stream: true``) and
    non-streaming modes.
    """
    auth = request.headers.get("Authorization", "")
    client = _get_client(auth)

    try:
        raw = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    # Extract fields from the request body
    model: str = raw.get("model", "mistral-large-latest")
    messages_raw: list[dict[str, Any]] = raw.get("messages", [])
    stream: bool = raw.get("stream", False)
    temperature: Any = raw.get("temperature")
    max_tokens: Any = raw.get("max_tokens")
    tools_raw: Any = raw.get("tools")
    tool_choice_raw = raw.get("tool_choice")
    top_p: Any = raw.get("top_p")
    stop: Any = raw.get("stop")
    random_seed: Any = raw.get("random_seed")
    response_format: Any = raw.get("response_format")
    presence_penalty: Any = raw.get("presence_penalty")
    frequency_penalty: Any = raw.get("frequency_penalty")
    safe_prompt: Any = raw.get("safe_prompt")

    # Build messages via TypedDicts
    messages = _build_messages(messages_raw)

    # Build the kwargs dict that matches the SDK method signature
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
    }

    # Only pass non-None optional fields
    for key, val in [
        ("temperature", temperature),
        ("max_tokens", max_tokens),
        ("top_p", top_p),
        ("stop", stop),
        ("random_seed", random_seed),
        ("presence_penalty", presence_penalty),
        ("frequency_penalty", frequency_penalty),
        ("safe_prompt", safe_prompt),
        ("response_format", response_format),
    ]:
        if val is not None:
            kwargs[key] = val

    # Tools
    if tools_raw:
        kwargs["tools"] = _build_tools(tools_raw)
        kwargs["tool_choice"] = _build_tool_choice(tool_choice_raw) or "auto"
    elif tool_choice_raw:
        log.debug("Ignoring tool_choice without tools.")

    if stream:
        from fastapi.responses import StreamingResponse as _SR
        return _SR(
            _sse_chunks(client, kwargs),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming
    result = await _non_stream_chat(client, kwargs)
    return JSONResponse(content=result)


# ---------------------------------------------------------------------------
# Test streaming endpoint
# ---------------------------------------------------------------------------

@app.get("/test/stream")
async def test_stream():
    """Yield a few dummy SSE frames for client‑side testing.

    This endpoint is useful when the developer does not have a valid
    Mistral API key but wants to verify that the front‑end SSE parser works
    correctly. It emits three simple ``data: {json}`` frames followed by a
    ``[DONE]`` terminator.
    """
    async def generator():
        # Simple payloads mimicking the shape of a real CompletionEvent.
        for i in range(3):
            payload = {"id": f"test-{i}", "object": "chat.completion.chunk", "choices": [{"delta": {"content": f"token{i}"}}]}
            frame = f"data: {json.dumps(payload)}\n\n"
            yield frame
            await asyncio.sleep(0.1)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


def _serialise(obj: Any) -> Dict[str, Any]:
    """Convert an SDK model into a plain dict (handles pydantic, NamedTuple, etc.)."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    if hasattr(obj, "_asdict"):
        return obj._asdict()
    if isinstance(obj, dict):
        return obj
    return dict(obj)


async def _sse_chunks(client: Mistral, kwargs: Dict[str, Any]):
    """
    Async generator yielding raw SSE text strings.

    Each string is one complete SSE frame: ``data: {json}\\n\\n``

    This is exactly the format the browser-side SSE parser in
    ``js/api.js`` reads via ``buf.indexOf('\\n\\n')`` and
    ``ln.startsWith('data:')``.
    """
    try:
        stream_resp = await client.chat.stream_async(**kwargs)
    except Exception as exc:
        log.exception("Stream init error")
        # Handle 429 rate limiting errors specifically
        if "rate limit" in str(exc).lower() or "429" in str(exc):
            error_data = {
                "error": {
                    "message": "Rate limit exceeded",
                    "type": "rate_limited",
                    "code": 1300,
                    "status": 429
                }
            }
            yield f"data: {json.dumps(error_data)}\n\n"
        else:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        return

    async for chunk in stream_resp:
        raw = _serialise(chunk)
        # Unwrap the CompletionEvent envelope {"data": {...}} -> {...}
        if isinstance(raw, dict) and "data" in raw and len(raw) == 1:
            raw = raw["data"]
        frame = f"data: {json.dumps(raw)}\n\n"
        log.debug("SSE chunk: %s", frame[:120])
        yield frame

    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Non-streaming
# ---------------------------------------------------------------------------


async def _non_stream_chat(
    client: Mistral, kwargs: Dict[str, Any]
) -> Dict[str, Any]:
    """Run a non-streaming chat completion and return the serialised result."""
    try:
        resp = await client.chat.complete_async(**kwargs)
    except Exception as exc:
        log.exception("Non-stream error")
        # Handle 429 rate limiting errors specifically
        if "rate limit" in str(exc).lower() or "429" in str(exc):
            raise HTTPException(
                status_code=429,
                detail={
                    "error": {
                        "message": "Rate limit exceeded",
                        "type": "rate_limited",
                        "code": 1300,
                        "status": 429
                    }
                }
            )
        else:
            raise HTTPException(status_code=502, detail=str(exc))

    return _serialise(resp)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ARIA Mistral Proxy Server")
    parser.add_argument(
        "--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8080, help="Port (default: 8080)"
    )
    parser.add_argument(
        "--reload", action="store_true",
        help="Enable auto-reload for development"
    )
    args = parser.parse_args()

    print(f"🚀 ARIA starting on http://{args.host}:{args.port}")
    print(f"   Frontend: http://{args.host}:{args.port}/")
    print(f"   API:       http://{args.host}:{args.port}/v1/chat/completions")
    print(f"   The server holds no API key — clients send it via Authorization header.")
    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )
