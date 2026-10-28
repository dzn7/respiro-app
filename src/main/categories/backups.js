// Snapshots locais do Time Machine e backups de iPhone/iPad guardados no Mac.
// Nada aqui é seguro sozinho: snapshot sai pelo tmutil (o macOS também apaga quando falta espaço) e backup de
// aparelho vai para a Lixeira um de cada vez, com aceite, porque pode ser a única cópia do aparelho.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { home, measure, run } from '../sys.js';

export const id = 'backups';

export const MOBILESYNC = join(home, 'Library/Application Support/MobileSync/Backup');
/** Só snapshots do Time Machine; o do sistema (com.apple.os.update…) nunca entra. */
const TM = /^com\.apple\.TimeMachine\.(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.local$/;

/**
 * Saída do `tmutil listlocalsnapshots /` → snapshots com data (hora local). Puro, testado.
 * @param {string} out @returns {{ date: string, at: number }[]}
 */
export function snapshots(out) {
  return out.split('\n').map((l) => TM.exec(l.trim())).filter((m) => m !== null).map((m) => ({
    date: `${m[1]}-${m[2]}-${m[3]}-${m[4]}${m[5]}${m[6]}`,
    at: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(),
  }));
}

/**
 * Info.plist do backup (já em JSON) → aparelho, modelo e data. Puro, testado.
 * @param {Record<string, unknown>} info
 */
export function backupInfo(info) {
  const at = Date.parse(String(info['Last Backup Date'] ?? ''));
  return {
    device: String(info['Device Name'] ?? info['Display Name'] ?? ''),
    product: String(info['Product Type'] ?? info['Product Name'] ?? ''),
    serial: String(info['Serial Number'] ?? info['Target Identifier'] ?? ''),
    at: Number.isFinite(at) ? at : 0,
  };
}

export async function scan() {
  /** @type {import('../../types.js').Item[]} */
  const items = [];

  const tm = snapshots(await run('/usr/bin/tmutil', ['listlocalsnapshots', '/'], { timeout: 15_000 }).catch(() => ''));
  for (const s of tm) {
    items.push({
      id: `tm-${s.date}`, name: msg('name.tmSnapshot', { at: s.at }), detail: msg('detail.tmSnapshot'), size: 0, freeable: null,
      safe: false, lastUsed: s.at, note: msg('note.tmSnapshot'), action: { kind: 'cmd', key: 'tm-delete-snapshot', arg: s.date },
    });
  }

  /** @type {import('../../types.js').Item[]} */
  const phones = [];
  let blocked = false;
  try {
    for (const entry of await readdir(MOBILESYNC, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9A-Fa-f-]{20,64}$/.test(entry.name)) continue;
      const path = join(MOBILESYNC, entry.name);
      const json = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(path, 'Info.plist')], { timeout: 5000 }).catch(() => '{}');
      const info = backupInfo(JSON.parse(json || '{}'));
      phones.push({
        id: `ios-${entry.name}`, name: info.device || msg('name.iosBackup'), detail: msg('detail.iosBackup', { product: info.product || '—', at: info.at }),
        path, size: 0, freeable: 0, safe: false, individual: true, lastUsed: info.at || undefined, note: msg('note.backupOld'),
        action: { kind: 'trash', path }, ...(info.serial ? { group: info.serial } : {}),
      });
    }
  } catch (/** @type {any} */ e) {
    blocked = e?.code === 'EPERM' || e?.code === 'EACCES';
  }
  // O mais recente de cada aparelho avisa que é a cópia mais nova dele.
  const newest = new Map();
  for (const p of phones) {
    const key = /** @type {any} */ (p).group ?? p.name;
    if (!newest.has(key) || (p.lastUsed ?? 0) > (newest.get(key).lastUsed ?? 0)) newest.set(key, p);
  }
  for (const p of newest.values()) p.note = msg('note.backupLatest');
  for (const p of phones) delete /** @type {any} */ (p).group;
  items.push(...(await measure(phones)));

  if (!items.length) return blocked ? { status: /** @type {const} */ ('needs-access'), message: msg('status.backupsAccess'), items: [] } : null;
  return { items, notice: blocked ? msg('status.backupsAccess') : undefined };
}
