// Barra de menus: anel do Respiro com o espaço livre ao lado e um menu com o resumo da última análise.
// Disco apertado: o anel fica colorido (aviso que sempre aparece) e o macOS recebe uma notificação por dia
// (app sem assinatura pode não entregar notificação; o anel colorido não depende disso).
import { Menu, Notification, Tray, nativeImage } from 'electron';
import { t } from '../shared/i18n.js';
import * as store from './store.js';
import { diskInfo } from './sys.js';

/** Cor do anel quando o disco aperta (o --danger do tema claro). */
const ALERT = /** @type {const} */ ([179, 38, 30]);
const DAY = 86_400_000;

/**
 * Anel aberto do ícone em BGRA: abertura de ~40° (à direita, ou girada por `turn`), pontas redondas,
 * antisserrilhado analítico.
 * @param {number} px lado em pixels @param {readonly [number, number, number]} rgb @param {number} [turn] radianos
 */
export function ringBitmap(px, rgb = [0, 0, 0], turn = 0) {
  const c = px / 2;
  const radius = px * 0.36;
  const half = px * 0.075;
  const gap = (20 * Math.PI) / 180;
  const ends = [turn - gap, turn + gap].map((a) => [c + radius * Math.cos(a), c + radius * Math.sin(a)]);
  const buf = Buffer.alloc(px * px * 4);
  for (let y = 0; y < px; y += 1) {
    for (let x = 0; x < px; x += 1) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - turn), Math.cos(Math.atan2(dy, dx) - turn))) > gap
        ? Math.abs(Math.hypot(dx, dy) - radius)
        : Math.min(...ends.map(([ex, ey]) => Math.hypot(x + 0.5 - ex, y + 0.5 - ey)));
      const alpha = Math.max(0, Math.min(1, half - d + 0.5));
      buf.set([rgb[2], rgb[1], rgb[0], Math.round(alpha * 255)], (y * px + x) * 4);
    }
  }
  return buf;
}

/** @param {boolean} alert */
function icon(alert) {
  const image = nativeImage.createFromBitmap(ringBitmap(36, alert ? ALERT : [0, 0, 0]), { width: 36, height: 36, scaleFactor: 2 });
  image.setTemplateImage(!alert);
  return image;
}

/** Quadros do anel girando (12 × 30°), feitos na primeira limpeza. @type {Electron.NativeImage[]} */
const frames = [];
/** @param {number} i */
function spinFrame(i) {
  if (!frames[i]) {
    frames[i] = nativeImage.createFromBitmap(ringBitmap(36, [0, 0, 0], (i * Math.PI) / 6), { width: 36, height: 36, scaleFactor: 2 });
    frames[i].setTemplateImage(true);
  }
  return frames[i];
}
/** @type {ReturnType<typeof setInterval> | undefined} */
let spin;
/** Texto do título enquanto limpa ("2/5"); null fora da limpeza. @type {string | null} */
let busy = null;

/** Limpeza em andamento: o anel gira e o título mostra o andamento. null volta ao espaço livre. @param {string | null} text */
export function cleaning(text) {
  busy = text;
  if (text === null) {
    clearInterval(spin);
    spin = undefined;
    update();
    return;
  }
  if (!tray) return;
  tray.setTitle(` ${text}`, { fontType: 'monospacedDigit' });
  let i = 0;
  spin ??= setInterval(() => { i = (i + 1) % 12; tray?.setImage(spinFrame(i)); }, 90);
}

/** O que dá para liberar com segurança na última análise (mesma conta da tela principal: freeable, nulo = 0). */
function safeTotal() {
  return (store.data.scan?.categories ?? []).flatMap((c) => c.items)
    .filter((i) => i.safe && i.action && !i.individual && !i.tool)
    .reduce((sum, i) => sum + (i.freeable ?? 0), 0);
}

/** @typedef {{ open: () => void, scan: () => void, preferences: () => void, quit: () => void, scanning: () => boolean }} Actions */

/** @type {Tray | null} */
let tray = null;
/** Referência viva: notificação sem dono é coletada e o clique se perde. @type {Notification | null} */
let note = null;
/** @type {Actions | null} */
let actions = null;

/** Onde está o ícone na tela (para a pílula nascer embaixo dele); null sem ícone. */
export const bounds = () => (tray && !tray.isDestroyed() ? tray.getBounds() : null);

/** Liga ou desliga conforme a preferência. @param {Actions} a */
export function syncTray(a) {
  actions = a;
  if (!store.data.prefs.showInMenuBar) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) tray = new Tray(icon(false));
  update();
}

/** Atualiza título, ícone e menu e avisa se o disco apertou (com ou sem barra). Barato: um statfs. */
export async function update() {
  const disk = await diskInfo();
  const pct = (disk.free / disk.total) * 100;
  const threshold = store.data.prefs.lowDiskAlert;
  const low = threshold > 0 && pct < threshold;
  // Uma vez por dia, contando entre aberturas do app.
  if (low && actions && Date.now() - store.data.lastAlert > DAY && Notification.isSupported()) {
    store.data.lastAlert = Date.now();
    store.save();
    note = new Notification({ title: t('notify.lowTitle'), body: t('notify.lowBody', { free: disk.free, pct: Math.round(pct) }) });
    note.on('click', actions.open);
    note.show();
  }
  if (!tray || !actions) return;
  if (!busy) {
    tray.setImage(icon(low));
    tray.setTitle(` ${t('tray.title', { free: disk.free })}`, { fontType: 'monospacedDigit' });
  }
  tray.setToolTip(t('tray.free', { free: disk.free, total: disk.total }));
  const scan = store.data.scan;
  const a = actions;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.free', { free: disk.free, total: disk.total }), enabled: false },
    ...(low ? [{ label: t('tray.low', { pct: Math.round(pct) }), enabled: false }] : []),
    { label: a.scanning() ? t('tray.scanning') : scan ? t('tray.safe', { bytes: safeTotal(), at: scan.at }) : t('tray.noScan'), enabled: false },
    { type: 'separator' },
    { label: t('tray.open'), click: a.open },
    { label: t('tray.scan'), click: a.scan, enabled: !a.scanning() },
    { label: t('tray.prefs'), click: a.preferences },
    { type: 'separator' },
    { label: t('tray.quit'), click: a.quit },
  ]));
}
