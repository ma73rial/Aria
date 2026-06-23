// Entry point and main agent loop.
// Bootstraps on DOMContentLoaded, then runs the tool-calling loop.

import { S, Live, getActiveApiKey } from './state.js';
import { Bus, toast, fileToBase64, fileToText, scrollBot } from './utils.js';
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
  if (!getActiveApiKey(S.provider)) {
    // Show the setup modal so the user can enter a key
    const setupModal = document.getElementById('setup-modal');
    if (setupModal) {
      setupModal.classList.remove('hidden');
      setTimeout(() => document.getElementById('setup-key')?.focus(), 100);
    } else {
      toast('No API key -- open Settings and save your key.');
    }
    return;
  }
  S.running = true;
  setInput(false);

  // Build the prompt content with attached file data.
  // Images become multimodal content blocks (data URL) so vision-capable
  // models can actually see them. Text files are inlined as before.
  const imageBlocks = [];
  let content = input;
  if (S.files.length) {
    let textAppendix = '';
    for (const f of S.files) {
      if (f.type.startsWith('image/')) {
        try {
          const dataUrl = await fileToBase64(f);
          imageBlocks.push({ type: 'image_url', image_url: { url: dataUrl } });
        } catch {
          textAppendix += '- ' + f.name + ' (' + f.type + ', failed to read)\n';
        }
      } else {
        const t = await fileToText(f, 2000);
        textAppendix += '- ' + f.name + ' (' + (f.type || 'text/plain') + ')\n```\n' + t + '\n```\n';
      }
    }
    if (textAppendix) content += '\n\n**Attached files:**\n' + textAppendix;
    if (imageBlocks.length) {
      content += '\n\n[' + imageBlocks.length + ' image' + (imageBlocks.length === 1 ? '' : 's') +
        ' attached — if your model does not support vision, say so rather than guessing at their contents.]';
    }
  }

  addUserMsg(input, S.files);
  S.files = [];
  renderAttachBar();

  // If there are images, send a multimodal content array: text block first,
  // then one image block per attached image.
  if (imageBlocks.length) {
    S.msgs.push({
      role: 'user',
      content: [{ type: 'text', text: content }, ...imageBlocks],
      _ts: Date.now(),
    });
  } else {
    S.msgs.push({ role: 'user', content, _ts: Date.now() });
  }
  startTurn();

  let turns = 0;
  try {
    while (turns++ < 22) {
      const pct = ctxPct();
      updateCtxBar(pct);
      if (pct > 0.76) {
        toast('Context at ' + (pct * 100).toFixed(0) + '% — compressing…', 3000);
        await compressCtx();
      }

      const apiMsgs = [{ role: 'system', content: buildSysPrompt() }, ...S.msgs];

      let resp;
      // During streaming, periodically render markdown so headings, lists,
      // and code blocks appear progressively instead of as raw text.
      // We debounce renderRich() calls (it's cheap but re-parses the full
      // string each time) and always do a final full render on completion.
      let renderTimer = null;
      let latestFull = '';
      try {
        resp = await streamChatWithRetry(apiMsgs, TOOLS, {
          onDelta(chunk, full) {
            if (!currentTurn) return;
            latestFull = full;
            let last = currentTurn.querySelector('.thought:last-child');
            if (!last) {
              const b = document.createElement('div');
              b.className = 'thought';
              currentTurn.appendChild(b);
              last = b;
            }
            // Debounce the markdown render to avoid excessive re-parsing.
            clearTimeout(renderTimer);
            renderTimer = setTimeout(() => {
              try {
                last.innerHTML = renderRich(latestFull);
                highlightAll(last);
              } catch {
                // If markdown parsing chokes on a partial token, fall back
                // to plain text for this tick — it'll self-correct on the
                // next render or the final pass.
                last.textContent = latestFull;
              }
              scrollBot();
            }, 120);
          },
        });
        // Final render with the complete content (ensures fences/tables close).
        clearTimeout(renderTimer);
        if (currentTurn && latestFull) {
          const last = currentTurn.querySelector('.thought:last-child');
          if (last) {
            last.innerHTML = renderRich(latestFull);
            highlightAll(last);
          }
        }
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
        _ts: Date.now(),
      });

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}
          const row = addToolRow(tc.function.name, args);
          let result;
          try {
            // Tools that require user input suspend the run-loop while waiting.
            // We re-enable the textarea (so the user can type an answer) but
            // keep S.running = true so no second runAgent() can be launched.
            const isUserInputTool = tc.function.name === 'clarify' || tc.function.name === 'simple_question'
              || (tc.function.name === 'suggest_mode' && S.mode !== 'yolo');
            if (isUserInputTool) setInput(true);
            const toolResult = execTool(tc.function.name, args);
            result = toolResult instanceof Promise ? await toolResult : toolResult;
            if (isUserInputTool) setInput(false);
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
            _ts: Date.now(),
          });
        }
        continue;
      }

      // Done: no tool calls — convert streaming thought into a final block.
      closeTurn();
      if (msg.content?.trim()) {
        const thought = currentTurn?.querySelector('.thought:last-child');
        if (thought) {
          // Rebuild as a proper .final structure so CSS flex layout works correctly.
          // (Dumping innerHTML directly into the thought div leaves markdown content
          // as bare flex children, which causes tables to lay out horizontally.)
          const dot = document.createElement('div');
          dot.className = 'fdot';
          const inner = document.createElement('div');
          inner.className = 'final-content';
          inner.innerHTML = renderRich(msg.content.trim());
          highlightAll(inner);
          thought.className = 'final';
          thought.innerHTML = '';
          thought.appendChild(dot);
          thought.appendChild(inner);
        } else {
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
  // Strip image data URLs before summarizing — they're large and irrelevant
  // to a text summary, and would bloat the compression request itself.
  const oldForSummary = old.map(m => {
    if (Array.isArray(m.content)) {
      const textBlock = m.content.find(b => b.type === 'text');
      return { ...m, content: (textBlock?.text || '') + ' [image attached]' };
    }
    return m;
  });
  try {
    const r = await apiChat([{
      role: 'user',
      content: 'Summarize this conversation concisely (max 250 words), preserving all key decisions, file paths, and code changes:\n\n' + JSON.stringify(oldForSummary),
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
  const firstUser = S.msgs.find(m => m.role === 'user')?.content;
  const firstUserText = Array.isArray(firstUser)
    ? (firstUser.find(b => b.type === 'text')?.text || 'Image message')
    : (firstUser || 'New chat');
  const title = firstUserText.slice(0, 50);
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
  if (S.idbSess && S.fsMode === 'idb') {
    try {
      await switchWorkspace(S.idbSess);
    } catch {}
  }

  // Refresh session list.
  refreshSessions();
});
