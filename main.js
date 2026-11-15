'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Offbeat');

// Portable build: keep settings, backups and the personal dictionary next to the .exe
// (so it all travels on a USB stick). Falls back to the normal location if that folder is read-only.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Offbeat Data');
  try {
    fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK);
    // First run of the portable version: start from the installed version's settings and word list.
    const installed = app.getPath('userData');
    for (const f of ['prefs.json', 'dictionary.txt']) {
      try { if (!fs.existsSync(path.join(dataDir, f)) && fs.existsSync(path.join(installed, f))) fs.copyFileSync(path.join(installed, f), path.join(dataDir, f)); } catch (e) { /* ignore */ }
    }
    app.setPath('userData', dataDir);
    // browser caches stay on the PC's temp folder, not the stick
    app.setPath('sessionData', path.join(app.getPath('temp'), 'Offbeat Portable Cache'));
    app.setPath('crashDumps', path.join(app.getPath('temp'), 'Offbeat Portable Cache', 'Crashpad'));
  }
  catch (e) { /* not writable: use %APPDATA%\Offbeat */ }
}
const isMac = process.platform === 'darwin';

/* ---------------- Preferences ---------------- */
const PREF_FILE = () => path.join(app.getPath('userData'), 'prefs.json');
const DEFAULT_PREFS = {
  theme: 'system',          // system | light | dark
  dimMarkup: false,
  showRevisions: true,
  showTags: true,
  showPageBreaks: true,
  smartLineBreaks: true,
  autoCaps: true,
  autocomplete: true,
  spellcheck: true,
  spellLang: 'en-US',
  typewriter: false,
  zoom: 1,
  autosave: true,           // save a moment after you stop typing (only scripts that have a file)
  outlineVisible: true,
  reopenLast: true,         // reopen the scripts that were open when Offbeat last closed
  uiScale: 1,               // size of the whole interface (1 = 100%)
  editorFont: 'courier-prime',
  print: { paper: 'letter', sceneNumbers: true, boldHeadings: true, underlineHeadings: false, spaceBeforeHeading: 2, font: 'courier-prime' },
  recent: [],
  session: [],              // scripts open at last quit (one tab each)
  sessionActive: null,      // the tab that was showing
  positions: {},            // path -> { line, ch, offset } so each script reopens where you left off
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
  if (key === 'uiScale') for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && docs.has(w.id)) applyScale(w);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && docs.has(w.id)) w.webContents.send('prefs', prefs);
  buildMenu();
}

/* ---------------- Documents / windows ---------------- */
// Each window holds one or more scripts, shown as tabs.
// docs: window id -> { tabs: Map(tabId -> { id, path, dirty, pos }), order: [tabId], active: tabId, closing }
// rec.path / rec.dirty describe the tab that's showing.
const docs = new Map();
let tabSeq = 0;
function newRecord() {
  return {
    tabs: new Map(), order: [], active: null, closing: false, lastClosedPath: null,
    get tab() { return this.tabs.get(this.active) || null; },
    get path() { const t = this.tab; return t ? t.path : null; },
    get dirty() { const t = this.tab; return t ? t.dirty : false; },
    set dirty(v) { const t = this.tab; if (t) t.dirty = v; }
  };
}
function tabPaths(rec) { return rec.order.map(id => rec.tabs.get(id)).filter(t => t && t.path).map(t => t.path); }
function untitledName(rec) {
  const used = new Set([...rec.tabs.values()].map(t => t.name));
  if (!used.has('Untitled')) return 'Untitled';
  let n = 2; while (used.has('Untitled ' + n)) n++;
  return 'Untitled ' + n;
}
const pendingReplies = new Map();
let replyId = 0;

/* Interface size: scales the whole window (menus excepted, which follow Windows' own scaling). */
const UI_SCALES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
function applyScale(win) {
  const z = UI_SCALES.includes(prefs.uiScale) ? prefs.uiScale : 1;
  win.webContents.setZoomFactor(z);
}
function stepScale(dir) {
  const i = UI_SCALES.indexOf(UI_SCALES.includes(prefs.uiScale) ? prefs.uiScale : 1);
  const next = UI_SCALES[Math.max(0, Math.min(UI_SCALES.length - 1, i + dir))];
  if (next !== prefs.uiScale) setPref('uiScale', next);
}

/* Remember where the cursor was in each script, and which scripts were open. */
let quitting = false;
function rememberPosition(d) {
  if (!d || !d.path || !d.pos) return;
  delete prefs.positions[d.path];
  prefs.positions[d.path] = d.pos;
  const keys = Object.keys(prefs.positions);
  for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete prefs.positions[k];
}
function openPaths(exceptId) {
  const out = [];
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.id === exceptId || !docs.has(w.id)) continue;
    for (const p of tabPaths(docs.get(w.id))) if (!out.includes(p)) out.push(p);
  }
  return out;
}
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  for (const rec of docs.values()) for (const t of rec.tabs.values()) rememberPosition(t);
  const open = openPaths();
  if (open.length) {
    prefs.session = open;
    const fw = focusedWin(); const rec = fw && docs.get(fw.id);
    prefs.sessionActive = rec && rec.path ? rec.path : null;
  }
  savePrefs();
});
function tabFrom(e, tabId) {
  const win = BrowserWindow.fromWebContents(e.sender);
  const rec = win && docs.get(win.id);
  if (!rec) return {};
  return { win, rec, tab: rec.tabs.get(tabId != null ? tabId : rec.active) };
}
ipcMain.on('position', (e, msg) => {
  const { tab } = tabFrom(e, msg && msg.tabId);
  if (tab && tab.path) tab.pos = msg && msg.pos ? msg.pos : msg;
});
// The window's tabs as the editor shows them.
ipcMain.on('tab-activated', (e, tabId) => {
  const { win, rec } = tabFrom(e);
  if (rec && rec.tabs.has(tabId)) { rec.active = tabId; updateTitle(win); }
});
ipcMain.on('tabs-order', (e, ids) => {
  const { rec } = tabFrom(e);
  if (rec && Array.isArray(ids)) rec.order = ids.filter(id => rec.tabs.has(id)).concat(rec.order.filter(id => !ids.includes(id)));
});
ipcMain.on('tab-info', (e, { tabId, path: p, name }) => {
  const { win, tab } = tabFrom(e, tabId);
  if (tab) { tab.path = p || null; tab.name = name || tab.name; updateTitle(win); }
});

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

function createWindow(files, opts) {
  opts = opts || {};
  const filePaths = (Array.isArray(files) ? files : files ? [files] : []);
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
  docs.set(win.id, newRecord());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', async () => {
    applyScale(win);
    win.webContents.send('prefs', prefs);
    const rec = docs.get(win.id);
    if (rec && rec.tabs.size) return;   // a reload: keep what's there
    for (const p of filePaths) await loadInto(win, p, { reuse: false });
    if (!rec.tabs.size) newTab(win, opts.text, opts.name);
    if (opts.activePath) {
      const t = [...rec.tabs.values()].find(x => x.path === opts.activePath);
      if (t) win.webContents.send('activate-tab', { tabId: t.id });
    }
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
    const rec = docs.get(win.id);
    if (!rec || rec.closing) return;
    const dirtyTabs = rec.order.map(id => rec.tabs.get(id)).filter(t => t && t.dirty);
    if (!dirtyTabs.length) return;
    e.preventDefault();
    if (rec.resolving) return;
    rec.resolving = true;
    try {
      for (const t of dirtyTabs) if (!(await resolveDirtyTab(win, t))) return;   // Cancel keeps the window open
      rec.closing = true;
      win.close();
    } finally { rec.resolving = false; }
  });
  const winId = win.id;
  win.on('closed', () => {
    const rec = docs.get(winId);
    docs.delete(winId);
    if (quitting || !rec) return;
    for (const t of rec.tabs.values()) rememberPosition(t);
    // Closing the last window ends the session: remember its scripts for next time.
    const others = openPaths(winId);
    const mine = tabPaths(rec);
    if (others.length) prefs.session = others;
    else if (mine.length) { prefs.session = mine; prefs.sessionActive = rec.path; }
    else if (rec.lastClosedPath) { prefs.session = [rec.lastClosedPath]; prefs.sessionActive = rec.lastClosedPath; }
    else if (BrowserWindow.getAllWindows().length > 0) prefs.session = [];
    savePrefs();
  });
  const remember = () => { if (!win.isMaximized() && !win.isMinimized()) { prefs.bounds = win.getBounds(); savePrefs(); } };
  win.on('resized', remember);
  win.on('moved', remember);
  return win;
}

function updateTitle(win) {
  const rec = win && !win.isDestroyed() && docs.get(win.id);
  if (!rec || !rec.tab) return;
  const t = rec.tab;
  const name = t.path ? path.basename(t.path) : (t.name || 'Untitled');
  win.setTitle(`${t.dirty ? '• ' : ''}${name} — Offbeat`);
  if (isMac) { win.setDocumentEdited(t.dirty); if (t.path) win.setRepresentedFilename(t.path); }
}

/* A new, empty (or given) script in its own tab. */
function newTab(win, text, name) {
  const rec = docs.get(win.id); if (!rec) return null;
  const id = ++tabSeq;
  const t = { id, path: null, dirty: false, pos: null, name: name || untitledName(rec) };
  rec.tabs.set(id, t); rec.order.push(id); rec.active = id;
  win.webContents.send('load', { tabId: id, text: text || '', path: null, name: t.name });
  updateTitle(win);
  return id;
}

/* Ask about one unsaved tab. Returns false if the person chose Cancel. */
async function resolveDirtyTab(win, t) {
  if (!t || !t.dirty) return true;
  if (prefs.autosave && t.path && await saveDoc(win, false, { auto: true, tabId: t.id })) return true;
  win.webContents.send('activate-tab', { tabId: t.id });
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
    message: `Do you want to save the changes you made to ${t.path ? path.basename(t.path) : (t.name || 'Untitled')}?`,
    detail: "Your changes will be lost if you don't save them."
  });
  if (r.response === 2) return false;
  if (r.response === 0) return saveDoc(win, false, { tabId: t.id });
  return true;
}

async function closeTab(win, tabId) {
  const rec = win && docs.get(win.id); if (!rec) return;
  const t = rec.tabs.get(tabId != null ? tabId : rec.active); if (!t) return;
  if (!(await resolveDirtyTab(win, t))) return;
  rememberPosition(t); savePrefs();
  if (t.path) rec.lastClosedPath = t.path;
  rec.tabs.delete(t.id);
  rec.order = rec.order.filter(id => id !== t.id);
  if (rec.active === t.id) rec.active = rec.order[0] || null;
  if (!rec.tabs.size) { rec.closing = true; win.close(); return; }   // last tab closes the window
  win.webContents.send('remove-tab', { tabId: t.id });
}
async function closeOtherTabs(win, keepId) {
  const rec = win && docs.get(win.id); if (!rec) return;
  for (const id of rec.order.slice()) if (id !== keepId) { await closeTab(win, id); if (rec.tabs.has(id)) return; }
}

function addRecent(p) {
  if (prefs.recent[0] === p) return;   // already first: nothing to update (keeps open menus from closing on autosave)
  prefs.recent = [p, ...prefs.recent.filter(x => x !== p)].slice(0, 12);
  savePrefs();
  try { app.addRecentDocument(p); } catch (e) { /* ignore */ }
  buildMenu();
}

/* Open a file in a tab of this window (or switch to it if it's already open here).
   An empty, untouched Untitled tab is reused instead of left behind. Returns the tab id. */
async function loadInto(win, filePath, opts) {
  opts = opts || {};
  const rec = docs.get(win.id); if (!rec) return null;
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (err) { dialog.showErrorBox('Could not open file', String(err.message || err)); return null; }
  const isFdx = /\.fdx$/i.test(filePath);
  if (!isFdx) for (const t of rec.tabs.values()) if (t.path === filePath) { win.webContents.send('activate-tab', { tabId: t.id }); return t.id; }
  let tabId = null;
  const a = rec.tab;
  if (opts.reuse !== false && a && !a.path && !a.dirty && await askRenderer(win, 'request-is-empty', { tabId: a.id })) tabId = a.id;
  const replace = tabId != null;
  if (!replace) tabId = ++tabSeq;
  const name = isFdx ? path.basename(filePath, path.extname(filePath)) + ' (imported)' : path.basename(filePath);
  rec.tabs.set(tabId, { id: tabId, path: isFdx ? null : filePath, dirty: isFdx, pos: null, name });
  if (!replace) rec.order.push(tabId);
  rec.active = tabId;
  if (isFdx) win.webContents.send('import-fdx', { tabId, xml: text, name: path.basename(filePath, path.extname(filePath)), replace });
  else {
    win.webContents.send('load', { tabId, text, path: filePath, name, pos: prefs.positions[filePath] || null, replace });
    addRecent(filePath);
  }
  updateTitle(win);
  return tabId;
}

function focusedWin() { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; }

async function openFile(p) {
  // already open somewhere? show that tab
  for (const w of BrowserWindow.getAllWindows()) {
    const rec = docs.get(w.id); if (!rec) continue;
    for (const t of rec.tabs.values()) if (t.path === p) {
      if (w.isMinimized()) w.restore();
      w.focus(); w.webContents.send('activate-tab', { tabId: t.id }); return;
    }
  }
  const win = focusedWin();
  if (win && docs.has(win.id)) { if (win.isMinimized()) win.restore(); win.focus(); await loadInto(win, p); }
  else createWindow([p]);
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

const lastBackup = new Map();
function backup(filePath, auto) {
  try {
    if (!fs.existsSync(filePath)) return;
    if (auto && Date.now() - (lastBackup.get(filePath) || 0) < 10 * 60 * 1000) return;
    lastBackup.set(filePath, Date.now());
    const dir = path.join(app.getPath('userData'), 'Backups', path.basename(filePath, path.extname(filePath)));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(filePath, path.join(dir, `${stamp}${path.extname(filePath) || '.fountain'}`));
    const files = fs.readdirSync(dir).sort();
    while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { /* ignore */ }
}

async function saveDoc(win, saveAs, opts) {
  const auto = !!(opts && opts.auto);
  const rec = docs.get(win.id);
  if (!rec) return false;
  const d = rec.tabs.get(opts && opts.tabId != null ? opts.tabId : rec.active);
  if (!d) return false;
  let target = d.path;
  if (saveAs || !target) {
    if (opts && opts.tabId != null) win.webContents.send('activate-tab', { tabId: d.id });
    const suggested = await askRenderer(win, 'request-suggested-name', { tabId: d.id });
    const r = await dialog.showSaveDialog(win, {
      defaultPath: target || path.join(app.getPath('documents'), (suggested || 'Untitled') + '.fountain'),
      filters: [{ name: 'Fountain', extensions: ['fountain'] }, { name: 'Text', extensions: ['txt'] }]
    });
    if (r.canceled || !r.filePath) return false;
    target = r.filePath;
  }
  const text = await askRenderer(win, 'request-text', { tabId: d.id });
  if (text === null) { dialog.showErrorBox('Save failed', 'Could not read the document.'); return false; }
  try {
    backup(target, auto);
    const tmp = target + '.offbeat-tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
    d.path = target; d.dirty = false; d.name = path.basename(target);
    updateTitle(win);
    addRecent(target);
    win.webContents.send('saved', { tabId: d.id, path: target, name: path.basename(target), auto });
    return true;
  } catch (err) {
    dialog.showErrorBox('Save failed', String(err.message || err));
    return false;
  }
}

/* ---------------- Export / print ---------------- */
async function renderInHiddenWindow(payload) {
  // A separate session keeps the interface size (zoom) from leaking into printed pages.
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, partition: 'offbeat-print', zoomFactor: 1 } });
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
ipcMain.on('dirty', (e, msg) => {
  const m = typeof msg === 'object' && msg ? msg : { dirty: msg };
  const { win, tab } = tabFrom(e, m.tabId);
  if (tab && tab.dirty !== m.dirty) { tab.dirty = !!m.dirty; updateTitle(win); }
});
ipcMain.on('set-pref', (e, { key, value }) => setPref(key, value));
ipcMain.on('menu-action', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  runAction(action, win);
});
ipcMain.handle('autosave', async (e, tabId) => {
  const { win, tab } = tabFrom(e, tabId);
  if (tab && tab.path && tab.dirty) return saveDoc(win, false, { auto: true, tabId: tab.id });
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
    case 'new': if (win && docs.has(win.id)) newTab(win); else createWindow(); break;
    case 'new-window': createWindow(); break;
    case 'close-tab': if (win) closeTab(win); break;
    case 'close-window': if (win) win.close(); break;
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
    default:
      if (win && /^close-tab:\d+$/.test(action)) closeTab(win, +action.split(':')[1]);
      else if (win && /^close-others:\d+$/.test(action)) closeOtherTabs(win, +action.split(':')[1]);
      else if (win) win.webContents.send('command', action);
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
        act('New Script', 'new', 'CmdOrCtrl+N'),
        act('New Window', 'new-window'),
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
        act('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        act('Close Window', 'close-window', 'CmdOrCtrl+Shift+W'),
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
      label: '&Review', submenu: [
        ed('Revision Mode', 'revision-mode', 'F8'),
        { label: 'Revision Color', submenu: ['Blue', 'Pink', 'Yellow', 'Green', 'Goldenrod', 'Buff', 'Rose', 'Cherry'].map((c, k) => ed(c, 'rev-gen:' + k)) },
        ed('Mark Selection as Revised', 'mark-revised'),
        ed('Suggest Selection for Removal', 'mark-removal'),
        ed('Clear Revision Marks', 'clear-revisions'),
        { type: 'separator' },
        ed('Add Review Note…', 'add-review', 'CmdOrCtrl+Shift+R'),
        ed('Next Review Note', 'next-review'),
        ed('Previous Review Note', 'prev-review'),
        ed('Remove Review Notes', 'remove-reviews'),
        { type: 'separator' },
        { label: 'Tag Selection As', submenu: [['Cast', 'cast'], ['Prop', 'prop'], ['Costume', 'costume'], ['Makeup', 'makeup'], ['Set Design', 'setDesign'],
          ['Vehicle', 'vehicle'], ['Animal', 'animal'], ['Extras', 'extras'], ['Stunt', 'stunt'], ['Special Effect', 'sfx'], ['Visual Effect', 'vfx'],
          ['Camera', 'camera'], ['Sound', 'sound'], ['Music', 'music'], ['Other', 'other']].map(([l, k]) => ed(l, 'tag:' + k)) },
        ed('Remove Tags', 'remove-tags'),
        { type: 'separator' },
        { label: 'Line Alternatives', submenu: [
          ed('New Alternative for This Line', 'alt-add'),
          ed('Next Version', 'alt-next', 'Alt+Down'),
          ed('Previous Version', 'alt-prev', 'Alt+Up'),
          ed('Keep Only This Version', 'alt-remove')
        ] },
        { type: 'separator' },
        ed('Document Settings…', 'doc-settings')
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
        ed('Next Tab', 'next-tab', 'Ctrl+Tab'),
        ed('Previous Tab', 'prev-tab', 'Ctrl+Shift+Tab'),
        { type: 'separator' },
        { label: 'Appearance', submenu: [radio('Follow System', 'theme', 'system'), radio('Light', 'theme', 'light'), radio('Dark', 'theme', 'dark')] },
        toggle('Dim Fountain Markup', 'dimMarkup', 'CmdOrCtrl+Shift+M'),
        toggle('Show Page Breaks', 'showPageBreaks'),
        toggle('Show Revisions', 'showRevisions'),
        toggle('Show Tags', 'showTags'),
        toggle('Typewriter Scrolling', 'typewriter'),
        { type: 'separator' },
        { label: 'Interface Size', submenu: [
          ...UI_SCALES.map(z => ({ label: Math.round(z * 100) + '%' + (z === 1 ? ' (default)' : ''), type: 'radio', checked: (UI_SCALES.includes(prefs.uiScale) ? prefs.uiScale : 1) === z, click: () => setPref('uiScale', z) })),
          { type: 'separator' },
          { label: 'Larger', accelerator: 'CmdOrCtrl+Shift+=', click: () => stepScale(1) },
          { label: 'Smaller', accelerator: 'CmdOrCtrl+Shift+-', click: () => stepScale(-1) }
        ] },
        { label: 'Editor Font', submenu: [
          radio('Courier Prime (default)', 'editorFont', 'courier-prime'),
          radio('Courier New', 'editorFont', 'courier-new'),
          radio('IBM Plex Mono', 'editorFont', 'plex'),
          radio('Atkinson Hyperlegible Mono (for low vision)', 'editorFont', 'atkinson'),
          radio('OpenDyslexic (for dyslexia)', 'editorFont', 'opendyslexic')
        ] },
        { type: 'separator' },
        ed('Zoom Script In', 'zoom-in', 'CmdOrCtrl+='),
        ed('Zoom Script Out', 'zoom-out', 'CmdOrCtrl+-'),
        ed('Script Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])
      ]
    },
    {
      label: '&Settings', submenu: [
        toggle('Reopen Last Script on Startup', 'reopenLast'),
        { type: 'separator' },
        toggle('Smart Line Breaks', 'smartLineBreaks'),
        toggle('Auto-Capitalize Headings & Characters', 'autoCaps'),
        toggle('Autocomplete', 'autocomplete'),
        { label: 'Spelling Language', submenu: [radio('English (US)', 'spellLang', 'en-US'), radio('English (UK)', 'spellLang', 'en-GB')] },
        { label: 'Open Personal Dictionary', click: () => openPersonalDictionary() },
        { type: 'separator' },
        { label: 'Paper Size', submenu: [radio('US Letter', 'print.paper', 'letter'), radio('A4', 'print.paper', 'a4')] },
        { label: 'PDF and Print Font', submenu: [radio('Courier Prime (default)', 'print.font', 'courier-prime'), radio('Courier New', 'print.font', 'courier-new')] },
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
    // (files are opened as tabs in the existing window by openFile)
  });
  app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady()) openFile(p); else pendingOpen.push(p); });
  const pendingOpen = [];
  app.whenReady().then(() => {
    nativeTheme.themeSource = prefs.theme;
    buildMenu();
    const files = [...fileArgs(process.argv), ...pendingOpen];
    if (files.length) createWindow(files.map(f => path.resolve(f)));
    else {
      // Reopen the scripts from last time (skipping any that were moved or deleted).
      let last = [];
      if (prefs.reopenLast) {
        last = (prefs.session || []).filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
        if (!last.length && prefs.recent[0] && fs.existsSync(prefs.recent[0])) last = [prefs.recent[0]];
      }
      if (last.length) createWindow(last, { activePath: prefs.sessionActive });
      else createWindow();
    }
    // sample / help docs handled in renderer via 'command'
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

// Open sample/help as new untitled tabs
ipcMain.on('open-text-doc', (e, { text, name }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && docs.has(win.id)) newTab(win, text, name); else createWindow([], { text, name });
});

/* ---------------- Automated test hook (only when OFFBEAT_TEST is set) ---------------- */
if (process.env.OFFBEAT_TEST) {
  app.whenReady().then(() => {
    setTimeout(async () => {
      const win = BrowserWindow.getAllWindows()[0];
      const steps = require(path.resolve(process.env.OFFBEAT_TEST));
      try { await steps({ win, BrowserWindow, askRenderer, saveDoc, loadInto, docs, newTab, closeTab, createWindow, openFile, prefs: () => prefs, exportPDFTo: async (file) => {
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
