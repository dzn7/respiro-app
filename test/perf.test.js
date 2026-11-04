// Desempenho: contas da memória, leitura do ps e do top, grupos por app, ferramentas de dev e órfãos, a regra S16,
// as regras automáticas (S18), as sugestões, e o relief encerrando de verdade um processo filho deste teste.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { DICTS } from '../src/shared/i18n.js';
import { perfDefaults, perfPrefs } from '../src/shared/perf.js';
import {
  canEnd, decide, devKind, devRows, dockerLimit, groupOf, held, parsePs, parseStats, parseTop, processes, project, suggest, tips, toMemory, vmOwner,
} from '../src/main/perf.js';
import { endTargets } from '../src/main/relief.js';

const H = '/Users/ana';
const ME = 501;
const NOW = Date.parse('2026-11-04T15:00:00');
const MIN = 60_000;
const ctx = { me: ME, self: new Set([9000]), protected: ['Visual Studio Code', 'Claude'] };
/** @param {number} pid @param {number} ppid @param {string} args @param {Partial<import('../src/types.js').Proc>} [o] */
const P = (pid, ppid, args, o = {}) => ({ pid, ppid, uid: ME, start: NOW - 40 * MIN, cpu: 0, rss: 1e8, tty: '??', args, mem: 1e8, ...o });
/** Toda frase que sai do main existe no dicionário. @param {import('../src/types.js').Msg | null | undefined} m */
const known = (m) => { if (m) assert.ok(m.key in DICTS['pt-BR'], `chave sem texto: ${m.key}`); };

// Saída real do Mac do QA (16 GB, 10 GB de swap com pressão "normal").
const SYSCTL = '17179869184\n1\ntotal = 11264.00M  used = 10038.56M  free = 1225.44M  (encrypted)\n';
const VMSTAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              168973.
Pages active:                            305012.
Pages wired down:                        157483.
Pages purgeable:                           5236.
"Translation faults":                3297795529.
File-backed pages:                       170955.
Anonymous pages:                         438778.
Pages occupied by compressor:             72825.
Swapouts:                             102273449.
`;

test('memória com as contas do Monitor de Atividade', () => {
  const m = toMemory(SYSCTL, VMSTAT, NOW);
  const page = 16384;
  assert.equal(m.total, 17179869184);
  assert.equal(m.app, (438778 - 5236) * page);
  assert.equal(m.used, (438778 - 5236 + 157483 + 72825) * page);
  assert.equal(m.cached, (170955 + 5236) * page);
  assert.equal(m.swapUsed, 10038.56 * 2 ** 20);
  assert.equal(m.pressure, 'normal');
  assert.equal(toMemory('1\n4\ntotal = 0,00M  used = 1,50M\n', VMSTAT).pressure, 'critical');
  assert.equal(toMemory('1\n4\ntotal = 0,00M  used = 1,50M\n', VMSTAT).swapUsed, 1.5 * 2 ** 20);
  assert.equal(toMemory('1\n2\n', VMSTAT).pressure, 'warn');
});

test('ps e top: caminho com espaço, início exato, footprint com unidade', () => {
  const ps = parsePs([
    '  1101     1   501 224512   3.0 Tue Nov  3 13:49:00 2026     ??       /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag',
    ' 35600 35599   501  58912   0.0 Wed Nov  4 14:04:59 2026     ttys004  node --test a.test.js',
    'lixo',
  ].join('\n'));
  assert.equal(ps.length, 2);
  assert.equal(ps[0].args, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag');
  assert.equal(ps[0].rss, 224512 * 1024);
  assert.equal(ps[1].start, new Date(2026, 10, 4, 14, 4, 59).getTime());
  assert.equal(ps[1].tty, 'ttys004');
  const top = parseTop('Processes: 522 total\n\nPID    MEM\n32522  1780M\n164    599M+\n57     12K-\n9      3G\n');
  assert.equal(top.get(32522), 1780 * 1024 ** 2);
  assert.equal(top.get(164), 599 * 1024 ** 2);
  assert.equal(top.get(57), 12 * 1024);
  assert.equal(top.get(9), 3 * 1024 ** 3);
});

test('grupos: app inteiro junto, máquina virtual no dono, sistema e outro usuário sem ação', () => {
  const g = (/** @type {string} */ args, o = {}, owner = '') => groupOf(P(1, 1, args, o), ME, owner, H);
  assert.deepEqual(g('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer'),
    { key: 'app:/Applications/Google Chrome.app', name: 'Google Chrome', kind: 'app', bundle: '/Applications/Google Chrome.app' });
  assert.equal(g('/System/Applications/TextEdit.app/Contents/MacOS/TextEdit').kind, 'app');
  assert.equal(g(`${H}/Library/Caches/ms-playwright/chromium-1/chrome-mac/Chromium.app/Contents/MacOS/Chromium --headless`).key, 'cli:Chromium');
  assert.equal(g('/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine', {}, 'Claude').key, 'vm:Claude');
  assert.equal(g('/usr/libexec/trustd').kind, 'system');
  assert.equal(g('/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder').kind, 'system');
  assert.equal(g('/opt/homebrew/bin/node x.js', { uid: 0 }).kind, 'system');
  assert.equal(g('node /x/n8n-mcp').key, 'cli:node');
  assert.equal(vmOwner('p1\nn/System/Library/CoreServices/SystemVersion.bundle\nn/Applications/Claude.app/Contents/Resources/smol-bin.arm64.img\n'), 'Claude');
  assert.equal(vmOwner(`n${H}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw\n`), 'Docker');
});

test('S16: nunca outro usuário, sistema, o próprio Respiro nem máquina virtual', () => {
  const key = (/** @type {import('../src/types.js').Proc} */ p) => canEnd(p, ctx)?.key ?? null;
  assert.equal(key(P(500, 1, 'node x', { uid: 0 })), 'perf.refuse.otherUser');
  assert.equal(key(P(1, 0, '/sbin/launchd')), 'perf.refuse.system');
  assert.equal(key(P(77, 1, '/usr/libexec/trustd')), 'perf.refuse.system');
  assert.equal(key(P(9000, 1, '/Applications/Respiro.app/Contents/MacOS/Respiro')), 'perf.refuse.self');
  assert.equal(key(P(9001, 9000, '/usr/bin/top -l 1')), 'perf.refuse.self');
  assert.equal(key(P(78, 1, '/System/Library/Frameworks/Virtualization.framework/X/com.apple.Virtualization.VirtualMachine')), 'perf.refuse.vm');
  assert.equal(key(P(79, 1, '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit')), null);
  assert.equal(key(P(80, 1, 'node /x/tsc')), null);
});

test('tipo da ferramenta de dev pela linha de comando', () => {
  /** @type {[string, string | null, string?][]} */
  const cases = [
    [`node ${H}/p/node_modules/.bin/tsc --noEmit`, 'typecheck', 'tsc'],
    ['node /x/typescript/lib/tsc.js -p .', 'typecheck', 'tsc'],
    ['npm run typecheck', 'typecheck', 'typecheck'],
    ['bash juridiq-server/scripts/agents/final-review.sh start --gate-fail-reason typecheck', 'gate', 'final-review.sh'],
    ['node scripts/check.mjs', 'gate', 'check.mjs'],
    ['node --test /x/dom.test.mjs', 'test', 'node --test'],
    ['node /x/node_modules/.bin/vitest run', 'test', 'vitest'],
    ['node /x/.bin/eslint .', 'lint', 'eslint'],
    ['node /x/.bin/vite build', 'build', 'vite build'],
    ['node /x/.bin/next dev', 'server', 'next dev'],
    ['node /x/.bin/vite', 'server', 'vite'],
    [`${H}/Library/Caches/ms-playwright/chromium-1/chrome-mac/Chromium.app/Contents/MacOS/Chromium --headless --no-sandbox`, 'browser', 'Chromium'],
    ['npm exec n8n-mcp@latest', 'mcp', 'n8n-mcp'],
    ['npm exec @supabase/mcp-server-supabase@latest --access-token x', 'mcp', 'mcp-server-supabase'],
    // Vigia, servidor e servidor de linguagem nunca contam como tarefa (o automático não encerra).
    ['node /x/node_modules/.bin/vitest --watch', 'server', 'vitest'],
    ['node /x/typescript/lib/tsserver.js --serverMode semantic', 'server', 'tsserver'],
    ['node /x/.bin/webpack serve', 'server', 'webpack'],
    ['node /x/.bin/eslint --stdio', 'server', 'eslint'],
    ['node /x/.bin/turbo dev', 'server', 'turbo'],
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', null],
    ['node /x/vitest-like-name.js', null],
    ['/bin/zsh -l', null],
  ];
  for (const [args, kind, name] of cases) {
    const k = devKind(args);
    assert.equal(k?.kind ?? null, kind, args);
    if (name) assert.equal(k?.name, name, args);
  }
});

test('órfão: a cadeia chega ao launchd sem terminal, editor ou sessão; a subárvore vai junto', () => {
  const procs = [
    P(100, 1, '/Applications/Visual Studio Code.app/Contents/MacOS/Code'),
    P(101, 100, '/bin/zsh -l'),
    P(102, 101, 'claude'),
    P(200, 102, `node ${H}/p/node_modules/.bin/tsc --noEmit`, { mem: 5e8 }),
    P(300, 1, `node ${H}/p/node_modules/.bin/tsc -p .`, { mem: 1.2e9, start: NOW - 50 * MIN }),
    P(301, 300, 'node worker.js', { mem: 3e8 }),
    P(400, 1, `bash ${H}/Documents/q/scripts/gate.sh`, { mem: 1e7 }),
    P(401, 400, `node ${H}/Documents/q/node_modules/.bin/tsc`, { mem: 9e8 }),
    P(500, 999, 'node /x/node_modules/.bin/vitest run'),
    P(600, 1, `node ${H}/w/node_modules/.bin/next dev`),
    P(700, 1, 'node /x/.bin/tsc', { uid: 0 }),
    // A sessão do agente cita "mcp" nos argumentos e o helper do app cita "--headless": nenhum dos dois é ferramenta.
    // tmux e screen seguram quem roda dentro deles.
    P(900, 1, 'tmux: server (/private/tmp/tmux-501/default)'),
    P(901, 900, '-zsh'),
    P(902, 901, `node ${H}/t/node_modules/.bin/eslint .`),
    P(910, 1, 'SCREEN -S work'),
    P(911, 910, `node ${H}/s/node_modules/.bin/jest`),
    P(800, 1, 'claude --mcp-config x --allowedTools mcp__computer-use'),
    P(801, 1, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --headless'),
    P(802, 1, `${H}/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude --output-format stream-json`),
  ];
  const { rows, targets } = devRows(procs, ctx, () => '', H);
  const row = (/** @type {string} */ id) => rows.find((r) => r.id === id);
  assert.equal(row('dev:typecheck:tsc:1')?.mem, 1.5e9);
  assert.deepEqual(row('dev:typecheck:tsc:1')?.projects, ['p']);
  assert.equal(row('dev:typecheck:tsc:0')?.host, 'claude');
  assert.equal(row('dev:gate:gate.sh:1')?.mem, 9.1e8);
  assert.deepEqual(row('dev:gate:gate.sh:1')?.projects, ['q']);
  // Cadeia incompleta na leitura: na dúvida, não é órfão.
  assert.equal(row('dev:test:vitest:0')?.orphan, false);
  assert.equal(row('dev:server:next dev:1')?.orphan, true);
  assert.equal(row('dev:lint:eslint:0')?.host, 'tmux');
  assert.equal(row('dev:test:jest:0')?.orphan, false);
  // Processo de outro usuário nem aparece.
  assert.equal(rows.reduce((s, r) => s + r.count, 0), 7);
  assert.deepEqual(targets.get('dev:typecheck:tsc:1')?.procs.map((p) => p.pid), [300, 301]);
  assert.equal(project(`${H}/Documents/juridiq-/juridiq-server`, H), 'juridiq-server');
  assert.equal(project(`${H}/.npm/_npx/abc/node_modules/x`, H), null);
  assert.equal(project('/tmp/x', H), null);
});

/** Pontos de 30 em 30 s nos últimos `minutes` minutos. @param {number} minutes @param {Partial<import('../src/types.js').TrendPoint>} o */
const trend = (minutes, o) => Array.from({ length: minutes * 2 + 1 }, (_, i) => ({ at: NOW - minutes * MIN + i * 30_000, used: 1e10, swap: 1e9, total: 17e9, pressure: /** @type {const} */ ('critical'), ...o }));

test('preferências do Desempenho: só valores das listas fechadas, pedaço por pedaço', () => {
  const cur = perfDefaults();
  assert.deepEqual(perfPrefs({ auto: 'sim', protected: 'Chrome', rules: { orphans: { on: true, minutes: 7, mode: 'agir', trigger: 'swap' } } }, cur),
    { ...cur, rules: { ...cur.rules, orphans: { ...cur.rules.orphans, on: true, trigger: 'swap' } } });
  assert.equal(perfPrefs({ rules: { alert: { mode: 'act' } } }, cur).rules.alert.mode, 'notify');
  assert.deepEqual(perfPrefs({ protected: [' Slack ', 'Slack', 3, ''] }, cur).protected, ['Slack']);
  assert.deepEqual(perfPrefs(undefined, cur), cur);
});

test('gatilho só vale se durou o tempo todo', () => {
  assert.equal(held(trend(6, {}), 'critical', 5, NOW), true);
  assert.equal(held(trend(3, {}), 'critical', 5, NOW), false);
  assert.equal(held([...trend(6, {}).slice(0, -1), { at: NOW, used: 0, swap: 0, total: 17e9, pressure: 'normal' }], 'critical', 5, NOW), false);
  assert.equal(held(trend(6, { pressure: 'warn' }), 'warn', 5, NOW), true);
  assert.equal(held(trend(6, { pressure: 'normal', swap: 9e9 }), 'swap', 5, NOW), true);
  assert.equal(held(trend(6, { pressure: 'normal', swap: 8e9 }), 'swap', 5, NOW), false);
});

test('S18: o automático só encerra ferramenta de tarefa órfã e não protegida; o resto vira aviso', () => {
  const prefs = perfDefaults();
  prefs.rules.orphans = { on: true, mode: 'act', trigger: 'critical', minutes: 5 };
  const dev = /** @type {import('../src/types.js').DevRow[]} */ ([
    { id: 'dev:typecheck:tsc:1', kind: 'typecheck', name: 'tsc', count: 3, projects: [], since: NOW - 40 * MIN, mem: 2.1e9, cpu: 0, orphan: true, protected: false, host: null },
    { id: 'dev:server:vite:1', kind: 'server', name: 'vite', count: 1, projects: [], since: NOW - 40 * MIN, mem: 3e8, cpu: 0, orphan: true, protected: false, host: null },
    { id: 'dev:test:jest:1', kind: 'test', name: 'jest', count: 1, projects: [], since: NOW - 40 * MIN, mem: 3e8, cpu: 0, orphan: true, protected: true, host: null },
    { id: 'dev:typecheck:tsc:0', kind: 'typecheck', name: 'tsc', count: 1, projects: [], since: NOW - 40 * MIN, mem: 5e8, cpu: 0, orphan: false, protected: false, host: 'claude' },
  ]);
  const docker = { installed: true, running: true, limit: null, vm: null, appId: null, containers: [
    { id: 'a'.repeat(64), name: 'db', image: 'postgres', mem: 4e8, cpu: 0, idleSince: NOW - 40 * MIN, protected: false },
    { id: 'b'.repeat(64), name: 'Docker', image: 'x', mem: 4e8, cpu: 0, idleSince: NOW - 40 * MIN, protected: true },
    { id: 'c'.repeat(64), name: 'api', image: 'x', mem: 4e8, cpu: 0, idleSince: NOW - 5 * MIN, protected: false },
  ] };
  const view = { dev, docker };
  const [d] = decide(prefs, trend(6, {}), view, {}, NOW);
  assert.deepEqual(d.act, ['dev:typecheck:tsc:1']);
  assert.equal(d.notify?.params?.n, 1);
  known(d.notify);
  known(d.why);
  // Só avisar: nada encerra.
  prefs.rules.orphans.mode = 'notify';
  assert.deepEqual(decide(prefs, trend(6, {}), view, {}, NOW)[0].act, []);
  // Espera de 30 min, gatilho curto e automação desligada: nada.
  assert.deepEqual(decide(prefs, trend(6, {}), view, { orphans: NOW - 10 * MIN }, NOW), []);
  assert.deepEqual(decide(prefs, trend(3, {}), view, {}, NOW), []);
  assert.deepEqual(decide({ ...prefs, auto: false }, trend(6, {}), view, {}, NOW), []);
  // Containers: ociosos pelo tempo da regra e fora dos protegidos.
  prefs.rules.orphans.on = false;
  prefs.rules.containers = { on: true, mode: 'act', trigger: 'critical', minutes: 30 };
  assert.deepEqual(decide(prefs, [], view, {}, NOW).map((x) => x.act), [['a'.repeat(64)]]);
  // Aviso: só avisa.
  prefs.rules.containers.on = false;
  prefs.rules.alert = { on: true, mode: 'act', trigger: 'swap', minutes: 2 };
  const [alert] = decide(prefs, trend(3, { swap: 9e9 }), view, {}, NOW);
  assert.deepEqual(alert.act, []);
  known(alert.notify);
});

test('sugestões com número e ação; dicas só com o que foi medido', () => {
  const dev = /** @type {import('../src/types.js').DevRow[]} */ ([
    { id: 'o', kind: 'typecheck', name: 'tsc', count: 3, projects: [], since: NOW - 40 * MIN, mem: 2.1e9, cpu: 0, orphan: true, protected: false, host: null },
    { id: 'l', kind: 'test', name: 'vitest', count: 1, projects: [], since: NOW - 25 * MIN, mem: 6e8, cpu: 0, orphan: false, protected: false, host: 'claude' },
    { id: 'm', kind: 'mcp', name: 'n8n-mcp', count: 7, projects: [], since: NOW - 60 * MIN, mem: 9e8, cpu: 0, orphan: false, protected: false, host: 'claude' },
  ]);
  const docker = { installed: true, running: false, limit: null, vm: null, appId: null, containers: [] };
  const s = suggest({ dev, docker }, NOW);
  assert.deepEqual(s.map((x) => x.id), ['orphans', 'long:l']);
  assert.deepEqual(s[0].text.params?.what, { key: 'perf.what.typecheck', params: { n: 3 } });
  assert.deepEqual(s[0].action?.ids, ['o']);
  for (const x of s) { known(x.text); known(x.action?.label); }
  const memory = toMemory(SYSCTL, VMSTAT, NOW);
  const procs = [P(11, 1, 'claude'), P(12, 1, 'claude'), P(13, 1, 'claude --resume'), P(14, 13, 'claude'), ...[4, 5, 6].map((pid) => P(pid, 1, 'npm exec n8n-mcp@latest'))];
  const t = tips({ dev, docker, groups: [], procs, memory }, NOW);
  assert.deepEqual(t.map((x) => x.id), ['docker', 'mcp', 'npx']);
  // Claude dentro de uma sessão conta como a mesma sessão.
  assert.equal(t[1].text.params?.sessions, 3);
  for (const x of t) { known(x.text); known(x.how); }
  // Docker com 4 GB num Mac de 16 GB: nada a sugerir.
  assert.equal(tips({ dev: [], docker: { ...docker, limit: 4 * 2 ** 30 }, groups: [], procs: [], memory }, NOW).length, 0);
  assert.equal(dockerLimit({ MemoryMiB: 4096 }), 4 * 2 ** 30);
  assert.equal(dockerLimit({ AutoStart: false }), null);
  assert.deepEqual(parseStats('{"ID":"abc","Name":"db","MemUsage":"512MiB / 7.6GiB","CPUPerc":"0.50%"}\nnão é json'),
    [{ id: 'abc', name: 'db', mem: 512 * 2 ** 20, cpu: 0.5 }]);
});

/** Processo filho de verdade; `stubborn` ignora o SIGTERM. @param {boolean} stubborn */
async function child(stubborn) {
  const c = spawn(process.execPath, ['-e', `${stubborn ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000)`], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const p = (await processes()).find((x) => x.pid === c.pid);
  assert.ok(p, 'filho não apareceu no ps');
  return { c, target: { id: `dev:test:${p.pid}`, name: 'teste', kind: /** @type {const} */ ('cli'), procs: [{ ...p, mem: 1000 }], protected: false } };
}
const real = () => ({ me: process.getuid?.() ?? 0, self: new Set([1]), protected: [] });

test('relief: pid reaproveitado e o próprio app ficam; filho que ignora SIGTERM só sai forçado', { timeout: 20_000 }, async () => {
  const me = /** @type {import('../src/types.js').Proc} */ ((await processes()).find((x) => x.pid === process.pid));
  // Mesmo pid com outro início: não é o mesmo processo (S16). Este teste continua vivo depois.
  const other = await endTargets([{ id: 'x', name: 'eu', kind: 'cli', procs: [{ ...me, start: me.start - 1000, mem: 0 }], protected: false }], { ctx: real() });
  assert.deepEqual(other.ended, [{ name: 'eu', freed: 0 }]);
  const self = await endTargets([{ id: 'x', name: 'eu', kind: 'cli', procs: [{ ...me, mem: 0 }], protected: false }], { ctx: { ...real(), self: new Set([process.pid]) } });
  assert.equal(self.refused[0]?.why.key, 'perf.refuse.self');

  const calm = await child(false);
  const ok = await endTargets([calm.target], { ctx: real() });
  assert.deepEqual(ok.ended, [{ name: 'teste', freed: 1000 }]);

  const hard = await child(true);
  try {
    assert.equal((await endTargets([hard.target], { force: true, ctx: real() })).refused[0]?.why.key, 'perf.refuse.notStuck');
    const first = await endTargets([hard.target], { ctx: real() });
    assert.deepEqual(first.stuck.map((x) => x.id), [hard.target.id]);
    assert.equal((await endTargets([hard.target], { force: true, auto: true, ctx: real() })).refused[0]?.why.key, 'perf.refuse.auto');
    const forced = await endTargets([hard.target], { force: true, ctx: real() });
    assert.deepEqual(forced.ended, [{ name: 'teste', freed: 1000 }]);
  } finally {
    hard.c.kill('SIGKILL');
  }
});
