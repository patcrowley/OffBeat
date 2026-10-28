/*
 * Offbeat — pagination & print rendering
 * Lays out parsed Fountain into industry-standard pages (12pt Courier,
 * 10 characters per inch, 6 lines per inch) with (MORE)/(CONT'D) handling.
 */
(function (root) {
  'use strict';
  const F = (typeof module !== 'undefined' && module.exports) ? require('./fountain.js') : root.Fountain;

  const PAPER = {
    letter: { width: 8.5, height: 11, lines: 54 },
    a4: { width: 8.27, height: 11.69, lines: 58 }
  };

  // Offsets (in characters) from the left text margin (1.5in) and widths.
  const LAYOUT = {
    heading: { left: 0, width: 60 },
    action: { left: 0, width: 60 },
    character: { left: 22, width: 38 },
    parenthetical: { left: 16, width: 20 },
    dialogue: { left: 10, width: 35 },
    transition: { left: 0, width: 60, align: 'right' },
    centered: { left: 0, width: 60, align: 'center' },
    lyrics: { left: 0, width: 60, align: 'center', italic: true },
    // dual dialogue columns
    dualL: { left: 0, width: 28 }, dualR: { left: 31, width: 29 }
  };

  const DEFAULTS = {
    paper: 'letter',
    sceneNumbers: true,
    boldHeadings: true,
    underlineHeadings: false,
    spaceBeforeHeading: 2,
    contd: "(CONT'D)",
    more: '(MORE)'
  };

  /* Flatten runs into a char array with style flags so we can wrap safely. */
  function toChars(runs, extra) {
    const out = [];
    for (const r of runs) {
      for (const ch of r.text) out.push({ c: ch, b: r.b || (extra && extra.b), i: r.i || (extra && extra.i), u: r.u || (extra && extra.u) });
    }
    return out;
  }

  function charsToRuns(chars) {
    const runs = [];
    let cur = null;
    for (const ch of chars) {
      if (cur && cur.b === !!ch.b && cur.i === !!ch.i && cur.u === !!ch.u) cur.text += ch.c;
      else { cur = { text: ch.c, b: !!ch.b, i: !!ch.i, u: !!ch.u }; runs.push(cur); }
    }
    return runs;
  }

  /* Word-wrap a styled char array to a width. Returns array of char arrays. */
  function wrapChars(chars, width) {
    const lines = [];
    let start = 0;
    while (start < chars.length) {
      // skip leading spaces on continuation lines
      if (lines.length > 0) while (start < chars.length && chars[start].c === ' ') start++;
      if (start >= chars.length) break;
      if (chars.length - start <= width) { lines.push(chars.slice(start)); break; }
      let br = -1;
      for (let k = start + width; k > start; k--) {
        if (chars[k] && chars[k].c === ' ') { br = k; break; }
      }
      if (br === -1) { // no space: hard break
        lines.push(chars.slice(start, start + width)); start += width;
      } else {
        lines.push(chars.slice(start, br)); start = br + 1;
      }
    }
    if (lines.length === 0) lines.push([]);
    return lines;
  }

  function wrapText(text, width, extra) {
    return wrapChars(toChars(F.parseInline(text), extra), width).map(charsToRuns);
  }

  function mkLine(kind, runs, layout, src, more) {
    return Object.assign({ kind, runs, left: layout.left, width: layout.width, align: layout.align || 'left', src }, more || {});
  }

  /* Build the rendered lines for each element. */
  function layoutElement(el, opt) {
    const out = [];
    switch (el.type) {
      case 'heading': {
        const L = el.l;
        const style = { b: opt.boldHeadings, u: opt.underlineHeadings };
        wrapText(L.content, LAYOUT.heading.width, style).forEach((r, k) =>
          out.push(mkLine('heading', r, LAYOUT.heading, L.index, k === 0 ? { sceneNumber: L.sceneNumber } : {})));
        return { lines: out, space: opt.spaceBeforeHeading, keepWithNext: true, kind: 'heading' };
      }
      case 'action': {
        for (const L of el.lines) {
          const t = L.content;
          if (t.trim() === '') { out.push(mkLine('action', [], LAYOUT.action, L.index)); continue; }
          wrapText(t, LAYOUT.action.width).forEach(r => out.push(mkLine('action', r, LAYOUT.action, L.index)));
        }
        return { lines: out, space: 1, splittable: true, kind: 'action' };
      }
      case 'transition': {
        const L = el.l;
        wrapText(L.content.toUpperCase(), 60).forEach(r => out.push(mkLine('transition', r, LAYOUT.transition, L.index)));
        return { lines: out, space: 1, kind: 'transition' };
      }
      case 'centered': {
        const L = el.l;
        wrapText(L.content, 60).forEach(r => out.push(mkLine('centered', r, LAYOUT.centered, L.index)));
        return { lines: out, space: 1, kind: 'centered' };
      }
      case 'lyrics': {
        for (const L of el.lines) wrapText(L.content, 60, { i: true }).forEach(r => out.push(mkLine('lyrics', r, LAYOUT.lyrics, L.index)));
        return { lines: out, space: 1, kind: 'lyrics' };
      }
      case 'dialogue-block': {
        return Object.assign(layoutDialogue(el, LAYOUT.character, LAYOUT.parenthetical, LAYOUT.dialogue), { space: 1, splittable: true, kind: 'dialogue' });
      }
      case 'dual': {
        const lw = 28, rw = 29;
        const left = layoutDialogue(el.left, { left: 7, width: lw - 7 }, { left: 3, width: lw - 4 }, { left: 0, width: lw });
        const right = layoutDialogue(el.right, { left: 31 + 7, width: rw - 7 }, { left: 31 + 3, width: rw - 4 }, { left: 31, width: rw });
        const n = Math.max(left.lines.length, right.lines.length);
        for (let k = 0; k < n; k++) {
          out.push({ kind: 'dual', cols: [left.lines[k] || null, right.lines[k] || null], src: (left.lines[k] || right.lines[k]).src });
        }
        return { lines: out, space: 1, kind: 'dual' };
      }
      case 'pagebreak':
        return { pagebreak: true, lines: [] };
      default:
        return null; // sections, synopses: not printed
    }
  }

  function layoutDialogue(block, cueL, parL, diaL) {
    const lines = [];
    const cueText = block.cue.content.toUpperCase();
    wrapText(cueText, cueL.width).forEach(r => lines.push(mkLine('character', r, cueL, block.cue.index)));
    const cueCount = lines.length;
    for (const p of block.parts) {
      if (p.type === 'parenthetical') {
        wrapText(p.content, parL.width).forEach(r => lines.push(mkLine('parenthetical', r, parL, p.index)));
      } else {
        const t = p.raw === '  ' ? '' : p.content;
        wrapText(t, diaL.width).forEach(r => lines.push(mkLine('dialogue', r, diaL, p.index)));
      }
    }
    return { lines, cueCount, cueText, cueL, parL, diaL, name: block.name };
  }

  const endsSentence = (line) => {
    const t = (line.runs || []).map(r => r.text).join('').trim();
    return /[.!?:—"')\]]$/.test(t) || t === '';
  };

  function paginate(parsed, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const paper = PAPER[opt.paper] || PAPER.letter;
    const MAX = paper.lines;
    const pages = [];
    let page = { lines: [] };
    const newPage = () => { pages.push(page); page = { lines: [] }; };
    const used = () => page.lines.length;

    const blocks = [];
    for (const el of parsed.elements) {
      const b = layoutElement(el, opt);
      if (b) { b.el = el; blocks.push(b); }
    }

    const pushBlank = (n) => { for (let k = 0; k < n; k++) page.lines.push({ kind: 'blank', runs: [], left: 0, width: 60 }); };

    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.pagebreak) { if (used() > 0) newPage(); continue; }
      let space = used() === 0 ? 0 : b.space;
      let need = space + b.lines.length;

      // keep headings with the next element's first two lines
      if (b.keepWithNext) {
        const nb = blocks[bi + 1];
        if (nb && !nb.pagebreak) need += nb.space + Math.min(nb.lines.length, nb.kind === 'dialogue' ? 3 : 2);
      }

      if (used() + need <= MAX) {
        pushBlank(space);
        b.lines.forEach(l => page.lines.push(l));
        continue;
      }

      // Try splitting
      const avail = MAX - used() - space;
      if (b.splittable && b.kind === 'action' && !b.keepWithNext) {
        if (avail >= 2 && b.lines.length - avail >= 2) {
          let k = avail;
          for (let t = avail; t >= 2; t--) { if (endsSentence(b.lines[t - 1])) { k = t; break; } }
          if (b.lines.length - k >= 2) {
            pushBlank(space);
            b.lines.slice(0, k).forEach(l => page.lines.push(l));
            newPage();
            b.lines.slice(k).forEach(l => page.lines.push(l));
            continue;
          }
        }
      } else if (b.splittable && b.kind === 'dialogue') {
        // lines available for content before (MORE)
        const slots = avail - 1;
        const minFirst = b.cueCount + 2;
        if (slots >= minFirst && b.lines.length - b.cueCount > 3) {
          const k = Math.min(slots, b.lines.length - 2);
          let chosen = -1, fallback = -1;
          for (let t = k; t >= minFirst; t--) {
            const last = b.lines[t - 1];
            if (last.kind !== 'dialogue') continue; // never end a page on a cue or parenthetical
            if (fallback === -1) fallback = t;
            if (endsSentence(last)) { chosen = t; break; }
          }
          if (chosen === -1) chosen = fallback;
          if (chosen !== -1 && b.lines.length - chosen >= 1) {
            pushBlank(space);
            b.lines.slice(0, chosen).forEach(l => page.lines.push(l));
            page.lines.push(mkLine('more', [{ text: opt.more, b: false, i: false, u: false }], b.cueL, b.lines[chosen - 1].src));
            newPage();
            const contCue = (b.cueText.includes(opt.contd) ? b.cueText : b.cueText + ' ' + opt.contd);
            wrapText(contCue, b.cueL.width).forEach(r => page.lines.push(mkLine('character', r, b.cueL, b.lines[chosen].src, { contd: true })));
            b.lines.slice(chosen).forEach(l => page.lines.push(l));
            continue;
          }
        }
      }

      // Move to next page
      if (used() > 0) newPage();
      b.lines.forEach(l => page.lines.push(l));
      // If a single block is longer than a page, spill
      while (page.lines.length > MAX) {
        const overflow = page.lines.splice(MAX);
        newPage();
        overflow.forEach(l => page.lines.push(l));
      }
    }
    if (page.lines.length || pages.length === 0) pages.push(page);
    pages.forEach((p, k) => {
      p.number = k + 1;
      // trim trailing blanks
      while (p.lines.length && p.lines[p.lines.length - 1].kind === 'blank') p.lines.pop();
      const first = p.lines.find(l => l.src !== undefined || (l.cols));
      p.firstSource = first ? first.src : undefined;
    });
    return { pages, paper, options: opt };
  }

  /* Map source line index → page number (for editor page markers & outline). */
  function pageMap(result) {
    const starts = [];
    for (const p of result.pages) if (p.firstSource !== undefined) starts.push({ line: p.firstSource, page: p.number });
    return starts;
  }

  function pageOfLine(result, lineIndex) {
    let pg = 1;
    for (const p of result.pages) {
      if (p.firstSource !== undefined && p.firstSource <= lineIndex) pg = p.number;
    }
    return pg;
  }

  /* ---------- HTML rendering ---------- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function runsHTML(runs) {
    return runs.map(r => {
      let h = esc(r.text);
      if (r.u) h = `<u>${h}</u>`;
      if (r.i) h = `<i>${h}</i>`;
      if (r.b) h = `<b>${h}</b>`;
      return h;
    }).join('');
  }

  function lineHTML(l, opt) {
    if (l.kind === 'blank') return '<div class="pl"></div>';
    if (l.kind === 'dual') {
      return '<div class="pl dual">' + l.cols.map(c => c ? cellHTML(c) : '').join('') + '</div>';
    }
    let sn = '';
    if (l.sceneNumber && opt.sceneNumbers) {
      sn = `<span class="sn snl">${esc(l.sceneNumber)}</span><span class="sn snr">${esc(l.sceneNumber)}</span>`;
    }
    return `<div class="pl k-${l.kind}" data-src="${l.src}">${sn}${cellHTML(l)}</div>`;
  }

  function cellHTML(l) {
    const style = `left:${l.left}ch;width:${l.width}ch;text-align:${l.align}`;
    return `<span class="pc" style="${style}">${runsHTML(l.runs)}</span>`;
  }

  function titlePageHTML(fields) {
    if (!fields || !fields.length) return '';
    const get = (k) => {
      const f = fields.find(x => x.key.toLowerCase() === k);
      return f ? f.value : '';
    };
    const fmt = (v) => v.split('\n').map(x => runsHTML(F.parseInline(x)) || '&nbsp;').join('<br>');
    const titleV = get('title'), credit = get('credit'), author = get('author') || get('authors'),
      source = get('source'), contact = get('contact'), date = get('draft date') || get('date'), notes = get('notes');
    return `<section class="page title-page">
      <div class="tp-center">
        ${titleV ? `<div class="tp-title">${fmt(titleV.toUpperCase().includes('*') ? titleV : titleV)}</div>` : ''}
        ${credit ? `<div class="tp-credit">${fmt(credit)}</div>` : ''}
        ${author ? `<div class="tp-author">${fmt(author)}</div>` : ''}
        ${source ? `<div class="tp-source">${fmt(source)}</div>` : ''}
      </div>
      <div class="tp-bottom">
        <div class="tp-contact">${contact ? fmt(contact) : ''}${notes ? '<br><br>' + fmt(notes) : ''}</div>
        <div class="tp-date">${date ? fmt(date) : ''}</div>
      </div>
    </section>`;
  }

  function renderHTML(parsed, result) {
    const opt = result.options;
    let html = titlePageHTML(parsed.title);
    for (const p of result.pages) {
      html += `<section class="page" data-page="${p.number}">`;
      if (p.number > 1) html += `<div class="pnum">${p.number}.</div>`;
      html += '<div class="pbody">' + p.lines.map(l => lineHTML(l, opt)).join('') + '</div></section>';
    }
    return html;
  }

  /* CSS shared by the preview pane and PDF export */
  function printCSS(paperName, fontURL) {
    const paper = PAPER[paperName] || PAPER.letter;
    return `
${fontURL ? `@font-face{font-family:'Courier Prime';font-weight:400;font-style:normal;src:url('${fontURL}/courier-prime-latin-400-normal.woff2') format('woff2');}
@font-face{font-family:'Courier Prime';font-weight:700;font-style:normal;src:url('${fontURL}/courier-prime-latin-700-normal.woff2') format('woff2');}
@font-face{font-family:'Courier Prime';font-weight:400;font-style:italic;src:url('${fontURL}/courier-prime-latin-400-italic.woff2') format('woff2');}
@font-face{font-family:'Courier Prime';font-weight:700;font-style:italic;src:url('${fontURL}/courier-prime-latin-700-italic.woff2') format('woff2');}` : ''}
@page { size: ${paper.width}in ${paper.height}in; margin: 0; }
.screenplay { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; color: #000; }
.screenplay .page { position: relative; width: ${paper.width}in; height: ${paper.height}in; background: #fff; box-sizing: border-box; overflow: hidden; page-break-after: always; break-after: page; }
.screenplay .page:last-child { page-break-after: auto; break-after: auto; }
.screenplay .pbody { position: absolute; top: 1in; left: 1.5in; width: 6in; }
.screenplay .pl { position: relative; height: 12pt; line-height: 12pt; white-space: pre; }
.screenplay .pc { position: absolute; top: 0; white-space: pre; }
.screenplay .pnum { position: absolute; top: 0.5in; right: 1in; line-height: 12pt; }
.screenplay .sn { position: absolute; top: 0; }
.screenplay .snl { left: -0.75in; }
.screenplay .snr { left: 6.35in; }
.screenplay .title-page .tp-center { position: absolute; top: 3.5in; left: 1in; right: 1in; text-align: center; line-height: 12pt; }
.screenplay .title-page .tp-title { margin-bottom: 48pt; }
.screenplay .title-page .tp-credit { margin-bottom: 12pt; }
.screenplay .title-page .tp-author { margin-bottom: 36pt; }
.screenplay .title-page .tp-bottom { position: absolute; bottom: 1in; left: 1.5in; right: 1in; display: flex; justify-content: space-between; align-items: flex-end; line-height: 12pt; }
.screenplay .title-page .tp-date { text-align: right; }
`;
  }

  const api = { paginate, renderHTML, printCSS, pageMap, pageOfLine, PAPER, DEFAULTS, LAYOUT, wrapText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Paginator = api;
})(typeof window !== 'undefined' ? window : globalThis);
