// Closing a window with several unsaved scripts: each untitled one is asked about; files autosave.
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, loadInto, docs, createWindow }) => {
  createWindow(); await new Promise(r => setTimeout(r, 1500));   // a spare window keeps the app running after this one closes
  const { dialog } = require('electron');
  const js = (s) => win.webContents.executeJavaScript(s);
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const A = path.join(process.env.SCRIPTS, 'a.fountain');
  const asked = []; let answers = [];
  dialog.showMessageBox = async (w, o) => { asked.push({ msg: o.message, showing: await js('App.active.name') }); return { response: answers.shift() }; };

  await js(`App.cm.replaceRange('first draft', {line: 0, ch: 0})`);            // Untitled, unsaved
  await js(`host.action('new')`); await sleep(400);
  await js(`App.cm.replaceRange('second draft', {line: 0, ch: 0})`);           // Untitled 2, unsaved
  await loadInto(win, A); await sleep(400);
  await js(`App.cm.replaceRange('FILE EDIT\\n\\n', {line: 0, ch: 0})`);         // a.fountain, unsaved (autosave is on)
  await sleep(100);

  answers = [2];   // Cancel on the first question
  win.close(); await sleep(1500);
  check('Cancel keeps the window open', !win.isDestroyed());
  check('asked about the first untitled script while showing it', asked.length === 1 && asked[0].msg.includes('Untitled') && asked[0].showing === 'Untitled', asked);

  asked.length = 0; answers = [1, 1];   // Don't Save, Don't Save
  win.close(); await sleep(2000);
  check('asked once per unsaved untitled script', asked.length === 2 && asked[1].msg.includes('Untitled 2') && asked[1].showing === 'Untitled 2', asked);
  check('the file was saved without asking', fs.readFileSync(A, 'utf8').startsWith('FILE EDIT'));
  check('the window closed', win.isDestroyed());
  console.log(fails ? `TABCLOSE: ${fails} failures` : 'TABCLOSE: all passed');
};
