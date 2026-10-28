// Janela, menu e IPC. O renderer só pede; quem decide e executa é o main.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TRASH } from './categories/trash.js';
import { clean } from './cleaner.js';
import { CATEGORIES, ORDER, scanCategories } from './scan.js';
import * as store from './store.js';
import { diskInfo, home, loadShellPath } from './sys.js';

/** @typedef {import('../types.js').Scan} Scan */

app.setName('Respiro');
if (process.env.RESPIRO_DATA) app.setPath('userData', process.env.RESPIRO_DATA);

const INDEX = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const FULL_DISK_ACCESS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 820, height: 700, minWidth: 680, minHeight: 560, show: false, title: 'Respiro',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window', visualEffectState: 'followWindow', backgroundColor: '#00000000',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
    },
  });
  win.loadFile(INDEX);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/** @param {'rescan' | 'preferences' | 'history'} command */
const send = (command) => () => win?.webContents.send('respiro:command', command);

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Respiro', submenu: [
      { role: 'about', label: 'Sobre o Respiro' },
      { type: 'separator' },
      { label: 'Ajustes…', accelerator: 'Command+,', click: send('preferences') },
      { type: 'separator' },
      { role: 'services', label: 'Serviços' },
      { type: 'separator' },
      { role: 'hide', label: 'Ocultar Respiro' },
      { role: 'hideOthers', label: 'Ocultar Outros' },
      { role: 'unhide', label: 'Mostrar Tudo' },
      { type: 'separator' },
      { role: 'quit', label: 'Encerrar Respiro' },
    ] },
    { label: 'Editar', submenu: [
      { role: 'copy', label: 'Copiar' },
      { role: 'selectAll', label: 'Selecionar Tudo' },
    ] },
    { label: 'Visualizar', submenu: [
      { label: 'Reanalisar', accelerator: 'Command+R', click: send('rescan') },
      { label: 'Histórico', accelerator: 'Command+Y', click: send('history') },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Tamanho Real' },
      { role: 'zoomIn', label: 'Aumentar' },
      { role: 'zoomOut', label: 'Diminuir' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Tela Cheia' },
    ] },
    { label: 'Janela', submenu: [
      { role: 'minimize', label: 'Minimizar' },
      { role: 'zoom', label: 'Zoom' },
      { role: 'close', label: 'Fechar' },
    ] },
  ]));
}

/** @type {Promise<Scan> | null} */
let scanning = null;
/** PATH do shell carrega uma vez; a primeira análise espera por ele. */
let shellReady = Promise.resolve();

/** @param {Set<string>} [only] */
function startScan(only) {
  if (scanning) return scanning;
  const t0 = Date.now();
  const { prefs, sizeCache } = store.data;
  const ignored = new Set(prefs.ignored.map((i) => i.ref));
  const progress = (/** @type {import('../types.js').Progress} */ p) => win?.webContents.send('respiro:progress', p);
  scanning = shellReady.then(() => scanCategories({ home, staleDays: prefs.staleDays, sizeCache, ignored }, progress, only)).then((found) => {
    const kept = only ? (store.data.scan?.categories ?? []).filter((c) => !only.has(c.id)) : [];
    /** @type {Scan} */
    const scan = { at: Date.now(), ms: Date.now() - t0, categories: [...kept, ...found].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)) };
    store.data.scan = scan;
    store.save();
    console.log(`[scan] ${only ? [...only].join(',') : 'completa'} em ${scan.ms} ms`);
    progress({ done: 1, total: 1, finished: scan });
    return scan;
  }).finally(() => { scanning = null; });
  return scanning;
}

/** Só a página do app fala com o main. @param {Electron.IpcMainInvokeEvent} e */
const trusted = (e) => e.senderFrame?.url.startsWith('file://') && fileURLToPath(e.senderFrame.url) === INDEX;

/** @param {string} channel @param {(...args: any[]) => any} fn */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Origem não autorizada.');
    return fn(...args);
  });
}

/** Resolve "categoria/item" na última análise. O renderer nunca manda caminho. @param {unknown} ref */
function resolve(ref) {
  if (typeof ref !== 'string') return null;
  const slash = ref.indexOf('/');
  const category = store.data.scan?.categories.find((c) => c.id === ref.slice(0, slash));
  const item = category?.items.find((i) => i.id === ref.slice(slash + 1));
  return category && item ? { ref, category: category.id, item } : null;
}

let cleaning = false;

function registerIpc() {
  handle('respiro:state', async () => ({
    disk: await diskInfo({ wait: !store.data.scan }), scan: store.data.scan, history: store.data.history, prefs: store.data.prefs, scanning: Boolean(scanning),
    // Ler a Lixeira só funciona com Acesso Total ao Disco: serve de teste da permissão.
    fullDiskAccess: await readdir(TRASH).then(() => true, () => false),
    catalog: CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
  }));

  handle('respiro:scan', () => startScan());

  handle('respiro:clean', async (/** @type {unknown} */ refs) => {
    if (!Array.isArray(refs) || !refs.length || refs.length > 1000) throw new Error('Pedido de limpeza inválido.');
    if (cleaning) throw new Error('Espere a limpeza em andamento terminar.');
    cleaning = true;
    try {
      const targets = refs.map(resolve);
      const missing = refs.filter((_, i) => !targets[i]);
      // O que a ferramenta diz que removeu pode não virar espaço livre (clones do APFS, disco virtual do Docker).
      const freeBefore = (await diskInfo()).free;
      const result = await clean(targets.filter((t) => t !== null), store.data.prefs);
      if (!result.simulated) result.disk = (await diskInfo()).free - freeBefore;
      result.failed.push(...missing.map((ref) => ({ ref: String(ref), name: String(ref), message: 'Item não encontrado. Reanalise e tente de novo.' })));
      if (!result.simulated && result.done.length) {
        store.data.history.unshift({ at: Date.now(), freed: result.freed, trashed: result.trashed, count: result.done.length, disk: result.disk });
        store.data.history = store.data.history.slice(0, 200);
        await store.save();
        const touched = new Set([...result.done.map((r) => r.slice(0, r.indexOf('/'))), 'trash']);
        // Análise em curso usa dados de antes da limpeza: reanalisa as categorias tocadas quando ela terminar.
        if (scanning) scanning.finally(() => startScan(touched));
        else startScan(touched);
      }
      return result;
    } finally {
      cleaning = false;
    }
  });

  handle('respiro:prefs', async (/** @type {any} */ next) => {
    const before = store.data.prefs;
    const prefs = { ...before };
    if (typeof next?.simulate === 'boolean') prefs.simulate = next.simulate;
    if (typeof next?.scanOnLaunch === 'boolean') prefs.scanOnLaunch = next.scanOnLaunch;
    if ([30, 60, 90].includes(next?.staleDays)) prefs.staleDays = next.staleDays;
    if (['system', 'light', 'dark'].includes(next?.theme)) prefs.theme = next.theme;
    if (Array.isArray(next?.ignored) && next.ignored.length <= 1000) {
      prefs.ignored = next.ignored
        .filter((/** @type {any} */ i) => typeof i?.ref === 'string' && i.ref.includes('/') && typeof i.name === 'string' && typeof i.category === 'string')
        .map((/** @type {any} */ i) => ({ ref: i.ref.slice(0, 1024), name: i.name.slice(0, 200), category: i.category.slice(0, 80) }));
    }
    store.data.prefs = prefs;
    await store.save();
    nativeTheme.themeSource = prefs.theme;
    // Item que voltou a ser mostrado só reaparece analisando a categoria dele de novo.
    const restored = before.ignored.filter((i) => !prefs.ignored.some((j) => j.ref === i.ref)).map((i) => i.ref.slice(0, i.ref.indexOf('/')));
    const rescan = new Set([...restored, ...(prefs.staleDays !== before.staleDays ? ['node'] : [])]);
    if (rescan.size) (scanning ?? Promise.resolve()).finally(() => startScan(rescan));
    return prefs;
  });

  handle('respiro:reveal', (/** @type {unknown} */ ref) => {
    const path = resolve(ref)?.item.path;
    if (path) shell.showItemInFolder(path);
  });

  handle('respiro:open', (/** @type {unknown} */ target) => {
    if (target === 'full-disk-access') return shell.openExternal(FULL_DISK_ACCESS);
    if (target === 'docker') return shell.openPath('/Applications/Docker.app').then(() => undefined);
    return undefined;
  });
}

app.whenReady().then(async () => {
  store.load();
  nativeTheme.themeSource = store.data.prefs.theme;
  buildMenu();
  registerIpc();
  shellReady = loadShellPath();
  if (store.data.prefs.scanOnLaunch || !store.data.scan) startScan();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
