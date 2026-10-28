'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Offbeat');
const isMac = process.platform === 'darwin';

/* ---------------- Preferences ---------------- */
const PREF_FILE = () => path.join(app.getPath('userData'), 'prefs.json');
const DEFAULT_PREFS = {
  theme: 'system',          // system | light | dark
  dimMarkup: false,
  showPageBreaks: true,
  smartLineBreaks: true,
  autoCaps: true,
  autocomplete: true,
  spellcheck: true,
  spellLang: 'en-US',
  typewriter: false,
  zoom: 1,
  autosave: false,
  outlineVisible: true,
  print: { paper: 'letter', sceneNumbers: true, boldHeadings: true, underlineHeadings: false, spaceBeforeHeading: 2 },
  recent: [],
  bounds: null
};
let prefs = loadPrefs();
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(PREF_FILE(), 'utf8'));
    return Object.assign({}, DEFAULT_PREFS, p, { print: Object.assign({}, DEFAULT_PREFS.print, p.print || {}) });
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_PREFS)); }
}
function savePrefs() {
  try { fs.mkdirSync(path.dirname(PREF_FILE()), { recursive: true }); fs.writeFileSync(PREF_FILE(), JSON.stringify(prefs, null, 2)); } catch (e) { /* ignore */ }
}
function setPref(key, value) {
  if (key.startsWith('print.')) prefs.print[key.slice(6)] = value; else prefs[key] = value;
  savePrefs();
  if (key === 'theme') nativeTheme.themeSource = value;
  if (key === 'spellLang') { Spell.reset(); }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && docs.has(w.id)) w.webContents.send('prefs', prefs);
  buildMenu();
}

/* ---------------- Documents / windows ---------------- */
const docs = new Map(); // window id -> { path, dirty, kind }
const pendingReplies = new Map();
let replyId = 0;

function askRenderer(win, channel, payload) {
  return new Promise((resolve) => {
    const id = ++replyId;
    pendingReplies.set(id, resolve);
    win.webContents.send(channel, { id, payload });
    setTimeout(() => { if (pendingReplies.has(id)) { pendingReplies.delete(id); resolve(null); } }, 10000);
  });
}
ipcMain.on('reply', (e, { id, value }) => {
  const r = pendingReplies.get(id);
  if (r) { pendingReplies.delete(id); r(value); }
});

function createWindow(filePath, initialText) {
  const b = prefs.bounds || { width: 1280, height: 860 };
  const win = new BrowserWindow({
    width: b.width, height: b.height,
    x: BrowserWindow.getAllWindows().length ? undefined : b.x,
    y: BrowserWindow.getAllWindows().length ? undefined : b.y,
    minWidth: 720, minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#f4f2ee',
    title: 'Offbeat',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  docs.set(win.id, { path: filePath || null, dirty: false });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('prefs', prefs);
    if (filePath) loadInto(win, filePath);
    else win.webContents.send('load', { text: initialText || '', path: null, name: 'Untitled' });
    updateTitle(win);
  });

  // context menu outside the script editor (the editor asks for its own via 'spell-menu')
  win.webContents.on('context-menu', (e, params) => {
    const items = [];
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    else if (params.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.on('close', async (e) => {
    const d = docs.get(win.id);
    if (!d || !d.dirty || d.closing) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Do you want to save the changes you made to ${d.path ? path.basename(d.path) : 'Untitled'}?`,
      detail: "Your changes will be lost if you don't save them."
    });
    if (r.response === 2) return;
    if (r.response === 0) {
      const ok = await saveDoc(win, false);
      if (!ok) return;
    }
    d.closing = true;
    win.close();
  });
  win.on('closed', () => docs.delete(win.id));
  const remember = () => { if (!win.isMaximized() && !win.isMinimized()) { prefs.bounds = win.getBounds(); savePrefs(); } };
  win.on('resized', remember);
  win.on('moved', remember);
  return win;
}

function updateTitle(win) {
  const d = docs.get(win.id);
  if (!d) return;
  const name = d.path ? path.basename(d.path) : 'Untitled';
  win.setTitle(`${d.dirty ? '• ' : ''}${name} — Offbeat`);
  if (isMac) { win.setDocumentEdited(d.dirty); if (d.path) win.setRepresentedFilename(d.path); }
}

function addRecent(p) {
  prefs.recent = [p, ...prefs.recent.filter(x => x !== p)].slice(0, 12);
  savePrefs();
  try { app.addRecentDocument(p); } catch (e) { /* ignore */ }
  buildMenu();
}

async function loadInto(win, filePath) {
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    const d = docs.get(win.id);
    if (/\.fdx$/i.test(filePath)) {
      win.webContents.send('import-fdx', { xml: text, name: path.basename(filePath, path.extname(filePath)) });
      d.path = null; d.dirty = true;
    } else {
      d.path = filePath; d.dirty = false;
      win.webContents.send('load', { text, path: filePath, name: path.basename(filePath) });
      addRecent(filePath);
    }
    updateTitle(win);
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err.message || err));
  }
}

function focusedWin() { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; }

async function openFile(p) {
  // reuse an empty untitled window if available
  const win = focusedWin();
  if (win && docs.has(win.id)) {
    const d = docs.get(win.id);
    if (!d.path && !d.dirty) {
      const empty = await askRenderer(win, 'request-is-empty');
      if (empty) { loadInto(win, p); return; }
    }
  }
  for (const w of BrowserWindow.getAllWindows()) {
    const d = docs.get(w.id);
    if (d && d.path === p) { w.focus(); return; }
  }
  createWindow(p);
}

async function openDialog() {
  const r = await dialog.showOpenDialog(focusedWin(), {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Screenplays', extensions: ['fountain', 'spmd', 'txt', 'fdx'] },
      { name: 'Fountain', extensions: ['fountain', 'spmd', 'txt'] },
      { name: 'Final Draft', extensions: ['fdx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!r.canceled) for (const p of r.filePaths) await openFile(p);
}

function backup(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const dir = path.join(app.getPath('userData'), 'Backups', path.basename(filePath, path.extname(filePath)));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(filePath, path.join(dir, `${stamp}${path.extname(filePath) || '.fountain'}`));
    const files = fs.readdirSync(dir).sort();
    while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { /* ignore */ }
}

async function saveDoc(win, saveAs) {
  const d = docs.get(win.id);
  if (!d) return false;
  let target = d.path;
  if (saveAs || !target) {
    const suggested = await askRenderer(win, 'request-suggested-name');
    const r = await dialog.showSaveDialog(win, {
      defaultPath: target || path.join(app.getPath('documents'), (suggested || 'Untitled') + '.fountain'),
      filters: [{ name: 'Fountain', extensions: ['fountain'] }, { name: 'Text', extensions: ['txt'] }]
    });
    if (r.canceled || !r.filePath) return false;
    target = r.filePath;
  }
  const text = await askRenderer(win, 'request-text');
  if (text === null) { dialog.showErrorBox('Save failed', 'Could not read the document.'); return false; }
  try {
    backup(target);
    const tmp = target + '.offbeat-tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
    d.path = target; d.dirty = false;
    updateTitle(win);
    addRecent(target);
    win.webContents.send('saved', { path: target, name: path.basename(target) });
    return true;
  } catch (err) {
    dialog.showErrorBox('Save failed', String(err.message || err));
    return false;
  }
}

/* ---------------- Export / print ---------------- */
async function renderInHiddenWindow(payload) {
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await w.loadFile(path.join(__dirname, 'src', 'print.html'));
  await w.webContents.executeJavaScript(`(async () => {
    document.getElementById('style').textContent = ${JSON.stringify(payload.css)};
    document.getElementById('root').innerHTML = ${JSON.stringify(payload.html)};
    await document.fonts.ready;
    return true;
  })()`);
  return w;
}

async function exportPDF(win) {
  const payload = await askRenderer(win, 'request-print-html');
  if (!payload) return;
  const d = docs.get(win.id);
  const base = d.path ? path.basename(d.path, path.extname(d.path)) : (payload.suggested || 'Untitled');
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(d.path ? path.dirname(d.path) : app.getPath('documents'), base + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return;
  const w = await renderInHiddenWindow(payload);
  try {
    const data = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
    fs.writeFileSync(r.filePath, data);
    shell.openPath(r.filePath);
  } catch (err) {
    dialog.showErrorBox('PDF export failed', String(err.message || err));
  } finally { w.destroy(); }
}

async function printDoc(win) {
  const payload = await askRenderer(win, 'request-print-html');
  if (!payload) return;
  const w = await renderInHiddenWindow(payload);
  w.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, () => w.destroy());
}

async function exportText(win, kind) {
  const payload = await askRenderer(win, 'request-export', kind);
  if (!payload) return;
  const d = docs.get(win.id);
  const base = d.path ? path.basename(d.path, path.extname(d.path)) : (payload.suggested || 'Untitled');
  const ext = kind === 'fdx' ? 'fdx' : 'html';
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(d.path ? path.dirname(d.path) : app.getPath('documents'), `${base}.${ext}`),
    filters: [{ name: kind === 'fdx' ? 'Final Draft' : 'HTML', extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return;
  fs.writeFileSync(r.filePath, payload.content, 'utf8');
}

async function importFDX() {
  const r = await dialog.showOpenDialog(focusedWin(), { filters: [{ name: 'Final Draft', extensions: ['fdx'] }], properties: ['openFile'] });
  if (r.canceled) return;
  await openFile(r.filePaths[0]);
}

/* ---------------- IPC ---------------- */
ipcMain.on('dirty', (e, dirty) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const d = win && docs.get(win.id);
  if (d && d.dirty !== dirty) { d.dirty = dirty; updateTitle(win); }
});
ipcMain.on('set-pref', (e, { key, value }) => setPref(key, value));
ipcMain.on('menu-action', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  runAction(action, win);
});
ipcMain.handle('autosave', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const d = win && docs.get(win.id);
  if (d && d.path && d.dirty) return saveDoc(win, false);
  return false;
});
/* ---------------- Spelling ---------------- */
const nspell = require('nspell');
const Spell = {
  checker: null, lang: null, personal: null,
  file: () => path.join(app.getPath('userData'), 'dictionary.txt'),
  loadPersonal() {
    try { this.personal = new Set(fs.readFileSync(this.file(), 'utf8').split(/\r?\n/).map(w => w.trim()).filter(Boolean)); }
    catch (e) { this.personal = new Set(); }
  },
  get() {
    const lang = prefs.spellLang === 'en-GB' ? 'en-GB' : 'en-US';
    if (this.checker && this.lang === lang) return this.checker;
    const dir = path.join(__dirname, 'node_modules', lang === 'en-GB' ? 'dictionary-en-gb' : 'dictionary-en');
    this.checker = nspell(fs.readFileSync(path.join(dir, 'index.aff')), fs.readFileSync(path.join(dir, 'index.dic')));
    this.lang = lang;
    if (!this.personal) this.loadPersonal();
    for (const w of this.personal) this.checker.add(w);
    return this.checker;
  },
  reset() { this.checker = null; this.personal = null; this.broadcast({ reset: true }); },
  broadcast(info) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('spell-changed', info); },
  add(word) {
    if (!this.personal) this.loadPersonal();
    this.personal.add(word);
    try { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), Array.from(this.personal).sort().join('\n') + '\n'); } catch (e) { /* ignore */ }
    this.get().add(word);
    this.broadcast({ added: word });
  }
};
ipcMain.handle('spell-check', (e, words) => { const sp = Spell.get(); return words.filter(w => !sp.correct(w)); });
// Rank suggestions: fewest edits first, then the ones that keep the most of the typed letters.
function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function keptLetters(typed, sugg) {
  const pool = {}; for (const c of sugg.toLowerCase()) pool[c] = (pool[c] || 0) + 1;
  let n = 0; for (const c of typed.toLowerCase()) if (pool[c] > 0) { pool[c]--; n++; }
  return n;
}
ipcMain.handle('spell-suggest', (e, word) => Spell.get().suggest(word)
  .map((s, i) => ({ s, i, d: editDistance(word, s), k: keptLetters(word, s) }))
  .sort((x, y) => x.d - y.d || y.k - x.k || x.i - y.i)
  .slice(0, 8).map(x => x.s));
ipcMain.handle('spell-add', (e, word) => { Spell.add(word); return true; });
ipcMain.handle('spell-menu', (e, { suggestions, word, hasSelection }) => new Promise((resolve) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let done = false;
  const pick = (v) => { if (!done) { done = true; resolve(v); } };
  const items = [];
  if (word) {
    if (suggestions.length) suggestions.forEach(sg => items.push({ label: sg, click: () => pick({ action: 'replace', value: sg }) }));
    else items.push({ label: 'No suggestions', enabled: false });
    items.push({ type: 'separator' },
      { label: `Add “${word}” to Dictionary`, click: () => pick({ action: 'add' }) },
      { label: 'Ignore in This Script', click: () => pick({ action: 'ignore' }) },
      { type: 'separator' });
  }
  items.push({ role: 'cut', enabled: hasSelection }, { role: 'copy', enabled: hasSelection }, { role: 'paste' });
  Menu.buildFromTemplate(items).popup({ window: win, callback: () => setTimeout(() => pick(null), 150) });
}));
function openPersonalDictionary() {
  if (!fs.existsSync(Spell.file())) { fs.mkdirSync(path.dirname(Spell.file()), { recursive: true }); fs.writeFileSync(Spell.file(), ''); }
  shell.openPath(Spell.file());
  if (!Spell.watching) {
    Spell.watching = true;
    let t = null;
    fs.watch(Spell.file(), () => { clearTimeout(t); t = setTimeout(() => Spell.reset(), 300); });
  }
}

ipcMain.handle('font-url', () => 'file://' + path.join(__dirname, 'node_modules', '@fontsource', 'courier-prime', 'files').replace(/\\/g, '/'));

function runAction(action, win) {
  win = win || focusedWin();
  switch (action) {
    case 'new': createWindow(); break;
    case 'open': openDialog(); break;
    case 'save': if (win) saveDoc(win, false); break;
    case 'save-as': if (win) saveDoc(win, true); break;
    case 'export-pdf': if (win) exportPDF(win); break;
    case 'export-fdx': if (win) exportText(win, 'fdx'); break;
    case 'export-html': if (win) exportText(win, 'html'); break;
    case 'import-fdx': importFDX(); break;
    case 'print': if (win) printDoc(win); break;
    case 'backups': {
      const dir = path.join(app.getPath('userData'), 'Backups');
      fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); break;
    }
    default: if (win) win.webContents.send('command', action);
  }
}

/* ---------------- Menu ---------------- */
function buildMenu() {
  // Editor-level shortcuts are handled inside the editor; listing them here with
  // registerAccelerator:false shows the shortcut without double-triggering.
  const ed = (label, cmd, accelerator) => ({ label, accelerator, registerAccelerator: false, click: (m, w) => runAction(cmd, w) });
  const act = (label, cmd, accelerator) => ({ label, accelerator, click: (m, w) => runAction(cmd, w) });
  const toggle = (label, key, accelerator) => ({ label, type: 'checkbox', accelerator, checked: !!(key.startsWith('print.') ? prefs.print[key.slice(6)] : prefs[key]), click: (m) => setPref(key, m.checked) });
  const radio = (label, key, value) => ({ label, type: 'radio', checked: (key.startsWith('print.') ? prefs.print[key.slice(6)] : prefs[key]) === value, click: () => setPref(key, value) });
  const colors = ['None', 'Red', 'Orange', 'Yellow', 'Green', 'Mint', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Pink', 'Brown', 'Gray'];

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File', submenu: [
        act('New', 'new', 'CmdOrCtrl+N'),
        act('Open…', 'open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: prefs.recent.length ? [
          ...prefs.recent.map(p => ({ label: p, click: () => openFile(p) })),
          { type: 'separator' }, { label: 'Clear Recent', click: () => { prefs.recent = []; savePrefs(); buildMenu(); } }
        ] : [{ label: 'No recent files', enabled: false }] },
        { type: 'separator' },
        act('Save', 'save', 'CmdOrCtrl+S'),
        act('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        toggle('Autosave', 'autosave'),
        act('Show Backups Folder', 'backups'),
        { type: 'separator' },
        act('Import Final Draft…', 'import-fdx'),
        { label: 'Export', submenu: [
          act('PDF…', 'export-pdf', 'CmdOrCtrl+Shift+E'),
          act('Final Draft (.fdx)…', 'export-fdx'),
          act('HTML…', 'export-html')
        ] },
        act('Print…', 'print', 'CmdOrCtrl+P'),
        { type: 'separator' },
        { role: isMac ? 'close' : 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W' },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Exit' }])
      ]
    },
    {
      label: '&Edit', submenu: [
        ed('Undo', 'undo', 'CmdOrCtrl+Z'),
        ed('Redo', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ed('Select All', 'select-all', 'CmdOrCtrl+A'),
        { type: 'separator' },
        ed('Find…', 'find', 'CmdOrCtrl+F'),
        ed('Find Next', 'find-next', 'F3'),
        ed('Replace…', 'replace', 'CmdOrCtrl+H'),
        ed('Go to Scene…', 'goto-scene', 'CmdOrCtrl+G'),
        { type: 'separator' },
        ed('Check Spelling…', 'spelling', 'F7'),
        toggle('Check Spelling While Typing', 'spellcheck')
      ]
    },
    {
      label: 'F&ormat', submenu: [
        ed('Bold', 'bold', 'CmdOrCtrl+B'),
        ed('Italic', 'italic', 'CmdOrCtrl+I'),
        ed('Underline', 'underline', 'CmdOrCtrl+U'),
        ed('Note', 'note', 'CmdOrCtrl+Shift+N'),
        ed('Omit (Boneyard)', 'omit', 'CmdOrCtrl+Shift+B'),
        { type: 'separator' },
        { label: 'Force Element', submenu: [
          ed('Scene Heading', 'force-heading', 'CmdOrCtrl+Alt+1'),
          ed('Action', 'force-action', 'CmdOrCtrl+Alt+2'),
          ed('Character', 'force-character', 'CmdOrCtrl+Alt+3'),
          ed('Transition', 'force-transition', 'CmdOrCtrl+Alt+4'),
          ed('Lyrics', 'force-lyrics', 'CmdOrCtrl+Alt+5'),
          ed('Centered', 'force-centered', 'CmdOrCtrl+Alt+6')
        ] },
        { label: 'Scene Color', submenu: colors.map(c => ed(c, 'color:' + c.toLowerCase())) },
        { type: 'separator' },
        ed('New Card…', 'new-card', 'CmdOrCtrl+Shift+Enter'),
        ed('Add Section', 'add-section'),
        ed('Add Synopsis', 'add-synopsis'),
        ed('Page Break', 'add-pagebreak'),
        ed('Dual Dialogue', 'dual-dialogue', 'CmdOrCtrl+Shift+D'),
        { type: 'separator' },
        ed('Title Page…', 'title-page', 'CmdOrCtrl+Shift+T'),
        ed('Lock Scene Numbers', 'lock-numbers'),
        ed('Unlock Scene Numbers', 'unlock-numbers')
      ]
    },
    {
      label: '&View', submenu: [
        act('Outline Sidebar', 'toggle-outline', 'CmdOrCtrl+Shift+O'),
        act('Index Cards', 'toggle-cards', 'CmdOrCtrl+Shift+K'),
        act('Timeline', 'toggle-timeline', 'CmdOrCtrl+Shift+L'),
        act('Print Preview', 'toggle-preview', 'CmdOrCtrl+E'),
        act('Statistics', 'stats', 'CmdOrCtrl+Shift+I'),
        { type: 'separator' },
        { label: 'Appearance', submenu: [radio('Follow System', 'theme', 'system'), radio('Light', 'theme', 'light'), radio('Dark', 'theme', 'dark')] },
        toggle('Dim Fountain Markup', 'dimMarkup', 'CmdOrCtrl+Shift+M'),
        toggle('Show Page Breaks', 'showPageBreaks'),
        toggle('Typewriter Scrolling', 'typewriter'),
        { type: 'separator' },
        ed('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        ed('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        ed('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])
      ]
    },
    {
      label: '&Settings', submenu: [
        toggle('Smart Line Breaks', 'smartLineBreaks'),
        toggle('Auto-Capitalize Headings & Characters', 'autoCaps'),
        toggle('Autocomplete', 'autocomplete'),
        { label: 'Spelling Language', submenu: [radio('English (US)', 'spellLang', 'en-US'), radio('English (UK)', 'spellLang', 'en-GB')] },
        { label: 'Open Personal Dictionary', click: () => openPersonalDictionary() },
        { type: 'separator' },
        { label: 'Paper Size', submenu: [radio('US Letter', 'print.paper', 'letter'), radio('A4', 'print.paper', 'a4')] },
        toggle('Print Scene Numbers', 'print.sceneNumbers'),
        toggle('Bold Scene Headings', 'print.boldHeadings'),
        toggle('Underline Scene Headings', 'print.underlineHeadings'),
        { label: 'Space Before Scene Headings', submenu: [radio('1 Line', 'print.spaceBeforeHeading', 1), radio('2 Lines', 'print.spaceBeforeHeading', 2)] }
      ]
    },
    {
      label: '&Help', submenu: [
        act('Fountain Syntax Guide', 'help'),
        act('Open Sample Screenplay', 'sample'),
        { label: 'Fountain.io', click: () => shell.openExternal('https://fountain.io/syntax') },
        { label: 'About Beat (the original Mac app)', click: () => shell.openExternal('https://www.beat-app.fi/') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- App lifecycle ---------------- */
function fileArgs(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && /\.(fountain|spmd|txt|fdx)$/i.test(a) && fs.existsSync(a));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    const files = fileArgs(argv);
    if (files.length) files.forEach(f => openFile(path.resolve(f)));
    else { const w = focusedWin(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady()) openFile(p); else pendingOpen.push(p); });
  const pendingOpen = [];
  app.whenReady().then(() => {
    nativeTheme.themeSource = prefs.theme;
    buildMenu();
    const files = [...fileArgs(process.argv), ...pendingOpen];
    if (files.length) files.forEach(f => createWindow(path.resolve(f)));
    else createWindow();
    // sample / help docs handled in renderer via 'command'
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

// Open sample/help as new untitled documents
ipcMain.on('open-text-doc', (e, { text }) => createWindow(null, text));

/* ---------------- Automated test hook (only when OFFBEAT_TEST is set) ---------------- */
if (process.env.OFFBEAT_TEST) {
  app.whenReady().then(() => {
    setTimeout(async () => {
      const win = BrowserWindow.getAllWindows()[0];
      const steps = require(path.resolve(process.env.OFFBEAT_TEST));
      try { await steps({ win, BrowserWindow, askRenderer, saveDoc, loadInto, docs, exportPDFTo: async (file) => {
        const payload = await askRenderer(win, 'request-print-html');
        const w = await renderInHiddenWindow(payload);
        const data = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
        fs.writeFileSync(file, data); w.destroy();
      } }); }
      catch (e) { console.error('TEST ERROR', e); }
      for (const w of BrowserWindow.getAllWindows()) { const d = docs.get(w.id); if (d) d.closing = true; }
      app.exit(0);
    }, 2500);
  });
}
