// Drives the running app: load sample, take screenshots, export PDF.
const fs = require('fs'); const path = require('path');
const out = process.env.OUT_DIR;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, exportPDFTo }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name), img.toPNG()); };
  win.webContents.on('console-message', (e) => { const m = e.message || e; if (e.level === 'error' || e.level === 3) console.log('CONSOLE', m); });
  win.setSize(1440, 900);
  await js(`App.setDocument(Samples.sample, null, 'The Last Reel.fountain')`);
  await sleep(1500);
  await shot('1-editor.png');
  const errs = await js(`JSON.stringify({pages: App.paginated.pages.length, scenes: App.parsed.outline.filter(o=>o.type==='scene').length})`);
  console.log('STATE', errs);
  await js(`cmd('toggle-cards')`); await sleep(800); await shot('2-cards.png');
  await js(`cmd('toggle-cards'); cmd('toggle-preview'); cmd('toggle-timeline')`); await sleep(1500); await shot('3-preview-timeline.png');
  await js(`cmd('toggle-preview'); cmd('toggle-timeline'); cmd('stats')`); await sleep(600); await shot('4-stats.png');
  await js(`App.closeModal(); cmd('title-page')`); await sleep(500); await shot('5-titlepage.png');
  await js(`App.closeModal()`);
  await exportPDFTo(path.join(out, 'sample.pdf'));
  if (process.env.BIG) {
    await js(`App.setDocument(${JSON.stringify(fs.readFileSync(process.env.BIG,'utf8'))}, null, 'big.fountain')`);
    await sleep(2500);
    await js(`App.jumpTo(800)`); await sleep(800);
    await shot('6-big.png');
    await exportPDFTo(path.join(out, 'big.pdf'));
  }
  const logs = await js(`window.__errs || []`); console.log('ERRS', JSON.stringify(logs));
};
