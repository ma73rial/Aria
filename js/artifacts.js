// ─────────────────────────────────────────────────────────────
// Persistent artifacts. Stored in a dedicated IDB database so
// they survive workspace switches. Inline in chat AND in the
// sidebar "Artifacts" tab.
// ─────────────────────────────────────────────────────────────

import { S } from './state.js';
import { Bus, uid, esc } from './utils.js';
import { renderRich, highlightAll } from './markdown.js';

const DB_NAME = 'aria_artifacts';
const STORE = 'a';

function artOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

export async function createArtifact({ title, type, language, content }) {
  const id = uid();
  const art = {
    id,
    title: title || 'Untitled',
    type,
    language: language || (type === 'code' ? 'plaintext' : ''),
    content,
    created: Date.now(),
    modified: Date.now(),
  };
  const db = await artOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(art);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
  S.artifacts.unshift(art);
  Bus.emit('artifacts:update', S.artifacts);
  // Inline preview in chat.
  renderInlineArtifact(art);
  return art;
}

export async function listArtifacts() {
  const db = await artOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).getAll().onsuccess = e => {
      const all = e.target.result || [];
      all.sort((a, b) => b.created - a.created);
      S.artifacts = all;
      Bus.emit('artifacts:update', all);
      res(all);
    };
    tx.onerror = e => rej(e.target.error);
  });
}

export async function getArtifact(id) {
  const db = await artOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}

export async function deleteArtifact(id) {
  const db = await artOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
  S.artifacts = S.artifacts.filter(a => a.id !== id);
  Bus.emit('artifacts:update', S.artifacts);
}

function renderInlineArtifact(art) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact';
  wrap.dataset.id = art.id;

  const head = document.createElement('div');
  head.className = 'artifact-hd';
  head.innerHTML = `<span class="artifact-type">${esc(art.type)}</span>
    <span class="artifact-title">${esc(art.title)}</span>
    <div class="artifact-actions">
      <button class="btn sm" data-act="open">Open</button>
      <button class="btn sm" data-act="copy">Copy</button>
      <button class="btn sm" data-act="download">Download</button>
      <button class="btn sm" data-act="newtab">↗</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'artifact-body';
  if (art.type === 'html') {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = art.content;
    body.appendChild(iframe);
  } else if (art.type === 'svg') {
    body.innerHTML = art.content;
  } else if (art.type === 'markdown') {
    body.className = 'md-wrap';
    body.innerHTML = renderRich(art.content);
    highlightAll(body);
  } else {
    // code
    body.className = 'code-blk';
    const ext = (art.language || 'text').toLowerCase();
    body.innerHTML = `<div class="code-hd"><span class="ch-fn">${esc(art.title)}</span><span>${esc(art.language || '')}</span></div>
<div class="code-body"><pre><code class="language-${esc(ext)}">${esc(art.content)}</code></pre></div>`;
    if (typeof hljs !== 'undefined') {
      body.querySelectorAll('pre code').forEach(b => {
        try { hljs.highlightElement(b); } catch {}
      });
    }
  }

  head.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => artifactAction(art, btn.dataset.act);
  });

  wrap.append(head, body);
  Bus.emit('turn:append', wrap);
}

async function artifactAction(art, act) {
  if (act === 'open') openArtifactModal(art);
  else if (act === 'copy') {
    try { await navigator.clipboard.writeText(art.content); } catch {}
  } else if (act === 'download') {
    const ext = ({ html: 'html', svg: 'svg', markdown: 'md', code: art.language || 'txt' })[art.type] || 'txt';
    const blob = new Blob([art.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${art.title.replace(/[^a-z0-9._-]/gi, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (act === 'newtab') {
    const w = window.open('', '_blank');
    w.document.write(`<title>${esc(art.title)}</title><body style="margin:0;background:#fff;color:#000;font:14px/1.6 system-ui;padding:24px;">${art.type === 'html' ? art.content : '<pre>' + esc(art.content) + '</pre>'}</body>`);
    w.document.close();
  }
}

function openArtifactModal(art) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal modal-lg">
    <div class="modal-hd">
      <span class="artifact-type">${esc(art.type)}</span>
      <span class="artifact-title">${esc(art.title)}</span>
      <button class="modal-close" title="Close">×</button>
    </div>
    <div class="modal-body"></div>
  </div>`;
  const body = modal.querySelector('.modal-body');
  if (art.type === 'html') {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = art.content;
    iframe.style.cssText = 'width:100%;height:70vh;border:0;background:#fff;';
    body.appendChild(iframe);
  } else if (art.type === 'svg') {
    body.innerHTML = art.content;
  } else if (art.type === 'markdown') {
    body.className = 'md-wrap';
    body.innerHTML = renderRich(art.content);
    highlightAll(body);
  } else {
    body.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--mono);font-size:12px;line-height:1.6;color:var(--txt)">${esc(art.content)}</pre>`;
  }
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}
