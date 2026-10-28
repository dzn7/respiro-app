// Janela, menu e IPC. O renderer só pede; quem decide e executa é o main.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRASH } from './categories/trash.js';
import { getLocale, msg, resolveLocale, setLocale, t } from '../shared/i18n.js';
import { clean } from './cleaner.js';
import { CATEGORIES, ORDER, scanCategories } from './scan.js';
import * as store from './store.js';
import { diskInfo, home, loadShellPath, tilde } from './sys.js';
import * as explore from './explore.js';
import { initIsland, island } from './island.js';
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
  // Fechar (ou ⌘Q) no meio de uma limpeza perderia histórico e reanálise: espera terminar.
  win.on('close', (e) => { if (cleaning) e.preventDefault(); });
  win.on('closed', () => {
    win = null;
    // Com a barra de menus ligada, o app continua lá e sai do Dock.
    if (store.data.prefs.showInMenuBar) app.dock?.hide();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/** @param {'rescan' | 'preferences' | 'history' | 'show-cleaning' | 'explore'} command */
const send = (command) => () => win?.webContents.send('respiro:command', command);

/** Abre (ou recria) a janela e volta ao Dock. */
function showWindow() {
  app.dock?.show();
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

/** Abre a janela e manda um comando à tela; se a janela acabou de nascer, espera a página carregar. @param {'preferences' | 'show-cleaning'} name */
function command(name) {
  const fresh = !win;
  showWindow();
  if (fresh) win?.webContents.once('did-finish-load', () => setTimeout(send(name), 300));
  else send(name)();
}

/** Ações do menu da barra. */
const trayActions = {
  open: showWindow,
  scan: () => { startScan(); },
  preferences: () => command('preferences'),
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
      { label: t('menu.explore'), accelerator: 'Command+E', click: send('explore') },
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
  retryDeferred();
}

/** @type {Promise<Scan> | null} */
let scanning = null;
/** PATH do shell carrega uma vez; a primeira análise espera por ele. */
let shellReady = Promise.resolve();

/** Pedido feito durante outra análise: roda quando ela terminar. 'all' = completa. @type {Set<string> | 'all' | null} */
let queued = null;

/** @param {Set<string>} [only] */
function startScan(only) {
  if (scanning) {
    queued = !only || queued === 'all' ? 'all' : new Set([...(queued ?? []), ...only]);
    return scanning;
  }
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
  }).finally(() => {
    scanning = null;
    tray.update();
    const next = queued;
    queued = null;
    if (next) startScan(next === 'all' ? undefined : next);
  });
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

/**
 * Resolve "categoria/item" na última análise, ou "explore/<id>" no índice do Explorar. O renderer nunca manda caminho.
 * @param {unknown} ref @returns {import('./cleaner.js').Target | null}
 */
function resolve(ref) {
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('explore/')) {
    const id = ref.slice(8);
    const e = explore.lookup(id);
    return e && { ref, category: 'explore', item: { id, name: basename(e.path), detail: tilde(e.path), size: e.size, freeable: e.size, safe: false,
      path: e.path, seen: e.seen, action: { kind: 'trash', path: e.path } } };
  }
  const slash = ref.indexOf('/');
  const category = store.data.scan?.categories.find((c) => c.id === ref.slice(0, slash));
  const item = category?.items.find((i) => i.id === ref.slice(slash + 1));
  return category && item ? { ref, category: category.id, item } : null;
}

let cleaning = false;
/** A pessoa mandou a limpeza para segundo plano: progresso e fim vão para a pílula do topo. */
let background = false;

/**
 * Resultado na pílula do topo. @param {import('../types.js').CleanResult} r @param {string} [title]
 */
function islandResult(r, title) {
  const later = !r.done.length && !r.failed.length && r.skipped.length > 0;
  const tone = r.done.length ? 'ok' : later ? 'later' : 'warn';
  const detail = r.simulated ? t('result.summarySimulated', { bytes: r.freed + r.trashed })
    : r.disk > 10e6 ? t('island.gain', { bytes: r.disk })
      : r.freed ? t('result.summaryRemoved', { bytes: r.freed })
        : r.trashed ? t('result.summaryTrashed', { bytes: r.trashed })
          : later ? t('result.summarySkipped', { n: r.skipped.length }) : t('result.summaryFailed', { n: r.failed.length });
  island({ kind: 'done', tone, detail, action: t('island.view'),
    title: title ?? t(r.simulated ? 'result.titleSimulated' : tone === 'ok' ? 'island.done' : later ? 'clean.allLater' : 'result.titleNothing') });
}

/**
 * Limpa, mede o disco antes e depois, guarda histórico e reanalisa o que mudou. Usada pela tela e pela nova
 * tentativa automática dos itens que ficaram para depois.
 * @param {import('./cleaner.js').Target[]} targets @param {Set<string>} force @param {(e: import('../types.js').CleanEvent) => void} progress
 */
async function cleanAndRecord(targets, force, progress) {
  // O que a ferramenta diz que removeu pode não virar espaço livre (clones do APFS, disco virtual do Docker).
  const freeBefore = (await diskInfo()).free;
  // Espaço livre ao vivo: statfs é barato.
  const poll = setInterval(async () => {
    const { free } = await diskInfo();
    progress({ kind: 'disk', gain: free - freeBefore, free });
  }, 700);
  const result = await clean(targets, { ...store.data.prefs, force }, progress).finally(() => clearInterval(poll));
  const after = await diskInfo();
  result.free = after.free;
  for (const t of targets) if (t.item.path && result.done.includes(t.ref)) delete store.data.sizeCache[t.item.path];
  for (const r of result.done) if (r.startsWith('explore/')) { explore.forget(r.slice(8)); explore.invalidate(); }
  if (!result.simulated) result.disk = after.free - freeBefore;
  // Em uso que passa sozinho: o Respiro tenta de novo no próximo tick.
  if (!result.simulated) {
    const retry = result.skipped.filter((s) => s.retry).map((s) => s.ref);
    store.data.deferred = [...new Set([...store.data.deferred.filter((r) => !result.done.includes(r)), ...retry])];
  }
  if (!result.simulated && result.done.length) {
    store.data.history.unshift({ at: Date.now(), freed: result.freed, trashed: result.trashed, count: result.done.length, disk: result.disk });
    store.data.history = store.data.history.slice(0, 200);
    sample(after, true);
    // Reanalisa as categorias tocadas (a fila espera a análise em curso terminar).
    startScan(new Set([...result.done.map((r) => r.slice(0, r.indexOf('/'))), 'trash']));
  }
  await store.save();
  return result;
}

/** Itens que ficaram para depois (cache do uv em uso): tenta de novo, em silêncio, quando liberar. */
async function retryDeferred() {
  if (cleaning || !store.data.deferred.length || store.data.prefs.simulate) return;
  const targets = store.data.deferred.map(resolve).filter((t) => t !== null);
  if (!targets.length) { store.data.deferred = []; return; }
  cleaning = true;
  try {
    const result = await cleanAndRecord(targets, new Set(), () => {});
    // Falha de verdade (não "em uso") sai da fila: não insiste para sempre.
    store.data.deferred = store.data.deferred.filter((r) => !result.failed.some((f) => f.ref === r));
    if (result.done.length) {
      console.log(`[deferred] ${result.done.join(', ')}`);
      islandResult(result, t('island.deferredDone'));
    }
  } finally {
    cleaning = false;
  }
}

function registerIpc() {
  handle('respiro:state', async () => ({
    disk: await diskInfo({ wait: !store.data.scan }), scan: store.data.scan, history: store.data.history, samples: store.data.samples, prefs: store.data.prefs, scanning: Boolean(scanning),
    // Idioma já resolvido pelo main (menu e janela iguais, mesmo com idioma do sistema que o Chromium não conhece).
    locale: getLocale(),
    // Ler a Lixeira só funciona com Acesso Total ao Disco: serve de teste da permissão.
    fullDiskAccess: await readdir(TRASH).then(() => true, () => false),
    catalog: CATEGORIES.map((c) => ({ id: c.id })),
  }));

  handle('respiro:scan', () => startScan());

  handle('respiro:clean', async (/** @type {unknown} */ refs, /** @type {any} */ opts) => {
    // A tela traduz a chave da mensagem de erro.
    if (!Array.isArray(refs) || !refs.length || refs.length > 1000) throw new Error('error.invalidRequest');
    if (cleaning) throw new Error('error.busy');
    // "Limpar mesmo assim": só vale para refs deste pedido (o cleaner ainda confere que é o uv).
    const force = new Set(Array.isArray(opts?.force) ? opts.force.filter((/** @type {unknown} */ r) => typeof r === 'string' && refs.includes(r)) : []);
    cleaning = true;
    try {
      const targets = refs.map(resolve);
      const found = targets.filter((x) => x !== null);
      // Andamento no ícone da barra de menus, durante qualquer limpeza.
      let finished = 0;
      const progress = (/** @type {import('../types.js').CleanEvent} */ e) => {
        // O ícone da barra gira e mostra o andamento; a pílula só aparece no fim.
        if (e.kind === 'start') tray.cleaning(`${finished + 1}/${found.length}`);
        if (e.kind === 'done' || e.kind === 'failed' || e.kind === 'skipped') finished += 1;
        if (win && !win.isDestroyed()) win.webContents.send('respiro:clean-progress', e);
      };
      tray.cleaning(`0/${found.length}`);
      const result = await cleanAndRecord(found, force, progress).finally(() => tray.cleaning(null));
      // Fim visto de fora (segundo plano, janela fechada ou sem foco): avisa na pílula do topo.
      if (background || !win || win.isDestroyed() || !win.isFocused()) islandResult(result);
      background = false;
      for (const ref of refs.filter((_, i) => !targets[i])) {
        const message = msg('error.itemMissing');
        result.failed.push({ ref: String(ref), name: String(ref), message });
        progress({ kind: 'failed', ref: String(ref), message });
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
    // Item ignorado sai também da análise salva; senão volta na próxima reanálise parcial.
    const hidden = new Set(prefs.ignored.map((i) => i.ref));
    for (const c of store.data.scan?.categories ?? []) c.items = c.items.filter((i) => !hidden.has(`${c.id}/${i.id}`));
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

  // Explorar só lê; o que a pessoa manda para a Lixeira volta pelo respiro:clean com refs "explore/<id>".
  handle('respiro:explore', (/** @type {unknown} */ kind, /** @type {unknown} */ id) => {
    const send = (/** @type {import('../types.js').ExploreProgress} */ p) => { if (win && !win.isDestroyed()) win.webContents.send('respiro:explore-progress', p); };
    if (kind === 'home' || kind === 'apps' || kind === 'disk') {
      return explore.mapScope(kind, (n) => send({ kind: 'count', n }), { cache: app.getPath('userData'), fresh: id === 'fresh' });
    }
    if (kind === 'dir' && typeof id === 'string') return explore.listDir(id);
    if (kind === 'large') return explore.largeFiles();
    if (kind === 'duplicates') return explore.duplicates((read, total) => send({ kind: 'read', read, total }));
    throw new Error('error.invalidRequest');
  });

  handle('respiro:background', (/** @type {unknown} */ on) => {
    background = on === true && cleaning;
    if (!background) island({ kind: 'hide' });
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
  // Análise salva por versão antiga pode ter categoria que saiu (Homebrew foi para "Caches de pacotes").
  if (store.data.scan) store.data.scan.categories = store.data.scan.categories.filter((c) => ORDER.includes(c.id));
  nativeTheme.themeSource = store.data.prefs.theme;
  applyLocale();
  registerIpc();
  shellReady = loadShellPath();
  if (store.data.prefs.scanOnLaunch || !store.data.scan) startScan();
  // Aberto pelo login com a barra ligada: fica só na barra de menus.
  const atLogin = app.getLoginItemSettings().wasOpenedAtLogin && store.data.prefs.showInMenuBar;
  if (atLogin) app.dock?.hide();
  else createWindow();
  tray.syncTray(trayActions);
  initIsland(() => command('show-cleaning'), tray.bounds);
  // statfs é barato: amostra do gráfico e título da barra a cada 5 minutos.
  tick();
  setInterval(tick, 5 * 60_000);
});

app.on('window-all-closed', () => {
  if (!store.data.prefs.showInMenuBar) app.quit();
});
app.on('activate', showWindow);
