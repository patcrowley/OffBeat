/* Offbeat — outline, index cards, timeline, preview, statistics, dialogs */
(function () {
  'use strict';
  const App = window.App, F = window.Fountain, P = window.Paginator, cm = App.cm;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => F.parseInline(s || '').map(r => { let h = esc(r.text); if (r.u) h = `<u>${h}</u>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`; return h; }).join('');
  const COLOR_LIST = ['red', 'orange', 'yellow', 'green', 'mint', 'cyan', 'blue', 'purple', 'magenta', 'pink', 'brown', 'gray'];

  const state = { outline: true, cards: false, timeline: false, preview: false, filter: '', current: null, selected: new Set(), anchor: null };

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
    if (state.editing) { state.cardsStale = true; return; }   // don't wipe a card mid-edit
    state.cardsStale = false;
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
      const sel = state.selected.has(it.line);
      html += `<article class="card${sel ? ' selected' : ''}" draggable="true" tabindex="0" data-line="${it.line}" aria-selected="${sel}" aria-label="Scene ${esc(it.number)}: ${esc(it.title)}">
        ${col ? `<i class="c-color" style="background:${col}"></i>` : ''}
        <div class="c-top"><span class="c-num">${esc(it.number)}</span><span class="c-head" title="${esc(it.title)}">${esc(it.title)}</span>
          <button class="c-go" title="Open this scene in the script" aria-label="Open scene ${esc(it.number)} in the script"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3.5v9.5H13V10M9 3h4v4M13 3 7.5 8.5"/></svg></button></div>
        ${body}
        <div class="c-foot"><span>${esc(it.characters.slice(0, 4).join(', '))}</span><span>${len ? fmtEighths(len.eighths) + ' pg' : ''}</span></div>
      </article>`;
    }
    html += addTile('data-end="1"', 'at the end of the script');
    // keep keyboard focus on the same card across redraws
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#cards-grid .card');
    const focusLine = focused ? focused.dataset.line : null;
    grid.innerHTML = html;
    grid.classList.toggle('multi', state.selected.size > 1);
    markCurrent();
    updateSelectionBar();
    if (focusLine != null) { const c = grid.querySelector(`.card[data-line="${focusLine}"]`); if (c) c.focus({ preventScroll: true }); }
  }

  let dragLine = null, dragLines = null;
  const grid = $('cards-grid');
  grid.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card'); if (!c || c.classList.contains('editing')) { e.preventDefault(); return; }
    dragLine = +c.dataset.line; c.classList.add('dragging');
    // dragging a selected card carries the whole selection along
    dragLines = state.selected.has(dragLine) && state.selected.size > 1 ? [...state.selected] : [dragLine];
    if (dragLines.length > 1) grid.querySelectorAll('.card.selected').forEach(x => x.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragLine));
  });
  grid.addEventListener('dragend', () => { dragLine = null; dragLines = null; grid.querySelectorAll('.dragging,.drop-before').forEach(x => x.classList.remove('dragging', 'drop-before')); });
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
    moveScenes(dragLines || [dragLine], before);
  });
  /* ---------- Editing a card in place ---------- */
  // Double-click (or Enter on a selected card) edits its heading and synopsis without leaving the cards.
  grid.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.card'); if (!c || e.target.closest('.c-go') || c.classList.contains('editing')) return;
    startEdit(c, e.target.closest('.c-body, .c-foot') ? 'synopsis' : 'heading');
  });
  grid.addEventListener('keydown', (e) => {
    const c = e.target.closest('.card');
    if (c && e.target === c && e.key === 'Enter') { e.preventDefault(); startEdit(c, 'heading'); }
  });

  function startEdit(card, focusField) {
    if (state.editing) {
      // save the card being edited first; the grid redraws, so find this card again by position
      const idx = [...grid.querySelectorAll('.card')].indexOf(card);
      commitEdit();
      card = grid.querySelectorAll('.card')[idx];
      if (!card) return;
    }
    const line = +card.dataset.line;
    const p = App.ensureParsed();
    const item = p.outline.find(o => o.type === 'scene' && o.line === line);
    if (!item) return;
    const head = p.lines[line].content;
    const syn = item.synopsis.join('\n');
    state.editing = { line, head, syn };
    card.classList.add('editing');
    card.draggable = false;
    card.querySelector('.c-top').innerHTML = `<span class="c-num">${esc(item.number)}</span>
      <input class="c-edit-head" value="${esc(head)}" spellcheck="false" autocomplete="off" aria-label="Scene heading">`;
    const body = card.querySelector('.c-body');
    const ta = document.createElement('textarea');
    ta.className = 'c-edit-syn'; ta.value = syn; ta.rows = 4;
    ta.placeholder = 'What happens in this scene';
    ta.setAttribute('aria-label', 'Synopsis');
    body.replaceWith(ta);
    const foot = card.querySelector('.c-foot');
    foot.innerHTML = '<span>Enter to save, Esc to cancel</span>';
    foot.title = 'Shift+Enter starts a new line in the synopsis';
    const field = focusField === 'synopsis' ? ta : card.querySelector('.c-edit-head');
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  function endEdit(focusLine) {
    state.editing = null;
    renderCards();
    const card = focusLine != null && grid.querySelector(`.card[data-line="${focusLine}"]`);
    if (card) card.focus({ preventScroll: true });
  }

  function cancelEdit() { if (state.editing) endEdit(state.editing.line); }

  function commitEdit() {
    const ed = state.editing; if (!ed) return;
    const card = grid.querySelector('.card.editing');
    const newHead = card ? card.querySelector('.c-edit-head').value : ed.head;
    const newSyn = card ? card.querySelector('.c-edit-syn').value : ed.syn;
    state.editing = null;
    const changed = applyCardEdit(ed.line, newHead, newSyn, ed);
    if (!changed) endEdit(ed.line);
    else { const c = grid.querySelector(`.card[data-line="${ed.line}"]`); if (c) c.focus({ preventScroll: true }); }
  }
  App.commitCardEdit = commitEdit;

  grid.addEventListener('keydown', (e) => {
    if (!e.target.matches('.c-edit-head, .c-edit-syn')) return;
    e.stopPropagation();                       // keep Esc from closing the card view
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter' && !(e.shiftKey && e.target.matches('.c-edit-syn'))) { e.preventDefault(); commitEdit(); }
  });
  // Clicking anywhere outside the card saves it.
  grid.addEventListener('focusout', (e) => {
    if (!e.target.closest('.card.editing')) return;
    const ed = state.editing;   // only save this edit, not one started by the click that moved focus
    setTimeout(() => {
      const card = grid.querySelector('.card.editing');
      if (state.editing === ed && ed && !(card && card.contains(document.activeElement))) commitEdit();
    }, 0);
  });

  /* Write a card's heading and synopsis back into the script as one undoable change. */
  function applyCardEdit(line, newHead, newSyn, before) {
    const p = App.ensureParsed();
    const item = p.outline.find(o => o.type === 'scene' && o.line === line);
    if (!item) return false;
    let head = newHead.trim().replace(/\s+/g, ' ').toUpperCase();
    const syn = newSyn.split('\n').map(x => x.trim()).filter(Boolean);
    const headChanged = head && head !== before.head;
    const synChanged = syn.join('\n') !== before.syn.split('\n').map(x => x.trim()).filter(Boolean).join('\n');
    if (!headChanged && !synChanged) return false;

    const raw = cm.getLine(line);
    let headLine = raw;
    if (headChanged) {
      // keep a locked scene number and any notes such as [[COLOR RED]]
      const num = raw.match(/#([\w.\-]+)#/);
      const notes = raw.match(/\[\[[^\]]*\]\]/g) || [];
      if (!F.HEADING_RE.test(head + ' ') && !head.startsWith('.')) head = '.' + head;
      headLine = head + (num ? ` #${num[1]}#` : '') + (notes.length ? ' ' + notes.join(' ') : '');
    }

    const last = item.endLine;
    const block = [];
    for (let k = item.line; k <= last; k++) block.push(cm.getLine(k));
    let out;
    if (synChanged) {
      // drop the old synopsis lines (and a blank line left doubled by their removal)
      const kept = [];
      for (let k = 1; k < block.length; k++) {
        if (p.lines[item.line + k].type === 'synopsis') {
          if (kept.length && kept[kept.length - 1].trim() === '' && (block[k + 1] || '').trim() === '') k++;
          continue;
        }
        kept.push(block[k]);
      }
      let trailing = 0;
      while (trailing < kept.length && kept[kept.length - 1 - trailing].trim() === '') trailing++;
      const bodyLines = kept.slice(0, kept.length - trailing);
      while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
      if (last < cm.lastLine() && trailing === 0) trailing = 1;
      out = [headLine];
      if (syn.length) out.push('', ...syn.map(s => '= ' + s));
      if (bodyLines.length) out.push('', ...bodyLines);
      for (let t = 0; t < trailing; t++) out.push('');
    } else {
      out = [headLine, ...block.slice(1)];
    }
    cm.replaceRange(out.join('\n'), { line: item.line, ch: 0 }, { line: last, ch: cm.getLine(last).length }, '+cardedit');
    App.ensureParsed();
    App.emit('parse', App.parsed);
    toast('Card updated, Ctrl+Z to undo');
    return true;
  }
  App.applyCardEdit = applyCardEdit;
  grid.addEventListener('click', (e) => {
    const go = e.target.closest('.c-go');
    if (go) { e.stopPropagation(); if (state.editing) commitEdit(); App.jumpTo(+go.closest('.card').dataset.line); return; }
    const add = e.target.closest('.card-add');
    if (add) { newCardDialog(add.dataset.end ? null : +add.dataset.before); return; }
  });
  $('cards').querySelector('.cards-head').addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) window.cmd(b.dataset.cmd); });
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.card'); if (!c || c.classList.contains('editing')) return;
    const line = +c.dataset.line;
    if (e.ctrlKey || e.metaKey) {                       // add or remove one card
      if (state.selected.has(line)) state.selected.delete(line); else state.selected.add(line);
      state.anchor = line;
    } else if (e.shiftKey && state.anchor != null) {    // select a run of cards
      const cards = [...grid.querySelectorAll('.card')].map(x => +x.dataset.line);
      const a = cards.indexOf(state.anchor), b = cards.indexOf(line);
      if (a !== -1 && b !== -1) { state.selected = new Set(cards.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    } else {
      state.selected = new Set([line]); state.anchor = line;
    }
    paintSelection();
    cm.setCursor({ line, ch: 0 }); state.current = App.currentScene(); markCurrent();
  });
  // Clicking the empty desk clears the selection.
  $('cards').addEventListener('click', (e) => {
    if (e.target.closest('.card, .card-add, .cards-head, .c-section, #popover')) return;
    if (state.selected.size) { clearSelection(); }
  });
  grid.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    e.preventDefault();
    const line = +c.dataset.line;
    if (!state.selected.has(line)) { state.selected = new Set([line]); state.anchor = line; paintSelection(); }
    cardMenu(e.clientX, e.clientY, [...state.selected]);
  });

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

  /* ---------- Selecting several cards and moving them together ---------- */
  function paintSelection() {
    grid.querySelectorAll('.card').forEach(c => {
      const on = state.selected.has(+c.dataset.line);
      c.classList.toggle('selected', on);
      c.setAttribute('aria-selected', on);
    });
    grid.classList.toggle('multi', state.selected.size > 1);
    updateSelectionBar();
  }
  function clearSelection() { state.selected = new Set(); state.anchor = null; paintSelection(); }
  App.clearCardSelection = clearSelection;
  function updateSelectionBar() {
    // forget selections that no longer point at a scene
    const scenes = new Set((App.parsed ? App.parsed.outline : []).filter(o => o.type === 'scene').map(o => o.line));
    for (const l of [...state.selected]) if (!scenes.has(l)) state.selected.delete(l);
    const n = state.selected.size;
    const bar = $('cards').querySelector('.sel-bar');
    bar.hidden = n === 0;
    $('cards').querySelector('.cards-hint').hidden = n > 0;
    bar.querySelector('.sel-count').textContent = n === 1 ? '1 card selected' : `${n} cards selected`;
  }
  $('cards').querySelector('.sel-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]'); if (!b) return;
    if (b.dataset.sel === 'clear') clearSelection();
    else { const r = b.getBoundingClientRect(); moveMenu(r.left, r.bottom + 6, [...state.selected]); }
  });
  // Any edit other than our own move makes line-based selections stale.
  cm.on('changes', (cm, changes) => {
    if (state.selected.size && !changes.every(c => c.origin === '+move')) { state.selected = new Set(); state.anchor = null; }
  });

  function popoverAt(x, y, html, onClick) {
    const pop = $('popover');
    pop.innerHTML = html;
    pop.hidden = false;
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    pop.onclick = (e) => { const b = e.target.closest('button'); if (b) onClick(b); };
    const first = pop.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }

  function moveMenuHTML(count) {
    const targets = Structure.sectionTargets(App.ensureParsed());
    const what = count === 1 ? 'this card' : `${count} cards`;
    if (!targets.length) {
      return `<p class="pop-note">Add acts to the script with lines like <code># Act One</code>, then you can send cards to them.</p>
        <button data-end="1">Move ${what} to the end of the script</button>`;
    }
    return `<p class="pop-note">Move ${what} to the end of</p>` +
      targets.map(t => `<button data-before="${t.before === null ? '' : t.before}" class="d${Math.min(t.depth, 3)}">${esc(t.title)}</button>`).join('');
  }
  function moveMenu(x, y, lines) {
    popoverAt(x, y, moveMenuHTML(lines.length), (b) => {
      $('popover').hidden = true;
      moveScenes(lines, b.dataset.end || b.dataset.before === '' ? null : +b.dataset.before);
    });
  }
  function cardMenu(x, y, lines) {
    const n = lines.length;
    const html = (n > 1 ? `<p class="pop-note">${n} cards selected</p>` : '') +
      `<button data-move="1">Move to act…</button><hr>` +
      `<button data-c="none"><i class="sw"></i>No color</button>` +
      COLOR_LIST.map(c => `<button data-c="${c}"><i class="sw" style="background:${F.colorValue(c)}"></i>${c[0].toUpperCase() + c.slice(1)}</button>`).join('') +
      (n === 1 ? `<hr><button data-go="1">Go to scene</button>` : '');
    popoverAt(x, y, html, (b) => {
      if (b.dataset.move) { moveMenu(x, y, lines); return; }
      $('popover').hidden = true;
      if (b.dataset.go) App.jumpTo(lines[0]);
      else if (b.dataset.c) {
        const keep = new Set(state.selected), anchor = state.anchor;   // recoloring doesn't move any lines
        cm.operation(() => lines.forEach(l => App.setSceneColor(l, b.dataset.c)));
        state.selected = keep; state.anchor = anchor;
        App.ensureParsed(); App.emit('parse', App.parsed);
      }
    });
  }

  /* Move scenes (by heading line) before another item's line, or to the end of the script. */
  function moveScenes(lines, beforeLine) {
    const r = Structure.moveScenes(cm.getValue(), lines, beforeLine == null ? null : beforeLine);
    if (!r) return null;
    applyText(r.text, '+move');
    state.selected = new Set(r.lines);
    state.anchor = r.lines[0];
    App.ensureParsed();
    App.emit('parse', App.parsed);
    if (state.cards) {
      const first = grid.querySelector(`.card[data-line="${r.lines[0]}"]`);
      if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      r.lines.forEach(l => { const c = grid.querySelector(`.card[data-line="${l}"]`); if (c) { c.classList.add('just-added'); setTimeout(() => c.classList.remove('just-added'), 1400); } });
    }
    toast(r.lines.length === 1 ? 'Scene moved, Ctrl+Z to undo' : `${r.lines.length} scenes moved, Ctrl+Z to undo`);
    return r.lines;
  }
  App.moveScenes = moveScenes;

  /* Replace the script text with the fewest changed lines (one undo step). */
  function applyText(newText, origin) {
    const d = Structure.lineDiff(cm.getValue(), newText);
    const last = cm.lastLine();
    let from, to, ins;
    if (d.from > last) { from = { line: last, ch: cm.getLine(last).length }; to = from; ins = '\n' + d.newLines.join('\n'); }
    else if (d.suffix === 0) { from = { line: d.from, ch: 0 }; to = { line: last, ch: cm.getLine(last).length }; ins = d.newLines.join('\n'); }
    else { from = { line: d.from, ch: 0 }; to = { line: d.oldEnd, ch: 0 }; ins = d.newLines.map(l => l + '\n').join(''); }
    App.resetMarks();
    cm.operation(() => {
      cm.replaceRange(ins, from, to, origin);
      // safety net: if the minimal update didn't land exactly, replace the whole text (still one undo step)
      if (cm.getValue() !== newText) cm.replaceRange(newText, { line: 0, ch: 0 }, { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length }, origin);
    });
  }

  /* Move a single scene (drag and drop of one card). */
  function moveScene(fromLine, beforeLine) { return moveScenes([fromLine], beforeLine); }
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
    if (state.editing) commitEdit();
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
      else if (state.editing) cancelEdit();
      else if (state.cards && state.selected.size > 1) clearSelection();
      else if (state.cards) App.toggleCards(false);
    }
    if (state.cards && !state.editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && $('modal-backdrop').hidden && !e.target.matches('input, textarea')) {
      e.preventDefault();
      const all = [...grid.querySelectorAll('.card')].map(c => +c.dataset.line);
      state.selected = new Set(all); state.anchor = all[0]; paintSelection();
    }
    // Undo/redo while the cards are showing (the script editor isn't focused there)
    const mod = e.ctrlKey || e.metaKey;
    if (state.cards && !state.editing && mod && $('modal-backdrop').hidden && !e.target.matches('input, textarea')) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); cm.undo(); App.ensureParsed(); App.emit('parse', App.parsed); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); cm.redo(); App.ensureParsed(); App.emit('parse', App.parsed); }
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
