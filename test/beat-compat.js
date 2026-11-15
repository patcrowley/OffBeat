// Beat compatibility in the running app.
// Run with OFFBEAT_TEST=test/beat-compat.js PORTABLE_EXECUTABLE_DIR=<empty dir> SCRIPTS=<empty dir>
const fs = require('fs'); const path = require('path');
const BD = require('../src/core/beatdoc.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, loadInto, saveDoc, askRenderer }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s); const wc = win.webContents;
  const shot = async (n) => out && fs.writeFileSync(path.join(out, n), (await wc.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const key = async (k, mods) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods || [] }); if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods || [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods || [] }); await sleep(40); };
  const type = async (s) => { for (const ch of s) await key(ch); await sleep(80); };
  win.setSize(1360, 880); win.focus();
  await js(`host.setPref('autosave', false)`); await sleep(200);

  /* ---- A file as Beat writes it ---- */
  const alt = BD.ALT_PREFIX + JSON.stringify({ current: 1, versions: [{ text: 'I never liked this town.', revisions: {} }, { text: 'This town never liked me.', revisions: {} }] }) + ' */';
  const body = [
    'Title: Night Shift',
    '',
    'INT. DINER - NIGHT',
    '',
    'Rain against the glass. MAE wipes the counter.',
    '',
    'MAE',
    'This town never liked me.',
    '',
    'EXT. PARKING LOT - NIGHT',
    '',
    'A pickup idles. The driver holds a shotgun.',
    ''
  ];
  const visible = body.join('\n');
  const file = body.slice(); file[7] += alt;
  const content = file.join('\n');
  const at = (s) => visible.indexOf(s);
  const settings = {
    'Revision': { Addition: [[at('Rain against'), 'Rain against the glass.'.length, 0]], Removed: [], RemovalSuggestion: [[at('The driver'), 'The driver'.length, 1]] },
    'Review Ranges': [{ range: [at('wipes'), 'wipes'.length], string: 'Stronger verb?' }],
    'Tags': [{ range: [at('shotgun'), 7], type: 'prop', definition: 'DEF-GUN' }, { range: [at('MAE wipes'), 3], type: 'cast', definition: 'DEF-MAE' }],
    'TagDefinitions': [{ name: 'shotgun', type: 'prop', id: 'DEF-GUN' }, { name: 'Mae', type: 'cast', id: 'DEF-MAE' }],
    'Heading UUIDs': [{ uuid: 'AAAA-1', string: 'INT. DINER - NIGHT' }, { uuid: 'BBBB-2', string: 'EXT. PARKING LOT - NIGHT' }],
    'Page Size': 0,
    'Scene Numbering Starts From': 12,
    'Revision Level': 2,
    'CharacterData': { MAE: { gender: 'woman', color: 'red' } },
    'Some Future Beat Setting': { keep: [1, 2, 3] },
    'Caret Position': at('pickup'),
    'Text Length': content.length
  };
  const F = path.join(process.env.SCRIPTS, 'night-shift.fountain');
  fs.writeFileSync(F, content + BD.START + ' ' + JSON.stringify(settings) + ' ' + BD.END);   // Beat adds no newline after one

  await loadInto(win, F); await sleep(700);
  check('the editor shows only the script', (await js(`App.cm.getValue()`)) === visible, await js(`App.cm.getValue()`));
  const counts = () => js(`(() => { const c = {}; App.cm.getDoc().getAllMarks().forEach(m => { if (m.beat) c[m.beat.k] = (c[m.beat.k] || 0) + 1; }); return JSON.stringify(c); })()`);
  check('revisions, notes, tags and alternatives become marks', (await counts()) === JSON.stringify({ rev: 2, review: 1, tag: 2, alt: 1 }), await counts());
  check('marks sit on the right words', (await js(`App.cm.getDoc().getAllMarks().filter(m => m.beat).map(m => m.beat.k + ':' + App.cm.getDoc().getRange(m.find().from, m.find().to)).sort().join('|')`))
    === ['alt:This town never liked me.', 'review:wipes', 'rev:Rain against the glass.', 'rev:The driver', 'tag:MAE', 'tag:shotgun'].sort().join('|'));
  check('scene numbers start where the document says', (await js(`App.ensureParsed().lines.filter(l => l.type === 'heading').map(l => l.sceneNumber).join(',')`)) === '12,13');
  check('the document paper size is used', (await js(`App.printOptions().paper`)) === 'a4');
  check('cursor opens where Beat left it', (await js(`App.cm.getLine(App.cm.getCursor().line)`)).startsWith('A pickup'), await js(`App.cm.getCursor()`));
  check('opening does not mark the script as edited', !(await js(`App.active.lastDirty`)));
  await sleep(300);
  await shot('b1-marks.png');

  /* ---- Edit above everything, save, and check Beat's offsets moved with the text ---- */
  await js(`App.cm.replaceRange('A NEW OPENING LINE.\\n\\n', {line: 2, ch: 0})`);
  await saveDoc(win, false); await sleep(500);
  const saved = fs.readFileSync(F, 'utf8');
  const r = BD.read(saved);
  const s = r.settings;
  const txt = r.body;
  const range = (a) => txt.slice(a[0], a[0] + a[1]);
  check('saved text has the edit', txt.includes('A NEW OPENING LINE.\n\nINT. DINER'));
  check('Text Length matches what Beat will count', s['Text Length'] === saved.slice(0, saved.indexOf(BD.START)).replace(/\n$/, '').length || s['Text Length'] === saved.indexOf(BD.START), [s['Text Length'], saved.indexOf(BD.START)]);
  check('revision ranges still cover the same words', range(s.Revision.Addition[0]) === 'Rain against the glass.' && s.Revision.Addition[0][2] === 0 && range(s.Revision.RemovalSuggestion[0]) === 'The driver' && s.Revision.RemovalSuggestion[0][2] === 1, s.Revision);
  check('review note still on its word', s['Review Ranges'].length === 1 && range(s['Review Ranges'][0].range) === 'wipes' && s['Review Ranges'][0].string === 'Stronger verb?', s['Review Ranges']);
  check('tags still on their words, with definitions', s.Tags.map(t => range(t.range) + ':' + t.type + ':' + t.definition).sort().join('|') === 'MAE:cast:DEF-MAE|shotgun:prop:DEF-GUN'
    && s.TagDefinitions.length === 2, [s.Tags, s.TagDefinitions]);
  check('alternatives written back on their line', r.alts.length === 1 && txt.split('\n')[r.alts[0].line] === 'This town never liked me.' && r.alts[0].raw === alt, r.alts);
  check('settings Offbeat does not use are kept', JSON.stringify(s['Some Future Beat Setting']) === '{"keep":[1,2,3]}' && s.CharacterData.MAE.color === 'red' && s['Page Size'] === 0 && s['Revision Level'] === 2);
  check('heading identifiers kept', s['Heading UUIDs'].map(h => h.uuid).join(',') === 'AAAA-1,BBBB-2', s['Heading UUIDs']);
  check('caret position saved', Number.isInteger(s['Caret Position']));
  check('saved file reopens cleanly', BD.read(saved).body === (await js(`App.cm.getValue()`)));

  /* ---- Tag, note and revision commands, with undo ---- */
  const selectWord = (w) => js(`(() => { const d = App.cm.getDoc(); const i = d.getValue().indexOf(${JSON.stringify(w)}); d.setSelection(d.posFromIndex(i), d.posFromIndex(i + ${w.length})); })()`);
  await selectWord('pickup');
  await js(`cmd('tag:vehicle')`); await sleep(150);
  const vehicle = () => js(`App.cm.getDoc().getAllMarks().filter(m => m.beat && m.beat.k === 'tag' && m.beat.type === 'vehicle').map(m => App.cm.getDoc().getRange(m.find().from, m.find().to)).join()`);
  check('Tag Selection As → Vehicle', (await vehicle()) === 'pickup', await vehicle());
  check('tagging marks the script as edited', await js(`App.active.lastDirty === true`));
  await js(`cmd('undo')`); await sleep(100);
  check('Ctrl+Z removes the tag', (await vehicle()) === '' && (await js(`App.cm.getValue().includes('A pickup idles')`)));
  await js(`cmd('redo')`); await sleep(100);
  check('Ctrl+Y puts it back', (await vehicle()) === 'pickup');

  await selectWord('counter');
  await js(`cmd('add-review')`); await sleep(200);
  await js(`document.getElementById('rv-text').value = 'Which counter?'; document.querySelector('[data-x=save]').click()`); await sleep(200);
  const notes = () => js(`App.cm.getDoc().getAllMarks().filter(m => m.beat && m.beat.k === 'review').map(m => App.cm.getDoc().getRange(m.find().from, m.find().to) + '=' + m.beat.text).sort().join('|')`);
  check('Add Review Note', (await notes()) === 'counter=Which counter?|wipes=Stronger verb?', await notes());
  await shot('b2-note.png');

  await selectWord('idles');
  await js(`cmd('rev-gen:3'); cmd('mark-revised')`); await sleep(150);
  const revs = () => js(`App.cm.getDoc().getAllMarks().filter(m => m.beat && m.beat.k === 'rev').map(m => App.cm.getDoc().getRange(m.find().from, m.find().to) + ':' + m.beat.gen).sort().join('|')`);
  check('Mark Selection as Revised uses the chosen color', (await revs()).includes('idles:3'), await revs());
  await selectWord('against the');
  await js(`cmd('clear-revisions')`); await sleep(150);
  check('Clear Revision Marks only clears the selection', (await revs()) === ['Rain :0', 'The driver:1', ' glass.:0', 'idles:3'].sort().join('|'), await revs());
  await js(`cmd('undo')`); await sleep(100);
  check('and undoes as one step', (await revs()) === ['Rain against the glass.:0', 'The driver:1', 'idles:3'].sort().join('|'), await revs());

  /* ---- Revision mode ---- */
  await js(`cmd('revision-mode')`); await sleep(100);
  check('status bar shows revision mode', await js(`!document.getElementById('st-rev').hidden && document.getElementById('st-rev').textContent.includes('Green')`));
  await js(`(() => { const d = App.cm.getDoc(); const l = d.getValue().split('\\n').findIndex(x => x.startsWith('Rain')); d.setCursor({ line: l, ch: d.getLine(l).length }); App.cm.focus(); })()`);
  await type(' Thunder.');
  check('typing in revision mode is marked in the current color, as one mark', (await revs()).includes(' Thunder.:3') && !(await revs()).includes('|r:3'), await revs());
  await js(`cmd('revision-mode')`); await sleep(100);
  await type(' Quiet.');
  check('with revision mode off, typing is not marked', !(await revs()).includes('Quiet'), await revs());
  check('editor shows the revision mark in the margin', await js(`!!document.querySelector('#editor pre.bt-rl3')`));
  await shot('b3-revisions.png');

  /* ---- Moving scenes keeps the marks ---- */
  await js(`cmd('toggle-cards')`); await sleep(400);
  const lots = await js(`App.ensureParsed().outline.find(o => o.title.startsWith('EXT. PARKING')).line`);
  const diner = await js(`App.ensureParsed().outline.find(o => o.title.startsWith('INT. DINER')).line`);
  await js(`App.moveScenes([${lots}], ${diner})`); await sleep(400);
  check('scenes moved', (await js(`App.ensureParsed().outline.map(o => o.title).join('|')`)) === 'EXT. PARKING LOT - NIGHT|INT. DINER - NIGHT');
  check('marks travel with the moved scene', (await vehicle()) === 'pickup' && (await revs()).includes('The driver:1') && (await revs()).includes('idles:3'), [await vehicle(), await revs()]);
  check('and with the scene that stayed', (await notes()) === 'counter=Which counter?|wipes=Stronger verb?' && (await counts()).includes('"alt":1'), [await notes(), await counts()]);
  await js(`cmd('undo')`); await sleep(300);
  check('undoing the move keeps them too', (await js(`App.ensureParsed().outline.map(o => o.title).join('|')`)) === 'INT. DINER - NIGHT|EXT. PARKING LOT - NIGHT' && (await vehicle()) === 'pickup' && (await notes()).includes('wipes'), [await vehicle(), await notes()]);
  await js(`cmd('toggle-cards')`); await sleep(300);

  /* ---- Line alternatives ---- */
  const lineOf = (t) => js(`App.cm.getValue().split('\\n').findIndex(x => x.startsWith(${JSON.stringify(t)}))`);
  await js(`App.cm.setCursor({ line: ${await lineOf('This town')}, ch: 3 })`);
  check('line with alternatives is flagged', await js(`!!document.querySelector('#editor pre.bt-has-alt')`));
  await js(`cmd('alt-prev')`); await sleep(150);
  check('Previous Version shows the other line', (await lineOf('I never liked this town.')) > 0);
  await js(`cmd('alt-next')`); await sleep(150);
  check('Next Version comes back', (await lineOf('This town never liked me.')) > 0);
  await js(`cmd('alt-prev')`); await sleep(100);
  await js(`cmd('undo')`); await sleep(100);
  check('undoing a switch brings back the line and its versions', (await lineOf('This town never liked me.')) > 0 && (await js(`App.cm.getDoc().getAllMarks().filter(m => m.beat && m.beat.k === 'alt').length`)) >= 1);
  await js(`cmd('alt-prev')`); await sleep(100);
  check('and switching still works after undo', (await lineOf('I never liked this town.')) > 0);
  await js(`cmd('alt-next')`); await sleep(100);
  // a line break typed at the start of the line doesn't move its versions to the new empty line
  await js(`(() => { const l = App.cm.getValue().split('\\n').findIndex(x => x.startsWith('This town')); App.cm.replaceRange('\\n', {line: l, ch: 0}); App.cm.setCursor({line: l + 1, ch: 2}); })()`);
  await js(`cmd('alt-prev')`); await sleep(100);
  check('versions stay with the line after Enter at its start', (await lineOf('I never liked this town.')) > 0, await js(`App.cm.getValue()`));
  await js(`cmd('alt-next')`); await sleep(100);
  await js(`(() => { const l = App.cm.getValue().split('\\n').findIndex(x => x.startsWith('This town')); App.cm.replaceRange('', {line: l - 1, ch: 0}, {line: l, ch: 0}); App.cm.setCursor({line: l - 1, ch: 2}); })()`);
  await js(`cmd('alt-add')`); await sleep(150);
  await js(`(() => { const l = App.cm.getValue().split('\\n').findIndex(x => x.startsWith('This town')); App.cm.replaceRange('Nobody here ever liked me.', {line: l, ch: 0}, {line: l, ch: App.cm.getLine(l).length}); })()`);
  await js(`cmd('alt-prev')`); await sleep(150);
  check('a new alternative keeps the old version', (await lineOf('This town never liked me.')) > 0);
  await js(`cmd('alt-next')`); await sleep(150);
  await saveDoc(win, false); await sleep(400);
  const r2 = BD.read(fs.readFileSync(F, 'utf8'));
  const data = BD.parseAlternative(r2.alts[0] && r2.alts[0].raw);
  check('three versions saved, the current one last', data && data.versions.map(v => v.text).join('|') === 'I never liked this town.|This town never liked me.|Nobody here ever liked me.' && data.current === 2
    && r2.body.split('\n')[r2.alts[0].line] === 'Nobody here ever liked me.', data);
  check('a revision added here reads back', r2.settings.Revision.Addition.some(a => r2.body.slice(a[0], a[0] + a[1]) === ' Thunder.' && a[2] === 3), r2.settings.Revision);
  check('the new tag and note read back', r2.settings.Tags.some(t => t.type === 'vehicle' && r2.body.slice(t.range[0], t.range[0] + t.range[1]) === 'pickup')
    && r2.settings['Review Ranges'].some(n => n.string === 'Which counter?') && r2.settings.TagDefinitions.some(d => d.type === 'vehicle' && d.name === 'pickup'));

  /* ---- Document settings dialog ---- */
  await js(`cmd('doc-settings')`); await sleep(200);
  await shot('b4-docsettings.png');
  await js(`document.getElementById('ds-paper').value = 'letter'; document.getElementById('ds-scene').value = '1'; document.getElementById('ds-hidepn').checked = true; document.querySelector('[data-gen="1"]').checked = false; document.querySelector('[data-x=save]').click()`); await sleep(400);
  check('settings change marks the script edited', await js(`App.active.lastDirty === true`));
  check('paper and scene numbers follow', (await js(`App.printOptions().paper`)) === 'letter' && (await js(`App.ensureParsed().lines.find(l => l.type === 'heading').sceneNumber`)) === '1');
  const pr = await askRenderer(win, 'request-print-html');
  check('print: no page numbers, hidden pink revision not marked, green marked', !pr.html.includes('class="pnum"') && pr.html.includes('<span class="rvm">++</span>') && !pr.html.includes('<span class="rvm">**</span>'), pr.html.match(/class="rvm">[^<]*/g));
  await saveDoc(win, false); await sleep(400);
  const s3 = BD.read(fs.readFileSync(F, 'utf8')).settings;
  check('document settings saved the way Beat stores them', s3['Page Size'] === 1 && !('Scene Numbering Starts From' in s3) && s3['Hide Page Numbers'] === true && JSON.stringify(s3['Hidden Revisions']) === '[1]', s3);
  check('saving clears the edited flag', await js(`App.active.lastDirty === false`));

  /* ---- A plain Offbeat script stays plain ---- */
  const G = path.join(process.env.SCRIPTS, 'plain.fountain');
  fs.writeFileSync(G, 'INT. ROOM - DAY\n\nNothing *fancy* here. +Highlight me+ and {{serial n}}.\n');
  await loadInto(win, G); await sleep(500);
  await js(`App.cm.replaceRange('Edited. ', {line: 2, ch: 0})`);
  await saveDoc(win, false); await sleep(300);
  check('no Beat block is added to a plain script', fs.readFileSync(G, 'utf8') === 'INT. ROOM - DAY\n\nEdited. Nothing *fancy* here. +Highlight me+ and {{serial n}}.\n');
  check('highlight and macro are styled in the editor', await js(`!!document.querySelector('#editor .cm-highlight') && !!document.querySelector('#editor .cm-macro')`));
  const pr2 = await askRenderer(win, 'request-print-html');
  check('print: highlight marked, macro resolved', pr2.html.includes('<mark>Highlight me</mark>') && pr2.html.includes('and 1.'), pr2.html.slice(0, 400));
  await js(`App.cm.setSelection({line: 2, ch: 0}, {line: 2, ch: 7}); cmd('tag:prop')`); await sleep(100);
  await saveDoc(win, false); await sleep(300);
  const g2 = BD.read(fs.readFileSync(G, 'utf8'));
  check('tagging a plain script adds a Beat block Beat can read', g2.settings && g2.settings.Tags.length === 1 && g2.body.slice(g2.settings.Tags[0].range[0], g2.settings.Tags[0].range[0] + 7) === 'Edited.' && g2.settings['Text Length'] === g2.body.length, g2.settings);

  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
};
