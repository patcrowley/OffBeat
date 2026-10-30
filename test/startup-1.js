// Launch 1: open a script, move into it, change size + font, then quit normally.
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, loadInto }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  const file = process.env.SCRIPT_FILE;
  console.log('L1 starts untitled:', await js('App.path === null'));
  await loadInto(win, file); await sleep(800);
  const target = await js(`App.ensureParsed().lines.findIndex((l, i) => i > 900 && l.type === 'action' && l.content.length > 40)`);
  await js(`App.jumpTo(${target}); App.cm.setCursor({line: ${target}, ch: 7})`);
  console.log('L1 cursor set to line', target); await sleep(900);
  await js(`host.setPref('uiScale', 1.5); host.setPref('editorFont', 'atkinson')`); await sleep(600);
  console.log('L1 zoom now', win.webContents.getZoomFactor());
  require('electron').app.quit(); await sleep(2500);
};
