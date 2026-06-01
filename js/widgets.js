// ─────────────────────────────────────────────────────────────
// Reusable input widgets: clarify (free-form) + simple_question
// (multiple choice). Used by the tool executor.
// ─────────────────────────────────────────────────────────────

export function makeClarifyWidget(question, onSubmit) {
  const w = document.createElement('div'); w.className = 'clr-widget';
  const q = document.createElement('div'); q.className = 'clr-q'; q.textContent = question;
  const hint = document.createElement('div'); hint.className = 'clr-hint'; hint.textContent = 'Type your response below.';
  const inp = document.createElement('textarea'); inp.className = 'clr-inp'; inp.rows = 2; inp.placeholder = 'Your answer...';
  const acts = document.createElement('div'); acts.className = 'clr-acts';
  const sub = document.createElement('button'); sub.className = 'btn prim sm'; sub.textContent = 'Submit';
  const go = () => {
    const v = inp.value.trim();
    if (!v) return;
    inp.disabled = sub.disabled = true;
    onSubmit(v);
  };
  sub.onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); };
  acts.appendChild(sub);
  w.append(q, hint, inp, acts);
  setTimeout(() => inp.focus(), 80);
  return w;
}

export function makeSQWidget(question, options, onSelect) {
  const w = document.createElement('div'); w.className = 'sq-widget';
  const q = document.createElement('div'); q.className = 'sq-q'; q.textContent = question;
  const opts = document.createElement('div'); opts.className = 'sq-opts';
  for (const opt of options) {
    const b = document.createElement('button');
    b.className = 'sq-opt';
    b.textContent = opt;
    b.onclick = () => {
      w.querySelectorAll('.sq-opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      setTimeout(() => {
        w.querySelectorAll('.sq-opt, .sq-other-inp').forEach(x => x.disabled = true);
        onSelect(opt);
      }, 280);
    };
    opts.appendChild(b);
  }
  const ob = document.createElement('button');
  ob.className = 'sq-opt';
  ob.textContent = 'Other…';
  const otherInp = document.createElement('input');
  otherInp.className = 'sq-other-inp';
  otherInp.placeholder = 'Type answer…';
  otherInp.style.display = 'none';
  ob.onclick = () => { otherInp.style.display = 'block'; otherInp.focus(); };
  otherInp.onkeydown = e => {
    if (e.key === 'Enter') {
      const v = otherInp.value.trim();
      if (v) {
        w.querySelectorAll('.sq-opt').forEach(x => x.disabled = true);
        otherInp.disabled = true;
        onSelect(v);
      }
    }
  };
  opts.appendChild(ob);
  w.append(q, opts, otherInp);
  return w;
}
