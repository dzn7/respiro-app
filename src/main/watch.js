// Segundo plano do Desempenho: memória a cada 30 s para a tendência, as regras que a pessoa ligou (S18), aviso nativo
// do macOS e o registro de toda ação, manual ou automática (S19). Quem encerra é o relief.js.
// Sem regra ligada, nada além de sysctl e vm_stat; processos e Docker só quando uma regra pode disparar.
import { Notification } from 'electron';
import { msg, tx } from '../shared/i18n.js';
import { collect, decide, held, memory, points, remember } from './perf.js';
import { endTargets, stopContainers } from './relief.js';
import * as store from './store.js';

/** @typedef {import('../types.js').PerfLog} PerfLog @typedef {import('../types.js').Msg} Msg */

/** Quando cada regra disparou (espera de 30 min entre um disparo e outro). @type {Partial<Record<import('../types.js').RuleId, number>>} */
const last = {};
/** Referência viva: notificação sem dono é coletada e o clique se perde. @type {Notification | null} */
let note = null;
let open = () => {};
/** @type {() => import('./perf.js').Ctx} */
let context = () => ({ me: process.getuid?.() ?? 0, self: new Set([process.pid]), protected: [] });

/** @param {Omit<PerfLog, 'at'>} entry */
export function log(entry) {
  store.data.perfLog = [{ at: Date.now(), ...entry }, ...store.data.perfLog].slice(0, 200);
  store.save();
}

/** @param {Msg} title @param {Msg} body */
function notify(title, body) {
  if (!Notification.isSupported()) return;
  note = new Notification({ title: tx(title), body: tx(body) });
  note.on('click', open);
  note.show();
}

async function beat() {
  remember(await memory());
  const prefs = store.data.prefs.perf;
  const { alert, orphans, containers } = prefs.rules;
  const now = Date.now();
  const due = prefs.auto && ((alert.on && held(points(), alert.trigger, alert.minutes, now))
    || (orphans.on && held(points(), orphans.trigger, orphans.minutes, now)) || containers.on);
  if (!due) return;
  // Segundo plano sem top (RSS basta para decidir); Docker no máximo a cada minuto.
  const ctx = context();
  const view = await collect(ctx, { foot: false, docker: containers.on, dockerTtl: 60_000 });
  for (const d of decide(prefs, points(), view, last, now)) {
    last[d.rule] = now;
    if (d.act.length) {
      const r = d.rule === 'containers' ? await stopContainers(d.act, { auto: true, protected: ctx.protected })
        : await endTargets(d.act.map((id) => view.targets.get(id) ?? null), { auto: true, ctx });
      const names = [...r.ended, ...r.stuck].map((x) => x.name);
      if (names.length) {
        const what = msg(d.rule === 'containers' ? 'perf.log.stopped' : 'perf.log.ended', { n: names.length, names: names.join(', ') });
        log({ auto: true, rule: d.rule, what, why: d.why, freed: r.freed });
        notify(d.why, msg('perf.notify.done', { what, bytes: r.freed }));
      }
      if (r.stuck.length) notify(msg('perf.notify.stuckTitle'), msg('perf.notify.stuck', { names: r.stuck.map((x) => x.name).join(', ') }));
    }
    if (d.notify) {
      log({ auto: true, rule: d.rule, what: msg('perf.log.notified', { text: d.notify }), why: d.why, freed: 0 });
      notify(d.why, d.notify);
    }
  }
}

/**
 * Liga o laço de 30 s. `onOpen` abre a página na Automação (clique no aviso); `ctx` diz quem é o usuário e quem é o
 * próprio Respiro, para nunca encerrá-lo.
 * @param {() => void} onOpen @param {() => import('./perf.js').Ctx} ctx
 */
export function initWatch(onOpen, ctx) {
  open = onOpen;
  context = ctx;
  const tick = () => beat().catch((e) => console.error('[watch]', e));
  tick();
  setInterval(tick, 30_000);
}
