/*
 * Offbeat — Beat document data
 *
 * Beat keeps extra data at the end of a .fountain file, in a JSON block between
 * two markers: revisions, review notes, tags, line alternatives and document
 * settings. Ranges in that block are character offsets into the text above it.
 * This module reads and writes that block the way Beat does, so a script can go
 * back and forth between Beat and Offbeat without losing or misplacing anything.
 * It also resolves Beat's {{macros}}. Works in Node (tests) and in the renderer.
 *
 * Offbeat is an independent program; nothing here is copied from Beat. The file
 * format details (key names, marker strings) are what Beat writes to disk.
 */
(function (root) {
  'use strict';

  const START = "/* If you're seeing this, you can remove the following stuff - BEAT:";
  const END = 'END_BEAT */';
  const ALT_PREFIX = '/** ALTERNATIVES: ';

  // Revision generations, in Beat's order. `marker` is what prints in the margin.
  const GENERATIONS = [
    { color: 'blue', label: 'Blue', marker: '*', hex: '#3f7fe0' },
    { color: 'pink', label: 'Pink', marker: '**', hex: '#e2589a' },
    { color: 'yellow', label: 'Yellow', marker: '+', hex: '#c9a400' },
    { color: 'green', label: 'Green', marker: '++', hex: '#2f9e57' },
    { color: 'goldenrod', label: 'Goldenrod', marker: '@', hex: '#c88a12' },
    { color: 'buff', label: 'Buff', marker: '@@', hex: '#b5915c' },
    { color: 'rose', label: 'Rose', marker: '#', hex: '#d9667a' },
    { color: 'cherry', label: 'Cherry', marker: '##', hex: '#b51f3d' }
  ];
  // Very old Beat files stored a color name instead of a generation number.
  const LEGACY_REVISIONS = ['blue', 'orange', 'purple', 'green'];

  // Production tags, in Beat's order.
  const TAG_TYPES = [
    { key: 'cast', label: 'Cast', hex: '#00a2c7' },
    { key: 'prop', label: 'Prop', hex: '#f76b15' },
    { key: 'vfx', label: 'Visual Effect', hex: '#8e4ec6' },
    { key: 'sfx', label: 'Special Effect', hex: '#a07553' },
    { key: 'camera', label: 'Camera', hex: '#4cc38a' },
    { key: 'animal', label: 'Animal', hex: '#d1a800' },
    { key: 'extras', label: 'Extras', hex: '#d23ad6' },
    { key: 'vehicle', label: 'Vehicle', hex: '#12a594' },
    { key: 'costume', label: 'Costume', hex: '#e93d82' },
    { key: 'makeup', label: 'Makeup', hex: '#30a46c' },
    { key: 'music', label: 'Music', hex: '#8a8f3c' },
    { key: 'sound', label: 'Sound', hex: '#d9667a' },
    { key: 'stunt', label: 'Stunt', hex: '#3e8ef7' },
    { key: 'setDesign', label: 'Set Design', hex: '#c88a12' },
    { key: 'other', label: 'Other', hex: '#8b8d98' }
  ];

  // Document-setting keys Offbeat reads or writes.
  const K = {
    revisions: 'Revision', hiddenRevisions: 'Hidden Revisions', revisionLevel: 'Revision Level',
    revisionMode: 'Revision Mode', reviews: 'Review Ranges', tags: 'Tags', tagDefinitions: 'TagDefinitions',
    caret: 'Caret Position', textLength: 'Text Length', headingUUIDs: 'Heading UUIDs',
    pageSize: 'Page Size', sceneStart: 'Scene Numbering Starts From', printSceneNumbers: 'Print Scene Numbers',
    hidePageNumbers: 'Hide Page Numbers', firstPageNumber: 'firstPageNumber', printHeadingColor: 'printHeadingColor'
  };

  /* ---------------- Reading ---------------- */

  /*
   * Split a file into what the editor shows and Beat's data.
   * Returns {
   *   body:      the script text (LF line endings, alternatives removed) — Beat's ranges index into this
   *   settings:  the parsed JSON object, or null
   *   raw:       the block exactly as found, when its JSON could not be read (it is then kept verbatim)
   *   alts:      [{ line, raw }] — line-alternative data cut from the end of a line
   *   hadBlock:  whether the file had a Beat block at all
   * }
   */
  function read(text) {
    text = text || '';
    let content = text, settings = null, raw = null, hadBlock = false;
    const open = text.indexOf(START);
    const close = text.lastIndexOf(END);
    if (open !== -1 && close !== -1 && close > open) {
      hadBlock = true;
      const block = text.slice(open, close + END.length);
      content = text.slice(0, open) + text.slice(close + END.length);
      const a = block.indexOf('{'), b = block.lastIndexOf('}');
      try {
        const v = a !== -1 && b > a ? JSON.parse(block.slice(a, b + 1)) : null;
        if (v && typeof v === 'object' && !Array.isArray(v)) settings = v; else raw = block;
      } catch (e) { raw = block; }
    }
    content = content.replace(/\r\n?/g, '\n');
    const lines = content.split('\n');
    const alts = [];
    for (let i = 0; i < lines.length; i++) {
      const k = lines[i].indexOf(ALT_PREFIX);
      if (k === -1) continue;
      alts.push({ line: i, raw: lines[i].slice(k) });
      lines[i] = lines[i].slice(0, k);
    }
    return { body: alts.length ? lines.join('\n') : content, settings, raw, alts, hadBlock };
  }

  /* Parse the JSON inside a line-alternative block: { current, versions: [{ text, revisions }] } or null. */
  function parseAlternative(raw) {
    if (!raw || !raw.startsWith(ALT_PREFIX)) return null;
    let s = raw.slice(ALT_PREFIX.length);
    const star = s.lastIndexOf('*/');
    if (star !== -1) s = s.slice(0, star);
    try {
      const v = JSON.parse(s.trim());
      if (!v || !Array.isArray(v.versions)) return null;
      return v;
    } catch (e) { return null; }
  }
  function formatAlternative(data) { return ALT_PREFIX + JSON.stringify(data) + ' */'; }

  /* ---------------- Writing ---------------- */

  /*
   * Put a file back together. `alts` is [{ line, raw }] against the lines of `body`.
   * The settings get a fresh "Text Length" (Beat checks it when it opens the file).
   * With no settings and no unreadable block, the plain script comes back unchanged.
   */
  function write(body, settings, alts, raw) {
    let content = body || '';
    if (alts && alts.length) {
      const lines = content.split('\n');
      for (const a of alts) if (a.line >= 0 && a.line < lines.length) lines[a.line] += a.raw;
      content = lines.join('\n');
    }
    let block = null;
    if (settings) {
      const s = Object.assign({}, settings);
      s[K.textLength] = content.length;
      block = START + ' ' + JSON.stringify(s) + ' ' + END;
    } else if (raw) block = raw;
    if (!block) return content;
    const sep = content.length && !content.endsWith('\n') ? '\n' : '';
    return content + sep + block;
  }

  /* ---------------- Ranges ---------------- */

  /*
   * Beat stores one value per character for each kind of mark (a character is either
   * revised or not, has one tag, one review note). Editor marks can overlap, so flatten
   * them: where marks overlap, the one with the higher `seq` wins. Each input is
   * { from, to, key, value, seq }; neighbouring pieces with the same key are joined.
   * Returns [{ from, to, value }] sorted by position.
   */
  function flatten(marks) {
    const items = marks.filter(m => m.to > m.from);
    if (!items.length) return [];
    const points = new Set();
    for (const m of items) { points.add(m.from); points.add(m.to); }
    const xs = Array.from(points).sort((a, b) => a - b);
    const starts = new Map();
    for (const m of items) { if (!starts.has(m.from)) starts.set(m.from, []); starts.get(m.from).push(m); }
    const active = [];
    const out = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const x = xs[i], nx = xs[i + 1];
      for (const m of starts.get(x) || []) active.push(m);
      for (let k = active.length - 1; k >= 0; k--) if (active[k].to <= x) active.splice(k, 1);
      if (!active.length) continue;
      let top = active[0];
      for (const m of active) if (m.seq > top.seq) top = m;
      const last = out[out.length - 1];
      if (last && last.to === x && last.key === top.key) last.to = nx;
      else out.push({ from: x, to: nx, key: top.key, value: top.value });
    }
    return out.map(o => ({ from: o.from, to: o.to, value: o.value }));
  }

  /* Revisions → Beat's "Revision" value. Input: [{ from, to, type: 'Addition'|'RemovalSuggestion', gen, seq }]. */
  function revisionsForSaving(marks) {
    const out = { Addition: [], Removed: [], RemovalSuggestion: [] };
    const flat = flatten(marks.map(m => ({ from: m.from, to: m.to, seq: m.seq, key: m.type + ':' + m.gen, value: m })));
    for (const f of flat) {
      const list = out[f.value.type === 'RemovalSuggestion' ? 'RemovalSuggestion' : 'Addition'];
      list.push([f.from, f.to - f.from, f.value.gen]);
    }
    return out.Addition.length || out.RemovalSuggestion.length ? out : {};
  }

  /* Beat's "Revision" value → [{ from, to, type, gen }], dropping anything outside the text. */
  function revisionsFromSettings(value, textLength) {
    const out = [];
    if (!value || typeof value !== 'object') return out;
    for (const key of Object.keys(value)) {
      let type = null;
      if (key === 'Addition') type = 'Addition';
      else if (key === 'Removal' || key === 'RemovalSuggestion') type = 'RemovalSuggestion';
      if (!type || !Array.isArray(value[key])) continue;
      for (const item of value[key]) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const loc = +item[0], len = +item[1];
        let gen = 0;
        if (item.length > 2) {
          if (typeof item[2] === 'string') gen = Math.max(0, LEGACY_REVISIONS.indexOf(item[2]));
          else gen = +item[2] || 0;
        }
        if (!(len > 0) || loc < 0 || loc + len > textLength) continue;
        out.push({ from: loc, to: loc + len, type, gen: Math.max(0, Math.min(GENERATIONS.length - 1, gen)) });
      }
    }
    return out;
  }

  /* Review notes: [{ range: [loc, len], string }] ⇄ [{ from, to, text }] */
  function reviewsFromSettings(value, textLength) {
    if (!Array.isArray(value)) return [];
    return value.filter(r => r && Array.isArray(r.range) && r.range.length >= 2 && typeof r.string === 'string')
      .map(r => ({ from: +r.range[0], to: +r.range[0] + +r.range[1], text: r.string }))
      .filter(r => r.to > r.from && r.from >= 0 && r.to <= textLength);
  }
  function reviewsForSaving(marks) {
    return flatten(marks.map(m => ({ from: m.from, to: m.to, seq: m.seq, key: m.text, value: m })))
      .filter(f => f.value.text !== '')
      .map(f => ({ range: [f.from, f.to - f.from], string: f.value.text }));
  }

  /* Tags: [{ range, type, definition }] + [{ name, type, id }] ⇄ [{ from, to, type, def: { name, type, id } }] */
  function tagsFromSettings(tags, defs, textLength) {
    const byId = new Map();
    for (const d of Array.isArray(defs) ? defs : []) if (d && d.id) byId.set(d.id, { name: String(d.name || ''), type: String(d.type || 'other'), id: String(d.id) });
    const out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
      if (!t || !Array.isArray(t.range) || t.range.length < 2) continue;
      const from = +t.range[0], to = from + +t.range[1];
      if (!(to > from) || from < 0 || to > textLength) continue;
      const def = byId.get(t.definition) || { name: '', type: String(t.type || 'other'), id: String(t.definition || '') };
      out.push({ from, to, type: String(t.type || def.type), def });
    }
    return out;
  }
  function tagsForSaving(marks) {
    const flat = flatten(marks.map(m => ({ from: m.from, to: m.to, seq: m.seq, key: m.type + ':' + m.def.id, value: m })));
    const tags = [], defs = [], seen = new Set();
    for (const f of flat) {
      tags.push({ range: [f.from, f.to - f.from], type: f.value.type, definition: f.value.def.id });
      if (!seen.has(f.value.def.id)) { seen.add(f.value.def.id); defs.push({ name: f.value.def.name, type: f.value.def.type, id: f.value.def.id }); }
    }
    return { tags, defs };
  }

  /*
   * Keep Beat's outline identifiers stable: an element keeps its UUID when an element with the
   * same text (ignoring case) is found in order; new elements get a new one.
   */
  function headingUUIDs(old, strings, makeUUID) {
    const prev = Array.isArray(old) ? old.filter(o => o && o.uuid) : [];
    let p = 0;
    return strings.map(s => {
      const low = s.toLowerCase();
      for (let k = p; k < prev.length && k < p + 50; k++) {
        if (String(prev[k].string || '').toLowerCase() === low) { p = k + 1; return { uuid: prev[k].uuid, string: s }; }
      }
      return { uuid: makeUUID(), string: s };
    });
  }

  /* ---------------- Macros ---------------- */
  /*
   * {{name = value}} defines a text macro, {{name}} prints it.
   * {{serial name}} (or series) counts up each time it's printed; {{serial name = 100}} sets it.
   * {{name.sub}} is a sub-counter under a serial. {{date}} / {{date d.M.yyyy}} prints today's date.
   * {{panel}} counts up and starts over at each top-level section.
   * {{ref text}} adds a numbered reference, {{references}} lists them.
   */
  const MACRO_TYPES = ['string', 'serial', 'series', 'number', 'date', 'panel', 'ref', 'references'];

  // Small arithmetic evaluator for macro assignments like {{serial page = 10 + 2}}.
  function evalNumber(src) {
    let i = 0;
    const s = String(src).replace(/\s+/g, '');
    const num = () => {
      if (s[i] === '(') { i++; const v = add(); if (s[i] === ')') i++; return v; }
      if (s[i] === '-') { i++; return -num(); }
      if (s[i] === '+') { i++; return num(); }
      const m = /^\d+(\.\d+)?/.exec(s.slice(i));
      if (!m) throw new Error('bad number');
      i += m[0].length; return parseFloat(m[0]);
    };
    const mul = () => { let v = num(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = num(); v = op === '*' ? v * r : v / r; } return v; };
    const add = () => { let v = mul(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = mul(); v = op === '+' ? v + r : v - r; } return v; };
    try { const v = add(); return i === s.length && isFinite(v) ? v : -1; } catch (e) { return -1; }
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Unicode date patterns (the kind Beat uses): d dd M MM MMM MMMM y yy yyyy E EEEE H HH h hh m mm a, 'quoted text'.
  function formatDate(pattern, d) {
    d = d || new Date();
    pattern = pattern || 'd.M.y';
    const pad = (n, w) => String(n).padStart(w, '0');
    let out = '', i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === "'") {
        const e = pattern.indexOf("'", i + 1);
        out += e === -1 ? pattern.slice(i + 1) : (e === i + 1 ? "'" : pattern.slice(i + 1, e));
        i = e === -1 ? pattern.length : e + 1; continue;
      }
      if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
      let n = 1; while (pattern[i + n] === c) n++;
      i += n;
      switch (c) {
        case 'd': out += pad(d.getDate(), n); break;
        case 'M': case 'L': out += n >= 4 ? MONTHS[d.getMonth()] : n === 3 ? MONTHS[d.getMonth()].slice(0, 3) : pad(d.getMonth() + 1, n); break;
        case 'y': case 'Y': case 'u': out += n === 2 ? pad(d.getFullYear() % 100, 2) : pad(d.getFullYear(), n); break;
        case 'E': case 'e': case 'c': out += n >= 4 ? DAYS[d.getDay()] : DAYS[d.getDay()].slice(0, 3); break;
        case 'H': out += pad(d.getHours(), n); break;
        case 'h': out += pad(d.getHours() % 12 || 12, n); break;
        case 'm': out += pad(d.getMinutes(), n); break;
        case 's': out += pad(d.getSeconds(), n); break;
        case 'a': out += d.getHours() < 12 ? 'AM' : 'PM'; break;
        default: out += c.repeat(n);
      }
    }
    return out;
  }

  function MacroParser(now) {
    this.macros = new Map();
    this.panel = 0;
    this.refs = [];
    this.now = now || new Date();
  }
  MacroParser.prototype.resetPanel = function () { this.panel = 0; };
  /* Resolve one macro (the text between {{ and }}). Returns a string, or null for an invalid macro. */
  MacroParser.prototype.resolve = function (body) {
    const trimmed = String(body).trim();
    const eq = trimmed.indexOf('=');
    const left = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim();
    const right = eq === -1 ? null : trimmed.slice(eq + 1).trim();
    const words = left.split(/\s+/).filter(Boolean);
    let type = 'string', name = '', params = '';
    if (words.length > 1 && MACRO_TYPES.includes(words[0].toLowerCase())) {
      type = words[0].toLowerCase();
      if (type === 'date' || type === 'ref') params = words.slice(1).join(' ');
      else name = words[1];
    } else name = words[0] || '';
    if (type !== 'date') name = name.toLowerCase();
    let sub = -1;
    if (name.includes('.') && type !== 'date') {
      const parts = name.split('.');
      name = parts[0];
      for (let k = 1; k < parts.length; k++) { if (parts[k] === 'sub') sub++; else break; }
    }
    if (name === 'date' || name === 'panel' || name === 'references') { type = name; name = ''; }
    if (!name && !['date', 'ref', 'references', 'panel'].includes(type)) return null;

    if (type === 'date') return formatDate(right != null && !params ? right : params, this.now);
    if (type === 'panel') { if (right != null) this.panel = evalNumber(right); else this.panel++; return String(this.panel); }
    if (type === 'ref') { this.refs.push(right != null ? right : params); return '[' + this.refs.length + ']'; }
    if (type === 'references') return this.refs.map((r, k) => `[${k + 1}] ${r}`).join('\n');

    let m = this.macros.get(name);
    if (!m) { m = { type: type === 'series' ? 'serial' : type, value: null, subs: {} }; this.macros.set(name, m); }
    if (right != null) {
      if (m.type === 'serial' || m.type === 'number') { m.value = evalNumber(right); m.subs = {}; }
      else m.value = right;
    } else {
      if (m.value == null) m.value = m.type === 'string' ? '' : 0;
      if (m.type === 'serial') {
        if (sub === -1) { m.value = (+m.value || 0) + 1; m.subs = {}; }
        else m.subs[sub] = (m.subs[sub] || 0) + 1;
      }
    }
    if (m.type === 'string') return String(m.value == null ? '' : m.value);
    if (sub !== -1) return String(m.subs[sub] != null ? m.subs[sub] : -1);
    const v = +m.value;
    return String(Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);
  };
  /* Replace every {{…}} in a string, left to right. Invalid macros print as nothing. */
  MacroParser.prototype.apply = function (text) {
    if (!text || text.indexOf('{{') === -1) return text;
    return text.replace(/\{\{([\s\S]*?)\}\}/g, (all, body) => { const v = this.resolve(body); return v == null ? '' : v; });
  };

  /*
   * Resolve macros for a parsed script, in reading order.
   * Returns { lines: Map(lineIndex → resolved content), title: Map(fieldIndex → resolved value) }.
   */
  function resolveMacros(parsed, now) {
    const P = new MacroParser(now);
    const lines = new Map(), title = new Map();
    let any = false;
    (parsed.title || []).forEach((f, k) => { if (f.value && f.value.includes('{{')) { title.set(k, P.apply(f.value)); any = true; } });
    for (const L of parsed.lines) {
      if (L.type === 'section' && L.depth === 1) P.resetPanel();
      if (L.type === 'title' || L.type === 'boneyard' || L.type === 'note' || L.type === 'empty') continue;
      const c = L.content;
      if (typeof c === 'string' && c.includes('{{')) { lines.set(L.index, P.apply(c)); any = true; }
    }
    return any ? { lines, title } : null;
  }

  /* ---------------- Settings helpers ---------------- */
  /* Print options the document overrides (only the keys it actually has). */
  function printOverrides(settings) {
    const o = {};
    if (!settings) return o;
    if (K.pageSize in settings) o.paper = +settings[K.pageSize] === 0 ? 'a4' : 'letter';
    if (K.printSceneNumbers in settings) o.sceneNumbers = !!settings[K.printSceneNumbers];
    if (K.hidePageNumbers in settings) o.hidePageNumbers = !!settings[K.hidePageNumbers];
    if (K.firstPageNumber in settings) { const n = parseInt(settings[K.firstPageNumber], 10); if (n > 0) o.firstPageNumber = n; }
    if (K.printHeadingColor in settings) o.printHeadingColor = !!settings[K.printHeadingColor];
    return o;
  }
  function sceneStart(settings) {
    const n = settings ? parseInt(settings[K.sceneStart], 10) : NaN;
    return n > 0 ? n : 1;
  }
  function hiddenRevisions(settings) {
    const h = settings && settings[K.hiddenRevisions];
    return new Set(Array.isArray(h) ? h.map(Number) : []);
  }

  const api = {
    START, END, ALT_PREFIX, GENERATIONS, LEGACY_REVISIONS, TAG_TYPES, KEYS: K,
    read, write, parseAlternative, formatAlternative,
    flatten, revisionsForSaving, revisionsFromSettings, reviewsFromSettings, reviewsForSaving,
    tagsFromSettings, tagsForSaving, headingUUIDs,
    MacroParser, resolveMacros, formatDate, evalNumber,
    printOverrides, sceneStart, hiddenRevisions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatDoc = api;
})(typeof window !== 'undefined' ? window : globalThis);
