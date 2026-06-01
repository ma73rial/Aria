// Event bindings and keyboard shortcuts.
// This module wires DOM elements to the state and UI modules.
// Shift+Tab: cycle plan -> edit -> yolo -> plan (when prompt is focused).

import { S, Live } from './state.js';
import { Bus, toast, scrollBot } from './utils.js';
import { initIDBSession, machOpen } from './fs.js';
import {
  setMode, setInput, updateUI, updateStatusBar,
  renderAttachBar, renderSessionList, renderMemoryList,
  renderTodos, appendToTurn, updateFileTree, closeTurn, newConv,
  renderEditHistory, renderRewindUI
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
    const name = prompt('Session name (optional):');
    await initIDBSession({ name: name || undefined });
  };

  // Mode buttons in the sidebar.
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  // Settings save.
  document.getElementById('save-settings').onclick = () => {
    S.key = document.getElementById('api-key').value.trim();
    S.model = document.getElementById('model-sel').value;
    const ti = document.getElementById('temp-inp');
    const mt = document.getElementById('maxtok-inp');
    if (ti) S.temperature = parseFloat(ti.value) || 0.7;
    if (mt) S.maxTokens = parseInt(mt.value, 10) || 4096;
    import('./state.js').then(m => m.saveState());
    updateStatusBar();
    toast('Settings saved');
  };

  // New chat.
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

