const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const scenes = () => js(`App.ensureParsed().outline.map(o => (o.type==='section'?'#':'') + o.title).join('|')`);
  win.setSize(1440, 900);
  await js(`App.setDocument(Samples.sample, null, 'x'); cmd('toggle-cards')`); await sleep(700);
  const tiles = await js(`[...document.querySelectorAll('.card-add')].map(t => t.title).join('|')`);
  check('add tiles at end of each section and script', tiles === 'New card at the end of this section|New card at the end of the script', tiles);

  // 1. Section-end tile (end of Act One)
  await js(`document.querySelector('.card-add[data-before]').click()`); await sleep(300);
  check('dialog says where', (await js(`document.getElementById('nc-msg').textContent`)).includes('at the end of Act One'));
  await shot('n1-dialog.png');
  await js(`(() => { const h = document.getElementById('nc-head'); h.value = 'int. lobby - night'; document.getElementById('nc-syn').value = 'Mae counts the till.\\nDesmond sweeps.'; document.querySelector('input[name=nc-color][value=green]').checked = true; document.querySelector('[data-x=add]').click(); })()`); await sleep(500);
  const s1 = (await scenes()).split('|');
  const iAct2 = s1.indexOf('#Act Two');
  check('inserted at end of Act One', s1[iAct2 - 1] === 'INT. LOBBY - NIGHT', s1);
  const txt = await js('App.cm.getValue()');
  check('scene text written', txt.includes('INT. LOBBY - NIGHT [[COLOR GREEN]]\n\n= Mae counts the till.\n= Desmond sweeps.\n\n# Act Two'), txt.slice(txt.indexOf('LOBBY - NIGHT') - 40, txt.indexOf('LOBBY - NIGHT') + 120));
  check('card shows synopsis + color', await js(`(() => { const c = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('LOBBY - NIGHT')); return !!c && c.textContent.includes('Mae counts the till.') && !!c.querySelector('.c-color'); })()`));
  check('scene numbers renumbered', (await js(`App.ensureParsed().outline.filter(o=>o.type==='scene').map(o=>o.number).join(',')`)) === '1,2,3,4,5,6,7');
  await shot('n2-added.png');

  // 2. End tile
  await js(`document.querySelector('.card-add[data-end]').click()`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'EXT. ROOFTOP - DAWN'`);
  await win.webContents.executeJavaScript(`document.getElementById('nc-head').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`); await sleep(400);
  const s2 = (await scenes()).split('|');
  check('Enter submits, end tile appends', s2[s2.length - 1] === 'EXT. ROOFTOP - DAWN', s2);
  check('no merged blocks', (await js(`/\\S\\n(INT|EXT)\\./.test(App.cm.getValue())`)) === false);

  // 3. Validation
  await js(`document.querySelector('.card-add[data-end]').click()`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'INT.'; document.querySelector('[data-x=add]').click()`); await sleep(200);
  check('empty heading rejected', (await js(`!document.getElementById('modal-backdrop').hidden && document.getElementById('nc-msg').classList.contains('error')`)));
  // non-standard heading gets forced
  await js(`document.getElementById('nc-head').value = 'montage'; document.querySelector('[data-x=add]').click()`); await sleep(300);
  check('non-standard heading forced with a period', (await js(`App.cm.getValue().includes('\\n.MONTAGE\\n')`)) && (await scenes()).endsWith('MONTAGE'));

  // 4. Header button inserts after selected card
  await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('.c-num').textContent === '2').click()`); await sleep(200);
  await js(`document.querySelector('.cards-head [data-cmd=new-card]').click()`); await sleep(200);
  check('header dialog says after scene 2', (await js(`document.getElementById('nc-msg').textContent`)).includes('after scene 2'));
  await js(`document.getElementById('nc-head').value = 'INT. ALLEY - NIGHT'; document.querySelector('[data-x=add]').click()`); await sleep(400);
  const s4 = (await scenes()).split('|').filter(x => !x.startsWith('#'));
  check('inserted after scene 2', s4[2] === 'INT. ALLEY - NIGHT', s4);

  // 5. Keyboard shortcut in card view
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control', 'shift'] }); await sleep(300);
  check('Ctrl+Shift+Enter opens dialog', await js(`!!document.getElementById('nc-head')`));
  await js(`App.closeModal()`);

  // 6. Drag a card onto a section tile (moves to end of that section)
  const firstLine = await js(`App.ensureParsed().outline.find(o => o.type==='scene').line`);
  await js(`App.moveScene(${firstLine}, +document.querySelector('.card-add[data-before]').dataset.before)`); await sleep(300);
  const s6 = (await scenes()).split('|');
  check('drop on section tile moves to section end', s6[s6.indexOf('#Act Two') - 1] === 'INT. THE ORPHEUM - PROJECTION BOOTH - NIGHT', s6);

  // 7. Undo removes the last add, and Back to script works
  await js(`cmd('undo')`); await js(`cmd('undo')`); await sleep(300);
  check('undo removes added card', !(await scenes()).includes('ALLEY'));
  await js(`document.querySelector('.cards-head [data-cmd=toggle-cards]').click()`); await sleep(300);
  check('Back to script closes cards', await js(`document.getElementById('cards').hidden`));

  // 8. From the editor: Ctrl+Shift+Enter adds after current scene and jumps there
  await js(`App.jumpTo(App.ensureParsed().outline.find(o=>o.type==='scene').line + 2); cmd('new-card')`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'INT. BOOTH - LATER'; document.querySelector('[data-x=add]').click()`); await sleep(400);
  check('editor add jumps to new heading', (await js(`App.cm.getLine(App.cm.getCursor().line)`)) === 'INT. BOOTH - LATER');

  await js(`cmd('toggle-cards')`); await sleep(500); await shot('n3-cards.png');
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `CARDS: ${fails} failures` : 'CARDS: all passed');
};
