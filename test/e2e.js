const fs = require('fs'); const path = require('path'); const os = require('os');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async ({ win, saveDoc, loadInto, docs }) => {
  const out = process.env.OUT_DIR;
  const js = (s) => win.webContents.executeJavaScript(s);
  const wc = win.webContents;
  let fails = 0;
  const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
  const key = async (k, mods) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods || [] }); if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods || [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods || [] }); await sleep(60); };
  const type = async (s) => { for (const ch of s) { await key(ch); } await sleep(80); };
  win.setSize(1300, 860); win.focus();
  await js(`App.setDocument('', null, 'Untitled'); App.cm.focus()`); await sleep(300);

  await type('int. kitchen - day');
  check('heading auto-caps', (await js('App.cm.getLine(0)')) === 'INT. KITCHEN - DAY', await js('App.cm.getLine(0)'));
  await key('Enter');
  check('Enter after heading adds blank line', (await js('App.cm.getCursor().line')) === 2);
  await type('Mae walks in.'); await key('Enter');
  await key('Tab'); await type('mae');
  check('Tab starts caps cue', (await js('App.cm.getLine(4)')) === 'MAE', await js('App.cm.getLine(4)'));
  await key('Escape'); await key('Enter');
  check('Enter after cue is single line', (await js('App.cm.getCursor().line')) === 5);
  await key('Tab');
  check('Tab in dialogue inserts ()', (await js('App.cm.getLine(5)')) === '()');
  await type('softly'); await key('End'); await key('Enter'); await type('Hello there.'); await key('Enter');
  const t = await js('App.ensureParsed().lines.map(l=>l.type).join(",")');
  check('element types', t.startsWith('heading,empty,action,empty,character,parenthetical,dialogue,empty'), t);
  await type('MA'); await sleep(200);
  check('autocomplete offers MAE', await js('!!(App.cm.state.completionActive && App.cm.state.completionActive.data && App.cm.state.completionActive.data.list.includes("MAE"))'));
  await key('Enter'); await sleep(100);
  check('autocomplete accepts', (await js('App.cm.getLine(App.cm.getCursor().line)')) === 'MAE', await js('App.cm.getLine(App.cm.getCursor().line)'));
  await js(`App.cm.setCursor({line:2,ch:4}); cmd('color:red')`);
  check('scene color', (await js('App.cm.getLine(0)')) === 'INT. KITCHEN - DAY [[COLOR RED]]');
  await js(`cmd('lock-numbers')`);
  check('lock numbers', (await js('App.cm.getLine(0)')) === 'INT. KITCHEN - DAY #1# [[COLOR RED]]', await js('App.cm.getLine(0)'));
  await js(`App.cm.setSelection({line:2,ch:0},{line:2,ch:3}); cmd('bold')`);
  check('bold wraps', (await js('App.cm.getLine(2)')).startsWith('**Mae** walks'));
  await js(`cmd('undo')`);

  // Card reorder + undo
  await js(`App.setDocument(Samples.sample, null, 'x')`); await sleep(400);
  const before = await js(`App.ensureParsed().outline.filter(o=>o.type==='scene').map(o=>o.title).join('|')`);
  await js(`cmd('toggle-cards')`); await sleep(400);
  await js(`App.moveScene(App.ensureParsed().outline.filter(o=>o.type==='scene')[1].line, null)`); await sleep(300);
  const after = await js(`App.ensureParsed().outline.filter(o=>o.type==='scene').map(o=>o.title).join('|')`);
  const b = before.split('|'), a = after.split('|');
  check('card moved to end', a[a.length - 1] === b[1] && a.length === b.length, a);
  await js(`App.moveScene(App.ensureParsed().outline.filter(o=>o.type==='scene')[4].line, App.ensureParsed().outline.filter(o=>o.type==='scene')[0].line)`); await sleep(200);
  const a2 = (await js(`App.ensureParsed().outline.filter(o=>o.type==='scene').map(o=>o.title).join('|')`)).split('|');
  check('card moved to front', a2[0] === a[4], a2);
  check('no merged blocks after moves', (await js(`/\\S\\n(INT|EXT)\\./.test(App.cm.getValue())`)) === false);
  await js(`cmd('undo'); cmd('undo')`); await sleep(300);
  check('undo restores order', (await js(`App.ensureParsed().outline.filter(o=>o.type==='scene').map(o=>o.title).join('|')`)) === before);
  await js(`cmd('toggle-cards')`);

  // Title page dialog
  await js(`cmd('title-page')`); await sleep(200);
  await js(`document.getElementById('tp-title').value='NEW TITLE'; document.querySelector('[data-x=save]').click()`); await sleep(200);
  check('title page updated', (await js('App.cm.getLine(0)')) === 'Title: NEW TITLE' && (await js('App.ensureParsed().title.length')) >= 5, await js('App.cm.getValue().slice(0,120)'));

  // Save / load with Beat settings block
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offbeat-'));
  const file = path.join(dir, 'beat file.fountain');
  const settings = `/* If you're seeing this, you can remove the following stuff - BEAT:\n{"Revision Color":"blue","Characters":{"MAE":{"gender":"woman"}}}\nEND_BEAT */`;
  fs.writeFileSync(file, 'INT. A - DAY\n\nHello.\n\n' + settings + '\n');
  await loadInto(win, file); await sleep(500);
  check('settings block hidden from editor', !(await js('App.cm.getValue()')).includes('BEAT:'));
  await js(`App.cm.replaceRange('More action.\\n\\n', {line: 4, ch: 0})`); await sleep(100);
  check('dirty after edit', docs.get(win.id).dirty === true);
  const ok = await saveDoc(win, false);
  const saved = fs.readFileSync(file, 'utf8');
  check('save writes file', ok && saved.includes('More action.'));
  check('settings block preserved on save', saved.trim().endsWith(settings), saved.slice(-200));
  check('clean after save', docs.get(win.id).dirty === false);
  const bdir = path.join(require('electron').app.getPath('userData'), 'Backups', 'beat file');
  check('backup created', fs.existsSync(bdir) && fs.readdirSync(bdir).length > 0);

  // FDX import
  const fdx = path.join(dir, 'imp.fdx');
  fs.writeFileSync(fdx, `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content>
  <Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>
  <Paragraph Type="Action"><Text>Rain on glass.</Text></Paragraph>
  <Paragraph Type="Character"><Text>JO</Text></Paragraph><Paragraph Type="Dialogue"><Text Style="Italic">Late</Text><Text> again.</Text></Paragraph>
  </Content></FinalDraft>`);
  await loadInto(win, fdx); await sleep(500);
  const imp = await js('App.cm.getValue()');
  check('fdx import', imp.includes('INT. OFFICE - DAY') && imp.includes('JO\n*Late* again.'), imp);
  check('fdx import marks dirty', docs.get(win.id).dirty === true);

  await js(`App.setDocument(Samples.help, null, 'Guide')`); await sleep(1200);
  fs.writeFileSync(path.join(out, 'e2e-help.png'), (await wc.capturePage()).toPNG());
  const errs = await js('window.__errs.filter(e => !e.includes("ResizeObserver"))');
  check('no renderer errors', errs.length === 0, errs);
  console.log(fails ? `E2E: ${fails} failures` : 'E2E: all passed');
};
