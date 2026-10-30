const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  const wc = win.webContents;
  const shot = async (n) => fs.writeFileSync(path.join(out, n), (await wc.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const key = async (k, mods) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods || [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods || [] }); await sleep(80); };
  const pos = async (sel) => JSON.parse(await js(`(() => { const el = ${sel}; el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
  const card = (n) => `document.querySelectorAll('.card')[${n}]`;
  const click = async (p, mods, button) => { wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: button || 'left', clickCount: 1, modifiers: mods || [] }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: button || 'left', clickCount: 1, modifiers: mods || [] }); await sleep(250); };
  const order = () => js(`App.ensureParsed().outline.map(o => (o.type === 'section' ? '#' : '') + o.title.replace(/^(INT|EXT)\\. THE ORPHEUM - /, '')).join(' | ')`);
  const selected = () => js(`[...document.querySelectorAll('.card.selected')].map(c => c.querySelector('.c-head').textContent.replace(/^(INT|EXT)\\. THE ORPHEUM - /, '')).join(' | ')`);
  const bar = () => js(`(() => { const n = document.querySelectorAll('.card.selected').length; return n === 0 ? '' : n === 1 ? '1 card selected' : n + ' cards selected'; })()`);
  win.setSize(1440, 900); win.focus();
  await js(`App.setDocument(Samples.sample, null, 'x'); cmd('toggle-cards')`); await sleep(700);
  console.log('   start:', await order());

  // Ctrl+click two cards in Act One
  await click(await pos(card(0)));
  await click(await pos(card(2)), ['control']);
  check('Ctrl+click selects several cards', (await selected()) === 'PROJECTION BOOTH - NIGHT | PROJECTION BOOTH - NIGHT' && (await bar()) === '2 cards selected', [await selected(), await bar()]);
  await shot('m1-selected.png');

  check('the selection toolbar is gone', await js(`!document.querySelector('.sel-bar, [data-sel]')`));
  // Move to act via right-click
  await click(await pos(card(2)), [], 'right'); await sleep(150);
  await click(await pos(`document.querySelector('#popover [data-move]')`)); await sleep(200);
  const items = await js(`[...document.querySelectorAll('#popover button')].map(b => b.textContent)`);
  check('move menu lists the acts', JSON.stringify(items) === JSON.stringify(['Act One', 'Act Two']), items);
  await shot('m2-menu.png');
  await click(await pos(`[...document.querySelectorAll('#popover button')].find(b => b.textContent === 'Act Two')`)); await sleep(500);
  const o1 = await order();
  check('both scenes moved to the end of Act Two, in order', o1 === '#Act One | MARQUEE - CONTINUOUS | #Act Two | LOBBY - DAY | AUDITORIUM - NIGHT | EXT. THE ORPHEUM - DAWN'.replace('EXT. THE ORPHEUM - DAWN', 'DAWN') + ' | PROJECTION BOOTH - NIGHT | PROJECTION BOOTH - NIGHT' || o1.endsWith('DAWN | PROJECTION BOOTH - NIGHT | PROJECTION BOOTH - NIGHT'), o1);
  check('moved cards stay selected', (await bar()) === '2 cards selected');
  check('no doubled blank lines', !(await js(`/\\n\\n\\n/.test(App.cm.getValue())`)));
  check('scene numbers follow the new order', (await js(`App.ensureParsed().outline.filter(o => o.type === 'scene').map(o => o.number).join(',')`)) === '1,2,3,4,5,6');

  // Ctrl+Z undoes the whole group move in one step
  const desk = JSON.parse(await js(`(() => { const r = document.getElementById('cards').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 30) }); })()`));
  check('test point is the empty desk', await js(`document.elementFromPoint(${desk.x}, ${desk.y}).id`) === 'cards' || await js(`document.elementFromPoint(${desk.x}, ${desk.y}).id`) === 'cards-grid');
  await click(desk);   // empty desk: clears selection
  check('clicking the empty desk clears the selection', (await bar()) === '');
  await key('z', ['control']); await sleep(400);
  check('one Ctrl+Z restores the original order', (await order()).startsWith('#Act One | PROJECTION BOOTH - NIGHT | MARQUEE - CONTINUOUS | PROJECTION BOOTH - NIGHT | #Act Two'), await order());

  // Shift+click a range, right-click > Move to act > Act One
  await click(await pos(card(3)));
  await click(await pos(card(5)), ['shift']);
  check('Shift+click selects a run', (await bar()) === '3 cards selected', await bar());
  await click(await pos(card(4)), [], 'right'); await sleep(200);
  check('right-click menu offers moving the group', (await js(`document.querySelector('#popover .pop-note').textContent`)) === '3 cards selected');
  await click(await pos(`document.querySelector('#popover [data-move]')`)); await sleep(150);
  await click(await pos(`[...document.querySelectorAll('#popover button')].find(b => b.textContent === 'Act One')`)); await sleep(500);
  const o2 = await order();
  check('right-click move sends the run to the end of Act One', o2.split(' | #Act Two')[0].endsWith('LOBBY - DAY | AUDITORIUM - NIGHT | DAWN') && o2.endsWith('#Act Two'), o2);
  await js(`document.querySelectorAll('.card')[3].scrollIntoView({block:'center'})`); await sleep(300); await shot('m3-moved.png');

  // Recolor the selected group from the right-click menu
  await click(await pos(card(4)), [], 'right'); await sleep(150);
  await click(await pos(`document.querySelector('#popover [data-c=yellow]')`)); await sleep(400);
  check('right-click color applies to every selected card', (await js(`App.ensureParsed().outline.filter(o => o.type === 'scene').slice(3).map(o => o.color).join(',')`)) === 'yellow,yellow,yellow');
  check('selection kept after recoloring', (await bar()) === '3 cards selected');

  // Drag a selected card: the whole group moves
  await js(`(() => { const g = document.getElementById('cards-grid'); const src = document.querySelectorAll('.card')[4]; const dst = document.querySelectorAll('.card')[0];
    const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); })()`); await sleep(500);
  const o3 = await order();
  check('dragging one selected card moves the whole group', o3.startsWith('#Act One | LOBBY - DAY | AUDITORIUM - NIGHT | DAWN | PROJECTION BOOTH'), o3);

  // Ctrl+A selects all; Esc clears; second Esc leaves the cards
  await click(await pos(card(0)));
  await key('a', ['control']);
  check('Ctrl+A selects every card', (await bar()) === '6 cards selected', await bar());
  await key('Escape');
  check('Esc clears a multi-selection first', (await bar()) === '' && await js(`!document.getElementById('cards').hidden`));
  // typing in the script afterwards clears any stale selection
  await click(await pos(card(1)), ['control']);
  await js(`cmd('toggle-cards'); App.cm.replaceRange('x', {line: 0, ch: 0}); cmd('toggle-cards')`); await sleep(400);
  check('editing the script clears the selection', (await bar()) === '');
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `MULTI: ${fails} failures` : 'MULTI: all passed');
};
