// Ponte mínima: o renderer só chama estes métodos e só recebe estes eventos.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('respiro', {
  state: () => ipcRenderer.invoke('respiro:state'),
  scan: () => ipcRenderer.invoke('respiro:scan'),
  clean: (/** @type {string[]} */ refs) => ipcRenderer.invoke('respiro:clean', refs),
  setPrefs: (/** @type {object} */ prefs) => ipcRenderer.invoke('respiro:prefs', prefs),
  reveal: (/** @type {string} */ ref) => ipcRenderer.invoke('respiro:reveal', ref),
  open: (/** @type {string} */ target) => ipcRenderer.invoke('respiro:open', target),
  onProgress: (/** @type {(p: unknown) => void} */ cb) => ipcRenderer.on('respiro:progress', (_e, p) => cb(p)),
  onCommand: (/** @type {(c: unknown) => void} */ cb) => ipcRenderer.on('respiro:command', (_e, c) => cb(c)),
});
