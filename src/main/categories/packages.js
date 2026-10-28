// pnpm, npm, yarn, bun e pip. Comando oficial sempre que a CLI existe.
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cachedSize, exists, has, home, measure, run, tilde } from '../sys.js';

export const id = 'packages';
export const name = 'Caches de pacotes';
export const blurb = 'Pacotes que pnpm, npm, yarn, bun e pip guardam para instalar mais rápido. Eles baixam de novo quando precisarem.';

/** @param {string} cmd @param {string[]} args */
const ask = (cmd, args) => run(cmd, args, { timeout: 15_000 }).then((out) => out.trim(), () => '');

/** @param {import('../../types.js').ScanContext} ctx */
export async function scan(ctx) {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  const [pnpm, npm, yarn, bun, pip] = await Promise.all(['pnpm', 'npm', 'yarn', 'bun', 'pip3'].map(has));

  if (pnpm) {
    const [store, meta] = await Promise.all([ask('pnpm', ['store', 'path']), ask('pnpm', ['cache', 'path'])]);
    if (store) {
      items.push({
        id: 'pnpm-store', name: 'pnpm store', detail: tilde(store), path: store, size: 0, freeable: null, safe: true,
        note: 'O pnpm remove só pacotes que nenhum projeto usa. O valor liberado aparece depois.',
        action: { kind: 'cmd', key: 'pnpm-prune' },
      });
      // Formatos de store de versões anteriores do pnpm (v3, v10…), que o pnpm atual não lê.
      for (const v of await readdir(dirname(store)).catch(() => [])) {
        const path = join(dirname(store), v);
        if (/^v\d+$/.test(v) && path !== store) {
          items.push({
            id: `pnpm-store-${v}`, name: `pnpm store antigo (${v})`, detail: tilde(path), path, size: 0, freeable: 0, safe: false,
            note: 'Usado por versões anteriores do pnpm. Projeto que ainda use uma delas baixa os pacotes de novo.',
            action: { kind: 'trash', path },
          });
        }
      }
    }
    if (meta) {
      items.push({ id: 'pnpm-meta', name: 'pnpm (metadados)', detail: tilde(meta), path: meta, size: 0, freeable: 0, safe: true,
        action: { kind: 'trash', path: meta } });
    }
  }

  if (npm) {
    const cache = await ask('npm', ['config', 'get', 'cache']);
    if (cache) {
      const path = join(cache, '_cacache');
      items.push({ id: 'npm', name: 'npm', detail: tilde(path), path, size: 0, freeable: 0, safe: true,
        action: { kind: 'cmd', key: 'npm-clean' } });
    }
  }

  if (yarn && (await ask('yarn', ['--version'])).startsWith('1.')) {
    const path = await ask('yarn', ['cache', 'dir']);
    if (path) items.push({ id: 'yarn', name: 'Yarn', detail: tilde(path), path, size: 0, freeable: 0, safe: true, action: { kind: 'cmd', key: 'yarn-clean' } });
  }

  const bunCache = process.env.BUN_INSTALL_CACHE_DIR || join(home, '.bun/install/cache');
  if (await exists(bunCache)) {
    items.push({ id: 'bun', name: 'Bun', detail: tilde(bunCache), path: bunCache, size: 0, freeable: 0, safe: true,
      action: bun ? { kind: 'cmd', key: 'bun-clean' } : { kind: 'trash', path: bunCache } });
  }

  const pipCache = pip ? await ask('pip3', ['cache', 'dir']) : join(home, 'Library/Caches/pip');
  if (pipCache && await exists(pipCache)) {
    items.push({ id: 'pip', name: 'pip', detail: tilde(pipCache), path: pipCache, size: 0, freeable: 0, safe: true,
      action: pip ? { kind: 'cmd', key: 'pip-purge' } : { kind: 'trash', path: pipCache } });
  }

  if (!items.length) return null;
  // O store do pnpm é o maior e só muda quando ganha ou perde pacote: reaproveita a medição anterior.
  await Promise.all(items.filter((i) => i.id.startsWith('pnpm-store')).map(async (i) => {
    i.size = await cachedSize(/** @type {string} */ (i.path), ctx.sizeCache);
  }));
  return { items: await measure(items) };
}
