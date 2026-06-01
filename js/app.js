// Entry point and main agent loop.
// Bootstraps on DOMContentLoaded, then runs the tool-calling loop.

import { S, Live } from './state.js';
import { Bus, toast, fileToBase64, fileToText } from './utils.js';
import { renderRich, highlightAll } from './markdown.js';
import { ICONS } from './icons.js';
import { initIDBSession, machGit, switchWorkspace, refreshSessions } from './fs.js';
import { streamChatWithRetry, apiChat, ctxPct } from './api.js';
import { buildSysPrompt } from './systemPrompt.js';
import { TOOLS, execTool } from './tools.js';
import {
  startTurn, closeTurn, addThought, addToolRow, finishToolRow,
  addUserMsg, addErrBlock, appendToTurn, addFinal,
  setInput, updateUI, updateCtxBar, updateFileTree, renderToolResult,
  renderConvList, renderAttachBar, currentTurn
} from './ui.js';

export async function afterFsInit(type, name) {
  S.fsMode = type;
  if (type === 'machine') {
    try {
      const br = await machGit();
      S.gitBranch = br;
    } catch { S.gitBranch = null; }
  } else {
    S.gitBranch = null;
  }
  updateUI();
  const el = document.getElementById('fs-info');
  if (el) el.innerHTML = (type === 'machine' ? ICONS.folderOpen(12) + ' ' : ICONS.database(12) + ' ') + name;
  const wsDisp = document.getElementById('ws-display');
  if (wsDisp) wsDisp.textContent = name;
  toast('Workspace: ' + name);
}

export async function runAgent(input) {
  if (S.running) return;
  if (!S.key) {
    toast('No API key -- open Settings and save your key.');
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('hide');
    document.getElementById('main')?.classList.add('sb-open');
    return;
  }
  S.running = true;
  setInput(false);

  // Build the prompt content with attached file data.
  let content = input;
  if (S.files.length) {
    content += '\n\n**Attached files:**\n';
    for (const f of S.files) {
      if (f.type.startsWith('image/')) {
        content += '- ' + f.name + ' (' + f.type + ', ' + Math.round(f.size / 1024) + 'KB)\n';
      } else {
        const t = await fileToText(f, 2000);
        content += '- ' + f.name + ' (' + (f.type || 'text/plain') + ')\n```\n' + t + '\n```\n';
      }
    }
    content += '\nNote: Files are available for analysis. Image files are processed separately.';
  }

  addUserMsg(input, S.files);
  S.files = [];
  renderAttachBar();
  S.msgs.push({ role: 'user', content });
  startTurn();

  let turns = 0;
  try {
    while (turns++ < 22) {
      const pct = ctxPct();
      updateCtxBar(pct);
      if (pct > 0.76) await compressCtx();

      const apiMsgs = [{ role: 'system', content: buildSysPrompt() }, ...S.msgs];

      let resp;
      try {
        resp = await streamChatWithRetry(apiMsgs, TOOLS, {
          onDelta(chunk, full) {
            // Update the streaming thought block in real-time.
            if (!currentTurn) return;
            let last = currentTurn.querySelector('.thought:last-child');
            if (!last) {
              // Create a new thought block if none exists.
              const b = document.createElement('div');
              b.className = 'thought';
              currentTurn.appendChild(b);
              last = b;
            }
            last.innerHTML = renderRich(full);
            highlightAll(last);
          },
        });
      } catch (e) {
        if (e.name === 'AbortError') { closeTurn(); break; }
        addErrBlock('API error: ' + e.message);
        break;
      }

      const msg = resp;
      if (!msg.content && !msg.tool_calls?.length) {
        addErrBlock('No response from API.');
        break;
      }

      S.msgs.push({
        role: 'assistant',
        content: msg.content || '',
        ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
      });

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}
          const row = addToolRow(tc.function.name, args);
          let result;
          try {
            const toolResult = execTool(tc.function.name, args);
            result = toolResult instanceof Promise ? await toolResult : toolResult;
            finishToolRow(row, result.success !== false);
            renderToolResult(tc.function.name, result);
          } catch (e) {
            result = { success: false, message: e.message };
            finishToolRow(row, false);
            addErrBlock(tc.function.name + ': ' + e.message);
          }
          S.msgs.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      // Done: no tool calls.
      closeTurn();
      // Convert the streaming thought to a final block instead of creating a new one.
      if (msg.content?.trim()) {
        const thought = currentTurn?.querySelector('.thought:last-child');
        if (thought) {
          // Restyle the thought as a final block.
          thought.className = 'final';
          // Prepend the green dot.
          const dot = document.createElement('div');
          dot.className = 'fdot';
          thought.insertBefore(dot, thought.firstChild);
        } else {
          // Fallback: no streaming thought exists, create one.
          addFinal(msg.content.trim());
        }
      }
      break;
    }
    if (turns >= 22) { closeTurn(); addErrBlock('Max turns reached. Continue in next message.'); }
  } catch (e) {
    closeTurn();
    addErrBlock('Unexpected error: ' + e.message);
    console.error(e);
  }

  // Persist.
  saveConv();
  updateCtxBar(ctxPct());
  S.running = false;
  setInput(true);
  document.getElementById('prompt-inp')?.focus();
}

// --- Context compression ------------------------------------

async function compressCtx() {
  if (S.msgs.length < 8) return;
  const old = S.msgs.slice(0, -4);
  const keep = S.msgs.slice(-4);
  try {
    const r = await apiChat([{
      role: 'user',
      content: 'Summarize this conversation concisely (max 250 words), preserving all key decisions, file paths, and code changes:\n\n' + JSON.stringify(old),
    }]);
    const sum = r.choices?.[0]?.message?.content || 'Previous context';
    S.msgs = [
      { role: 'user', content: '[Context summary]: ' + sum },
      { role: 'assistant', content: 'Understood, I have the prior context.' },
      ...keep,
    ];
    toast('Context compressed to fit window.');
  } catch {}
}

function saveConv() {
  if (!S.convId) S.convId = Math.random().toString(36).slice(2, 9);
  const title = (S.msgs.find(m => m.role === 'user')?.content || 'New chat').slice(0, 50);
  const existing = S.convs.findIndex(c => c.id === S.convId);
  const c = {
    id: S.convId,
    title,
    msgs: S.msgs,
    created: existing >= 0 ? S.convs[existing].created : Date.now(),
    modified: Date.now(),
  };
  if (existing >= 0) S.convs[existing] = c;
  else S.convs.unshift(c);
  if (S.convs.length > 60) S.convs.length = 60;
  import('./state.js').then(m => m.saveState());
  renderConvList();
}

// --- Boot ---------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const { loadState } = await import('./state.js');
  loadState();

  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === S.mode));

  updateUI();

  const { initEvents } = await import('./events.js');
  initEvents();

  document.getElementById('prompt-inp')?.focus();

  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  // Restore previous IDB session on reload, if one was active.
  if (S.idbSess && !S.fsMode) {
    try {
      await switchWorkspace(S.idbSess);
    } catch {}
  }

  // Refresh session list.
  refreshSessions();
});

