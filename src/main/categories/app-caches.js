// ~/Library/Caches e ~/Library/Logs, versões antigas de extensões de editor e caches das IDEs JetBrains.
// Pastas da Apple e o que já está em outra categoria ficam de fora.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { home, measure, newestMtime, ownerRunning, runningApps } from '../sys.js';

export const id = 'appcaches';

export const CACHES = join(home, 'Library/Caches');
export const LOGS = join(home, 'Library/Logs');
/** Já contados em outra categoria ou mantidos pelo macOS. */
export const OWNED_ELSEWHERE = new Set(['Homebrew', 'pip', 'Yarn', 'pnpm', 'ms-playwright', 'com.apple.dt.Xcode',
  'go-build', 'CocoaPods', 'Cypress', 'JetBrains',
  'CloudKit', 'GeoServices', 'FamilyCircle', 'familycircled', 'PassKit', 'GameKit', 'icloudmailagent', 'askpermissiond', 'Animoji']);
const RECENT = 7 * 86_400_000;
const MIN_SIZE = 1_000_000;

/** @param {string} name */
export const isOwnedElsewhere = (name) => name.startsWith('com.apple.') || name.startsWith('.') || OWNED_ELSEWHERE.has(name);

/** Editores da família VS Code: pasta de extensões e nome do processo. */
const EDITORS = /** @type {const} */ ([['.vscode', 'VS Code', 'code'], ['.vscode-insiders', 'VS Code Insiders', 'code - insiders'], ['.cursor', 'Cursor', 'cursor'], ['.windsurf', 'Windsurf', 'windsurf']]);

/**
 * Pastas que o editor marcou como obsoletas e não estão mais instaladas. O editor apaga sozinho no próximo início;
 * enquanto isso, ocupam espaço.
 * @param {string} obsolete conteúdo de .obsolete @param {string} installed conteúdo de extensions.json
 */
export function obsoleteExtensions(obsolete, installed) {
  /** @type {Set<string>} */
  let keep;
  try { keep = new Set(JSON.parse(installed).map((/** @type {{ relativeLocation?: string }} */ e) => e.relativeLocation)); } catch { return []; }
  try { return Object.keys(JSON.parse(obsolete)).filter((k) => /^[^./][^/]*$/.test(k) && !keep.has(k)); } catch { return []; }
}

/** @param {string[]} running */
async function editorExtensions(running) {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  for (const [dir, label, proc] of EDITORS) {
    const root = join(home, dir, 'extensions');
    const read = (/** @type {string} */ f) => readFile(join(root, f), 'utf8').catch(() => '');
    const open = running.includes(proc);
    for (const name of obsoleteExtensions(await read('.obsolete'), await read('extensions.json'))) {
      const path = join(root, name);
      items.push({ id: `ext-${dir}-${name}`, name, detail: label, path, size: 0, freeable: 0, safe: !open, inUse: open,
        note: msg(open ? 'note.editorOpen' : 'note.extensionObsolete', { app: label }), action: { kind: 'trash', path } });
    }
  }
  return items;
}

/**
 * Caches e logs das IDEs JetBrains: pasta por produto e versão (WebStorm2024.1). A versão mais nova de cada produto
 * pede atenção (refaz o índice ao abrir) ou fica em uso com uma IDE aberta; as antigas são seguras.
 * ponytail: "IDE aberta" = qualquer app com bundle com.jetbrains.*; casar produto a produto se incomodar.
 * @param {string[]} running
 */
async function jetbrains(running) {
  const open = running.some((r) => r.startsWith('com.jetbrains.'));
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  for (const [root, kind] of /** @type {const} */ ([[join(CACHES, 'JetBrains'), 'Cache'], [join(LOGS, 'JetBrains'), 'Log']])) {
    const dirs = (await readdir(root).catch(() => [])).map((n) => /^(\D+?)(\d{4}\.\d+)$/.exec(n)).filter((m) => m !== null);
    /** @type {Map<string, string>} */
    const latest = new Map();
    for (const [, product, version] of dirs) {
      const best = latest.get(product);
      if (!best || version.localeCompare(best, 'en', { numeric: true }) > 0) latest.set(product, version);
    }
    for (const [name, product, version] of dirs) {
      const path = join(root, name);
      const current = latest.get(product) === version;
      items.push({ id: `jetbrains-${kind}-${name}`, name: `${product} ${version}`, detail: msg(kind === 'Cache' ? 'detail.cache' : 'detail.log'), path, size: 0, freeable: 0,
        lastUsed: await newestMtime(path, 1), safe: !current, inUse: current && open,
        note: msg(!current ? 'note.jetbrainsOld' : open ? 'note.ideOpen' : 'note.jetbrainsCurrent'), action: { kind: 'trash', path } });
    }
  }
  return items;
}

export async function scan() {
  const running = await runningApps();
  /** @type {import('../../types.js').Item[]} */
  const items = [...(await editorExtensions(running)), ...(await jetbrains(running))];
  for (const [root, kind] of /** @type {const} */ ([[CACHES, 'Cache'], [LOGS, 'Log']])) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (isOwnedElsewhere(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      const lastUsed = await newestMtime(path, 2);
      const open = ownerRunning(entry.name, running);
      const recent = Date.now() - lastUsed < RECENT;
      items.push({
        id: `${kind}-${entry.name}`, name: entry.name, detail: msg(kind === 'Cache' ? 'detail.cache' : 'detail.log'), path, size: 0, freeable: 0, lastUsed, safe: !open && !recent, inUse: open,
        note: open ? msg('note.appOpen') : recent ? msg('note.appRecent') : undefined,
        action: { kind: 'trash', path },
      });
    }
  }
  const measured = (await measure(items)).filter((i) => i.size >= MIN_SIZE);
  return measured.length ? { items: measured } : null;
}
