/* Offbeat — editor core */
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String(e.message) + ' @' + e.filename + ':' + e.lineno));
(function () {
  'use strict';
  const F = window.Fountain, P = window.Paginator;
  const host = window.host || {
    // fallback so the page can be opened in a plain browser for testing
    on() {}, reply() {}, setDirty() {}, setPref() {}, action() {}, autosave: async () => false,
    fontURL: async () => '../node_modules/@fontsource/courier-prime/files', openTextDoc() {}, platform: 'web'
  };

  const App = window.App = {
    cm: null, parsed: null, paginated: null, prefs: null,
    parseGen: -1, paginateGen: -1,
    tabs: [], active: null,   // open scripts; each tab has its own CodeMirror document
    listeners: { parse: [], paginate: [], cursor: [], prefs: [], beforetabswitch: [], tabswitch: [] },
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    emit(ev, d) { for (const fn of this.listeners[ev] || []) { try { fn(d); } catch (e) { console.error(e); } } }
  };
  // The script that's showing: these read and write the active tab.
  const TAB_DEFAULTS = { path: null, name: 'Untitled', beat: null, cleanGen: 0 };
  for (const k of Object.keys(TAB_DEFAULTS)) {
    Object.defineProperty(App, k, {
      get() { return App.active ? App.active[k] : TAB_DEFAULTS[k]; },
      set(v) { if (App.active) App.active[k] = v; }
    });
  }

  /* ---------------- CodeMirror ---------------- */
  const cm = App.cm = CodeMirror(document.getElementById('editor'), {
    mode: 'fountain',
    lineWrapping: true,
    inputStyle: 'contenteditable',
    spellcheck: false,
    autocorrect: false,
    undoDepth: 2000,
    cursorScrollMargin: 80,
    styleActiveLine: false,
    viewportMargin: 20,
    extraKeys: {
      'Enter': (cm) => smartEnter(false),
      'Shift-Enter': (cm) => cm.replaceSelection('\n'),
      'Tab': () => smartTab(),
      'Ctrl-B': () => cmd('bold'), 'Ctrl-I': () => cmd('italic'), 'Ctrl-U': () => cmd('underline'),
      'Shift-Ctrl-N': () => cmd('note'), 'Shift-Ctrl-B': () => cmd('omit'),
      'Ctrl-Alt-1': () => cmd('force-heading'), 'Ctrl-Alt-2': () => cmd('force-action'),
      'Ctrl-Alt-3': () => cmd('force-character'), 'Ctrl-Alt-4': () => cmd('force-transition'),
      'Ctrl-Alt-5': () => cmd('force-lyrics'), 'Ctrl-Alt-6': () => cmd('force-centered'),
      'Ctrl-G': () => cmd('goto-scene'), 'F3': 'findNext', 'Shift-F3': 'findPrev', 'Ctrl-H': 'replace',
      'Ctrl-Y': 'redo', 'Shift-Ctrl-Z': 'redo',
      'Ctrl-=': () => cmd('zoom-in'), 'Ctrl--': () => cmd('zoom-out'), 'Ctrl-0': () => cmd('zoom-reset'),
      'Shift-Ctrl-Enter': () => cmd('new-card'), 'F7': () => cmd('spelling'), 'Shift-Ctrl-D': () => cmd('dual-dialogue'), 'Shift-Ctrl-T': () => cmd('title-page'),
      'Esc': () => { if (App.capsLine) App.capsLine = null; }
    }
  });
  if (host.platform === 'darwin') {
    const k = cm.getOption('extraKeys'); const mk = {};
    for (const [key, v] of Object.entries(k)) mk[key.replace(/Ctrl-/g, 'Cmd-')] = v;
    cm.setOption('extraKeys', Object.assign({}, k, mk));
  }

  /* ---------------- Parsing & line formatting ---------------- */
  App.ensureParsed = function () {
    const gen = cm.changeGeneration();
    if (App.parseGen === gen && App.parsed) return App.parsed;
    App.parsed = F.parse(cm.getValue(), { sceneStart: App.sceneStart() });
    App.parseGen = gen;
    applyLineClasses();
    return App.parsed;
  };

  function classFor(L) {
    if (!L) return '';
    let c = 'ln-' + L.type;
    if (L.type === 'section') c += ' d' + Math.min(L.depth, 3);
    if (L.type === 'title' && /^[A-Za-z][^:]*:/.test(L.raw)) c += ' tk';
    if (L.type === 'character' && L.dual) c += ' ln-dual';
    if (L.type === 'heading' && L.color) c += ' scol-' + L.color.replace(/[^a-z]/g, '');
    return c;
  }

  function applyLineClasses() {
    const lines = App.parsed.lines;
    const capsHandle = App.capsLine;
    cm.operation(() => {
      let i = 0;
      cm.eachLine((h) => {
        let c = classFor(lines[i]);
        if (h === capsHandle) c += ' ln-caps';
        if (h._fc !== c) {
          if (h._fc) cm.removeLineClass(h, 'text', h._fc);
          if (c) cm.addLineClass(h, 'text', c);
          h._fc = c;
        }
        i++;
      });
    });
  }

  let outlineTimer = null, pageTimer = null;
  function scheduleWork() {
    clearTimeout(outlineTimer); clearTimeout(pageTimer);
    outlineTimer = setTimeout(() => { App.ensureParsed(); App.emit('parse', App.parsed); updateSceneNumbers(); }, 220);
    pageTimer = setTimeout(() => App.paginate(), 700);
  }

  // Forget cached scene-number and page-break markers so they're redrawn after big text changes.
  App.resetMarks = function () { sceneSig = ''; gapSig = ''; };

  App.paginate = function () {
    App.ensureParsed();
    const gen = App.parseGen;
    if (App.paginateGen === gen && App.paginated && !App._forcePaginate) return App.paginated;
    App._forcePaginate = false;
    App.paginated = P.paginate(App.parsed, App.printOptions());
    App.paginateGen = gen;
    updatePageGaps();
    App.emit('paginate', App.paginated);
    updateStatus();
    return App.paginated;
  };

  /* Print options: the app's settings, with anything the script's own (Beat) settings override. */
  App.printOptions = function (tab) {
    tab = tab || App.active;
    const base = Object.assign({}, P.DEFAULTS, App.prefs ? App.prefs.print : {});
    const s = tab && tab.beat ? tab.beat.settings : null;
    const o = Object.assign(base, window.BeatDoc.printOverrides(s));
    if (App.beatPrintExtras) Object.assign(o, App.beatPrintExtras(tab));
    return o;
  };
  App.sceneStart = function (tab) {
    tab = tab || App.active;
    return window.BeatDoc.sceneStart(tab && tab.beat ? tab.beat.settings : null);
  };

  /* ---------------- Scene numbers & page gaps ---------------- */
  let sceneMarks = [], sceneSig = '';
  function updateSceneNumbers() {
    const lines = App.parsed.lines;
    const heads = lines.filter(l => l.type === 'heading');
    const sig = heads.map(h => h.index + ':' + h.sceneNumber).join('|');
    if (sig === sceneSig) return;
    sceneSig = sig;
    cm.operation(() => {
      sceneMarks.forEach(m => m.clear());
      sceneMarks = heads.map(h => {
        const el = document.createElement('span');
        el.className = 'scene-num-wrap';
        el.innerHTML = `<span class="scene-num"></span><span class="scene-num r"></span>`;
        el.querySelectorAll('span').forEach(s => { s.textContent = h.sceneNumber; });
        return cm.setBookmark({ line: h.index, ch: 0 }, { widget: el, insertLeft: true, handleMouseEvents: true });
      });
    });
  }

  let gapWidgets = [], gapSig = '';
  function updatePageGaps() {
    const starts = P.pageMap(App.paginated).filter(s => s.page > 1);
    const sig = starts.map(s => s.line + ':' + s.page).join('|');
    if (sig === gapSig) return;
    gapSig = sig;
    const scroll = cm.getScrollInfo();
    cm.operation(() => {
      gapWidgets.forEach(w => w.clear());
      gapWidgets = starts.map(s => {
        const el = document.createElement('div');
        el.className = 'page-gap';
        const n = document.createElement('span');
        n.textContent = s.page + '.';
        el.appendChild(n);
        return cm.addLineWidget(s.line, el, { above: true, handleMouseEvents: false, noHScroll: true });
      });
    });
    cm.scrollTo(null, scroll.top);
  }

  /* ---------------- Geometry: center a true-scale page ---------------- */
  // Width of one "screenplay character". Equal to the glyph width for monospaced fonts; for
  // proportional fonts (OpenDyslexic) it's the average over typical script text, so a line holds
  // about as much as the printed 60-character line.
  const unitProbe = document.createElement('span');
  unitProbe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0';
  cm.getWrapperElement().appendChild(unitProbe);
  const SAMPLE = 'She grabs the keys and runs for the door. MAE (V.O.) We have to go, now! INT. KITCHEN - DAY';
  function charUnit() {
    unitProbe.textContent = 'iiiiiiiiii'; const narrow = unitProbe.getBoundingClientRect().width;
    unitProbe.textContent = 'MMMMMMMMMM'; const wide = unitProbe.getBoundingClientRect().width;
    if (Math.abs(narrow - wide) < 0.5) return cm.defaultCharWidth();
    unitProbe.textContent = SAMPLE;
    return unitProbe.getBoundingClientRect().width / SAMPLE.length;
  }
  App.charUnit = charUnit;

  App.layout = function () {
    const wrap = cm.getWrapperElement();
    // Width of the visible text area (the scroller also contains a hidden 50px strip used to hide native scrollbars).
    const W = (cm.display.lineDiv.offsetWidth || (cm.getScrollerElement().clientWidth - 50)) - 2;
    // In a narrow pane, shrink the type only slightly; after that keep the size the writer chose
    // (interface size and script zoom) and wrap lines earlier instead.
    const ed = document.getElementById('editor');
    const curFit = parseFloat(ed.style.getPropertyValue('--fit')) || 1;
    const baseCw = charUnit() / curFit;
    const fit = Math.max(0.85, Math.min(1, (W - 24) / (74 * baseCw)));
    if (Math.abs(fit - curFit) > 0.01) { ed.style.setProperty('--fit', fit.toFixed(3)); cm.refresh(); }
    const cw = charUnit();
    document.getElementById('editor').style.setProperty('--u', cw + 'px');
    const pageW = 85 * cw;
    const pageL = Math.max(12, Math.floor((W - pageW) / 2));
    let colL = pageL + 15 * cw;
    let colR = W - colL - 60 * cw;
    if (colR < 16) { colL = Math.max(16 + 7 * cw, colL + colR - 16); colR = 16; }
    const colW = Math.max(20 * cw, W - colL - colR);
    const s = document.getElementById('editor').style;
    s.setProperty('--colW', colW + 'px');
    s.setProperty('--k', Math.min(1, colW / (60 * cw)).toFixed(4));
    s.setProperty('--colL', colL + 'px');
    s.setProperty('--colR', colR + 'px');
    s.setProperty('--pageL', pageL + 'px');
    s.setProperty('--pageR', Math.min(W, pageL + pageW) + 'px');
    void wrap;
    cm.refresh();
    if (App.applyRestore) App.applyRestore();
  };
  let layoutRaf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(layoutRaf); layoutRaf = requestAnimationFrame(() => App.layout()); }).observe(document.getElementById('editor'));

  /* ---------------- Status bar ---------------- */
  function currentSceneItem() {
    if (!App.parsed) return null;
    const line = cm.getCursor().line;
    let cur = null;
    for (const it of App.parsed.outline) { if (it.type === 'scene' && it.line <= line) cur = it; if (it.line > line) break; }
    return cur;
  }
  App.currentScene = currentSceneItem;

  function updateStatus() {
    if (!App.parsed) return;
    const sc = currentSceneItem();
    document.getElementById('st-scene').textContent = sc ? `Scene ${sc.number}   ${sc.title}` : '';
    if (App.paginated) {
      const pg = P.pageOfLine(App.paginated, cm.getCursor().line);
      document.getElementById('st-page').textContent = `Page ${pg} of ${App.paginated.pages.length}`;
    }
    let words = 0;
    for (const L of App.parsed.lines) {
      if (L.type === 'title' || L.type === 'boneyard' || L.type === 'note' || L.type === 'empty' || L.type === 'section' || L.type === 'synopsis') continue;
      words += (L.content || '').split(/\s+/).filter(Boolean).length;
    }
    document.getElementById('st-words').textContent = `${words.toLocaleString()} words`;
  }
  App.updateStatus = updateStatus;

  /* Something saved with the script changed without touching its text (document settings, revision mode). */
  App.touchMeta = function (tab) {
    tab = tab || App.active; if (!tab) return;
    tab.metaSeq = (tab.metaSeq || 0) + 1;
    updateDirty(tab);
    scheduleAutosave(1500, tab);
  };

  /* ---------------- Dirty tracking (per tab) ---------------- */
  function updateDirty(tab, forceUI) {
    tab = tab || App.active; if (!tab) return;
    const dirty = !tab.doc.isClean(tab.cleanGen) || (tab.metaSeq || 0) !== (tab.cleanMeta || 0);
    const changed = dirty !== tab.lastDirty;
    if (changed) { tab.lastDirty = dirty; host.setDirty(dirty, tab.id); App.renderTabs(); }
    if (tab === App.active && (changed || forceUI)) {
      document.getElementById('doc-name').classList.toggle('dirty', dirty);
      document.getElementById('st-saved').textContent = dirty ? 'Edited' : (tab.path ? 'Saved' : '');
    }
  }

  cm.on('changes', () => {
    App.ensureParsed();
    scheduleWork();
    updateDirty();
  });

  let cursorTimer = null;
  cm.on('cursorActivity', () => {
    if (App.capsLine && cm.getCursor().line !== cm.getLineNumber(App.capsLine)) { App.capsLine = null; App.parseGen = -1; App.ensureParsed(); }
    if (App.prefs && App.prefs.typewriter) {
      const c = cm.cursorCoords(null, 'local');
      const info = cm.getScrollInfo();
      cm.scrollTo(null, c.top - info.clientHeight / 2 + 20);
    }
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { updateStatus(); App.emit('cursor', currentSceneItem()); }, 120);
  });

  /* ---------------- Auto capitalization ---------------- */
  cm.on('beforeChange', (cm, ch) => {
    if (!App.prefs || !App.prefs.autoCaps) return;
    if (ch.origin !== '+input' || !ch.update) return;
    const handle = cm.getLineHandle(ch.from.line);
    if (App.capsLine && handle === App.capsLine && ch.text.length === 1) {
      ch.update(ch.from, ch.to, [ch.text[0].toUpperCase()]);
      return;
    }
    if (ch.text.length !== 1) return;
    const line = cm.getLine(ch.from.line);
    const prevEmpty = ch.from.line === 0 || cm.getLine(ch.from.line - 1).trim() === '';
    if (!prevEmpty) return;
    const after = line.slice(0, ch.from.ch) + ch.text[0] + line.slice(ch.to.ch);
    if (F.HEADING_RE.test(after.trimStart()) || /^\.[^.]/.test(after.trimStart())) {
      // uppercase outside of notes
      const before = line.slice(0, ch.from.ch);
      if (before.includes('[[') && !before.includes(']]')) return;
      ch.update(ch.from, ch.to, [ch.text[0].toUpperCase()]);
    }
  });
  cm.on('change', (cm, ch) => {
    if (!App.prefs || !App.prefs.autoCaps || ch.origin !== '+input') return;
    const ln = ch.from.line;
    const text = cm.getLine(ln);
    const prevEmpty = ln === 0 || cm.getLine(ln - 1).trim() === '';
    if (!prevEmpty) return;
    if (F.HEADING_RE.test(text.trimStart())) {
      const noteIdx = text.indexOf('[[');
      const head = noteIdx === -1 ? text : text.slice(0, noteIdx);
      if (head !== head.toUpperCase()) {
        const cur = cm.getCursor();
        cm.replaceRange(head.toUpperCase(), { line: ln, ch: 0 }, { line: ln, ch: head.length }, '+input');
        cm.setCursor(cur);
      }
    }
  });

  /* ---------------- Smart Enter / Tab ---------------- */
  function lineType(n) {
    const p = App.ensureParsed();
    return p.lines[n] ? p.lines[n].type : 'empty';
  }

  function smartEnter() {
    if (!App.prefs || !App.prefs.smartLineBreaks || cm.somethingSelected()) { cm.replaceSelection('\n'); return; }
    const cur = cm.getCursor();
    const text = cm.getLine(cur.line);
    if (cur.ch < text.length || text.trim() === '') { cm.replaceSelection('\n'); return; }
    const prevEmpty = cur.line === 0 || cm.getLine(cur.line - 1).trim() === '';
    const t = lineType(cur.line);
    let insert = '\n';
    if (t === 'character' || t === 'parenthetical') insert = '\n';
    else if (prevEmpty && F.isCharacterCue(text.replace(/\[\[.*?\]\]/g, '')) && !F.HEADING_RE.test(text.trim()) && !/TO:$/.test(text.trim())) insert = '\n';
    else if (['heading', 'action', 'dialogue', 'transition', 'centered', 'lyrics', 'section', 'synopsis'].includes(t)) insert = '\n\n';
    if (App.capsLine) App.capsLine = null;
    cm.replaceSelection(insert);
  }

  function smartTab() {
    const cur = cm.getCursor();
    const text = cm.getLine(cur.line);
    const prevText = cur.line > 0 ? cm.getLine(cur.line - 1) : '';
    const prevType = cur.line > 0 ? lineType(cur.line - 1) : 'empty';
    const prevIsCue = prevType === 'character' || (cur.line > 0 && prevText.trim() !== '' &&
      (cur.line < 2 || cm.getLine(cur.line - 2).trim() === '') && F.isCharacterCue(prevText.replace(/\[\[.*?\]\]/g, '')) && !F.HEADING_RE.test(prevText.trim()));
    if (text.trim() === '' && (prevIsCue || prevType === 'dialogue' || prevType === 'parenthetical') && prevText.trim() !== '') {
      cm.replaceRange('()', { line: cur.line, ch: 0 }, { line: cur.line, ch: text.length });
      cm.setCursor({ line: cur.line, ch: 1 });
      return;
    }
    if (text.trim() === '') {
      App.capsLine = cm.getLineHandle(cur.line);
      App.parseGen = -1; App.ensureParsed();
      toast('Character cue: type a name, press Enter for dialogue');
      return;
    }
    if (cm.state.completionActive) return CodeMirror.Pass;
    // Tab on an existing line toggles character cue ↔ action
    const t = lineType(cur.line);
    if (t === 'action' && text === text.toUpperCase()) return;
    if (t === 'action') { cm.replaceRange(text.toUpperCase(), { line: cur.line, ch: 0 }, { line: cur.line, ch: text.length }); }
  }

  /* ---------------- Autocomplete ---------------- */
  const TIMES = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DUSK', 'DAWN', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME'];
  function hintSource(cm) {
    const cur = cm.getCursor();
    const text = cm.getLine(cur.line);
    if (cur.ch !== text.length || !text.trim()) return null;
    const prevEmpty = cur.line === 0 || cm.getLine(cur.line - 1).trim() === '';
    if (!prevEmpty) return null;
    const p = App.parsed || App.ensureParsed();
    const up = text.toUpperCase();
    let list = [];
    if (F.HEADING_RE.test(text.trimStart())) {
      const m = up.match(/^(.*?)\s+[-–]\s*([A-Z ]*)$/);
      if (m) {
        list = TIMES.filter(t => t.startsWith(m[2].trim()) && t !== m[2].trim()).map(t => `${m[1]} - ${t}`);
      } else {
        const seen = new Set();
        for (const L of p.lines) {
          if (L.type !== 'heading' || L.index === cur.line) continue;
          const loc = L.content.replace(/\s+[-–]\s+[^-–]*$/, '').trim();
          if (loc.startsWith(up.trim()) && loc !== up.trim()) seen.add(loc);
        }
        list = Array.from(seen).sort();
      }
    } else if (/^@?[A-Z0-9 .'\-]*$/.test(up) && (text === up || App.capsLine === cm.getLineHandle(cur.line))) {
      const prefix = up.replace(/^@/, '').trim();
      if (!prefix) return null;
      const counts = {};
      for (const L of p.lines) if (L.type === 'character' && L.index !== cur.line) counts[L.name] = (counts[L.name] || 0) + 1;
      list = Object.keys(counts).filter(n => n.startsWith(prefix) && n !== prefix).sort((a, b) => counts[b] - counts[a]);
    }
    if (!list.length) return null;
    return { list: list.slice(0, 12), from: CodeMirror.Pos(cur.line, 0), to: CodeMirror.Pos(cur.line, text.length) };
  }
  cm.on('inputRead', (cm, ch) => {
    if (!App.prefs || !App.prefs.autocomplete || cm.state.completionActive) return;
    if (ch.origin !== '+input') return;
    App.ensureParsed();
    cm.showHint({ hint: hintSource, completeSingle: false, closeCharacters: /[\n]/ });
  });

  /* ---------------- Commands ---------------- */
  function wrapSelection(open, close) {
    close = close === undefined ? open : close;
    const sels = cm.listSelections();
    cm.operation(() => {
      for (const s of sels.slice().reverse()) {
        const from = CodeMirror.cmpPos(s.anchor, s.head) < 0 ? s.anchor : s.head;
        const to = from === s.anchor ? s.head : s.anchor;
        const text = cm.getRange(from, to);
        const bL = cm.getRange(CodeMirror.Pos(from.line, from.ch - open.length), from);
        const aL = cm.getRange(to, CodeMirror.Pos(to.line, to.ch + close.length));
        if (text && bL === open && aL === close) {
          cm.replaceRange(text, CodeMirror.Pos(from.line, from.ch - open.length), CodeMirror.Pos(to.line, to.ch + close.length));
        } else if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
          cm.replaceRange(text.slice(open.length, text.length - close.length), from, to);
        } else {
          cm.replaceRange(open + text + close, from, to);
          if (!text) cm.setCursor(CodeMirror.Pos(from.line, from.ch + open.length));
        }
      }
    });
    cm.focus();
  }

  function forceLine(prefix, suffix) {
    const ln = cm.getCursor().line;
    const text = cm.getLine(ln);
    let t = text.replace(/^\s*[.!@~>](?!\.)/, '').replace(/\s*<\s*$/, '').replace(/^\s+/, '');
    const isSame = text.trimStart().startsWith(prefix) && (!suffix || text.trimEnd().endsWith(suffix));
    if (!isSame) t = prefix + t + (suffix || '');
    cm.replaceRange(t, { line: ln, ch: 0 }, { line: ln, ch: text.length });
    if (!isSame && (prefix === '.' || prefix === '@' || prefix === '>')) {
      // keep blank line before so it reads correctly
      if (ln > 0 && cm.getLine(ln - 1).trim() !== '' && prefix !== '@') cm.replaceRange('\n', { line: ln, ch: 0 });
    }
    cm.focus();
  }

  function sceneHeadingLine() {
    App.ensureParsed();
    const sc = currentSceneItem();
    return sc ? sc.line : -1;
  }

  App.setSceneColor = function (line, color) {
    const text = cm.getLine(line);
    let t = text.replace(/\s*\[\[\s*COLOR\s+[^\]]*\]\]/gi, '');
    if (color && color !== 'none') t = t.replace(/\s+$/, '') + ` [[COLOR ${color.toUpperCase()}]]`;
    cm.replaceRange(t, { line, ch: 0 }, { line, ch: text.length });
  };

  App.jumpTo = function (line, opts) {
    const cards = document.getElementById('cards');
    if (!cards.hidden && !(opts && opts.keepCards)) App.toggleCards(false);
    cm.focus();
    cm.setCursor({ line, ch: 0 });
    const top = cm.charCoords({ line, ch: 0 }, 'local').top;
    cm.scrollTo(null, Math.max(0, top - 120));
  };

  const commands = {
    'undo': () => cm.undo(), 'redo': () => cm.redo(),
    'select-all': () => cm.execCommand('selectAll'),
    'find': () => cm.execCommand('find'), 'find-next': () => cm.execCommand('findNext'), 'replace': () => cm.execCommand('replace'),
    'bold': () => wrapSelection('**'), 'italic': () => wrapSelection('*'), 'underline': () => wrapSelection('_'),
    'note': () => wrapSelection('[[', ']]'), 'omit': () => wrapSelection('/*', '*/'),
    'force-heading': () => forceLine('.'), 'force-action': () => forceLine('!'), 'force-character': () => forceLine('@'),
    'force-transition': () => forceLine('>'), 'force-lyrics': () => forceLine('~'), 'force-centered': () => forceLine('>', '<'),
    'add-section': () => insertBlock('# '), 'add-synopsis': () => insertBlock('= '), 'add-pagebreak': () => insertBlock('===', true),
    'dual-dialogue': () => {
      App.ensureParsed();
      let ln = cm.getCursor().line;
      while (ln >= 0 && ['dialogue', 'parenthetical'].includes(lineType(ln))) ln--;
      if (lineType(ln) !== 'character') { toast('Place the cursor in the second character’s dialogue'); return; }
      const t = cm.getLine(ln);
      const nt = /\^\s*$/.test(t) ? t.replace(/\s*\^\s*$/, '') : t.replace(/\s+$/, '') + ' ^';
      cm.replaceRange(nt, { line: ln, ch: 0 }, { line: ln, ch: t.length });
    },
    'lock-numbers': () => {
      const p = App.ensureParsed();
      cm.operation(() => p.lines.filter(l => l.type === 'heading' && !/#[\w.\-]+#\s*$/.test(l.raw)).forEach(l => {
        const t = cm.getLine(l.index);
        const noteIdx = t.search(/\s*\[\[/);
        const pos = noteIdx === -1 ? t.replace(/\s+$/, '').length : noteIdx;
        cm.replaceRange(` #${l.sceneNumber}#`, { line: l.index, ch: pos });
      }));
      toast('Scene numbers locked');
    },
    'unlock-numbers': () => {
      const p = App.ensureParsed();
      cm.operation(() => p.lines.filter(l => l.type === 'heading').forEach(l => {
        const t = cm.getLine(l.index);
        const nt = t.replace(/\s*#[\w.\-]+#/, '');
        if (nt !== t) cm.replaceRange(nt, { line: l.index, ch: 0 }, { line: l.index, ch: t.length });
      }));
      toast('Scene numbers unlocked');
    },
    'zoom-in': () => setZoom((App.prefs.zoom || 1) + 0.1),
    'zoom-out': () => setZoom((App.prefs.zoom || 1) - 0.1),
    'zoom-reset': () => setZoom(1),
    'sample': () => host.openTextDoc(window.Samples.sample, 'Sample Screenplay'),
    'help': () => host.openTextDoc(window.Samples.help, 'Fountain Guide'),
    'next-tab': () => cycleTab(1),
    'prev-tab': () => cycleTab(-1)
  };
  App.commands = commands;

  function insertBlock(prefix, standalone) {
    const ln = cm.getCursor().line;
    const text = cm.getLine(ln);
    if (text.trim() === '') {
      cm.replaceRange(prefix, { line: ln, ch: 0 }, { line: ln, ch: text.length });
    } else {
      cm.replaceRange(`\n\n${prefix}${standalone ? '\n' : ''}`, { line: ln, ch: text.length });
    }
    cm.focus();
  }

  function setZoom(z) {
    z = Math.round(Math.min(2.2, Math.max(0.6, z)) * 100) / 100;
    host.setPref('zoom', z);
    App.prefs.zoom = z;
    applyPrefs();
  }

  window.cmd = cmd;
  function cmd(name) {
    if (name.startsWith('color:')) {
      const line = sceneHeadingLine();
      if (line < 0) { toast('Move the cursor into a scene to color it'); return; }
      App.setSceneColor(line, name.slice(6));
      return;
    }
    if (commands[name]) return commands[name]();
    if (App.viewCommands && App.viewCommands[name]) return App.viewCommands[name]();
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  window.toast = function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };
  const toast = window.toast;

  /* ---------------- Preferences ---------------- */
  // Editor fonts. All but OpenDyslexic are monospaced, so the editor lines up like the printed page.
  const EDITOR_FONTS = {
    'courier-prime': "'Courier Prime', 'Courier New', Courier, monospace",
    'courier-new': "'Courier New', 'Courier Prime', Courier, monospace",
    'plex': "'IBM Plex Mono', 'Courier Prime', monospace",
    'atkinson': "'Atkinson Hyperlegible Mono', 'Courier Prime', monospace",
    'opendyslexic': "'OpenDyslexic', 'Courier Prime', sans-serif"
  };
  App.EDITOR_FONTS = EDITOR_FONTS;
  let currentFont = null;
  let fontReady = null;
  function applyFont(id) { const p = loadFont(id); if (p) fontReady = p; return fontReady; }
  async function loadFont(id) {
    const family = EDITOR_FONTS[id] || EDITOR_FONTS['courier-prime'];
    if (family === currentFont) return null;
    currentFont = family;
    document.documentElement.style.setProperty('--script', family);
    const first = family.split(',')[0];
    try { await Promise.all(['400', '700', 'italic 400'].map(w => document.fonts.load(`${w} 16px ${first}`))); } catch (e) { /* fall back silently */ }
    if (family !== currentFont) return;
    cm.refresh();   // drop the old font's cached character width
    App.layout();   // then re-measure the page for the new font
    sceneSig = ''; gapSig = '';
    if (App.parsed) { updateSceneNumbers(); App._forcePaginate = true; App.paginate(); }
    applyRestore();
  }

  let prevPrint = '', prevAutosave = null;
  function applyPrefs() {
    const p = App.prefs;
    if (p.autosave && prevAutosave === false) App.tabs.forEach(t => scheduleAutosave(500, t));   // just switched on: save what's waiting
    prevAutosave = !!p.autosave;
    applyFont(p.editorFont);
    document.documentElement.style.setProperty('--zoom', p.zoom || 1);
    document.body.classList.toggle('dim-markup', !!p.dimMarkup);
    document.body.classList.toggle('no-pagebreaks', !p.showPageBreaks);
    document.body.classList.toggle('typewriter', !!p.typewriter);
    App.layout();
    const ps = JSON.stringify(p.print);
    if (ps !== prevPrint) { prevPrint = ps; App._forcePaginate = true; if (App.parsed) App.paginate(); }
    App.emit('prefs', p);
  }

  /* ---------------- Tabs: one CodeMirror document per open script ---------------- */
  // Beat keeps its data (revisions, notes, tags, settings) in a block at the end of the file.
  // It's taken off while editing, shown as marks in the text, and written back on save (beat.js).
  function makeDoc(text) {
    const info = window.BeatDoc.read(text || '');
    return { doc: CodeMirror.Doc(info.body, 'fountain'), info };
  }
  function fillTab(tab, text, path, name) {
    const { doc, info } = makeDoc(text);
    Object.assign(tab, { doc, beat: null, path: path || null, name: name || 'Untitled', savedGen: null, lastDirty: undefined, marks: null, pendingPos: null, ignored: new Set(), metaSeq: 0, cleanMeta: 0, savedMeta: null, decor: null });
    if (App.beatAttach) App.beatAttach(tab, info);
    else tab.beat = { settings: info.settings, raw: info.raw, alts: info.alts };
    tab.cleanGen = doc.changeGeneration(true);
    return tab;
  }
  let localSeq = 0;
  function createTab(id, text, path, name) {
    const tab = fillTab({ id, autoTimer: null }, text, path, name);
    App.tabs.push(tab);
    return tab;
  }
  const byId = (id) => App.tabs.find(t => t.id === id) || null;
  App.tabById = byId;

  function activate(tab, opts) {
    if (!tab) return;
    opts = opts || {};
    const prev = App.active;
    if (prev === tab && !opts.force) return;
    if (prev && prev !== tab) {
      App.emit('beforetabswitch', prev);
      prev.marks = { sceneMarks, sceneSig, gapWidgets, gapSig };
      if (pendingRestore && pendingRestore.tab === prev) { prev.pendingPos = pendingRestore.pos; pendingRestore = null; }
      if (App.tabs.includes(prev)) scheduleAutosave(0, prev);   // leaving a script saves it
    }
    App.active = tab;
    if (cm.getDoc() !== tab.doc) cm.swapDoc(tab.doc);
    ({ sceneMarks, sceneSig, gapWidgets, gapSig } = tab.marks || { sceneMarks: [], sceneSig: '', gapWidgets: [], gapSig: '' });
    App.capsLine = null; App.parseGen = -1; App.paginateGen = -1; App._forcePaginate = true;
    const nameEl = document.getElementById('doc-name');
    nameEl.textContent = tab.name; nameEl.title = tab.path || '';
    App.ensureParsed();
    App.emit('parse', App.parsed);
    updateSceneNumbers();
    App.paginate();
    updateDirty(tab, true);
    if (tab.pendingPos) { const p = tab.pendingPos; tab.pendingPos = null; restorePosition(p); }
    if (host.tabActivated && typeof tab.id === 'number') host.tabActivated(tab.id);
    renderTabs();
    App.emit('tabswitch', tab);
    updateStatus();
    if (!opts.noFocus) cm.focus();
  }
  App.activateTab = (id) => activate(byId(id));

  function openTab(id, text, path, name, pos) {
    const tab = createTab(id, text, path, name);
    activate(tab);
    cm.setCursor({ line: 0, ch: 0 });
    if (!pos && App.beatCaret) pos = App.beatCaret(tab);
    if (pos && pos.line < cm.lineCount()) restorePosition(pos);
    return tab;
  }

  function removeTab(id) {
    const tab = byId(id); if (!tab) return;
    clearTimeout(tab.autoTimer);
    const i = App.tabs.indexOf(tab);
    App.tabs.splice(i, 1);
    if (App.active === tab) {
      App.active = null;
      const next = App.tabs[i] || App.tabs[i - 1];
      if (next) activate(next);
    }
    renderTabs();
  }

  /* Load text into the script that's showing (replacing it). Opens a first tab if there is none. */
  function setDocument(text, path, name, pos) {
    let tab = App.active;
    if (!tab) tab = createTab('local' + (++localSeq), text, path, name);
    else fillTab(tab, text, path, name);
    if (host.tabInfo && typeof tab.id === 'number') host.tabInfo(tab.id, { path: tab.path, name: tab.name });
    activate(tab, { force: true });
    cm.setCursor({ line: 0, ch: 0 });
    if (!pos && App.beatCaret) pos = App.beatCaret(tab);
    if (pos && pos.line < cm.lineCount()) restorePosition(pos);
    cm.focus();
  }
  App.setDocument = setDocument;

  /* ---------------- Tab bar ---------------- */
  const tabBar = document.getElementById('tabbar');
  const escT = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const shortName = (t) => (t.name || 'Untitled').replace(/\.(fountain|spmd|txt)$/i, '');
  function renderTabs() {
    if (!tabBar) return;
    const show = App.tabs.length > 1;
    if (tabBar.hidden === show) { tabBar.hidden = !show; requestAnimationFrame(() => App.layout()); }
    if (!show) return;
    const html = App.tabs.map(t => {
      const on = t === App.active;
      return `<div class="tab${on ? ' active' : ''}${t.lastDirty ? ' dirty' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" draggable="true" data-tab="${t.id}" title="${escT(t.path || t.name)}">` +
        `<span class="tab-name">${escT(shortName(t))}</span>` +
        `<button class="tab-close" data-close="${t.id}" tabindex="-1" aria-label="Close ${escT(shortName(t))}" title="Close (Ctrl+W)"></button></div>`;
    }).join('') + `<button class="tab-new" title="New script (Ctrl+N)" aria-label="New script"></button>`;
    if (tabBar._html !== html) { tabBar.innerHTML = html; tabBar._html = html; }
    const a = tabBar.querySelector('.tab.active'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  App.renderTabs = renderTabs;
  const closeTab = (id) => host.action('close-tab:' + id);   // the window asks about unsaved changes
  if (tabBar) {
    tabBar.addEventListener('click', (e) => {
      const c = e.target.closest('[data-close]'); if (c) { e.stopPropagation(); closeTab(+c.dataset.close); return; }
      if (e.target.closest('.tab-new')) { host.action('new'); return; }
      const t = e.target.closest('.tab'); if (t) activate(byId(+t.dataset.tab));
    });
    tabBar.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll
    tabBar.addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeTab(+t.dataset.tab); });
    tabBar.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.tab'); if (!t) return;
      e.preventDefault();
      const id = +t.dataset.tab;
      const pop = document.getElementById('popover');
      pop.innerHTML = `<button data-act="close">Close</button>` + (App.tabs.length > 1 ? `<button data-act="others">Close Others</button>` : '');
      pop.hidden = false;
      const r = pop.getBoundingClientRect();
      pop.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
      pop.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
      pop.onclick = (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        pop.hidden = true;
        if (b.dataset.act === 'close') closeTab(id); else host.action('close-others:' + id);
      };
    });
    // drag a tab to reorder
    let dragId = null;
    tabBar.addEventListener('dragstart', (e) => { const t = e.target.closest('.tab'); if (!t) return; dragId = +t.dataset.tab; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); t.classList.add('dragging'); });
    tabBar.addEventListener('dragend', () => { dragId = null; tabBar.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
    tabBar.addEventListener('dragover', (e) => {
      const t = e.target.closest('.tab'); if (!t || dragId === null) return;
      e.preventDefault();
      const r = t.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
      tabBar.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      t.classList.add(after ? 'drop-after' : 'drop-before');
    });
    tabBar.addEventListener('drop', (e) => {
      const t = e.target.closest('.tab'); if (!t || dragId === null) return;
      e.preventDefault();
      const moving = byId(dragId), target = byId(+t.dataset.tab);
      if (!moving || !target || moving === target) return;
      const after = t.classList.contains('drop-after');
      App.tabs.splice(App.tabs.indexOf(moving), 1);
      App.tabs.splice(App.tabs.indexOf(target) + (after ? 1 : 0), 0, moving);
      tabBar._html = null; renderTabs();
      if (host.tabsOrder) host.tabsOrder(App.tabs.map(x => x.id).filter(x => typeof x === 'number'));
    });
  }
  function cycleTab(dir) {
    if (App.tabs.length < 2) return;
    const i = App.tabs.indexOf(App.active);
    activate(App.tabs[(i + dir + App.tabs.length) % App.tabs.length]);
  }
  App.cycleTab = cycleTab;
  // Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp switch scripts.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp') {
      if (!document.getElementById('modal-backdrop').hidden) return;
      e.preventDefault(); e.stopPropagation();
      cycleTab(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1);
    }
  }, true);

  /* Reopen each script where you left off: same cursor, same spot on screen. */
  // Fonts and the interface size can still be settling when a script opens, which moves the
  // text around, so the scroll is re-applied after each relayout for a moment (until the user acts).
  let pendingRestore = null;
  function applyRestore() {
    if (!pendingRestore) return;
    if (Date.now() > pendingRestore.until) { pendingRestore = null; return; }
    if (pendingRestore.tab !== App.active) return;
    const { line, offset } = pendingRestore;
    const top = cm.charCoords({ line, ch: 0 }, 'local').top;
    cm.scrollTo(null, Math.max(0, top - offset));
  }
  App.applyRestore = applyRestore;
  function restorePosition(pos) {
    const line = Math.min(pos.line, cm.lastLine());
    cm.setCursor({ line, ch: Math.min(pos.ch || 0, cm.getLine(line).length) });
    pendingRestore = { tab: App.active, pos, line, offset: pos.offset != null ? pos.offset : 120, until: Date.now() + 2500 };
    requestAnimationFrame(applyRestore);
    Promise.resolve(fontReady).then(() => requestAnimationFrame(() => requestAnimationFrame(applyRestore)));
  }
  const cancelRestore = () => { pendingRestore = null; };
  cm.getWrapperElement().addEventListener('mousedown', cancelRestore, true);
  cm.getWrapperElement().addEventListener('wheel', cancelRestore, { passive: true, capture: true });
  cm.on('keydown', cancelRestore);
  let posTimer = null;
  function reportPosition() {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (!App.active || !App.path || !host.sendPosition) return;
      const c = cm.getCursor();
      const top = cm.charCoords({ line: c.line, ch: 0 }, 'local').top;
      const offset = Math.round(top - cm.getScrollInfo().top);
      host.sendPosition({ line: c.line, ch: c.ch, offset: Math.max(0, Math.min(offset, cm.getScrollInfo().clientHeight - 40)) }, App.active.id);
    }, 400);
  }
  cm.on('cursorActivity', reportPosition);
  cm.on('scroll', reportPosition);

  function getTextFor(tab) {
    if (App.beatSerialize) return App.beatSerialize(tab);
    const b = tab.beat || {};
    return window.BeatDoc.write(tab.doc.getValue(), b.settings, b.alts, b.raw);
  }
  App.getTextFor = getTextFor;
  App.getText = function () { return App.active ? getTextFor(App.active) : cm.getValue(); };

  App.suggestedName = function () {
    const p = App.ensureParsed();
    const t = p.title.find(f => f.key.toLowerCase() === 'title');
    return t ? F.plainInline(t.value.split('\n')[0]).replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled' : (App.name || 'Untitled').replace(/\.[^.]+$/, '');
  };

  function loadIntoTab(tabId, text, path, name, pos, replace) {
    const existing = tabId != null ? byId(tabId) : null;
    if (existing || replace || tabId == null) {
      if (existing) activate(existing, { noFocus: true });
      setDocument(text, path, name, pos);
      if (tabId != null && App.active && App.active.id !== tabId) App.active.id = tabId;
    } else openTab(tabId, text, path, name, pos);
  }
  host.on('load', ({ tabId, text, path, name, pos, replace }) => loadIntoTab(tabId, text, path, name, pos, replace));
  host.on('import-fdx', ({ tabId, xml, name, replace }) => {
    try {
      const text = FDX.fromFDX(xml);
      loadIntoTab(tabId, text, null, name + ' (imported)', null, replace);
      App.active.cleanGen = -1; App.active.lastDirty = undefined; updateDirty(App.active, true);
      toast('Imported from Final Draft — save to keep it as Fountain');
    } catch (e) { toast('Could not import this Final Draft file'); console.error(e); }
  });
  host.on('activate-tab', ({ tabId }) => activate(byId(tabId)));
  host.on('remove-tab', ({ tabId }) => removeTab(tabId));
  host.on('saved', ({ tabId, path, name, auto }) => {
    const tab = (tabId != null && byId(tabId)) || App.active; if (!tab) return;
    tab.path = path; tab.name = name;
    if (tab === App.active) {
      document.getElementById('doc-name').textContent = name;
      document.getElementById('doc-name').title = path;
    }
    // Clean as of the text that was written; anything typed during the save stays unsaved.
    tab.cleanGen = tab.savedGen != null ? tab.savedGen : tab.doc.changeGeneration(true);
    tab.cleanMeta = tab.savedMeta != null ? tab.savedMeta : (tab.metaSeq || 0);
    tab.savedGen = null; tab.savedMeta = null;
    tab.lastDirty = undefined; updateDirty(tab, true);   // always re-report, so the window knows about later edits
    tabBar && (tabBar._html = null); renderTabs();
    if (tab.doc.isClean(tab.cleanGen) && (tab.metaSeq || 0) === (tab.cleanMeta || 0)) { if (tab === App.active) document.getElementById('st-saved').textContent = auto ? 'Autosaved' : 'Saved'; }
    else scheduleAutosave(1500, tab);
  });
  host.on('prefs', (p) => { App.prefs = p; applyPrefs(); });
  host.on('command', (c) => cmd(c));
  const tabFor = (payload) => (payload && payload.tabId != null && byId(payload.tabId)) || App.active;
  host.on('request-text', ({ id, payload }) => {
    const tab = tabFor(payload);
    if (!tab) return host.reply(id, cm.getValue());
    tab.savedGen = tab.doc.changeGeneration(true);
    tab.savedMeta = tab.metaSeq || 0;
    host.reply(id, getTextFor(tab));
  });
  host.on('request-is-empty', ({ id, payload }) => {
    const tab = tabFor(payload);
    host.reply(id, !!tab && !tab.path && tab.doc.getValue().trim() === '' && tab.doc.isClean(tab.cleanGen));
  });
  host.on('request-suggested-name', ({ id, payload }) => {
    const tab = tabFor(payload);
    if (!tab || tab === App.active) return host.reply(id, App.suggestedName());
    const t = F.parse(tab.doc.getValue(), { sceneStart: App.sceneStart(tab) }).title.find(f => f.key.toLowerCase() === 'title');
    host.reply(id, t ? F.plainInline(t.value.split('\n')[0]).replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled' : (tab.name || 'Untitled').replace(/\.[^.]+$/, ''));
  });
  host.on('request-print-html', async ({ id }) => {
    App.ensureParsed();
    const opt = App.printOptions();
    const res = P.paginate(App.parsed, opt);
    const fontURL = await host.fontURL();
    host.reply(id, { html: P.renderHTML(App.parsed, res), css: P.printCSS(opt.paper, fontURL, opt.font), suggested: App.suggestedName() });
  });
  host.on('request-export', ({ id, payload }) => {
    App.ensureParsed();
    if (payload === 'fdx') host.reply(id, { content: FDX.toFDX(cm.getValue()), suggested: App.suggestedName() });
    else {
      const opt = App.printOptions();
      const res = P.paginate(App.parsed, opt);
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${App.suggestedName()}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>${P.printCSS(opt.paper, null, opt.font)} body{background:#e6e6e6;margin:0;padding:24px 0} .screenplay .page{margin:0 auto 24px;box-shadow:0 1px 4px rgba(0,0,0,.2)} @media print{body{background:#fff;padding:0}.screenplay .page{margin:0;box-shadow:none}}</style>
</head><body><div class="screenplay">${P.renderHTML(App.parsed, res)}</div></body></html>`;
      host.reply(id, { content: html, suggested: App.suggestedName() });
    }
  });

  // Autosave (per tab): shortly after you stop typing, when you switch tabs or apps, and every 30 s as a safety net.
  function scheduleAutosave(delay, tab) {
    tab = tab || App.active; if (!tab) return;
    clearTimeout(tab.autoTimer);
    if (!App.prefs || !App.prefs.autosave || !tab.path) return;
    tab.autoTimer = setTimeout(() => {
      if (App.tabs.includes(tab) && (!tab.doc.isClean(tab.cleanGen) || (tab.metaSeq || 0) !== (tab.cleanMeta || 0))) host.autosave(tab.id);
    }, delay);
  }
  const autosaveAll = () => App.tabs.forEach(t => scheduleAutosave(0, t));
  cm.on('changes', () => scheduleAutosave(2500));
  window.addEventListener('blur', autosaveAll);
  setInterval(autosaveAll, 30000);

  // Toolbar
  document.getElementById('toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cmd) cmd(b.dataset.cmd);
    if (b.dataset.action) host.action(b.dataset.action);
  });

  // Defaults when running without a host (browser test mode)
  if (!window.host) {
    App.prefs = { theme: 'system', dimMarkup: false, showPageBreaks: true, smartLineBreaks: true, autoCaps: true, autocomplete: true, typewriter: false, zoom: 1, autosave: false, outlineVisible: true, print: Object.assign({}, P.DEFAULTS) };
    setTimeout(() => { applyPrefs(); setDocument(window.Samples.sample, null, 'Sample.fountain'); }, 0);
  }
})();
