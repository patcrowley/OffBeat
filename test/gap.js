const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  // Find any run of 2+ blank lines
  const gaps = () => js(`App.cm.getValue().split('\\n').reduce((a, l, i, arr) => (l.trim() === '' && i > 0 && arr[i-1].trim() === '' && i < arr.length - 1 ? a.concat(i) : a), [])`);
  win.setSize(1440, 900);
  const doc = '.HERO GETS CAUGHT AT THE DOCKS\\n\\n.HERO TRIES TO WIN THE TEAM BACK.\\n\\n\\n\\n\\n\\n# ACT 1\\n\\n# ACT 2\\n\\n\\n';
  await js(`App.setDocument('${doc}', null, 'gap.fountain'); cmd('toggle-cards')`); await sleep(600);

  // New card at the end of the opening run (tile before # ACT 1) — the case in the screenshot
  await js(`document.querySelector('.card-add[data-before]').click()`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'Inciting incident at the warehouse'; document.querySelector('[data-x=add]').click()`); await sleep(400);
  let v = await js('App.cm.getValue()');
  check('one blank line above and below the new scene', v.includes('WIN THE TEAM BACK.\n\n.INCITING INCIDENT AT THE WAREHOUSE\n\n# ACT 1'), v);
  check('no double blank lines left before it', (await gaps()).length === 0 || !v.slice(0, v.indexOf('# ACT 1')).includes('\n\n\n'), v);

  // End of script with trailing blank lines
  await js(`document.querySelector('.card-add[data-end]').click()`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'Showdown'; document.getElementById('nc-syn').value = 'They win.'; document.querySelector('[data-x=add]').click()`); await sleep(400);
  v = await js('App.cm.getValue()');
  check('end of script: one blank line, no trailing pile-up', v.endsWith('# ACT 2\n\n.SHOWDOWN\n\n= They win.\n'), v.slice(-60));

  // Header button after selected card
  await js(`[...document.querySelectorAll('.card')][0].click()`); await sleep(100);
  await js(`document.querySelector('.cards-head [data-cmd=new-card]').click()`); await sleep(200);
  await js(`document.getElementById('nc-head').value = 'INT. CAR - NIGHT'; document.querySelector('[data-x=add]').click()`); await sleep(400);
  v = await js('App.cm.getValue()');
  check('after selected card: single blank lines', v.startsWith('.HERO GETS CAUGHT AT THE DOCKS\n\nINT. CAR - NIGHT\n\n.HERO TRIES'), v.slice(0, 120));

  // Moving cards keeps single spacing too
  await js(`App.moveScene(0, null)`); await sleep(300);
  v = await js('App.cm.getValue()');
  check('moved card lands with single blank lines', v.endsWith('= They win.\n\n.HERO GETS CAUGHT AT THE DOCKS\n') && !v.includes('\n\n\n'), v);
  await js(`cmd('undo')`); await sleep(200);
  check('undo restores', (await js('App.cm.getValue()')).startsWith('.HERO GETS CAUGHT'));
  console.log(fails ? `GAP: ${fails} failures` : 'GAP: all passed');
};
