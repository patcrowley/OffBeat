// Interface sizes, editor fonts, PDF font; PDFs must not change with interface size.
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, exportPDFTo }) => {
  const out = process.env.OUT_DIR; const js = (s) => win.webContents.executeJavaScript(s);
  const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  win.setSize(1440, 900);
  await js(`App.setDocument(Samples.sample, null, 'The Last Reel.fountain'); App.jumpTo(14)`); await sleep(1200);
  await exportPDFTo(path.join(out, 'pdf-100.pdf'));
  for (const z of [1.5, 2]) {
    await js(`host.setPref('uiScale', ${z})`); await sleep(1200);
    check(`interface at ${z * 100}%`, win.webContents.getZoomFactor() === z, win.webContents.getZoomFactor());
    const m = JSON.parse(await js(`JSON.stringify({ overflowX: document.documentElement.scrollWidth > innerWidth + 1, lines: App.cm.getWrapperElement().querySelectorAll('pre.ln-dialogue').length })`));
    check(`no sideways scrolling at ${z * 100}%`, !m.overflowX, m);
    await shot(`ui-${z * 100}.png`);
  }
  await exportPDFTo(path.join(out, 'pdf-200.pdf'));
  await js(`cmd('toggle-cards')`); await sleep(600); await shot('ui-200-cards.png'); await js(`cmd('toggle-cards')`);
  await js(`cmd('stats')`); await sleep(500); await shot('ui-200-stats.png'); await js(`App.closeModal()`);
  await js(`host.setPref('uiScale', 1)`); await sleep(800);

  for (const f of ['courier-new', 'plex', 'atkinson', 'opendyslexic', 'courier-prime']) {
    await js(`host.setPref('editorFont', '${f}')`); await sleep(900);
    const r = JSON.parse(await js(`JSON.stringify({ family: getComputedStyle(App.cm.getWrapperElement()).fontFamily, cw: App.cm.defaultCharWidth(),
      unit: App.charUnit(), width: App.cm.display.lineDiv.offsetWidth,
      loaded: document.fonts.check('16px ' + getComputedStyle(App.cm.getWrapperElement()).fontFamily.split(',')[0]),
      colR: parseFloat(document.getElementById('editor').style.getPropertyValue('--colR')),
      pageW: parseFloat(document.getElementById('editor').style.getPropertyValue('--pageR')) - parseFloat(document.getElementById('editor').style.getPropertyValue('--pageL')) })`));
    check(`page is 85 characters wide in ${f} (or fills a narrower pane)`, Math.abs(r.pageW - Math.min(85 * r.unit, r.width - 2 - 12)) < 3, r);
    const wanted = { 'courier-new': 'Courier New', plex: 'IBM Plex Mono', atkinson: 'Atkinson Hyperlegible Mono', opendyslexic: 'OpenDyslexic', 'courier-prime': 'Courier Prime' }[f];
    check(`editor font ${f}`, r.family.replace(/"/g, '').startsWith(wanted) && (r.loaded || f === 'courier-new'), r);
    console.log(`   ${f}: character unit ${r.unit.toFixed(2)}px, right margin ${r.colR.toFixed(0)}px`);
    if (f !== 'courier-prime') await shot(`font-${f}.png`);
  }
  check('outline uses editor font too', (await js(`getComputedStyle(document.querySelector('.o-title')).fontFamily`)).startsWith('"Courier Prime"'));

  await js(`host.setPref('print.font', 'courier-new')`); await sleep(500);
  const css = await js(`(async () => { const p = await new Promise(r => { const id = 'x'; r(Paginator.printCSS(App.prefs.print.paper, '', App.prefs.print.font)); }); return p; })()`);
  check('PDF font switches to Courier New', /font-family: 'Courier New', 'Courier Prime'/.test(css));
  await exportPDFTo(path.join(out, 'pdf-couriernew.pdf'));
  await js(`cmd('toggle-preview')`); await sleep(1200);
  check('preview follows PDF font', (await js(`getComputedStyle(document.querySelector('#preview-pages .pl')).fontFamily`)).startsWith('"Courier New"'));
  await js(`host.setPref('print.font', 'courier-prime'); cmd('toggle-preview')`); await sleep(400);
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `LOOK: ${fails} failures` : 'LOOK: all passed');
};
