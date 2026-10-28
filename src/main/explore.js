// Explorar: mapa do disco, arquivos grandes e duplicados. Só lê. Quem manda para a Lixeira é o cleaner (S14), pelos
// refs "explore/<id>" deste índice: o renderer nunca manda caminho.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { literal, personalRule } from './cleaner.js';
import { t } from '../shared/i18n.js';
import { home, run, tilde } from './sys.js';

/**
 * @typedef {import('../types.js').ExploreNode} ExploreNode
 * @typedef {import('../types.js').ExploreFile} ExploreFile
 * @typedef {{ path: string, size: number, dir: boolean, known?: boolean, seen?: { bytes: number, mtime: number } }} Entry
 */

/** Raízes do mapa. "disk" lê o volume de dados inteiro com a senha de administrador, só para ler. */
export const ROOTS = { home, apps: '/Applications', disk: '/System/Volumes/Data' };

/** Índice id → o que apareceu na tela, para o cleaner resolver os refs. Arquivo guarda tamanho e data de quando foi listado. */
/** @type {Map<string, Entry>} */
const index = new Map();

/**
 * `known`: o mapa já leu as subpastas desta (entrar nela só precisa dos arquivos).
 * @param {string} path @param {number} size @param {boolean} dir @param {{ bytes: number, mtime: number }} [seen] @param {boolean} [known]
 */
function remember(path, size, dir, seen, known = false) {
  const id = createHash('sha1').update(path).digest('hex').slice(0, 16);
  index.set(id, { path, size, dir, seen, known: known || index.get(id)?.known });
  return id;
}

/** @param {string} id */
export const lookup = (id) => index.get(id) ?? null;
/** @param {string} id */
export const forget = (id) => index.delete(id);

/**
 * Saída do `du -k` → árvore com tamanho em bytes, filhos do maior para o menor. Puro, testado.
 * @param {string[]} lines @param {string} root
 */
export function treeFromDu(lines, root) {
  /** @type {Map<string, ExploreNode>} */
  const nodes = new Map();
  for (const line of lines) {
    const m = /^(\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    nodes.set(m[2], { id: '', path: m[2], name: m[2] === root ? root : basename(m[2]), size: Number(m[1]) * 1024, dir: true, children: [] });
  }
  for (const [path, node] of nodes) if (path !== root) nodes.get(dirname(path))?.children?.push(node);
  for (const node of nodes.values()) node.children?.sort((a, b) => b.size - a.size);
  return nodes.get(root) ?? null;
}

/** Id do índice, se a regra deixa ir para a Lixeira e o caminho para mostrar ("~/…"), em toda a árvore. @param {ExploreNode} node */
function annotate(node) {
  node.id = remember(node.path, node.size, node.dir, node.dir ? undefined : node.seen, Boolean(node.children?.some((c) => c.dir)));
  node.trashable = personalRule(node.path) === null;
  node.path = tilde(node.path);
  delete node.seen;
  for (const c of node.children ?? []) annotate(c);
  return node;
}

/** du com contagem de linhas para o progresso. du sai com erro quando alguma pasta é protegida: o que leu vale. */
async function du(/** @type {string} */ path, /** @type {number} */ depth, onCount = (/** @type {number} */ _n) => {}) {
  let n = 0;
  const out = await run('/usr/bin/du', ['-k', '-x', '-d', String(depth), path], {
    timeout: 30 * 60_000, onLine: () => { n += 1; if (n % 200 === 0) onCount(n); },
  }).catch((/** @type {any} */ e) => String(e?.stdout ?? ''));
  return out.split('\n');
}

/** Leitura do du já feita: o mapa da pasta pessoal leva minutos (o du do macOS lê pasta por pasta), então fica guardado. */
const MAP_MAX_AGE = 6 * 3600_000;
/** Depois de mandar algo do Explorar para a Lixeira, o mapa guardado não vale mais. */
let stale = false;
export const invalidate = () => { stale = true; };

/**
 * Mapa de uma raiz até 3 níveis. "disk" roda o mesmo du como root pelo diálogo do macOS: nada é escrito nem apagado.
 * Com `cache`, reaproveita a leitura de até 6 h (sem pedir a senha de novo); `fresh` lê de novo.
 * @param {'home' | 'apps' | 'disk'} scope @param {(n: number) => void} onCount @param {{ cache?: string, fresh?: boolean }} [o]
 */
export async function mapScope(scope, onCount, { cache, fresh = false } = {}) {
  const root = ROOTS[scope];
  const file = cache && join(cache, `explore-${scope}.txt`);
  let at = Date.now();
  /** @type {string[] | null} */
  let lines = null;
  const saved = file && !fresh && !stale ? await stat(file).catch(() => null) : null;
  const cached = Boolean(saved && at - saved.mtimeMs < MAP_MAX_AGE);
  if (file && saved && cached) {
    lines = (await readFile(file, 'utf8')).split('\n');
    at = saved.mtimeMs;
  } else if (scope === 'disk') {
    const script = `do shell script "/usr/bin/du -k -x -d 3 ${root} 2>/dev/null; exit 0" with administrator privileges with prompt ${literal(t('admin.promptMap'))}`;
    const out = await run('/usr/bin/osascript', ['-e', script], { timeout: 30 * 60_000 }).catch((/** @type {any} */ e) => {
      throw new Error(/-128|cancel/i.test(`${e?.message} ${e?.stderr}`) ? 'error.passwordCancelled' : 'error.passwordDenied');
    });
    lines = out.split(/\r\n|\r|\n/);
  } else {
    lines = await du(root, 3, onCount);
  }
  if (file && !cached) {
    await writeFile(file, lines.join('\n')).catch(() => {});
    stale = false;
  }
  const tree = treeFromDu(lines, root);
  if (!tree) return null;
  annotate(tree).at = at;
  return tree;
}

/**
 * Arquivos de 1 MB para cima de uma pasta e, se o mapa ainda não leu as subpastas dela (abaixo do 3º nível), as
 * subpastas (du -d 1). Repetir o du numa pasta já lida levaria minutos em ~/Library. Só dentro das raízes.
 * @param {string} id
 */
export async function listDir(id) {
  const entry = index.get(id);
  if (!entry?.dir || !Object.values(ROOTS).some((r) => entry.path === r || entry.path.startsWith(`${r}/`))) return null;
  /** @type {ExploreNode} */
  const empty = { id: '', path: entry.path, name: basename(entry.path), size: entry.size, dir: true, children: [] };
  const node = entry.known ? empty : treeFromDu(await du(entry.path, 1), entry.path) ?? empty;
  for (const e of await readdir(entry.path, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile()) continue;
    const path = join(entry.path, e.name);
    const st = await lstat(path).catch(() => null);
    if (st && st.blocks * 512 >= 1e6) node.children?.push({ id: '', path, name: e.name, size: st.blocks * 512, dir: false, mtime: st.mtimeMs, seen: { bytes: st.size, mtime: st.mtimeMs } });
  }
  node.children?.sort((a, b) => b.size - a.size);
  return annotate(node);
}

/** Spotlight; com ele desligado, find (mais lento). @param {string} root @param {number} min bytes */
async function bigFiles(root, min) {
  const out = await run('/usr/bin/mdfind', ['-onlyin', root, `kMDItemFSSize > ${min}`], { timeout: 60_000 }).catch(() => '');
  if (out.trim()) return out.split('\n').filter(Boolean);
  const found = await run('/usr/bin/find', [root, '-xdev', '-type', 'f', '-size', `+${Math.round(min / 1e6)}M`], { timeout: 10 * 60_000 })
    .catch((/** @type {any} */ e) => String(e?.stdout ?? ''));
  return found.split('\n').filter(Boolean);
}

/** @param {string} path @param {import('node:fs').Stats} st @returns {ExploreFile} */
function file(path, st) {
  // Espaço ocupado de verdade: arquivo esparso (Docker.raw, disco de VM) tem tamanho aparente muito maior.
  const size = st.blocks * 512;
  return { id: remember(path, size, false, { bytes: st.size, mtime: st.mtimeMs }), path: tilde(path), name: basename(path), size, mtime: st.mtimeMs,
    trashable: personalRule(path) === null };
}

/**
 * Arquivos de 100 MB para cima: pasta pessoal, Aplicativos e as pastas compartilhadas.
 * @returns {Promise<ExploreFile[]>}
 */
export async function largeFiles(min = 100e6) {
  const seen = new Set();
  /** @type {ExploreFile[]} */
  const files = [];
  for (const root of [home, '/Applications', '/Library', '/Users/Shared']) {
    for (const path of await bigFiles(root, min)) {
      if (seen.has(path)) continue;
      seen.add(path);
      const st = await lstat(path).catch(() => null);
      if (st?.isFile() && st.blocks * 512 >= min) files.push(file(path, st));
    }
  }
  return files.sort((a, b) => b.size - a.size);
}

/** Fora dos duplicados: dados de apps, dependências, repositórios, pacotes de app, discos de VM. */
const SKIP = /\/(?:Library|node_modules|\.git|\.Trash|\.cache|\.npm|\.pnpm-store|\.venv|venv)\/|\.app\/|\.(?:raw|vmdk|qcow2|vdi|vhdx|sparseimage|sparsebundle)$/i;

/** Cabeça e cauda (64 KB cada) ou o arquivo inteiro. @param {string} path @param {number} size @param {boolean} full */
async function digest(path, size, full) {
  const hash = createHash(full ? 'sha256' : 'sha1');
  if (full) {
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  }
  const fd = await open(path, 'r');
  try {
    const n = Math.min(65536, size);
    const buf = Buffer.alloc(n);
    await fd.read(buf, 0, n, 0);
    hash.update(buf);
    await fd.read(buf, 0, n, size - n);
    hash.update(buf);
  } finally {
    await fd.close();
  }
  return hash.digest('hex');
}

/** Grupos de 2+ com a mesma chave, em sequência (sem abrir centenas de arquivos juntos). @template T @param {T[]} list @param {(x: T) => Promise<string> | string} key */
async function groups(list, key) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const x of list) {
    // Arquivo que sumiu ou não abre no meio do caminho sai da conta.
    const k = await Promise.resolve().then(() => key(x)).catch(() => null);
    if (k !== null) map.set(k, [...(map.get(k) ?? []), x]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/**
 * Cópia que fica: a mais antiga fora de Downloads e da Mesa (se todas estão lá, a mais antiga). Puro, testado.
 * @param {{ path: string, mtime: number }[]} copies @param {string} [h]
 */
export function keeper(copies, h = home) {
  const loose = (/** @type {string} */ p) => p.startsWith(`${h}/Downloads/`) || p.startsWith(`${h}/Desktop/`);
  const sorted = [...copies].sort((a, b) => a.mtime - b.mtime);
  return (sorted.find((c) => !loose(c.path)) ?? sorted[0]).path;
}

/**
 * Duplicados na pasta pessoal: mesmo tamanho → mesma cabeça e cauda → mesmo SHA-256.
 * ponytail: lê no máximo 50 GB por rodada; acima disso os maiores grupos ficam para a próxima.
 * @param {(read: number, total: number) => void} onProgress @param {{ paths?: string[], min?: number, h?: string }} [o] testes
 * @returns {Promise<import('../types.js').DuplicateGroup[]>}
 */
export async function duplicates(onProgress, { paths, min = 20e6, h = home } = {}) {
  const LIMIT = 50e9;
  /** @type {{ path: string, st: import('node:fs').Stats }[]} */
  const files = [];
  for (const path of paths ?? await bigFiles(h, min)) {
    if (SKIP.test(path)) continue;
    const st = await lstat(path).catch(() => null);
    if (st?.isFile() && st.size >= min) files.push({ path, st });
  }
  /** @type {typeof files[]} */
  const candidates = [];
  for (const g of await groups(files, (f) => String(f.st.size))) candidates.push(...await groups(g, (f) => digest(f.path, f.st.size, false)));
  candidates.sort((a, b) => b[0].st.size * b.length - a[0].st.size * a.length);
  const total = Math.min(LIMIT, candidates.reduce((s, g) => s + g[0].st.size * g.length, 0));
  let read = 0;
  /** @type {import('../types.js').DuplicateGroup[]} */
  const result = [];
  for (const group of candidates) {
    if (read + group[0].st.size * group.length > LIMIT) break;
    const same = await groups(group, async (f) => {
      const d = await digest(f.path, f.st.size, true);
      read += f.st.size;
      onProgress(read, total);
      return d;
    });
    for (const g of same) {
      const keep = keeper(g.map((f) => ({ path: f.path, mtime: f.st.mtimeMs })), h);
      result.push({ size: g[0].st.size, copies: g.map((f) => ({ ...file(f.path, f.st), keep: f.path === keep })) });
    }
  }
  return result.sort((a, b) => b.size * (b.copies.length - 1) - a.size * (a.copies.length - 1));
}
