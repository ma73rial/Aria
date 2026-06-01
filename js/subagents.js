// ─────────────────────────────────────────────────────────────
// Subagent runner. Recursively runs a smaller agent loop with
// isolated state. Max 2 levels of nesting (parent → child).
// ─────────────────────────────────────────────────────────────

import { S } from './state.js';
import { Bus, esc } from './utils.js';
import { streamChatWithRetry, apiChat } from './api.js';
import { TOOLS, execTool } from './tools.js';

const MAX_DEPTH = 2;
const MAX_TURNS = 12;

/**
 * Run a subagent on a self-contained task. Returns a structured
 * summary that the parent agent can quote in its next turn.
 */
export async function spawnSubagent(task, systemPrompt) {
  if (S.subagentDepth >= MAX_DEPTH) {
    return { summary: 'Subagent depth limit reached. Continue inline.' };
  }
  S.subagentDepth += 1;
  const previousDepth = S.subagentDepth;

  // Subagent gets its own message history and a "voice" card.
  const messages = [
    { role: 'user', content: task },
  ];

  // Render the subagent indicator in the parent's chat.
  const card = document.createElement('div');
  card.className = 'subagent-card';
  card.dataset.depth = previousDepth;
  card.innerHTML = `<div class="subagent-head">
    <span class="subagent-badge">subagent · depth ${previousDepth}</span>
    <span class="subagent-task">${esc(task.slice(0, 80))}${task.length > 80 ? '…' : ''}</span>
  </div>
  <div class="subagent-body"><div class="dots"><span></span><span></span><span></span></div> <span class="subagent-status">Working…</span></div>`;
  Bus.emit('turn:append', card);

  const status = card.querySelector('.subagent-status');
  const body = card.querySelector('.subagent-body');

  let content = '';
  let turns = 0;
  let summary = '';

  try {
    while (turns++ < MAX_TURNS) {
      const sysMsg = {
        role: 'system',
        content: `You are a subagent (depth ${previousDepth}) working for ARIA. ${systemPrompt || 'Be concise. When done, write a structured summary starting with "DONE:".'}`,
      };
      const out = await streamChatWithRetry([sysMsg, ...messages], TOOLS, {
        onDelta: (chunk) => {
          content += chunk;
          if (body) body.innerHTML = `<span class="subagent-content">${esc(content.slice(-200))}${content.length > 200 ? '…' : ''}</span>`;
        },
      });

      messages.push({ role: 'assistant', content: out.content, ...(out.tool_calls ? { tool_calls: out.tool_calls } : {}) });
      content = out.content;

      if (out.tool_calls?.length) {
        for (const tc of out.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}
          status.textContent = `→ ${tc.function.name}`;
          let result;
          try {
            const tr = execTool(tc.function.name, args);
            result = tr instanceof Promise ? await tr : tr;
          } catch (e) {
            result = { success: false, message: e.message };
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(result) });
        }
        continue;
      }

      summary = out.content.trim();
      break;
    }
  } catch (e) {
    summary = 'Subagent error: ' + e.message;
  } finally {
    S.subagentDepth = previousDepth - 1;
    status.textContent = '✓ Done';
    if (summary) body.innerHTML = `<span class="subagent-content">${esc(summary.slice(0, 400))}${summary.length > 400 ? '…' : ''}</span>`;
  }

  return { summary: summary || 'Subagent completed without summary.' };
}
