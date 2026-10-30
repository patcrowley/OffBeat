// Launch 2: same settings folder, no file argument — should reopen where we left off.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, BrowserWindow }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  await sleep(800);
  const r = JSON.parse(await js(`JSON.stringify({ path: App.path, cur: App.cm.getCursor(), font: getComputedStyle(App.cm.getWrapperElement()).fontFamily,
     visible: (() => { const c = App.cm.cursorCoords(null, 'local').top, s = App.cm.getScrollInfo(); return c >= s.top && c <= s.top + s.clientHeight; })() })`));
  console.log('L2', JSON.stringify({ windows: BrowserWindow.getAllWindows().length, zoom: win.webContents.getZoomFactor(), ...r }));
};
