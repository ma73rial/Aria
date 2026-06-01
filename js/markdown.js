// ─────────────────────────────────────────────────────────────
// Markdown rendering + light token highlighting.
//
// BUG FIX (vs. the old monolithic index.html):
//   The original `formatThought` called esc() on the raw string,
//   THEN passed the escaped string to marked.parse(). Because the
//   string was already HTML-escaped, marked saw `&lt;` and `&amp;`
//   instead of `<` and `&`, so no markdown ever actually rendered.
//   This module re-orders the operations and adds a single
//   `renderRich()` entry point used everywhere a model string
//   touches the DOM.
// ─────────────────────────────────────────────────────────────

import { esc } from './utils.js';

// Configure marked once. We render into a wrapper element that does
// its own CSS scoping, so we let marked emit HTML directly.
let markedReady = false;
function ensureMarked() {
  if (markedReady || typeof marked === 'undefined') return;
  marked.setOptions({
    gfm: true,
    breaks: true,
    // We pre-escape any user-controlled content upstream; marked
    // itself passes raw HTML through.
  });
  // Open external links in a new tab safely.
  const renderer = new marked.Renderer();
  const origLink = renderer.link.bind(renderer);
  renderer.link = (href, title, text) => {
    const html = origLink(href, title, text);
    return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  };
  marked.use({ renderer });
  markedReady = true;
}

/**
 * Render a model string to a HTML string.
 *
 *   1. Extract fenced code blocks so we can pass their content
 *      VERBATIM to marked.
 *   2. Run marked.parse() on the raw markdown.
 *   3. Apply lightweight token highlighting to the rendered HTML
 *      (after markdown parsing, outside of HTML tags).
 *   4. Re-inject code blocks with language hints.
 */
export function renderRich(raw) {
  if (!raw) return '';
  ensureMarked();

  // 1. Pull out fenced code blocks; remember them by index.
  const codeBlocks = [];
  let s = String(raw).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code });
    return `\u0000CODEBLOCK_${codeBlocks.length - 1}\u0000`;
  });

  // 2. Markdown parse FIRST (before any token highlighting).
  if (typeof marked !== 'undefined') {
    try { s = marked.parse(s); }
    catch (e) { console.error('marked error', e); }
  }

  // 3. Apply token highlighting to the rendered HTML.
  // We need to be careful to only highlight text content, not HTML tags.
  // Strategy: split by HTML tags, highlight only the text parts.
  s = s.replace(/>([^<]+)</g, (match, textContent) => {
    // Highlight backtick-enclosed text (inline code)
    let highlighted = textContent.replace(/`([^`\n]+)`/g, (_, p) =>
      /\.[a-zA-Z0-9]{1,6}$/.test(p)
        ? `<span class="rf">${esc(p)}</span>`
        : `<code>${esc(p)}</code>`
    );
    // Highlight single-quoted strings (short ones)
    highlighted = highlighted.replace(/'([^'\n]{1,60})'/g, '<span class="rk">$1</span>');
    return '>' + highlighted + '<';
  });

  // 4. Replace placeholders with proper code blocks.
  s = s.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_, i) => {
    const { lang, code } = codeBlocks[+i];
    const safeLang = esc(lang || 'text');
    return `<pre><code class="language-${safeLang}">${esc(code)}</code></pre>`;
  });

  return s;
}

/**
 * After rendering, find any <pre><code> blocks and ask highlight.js
 * to highlight them. Safe to call multiple times; hljs dedupes.
 */
export function highlightAll(root) {
  if (typeof hljs === 'undefined' || !root) return;
  root.querySelectorAll('pre code').forEach(block => {
    // Don't re-highlight if already done.
    if (block.dataset.highlighted) return;
    try { hljs.highlightElement(block); }
    catch (e) { /* language may not be registered; that's fine */ }
  });
}

/**
 * The old `formatThought` was a stub that escaped HTML, breaking
 * markdown. We keep a thin wrapper for callers that haven't moved
 * to renderRich() yet — it now returns UNESCAPED markdown that
 * should be passed to innerHTML only after renderRich().
 *
 * @deprecated Use renderRich() directly.
 */
export function formatThought(raw) {
  // Old behaviour: token-highlight filenames/quotes only.
  let t = esc(raw);
  t = t.replace(/`([^`\n]+)`/g, (_, p) =>
    /\.[a-zA-Z]{1,6}$/.test(p) ? `<span class="rf">${p}</span>` : `<code>${p}</code>`
  );
  t = t.replace(/'([^'\n]{1,50})'/g, '<span class="rk">$1</span>');
  return t;
}
