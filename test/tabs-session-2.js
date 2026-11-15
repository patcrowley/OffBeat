const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, BrowserWindow }) => {
  const js = (s) => win.webContents.executeJavaScript(s);
  await sleep(1000);
  const tabs = await js(`App.tabs.map(t => (t === App.active ? '*' : '') + t.name).join(' | ')`);
  const curB = await js(`App.cm.getCursor().line`);
  await js(`App.activateTab(App.tabs.find(t => t.name === 'a.fountain').id)`); await sleep(400);
  const curA = await js(`App.cm.getCursor().line`);
  console.log('S2', JSON.stringify({ windows: BrowserWindow.getAllWindows().length, tabs, curB, curA, bar: await js(`!document.getElementById('tabbar').hidden`) }));
};
