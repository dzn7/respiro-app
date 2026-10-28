// ÚNICO módulo que apaga (PRD › S1–S10). Lixeira para pastas, comando oficial para o resto.
// Nada daqui confia no renderer: cada alvo vem da última análise e é revalidado agora.
import electron from 'electron';
import { lstat, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { recheck as recheckBrowser, PLAYWRIGHT } from './categories/browsers.js';
import { ARTIFACTS, PROJECT_MARKERS, recheck as recheckNode, worktreeMain } from './categories/node-modules.js';
import { xcodeRunning } from './categories/xcode.js';
import { msg, t } from '../shared/i18n.js';
import { exists, home, parseSize, run, size } from './sys.js';

/**
 * @typedef {import('../types.js').CommandKey} CommandKey
 * @typedef {import('../types.js').Item} Item
 * @typedef {{ ref: string, category: import('../types.js').CategoryId, item: Item }} Target
 * @typedef {import('../types.js').Msg} Msg
 */

/** Caminho absoluto, normalizado, dentro da pasta pessoal e fora de ~/Library. @param {string} a */
const projectPath = (a) => isAbsolute(a) && normalize(a) === a && a.startsWith(`${home}/`) && !a.startsWith(`${home}/Library/`);

/**
 * Tabela fechada de comandos. Argumento extra só com validador (regex ou função).
 * `build` monta argumentos que dependem do disco (repositório da worktree).
 * @type {Record<CommandKey, { cmd: string, args: string[], arg?: RegExp | ((a: string) => boolean), build?: (a: string) => Promise<string[]>, measure?: true }>}
 */
const COMMANDS = {
  'pnpm-prune': { cmd: 'pnpm', args: ['store', 'prune'], measure: true },
  'npm-clean': { cmd: 'npm', args: ['cache', 'clean', '--force'], measure: true },
  'yarn-clean': { cmd: 'yarn', args: ['cache', 'clean'], measure: true },
  'bun-clean': { cmd: 'bun', args: ['pm', 'cache', 'rm'], measure: true },
  'pip-purge': { cmd: 'pip3', args: ['cache', 'purge'], measure: true },
  'uv-prune': { cmd: 'uv', args: ['cache', 'prune'] },
  'go-clean-modcache': { cmd: 'go', args: ['clean', '-modcache'], measure: true },
  'go-clean-cache': { cmd: 'go', args: ['clean', '-cache'], measure: true },
  'pod-cache-clean': { cmd: 'pod', args: ['cache', 'clean', '--all'], measure: true },
  'dart-pub-cache-clean': { cmd: 'dart', args: ['pub', 'cache', 'clean', '--force'], measure: true },
  'cargo-clean': { cmd: 'cargo', args: ['clean', '--manifest-path'], arg: (a) => projectPath(a) && a.endsWith('/Cargo.toml'), measure: true },
  'git-worktree-remove': { cmd: 'git', args: [], arg: projectPath, build: async (a) => ['-C', await worktreeMain(a), 'worktree', 'remove', a] },
  'avd-delete': { cmd: 'avdmanager', args: ['delete', 'avd', '-n'], arg: /^[\w.-]{1,100}$/ },
  'sdk-uninstall': { cmd: 'sdkmanager', args: ['--uninstall'], arg: /^system-images;android-[\w.-]+;[\w-]+;[\w-]+$/ },
  'brew-cleanup': { cmd: 'brew', args: ['cleanup', '--prune=all'] },
  'docker-builder-prune': { cmd: 'docker', args: ['builder', 'prune', '--all', '--force'] },
  'docker-rm-container': { cmd: 'docker', args: ['container', 'rm'], arg: /^[0-9a-f]{12,64}$/ },
  'docker-rm-image': { cmd: 'docker', args: ['image', 'rm'], arg: /^[0-9a-f]{12,64}$/ },
  'docker-volume-rm': { cmd: 'docker', args: ['volume', 'rm'], arg: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/ },
  'docker-reclaim': { cmd: 'docker', args: ['run', '--rm', '--privileged', '--pid=host', 'docker/desktop-reclaim-space'] },
  'simctl-delete-unavailable': { cmd: 'xcrun', args: ['simctl', 'delete', 'unavailable'] },
  'empty-trash': { cmd: '/usr/bin/osascript', args: ['-e', 'tell application "Finder" to empty trash'], measure: true },
};

/** @param {CommandKey} key @param {string | undefined} arg */
async function argv(key, arg) {
  const spec = COMMANDS[key];
  if (spec.build && arg) return spec.build(arg);
  return arg ? [...spec.args, arg] : spec.args;
}

/** Prévia oficial do Homebrew (não apaga nada). */
export const brewPreview = () => run('brew', ['cleanup', '-n', '--prune=all'], { timeout: 120_000 });

/** Texto do comando para a confirmação. @param {Item['action']} action @returns {import('../types.js').Text | undefined} */
export function commandLine(action) {
  if (action?.kind !== 'cmd') return undefined;
  const { cmd, args } = COMMANDS[action.key];
  if (action.key === 'empty-trash') return msg('cmd.emptyTrash');
  if (action.key === 'git-worktree-remove') return `git worktree remove ${action.arg?.replace(home, '~') ?? ''}`;
  if (action.key === 'cargo-clean') return `cargo clean --manifest-path ${action.arg?.replace(home, '~') ?? ''}`;
  return [basename(cmd), ...args, action.arg && /^[0-9a-f]{12,}$/.test(action.arg) ? action.arg.slice(0, 12) : action.arg].filter(Boolean).join(' ');
}

/**
 * Regra de caminho para a Lixeira. Devolve o motivo da recusa ou null.
 * Só passa o que está numa raiz conhecida: filho direto de uma pasta de cache listada, caminho exato
 * de cache de ferramenta, ou pasta gerada (node_modules, .next, target…) dentro de um projeto.
 * @param {string} path @param {string} [h] pasta pessoal @returns {Msg | null}
 */
export function trashRule(path, h = home) {
  if (!isAbsolute(path) || normalize(path) !== path || path.endsWith(sep) || !path.startsWith(`${h}/`)) return msg('refuse.invalidPath');
  const parent = dirname(path);
  const name = basename(path);
  const lib = join(h, 'Library');
  const any = () => true;
  /** @type {[string, (n: string) => boolean, string?][]} pai → nome aceito → motivo da recusa */
  const children = [
    [join(lib, 'Caches'), (n) => !n.startsWith('com.apple.') || n === 'com.apple.dt.Xcode', 'refuse.appleFolder'],
    [join(lib, 'Logs'), (n) => !n.startsWith('com.apple.'), 'refuse.appleFolder'],
    [join(lib, 'Developer/Xcode/DerivedData'), any],
    [join(lib, 'Developer/CoreSimulator/Devices'), (n) => /^[0-9A-F-]{36}$/.test(n), 'refuse.notSimulator'],
    ...['iOS', 'watchOS', 'tvOS', 'visionOS'].map((os) => /** @type {[string, (n: string) => boolean]} */ ([join(lib, `Developer/Xcode/${os} DeviceSupport`), any])),
    [PLAYWRIGHT, (n) => /^[a-z][a-z_]*-\d+$/.test(n), 'refuse.notPlaywright'],
    [join(lib, 'Caches/Cypress'), (n) => /^\d+\.\d+\.\d+/.test(n)],
    [join(lib, 'Caches/JetBrains'), any],
    [join(lib, 'Logs/JetBrains'), any],
    ...['.vscode', '.vscode-insiders', '.cursor', '.windsurf'].map((d) => /** @type {[string, (n: string) => boolean]} */ ([join(h, d, 'extensions'), (n) => !n.startsWith('.')])),
  ];
  const rule = children.find(([dir]) => dir === parent);
  if (rule) return rule[1](name) ? null : msg(rule[2] ?? 'refuse.outside');

  const exact = ['.bun/install/cache', '.cache/uv', '.cargo/registry/cache', '.cargo/registry/src', '.cargo/git/checkouts',
    '.gradle/caches', '.gradle/wrapper/dists', '.m2/repository', '.pub-cache'].map((p) => join(h, p));
  if (exact.includes(path)) return null;
  if (/^v\d+$/.test(name) && ['store', '.pnpm-store'].includes(basename(parent))) return null;
  if (dirname(parent) === join(h, '.cache/puppeteer') && /^[\w.-]+$/.test(name)) return null;
  const sdk = process.env.ANDROID_HOME || join(lib, 'Android/sdk');
  if (path.startsWith(`${sdk}/system-images/`) && path.slice(sdk.length + 1).split(sep).length === 4) return null;

  if (ARTIFACTS.has(name) && !path.startsWith(`${lib}/`)) {
    const segments = path.slice(h.length + 1).split(sep);
    return segments.slice(0, -1).some((s) => s === 'node_modules' || s.startsWith('.')) ? msg('refuse.nested') : null;
  }
  return msg('refuse.outside');
}

/** Checagens que dependem do disco agora. @param {string} path @returns {Promise<Msg | null>} */
async function canTrash(path) {
  const rule = trashRule(path);
  if (rule) return rule;
  const st = await lstat(path).catch(() => null);
  if (!st) return msg('refuse.gone');
  if (st.isSymbolicLink()) return msg('refuse.symlink');
  if ((await realpath(path).catch(() => '')) !== path) return msg('refuse.throughLink');
  // Pasta gerada só sai se estiver ao lado do arquivo que a define (package.json, Cargo.toml…).
  const markers = PROJECT_MARKERS[basename(path)];
  if (markers && !(await Promise.all(markers.map((/** @type {string} */ m) => exists(join(dirname(path), m))))).some(Boolean)) return msg('refuse.notProject');
  return null;
}

/** Motivo para não limpar agora, ou null. @param {Target} t @param {number} staleDays @returns {Promise<Msg | null>} */
export async function refuse({ category, item }, staleDays) {
  const action = item.action;
  if (!action) return item.note ?? msg('refuse.protected');
  if (action.kind === 'trash') {
    const why = await canTrash(action.path);
    if (why) return why;
    // Item em uso escolhido de propósito já foi avisado; a revalidação protege o que entrou como seguro.
    if (!item.safe) return null;
    if (category === 'node') return recheckNode(action.path, staleDays);
    if (category === 'browsers') return recheckBrowser(action.path);
    if (category === 'xcode' && /\/Xcode\/|com\.apple\.dt\.Xcode/.test(action.path) && await xcodeRunning()) return msg('refuse.xcodeOpened');
    return null;
  }
  const spec = COMMANDS[action.key];
  if (!spec) return msg('refuse.unknownCommand');
  const ok = !spec.arg ? action.arg === undefined
    : typeof spec.arg === 'function' ? spec.arg(action.arg ?? '') : spec.arg.test(action.arg ?? '');
  if (!ok) return msg('refuse.badArg');
  return null;
}

/**
 * AppleScript que devolve ao usuário pastas do root, com o diálogo de senha do macOS (uma vez para todas).
 * Só chown: nada é apagado como root. Caminhos já passaram por trashRule.
 * @param {string[]} paths @param {{ uid: number, gid: number }} [user]
 */
export function adminScript(paths, user = userInfo()) {
  const literal = (/** @type {string} */ p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const args = paths.map((p) => `quoted form of ${literal(p)}`).join(' & " " & ');
  return `do shell script "/usr/sbin/chown -R ${user.uid}:${user.gid} " & ${args} with administrator privileges `
    + `with prompt ${literal(t('admin.prompt', { n: paths.length }))}`;
}

/** Erro do sistema em frase que a pessoa entende. @param {unknown} e @returns {Msg} */
export function friendly(e) {
  const message = String(/** @type {any} */ (e)?.message ?? e);
  if (/EACCES|EPERM|permission|permiss[ãa]o/i.test(message)) return msg('error.permission');
  return msg('error.raw', { text: message.slice(0, 200) });
}

/**
 * Quanto a ferramenta diz que liberou: docker ("Total reclaimed space: 1.2GB", "Total: 3.6GB"),
 * brew ("freed approximately 1.2GB"), uv ("Removed 12 files (3.4GiB)"), cargo ("Removed 9 files, 1.1GiB total").
 * @param {string} out @param {string} key
 */
export function reportedFreed(out, key) {
  const m = /(?:Total reclaimed space|Total|freed approximately):?\s*([\d.]+\s*[kKMGT]?i?B)/.exec(out)
    ?? /Removed [\d,]+ files?(?: \(|, )([\d.]+\s*[kKMGT]?i?B)/.exec(out);
  return m ? parseSize(m[1], key === 'brew-cleanup' || /iB/.test(m[1]) ? 1024 : 1000) : null;
}

/** @param {Item} item @returns {Promise<number | null>} bytes liberados; null se ninguém sabe */
async function runCommand(item) {
  const action = /** @type {{ kind: 'cmd', key: CommandKey, arg?: string }} */ (item.action);
  const spec = COMMANDS[action.key];
  const before = spec.measure && item.path ? await size(item.path) : null;
  const out = await run(spec.cmd, await argv(action.key, action.arg), { timeout: 30 * 60_000 });
  const reported = reportedFreed(out, action.key);
  if (reported !== null) return reported;
  if (before !== null && item.path) return Math.max(0, before - (await size(item.path)));
  return item.freeable;
}

/**
 * Limpa os alvos em sequência. Simular percorre as mesmas checagens sem executar nada.
 * @param {Target[]} targets @param {{ simulate: boolean, staleDays: number }} opts
 * @returns {Promise<import('../types.js').CleanResult>}
 */
export async function clean(targets, { simulate, staleDays }) {
  /** @type {import('../types.js').CleanResult} */
  const result = { simulated: simulate, freed: 0, trashed: 0, unknown: 0, done: [], failed: [], docker: false, disk: 0 };
  const solo = targets.length > 1 && targets.some((t) => t.item.individual);
  /** @type {Set<string>} comandos sem argumento rodam uma vez só */
  const ran = new Set();

  // Pastas do root: uma senha só, pedida antes de mexer em qualquer uma.
  /** @type {Map<string, Msg>} ref → motivo de falha */
  const adminFailed = new Map();
  const admin = solo || simulate ? [] : (await Promise.all(targets.filter((t) => t.item.admin && t.item.action?.kind === 'trash')
    .map(async (t) => ((await refuse(t, staleDays)) ? null : t)))).filter((t) => t !== null);
  if (admin.length) {
    try {
      await run('/usr/bin/osascript', ['-e', adminScript(admin.map((t) => /** @type {{ path: string }} */ (t.item.action).path))], { timeout: 180_000 });
    } catch (/** @type {any} */ e) {
      const reason = msg(/-128|cancel/i.test(`${e?.message} ${e?.stderr}`) ? 'error.passwordCancelled' : 'error.passwordDenied');
      for (const t of admin) adminFailed.set(t.ref, reason);
    }
  }

  for (const t of targets) {
    const { item } = t;
    const why = solo ? msg('error.solo') : adminFailed.get(t.ref) ?? await refuse(t, staleDays);
    if (why) {
      result.failed.push({ ref: t.ref, name: item.name, message: why });
      continue;
    }
    try {
      const action = /** @type {NonNullable<Item['action']>} */ (item.action);
      if (action.kind === 'trash') {
        if (!simulate) await electron.shell.trashItem(action.path);
        result.trashed += item.size;
      } else {
        const once = `${action.key}:${action.arg ?? ''}`;
        const freed = simulate ? item.freeable : ran.has(once) ? 0 : await runCommand(item);
        ran.add(once);
        if (freed === null) result.unknown += 1;
        else result.freed += freed;
      }
      result.done.push(t.ref);
      if (t.category === 'docker') result.docker = true;
    } catch (/** @type {any} */ e) {
      result.failed.push({ ref: t.ref, name: item.name, message: friendly(e) });
    }
  }
  return result;
}
