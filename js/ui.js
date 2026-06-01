// UI rendering. All DOM creation, update, and manipulation.
import { S, Live } from './state.js';
import { Bus, esc, fmtEl, scrollBot, toast } from './utils.js';
import { renderRich, highlightAll } from './markdown.js';
import { fsList, fsRead } from './fs.js';
import { openReviewModal } from './review.js';
import { icon, fileIcon, fileIconName, ICONS } from './icons.js';

let currentTurn = null;
let workingEl = null;
export { currentTurn, workingEl };

export function startTurn() {
  const msgs = document.getElementById('msgs');
  document.getElementById('welcome')?.remove();
  currentTurn = document.createElement('div');
  currentTurn.className = 'msg-agent';
  currentTurn.dataset.tid = Math.random().toString(36).slice(2, 9);
  workingEl = document.createElement('div');
  workingEl.className = 'working';
  workingEl.innerHTML = '<div class="dots"><span></span><span></span><span></span></div><span class="working-txt">Working\u2026</span>';
  currentTurn.appendChild(workingEl);
  msgs.appendChild(currentTurn);
  scrollBot();
  Live.t0 = Date.now();
  Live.tickTimer = setInterval(() => {
    const el = workingEl?.querySelector('.working-txt');
    if (el) el.textContent = 'Worked for ' + fmtEl(Date.now() - Live.t0) + '.';
  }, 200);
}

export function closeTurn() {
  if (Live.tickTimer) { clearInterval(Live.tickTimer); Live.tickTimer = null; }
  if (workingEl) {
    const el = workingEl.querySelector('.working-txt');
    if (el) { el.textContent = 'Worked for ' + fmtEl(Date.now() - Live.t0) + '.'; el.style.color = 'var(--txt3)'; }
    workingEl.querySelector('.dots')?.remove();
  }
  if (S.pendingDiffs.length > 0 && currentTurn) {
    const chip = document.createElement('div');
    chip.className = 'review-chip';
    chip.textContent = 'Review ' + S.pendingDiffs.length + ' change' + (S.pendingDiffs.length === 1 ? '' : 's') + ' \u2192';
    chip.onclick = openReviewModal;
    currentTurn.appendChild(chip);
    scrollBot();
  }
  if (S.mode === 'yolo' && S.pendingDiffs.length > 0) {
    setTimeout(() => { S.pendingDiffs = []; Bus.emit('review:update', []); }, 5000);
  }
}

export function addThought(text) {
  if (!currentTurn) return;
  const b = document.createElement('div');
  b.className = 'thought';
  b.innerHTML = renderRich(text);
  highlightAll(b);
  currentTurn.appendChild(b);
  scrollBot();
}

export function addToolRow(name, args) {
  if (!currentTurn) return null;
  const el = document.createElement('div');
  el.className = 'tool-act';
  const dot = document.createElement('div');
  dot.className = 'tdot run';
  const lbl = document.createElement('div');
  lbl.className = 'tlabel';
  lbl.innerHTML = toolLabel(name, args);
  el.append(dot, lbl);
  currentTurn.appendChild(el);
  scrollBot();
  return el;
}

export function finishToolRow(el, ok) {
  if (!el) return;
  const d = el.querySelector('.tdot');
  if (d) { d.classList.remove('run'); d.classList.add(ok ? 'ok' : 'err'); }
}

export function appendToTurn(el) {
  if (currentTurn) currentTurn.appendChild(el);
  scrollBot();
}

function toolLabel(name, args) {
  const A = s => '<span class="ta">' + esc(String(s || '')) + '</span>';
  const m = {
    list_directory: 'Listed directory ' + A(args.path || '.'),
    read_file: 'Read ' + A(args.path),
    read_file_range: 'Read slice of ' + A(args.path),
    read_many_files: 'Read <b>' + (args.paths?.length || 0) + '</b> files',
    write_file: 'Wrote ' + A(args.path),
    edit_file: 'Edited ' + A(args.path),
    delete_file: 'Deleted ' + A(args.path),
    rename_file: 'Renamed ' + A(args.old_path) + ' \u2192 ' + A(args.new_path),
    make_directory: 'Created directory ' + A(args.path),
    fetch_request: 'Fetched ' + A(args.url),
    clarify: 'Asked a question',
    simple_question: 'Asked a question',
    think_deeper: 'Thinking deeper\u2026',
    add_todo: 'Added TODO: ' + A(args.text),
    complete_todo: 'Completed TODO [' + args.index + ']',
    run_javascript: 'Ran JavaScript',
    display_html: 'Displaying HTML',
    display_markdown: 'Rendering markdown',
    create_artifact: 'Created artifact: ' + A(args.title),
    spawn_subagent: 'Spawned subagent',
    git_status: 'Checked git status',
    save_to_memory: 'Saved memory: ' + A(args.key),
    search_conversations: 'Searched: ' + A(args.query),
    date_now: 'Got current time',
    make_pdf: 'PDF: ' + A(args.filename || 'doc'),
    suggest_mode: 'Suggested: ' + A(args.mode),
    init_filesystem: 'Init ' + A(args.type) + ' filesystem',
    switch_workspace: 'Switched to session: ' + A(args.name),
    list_workspaces: 'Listed workspaces',
    delete_workspace: 'Deleted session: ' + A(args.name),
    list_todos: 'Listed TODOs',
  };
  return m[name] || esc(name);
}



// --- Tool result rendering ----------------------------------

export function renderToolResult(name, result) {
  if (!currentTurn || !result) return;
  const ui = result._ui;

  if (ui === 'suggest_mode') {
    const wrap = document.createElement('div');
    wrap.className = 'mode-sug';
    const r = document.createElement('div');
    r.className = 'mode-sug-reason';
    r.textContent = result.reason;
    const ab = document.createElement('div');
    ab.className = 'act-bubbles';
    const lb = document.createElement('button');
    lb.className = 'act-bub';
    const sb = document.createElement('button');
    sb.className = 'act-bub';
    sb.textContent = 'Skip';
    sb.style.marginLeft = '6px';
    const modeActions = {
      plan: () => setMode('plan'),
      edit: () => setMode('edit'),
      yolo: () => setMode('yolo'),
      open_folder: () => document.getElementById('open-folder-btn')?.click(),
      new_idb: () => { import('./fs.js').then(m => m.initIDBSession()); },
    };
    lb.textContent = result.mode === 'open_folder' ? '\ud83d\udcc1 Open Folder'
      : result.mode === 'new_idb' ? '\ud83d\udfc4 New IDB Session'
      : 'Switch to ' + result.mode.toUpperCase();
    const disable = () => { lb.disabled = true; lb.style.opacity = '.4'; sb.disabled = true; sb.style.opacity = '.4'; };
    lb.onclick = () => { modeActions[result.mode]?.(); disable(); };
    sb.onclick = disable;
    if (S.mode === 'yolo') setTimeout(() => { modeActions[result.mode]?.(); disable(); }, 10000);
    ab.append(lb, sb);
    wrap.append(r, ab);
    appendToTurn(wrap);
    return;
  }

  if (ui === 'diff' && result.diff) {
    renderDiffInline(result.path, result.diff, result.isNew);
    return;
  }

  if (ui === 'think_deeper' && result.analysis) {
    addCondensedThought(result.analysis);
    return;
  }

  if (ui === 'markdown' && result.content) {
    const el = document.createElement('div');
    el.className = 'md-wrap';
    if (result.title) {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:10px;font-family:var(--mono);color:var(--txt3);margin-bottom:5px;';
      h.textContent = result.title;
      el.appendChild(h);
    }
    el.innerHTML += renderRich(result.content);
    highlightAll(el);
    appendToTurn(el);
    return;
  }

  if (ui === 'html' && result.html) {
    const wrap = document.createElement('div');
    wrap.className = 'html-wrap';
    const hd = document.createElement('div');
    hd.className = 'html-hd';
    hd.textContent = result.title || 'HTML Preview';
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.style.height = (result.height || 300) + 'px';
    iframe.srcdoc = result.html;
    wrap.append(hd, iframe);
    appendToTurn(wrap);
    return;
  }

  if (ui === 'js') {
    const el = document.createElement('div');
    el.className = 'js-out' + (result.error ? ' err' : '');
    el.textContent = result.error ? 'Error: ' + result.error : (result.output || '(no output)');
    appendToTurn(el);
    return;
  }

  if (ui === 'fetch' && result.body) {
    const el = document.createElement('div');
    el.className = 'fetch-out';
    el.textContent = 'HTTP ' + result.status + '\n' + result.body;
    appendToTurn(el);
    return;
  }

  if (ui === 'subagent' && result.summary) {
    const note = document.createElement('div');
    note.className = 'subagent-result';
    note.textContent = result.summary.slice(0, 300);
    appendToTurn(note);
  }
}



function renderDiffInline(path, diff, isNew) {
  const blk = document.createElement('div');
  blk.className = 'diff-blk';
  const fname = path.split('/').pop();
  let h = '<div class="diff-hd"><span class="diff-fn">' + esc(fname) + '</span><span class="diff-st">';
  if (isNew) h += '<span style="color:var(--teal)">new</span>';
  h += '<span class="diff-add-c">+' + diff.stats.add + '</span><span class="diff-del-c">-' + diff.stats.del + '</span></span></div>';
  blk.innerHTML = h;
  const body = document.createElement('div');
  body.style.padding = '3px 0';
  for (const line of diff.lines) {
    const el = document.createElement('div');
    if (line.t === 'gap') {
      el.className = 'diff-line gap';
      el.innerHTML = '<span class="diff-pfx">…</span><span style="color:var(--txt3);font-style:italic">unchanged</span>';
    } else {
      const cls = { add: 'add', del: 'del', ctx: 'ctx' }[line.t] || 'ctx';
      const pfx = { add: '+', del: '-', ctx: ' ' }[line.t] || ' ';
      el.className = 'diff-line ' + cls;
      el.innerHTML = '<span class="diff-pfx">' + pfx + '</span>' + esc(line.s || '');
    }
    body.appendChild(el);
  }
  blk.appendChild(body);
  appendToTurn(blk);
}

function addCondensedThought(text) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'border:1px solid var(--border2);border-radius:var(--r);overflow:hidden;margin:8px 0;max-width:640px;';

  // Header (clickable to toggle)
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,rgba(124,92,252,.12),rgba(91,164,245,.08));cursor:pointer;user-select:none;transition:background .2s;';
  header.onmouseenter = () => header.style.background = 'linear-gradient(135deg,rgba(124,92,252,.2),rgba(91,164,245,.14))';
  header.onmouseleave = () => header.style.background = 'linear-gradient(135deg,rgba(124,92,252,.12),rgba(91,164,245,.08))';

  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:8px;';
  left.innerHTML = '<span style="display:inline-flex;align-items:center;">' + ICONS.brain(16) + '</span><strong style="color:var(--purple);font-size:13px;margin-left:8px;">Thinking Deeper</strong>';

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:10px;color:var(--txt3);font-family:var(--mono);';
  hint.textContent = 'click to expand';
  const arrow = document.createElement('span');
  arrow.style.cssText = 'color:var(--purple);font-size:12px;transition:transform .25s ease;display:inline-block;';
  arrow.textContent = '\u25BC';
  right.append(hint, arrow);

  header.append(left, right);

  // Detail content (hidden by default)
  const detail = document.createElement('div');
  detail.style.cssText = 'display:none;border-top:1px solid var(--border);padding:12px 14px;background:var(--surf);max-height:400px;overflow-y:auto;';
  detail.innerHTML = renderRich(text);
  highlightAll(detail);

  // Toggle handler
  let expanded = false;
  header.onclick = () => {
    expanded = !expanded;
    detail.style.display = expanded ? 'block' : 'none';
    arrow.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
    hint.textContent = expanded ? 'click to collapse' : 'click to expand';
    if (expanded) scrollBot();
  };

  wrap.append(header, detail);
  appendToTurn(wrap);
}

// --- User message ------------------------------------------

export function addUserMsg(text, files) {
  document.getElementById('welcome')?.remove();
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg-user';
  const bub = document.createElement('div');
  bub.className = 'user-bub';
  bub.innerHTML = esc(text).replace(/@(\S+)/g, '<span class="fref">@$1</span>');
  if (files?.length) {
    const bar = document.createElement('div');
    bar.className = 'user-attach';
    for (const f of files) {
      const c = document.createElement('span');
      c.className = 'user-attach-chip';
      c.innerHTML = ICONS.paperclip(12) + ' <span>' + esc(f.name) + '</span>';
      bar.appendChild(c);
    }
    bub.appendChild(bar);
  }
  wrap.appendChild(bub);
  msgs.appendChild(wrap);
  scrollBot();
}

export function addErrBlock(msg) {
  if (!currentTurn) return;
  const el = document.createElement('div');
  el.className = 'err-blk';
  el.textContent = msg;
  currentTurn.appendChild(el);
  scrollBot();
}

export function addFinal(text) {
  if (!currentTurn) return;
  const el = document.createElement('div');
  el.className = 'final';
  el.innerHTML = '<div class="fdot"></div><div class="final-content">' + renderRich(text) + '</div>';
  highlightAll(el);
  currentTurn.appendChild(el);
  scrollBot();
}

// --- Status bar --------------------------------------------

export function updateStatusBar() {
  const p = document.getElementById('sb-path');
  if (p) p.textContent = S.cwd;
  const br = document.getElementById('sb-branch');
  if (br) {
    if (S.gitBranch) { br.textContent = '\u2442 ' + S.gitBranch; br.classList.remove('hide'); }
    else br.classList.add('hide');
  }
  const badge = document.getElementById('mode-badge');
  if (badge) { badge.textContent = S.mode.toUpperCase(); badge.className = S.mode; }
  const chip = document.getElementById('mode-chip');
  if (chip) { chip.textContent = S.mode.charAt(0).toUpperCase() + S.mode.slice(1); chip.className = 'top-chip ' + S.mode; }
  const modelEl = document.getElementById('sb-model');
  if (modelEl) modelEl.textContent = S.model;
}

export function updateCtxBar(pct) {
  if (pct !== undefined) S.ctxUsage = pct;
  const pctEl = document.getElementById('ctx-pct');
  const fillEl = document.getElementById('ctx-fill');
  if (pctEl) pctEl.textContent = (S.ctxUsage * 100).toFixed(1) + '%';
  if (fillEl) {
    fillEl.style.width = Math.min(S.ctxUsage * 100, 100) + '%';
    fillEl.style.backgroundPosition = (S.ctxUsage * 100) + '% center';
  }
}

export function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  updateStatusBar();
  import('./state.js').then(m => m.saveState());
  toast('Mode: ' + mode.toUpperCase());
}

export function setInput(enabled) {
  const inp = document.getElementById('prompt-inp');
  const btn = document.getElementById('send-btn');
  if (!inp || !btn) return;
  inp.disabled = !enabled;
  if (enabled) { btn.innerHTML = 'SEND&nbsp;\u21b5'; btn.className = ''; btn.disabled = false; }
  else { btn.innerHTML = '<div class="spin"></div>'; btn.className = 'stop'; btn.disabled = false; }
}



// --- File tree ---------------------------------------------

export async function updateFileTree(dir) {
  const el = document.getElementById('file-tree');
  if (!el) return;
  if (!S.fsMode) { el.innerHTML = '<div style="color:var(--txt3);font-size:10px;padding:3px">No workspace open</div>'; return; }
  try {
    const target = dir || S.cwd;
    const items = await fsList(target);
    el.innerHTML = '';
    const bc = document.createElement('div');
    bc.className = 'ftree-bc';
    const rootPath = S.fsMode === 'idb' ? 'idb://' + S.idbSess + '/' : '/';
    if (target !== rootPath) {
      const up = document.createElement('button');
      up.className = 'btn sm';
      up.textContent = '\u2191 ..';
      const parts = target.replace(/\/$/, '').split('/').filter(Boolean);
      parts.pop();
      const parentDir = parts.length ? rootPath + parts.join('/') + '/' : rootPath;
      up.onclick = () => updateFileTree(parentDir);
      bc.appendChild(up);
    }
    el.appendChild(bc);

    if (!items.length) {
      el.innerHTML += '<div style="color:var(--txt3);font-size:10px;padding:3px">Empty workspace</div>';
      return;
    }
    items.sort((a, b) => (a.type === 'dir' && b.type !== 'dir') ? -1 : (a.type !== 'dir' && b.type === 'dir') ? 1 : a.name.localeCompare(b.name));
    for (const it of items.slice(0, 80)) {
      const e = document.createElement('div');
      e.className = 'fitem' + (it.type === 'dir' ? ' dir' : '');
      const fileIconSvg = it.type === 'dir' ? ICONS.folder(12) : fileIcon(it.name, 12);
      e.innerHTML = '<span class="fitem-icon">' + fileIconSvg + '</span><span>' + esc(it.name) + '</span>';
      e.onclick = async () => {
        if (it.type === 'dir') {
          const newDir = S.fsMode === 'idb' ? S.cwd + it.name + '/' : it.name;
          await updateFileTree(newDir);
        } else {
          try {
            const p = it.path || (S.fsMode === 'idb' ? S.cwd + it.name : it.name);
            const c = await fsRead(p);
            showCodeBlk(it.name, c);
          } catch (er) { toast('Read error: ' + er.message); }
        }
      };
      el.appendChild(e);
    }
    if (items.length > 80) {
      const m = document.createElement('div');
      m.style.cssText = 'font-size:10px;color:var(--txt3);padding:3px 6px';
      m.textContent = '+' + (items.length - 80) + ' more';
      el.appendChild(m);
    }
  } catch (e) {
    el.innerHTML = '<div style="color:var(--red);font-size:10px;padding:3px">' + esc(e.message) + '</div>';
  }
}

// fileIcon is now imported from icons.js

function showCodeBlk(name, content) {
  document.getElementById('welcome')?.remove();
  const blk = document.createElement('div');
  blk.className = 'code-blk';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const lines = content.split('\n').length;
  blk.innerHTML = '<div class="code-hd"><span class="ch-fn">' + esc(name) + '</span><span>' + lines + ' lines</span></div>' +
    '<div class="code-body"><pre><code class="language-' + esc(ext) + '">' + esc(content) + '</code></pre></div>';
  if (typeof hljs !== 'undefined') hljs.highlightAllUnder(blk);
  document.getElementById('msgs')?.appendChild(blk);
  scrollBot();
}

// --- Sidebar sections --------------------------------------

export function renderTodos() {
  const el = document.getElementById('todo-ui');
  if (!el) return;
  const active = S.todos.filter(t => !t.done);
  if (!active.length) { el.innerHTML = '<div style="color:var(--txt3);font-size:10px;padding:3px">No active TODOs</div>'; return; }
  el.innerHTML = '';
  active.forEach(todo => {
    const li = document.createElement('div');
    li.className = 'todo-item';
    const cb = document.createElement('div');
    cb.className = 'todo-cb';
    cb.onclick = () => { todo.done = true; import('./state.js').then(m => m.saveState()); renderTodos(); };
    const txt = document.createElement('div');
    txt.className = 'todo-txt';
    txt.textContent = todo.text;
    li.append(cb, txt);
    el.appendChild(li);
  });
}

export function renderConvList() {
  const el = document.getElementById('conv-list');
  if (!el) return;
  el.innerHTML = '';
  for (const c of S.convs.slice(0, 30)) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === S.convId ? ' act' : '');
    item.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
    info.innerHTML = '<div class="conv-title">' + esc(c.title) + '</div><div class="conv-meta">' + new Date(c.modified).toLocaleDateString() + '</div>';
    info.onclick = () => loadConv(c.id);
    const delBtn = document.createElement('button');
    delBtn.className = 'ibtn';
    delBtn.style.cssText = 'width:20px;height:20px;opacity:0.4;flex-shrink:0;';
    delBtn.innerHTML = ICONS.trash(10);
    delBtn.title = 'Delete conversation';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Delete this conversation?')) {
        S.convs = S.convs.filter(x => x.id !== c.id);
        if (S.convId === c.id) newConv();
        import('./state.js').then(m => m.saveState());
        renderConvList();
      }
    };
    item.append(info, delBtn);
    el.appendChild(item);
  }
}

export function renderSessionList() {
  const el = document.getElementById('session-list');
  if (!el) return;
  el.innerHTML = '';
  if (!S.sessions.length) { el.innerHTML = '<div style="color:var(--txt3);font-size:10px;padding:3px">No sessions</div>'; return; }
  for (const s of S.sessions.slice(0, 20)) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (s.active ? ' act' : '');
    item.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
    const meta = s.size + ' files \u00b7 ' + (s.firstPrompt ? esc(s.firstPrompt.slice(0, 40)) + '\u2026' : new Date(s.created).toLocaleDateString());
    info.innerHTML = '<div class="conv-title">' + esc(s.displayName) + '</div><div class="conv-meta">' + meta + '</div>';
    info.onclick = async () => {
      const { switchWorkspace } = await import('./fs.js');
      await switchWorkspace(s.name);
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'ibtn';
    delBtn.style.cssText = 'width:20px;height:20px;opacity:0.4;flex-shrink:0;';
    delBtn.innerHTML = ICONS.trash(10);
    delBtn.title = 'Delete session';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete session "' + s.displayName + '"? This cannot be undone.')) {
        const { deleteSession } = await import('./fs.js');
        await deleteSession(s.name);
        renderSessionList();
        updateFileTree();
      }
    };
    item.append(info, delBtn);
    el.appendChild(item);
  }
}

export function renderMemoryList() {
  const el = document.getElementById('memory-list');
  if (!el) return;
  el.innerHTML = '';
  if (!S.memory.length) { el.innerHTML = '<div style="color:var(--txt3);font-size:10px;padding:3px">No saved memories</div>'; return; }
  for (const m of S.memory) {
    const item = document.createElement('div');
    item.classList.add('todo-item');
    item.innerHTML = '<div class="todo-txt" style="font-weight:600;color:var(--teal)">' + esc(m.key) + '</div><div class="todo-txt">' + esc(m.val.slice(0, 80)) + (m.val.length > 80 ? '\u2026' : '') + '</div>';
    el.appendChild(item);
  }
}



// --- Attach bar --------------------------------------------

export function renderAttachBar() {
  const bar = document.getElementById('attach-bar');
  if (!bar) return;
  bar.innerHTML = '';
  if (!S.files.length) { bar.classList.remove('has'); return; }
  bar.classList.add('has');
  S.files.forEach((f, i) => {
    const c = document.createElement('div');
    c.className = 'atch-chip';
    c.innerHTML = esc(f.name) + ' <button onclick="rmFile(' + i + ')">' + ICONS.x(10) + '</button>';
    bar.appendChild(c);
  });
}

window.rmFile = function(i) { S.files.splice(i, 1); renderAttachBar(); };

// --- Edit history and undo ----------------------------------

export function renderEditHistory() {
  const el = document.getElementById('edit-history');
  if (!el) return;
  el.innerHTML = '';
  if (!S.editHistory || !S.editHistory.length) {
    el.innerHTML = '<div style="color:var(--txt3);font-size:10px;padding:3px">No edit history</div>';
    return;
  }
  
  // Show last 10 edits
  const recent = S.editHistory.slice(-10).reverse();
  for (const edit of recent) {
    const item = document.createElement('div');
    item.className = 'todo-item';
    item.style.cssText = 'gap:6px;';
    
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    info.innerHTML = '<div class="todo-txt" style="font-weight:600;color:var(--teal)">' + esc(edit.path) + '</div>' +
      '<div class="todo-txt" style="opacity:0.6">' + edit.tool + ' at ' + new Date(edit.ts).toLocaleTimeString() + '</div>';
    
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn sm';
    undoBtn.innerHTML = ICONS.undo(10);
    undoBtn.title = 'Undo this edit';
    undoBtn.onclick = async () => {
      if (confirm('Revert ' + edit.path + ' to previous version?')) {
        try {
          const { fsWrite } = await import('./fs.js');
          await fsWrite(edit.path, edit.before);
          toast('Reverted: ' + edit.path);
          // Remove this edit from history
          const idx = S.editHistory.indexOf(edit);
          if (idx >= 0) S.editHistory.splice(idx, 1);
          await import('./state.js').then(m => m.saveState());
          renderEditHistory();
          updateFileTree();
        } catch (e) {
          toast('Undo failed: ' + e.message);
        }
      }
    };
    
    item.append(info, undoBtn);
    el.appendChild(item);
  }
}

// --- Conversation rewind ------------------------------------

export function renderRewindUI() {
  const el = document.getElementById('rewind-btn');
  if (!el) return;
  
  el.onclick = () => {
    if (!S.msgs.length) {
      toast('No messages to rewind');
      return;
    }
    
    // Find user messages to rewind to
    const userMsgs = S.msgs
      .map((m, i) => ({ msg: m, idx: i }))
      .filter(x => x.msg.role === 'user');
    
    if (userMsgs.length < 2) {
      toast('Need at least 2 user messages to rewind');
      return;
    }
    
    // Create modal to select rewind point
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-hd">
          <span>Rewind Conversation</span>
          <button class="modal-close">${ICONS.x(16)}</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--txt2);margin-bottom:10px;">Select a message to rewind to. All messages after this point will be removed.</p>
          <div class="rewind-options"></div>
        </div>
      </div>
    `;
    
    const options = modal.querySelector('.rewind-options');
    userMsgs.slice(0, -1).forEach((x, i) => {
      const opt = document.createElement('div');
      opt.className = 'conv-item';
      opt.style.cssText = 'cursor:pointer;margin-bottom:4px;';
      opt.innerHTML = '<div class="conv-title">' + esc(x.msg.content.slice(0, 80)) + (x.msg.content.length > 80 ? '...' : '') + '</div>' +
        '<div class="conv-meta">Message ' + (i + 1) + '</div>';
      opt.onclick = () => {
        if (confirm('Rewind to this message? This will remove messages after this point and may undo file edits.')) {
          // Use state.rewindToMessage to get edits that need undoing
          import('./state.js').then(async m => {
            const res = m.rewindToMessage(x.idx);
            if (!res || !res.trimmed) {
              toast('Rewind failed');
              return;
            }
            const edits = res.editsToUndo || [];
            if (edits.length) {
              const { fsWrite } = await import('./fs.js');
              for (const e of edits) {
                try {
                  await fsWrite(e.path, e.before);
                } catch (err) {
                  console.error('Failed to undo edit', e, err);
                }
              }
              toast('Reverted ' + edits.length + ' file edit(s) to match rewind point');
            }
            // Save conversation
            import('./app.js').then(m2 => m2.saveConv());
            // Reload conversation
            loadConv(S.convId);
            modal.remove();
            toast('Rewound to message ' + (i + 1));
          });
        }
      };
      options.appendChild(opt);
    });
    
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    document.body.appendChild(modal);
  };
}

export function updateUI() {
  updateStatusBar();
  renderTodos();
  renderConvList();
  renderSessionList();
  renderMemoryList();
  renderEditHistory();
  updateCtxBar();
  updateFileTree();
}

function loadConv(id) {
  const c = S.convs.find(function(x) { return x.id === id; });
  if (!c) return;
  S.convId = id;
  S.msgs = c.msgs;
  const msgs = document.getElementById('msgs');
  msgs.innerHTML = '';
  
  // Render all messages from history
  for (const m of S.msgs) {
    if (m.role === 'user') {
      addUserMsg(m.content, []);
    } else if (m.role === 'assistant' && m.content) {
      // Create a message container for assistant messages
      const turn = document.createElement('div');
      turn.className = 'msg-agent';
      const content = document.createElement('div');
      content.className = 'final';
      content.innerHTML = '<div class="fdot"></div><div class="md-wrap">' + renderRich(m.content) + '</div>';
      highlightAll(content);
      turn.appendChild(content);
      msgs.appendChild(turn);
    }
  }
  
  scrollBot();
  updateUI();
  toast('Loaded conversation');
}

export function newConv() {
  S.convId = null;
  S.msgs = [];
  S.pendingDiffs = [];
  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = '';
  updateUI();
}

export { loadConv };
