// Desempenho: memória, processos e Docker ao vivo, as sugestões e a decisão das regras automáticas. Só lê; quem
// encerra processo ou para container é relief.js (S15). Sem electron: as contas puras são testadas em test/perf.test.js.
// Leve de propósito: memória (sysctl + vm_stat) custa milissegundos e ps uns 40 ms; o footprint (top) custa ~0,5 s de
// CPU e fica guardado 30 s; a lista de processos 9 s; Docker 15 s; o dono de cada máquina virtual (lsof) e a pasta de cada ferramenta, por pid.
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { msg } from '../shared/i18n.js';
import { exists, home, parseSize, run } from './sys.js';

/**
 * @typedef {import('../types.js').Memory} Memory
 * @typedef {import('../types.js').TrendPoint} TrendPoint
 * @typedef {import('../types.js').Proc} Proc
 * @typedef {import('../types.js').DevKind} DevKind
 * @typedef {import('../types.js').DevRow} DevRow
 * @typedef {import('../types.js').PerfGroup} PerfGroup
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').DockerState} DockerState
 * @typedef {import('../types.js').Suggestion} Suggestion
 * @typedef {import('../types.js').PerfPrefs} PerfPrefs
 * @typedef {import('../types.js').RuleId} RuleId
 * @typedef {import('../types.js').Trigger} Trigger
 * @typedef {import('../types.js').Msg} Msg
 * @typedef {{ me: number, self: Set<number>, protected: string[] }} Ctx
 * @typedef {{ id: string, name: string, kind: 'app' | 'cli', bundle?: string, procs: (Proc & { mem: number })[], protected: boolean }} Target
 * @typedef {{ memory: Memory, groups: PerfGroup[], dev: DevRow[], docker: DockerState, targets: Map<string, Target>, procs: Proc[] }} View
 */

// Saída do ps e do sysctl em inglês e com ponto decimal, seja qual for o idioma do Mac.
const C = { env: { LC_ALL: 'C' }, timeout: 10_000 };
const MIN = 60_000;
const WINDOW = 15 * MIN;
const PRESSURE = /** @type {Record<string, import('../types.js').Pressure>} */ ({ 1: 'normal', 2: 'warn', 4: 'critical' });
/** Executável do sistema (S16). Os apps de /System/Applications (Notas, TextEdit) são apps como os outros. */
export const SYSTEM = /^\/(?:System\/(?!Applications\/)|usr\/libexec\/|usr\/sbin\/|sbin\/|Library\/Apple\/)/;
const VM = 'com.apple.Virtualization.VirtualMachine';
/** Ferramenta de tarefa que termina: a única que o automático encerra quando fica órfã (S18). */
export const FINITE = new Set(['typecheck', 'lint', 'test', 'build', 'gate']);

// ---------- Memória ----------

/** vm_stat → tamanho da página e contagens por nome. @param {string} out */
export function parseVmStat(out) {
  const size = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
  /** @type {Record<string, number>} */
  const pages = {};
  for (const m of out.matchAll(/^"?([^:"\n]+)"?:\s+(\d+)\.?$/gm)) pages[m[1].trim()] = Number(m[2]);
  return { size, pages };
}

/** "total = 11264.00M  used = 10038.56M  free = …" (vírgula decimal também). @param {string} text */
export function parseSwap(text) {
  const mb = (/** @type {string} */ k) => Number(new RegExp(`${k} = ([\\d.,]+)M`).exec(text)?.[1].replace(',', '.') ?? 0) * 2 ** 20;
  return { total: mb('total'), used: mb('used') };
}

/**
 * `sysctl -n hw.memsize kern.memorystatus_vm_pressure_level vm.swapusage` + vm_stat → Memory.
 * Contas do Monitor de Atividade: apps = anônimas − purgáveis; em uso = apps + fixa + comprimida; cache = arquivos + purgáveis.
 * @param {string} sysctl @param {string} vmstat @param {number} [at] @returns {Memory}
 */
export function toMemory(sysctl, vmstat, at = Date.now()) {
  const [memsize = '0', level = '1', swap = ''] = sysctl.trim().split('\n');
  const { size, pages } = parseVmStat(vmstat);
  const p = (/** @type {string} */ k) => (pages[k] ?? 0) * size;
  const app = Math.max(0, p('Anonymous pages') - p('Pages purgeable'));
  const wired = p('Pages wired down');
  const compressed = p('Pages occupied by compressor');
  const s = parseSwap(swap);
  return { at, total: Number(memsize), used: app + wired + compressed, app, wired, compressed, cached: p('File-backed pages') + p('Pages purgeable'),
    swapUsed: s.used, swapTotal: s.total, pressure: PRESSURE[level.trim()] ?? 'normal' };
}

/** Nunca o CLI memory_pressure: ele aloca memória. */
export async function memory() {
  const [sys, vm] = await Promise.all([
    run('/usr/sbin/sysctl', ['-n', 'hw.memsize', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage'], C),
    run('/usr/bin/vm_stat', [], C),
  ]);
  return toMemory(sys, vm);
}

/** @type {TrendPoint[]} */
const trend = [];

/** Guarda a amostra na janela de 15 min (5 s com a página aberta, 30 s fora). @param {Memory} m */
export function remember(m) {
  if (trend.length && m.at - trend[trend.length - 1].at < 4000) trend.pop();
  trend.push({ at: m.at, used: m.used, swap: m.swapUsed, total: m.total, pressure: m.pressure });
  while (trend.length && trend[0].at < m.at - WINDOW) trend.shift();
}
export const points = () => trend;

/** O ponto bate com o gatilho da regra? @param {TrendPoint} p @param {Trigger} trigger */
const hit = (p, trigger) => (trigger === 'critical' ? p.pressure === 'critical' : trigger === 'warn' ? p.pressure !== 'normal' : p.swap > p.total / 2);

/**
 * O gatilho valeu em todas as amostras dos últimos `minutes` minutos, e há amostra cobrindo o começo da janela?
 * @param {TrendPoint[]} points @param {Trigger} trigger @param {number} minutes @param {number} now
 */
export function held(points, trigger, minutes, now) {
  const from = now - minutes * MIN;
  const inside = points.filter((p) => p.at >= from - 35_000 && p.at <= now);
  return inside.length > 0 && inside[0].at <= from + 35_000 && inside.every((p) => hit(p, trigger));
}

// ---------- Processos ----------

/** Linha de comando cortada: o que identifica o processo está no começo, e o resto só encarece as regex. */
const ARGS = 2000;
const PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(\S+)\s(.*)$/;

/** `LC_ALL=C ps -axo pid=,ppid=,uid=,rss=,pcpu=,lstart=,tty=,args=` → Proc[]. @param {string} out @returns {Proc[]} */
export function parsePs(out) {
  return out.split('\n').flatMap((line) => {
    const m = PS.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), rss: Number(m[4]) * 1024, cpu: Number(m[5]),
      start: Date.parse(m[6]), tty: m[7], args: m[8].trim().slice(0, ARGS) }] : [];
  });
}

export const processes = async () => parsePs(await run('/bin/ps', ['-axo', 'pid=,ppid=,uid=,rss=,pcpu=,lstart=,tty=,args='], C));

let listed = { at: 0, procs: /** @type {Promise<Proc[]>} */ (Promise.resolve([])) };
/** Lista para a tela, relida no máximo a cada 9 s (a memória e o gráfico seguem a cada 5 s). Quem encerra relê na hora. */
function recent() {
  if (Date.now() - listed.at > 9000) listed = { at: Date.now(), procs: processes() };
  return listed.procs;
}

/** `top -l 1 -stats pid,mem` → pid → footprint em bytes (a "Memória" do Monitor de Atividade). @param {string} out */
export function parseTop(out) {
  const unit = /** @type {Record<string, number>} */ ({ B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 });
  /** @type {Map<number, number>} */
  const map = new Map();
  for (const m of out.matchAll(/^(\d+)\s+([\d.]+)([BKMG])[+-]?\s*$/gm)) map.set(Number(m[1]), Number(m[2]) * unit[m[3]]);
  return map;
}

let foot = { at: 0, map: /** @type {Map<number, number>} */ (new Map()) };
/** O top custa ~0,5 s de CPU: footprint relido a cada 30 s. */
const FOOT_TTL = 30_000;
/** @type {Promise<Map<number, number>> | null} */
let reading = null;
/** Footprint de todos os processos, lido no máximo a cada 30 s; enquanto relê, vale o anterior. */
function footprints() {
  if (!reading && Date.now() - foot.at > FOOT_TTL) {
    reading = run('/usr/bin/top', ['-l', '1', '-stats', 'pid,mem'], C).then(parseTop, () => new Map())
      .then((map) => { foot = { at: Date.now(), map }; reading = null; return map; });
  }
  return foot.map.size || !reading ? Promise.resolve(foot.map) : reading;
}

/** Pacote .app mais de fora do executável ("/Applications/Google Chrome.app"), se houver. @param {string} args */
export const bundleOf = (args) => /^(\/(?:(?! -)[^])*?\.app)\//.exec(args)?.[1] ?? null;
/** Nome do executável ("node", "claude"); dentro de pacote o caminho pode ter espaço; shell de login vem como "-zsh". @param {string} args */
const exe = (args) => (/\.app\/Contents\/MacOS\/([^/]+?)(?=\s+-|$)/.exec(args)?.[1] ?? basename(args.split(' ')[0])).replace(/^-|:$/g, '');
/**
 * Nome que a pessoa reconhece: o último pacote do caminho ("Google Chrome Helper (Renderer)") ou o executável.
 * Sem regex de propósito: linha de comando enorme (o shell de uma sessão de agente) deixava a regex quadrática.
 * @param {string} args
 */
function procName(args) {
  const i = args.lastIndexOf('.app/Contents/MacOS/');
  return i < 0 ? exe(args) : args.slice(args.lastIndexOf('/', i) + 1, i);
}
/** Apps de verdade; pacote fora daqui (Chromium do Playwright, Claude Code embutido) conta como processo de terminal. */
const appDirs = (/** @type {string} */ h) => ['/Applications/', '/System/Applications/', `${h}/Applications/`];

/** Dono de uma máquina virtual pelos arquivos que ela abriu (disco do Docker, imagem dentro de um .app). @param {string} lsof */
export function vmOwner(lsof) {
  if (/Docker\.raw|com\.docker/.test(lsof)) return 'Docker';
  const files = lsof.split('\n').filter((l) => l.startsWith('n/') && !/^n\/(?:System|usr)\//.test(l));
  for (const f of files) {
    const m = /\/([^/]+)\.app\//.exec(f);
    if (m) return m[1];
  }
  return '';
}

/** @type {Map<number, Promise<string>>} */
const owners = new Map();
/** @param {number} pid */
function ownerOf(pid) {
  if (!owners.has(pid)) {
    owners.set(pid, run('/usr/sbin/lsof', ['-n', '-P', '-w', '-p', String(pid), '-F', 'n'], { timeout: 5000 })
      .catch((/** @type {any} */ e) => String(e?.stdout ?? '')).then(vmOwner));
  }
  return /** @type {Promise<string>} */ (owners.get(pid));
}

/**
 * Grupo do processo na aba Apps: o app (todos os processos do Chrome juntos), a máquina virtual atribuída ao dono,
 * o executável (node, python) ou "Sistema" (outro usuário, executável do sistema).
 * @param {Proc} p @param {number} me @param {string} [owner] dono, quando é máquina virtual @param {string} [h]
 * @returns {{ key: string, name: string, kind: PerfGroup['kind'], bundle?: string }}
 */
export function groupOf(p, me, owner = '', h = home) {
  if (p.uid !== me) return { key: 'system', name: '', kind: 'system' };
  if (p.args.includes(VM)) return { key: `vm:${owner}`, name: owner, kind: 'vm' };
  if (SYSTEM.test(p.args)) return { key: 'system', name: '', kind: 'system' };
  const bundle = bundleOf(p.args);
  if (bundle && appDirs(h).some((d) => bundle.startsWith(d))) return { key: `app:${bundle}`, name: basename(bundle, '.app'), kind: 'app', bundle };
  const name = bundle ? basename(bundle, '.app') : exe(p.args);
  return { key: `cli:${name}`, name, kind: 'cli' };
}

/** S16: outro usuário, pid 0/1, o próprio Respiro (e o que ele abriu) e executável do sistema nunca. @param {Proc} p @param {Ctx} ctx @returns {Msg | null} */
export function canEnd(p, ctx) {
  if (p.uid !== ctx.me) return msg('perf.refuse.otherUser');
  if (p.pid <= 1 || (SYSTEM.test(p.args) && !p.args.includes(VM))) return msg('perf.refuse.system');
  if (ctx.self.has(p.pid) || ctx.self.has(p.ppid)) return msg('perf.refuse.self');
  if (p.args.includes(VM)) return msg('perf.refuse.vm');
  return null;
}

/** Nome na lista de protegidos (sem diferenciar maiúsculas). @param {string[]} names @param {string[]} list */
export const isProtected = (names, list) => names.some((n) => n && list.some((x) => x.toLowerCase() === n.toLowerCase()));

// ---------- Ferramentas de desenvolvimento ----------

/** Ordem importa: navegador de teste antes de "--headless" casar com outra coisa; gate antes do typecheck que ele roda. */
const DEV = /** @type {[DevKind, RegExp][]} */ ([
  ['browser', /ms-playwright|chrome-headless-shell|--headless(?:=\w+)?(?:\s|$)|--enable-automation|--remote-debugging-pipe/],
  ['mcp', /[\w@./-]*mcp[\w.-]*/i],
  ['gate', /\S*(?:gate|final-review|check|verify)\.(?:sh|mjs|js|py)\b|\b(?:npm|pnpm) run verify\b|lint-staged|husky|\.claude\/hooks\/\S+/],
  ['typecheck', /\S*\b(?:tsc|tsgo|vue-tsc|tsserver|mypy|pyright)(?:\.js)?(?=\s|$)|\S*typecheck\S*/],
  ['test', /\S*\b(?:vitest|jest|mocha|pytest|cypress)(?=\s|$)|\bnode\s(?:\S+\s)*?--test(?=\s|$)|playwright\s+test/],
  ['lint', /\S*\b(?:eslint|biome|prettier|oxlint|stylelint)(?=\s|$)/],
  ['build', /\S*\b(?:webpack|esbuild|rollup|turbo|tsup|nx)(?=\s|$)|\b(?:vite|next|astro) build\b|electron-packager|@electron\/packager/],
  ['server', /\b(?:next|vite|astro|remix|wrangler) dev\b|\S*\bvite(?=\s|$)|nodemon|webpack serve|\b(?:npm|pnpm|yarn|bun) (?:run )?dev\b/],
]);

const LONG = /\b(?:tsserver|typescript-language-server|pyright-langserver|language-server|langserver)\b|(?:^|\s)(?:--watch|-w|watch|serve|dev|--stdio|--lsp)(?=\s|$)/;

/**
 * Tipo e nome da ferramenta de dev pela linha de comando; null quando não é uma.
 * @param {string} args @returns {{ kind: DevKind, name: string } | null}
 */
export function devKind(args) {
  for (const [kind, re] of DEV) {
    const m = re.exec(args);
    if (!m) continue;
    if (kind === 'browser') return { kind, name: procName(args) };
    const name = basename(m[0].trim().replace(/@[\w.^~-]+$/, '')).replace(/\.js$/, '');
    // Vigia (--watch), servidor e servidor de linguagem ficam rodando de propósito: nunca contam como tarefa (S18).
    return { kind: FINITE.has(kind) && LONG.test(args) ? 'server' : kind, name: kind === 'test' && name.startsWith('node') ? 'node --test' : name };
  }
  return null;
}

/** Anfitrião: quem tem alguém do outro lado (app, terminal, sessão de agente, multiplexador). */
/** O servidor do tmux aparece como "tmux: server (…)" e o do screen como "SCREEN". */
const HOSTS = /^(?:claude|codex|tmux|screen|zellij|sshd|nvim|vim|emacs)$/i;
/** @param {Proc} p */
export const isHost = (p) => Boolean(bundleOf(p.args)) || HOSTS.test(exe(p.args));

/**
 * Ferramenta de dev deste usuário: processo de terminal (não app instalado, não a sessão de agente, não do sistema)
 * cuja linha de comando casa com um tipo. A sessão do Claude cita "mcp" e "tsc" nos argumentos e não é ferramenta.
 * @param {Proc} p @param {number} me @param {string} [h]
 */
export function devOf(p, me, h = home) {
  if (p.uid !== me || SYSTEM.test(p.args) || HOSTS.test(exe(p.args))) return null;
  const bundle = bundleOf(p.args);
  if (bundle && appDirs(h).some((d) => bundle.startsWith(d))) return null;
  return devKind(p.args);
}

/**
 * Quem ainda espera pelo processo: o anfitrião na cadeia de pais; null = a cadeia chega ao launchd sem anfitrião
 * (órfão); undefined = a leitura não tem a cadeia inteira (na dúvida, não é órfão).
 * @param {Proc} p @param {Map<number, Proc>} byPid @returns {Proc | null | undefined}
 */
export function hostOf(p, byPid) {
  let cur = p;
  for (let n = 0; n < 64; n++) {
    if (cur.ppid <= 1) return null;
    const parent = byPid.get(cur.ppid);
    if (!parent) return undefined;
    if (isHost(parent)) return parent;
    cur = parent;
  }
  return undefined;
}

const MARKERS = new Set(['node_modules', 'src', 'scripts', 'test', 'tests', 'packages', 'apps', 'bin', 'dist', 'build', 'lib']);
/** Pasta do projeto a partir de um caminho dentro da pasta pessoal; caches (pastas ocultas) não contam. @param {string} path @param {string} [h] */
export function project(path, h = home) {
  if (!path.startsWith(`${h}/`)) return null;
  const parts = path.slice(h.length + 1).split('/').filter(Boolean);
  const cut = parts.findIndex((s) => MARKERS.has(s));
  const upto = cut === -1 ? parts : parts.slice(0, cut);
  if (!upto.length || upto[0] === 'Library' || upto.some((s) => s.startsWith('.'))) return null;
  return upto[upto.length - 1];
}

/** @type {Map<string, string>} */
const cwds = new Map();
const pkey = (/** @type {Proc} */ p) => `${p.pid}@${p.start}`;
/** Pasta de trabalho de cada ferramenta (um lsof para as novas; as já vistas ficam guardadas). @param {Proc[]} list */
async function readCwds(list) {
  if (cwds.size > 2000) cwds.clear();
  const missing = list.filter((p) => !cwds.has(pkey(p)));
  if (!missing.length) return;
  const out = await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', missing.map((p) => p.pid).join(','), '-F', 'n'], { timeout: 5000 })
    .catch((/** @type {any} */ e) => String(e?.stdout ?? ''));
  /** @type {Map<number, string>} */
  const got = new Map();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n')) got.set(pid, line.slice(1));
  }
  for (const p of missing) cwds.set(pkey(p), got.get(p.pid) ?? '');
}

/** Ferramentas de tarefa vistas na última hora (para "tsc rodou 12 vezes"). @type {Map<string, { name: string, at: number, peak: number }>} */
const seen = new Map();

/**
 * Ferramentas de dev: cada processo de dev cujo pai não é de dev vira uma raiz que leva a subárvore inteira;
 * raízes do mesmo tipo, nome e situação (órfã ou não) viram uma linha.
 * @param {(Proc & { mem: number })[]} procs @param {Ctx} ctx @param {(p: Proc) => string} cwdOf @param {string} [h]
 * @returns {{ rows: DevRow[], targets: Map<string, Target> }}
 */
export function devRows(procs, ctx, cwdOf = () => '', h = home) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  /** @type {Map<number, (Proc & { mem: number })[]>} */
  const kids = new Map();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const kinds = new Map(procs.flatMap((p) => { const k = devOf(p, ctx.me, h); return k ? [[p.pid, k]] : []; }));
  /** @type {Map<string, DevRow>} */
  const rows = new Map();
  /** @type {Map<string, Target>} */
  const targets = new Map();
  for (const [pid, k] of kinds) {
    const root = /** @type {Proc & { mem: number }} */ (byPid.get(pid));
    if (kinds.has(root.ppid)) continue;
    const tree = [root];
    for (let i = 0; i < tree.length; i++) tree.push(...(kids.get(tree[i].pid) ?? []));
    const host = hostOf(root, byPid);
    const orphan = host === null;
    const id = `dev:${k.kind}:${k.name}:${orphan ? 1 : 0}`;
    const where = project(cwdOf(root), h) ?? project(new RegExp(`${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\S+`).exec(root.args)?.[0] ?? '', h);
    const row = rows.get(id) ?? { id, kind: k.kind, name: k.name, count: 0, projects: [], since: root.start, mem: 0, cpu: 0, orphan,
      protected: isProtected([k.name, exe(root.args)], ctx.protected), host: host ? procName(host.args) : null };
    row.count += 1;
    row.since = Math.min(row.since, root.start);
    row.mem += tree.reduce((s, p) => s + p.mem, 0);
    row.cpu += tree.reduce((s, p) => s + p.cpu, 0);
    if (where && !row.projects.includes(where)) row.projects.push(where);
    rows.set(id, row);
    const target = targets.get(id) ?? { id, name: k.name, kind: 'cli', procs: [], protected: row.protected };
    target.procs.push(...tree);
    targets.set(id, target);
    if (FINITE.has(k.kind)) seen.set(pkey(root), { name: k.name, at: root.start, peak: Math.max(seen.get(pkey(root))?.peak ?? 0, root.mem) });
  }
  for (const [key, s] of seen) if (s.at < Date.now() - 60 * MIN) seen.delete(key);
  return { rows: [...rows.values()].sort((a, b) => b.mem - a.mem), targets };
}

// ---------- Docker ----------

/** `docker stats --no-stream --format {{json .}}` → memória e CPU por id. @param {string} out */
export function parseStats(out) {
  return out.split('\n').flatMap((line) => {
    try {
      const s = JSON.parse(line);
      return [{ id: String(s.ID), name: String(s.Name), mem: parseSize(String(s.MemUsage).split('/')[0], 1024), cpu: Number.parseFloat(s.CPUPerc) || 0 }];
    } catch { return []; }
  });
}

/** Memória configurada no settings-store.json do Docker Desktop (MiB); null = padrão. @param {Record<string, unknown>} json */
export function dockerLimit(json) {
  const key = Object.keys(json).find((k) => k.toLowerCase() === 'memorymib');
  const mib = key ? Number(json[key]) : 0;
  return mib > 0 ? mib * 2 ** 20 : null;
}

const SETTINGS = join(home, 'Library/Group Containers/group.com.docker/settings-store.json');
/** @type {Map<string, number>} id → desde quando está com CPU abaixo de 1 % */
const idle = new Map();
let dock = { at: 0, value: /** @type {Omit<DockerState, 'vm' | 'appId'> | null} */ (null) };

/**
 * Docker Desktop: fechado não custa nada (só olha os processos e o arquivo de ajustes); aberto, info + stats + ps
 * guardados por `ttl`. Container ocioso = CPU abaixo de 1 % em todas as leituras desde `idleSince`.
 * @param {Proc[]} procs @param {number} [ttl] @returns {Promise<Omit<DockerState, 'vm' | 'appId'>>}
 */
async function docker(procs, ttl = 15_000) {
  const running = procs.some((p) => p.args.startsWith('/Applications/Docker.app/'));
  if (dock.value && dock.value.running === running && Date.now() - dock.at < ttl) return dock.value;
  const installed = running || await exists('/Applications/Docker.app');
  let limit = await readFile(SETTINGS, 'utf8').then((s) => dockerLimit(JSON.parse(s)), () => null);
  /** @type {Omit<Container, 'protected'>[]} */
  let containers = [];
  if (running) {
    const opts = { timeout: 8000 };
    const [info, stats, ps] = await Promise.all([
      run('docker', ['info', '--format', '{{json .MemTotal}}'], opts).catch(() => ''),
      run('docker', ['stats', '--no-stream', '--format', '{{json .}}'], opts).catch(() => ''),
      run('docker', ['ps', '--format', '{{json .}}'], opts).catch(() => ''),
    ]);
    limit = Number(info) || limit;
    const images = new Map(ps.split('\n').flatMap((l) => { try { const c = JSON.parse(l); return [[String(c.ID), String(c.Image)]]; } catch { return []; } }));
    const now = Date.now();
    containers = parseStats(stats).map((s) => {
      if (s.cpu < 1) idle.set(s.id, idle.get(s.id) ?? now);
      else idle.delete(s.id);
      const short = s.id.slice(0, 12);
      return { ...s, image: images.get(short) ?? images.get(s.id) ?? '', idleSince: idle.get(s.id) ?? null };
    });
    for (const id of idle.keys()) if (!containers.some((c) => c.id === id)) idle.delete(id);
  }
  const value = { installed, running, limit, containers: /** @type {Container[]} */ (containers) };
  dock = { at: Date.now(), value };
  return value;
}

/** Container da última leitura (para o relief conferir antes de parar). @param {string} id */
export const containerSeen = (id) => dock.value?.containers.find((c) => c.id === id) ?? null;

// ---------- Leitura completa ----------

/**
 * Memória, processos agrupados, ferramentas de dev e Docker numa leitura. `foot: false` (segundo plano) usa o RSS e
 * não roda o top; `docker: false` não olha o Docker.
 * @param {Ctx} ctx @param {{ foot?: boolean, docker?: boolean, dockerTtl?: number }} [o] @returns {Promise<View>}
 */
export async function collect(ctx, { foot = true, docker: withDocker = true, dockerTtl } = {}) {
  const [mem, procs, prints] = await Promise.all([memory(), foot ? recent() : processes(), foot ? footprints() : Promise.resolve(new Map())]);
  remember(mem);
  const sized = procs.map((p) => ({ ...p, mem: prints.get(p.pid) ?? p.rss }));
  const vms = sized.filter((p) => p.uid === ctx.me && p.args.includes(VM));
  for (const pid of owners.keys()) if (!vms.some((p) => p.pid === pid)) owners.delete(pid);
  const vmOwners = new Map(await Promise.all(vms.map(async (p) => /** @type {const} */ ([p.pid, await ownerOf(p.pid)]))));

  /** @type {Map<string, PerfGroup & { procs: (Proc & { mem: number })[], bundle?: string }>} */
  const groups = new Map();
  for (const p of sized) {
    const g = groupOf(p, ctx.me, vmOwners.get(p.pid));
    const group = groups.get(g.key) ?? { id: g.key, name: g.name, kind: g.kind, bundle: g.bundle, count: 0, mem: 0, cpu: 0, exact: true,
      protected: g.kind !== 'system' && isProtected([g.name], ctx.protected), endable: false, top: [], procs: [] };
    group.count += 1;
    group.mem += p.mem;
    group.cpu += p.cpu;
    group.exact &&= prints.has(p.pid);
    group.procs.push(p);
    groups.set(g.key, group);
  }
  /** @type {Map<string, Target>} */
  const targets = new Map();
  const list = [...groups.values()].sort((a, b) => (a.kind === 'system' ? 1 : 0) - (b.kind === 'system' ? 1 : 0) || b.mem - a.mem).map(({ procs: ps, bundle, ...g }) => {
    const endable = (g.kind === 'app' || g.kind === 'cli') && ps.every((p) => !canEnd(p, ctx));
    if (endable) targets.set(g.id, { id: g.id, name: g.name, kind: /** @type {'app' | 'cli'} */ (g.kind), bundle, procs: ps, protected: g.protected });
    const top = [...ps].sort((a, b) => b.mem - a.mem).slice(0, 10).map((p) => ({ pid: p.pid, name: procName(p.args), mem: p.mem, cpu: p.cpu }));
    return { ...g, endable, top };
  });

  const byPid = new Map(sized.map((p) => [p.pid, p]));
  const roots = sized.filter((p) => devOf(p, ctx.me) && !(byPid.has(p.ppid) && devOf(/** @type {Proc} */ (byPid.get(p.ppid)), ctx.me)));
  await readCwds(roots);
  const dev = devRows(sized, ctx, (p) => cwds.get(pkey(p)) ?? '');
  for (const [id, t] of dev.targets) if (t.procs.every((p) => !canEnd(p, ctx))) targets.set(id, t);

  const d = withDocker ? await docker(procs, dockerTtl) : { installed: false, running: false, limit: null, containers: [] };
  const dockerState = {
    ...d,
    containers: d.containers.map((c) => ({ ...c, protected: isProtected([c.name], ctx.protected) })),
    vm: list.find((g) => g.id === 'vm:Docker')?.mem ?? null,
    appId: targets.has('app:/Applications/Docker.app') ? 'app:/Applications/Docker.app' : null,
  };
  return { memory: mem, groups: list.slice(0, 60), dev: dev.rows, docker: dockerState, targets, procs: sized };
}

/** O que cada id da tela encerra, da última leitura que a tela viu (o renderer só manda ids, S4). @type {Map<string, Target>} */
let index = new Map();
/** @param {string} id */
export const lookup = (id) => index.get(id) ?? null;

/** Leitura para a página: a leitura completa, sugestões e dicas; os ids viram o índice das ações. @param {Ctx} ctx */
export async function snapshot(ctx) {
  const view = await collect(ctx);
  index = view.targets;
  const now = Date.now();
  return { memory: view.memory, trend: [...trend], groups: view.groups, dev: view.dev, docker: view.docker,
    suggestions: suggest(view, now), tips: tips(view, now) };
}

// ---------- Sugestões ----------

/** "3 typechecks órfãos" / "2 ferramentas de dev órfãs": o tipo, se todas forem do mesmo. @param {DevRow[]} rows @param {number} n */
const what = (rows, n) => msg(new Set(rows.map((r) => r.kind)).size === 1 ? `perf.what.${rows[0].kind}` : 'perf.what.dev', { n });
const sum = (/** @type {number[]} */ xs) => xs.reduce((s, x) => s + x, 0);

/**
 * Até 3 sugestões que resolvem agora, a de mais memória primeiro: ferramentas órfãs, tarefa presa há mais de 20 min,
 * containers ociosos.
 * @param {Pick<View, 'dev' | 'docker'>} view @param {number} now @returns {Suggestion[]}
 */
export function suggest({ dev, docker: d }, now) {
  /** @type {Suggestion[]} */
  const out = [];
  /** @param {string} id @param {DevRow[]} rows @param {string} key */
  const lost = (id, rows, key) => {
    if (!rows.length) return;
    const n = sum(rows.map((r) => r.count));
    const bytes = sum(rows.map((r) => r.mem));
    out.push({ id, text: msg(key, { n, what: what(rows, n), since: Math.min(...rows.map((r) => r.since)), bytes }),
      action: { kind: 'end', ids: rows.map((r) => r.id), label: msg('perf.endN', { n }), bytes } });
  };
  lost('orphans', dev.filter((r) => r.orphan && FINITE.has(r.kind)), 'perf.sug.orphans');
  lost('strays', dev.filter((r) => r.orphan && !FINITE.has(r.kind)), 'perf.sug.orphans');
  for (const r of dev.filter((x) => !x.orphan && FINITE.has(x.kind) && now - x.since > 20 * MIN)) {
    out.push({ id: `long:${r.id}`, text: msg('perf.sug.long', { name: r.name, since: r.since, bytes: r.mem }),
      action: { kind: 'end', ids: [r.id], label: msg('perf.end'), bytes: r.mem } });
  }
  const quiet = d.containers.filter((c) => c.idleSince !== null && now - c.idleSince > 15 * MIN);
  if (quiet.length) {
    const bytes = sum(quiet.map((c) => c.mem));
    out.push({ id: 'containers', text: msg('perf.sug.containers', { n: quiet.length, since: Math.min(...quiet.map((c) => /** @type {number} */ (c.idleSince))), bytes }),
      action: { kind: 'stop', ids: quiet.map((c) => c.id), label: msg('perf.stopN', { n: quiet.length }), bytes } });
  }
  return out.sort((a, b) => (b.action?.bytes ?? 0) - (a.action?.bytes ?? 0)).slice(0, 3);
}

/**
 * Ajustes na origem, só com o que foi medido: limite do Docker, sessões e servidores MCP repetidos, `npm exec` que fica
 * na memória, typecheck que roda muitas vezes, máquina virtual de app.
 * @param {Pick<View, 'dev' | 'docker' | 'groups' | 'procs' | 'memory'>} view @param {number} now @returns {Suggestion[]}
 */
export function tips({ dev, docker: d, groups, procs, memory: m }, now) {
  /** @type {Suggestion[]} */
  const out = [];
  const limit = d.limit ?? m.total / 2;
  if (d.installed && limit > Math.max(4e9, m.total * 0.4)) {
    out.push({ id: 'docker', text: msg('perf.tip.docker', { limit, total: m.total }), how: msg('perf.tip.dockerHow'),
      action: { kind: 'open-docker', ids: [], label: msg('perf.openDocker'), bytes: 0 } });
  }
  // Sessão = processo do Claude Code cujo pai não é outro (os de dentro de uma sessão contam uma vez).
  const agents = procs.filter((p) => exe(p.args) === 'claude');
  const sessions = agents.filter((p) => !agents.some((q) => q.pid === p.ppid)).length;
  const mcp = dev.filter((r) => r.kind === 'mcp');
  const servers = sum(mcp.map((r) => r.count));
  // Repetido de verdade: o mesmo servidor aberto mais de uma vez.
  if (sessions >= 2 && mcp.some((r) => r.count >= 2)) {
    out.push({ id: 'mcp', text: msg('perf.tip.mcp', { sessions, servers, bytes: sum(mcp.map((r) => r.mem)) }), how: msg('perf.tip.mcpHow') });
  }
  const wrappers = procs.filter((p) => /^npm exec\b/.test(p.args));
  if (wrappers.length >= 3) {
    out.push({ id: 'npx', text: msg('perf.tip.npx', { n: wrappers.length, bytes: sum(wrappers.map((p) => p.mem ?? p.rss)) }), how: msg('perf.tip.npxHow') });
  }
  /** @type {Map<string, { n: number, peak: number }>} */
  const runs = new Map();
  for (const s of seen.values()) if (s.at >= now - 60 * MIN) runs.set(s.name, { n: (runs.get(s.name)?.n ?? 0) + 1, peak: Math.max(runs.get(s.name)?.peak ?? 0, s.peak) });
  for (const [name, r] of runs) if (r.n >= 6) out.push({ id: `runs:${name}`, text: msg('perf.tip.runs', { name, n: r.n, peak: r.peak }), how: msg('perf.tip.runsHow') });
  for (const g of groups.filter((x) => x.kind === 'vm' && x.name && x.name !== 'Docker' && x.mem >= 1e9)) {
    out.push({ id: `vm:${g.name}`, text: msg('perf.tip.vm', { name: g.name, bytes: g.mem }) });
  }
  return out;
}

// ---------- Regras automáticas ----------

/**
 * O que as regras ligadas pedem agora (S18). Pura: quem age é o watch.js com o relief.js. Cada regra dispara no máximo
 * uma vez a cada 30 min. Só age em ferramenta de tarefa órfã e em container ocioso fora dos protegidos; o resto vira aviso.
 * @param {PerfPrefs} prefs @param {TrendPoint[]} trend @param {Pick<View, 'dev' | 'docker'>} view
 * @param {Partial<Record<RuleId, number>>} last quando cada regra disparou @param {number} now
 * @returns {{ rule: RuleId, act: string[], notify: Msg | null, why: Msg }[]}
 */
export function decide(prefs, trend, view, last, now) {
  if (!prefs.auto) return [];
  /** @type {{ rule: RuleId, act: string[], notify: Msg | null, why: Msg }[]} */
  const out = [];
  const { alert, orphans, containers } = prefs.rules;
  const ready = (/** @type {RuleId} */ id) => now - (last[id] ?? 0) >= 30 * MIN;
  const why = (/** @type {import('../types.js').Rule} */ r) => msg(`perf.why.${r.trigger}`, { minutes: r.minutes });
  if (alert.on && ready('alert') && held(trend, alert.trigger, alert.minutes, now)) {
    out.push({ rule: 'alert', act: [], notify: msg('perf.notify.alert'), why: why(alert) });
  }
  if (orphans.on && ready('orphans') && held(trend, orphans.trigger, orphans.minutes, now)) {
    const lost = view.dev.filter((r) => r.orphan && !r.protected);
    const act = orphans.mode === 'act' ? lost.filter((r) => FINITE.has(r.kind)) : [];
    const rest = lost.filter((r) => !act.includes(r));
    const n = sum(rest.map((r) => r.count));
    if (act.length || rest.length) {
      out.push({ rule: 'orphans', act: act.map((r) => r.id), why: why(orphans),
        notify: rest.length ? msg('perf.sug.orphans', { n, what: what(rest, n), since: Math.min(...rest.map((r) => r.since)), bytes: sum(rest.map((r) => r.mem)) }) : null });
    }
  }
  if (containers.on && ready('containers')) {
    const quiet = view.docker.containers.filter((c) => !c.protected && c.idleSince !== null && now - c.idleSince >= containers.minutes * MIN);
    if (quiet.length) {
      out.push({ rule: 'containers', act: containers.mode === 'act' ? quiet.map((c) => c.id) : [], why: msg('perf.why.idle', { minutes: containers.minutes }),
        notify: containers.mode === 'act' ? null : msg('perf.sug.containers', { n: quiet.length, since: Math.min(...quiet.map((c) => /** @type {number} */ (c.idleSince))), bytes: sum(quiet.map((c) => c.mem)) }) });
    }
  }
  return out;
}
