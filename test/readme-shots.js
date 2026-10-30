// Regenerates the README screenshots from the built-in sample screenplay.
// Usage (from the repo root):  OUT_DIR=docs/screenshots OFFBEAT_TEST=test/readme-shots.js npx electron .
// Tip: set PORTABLE_EXECUTABLE_DIR to an empty folder so your own settings aren't used or changed.
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win }) => {
  const { nativeTheme } = require('electron');
  const out = process.env.OUT_DIR || 'docs/screenshots';
  const js = (s) => win.webContents.executeJavaScript(s); const wc = win.webContents;
  const shot = async (name) => { await sleep(400); fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG()); console.log('SHOT', name); };
  const pos = async (sel) => JSON.parse(await js(`(() => { const el = ${sel}; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
  const click = async (p, opts) => { const o = opts || {}; for (let i = 1; i <= (o.count || 1); i++) { wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: o.button || 'left', clickCount: i, modifiers: o.mods || [] }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: o.button || 'left', clickCount: i, modifiers: o.mods || [] }); } await sleep(300); };
  const reset = async () => { await js(`App.closeModal(); document.getElementById('popover').hidden = true; if (!document.getElementById('cards').hidden) cmd('toggle-cards'); if (!document.getElementById('preview').hidden) cmd('toggle-preview'); if (!document.getElementById('timeline').hidden) cmd('toggle-timeline'); App.clearCardSelection && App.clearCardSelection();`); await sleep(300); };

  nativeTheme.themeSource = 'light';
  win.setSize(1280, 800); win.focus();
  const ignoreNames = () => js(`Spell.ignored.add('orpheum'); Spell.ignored.add('okafor'); Spell.refresh()`);   // the sample's invented names
  await js(`host.setPref('autosave', false); App.setDocument(Samples.sample, null, 'The Last Reel.fountain')`); await sleep(1500);
  await ignoreNames(); await sleep(300);

  // 1. Writing: editor + outline
  await js(`App.cm.setCursor({line: 20, ch: 0}); App.cm.focus()`); await sleep(300);
  await js(`App.cm.scrollTo(null, App.cm.charCoords({line: 9, ch: 0}, 'local').top - 70)`); await sleep(500);
  await shot('editor.png');

  // 2. Index cards: several selected, right-click "Move to act"
  await js(`cmd('toggle-cards')`); await sleep(800);
  await click(await pos(`document.querySelectorAll('.card')[0]`));
  await click(await pos(`document.querySelectorAll('.card')[2]`), { mods: ['control'] });
  await click(await pos(`document.querySelectorAll('.card')[2]`), { button: 'right' }); await sleep(200);
  await click(await pos(`document.querySelector('#popover [data-move]')`)); await sleep(300);
  await shot('cards.png');
  await reset();

  // 3. Editing a card in place
  await js(`cmd('toggle-cards')`); await sleep(700);
  await click(await pos(`document.querySelectorAll('.card')[1].querySelector('.c-body')`), { count: 2 });
  await js(`document.activeElement.value = 'Desmond sees the developer photographing the marquee.'`);
  await shot('card-edit.png');
  await js(`document.querySelector('.card.editing .c-edit-syn') && document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))`);
  await reset();
  await js(`App.setDocument(Samples.sample, null, 'The Last Reel.fountain')`); await sleep(800);

  // 4. Dark mode, print preview and timeline
  nativeTheme.themeSource = 'dark'; await sleep(500);
  await js(`cmd('toggle-preview'); cmd('toggle-timeline'); App.jumpTo(40)`); await sleep(1800);
  await js(`document.getElementById('preview-scroll').scrollTop = document.querySelectorAll('#preview-pages .page')[1].offsetTop * parseFloat(document.getElementById('preview-pages').style.zoom || 1) - 10`); await sleep(400);
  await shot('preview-dark.png');
  await reset();
  nativeTheme.themeSource = 'light'; await sleep(400);

  // 5. Statistics
  await js(`cmd('stats')`); await sleep(600);
  await shot('statistics.png');
  await reset();

  // 6. Spell check review (a typo is added to the sample for the picture)
  await js(`App.cm.replaceRange('Mae checks the gate with her flashlite. ', {line: 16, ch: 0}); App.cm.setCursor({line: 14, ch: 0}); App.jumpTo(14)`); await sleep(800);
  await js(`cmd('spelling')`); await sleep(900);
  await shot('spelling.png');
  await reset();
  await js(`App.setDocument(Samples.sample, null, 'The Last Reel.fountain')`); await sleep(800);

  // 7. Accessibility: 150% interface with Atkinson Hyperlegible Mono
  await js(`host.setPref('uiScale', 1.5); host.setPref('editorFont', 'atkinson')`); await sleep(1500);
  await js(`App.jumpTo(20)`); await sleep(800);
  await shot('large-text.png');
  await js(`host.setPref('uiScale', 1); host.setPref('editorFont', 'courier-prime')`); await sleep(500);
};
