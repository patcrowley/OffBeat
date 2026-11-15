// Tabs: several scripts in one window. Run with PORTABLE_EXECUTABLE_DIR=<empty dir> SCRIPTS=<dir with a.fountain, b.fountain>
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, loadInto, docs, openFile, closeTab }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s); const wc = win.webContents;
  const shot = async (n) => out && fs.writeFileSync(path.join(out, n), (await wc.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const A = path.join(process.env.SCRIPTS, 'a.fountain'), B = path.join(process.env.SCRIPTS, 'b.fountain');
  const key = async (k, mods) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods || [] }); if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods || [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods || [] }); await sleep(60); };
  const type = async (s) => { for (const ch of s) await key(ch); await sleep(80); };
  const pos = async (sel) => JSON.parse(await js(`(() => { const r = (${sel}).getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
  const click = async (p, button) => { wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: button || 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: button || 'left', clickCount: 1 }); await sleep(300); };
  const tabEl = (name) => `[...document.querySelectorAll('.tab')].find(t => t.textContent.trim() === '${name}')`;
  const tabs = () => js(`App.tabs.map(t => (t === App.active ? '*' : '') + t.name).join(' | ')`);
  const rec = () => docs.get(win.id);
  win.setSize(1280, 820); win.focus();
  await sleep(300);

  check('one script: no tab bar', await js(`document.getElementById('tabbar').hidden && App.tabs.length === 1`));
  await js(`host.action('new')`); await sleep(500);
  check('New Script opens a second tab and shows the tab bar', (await tabs()) === 'Untitled | *Untitled 2' && await js(`!document.getElementById('tabbar').hidden`), await tabs());

  await loadInto(win, A); await sleep(500);
  check('opening a file reuses the empty Untitled tab', (await tabs()) === 'Untitled | *a.fountain', await tabs());
  await loadInto(win, B); await sleep(500);
  check('second file opens in its own tab', (await tabs()) === 'Untitled | a.fountain | *b.fountain', await tabs());
  check('window title follows the tab', win.getTitle() === 'b.fountain — Offbeat', win.getTitle());
  check('main process knows the tabs', JSON.stringify([...rec().tabs.values()].map(t => t.path && path.basename(t.path))) === JSON.stringify([null, 'a.fountain', 'b.fountain']));
  await shot('t1-tabs.png');

  // switch by clicking; each tab keeps its own text, cursor and undo history
  await js(`App.cm.setCursor({line: 4, ch: 0})`); await type('BEE ');
  await click(await pos(tabEl('a')));
  check('clicking a tab shows that script', (await js(`App.cm.getLine(0)`)) === 'INT. ALPHA - DAY' && win.getTitle() === 'a.fountain — Offbeat', [await js(`App.cm.getLine(0)`), win.getTitle()]);
  await js(`App.cm.setCursor({line: 6, ch: 3})`);
  await js(`cmd('undo')`); await sleep(100);
  check('undo in one tab does not touch another', !(await js(`App.cm.getValue()`)).includes('BEE') && (await js(`App.cm.getLine(0)`)) === 'INT. ALPHA - DAY');
  await click(await pos(tabEl('b')));
  check('the other tab still has its edit', (await js(`App.cm.getLine(4)`)).startsWith('BEE '), await js(`App.cm.getLine(4)`));
  await js(`cmd('undo')`); await sleep(100);
  check('and its own undo history', !(await js(`App.cm.getLine(4)`)).startsWith('BEE'));
  await click(await pos(tabEl('a')));
  check('cursor position kept per tab', JSON.stringify(await js(`App.cm.getCursor()`)) === JSON.stringify({ line: 6, ch: 3, sticky: null }) || (await js(`App.cm.getCursor().line`)) === 6, await js(`App.cm.getCursor()`));

  // leaving a tab autosaves it
  await click(await pos(tabEl('b')));
  await js(`App.cm.replaceRange('SAVED ON SWITCH\\n\\n', {line: 0, ch: 0})`);
  await click(await pos(tabEl('a'))); await sleep(1200);
  check('switching away from a script saves it', fs.readFileSync(B, 'utf8').startsWith('SAVED ON SWITCH'));
  check('and its tab shows as saved', await js(`!App.tabById(${[...rec().tabs.values()].find(t => t.path === B).id}).lastDirty`));

  // unsaved marker and title with autosave off
  await js(`host.setPref('autosave', false)`); await sleep(200);
  await js(`App.cm.replaceRange('dirty ', {line: 2, ch: 0})`); await sleep(300);
  check('unsaved tab shows a marker', await js(`${tabEl('a')}.classList.contains('dirty')`) && win.getTitle().startsWith('•'), win.getTitle());
  await shot('t2-dirty.png');
  await js(`cmd('undo')`); await sleep(300);
  check('marker clears when back to saved text', await js(`!${tabEl('a')}.classList.contains('dirty')`));
  await js(`host.setPref('autosave', true)`); await sleep(200);

  // Ctrl+Tab cycles, Ctrl+Shift+Tab goes back
  await key('Tab', ['control']); await sleep(300);
  check('Ctrl+Tab goes to the next tab', (await tabs()) === 'Untitled | a.fountain | *b.fountain', await tabs());
  await key('Tab', ['control']); await sleep(300);
  check('and wraps around', (await tabs()) === '*Untitled | a.fountain | b.fountain', await tabs());
  await key('Tab', ['control', 'shift']); await sleep(300);
  check('Ctrl+Shift+Tab goes back', (await tabs()) === 'Untitled | a.fountain | *b.fountain', await tabs());

  // opening an already open file switches to it
  await openFile(A); await sleep(400);
  check('opening a file that is already open switches to its tab', (await tabs()) === 'Untitled | *a.fountain | b.fountain', await tabs());

  // the card view follows the tab
  await js(`cmd('toggle-cards')`); await sleep(500);
  const cardsA = await js(`[...document.querySelectorAll('.card .c-head')].map(c => c.textContent).join(',')`);
  await click(await pos(tabEl('b'))); await sleep(500);
  const cardsB = await js(`[...document.querySelectorAll('.card .c-head')].map(c => c.textContent).join(',')`);
  check('index cards show the active script', cardsA.includes('ALPHA') && cardsB.includes('BRAVO') && !cardsB.includes('ALPHA'), [cardsA, cardsB]);
  await js(`cmd('toggle-cards')`); await sleep(300);

  // spelling ignores belong to one script
  await js(`App.cm.replaceRange('Zorgle went home.\\n\\n', {line: 2, ch: 0}); Spell.ignored.add('zorgle'); Spell.refresh()`); await sleep(600);
  const flaggedB = await js(`[...document.querySelectorAll('.cm-spell-error')].map(e => e.textContent).includes('Zorgle')`);
  await click(await pos(tabEl('a')));
  await js(`App.cm.replaceRange('Zorgle went home.\\n\\n', {line: 2, ch: 0})`); await sleep(800);
  const flaggedA = await js(`[...document.querySelectorAll('.cm-spell-error')].map(e => e.textContent).includes('Zorgle')`);
  check('"ignore in this script" only applies to that script', !flaggedB && flaggedA, { flaggedB, flaggedA });
  await js(`cmd('undo')`); await sleep(300);

  // drag a tab to reorder
  await js(`(() => { const src = ${tabEl('b')}, dst = ${tabEl('Untitled')};
    const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect(); dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5 }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); })()`); await sleep(400);
  check('dragging a tab reorders it', (await tabs()).replace('*', '') === 'b.fountain | Untitled | a.fountain', await tabs());
  check('main process follows the new order', JSON.stringify(rec().order.map(id => rec().tabs.get(id).name)) === JSON.stringify(['b.fountain', 'Untitled', 'a.fountain']), rec().order.map(id => rec().tabs.get(id).name));

  // close with the x, middle-click, and the menu command
  await click(await pos(`${tabEl('Untitled')}.querySelector('.tab-close')`)); await sleep(400);
  check('the close button closes a clean tab without asking', (await tabs()).replace('*', '') === 'b.fountain | a.fountain', await tabs());
  check('closing tabs leaves the tab bar while two remain', await js(`!document.getElementById('tabbar').hidden`));
  await js(`host.action('new')`); await sleep(400);
  await click(await pos(tabEl('Untitled')), 'middle'); await sleep(400);
  check('middle-click closes a tab', (await tabs()).replace('*', '') === 'b.fountain | a.fountain', await tabs());
  await click(await pos(tabEl('a')));
  await js(`host.action('close-tab')`); await sleep(400);
  check('Close Tab closes the active tab and hides the bar with one left', (await tabs()) === '*b.fountain' && await js(`document.getElementById('tabbar').hidden`), await tabs());

  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `TABS: ${fails} failures` : 'TABS: all passed');
};
