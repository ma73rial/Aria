# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ARIA** — Autonomous Reasoning & Implementation Agent. A browser-native AI coding collaborator that runs entirely in the browser with a Python backend proxy server. Supports multiple LLM providers (Mistral, OpenAI, Anthropic, Gemini, Groq, and custom OpenAI-compatible endpoints).

## Architecture

### Frontend (vanilla JS modules, no build step)
```
index.html          Entry point and HTML structure
styles.css          Single stylesheet — CSS custom properties throughout
js/
├── app.js          Boot, agent loop, context compression
├── api.js          Mistral streaming API client with retry logic (proxies via backend)
├── tools.js        Tool executor — 25+ tool implementations
├── tools-schema.js Tool definitions passed to the API
├── systemPrompt.js System prompt builder (mode-aware, session-aware)
├── state.js        Application state, persistence (localStorage), undo/rewind
├── ui.js           All DOM rendering — messages, diffs, accordions, modals
├── events.js       Event wiring — keyboard shortcuts, sidebar, settings
├── fs.js           Filesystem abstraction over OPFS/IDB and File System Access API
├── diff.js         Diff computation and hunk generation
├── review.js       Diff review modal — per-file accept/reject
├── markdown.js     Markdown rendering (marked + highlight.js)
├── icons.js        Inline SVG icon system
├── artifacts.js    HTML/code/markdown artifact renderer
├── subagents.js    Subagent spawning and result handling
├── widgets.js      Clarify and simple_question interactive widgets
└── utils.js        Bus (event emitter), toast, escape, scroll helpers
```

### Backend (Python FastAPI)
```
server.py           FastAPI server proxying to Mistral/OpenAI/Anthropic/Gemini/Groq
requirements.txt    fastapi, uvicorn, mistralai, python-dotenv, sse-starlette
.env.example        MISTRAL_API_KEY (optional, clients send keys via Authorization header)
```

### Filesystem Abstraction (js/fs.js)
Two backends unified under a single path API:
- **Machine** (`fsMode: 'machine'`) — File System Access API (Chrome/Edge only). Real filesystem paths.
- **IDB** (`fsMode: 'idb'`) — Virtual filesystem in IndexedDB. Prefixed `idb://session-name/`. Works everywhere.

Exports: `fsRead`, `fsWrite`, `fsList`, `fsMkdir`, `fsDelete`, `fsRename`, `fsReadRange`, `initIDBSession`, `switchWorkspace`, `refreshSessions`, `machOpen`, `machReadBlob`.

### Agent Loop (js/app.js)
1. User sends message → `runAgent()`
2. Message history + system prompt → streaming API via `streamChatWithRetry()`
3. Model returns text and/or tool calls
4. Each tool call dispatched to `execTool()` in `tools.js`
5. Tool results pushed back into message history
6. Loop continues until no tool calls returned
7. Conversation saved to `localStorage`

Three modes:
- **Plan** — Read-only analysis, no file writes
- **Edit** — Pair programming, every diff requires approval
- **YOLO** — Autonomous, diffs auto-accept after 5s (configurable)

## Common Commands

### Running the Server
```bash
# Start backend proxy server (port 8080)
python server.py
# Or with auto-reload
python server.py --reload

# Access at http://localhost:8080
```

### Development
- No build step — edit files directly, refresh browser
- Frontend served statically by FastAPI from project root
- JS modules loaded via `<script type="module">` in index.html
- CSS custom properties in `styles.css` for theming

### Testing
No formal test suite exists. Test by:
1. Running `python server.py`
2. Opening `http://localhost:8080`
3. Adding an API key in Settings
4. Opening a workspace (File System Access API or IDB session)
5. Sending a message to the agent

## Key Files to Understand

| File | Purpose |
|------|---------|
| `js/app.js:37` | `runAgent()` — main agent loop |
| `js/tools.js:134` | `execTool()` — all tool implementations |
| `js/tools-schema.js` | Tool definitions for function calling |
| `js/state.js:6` | `S` — central mutable state object |
| `js/systemPrompt.js:345` | `buildSysPrompt()` — constructs system prompt per mode |
| `js/api.js:60` | `streamChat()` — streaming with retry/fallback |
| `js/fs.js` | Filesystem abstraction (both backends) |
| `server.py:803` | `/v1/chat/completions` — multi-provider proxy endpoint |

## Provider Configuration

Providers defined in `js/state.js:85` (`PROVIDERS` object):
- `mistral`, `openai`, `groq`, `anthropic`, `gemini`, `custom`

Each has: label, keyPlaceholder, models array, fallback chain, dynamicModels flag.

Model context windows in `MODEL_CTX` (js/state.js:56).

## Persistence

All state in `localStorage`:
- `aria_api_keys` — per-provider API keys
- `aria_custom_models` — user-added models
- `aria_custom_provider` — custom OpenAI-compatible base URL
- `aria_provider_models` — discovered models per provider
- `aria_prov`, `aria_m` — current provider/model
- `aria_mode` — plan/edit/yolo
- `aria_todos`, `aria_mem` — todos and memory
- `aria_convs` — conversation history
- `aria_editHistory` — last 50 edits (for undo)
- `aria_pending_diffs` — YOLO mode diffs awaiting batch review
- `aria_idb_sess`, `aria_fs_mode`, `aria_cwd` — filesystem state
- `aria_temp`, `aria_maxtok` — generation params

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Cmd/Ctrl+K` | Focus prompt |
| `Cmd/Ctrl+\` | Toggle sidebar |
| `Cmd/Ctrl+M` | Cycle modes (Plan → Edit → YOLO) |

## Important Notes

- **No API keys stored server-side** — clients send `Authorization: Bearer <key>` header
- **Frontend is a SPA** — FastAPI serves index.html for unmatched routes
- **Context compression** — triggers at 76% of model context window (js/app.js:247)
- **Edit history** — records before/after for undo (js/state.js:240)
- **Subagents** — max depth 2, isolated context (js/tools.js:520)
- **Rate limit handling** — exponential backoff + model step-down (js/api.js)
- **Multimodal** — images attached as data URLs in message content arrays