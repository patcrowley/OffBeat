const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
  win.setSize(1440, 900);
  await js(`App.setDocument(Samples.sample, null, 'The Last Reel.fountain'); App.jumpTo(14)`); await sleep(1200);
  await shot('a-editor.png');
  await js(`cmd('toggle-preview'); cmd('toggle-timeline')`); await sleep(1500); await shot('b-preview.png');
  await js(`cmd('toggle-preview'); cmd('toggle-timeline')`);
  require('electron').nativeTheme.themeSource = 'dark'; await sleep(600);
  await js(`App.jumpTo(40)`); await sleep(500); await shot('c-dark.png');
  await js(`cmd('toggle-cards')`); await sleep(600); await shot('d-dark-cards.png');
};
