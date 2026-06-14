// Event bindings and keyboard shortcuts.
// This module wires DOM elements to the state and UI modules.
// Shift+Tab: cycle plan -> edit -> yolo -> plan (when prompt is focused).

import {
  S, Live, PROVIDERS, PROVIDER_LABELS, PROVIDER_KEY_PLACEHOLDER,
  getActiveApiKey, getApiKeys, getProviderModelList, saveState, setActiveApiKey
} from './state.js';
import { Bus, toast, scrollBot } from './utils.js';
import { initIDBSession, machOpen } from './fs.js';
import { showSessionNameModal } from './ui.js';
import {
  setMode, setInput, updateUI, updateStatusBar,
  renderAttachBar, renderSessionList, renderMemoryList,
  renderTodos, appendToTurn, updateFileTree, closeTurn, newConv,
  renderEditHistory, renderRewindUI, updateFooterMeta
} from './ui.js';

export function initEvents() {
  const inp = document.getElementById('prompt-inp');
  const btn = document.getElementById('send-btn');
  const chat = document.getElementById('chat');

  const toggleSidebar = () => {
    document.getElementById('sidebar').classList.toggle('hide');
    document.getElementById('main').classList.toggle('sb-open');
  };
  document.getElementById('toggle-sb').onclick = toggleSidebar;
  document.getElementById('close-sb').onclick = () => {
    document.getElementById('sidebar').classList.add('hide');
    document.getElementById('main').classList.remove('sb-open');
  };

  // ── Slash command preview ─────────────────────────────────
  // A small popup above the textarea that appears when the user types '/'
  // and filters as they keep typing. Arrow keys + Tab/Enter to complete.

  const SLASH_COMMANDS = [
    { cmd: 'plan',      desc: 'Switch to Plan mode (read-only analysis)',        arg: false },
    { cmd: 'edit',      desc: 'Switch to Edit mode (collaborative pair programming)', arg: false },
    { cmd: 'yolo',      desc: 'Switch to YOLO mode (autonomous execution)',      arg: false },
    { cmd: 'clear',     desc: 'Start a new conversation',                        arg: false },
    { cmd: 'workspace', desc: 'Switch to a named workspace session',             arg: '<name>' },
    { cmd: 'ws',        desc: 'Alias for /workspace',                            arg: '<name>' },
    { cmd: 'help',      desc: 'Show available slash commands',                   arg: false },
  ];

  let slashPopup = null;
  let slashActive = -1; // index of highlighted item

  function destroySlashPopup() {
    if (slashPopup) { slashPopup.remove(); slashPopup = null; }
    slashActive = -1;
  }

  function buildSlashPopup(matches) {
    destroySlashPopup();
    if (!matches.length) return;

    const wrap = document.createElement('div');
    wrap.id = 'slash-popup';
    wrap.style.cssText = [
      'position:absolute',
      'bottom:calc(100% + 6px)',
      'left:0',
      'right:0',
      'background:var(--surf2,#1a1a24)',
      'border:1px solid var(--border,#2a2a3a)',
      'border-radius:8px',
      'overflow:hidden',
      'z-index:200',
      'box-shadow:0 4px 20px rgba(0,0,0,.45)',
      'font-family:var(--mono,"Geist Mono",monospace)',
      'font-size:12px',
    ].join(';');

    matches.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'slash-row';
      row.dataset.idx = i;
      row.style.cssText = 'display:flex;align-items:baseline;gap:10px;padding:7px 12px;cursor:pointer;transition:background .1s;';
      row.onmouseenter = () => setSlashActive(i);
      row.onclick = () => applySlashCompletion(m);

      const cmdSpan = document.createElement('span');
      cmdSpan.style.cssText = 'color:var(--acc,#7c5cfc);font-weight:600;min-width:90px;flex-shrink:0;';
      cmdSpan.textContent = '/' + m.cmd + (m.arg ? ' ' + m.arg : '');

      const descSpan = document.createElement('span');
      descSpan.style.cssText = 'color:var(--txt3,#666);';
      descSpan.textContent = m.desc;

      row.append(cmdSpan, descSpan);
      wrap.appendChild(row);
    });

    // Position relative to prompt-wrap (the parent of the textarea).
    const promptWrap = document.getElementById('prompt-wrap');
    if (!promptWrap) return;
    promptWrap.style.position = 'relative';
    promptWrap.appendChild(wrap);
    slashPopup = wrap;

    setSlashActive(0);
  }

  function setSlashActive(idx) {
    if (!slashPopup) return;
    const rows = slashPopup.querySelectorAll('.slash-row');
    rows.forEach((r, i) => {
      r.style.background = i === idx ? 'var(--surf3,rgba(124,92,252,.12))' : '';
    });
    slashActive = idx;
  }

  function applySlashCompletion(match) {
    const val = inp.value;
    const slashIdx = val.lastIndexOf('/');
    if (slashIdx === -1) { destroySlashPopup(); return; }
    // Replace everything from '/' onward with the completed command.
    const completed = '/' + match.cmd + (match.arg ? ' ' : '');
    inp.value = val.slice(0, slashIdx) + completed;
    inp.focus();
    // Position cursor at end.
    inp.selectionStart = inp.selectionEnd = inp.value.length;
    destroySlashPopup();
  }

  function updateSlashPopup() {
    const val = inp.value;
    // Only show when the value starts with '/' and has no spaces yet
    // (spaces mean the user has moved past the command into the arg).
    if (!val.startsWith('/') || val.includes(' ')) {
      destroySlashPopup();
      return;
    }
    const partial = val.slice(1).toLowerCase();
    const matches = partial === ''
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter(c => c.cmd.startsWith(partial));
    if (!matches.length) { destroySlashPopup(); return; }
    buildSlashPopup(matches);
  }

  // Augment the existing oninput handler.
  const _origOninput = inp.oninput;
  inp.oninput = (e) => {
    if (_origOninput) _origOninput.call(inp, e);
    updateSlashPopup();
  };

  // Intercept arrow keys and Tab inside the popup.
  const _origOnkeydown = inp.onkeydown;
  inp.onkeydown = (e) => {
    if (slashPopup) {
      const rows = slashPopup.querySelectorAll('.slash-row');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashActive((slashActive + 1) % rows.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashActive((slashActive - 1 + rows.length) % rows.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && slashActive >= 0)) {
        const match = SLASH_COMMANDS.filter(c => {
          const partial = inp.value.slice(1).toLowerCase();
          return c.cmd.startsWith(partial);
        })[slashActive];
        if (match) {
          e.preventDefault();
          applySlashCompletion(match);
          return;
        }
      }
      if (e.key === 'Escape') {
        destroySlashPopup();
        return;
      }
    }
    if (_origOnkeydown) _origOnkeydown.call(inp, e);
  };

  // Dismiss popup when focus leaves the input.
  inp.addEventListener('blur', () => setTimeout(destroySlashPopup, 150));

  // Send / stop.
  const doSend = () => {
    if (S.running) {
      Live.abortCtrl?.abort();
      Bus.emit('agent:abort');
      S.running = false;
      setInput(true);
      closeTurn();
      return;
    }
    const t = inp.value.trim();
    if (!t) return;

    // ── Slash commands ────────────────────────────────────────
    // Handled client-side before the message reaches the model.
    if (t.startsWith('/')) {
      const [cmd, ...rest] = t.slice(1).split(' ');
      const arg = rest.join(' ').trim();
      switch (cmd.toLowerCase()) {
        case 'plan':
          inp.value = '';
          if (S.running) { toast('Cannot switch mode while agent is running.'); return; }
          setMode('plan'); return;
        case 'edit':
          inp.value = '';
          if (S.running) { toast('Cannot switch mode while agent is running.'); return; }
          setMode('edit'); return;
        case 'yolo':
          inp.value = '';
          if (S.running) { toast('Cannot switch mode while agent is running.'); return; }
          setMode('yolo'); return;
        case 'clear':
          inp.value = '';
          import('./ui.js').then(m => m.newConv()); return;
        case 'workspace':
        case 'ws':
          inp.value = '';
          if (!arg) { toast('Usage: /workspace <name>'); return; }
          import('./fs.js').then(async m => {
            try { await m.switchWorkspace(arg); toast('Workspace: ' + arg); }
            catch (e) { toast('Workspace not found: ' + arg); }
          }); return;
        case 'help':
          inp.value = '';
          toast('/plan /edit /yolo /clear /workspace <name>', 4000); return;
        // Unknown slash command — let it fall through to the model as normal text.
      }
    }

    inp.value = '';
    inp.style.height = 'auto';
    import('./app.js').then(m => m.runAgent(t));
  };
  btn.onclick = doSend;
  inp.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  };
  inp.oninput = () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 180) + 'px';
  };

  // Attach files.
  document.getElementById('attach-btn').onclick = () =>
    document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = e => {
    S.files.push(...Array.from(e.target.files || []));
    renderAttachBar();
    e.target.value = '';
  };

  // Drag and drop onto the chat area.
  chat.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  chat.addEventListener('drop', e => {
    e.preventDefault();
    const f = Array.from(e.dataTransfer.files);
    if (f.length) { S.files.push(...f); renderAttachBar(); inp.focus(); }
  });

  // Welcome screen CTAs — wired here instead of inline onclick in HTML.
  document.getElementById('wlc-open-folder')?.addEventListener('click', () =>
    document.getElementById('open-folder-btn')?.click());
  document.getElementById('wlc-new-session')?.addEventListener('click', () =>
    import('./fs.js').then(m => m.initIDBSession()));
  document.getElementById('wlc-chat-only')?.addEventListener('click', () =>
    document.getElementById('prompt-inp')?.focus());

  // Open real folder (File System Access API).
  document.getElementById('open-folder-btn').onclick = async () => {
    if (!('showDirectoryPicker' in window)) { toast('File System Access API not supported in this browser.'); return; }
    const n = await machOpen().catch(() => null);
    if (n) {
      const { afterFsInit } = await import('./app.js');
      afterFsInit('machine', n);
    }
  };

  // Start a new IDB session.
  document.getElementById('new-idb-btn').onclick = async () => {
    const name = await showSessionNameModal();
    await initIDBSession({ name });
  };

  // Mode buttons in the sidebar (joiner-toggle).
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => {
      if (S.running) { toast('Cannot switch mode while agent is running.'); return; }
      setMode(b.dataset.mode);
    };
  });



  // -----------------------------------------------------------------------
  // First-load setup modal — blocks the app until a key is provided.
  // -----------------------------------------------------------------------
  const setupModal = document.getElementById('setup-modal');
  const setupProviderSel = document.getElementById('setup-provider');
  const setupKeyInput = document.getElementById('setup-key');
  const setupCustomBaseWrap = document.getElementById('setup-custom-base-wrap');
  const setupCustomBase = document.getElementById('setup-custom-base');
  const setupSave = document.getElementById('setup-save');
  const setupError = document.getElementById('setup-error');
  const setupNoKey = document.getElementById('setup-no-key');
  const setupEye = document.getElementById('setup-eye');
  const appLock = document.getElementById('app-lock');
  const appLockSetup = document.getElementById('app-lock-setup');

  // Settings modal (gear icon)
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-modal-close');
  const settingsCancel = document.getElementById('settings-modal-cancel');
  const settingsSave = document.getElementById('settings-modal-save');
  const settingsEye = document.getElementById('settings-eye');
  const keyStatus = document.getElementById('key-status');
  const customProviderRow = document.getElementById('custom-provider-row');
  const customProviderBase = document.getElementById('custom-provider-base');
  const modelFreeform = document.getElementById('model-freeform');

  /**
   * Validate an API key by making a minimal request with the current provider.
   */
  async function testKey(key, provider) {
    provider = provider || S.provider || 'mistral';
    const discovered = await refreshProviderModels(provider, true, key);
    if (!discovered.length) {
      return {
        ok: true,
        verified: false,
        warning: `Could not load a live model list for ${provider}; saved without verification.`,
      };
    }
    const model = discovered[0];
    const payload = {
      provider,
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    };
    if (provider === 'custom') payload.base_url = S.customProvider.baseUrl;
    try {
      const r = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) return { ok: true, verified: true };
      let responseBody = null;
      try { responseBody = await r.json(); } catch {}
      return { ok: false, status: r.status, error: (responseBody && (responseBody.detail || responseBody.message)) || `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: 'Network error: ' + e.message };
    }
  }

  async function refreshProviderModels(provider, force = false, keyOverride = '') {
    if (!provider || !PROVIDERS[provider]?.dynamicModels) return getProviderModelList(provider);
    if (!force && (S.providerModels[provider] || []).length) return S.providerModels[provider];
    const key = keyOverride || getActiveApiKey(provider);
    if (!key && provider !== 'custom') return [];
    const params = new URLSearchParams({ provider });
    if (provider === 'custom' && S.customProvider.baseUrl) params.set('base_url', S.customProvider.baseUrl);
    try {
      const r = await fetch('/v1/models?' + params.toString(), {
        headers: key ? { 'Authorization': 'Bearer ' + key } : {},
      });
      if (!r.ok) return [];
      const data = await r.json();
      const models = (data.data || []).map(m => m.id || m.name).filter(Boolean).sort();
      if (models.length) {
        S.providerModels[provider] = models;
        saveState();
      }
      return models;
    } catch {
      return [];
    }
  }

  function showSetupError(msg) {
    if (!setupError) return;
    setupError.textContent = msg;
    setupError.classList.remove('hidden');
  }
  function clearSetupError() {
    if (!setupError) return;
    setupError.textContent = '';
    setupError.classList.add('hidden');
  }

  function populateProviderSelect(sel, selected = S.provider) {
    if (!sel) return;
    sel.innerHTML = '';
    for (const [val, label] of Object.entries(PROVIDER_LABELS)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = val === selected;
      sel.appendChild(opt);
    }
  }

  function updateCustomProviderVisibility() {
    const provider = document.getElementById('provider-sel')?.value || S.provider;
    if (customProviderRow) customProviderRow.classList.toggle('hidden', provider !== 'custom');
    if (customProviderBase) customProviderBase.value = S.customProvider.baseUrl || '';
    const setupProvider = setupProviderSel?.value || S.provider;
    if (setupCustomBaseWrap) setupCustomBaseWrap.classList.toggle('hidden', setupProvider !== 'custom');
    if (setupCustomBase && !setupCustomBase.value) setupCustomBase.value = S.customProvider.baseUrl || '';
  }

  function refreshKeyStatus() {
    if (!keyStatus) return;
    const activeKey = getActiveApiKey(S.provider);
    if (activeKey) {
      const masked = activeKey.length > 12
        ? activeKey.slice(0, 7) + '…' + activeKey.slice(-4)
        : '••••';
      keyStatus.textContent = `Active Key (${S.provider}): ${masked}`;
      keyStatus.style.color = 'var(--txt3)';
    } else {
      keyStatus.textContent = `No active key for ${S.provider}. ARIA may be locked.`;
      keyStatus.style.color = 'var(--red)';
    }
  }

  function showSetupModal() {
    if (!setupModal) return;
    populateProviderSelect(setupProviderSel, S.provider);
    updateCustomProviderVisibility();
    setupModal.classList.remove('hidden');
    const inp = document.getElementById('prompt-inp');
    if (inp) inp.disabled = true;
    if (appLock) appLock.classList.add('hidden');
    setTimeout(function () { if (setupKeyInput) setupKeyInput.focus(); }, 100);
  }

  function lockApp() {
    if (appLock) appLock.classList.remove('hidden');
    const inp = document.getElementById('prompt-inp');
    if (inp) inp.disabled = true;
  }

  function updateSaveButton() {
    if (!setupSave || !setupKeyInput) return;
    const v = setupKeyInput.value.trim();
    const provider = setupProviderSel?.value || S.provider;
    const needsBase = provider === 'custom';
    setupSave.disabled = v.length < 4 || (needsBase && !setupCustomBase?.value.trim());
  }
  if (setupKeyInput) {
    setupKeyInput.addEventListener('input', function () {
      clearSetupError();
      updateSaveButton();
    });
    setupKeyInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !setupSave.disabled) {
        e.preventDefault();
        setupSave.click();
      }
    });
  }
  if (setupProviderSel) {
    setupProviderSel.onchange = function () {
      S.provider = setupProviderSel.value;
      updateCustomProviderVisibility();
      updateSaveButton();
    };
  }
  if (setupCustomBase) {
    setupCustomBase.addEventListener('input', function () {
      S.customProvider.baseUrl = setupCustomBase.value.trim();
      updateSaveButton();
    });
  }

  if (setupEye && setupKeyInput) {
    setupEye.onclick = function () {
      const isPw = setupKeyInput.type === 'password';
      setupKeyInput.type = isPw ? 'text' : 'password';
      setupEye.style.color = isPw ? 'var(--acc)' : 'var(--txt3)';
    };
  }
  if (settingsEye) {
    const settingsInput = document.getElementById('api-key'); // This is now a display for the active key
    settingsEye.onclick = function () {
      if (!settingsInput) return;
      if (settingsInput.type === 'password') {
        settingsInput.type = 'text';
        settingsInput.value = getActiveApiKey(); // Reveal the actual key
        settingsEye.style.color = 'var(--acc)';
      } else {
        settingsInput.type = 'password';
        // Mask the key again, keep the placeholder or masked value
        settingsInput.value = settingsInput.value ? '••••••••••••' : '';
        settingsEye.style.color = 'var(--txt3)';
      }
    };
  }

  if (setupSave) {
    setupSave.onclick = async function () {
      const provider = setupProviderSel?.value || S.provider;
      const key = setupKeyInput.value.trim();
      if (!key) { showSetupError('Please enter a key.'); return; }
      if (provider === 'custom') {
        S.customProvider.baseUrl = setupCustomBase?.value.trim() || '';
        if (!S.customProvider.baseUrl) { showSetupError('Please enter a custom provider base URL.'); return; }
      }
      S.provider = provider;
      setupSave.disabled = true;
      const oldText = setupSave.textContent;
      setupSave.textContent = 'Testing…';
      clearSetupError();
      const res = await testKey(key, provider);
      if (!res.ok) {
        showSetupError('Key rejected: ' + (res.error || 'unknown error'));
        setupSave.disabled = false;
        setupSave.textContent = oldText;
        return;
      }
      if (res.warning) {
        toast(res.warning, 'warn');
      }
      if (!S.apiKeys[provider]) S.apiKeys[provider] = [];
      const existing = S.apiKeys[provider].findIndex(k => k.key === key);
      if (existing >= 0) {
        S.apiKeys[provider][existing] = { ...S.apiKeys[provider][existing], name: 'Default', active: true };
        setActiveApiKey(provider, existing);
      } else {
        S.apiKeys[provider].push({ key, name: 'Default', active: true });
        setActiveApiKey(provider, S.apiKeys[provider].length - 1);
      }
      await refreshProviderModels(provider, true, key);
      S.model = getProviderModelList(provider)[0] || S.model;
      saveState();
      updateStatusBar();
      updateFooterMeta();
      refreshKeyStatus();
      if (appLock) appLock.classList.add('hidden');
      if (setupModal) setupModal.classList.add('hidden');
      const inp = document.getElementById('prompt-inp');
      if (inp) inp.disabled = false;
      toast('API key saved');
      setupSave.textContent = oldText;
    };
  }

  if (setupNoKey) {
    setupNoKey.onclick = function () {
      localStorage.setItem('aria_no_key', '1');
      setupModal.classList.add('hidden');
      lockApp();
      toast('ARIA is locked. Open the settings gear to add a key.');
    };
  }

  if (appLockSetup) {
    appLockSetup.onclick = function () {
      if (appLock) appLock.classList.add('hidden');
      showSetupModal();
    };
  }

  // ── Provider / model selectors ────────────────────────────
  async function populateModelSel(provider, forceRefresh = false) {
    const sel = document.getElementById('model-sel');
    if (!sel) return;
    sel.innerHTML = '';

    const liveModels = await refreshProviderModels(provider, forceRefresh);
    const models = liveModels.length ? liveModels : getProviderModelList(provider);

    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      if (m === S.model) opt.selected = true;
      sel.appendChild(opt);
    }
    if (!models.includes(S.model)) {
      if (models[0]) {
        S.model = models[0];
        sel.value = models[0];
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Enter custom model';
        sel.appendChild(opt);
      }
    }
    if (modelFreeform) {
      modelFreeform.value = models.includes(S.model) ? '' : S.model;
    }
  }

  function populateProviderSel() {
    populateProviderSelect(document.getElementById('provider-sel'), S.provider);
  }

  const providerSel = document.getElementById('provider-sel');
  if (providerSel) {
    providerSel.onchange = async function () {
      const newProv = this.value;
      S.provider = newProv;
      if (customProviderBase) customProviderBase.value = S.customProvider.baseUrl || '';
      updateCustomProviderVisibility();
      await populateModelSel(newProv, true);
      refreshKeyStatus();
    };
  }
  if (customProviderBase) {
    customProviderBase.addEventListener('input', async function () {
      S.customProvider.baseUrl = customProviderBase.value.trim();
        S.providerModels.custom = [];
        if (S.provider === 'custom') await populateModelSel('custom', true);
    });
  }
  if (modelFreeform) {
    modelFreeform.addEventListener('input', function () {
      if (modelFreeform.value.trim()) S.model = modelFreeform.value.trim();
    });
  }
  const modelSelEl = document.getElementById('model-sel');
  if (modelSelEl) {
    modelSelEl.onchange = function () {
      if (modelSelEl.value) {
        S.model = modelSelEl.value;
        if (modelFreeform) modelFreeform.value = '';
      }
    };
  }

  const openSettings = async function () {
    populateProviderSel();
    updateCustomProviderVisibility();
    await populateModelSel(S.provider, true);
    const t = document.getElementById('temp-inp'); if (t) t.value = S.temperature;
    const x = document.getElementById('maxtok-inp'); if (x) x.value = S.maxTokens;

    // Display active key in the main settings modal key field (read-only)
    const activeKey = getActiveApiKey(S.provider);
    const keyInp = document.getElementById('api-key');
    if (keyInp) {
      keyInp.value = activeKey ? '••••••••••••' : ''; // Mask by default
      keyInp.placeholder = PROVIDER_KEY_PLACEHOLDER[S.provider] || 'No key set';
      keyInp.readOnly = true; // Make it read-only
    }
    refreshKeyStatus();
    renderAPIKeyList(); // Render the list of saved API keys
    renderCustomModelList(); // Render the list of custom models
    settingsModal.classList.remove('hidden');
  };
  const closeSettings = function () { settingsModal.classList.add('hidden'); };

  if (settingsBtn) settingsBtn.onclick = openSettings;
  if (settingsClose) settingsClose.onclick = closeSettings;
  if (settingsCancel) settingsCancel.onclick = closeSettings;
  if (settingsSave) {
    settingsSave.onclick = async function () {
      S.provider = document.getElementById('provider-sel')?.value || 'mistral';
      if (S.provider === 'custom') {
        S.customProvider.baseUrl = customProviderBase?.value.trim() || '';
        if (!S.customProvider.baseUrl) {
          toast('Custom provider base URL is required.', 'error');
          return;
        }
      }
      S.model = modelFreeform?.value.trim() || document.getElementById('model-sel')?.value || S.model;
      const ti = document.getElementById('temp-inp');
      const mt = document.getElementById('maxtok-inp');
      if (ti) S.temperature = parseFloat(ti.value) || 0.7;
      if (mt) S.maxTokens = parseInt(mt.value, 10) || 4096;
      await import('./state.js').then(function (m) { return m.saveState(); });
      updateStatusBar();
      updateFooterMeta();
      toast('Settings saved');
      closeSettings();
    };
  }
  if (settingsModal) {
    settingsModal.onclick = function (e) { if (e.target === settingsModal) closeSettings(); };
  }

  /**
   * Boot-time decision: do we have a valid key?  If not, show the setup
   * modal (or, if the user previously chose "continue without a key",
   * show the small lock overlay).
   */
  const noKeyChosen = localStorage.getItem('aria_no_key') === '1';
  // Check if there are any API keys saved at all
  const hasAnyApiKeys = Object.values(S.apiKeys).some(keys => Array.isArray(keys) && keys.length > 0);

  if (!hasAnyApiKeys) {
    if (noKeyChosen) {
      lockApp();
    } else {
      showSetupModal();
    }
  }
  refreshKeyStatus();

  // Init accordions
  import('./ui.js').then(function (m) { m.initAccordions(); m.restoreAccordions(); });

  // ── API Key Management ────────────────────────────
  const addApiKeyBtn = document.getElementById('add-api-key-btn');
  const addApiKeyForm = document.getElementById('add-api-key-form');
  const cancelAddApiKeyBtn = document.getElementById('cancel-add-api-key');
  const saveNewApiKeyBtn = document.getElementById('save-new-api-key');
  const newApiKeyProviderSel = document.getElementById('new-api-key-provider-sel');
  const newApiKeyInput = document.getElementById('new-api-key-input');
  const newApiKeyNameInput = document.getElementById('new-api-key-name');
  const apiKeyListDiv = document.getElementById('api-key-list');

  function renderAPIKeyList() {
    if (!apiKeyListDiv) return;
    apiKeyListDiv.innerHTML = '';
    for (const provider in S.apiKeys) {
      if (!Array.isArray(S.apiKeys[provider])) continue;
      S.apiKeys[provider].forEach((keyObj, index) => {
        const keyItem = document.createElement('div');
        keyItem.className = 'api-key-item';
        const maskedKey = keyObj.key.length > 8 ? keyObj.key.slice(0, 4) + '...' + keyObj.key.slice(-4) : '••••';
        const label = document.createElement('span');
        label.textContent = `${keyObj.active ? 'Active: ' : ''}${keyObj.name || 'Untitled Key'} (${PROVIDER_LABELS[provider] || provider}): ${maskedKey}`;
        const useBtn = document.createElement('button');
        useBtn.className = 'btn sm';
        useBtn.textContent = 'Use';
        useBtn.disabled = !!keyObj.active;
        useBtn.onclick = () => {
          setActiveApiKey(provider, index);
          saveState();
          refreshKeyStatus();
          renderAPIKeyList();
        };
        const delBtn = document.createElement('button');
        delBtn.className = 'btn sm danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => {
          S.apiKeys[provider].splice(index, 1);
          if (S.apiKeys[provider][0] && !S.apiKeys[provider].some(k => k.active)) S.apiKeys[provider][0].active = true;
          saveState();
          refreshKeyStatus();
          renderAPIKeyList();
        };
        keyItem.append(label, useBtn, delBtn);
        apiKeyListDiv.appendChild(keyItem);
      });
    }
    if (!apiKeyListDiv.children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = 'No saved API keys.';
      apiKeyListDiv.appendChild(empty);
    }
  }

  if (addApiKeyBtn) addApiKeyBtn.onclick = () => {
    addApiKeyForm.classList.remove('hidden');
    addApiKeyBtn.classList.add('hidden');
    populateProviderSelect(newApiKeyProviderSel, S.provider);
    newApiKeyInput.focus();
  };

  if (cancelAddApiKeyBtn) cancelAddApiKeyBtn.onclick = () => {
    addApiKeyForm.classList.add('hidden');
    addApiKeyBtn.classList.remove('hidden');
    newApiKeyInput.value = '';
    newApiKeyNameInput.value = '';
  };

  if (saveNewApiKeyBtn) saveNewApiKeyBtn.onclick = async () => {
    const provider = newApiKeyProviderSel.value;
    const key = newApiKeyInput.value.trim();
    const name = newApiKeyNameInput.value.trim();

    if (!key) { toast('API Key cannot be empty!', 'error'); return; }
    if (provider === 'custom' && !S.customProvider.baseUrl) {
      toast('Set a custom provider base URL first.', 'error');
      return;
    }

    const res = await testKey(key, provider);
    if (!res.ok) {
      toast('API Key rejected: ' + (res.error || 'unknown error'), 'error');
      return;
    }

    if (!S.apiKeys[provider]) S.apiKeys[provider] = [];
    const existing = S.apiKeys[provider].findIndex(k => k.key === key);
    if (existing >= 0) {
      S.apiKeys[provider][existing] = { ...S.apiKeys[provider][existing], name: name || S.apiKeys[provider][existing].name || 'Untitled Key' };
      setActiveApiKey(provider, existing);
    } else {
      S.apiKeys[provider].push({ key, name: name || 'Untitled Key' });
      setActiveApiKey(provider, S.apiKeys[provider].length - 1);
    }
    await refreshProviderModels(provider, true);
    saveState();
    toast('API Key saved!');
    renderAPIKeyList();
    cancelAddApiKeyBtn.click(); // Hide form and clear fields
  };

  // ── Custom Model Management ────────────────────────────
  const addCustomModelBtn = document.getElementById('add-custom-model-btn');
  const addCustomModelForm = document.getElementById('add-custom-model-form');
  const cancelAddCustomModelBtn = document.getElementById('cancel-add-custom-model');
  const saveNewCustomModelBtn = document.getElementById('save-new-custom-model');
  const newCustomModelNameInput = document.getElementById('new-custom-model-name');
  const newCustomModelProviderSel = document.getElementById('new-custom-model-provider-sel');
  const newCustomModelBaseInput = document.getElementById('new-custom-model-base');
  const customModelListDiv = document.getElementById('custom-model-list');

  function renderCustomModelList() {
    if (!customModelListDiv) return;
    customModelListDiv.innerHTML = '';
    S.customModels.forEach((modelObj, index) => {
      const modelItem = document.createElement('div');
      modelItem.className = 'custom-model-item';
      const label = document.createElement('span');
      label.textContent = `${modelObj.name} (${PROVIDER_LABELS[modelObj.provider] || modelObj.provider})`;
      const delBtn = document.createElement('button');
      delBtn.className = 'btn sm danger';
      delBtn.textContent = 'Delete';
      delBtn.onclick = async () => {
        S.customModels.splice(index, 1);
        saveState();
        await populateModelSel(S.provider);
        renderCustomModelList();
      };
      modelItem.append(label, delBtn);
      customModelListDiv.appendChild(modelItem);
    });
    if (!customModelListDiv.children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = 'No custom models.';
      customModelListDiv.appendChild(empty);
    }
  }

  if (addCustomModelBtn) addCustomModelBtn.onclick = () => {
    addCustomModelForm.classList.remove('hidden');
    addCustomModelBtn.classList.add('hidden');
    populateProviderSelect(newCustomModelProviderSel, S.provider);
    newCustomModelNameInput.focus();
  };

  if (cancelAddCustomModelBtn) cancelAddCustomModelBtn.onclick = () => {
    addCustomModelForm.classList.add('hidden');
    addCustomModelBtn.classList.remove('hidden');
    newCustomModelNameInput.value = '';
    newCustomModelBaseInput.value = '';
  };

  if (saveNewCustomModelBtn) saveNewCustomModelBtn.onclick = async () => {
    const name = newCustomModelNameInput.value.trim();
    const provider = newCustomModelProviderSel.value;

    if (!name) { toast('Model Name cannot be empty!', 'error'); return; }
    if (S.customModels.some(m => m.provider === provider && m.name === name)) {
      toast('That custom model already exists for this provider.', 'error');
      return;
    }

    S.customModels.push({ name, provider });
    saveState();
    toast('Custom Model saved!');
    await populateModelSel(S.provider);
    renderCustomModelList();
    cancelAddCustomModelBtn.click(); // Hide form and clear fields
  };

  // New chat.  // New chat.
  document.getElementById('new-chat-btn').onclick = newConv;

  // Undo last edit.
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) {
    undoBtn.onclick = async () => {
      const { undoLastEdit } = await import('./state.js');
      const { fsWrite } = await import('./fs.js');
      const last = undoLastEdit();
      if (!last) {
        toast('No edits to undo');
        return;
      }
      try {
        await fsWrite(last.path, last.before);
        toast(`Undid ${last.toolName} on ${last.path}`);
        Bus.emit('fs:changed', { path: last.path });
        updateFileTree();
        renderEditHistory();
      } catch (e) {
        toast('Failed to undo: ' + e.message);
      }
    };
  }

  // Rewind conversation - use the modal UI
  renderRewindUI();

  // Render edit history on load
  renderEditHistory();

  // Paste image handling.
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) { S.files.push(f); renderAttachBar(); }
      }
    }
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', e => {
    // Cmd/Ctrl+K: focus the prompt textarea.
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inp.focus(); inp.select(); }
    // Cmd/Ctrl+\: toggle sidebar.
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') { toggleSidebar(); }
    // Ctrl/Cmd+M: cycle modes plan -> edit -> yolo -> plan.
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      if (S.running) { toast('Cannot switch mode while agent is running.'); return; }
      const modes = ['plan', 'edit', 'yolo'];
      const idx = modes.indexOf(S.mode);
      setMode(modes[(idx + 1) % modes.length]);
    }
    // Escape: close the topmost open modal, or blur the input.
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openModal) {
        openModal.classList.add('hidden');
        e.preventDefault();
        return;
      }
      if (document.activeElement === inp) inp.blur();
    }
  });

  // Bus subscriptions: react to events from other modules.
  Bus.on('fs:init', ({ type, name }) => { import('./app.js').then(m => m.afterFsInit(type, name)); });
  Bus.on('fs:switch', () => updateUI());
  Bus.on('fs:close', () => updateUI());
  Bus.on('fs:changed', () => updateFileTree());
  Bus.on('sessions:refresh', () => renderSessionList());
  Bus.on('memory:update', () => renderMemoryList());
  Bus.on('todos:update', () => renderTodos());
  Bus.on('status:update', () => updateUI());
  Bus.on('ctx:update', pct => { import('./ui.js').then(m => m.updateCtxBar(pct)); });
  Bus.on('tokens:update', usage => { import('./ui.js').then(m => { m.updateFooterMeta(); }); });
  Bus.on('widget:append', w => appendToTurn(w));
  Bus.on('turn:append', el => {
    document.getElementById('msgs')?.appendChild(el);
    scrollBot();
  });
}
