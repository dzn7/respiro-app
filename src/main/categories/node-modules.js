// Projetos sob a pasta pessoal: pastas que as ferramentas geram e recriam (node_modules, .next, target, .venv…)
// e worktrees do git. Só as de projeto parado há mais de `staleDays` entram como seguras.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { cachedSize, du, exists, has, home, newestMtime, openFiles, openInside, run, tilde } from '../sys.js';

export const id = 'node';

const JS = ['package.json'];
const PY = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'];
/** Pasta gerada → arquivo que precisa estar ao lado dela para contar como projeto. */
export const PROJECT_MARKERS = /** @type {Record<string, string[]>} */ ({
  node_modules: JS, '.next': JS, '.nuxt': JS, '.svelte-kit': JS, '.turbo': JS, '.parcel-cache': JS, dist: JS, build: JS,
  target: ['Cargo.toml'], '.venv': PY, venv: PY,
});
export const ARTIFACTS = new Set(Object.keys(PROJECT_MARKERS));
/** Podem ser código versionado: só seguros se o git ignora. */
const MAYBE_SOURCE = new Set(['dist', 'build']);

const SKIP_AT_HOME = new Set(['Library', 'Applications', 'Pictures', 'Movies', 'Music', 'Public']);
const NOT_ACTIVITY = new Set([...ARTIFACTS, '.git', '.cache', 'coverage', '.output']);
const INSTALL_MARKERS = ['.package-lock.json', '.modules.yaml', '.yarn-state.yml', '.yarn-integrity'];
const DAY = 86_400_000;

/**
 * Pastas geradas ao lado do arquivo que as define, e worktrees do git (pasta com .git em arquivo).
 * Não entra em pastas ocultas, em pastas geradas nem em ~/Library.
 * @param {string} root @param {number} [maxDepth]
 */
export async function findArtifacts(root, maxDepth = 5) {
  /** @type {{ project: string, path: string, kind: string }[]} */
  const artifacts = [];
  /** @type {string[]} */
  const worktrees = [];
  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((e) => e.name));
    if (entries.some((e) => e.name === '.git' && e.isFile())) worktrees.push(dir);
    /** @type {string[]} */
    const next = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const markers = PROJECT_MARKERS[e.name];
      if (markers?.some((m) => names.has(m))) artifacts.push({ project: dir, path: join(dir, e.name), kind: e.name });
      else if (!e.name.startsWith('.') && e.name !== 'node_modules' && !(depth === 0 && SKIP_AT_HOME.has(e.name))) next.push(join(dir, e.name));
    }
    if (depth < maxDepth) await Promise.all(next.map((d) => walk(d, depth + 1)));
  }
  await walk(root, 0);
  return { artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)), worktrees: worktrees.sort() };
}

/** Só os node_modules (usado pelos navegadores de teste e pelos testes). @param {string} root @param {number} [maxDepth] */
export const findNodeModules = async (root, maxDepth) =>
  (await findArtifacts(root, maxDepth)).artifacts.filter((a) => a.kind === 'node_modules').map((a) => a.path);

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
 * @param {string} artifact @param {number} staleDays @returns {Promise<import('../../types.js').Msg | null>} motivo para não limpar
 */
export async function recheck(artifact, staleDays) {
  if (openInside(artifact, await openFiles())) return msg('refuse.openNow');
  const markers = [...new Set(Object.values(PROJECT_MARKERS).flat())];
  for (let dir = dirname(artifact); dir.startsWith(`${home}/`); dir = dirname(dir)) {
    if (!(await Promise.all(markers.map((m) => exists(join(dir, m))))).some(Boolean)) continue;
    if (Date.now() - (await lastActivity(dir)) < staleDays * DAY) return msg('refuse.recentProject', { name: basename(dir), days: staleDays });
  }
  return null;
}

/**
 * Repositório principal de uma worktree, lido do .git dela ("gitdir: <repo>/.git/worktrees/<nome>").
 * @param {string} worktree @returns {Promise<string>}
 */
export async function worktreeMain(worktree) {
  const pointer = (await readFile(join(worktree, '.git'), 'utf8')).trim();
  const m = /^gitdir: (\/.+)\/\.git\/worktrees\/[^/]+$/.exec(pointer);
  if (!m || !m[1].startsWith(`${home}/`)) throw new Error('not a worktree');
  return m[1];
}

/**
 * dist/build: o git ignora (seguro), não acompanha (pede atenção) ou versiona (é código, fica de fora)?
 * @param {string} project @param {string} kind @returns {Promise<'ignored' | 'loose' | 'tracked'>}
 */
async function gitStatusOf(project, kind) {
  const ok = (/** @type {string[]} */ args) => run('git', ['-C', project, ...args], { timeout: 10_000 }).then(() => true, () => false);
  if (await ok(['check-ignore', '-q', kind])) return 'ignored';
  return (await ok(['ls-files', '--error-unmatch', kind])) ? 'tracked' : 'loose';
}

/**
 * @param {{ project: string, path: string, kind: string }} a @param {number} lastUsed @param {boolean} idle @param {number} size
 * @param {{ cargo: boolean }} tools @param {boolean} busy algum processo usa a pasta agora
 * @returns {Promise<import('../../types.js').Item | null>}
 */
async function artifactItem(a, lastUsed, idle, size, tools, busy) {
  let freeable = /** @type {number | null} */ (size);
  let note;
  let safe = idle && !busy;
  if (a.kind === 'node_modules') {
    // pnpm e bun clonam arquivos do store (APFS): apagar a pasta devolve bem menos do que o du mostra.
    const cloned = (await exists(join(a.path, '.pnpm'))) || (await exists(join(a.project, 'bun.lock'))) || (await exists(join(a.project, 'bun.lockb')));
    if (cloned) { freeable = null; note = msg('note.cloned'); }
    if (!idle) note = msg('note.nodeActive');
  } else if (a.kind === '.venv' || a.kind === 'venv') {
    const cfg = await readFile(join(a.path, 'pyvenv.cfg'), 'utf8').catch(() => '');
    if (!cfg) return null;
    if (/^uv\s*=/m.test(cfg)) { freeable = null; note = msg('note.venvCloned'); }
    if (!idle) note = msg('note.venvActive');
  } else if (MAYBE_SOURCE.has(a.kind)) {
    const status = await gitStatusOf(a.project, a.kind);
    if (status === 'tracked') return null;
    if (status === 'loose') { safe = false; note = msg('note.buildMaybeSource'); }
    if (!idle) note = msg('note.buildActive');
  } else if (!idle) {
    note = msg('note.buildActive');
  }
  // Data velha não basta: um servidor rodando do .venv ou do node_modules há semanas usa a pasta agora.
  if (busy) note = msg('note.openNow');
  return {
    id: a.path, name: basename(a.project), detail: tilde(a.path), path: a.path, size, lastUsed, freeable, safe, inUse: !idle || busy, note,
    action: a.kind === 'target' && tools.cargo
      ? { kind: 'cmd', key: 'cargo-clean', arg: join(a.project, 'Cargo.toml') }
      : { kind: 'trash', path: a.path },
  };
}

/**
 * Worktree: só sai pelo `git worktree remove` (sem --force), que recusa se houver mudança.
 * @param {string} wt @param {number} lastUsed @param {boolean} idle @param {number} total tamanho inteiro @param {number} inner já contado em pastas geradas
 * @param {boolean} busy algum processo usa a pasta agora
 * @returns {Promise<import('../../types.js').Item | null>}
 */
async function worktreeItem(wt, lastUsed, idle, total, inner, busy) {
  const main = await worktreeMain(wt).catch(() => null);
  if (!main) return null;
  const pointer = (await readFile(join(wt, '.git'), 'utf8')).trim().slice('gitdir: '.length);
  const locked = await exists(join(pointer, 'locked'));
  const dirty = (await run('git', ['-C', wt, 'status', '--porcelain'], { timeout: 20_000 }).catch(() => 'x')).trim() !== '';
  const secrets = (await exists(join(wt, '.env'))) || (await exists(join(wt, '.env.local')));
  const blocked = locked || dirty;
  const own = Math.max(0, total - inner);
  return {
    id: `worktree:${wt}`, name: basename(wt), detail: tilde(wt), path: wt, lastUsed,
    // Só o que não aparece em outra linha (node_modules/.next listados dentro dela): nada contado duas vezes.
    size: own, freeable: blocked ? 0 : own, safe: false, inUse: blocked || !idle || busy,
    note: msg(locked ? 'note.worktreeLocked' : dirty ? 'note.worktreeDirty' : busy ? 'note.openNow' : secrets ? 'note.worktreeEnv' : idle ? 'note.worktree' : 'note.worktreeActive'),
    action: blocked ? null : { kind: 'cmd', key: 'git-worktree-remove', arg: wt },
  };
}

/** @param {import('../../types.js').ScanContext} ctx */
export async function scan(ctx) {
  const { artifacts, worktrees } = await findArtifacts(ctx.home);
  if (!artifacts.length && !worktrees.length) return null;

  const projects = [...new Set([...artifacts.map((a) => a.project), ...worktrees])];
  const last = groupActivity(new Map(await Promise.all(projects.map(async (p) => /** @type {[string, number]} */ ([p, await lastActivity(p)])))));
  const idle = (/** @type {string} */ p) => Date.now() - (last.get(p) ?? 0) >= ctx.staleDays * DAY;

  // node_modules só muda quando o projeto reinstala: a chave é a data da instalação.
  const modules = artifacts.filter((a) => a.kind === 'node_modules').map((a) => a.path);
  const keys = await Promise.all(modules.map(async (nm) => (await Promise.all(
    ['', ...INSTALL_MARKERS].map((f) => stat(join(nm, f)).then((s) => s.mtimeMs, () => 0)))).join(':')));
  const measured = await du(modules.filter((nm, i) => ctx.sizeCache[nm]?.key !== keys[i]));
  modules.forEach((nm, i) => { if (measured.has(nm)) ctx.sizeCache[nm] = { key: keys[i], size: measured.get(nm) ?? 0 }; });
  // As outras pastas geradas e as worktrees usam a impressão digital de dois níveis.
  await Promise.all([...artifacts.filter((a) => a.kind !== 'node_modules').map((a) => a.path), ...worktrees]
    .map((p) => cachedSize(p, ctx.sizeCache)));
  const present = new Set([...artifacts.map((a) => a.path), ...worktrees]);
  for (const p of Object.keys(ctx.sizeCache)) if (ARTIFACTS.has(basename(p)) && !present.has(p)) delete ctx.sizeCache[p];

  const tools = { cargo: await has('cargo') };
  const files = await openFiles();
  const listed = (await Promise.all(artifacts.map((a) => artifactItem(a, last.get(a.project) ?? 0, idle(a.project), ctx.sizeCache[a.path]?.size ?? 0, tools,
    openInside(a.path, files))))).filter((i) => i !== null);
  const trees = await Promise.all(worktrees.map((wt) => {
    // Desconta só as pastas geradas que viraram linha; as que ficaram de fora (dist versionado) continuam na worktree.
    const inner = listed.filter((i) => i.path?.startsWith(`${wt}/`)).reduce((s, i) => s + i.size, 0);
    return worktreeItem(wt, last.get(wt) ?? 0, idle(wt), ctx.sizeCache[wt]?.size ?? 0, inner, openInside(wt, files));
  }));
  return { items: [...listed, ...trees].filter((i) => i !== null && i.size > 0).map((i) => /** @type {import('../../types.js').Item} */ (i)) };
}
