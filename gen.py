import os

ROOT = "/Users/maximilianpezzullo/aria"
BAK = os.path.join(ROOT, "server.py.bak")
OUT = os.path.join(ROOT, "server.py")

with open(BAK, "r") as f:
    orig = f.read()

with open(os.path.join(ROOT, "provider_handlers.py"), "r") as f:
    handlers = f.read()

lines = orig.split("\n")

# Extract parts from original
part1 = "\n".join(lines[0:126])
part2 = "\n".join(lines[127:214])
part3 = "\n".join(lines[213:307])
part4 = "\n".join(lines[306:392])
part5 = "\n".join(lines[421:434])
part6 = "\n".join(lines[433:506])
part7 = "\n".join(lines[391:422])
part8 = "\n".join(lines[505:])

# Modify part1: add uuid, provider endpoints, _get_key
part1 = part1.replace("from contextlib import asynccontextmanager", "import uuid\nfrom contextlib import asynccontextmanager")
part1 = part1.replace('STATE = {"client": None, "key": None}',
    'STATE = {"client": None, "key": None}\n\n'
    'PROVIDER_ENDPOINTS = {\n'
    '    "mistral": "https://api.mistral.ai/v1/chat/completions",\n'
    '    "openai": "https://api.openai.com/v1/chat/completions",\n'
    '    "groq": "https://api.groq.com/openai/v1/chat/completions",\n'
    '    "anthropic": "https://api.anthropic.com/v1/messages",\n'
    '}\n'
    'GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"')

part1 += '''


def _get_key(auth_header: str, env_var: str) -> str:
    if not auth_header:
        env_key = os.getenv(env_var)
        if not env_key:
            raise HTTPException(status_code=401, detail=f"Missing Authorization header and no {env_var} env var.")
        return env_key.strip()
    prefix = "Bearer "
    if not auth_header.startswith(prefix):
        raise HTTPException(status_code=401, detail="Authorization header must use the Bearer scheme.")
    key = auth_header[len(prefix):].strip()
    if not key:
        raise HTTPException(status_code=401, detail="Empty API key.")
    return key
'''

# Replace docstring
old_doc = '"""\nARIA Backend Proxy Server\n=========================' + '\n' + 'Proxies chat completion requests to the Mistral AI API using the\nofficial Mistral Python SDK'
# Simpler: just find and replace the main docstring
part1 = part1[:part1.find('"""')] + '"""\nARIA Backend Proxy Server\n=========================' + '\n' + 'Multi-provider proxy for AI chat completions.' + '\n' + '"""'
# Actually, let me just do a simple replacement
part1 = part1.replace('ARIA Backend Proxy Server', 'ARIA Multi-Provider Proxy Server')

# Build new route handler
new_route = '''
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    auth = request.headers.get("Authorization", "")
    try:
        raw = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    provider = raw.get("provider", "mistral").lower().strip()
    stream = raw.get("stream", False)

    if provider == "mistral":
        return await _handle_mistral(auth, raw, stream)
    elif provider == "openai":
        return await _handle_openai(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE)
    elif provider == "groq":
        return await _handle_groq(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE)
    elif provider == "anthropic":
        return await _handle_anthropic(auth, raw, stream, PROVIDER_ENDPOINTS, _get_key, _HTTPX_AVAILABLE)
    elif provider == "gemini":
        return await _handle_gemini(auth, raw, stream, GEMINI_BASE, _get_key, _HTTPX_AVAILABLE)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
'''

# Build Mistral handler wrapper
# Extract the body of the original chat_completions function (without the def line)
route_body = part4.split("async def chat_completions")[-1]

# Replace import of _SR inside route_body
route_body = route_body.replace("from fastapi.responses import StreamingResponse as _SR", "")

mistral_handler = '''
async def _handle_mistral(auth, raw, stream):
    client = _get_client(auth)
    model = raw.get("model", "mistral-large-latest")
    messages_raw = raw.get("messages", [])
    temperature = raw.get("temperature")
    max_tokens = raw.get("max_tokens")
    tools_raw = raw.get("tools")
    tool_choice_raw = raw.get("tool_choice")
    top_p = raw.get("top_p")
    stop = raw.get("stop")
    random_seed = raw.get("random_seed")
    response_format = raw.get("response_format")
    presence_penalty = raw.get("presence_penalty")
    frequency_penalty = raw.get("frequency_penalty")
    safe_prompt = raw.get("safe_prompt")

    messages = _build_messages(messages_raw)
    kwargs = {"model": model, "messages": messages, "stream": stream}

    for key, val in [
        ("temperature", temperature), ("max_tokens", max_tokens), ("top_p", top_p),
        ("stop", stop), ("random_seed", random_seed), ("presence_penalty", presence_penalty),
        ("frequency_penalty", frequency_penalty), ("safe_prompt", safe_prompt),
        ("response_format", response_format),
    ]:
        if val is not None:
            kwargs[key] = val

    if tools_raw:
        kwargs["tools"] = _build_tools(tools_raw)
        kwargs["tool_choice"] = _build_tool_choice(tool_choice_raw) or "auto"
    elif tool_choice_raw:
        log.debug("Ignoring tool_choice without tools.")

    if stream:
        from fastapi.responses import StreamingResponse as _SR
        return _SR(
            _mistral_sse_chunks(client, kwargs),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    result = await _mistral_non_stream(client, kwargs)
    return JSONResponse(content=result)
'''

# Assemble final
final = part1 + "\n\n"
final += "# --- Message / tool builders ---\n"
final += part2 + "\n\n"
final += part3 + "\n\n"
final += new_route + "\n\n"
final += "# --- Serialization helper ---\n"
final += part5 + "\n\n"
final += "def _sse_frame(data: dict) -> str:\n"
final += "    return 'data: {}'.format(json.dumps(data)) + '\\n\\n'\n"
final += "\n"
final += "# --- Mistral handler ---\n"
final += mistral_handler + "\n"
final += part6 + "\n\n"
final += "# --- Provider handlers ---\n"
final += handlers + "\n\n"
final += part7 + "\n\n"
final += part8 + "\n"

# Rename Mistral functions
final = final.replace("async def _sse_chunks", "async def _mistral_sse_chunks")
final = final.replace("async def _non_stream_chat", "async def _mistral_non_stream")
final = final.replace("_sse_chunks(client", "_mistral_sse_chunks(client")
final = final.replace("_non_stream_chat(client", "_mistral_non_stream(client")

# Update version and title
final = final.replace('title="ARIA Mistral Proxy"', 'title="ARIA Multi-Provider Proxy"')
final = final.replace('version="1.0.0"', 'version="1.1.0"')

# Update description in entry point
final = final.replace('description="ARIA Mistral Proxy Server"', 'description="ARIA Multi-Provider Proxy Server"')

# Add provider line to startup message
final = final.replace(
    'print(f"\\U0001f680 ARIA starting on http://{args.host}:{args.port}")',
    'print(f"ARIA starting on http://{args.host}:{args.port}")'
)
# Add provider info
final = final.replace(
    'print(f"   Frontend: http://{args.host}:{args.port}/")',
    'print(f"   Frontend: http://{args.host}:{args.port}/")' +
    '\n    print(f"   Providers: Mistral, OpenAI, Groq, Anthropic, Gemini")'
)

with open(OUT, 'w') as f:
    f.write(final)

print(f"Written: {len(final)} bytes, {final.count(chr(10))} lines")
