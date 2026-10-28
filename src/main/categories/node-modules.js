// node_modules de projetos sob a pasta pessoal. Só os parados há mais de `staleDays` podem sair.
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { du, exists, home, newestMtime, tilde } from '../sys.js';

export const id = 'node';
export const name = 'node_modules';
export const blurb = 'Dependências instaladas em projetos parados. Voltam com pnpm install ou npm install quando você retomar o projeto.';

const SKIP_AT_HOME = new Set(['Library', 'Applications', 'Pictures', 'Movies', 'Music', 'Public']);
const NOT_ACTIVITY = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.nuxt', '.output', '.svelte-kit']);
const INSTALL_MARKERS = ['.package-lock.json', '.modules.yaml', '.yarn-state.yml', '.yarn-integrity'];
const DAY = 86_400_000;

/**
 * Pastas node_modules ao lado de um package.json, sem entrar em pastas ocultas nem em outra node_modules.
 * @param {string} root @param {number} [maxDepth] profundidade de pastas visitadas abaixo de root
 */
export async function findNodeModules(root, maxDepth = 5) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    /** @type {string[]} */
    const next = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || (depth === 0 && SKIP_AT_HOME.has(e.name))) continue;
      if (e.name !== 'node_modules') next.push(join(dir, e.name));
      else if (entries.some((x) => x.name === 'package.json')) found.push(join(dir, e.name));
    }
    if (depth < maxDepth) await Promise.all(next.map((d) => walk(d, depth + 1)));
  }
  await walk(root, 0);
  return found.sort();
}

/** Último sinal de uso do projeto: arquivos, git e instalação. @param {string} project */
export async function lastActivity(project) {
  const at = (/** @type {string} */ p) => stat(p).then((s) => s.mtimeMs, () => 0);
  const times = await Promise.all([
    newestMtime(project, 2, NOT_ACTIVITY),
    ...['.git/index', '.git/HEAD', '.git/FETCH_HEAD'].map((f) => at(join(project, f))),
    ...INSTALL_MARKERS.map((f) => at(join(project, 'node_modules', f))),
  ]);
  return Math.max(...times);
}

/**
 * Projeto dentro de monorepo herda a atividade da raiz e dos vizinhos (e vice-versa).
 * @param {Map<string, number>} last projeto → último uso
 */
export function groupActivity(last) {
  const projects = [...last.keys()];
  return new Map(projects.map((p) => [p, Math.max(...projects
    .filter((q) => q === p || p.startsWith(`${q}/`) || q.startsWith(`${p}/`))
    .map((q) => last.get(q) ?? 0))]));
}

/**
 * Revalida na hora de limpar: o projeto e as raízes acima dele seguem parados?
 * @param {string} nodeModules @param {number} staleDays @returns {Promise<string | null>} motivo para não limpar
 */
export async function recheck(nodeModules, staleDays) {
  for (let dir = dirname(nodeModules); dir.startsWith(`${home}/`); dir = dirname(dir)) {
    if (!(await exists(join(dir, 'package.json')))) continue;
    if (Date.now() - (await lastActivity(dir)) < staleDays * DAY) return `${basename(dir)} foi usado nos últimos ${staleDays} dias.`;
  }
  return null;
}

/** @param {import('../../types.js').ScanContext} ctx */
export async function scan(ctx) {
  const folders = await findNodeModules(ctx.home);
  if (!folders.length) return null;

  const projects = folders.map(dirname);
  const last = groupActivity(new Map(await Promise.all(projects.map(async (p) => /** @type {[string, number]} */ ([p, await lastActivity(p)])))));

  // Tamanho só muda quando o projeto reinstala: reaproveita a medição anterior pela data da instalação.
  const keys = await Promise.all(folders.map(async (nm) => (await Promise.all(
    ['', ...INSTALL_MARKERS].map((f) => stat(join(nm, f)).then((s) => s.mtimeMs, () => 0)))).join(':')));
  const stale = folders.filter((nm, i) => ctx.sizeCache[nm]?.key !== keys[i]);
  const measured = await du(stale);
  folders.forEach((nm, i) => { if (measured.has(nm)) ctx.sizeCache[nm] = { key: keys[i], size: measured.get(nm) ?? 0 }; });
  for (const nm of Object.keys(ctx.sizeCache)) if (nm.endsWith('/node_modules') && !folders.includes(nm)) delete ctx.sizeCache[nm];

  const items = await Promise.all(folders.map(async (nm) => {
    const project = dirname(nm);
    const lastUsed = last.get(project) ?? 0;
    const idle = Date.now() - lastUsed >= ctx.staleDays * DAY;
    // pnpm e bun clonam arquivos do store (APFS): apagar a pasta devolve bem menos do que o du mostra.
    const cloned = (await exists(join(nm, '.pnpm'))) || (await exists(join(project, 'bun.lock'))) || (await exists(join(project, 'bun.lockb')));
    const size = ctx.sizeCache[nm]?.size ?? 0;
    return /** @type {import('../../types.js').Item} */ ({
      id: nm, name: basename(project), detail: tilde(project), path: nm, size, lastUsed,
      freeable: cloned ? null : size, safe: idle, inUse: !idle,
      note: !idle ? 'Projeto ativo. Depois de limpar, rode pnpm install.'
        : cloned ? 'Instalado com pnpm ou bun: os arquivos são compartilhados com o cache, então o ganho real aparece depois.' : undefined,
      action: { kind: 'trash', path: nm },
    });
  }));
  return { items: items.filter((i) => i.size > 0) };
}
