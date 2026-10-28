// Aviso que nasce embaixo do ícone do Respiro na barra de menus, estilo Dynamic Island: pílula preta com o
// resultado da limpeza. Janela própria, transparente e sem foco, criada uma vez na abertura do app (pronta para
// aparecer sem atraso). Só transform e opacity animam: nada de refazer layout a cada quadro.
// Sem o ícone na barra (opção desligada), aparece no canto direito, logo abaixo da barra de menus.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('../renderer/island.html', import.meta.url));
const W = 400;
const H = 104;

/** @typedef {{ kind: 'done', tone: 'ok' | 'later' | 'warn', title: string, detail: string, action: string } | { kind: 'hide' }} Payload */

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Promise<void> | null} */
let ready = null;
let open = () => {};
/** @type {() => Electron.Rectangle | null} */
let anchor = () => null;

function ensure() {
  if (win && !win.isDestroyed() && ready) return ready;
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, show: false, alwaysOnTop: true, type: 'panel',
    webPreferences: { preload: fileURLToPath(new URL('./island.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; ready = null; });
  ready = win.loadFile(PAGE);
  return ready;
}

/** Centrada embaixo do ícone da barra; sem ícone, no canto direito. Sempre dentro da tela. */
function place() {
  const icon = anchor();
  const display = icon ? screen.getDisplayMatching(icon) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const centre = icon ? icon.x + icon.width / 2 : area.x + area.width - W / 2 - 8;
  const x = Math.round(Math.min(Math.max(centre - W / 2, area.x + 4), area.x + area.width - W - 4));
  win?.setBounds({ x, y: area.y + 2, width: W, height: H });
  // A ponta da pílula aponta para o ícone: diz à página onde fica o centro dele.
  return Math.round(centre - x);
}

/** Mostra o resultado ou recolhe. @param {Payload} payload */
export async function island(payload) {
  if (payload.kind === 'hide') { win?.webContents.send('island:show', payload); return; }
  await ensure();
  if (!win) return;
  const tip = place();
  // A página começa invisível: mostrar a janela antes do conteúdo evita o quadro velho piscando.
  if (!win.isVisible()) win.showInactive();
  win.webContents.send('island:show', { ...payload, tip });
}

/** @param {() => void} onOpen clique na pílula @param {() => Electron.Rectangle | null} iconBounds */
export function initIsland(onOpen, iconBounds) {
  open = onOpen;
  anchor = iconBounds;
  ensure();
  const mine = (/** @type {Electron.IpcMainEvent} */ e) => win && e.sender === win.webContents;
  // Sobre a pílula, a janela aceita o mouse; fora dela, o clique passa para o que estiver embaixo.
  ipcMain.on('island:hover', (e, on) => { if (mine(e)) win?.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.on('island:act', (e, action) => {
    if (!mine(e)) return;
    if (action === 'open') open();
    if (action === 'hidden') { win?.setIgnoreMouseEvents(true, { forward: true }); win?.hide(); }
  });
}
