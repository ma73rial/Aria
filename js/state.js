// ─────────────────────────────────────────────────────────────
// Central state. Single mutable `S` object. Persistence via
// localStorage. Other modules import {S, saveState, loadState}.
// ─────────────────────────────────────────────────────────────

export const S = {
  // API & model
  apiKeys: {}, // { 'mistral': [{key: 'sk-...', name: 'default', active: true}, ...], ... }
  customModels: [], // [{name: 'My Custom Model', provider: 'mistral'}]
  customProvider: { baseUrl: '' },
  providerModels: {},
  provider: 'mistral',
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
  lastUsage: null,  // { prompt_tokens, completion_tokens, total_tokens } from last API call
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
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-3.5-turbo': 16385,
  'o1-mini': 128000,
  'o1-preview': 128000,
  'llama-3.3-70b-versatile': 131072,
  'llama-3.1-8b-instant': 131072,
  'mixtral-8x7b-32768': 32768,
  'gemma2-9b-it': 8192,
  'llama3-70b-8192': 8192,
  'llama3-8b-8192': 8192,
  'llama-guard-3-8b': 8192,
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-flash-lite': 1048576,
  'gemini-1.5-pro': 1048576,
  'gemini-1.5-flash': 1048576,
};

export const PROVIDERS = {
  mistral: {
    label: 'Mistral AI',
    keyPlaceholder: 'sk-...',
    models: ['mistral-large-latest', 'codestral-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    fallback: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
    dynamicModels: true,
  },
  openai: {
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini', 'o1-preview'],
    fallback: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    dynamicModels: true,
  },
  groq: {
    label: 'Groq',
    keyPlaceholder: 'gsk_...',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'llama3-70b-8192', 'llama3-8b-8192'],
    fallback: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    dynamicModels: true,
  },
  anthropic: {
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    fallback: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307'],
    dynamicModels: false,
  },
  gemini: {
    label: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    fallback: ['gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    dynamicModels: true,
  },
  custom: {
    label: 'Custom OpenAI-Compatible',
    keyPlaceholder: 'API key',
    models: [],
    fallback: [],
    dynamicModels: true,
    customEndpoint: true,
  },
};

// Provider-specific model lists (first item is the default)
export const PROVIDER_MODELS = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, cfg]) => [id, cfg.models])
);

export const PROVIDER_LABELS = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, cfg]) => [id, cfg.label])
);

export const PROVIDER_KEY_PLACEHOLDER = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, cfg]) => [id, cfg.keyPlaceholder])
);

// Fallback chain per-provider (step down on 429/5xx)
export const MODEL_FALLBACK_BY_PROVIDER = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, cfg]) => [id, cfg.fallback])
);

// Legacy — kept so existing imports don't break
export const MODEL_FALLBACK = MODEL_FALLBACK_BY_PROVIDER.mistral;

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
  S.apiKeys  = JSON.parse(localStorage.getItem('aria_api_keys') || '{}');
  S.customModels = JSON.parse(localStorage.getItem('aria_custom_models') || '[]');
  S.customProvider = JSON.parse(localStorage.getItem('aria_custom_provider') || '{"baseUrl":""}');
  S.providerModels = JSON.parse(localStorage.getItem('aria_provider_models') || '{}');
  S.provider = localStorage.getItem('aria_prov') || 'mistral';
  if (!PROVIDERS[S.provider]) S.provider = 'mistral';
  S.model    = localStorage.getItem('aria_m') || 'mistral-large-latest';
  S.mode     = localStorage.getItem('aria_mode') || 'edit';
  S.todos    = JSON.parse(localStorage.getItem('aria_todos') || '[]');
  S.memory   = JSON.parse(localStorage.getItem('aria_mem') || '[]');
  S.convs    = JSON.parse(localStorage.getItem('aria_convs') || '[]');
  S.editHistory = JSON.parse(localStorage.getItem('aria_editHistory') || '[]');
  S.pendingDiffs = JSON.parse(localStorage.getItem('aria_pending_diffs') || '[]');
  S.idbSess  = localStorage.getItem('aria_idb_sess') || null;
  S.fsMode   = localStorage.getItem('aria_fs_mode') || null;
  S.cwd      = localStorage.getItem('aria_cwd') || '~';
  S.temperature = parseFloat(localStorage.getItem('aria_temp') || '0.7') || 0.7;
  S.maxTokens   = parseInt(localStorage.getItem('aria_maxtok') || '4096', 10);
  // Sync UI inputs
  const p = document.getElementById('provider-sel'); if (p) p.value = S.provider;
  const m = document.getElementById('model-sel');  if (m) m.value = S.model;
  const t = document.getElementById('temp-inp');   if (t) t.value = S.temperature;
  const x = document.getElementById('maxtok-inp'); if (x) x.value = S.maxTokens;
}

export function saveState() {
  localStorage.setItem('aria_api_keys', JSON.stringify(S.apiKeys));
  localStorage.setItem('aria_custom_models', JSON.stringify(S.customModels));
  localStorage.setItem('aria_custom_provider', JSON.stringify(S.customProvider));
  localStorage.setItem('aria_provider_models', JSON.stringify(S.providerModels));
  localStorage.setItem('aria_prov', S.provider);
  localStorage.setItem('aria_m', S.model);
  localStorage.setItem('aria_mode', S.mode);
  localStorage.setItem('aria_todos', JSON.stringify(S.todos));
  localStorage.setItem('aria_mem', JSON.stringify(S.memory));
  localStorage.setItem('aria_convs', JSON.stringify(S.convs));
  localStorage.setItem('aria_editHistory', JSON.stringify(S.editHistory.slice(-50))); // Keep last 50 edits
  // Persist pending diffs so the review modal survives a page reload mid-YOLO.
  if (S.pendingDiffs.length) localStorage.setItem('aria_pending_diffs', JSON.stringify(S.pendingDiffs));
  else localStorage.removeItem('aria_pending_diffs');
  if (S.idbSess) localStorage.setItem('aria_idb_sess', S.idbSess);
  else localStorage.removeItem('aria_idb_sess');
  if (S.fsMode) localStorage.setItem('aria_fs_mode', S.fsMode);
  else localStorage.removeItem('aria_fs_mode');
  if (S.cwd && S.cwd !== '~') localStorage.setItem('aria_cwd', S.cwd);
  else localStorage.removeItem('aria_cwd');
  localStorage.setItem('aria_temp', String(S.temperature));
  localStorage.setItem('aria_maxtok', String(S.maxTokens));
}

export function getApiKeys(provider = S.provider) {
  return (S.apiKeys[provider] || []).filter(k => k && k.key);
}

export function getActiveApiKey(provider = S.provider) {
  const keys = getApiKeys(provider);
  return (keys.find(k => k.active) || keys[0] || {}).key || '';
}

export function setActiveApiKey(provider, index) {
  const keys = S.apiKeys[provider] || [];
  keys.forEach((keyObj, i) => { keyObj.active = i === index; });
}

export function getProviderModelList(provider = S.provider) {
  const discovered = S.providerModels[provider] || [];
  const builtIn = PROVIDER_MODELS[provider] || [];
  const custom = S.customModels.filter(m => m.provider === provider).map(m => m.name);
  if (discovered.length) {
    return [...new Set([...discovered, ...custom].filter(Boolean))];
  }
  return [...new Set([...builtIn, ...custom].filter(Boolean))];
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
