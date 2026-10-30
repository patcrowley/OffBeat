/* Offbeat — outline, index cards, timeline, preview, statistics, dialogs */
(function () {
  'use strict';
  const App = window.App, F = window.Fountain, P = window.Paginator, cm = App.cm;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => F.parseInline(s || '').map(r => { let h = esc(r.text); if (r.u) h = `<u>${h}</u>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`; return h; }).join('');
  const COLOR_LIST = ['red', 'orange', 'yellow', 'green', 'mint', 'cyan', 'blue', 'purple', 'magenta', 'pink', 'brown', 'gray'];

  const state = { outline: true, cards: false, timeline: false, preview: false, filter: '', current: null };

  /* ---------- scene lengths (in eighths of a page) from pagination ---------- */
  function sceneLengths() {
    const res = App.paginated; if (!res || !App.parsed) return {};
    const scenes = App.parsed.outline.filter(o => o.type === 'scene');
    const starts = scenes.map(s => s.line);
    const counts = {};
    const MAX = res.paper.lines;
    const find = (src) => { let lo = 0, hi = starts.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= src) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
    for (const p of res.pages) {
      let lastScene = -1;
      for (const l of p.lines) {
        let src = l.src;
        if (src === undefined && l.kind === 'blank') { if (lastScene >= 0) counts[lastScene] = (counts[lastScene] || 0) + 1; continue; }
        if (src === undefined) continue;
        const k = find(src);
        lastScene = k;
        if (k >= 0) counts[k] = (counts[k] || 0) + 1;
      }
    }
    const out = {};
    scenes.forEach((s, k) => { out[s.line] = { lines: counts[k] || 1, eighths: Math.max(1, Math.round(((counts[k] || 1) / MAX) * 8)) }; });
    return out;
  }
  const fmtEighths = (e) => { const w = Math.floor(e / 8), r = e % 8; return (w ? w + (r ? ' ' : '') : '') + (r ? `${r}/8` : ''); };

  function pageFor(line) { return App.paginated ? P.pageOfLine(App.paginated, line) : ''; }

  /* ---------- Outline ---------- */
  function matchesFilter(it, f) {
    if (!f) return true;
    f = f.toLowerCase();
    if (it.type === 'section') return it.title.toLowerCase().includes(f);
    return it.title.toLowerCase().includes(f) || String(it.number).toLowerCase() === f ||
      (it.color || '').toLowerCase() === f || it.synopsis.join(' ').toLowerCase().includes(f) ||
      it.characters.some(c => c.toLowerCase().includes(f));
  }

  function renderOutline() {
    if (!state.outline || !App.parsed) return;
    const list = $('outline-list');
    const items = App.parsed.outline.filter(it => matchesFilter(it, state.filter));
    const html = items.map(it => {
      if (it.type === 'section') return `<li class="section d${Math.min(it.depth, 3)}" data-line="${it.line}">${esc(it.title)}</li>`;
      const col = F.colorValue(it.color);
      return `<li class="scene" data-line="${it.line}">${col ? `<i class="o-color" style="background:${col}"></i>` : ''}
        <div class="o-row"><span class="o-num">${esc(it.number)}</span><span class="o-title">${esc(it.title)}</span><span class="o-pg">${pageFor(it.line)}</span></div>
        ${it.synopsis.length ? `<div class="o-syn">${inline(it.synopsis[0])}</div>` : ''}</li>`;
    }).join('');
    if (list._html !== html) { list.innerHTML = html; list._html = html; }
    $('outline-empty').hidden = App.parsed.outline.length > 0;
    markCurrent();
  }

  function markCurrent() {
    const cur = state.current;
    document.querySelectorAll('#outline-list li.current, #cards-grid .card.current, #timeline-track .current').forEach(e => e.classList.remove('current'));
    if (!cur) return;
    const sel = `[data-line="${cur.line}"]`;
    const li = document.querySelector('#outline-list li' + sel);
    if (li) { li.classList.add('current'); if (state.outline) li.scrollIntoView({ block: 'nearest' }); }
    const card = document.querySelector('#cards-grid .card' + sel); if (card) card.classList.add('current');
    const tl = document.querySelector('#timeline-track .tl-scene' + sel); if (tl) { tl.classList.add('current'); if (state.timeline) tl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  $('outline-list').addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    App.jumpTo(+li.dataset.line);
  });
  $('outline-list').addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li.scene'); if (!li) return;
    e.preventDefault();
    colorMenu(e.clientX, e.clientY, +li.dataset.line);
  });
  $('outline-filter').addEventListener('input', (e) => { state.filter = e.target.value.trim(); renderOutline(); });

  /* ---------- Color popover ---------- */
  function colorMenu(x, y, line) {
    const pop = $('popover');
    pop.innerHTML = `<button data-c="none"><i class="sw"></i>No color</button>` +
      COLOR_LIST.map(c => `<button data-c="${c}"><i class="sw" style="background:${F.colorValue(c)}"></i>${c[0].toUpperCase() + c.slice(1)}</button>`).join('') +
      `<hr><button data-go="1">Go to scene</button>`;
    pop.hidden = false;
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    pop.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    pop.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pop.hidden = true;
      if (b.dataset.go) App.jumpTo(line);
      else App.setSceneColor(line, b.dataset.c);
    };
  }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#popover')) $('popover').hidden = true; });

  /* ---------- Index cards ---------- */
  function renderCards() {
    if (!state.cards || !App.parsed) return;
    const lens = sceneLengths();
    const grid = $('cards-grid');
    let html = '';
    const addTile = (attrs, where) => `<button class="card-add" ${attrs} title="New card ${where}"><span class="ca-plus" aria-hidden="true">+</span><span>New card</span></button>`;
    for (const it of App.parsed.outline) {
      if (it.type === 'section') {
        // close the previous section (or opening run of scenes) with an add tile
        if (html) html += addTile(`data-before="${it.line}"`, 'at the end of this section');
        html += `<div class="c-section" data-line="${it.line}">${esc(it.title)}</div>`;
        continue;
      }
      const col = F.colorValue(it.color);
      const body = it.synopsis.length ? `<div class="c-body">${inline(it.synopsis.join(' '))}</div>`
        : it.notes.length ? `<div class="c-body">${esc(it.notes[0])}</div>`
        : `<div class="c-body snippet">${inline(it.snippet)}</div>`;
      const len = lens[it.line];
      html += `<article class="card" draggable="true" data-line="${it.line}">
        ${col ? `<i class="c-color" style="background:${col}"></i>` : ''}
        <div class="c-top"><span class="c-num">${esc(it.number)}</span><span class="c-head" title="${esc(it.title)}">${esc(it.title)}</span></div>
        ${body}
        <div class="c-foot"><span>${esc(it.characters.slice(0, 4).join(', '))}</span><span>${len ? fmtEighths(len.eighths) + ' pg' : ''}</span></div>
      </article>`;
    }
    html += addTile('data-end="1"', 'at the end of the script');
    grid.innerHTML = html;
    markCurrent();
  }

  let dragLine = null;
  const grid = $('cards-grid');
  grid.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    dragLine = +c.dataset.line; c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragLine));
  });
  grid.addEventListener('dragend', () => { dragLine = null; grid.querySelectorAll('.dragging,.drop-before').forEach(x => x.classList.remove('dragging', 'drop-before')); });
  grid.addEventListener('dragover', (e) => {
    const t = e.target.closest('.card, .card-add, .c-section'); if (!t || dragLine === null) return;
    e.preventDefault();
    grid.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before'));
    t.classList.add('drop-before');
  });
  grid.addEventListener('drop', (e) => {
    const t = e.target.closest('.card, .card-add, .c-section'); if (!t || dragLine === null) return;
    e.preventDefault();
    const before = t.dataset.end ? null : t.dataset.before !== undefined ? +t.dataset.before : +t.dataset.line;
    moveScene(dragLine, before);
  });
  grid.addEventListener('dblclick', (e) => { const c = e.target.closest('.card'); if (c) App.jumpTo(+c.dataset.line); });
  grid.addEventListener('click', (e) => {
    const add = e.target.closest('.card-add');
    if (add) { newCardDialog(add.dataset.end ? null : +add.dataset.before); return; }
  });
  $('cards').querySelector('.cards-head').addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) window.cmd(b.dataset.cmd); });
  grid.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { cm.setCursor({ line: +c.dataset.line, ch: 0 }); state.current = App.currentScene(); markCurrent(); } });
  grid.addEventListener('contextmenu', (e) => { const c = e.target.closest('.card'); if (!c) return; e.preventDefault(); colorMenu(e.clientX, e.clientY, +c.dataset.line); });

  /* Put a scene block before line `before` (or at the end when null) with exactly one
     blank line above and below it, collapsing any run of blank lines at that spot.
     Returns the line number of the block's first line. */
  function placeBlock(block, before, origin) {
    block = block.replace(/\s+$/, '');
    const last = cm.lastLine();
    let prev = (before === null ? last : before - 1);
    while (prev >= 0 && cm.getLine(prev).trim() === '') prev--;
    const from = prev >= 0 ? { line: prev, ch: cm.getLine(prev).length } : { line: 0, ch: 0 };
    const lead = prev >= 0 ? '\n\n' : '';
    if (before === null) cm.replaceRange(lead + block + '\n', from, { line: last, ch: cm.getLine(last).length }, origin);
    else cm.replaceRange(lead + block + '\n\n', from, { line: before, ch: 0 }, origin);
    return prev >= 0 ? prev + 2 : 0;
  }

  /* Move a scene's full text block before another item's line (or to the end). */
  function moveScene(fromLine, beforeLine) {
    const p = App.ensureParsed();
    const item = p.outline.find(o => o.line === fromLine && o.type === 'scene');
    if (!item || beforeLine === fromLine) return;
    if (beforeLine !== null && beforeLine > item.line && beforeLine <= item.endLine + 1) return; // same spot
    const lastLine = cm.lastLine();
    const blockLines = [];
    for (let k = item.line; k <= item.endLine; k++) blockLines.push(cm.getLine(k));
    while (blockLines.length && blockLines[blockLines.length - 1].trim() === '') blockLines.pop();
    const block = blockLines.join('\n');
    const count = item.endLine - item.line + 1;
    cm.operation(() => {
      // remove
      const delFrom = { line: item.line, ch: 0 };
      const delTo = item.endLine >= lastLine ? { line: lastLine, ch: cm.getLine(lastLine).length } : { line: item.endLine + 1, ch: 0 };
      cm.replaceRange('', delFrom, delTo, '+move');
      const target = beforeLine === null ? null : beforeLine > item.endLine ? beforeLine - count : beforeLine;
      placeBlock(block, target, '+move');
    });
    App.ensureParsed();
    App.emit('parse', App.parsed);
    toast('Scene moved — Ctrl+Z to undo');
  }
  App.moveScene = moveScene;

  /* ---------- New card ---------- */
  // Where a new card goes when it isn't placed by a tile: right after the selected scene.
  function insertionAfterCurrent() {
    const p = App.ensureParsed();
    const cur = App.currentScene();
    if (!cur) return { before: null, where: 'at the end of the script' };
    const idx = p.outline.findIndex(o => o.line === cur.line);
    const next = p.outline[idx + 1];
    return { before: next ? next.line : null, where: `after scene ${cur.number}` };
  }

  function describeSpot(before) {
    if (before === null) return 'at the end of the script';
    const p = App.ensureParsed();
    const idx = p.outline.findIndex(o => o.line === before);
    const prev = idx > 0 ? p.outline[idx - 1] : null;
    const sec = [...p.outline.slice(0, Math.max(idx, 0))].reverse().find(o => o.type === 'section');
    if (p.outline[idx] && p.outline[idx].type === 'section' && sec) return `at the end of ${sec.title}`;
    if (prev && prev.type === 'scene') return `after scene ${prev.number}`;
    return 'before scene ' + (p.outline[idx] ? p.outline[idx].number : '');
  }

  function newCardDialog(before, whereText) {
    const p = App.ensureParsed();
    const where = whereText || describeSpot(before);
    const locs = Array.from(new Set(p.lines.filter(l => l.type === 'heading').map(l => l.content.replace(/\s+[-–]\s+[^-–]*$/, '').trim()))).sort();
    const swatches = ['none', ...COLOR_LIST].map((c, k) => `<label class="swatch" title="${c === 'none' ? 'No color' : c[0].toUpperCase() + c.slice(1)}">
        <input type="radio" name="nc-color" value="${c}" ${k === 0 ? 'checked' : ''}><i style="${c === 'none' ? '' : `background:${F.colorValue(c)}`}"></i></label>`).join('');
    const m = openModal(`<div class="m-head"><h2>New card</h2></div>
      <div class="m-body">
        <div class="field"><label for="nc-head">Scene heading</label><input id="nc-head" list="nc-locs" value="INT. " spellcheck="false" autocomplete="off"></div>
        <datalist id="nc-locs">${locs.map(l => `<option value="${esc(l)} - ">`).join('')}</datalist>
        <div class="field"><label for="nc-syn">Synopsis</label><textarea id="nc-syn" placeholder="What happens in this scene"></textarea></div>
        <div class="field"><label>Color</label><div class="swatches">${swatches}</div></div>
        <p class="hint" id="nc-msg">The scene goes ${esc(where)}. The synopsis shows on the card and never prints.</p>
      </div>
      <div class="m-foot"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="add">Add card</button></div>`);
    const head = $('nc-head');
    setTimeout(() => { head.focus(); head.setSelectionRange(head.value.length, head.value.length); }, 0);
    const submit = () => {
      let h = head.value.trim().toUpperCase().replace(/\s+/g, ' ');
      if (!h || /^(INT|EXT|EST|INT\.?\/EXT|I\/E)\.?$/.test(h)) {
        $('nc-msg').textContent = 'Give the scene a heading, like INT. KITCHEN - DAY.';
        $('nc-msg').classList.add('error'); head.focus(); return;
      }
      if (!F.HEADING_RE.test(h + ' ') && !h.startsWith('.')) h = '.' + h;
      const color = (m.querySelector('input[name=nc-color]:checked') || {}).value;
      const syn = $('nc-syn').value.split('\n').map(x => x.trim()).filter(Boolean);
      closeModal();
      insertScene(before, h + (color && color !== 'none' ? ` [[COLOR ${color.toUpperCase()}]]` : ''), syn);
    };
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    $('nc-syn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
    m.onclick = (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'cancel') closeModal(); else submit();
    };
  }

  function insertScene(before, heading, synopsis) {
    let block = heading;
    if (synopsis.length) block += '\n\n' + synopsis.map(x => '= ' + x).join('\n');
    const headingLine = placeBlock(block, before, '+addcard');
    cm.setCursor({ line: headingLine, ch: 0 });
    App.ensureParsed();
    App.emit('parse', App.parsed);
    if (state.cards) {
      const card = $('cards-grid').querySelector(`.card[data-line="${headingLine}"]`);
      if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('just-added'); setTimeout(() => card.classList.remove('just-added'), 1400); }
    } else App.jumpTo(headingLine);
    toast('Card added — Ctrl+Z to undo');
    return headingLine;
  }
  App.insertScene = insertScene;
  App.newCardDialog = newCardDialog;

  App.toggleCards = function (force) {
    state.cards = force === undefined ? !state.cards : force;
    $('cards').hidden = !state.cards;
    cm.getWrapperElement().style.visibility = state.cards ? 'hidden' : '';
    setOn('toggle-cards', state.cards);
    if (state.cards) { App.paginate(); renderCards(); } else { cm.refresh(); cm.focus(); }
  };

  /* ---------- Timeline ---------- */
  function renderTimeline() {
    if (!state.timeline || !App.parsed) return;
    const lens = sceneLengths();
    const track = $('timeline-track');
    const scenes = App.parsed.outline;
    const total = Object.values(lens).reduce((a, b) => a + b.lines, 0) || 1;
    const nScenes = scenes.filter(s => s.type === 'scene').length, nSec = scenes.length - nScenes;
    const avail = Math.max(track.parentElement.clientWidth - 24 - nScenes * 2 - nSec * 8, 300);
    const scale = Math.max(avail / total, 0.6);
    track.innerHTML = scenes.map(it => {
      if (it.type === 'section') return `<div class="tl-section" data-line="${it.line}" title="${esc(it.title)}"><span>${esc(it.title)}</span></div>`;
      const len = (lens[it.line] || { lines: 4 }).lines;
      const col = F.colorValue(it.color);
      const w = Math.max(4, Math.round(len * scale) - 2);
      return `<div class="tl-scene" data-line="${it.line}" style="width:${w}px;${col ? `background:${col}` : ''}" title="${esc(it.number + '. ' + it.title)}">${w > 46 ? `<span>${esc(it.number)}</span>` : ''}</div>`;
    }).join('');
    markCurrent();
  }
  $('timeline-track').addEventListener('click', (e) => { const s = e.target.closest('[data-line]'); if (s) App.jumpTo(+s.dataset.line); });

  /* ---------- Preview ---------- */
  let previewFontSet = false;
  async function renderPreview() {
    if (!state.preview || !App.paginated) return;
    if (!previewFontSet) {
      const fontURL = await (window.host ? window.host.fontURL() : Promise.resolve('../node_modules/@fontsource/courier-prime/files'));
      $('print-style').textContent = P.printCSS(App.prefs.print.paper, fontURL, App.prefs.print.font).replace(/@page[^}]*}/, '');
      previewFontSet = App.prefs.print.paper + '|' + App.prefs.print.font;
    }
    if (previewFontSet !== App.prefs.print.paper + '|' + App.prefs.print.font) { previewFontSet = false; return renderPreview(); }
    const pages = $('preview-pages');
    pages.innerHTML = P.renderHTML(App.parsed, App.paginated);
    fitPreview();
    $('preview-info').textContent = `${App.paginated.pages.length} pages, ${App.prefs.print.paper === 'a4' ? 'A4' : 'US Letter'}`;
  }
  function fitPreview() {
    const pages = $('preview-pages');
    const scroll = $('preview-scroll');
    const pw = (P.PAPER[App.prefs.print.paper] || P.PAPER.letter).width * 96;
    const s = Math.min(1.2, (scroll.clientWidth - 40) / pw);
    pages.style.zoom = s;
    pages.style.width = pw + 'px';
  }
  new ResizeObserver(() => { if (state.preview) requestAnimationFrame(fitPreview); }).observe($('preview-scroll'));
  $('preview-pages').addEventListener('click', (e) => { const l = e.target.closest('[data-src]'); if (l && l.dataset.src !== 'undefined') App.jumpTo(+l.dataset.src); });
  $('preview').addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) window.host && window.host.action(b.dataset.action); });

  /* ---------- Modals ---------- */
  function openModal(html, opts) {
    const m = $('modal');
    $('modal-backdrop').classList.remove('spelling');
    m.onkeydown = null;
    m.className = opts && opts.wide ? 'wide' : '';
    m.innerHTML = html;
    $('modal-backdrop').hidden = false;
    const f = m.querySelector('[autofocus], input, textarea, button');
    if (f) setTimeout(() => f.focus(), 0);
    return m;
  }
  function closeModal() { $('modal-backdrop').hidden = true; $('modal-backdrop').classList.remove('spelling'); $('modal').innerHTML = ''; $('modal').onkeydown = null; if (!state.cards) cm.focus(); }
  $('modal-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('modal-backdrop').hidden) { closeModal(); e.preventDefault(); }
      else if (!$('popover').hidden) $('popover').hidden = true;
      else if (state.cards) App.toggleCards(false);
    }
  });
  App.closeModal = closeModal;

  /* Title page editor */
  const TP_FIELDS = [['Title', 'title'], ['Credit', 'credit'], ['Author', 'author'], ['Source', 'source'], ['Draft date', 'draft date'], ['Contact', 'contact'], ['Notes', 'notes']];
  function titlePageDialog() {
    const p = App.ensureParsed();
    const get = (k) => { const f = p.title.find(x => x.key.toLowerCase() === k || (k === 'author' && x.key.toLowerCase() === 'authors')); return f ? f.value : ''; };
    const extra = p.title.filter(x => !TP_FIELDS.some(([, k]) => k === x.key.toLowerCase() || (k === 'author' && x.key.toLowerCase() === 'authors')));
    const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const m = openModal(`<div class="m-head"><h2>Title page</h2></div>
      <div class="m-body">
        <p class="hint">Use **bold**, *italic* and _underline_ as in the script. Leave a field empty to omit it.</p>
        ${TP_FIELDS.map(([label, k]) => {
          const multi = k === 'contact' || k === 'notes';
          return `<div class="field"><label for="tp-${k.replace(' ', '-')}">${label}</label>${multi
            ? `<textarea id="tp-${k.replace(' ', '-')}" data-k="${label}">${esc(get(k))}</textarea>`
            : `<input id="tp-${k.replace(' ', '-')}" data-k="${label}" value="${esc(get(k))}" ${k === 'draft date' ? `placeholder="${esc(today)}"` : ''}>`}</div>`;
        }).join('')}
      </div>
      <div class="m-foot"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="save">Update title page</button></div>`);
    m.querySelector('#tp-draft-date').addEventListener('dblclick', (e) => { if (!e.target.value) e.target.value = today; });
    m.onclick = (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'cancel') return closeModal();
      const lines = [];
      m.querySelectorAll('[data-k]').forEach(inp => {
        const v = inp.value.trim(); if (!v) return;
        const vs = v.split('\n');
        if (vs.length === 1 && inp.tagName === 'INPUT') lines.push(`${inp.dataset.k}: ${vs[0]}`);
        else { lines.push(`${inp.dataset.k}:`); vs.forEach(x => lines.push('    ' + x.trim())); }
      });
      extra.forEach(x => { const vs = x.value.split('\n'); if (vs.length === 1) lines.push(`${x.key}: ${vs[0]}`); else { lines.push(`${x.key}:`); vs.forEach(v => lines.push('    ' + v)); } });
      const end = p.titleEnd;
      let to = end;
      while (to < cm.lineCount() && cm.getLine(to).trim() === '' && to < end + 1) to++;
      const block = lines.length ? lines.join('\n') + '\n\n' : '';
      cm.replaceRange(block, { line: 0, ch: 0 }, to >= cm.lineCount() ? { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length } : { line: to, ch: 0 });
      closeModal();
      toast(lines.length ? 'Title page updated' : 'Title page removed');
    };
  }

  /* Go to scene palette */
  function gotoDialog() {
    const p = App.ensureParsed();
    const scenes = p.outline.filter(o => o.type === 'scene');
    const m = openModal(`<div class="palette"><input id="pal-q" placeholder="Scene number, location or character" autofocus spellcheck="false"><ol id="pal-list"></ol></div>`);
    let sel = 0, shown = scenes;
    const render = () => {
      $('pal-list').innerHTML = shown.slice(0, 200).map((s, k) => `<li class="${k === sel ? 'sel' : ''}" data-line="${s.line}"><span class="o-num">${esc(s.number)}</span><span>${esc(s.title)}</span></li>`).join('');
      const e = $('pal-list').children[sel]; if (e) e.scrollIntoView({ block: 'nearest' });
    };
    const q = $('pal-q');
    q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      shown = !v ? scenes : scenes.filter(s => String(s.number).toLowerCase() === v || s.title.toLowerCase().includes(v) || s.characters.some(c => c.toLowerCase().includes(v)));
      if (/^\d+[a-z]?$/.test(v)) shown.sort((a, b) => (String(b.number).toLowerCase() === v) - (String(a.number).toLowerCase() === v));
      sel = 0; render();
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      if (e.key === 'Enter' && shown[sel]) { const l = shown[sel].line; closeModal(); App.jumpTo(l); }
    });
    m.onclick = (e) => { const li = e.target.closest('li'); if (li) { closeModal(); App.jumpTo(+li.dataset.line); } };
    render();
  }

  /* Statistics */
  function statsDialog() {
    App.paginate();
    const s = FDX.stats(cm.getValue(), App.paginated);
    const maxW = Math.max(1, ...s.characters.map(c => c.words));
    const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
    const ie = s.int + s.ext + s.intExt, dn = s.day + s.night + s.otherTime;
    const runtime = s.pages ? `${s.pages} min` : '—';
    openModal(`<div class="m-head"><h2>Statistics</h2><button class="btn" data-x="close">Close</button></div>
      <div class="m-body">
        <div class="stats-grid">
          <div class="stat"><b>${s.pages}</b><span>pages</span></div>
          <div class="stat"><b>${s.scenes}</b><span>scenes</span></div>
          <div class="stat"><b>${s.words.toLocaleString()}</b><span>words</span></div>
          <div class="stat"><b>${runtime}</b><span>rough runtime</span></div>
        </div>
        <div class="two-col">
          <div>
            <h3 class="sub">Interior and exterior</h3>
            <div class="split"><i style="width:${pct(s.int, ie)}%;background:#2f72e0"></i><i style="width:${pct(s.ext, ie)}%;background:#23885a"></i><i style="width:${pct(s.intExt, ie)}%;background:#d9a400"></i></div>
            <div class="legend"><span><i style="background:#2f72e0"></i>INT ${s.int}</span><span><i style="background:#23885a"></i>EXT ${s.ext}</span><span><i style="background:#d9a400"></i>INT/EXT ${s.intExt}</span></div>
          </div>
          <div>
            <h3 class="sub">Time of day</h3>
            <div class="split"><i style="width:${pct(s.day, dn)}%;background:#e8b923"></i><i style="width:${pct(s.night, dn)}%;background:#3c3f8f"></i><i style="width:${pct(s.otherTime, dn)}%;background:#8b8d98"></i></div>
            <div class="legend"><span><i style="background:#e8b923"></i>Day ${s.day}</span><span><i style="background:#3c3f8f"></i>Night ${s.night}</span><span><i style="background:#8b8d98"></i>Other ${s.otherTime}</span></div>
          </div>
        </div>
        <div class="two-col">
          <div>
            <h3 class="sub">Characters by dialogue</h3>
            <table class="chars"><thead><tr><th>Name</th><th>Words</th><th>Speeches</th><th>Scenes</th><th></th></tr></thead><tbody>
            ${s.characters.slice(0, 40).map(c => `<tr><td class="name">${esc(c.name)}</td><td>${c.words.toLocaleString()}</td><td>${c.blocks}</td><td>${c.scenes}</td><td class="bar"><i style="width:${(c.words / maxW) * 100}%"></i></td></tr>`).join('') || '<tr><td colspan="5">No dialogue yet.</td></tr>'}
            </tbody></table>
          </div>
          <div>
            <h3 class="sub">Locations</h3>
            <table class="chars"><thead><tr><th>Location</th><th>Scenes</th></tr></thead><tbody>
            ${s.locations.slice(0, 40).map(l => `<tr><td class="name">${esc(l.name)}</td><td>${l.count}</td></tr>`).join('') || '<tr><td colspan="2">No scene headings yet.</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>`, { wide: true }).onclick = (e) => { if (e.target.closest('[data-x]')) closeModal(); };
  }

  /* ---------- View toggles ---------- */
  function setOn(cmdName, on) { document.querySelectorAll(`#toolbar [data-cmd="${cmdName}"]`).forEach(b => b.classList.toggle('on', !!on)); }
  function relayout() { requestAnimationFrame(() => { App.layout(); if (state.timeline) renderTimeline(); }); }

  App.viewCommands = {
    'toggle-outline': () => {
      state.outline = !state.outline; $('outline').hidden = !state.outline; setOn('toggle-outline', state.outline);
      if (window.host) window.host.setPref('outlineVisible', state.outline);
      renderOutline(); relayout();
    },
    'toggle-cards': () => App.toggleCards(),
    'toggle-timeline': () => { state.timeline = !state.timeline; $('timeline').hidden = !state.timeline; setOn('toggle-timeline', state.timeline); App.paginate(); renderTimeline(); relayout(); },
    'toggle-preview': () => { state.preview = !state.preview; $('preview').hidden = !state.preview; setOn('toggle-preview', state.preview); App.paginate(); renderPreview(); relayout(); },
    'stats': statsDialog,
    'title-page': titlePageDialog,
    'goto-scene': gotoDialog,
    'new-card': () => { const spot = insertionAfterCurrent(); newCardDialog(spot.before, spot.where); }
  };
  document.addEventListener('keydown', (e) => {
    if (state.cards && $('modal-backdrop').hidden && e.key === 'Enter' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.cmd('new-card'); }
  });

  /* ---------- Wiring ---------- */
  App.on('parse', () => { state.current = App.currentScene(); renderOutline(); if (state.cards) renderCards(); });
  App.on('paginate', () => { renderOutline(); if (state.cards) renderCards(); if (state.timeline) renderTimeline(); if (state.preview) renderPreview(); });
  App.on('cursor', (sc) => { if ((sc && sc.line) !== (state.current && state.current.line)) { state.current = sc; markCurrent(); } });
  let firstPrefs = true;
  App.on('prefs', (p) => {
    if (firstPrefs) { firstPrefs = false; state.outline = p.outlineVisible !== false; $('outline').hidden = !state.outline; setOn('toggle-outline', state.outline); relayout(); }
    if (state.preview) { previewFontSet = false; }
  });
  setOn('toggle-outline', state.outline);
})();
