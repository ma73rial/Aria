"""Provider-specific handlers for OpenAI, Groq, Anthropic, and Gemini."""
import json, logging, uuid

log = logging.getLogger("aria-proxy")

def _make_headers(key: str, provider: str) -> dict:
    h = {"User-Agent": "ARIA-Proxy/1.0", "Content-Type": "application/json"}
    if provider == "anthropic":
        h["x-api-key"] = key
        h["anthropic-version"] = "2023-06-01"
        h["anthropic-dangerous-direct-browser-access"] = "true"
    elif provider == "gemini":
        pass
    else:
        h["Authorization"] = f"Bearer {key}"
    return h

def _sse_frame(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

# ---- OpenAI / Groq compatible (passthrough) ----

async def _handle_openai_compat(auth, raw, stream, provider, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE):
    import httpx
    from fastapi import HTTPException
    from fastapi.responses import JSONResponse, StreamingResponse

    if not _HTTPX_AVAILABLE:
        raise HTTPException(status_code=501, detail="httpx not installed.")
    key = _get_key(auth, f"{provider.upper()}_API_KEY")
    endpoint = PROVIDER_ENDPOINTS[provider]
    body = {k: v for k, v in raw.items() if k not in ("provider",)}
    headers = _make_headers(key, provider)

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(endpoint, json=body, headers=headers)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}")

        if stream:
            async def forward():
                try:
                    async for chunk in resp.aiter_bytes():
                        yield chunk.decode()
                except Exception as exc:
                    log.exception("SSE forward error")
                    yield _sse_frame({"error": str(exc)})
            return StreamingResponse(
                forward(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        else:
            if not resp.is_success:
                try:
                    detail = json.loads(await resp.aread())
                except Exception:
                    detail = resp.text
                raise HTTPException(status_code=resp.status_code, detail=detail)
            return JSONResponse(content=resp.json())

async def _handle_openai(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE):
    return await _handle_openai_compat(auth, raw, stream, "openai", PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE)

async def _handle_groq(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE):
    return await _handle_openai_compat(auth, raw, stream, "groq", PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE)

# ---- Anthropic handler ----

def _anthropic_build_messages(messages: list) -> tuple:
    out = []
    system_parts = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "system":
            system_parts.append({"type": "text", "text": content or ""})
            continue
        if role == "assistant":
            blocks = []
            if content:
                blocks.append({"type": "text", "text": content})
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    try:
                        args = json.loads(tc["function"]["arguments"])
                    except (json.JSONDecodeError, KeyError):
                        args = {}
                    blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["function"]["name"], "input": args})
            out.append({"role": "assistant", "content": blocks})
            continue
        if role == "tool":
            parts = [{"type": "tool_result", "tool_use_id": msg.get("tool_call_id", ""), "content": content}]
            out.append({"role": "user", "content": parts})
            continue
        out.append({"role": "user", "content": content or ""})
    return out, system_parts

def _anthropic_build_tools(tools: list) -> list:
    out = []
    for t in tools:
        if t.get("type") == "function":
            fn = t.get("function", {})
            out.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
    return out

def _anthropic_sse_to_openai(line: str) -> str:
    line = line.strip()
    if not line or not line.startswith("data: "):
        return ""
    data_str = line[6:].strip()
    if data_str == "[DONE]":
        return "data: [DONE]\n\n"
    try:
        data = json.loads(data_str)
    except json.JSONDecodeError:
        return ""
    event_type = data.get("type", "")

    if event_type == "message_start":
        msg = data.get("message", {})
        return _sse_frame({"model": msg.get("model", ""), "choices": [{"index": 0, "delta": {"role": "assistant"}}]})
    elif event_type == "content_block_start":
        block = data.get("content_block", {})
        if block.get("type") == "tool_use":
            idx = data.get("index", 0)
            return _sse_frame({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": idx, "id": block.get("id", ""), "function": {"name": block.get("name", ""), "arguments": ""}}]}}]})
        return ""
    elif event_type == "content_block_delta":
        delta = data.get("delta", {})
        if delta.get("type") == "text_delta":
            return _sse_frame({"choices": [{"index": 0, "delta": {"content": delta.get("text", "")}}]})
        elif delta.get("type") == "input_json_delta":
            idx = data.get("index", 0)
            return _sse_frame({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": idx, "function": {"arguments": delta.get("partial_json", "")}}]}}]})
        return ""
    elif event_type == "message_delta":
        delta = data.get("delta", {})
        stop_reason = delta.get("stop_reason", "")
        usage = data.get("usage")
        msg_data = {}
        if stop_reason:
            fm = {"end_turn": "stop", "max_tokens": "length", "stop_sequence": "stop", "tool_use": "tool_calls"}
            msg_data["choices"] = [{"index": 0, "delta": {}, "finish_reason": fm.get(stop_reason, stop_reason)}]
        if usage:
            msg_data["usage"] = {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
            }
        return _sse_frame(msg_data) if msg_data else ""
    if data.get("error"):
        return _sse_frame({"error": data["error"]})
    return ""

async def _handle_anthropic(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE):
    import httpx
    from fastapi import HTTPException, JSONResponse, StreamingResponse

    if not _HTTPX_AVAILABLE:
        raise HTTPException(status_code=501, detail="httpx not installed.")
    key = _get_key(auth, "ANTHROPIC_API_KEY")
    endpoint = PROVIDER_ENDPOINTS["anthropic"]
    anthropic_msgs, system_parts = _anthropic_build_messages(raw.get("messages", []))

    body = {
        "model": raw.get("model", "claude-sonnet-4-20250514"),
        "messages": anthropic_msgs,
        "max_tokens": raw.get("max_tokens", 4096),
    }
    if system_parts:
        body["system"] = system_parts
    if raw.get("temperature") is not None:
        body["temperature"] = raw["temperature"]
    tools_raw = raw.get("tools")
    if tools_raw:
        body["tools"] = _anthropic_build_tools(tools_raw)
        body["tool_choice"] = {"type": "auto"}
    if raw.get("top_p") is not None:
        body["top_p"] = raw["top_p"]
    stop = raw.get("stop")
    if stop:
        body["stop_sequences"] = [stop] if isinstance(stop, str) else stop
    if stream:
        body["stream"] = True

    headers = _make_headers(key, "anthropic")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(endpoint, json=body, headers=headers)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Anthropic upstream error: {exc}")
        if not resp.is_success and not stream:
            try:
                detail = json.loads(await resp.aread())
            except Exception:
                detail = resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail)

        if stream:
            async def forward():
                buf = ""
                try:
                    async for chunk in resp.aiter_bytes():
                        buf += chunk.decode()
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            converted = _anthropic_sse_to_openai(line.strip())
                            if converted:
                                yield converted
                    if buf.strip():
                        converted = _anthropic_sse_to_openai(buf.strip())
                        if converted:
                            yield converted
                except Exception as exc:
                    log.exception("Anthropic SSE error")
                    yield _sse_frame({"error": str(exc)})
                finally:
                    yield "data: [DONE]\n\n"
            return StreamingResponse(
                forward(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        else:
            return JSONResponse(content=resp.json())

# ---- Gemini handler ----

def _gemini_build_contents(messages: list) -> tuple:
    contents = []
    system_parts = []
    role_map = {"user": "user", "assistant": "model", "system": "user"}
    for msg in messages:
        role = msg.get("role", "")
        text = msg.get("content", "")
        if role == "system":
            system_parts.append({"text": text or ""})
            continue
        if role == "tool":
            continue
        parts = []
        if text:
            parts.append({"text": text})
        if role == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except (json.JSONDecodeError, KeyError):
                    args = {}
                parts.append({"functionCall": {"name": tc["function"]["name"], "args": args}})
        contents.append({"role": role_map.get(role, "user"), "parts": parts})
    return contents, system_parts

def _gemini_build_tools(tools: list) -> list:
    funcs = []
    for t in tools:
        if t.get("type") == "function":
            fn = t.get("function", {})
            funcs.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
            })
    if funcs:
        return [{"functionDeclarations": funcs}]
    return []

def _gemini_sse_to_openai(data_str: str) -> str:
    if not data_str or data_str == "[DONE]":
        return "data: [DONE]\n\n"
    try:
        data = json.loads(data_str)
    except json.JSONDecodeError:
        return ""
    if data.get("error"):
        return _sse_frame({"error": data["error"]})
    candidates = data.get("candidates", [])
    if not candidates:
        return ""
    candidate = candidates[0]
    content = candidate.get("content", {})
    parts = content.get("parts", [])
    finish_reason = candidate.get("finishReason", "")
    usage_meta = None
    if "usageMetadata" in data:
        u = data["usageMetadata"]
        usage_meta = {"prompt_tokens": u.get("promptTokenCount", 0), "completion_tokens": u.get("candidatesTokenCount", 0), "total_tokens": u.get("totalTokenCount", 0)}
    choice = {"index": 0, "delta": {}}
    for part in parts:
        if "text" in part:
            choice["delta"]["content"] = part["text"]
        elif "functionCall" in part:
            fc = part["functionCall"]
            choice["delta"]["tool_calls"] = [{"index": 0, "id": f"call_{uuid.uuid4().hex[:8]}", "function": {"name": fc.get("name", ""), "arguments": json.dumps(fc.get("args", {}))}}]
    if finish_reason:
        fm = {"STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "safety", "RECITATION": "recitation", "OTHER": "stop"}
        choice["finish_reason"] = fm.get(finish_reason, finish_reason.lower())
    result = {"choices": [choice]}
    if usage_meta:
        result["usage"] = usage_meta
    return _sse_frame(result)

async def _handle_gemini(auth, raw, stream, GEMINI_BASE, _get_key, _HTTPX_AVAILABLE):
    import httpx
    from fastapi import HTTPException, JSONResponse, StreamingResponse

    if not _HTTPX_AVAILABLE:
        raise HTTPException(status_code=501, detail="httpx not installed.")
    key = _get_key(auth, "GEMINI_API_KEY")
    model = raw.get("model", "gemini-2.0-flash")
    contents, system_parts = _gemini_build_contents(raw.get("messages", []))

    body = {"contents": contents}
    if system_parts:
        body["systemInstruction"] = {"parts": system_parts}
    gen_config = {}
    if raw.get("temperature") is not None:
        gen_config["temperature"] = raw["temperature"]
    if raw.get("max_tokens") is not None:
        gen_config["maxOutputTokens"] = raw["max_tokens"]
    if raw.get("top_p") is not None:
        gen_config["topP"] = raw["top_p"]
    stop = raw.get("stop")
    if stop:
        gen_config["stopSequences"] = stop if isinstance(stop, list) else [stop]
    if gen_config:
        body["generationConfig"] = gen_config
    tools_raw = raw.get("tools")
    if tools_raw:
        funcs = _gemini_build_tools(tools_raw)
        if funcs:
            body["tools"] = funcs

    headers = {"User-Agent": "ARIA-Proxy/1.0", "Content-Type": "application/json"}

    if stream:
        endpoint = f"{GEMINI_BASE}/{model}:streamGenerateContent?key={key}&alt=sse"
    else:
        endpoint = f"{GEMINI_BASE}/{model}:generateContent?key={key}"

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(endpoint, json=body, headers=headers)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Gemini upstream error: {exc}")
        if not resp.is_success and not stream:
            try:
                detail = json.loads(await resp.aread())
            except Exception:
                detail = resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail)

        if stream:
            async def forward():
                buf = ""
                try:
                    async for chunk in resp.aiter_bytes():
                        buf += chunk.decode()
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            line = line.strip()
                            if not line or not line.startswith("data: "):
                                continue
                            converted = _gemini_sse_to_openai(line[6:].strip())
                            if converted:
                                yield converted
                    if buf.strip() and buf.strip().startswith("data: "):
                        converted = _gemini_sse_to_openai(buf.strip()[6:].strip())
                        if converted:
                            yield converted
                except Exception as exc:
                    log.exception("Gemini SSE error")
                    yield _sse_frame({"error": str(exc)})
                finally:
                    yield "data: [DONE]\n\n"
            return StreamingResponse(
                forward(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        else:
            return JSONResponse(content=resp.json())
