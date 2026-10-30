// Autosave: run with PORTABLE_EXECUTABLE_DIR set to an empty folder and SCRIPT_FILE to a script.
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, loadInto, docs, saveDoc }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  const { app } = require('electron');
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const file = process.env.SCRIPT_FILE;
  const disk = () => fs.readFileSync(file, 'utf8');
  const backups = () => { const d = path.join(app.getPath('userData'), 'Backups', path.basename(file, '.fountain')); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; };
  const type = (s, line) => js(`App.cm.replaceRange(${JSON.stringify(s)}, {line: ${line || 0}, ch: 0})`);

  check('autosave is on by default for a new setup', await js('App.prefs.autosave') === true);
  await loadInto(win, file); await sleep(800);

  await type('FIRST EDIT\n\n'); await sleep(4000);
  check('saves a moment after typing stops', disk().startsWith('FIRST EDIT'), disk().slice(0, 40));
  check('status says Autosaved and window is clean', (await js(`document.getElementById('st-saved').textContent`)) === 'Autosaved' && docs.get(win.id).dirty === false);

  // Typing while a save is being written must not be lost or marked saved.
  await type('SECOND\n\n'); await sleep(2550); await type('THIRD\n\n'); await sleep(5000);
  check('edits typed during a save are saved too', disk().startsWith('THIRD\n\nSECOND\n\nFIRST EDIT'), disk().slice(0, 40));
  check('clean afterwards', docs.get(win.id).dirty === false && await js('App.cm.isClean(App.cleanGen)'));

  await type('BLUR\n\n'); await js(`window.dispatchEvent(new Event('blur'))`); await sleep(1200);
  check('switching to another app saves right away', disk().startsWith('BLUR'));

  check('frequent autosaves make only one backup', backups() === 1, backups());
  await type('MANUAL\n\n'); await saveDoc(win, false); await sleep(300);
  check('a manual save still makes its own backup', backups() === 2, backups());

  await js(`host.setPref('autosave', false)`); await sleep(200);
  await type('OFF\n\n'); await sleep(4000);
  check('nothing saved with autosave off', !disk().startsWith('OFF') && docs.get(win.id).dirty === true);
  await js(`host.setPref('autosave', true)`); await sleep(4000);
  check('turning it back on saves pending edits', disk().startsWith('OFF'));

  await js(`App.setDocument('INT. NEW - DAY\\n', null, 'Untitled')`); await sleep(200);
  await type('UNTITLED\n\n'); await sleep(4000);
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('untitled scripts are left alone, no errors', errs.length === 0, errs);

  // Close with an unsaved edit: should save and close without asking.
  await loadInto(win, file); await sleep(600);
  await type('ON CLOSE\n\n');
  console.log(fails ? `AUTOSAVE: ${fails} failures (before close)` : 'AUTOSAVE: all passed (before close)');
  win.close();
  await sleep(4000);
  console.log('CLOSE window still open:', !win.isDestroyed());
};
