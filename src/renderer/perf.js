// Desempenho: memória, processos e Docker ao vivo, para decidir o que encerrar ou mudar para o Mac voltar a respirar.
// Página em tela cheia como o Explorar. Lê a cada 5 s só aberta e visível; região com o mouse ou o foco não redesenha
// (nada pula embaixo do clique). O renderer manda só ids (S4); quem encerra é o main (relief.js, S15–S17). Regras
// automáticas, protegidos e registro na aba Automação (S18, S19).
import { button, checkbox, disclosure, h, menu, segmented, select, svg, toggle, uid } from './controls.js';
import { formatBytes, has, t, tx } from '../shared/i18n.js';
import { MINUTES, TRIGGERS } from '../shared/perf.js';
import { timeChart } from './chart.js';
import { ring } from './loader.js';

/**
 * @typedef {import('../types.js').PerfSnapshot} PerfSnapshot
 * @typedef {import('../types.js').PerfPrefs} PerfPrefs
 * @typedef {import('../types.js').PerfGroup} PerfGroup
 * @typedef {import('../types.js').DevRow} DevRow
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').Suggestion} Suggestion
 * @typedef {import('../types.js').EndResult} EndResult
 * @typedef {import('../types.js').RuleId} RuleId
 * @typedef {'apps' | 'dev' | 'docker' | 'origin' | 'auto'} Tab
 * @typedef {'end' | 'force' | 'stop'} Kind
 * @typedef {{ kind: Kind, ids: string[], rows: { name: string, mem: number | null }[], app: boolean }} Ask
 */

const api = window.respiro;
const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('perf'));
const MIN = 60_000;
const TABS = /** @type {const} */ (['apps', 'dev', 'docker', 'origin', 'auto']);
const TONE = /** @type {const} */ ({ normal: ['safe', 'check-circle'], warn: ['attention', 'warning'], critical: ['danger', 'warning-octagon'] });

const state = {
  tab: /** @type {Tab} */ ('apps'),
  /** @type {PerfSnapshot | null} */ snap: null,
  error: '',
  /** grupos abertos na aba Apps */
  /** @type {Set<string>} */ open: new Set(),
  /** @type {Ask | null} */ ask: null,
  /** @type {{ kind: Kind, r: EndResult } | null} */ done: null,
  busy: false,
};
let timer = 0;
/** @type {(text: string) => void} */
let say = () => {};
/** @type {{ subtitle?: HTMLElement, now?: HTMLElement, body?: HTMLElement, foot?: HTMLElement }} */
const ui = {};

/** Erro do IPC em frase (a chave vem do main). @param {unknown} e */
function reason(e) {
  const text = String(/** @type {Error} */ (e)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return has(text) ? t(text) : text;
}

const cpu = (/** @type {number} */ v) => new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 }).format(v);

// ---------- Abrir, ler, fechar ----------

/** Abre a página (na aba pedida); `announce` fala a mudança de pressão e o resultado das ações. @param {{ tab?: Tab, announce?: (text: string) => void }} [o] */
export function openPerf({ tab, announce } = {}) {
  if (tab) state.tab = tab;
  if (announce) say = announce;
  const d = dialog();
  d.onkeydown = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (state.busy) return;
    if (state.ask || state.done) back(); else d.close();
  };
  d.oncancel = (e) => e.preventDefault();
  d.onclose = () => { clearTimeout(timer); state.ask = null; state.done = null; };
  if (!d.open) d.showModal();
  render();
  refresh();
}

/** Lê de novo a cada 5 s com a página aberta e visível. Confirmação e resultado congelam: a lista confirmada é a que sai. */
async function refresh() {
  clearTimeout(timer);
  const d = dialog();
  if (!d.open) return;
  if (!state.ask && !state.done && !state.busy && document.visibilityState === 'visible') {
    try {
      const snap = await api.perf('snapshot');
      if (state.snap && snap.memory.pressure !== state.snap.memory.pressure) say(t(`perf.pressure.${snap.memory.pressure}`));
      state.snap = snap;
      state.error = '';
    } catch (e) {
      state.error = reason(e);
    }
    if (d.open && !state.ask && !state.done && !state.busy) update();
  }
  if (d.open) timer = window.setTimeout(refresh, 5000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && dialog().open) refresh(); });

function back() {
  state.ask = null;
  state.done = null;
  render();
  refresh();
}

// ---------- Desenho ----------

/** Mouse em cima ou foco dentro: a região espera. @param {HTMLElement | undefined} el */
const held = (el) => Boolean(el && (el.matches(':hover') || el.contains(document.activeElement)));
const focusKey = () => /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.focus;
/** @param {string | undefined} key */
const refocus = (key) => { if (key) /** @type {HTMLElement | null} */ (dialog().querySelector(`[data-focus="${CSS.escape(key)}"]`))?.focus(); };

/** Página inteira: cabeçalho, estado, abas e conteúdo; ou a confirmação; ou o resultado. */
function render() {
  const d = dialog();
  const focused = focusKey();
  const flow = state.ask || state.done || state.busy;
  const sub = h('p', { class: 'x-subtitle' });
  const now = h('section', { class: 'p-now', 'aria-label': t('perf.nowLabel') });
  const body = h('div', { class: 'x-body' });
  const foot = h('footer', { class: 'x-foot' });
  Object.assign(ui, { subtitle: sub, now, body, foot });
  d.replaceChildren(
    h('div', { class: 'welcome-drag', 'aria-hidden': 'true' }),
    h('div', { class: 'x-doc' },
      h('header', { class: 'x-head' },
        h('h1', { class: 'x-title', id: 'perf-title' }, svg('gauge', 20), h('span', {}, title())),
        sub),
      !flow && now,
      !flow && segmented({ label: t('perf.tabs'), value: state.tab, onChange: (tab) => { state.tab = tab; fill(body, bodyView); refocusTab(); },
        options: TABS.map((value) => ({ value, label: t(`perf.tab.${value}`), count: count(value) })) }),
      body),
    foot);
  fill(sub, () => [subtitle()]);
  if (!flow) fill(now, nowView);
  fill(body, flow ? flowView : bodyView);
  fill(foot, footView);
  if (focused) refocus(focused);
  else if (flow) /** @type {HTMLElement | null} */ (foot.querySelector('[data-autofocus]'))?.focus();
}

/** Atualização ao vivo: só as regiões que ninguém está usando. */
function update() {
  if (!ui.now?.isConnected) { render(); return; }
  const focused = focusKey();
  fill(ui.subtitle, () => [subtitle()]);
  for (const [el, view] of /** @type {const} */ ([[ui.now, nowView], [ui.body, bodyView], [ui.foot, footView]])) if (!held(el)) fill(el, view);
  // Contagens das abas acompanham a leitura.
  for (const [i, tab] of TABS.entries()) {
    const c = dialog().querySelectorAll('.x-doc > .seg .seg-option')[i]?.querySelector('.count');
    if (c) c.textContent = String(count(tab) ?? '');
  }
  if (focused) refocus(focused);
}

/** @param {HTMLElement | undefined} el @param {() => any[]} view */
function fill(el, view) { el?.replaceChildren(...view().filter(Boolean)); }
const refocusTab = () => /** @type {HTMLElement | null} */ (dialog().querySelector('.x-doc > .seg .seg-option[aria-checked="true"]'))?.focus();

/** @param {Tab} tab */
function count(tab) {
  const s = state.snap;
  const n = !s ? 0 : tab === 'dev' ? s.dev.length : tab === 'docker' ? s.docker.containers.length : tab === 'origin' ? s.tips.length : 0;
  return n || undefined;
}

function title() {
  const a = state.ask;
  if (a) return t(`perf.ask.${a.kind}`, { n: a.rows.length, name: a.rows[0]?.name ?? '' });
  if (state.done) return state.done.r.freed ? t('perf.done.freed', { bytes: state.done.r.freed }) : t('perf.done.title');
  return t('perf.title');
}

function subtitle() {
  if (state.ask) return t(state.ask.kind === 'force' ? 'perf.method.force' : state.ask.kind === 'stop' ? 'perf.method.stop' : state.ask.app ? 'perf.method.app' : 'perf.method.cli');
  if (state.done) return state.done.kind === 'stop' ? t('perf.done.dockerNote') : t('perf.done.text');
  const m = state.snap?.memory;
  if (!m) return t('perf.subtitle');
  if (m.pressure !== 'normal') return t(`perf.state.${m.pressure}`);
  return m.swapUsed > m.total / 2 ? t('perf.state.swap', { swap: m.swapUsed }) : t('perf.state.normal');
}

// ---------- Estado da memória e sugestões ----------

const clock = () => new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' });

/** @param {string} label @param {string} value @param {string} [sub] */
const stat = (label, value, sub = '') => h('div', { class: 'p-stat' }, h('dt', {}, label), h('dd', { class: 'num' }, value, sub && h('span', { class: 'p-stat-sub' }, ` ${sub}`)));

function nowView() {
  const s = state.snap;
  if (!s) return [placeholder()];
  const m = s.memory;
  const [tone, icon] = TONE[m.pressure];
  const now = Date.now();
  const time = clock();
  return [
    h('div', { class: 'p-state' },
      h('p', { class: `p-pressure tone-${tone}` }, svg(icon, 14), h('span', {}, t(`perf.pressure.${m.pressure}`))),
      h('dl', { class: 'p-stats' },
        stat(t('perf.stat.used'), formatBytes(m.used), t('perf.stat.of', { total: m.total })),
        stat(t('perf.stat.compressed'), formatBytes(m.compressed)),
        stat(t('perf.stat.cached'), formatBytes(m.cached)),
        stat(t('perf.stat.swap'), formatBytes(m.swapUsed), m.swapTotal ? t('perf.stat.of', { total: m.swapTotal }) : ''))),
    h('div', { class: 'p-chart' },
      timeChart(s.trend, { series: [{ key: 'used', label: t('perf.stat.used') }, { key: 'swap', label: t('perf.stat.swap') }], from: now - 15 * MIN, now,
        x: (at) => time.format(at), label: (_start, min, max) => t('perf.chart.label', { min, max }), title: t('perf.chart.title'), date: t('chart.date'), empty: t('perf.chart.empty') })),
    s.suggestions.length > 0 && h('div', { class: 'p-sug' },
      h('h2', { class: 'group-heading' }, h('span', { class: 'group-label' }, t('perf.sug.title'))),
      h('ul', { class: 'x-list' }, s.suggestions.map((x) => h('li', { class: 'x-row plain' }, h('span', { class: 'p-text' }, tx(x.text)), actionButton(x))))),
  ];
}

/** @param {Suggestion} x */
function actionButton(x) {
  const a = x.action;
  if (!a) return null;
  const run = () => (a.kind === 'open-docker' ? api.open('docker') : ask(a.kind === 'stop' ? 'stop' : 'end', a.ids));
  return button(tx(a.label), run, 'secondary small', { 'data-focus': `sug:${x.id}` });
}

function placeholder() {
  if (state.error) {
    return h('div', { class: 'x-state' }, h('p', { class: 'notice tone-attention' }, svg('warning', 14), h('span', {}, t('perf.error', { reason: state.error }))),
      button(t('explore.retry'), () => refresh(), 'secondary small'));
  }
  return h('div', { class: 'x-state', role: 'status' }, h('p', { class: 'x-loading' }, ring(16), h('span', {}, t('perf.loading'))));
}

// ---------- Abas ----------

function bodyView() {
  if (!state.snap) return [];
  if (state.tab === 'apps') return appsView(state.snap);
  if (state.tab === 'dev') return devView(state.snap);
  if (state.tab === 'docker') return dockerView(state.snap);
  if (state.tab === 'origin') return originView(state.snap);
  return autoView(state.snap);
}

/** @param {PerfGroup} g */
const groupName = (g) => (g.kind === 'system' ? t('perf.system') : g.kind === 'vm' ? t('perf.vm', { name: g.name || t('perf.vmUnknown') }) : g.name);
const lock = () => h('span', { class: 'x-lock', 'data-tip': t('perf.protectedTip'), 'aria-label': t('perf.protectedTip'), role: 'img' }, svg('lock-simple', 12));

/** @param {PerfSnapshot} s */
function appsView(s) {
  return [h('ul', { class: 'x-list' }, s.groups.map((g) => {
    const name = groupName(g);
    const open = state.open.has(g.id);
    const panel = uid('p-procs');
    const meta = [t('perf.procs', { n: g.count }), t('perf.cpu', { cpu: cpu(g.cpu) }), !g.exact && t('perf.approx')].filter(Boolean).join(' · ');
    const more = h('button', { type: 'button', class: 'icon-button small p-more', 'aria-expanded': String(open), 'aria-controls': panel,
      'aria-label': t('perf.showProcs', { name }), 'data-focus': `${g.id}:more`,
      onclick: () => { if (open) state.open.delete(g.id); else state.open.add(g.id); fill(ui.body, bodyView); refocus(`${g.id}:more`); } }, svg('caret-right', 12));
    return h('li', { class: 'p-group' },
      h('div', { class: 'x-row' }, more,
        h('span', { class: 'x-text' }, h('span', { class: 'x-name' }, name, g.protected && lock()), h('span', { class: 'x-meta' }, meta)),
        h('span', { class: 'x-size num' }, formatBytes(g.mem)),
        g.endable ? button(t('perf.end'), () => ask('end', [g.id]), 'quiet small', { 'aria-label': t('perf.endName', { name }), 'data-focus': `${g.id}:end` }) : h('span')),
      open && h('ul', { class: 'p-procs', id: panel }, g.top.map((p) => h('li', {},
        h('span', { class: 'p-proc' }, p.name), h('span', { class: 'mono' }, String(p.pid)), h('span', { class: 'num' }, t('perf.cpu', { cpu: cpu(p.cpu) })),
        h('span', { class: 'num' }, formatBytes(p.mem))))));
  }))];
}

/** @param {DevRow} r */
function devRow(r) {
  const name = `${t(`perf.kind.${r.kind}`)} · ${r.name}`;
  const meta = [r.projects.join(', '), r.host && t('perf.dev.in', { host: r.host }), t('perf.dev.since', { since: r.since })].filter(Boolean).join(' · ');
  return h('li', { class: 'x-row' },
    h('span', { class: 'x-lock', 'aria-hidden': 'true' }, svg('terminal-window', 14)),
    h('span', { class: 'x-text' },
      h('span', { class: 'x-name' }, name,
        r.count > 1 && h('span', { class: 'badge num' }, `×${r.count}`),
        r.orphan && h('span', { class: 'badge p-orphan', tabindex: '0', 'data-tip': t('perf.orphanTip'), 'data-focus': `${r.id}:orphan` }, t('perf.orphan')),
        r.protected && lock()),
      h('span', { class: 'x-meta' }, meta)),
    h('span', { class: 'x-size num' }, formatBytes(r.mem)),
    button(t('perf.end'), () => ask('end', [r.id]), 'quiet small', { 'aria-label': t('perf.endName', { name }), 'data-focus': `${r.id}:end` }));
}

/** @param {PerfSnapshot} s */
function devView(s) {
  const lost = s.dev.filter((r) => r.orphan);
  const n = lost.reduce((sum, r) => sum + r.count, 0);
  return [
    h('div', { class: 'x-tools' }, h('p', { class: 'x-explain' }, t('perf.dev.explain')),
      lost.length > 0 && button(t('perf.dev.endOrphans', { n, bytes: lost.reduce((sum, r) => sum + r.mem, 0) }), () => ask('end', lost.map((r) => r.id)), 'secondary small', { 'data-focus': 'dev:orphans' })),
    s.dev.length ? h('ul', { class: 'x-list' }, s.dev.map(devRow)) : h('p', { class: 'x-empty' }, t('perf.dev.empty')),
  ];
}

/** @param {PerfSnapshot} s */
function dockerView(s) {
  const d = s.docker;
  const total = s.memory.total;
  if (!d.installed) return [h('p', { class: 'x-empty' }, t('perf.docker.none'))];
  const limit = d.limit ? t('perf.docker.limit', { limit: d.limit, total }) : t('perf.docker.limitDefault', { limit: total / 2, total });
  if (!d.running) return [h('p', { class: 'x-explain' }, t('perf.docker.closed'), ' ', limit)];
  const now = Date.now();
  const quiet = d.containers.filter((c) => c.idleSince !== null && now - c.idleSince > 15 * MIN);
  return [
    h('div', { class: 'x-tools' },
      h('p', { class: 'x-explain' }, d.vm ? t('perf.docker.vm', { limit: d.limit ?? total / 2, vm: d.vm }) : t('perf.docker.reserve', { limit: d.limit ?? total / 2 })),
      quiet.length > 0 && button(t('perf.stopN', { n: quiet.length }), () => ask('stop', quiet.map((c) => c.id)), 'secondary small', { 'data-focus': 'docker:quiet' }),
      d.appId && button(t('perf.docker.quit'), () => ask('end', [/** @type {string} */ (d.appId)]), 'secondary small', { 'data-focus': 'docker:quit' })),
    d.containers.length ? h('ul', { class: 'x-list' }, d.containers.map((c) => h('li', { class: 'x-row' },
      h('span', { class: 'x-lock', 'aria-hidden': 'true' }, svg('shipping-container', 14)),
      h('span', { class: 'x-text' }, h('span', { class: 'x-name' }, c.name, c.protected && lock()),
        h('span', { class: 'x-meta' }, [c.image, t('perf.cpu', { cpu: cpu(c.cpu) }), c.idleSince !== null && now - c.idleSince > MIN && t('perf.docker.idle', { since: c.idleSince })].filter(Boolean).join(' · '))),
      h('span', { class: 'x-size num' }, formatBytes(c.mem)),
      button(t('perf.stop'), () => ask('stop', [c.id]), 'quiet small', { 'aria-label': t('perf.stopName', { name: c.name }), 'data-focus': `${c.id}:stop` }))))
      : h('p', { class: 'x-empty' }, t('perf.docker.noContainers')),
  ];
}

/** @param {PerfSnapshot} s */
function originView(s) {
  if (!s.tips.length) return [h('p', { class: 'x-empty' }, t('perf.origin.empty'))];
  return [
    h('p', { class: 'x-explain' }, t('perf.origin.explain')),
    h('ul', { class: 'x-list' }, s.tips.map((x) => h('li', { class: 'p-tip' },
      h('div', { class: 'x-row plain' }, h('span', { class: 'p-text' }, tx(x.text)), actionButton(x)),
      ...(x.how ? disclosure({ label: t('perf.how'), content: h('p', { class: 'p-how' }, tx(x.how)) }) : [])))),
  ];
}

// ---------- Automação ----------

/** Manda só o que mudou: a barra de menus pode ter mexido no resto. @param {import('../types.js').PerfPatch} perf */
async function save(perf) {
  const prefs = await api.setPrefs({ perf });
  if (state.snap) state.snap.prefs = prefs.perf;
  const focused = focusKey();
  fill(ui.body, bodyView);
  refocus(focused);
}

/** @param {RuleId} id @param {Partial<import('../types.js').Rule>} patch */
function saveRule(id, patch) {
  save({ rules: { [id]: patch } });
}

/** @param {PerfSnapshot} s @param {RuleId} id */
function ruleView(s, id) {
  const r = s.prefs.rules[id];
  const label = `rule-${id}`;
  const half = s.memory.total / 2;
  const sw = toggle({ checked: r.on, labelledBy: label, describedBy: `${label}-text`, onChange: (on) => saveRule(id, { on }) });
  sw.dataset.focus = `${label}:on`;
  const trigger = id !== 'containers' && select({ value: r.trigger, labelledBy: `${label} ${label}-trigger`,
    options: TRIGGERS.map((v) => ({ value: v, label: t(`perf.trigger.${v}`, { half }) })), onChange: (v) => saveRule(id, { trigger: v }) });
  const minutes = select({ value: r.minutes, labelledBy: `${label} ${label}-minutes`,
    options: MINUTES[id].map((m) => ({ value: /** @type {number} */ (m), label: t(id === 'containers' ? 'perf.idleFor' : 'perf.for', { n: m }) })), onChange: (v) => saveRule(id, { minutes: v }) });
  const mode = id !== 'alert' && segmented({ label: t('perf.rule.mode'), value: r.mode, onChange: (v) => saveRule(id, { mode: v }),
    options: [{ value: /** @type {const} */ ('notify'), label: t('perf.rule.notify') }, { value: /** @type {const} */ ('act'), label: t('perf.rule.act') }] });
  return h('div', { class: 'setting column p-rule', 'data-off': !s.prefs.auto || undefined },
    h('div', { class: 'p-rule-head' },
      h('div', {}, h('div', { class: 'setting-label', id: label }, t(`perf.rule.${id}`)), h('p', { class: 'setting-text', id: `${label}-text` }, t(`perf.rule.${id}Text`))),
      sw),
    r.on && h('div', { class: 'p-rule-controls' },
      h('span', { class: 'sr-only', id: `${label}-trigger` }, t('perf.rule.trigger')), h('span', { class: 'sr-only', id: `${label}-minutes` }, t('perf.rule.minutes')),
      trigger, minutes, mode));
}

/** @param {PerfSnapshot} s */
function autoView(s) {
  const p = s.prefs;
  const master = toggle({ checked: p.auto, labelledBy: 'perf-auto', describedBy: 'perf-auto-text', onChange: (auto) => save({ auto }) });
  master.dataset.focus = 'perf-auto:on';
  const taken = new Set(p.protected.map((x) => x.toLowerCase()));
  const names = [...new Set([...s.groups.filter((g) => g.kind === 'app' || g.kind === 'cli').map((g) => g.name), ...s.dev.map((r) => r.name), ...s.docker.containers.map((c) => c.name)])]
    .filter((x) => x && !taken.has(x.toLowerCase())).slice(0, 24);
  return [
    h('div', { class: 'setting' }, h('div', {}, h('div', { class: 'setting-label', id: 'perf-auto' }, t('perf.auto')), h('p', { class: 'setting-text', id: 'perf-auto-text' }, t('perf.autoText'))), master),
    ...(/** @type {const} */ (['alert', 'orphans', 'containers'])).map((id) => ruleView(s, id)),
    h('h2', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, t('perf.protected'))),
    h('p', { class: 'x-explain' }, t('perf.protectedText')),
    h('ul', { class: 'p-chips' },
      p.protected.map((name) => h('li', { class: 'p-chip' }, h('span', {}, name),
        h('button', { type: 'button', class: 'p-chip-x', 'aria-label': t('perf.unprotect', { name }), 'data-tip': t('perf.unprotect', { name }), 'data-focus': `chip:${name}`,
          onclick: () => save({ protected: p.protected.filter((x) => x !== name) }) }, svg('x', 12)))),
      names.length > 0 && h('li', {}, menu({ label: t('perf.protectAdd'), icon: 'plus', items: names.map((name) => ({ label: name, icon: 'lock-simple', onSelect: () => save({ protected: [...p.protected, name] }) })) }))),
    h('h2', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, t('perf.log'))),
    s.log.length ? h('ul', { class: 'x-list' }, s.log.map((l) => h('li', { class: 'x-row plain' },
      h('span', { class: 'x-text' }, h('span', { class: 'p-text' }, tx(l.what)),
        h('span', { class: 'x-meta' }, [t('perf.log.at', { at: l.at }), t(l.auto ? 'perf.log.auto' : 'perf.log.you'), l.why && tx(l.why)].filter(Boolean).join(' · '))),
      h('span', { class: 'x-size num' }, l.freed ? formatBytes(l.freed) : ''))))
      : h('p', { class: 'x-empty' }, t('perf.log.empty')),
  ];
}

// ---------- Confirmar, encerrar, resultado ----------

/** Confirmação com a lista exata da última leitura. @param {Kind} kind @param {string[]} ids */
function ask(kind, ids) {
  const s = state.snap;
  if (!s) return;
  const rows = ids.flatMap((id) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) return [{ name: `${groupName(g)} · ${t('perf.procs', { n: g.count })}`, mem: g.mem, app: g.kind === 'app' }];
    const r = s.dev.find((x) => x.id === id);
    if (r) return [{ name: `${t(`perf.kind.${r.kind}`)} · ${r.name}${r.count > 1 ? ` ×${r.count}` : ''}`, mem: r.mem, app: false }];
    const c = s.docker.containers.find((x) => x.id === id);
    return c ? [{ name: c.name, mem: c.mem, app: false }] : [];
  });
  if (!rows.length) return;
  state.ask = { kind, ids, rows: rows.map(({ name, mem }) => ({ name, mem })), app: rows.some((r) => r.app) };
  render();
}

async function go() {
  const a = state.ask;
  if (!a) return;
  state.busy = true;
  render();
  try {
    const r = await api.perf(a.kind, a.ids);
    state.done = { kind: a.kind, r };
    say(r.freed ? t('perf.done.freed', { bytes: r.freed }) : t('perf.done.title'));
  } catch (e) {
    state.error = reason(e);
  }
  state.ask = null;
  state.busy = false;
  render();
}

function flowView() {
  if (state.busy) return [h('div', { class: 'x-state', role: 'status' }, h('p', { class: 'x-loading' }, ring(16), h('span', {}, t(state.ask?.kind === 'stop' ? 'perf.stopping' : 'perf.ending'))))];
  const a = state.ask;
  if (a) {
    const total = a.rows.reduce((s, r) => s + (r.mem ?? 0), 0);
    return [
      h('ul', { class: 'x-list' }, a.rows.map((r) => h('li', { class: 'x-row plain' }, h('span', { class: 'x-name' }, r.name), h('span', { class: 'x-size num' }, r.mem ? formatBytes(r.mem) : '')))),
      total > 0 && h('p', { class: 'x-explain' }, t(a.kind === 'stop' ? 'perf.ask.totalDocker' : 'perf.ask.total', { bytes: total })),
    ];
  }
  const r = state.done?.r;
  if (!r) return [];
  /** @param {Parameters<typeof svg>[0]} icon @param {string} tone @param {string} name @param {string} text */
  const line = (icon, tone, name, text) => h('li', { class: 'x-row plain' },
    h('span', { class: 'x-name' }, h('span', { class: `tone-${tone}`, 'aria-hidden': 'true' }, svg(icon, 14)), name), h('span', { class: 'x-meta' }, text));
  return [h('ul', { class: 'x-list' },
    r.ended.map((x) => line('check-circle', 'safe', x.name, x.freed ? formatBytes(x.freed) : t('perf.done.gone'))),
    r.stuck.map((x) => line('warning', 'attention', x.name, t('perf.done.stuck'))),
    r.refused.map((x) => line('lock-simple', 'muted', x.name, tx(x.why))))];
}

function footView() {
  if (state.busy) return [h('span', { class: 'spacer' })];
  const a = state.ask;
  if (a) {
    const go_ = button(t(`perf.go.${a.kind}`, { n: a.rows.length }), go, a.kind === 'force' ? 'quiet danger' : 'primary', { disabled: a.kind === 'force' });
    const back_ = button(t('explore.back'), back, 'secondary', { 'data-autofocus': true });
    if (a.kind !== 'force') return [h('span', { class: 'spacer' }), back_, go_];
    const accept = checkbox({ labelledBy: 'p-accept', onChange: (on) => { go_.disabled = !on; } });
    return [h('div', { class: 'confirm-check' }, accept, h('span', { id: 'p-accept', onclick: () => accept.click() }, t('perf.accept'))), h('span', { class: 'spacer' }), back_, go_];
  }
  const d = state.done;
  if (d) {
    const stuck = d.r.stuck;
    return [h('span', { class: 'spacer' }),
      stuck.length > 0 && button(t('perf.forceN', { n: stuck.length }), () => {
        state.done = null;
        state.ask = { kind: 'force', ids: stuck.map((x) => x.id), rows: stuck.map((x) => ({ name: x.name, mem: null })), app: false };
        render();
      }, 'secondary'),
      button(t('perf.done.close'), back, 'primary', { 'data-autofocus': true })];
  }
  const self = state.snap?.self;
  return [h('p', { class: 'x-picked' }, self ? t('perf.self', { mem: self.mem, cpu: cpu(self.cpu) }) : ''),
    button(t('explore.close'), () => dialog().close(), 'secondary')];
}
