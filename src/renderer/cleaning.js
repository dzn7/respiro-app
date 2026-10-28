// Tela da limpeza: uma página calma, como um documento. Em cima o espaço livre do disco agora (o mesmo número da
// tela principal) e quanto subiu desde o início; embaixo a barra com um trecho por item e a lista de tarefas.
// Nada é encenado: cada item muda quando o main avisa; o número é o statfs; a linha cinza é a saída da ferramenta.
// Item em uso não é erro: fica para depois. Cache do uv em uso pergunta se limpa mesmo assim.
import { button, h, svg } from './controls.js';
import { formatBytes, t, tx } from '../shared/i18n.js';
import { ring } from './loader.js';
import { countTo, curve, reduced, token } from './motion.js';

/**
 * @typedef {{ ref: string, name: string, category: string, trash: boolean, command: string | null, size: number }} Job
 * @typedef {{ label: string, run: () => void }} Action
 * @typedef {{ actions: Action[], onClose: () => void, onForce: (refs: string[]) => void }} Finish
 * @typedef {import('../types.js').CleanEvent} CleanEvent
 * @typedef {import('../types.js').CleanResult} CleanResult
 */

const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('cleaning'));

let run = {
  simulate: false,
  /** @type {Map<string, { row: HTMLElement, segment: HTMLElement }>} */ jobs: new Map(),
  total: 0,
  finished: 0,
  removed: 0,
  trashed: 0,
  /** @type {string | null} */ active: null,
  started: 0,
  begun: 0,
  /** @type {ReturnType<typeof setInterval> | undefined} */ clock: undefined,
  working: false,
  startFree: 0,
  /** A pessoa mandou para segundo plano: a página fecha e a limpeza segue. */
  background: false,
};
/** Avisa a tela principal do andamento (pílula da barra de título); null quando não há o que mostrar. */
let onStatus = (/** @type {string | null} */ _text) => {};
let toBackground = (/** @type {boolean} */ _on) => {};
/** @type {Record<string, HTMLElement>} */
let ui = {};

/** m:ss @param {number} ms */
const clock = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Há limpeza rodando (com a página aberta ou em segundo plano)? */
export const cleaningBusy = () => run.working;

/** Reabre a página da limpeza (em andamento ou com o resultado). false se não há nenhuma. */
export function reopenCleaning() {
  const d = dialog();
  if (!ui.doc || !d.firstChild) return false;
  run.background = false;
  toBackground(false);
  onStatus(null);
  if (!d.open) d.showModal();
  return true;
}

/**
 * @param {{ jobs: Job[], simulate: boolean, free: number, catName: (id: string) => string,
 *   status?: (text: string | null) => void, background?: (on: boolean) => void }} o
 */
export function openCleaning({ jobs, simulate, free, catName, status = () => {}, background = () => {} }) {
  clearInterval(run.clock);
  run = { simulate, jobs: new Map(), total: jobs.length, finished: 0, removed: 0, trashed: 0, active: null, started: 0, begun: Date.now(), clock: undefined, working: true, startFree: free, background: false };
  onStatus = status;
  toBackground = background;

  ui = {
    status: h('span', { class: 'clean-status-text' }, t('clean.starting')),
    glyph: h('span', { class: 'clean-status-glyph' }, ring(14)),
    // Simular: quanto seria liberado. Real: espaço livre agora, que sobe enquanto limpa.
    amount: h('h1', { class: 'clean-amount num', id: 'cleaning-title' }, formatBytes(simulate ? 0 : free)),
    delta: h('span', { class: 'clean-delta num' }),
    caption: h('span', {}, t(simulate ? 'clean.wouldFree' : 'clean.freeNow')),
    removed: h('span', { class: 'num' }, formatBytes(0)),
    trashed: h('span', { class: 'num' }, formatBytes(0)),
    elapsed: h('span', { class: 'num' }, clock(0)),
    summary: h('p', { class: 'clean-summary', 'aria-live': 'polite' }),
    notes: h('ul', { class: 'clean-notes' }),
    foot: h('footer', { class: 'clean-foot' }, h('p', { class: 'clean-hint' }, t(simulate ? 'clean.hintSimulate' : 'clean.hint')),
      button(t('clean.background'), sendToBackground, 'secondary', { 'data-role': 'background' })),
  };

  // Trecho de cada item proporcional ao que ele deve liberar; quem só se mede depois ganha um trecho mínimo.
  const known = jobs.reduce((s, j) => s + (j.size || 0), 0);
  const meter = h('div', { class: 'clean-meter', 'aria-hidden': 'true' });
  const list = h('ol', { class: 'clean-list', 'aria-label': t('clean.listLabel') });
  jobs.forEach((job, i) => {
    const segment = h('span', { class: 'meter-part', 'data-cat': job.category, 'data-state': 'pending' }, h('span', { class: 'meter-fill' }));
    segment.style.setProperty('--w', String(Math.max(known ? (job.size || 0) / known : 0, 1 / Math.max(jobs.length * 4, 12))));
    const row = h('li', { class: 'job', 'data-state': 'pending' },
      h('span', { class: 'job-glyph' }, h('span', { class: 'job-dot' })),
      h('span', { class: 'job-text' },
        h('span', { class: 'job-name' }, job.name),
        h('span', { class: 'job-meta' }, catName(job.category), ' · ', job.command ? h('code', {}, job.command) : t('clean.methodTrash')),
        h('span', { class: 'job-line' }, h('span', { class: 'job-line-text mono' }))),
      h('span', { class: 'job-side num' }, job.size ? formatBytes(job.size) : ''));
    row.style.setProperty('--i', String(Math.min(i, 10)));
    meter.append(segment);
    list.append(row);
    run.jobs.set(job.ref, { row, segment });
  });

  const d = dialog();
  // Esc: o Chromium ignora preventDefault no 2º cancel seguido, então o Esc é barrado já no teclado.
  d.onkeydown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (!run.working) /** @type {HTMLElement | null} */ (d.querySelector('[data-primary]'))?.click();
  };
  d.oncancel = (e) => e.preventDefault();
  // Se algo fechar o diálogo no meio, ele volta: a limpeza continua e o resultado precisa de lugar.
  d.onclose = () => { if (run.working && !run.background && d.isConnected) d.showModal(); };
  d.replaceChildren(
    h('div', { class: 'welcome-drag', 'aria-hidden': 'true' }),
    h('div', { class: 'clean-doc', 'data-phase': 'working' },
      h('header', { class: 'clean-head' },
        h('p', { class: 'clean-status' }, ui.glyph, ui.status),
        ui.amount, h('p', { class: 'clean-caption' }, ui.caption, ui.delta), meter,
        h('p', { class: 'clean-facts' },
          h('span', {}, t('clean.removed'), ' ', ui.removed), h('span', {}, t('clean.trashed'), ' ', ui.trashed), h('span', {}, ui.elapsed)),
        ui.summary, ui.notes),
      h('div', { class: 'clean-scroll' }, list)),
    ui.foot);
  ui.doc = /** @type {HTMLElement} */ (d.querySelector('.clean-doc'));
  d.showModal();
  run.clock = setInterval(tick, 1000);
}

/** Evento do main. @param {CleanEvent} e */
export function cleaningEvent(e) {
  if (!run.working) return;
  if (e.kind === 'disk') {
    if (!run.simulate) showFree(e.free);
    return;
  }
  if (e.kind === 'password') {
    ui.status.textContent = t('clean.password');
    return;
  }
  const job = run.jobs.get(e.ref);
  if (!job) return;
  const { row } = job;
  if (e.kind === 'start') {
    run.active = e.ref;
    run.started = Date.now();
    setState(job, 'running', ring(14));
    ui.status.textContent = t('clean.progress', { n: run.finished + 1, total: run.total, name: row.querySelector('.job-name')?.textContent ?? '' });
    row.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  } else if (e.kind === 'output') {
    /** @type {HTMLElement} */ (row.querySelector('.job-line-text')).textContent = e.line;
  } else if (e.kind === 'done') {
    run.finished += 1;
    run.removed += e.freed ?? 0;
    run.trashed += e.trashed;
    setState(job, 'done', svg('check', 14));
    side(row, e.trashed ? t('clean.toTrash', { bytes: e.trashed }) : e.freed ? formatBytes(e.freed) : t('clean.ok'));
    countTo(ui.removed, run.removed, formatBytes);
    countTo(ui.trashed, run.trashed, formatBytes);
    if (run.simulate) countTo(ui.amount, run.removed + run.trashed, formatBytes);
  } else if (e.kind === 'failed') {
    run.finished += 1;
    setState(job, 'failed', svg('warning', 14));
    side(row, t('clean.failed'));
    /** @type {HTMLElement} */ (row.querySelector('.job-line-text')).textContent = tx(e.message);
  } else if (e.kind === 'skipped') {
    run.finished += 1;
    setState(job, 'skipped', svg('lock-simple', 14));
    side(row, t('clean.later'));
    /** @type {HTMLElement} */ (row.querySelector('.job-line-text')).textContent = tx(e.message);
  }
  if ((e.kind === 'done' || e.kind === 'failed' || e.kind === 'skipped') && run.active === e.ref) run.active = null;
  if (run.background) onStatus(t('clean.pill', { n: Math.min(run.finished + (run.active ? 1 : 0), run.total), total: run.total }));
}

/**
 * Fim: os números assentam, a frase de resumo aparece e os botões entram. Mesma página, sem troca de tela.
 * @param {CleanResult} r @param {Finish} f
 */
export function finishCleaning(r, { actions, onClose, onForce }) {
  stop('done');
  onStatus(null);
  // Item que o main nem achou (análise mudou) ou que ficou sem evento: assenta no estado final.
  for (const [ref, job] of run.jobs) {
    if (job.row.dataset.state !== 'pending' && job.row.dataset.state !== 'running') continue;
    const failure = r.failed.find((f) => f.ref === ref);
    setState(job, 'failed', svg('warning', 14));
    side(job.row, t('clean.failed'));
    if (failure) /** @type {HTMLElement} */ (job.row.querySelector('.job-line-text')).textContent = tx(failure.message);
  }
  const nothing = !r.done.length;
  const later = !r.done.length && !r.failed.length && r.skipped.length > 0;
  ui.glyph.replaceChildren(svg(later ? 'lock-simple' : nothing ? 'warning' : 'check', 14));
  ui.status.textContent = t(r.simulated ? 'result.titleSimulated' : later ? 'clean.allLater' : nothing ? 'result.titleNothing' : 'result.titleDone');
  if (r.simulated) countTo(ui.amount, r.freed + r.trashed, formatBytes);
  else showFree(r.free);
  countTo(ui.removed, r.freed, formatBytes);
  countTo(ui.trashed, r.trashed, formatBytes);
  ui.summary.textContent = r.simulated
    ? t('result.summarySimulated', { bytes: r.freed + r.trashed })
    : [r.freed && t('result.summaryRemoved', { bytes: r.freed }), r.trashed && t('result.summaryTrashed', { bytes: r.trashed }),
      r.skipped.length && t('result.summarySkipped', { n: r.skipped.length }),
      r.failed.length && t('result.summaryFailed', { n: r.failed.length })].filter(Boolean).join(' ') || t('result.titleNothing');

  /** @param {string} text */
  const note = (text) => h('li', {}, text);
  const notes = [];
  if (r.simulated) notes.push(note(t('result.nothingDeleted')));
  else {
    if (r.trashed) notes.push(note(t('clean.trashNote')));
    if (r.freed - r.disk > Math.max(500e6, r.freed * 0.3)) notes.push(note(t('result.gap')));
    else if (r.docker) notes.push(note(t('result.docker')));
    if (r.unknown && !r.freed) notes.push(note(t('result.unknownDone')));
  }
  ui.notes.replaceChildren(...notes);

  const close = (/** @type {(() => void) | null} */ then) => () => leave(() => { onClose(); then?.(); });
  // Cache do uv em uso: explica e pergunta. Sem resposta, fica para depois e o Respiro tenta sozinho.
  const busy = r.simulated ? [] : r.skipped.filter((s) => s.retry);
  if (busy.length) {
    const names = busy.map((s) => s.message.params?.names).find(Boolean);
    const ask = h('div', { class: 'clean-ask', role: 'group', 'aria-labelledby': 'clean-ask-title' },
      h('p', { class: 'clean-ask-title', id: 'clean-ask-title' }, svg('lock-simple', 14), t('clean.askTitle')),
      h('p', { class: 'clean-ask-text' }, names ? t('clean.askText', { names: String(names) }) : t('clean.askTextUnknown')),
      h('div', { class: 'clean-ask-actions' },
        button(t('clean.askLater'), () => { ask.remove(); ui.notes.append(h('li', {}, t('clean.retryLater'))); }, 'secondary small'),
        button(t('clean.askForce'), close(() => onForce(busy.map((s) => s.ref))), 'secondary small')));
    ui.notes.after(ask);
  }
  ui.foot.replaceChildren(h('span', { class: 'spacer' }),
    ...actions.map((a) => button(a.label, close(a.run), 'secondary')),
    button(t('clean.close'), close(null), 'primary', { 'data-primary': true }));
  /** @type {HTMLElement} */ (ui.foot.querySelector('[data-primary]')).focus();
}

/** Erro antes de começar (outra limpeza em curso, pedido inválido). @param {string} reason @param {() => void} onClose */
export function failCleaning(reason, onClose) {
  stop('error');
  ui.glyph.replaceChildren(svg('warning', 14));
  ui.status.textContent = t('clean.errorTitle');
  ui.summary.textContent = t('confirm.error', { reason });
  ui.foot.replaceChildren(h('span', { class: 'spacer' }), button(t('clean.close'), () => leave(onClose), 'primary', { 'data-primary': true }));
  /** @type {HTMLElement} */ (ui.foot.querySelector('[data-primary]')).focus();
}

// ---------- Partes ----------

/** "Continuar em segundo plano": a página sai, a limpeza segue e o fim aparece na pílula do topo. */
async function sendToBackground() {
  run.background = true;
  toBackground(true);
  onStatus(t('clean.pill', { n: Math.min(run.finished + 1, run.total), total: run.total }));
  const d = dialog();
  await d.animate([{ opacity: 1 }, { opacity: 0, transform: reduced() ? 'none' : 'scale(.985)' }],
    { duration: token('--dur-state'), easing: curve('--ease-in'), fill: 'forwards' }).finished.catch(() => {});
  if (run.background) d.close();
  d.getAnimations().forEach((a) => a.cancel());
  /** @type {HTMLElement | null} */ (document.querySelector('#clean-pill'))?.focus();
}

/** Espaço livre agora e quanto subiu desde o início da limpeza. @param {number} free */
function showFree(free) {
  countTo(ui.amount, free, formatBytes);
  const gain = free - run.startFree;
  // Abaixo de 10 MB é ruído do sistema; não mostra.
  ui.delta.textContent = gain > 10e6 ? ` · ${t('clean.sinceStart', { bytes: gain })}` : '';
}

/** @param {'done' | 'error'} phase */
function stop(phase) {
  run.working = false;
  clearInterval(run.clock);
  ui.doc.dataset.phase = phase;
  ui.elapsed.textContent = clock(Date.now() - run.begun);
}

/** @param {{ row: HTMLElement, segment: HTMLElement }} job @param {string} state @param {Element} glyph */
function setState({ row, segment }, state, glyph) {
  row.dataset.state = state;
  segment.dataset.state = state;
  row.querySelector('.job-glyph')?.replaceChildren(glyph);
}

/** @param {HTMLElement} row @param {string} text */
const side = (row, text) => { /** @type {HTMLElement} */ (row.querySelector('.job-side')).textContent = text; };

/** Relógio da limpeza e do item ativo. */
function tick() {
  ui.elapsed.textContent = clock(Date.now() - run.begun);
  const job = run.active ? run.jobs.get(run.active) : null;
  if (job) side(job.row, clock(Date.now() - run.started));
}

/** @param {() => void} done */
async function leave(done) {
  const d = dialog();
  await d.animate([{ opacity: 1 }, { opacity: 0 }],
    { duration: token('--dur-state'), easing: curve('--ease-in'), fill: 'forwards' }).finished.catch(() => {});
  d.close();
  d.replaceChildren();
  d.getAnimations().forEach((a) => a.cancel());
  done();
  // O que abriu a limpeza (sheet) já fechou: o foco volta para a tela principal.
  if (!document.querySelector('dialog[open]')) /** @type {HTMLElement | null} */ (document.querySelector('#btn-free:not([hidden]), .row-main'))?.focus();
}
