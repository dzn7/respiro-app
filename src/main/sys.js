// Acesso ao sistema só de leitura: processos, tamanhos, datas, disco.
import { execFile } from 'node:child_process';
import { access, constants, lstat, readdir, stat, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const home = homedir();

// App aberto pelo Finder herda PATH mínimo; somamos o do shell de login e os lugares comuns.
let PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${home}/Library/pnpm`, `${home}/.bun/bin`,
  `${home}/.local/bin`, '/Applications/Docker.app/Contents/Resources/bin'].filter(Boolean).join(':');

export async function loadShellPath() {
  try {
    const out = await run(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__RESPIRO__%s__RESPIRO__" "$PATH"'], { timeout: 4000 });
    const found = out.match(/__RESPIRO__(.*)__RESPIRO__/)?.[1];
    if (found) PATH = `${found}:${PATH}`;
  } catch { /* fica o PATH padrão */ }
}

/**
 * execFile sem shell. Rejeita com a saída de erro da ferramenta.
 * @param {string} cmd @param {string[]} args @param {{ timeout?: number }} [opts]
 * @returns {Promise<string>}
 */
export function run(cmd, args, { timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 << 20, env: { ...process.env, PATH } }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr, message: (stderr || err.message).trim().split('\n').pop() }));
      else resolve(stdout);
    });
  });
}

/** @param {string} cmd */
export const has = (cmd) => run('/usr/bin/which', [cmd], { timeout: 5000 }).then(() => true, () => false);

/**
 * Dá para mover para a Lixeira sem senha? Mover pasta exige escrita no pai e na própria pasta
 * (o ".." dela muda). Pasta criada com sudo pertence ao root e falha aqui.
 * @param {string} path
 */
export async function movable(path) {
  const st = await lstat(path).catch(() => null);
  if (!st) return false;
  try {
    await access(dirname(path), constants.W_OK);
    if (st.isDirectory()) await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} p */
export const exists = (p) => lstat(p).then(() => true, () => false);

// du é I/O pesado: no máximo 8 ao mesmo tempo (SSD rende em paralelo, mais que isso só disputa).
let running = 0;
/** @type {(() => void)[]} */
const queue = [];
/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
async function limited(fn) {
  if (running >= 8) await new Promise((r) => queue.push(/** @type {() => void} */ (r)));
  running += 1;
  try { return await fn(); } finally { running -= 1; queue.shift()?.(); }
}

/**
 * Bytes alocados de cada caminho (du -sk). Caminho ilegível conta o que deu para ler.
 * @param {string[]} paths @returns {Promise<Map<string, number>>}
 */
export async function du(paths) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  await Promise.all(paths.map(async (p) => {
    const out = await limited(() => run('/usr/bin/du', ['-sk', p], { timeout: 600_000 })
      .catch((/** @type {any} */ e) => String(e.stdout ?? '')));
    const kb = Number(out.slice(0, out.indexOf('\t')));
    if (kb >= 0 && out.includes('\t')) sizes.set(p, kb * 1024);
  }));
  return sizes;
}

/** @param {string} p */
export const size = async (p) => (await du([p])).get(p) ?? 0;

/**
 * Data mais recente de uma pasta e do que está nela até `depth` níveis. Ignora o que não indica uso.
 * ponytail: amostra rasa (depth 2, 400 entradas); edição funda sem tocar pastas de cima passa despercebida.
 * @param {string} dir @param {number} [depth] @param {Set<string>} [skip]
 */
export async function newestMtime(dir, depth = 1, skip = new Set()) {
  let newest = 0;
  let budget = 400;
  /** @param {string} d @param {number} level */
  async function visit(d, level) {
    let entries;
    try {
      newest = Math.max(newest, (await stat(d)).mtimeMs);
      entries = await readdir(d, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (budget-- <= 0 || skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory() && level < depth) await visit(p, level + 1);
      else newest = Math.max(newest, await lstat(p).then((s) => s.mtimeMs, () => 0));
    }
  }
  await visit(dir, 0);
  return newest;
}

/**
 * Tamanhos como as CLIs imprimem: "1.093GB", "8.19kB", "0B". Docker usa base 1000, Homebrew 1024.
 * @param {string} text @param {1000 | 1024} [base]
 */
export function parseSize(text, base = 1000) {
  const m = /([\d.]+)\s*([kKMGTP]?)i?B/.exec(text ?? '');
  if (!m) return 0;
  return Math.round(Number(m[1]) * base ** ' KMGTP'.indexOf(m[2].toUpperCase() || ' '));
}

// Nome do volume sai do diskutil em segundo plano; a primeira tela não espera por ele.
let diskName = 'Macintosh HD';
const named = run('/usr/sbin/diskutil', ['info', '/'], { timeout: 3000 })
  .then((out) => { diskName = out.match(/Volume Name:\s*(.+)/)?.[1].trim() || diskName; }, () => {});

/** @param {{ wait?: boolean }} [opts] */
export async function diskInfo({ wait = false } = {}) {
  if (wait) await named;
  const s = await statfs('/');
  // ponytail: bavail ignora o espaço "purgável" que o Finder soma; o livre aqui pode sair menor.
  return { name: diskName, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}

/**
 * Impressão digital barata de uma pasta: datas e contagem de 2 níveis. Serve para quem
 * só cresce criando entradas nesses níveis (store do pnpm, node_modules); não para cache qualquer.
 * @param {string} dir
 */
export async function fingerprint(dir) {
  let newest = 0;
  let count = 0;
  /** @param {string} d @param {number} level */
  async function visit(d, level) {
    newest = Math.max(newest, await stat(d).then((s) => s.mtimeMs, () => 0));
    if (level === 2) return;
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    count += entries.length;
    await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => visit(join(d, e.name), level + 1)));
  }
  await visit(dir, 0);
  return `${newest}:${count}`;
}

/**
 * Tamanho com cache por impressão digital. `measure` troca o du por algo mais rápido da própria ferramenta.
 * @param {string} path @param {import('../types.js').ScanContext['sizeCache']} cache
 * @param {(path: string) => Promise<number>} [measure]
 */
export async function cachedSize(path, cache, measure = size) {
  const key = await fingerprint(path);
  if (cache[path]?.key !== key) cache[path] = { key, size: await measure(path) };
  return cache[path].size;
}

/** Nomes e bundle IDs dos apps abertos, em minúsculas. */
export async function runningApps() {
  const out = await run('/usr/bin/lsappinfo', ['list'], { timeout: 5000 }).catch(() => '');
  return [...out.matchAll(/^\s*\d+\) "([^"]+)"|bundleID="([^"]+)"/gm)].map((m) => (m[1] ?? m[2]).toLowerCase());
}

/**
 * A pasta de cache parece ser de um app aberto? Casa por bundle ID ou nome do fabricante.
 * ponytail: heurística por nome; pasta com nome genérico de app aberto fica protegida a mais, nunca a menos.
 * @param {string} folder @param {string[]} running
 */
export function ownerRunning(folder, running) {
  const key = folder.toLowerCase().replace(/software$/, '');
  return running.some((r) => r === key || r.startsWith(`${key}.`) || (key.length >= 4 && r.includes(key)));
}

/** /Users/x/pasta → ~/pasta @param {string} p */
export const tilde = (p) => (p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

/**
 * Preenche size (e freeable, quando conhecido) com du, e descarta itens vazios.
 * @param {import('../types.js').Item[]} items
 */
export async function measure(items) {
  const sizes = await du(items.flatMap((i) => (i.path && !i.size ? [i.path] : [])));
  for (const item of items) {
    if (item.path && !item.size) item.size = sizes.get(item.path) ?? 0;
    if (item.freeable !== null && !item.freeable) item.freeable = item.size;
  }
  return items.filter((i) => i.size > 0);
}
