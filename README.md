# ARIA

**Autonomous Reasoning & Implementation Agent** — a browser-native AI coding collaborator powered by the Mistral API.

ARIA runs entirely in the browser. No backend, no build step, no install. Open a folder or start a virtual session and you have a pair programmer with full read/write access to your code.

---

## What it does

ARIA is a tool-calling agent that can read, write, and edit files; run JavaScript; fetch URLs; manage todos and memory across sessions; spawn subagents for isolated subtasks; and ask clarifying questions when it genuinely needs them. It operates in three modes that control how autonomously it acts:

| Mode | Behaviour |
|------|-----------|
| **Plan** | Read-only analysis. Maps the codebase, identifies problems, produces a concrete implementation plan. No writes. |
| **Edit** | Collaborative pair programming. Every file change is shown as a diff and requires approval before being applied. |
| **YOLO** | Autonomous execution. Chains reads, writes, and edits without interruption. Diffs auto-accept after 5 seconds. Best for large refactors or feature work with clear requirements. |

---

## Getting started

NEW: Aria got a backend. Start with:
```bash
# Python 
python server.py
```

Then open `http://localhost:8000`, enter your Mistral API key when prompted, and either:

- **Open Workspace** — picks a local folder via the File System Access API (Chrome/Edge)
- **New Session** — creates an in-browser virtual filesystem backed by IndexedDB (works everywhere)
- **Chat Without FS** — chat only, no file access

Your API key is stored in `api.key` and never leaves the server.

---

## Browser compatibility

| Feature | Chrome/Edge | Firefox | Safari |
|---------|-------------|---------|--------|
| Full functionality | ✅ | ⚠️ no File System Access API | ⚠️ no File System Access API |
| IDB sessions | ✅ | ✅ | ✅ |
| Local folder access | ✅ | ❌ | ❌ |

Local folder access (`Open Workspace`) requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), which is Chrome/Edge only. IDB sessions work in all modern browsers.

---

## Architecture

```
index.html          Entry point and HTML structure
styles.css          Single stylesheet — CSS custom properties throughout

js/
├── app.js          Boot, agent loop, context compression
├── api.js          Mistral streaming API client with retry logic
├── tools.js        Tool executor — all 25+ tool implementations
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

### How the agent loop works

1. User sends a message → `runAgent()` in `app.js`
2. Message history + system prompt → Mistral streaming API
3. Model returns text (streamed live) and/or tool calls
4. Each tool call is dispatched to `execTool()` in `tools.js`
5. Tool results are pushed back into the message history
6. Loop continues until the model returns a response with no tool calls
7. Conversation is saved to `localStorage`

Clarify/simple_question tools suspend the loop and re-enable the input so the user can answer inline — `S.running` stays `true` throughout so no second agent run can be triggered.

### Filesystem abstraction

ARIA presents a unified path API over two backends:

- **Machine** (`fsMode: 'machine'`) — wraps the browser's File System Access API. Paths are real filesystem paths. Requires user permission grant per folder.
- **IDB** (`fsMode: 'idb'`) — a virtual filesystem stored in IndexedDB under named sessions. Paths are prefixed `idb://session-name/`. Fully portable, no permissions needed.

`fs.js` exports `fsRead`, `fsWrite`, `fsList`, `fsMkdir`, `fsDelete`, `fsRename` — the rest of the codebase uses these exclusively and never touches the backends directly.

---

## Tools

The agent has access to these tools:

**Filesystem** — `read_file`, `read_file_range`, `read_many_files`, `write_file`, `edit_file`, `delete_file`, `rename_file`, `make_directory`, `list_directory`

**Workspace** — `init_filesystem`, `switch_workspace`, `list_workspaces`, `delete_workspace`

**Memory & todos** — `save_to_memory`, `add_todo`, `complete_todo`, `list_todos`

**Output** — `display_markdown`, `display_html`, `create_artifact`, `make_pdf`

**Execution** — `run_javascript`, `fetch_request`, `git_status`

**Agent** — `think_deeper`, `clarify`, `simple_question`, `spawn_subagent`, `suggest_mode`

**Utility** — `date_now`, `search_conversations`

---

## Settings

All settings live in the gear icon at the bottom of the sidebar:

- **Mistral API Key** — validated against the API on save
- **Model** — Mistral Large, Codestral, Mistral Medium, Mistral Small, Mistral Nemo
- **Temperature** — default 0.7
- **Max Tokens** — default 4096

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Cmd/Ctrl+K` | Focus prompt |
| `Cmd/Ctrl+\` | Toggle sidebar |
| `Cmd/Ctrl+M` | Cycle modes (Plan → Edit → YOLO) |
