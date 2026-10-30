const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  await sleep(500);
  console.log('L3', JSON.stringify({ path: await win.webContents.executeJavaScript('App.path'), text: await win.webContents.executeJavaScript('App.cm.getValue().length') }));
};
