// Navegadores baixados pelo Playwright. Mesma regra do coletor do próprio Playwright:
// uma revisão está em uso se algum projeto em .links aponta para um browsers.json que a cita.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { home, measure, newestMtime } from '../sys.js';

export const id = 'browsers';
export const name = 'Navegadores de teste';
export const blurb = 'Versões de Chromium, Firefox e WebKit baixadas pelo Playwright que nenhum projeto usa mais.';

export const PLAYWRIGHT = process.env.PLAYWRIGHT_BROWSERS_PATH || join(home, 'Library/Caches/ms-playwright');
const BROWSER_DIR = /^[a-z][a-z_]*-\d+$/;

/** @param {string} [root] */
export async function usedBrowserDirs(root = PLAYWRIGHT) {
  const used = new Set();
  let projects = 0;
  for (const link of await readdir(join(root, '.links')).catch(() => [])) {
    try {
      const target = (await readFile(join(root, '.links', link), 'utf8')).trim();
      /** @type {{ browsers: { name: string, revision: string, revisionOverrides?: Record<string, string> }[] }} */
      const json = JSON.parse(await readFile(join(target, 'browsers.json'), 'utf8'));
      projects += 1;
      for (const b of json.browsers) {
        for (const rev of [b.revision, ...Object.values(b.revisionOverrides ?? {})]) used.add(`${b.name.replace(/-/g, '_')}-${rev}`);
      }
    } catch { /* projeto removido: não segura nenhuma revisão, como no Playwright */ }
  }
  return { used, projects };
}

/** chromium_headless_shell-1248 → Chromium Headless Shell 1248 @param {string} dir */
const pretty = (dir) => dir.replace(/-(\d+)$/, ' $1').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export async function scan() {
  const dirs = (await readdir(PLAYWRIGHT).catch(() => [])).filter((d) => BROWSER_DIR.test(d));
  if (!dirs.length) return null;
  const { used, projects } = await usedBrowserDirs();
  const items = await Promise.all(dirs.map(async (dir) => {
    const path = join(PLAYWRIGHT, dir);
    const inUse = used.has(dir);
    return /** @type {import('../../types.js').Item} */ ({
      id: dir, name: pretty(dir), detail: 'Playwright', path, size: 0, freeable: 0, lastUsed: await newestMtime(path),
      safe: !inUse && projects > 0, inUse,
      note: inUse ? 'Usado por um projeto. Ele baixa de novo com npx playwright install.' : projects ? 'Nenhum projeto usa esta versão.' : 'Não foi possível saber quais projetos usam o Playwright.',
      action: { kind: 'trash', path },
    });
  }));
  return { items: await measure(items) };
}

/** @param {string} path @returns {Promise<string | null>} */
export async function recheck(path) {
  return (await usedBrowserDirs()).used.has(basename(path)) ? 'Um projeto passou a usar esta versão.' : null;
}
