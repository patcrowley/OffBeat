'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  on: (channel, fn) => {
    const allowed = ['load', 'import-fdx', 'saved', 'prefs', 'command',
      'spell-changed', 'request-text', 'request-is-empty', 'request-suggested-name', 'request-print-html', 'request-export'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  },
  reply: (id, value) => ipcRenderer.send('reply', { id, value }),
  setDirty: (d) => ipcRenderer.send('dirty', d),
  setPref: (key, value) => ipcRenderer.send('set-pref', { key, value }),
  action: (a) => ipcRenderer.send('menu-action', a),
  autosave: () => ipcRenderer.invoke('autosave'),
  fontURL: () => ipcRenderer.invoke('font-url'),
  openTextDoc: (text) => ipcRenderer.send('open-text-doc', { text }),
  sendPosition: (pos) => ipcRenderer.send('position', pos),
  spellCheck: (words) => ipcRenderer.invoke('spell-check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell-suggest', word),
  spellAdd: (word) => ipcRenderer.invoke('spell-add', word),
  spellMenu: (opts) => ipcRenderer.invoke('spell-menu', opts),
  platform: process.platform
});
