// Ponte da pílula do topo: só recebe o que mostrar e devolve hover e clique.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  on: (/** @type {(p: unknown) => void} */ cb) => ipcRenderer.on('island:show', (_e, p) => cb(p)),
  hover: (/** @type {boolean} */ on) => ipcRenderer.send('island:hover', on),
  act: (/** @type {'open' | 'hidden'} */ action) => ipcRenderer.send('island:act', action),
});
