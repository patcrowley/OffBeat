// Unit tests for the Fountain core (run: npm test)
const assert = require('assert');
const F = require('../src/core/fountain.js');
const P = require('../src/core/paginate.js');
const FDX = require('../src/core/fdx.js');
const { DOMParser } = require('@xmldom/xmldom');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const types = (txt) => F.parse(txt).lines.map(l => l.type);

t('title page', () => {
  const p = F.parse('Title: My Film\nAuthor: Pat\nContact:\n    a@b.c\n    555\n\nINT. HOUSE - DAY\n');
  assert.deepStrictEqual(p.title.map(f => f.key), ['Title', 'Author', 'Contact']);
  assert.strictEqual(p.title[2].value, 'a@b.c\n555');
  assert.strictEqual(p.lines[6].type, 'heading');
});
t('headings', () => {
  assert.deepStrictEqual(types('\nINT. HOUSE - DAY\n\next. yard\n\n.MONTAGE\n\nINTERIOR DESIGN\n'),
    ['empty', 'heading', 'empty', 'heading', 'empty', 'heading', 'empty', 'action', 'empty']);
  const p = F.parse('INT. HOUSE - DAY #12A#\n\nEXT. YARD [[COLOR RED]]\n');
  assert.strictEqual(p.lines[0].sceneNumber, '12A');
  assert.strictEqual(p.lines[2].sceneNumber, '13');
  assert.strictEqual(p.lines[2].color, 'red');
  assert.strictEqual(p.lines[2].content, 'EXT. YARD');
});
t('dialogue blocks', () => {
  assert.deepStrictEqual(types('BOB\n(quietly)\nHello.\nStill me.\n\nBOB (V.O.)\nHi.\n'),
    ['character', 'parenthetical', 'dialogue', 'dialogue', 'empty', 'character', 'dialogue', 'empty']);
  assert.deepStrictEqual(types('@McCLANE\nYippee.\n'), ['character', 'dialogue', 'empty']);
  assert.deepStrictEqual(types('BOOM!\n\nNot a cue.\n'), ['action', 'empty', 'action', 'empty']);
  assert.deepStrictEqual(types('!SHOUTING\nmore action\n'), ['action', 'action', 'empty']);
});
t('dual dialogue', () => {
  const p = F.parse('ANN\nHi.\n\nBOB ^\nHey.\n');
  assert.strictEqual(p.elements.length, 1);
  assert.strictEqual(p.elements[0].type, 'dual');
  assert.strictEqual(p.elements[0].right.name, 'BOB');
});
t('other elements', () => {
  assert.deepStrictEqual(types('\nCUT TO:\n\n> FADE OUT.\n\n> THE END <\n\n~la la\n# Act\n\n= synopsis\n\n===\n'),
    ['empty', 'transition', 'empty', 'transition', 'empty', 'centered', 'empty', 'lyrics', 'section', 'empty', 'synopsis', 'empty', 'pagebreak', 'empty']);
});
t('notes & boneyard', () => {
  const p = F.parse('Action [[note]] here.\n\n/* gone\nstill gone */\n\n[[\nmulti\n]]\n');
  assert.strictEqual(p.lines[0].content, 'Action  here.');
  assert.strictEqual(p.lines[2].type, 'boneyard');
  assert.strictEqual(p.lines[3].type, 'boneyard');
  assert.strictEqual(p.lines[6].type, 'note');
});
t('beat settings block preserved', () => {
  const s = F.splitSettings('INT. A\n\n' + F.SETTINGS_START + ' {"Revision":1} ' + F.SETTINGS_END + '\n');
  assert.deepStrictEqual(s.settings, { Revision: 1 });
  assert.strictEqual(s.body, 'INT. A\n\n');
  const p = F.parse('Hi\n\n' + F.SETTINGS_START + ' {"a":"BOB"}\n' + F.SETTINGS_END);
  assert.ok(p.lines.slice(2).every(l => l.type === 'boneyard'));
});
t('inline markup', () => {
  assert.deepStrictEqual(F.parseInline('a **b** *c* _d_ ***e*** \\*f\\*').filter(r => r.b || r.i || r.u).map(r => r.text), ['b', 'c', 'd', 'e']);
  assert.strictEqual(F.plainInline('\\*f\\*'), '*f*');
});
t('outline', () => {
  const p = F.parse('# Act One\n\nINT. A - DAY\n\n= syn\n\nBOB\nHi.\n\nEXT. B - NIGHT\n\nAction.\n');
  assert.deepStrictEqual(p.outline.map(o => o.type), ['section', 'scene', 'scene']);
  assert.deepStrictEqual(p.outline[1].synopsis, ['syn']);
  assert.deepStrictEqual(p.outline[1].characters, ['BOB']);
  assert.strictEqual(p.outline[2].snippet, 'Action.');
  assert.strictEqual(p.outline[1].endLine, 8);
});
t('pagination: page length and MORE/CONTD', () => {
  let s = 'INT. ROOM - DAY\n\n';
  for (let k = 0; k < 20; k++) s += 'Some action that fills a line.\n\n';
  s += 'BOB\n' + Array.from({ length: 30 }, (_, k) => `Sentence number ${k} goes here.`).join(' ') + '\n';
  const r = P.paginate(F.parse(s));
  assert.ok(r.pages.length >= 2);
  r.pages.forEach(pg => assert.ok(pg.lines.length <= 54, 'page too long ' + pg.lines.length));
  const p1 = r.pages[0].lines, p2 = r.pages[1].lines;
  assert.strictEqual(p1[p1.length - 1].kind, 'more');
  assert.ok(p2[0].kind === 'character' && p2[0].contd);
  assert.ok(p2[0].runs[0].text.includes("(CONT'D)"));
});
t('pagination: heading never orphaned', () => {
  let s = '';
  for (let k = 0; k < 26; k++) s += 'Line of action.\n\n';
  s += 'INT. NEW - DAY\n\nAction one.\n';
  const r = P.paginate(F.parse(s));
  const last = r.pages[0].lines.filter(l => l.kind !== 'blank').pop();
  assert.notStrictEqual(last.kind, 'heading');
});
t('pagination: forced page break', () => {
  const r = P.paginate(F.parse('Act.\n\n===\n\nNext.\n'));
  assert.strictEqual(r.pages.length, 2);
});
t('wrap widths', () => {
  const r = P.paginate(F.parse('BOB\n' + 'word '.repeat(40) + '\n'));
  r.pages[0].lines.filter(l => l.kind === 'dialogue').forEach(l => assert.ok(l.runs.map(x => x.text).join('').length <= 35));
});
t('FDX round trip', () => {
  const src = 'Title: Test\nAuthor: Pat\n\nINT. HOUSE - DAY #4#\n\nAction with **bold** and *it*.\n\nBOB\n(softly)\nHello there.\n\nANN\nHi.\n\nCARL ^\nHey.\n\nCUT TO:\n\nEXT. YARD - NIGHT\n\n~Sing it\n';
  const xml = FDX.toFDX(src);
  assert.ok(xml.includes('<Paragraph Type="Scene Heading" Number="4">'));
  assert.ok(xml.includes('<DualDialogue>'));
  assert.ok(xml.includes('Style="Bold"'));
  const back = FDX.fromFDX(xml, DOMParser);
  const p = F.parse(back);
  const ts = p.lines.map(l => l.type).filter(x => x !== 'empty');
  assert.deepStrictEqual(ts, ['title', 'title', 'heading', 'action', 'character', 'parenthetical', 'dialogue', 'character', 'dialogue', 'character', 'dialogue', 'transition', 'heading', 'lyrics']);
  assert.ok(back.includes('**bold**'));
  assert.ok(back.includes('CARL ^'));
  assert.ok(back.includes('#4#'));
});
t('stats', () => {
  const s = FDX.stats('INT. A - DAY\n\nBOB\nOne two three.\n\nEXT. B - NIGHT\n\nANN\nHi.\n\nBOB\nFour.\n');
  assert.strictEqual(s.scenes, 2); assert.strictEqual(s.int, 1); assert.strictEqual(s.ext, 1);
  assert.strictEqual(s.day, 1); assert.strictEqual(s.night, 1);
  assert.strictEqual(s.characters[0].name, 'BOB'); assert.strictEqual(s.characters[0].words, 4);
  assert.strictEqual(s.characters[0].scenes, 2);
});
t('big script performance', () => {
  const fs = require('fs'); const f = process.env.BIG;
  if (!f || !fs.existsSync(f)) return;
  const txt = fs.readFileSync(f, 'utf8');
  const t0 = Date.now(); const p = F.parse(txt); const r = P.paginate(p);
  assert.ok(Date.now() - t0 < 500); assert.ok(r.pages.length > 100);
});
const S = require('../src/core/structure.js');
const ACTS = 'Title: T\n\n# Act One\n\nINT. A - DAY\n\nAlpha.\n\nINT. B - DAY\n\n= syn b\n\nBravo.\n\nINT. C - DAY\n\nCharlie.\n\n# Act Two\n\n## Sequence\n\nINT. D - NIGHT\n\nDelta.\n\nINT. E - NIGHT\n\nEcho.\n';
const order = (txt) => F.parse(txt).outline.map(o => (o.type === 'section' ? '#' : '') + o.title).join('|');
const lineOf = (txt, t) => F.parse(txt).outline.find(o => o.title === t).line;
t('move several scenes to another act', () => {
  const tg = S.sectionTargets(F.parse(ACTS));
  assert.deepStrictEqual(tg.map(x => [x.title, x.before]), [['Act One', lineOf(ACTS, 'Act Two')], ['Act Two', null], ['Sequence', null]]);
  const r = S.moveScenes(ACTS, [lineOf(ACTS, 'INT. C - DAY'), lineOf(ACTS, 'INT. A - DAY')], tg[1].before);
  assert.strictEqual(order(r.text), '#Act One|INT. B - DAY|#Act Two|#Sequence|INT. D - NIGHT|INT. E - NIGHT|INT. A - DAY|INT. C - DAY');
  assert.ok(!/\n\n\n/.test(r.text) && r.text.endsWith('Charlie.\n'));
  assert.deepStrictEqual(r.lines.map(l => r.text.split('\n')[l]), ['INT. A - DAY', 'INT. C - DAY']);
  assert.ok(r.text.includes('INT. B - DAY\n\n= syn b\n\nBravo.\n\n# Act Two'));
});
t('move scenes back into an earlier act', () => {
  const r = S.moveScenes(ACTS, [lineOf(ACTS, 'INT. D - NIGHT'), lineOf(ACTS, 'INT. E - NIGHT')], lineOf(ACTS, 'Act Two'));
  assert.strictEqual(order(r.text), '#Act One|INT. A - DAY|INT. B - DAY|INT. C - DAY|INT. D - NIGHT|INT. E - NIGHT|#Act Two|#Sequence');
  assert.ok(!/\n\n\n/.test(r.text));
});
t('moving to where scenes already are changes nothing', () => {
  assert.strictEqual(S.moveScenes(ACTS, [lineOf(ACTS, 'INT. C - DAY')], lineOf(ACTS, 'Act Two')), null);
  assert.strictEqual(S.moveScenes(ACTS, [lineOf(ACTS, 'INT. E - NIGHT')], null), null);
});
t('single scene drag before another', () => {
  const r = S.moveScenes(ACTS, [lineOf(ACTS, 'INT. B - DAY')], lineOf(ACTS, 'INT. A - DAY'));
  assert.strictEqual(order(r.text).split('|').slice(0, 4).join('|'), '#Act One|INT. B - DAY|INT. A - DAY|INT. C - DAY');
});
t('line diff', () => {
  const d = S.lineDiff('a\nb\nc\nd', 'a\nx\ny\nd');
  assert.deepStrictEqual([d.from, d.oldEnd, d.newLines], [1, 3, ['x', 'y']]);
});
console.log(`${passed} tests passed${process.exitCode ? ', with failures' : ''}`);
