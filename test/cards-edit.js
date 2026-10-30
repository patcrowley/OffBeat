const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  const wc = win.webContents;
  const shot = async (n) => fs.writeFileSync(path.join(out, n), (await wc.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const key = async (k, mods) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods || [] }); if (k.length === 1 || k === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: k === 'Enter' ? '\r' : k, modifiers: mods || [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods || [] }); await sleep(40); };
  const type = async (s) => { for (const ch of s) await key(ch); await sleep(60); };
  const at = async (sel, n, where) => JSON.parse(await js(`(() => { const c = document.querySelectorAll('.card')[${n}]; const el = ${sel ? `c.querySelector('${sel}')` : 'c'}; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + ${where === 'right' ? 'r.width - 8' : 'r.width / 2'}), y: Math.round(r.top + r.height / 2) }); })()`));
  const click = async (p, count) => { for (let i = 1; i <= (count || 1); i++) { wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: i }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: i }); } await sleep(250); };
  const sceneBlock = (n) => js(`(() => { const it = App.ensureParsed().outline.filter(o => o.type === 'scene')[${n}]; const l = []; for (let k = it.line; k <= it.endLine; k++) l.push(App.cm.getLine(k)); return l.join('\\n'); })()`);
  const cardsOpen = () => js(`!document.getElementById('cards').hidden`);
  win.setSize(1440, 900); win.focus();
  await js(`App.setDocument(Samples.sample, null, 'x'); cmd('toggle-cards')`); await sleep(700);
  const tripleBefore = await js(`(App.cm.getValue().match(/\\n\\n\\n/g) || []).length`);

  // 1. Double-click a card's body: edit synopsis in place, Enter saves
  await click(await at('.c-body', 1), 2);
  check('double-click opens the card for editing (not the script)', (await cardsOpen()) && await js(`document.activeElement.matches('.card.editing .c-edit-syn')`));
  await shot('ce1-editing.png');
  await type('Mae teaches Desmond the cue marks.'); await key('Enter'); await sleep(400);
  let b = await sceneBlock(1);
  check('synopsis written under the heading', b.startsWith('EXT. THE ORPHEUM - MARQUEE - CONTINUOUS [[COLOR ORANGE]]\n\n= Mae teaches Desmond the cue marks.\n\nHalf the bulbs'), b.slice(0, 150));
  check('still in the card view, card shows new synopsis', (await cardsOpen()) && (await js(`document.querySelectorAll('.card')[1].querySelector('.c-body').textContent`)) === 'Mae teaches Desmond the cue marks.');
  check('edited card keeps focus', await js(`document.activeElement === document.querySelectorAll('.card')[1]`));

  // 2. Edit a heading that has a color note; Enter on a focused card starts editing
  await click(await at('', 0)); await sleep(100);
  await js(`document.querySelectorAll('.card')[0].focus()`); await key('Enter');
  check('Enter on a selected card edits it', await js(`document.activeElement.matches('.card.editing .c-edit-head')`));
  await js(`document.activeElement.select()`); await type('int. projection booth - night'); await key('Enter'); await sleep(400);
  check('heading changed, color kept', (await js(`App.cm.getLine(App.ensureParsed().outline.filter(o => o.type === 'scene')[0].line)`)) === 'INT. PROJECTION BOOTH - NIGHT [[COLOR BLUE]]');

  // 3. Replace an existing synopsis with two lines (Shift+Enter)
  await click(await at('.c-body', 3), 2);
  await js(`document.activeElement.select()`); await type('The town rallies.'); await key('Enter', ['shift']); await type('Desmond gives a speech.'); await key('Enter'); await sleep(400);
  b = await sceneBlock(3);
  check('old synopsis replaced by two lines', b.includes('\n\n= The town rallies.\n= Desmond gives a speech.\n\n') && !b.includes('The town shows up'), b.slice(0, 160));

  // 4. Esc cancels without closing the cards
  const before4 = await js('App.cm.getValue()');
  await click(await at('.c-body', 3), 2); await type('throwaway'); await key('Escape'); await sleep(300);
  check('Esc cancels and stays in cards', (await js('App.cm.getValue()')) === before4 && (await cardsOpen()) && await js(`!document.querySelector('.card.editing')`));

  // 5. Clearing the synopsis removes it cleanly; clicking outside saves
  await click(await at('.c-body', 3), 2); await js(`document.activeElement.value = ''`);
  await click({ x: 700, y: 75 }); await sleep(400);
  b = await sceneBlock(3);
  check('clicking outside saves; synopsis removed', !b.includes('= ') && b.startsWith('INT. THE ORPHEUM - LOBBY - DAY [[COLOR GREEN]]\n\nThe lobby is packed.'), b.slice(0, 120));
  check('no doubled blank lines created', (await js(`(App.cm.getValue().match(/\\n\\n\\n/g) || []).length`)) === tripleBefore);

  // 6. Ctrl+Z in the card view undoes the last card edit
  await click({ x: 700, y: 75 });
  await key('z', ['control']); await sleep(400);
  b = await sceneBlock(3);
  check('Ctrl+Z works in the card view', b.includes('= The town rallies.') && (await cardsOpen()), b.slice(0, 120));

  // 7. Double-click another card while editing: first one is saved, second opens
  await click(await at('.c-body', 2), 2); await type(' Extra.');
  await click(await at('.c-body', 4), 2);
  b = await sceneBlock(2);
  check('switching cards saves the first', b.includes('= ') && b.includes('Extra.'), b.slice(0, 160));
  check('second card is now editing', await js(`document.querySelectorAll('.card')[4].classList.contains('editing')`));
  await key('Escape');

  // 8. Non-standard heading is forced; locked scene numbers kept
  await js(`cmd('lock-numbers')`); await sleep(300);
  await click(await at('.c-head', 5), 2); await js(`document.activeElement.select()`); await type('montage'); await key('Enter'); await sleep(400);
  check('non-standard heading forced and number kept', (await js(`App.cm.getLine(App.ensureParsed().outline.filter(o => o.type === 'scene')[5].line)`)) === '.MONTAGE #6#');

  // 9. The open-in-script button jumps to the scene
  await click(await at('.c-go', 2));
  check('open-in-script button switches to the script at that scene', !(await cardsOpen()) && (await js(`App.cm.getCursor().line`)) === (await js(`App.ensureParsed().outline.filter(o => o.type === 'scene')[2].line`)));
  await js(`cmd('toggle-cards')`); await sleep(500);
  await js(`document.querySelectorAll('.card')[2].scrollIntoView({block:'center'})`); await sleep(200);
  await shot('ce2-cards.png');
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `CARDEDIT: ${fails} failures` : 'CARDEDIT: all passed');
};
