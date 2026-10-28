// Roda as categorias em paralelo e avisa cada uma que termina. Ordem fixa = ordem das cores (UI.md).
import * as appCaches from './categories/app-caches.js';
import * as backups from './categories/backups.js';
import * as browsers from './categories/browsers.js';
import * as docker from './categories/docker.js';
import * as nodeModules from './categories/node-modules.js';
import * as packages from './categories/packages.js';
import * as trash from './categories/trash.js';
import * as xcode from './categories/xcode.js';
import { msg } from '../shared/i18n.js';
import { commandLine } from './cleaner.js';
import { movable } from './sys.js';

/**
 * @typedef {import('../types.js').Category} Category
 * @typedef {{ id: import('../types.js').CategoryId,
 *   scan: (ctx: import('../types.js').ScanContext) => Promise<import('../types.js').CategoryScan | null> }} CategoryModule
 */

/** @type {CategoryModule[]} */
export const CATEGORIES = [packages, docker, nodeModules, xcode, browsers, backups, appCaches, trash];
export const ORDER = CATEGORIES.map((c) => c.id);

/** @param {import('../types.js').Item} i */
const rank = (i) => (!i.action ? 3 : i.inUse ? 2 : i.safe ? 0 : 1);

/**
 * @param {import('../types.js').ScanContext} ctx
 * @param {(p: import('../types.js').Progress) => void} onProgress
 * @param {Set<string>} [only] reanalisa só estas categorias
 * @returns {Promise<Category[]>} categorias presentes entre as analisadas
 */
export async function scanCategories(ctx, onProgress, only) {
  const mods = only ? CATEGORIES.filter((c) => only.has(c.id)) : CATEGORIES;
  let done = 0;
  /** @type {Category[]} */
  const found = [];
  await Promise.all(mods.map(async (mod) => {
    /** @type {import('../types.js').CategoryScan | null} */
    let result;
    const t0 = Date.now();
    try {
      result = await mod.scan(ctx);
      console.log(`[scan] ${mod.id} ${Date.now() - t0} ms`);
    } catch (e) {
      console.error(`[scan] ${mod.id}:`, e);
      result = { status: 'error', message: msg('error.scan'), items: [] };
    }
    done += 1;
    if (!result) return onProgress({ done, total: mods.length, absent: mod.id });
    // Pasta do root (criada com sudo): continua limpável, mas pede atenção e a senha do macOS.
    await Promise.all(result.items.map(async (item) => {
      if (item.action?.kind === 'trash' && !(await movable(item.action.path))) {
        Object.assign(item, { admin: true, safe: false, note: msg('note.admin') });
      }
    }));
    for (const item of result.items) item.command = commandLine(item.action);
    // Tamanho conta tudo (é espaço ocupado); itens ignorados só saem da lista.
    const size = result.size ?? result.items.reduce((sum, i) => sum + i.size, 0);
    /** @type {Category} */
    const category = {
      id: mod.id, status: result.status ?? 'ok', message: result.message, notice: result.notice, size,
      // Seguro, depois atenção, depois em uso; dentro de cada grupo, maior primeiro.
      items: result.items.filter((i) => !ctx.ignored.has(`${mod.id}/${i.id}`)).sort((a, b) => rank(a) - rank(b) || b.size - a.size),
    };
    found.push(category);
    onProgress({ done, total: mods.length, category });
  }));
  return found.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}
