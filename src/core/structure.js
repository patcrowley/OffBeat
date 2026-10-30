/*
 * Offbeat — moving scenes around the script (used by the index cards)
 * Pure text functions so they can be tested without the editor.
 */
(function (root) {
  'use strict';
  const F = (typeof module !== 'undefined' && module.exports) ? require('./fountain.js') : root.Fountain;

  /*
   * Move the scenes whose headings are on `sceneLines` so they sit, in script order,
   * just before line `before` (a scene or section heading), or at the end when `before` is null.
   * Exactly one blank line is left around the moved group and where each scene came from.
   * Returns { text, lines } where `lines` are the moved headings' new line numbers,
   * or null when nothing would change.
   */
  function moveScenes(text, sceneLines, before) {
    const parsed = F.parse(text);
    const lines = text.split('\n');
    const items = parsed.outline
      .filter(o => o.type === 'scene' && sceneLines.includes(o.line))
      .sort((a, b) => a.line - b.line);
    if (!items.length) return null;
    if (before !== null && before !== undefined && items.some(it => before >= it.line && before <= it.endLine)) {
      // dropping onto one of the moved scenes: put the group where that scene starts
      before = items.find(it => before >= it.line && before <= it.endLine).line;
      if (items.some(it => it.line === before) && items.length === 1) return null;
    }

    const removed = new Set();
    const blocks = items.map(it => {
      const b = [];
      for (let k = it.line; k <= it.endLine; k++) { b.push(lines[k]); removed.add(k); }
      while (b.length > 1 && b[b.length - 1].trim() === '') b.pop();
      return b;
    });

    // Lines that stay, remembering where the target ended up.
    const remaining = [];
    let target = null;
    for (let k = 0; k < lines.length; k++) {
      if (k === before) target = remaining.length;
      if (!removed.has(k)) remaining.push(lines[k]);
    }
    if (before === null || before === undefined || target === null) target = remaining.length;

    let prev = target - 1;
    while (prev >= 0 && remaining[prev].trim() === '') prev--;
    const head = remaining.slice(0, prev + 1);
    const tail = remaining.slice(target);
    while (tail.length && tail[0].trim() === '') tail.shift();

    const group = [];
    const offsets = [];
    blocks.forEach((b, i) => { if (i) group.push(''); offsets.push(group.length); group.push(...b); });

    const out = head.slice();
    if (out.length) out.push('');
    const start = out.length;
    out.push(...group);
    out.push('');
    if (tail.length) out.push(...tail);
    else if (lines[lines.length - 1] !== '') out.pop();   // keep the file's original ending

    const result = out.join('\n');
    if (result === text) return null;
    return { text: result, lines: offsets.map(o => start + o) };
  }

  /* Smallest line range that differs between two texts, for a minimal editor update. */
  function lineDiff(oldText, newText) {
    const a = oldText.split('\n'), b = newText.split('\n');
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    return { from: p, oldEnd: a.length - s, newLines: b.slice(p, b.length - s), oldCount: a.length, suffix: s };
  }

  /* Sections a card can be sent to, with the line to insert before (end of that section). */
  function sectionTargets(parsed) {
    const secs = parsed.outline.filter(o => o.type === 'section');
    return secs.map((s, i) => {
      const next = secs.slice(i + 1).find(n => n.depth <= s.depth);
      return { title: s.title, depth: s.depth, line: s.line, before: next ? next.line : null };
    });
  }

  const api = { moveScenes, lineDiff, sectionTargets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Structure = api;
})(typeof window !== 'undefined' ? window : globalThis);
