/*
 * CodeMirror mode for Fountain inline styling (markup characters, emphasis,
 * notes, boneyard). Element-level formatting (indents, caps, alignment) is
 * applied separately as line classes from the full parser.
 */
(function () {
  'use strict';

  function lineStyles(text, start) {
    const n = text.length;
    const st = new Array(n).fill('');
    let bone = start.bone, note = start.note;
    let i = 0;
    // pass 1: boneyard / notes
    while (i < n) {
      if (bone) {
        const e = text.indexOf('*/', i);
        const end = e === -1 ? n : e + 2;
        for (let k = i; k < end; k++) st[k] = 'boneyard';
        if (e !== -1) bone = false;
        i = end; continue;
      }
      if (note) {
        const e = text.indexOf(']]', i);
        const end = e === -1 ? n : e + 2;
        for (let k = i; k < end; k++) st[k] = 'note';
        if (e !== -1) note = false;
        i = end; continue;
      }
      if (text.startsWith('/*', i)) { bone = true; continue; }
      if (text.startsWith('[[', i)) { note = true; continue; }
      i++;
    }
    // pass 2: emphasis (only in unstyled regions)
    const mark = (re, cls, open) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        let clear = true;
        for (let k = s; k < e; k++) if (st[k] === 'boneyard' || st[k] === 'note') { clear = false; break; }
        if (!clear) continue;
        for (let k = s; k < e; k++) st[k] = (st[k] ? st[k] + ' ' : '') + cls;
        for (let k = s; k < s + open; k++) st[k] += ' markup';
        for (let k = e - open; k < e; k++) st[k] += ' markup';
      }
    };
    const masked = text.replace(/\\[*_]/g, '  ');
    const run = (re, cls, open) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(masked))) {
        const s = m.index, e = s + m[0].length;
        let clear = true;
        for (let k = s; k < e; k++) if (/boneyard|note/.test(st[k])) { clear = false; break; }
        if (!clear) continue;
        for (let k = s; k < e; k++) st[k] = (st[k] ? st[k] + ' ' : '') + cls;
        for (let k = s; k < s + open; k++) st[k] += ' markup';
        for (let k = e - open; k < e; k++) st[k] += ' markup';
      }
    };
    void mark;
    run(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, 'strong em', 3);
    run(/(?<!\*)\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*(?!\*)/g, 'strong', 2);
    run(/(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, 'em', 1);
    run(/_(?=\S)(.+?)(?<=\S)_/g, 'underline', 1);
    // escapes
    for (let k = 0; k < n - 1; k++) if (text[k] === '\\' && /[*_]/.test(text[k + 1]) && !/boneyard|note/.test(st[k])) st[k] = 'markup';

    // pass 3: element markup characters
    const lead = text.match(/^\s*/)[0].length;
    const t = text.slice(lead);
    const addAt = (k, cls) => { if (k >= 0 && k < n && !/boneyard|note/.test(st[k])) st[k] = (st[k] ? st[k] + ' ' : '') + cls; };
    if (/^\.[^.]/.test(t) || /^[!@~>=]/.test(t)) addAt(lead, 'markup force');
    if (/^#/.test(t)) { const h = t.match(/^#+/)[0].length; for (let k = 0; k < h; k++) addAt(lead + k, 'markup force'); }
    if (/^>.*<\s*$/.test(t)) addAt(text.lastIndexOf('<'), 'markup force');
    if (/\^\s*$/.test(text) && !/^\s*$/.test(text.replace(/\^\s*$/, ''))) addAt(text.lastIndexOf('^'), 'markup force');
    const sn = text.match(/#[\w.\-]+#\s*$/);
    if (sn && !/^\s*#/.test(text)) for (let k = sn.index; k < sn.index + sn[0].trimEnd().length; k++) addAt(k, 'markup scene-num-text');

    return { st, end: { bone, note } };
  }

  CodeMirror.defineMode('fountain', function () {
    return {
      startState: () => ({ bone: false, note: false, styles: null, nextBone: false, nextNote: false }),
      copyState: (s) => ({ bone: s.bone, note: s.note, styles: s.styles, nextBone: s.nextBone, nextNote: s.nextNote }),
      blankLine: (s) => { /* states unchanged across empty lines */ },
      token: function (stream, state) {
        if (stream.sol()) {
          const r = lineStyles(stream.string, state);
          state.styles = r.st;
          state.nextBone = r.end.bone; state.nextNote = r.end.note;
        }
        const st = state.styles;
        const p = stream.pos;
        const cur = st[p] || '';
        let q = p + 1;
        while (q < st.length && (st[q] || '') === cur) q++;
        stream.pos = q;
        if (stream.eol()) { state.bone = state.nextBone; state.note = state.nextNote; }
        return cur || null;
      }
    };
  });

  // Exposed for the editor's own use
  window.FountainMode = { lineStyles };
})();
