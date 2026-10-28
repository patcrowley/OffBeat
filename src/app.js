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
    path: null, name: 'Untitled', settingsRaw: null,
    cleanGen: 0, parseGen: -1, paginateGen: -1,
    listeners: { parse: [], paginate: [], cursor: [], prefs: [] },
    on(ev, fn) { this.listeners[ev].push(fn); },
    emit(ev, d) { for (const fn of this.listeners[ev]) { try { fn(d); } catch (e) { console.error(e); } } }
  };

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
    App.parsed = F.parse(cm.getValue());
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

  App.paginate = function () {
    App.ensureParsed();
    const gen = App.parseGen;
    if (App.paginateGen === gen && App.paginated && !App._forcePaginate) return App.paginated;
    App._forcePaginate = false;
    App.paginated = P.paginate(App.parsed, App.prefs ? App.prefs.print : {});
    App.paginateGen = gen;
    updatePageGaps();
    App.emit('paginate', App.paginated);
    updateStatus();
    return App.paginated;
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
  App.layout = function () {
    const wrap = cm.getWrapperElement();
    const W = cm.getScrollerElement().clientWidth - 2;
    // shrink the type when the pane is narrower than a page so the format holds
    const ed = document.getElementById('editor');
    const curFit = parseFloat(ed.style.getPropertyValue('--fit')) || 1;
    const baseCw = cm.defaultCharWidth() / curFit;
    const fit = Math.max(0.55, Math.min(1, (W - 24) / (74 * baseCw)));
    if (Math.abs(fit - curFit) > 0.01) { ed.style.setProperty('--fit', fit.toFixed(3)); cm.refresh(); }
    const cw = cm.defaultCharWidth();
    const pageW = 85 * cw;
    const pageL = Math.max(12, Math.floor((W - pageW) / 2));
    let colL = pageL + 15 * cw;
    let colR = W - colL - 60 * cw;
    if (colR < 16) { colL = Math.max(16 + 7 * cw, colL + colR - 16); colR = 16; }
    const s = document.getElementById('editor').style;
    s.setProperty('--colL', colL + 'px');
    s.setProperty('--colR', colR + 'px');
    s.setProperty('--pageL', pageL + 'px');
    s.setProperty('--pageR', Math.min(W, pageL + pageW) + 'px');
    void wrap;
    cm.refresh();
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

  /* ---------------- Dirty tracking ---------------- */
  let lastDirty = false;
  function updateDirty() {
    const dirty = !cm.isClean(App.cleanGen);
    if (dirty !== lastDirty) {
      lastDirty = dirty;
      host.setDirty(dirty);
      document.getElementById('doc-name').classList.toggle('dirty', dirty);
      document.getElementById('st-saved').textContent = dirty ? 'Edited' : (App.path ? 'Saved' : '');
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
    'sample': () => host.openTextDoc(window.Samples.sample),
    'help': () => host.openTextDoc(window.Samples.help)
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
  let prevPrint = '';
  function applyPrefs() {
    const p = App.prefs;
    document.documentElement.style.setProperty('--zoom', p.zoom || 1);
    document.body.classList.toggle('dim-markup', !!p.dimMarkup);
    document.body.classList.toggle('no-pagebreaks', !p.showPageBreaks);
    document.body.classList.toggle('typewriter', !!p.typewriter);
    App.layout();
    const ps = JSON.stringify(p.print);
    if (ps !== prevPrint) { prevPrint = ps; App._forcePaginate = true; if (App.parsed) App.paginate(); }
    App.emit('prefs', p);
  }

  /* ---------------- Load / save ---------------- */
  function setDocument(text, path, name) {
    const s = F.splitSettings(text || '');
    App.settingsRaw = s.raw || null;
    let body = s.raw ? s.body.replace(/\s+$/, '\n') : s.body;
    App.path = path; App.name = name || 'Untitled';
    document.getElementById('doc-name').textContent = App.name;
    document.getElementById('doc-name').title = path || '';
    cm.setValue(body.replace(/\r\n?/g, '\n'));
    cm.clearHistory();
    App.cleanGen = cm.changeGeneration(true);
    lastDirty = true; updateDirty();
    sceneSig = ''; gapSig = '';
    App.parseGen = -1;
    App.ensureParsed();
    App.emit('parse', App.parsed);
    updateSceneNumbers();
    App.paginate();
    cm.setCursor({ line: 0, ch: 0 });
    cm.focus();
  }
  App.setDocument = setDocument;

  App.getText = function () {
    let t = cm.getValue();
    if (App.settingsRaw) t = t.replace(/\s+$/, '') + '\n\n' + App.settingsRaw;
    return t;
  };

  App.suggestedName = function () {
    const p = App.ensureParsed();
    const t = p.title.find(f => f.key.toLowerCase() === 'title');
    return t ? F.plainInline(t.value.split('\n')[0]).replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled' : (App.name || 'Untitled').replace(/\.[^.]+$/, '');
  };

  host.on('load', ({ text, path, name }) => setDocument(text, path, name));
  host.on('import-fdx', ({ xml, name }) => {
    try {
      const text = FDX.fromFDX(xml);
      setDocument(text, null, name + ' (imported)');
      App.cleanGen = -1; lastDirty = false; updateDirty();
      toast('Imported from Final Draft — save to keep it as Fountain');
    } catch (e) { toast('Could not import this Final Draft file'); console.error(e); }
  });
  host.on('saved', ({ path, name }) => {
    App.path = path; App.name = name;
    document.getElementById('doc-name').textContent = name;
    document.getElementById('doc-name').title = path;
    App.cleanGen = cm.changeGeneration(true);
    lastDirty = true; updateDirty();
    document.getElementById('st-saved').textContent = 'Saved';
  });
  host.on('prefs', (p) => { App.prefs = p; applyPrefs(); });
  host.on('command', (c) => cmd(c));
  host.on('request-text', ({ id }) => host.reply(id, App.getText()));
  host.on('request-is-empty', ({ id }) => host.reply(id, cm.getValue().trim() === '' && cm.isClean(App.cleanGen)));
  host.on('request-suggested-name', ({ id }) => host.reply(id, App.suggestedName()));
  host.on('request-print-html', async ({ id }) => {
    App.ensureParsed();
    const res = P.paginate(App.parsed, App.prefs.print);
    const fontURL = await host.fontURL();
    host.reply(id, { html: P.renderHTML(App.parsed, res), css: P.printCSS(App.prefs.print.paper, fontURL), suggested: App.suggestedName() });
  });
  host.on('request-export', ({ id, payload }) => {
    App.ensureParsed();
    if (payload === 'fdx') host.reply(id, { content: FDX.toFDX(cm.getValue()), suggested: App.suggestedName() });
    else {
      const res = P.paginate(App.parsed, App.prefs.print);
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${App.suggestedName()}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>${P.printCSS(App.prefs.print.paper, null)} body{background:#e6e6e6;margin:0;padding:24px 0} .screenplay .page{margin:0 auto 24px;box-shadow:0 1px 4px rgba(0,0,0,.2)} @media print{body{background:#fff;padding:0}.screenplay .page{margin:0;box-shadow:none}}</style>
</head><body><div class="screenplay">${P.renderHTML(App.parsed, res)}</div></body></html>`;
      host.reply(id, { content: html, suggested: App.suggestedName() });
    }
  });

  // Autosave every minute when enabled
  setInterval(() => { if (App.prefs && App.prefs.autosave && App.path) host.autosave(); }, 60000);

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
