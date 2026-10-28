// Navegadores baixados pelo Playwright, Cypress e Puppeteer. Playwright segue a regra do coletor dele:
// uma revisão está em uso se algum projeto em .links aponta para um browsers.json que a cita.
// Cypress e Puppeteer não registram quem usa: a versão mais nova fica, as outras pedem atenção.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { home, measure, newestMtime } from '../sys.js';

export const id = 'browsers';

export const PLAYWRIGHT = process.env.PLAYWRIGHT_BROWSERS_PATH || join(home, 'Library/Caches/ms-playwright');
const CYPRESS = join(home, 'Library/Caches/Cypress');
const PUPPETEER = join(home, '.cache/puppeteer');
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
const pretty = (dir) => dir.replace(/-(\d+)$/, ' $1').split(/[_-]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Nome da versão mais nova (13.10.0 > 13.9.2). @param {string[]} names */
export const newestVersion = (names) => names.reduce((a, b) => (a.localeCompare(b, 'en', { numeric: true }) >= 0 ? a : b), names[0]);

/** Uma pasta por versão; a mais nova fica em uso. @param {string} root @param {string} tool @param {string} [label] */
async function versions(root, tool, label = tool) {
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && /^[\w.-]+$/.test(e.name)).map((e) => e.name);
  const latest = newestVersion(names);
  return Promise.all(names.map(async (name) => {
    const path = join(root, name);
    const current = name === latest;
    return /** @type {import('../../types.js').Item} */ ({
      id: `${tool.toLowerCase()}-${basename(root)}-${name}`, name: `${label} ${name}`, detail: tool, path, size: 0, freeable: 0, lastUsed: await newestMtime(path),
      safe: false, inUse: current, note: msg(current ? 'note.toolLatest' : 'note.toolOld', { tool }), action: { kind: 'trash', path },
    });
  }));
}

export async function scan() {
  const others = [
    ...(await versions(CYPRESS, 'Cypress')),
    ...(await Promise.all((await readdir(PUPPETEER).catch(() => [])).filter((b) => /^[\w-]+$/.test(b))
      .map((b) => versions(join(PUPPETEER, b), 'Puppeteer', pretty(b))))).flat(),
  ];
  const dirs = (await readdir(PLAYWRIGHT).catch(() => [])).filter((d) => BROWSER_DIR.test(d));
  if (!dirs.length && !others.length) return null;
  const { used, projects } = await usedBrowserDirs();
  const playwright = await Promise.all(dirs.map(async (dir) => {
    const path = join(PLAYWRIGHT, dir);
    const inUse = used.has(dir);
    return /** @type {import('../../types.js').Item} */ ({
      id: dir, name: pretty(dir), detail: 'Playwright', path, size: 0, freeable: 0, lastUsed: await newestMtime(path),
      safe: !inUse && projects > 0, inUse,
      note: msg(inUse ? 'note.playwrightUsed' : projects ? 'note.playwrightUnused' : 'note.playwrightUnknown'),
      action: { kind: 'trash', path },
    });
  }));
  return { items: await measure([...playwright, ...others]) };
}

/** @param {string} path @returns {Promise<import('../../types.js').Msg | null>} */
export async function recheck(path) {
  return (await usedBrowserDirs()).used.has(basename(path)) ? msg('refuse.browserNowUsed') : null;
}
