/* Offbeat — spell checking: live underlines, right-click fixes, and the F7 review */
(function () {
  'use strict';
  const App = window.App, cm = App.cm, F = window.Fountain;
  const host = window.host;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
  const cache = new Map();       // word -> true (ok) | false (misspelled)
  const pending = new Set();
  const ignored = new Set();     // "Ignore in this script" (lowercased)
  let names = new Set();         // words from character cues, ignored automatically
  let enabled = true;
  let overlayOn = false;

  if (!host || !host.spellCheck) { window.Spell = { enabled: false }; return; }

  const norm = (w) => w.replace(/’/g, "'");

  /* Mask text that shouldn't be checked (keeps positions intact). */
  function maskLine(text, type) {
    const blank = (m) => ' '.repeat(m.length);
    let t = text
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, blank)              // emails
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, blank)               // urls
      .replace(/\/\*.*?(\*\/|$)/g, blank)                            // boneyard
      .replace(/\[\[\s*COLOR\s+[^\]]*\]\]/gi, blank)                 // color notes
      .replace(/#[\w.\-]+#\s*$/, blank);                             // scene numbers
    if (type === 'title') t = t.replace(/^[A-Za-z][^:]*:/, blank);  // title page keys
    return t;
  }

  function lineWords(text, type) {
    const out = [];
    if (type === 'boneyard') return out;
    const t = maskLine(text, type);
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(t))) {
      const w = m[0];
      if (w.length < 2 || /\d/.test(w)) continue;
      out.push({ word: w, start: m.index, end: m.index + w.length });
    }
    return out;
  }

  function status(word) {
    const n = norm(word);
    const low = n.toLowerCase();
    if (ignored.has(low) || names.has(n.toUpperCase())) return true;
    const c = cache.get(n);
    if (c === undefined) { pending.add(n); scheduleCheck(); return true; }
    return c;
  }

  let checkTimer = null;
  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runCheck, 120);
  }
  async function runCheck() {
    if (!pending.size) return;
    const words = Array.from(pending); pending.clear();
    const bad = new Set(await host.spellCheck(words));
    let changed = false;
    for (const w of words) { const ok = !bad.has(w); cache.set(w, ok); if (!ok) changed = true; }
    if (changed) refresh();
  }

  function refreshNames() {
    const p = App.parsed; if (!p) return;
    const s = new Set();
    for (const L of p.lines) if (L.type === 'character') for (const w of (L.name || '').split(/[^\p{L}'’]+/u)) if (w) s.add(norm(w).toUpperCase());
    const before = Array.from(names).join('|'), after = Array.from(s).join('|');
    names = s;
    if (before !== after) refresh();
  }

  /* CodeMirror overlay that underlines misspelled words */
  const overlay = {};
  // StringStream objects are reused per line, so cache ranges by line text instead.
  const rangeCache = new Map();
  overlay.token = function (stream) {
    const lineNo = stream.lineOracle && typeof stream.lineOracle.line === 'number' ? stream.lineOracle.line : -1;
    const L = App.parsed && lineNo >= 0 ? App.parsed.lines[lineNo] : null;
    const type = L ? L.type : 'action';
    const key = type + '\u0000' + stream.string;
    let ranges = rangeCache.get(key);
    if (!ranges || stream.sol()) {
      ranges = lineWords(stream.string, type).filter(w => !status(w.word));
      rangeCache.set(key, ranges);
      if (rangeCache.size > 4000) rangeCache.clear();
    }
    const pos = stream.pos;
    for (const r of ranges) {
      if (pos >= r.start && pos < r.end) { stream.pos = r.end; return 'spell-error'; }
      if (r.start > pos) { stream.pos = r.start; return null; }
    }
    stream.skipToEnd();
    return null;
  };

  function refresh() {
    rangeCache.clear();
    if (overlayOn) { cm.removeOverlay(overlay); cm.addOverlay(overlay); }
  }
  function setEnabled(on) {
    enabled = on;
    if (on && !overlayOn) { cm.addOverlay(overlay); overlayOn = true; }
    if (!on && overlayOn) { cm.removeOverlay(overlay); overlayOn = false; }
  }

  App.on('parse', refreshNames);
  App.on('prefs', (p) => setEnabled(p.spellcheck !== false));
  host.on('spell-changed', (info) => {
    if (info && info.added) {
      const low = info.added.toLowerCase();
      for (const k of cache.keys()) if (k.toLowerCase() === low) cache.set(k, true);
      cache.set(info.added, true);
      refresh();
    } else { cache.clear(); checkAll().then(refresh); }
  });

  /* Case-matching replacement */
  function matchCase(orig, rep) {
    if (orig === orig.toUpperCase() && /\p{L}/u.test(orig) && orig.length > 1) return rep.toUpperCase();
    if (orig[0] === orig[0].toUpperCase() && orig.slice(1) === orig.slice(1).toLowerCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
  }

  function wordAt(pos) {
    const L = App.parsed ? App.parsed.lines[pos.line] : null;
    const words = lineWords(cm.getLine(pos.line), L ? L.type : 'action');
    return words.find(w => pos.ch >= w.start && pos.ch <= w.end) || null;
  }

  /* Right-click: suggestions in a native menu */
  cm.getWrapperElement().addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
    const w = enabled ? wordAt(pos) : null;
    const bad = w && !status(w.word);
    const suggestions = bad ? await host.spellSuggest(norm(w.word)) : [];
    const res = await host.spellMenu({ word: bad ? w.word : null, suggestions, hasSelection: cm.somethingSelected() });
    if (!res || !bad) return;
    if (res.action === 'replace') {
      cm.replaceRange(matchCase(w.word, res.value), { line: pos.line, ch: w.start }, { line: pos.line, ch: w.end }, '+spell');
    } else if (res.action === 'add') {
      await host.spellAdd(norm(w.word));
    } else if (res.action === 'ignore') {
      ignored.add(norm(w.word).toLowerCase()); refresh();
    }
    cm.focus();
  }, true);

  /* ---------- F7: review every misspelling ---------- */
  async function checkAll() {
    App.ensureParsed();
    const words = new Set();
    cm.eachLine(h => { const n = cm.getLineNumber(h); const L = App.parsed.lines[n]; for (const w of lineWords(h.text, L ? L.type : 'action')) { const k = norm(w.word); if (!cache.has(k)) words.add(k); } });
    if (words.size) {
      const list = Array.from(words);
      const bad = new Set(await host.spellCheck(list));
      for (const w of list) cache.set(w, !bad.has(w));
    }
  }

  function occurrences() {
    const out = [];
    const n = cm.lineCount();
    for (let i = 0; i < n; i++) {
      const L = App.parsed.lines[i];
      for (const w of lineWords(cm.getLine(i), L ? L.type : 'action')) if (!status(w.word)) out.push({ line: i, ch: w.start, end: w.end, word: w.word });
    }
    return out;
  }

  async function reviewDialog() {
    if (!$('modal-backdrop').hidden) return;
    await checkAll();
    const skipped = new Set();
    let from = cm.getCursor('from');
    let wrapped = false;
    const startPos = { line: from.line, ch: from.ch };

    const m = document.getElementById('modal');
    m.className = '';
    $('modal-backdrop').hidden = false;
    $('modal-backdrop').classList.add('spelling');

    const close = () => { m.onclick = null; m.onkeydown = null; App.closeModal(); };

    const next = () => {
      App.ensureParsed();
      const all = occurrences().filter(o => !skipped.has(`${o.line}:${o.ch}:${o.word}`));
      const after = all.filter(o => o.line > from.line || (o.line === from.line && o.ch >= from.ch));
      let cur = after[0];
      if (!cur && !wrapped) { wrapped = true; cur = all.find(o => o.line < startPos.line || (o.line === startPos.line && o.ch < startPos.ch)); }
      else if (cur && wrapped && (cur.line > startPos.line || (cur.line === startPos.line && cur.ch >= startPos.ch))) cur = null;
      return { cur, remaining: all.length };
    };

    const render = async () => {
      const { cur, remaining } = next();
      if (!cur) {
        m.innerHTML = `<div class="m-head"><h2>Spelling</h2></div>
          <div class="m-body"><p class="sp-done">${remaining ? 'You’ve reviewed every flagged word.' : 'No spelling mistakes found.'}</p></div>
          <div class="m-foot"><button class="btn primary" data-x="close">Done</button></div>`;
        m.onkeydown = null;
        m.onclick = (e) => { if (e.target.closest('[data-x=close]')) close(); };
        m.querySelector('[data-x=close]').focus();
        return;
      }
      cm.setSelection({ line: cur.line, ch: cur.ch }, { line: cur.line, ch: cur.end });
      cm.scrollIntoView({ from: { line: cur.line, ch: cur.ch }, to: { line: cur.line, ch: cur.end } }, 160);
      const text = cm.getLine(cur.line);
      const a = Math.max(0, cur.ch - 70), b = Math.min(text.length, cur.end + 70);
      const ctx = (a > 0 ? '…' : '') + esc(text.slice(a, cur.ch)) + `<mark>${esc(cur.word)}</mark>` + esc(text.slice(cur.end, b)) + (b < text.length ? '…' : '');
      const sugg = (await host.spellSuggest(norm(cur.word))).map(s => matchCase(cur.word, s));
      const sameWord = occurrences().filter(o => o.word.toLowerCase() === cur.word.toLowerCase()).length;
      m.innerHTML = `<div class="m-head"><h2>Spelling</h2><span class="sp-count">${remaining} to review</span></div>
        <div class="m-body">
          <div class="sp-context">${ctx}</div>
          <div class="field"><label for="sp-to">Change to</label><input id="sp-to" value="${esc(sugg[0] || cur.word)}" spellcheck="false"></div>
          <div class="field"><label>Suggestions</label><div class="sp-sugg">${sugg.length ? sugg.map(s => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('') : '<span class="hint">No suggestions</span>'}</div></div>
        </div>
        <div class="m-foot sp-foot">
          <button class="btn" data-x="add">Add to dictionary</button>
          <button class="btn" data-x="ignore">Ignore all</button>
          <span class="spacer"></span>
          <button class="btn" data-x="skip">Skip</button>
          ${sameWord > 1 ? `<button class="btn" data-x="all">Change all (${sameWord})</button>` : ''}
          <button class="btn primary" data-x="change">Change</button>
        </div>`;
      const input = $('sp-to');
      input.focus(); input.select();
      m.onkeydown = (e) => { if (e.key === 'Enter' && e.target === input) { e.preventDefault(); act('change', cur); } };
      m.onclick = (e) => {
        const chip = e.target.closest('[data-s]');
        if (chip) { input.value = chip.dataset.s; if (e.detail === 2) act('change', cur); input.focus(); return; }
        const b = e.target.closest('[data-x]'); if (b) act(b.dataset.x, cur);
      };
    };

    const act = async (what, cur) => {
      if (what === 'close') return close();
      if (!cur) return;
      const to = ($('sp-to') || {}).value;
      if (what === 'skip') { skipped.add(`${cur.line}:${cur.ch}:${cur.word}`); from = { line: cur.line, ch: cur.end }; }
      else if (what === 'ignore') { ignored.add(norm(cur.word).toLowerCase()); refresh(); from = { line: cur.line, ch: cur.end }; }
      else if (what === 'add') { await host.spellAdd(norm(cur.word)); cache.set(norm(cur.word), true); from = { line: cur.line, ch: cur.end }; }
      else if (what === 'change' && to) {
        cm.replaceRange(to, { line: cur.line, ch: cur.ch }, { line: cur.line, ch: cur.end }, '+spell');
        from = { line: cur.line, ch: cur.ch + to.length };
        await checkAll();
      } else if (what === 'all' && to) {
        const low = cur.word.toLowerCase();
        const occ = occurrences().filter(o => o.word.toLowerCase() === low).reverse();
        cm.operation(() => occ.forEach(o => cm.replaceRange(o.word === cur.word ? to : matchCase(o.word, to), { line: o.line, ch: o.ch }, { line: o.line, ch: o.end }, '+spell')));
        from = { line: cur.line, ch: cur.ch + to.length };
        await checkAll();
      }
      render();
    };

    await render();
  }

  App.viewCommands = App.viewCommands || {};
  App.viewCommands.spelling = reviewDialog;
  window.Spell = { status, refresh, checkAll, occurrences, ignored, cache, setEnabled, get enabled() { return enabled; } };
})();
