// ÚNICO módulo que apaga (PRD › S1–S10). Lixeira para pastas, comando oficial para o resto.
// Nada daqui confia no renderer: cada alvo vem da última análise e é revalidado agora.
import electron from 'electron';
import { lstat, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { recheck as recheckBrowser, PLAYWRIGHT } from './categories/browsers.js';
import { recheck as recheckNode } from './categories/node-modules.js';
import { xcodeRunning } from './categories/xcode.js';
import { exists, home, parseSize, run, size } from './sys.js';

/**
 * @typedef {import('../types.js').CommandKey} CommandKey
 * @typedef {import('../types.js').Item} Item
 * @typedef {{ ref: string, category: import('../types.js').CategoryId, item: Item }} Target
 */

/** Tabela fechada de comandos. Argumento extra só onde há regex. @type {Record<CommandKey, { cmd: string, args: string[], arg?: RegExp, measure?: true }>} */
const COMMANDS = {
  'pnpm-prune': { cmd: 'pnpm', args: ['store', 'prune'], measure: true },
  'npm-clean': { cmd: 'npm', args: ['cache', 'clean', '--force'], measure: true },
  'yarn-clean': { cmd: 'yarn', args: ['cache', 'clean'], measure: true },
  'bun-clean': { cmd: 'bun', args: ['pm', 'cache', 'rm'], measure: true },
  'pip-purge': { cmd: 'pip3', args: ['cache', 'purge'], measure: true },
  'brew-cleanup': { cmd: 'brew', args: ['cleanup', '--prune=all'] },
  'docker-builder-prune': { cmd: 'docker', args: ['builder', 'prune', '--all', '--force'] },
  'docker-rm-container': { cmd: 'docker', args: ['container', 'rm'], arg: /^[0-9a-f]{12,64}$/ },
  'docker-rm-image': { cmd: 'docker', args: ['image', 'rm'], arg: /^[0-9a-f]{12,64}$/ },
  'docker-volume-rm': { cmd: 'docker', args: ['volume', 'rm'], arg: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/ },
  'simctl-delete-unavailable': { cmd: 'xcrun', args: ['simctl', 'delete', 'unavailable'] },
  'empty-trash': { cmd: '/usr/bin/osascript', args: ['-e', 'tell application "Finder" to empty trash'], measure: true },
};

/** Prévia oficial do Homebrew (não apaga nada). */
export const brewPreview = () => run('brew', ['cleanup', '-n', '--prune=all'], { timeout: 120_000 });

/** Texto do comando para a confirmação. @param {Item['action']} action */
export function commandLine(action) {
  if (action?.kind !== 'cmd') return undefined;
  const { cmd, args } = COMMANDS[action.key];
  if (action.key === 'empty-trash') return 'Finder › Esvaziar Lixeira';
  return [basename(cmd), ...args, action.arg?.slice(0, 12)].filter(Boolean).join(' ');
}

/**
 * Regra de caminho para a Lixeira. Devolve o motivo da recusa ou null.
 * @param {string} path @param {string} [h] pasta pessoal
 */
export function trashRule(path, h = home) {
  if (!isAbsolute(path) || normalize(path) !== path || path.endsWith(sep) || !path.startsWith(`${h}/`)) return 'Caminho inválido.';
  const parent = dirname(path);
  const name = basename(path);
  const lib = join(h, 'Library');
  if (parent === join(lib, 'Caches') || parent === join(lib, 'Logs')) {
    return name.startsWith('com.apple.') && name !== 'com.apple.dt.Xcode' ? 'Pasta mantida pelo macOS.' : null;
  }
  if (parent === join(lib, 'Developer/Xcode/DerivedData')) return null;
  if (parent === join(lib, 'Developer/CoreSimulator/Devices')) return /^[0-9A-F-]{36}$/.test(name) ? null : 'Não é um simulador.';
  if (parent === PLAYWRIGHT) return /^[a-z][a-z_]*-\d+$/.test(name) ? null : 'Não é um navegador do Playwright.';
  if (path === join(h, '.bun/install/cache')) return null;
  if (/^v\d+$/.test(name) && ['store', '.pnpm-store'].includes(basename(parent))) return null;
  if (name === 'node_modules' && !path.startsWith(`${lib}/`)) {
    const segments = path.slice(h.length + 1).split(sep);
    return segments.slice(0, -1).some((s) => s === 'node_modules' || s.startsWith('.')) ? 'node_modules dentro de outra pasta protegida.' : null;
  }
  return 'Fora das pastas que o Respiro pode limpar.';
}

/** Checagens que dependem do disco agora. @param {string} path */
async function canTrash(path) {
  const rule = trashRule(path);
  if (rule) return rule;
  const st = await lstat(path).catch(() => null);
  if (!st) return 'Já não existe.';
  if (st.isSymbolicLink()) return 'É um atalho (link simbólico).';
  if ((await realpath(path).catch(() => '')) !== path) return 'O caminho passa por um atalho.';
  if (basename(path) === 'node_modules' && !(await exists(join(dirname(path), 'package.json')))) return 'Não é a pasta de dependências de um projeto.';
  return null;
}

/** Motivo para não limpar agora, ou null. @param {Target} t @param {number} staleDays */
export async function refuse({ category, item }, staleDays) {
  const action = item.action;
  if (!action) return item.note ?? 'Protegido.';
  if (action.kind === 'trash') {
    const why = await canTrash(action.path);
    if (why) return why;
    // Item em uso escolhido de propósito já foi avisado; a revalidação protege o que entrou como seguro.
    if (!item.safe) return null;
    if (category === 'node') return recheckNode(action.path, staleDays);
    if (category === 'browsers') return recheckBrowser(action.path);
    if (category === 'xcode' && !action.path.includes('/CoreSimulator/') && await xcodeRunning()) return 'O Xcode foi aberto. Limpe de novo para confirmar.';
    return null;
  }
  const spec = COMMANDS[action.key];
  if (!spec) return 'Comando desconhecido.';
  if (spec.arg ? !spec.arg.test(action.arg ?? '') : action.arg !== undefined) return 'Argumento inválido.';
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
  const what = paths.length === 1 ? 'uma pasta criada' : `${paths.length} pastas criadas`;
  return `do shell script "/usr/sbin/chown -R ${user.uid}:${user.gid} " & ${args} with administrator privileges `
    + `with prompt "O Respiro quer devolver ao seu usuário ${what} com sudo, para poder mandá-las à Lixeira. Nada é apagado aqui."`;
}

/** Erro do sistema em frase que a pessoa entende. @param {unknown} e */
export function friendly(e) {
  const message = String(/** @type {any} */ (e)?.message ?? e);
  if (/EACCES|EPERM|permission|permiss[ãa]o/i.test(message)) return 'Sem permissão: parte dos arquivos pertence ao administrador (criados com sudo).';
  return message.slice(0, 200);
}

/** "Total reclaimed space: 1.2GB", "Total: 3.6GB", "freed approximately 1.2GB". @param {string} out @param {string} key */
export function reportedFreed(out, key) {
  const m = /(?:Total reclaimed space|Total|freed approximately):?\s*([\d.]+\s*[kKMGT]?i?B)/.exec(out);
  return m ? parseSize(m[1], key === 'brew-cleanup' ? 1024 : 1000) : null;
}

/** @param {Item} item @returns {Promise<number | null>} bytes liberados; null se ninguém sabe */
async function runCommand(item) {
  const action = /** @type {{ kind: 'cmd', key: CommandKey, arg?: string }} */ (item.action);
  const spec = COMMANDS[action.key];
  const before = spec.measure && item.path ? await size(item.path) : null;
  const out = await run(spec.cmd, action.arg ? [...spec.args, action.arg] : spec.args, { timeout: 30 * 60_000 });
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
  /** @type {Map<string, string>} ref → motivo de falha */
  const adminFailed = new Map();
  const admin = solo || simulate ? [] : (await Promise.all(targets.filter((t) => t.item.admin && t.item.action?.kind === 'trash')
    .map(async (t) => ((await refuse(t, staleDays)) ? null : t)))).filter((t) => t !== null);
  if (admin.length) {
    try {
      await run('/usr/bin/osascript', ['-e', adminScript(admin.map((t) => /** @type {{ path: string }} */ (t.item.action).path))], { timeout: 180_000 });
    } catch (/** @type {any} */ e) {
      const reason = /-128|cancel/i.test(`${e?.message} ${e?.stderr}`) ? 'Senha não informada. Nada foi apagado.' : 'O macOS não autorizou. Nada foi apagado.';
      for (const t of admin) adminFailed.set(t.ref, reason);
    }
  }

  for (const t of targets) {
    const { item } = t;
    try {
      const why = solo ? 'Este item precisa de confirmação individual.' : adminFailed.get(t.ref) ?? await refuse(t, staleDays);
      if (why) throw new Error(why);
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
