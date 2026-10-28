/*
 * Offbeat — Final Draft (.fdx) import/export and screenplay statistics
 */
(function (root) {
  'use strict';
  const F = (typeof module !== 'undefined' && module.exports) ? require('./fountain.js') : root.Fountain;

  const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function textNodes(content) {
    const runs = F.parseInline(content);
    if (!runs.length) return '<Text></Text>';
    return runs.map(r => {
      const st = [r.b && 'Bold', r.i && 'Italic', r.u && 'Underline'].filter(Boolean).join('+');
      return `<Text${st ? ` Style="${st}"` : ''}>${xmlEsc(r.text)}</Text>`;
    }).join('');
  }

  function para(type, content, attrs) {
    return `    <Paragraph Type="${type}"${attrs || ''}>${textNodes(content)}</Paragraph>\n`;
  }

  function dialogueParas(block) {
    let s = para('Character', block.cue.content.toUpperCase());
    for (const p of block.parts) {
      if (p.type === 'parenthetical') s += para('Parenthetical', p.content);
      else s += para('Dialogue', p.raw === '  ' ? '' : p.content);
    }
    return s;
  }

  function toFDX(text) {
    const parsed = F.parse(text);
    let body = '';
    for (const el of parsed.elements) {
      switch (el.type) {
        case 'heading':
          body += para('Scene Heading', el.l.content, ` Number="${xmlEsc(el.l.sceneNumber)}"`); break;
        case 'action':
          body += para('Action', el.lines.map(l => l.content).join('\n')); break;
        case 'dialogue-block':
          body += dialogueParas(el); break;
        case 'dual':
          body += `    <Paragraph>\n      <DualDialogue>\n${dialogueParas(el.left)}${dialogueParas(el.right)}      </DualDialogue>\n    </Paragraph>\n`; break;
        case 'transition':
          body += para('Transition', el.l.content.toUpperCase()); break;
        case 'centered':
          body += para('Action', el.l.content, ' Alignment="Center"'); break;
        case 'lyrics':
          body += el.lines.map(l => para('Lyrics', l.content)).join(''); break;
        case 'pagebreak':
          body += `    <Paragraph Type="Action" StartsNewPage="Yes"><Text></Text></Paragraph>\n`; break;
        case 'section':
          body += `    <Paragraph Type="Outline ${Math.min(el.l.depth, 3)}"><Text>${xmlEsc(el.l.content)}</Text></Paragraph>\n`; break;
        case 'synopsis':
          body += `    <Paragraph Type="Outline Body"><Text>${xmlEsc(el.l.content)}</Text></Paragraph>\n`; break;
      }
    }
    let title = '';
    if (parsed.title.length) {
      const get = (k) => (parsed.title.find(f => f.key.toLowerCase() === k) || {}).value || '';
      const center = (v) => v.split('\n').map(x => `      <Paragraph Alignment="Center" Type="Title">${textNodes(x)}</Paragraph>\n`).join('');
      const left = (v) => v.split('\n').map(x => `      <Paragraph Alignment="Left" Type="Title">${textNodes(x)}</Paragraph>\n`).join('');
      const blank = (n) => '      <Paragraph Type="Title"><Text></Text></Paragraph>\n'.repeat(n);
      title = '  <TitlePage>\n    <Content>\n' + blank(16) + center(get('title')) + blank(3) +
        (get('credit') ? center(get('credit')) + blank(1) : '') + center(get('author') || get('authors')) +
        (get('source') ? blank(2) + center(get('source')) : '') + blank(14) +
        left(get('contact')) + (get('draft date') ? blank(1) + left(get('draft date')) : '') +
        '    </Content>\n  </TitlePage>\n';
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${body}  </Content>
${title}</FinalDraft>
`;
  }

  /* ---------- Import ---------- */
  function paraText(p) {
    const texts = Array.from(p.getElementsByTagName('Text'));
    return texts.map(t => {
      let s = t.textContent;
      const style = (t.getAttribute('Style') || '');
      if (!s) return '';
      if (style.includes('Underline')) s = `_${s}_`;
      if (style.includes('Bold') && style.includes('Italic')) s = `***${s}***`;
      else if (style.includes('Bold')) s = `**${s}**`;
      else if (style.includes('Italic')) s = `*${s}*`;
      return s;
    }).join('').replace(/\*\*\*\*\*\*|\*\*\*\*|__/g, '');
  }

  function fromFDX(xml, DOMParserImpl) {
    const DP = DOMParserImpl || root.DOMParser;
    const doc = new DP().parseFromString(xml, 'text/xml');
    const out = [];
    const titleLines = [];

    const tp = doc.getElementsByTagName('TitlePage')[0];
    if (tp) {
      const ps = Array.from(tp.getElementsByTagName('Paragraph')).map(p => ({ t: paraText(p).trim(), a: p.getAttribute('Alignment') }));
      const center = ps.filter(p => p.t && p.a === 'Center').map(p => p.t);
      const leftish = ps.filter(p => p.t && p.a !== 'Center').map(p => p.t);
      if (center.length) {
        titleLines.push('Title: ' + center[0]);
        const byIdx = center.findIndex(c => /^(written )?by$|^screenplay by$|^story by/i.test(c));
        if (byIdx > 0) {
          titleLines.push('Credit: ' + center[byIdx]);
          if (center[byIdx + 1]) titleLines.push('Author: ' + center[byIdx + 1]);
          if (center.length > byIdx + 2) titleLines.push('Source: ' + center.slice(byIdx + 2).join(' '));
        } else if (center[1]) titleLines.push('Author: ' + center.slice(1).join(' '));
      }
      if (leftish.length) titleLines.push('Contact:\n' + leftish.map(l => '    ' + l).join('\n'));
      titleLines.push('');
    }

    const content = doc.getElementsByTagName('Content')[0];
    if (!content) throw new Error('Not a Final Draft document');
    const blank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };

    const handle = (p, inDual, dualIndex) => {
      const type = p.getAttribute('Type') || '';
      const dual = p.getElementsByTagName('DualDialogue')[0];
      if (dual) {
        let cueCount = 0;
        Array.from(dual.children).forEach(c => { if (c.tagName === 'Paragraph') { if (c.getAttribute('Type') === 'Character') cueCount++; handle(c, true, cueCount); } });
        return;
      }
      let t = paraText(p);
      if (p.getAttribute('StartsNewPage') === 'Yes') { blank(); out.push('==='); }
      switch (type) {
        case 'Scene Heading': {
          blank();
          let h = t.trim().toUpperCase();
          if (!F.HEADING_RE.test(h)) h = '.' + h;
          const n = p.getAttribute('Number');
          out.push(n ? `${h} #${n}#` : h); out.push(''); break;
        }
        case 'Character': {
          blank();
          let c = t.trim().toUpperCase();
          if (!F.isCharacterCue(c)) c = '@' + c;
          if (inDual && dualIndex === 2) c += ' ^';
          out.push(c); break;
        }
        case 'Parenthetical': {
          let s = t.trim();
          if (!s.startsWith('(')) s = '(' + s + ')';
          out.push(s); break;
        }
        case 'Dialogue':
          t.split('\n').forEach(x => out.push(x.trim() === '' ? '  ' : x)); break;
        case 'Transition': {
          blank();
          const s = t.trim().toUpperCase();
          out.push(/TO:$/.test(s) ? s : '> ' + s); out.push(''); break;
        }
        case 'Lyrics':
          blank(); out.push('~' + t.trim()); break;
        case 'Shot':
          blank(); out.push(t.trim().toUpperCase()); out.push(''); break;
        default: {
          if (/^Outline \d/.test(type)) { blank(); out.push('#'.repeat(parseInt(type.slice(8), 10) || 1) + ' ' + t.trim()); out.push(''); break; }
          if (type === 'Outline Body') { blank(); out.push('= ' + t.trim()); out.push(''); break; }
          if (!t.trim()) break;
          blank();
          if (p.getAttribute('Alignment') === 'Center') out.push('> ' + t.trim() + ' <');
          else {
            // protect lines that would otherwise parse as something else
            t.split('\n').forEach((x, k) => {
              const needsForce = k === 0 && (F.HEADING_RE.test(x) || (F.isCharacterCue(x) && !/^[A-Z ]+[.!]$/.test(x)));
              out.push(needsForce ? '!' + x : x);
            });
          }
          out.push('');
        }
      }
    };

    Array.from(content.children).forEach(p => { if (p.tagName === 'Paragraph') handle(p, false, 0); });
    let text = (titleLines.length ? titleLines.join('\n') + '\n' : '') + out.join('\n');
    return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ---------- Statistics ---------- */
  function stats(text, paginated) {
    const p = F.parse(text);
    const chars = {};
    let cur = null;
    let sceneCount = 0, intC = 0, extC = 0, intExtC = 0, day = 0, night = 0, otherTime = 0;
    const locations = {};
    let words = 0;
    for (const L of p.lines) {
      if (L.type === 'title' || L.type === 'boneyard' || L.type === 'note') continue;
      if (['action', 'dialogue', 'heading', 'character', 'parenthetical', 'transition', 'lyrics', 'centered'].includes(L.type)) {
        const w = (L.content || '').trim().split(/\s+/).filter(Boolean).length; words += w;
      }
      if (L.type === 'heading') {
        sceneCount++;
        const h = L.content;
        if (/^(INT\.?\/EXT|INT\/EXT|I\/E|I\.\/E)/i.test(h)) intExtC++;
        else if (/^INT/i.test(h)) intC++;
        else if (/^EXT/i.test(h)) extC++;
        const parts = h.replace(/^(INT\.?\/EXT\.?|INT\/EXT\.?|I\/E\.?|I\.\/E\.?|INT\.?|EXT\.?|EST\.?)\s*/i, '').split(/\s+[-–—]\s+/);
        const loc = (parts[0] || '').trim();
        const time = (parts[parts.length - 1] || '').trim();
        if (loc) locations[loc] = (locations[loc] || 0) + 1;
        if (parts.length > 1) {
          if (/DAY|MORNING|AFTERNOON|DAWN|NOON/i.test(time)) day++;
          else if (/NIGHT|EVENING|DUSK/i.test(time)) night++;
          else otherTime++;
        } else otherTime++;
      }
      if (L.type === 'character') {
        cur = L.name;
        if (!chars[cur]) chars[cur] = { name: cur, blocks: 0, lines: 0, words: 0, scenes: new Set() };
        chars[cur].blocks++;
        chars[cur].scenes.add(sceneCount);
      } else if (L.type === 'dialogue' && cur) {
        chars[cur].lines++;
        chars[cur].words += (L.content || '').trim().split(/\s+/).filter(Boolean).length;
      } else if (L.type !== 'parenthetical') cur = null;
    }
    const characters = Object.values(chars).map(c => Object.assign(c, { scenes: c.scenes.size }))
      .sort((a, b) => b.words - a.words);
    const locs = Object.entries(locations).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      pages: paginated ? paginated.pages.length : null,
      scenes: sceneCount, words, int: intC, ext: extC, intExt: intExtC, day, night, otherTime,
      characters, locations: locs
    };
  }

  const api = { toFDX, fromFDX, stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDX = api;
})(typeof window !== 'undefined' ? window : globalThis);
