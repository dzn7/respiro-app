// ~/Library/Caches e ~/Library/Logs. Pastas da Apple e o que já está em outra categoria ficam de fora.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { home, measure, newestMtime, ownerRunning, runningApps } from '../sys.js';

export const id = 'appcaches';
export const name = 'Caches e logs de apps';
export const blurb = 'Arquivos temporários e registros que os apps recriam sozinhos. Os de apps abertos ou usados nos últimos 7 dias pedem atenção.';

export const CACHES = join(home, 'Library/Caches');
export const LOGS = join(home, 'Library/Logs');
/** Já contados em outra categoria ou mantidos pelo macOS. */
export const OWNED_ELSEWHERE = new Set(['Homebrew', 'pip', 'Yarn', 'pnpm', 'ms-playwright', 'com.apple.dt.Xcode',
  'CloudKit', 'GeoServices', 'FamilyCircle', 'familycircled', 'PassKit', 'GameKit', 'icloudmailagent', 'askpermissiond', 'Animoji']);
const RECENT = 7 * 86_400_000;
const MIN_SIZE = 1_000_000;

/** @param {string} name */
export const isOwnedElsewhere = (name) => name.startsWith('com.apple.') || name.startsWith('.') || OWNED_ELSEWHERE.has(name);

export async function scan() {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  const running = await runningApps();
  for (const [root, kind] of /** @type {const} */ ([[CACHES, 'Cache'], [LOGS, 'Log']])) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (isOwnedElsewhere(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      const lastUsed = await newestMtime(path, 2);
      const open = ownerRunning(entry.name, running);
      const recent = Date.now() - lastUsed < RECENT;
      items.push({
        id: `${kind}-${entry.name}`, name: entry.name, detail: kind, path, size: 0, freeable: 0, lastUsed, safe: !open && !recent, inUse: open,
        note: open ? 'O app parece estar aberto. Feche o app antes de limpar.' : recent ? 'Usado nos últimos 7 dias. O app pode estar aberto.' : undefined,
        action: { kind: 'trash', path },
      });
    }
  }
  const measured = (await measure(items)).filter((i) => i.size >= MIN_SIZE);
  return measured.length ? { items: measured } : null;
}
