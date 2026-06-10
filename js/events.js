// Event bindings and keyboard shortcuts.
// This module wires DOM elements to the state and UI modules.
// Shift+Tab: cycle plan -> edit -> yolo -> plan (when prompt is focused).

import { S, Live } from './state.js';
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

  // Send / stop.
  const doSend = () => {
    if (S.running) {
      Live.abortCtrl?.abort();
      S.running = false;
      setInput(true);
      closeTurn();
      return;
    }
    const t = inp.value.trim();
    if (!t) return;
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
  const setupKeyInput = document.getElementById('setup-key');
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

  /**
   * Validate a Mistral key by calling /v1/chat/completions with a tiny
   * 1-token request.  Resolves to { ok, error? }.
   */
  async function testKey(key) {
    try {
      const r = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (r.ok) return { ok: true };
      let body = null;
      try { body = await r.json(); } catch {}
      return {
        ok: false,
        status: r.status,
        error: (body && (body.detail || body.message)) || `HTTP ${r.status}`,
      };
    } catch (e) {
      return { ok: false, error: 'Network error: ' + e.message };
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

  /**
   * Save the key to state, persist to localStorage, and unlock the app.
   */
  async function commitKey(key, opts) {
    opts = opts || {};
    S.key = key;
    await import('./state.js').then(function (m) { return m.saveState(); });
    updateStatusBar();
    updateFooterMeta();
    refreshKeyStatus();
    if (appLock) appLock.classList.add('hidden');
    if (setupModal && opts.close !== false) setupModal.classList.add('hidden');
    if (settingsModal && opts.close !== false) settingsModal.classList.add('hidden');
    const inp = document.getElementById('prompt-inp');
    if (inp) inp.disabled = false;
    if (!opts.silent) toast('API key saved');
  }

  function refreshKeyStatus() {
    if (!keyStatus) return;
    if (S.key) {
      const masked = S.key.length > 12
        ? S.key.slice(0, 7) + '…' + S.key.slice(-4)
        : '••••';
      keyStatus.textContent = 'Active: ' + masked + ' (use the eye icon to reveal)';
    } else {
      keyStatus.textContent = 'No key set — ARIA will be locked.';
    }
  }

  function showSetupModal() {
    if (!setupModal) return;
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
    setupSave.disabled = v.length < 4;
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

  if (setupEye && setupKeyInput) {
    setupEye.onclick = function () {
      const isPw = setupKeyInput.type === 'password';
      setupKeyInput.type = isPw ? 'text' : 'password';
      setupEye.style.color = isPw ? 'var(--acc)' : 'var(--txt3)';
    };
  }
  if (settingsEye) {
    const settingsInput = document.getElementById('api-key');
    settingsEye.onclick = function () {
      if (!settingsInput) return;
      const isPw = settingsInput.type === 'password';
      settingsInput.type = isPw ? 'text' : 'password';
      settingsEye.style.color = isPw ? 'var(--acc)' : 'var(--txt3)';
    };
  }

  if (setupSave) {
    setupSave.onclick = async function () {
      const key = setupKeyInput.value.trim();
      if (!key) { showSetupError('Please enter a key.'); return; }
      setupSave.disabled = true;
      const oldText = setupSave.textContent;
      setupSave.textContent = 'Testing…';
      clearSetupError();
      const res = await testKey(key);
      if (!res.ok) {
        showSetupError('Key rejected: ' + (res.error || 'unknown error'));
        setupSave.disabled = false;
        setupSave.textContent = oldText;
        return;
      }
      await commitKey(key);
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

  const openSettings = function () {
    const k = document.getElementById('api-key'); if (k) k.value = S.key;
    const m = document.getElementById('model-sel'); if (m) m.value = S.model;
    const t = document.getElementById('temp-inp'); if (t) t.value = S.temperature;
    const x = document.getElementById('maxtok-inp'); if (x) x.value = S.maxTokens;
    refreshKeyStatus();
    settingsModal.classList.remove('hidden');
  };
  const closeSettings = function () { settingsModal.classList.add('hidden'); };

  if (settingsBtn) settingsBtn.onclick = openSettings;
  if (settingsClose) settingsClose.onclick = closeSettings;
  if (settingsCancel) settingsCancel.onclick = closeSettings;
  if (settingsSave) {
    settingsSave.onclick = async function () {
      const newKey = document.getElementById('api-key').value.trim();
      S.model = document.getElementById('model-sel').value;
      const ti = document.getElementById('temp-inp');
      const mt = document.getElementById('maxtok-inp');
      if (ti) S.temperature = parseFloat(ti.value) || 0.7;
      if (mt) S.maxTokens = parseInt(mt.value, 10) || 4096;
      if (newKey && newKey !== S.key) {
        const old = settingsSave.textContent;
        settingsSave.textContent = 'Testing…';
        settingsSave.disabled = true;
        const res = await testKey(newKey);
        settingsSave.disabled = false;
        settingsSave.textContent = old;
        if (!res.ok) {
          refreshKeyStatus();
          if (keyStatus) {
            keyStatus.textContent = '✕ Rejected: ' + (res.error || 'unknown error');
            keyStatus.style.color = 'var(--red)';
          }
          return;
        }
        await commitKey(newKey, { close: false });
        if (keyStatus) {
          keyStatus.textContent = '✓ New key verified and saved';
          keyStatus.style.color = 'var(--green)';
          setTimeout(function () { keyStatus.style.color = ''; refreshKeyStatus(); }, 2500);
        }
      } else {
        await import('./state.js').then(function (m) { return m.saveState(); });
        updateStatusBar();
        updateFooterMeta();
        toast('Settings saved');
      }
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
  if (!S.key) {
    if (noKeyChosen) {
      lockApp();
    } else {
      showSetupModal();
    }
  }
  refreshKeyStatus();

  // Init accordions
  import('./ui.js').then(function (m) { m.initAccordions(); m.restoreAccordions(); });

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
  Bus.on('widget:append', w => appendToTurn(w));
  Bus.on('turn:append', el => {
    document.getElementById('msgs')?.appendChild(el);
    scrollBot();
  });
}

