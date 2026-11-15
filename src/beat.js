/*
 * Offbeat — Beat's document data in the editor
 * Revisions, review notes, production tags and line alternatives live as marks in the
 * text (CodeMirror text markers), so they move with the words as you edit. On save they
 * are written back into Beat's data block with fresh offsets (core/beatdoc.js).
 *
 * Changing marks is done by rewriting the affected text with itself: CodeMirror keeps
 * the old marks in its undo history, so Ctrl+Z undoes adding a tag or a note too.
 */
(function () {
  'use strict';
  const App = window.App, cm = App.cm, BD = window.BeatDoc, F = window.Fountain;
  const K = BD.KEYS;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m) => window.toast(m);
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  })).toUpperCase();
  const tagType = (key) => BD.TAG_TYPES.find(t => t.key === key) || BD.TAG_TYPES[BD.TAG_TYPES.length - 1];

  let seq = 0;   // creation order: where marks of one kind overlap, the newer one wins

  /* ---------------- Marks ---------------- */
  function markOptions(b) {
    switch (b.k) {
      case 'rev': {
        const g = BD.GENERATIONS[b.gen] || BD.GENERATIONS[0];
        return { className: `bt-rev bt-g${b.gen}${b.type === 'RemovalSuggestion' ? ' bt-remove' : ''}`,
          attributes: { title: b.type === 'RemovalSuggestion' ? `Suggested for removal (${g.label} revision)` : `${g.label} revision` } };
      }
      case 'review': return { className: 'bt-review', attributes: { title: 'Note: ' + b.text } };
      case 'tag': { const t = tagType(b.type); return { className: 'bt-tag bt-tag-' + t.key, attributes: { title: `${t.label}: ${b.def.name}` } }; }
      // Stretches over its whole line whatever you type there, so retyping the line keeps its versions.
      case 'alt': return { className: 'bt-alt', inclusiveLeft: true, inclusiveRight: true, clearWhenEmpty: false };
    }
    return {};
  }
  function addMark(doc, from, to, b) {
    if (typeof from === 'number') from = doc.posFromIndex(from);
    if (typeof to === 'number') to = doc.posFromIndex(to);
    const data = Object.assign({}, b);
    if (data.seq == null) data.seq = ++seq; else seq = Math.max(seq, data.seq);
    const o = markOptions(data);
    o.beat = data;
    return doc.markText(from, to, o);
  }
  function marksOf(doc, kind) { return doc.getAllMarks().filter(m => m.beat && (!kind || m.beat.k === kind)); }
  function rangeOf(m) { const r = m.find(); return r && r.from ? r : null; }
  const cmp = CodeMirror.cmpPos;
  const minPos = (a, b) => cmp(a, b) <= 0 ? a : b;
  const maxPos = (a, b) => cmp(a, b) >= 0 ? a : b;

  /*
   * Change marks over a stretch of text in one undoable step.
   * `edit(from, to, kept)` gets the range and the marks that touched it (now gone or cut) and adds new ones.
   * kinds: which kinds of marks the edit replaces — their extents widen the range so none are left half-cut.
   */
  function rewrite(from, to, kinds, edit) {
    const doc = cm.getDoc();
    // Widen to whole marks of the kinds being changed.
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of doc.findMarks(from, to)) {
        if (!m.beat || !kinds.includes(m.beat.k)) continue;
        const r = rangeOf(m); if (!r) continue;
        if (cmp(r.from, from) < 0) { from = r.from; changed = true; }
        if (cmp(r.to, to) > 0) { to = r.to; changed = true; }
      }
    }
    const touched = doc.findMarks(from, to).filter(m => m.beat).map(m => ({ m, r: rangeOf(m), b: m.beat })).filter(x => x.r);
    const sels = doc.listSelections();
    const text = doc.getRange(from, to);
    doc.changeGeneration(true);   // its own undo step
    cm.operation(() => {
      doc.replaceRange(text, from, to, '+beat');
      // Put back what the rewrite cut, except the kinds the edit is replacing.
      for (const t of touched) {
        const a = maxPos(t.r.from, from), z = minPos(t.r.to, to);
        if (kinds.includes(t.b.k) || cmp(a, z) >= 0) continue;
        const now = rangeOf(t.m);
        if (now && cmp(now.from, a) <= 0 && cmp(now.to, z) >= 0) continue;   // still covers it
        addMark(doc, a, z, t.b);
      }
      edit(from, to, touched.filter(t => kinds.includes(t.b.k)));
      doc.setSelections(sels, undefined, { scroll: false });
    });
    doc.changeGeneration(true);
    App.resetMarks();
    refreshDecor();
  }

  function selectionRange() {
    const s = cm.getDoc().listSelections()[0];
    const from = minPos(s.anchor, s.head), to = maxPos(s.anchor, s.head);
    return { from, to, empty: cmp(from, to) === 0 };
  }

  /* ---------------- Loading & saving ---------------- */
  App.beatAttach = function (tab, info) {
    const doc = tab.doc;
    tab.beat = { settings: info.settings, raw: info.raw, hadBlock: info.hadBlock };
    const s = info.settings;
    const len = doc.getValue().length;
    if (s) {
      for (const r of BD.revisionsFromSettings(s[K.revisions], len)) addMark(doc, r.from, r.to, { k: 'rev', type: r.type, gen: r.gen });
      for (const r of BD.reviewsFromSettings(s[K.reviews], len)) addMark(doc, r.from, r.to, { k: 'review', text: r.text });
      for (const t of BD.tagsFromSettings(s[K.tags], s[K.tagDefinitions], len)) addMark(doc, t.from, t.to, { k: 'tag', type: t.type, def: t.def });
    }
    for (const a of info.alts) {
      if (a.line >= doc.lineCount()) continue;
      addMark(doc, { line: a.line, ch: 0 }, { line: a.line, ch: doc.getLine(a.line).length }, { k: 'alt', raw: a.raw });
    }
  };

  /* Where Beat left the caret, for a script opened here for the first time. */
  App.beatCaret = function (tab) {
    const s = tab && tab.beat && tab.beat.settings;
    const c = s ? parseInt(s[K.caret], 10) : NaN;
    if (!(c > 0)) return null;
    const p = tab.doc.posFromIndex(c);
    return { line: p.line, ch: p.ch };
  };

  /* Line alternatives attach to the line their mark starts on; one per line. */
  function altMarksByLine(doc) {
    const out = new Map();
    for (const m of marksOf(doc, 'alt')) {
      const line = altLine(doc, m);
      if (line == null) continue;
      const prev = out.get(line);
      if (!prev || prev.beat.seq < m.beat.seq) out.set(line, m);
    }
    return out;
  }
  /* The line an alternatives mark belongs to. The mark can stretch over a line break typed at
     either end of its line; then it's the line that looks most like the version last stored. */
  function altLine(doc, m) {
    const r = rangeOf(m);
    if (!r || cmp(r.from, r.to) === 0) return null;   // its text was deleted
    let last = r.to.line;
    if (last > r.from.line && r.to.ch === 0) last--;
    if (last === r.from.line) return r.from.line;
    const data = BD.parseAlternative(m.beat.raw);
    const want = data && data.versions[data.current | 0] ? String(data.versions[data.current | 0].text || '') : '';
    let best = r.from.line, score = -1;
    for (let ln = r.from.line; ln <= last; ln++) {
      const t = doc.getLine(ln);
      if (!t.trim()) continue;
      let p = 0; while (p < t.length && p < want.length && t[p] === want[p]) p++;
      let q = 0; while (q < t.length - p && q < want.length - p && t[t.length - 1 - q] === want[want.length - 1 - q]) q++;
      const sc = t === want ? 1e9 : p + q;
      if (sc > score) { score = sc; best = ln; }
    }
    return best;
  }

  /* Revisions on one line, in Beat's per-line form: { generation: [[loc, len], ...] } (additions only). */
  function lineRevisions(doc, line) {
    const len = doc.getLine(line).length;
    const marks = [];
    for (const m of doc.findMarks({ line, ch: 0 }, { line, ch: len })) {
      if (!m.beat || m.beat.k !== 'rev' || m.beat.type !== 'Addition') continue;
      const r = rangeOf(m);
      const a = r.from.line < line ? 0 : r.from.ch, z = r.to.line > line ? len : r.to.ch;
      if (z > a) marks.push({ from: a, to: z, seq: m.beat.seq, key: String(m.beat.gen), value: m.beat.gen });
    }
    const out = {};
    for (const f of BD.flatten(marks)) (out[f.value] = out[f.value] || []).push([f.from, f.to - f.from]);
    return out;
  }

  /* The alternatives block for a line, with its current version updated to what the line says now. */
  function altRawFor(doc, line, m) {
    const data = BD.parseAlternative(m.beat.raw);
    if (!data) return m.beat.raw;
    const cur = Math.max(0, Math.min(data.versions.length - 1, data.current | 0));
    const text = doc.getLine(line);
    const revisions = lineRevisions(doc, line);
    const v = data.versions[cur] || {};
    if (v.text === text && JSON.stringify(v.revisions || {}) === JSON.stringify(revisions)) return m.beat.raw;
    data.versions[cur] = Object.assign({}, v, { text, revisions });
    data.current = cur;
    return BD.formatAlternative(data);
  }

  App.beatSerialize = function (tab) {
    const doc = tab.doc, b = tab.beat || {};
    const body = doc.getValue();
    const revs = [], reviews = [], tags = [];
    for (const m of marksOf(doc)) {
      if (m.beat.k === 'alt') continue;
      const r = rangeOf(m); if (!r) continue;
      const from = doc.indexFromPos(r.from), to = doc.indexFromPos(r.to);
      if (to <= from) continue;
      const x = Object.assign({ from, to }, m.beat);
      if (m.beat.k === 'rev') revs.push(x); else if (m.beat.k === 'review') reviews.push(x); else if (m.beat.k === 'tag') tags.push(x);
    }
    const alts = [];
    for (const [line, m] of altMarksByLine(doc)) alts.push({ line, raw: altRawFor(doc, line, m) });
    alts.sort((a, c) => a.line - c.line);

    let settings = b.settings ? Object.assign({}, b.settings) : null;
    const hasData = revs.length || reviews.length || tags.length || alts.length;
    if (!settings && hasData) settings = {};
    if (settings) {
      const full = b.hadBlock || hasData;
      if (full || K.revisions in settings) settings[K.revisions] = BD.revisionsForSaving(revs);
      if (full || K.reviews in settings) settings[K.reviews] = BD.reviewsForSaving(reviews);
      if (full || K.tags in settings) { const t = BD.tagsForSaving(tags); settings[K.tags] = t.tags; settings[K.tagDefinitions] = t.defs; }
      if (b.hadBlock || K.caret in settings) settings[K.caret] = doc.indexFromPos(doc.getCursor());
      if (K.headingUUIDs in settings) {
        const parsed = F.parse(body);
        const strings = parsed.lines.filter(l => l.type === 'heading' || l.type === 'section').map(l => l.raw);
        settings[K.headingUUIDs] = BD.headingUUIDs(settings[K.headingUUIDs], strings, uuid);
        b.settings[K.headingUUIDs] = settings[K.headingUUIDs];   // keep new identifiers stable between saves
      }
    }
    return BD.write(body, settings, alts, settings ? null : b.raw);
  };

  /* ---------------- Keeping marks when whole lines move (index cards) ---------------- */
  /*
   * Run `apply`, which replaces old lines with new ones. Marks on lines that come through
   * unchanged are put back where those lines end up. `origin[k]` says which old line new line k
   * came from; without it, lines are matched by their text, in order.
   */
  App.keepMarks = function (oldLines, newLines, origin, apply) {
    const doc = cm.getDoc();
    const snaps = marksOf(doc).map(m => ({ m, r: rangeOf(m) })).filter(s => s.r);
    if (!snaps.length) { apply(); return; }
    let map;   // old line → new line
    if (origin) {
      map = new Map();
      origin.forEach((o, k) => { if (o >= 0 && oldLines[o] === newLines[k]) map.set(o, k); });
    } else {
      let p = 0; while (p < oldLines.length && p < newLines.length && oldLines[p] === newLines[p]) p++;
      let s = 0; while (s < oldLines.length - p && s < newLines.length - p && oldLines[oldLines.length - 1 - s] === newLines[newLines.length - 1 - s]) s++;
      map = new Map();
      for (let k = 0; k < p; k++) map.set(k, k);
      for (let k = 0; k < s; k++) map.set(oldLines.length - 1 - k, newLines.length - 1 - k);
      let j = p;
      for (let i = p; i < oldLines.length - s; i++) {
        for (let q = j; q < newLines.length - s && q < j + 200; q++) {
          if (newLines[q] === oldLines[i]) { map.set(i, q); j = q + 1; break; }
        }
      }
    }
    apply();
    cm.operation(() => {
      for (const s of snaps) {
        const now = rangeOf(s.m);
        if (now && now.from.line === map.get(s.r.from.line) && now.to.line === map.get(s.r.to.line) && now.from.ch === s.r.from.ch && now.to.ch === s.r.to.ch) continue;
        const a = map.get(s.r.from.line), z = map.get(s.r.to.line);
        if (a == null || z == null || z - a !== s.r.to.line - s.r.from.line) continue;
        if (now) continue;   // kept by the editor (outside the replaced lines)
        addMark(doc, { line: a, ch: s.r.from.ch }, { line: z, ch: s.r.to.ch }, s.m.beat);
      }
    });
    refreshDecor();
  };

  /* ---------------- Settings stored with the script ---------------- */
  function settingsFor(tab, create) {
    tab = tab || App.active; if (!tab) return null;
    if (!tab.beat) tab.beat = { settings: null, raw: null, hadBlock: false };
    if (!tab.beat.settings && create) tab.beat.settings = {};
    return tab.beat.settings;
  }
  const revisionMode = () => { const s = settingsFor(); return !!(s && s[K.revisionMode]); };
  const revisionLevel = () => { const s = settingsFor(); const n = s ? parseInt(s[K.revisionLevel], 10) : 0; return n >= 0 && n < BD.GENERATIONS.length ? n : 0; };

  /* Which characters are revised, line by line, for the printed margin marks. */
  App.beatPrintExtras = function (tab) {
    tab = tab || App.active;
    if (!tab || !tab.doc) return {};
    const doc = tab.doc;
    const hidden = BD.hiddenRevisions(tab.beat && tab.beat.settings);
    const revisions = new Map();
    for (const m of marksOf(doc, 'rev')) {
      if (hidden.has(m.beat.gen)) continue;
      const r = rangeOf(m); if (!r) continue;
      for (let ln = r.from.line; ln <= r.to.line; ln++) {
        const len = doc.getLine(ln).length;
        const a = ln === r.from.line ? r.from.ch : 0, z = ln === r.to.line ? r.to.ch : len;
        if (z <= a) continue;
        let arr = revisions.get(ln);
        if (!arr) { arr = new Int8Array(len).fill(-1); revisions.set(ln, arr); }
        for (let k = a; k < z && k < len; k++) if (m.beat.gen > arr[k]) arr[k] = m.beat.gen;
      }
    }
    return revisions.size ? { revisions } : {};
  };

  /* ---------------- Revision mode: what you type is marked as revised ---------------- */
  const UNTRACKED = new Set(['setValue', 'undo', 'redo', '+beat', '+move']);
  cm.on('change', (cm, ch) => {
    if (!revisionMode() || UNTRACKED.has(ch.origin)) return;
    const inserted = ch.text.join('\n');
    if (!inserted.replace(/\n/g, '')) return;
    const doc = cm.getDoc();
    const from = ch.from, to = CodeMirror.changeEnd(ch);
    const gen = revisionLevel();
    // Grow the revision you're typing at the end of instead of adding one mark per keystroke.
    let start = from;
    for (const m of doc.findMarksAt(from)) {
      if (!m.beat || m.beat.k !== 'rev' || m.beat.type !== 'Addition' || m.beat.gen !== gen) continue;
      const r = rangeOf(m);
      if (r && cmp(r.to, from) === 0) { start = r.from; m.clear(); break; }
    }
    addMark(doc, start, to, { k: 'rev', type: 'Addition', gen });
  });

  /* ---------------- Commands ---------------- */
  function requireSelection(what) {
    const s = selectionRange();
    if (s.empty) { toast(`Select the text ${what} first`); return null; }
    return s;
  }

  function setRevisionMode(on) {
    const s = settingsFor(null, true);
    if (on) s[K.revisionMode] = true; else delete s[K.revisionMode];
    if (!(K.revisionLevel in s) && on) s[K.revisionLevel] = 0;
    App.touchMeta();
    updateStatus();
    toast(on ? `Revision mode on: what you type is marked as ${BD.GENERATIONS[revisionLevel()].label} revision` : 'Revision mode off');
  }
  function setGeneration(n) {
    const s = settingsFor(null, true);
    s[K.revisionLevel] = n;
    App.touchMeta();
    updateStatus();
    toast(`Revision color: ${BD.GENERATIONS[n].label}` + (revisionMode() ? '' : '. Turn on Revision Mode (F8) to mark what you type.'));
  }

  function markRevision(type) {
    const s = requireSelection(type === 'RemovalSuggestion' ? 'to suggest for removal' : 'to mark as revised'); if (!s) return;
    const gen = revisionLevel();
    rewrite(s.from, s.to, ['rev'], (from, to, old) => {
      // keep the parts of older revisions outside the selection
      for (const t of old) {
        if (cmp(t.r.from, s.from) < 0) addMark(cm.getDoc(), t.r.from, s.from, t.b);
        if (cmp(t.r.to, s.to) > 0) addMark(cm.getDoc(), s.to, t.r.to, t.b);
      }
      addMark(cm.getDoc(), s.from, s.to, { k: 'rev', type, gen });
    });
  }

  function clearKind(kind, label) {
    let s = selectionRange();
    const doc = cm.getDoc();
    if (s.empty) {
      if (!marksOf(doc, kind).length) { toast(`No ${label} in this script`); return; }
      if (!window.confirm(`Remove all ${label} from this script? You can undo this with Ctrl+Z.`)) return;
      s = { from: { line: 0, ch: 0 }, to: { line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length } };
    } else if (!doc.findMarks(s.from, s.to).some(m => m.beat && m.beat.k === kind)) { toast(`No ${label} in the selection`); return; }
    rewrite(s.from, s.to, [kind], (from, to, old) => {
      for (const t of old) {
        if (cmp(t.r.from, s.from) < 0) addMark(doc, t.r.from, s.from, t.b);
        if (cmp(t.r.to, s.to) > 0) addMark(doc, s.to, t.r.to, t.b);
      }
    });
    toast(`Removed ${label}` + (s.empty ? '' : ' from the selection'));
  }

  /* Review notes */
  function reviewAt(pos) {
    return cm.getDoc().findMarksAt(pos).filter(m => m.beat && m.beat.k === 'review').map(m => ({ m, r: rangeOf(m) })).find(x => x.r && cmp(x.r.from, pos) <= 0 && cmp(x.r.to, pos) >= 0) || null;
  }
  function reviewDialog(target) {
    const s = target ? { from: target.r.from, to: target.r.to } : requireSelection('to add a note to');
    if (!s) return;
    const doc = cm.getDoc();
    const existing = target || (() => {
      const hit = doc.findMarks(s.from, s.to).filter(m => m.beat && m.beat.k === 'review');
      return hit.length === 1 ? { m: hit[0], r: rangeOf(hit[0]) } : null;
    })();
    const quoted = doc.getRange(s.from, s.to).replace(/\s+/g, ' ').trim();
    const m = App.openModal(`<div class="m-head"><h2>${existing ? 'Review note' : 'Add review note'}</h2></div>
      <div class="m-body">
        <p class="hint">On “${esc(quoted.length > 90 ? quoted.slice(0, 88) + '…' : quoted)}”. Notes are highlighted in the script and never print. Beat shows them too.</p>
        <div class="field"><label for="rv-text">Note</label><textarea id="rv-text" spellcheck="true">${esc(existing ? existing.m.beat.text : '')}</textarea></div>
      </div>
      <div class="m-foot">${existing ? '<button class="btn" data-x="remove" style="margin-right:auto">Remove note</button>' : ''}<button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="save">${existing ? 'Update note' : 'Add note'}</button></div>`);
    const ta = m.querySelector('#rv-text');
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    const range = existing ? existing.r : s;
    const save = () => {
      const text = ta.value.trim();
      App.closeModal();
      if (!text && !existing) return;
      rewrite(range.from, range.to, ['review'], (from, to, old) => {
        for (const t of old) {
          if (cmp(t.r.from, range.from) < 0) addMark(doc, t.r.from, range.from, t.b);
          if (cmp(t.r.to, range.to) > 0) addMark(doc, range.to, t.r.to, t.b);
        }
        if (text) addMark(doc, range.from, range.to, { k: 'review', text });
      });
      toast(text ? (existing ? 'Note updated' : 'Note added') : 'Note removed');
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
    m.onclick = (e) => {
      const btn = e.target.closest('[data-x]'); if (!btn) return;
      if (btn.dataset.x === 'cancel') return App.closeModal();
      if (btn.dataset.x === 'remove') ta.value = '';
      save();
    };
  }
  // Click a note's text to read or change it.
  cm.getWrapperElement().addEventListener('click', (e) => {
    if (!e.target.closest('.bt-review') || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (cm.somethingSelected()) return;
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
    const hit = reviewAt(pos); if (!hit) return;
    App.popoverAt(e.clientX + 6, e.clientY + 14, `<div class="pop-review">${esc(hit.m.beat.text).replace(/\n/g, '<br>')}</div>
      <button data-a="edit">Edit note…</button><button data-a="remove">Remove note</button>`, (btn) => {
      document.getElementById('popover').hidden = true;
      if (btn.dataset.a === 'edit') reviewDialog(hit);
      else {
        rewrite(hit.r.from, hit.r.to, ['review'], () => {});
        toast('Note removed');
      }
    });
  });

  /* Production tags */
  function tagSelection(type) {
    const s = requireSelection('to tag'); if (!s) return;
    const doc = cm.getDoc();
    const name = doc.getRange(s.from, s.to).replace(/\s+/g, ' ').trim();
    if (!name) { toast('Select some words to tag'); return; }
    // Reuse the definition when this item has been tagged before.
    let def = null;
    for (const m of marksOf(doc, 'tag')) if (m.beat.type === type && m.beat.def.name.toLowerCase() === name.toLowerCase()) { def = m.beat.def; break; }
    const saved = settingsFor() && settingsFor()[K.tagDefinitions];
    if (!def && Array.isArray(saved)) {
      const d = saved.find(x => x && x.type === type && String(x.name).toLowerCase() === name.toLowerCase());
      if (d) def = { name: String(d.name), type, id: String(d.id) };
    }
    if (!def) def = { name, type, id: uuid() };
    rewrite(s.from, s.to, ['tag'], (from, to, old) => {
      for (const t of old) {
        if (cmp(t.r.from, s.from) < 0) addMark(doc, t.r.from, s.from, t.b);
        if (cmp(t.r.to, s.to) > 0) addMark(doc, s.to, t.r.to, t.b);
      }
      addMark(doc, s.from, s.to, { k: 'tag', type, def });
    });
    if (App.prefs && App.prefs.showTags === false) toast(`Tagged as ${tagType(type).label}. Tags are hidden: View → Show Tags`);
    else toast(`Tagged “${name}” as ${tagType(type).label}`);
  }

  /* Line alternatives: other versions of one line, kept with the script. */
  function currentAlt(line) {
    const m = altMarksByLine(cm.getDoc()).get(line);
    if (!m) return null;
    const data = BD.parseAlternative(m.beat.raw);
    return data ? { m, data } : null;
  }
  // Replace a line's text and its alternatives data in one undoable step. The rewrite reaches one line
  // past the old alternatives mark on each side, so the editor drops that mark (Ctrl+Z brings it back).
  function rewriteLine(line, text, raw) {
    const doc = cm.getDoc();
    const altMark = altMarksByLine(doc).get(line) || null;
    let a = line, z = line;
    const ar = altMark && rangeOf(altMark);
    if (ar) { a = Math.min(a, ar.from.line); z = Math.max(z, ar.to.line); }
    const lastLine = doc.lastLine();
    const from = a > 0 ? { line: a - 1, ch: doc.getLine(a - 1).length } : { line: 0, ch: 0 };
    const to = z < lastLine ? { line: z + 1, ch: 0 } : { line: z, ch: doc.getLine(z).length };
    const lines = doc.getRange(from, to).split('\n');
    const k = line - from.line;
    const changed = lines[k] !== text;
    lines[k] = text;
    const touched = doc.findMarks(from, to).filter(m => m.beat && m !== altMark).map(m => ({ m, r: rangeOf(m), b: m.beat })).filter(x => x.r);
    const sels = doc.listSelections();
    doc.changeGeneration(true);   // its own undo step
    cm.operation(() => {
      doc.replaceRange(lines.join('\n'), from, to, '+beat');
      for (const t of touched) {
        const p = maxPos(t.r.from, from), q = minPos(t.r.to, to);
        if (cmp(p, q) >= 0) continue;
        if (changed && p.line <= line && q.line >= line) continue;   // marks on the old text of the line
        const now = rangeOf(t.m);
        if (now && cmp(now.from, p) <= 0 && cmp(now.to, q) >= 0) continue;
        addMark(doc, p, q, t.b);
      }
      if (altMark && rangeOf(altMark)) altMark.clear();   // first or last line of the script
      if (raw && text) addMark(doc, { line, ch: 0 }, { line, ch: text.length }, { k: 'alt', raw });
      if (changed) doc.setCursor({ line, ch: text.length }); else doc.setSelections(sels, undefined, { scroll: false });
    });
    doc.changeGeneration(true);
    App.resetMarks();
    refreshDecor();
  }
  function versionRevisions(line, v) {
    // Revisions saved with a version come back as marks when you switch to it.
    const doc = cm.getDoc();
    for (const gen of Object.keys(v.revisions || {})) {
      for (const pair of v.revisions[gen] || []) {
        const a = +pair[0], len = +pair[1];
        if (!(len > 0) || a < 0 || a + len > doc.getLine(line).length) continue;
        addMark(doc, { line, ch: a }, { line, ch: a + len }, { k: 'rev', type: 'Addition', gen: Math.max(0, Math.min(7, +gen || 0)) });
      }
    }
  }
  function addAlternative() {
    const line = cm.getCursor().line;
    const doc = cm.getDoc();
    const text = doc.getLine(line);
    if (!text.trim()) { toast('Put the cursor on a line with text to give it an alternative'); return; }
    const cur = currentAlt(line);
    const revisions = lineRevisions(doc, line);
    let data;
    if (cur) {
      data = cur.data;
      const c = Math.max(0, Math.min(data.versions.length - 1, data.current | 0));
      data.versions[c] = Object.assign({}, data.versions[c], { text, revisions });
      data.versions.push({ text, revisions: {} });
    } else data = { current: 0, versions: [{ text, revisions }, { text, revisions: {} }] };
    data.current = data.versions.length - 1;
    rewriteLine(line, text, BD.formatAlternative(data));
    toast(`Alternative ${data.versions.length} of ${data.versions.length}: rewrite the line. Alt+Up and Alt+Down switch between versions.`);
  }
  function stepAlternative(dir) {
    const line = cm.getCursor().line;
    const cur = currentAlt(line);
    if (!cur) return false;
    const doc = cm.getDoc();
    const data = cur.data;
    const c = Math.max(0, Math.min(data.versions.length - 1, data.current | 0));
    const n = c + dir;
    if (n < 0 || n >= data.versions.length) { toast(dir < 0 ? 'This is the first version of the line' : 'This is the last version of the line'); return true; }
    if (!String(data.versions[n].text || '').trim()) { toast('That version of the line is empty'); return true; }
    data.versions[c] = Object.assign({}, data.versions[c], { text: doc.getLine(line), revisions: lineRevisions(doc, line) });
    data.current = n;
    const v = data.versions[n];
    cm.operation(() => { rewriteLine(line, String(v.text || ''), BD.formatAlternative(data)); versionRevisions(line, v); });
    toast(`Version ${n + 1} of ${data.versions.length}`);
    return true;
  }
  function removeAlternatives() {
    const line = cm.getCursor().line;
    if (!currentAlt(line)) { toast('This line has no alternatives'); return; }
    rewriteLine(line, cm.getDoc().getLine(line), null);
    toast('Kept this version and removed the other versions of the line');
  }

  /* Document settings (saved in the script, the way Beat does) */
  function docSettingsDialog() {
    const tab = App.active; if (!tab) return;
    const s = settingsFor(tab) || {};
    const has = (k) => k in s;
    const appPaper = App.prefs.print.paper === 'a4' ? 'A4' : 'US Letter';
    const hidden = BD.hiddenRevisions(s);
    const tri = (k, def) => has(k) ? (s[k] ? 'on' : 'off') : 'default';
    const sel = (id, value, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const m = App.openModal(`<div class="m-head"><h2>Document settings</h2></div>
      <div class="m-body ds">
        <p class="hint">These are saved inside this script, so Beat uses them too. “Use my setting” follows Offbeat’s Settings menu.</p>
        <div class="field"><label for="ds-paper">Paper size</label>${sel('ds-paper', has(K.pageSize) ? (+s[K.pageSize] === 0 ? 'a4' : 'letter') : 'default', [['default', `Use my setting (${appPaper})`], ['letter', 'US Letter'], ['a4', 'A4']])}</div>
        <div class="field"><label for="ds-scene">First scene number</label><input id="ds-scene" type="number" min="1" step="1" value="${BD.sceneStart(s)}"></div>
        <div class="field"><label for="ds-sn">Print scene numbers</label>${sel('ds-sn', tri(K.printSceneNumbers), [['default', `Use my setting (${App.prefs.print.sceneNumbers ? 'yes' : 'no'})`], ['on', 'Yes'], ['off', 'No']])}</div>
        <div class="field"><label for="ds-first">First page number</label><input id="ds-first" type="number" min="1" step="1" value="${has(K.firstPageNumber) && +s[K.firstPageNumber] > 0 ? +s[K.firstPageNumber] : 1}"></div>
        <div class="field"><label></label><div class="checks">
          <label><input type="checkbox" id="ds-hidepn" ${s[K.hidePageNumbers] ? 'checked' : ''}> Hide page numbers</label>
          <label><input type="checkbox" id="ds-color" ${s[K.printHeadingColor] ? 'checked' : ''}> Print scene headings in their scene color</label>
        </div></div>
        <div class="field"><label>Revisions to mark when printing</label><div class="checks gens">
          ${BD.GENERATIONS.map((g, k) => `<label><input type="checkbox" data-gen="${k}" ${hidden.has(k) ? '' : 'checked'}><i class="gen-dot bt-g${k}"></i>${g.label} <code>${esc(g.marker)}</code></label>`).join('')}
        </div></div>
      </div>
      <div class="m-foot"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="save">Save settings</button></div>`);
    m.onclick = (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'cancel') return App.closeModal();
      const st = settingsFor(tab, true);
      const before = JSON.stringify(st);
      const paper = m.querySelector('#ds-paper').value;
      if (paper === 'default') delete st[K.pageSize]; else st[K.pageSize] = paper === 'a4' ? 0 : 1;
      const scene = parseInt(m.querySelector('#ds-scene').value, 10);
      if (scene > 1) st[K.sceneStart] = scene; else delete st[K.sceneStart];
      const sn = m.querySelector('#ds-sn').value;
      if (sn === 'default') delete st[K.printSceneNumbers]; else st[K.printSceneNumbers] = sn === 'on';
      const first = parseInt(m.querySelector('#ds-first').value, 10);
      if (first > 1) st[K.firstPageNumber] = first; else delete st[K.firstPageNumber];
      if (m.querySelector('#ds-hidepn').checked) st[K.hidePageNumbers] = true; else delete st[K.hidePageNumbers];
      if (m.querySelector('#ds-color').checked) st[K.printHeadingColor] = true; else delete st[K.printHeadingColor];
      const hid = [...m.querySelectorAll('[data-gen]')].filter(x => !x.checked).map(x => +x.dataset.gen);
      if (hid.length) st[K.hiddenRevisions] = hid; else delete st[K.hiddenRevisions];
      App.closeModal();
      if (JSON.stringify(st) === before) return;
      App.touchMeta(tab);
      App.parseGen = -1; App._forcePaginate = true; App.resetMarks();
      App.ensureParsed(); App.emit('parse', App.parsed); App.paginate();
      toast('Document settings saved with the script');
    };
  }

  Object.assign(App.commands, {
    'revision-mode': () => setRevisionMode(!revisionMode()),
    'mark-revised': () => markRevision('Addition'),
    'mark-removal': () => markRevision('RemovalSuggestion'),
    'clear-revisions': () => clearKind('rev', 'revision marks'),
    'add-review': () => {
      const s = selectionRange();
      if (s.empty) { const hit = reviewAt(s.from); if (hit) return reviewDialog(hit); }
      reviewDialog(null);
    },
    'remove-reviews': () => clearKind('review', 'review notes'),
    'remove-tags': () => clearKind('tag', 'tags'),
    'alt-add': addAlternative,
    'alt-next': () => { if (!stepAlternative(1)) toast('This line has no alternatives. Add one with Format → Line Alternatives.'); },
    'alt-prev': () => { if (!stepAlternative(-1)) toast('This line has no alternatives. Add one with Format → Line Alternatives.'); },
    'alt-remove': removeAlternatives,
    'doc-settings': docSettingsDialog,
    'next-review': () => jumpToMark('review', 1),
    'prev-review': () => jumpToMark('review', -1)
  });
  for (let g = 0; g < BD.GENERATIONS.length; g++) App.commands['rev-gen:' + g] = () => setGeneration(g);
  for (const t of BD.TAG_TYPES) App.commands['tag:' + t.key] = () => tagSelection(t.key);

  function jumpToMark(kind, dir) {
    const doc = cm.getDoc();
    const cur = doc.getCursor();
    const list = marksOf(doc, kind).map(m => rangeOf(m)).filter(Boolean).sort((a, b) => cmp(a.from, b.from));
    if (!list.length) { toast('No review notes in this script'); return; }
    let target = dir > 0 ? list.find(r => cmp(r.from, cur) > 0) : [...list].reverse().find(r => cmp(r.to, cur) < 0);
    if (!target) target = dir > 0 ? list[0] : list[list.length - 1];
    App.jumpTo(target.from.line);
    doc.setSelection(target.from, target.to);
  }

  // Alt+Up / Alt+Down switch a line's versions (and fall through when the line has none).
  const keys = Object.assign({}, cm.getOption('extraKeys'), {
    'Alt-Up': () => (stepAlternative(-1) ? undefined : CodeMirror.Pass),
    'Alt-Down': () => (stepAlternative(1) ? undefined : CodeMirror.Pass),
    'F8': () => setRevisionMode(!revisionMode()),
    'Shift-Ctrl-R': () => App.commands['add-review']()
  });
  cm.setOption('extraKeys', keys);

  /* ---------------- Editor decorations ---------------- */
  // Lines with alternatives get a marker; revised lines get Beat's revision mark in the right margin.
  let decorTimer = null;
  function refreshDecor() { clearTimeout(decorTimer); decorTimer = setTimeout(applyDecor, 60); }
  function applyDecor() {
    const tab = App.active; if (!tab) return;
    const decor = tab.decor || new Map();   // line handle → classes, per script
    const doc = cm.getDoc();
    const want = new Map();
    const add = (line, cls) => { const h = doc.getLineHandle(line); if (h) want.set(h, (want.get(h) ? want.get(h) + ' ' : '') + cls); };
    for (const line of altMarksByLine(doc).keys()) add(line, 'bt-has-alt');
    const top = new Map();
    for (const m of marksOf(doc, 'rev')) {
      const r = rangeOf(m); if (!r) continue;
      for (let ln = r.from.line; ln <= r.to.line; ln++) {
        if (ln === r.to.line && r.to.ch === 0 && ln > r.from.line) continue;
        if (!top.has(ln) || top.get(ln) < m.beat.gen) top.set(ln, m.beat.gen);
      }
    }
    for (const [ln, g] of top) add(ln, 'bt-rl bt-rl' + g);
    cm.operation(() => {
      for (const [h, cls] of decor) if (want.get(h) !== cls && doc.getLineNumber(h) != null) cm.removeLineClass(h, 'text', cls);
      for (const [h, cls] of want) if (decor.get(h) !== cls) cm.addLineClass(h, 'text', cls);
    });
    tab.decor = want;
  }
  cm.on('changes', refreshDecor);
  App.on('tabswitch', () => { applyDecor(); updateStatus(); });

  /* ---------------- Status bar ---------------- */
  const stRev = document.getElementById('st-rev');
  function updateStatus() {
    if (!stRev) return;
    const on = revisionMode();
    stRev.hidden = !on;
    if (on) {
      const g = BD.GENERATIONS[revisionLevel()];
      stRev.innerHTML = `<i class="gen-dot bt-g${revisionLevel()}"></i>Revising: ${esc(g.label)}`;
      stRev.title = 'Revision mode is on (F8 to turn off). New text is marked as a revision.';
    }
  }
  if (stRev) stRev.addEventListener('click', () => setRevisionMode(false));

  /* View preferences */
  App.on('prefs', (p) => {
    document.body.classList.toggle('hide-revisions', p.showRevisions === false);
    document.body.classList.toggle('hide-tags', p.showTags === false);
  });
})();
