// ─────────────────────────────────────────────────────────────
// Mistral API client with:
//   - Streaming (SSE) for real-time token output
//   - Exponential-backoff retry on 429 / 5xx
//   - Automatic model step-down (large → medium → small)
//   - Abort signal plumbed through
// ─────────────────────────────────────────────────────────────

import { S, Live, MODEL_CTX, MODEL_FALLBACK } from './state.js';
import { est, sleep, Bus, toast } from './utils.js';

const MAX_RETRIES = 5;
const BASE_BACKOFF = 1000;
const MAX_BACKOFF  = 30000;

/**
 * Stream a chat completion.
 *
 * @param {Array}  messages
 * @param {Array=} tools
 * @param {Object=} opts - { onDelta, onToolDelta, signal, model, temperature, max_tokens }
 */
export async function streamChat(messages, tools = null, opts = {}) {
  const {
    onDelta, onToolDelta,
    signal,
    model = S.model,
    temperature = S.temperature,
    max_tokens = S.maxTokens,
  } = opts;

  if (!S.key) throw new Error('No API key. Open settings → save your Mistral key.');

  const body = { model, messages, temperature, max_tokens, stream: true };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

  Live.abortCtrl = new AbortController();
  const finalSignal = signal
    ? combineSignals([signal, Live.abortCtrl.signal])
    : Live.abortCtrl.signal;

  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    signal: finalSignal,
    headers: {
      'Authorization': 'Bearer ' + S.key,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ message: r.statusText }));
    const err = new Error('Mistral: ' + (e.message || e.error?.message || r.statusText));
    err.status = r.status;
    err.headers = r.headers;
    throw err;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  const toolCalls = new Map();
  let usage = null;
  let finalModel = model;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = event.split('\n').filter(Boolean);
      for (const ln of lines) {
        if (!ln.startsWith('data:')) continue;
        const data = ln.slice(5).trim();
        if (data === '[DONE]') continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.model) finalModel = parsed.model;
        if (parsed.usage) usage = parsed.usage;
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          onDelta?.(delta.content, content);
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            if (!toolCalls.has(i)) {
              toolCalls.set(i, { id: tc.id || '', name: tc.function?.name || '', args: '' });
            }
            const e = toolCalls.get(i);
            if (tc.id) e.id = tc.id;
            if (tc.function?.name) e.name = tc.function.name;
            if (tc.function?.arguments) e.args += tc.function.arguments;
            onToolDelta?.(e, i);
          }
        }
      }
    }
  }

  const tcs = [...toolCalls.values()].map((t, i) => ({
    id: t.id || ('call_' + i),
    type: 'function',
    function: { name: t.name, arguments: t.args || '{}' },
  }));
  return { content, tool_calls: tcs, usage, model: finalModel };
}

/**
 * Non-streaming single request. Used for compressCtx, think_deeper,
 * and the test path.
 */
export async function apiChat(messages, tools = null, opts = {}) {
  const { signal, model = S.model, temperature = S.temperature, max_tokens = S.maxTokens } = opts;
  if (!S.key) throw new Error('No API key. Open settings → save your Mistral key.');

  Live.abortCtrl = new AbortController();
  const finalSignal = signal
    ? combineSignals([signal, Live.abortCtrl.signal])
    : Live.abortCtrl.signal;

  const body = { model, messages, temperature, max_tokens };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    signal: finalSignal,
    headers: {
      'Authorization': 'Bearer ' + S.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ message: r.statusText }));
    const err = new Error('Mistral: ' + (e.message || e.error?.message || r.statusText));
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/**
 * Streaming + retry + step-down.
 *
 *   1. Try the user's current model.
 *   2. On 429 (read Retry-After) or 5xx: back off, retry up to
 *      MAX_RETRIES times.
 *   3. After the budget is exhausted, step down to the next
 *      model in MODEL_FALLBACK and reset the retry budget.
 *   4. Surface a toast + Bus event on every retry / step-down.
 */
export async function streamChatWithRetry(messages, tools, opts = {}) {
  let model = opts.model || S.model;
  const { onDelta, onToolDelta } = opts;
  let lastErr = null;

  for (let modelAttempt = 0; modelAttempt < MODEL_FALLBACK.length; modelAttempt++) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const out = await streamChat(messages, tools, { ...opts, model, onDelta, onToolDelta });
        if (out.usage) {
          S.ctxUsage = out.usage.prompt_tokens / (MODEL_CTX[out.model] || MODEL_CTX[model] || 32768);
          Bus.emit('ctx:update', S.ctxUsage);
        }
        return out;
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError') throw e;
        if (e.status && e.status >= 400 && e.status < 429) throw e;
        const wait = backoffMs(e, attempt);
        toast(`⚠ ${e.status || 'Error'}: retrying in ${(wait / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})…`, 3000);
        Bus.emit('api:retry', { status: e.status, attempt, wait, model });
        await sleep(wait);
        if (opts.signal?.aborted || Live.abortCtrl?.signal.aborted) throw e;
      }
    }
    const nextModel = MODEL_FALLBACK[MODEL_FALLBACK.indexOf(model) + 1];
    if (!nextModel || nextModel === model) break;
    toast(`🔽 Stepping down: ${model} → ${nextModel}`, 3000);
    Bus.emit('api:stepdown', { from: model, to: nextModel });
    model = nextModel;
  }
  throw lastErr || new Error('All models exhausted');
}

/**
 * Read Retry-After header if present, otherwise exponential.
 */
function backoffMs(err, attempt) {
  if (err && err.headers) {
    const ra = err.headers.get && err.headers.get('Retry-After');
    if (ra) {
      const s = parseInt(ra, 10);
      if (!isNaN(s)) return Math.min(s * 1000, MAX_BACKOFF);
    }
  }
  return Math.min(BASE_BACKOFF * Math.pow(2, attempt), MAX_BACKOFF);
}

/**
 * Combine multiple AbortSignals into one. Whoever fires first
 * aborts the request.
 */
function combineSignals(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(); break; }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

// Re-export for callers that still want a single call (compressCtx,
// think_deeper, etc.) without the retry wrapper.
export { apiChat as default };



// ─── Context math ────────────────────────────────────────────

export function estCtx() {
  return S.msgs.reduce((s, m) => s + est(m.content || ''), 0);
}
export function ctxPct() {
  if (S.ctxUsage > 0) return S.ctxUsage;
  return estCtx() / (MODEL_CTX[S.model] || 32768);
}

