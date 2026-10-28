/*
 * Offbeat — Fountain parser
 * Classifies every source line of a .fountain document and groups them into
 * screenplay elements. Works in Node (tests) and in the renderer.
 */
(function (root) {
  'use strict';

  const SETTINGS_START = "/* If you're seeing this, you can remove the following stuff - BEAT:";
  const SETTINGS_END = 'END_BEAT */';

  const HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E|I\.\/E)[.\s]/i;
  const SCENE_NUM_RE = /\s*#([\w.\-]+)#\s*$/;
  const COLOR_RE = /\[\[\s*COLOR\s+([a-z#0-9]+)\s*\]\]/i;
  const TITLE_KEY_RE = /^([A-Za-z][A-Za-z0-9 _\-]*):(.*)$/;

  const COLORS = {
    red: '#e5484d', blue: '#3e8ef7', green: '#30a46c', pink: '#e93d82', orange: '#f76b15',
    brown: '#a07553', cyan: '#00a2c7', magenta: '#d23ad6', yellow: '#e2b500', purple: '#8e4ec6',
    gray: '#8b8d98', grey: '#8b8d98', teal: '#12a594', olive: '#8a8f3c', mint: '#4cc38a'
  };

  function isEmptyText(t) { return t.trim() === ''; }

  /* Remove boneyard and notes from a line, tracking multi-line state. */
  function stripLine(text, state) {
    let out = '';
    let i = 0;
    let hadNote = false, hadBone = false;
    while (i < text.length) {
      if (state.bone) {
        const end = text.indexOf('*/', i);
        hadBone = true;
        if (end === -1) { i = text.length; break; }
        state.bone = false; i = end + 2; continue;
      }
      if (state.note) {
        const end = text.indexOf(']]', i);
        hadNote = true;
        if (end === -1) { i = text.length; break; }
        state.note = false; i = end + 2; continue;
      }
      const b = text.indexOf('/*', i);
      const n = text.indexOf('[[', i);
      let next = -1, kind = null;
      if (b !== -1 && (n === -1 || b < n)) { next = b; kind = 'bone'; }
      else if (n !== -1) { next = n; kind = 'note'; }
      if (next === -1) { out += text.slice(i); break; }
      out += text.slice(i, next);
      i = next + 2;
      state[kind] = true;
    }
    return { text: out, hadNote, hadBone };
  }

  function isCharacterCue(t) {
    let s = t.trim();
    if (!s) return false;
    if (s.endsWith('^')) s = s.slice(0, -1).trim();
    // remove extensions like (V.O.) (CONT'D)
    const name = s.replace(/\(.*?\)/g, '').trim();
    if (!name) return false;
    if (!/[A-Z]/.test(name)) return false;
    if (name !== name.toUpperCase()) return false;
    if (/^[\d\W_]+$/.test(name)) return false;
    return true;
  }

  function characterName(t) {
    let s = t.trim();
    if (s.startsWith('@')) s = s.slice(1);
    if (s.endsWith('^')) s = s.slice(0, -1);
    return s.replace(/\(.*?\)/g, '').trim().toUpperCase();
  }

  /* ---------- Title page ---------- */
  function parseTitlePage(rawLines) {
    const first = rawLines[0] || '';
    const m = first.match(TITLE_KEY_RE);
    if (!m || HEADING_RE.test(first)) return { fields: [], end: 0 };
    const fields = [];
    let i = 0;
    let current = null;
    for (; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (isEmptyText(line)) break;
      const km = line.match(TITLE_KEY_RE);
      if (km && !/^\s/.test(line)) {
        current = { key: km[1].trim(), value: [] , line: i };
        const v = km[2].trim();
        if (v) current.value.push(v);
        fields.push(current);
      } else if (current) {
        current.value.push(line.trim());
      }
    }
    return { fields: fields.map(f => ({ key: f.key, value: f.value.join('\n'), line: f.line })), end: i };
  }

  /* ---------- Main parse ---------- */
  function parse(text) {
    text = (text || '').replace(/\r\n?/g, '\n');
    const raw = text.split('\n');
    const title = parseTitlePage(raw);
    const lines = new Array(raw.length);
    const st = { bone: false, note: false };

    // Pass 1: strip boneyard/notes and mark settings block
    const stripped = new Array(raw.length);
    let inSettings = false;
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i];
      if (t.startsWith(SETTINGS_START)) inSettings = true;
      if (inSettings) {
        stripped[i] = { text: '', hadBone: true, hadNote: false, settings: true };
        if (t.includes(SETTINGS_END)) inSettings = false;
        st.bone = false;
        continue;
      }
      const wasBone = st.bone, wasNote = st.note;
      const s = stripLine(t, st);
      s.startedInBone = wasBone; s.startedInNote = wasNote;
      stripped[i] = s;
    }

    const effEmpty = (i) => {
      if (i < title.end) return true;
      if (i < 0 || i >= raw.length) return true;
      return isEmptyText(stripped[i].text);
    };

    let prevType = 'empty';
    let sceneCounter = 0;
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i];
      const s = stripped[i];
      const L = { index: i, raw: t, text: s.text, type: 'action', forced: false };
      lines[i] = L;

      if (i < title.end) { L.type = 'title'; prevType = 'empty'; continue; }
      if (s.settings) { L.type = 'boneyard'; L.settings = true; prevType = 'empty'; continue; }

      const clean = s.text;
      const trimmed = clean.trim();

      if (trimmed === '') {
        if (s.hadNote && !s.hadBone) L.type = 'note';
        else if (s.hadBone) L.type = 'boneyard';
        else if (t === '  ' && (prevType === 'dialogue' || prevType === 'parenthetical')) {
          L.type = 'dialogue'; prevType = 'dialogue'; continue;
        } else L.type = 'empty';
        // notes / boneyard lines don't break dialogue blocks visually but do act as separators
        prevType = 'empty';
        continue;
      }

      const prevEmpty = effEmpty(i - 1);
      const nextEmpty = effEmpty(i + 1);
      const inDialogue = !prevEmpty && (prevType === 'character' || prevType === 'dialogue' || prevType === 'parenthetical');

      if (inDialogue) {
        if (trimmed.startsWith('(')) L.type = 'parenthetical';
        else L.type = 'dialogue';
      } else if (/^={3,}$/.test(trimmed)) {
        L.type = 'pagebreak';
      } else if (trimmed.startsWith('#')) {
        L.type = 'section';
        L.depth = trimmed.match(/^#+/)[0].length;
        L.content = trimmed.replace(/^#+\s*/, '');
      } else if (trimmed.startsWith('=')) {
        L.type = 'synopsis';
        L.content = trimmed.replace(/^=\s*/, '');
      } else if (trimmed.startsWith('~')) {
        L.type = 'lyrics'; L.forced = true;
        L.content = trimmed.replace(/^~\s*/, '');
      } else if (trimmed.startsWith('!')) {
        L.type = 'action'; L.forced = true;
      } else if (/^\.[^.]/.test(trimmed)) {
        L.type = 'heading'; L.forced = true;
      } else if (trimmed.startsWith('>') && trimmed.endsWith('<') && trimmed.length > 1) {
        L.type = 'centered'; L.forced = true;
        L.content = trimmed.slice(1, -1).trim();
      } else if (trimmed.startsWith('>')) {
        L.type = 'transition'; L.forced = true;
        L.content = trimmed.slice(1).trim();
      } else if (trimmed.startsWith('@')) {
        L.type = 'character'; L.forced = true;
      } else if (prevEmpty && HEADING_RE.test(trimmed)) {
        L.type = 'heading';
      } else if (prevEmpty && nextEmpty && trimmed === trimmed.toUpperCase() && /TO:$/.test(trimmed)) {
        L.type = 'transition';
        L.content = trimmed;
      } else if (prevEmpty && !nextEmpty && isCharacterCue(trimmed)) {
        L.type = 'character';
      } else {
        L.type = 'action';
      }

      if (L.type === 'heading') {
        let h = trimmed;
        if (L.forced) h = h.slice(1);
        const cm = t.match(COLOR_RE);
        if (cm) L.color = cm[1].toLowerCase();
        const nm = h.match(SCENE_NUM_RE);
        if (nm) { L.sceneNumber = nm[1]; h = h.replace(SCENE_NUM_RE, ''); }
        else { sceneCounter++; L.sceneNumber = String(sceneCounter); }
        if (nm) {
          const n = parseInt(nm[1], 10);
          if (!isNaN(n)) sceneCounter = n;
        }
        L.content = h.trim().toUpperCase();
      }
      if (L.type === 'character') {
        L.name = characterName(trimmed);
        L.dual = trimmed.endsWith('^');
        let c = trimmed;
        if (c.startsWith('@')) c = c.slice(1);
        if (L.dual) c = c.slice(0, -1);
        L.content = c.trim();
      }
      if (L.type === 'section' || L.type === 'synopsis') {
        const cm = t.match(COLOR_RE);
        if (cm) L.color = cm[1].toLowerCase();
      }
      if (L.content === undefined) {
        let c = clean;
        if (L.type === 'action' && L.forced) c = c.replace(/^\s*!/, '');
        L.content = L.type === 'action' ? c.replace(/\s+$/, '') : c.trim();
      }
      prevType = L.type;
    }

    const elements = buildElements(lines);
    const outline = buildOutline(lines);
    return { raw, lines, title: title.fields, titleEnd: title.end, elements, outline };
  }

  /* ---------- Elements for printing ---------- */
  function buildElements(lines) {
    const els = [];
    let i = 0;
    while (i < lines.length) {
      const L = lines[i];
      switch (L.type) {
        case 'character': {
          const block = { type: 'dialogue-block', line: i, cue: L, parts: [], dual: L.dual, name: L.name };
          let j = i + 1;
          while (j < lines.length && (lines[j].type === 'dialogue' || lines[j].type === 'parenthetical')) {
            block.parts.push(lines[j]); j++;
          }
          if (L.dual) {
            // pair with previous dialogue block (skip notes/empties)
            for (let k = els.length - 1; k >= 0; k--) {
              const e = els[k];
              if (e.type === 'dialogue-block' && !e.dual) {
                els.splice(k, 1);
                els.push({ type: 'dual', line: e.line, left: e, right: block });
                block._paired = true;
                break;
              }
              if (e.type !== 'note') break;
            }
          }
          if (!block._paired) els.push(block);
          i = j; continue;
        }
        case 'action': {
          const el = { type: 'action', line: i, lines: [L] };
          let j = i + 1;
          while (j < lines.length && lines[j].type === 'action') { el.lines.push(lines[j]); j++; }
          els.push(el); i = j; continue;
        }
        case 'lyrics': {
          const el = { type: 'lyrics', line: i, l: L, lines: [L] };
          let j = i + 1;
          while (j < lines.length && lines[j].type === 'lyrics') { el.lines.push(lines[j]); j++; }
          els.push(el); i = j; continue;
        }
        case 'heading': case 'transition': case 'centered': case 'pagebreak':
        case 'section': case 'synopsis':
          els.push({ type: L.type, line: i, l: L });
          break;
        case 'dialogue': case 'parenthetical':
          // orphaned (shouldn't happen) — treat as action
          els.push({ type: 'action', line: i, lines: [L] });
          break;
      }
      i++;
    }
    // merge consecutive lyrics/centered into same element group is not needed
    return els;
  }

  /* ---------- Outline ---------- */
  function buildOutline(lines) {
    const items = [];
    let current = null;
    let currentSection = null;
    for (const L of lines) {
      if (L.type === 'section') {
        currentSection = { type: 'section', line: L.index, depth: L.depth, title: L.content, color: L.color, synopsis: [] };
        items.push(currentSection);
        current = currentSection;
      } else if (L.type === 'heading') {
        current = {
          type: 'scene', line: L.index, title: L.content, number: L.sceneNumber, color: L.color,
          synopsis: [], notes: [], snippet: '', characters: new Set(), endLine: L.index,
          section: currentSection ? currentSection.title : null
        };
        items.push(current);
      } else if (current) {
        if (L.type === 'synopsis') current.synopsis.push(L.content);
        else if (current.type === 'scene') {
          if (L.type === 'character') current.characters.add(L.name);
          if (L.type === 'note') {
            const m = L.raw.match(/\[\[(.*?)\]\]/);
            if (m && !COLOR_RE.test(L.raw)) current.notes.push(m[1].trim());
          }
          if (!current.snippet && L.type === 'action' && L.content.trim()) current.snippet = L.content.trim();
        }
      }
      if (current && current.type === 'scene' && L.type !== 'section') current.endLine = L.index;
    }
    // endLine for scenes: until the line before next scene/section
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const next = items[k + 1];
      it.endLine = next ? next.line - 1 : lines.length - 1;
      if (it.characters) it.characters = Array.from(it.characters);
    }
    return items;
  }

  /* ---------- Inline markup ---------- */
  // Returns runs: [{text, b, i, u}]
  const ESC = { '*': '', '_': '' };
  function parseInline(text) {
    if (!text) return [];
    let s = text.replace(/\\([*_])/g, (m, c) => ESC[c]);
    s = s.replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '$1');
    s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1');
    s = s.replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1');
    s = s.replace(/_(?=\S)(.+?)(?<=\S)_/g, '$1');
    const runs = [];
    let b = 0, it = 0, u = 0, buf = '';
    const push = () => { if (buf) { runs.push({ text: buf, b: b > 0, i: it > 0, u: u > 0 }); buf = ''; } };
    for (const ch of s) {
      switch (ch) {
        case '': push(); b++; break;
        case '': push(); b--; break;
        case '': push(); it++; break;
        case '': push(); it--; break;
        case '': push(); u++; break;
        case '': push(); u--; break;
        case '': buf += '*'; break;
        case '': buf += '_'; break;
        default: buf += ch;
      }
    }
    push();
    return runs;
  }

  function plainInline(text) { return parseInline(text).map(r => r.text).join(''); }

  /* Scene color helper */
  function colorValue(name) {
    if (!name) return null;
    name = name.toLowerCase();
    if (name.startsWith('#')) return name;
    return COLORS[name] || null;
  }

  /* Extract Beat settings block (kept verbatim on save) */
  function splitSettings(text) {
    const idx = text.indexOf(SETTINGS_START);
    if (idx === -1) return { body: text, settings: null };
    const end = text.indexOf(SETTINGS_END, idx);
    const json = text.slice(idx + SETTINGS_START.length, end === -1 ? undefined : end).trim();
    let data = null;
    try { data = JSON.parse(json); } catch (e) { /* ignore */ }
    return { body: text.slice(0, idx), settings: data, raw: text.slice(idx) };
  }

  const api = { parse, parseInline, plainInline, isCharacterCue, characterName, colorValue, COLORS,
    HEADING_RE, COLOR_RE, splitSettings, SETTINGS_START, SETTINGS_END };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fountain = api;
})(typeof window !== 'undefined' ? window : globalThis);
