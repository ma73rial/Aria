// ─────────────────────────────────────────────────────────────
// Small utility helpers shared across modules.
// No imports; safe to load first.
// ─────────────────────────────────────────────────────────────

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

// Escape HTML for safe innerHTML insertion. Use this on any
// untrusted text BEFORE it touches the DOM. Do not use on text
// that will be passed to marked.parse() — see markdown.js.
export const esc = t => String(t ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Rough token estimate (chars/3.8). Strips base64 image data before estimating
// to avoid inflating the count from multimodal messages (base64 at ~1.3× the
// image size would immediately blow the context % way past real usage).
export const est = s => {
  if (typeof s !== 'string') {
    if (Array.isArray(s)) {
      // Multimodal content array — sum text blocks only, add a fixed cost
      // per image block (~1000 tokens as a rough vision estimate).
      return s.reduce((acc, part) => {
        if (part?.type === 'text') return acc + Math.ceil((part.text || '').length / 3.8);
        if (part?.type === 'image_url') return acc + 1000; // vision token budget
        return acc;
      }, 0);
    }
    return Math.ceil(JSON.stringify(s).length / 3.8);
  }
  return Math.ceil(s.length / 3.8);
};

export function fmtEl(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function scrollBot() {
  const c = document.getElementById('chat');
  if (!c) return;
  requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

// Debounce wrapper — useful for input handlers, file-tree refreshes, etc.
export function debounce(fn, wait = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), wait);
  };
}

// Sleep helper (for retry backoff).
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tiny event bus for cross-module updates. Keeps modules from
// reaching into each other's internals.
const listeners = new Map();
export const Bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  },
  emit(evt, payload) {
    listeners.get(evt)?.forEach(fn => {
      try { fn(payload); } catch (e) { console.error(`[bus ${evt}]`, e); }
    });
  }
};

// Convert a File to a base64 data URL (for image attachments).
export const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
});

// Read a File as text (with a size cap to avoid OOM).
export async function fileToText(file, max = 2000) {
  const t = await file.text().catch(() => '[unreadable]');
  return t.length > max ? t.slice(0, max) + `\n\n[...truncated, ${t.length - max} more chars]` : t;
}

// Detect whether we're running from file://. ES modules work over
// file:// in Firefox and modern Chromium, but a few APIs (fetch to
// arbitrary origins, workers) can be stricter. We surface this so
// the user can switch browsers if something misbehaves.
export const isFileProtocol = typeof location !== 'undefined' && location.protocol === 'file:';
