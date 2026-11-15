'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  on: (channel, fn) => {
    const allowed = ['load', 'import-fdx', 'saved', 'prefs', 'command', 'activate-tab', 'remove-tab',
      'spell-changed', 'request-text', 'request-is-empty', 'request-suggested-name', 'request-print-html', 'request-export'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  },
  reply: (id, value) => ipcRenderer.send('reply', { id, value }),
  setDirty: (d, tabId) => ipcRenderer.send('dirty', { dirty: d, tabId }),
  setPref: (key, value) => ipcRenderer.send('set-pref', { key, value }),
  action: (a) => ipcRenderer.send('menu-action', a),
  autosave: (tabId) => ipcRenderer.invoke('autosave', tabId),
  tabActivated: (tabId) => ipcRenderer.send('tab-activated', tabId),
  tabsOrder: (ids) => ipcRenderer.send('tabs-order', ids),
  tabInfo: (tabId, info) => ipcRenderer.send('tab-info', Object.assign({ tabId }, info)),
  fontURL: () => ipcRenderer.invoke('font-url'),
  openTextDoc: (text, name) => ipcRenderer.send('open-text-doc', { text, name }),
  sendPosition: (pos, tabId) => ipcRenderer.send('position', { pos, tabId }),
  spellCheck: (words) => ipcRenderer.invoke('spell-check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell-suggest', word),
  spellAdd: (word) => ipcRenderer.invoke('spell-add', word),
  spellMenu: (opts) => ipcRenderer.invoke('spell-menu', opts),
  platform: process.platform
});
