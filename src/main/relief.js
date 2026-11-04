// ÚNICO lugar que encerra processo ou para container (S15: o npm run check barra process.kill, kill e stop no resto de
// src/main). Cada processo é revalidado contra um ps novo na hora (S16); app com janela fecha pelo próprio app, que
// pergunta se quer salvar (S17); forçar só para quem não respondeu e a pessoa pediu; o automático nunca força, nunca
// fecha app e nunca toca no que está protegido (S18).
import { msg } from '../shared/i18n.js';
import { literal } from './cleaner.js';
import { canEnd, containerSeen, isProtected, parseStats, processes } from './perf.js';
import { run } from './sys.js';

/**
 * @typedef {import('./perf.js').Target} Target
 * @typedef {import('./perf.js').Ctx} Ctx
 * @typedef {import('../types.js').Proc} Proc
 * @typedef {import('../types.js').EndResult} EndResult
 */

/** Ids que não responderam ao pedido normal: só eles podem ser forçados. */
const stuck = new Set();
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** Sinal 0 só pergunta se o processo existe. @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/** Espera os processos saírem; devolve quem ficou (zumbi, que só espera o pai recolher, conta como saído). @param {Proc[]} procs @param {number} ms */
async function gone(procs, ms) {
  const until = Date.now() + ms;
  let left = procs.filter((p) => alive(p.pid));
  while (left.length && Date.now() < until) {
    await sleep(200);
    left = left.filter((p) => alive(p.pid));
  }
  if (!left.length) return left;
  const states = await run('/bin/ps', ['-o', 'pid=,stat=', '-p', left.map((p) => p.pid).join(',')], { timeout: 5000 }).catch(() => '');
  const zombie = new Set([...states.matchAll(/^\s*(\d+)\s+Z/gm)].map((m) => Number(m[1])));
  return left.filter((p) => !zombie.has(p.pid));
}

/** Pede para o app fechar como o ⌘Q faria; ele pergunta se quer salvar. Sem esperar resposta: o "Salvar?" não prende o Respiro. @param {string} bundle */
async function quit(bundle) {
  const id = (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${bundle}/Contents/Info.plist`], { timeout: 5000 })).trim();
  if (!/^[\w.-]+$/.test(id)) throw new Error('perf.refuse.failed');
  // "is running" antes: tell application abriria o app se ele já tivesse fechado.
  await run('/usr/bin/osascript', ['-e', 'ignoring application responses', '-e', `if application id ${literal(id)} is running then tell application id ${literal(id)} to quit`,
    '-e', 'end ignoring'], { timeout: 10_000 });
}

/**
 * Encerra cada alvo: app pelo próprio app; processo de terminal com SIGTERM (folhas primeiro); com `force`, SIGKILL.
 * @param {(Target | null)[]} targets @param {{ force?: boolean, auto?: boolean, ctx: Ctx }} o @returns {Promise<EndResult>}
 */
export async function endTargets(targets, { force = false, auto = false, ctx }) {
  /** @type {EndResult} */
  const result = { ended: [], stuck: [], refused: [], freed: 0 };
  for (const t of targets) {
    if (!t) { result.refused.push({ name: '', why: msg('perf.refuse.gone') }); continue; }
    // Leitura nova para cada alvo: a espera do anterior (até 10 s) dá tempo de um pid ser reaproveitado.
    const now = new Map((await processes()).map((p) => [p.pid, p]));
    // S16: mesmo pid, mesmo início e mesmo comando. Pid reaproveitado fica de fora; o que já saiu não conta.
    const procs = t.procs.filter((p) => { const q = now.get(p.pid); return q && q.start === p.start && q.args === p.args; });
    if (!procs.length) { stuck.delete(t.id); result.ended.push({ name: t.name, freed: 0 }); continue; }
    const why = procs.map((p) => canEnd(/** @type {Proc} */ (now.get(p.pid)), ctx)).find(Boolean)
      ?? (auto && (t.kind === 'app' || t.protected || force) ? msg('perf.refuse.auto') : null)
      ?? (force && !stuck.has(t.id) ? msg('perf.refuse.notStuck') : null);
    if (why) { result.refused.push({ name: t.name, why }); continue; }
    try {
      if (t.kind === 'app' && !force && t.bundle) await quit(t.bundle);
      else for (const p of [...procs].reverse()) { try { process.kill(p.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* já saiu */ } }
    } catch {
      result.refused.push({ name: t.name, why: msg('perf.refuse.failed') });
      continue;
    }
    const left = await gone(procs, t.kind === 'app' && !force ? 10_000 : 3000);
    const freed = procs.filter((p) => !left.includes(p)).reduce((s, p) => s + p.mem, 0);
    result.freed += freed;
    if (left.length) {
      stuck.add(t.id);
      result.stuck.push({ id: t.id, name: t.name, freed });
    } else {
      stuck.delete(t.id);
      result.ended.push({ name: t.name, freed });
    }
  }
  return result;
}

/**
 * Para containers da última leitura, um por vez. Id validado; o automático não para container protegido e confere,
 * na hora, que ele continua ocioso.
 * @param {string[]} ids @param {{ auto?: boolean, protected?: string[] }} [o] @returns {Promise<EndResult>}
 */
export async function stopContainers(ids, { auto = false, protected: names = [] } = {}) {
  /** @type {EndResult} */
  const result = { ended: [], stuck: [], refused: [], freed: 0 };
  for (const id of ids) {
    const c = /^[0-9a-f]{12,64}$/.test(id) ? containerSeen(id) : null;
    if (!c) { result.refused.push({ name: id.slice(0, 12), why: msg('perf.refuse.gone') }); continue; }
    if (auto) {
      const now = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', id], { timeout: 15_000 }).then(parseStats, () => []);
      if (isProtected([c.name], names) || !now.length || now[0].cpu >= 1) { result.refused.push({ name: c.name, why: msg('perf.refuse.auto') }); continue; }
    }
    try {
      await run('docker', ['stop', id], { timeout: 60_000 });
      result.ended.push({ name: c.name, freed: c.mem });
      result.freed += c.mem;
    } catch {
      result.refused.push({ name: c.name, why: msg('perf.refuse.failed') });
    }
  }
  return result;
}
