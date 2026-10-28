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
 * Anel aberto do ícone em BGRA: abertura de ~40° à direita, pontas redondas, antisserrilhado analítico.
 * @param {number} px lado em pixels @param {readonly [number, number, number]} rgb
 */
export function ringBitmap(px, rgb = [0, 0, 0]) {
  const c = px / 2;
  const radius = px * 0.36;
  const half = px * 0.075;
  const gap = (20 * Math.PI) / 180;
  const ends = [-gap, gap].map((a) => [c + radius * Math.cos(a), c + radius * Math.sin(a)]);
  const buf = Buffer.alloc(px * px * 4);
  for (let y = 0; y < px; y += 1) {
    for (let x = 0; x < px; x += 1) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.abs(Math.atan2(dy, dx)) > gap
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

/** O que dá para liberar com segurança na última análise (mesma conta da tela principal). */
function safeTotal() {
  return (store.data.scan?.categories ?? []).flatMap((c) => c.items)
    .filter((i) => i.safe && i.action && !i.individual && !i.tool)
    .reduce((sum, i) => sum + (i.action?.kind === 'trash' ? i.size : i.freeable ?? 0), 0);
}

/** @typedef {{ open: () => void, scan: () => void, preferences: () => void, quit: () => void, scanning: () => boolean }} Actions */

/** @type {Tray | null} */
let tray = null;
let lastAlert = 0;
/** @type {Actions | null} */
let actions = null;

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

/** Atualiza título, ícone e menu. Barato: um statfs. */
export async function update() {
  if (!tray || !actions) return;
  const disk = await diskInfo();
  if (!tray || !actions) return;
  const pct = (disk.free / disk.total) * 100;
  const threshold = store.data.prefs.lowDiskAlert;
  const low = threshold > 0 && pct < threshold;
  tray.setImage(icon(low));
  tray.setTitle(` ${t('tray.title', { free: disk.free })}`, { fontType: 'monospacedDigit' });
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
  if (low && Date.now() - lastAlert > DAY) {
    lastAlert = Date.now();
    if (Notification.isSupported()) {
      const note = new Notification({ title: t('notify.lowTitle'), body: t('notify.lowBody', { free: disk.free, pct: Math.round(pct) }) });
      note.on('click', a.open);
      note.show();
    }
  }
}
