// pnpm, npm, yarn, bun, pip, uv, Go, Cargo, Gradle, Maven, CocoaPods e pub.
// Comando oficial sempre que a CLI existe; Lixeira quando a ferramenta não tem comando ou não está instalada.
import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { cachedSize, exists, has, home, measure, run, size, tilde } from '../sys.js';

export const id = 'packages';

/** @param {string} cmd @param {string[]} args */
const ask = (cmd, args) => run(cmd, args, { timeout: 15_000 }).then((out) => out.trim(), () => '');

/** @param {import('../../types.js').ScanContext} ctx */
export async function scan(ctx) {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  const [pnpm, npm, yarn, bun, pip] = await Promise.all(['pnpm', 'npm', 'yarn', 'bun', 'pip3'].map(has));

  if (pnpm) {
    const [store, meta] = await Promise.all([ask('pnpm', ['store', 'path']), ask('pnpm', ['cache', 'path'])]);
    if (store) {
      items.push({
        id: 'pnpm-store', name: msg('name.pnpmStore'), detail: tilde(store), path: store, size: 0, freeable: null, safe: true,
        note: msg('note.pnpmStore'),
        action: { kind: 'cmd', key: 'pnpm-prune' },
      });
      // Formatos de store de versões anteriores do pnpm (v3, v10…), que o pnpm atual não lê.
      for (const v of await readdir(dirname(store)).catch(() => [])) {
        const path = join(dirname(store), v);
        if (/^v\d+$/.test(v) && path !== store) {
          items.push({
            // Projetos que fixam a versão antiga do pnpm clonam deste store: o ganho real só aparece depois.
            id: `pnpm-store-${v}`, name: msg('name.pnpmOld', { v }), detail: tilde(path), path, size: 0, freeable: null, safe: false,
            note: msg('note.pnpmOld'),
            action: { kind: 'trash', path },
          });
        }
      }
    }
    if (meta) {
      items.push({ id: 'pnpm-meta', name: msg('name.pnpmMeta'), detail: tilde(meta), path: meta, size: 0, freeable: 0, safe: true,
        action: { kind: 'trash', path: meta } });
    }
  }

  if (npm) {
    const cache = await ask('npm', ['config', 'get', 'cache']);
    if (cache) {
      const path = join(cache, '_cacache');
      items.push({ id: 'npm', name: 'npm', detail: tilde(path), path, size: 0, freeable: 0, safe: true,
        action: { kind: 'cmd', key: 'npm-clean' } });
    }
  }

  if (yarn && (await ask('yarn', ['--version'])).startsWith('1.')) {
    const path = await ask('yarn', ['cache', 'dir']);
    if (path) items.push({ id: 'yarn', name: 'Yarn', detail: tilde(path), path, size: 0, freeable: 0, safe: true, action: { kind: 'cmd', key: 'yarn-clean' } });
  }

  const bunCache = process.env.BUN_INSTALL_CACHE_DIR || join(home, '.bun/install/cache');
  if (await exists(bunCache)) {
    // O bun clona do cache para os node_modules (APFS): apagar o cache devolve menos que o du mostra.
    items.push({ id: 'bun', name: 'Bun', detail: tilde(bunCache), path: bunCache, size: 0, freeable: null, safe: true, note: msg('note.sharedCache'),
      action: bun ? { kind: 'cmd', key: 'bun-clean' } : { kind: 'trash', path: bunCache } });
  }

  const pipCache = pip ? await ask('pip3', ['cache', 'dir']) : join(home, 'Library/Caches/pip');
  if (pipCache && await exists(pipCache)) {
    items.push({ id: 'pip', name: 'pip', detail: tilde(pipCache), path: pipCache, size: 0, freeable: 0, safe: true,
      action: pip ? { kind: 'cmd', key: 'pip-purge' } : { kind: 'trash', path: pipCache } });
  }

  items.push(...(await otherTools()));

  if (!items.length) return null;
  // O store do pnpm é o maior e só muda quando ganha ou perde pacote: reaproveita a medição anterior.
  // uv cache size é ~4x mais rápido que o du em caches com milhões de arquivos.
  const uvSize = (/** @type {string} */ p) => run('uv', ['cache', 'size'], { timeout: 120_000 }).then((o) => Number(o.trim()) || size(p), () => size(p));
  await Promise.all(items.filter((i) => i.id.startsWith('pnpm-store') || i.id === 'uv').map(async (i) => {
    // O uv regrava metadados a cada uso: a impressão digital muda sem o tamanho mudar. Remede a cada 6 h.
    i.size = await cachedSize(/** @type {string} */ (i.path), ctx.sizeCache, i.id === 'uv' ? uvSize : undefined, i.id === 'uv' ? 6 * 3_600_000 : 0);
  }));
  return { items: await measure(items) };
}

/**
 * Quem segura a trava do cache do uv (uvx e uv run abertos, como servidores MCP). Com algum aberto,
 * `uv cache prune` espera para sempre. Devolve nomes legíveis: o pacote do uvx ou a pasta do projeto.
 * @param {string} cache
 */
export async function uvHolders(cache) {
  const pids = (await run('/usr/sbin/lsof', ['-t', join(cache, '.lock')], { timeout: 5000 }).catch(() => '')).trim().split('\n').filter((p) => /^\d+$/.test(p));
  if (!pids.length) return [];
  const lines = (await run('/bin/ps', ['-o', 'args=', '-p', pids.join(',')], { timeout: 5000 }).catch(() => '')).trim().split('\n');
  return [...new Set(lines.filter(Boolean).map(uvProcessName))];
}

/** "uv tool uvx code-review-graph serve" → code-review-graph; "uv --directory ~/x/srv run main.py" → srv. @param {string} args */
export function uvProcessName(args) {
  const words = args.trim().split(/\s+/);
  const uvx = words.indexOf('uvx');
  if (uvx >= 0 && words[uvx + 1]) return words[uvx + 1];
  const dir = words.indexOf('--directory');
  if (dir >= 0 && words[dir + 1]) return basename(words[dir + 1]);
  return 'uv';
}

/** Ecossistemas além do JavaScript. Cada um só aparece se a pasta existir. */
async function otherTools() {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  /** @param {Omit<import('../../types.js').Item, 'size' | 'freeable' | 'safe'> & Partial<import('../../types.js').Item>} item */
  const add = async (item) => {
    if (item.path && await exists(item.path)) items.push({ size: 0, freeable: 0, safe: true, ...item });
  };
  const [uv, go, pod, dart] = await Promise.all(['uv', 'go', 'pod', 'dart'].map(has));

  // uv: "nunca é seguro mexer na pasta direto" (docs da Astral). prune tira só o que nada mais alcança.
  const uvDir = uv ? await ask('uv', ['cache', 'dir']) : join(home, '.cache/uv');
  const holders = await uvHolders(uvDir);
  await add({ id: 'uv', name: 'uv', detail: tilde(uvDir), path: uvDir, freeable: null, safe: !holders.length, inUse: holders.length > 0,
    note: holders.length ? msg('note.uvBusy', { names: holders.join(', ') }) : msg('note.uvPrune'),
    action: uv ? { kind: 'cmd', key: 'uv-prune' } : { kind: 'trash', path: uvDir } });

  // Go: o cache de módulos é só leitura; só o próprio go consegue apagar.
  if (go) {
    const [mod, build] = (await ask('go', ['env', 'GOMODCACHE', 'GOCACHE'])).split('\n');
    if (mod) await add({ id: 'go-mod', name: msg('name.goModules'), detail: tilde(mod), path: mod, action: { kind: 'cmd', key: 'go-clean-modcache' } });
    if (build) await add({ id: 'go-build', name: msg('name.goBuild'), detail: tilde(build), path: build, action: { kind: 'cmd', key: 'go-clean-cache' } });
  }

  // Cargo: sem comando estável para o cache global; downloads e fontes voltam no próximo build.
  for (const [id, rel, key] of [['cargo-cache', 'registry/cache', 'name.cargoCache'], ['cargo-src', 'registry/src', 'name.cargoSrc'], ['cargo-git', 'git/checkouts', 'name.cargoGit']]) {
    const path = join(home, '.cargo', rel);
    await add({ id, name: msg(key), detail: tilde(path), path, action: { kind: 'trash', path } });
  }

  // Gradle: sem comando de limpeza; com daemon rodando, a pasta está em uso.
  const daemon = await run('/usr/bin/pgrep', ['-f', 'GradleDaemon'], { timeout: 5000 }).then(() => true, () => false);
  const gradleCaches = join(home, '.gradle/caches');
  await add({ id: 'gradle-caches', name: msg('name.gradleCaches'), detail: tilde(gradleCaches), path: gradleCaches, safe: !daemon, inUse: daemon,
    note: daemon ? msg('note.gradleRunning') : undefined, action: { kind: 'trash', path: gradleCaches } });
  const gradleDists = join(home, '.gradle/wrapper/dists');
  await add({ id: 'gradle-dists', name: msg('name.gradleDists'), detail: tilde(gradleDists), path: gradleDists, safe: false,
    note: msg('note.gradleDists'), action: { kind: 'trash', path: gradleDists } });

  // Maven: pode guardar artefato instalado localmente que nunca foi publicado.
  const m2 = join(home, '.m2/repository');
  await add({ id: 'maven', name: 'Maven', detail: tilde(m2), path: m2, safe: false, note: msg('note.maven'), action: { kind: 'trash', path: m2 } });

  const pods = join(home, 'Library/Caches/CocoaPods');
  await add({ id: 'cocoapods', name: 'CocoaPods', detail: tilde(pods), path: pods,
    action: pod ? { kind: 'cmd', key: 'pod-cache-clean' } : { kind: 'trash', path: pods } });

  const pub = join(home, '.pub-cache');
  await add({ id: 'pub', name: msg('name.pub'), detail: tilde(pub), path: pub, note: msg('note.pubGet'),
    action: dart ? { kind: 'cmd', key: 'dart-pub-cache-clean' } : { kind: 'trash', path: pub } });
  return items;
}
