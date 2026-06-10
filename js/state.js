// ─────────────────────────────────────────────────────────────
// Central state. Single mutable `S` object. Persistence via
// localStorage. Other modules import {S, saveState, loadState}.
// ─────────────────────────────────────────────────────────────

export const S = {
  // API & model
  key: '',
  model: 'mistral-large-latest',
  // Generation params (new — exposed in Settings)
  temperature: 0.7,
  maxTokens: 4096,
  // Mode
  mode: 'edit', // 'plan' | 'edit' | 'yolo'
  // Filesystem
  fsMode: null,        // 'idb' | 'machine' | null
  idbSess: null,       // current IDB session name
  machRoot: null,      // FileSystemDirectoryHandle
  cwd: '~',            // display string
  // Conversation
  msgs: [],            // [{role, content, tool_calls?, name?, tool_call_id?}]
  convId: null,
  convs: [],           // [{id, title, msgs, created, modified}]
  // Edit history (for undo)
  editHistory: [],     // [{timestamp, path, before, after, toolName, args}]
  // Todos & memory (loaded from localStorage)
  todos: [],
  memory: [],
  // Per-turn working state
  running: false,
  ctxUsage: 0,
  files: [],           // pending attachments
  gitBranch: null,
  // UI state
  pendClr: null,
  pendQ: null,
  // Cached messages of the *current* turn (for streaming)
  liveContent: '',
  liveToolCalls: [],
  // Subagent stack — used to track recursion depth
  subagentDepth: 0,
  // Artifacts (lightweight cache; source of truth is the IDB store)
  artifacts: [],
  // Per-turn pending diffs (for multi-file review)
  pendingDiffs: [],    // [{id, path, before, after, diff, isNew, resolved}]
  // Sessions list (workspaces) — refreshed on init
  sessions: [],
};

// Per-model context window sizes.
export const MODEL_CTX = {
  'mistral-large-latest': 131072,
  'codestral-latest': 32768,
  'mistral-medium-latest': 32768,
  'mistral-small-latest': 32768,
  'open-mistral-nemo': 131072,
};

// Model fallback chain used by apiChatWithRetry when we hit 429/5xx.
export const MODEL_FALLBACK = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
];

// Module-scope working state (not persisted; reset on reload).
export const Live = {
  abortCtrl: null,
  currentTurn: null,
  workingEl: null,
  t0: 0,
  tickTimer: null,
};

// ─── Persistence ─────────────────────────────────────────────

export function loadState() {
  S.key      = localStorage.getItem('aria_k') || '';
  S.model    = localStorage.getItem('aria_m') || 'mistral-large-latest';
  S.mode     = localStorage.getItem('aria_mode') || 'edit';
  S.todos    = JSON.parse(localStorage.getItem('aria_todos') || '[]');
  S.memory   = JSON.parse(localStorage.getItem('aria_mem') || '[]');
  S.convs    = JSON.parse(localStorage.getItem('aria_convs') || '[]');
  S.editHistory = JSON.parse(localStorage.getItem('aria_editHistory') || '[]');
  S.idbSess  = localStorage.getItem('aria_idb_sess') || null;
  S.temperature = parseFloat(localStorage.getItem('aria_temp') || '0.7') || 0.7;
  S.maxTokens   = parseInt(localStorage.getItem('aria_maxtok') || '4096', 10);
  // Sync UI inputs
  const k = document.getElementById('api-key');    if (k) k.value = S.key;
  const m = document.getElementById('model-sel');  if (m) m.value = S.model;
  const t = document.getElementById('temp-inp');   if (t) t.value = S.temperature;
  const x = document.getElementById('maxtok-inp'); if (x) x.value = S.maxTokens;
}

export function saveState() {
  localStorage.setItem('aria_k', S.key);
  localStorage.setItem('aria_m', S.model);
  localStorage.setItem('aria_mode', S.mode);
  localStorage.setItem('aria_todos', JSON.stringify(S.todos));
  localStorage.setItem('aria_mem', JSON.stringify(S.memory));
  localStorage.setItem('aria_convs', JSON.stringify(S.convs));
  localStorage.setItem('aria_editHistory', JSON.stringify(S.editHistory.slice(-50))); // Keep last 50 edits
  if (S.idbSess) localStorage.setItem('aria_idb_sess', S.idbSess);
  else localStorage.removeItem('aria_idb_sess');
  localStorage.setItem('aria_temp', String(S.temperature));
  localStorage.setItem('aria_maxtok', String(S.maxTokens));
}

// ─── Edit History & Undo ──────────────────────────────────

export function recordEdit(path, before, after, toolName, args) {
  S.editHistory.push({
    timestamp: Date.now(),
    path,
    before,
    after,
    toolName,
    args: { ...args }
  });
  // Keep only last 50 edits
  if (S.editHistory.length > 50) {
    S.editHistory = S.editHistory.slice(-50);
  }
  saveState();
}

export function undoLastEdit() {
  if (S.editHistory.length === 0) return null;
  const last = S.editHistory.pop();
  saveState();
  return last;
}

export function getEditHistory() {
  return [...S.editHistory];
}

// ─── Conversation Rewind ──────────────────────────────────

export function rewindToMessage(messageIndex) {
  if (messageIndex < 0 || messageIndex >= S.msgs.length) return false;
  // Determine cutoff timestamp (messages without timestamps default to 0)
  const cutoffTs = S.msgs[messageIndex]?._ts || 0;

  // Find edits that happened after the cutoff — these need undoing
  const editsToUndo = S.editHistory.filter(e => e.timestamp > cutoffTs).map(e => ({ ...e })).reverse();

  // Trim messages to the selected point
  S.msgs = S.msgs.slice(0, messageIndex + 1);

  // Trim editHistory to only keep edits up to the cutoff
  S.editHistory = S.editHistory.filter(e => e.timestamp <= cutoffTs);
  saveState();

  return { trimmed: true, editsToUndo };
}
