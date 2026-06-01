// ─────────────────────────────────────────────────────────────
// Per-turn diff buffer for multi-file review.
// When the agent's edit_file / write_file tools fire, the diffs
// are queued in S.pendingDiffs. The user opens the "Review N
// changes" chip and accepts/rejects per file.
// ─────────────────────────────────────────────────────────────

import { S } from './state.js';
import { Bus, esc } from './utils.js';
import { fsWrite } from './fs.js';

/**
 * Called by execTool when an edit completes. Adds to the buffer
 * and emits a 'review:update' so the UI can show the chip.
 */
export function recordPendingDiff({ path, before, after, diff, isNew }) {
  // If the same path was edited twice in one turn, merge the
  // "before" with the previous "after" so the user sees the
  // net change.
  const existing = S.pendingDiffs.findIndex(d => d.path === path);
  if (existing >= 0) {
    S.pendingDiffs[existing].after = after;
    S.pendingDiffs[existing].diff = diff;
  } else {
    S.pendingDiffs.push({ id: Math.random().toString(36).slice(2, 9), path, before, after, diff, isNew, resolved: null });
  }
  Bus.emit('review:update', S.pendingDiffs);
}

export function clearPendingDiffs() {
  S.pendingDiffs = [];
  Bus.emit('review:update', []);
}

export function resolvePendingDiff(id, decision) {
  // decision: 'accept' | 'reject'
  const d = S.pendingDiffs.find(x => x.id === id);
  if (!d) return;
  d.resolved = decision;
  if (decision === 'reject') {
    // Restore the before content.
    fsWrite(d.path, d.before).catch(() => {});
  }
  Bus.emit('review:update', S.pendingDiffs);
}

export function openReviewModal() {
  if (S.pendingDiffs.length === 0) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  const files = S.pendingDiffs.map(d => `
    <div class="review-file" data-id="${d.id}">
      <div class="review-hd">
        <span class="review-fn">${esc(d.path)}</span>
        ${d.isNew ? '<span class="review-new">new</span>' : ''}
        <span class="review-add">+${d.diff.stats.add}</span>
        <span class="review-del">-${d.diff.stats.del}</span>
        <div class="review-acts">
          <button class="btn sm prim" data-act="accept">Accept</button>
          <button class="btn sm" data-act="reject">Reject</button>
        </div>
      </div>
      <div class="review-body">
        ${d.diff.lines.slice(0, 30).map(line => {
          if (line.t === 'gap') return '<div class="diff-line gap"><span class="diff-pfx">…</span>unchanged</div>';
          const cls = { add: 'add', del: 'del', ctx: 'ctx' }[line.t] || 'ctx';
          const pfx = { add: '+', del: '-', ctx: ' ' }[line.t] || ' ';
          return `<div class="diff-line ${cls}"><span class="diff-pfx">${pfx}</span>${esc(line.s || '')}</div>`;
        }).join('')}
        ${d.diff.lines.length > 30 ? `<div class="diff-line gap">… ${d.diff.lines.length - 30} more lines</div>` : ''}
      </div>
    </div>
  `).join('');

  const allAccepted = S.pendingDiffs.every(d => d.resolved === 'accept');
  const allRejected = S.pendingDiffs.every(d => d.resolved === 'reject');
  modal.innerHTML = `<div class="modal modal-lg">
    <div class="modal-hd">
      <span>Review ${S.pendingDiffs.length} change${S.pendingDiffs.length === 1 ? '' : 's'}</span>
      <button class="modal-close">×</button>
    </div>
    <div class="modal-body">${files}</div>
    <div class="modal-ft">
      <button class="btn" id="rv-all-accept">Accept all</button>
      <button class="btn" id="rv-all-reject">Reject all</button>
      <button class="btn prim" id="rv-done">Done</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // dismiss: just close modal, keep buffer (user might review later)
  const dismiss = () => { modal.remove(); };
  // finish: close modal AND clear buffer (user has finished reviewing)
  const finish = () => { modal.remove(); clearPendingDiffs(); };
  
  modal.querySelector('.modal-close').onclick = dismiss;
  modal.onclick = e => { if (e.target === modal) dismiss(); };

  modal.querySelectorAll('.review-file').forEach(file => {
    const id = file.dataset.id;
    file.querySelector('[data-act=accept]').onclick = () => {
      resolvePendingDiff(id, 'accept');
      file.classList.add('resolved-accept');
    };
    file.querySelector('[data-act=reject]').onclick = () => {
      resolvePendingDiff(id, 'reject');
      file.classList.add('resolved-reject');
    };
  });

  modal.querySelector('#rv-all-accept').onclick = () => {
    S.pendingDiffs.forEach(d => { if (!d.resolved) resolvePendingDiff(d.id, 'accept'); });
    finish();
  };
  modal.querySelector('#rv-all-reject').onclick = () => {
    S.pendingDiffs.forEach(d => { if (!d.resolved) resolvePendingDiff(d.id, 'reject'); });
    finish();
  };
  modal.querySelector('#rv-done').onclick = finish;
}
