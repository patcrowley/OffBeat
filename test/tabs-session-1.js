// Restart 1: open two scripts as tabs, move the cursor, leave b showing, quit normally.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const path = require('path');
module.exports = async ({ win, loadInto }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  const dir = process.env.SCRIPTS;
  await loadInto(win, path.join(dir, 'a.fountain')); await sleep(400);
  await js(`App.cm.setCursor({line: 6, ch: 4})`); await sleep(700);
  await loadInto(win, path.join(dir, 'b.fountain')); await sleep(400);
  await js(`App.cm.setCursor({line: 4, ch: 2})`); await sleep(700);
  await js(`host.action('new')`); await sleep(300);   // an empty untitled tab is not reopened
  await js(`App.activateTab(App.tabs[1].id)`); await sleep(700);
  console.log('S1', await js(`App.tabs.map(t => (t === App.active ? '*' : '') + t.name).join(' | ')`));
  require('electron').app.quit(); await sleep(2500);
};
