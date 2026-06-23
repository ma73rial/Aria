// ─────────────────────────────────────────────────────────────
// Filesystem abstraction. Two backends:
//   - IDB (virtual, multi-session, named or auto-named)
//   - Machine (File System Access API — Chromium only)
//
// On top of basic CRUD we expose session management so the model
// can list existing workspaces and switch instead of creating a
// new empty one (the original bug: model saw "(empty)" and called
// init_filesystem('idb') blindly).
// ─────────────────────────────────────────────────────────────

import { Bus } from './utils.js';
import { S, saveState } from './state.js';

// ─── IDB (low-level) ────────────────────────────────────────

async function idbOpen(sess) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('aria_fs_' + sess, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('f'))    db.createObjectStore('f',    { keyPath: 'p' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function idbGet(sess, path) {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('f', 'readonly');
    const req = tx.objectStore('f').get(path);
    req.onsuccess = e => r(e.target.result);
    req.onerror = e => j(e.target.error);
  });
}

async function idbPut(sess, path, content, type = 'file') {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('f', 'readwrite');
    const req = tx.objectStore('f').put({ p: path, content, type, m: Date.now() });
    req.onsuccess = e => r(true);
    req.onerror = e => j(e.target.error);
  });
}

async function idbDel(sess, path) {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('f', 'readwrite');
    const req = tx.objectStore('f').delete(path);
    req.onsuccess = e => r(true);
    req.onerror = e => j(e.target.error);
  });
}

async function idbListAll(sess) {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('f', 'readonly');
    tx.objectStore('f').getAll().onsuccess = e => r(e.target.result || []);
    tx.onerror = e => j(e.target.error);
  });
}

async function idbList(sess, dir) {
  const all = await idbListAll(sess);
  const base = dir === '/' ? '/' : (dir.endsWith('/') ? dir : dir + '/');
  return all.filter(item => {
    if (item.p === dir || item.p === dir + '/') return false;
    const rest = item.p.startsWith(base) ? item.p.slice(base.length) : null;
    if (!rest) return false;
    return rest.length > 0 && !rest.replace(/\/$/, '').includes('/');
  });
}

async function idbMetaGet(sess, key) {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = e => r(e.target.result?.v);
    req.onerror = e => j(e.target.error);
  });
}

async function idbMetaPut(sess, key, value) {
  const db = await idbOpen(sess);
  return new Promise((r, j) => {
    const tx = db.transaction('meta', 'readwrite');
    const req = tx.objectStore('meta').put({ k: key, v: value });
    req.onsuccess = e => r(true);
    req.onerror = e => j(e.target.error);
  });
}

// ─── Machine (File System Access API) ───────────────────────

async function machOpen() {
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite' });
    S.machRoot = h;
    return h.name;
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    return null;
  }
}

async function machResolve(path, create = false) {
  if (!S.machRoot) throw new Error('No folder open');
  const p = path.replace(/^[~\/]+/, '');
  const parts = p.split('/').filter(Boolean);
  let dir = S.machRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create });
  }
  if (!parts.length) return { handle: dir, type: 'dir' };
  const last = parts[parts.length - 1];
  try { return { handle: await dir.getFileHandle(last, { create }), type: 'file' }; } catch {}
  try { return { handle: await dir.getDirectoryHandle(last, { create }), type: 'dir' }; } catch {}
  return null;
}

async function machRead(path) {
  const r = await machResolve(path);
  if (!r || r.type !== 'file') throw new Error('File not found: ' + path);
  return await (await r.handle.getFile()).text();
}

// Returns an object-URL (blob:// string) — caller must revoke when done.
export async function machReadBlob(path) {
  const q = parsePath(normPath(path));
  const p = q.type === 'idb' ? q.p : (q.p || path.replace(/^[~\/]+/, ''));
  const r = await machResolve(p);
  if (!r || r.type !== 'file') throw new Error('File not found: ' + path);
  const file = await r.handle.getFile();
  return URL.createObjectURL(file);
}

async function machWrite(path, content) {
  const r = await machResolve(path, true);
  if (!r || r.type !== 'file') throw new Error('Cannot write to: ' + path);
  const w = await r.handle.createWritable();
  await w.write(content);
  await w.close();
}

async function machDelete(path) {
  throw new Error('Direct delete is not supported by the File System Access API. Delete the file from your OS.');
}

async function machList(path) {
  if (!S.machRoot) throw new Error('No folder open');
  const p = (path || '').replace(/^[~\/]+/, '');
  let dir = S.machRoot;
  if (p) for (const part of p.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part);
  }
  const out = [];
  for await (const [name, h] of dir.entries()) {
    out.push({ name, type: h.kind === 'directory' ? 'dir' : 'file' });
  }
  return out;
}

async function machMkdir(path) {
  const parts = path.replace(/^[~\/]+/, '').split('/').filter(Boolean);
  let dir = S.machRoot;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
}

export async function machGit() {
  try {
    const g = await S.machRoot.getDirectoryHandle('.git');
    const hf = await g.getFileHandle('HEAD');
    const t = await (await hf.getFile()).text();
    const m = t.match(/ref: refs\/heads\/(.+)/);
    return m ? m[1].trim() : t.trim().slice(0, 7);
  } catch { return null; }
}


// ─── High-level path normalization ──────────────────────────

export function normPath(path) {
  if (!path) return S.cwd;
  if (S.fsMode === 'idb' && !path.startsWith('idb://') && !path.startsWith('/')) {
    return 'idb://' + S.idbSess + '/' + path;
  }
  return path;
}

export function parsePath(path) {
  if (path.startsWith('idb://')) {
    const rest = path.slice(6), si = rest.indexOf('/');
    if (si === -1) return { type: 'idb', sess: rest, p: '/' };
    return { type: 'idb', sess: rest.slice(0, si), p: rest.slice(si) || '/' };
  }
  return { type: 'machine', p: path };
}

// ─── Public FS API ──────────────────────────────────────────

export async function fsRead(path) {
  const q = parsePath(normPath(path));
  if (q.type === 'idb') {
    const r = await idbGet(q.sess || S.idbSess, q.p);
    if (!r) throw new Error('Not found: ' + path);
    return r.content || '';
  }
  return machRead(q.p);
}

export async function fsWrite(path, content) {
  const q = parsePath(normPath(path));
  if (q.type === 'idb') return idbPut(q.sess || S.idbSess, q.p, content);
  return machWrite(q.p, content);
}

export async function fsList(path) {
  const q = parsePath(normPath(path || S.cwd));
  if (q.type === 'idb') {
    const items = await idbList(q.sess || S.idbSess, q.p);
    return items.map(i => ({
      name: i.p.split('/').filter(Boolean).pop() || i.p,
      type: i.type,
      path: i.p,
    }));
  }
  return machList(q.p);
}

export async function fsMkdir(path) {
  const q = parsePath(normPath(path));
  if (q.type === 'idb') {
    const segs = q.p.split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      cur += '/' + s;
      await idbPut(q.sess || S.idbSess, cur, null, 'dir');
    }
    return true;
  }
  return machMkdir(q.p);
}

export async function fsDelete(path) {
  const q = parsePath(normPath(path));
  if (q.type === 'idb') return idbDel(q.sess || S.idbSess, q.p);
  return machDelete(q.p);
}

export async function fsRename(oldPath, newPath) {
  const q1 = parsePath(normPath(oldPath));
  const q2 = parsePath(normPath(newPath));
  if (q1.type === 'idb' && q2.type === 'idb') {
    const sess = q1.sess || S.idbSess;
    const item = await idbGet(sess, q1.p);
    if (!item) throw new Error('Not found: ' + oldPath);
    await idbPut(sess, q2.p, item.content, item.type);
    await idbDel(sess, q1.p);
    return true;
  }
  throw new Error('Rename is only supported for IDB workspaces.');
}

export async function fsReadRange(path, offset, limit) {
  const full = await fsRead(path);
  const lines = full.split('\n');
  const slice = lines.slice(offset, offset + limit);
  return { content: slice.join('\n'), total: lines.length, offset, limit };
}


// ─── Workspace / session management ─────────────────────────

function autoName() {
  const d = new Date();
  return `Session ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Initialise a brand-new IDB session.
 * The model used to call `init_filesystem('idb')` blindly and end
 * up with anonymous timestamped sessions. Now we let the user
 * (or model) name them, and we list existing sessions so the
 * model can switch instead of duplicating.
 */
export async function initIDBSession(opts = {}) {
  const name = opts.name || ('sess-' + Date.now().toString(36));
  await idbMetaPut(name, 'name', opts.name || autoName());
  await idbMetaPut(name, 'created', Date.now());
  await idbMetaPut(name, 'firstPrompt', (opts.firstPrompt || '').slice(0, 120));
  await idbPut(name, '/', null, 'dir');

  S.idbSess = name;
  S.fsMode = 'idb';
  S.cwd = 'idb://' + name + '/';
  saveState();

  await refreshSessions();
  Bus.emit('fs:init', { type: 'idb', name });
  return name;
}

export async function switchWorkspace(sessionName) {
  if (!sessionName) throw new Error('switchWorkspace: name required');
  const items = await idbListAll(sessionName).catch(() => null);
  if (items === null) throw new Error(`Session "${sessionName}" not found`);

  S.idbSess = sessionName;
  S.fsMode = 'idb';
  S.cwd = 'idb://' + sessionName + '/';
  S.machRoot = null;
  saveState();
  await refreshSessions();
  Bus.emit('fs:switch', { type: 'idb', name: sessionName });
  return sessionName;
}

export async function renameSession(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const all = await idbListAll(oldName);
  for (const it of all) {
    await idbPut(newName, it.p, it.content, it.type);
  }
  for (const k of ['name', 'created', 'firstPrompt']) {
    const v = await idbMetaGet(oldName, k).catch(() => null);
    if (v != null) await idbMetaPut(newName, k, v);
  }
  await deleteSession(oldName, true);
  if (S.idbSess === oldName) {
    S.idbSess = newName;
    S.cwd = 'idb://' + newName + '/';
    saveState();
  }
  await refreshSessions();
}

export async function deleteSession(name, silent = false) {
  return new Promise((res, rej) => {
    const r = indexedDB.deleteDatabase('aria_fs_' + name);
    r.onsuccess = async () => {
      if (S.idbSess === name) {
        S.idbSess = null;
        S.fsMode = null;
        S.cwd = '~';
        saveState();
        Bus.emit('fs:close', {});
      }
      await refreshSessions();
      res(true);
    };
    r.onerror = e => silent ? res(false) : rej(e.target.error);
  });
}

/**
 * Enumerate all IDB sessions.
 * - Uses indexedDB.databases() where available.
 * - Falls back to probing a localStorage-cached list of names.
 */
export async function refreshSessions() {
  const names = new Set();

  if (typeof indexedDB.databases === 'function') {
    try {
      const all = await indexedDB.databases();
      for (const db of all) {
        if (db.name && db.name.startsWith('aria_fs_')) {
          names.add(db.name.slice('aria_fs_'.length));
        }
      }
    } catch {}
  }

  const known = JSON.parse(localStorage.getItem('aria_known_sessions') || '[]');
  for (const k of known) {
    if (!names.has(k)) {
      try {
        const x = await idbListAll(k);
        if (x !== null) names.add(k);
      } catch {}
    }
  }

  const sessions = [];
  for (const name of names) {
    let displayName = name, created = 0, firstPrompt = '';
    try {
      displayName = await idbMetaGet(name, 'name').catch(() => null) || name;
      created     = await idbMetaGet(name, 'created').catch(() => 0) || 0;
      firstPrompt = await idbMetaGet(name, 'firstPrompt').catch(() => '') || '';
    } catch {}
    const all = await idbListAll(name).catch(() => []);
    sessions.push({
      name,
      displayName,
      created,
      firstPrompt,
      size: all.length,
      active: S.idbSess === name,
    });
  }
  sessions.sort((a, b) => b.created - a.created);
  S.sessions = sessions;
  localStorage.setItem('aria_known_sessions', JSON.stringify([...names]));
  Bus.emit('sessions:refresh', sessions);
  return sessions;
}

export async function ensureSession() {
  if (S.fsMode === 'idb' && S.idbSess) return S.idbSess;
  if (S.fsMode === 'machine') return 'machine';
  return null;
}

export { machOpen };

