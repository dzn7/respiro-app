// Janela, menu e IPC. O renderer só pede; quem decide e executa é o main.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TRASH } from './categories/trash.js';
import { msg, resolveLocale, setLocale, t } from '../shared/i18n.js';
import { clean } from './cleaner.js';
import { CATEGORIES, ORDER, scanCategories } from './scan.js';
import * as store from './store.js';
import { diskInfo, home, loadShellPath } from './sys.js';
import * as tray from './tray.js';

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
  win.on('closed', () => {
    win = null;
    // Com a barra de menus ligada, o app continua lá e sai do Dock.
    if (store.data.prefs.showInMenuBar) app.dock?.hide();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/** @param {'rescan' | 'preferences' | 'history'} command */
const send = (command) => () => win?.webContents.send('respiro:command', command);

/** Abre (ou recria) a janela e volta ao Dock. */
function showWindow() {
  app.dock?.show();
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

/** Ações do menu da barra; Ajustes espera a página carregar se a janela acabou de nascer. */
const trayActions = {
  open: showWindow,
  scan: () => { startScan(); },
  preferences: () => {
    const fresh = !win;
    showWindow();
    if (fresh) win?.webContents.once('did-finish-load', () => setTimeout(send('preferences'), 300));
    else send('preferences')();
  },
  quit: () => app.quit(),
  scanning: () => Boolean(scanning),
};

/** Idioma da preferência ou do macOS; o menu acompanha. */
function applyLocale() {
  setLocale(resolveLocale(store.data.prefs.locale, app.getPreferredSystemLanguages()[0] ?? app.getLocale()));
  buildMenu();
  tray.update();
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Respiro', submenu: [
      { role: 'about', label: t('menu.about') },
      { type: 'separator' },
      { label: t('menu.settings'), accelerator: 'Command+,', click: send('preferences') },
      { type: 'separator' },
      { role: 'services', label: t('menu.services') },
      { type: 'separator' },
      { role: 'hide', label: t('menu.hide') },
      { role: 'hideOthers', label: t('menu.hideOthers') },
      { role: 'unhide', label: t('menu.showAll') },
      { type: 'separator' },
      { role: 'quit', label: t('menu.quit') },
    ] },
    { label: t('menu.edit'), submenu: [
      { role: 'copy', label: t('menu.copy') },
      { role: 'selectAll', label: t('menu.selectAll') },
    ] },
    { label: t('menu.view'), submenu: [
      { label: t('menu.rescan'), accelerator: 'Command+R', click: send('rescan') },
      { label: t('menu.history'), accelerator: 'Command+Y', click: send('history') },
      { type: 'separator' },
      { role: 'resetZoom', label: t('menu.actualSize') },
      { role: 'zoomIn', label: t('menu.zoomIn') },
      { role: 'zoomOut', label: t('menu.zoomOut') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.fullscreen') },
    ] },
    { label: t('menu.window'), submenu: [
      { role: 'minimize', label: t('menu.minimize') },
      { role: 'zoom', label: t('menu.zoom') },
      { role: 'close', label: t('menu.close') },
    ] },
  ]));
}

const DAY = 86_400_000;

/**
 * Anota o espaço livre para o gráfico: no máximo uma vez a cada 6 h, sempre depois de uma limpeza. Guarda um ano.
 * @param {import('../types.js').Disk} disk @param {boolean} [force]
 */
function sample(disk, force = false) {
  const last = store.data.samples.at(-1);
  if (!force && last && Date.now() - last.at < DAY / 4) return;
  store.data.samples = [...store.data.samples.filter((s) => s.at >= Date.now() - 366 * DAY), { at: Date.now(), free: disk.free, total: disk.total }];
  store.save();
}

/** A cada 5 minutos: statfs, amostra e título da barra. */
async function tick() {
  sample(await diskInfo());
  tray.update();
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
  }).finally(() => { scanning = null; tray.update(); });
  tray.update();
  return scanning;
}

/** Só a página do app fala com o main. @param {Electron.IpcMainInvokeEvent} e */
const trusted = (e) => e.senderFrame?.url.startsWith('file://') && fileURLToPath(e.senderFrame.url) === INDEX;

/** @param {string} channel @param {(...args: any[]) => any} fn */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('error.untrusted');
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
    disk: await diskInfo({ wait: !store.data.scan }), scan: store.data.scan, history: store.data.history, samples: store.data.samples, prefs: store.data.prefs, scanning: Boolean(scanning),
    // Ler a Lixeira só funciona com Acesso Total ao Disco: serve de teste da permissão.
    fullDiskAccess: await readdir(TRASH).then(() => true, () => false),
    catalog: CATEGORIES.map((c) => ({ id: c.id })),
  }));

  handle('respiro:scan', () => startScan());

  handle('respiro:clean', async (/** @type {unknown} */ refs) => {
    // A tela traduz a chave da mensagem de erro.
    if (!Array.isArray(refs) || !refs.length || refs.length > 1000) throw new Error('error.invalidRequest');
    if (cleaning) throw new Error('error.busy');
    cleaning = true;
    try {
      const targets = refs.map(resolve);
      const missing = refs.filter((_, i) => !targets[i]);
      // O que a ferramenta diz que removeu pode não virar espaço livre (clones do APFS, disco virtual do Docker).
      const freeBefore = (await diskInfo()).free;
      const result = await clean(targets.filter((t) => t !== null), store.data.prefs);
      const after = await diskInfo();
      if (!result.simulated) result.disk = after.free - freeBefore;
      result.failed.push(...missing.map((ref) => ({ ref: String(ref), name: String(ref), message: msg('error.itemMissing') })));
      if (!result.simulated && result.done.length) {
        store.data.history.unshift({ at: Date.now(), freed: result.freed, trashed: result.trashed, count: result.done.length, disk: result.disk });
        store.data.history = store.data.history.slice(0, 200);
        sample(after, true);
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
    if (['system', 'pt-BR', 'en', 'es'].includes(next?.locale)) prefs.locale = next.locale;
    for (const key of /** @type {const} */ (['onboarded', 'showInMenuBar', 'openAtLogin'])) if (typeof next?.[key] === 'boolean') prefs[key] = next[key];
    if ([0, 10, 15, 20].includes(next?.lowDiskAlert)) prefs.lowDiskAlert = next.lowDiskAlert;
    if (Array.isArray(next?.ignored) && next.ignored.length <= 1000) {
      prefs.ignored = next.ignored
        .filter((/** @type {any} */ i) => typeof i?.ref === 'string' && i.ref.includes('/') && typeof i.name === 'string' && typeof i.category === 'string')
        .map((/** @type {any} */ i) => ({ ref: i.ref.slice(0, 1024), name: i.name.slice(0, 200), category: i.category.slice(0, 80) }));
    }
    store.data.prefs = prefs;
    await store.save();
    nativeTheme.themeSource = prefs.theme;
    if (prefs.locale !== before.locale) applyLocale();
    if (prefs.openAtLogin !== before.openAtLogin) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin });
    if (prefs.showInMenuBar !== before.showInMenuBar || prefs.lowDiskAlert !== before.lowDiskAlert) tray.syncTray(trayActions);
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
  applyLocale();
  registerIpc();
  shellReady = loadShellPath();
  if (store.data.prefs.scanOnLaunch || !store.data.scan) startScan();
  createWindow();
  tray.syncTray(trayActions);
  // statfs é barato: amostra do gráfico e título da barra a cada 5 minutos.
  tick();
  setInterval(tick, 5 * 60_000);
});

app.on('window-all-closed', () => {
  if (!store.data.prefs.showInMenuBar) app.quit();
});
app.on('activate', showWindow);
