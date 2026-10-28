// Tela principal e o sheet único (detalhe → confirmação → resultado). Texto dinâmico entra só por textContent.
import { button, checkbox, disclosure, h, installTooltips, menu, searchField, segmented, select, svg, toggle } from './controls.js';
import { LANGUAGE_NAMES, formatBytes, formatDateTime, has, resolveLocale, setLocale, t, template, tx } from '../shared/i18n.js';
import { freeChart } from './chart.js';
import { hero, ring } from './loader.js';
import { openWelcome, refreshWelcome } from './welcome.js';
import { countTo, leave, morph, swap } from './motion.js';

/**
 * @typedef {import('../types.js').Category} Category
 * @typedef {import('../types.js').Item} Item
 * @typedef {import('../types.js').CleanResult} CleanResult
 * @typedef {import('./controls.js').IconName} IconName
 * @typedef {import('../types.js').Text} Text
 */

const api = window.respiro;
const ICONS = /** @type {const} */ ({
  packages: 'package', docker: 'shipping-container', node: 'tree-structure', xcode: 'hammer',
  browsers: 'browsers', homebrew: 'beer-stein', appcaches: 'stack', trash: 'trash',
});
const ORDER = Object.keys(ICONS);

const state = {
  /** @type {import('../types.js').Disk | null} */ disk: null,
  /** @type {Map<string, Category>} */ categories: new Map(),
  /** @type {import('../types.js').State['catalog']} */ catalog: [],
  /** Primeira análise: categoria → 'pending' | 'done' | 'absent'. Vazio quando já existe resultado. */
  /** @type {Map<string, string>} */ checklist: new Map(),
  scanAt: 0,
  scanning: true,
  fullDiskAccess: false,
  progress: { done: 0, total: 0 },
  /** @type {import('../types.js').HistoryEntry[]} */ history: [],
  /** @type {import('../types.js').Sample[]} */ samples: [],
  /** @type {import('../types.js').Prefs} */ prefs: { simulate: false, staleDays: 30, theme: 'system', scanOnLaunch: true, ignored: [], locale: 'system',
    onboarded: true, showInMenuBar: true, openAtLogin: false, lowDiskAlert: 10 },
};

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @param {number} [size] */
const catIcon = (id, size = 16) => svg(ICONS[/** @type {keyof typeof ICONS} */ (id)] ?? 'stack', size);
/** Caminho de pasta vai em Geist Mono. @param {Text | undefined} text */
const isPath = (text) => typeof text === 'string' && (text.startsWith('~/') || text.startsWith('/'));
/** @param {string} id */
const catName = (id) => t(`cat.${id}.name`);
/** Categoria do item ignorado: versões antigas guardavam o nome em português. @param {string} value */
const ignoredCategory = (value) => (has(`cat.${value}.name`) ? catName(value) : value);

/**
 * Frase traduzida com elementos encaixados nos marcadores (ex.: número que conta dentro do texto).
 * @param {string} key @param {Record<string, any>} parts nós ou textos por marcador @param {number} [n]
 */
function rich(key, parts, n) {
  return template(key, n).split(/(\{\w+(?:\|\w+)?\})/).filter(Boolean).map((chunk) => {
    const name = /^\{(\w+)/.exec(chunk)?.[1];
    return name && name in parts ? parts[name] : chunk;
  });
}

/** Aplica o idioma e traduz os textos fixos do index.html. */
function applyLocale() {
  setLocale(resolveLocale(state.prefs.locale, navigator.language));
  document.documentElement.lang = resolveLocale(state.prefs.locale, navigator.language);
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]'))) el.textContent = t(el.dataset.i18n ?? '');
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n-attr]'))) {
    for (const pair of (el.dataset.i18nAttr ?? '').split(',')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  }
}

/** @param {string} text */
function announce(text) {
  const el = byId('announce');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

// ---------- Regras de exibição ----------

/** @param {Category} c @param {Item} i */
const ref = (c, i) => `${c.id}/${i.id}`;
/** @param {Category} c */
const safeItems = (c) => c.items.filter((i) => i.safe && i.action && !i.individual);
/** Itens da lista: ações da categoria (tool) ficam de fora. @param {Category} c */
const listed = (c) => c.items.filter((i) => !i.tool);
/** @param {Item[]} items */
const freeable = (items) => items.reduce((sum, i) => sum + (i.freeable ?? 0), 0);
/** @param {Item[]} items */
const unknowns = (items) => items.filter((i) => i.freeable === null).length;
/** @param {Item} i */
const releases = (i) => (i.action?.kind === 'trash' ? i.size : i.freeable ?? 0);
const sorted = () => [...state.categories.values()].sort((a, b) => b.size - a.size);
const firstScan = () => state.checklist.size > 0;

/** @param {string} r */
function lookup(r) {
  const slash = r.indexOf('/');
  const category = state.categories.get(r.slice(0, slash));
  const item = category?.items.find((i) => i.id === r.slice(slash + 1));
  return category && item ? { category, item, ref: r } : null;
}

// ---------- Tela principal ----------

function render() {
  renderChrome();
  renderDisk();
  renderSafe();
  morph(renderList);
}

function renderChrome() {
  const progress = byId('progress');
  progress.toggleAttribute('data-active', state.scanning);
  const { done, total } = state.progress;
  if (!progress.firstChild) progress.append(ring(18));
  progress.style.setProperty('--p', String(total ? Math.max(6, Math.round((done / total) * 89)) : 6));
  progress.setAttribute('aria-valuemax', String(total || 1));
  progress.setAttribute('aria-valuenow', String(done));
  progress.setAttribute('aria-hidden', String(!state.scanning));
  /** @type {HTMLButtonElement} */ (byId('btn-rescan')).disabled = state.scanning;
  byId('sim-pill').hidden = !state.prefs.simulate;
  byId('footer').textContent = state.scanning
    ? (total ? t('footer.scanningCount', { done, total }) : t('footer.scanning'))
    : state.scanAt ? t('footer.updated', { at: state.scanAt }) : '';
  byId('categories').setAttribute('aria-busy', String(state.scanning));
}

function renderDisk() {
  const { disk } = state;
  if (!disk) return;
  byId('disk-name').textContent = disk.name;
  countTo(byId('disk-free'), disk.free, formatBytes);
  byId('disk-total').textContent = t('disk.ofTotal', { total: disk.total });

  const used = disk.total - disk.free;
  const cats = ORDER.map((id) => state.categories.get(id)).filter((c) => c && c.size > 0).map((c) => /** @type {Category} */ (c));
  const counted = cats.reduce((sum, c) => sum + c.size, 0);
  const segments = [
    ...cats.map((c) => ({ id: c.id, name: catName(c.id), size: c.size })),
    { id: 'system', name: t(firstScan() ? 'disk.used' : 'disk.system'), size: Math.max(0, used - counted) },
    { id: 'free', name: t('disk.free'), size: disk.free },
  ];

  // Segmentos reaproveitados: a largura anima de onde estava (e cresce do zero na primeira vez).
  const bar = byId('bar');
  const existing = new Map([...bar.children].map((el) => [/** @type {HTMLElement} */ (el).dataset.cat, /** @type {HTMLElement} */ (el)]));
  bar.replaceChildren(...segments.map((s) => {
    const el = existing.get(s.id) ?? h('span', { class: 'segment', 'data-cat': s.id });
    el.dataset.tip = `${s.name} · ${formatBytes(s.size)}`;
    return el;
  }));
  requestAnimationFrame(() => {
    for (const s of segments) {
      if (s.id !== 'free') /** @type {HTMLElement | null} */ (bar.querySelector(`[data-cat="${s.id}"]`))?.style.setProperty('--w', `${(s.size / disk.total) * 100}%`);
    }
  });
  bar.setAttribute('aria-label', t('disk.barLabel', { name: disk.name, free: disk.free, total: disk.total,
    segments: segments.filter((s) => s.id !== 'free').map((s) => `${s.name}, ${formatBytes(s.size)}`).join('; ') }));

  byId('legend').replaceChildren(...segments.map((s) =>
    h('li', { 'data-cat': s.id }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, s.name), h('span', { class: 'num' }, formatBytes(s.size)))));
}

function renderSafe() {
  const items = sorted().flatMap(safeItems);
  const total = freeable(items);
  const unknown = unknowns(items);
  const value = byId('safe-value');
  const note = byId('safe-note');
  const free = byId('btn-free');
  free.textContent = t(state.prefs.simulate ? 'safe.simulate' : 'safe.review');

  // Primeira análise: o número ainda não existe; a marca ocupa o lugar dele. Mesmo elemento entre renders,
  // para a abertura não recomeçar a cada categoria que termina.
  const loader = byId('safe-loader');
  loader.hidden = !firstScan();
  byId('safe-text').hidden = firstScan();
  if (firstScan()) {
    if (loader.dataset.text !== t('safe.summing')) {
      loader.dataset.text = t('safe.summing');
      loader.replaceChildren(hero(t('safe.summing')));
    }
    free.hidden = true;
    return;
  }
  loader.replaceChildren();
  delete loader.dataset.text;
  free.hidden = !items.length;
  value.hidden = !items.length || !total;
  if (!value.hidden) countTo(value, total, formatBytes);
  if (!items.length) note.textContent = t(state.scanning ? 'safe.stillScanning' : 'safe.nothing');
  else note.textContent = !unknown ? '' : t(total ? 'safe.plusUnknown' : 'safe.onlyUnknown');
}

/** @param {Category} c */
function rowSummary(c) {
  if (c.status !== 'ok') return { tone: 'attention', icon: /** @type {IconName} */ ('info'), text: tx(c.message) };
  if (c.id === 'trash') return { tone: '', icon: null, text: t('row.trash', { detail: c.items[0]?.detail ?? '' }) };
  const safe = safeItems(c);
  const bytes = freeable(safe);
  if (safe.length) {
    const text = bytes ? t(unknowns(safe) ? 'row.safeUnknown' : 'row.safe', { bytes }) : t('row.safeOnlyUnknown');
    return { tone: 'safe', icon: /** @type {IconName} */ ('check-circle'), text };
  }
  const attention = listed(c).filter((i) => !i.safe && i.action && !i.inUse).length;
  if (attention) return { tone: 'attention', icon: /** @type {IconName} */ ('warning'), text: t('row.attention', { n: attention }) };
  const inUse = c.items.filter((i) => i.inUse).length;
  return { tone: '', icon: null, text: inUse ? t('row.inUse', { n: inUse }) : t('row.nothing') };
}

/** @param {Category} c */
function rowAction(c) {
  if (c.status === 'unavailable' && c.id === 'docker') return button(t('row.openDocker'), () => api.open('docker'), 'quiet small');
  if (c.status === 'needs-access') return button(t('row.openSettings'), () => api.open('full-disk-access'), 'quiet small');
  if (c.status === 'error') return button(t('row.retry'), rescan, 'quiet small');
  const empty = c.id === 'trash' && c.items[0];
  if (empty) return button(t('row.empty'), () => confirmIndividual(c, empty), 'quiet small danger', { 'aria-label': t('row.emptyLabel'), 'data-role': 'free' });
  const safe = safeItems(c);
  if (c.status !== 'ok' || !safe.length) return h('span');
  return button(t('row.clean'), () => confirmClean(safe.map((i) => ref(c, i))), 'quiet small', { 'aria-label': t('row.cleanLabel', { name: catName(c.id) }), 'data-role': 'free' });
}

/** @param {Category} c */
function row(c) {
  const sum = rowSummary(c);
  return h('li', { class: 'row', 'data-cat': c.id },
    h('button', { type: 'button', class: 'row-main', 'data-role': 'main', onclick: () => openDetail(c.id),
      'aria-label': t('row.label', { name: catName(c.id), size: c.status === 'ok' ? formatBytes(c.size) : '', summary: sum.text }) }),
    h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, catIcon(c.id)),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, catName(c.id)),
      h('span', { class: `row-sub ${sum.tone ? `tone-${sum.tone}` : ''}` }, sum.icon && svg(sum.icon, 14), h('span', {}, sum.text))),
    h('span', { class: 'row-size' }, c.status === 'ok' ? formatBytes(c.size) : '—'),
    rowAction(c),
    h('span', { class: 'chevron', 'aria-hidden': 'true' }, svg('caret-right', 12)));
}

/** Linha da lista de verificação da primeira análise: posição fixa, só o conteúdo muda. @param {{ id: string }} entry */
function checklistRow(entry) {
  const status = state.checklist.get(entry.id) ?? 'pending';
  const c = state.categories.get(entry.id);
  const name = catName(entry.id);
  const sub = status === 'pending' ? [ring(12), h('span', {}, t('checklist.scanning'))]
    : status === 'absent' ? [h('span', {}, t('checklist.absent'))]
      : c ? [rowSummary(c).text] : [];
  const label = status === 'pending' ? t('checklist.labelScanning', { name }) : status === 'absent' ? t('checklist.labelAbsent', { name }) : `${name}: ${formatBytes(c?.size ?? 0)}`;
  return h('li', { class: `row checklist ${status}`, 'data-cat': entry.id, 'aria-label': label },
    h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, catIcon(entry.id)),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-sub' }, sub)),
    h('span', { class: 'row-size' }, status === 'done' && c ? formatBytes(c.size) : ''),
    h('span'), h('span'));
}

function renderList() {
  const list = byId('categories');
  if (firstScan()) {
    list.replaceChildren(...state.catalog.map(checklistRow));
    return;
  }
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const current = /** @type {HTMLElement | null} */ (active?.closest('.row') ?? null);
  const focus = current && { cat: current.dataset.cat, role: active?.dataset.role };
  const rows = sorted().map(row);
  for (const el of rows) el.style.setProperty('view-transition-name', `row-${el.dataset.cat}`);
  list.replaceChildren(...rows);
  if (focus) {
    /** @type {HTMLElement | null} */ (list.querySelector(`[data-cat="${focus.cat}"] [data-role="${focus.role}"]`)
      ?? list.querySelector(`[data-cat="${focus.cat}"] .row-main`))?.focus();
  }
}

// ---------- Sheet único ----------
// Uma camada só: detalhe, confirmação, resultado, ajustes e histórico trocam de conteúdo no mesmo sheet.
// Esc e "Voltar" voltam um passo; sem passo anterior, fecham.

const sheet = /** @type {HTMLDialogElement} */ (byId('sheet'));
/** @type {(() => void) | null} */
let back = null;
/** @type {Element | null} */
let opener = null;
/** Mudanças que esperam o sheet fechar para animar na lista. */
let pendingRender = false;

sheet.addEventListener('cancel', (e) => {
  if (sheet.dataset.busy || back) e.preventDefault();
  if (!sheet.dataset.busy && back) back();
});
sheet.addEventListener('click', (e) => { if (e.target === sheet && !sheet.dataset.busy) sheet.close(); });
sheet.addEventListener('close', () => {
  back = null;
  /** @type {HTMLElement | null} */ (opener)?.focus?.();
  if (pendingRender) {
    pendingRender = false;
    render();
  }
});

/** Abre o sheet, ou troca o conteúdo com transição. @param {string} titleId @param {(() => void) | null} previous @param {...any} content */
async function present(titleId, previous, ...content) {
  const inner = h('div', { class: 'sheet-inner' }, ...content);
  back = previous;
  sheet.setAttribute('aria-labelledby', titleId);
  if (sheet.open) {
    await swap(sheet, inner);
  } else {
    sheet.replaceChildren(inner);
    opener = document.activeElement;
    sheet.showModal();
  }
  /** @type {HTMLElement | null} */ (inner.querySelector('[data-autofocus]'))?.focus();
}

/** @param {string} id @param {string} title @param {string} [text] @param {any} [lead] */
const head = (id, title, text, lead) =>
  h('div', { class: 'sheet-head' }, lead, h('div', {}, h('h2', { class: 'sheet-title', id }, title), text && h('p', { class: 'sheet-text' }, text)));

/** "Voltar" quando há passo anterior; senão "Cancelar". */
const backButton = (/** @type {(() => void) | null} */ previous, /** @type {Record<string, any>} */ attrs = {}) =>
  button(t(previous ? 'sheet.back' : 'sheet.cancel'), () => (previous ? previous() : sheet.close()), 'secondary', attrs);

/** @param {Item} item */
function itemMeta(item) {
  return h('span', { class: 'item-meta' },
    item.detail && h('span', { class: isPath(item.detail) ? 'mono' : '' }, tx(item.detail)),
    item.detail && item.lastUsed ? ' · ' : '',
    item.lastUsed ? t('item.used', { at: item.lastUsed }) : '');
}

/** @param {Item} item */
function itemNote(item) {
  if (!item.note) return null;
  const tone = !item.action ? '' : !item.safe ? 'tone-attention' : '';
  const glyph = !item.action ? 'lock-simple' : item.admin ? 'lock-simple' : !item.safe ? 'warning' : 'info';
  return h('span', { class: `item-note ${tone}` }, svg(glyph, 14), h('span', {}, tx(item.note)));
}

/** @param {Item} item */
function parts(item) {
  if (!item.parts?.length) return null;
  const [trigger, panel] = disclosure({
    label: h('span', {}, t('item.seeParts', { n: item.parts.length })),
    content: h('ul', { class: 'parts' }, item.parts.slice(0, 200).map((p) =>
      h('li', {}, h('span', { class: isPath(p.name) ? 'mono' : '' }, p.name), h('span', { class: 'num' }, formatBytes(p.size))))),
  });
  return h('div', { class: 'parts-wrap' }, trigger, panel);
}

/**
 * Linha de item do detalhe.
 * @param {Category} c @param {Item} item
 * @param {{ selected: Set<string>, update: () => void, showNote: boolean, onIgnore: (item: Item) => void }} o
 */
function itemRow(c, item, { selected, update, showNote, onIgnore }) {
  const nameId = `name-${c.id}-${item.id}`.replace(/[^\w-]/g, '_');
  const box = item.action && !item.individual
    ? checkbox({ checked: selected.has(item.id), labelledBy: nameId, onChange: (on) => { if (on) selected.add(item.id); else selected.delete(item.id); update(); } })
    : null;
  const control = box ? h('span', { class: 'control' }, box)
    : !item.action ? h('span', { class: 'control', 'aria-hidden': 'true' }, svg('lock-simple', 14)) : h('span', { class: 'control' });
  const actions = [];
  const name = tx(item.name);
  if (item.individual) {
    const trash = c.id === 'trash';
    actions.push(button(t(trash ? 'item.empty' : 'item.delete'), () => confirmIndividual(c, item, () => openDetail(c.id)), 'quiet small danger',
      { 'aria-label': t(trash ? 'item.emptyLabel' : 'item.deleteLabel', { name }) }));
  }
  const path = item.path;
  actions.push(menu({ label: t('item.actions', { name }), icon: 'dots-three', items: [
    ...(path ? [
      { label: t('item.reveal'), icon: /** @type {IconName} */ ('folder-open'), onSelect: () => api.reveal(ref(c, item)) },
      { label: t('item.copyPath'), icon: /** @type {IconName} */ ('copy'), onSelect: () => { navigator.clipboard.writeText(path); announce(t('item.copied')); } },
    ] : []),
    { label: t('item.ignore'), icon: 'eye-slash', onSelect: () => onIgnore(item) },
  ] }));
  return h('li', { class: 'item', 'data-ref': ref(c, item) },
    control,
    h('div', { class: 'item-text' },
      h('span', { class: 'item-name', id: nameId, onclick: () => box?.click() }, name),
      itemMeta(item), showNote && itemNote(item), parts(item)),
    h('span', { class: 'item-size' }, formatBytes(item.size)),
    h('span', { class: 'item-actions' }, actions));
}

/**
 * Detalhe da categoria. Depois de uma limpeza, volta mostrando os itens limpos saindo da lista.
 * @param {string} id @param {{ snapshot?: Category, leaving?: Set<string> }} [after]
 */
async function openDetail(id, after = {}) {
  const full = after.snapshot ?? state.categories.get(id);
  if (!full) return;
  const c = { ...full, items: listed(full) };
  const leaving = after.leaving ?? new Set();
  const selected = new Set(safeItems(c).filter((i) => !leaving.has(ref(c, i))).map((i) => i.id));
  const total = h('span', { class: 'total', 'aria-live': 'polite' });
  const go = button(t(state.prefs.simulate ? 'detail.simulateSelected' : 'detail.cleanSelected'),
    () => confirmClean([...selected].map((i) => `${c.id}/${i}`), () => openDetail(id)), 'primary', { 'data-autofocus': selected.size > 0 });

  const update = () => {
    const chosen = c.items.filter((i) => selected.has(i.id));
    const bytes = chosen.reduce((s, i) => s + releases(i), 0);
    const amount = bytes ? (unknowns(chosen) ? t('detail.amountPlus', { bytes }) : formatBytes(bytes)) : t('detail.amountOnlyUnknown');
    total.textContent = chosen.length ? t('detail.selection', { count: t('detail.count', { n: chosen.length }), amount }) : t('detail.nothingSelected');
    go.disabled = !chosen.length;
  };

  // Grupos: o que sai sem risco, o que pede um olhar, e o que está em uso (recolhido; limpável por escolha).
  /** @type {Record<string, (i: Item) => boolean>} */
  const kinds = {
    all: () => true,
    safe: (i) => Boolean(i.action && i.safe && !i.individual),
    attention: (i) => Boolean(i.action && !i.safe && !i.inUse),
    inUse: (i) => Boolean(i.inUse || !i.action),
  };
  const view = { filter: 'all', query: '', sort: 'size' };
  const list = h('div', { class: 'detail-list' });
  const selectable = (/** @type {Item} */ i) => Boolean(i.action && !i.individual);

  const onIgnore = async (/** @type {Item} */ item) => {
    const entry = { ref: ref(c, item), name: tx(item.name), category: c.id };
    state.prefs = await api.setPrefs({ ignored: [...state.prefs.ignored, entry] });
    for (const cat of [c, state.categories.get(c.id)]) if (cat) cat.items = cat.items.filter((i) => i.id !== item.id);
    selected.delete(item.id);
    pendingRender = true;
    const el = /** @type {HTMLElement | null} */ (list.querySelector(`.item[data-ref="${CSS.escape(entry.ref)}"]`));
    if (el) leave(el);
    update();
    announce(t('detail.ignored', { name: entry.name }));
  };

  /** @param {Item[]} items @param {boolean} showNote */
  const ul = (items, showNote) => h('ul', { class: 'items' }, items.map((item) => itemRow(c, item, { selected, update, showNote, onIgnore })));

  const draw = () => {
    const match = (/** @type {Item} */ i) => !view.query || `${tx(i.name)} ${tx(i.detail)}`.toLowerCase().includes(view.query);
    /** @type {Record<string, (a: Item, b: Item) => number>} */
    const order = {
      size: (a, b) => b.size - a.size,
      age: (a, b) => (a.lastUsed ?? Infinity) - (b.lastUsed ?? Infinity),
      name: (a, b) => tx(a.name).localeCompare(tx(b.name), document.documentElement.lang),
    };
    if (view.filter === 'all' && !view.query && view.sort === 'size') {
      const groups = [
        { title: t('group.safe'), items: c.items.filter(kinds.safe), collapsed: false },
        { title: t('group.attention'), items: c.items.filter(kinds.attention), collapsed: false },
        { title: t('group.inUse'), items: c.items.filter(kinds.inUse), collapsed: true },
      ].filter((g) => g.items.length);
      list.replaceChildren(...(groups.length ? groups.map((g) => {
        const notes = new Set(g.items.map((i) => tx(i.note)));
        const shared = notes.size === 1 && g.items.length > 1 ? [...notes][0] : undefined;
        const note = shared && h('p', { class: 'group-note' }, shared);
        const label = h('span', { class: 'group-label' }, g.title, h('span', { class: 'count' }, String(g.items.length)));
        if (g.collapsed) {
          const [trigger, panel] = disclosure({ label, content: [note, ul(g.items, !shared)], open: groups.length === 1 });
          return h('section', { class: 'group-section' }, trigger, panel);
        }
        return h('section', { class: 'group-section' }, h('h3', { class: 'group-heading' }, label), note, ul(g.items, !shared));
      }) : [h('p', { class: 'empty' }, t('detail.emptyCategory'))]));
    } else {
      const items = c.items.filter(kinds[view.filter]).filter(match).sort(order[view.sort]);
      list.replaceChildren(items.length ? ul(items, true) : h('p', { class: 'empty' }, view.query ? t('detail.noMatch', { q: view.query }) : t('detail.emptyFilter')));
    }
    syncMark();
  };

  // Marcar ou desmarcar de uma vez o que está visível (só itens com checkbox).
  const mark = button(t('detail.markVisible'), () => {
    const visible = visibleSelectable();
    const all = visible.every((i) => selected.has(i.id));
    for (const i of visible) if (all) selected.delete(i.id); else selected.add(i.id);
    draw();
    update();
  }, 'quiet small');
  const visibleSelectable = () => [...list.querySelectorAll('.item[data-ref]')]
    .map((el) => c.items.find((i) => ref(c, i) === /** @type {HTMLElement} */ (el).dataset.ref))
    .filter((i) => i !== undefined && selectable(i)).map((i) => /** @type {Item} */ (i));
  const syncMark = () => {
    const visible = visibleSelectable();
    mark.hidden = !visible.length;
    mark.textContent = t(visible.length && visible.every((i) => selected.has(i.id)) ? 'detail.unmarkVisible' : 'detail.markVisible');
  };

  const counts = Object.fromEntries(Object.entries(kinds).map(([k, fn]) => [k, c.items.filter(fn).length]));
  const filters = c.items.length > 6 && h('div', { class: 'filters' },
    segmented({ label: t('filter.label'), value: 'all', onChange: (v) => { view.filter = v; draw(); },
      options: [
        { value: 'all', label: t('filter.all'), count: counts.all },
        { value: 'safe', label: t('filter.safe'), count: counts.safe },
        { value: 'attention', label: t('filter.attention'), count: counts.attention },
        { value: 'inUse', label: t('filter.inUse'), count: counts.inUse },
      ].filter((o) => o.value === 'all' || o.count) }),
    h('div', { class: 'filters-row' },
      searchField({ label: t('filter.search'), onInput: (q) => { view.query = q; draw(); } }),
      h('span', { class: 'filter-label', id: `sort-${c.id}` }, t('filter.sort')),
      select({ value: 'size', labelledBy: `sort-${c.id}`, onChange: (v) => { view.sort = v; draw(); },
        options: [{ value: 'size', label: t('sort.size') }, { value: 'age', label: t('sort.age') }, { value: 'name', label: t('sort.name') }] }),
      mark));

  await present('detail-title', null,
    head('detail-title', catName(c.id), t(`cat.${c.id}.blurb`), h('span', { class: 'cat-icon', 'data-cat': c.id, 'aria-hidden': 'true' }, catIcon(c.id, 18))),
    filters,
    h('div', { class: 'sheet-body' },
      c.notice && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, tx(c.notice)),
        full.items.some((i) => i.tool) && button(t('docker.reclaim'), () => confirmClean([`${c.id}/reclaim`], () => openDetail(id)), 'secondary small')),
      c.status !== 'ok' && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, tx(c.message))),
      list),
    h('div', { class: 'sheet-foot' }, total, h('span', { class: 'spacer' }),
      button(t('sheet.close'), () => sheet.close(), 'secondary', { 'data-autofocus': !selected.size }),
      c.items.some(selectable) && go));
  draw();
  update();
  /** @type {HTMLElement} */ (sheet.querySelector('.sheet-inner')).classList.toggle('tall', Boolean(filters));

  // Itens recém-limpos saem: some, encolhe, e o grupo vazio vai junto.
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (sheet.querySelectorAll('.item[data-ref]'))) {
    if (!leaving.has(el.dataset.ref ?? '')) continue;
    const section = /** @type {HTMLElement | null} */ (el.closest('.group-section'));
    const remaining = section ? [...section.querySelectorAll('.item[data-ref]')].filter((x) => !leaving.has(/** @type {HTMLElement} */ (x).dataset.ref ?? '')) : [1];
    leave(remaining.length ? el : /** @type {HTMLElement} */ (section));
  }
}

/**
 * Confirmação com a lista exata do que sai e como.
 * @param {string[]} refs @param {(() => void) | null} [previous] tela para onde "Voltar" leva
 */
function confirmClean(refs, previous = null) {
  const targets = refs.map(lookup).filter((t) => t !== null);
  if (!targets.length) return;
  const trash = targets.filter((t) => t.item.action?.kind === 'trash');
  const commands = targets.filter((t) => t.item.action?.kind === 'cmd');
  const admin = targets.filter((t) => t.item.admin).length;
  const inUse = targets.filter((t) => t.item.inUse).length;
  const total = targets.reduce((s, t) => s + releases(t.item), 0);
  const unknown = unknowns(targets.map((t) => t.item));
  const simulate = state.prefs.simulate;
  const label = simulate ? t('confirm.simulate') : total ? t('confirm.free', { bytes: total }) : t('confirm.clean');
  const origin = new Set(targets.map((t) => t.category.id)).size === 1 && previous ? targets[0].category.id : null;

  /** @param {typeof targets} list */
  const lines = (list) => h('ul', { class: 'items compact' }, list.map((x) => h('li', { class: 'item' },
    h('span', { class: 'control', 'data-cat': x.category.id }, h('span', { class: 'legend-dot' })),
    h('div', { class: 'item-text' }, h('span', { class: 'item-name' }, tx(x.item.name)),
      h('span', { class: 'item-meta' }, catName(x.category.id), x.item.detail && ' · ', x.item.detail && h('span', { class: isPath(x.item.detail) ? 'mono' : '' }, tx(x.item.detail))),
      x.item.command && h('code', { class: 'item-command' }, tx(x.item.command))),
    h('span', { class: 'item-size' }, x.item.freeable === null && x.item.action?.kind === 'cmd' ? t('confirm.onClean') : formatBytes(releases(x.item))),
    h('span', { class: 'item-actions' }, x.item.admin && h('span', { class: 'badge', 'data-tip': t('confirm.passwordTip') }, svg('lock-simple', 12), t('confirm.passwordBadge'))))));

  const error = h('p', { class: 'error-text', role: 'alert', hidden: true });
  const cancel = backButton(previous, { 'data-autofocus': commands.length > 0 || inUse > 0 });
  const run = button(label, async () => {
    sheet.dataset.busy = '1';
    run.disabled = cancel.disabled = true;
    run.replaceChildren(ring(14), h('span', {}, t(simulate ? 'confirm.simulating' : admin ? 'confirm.waitingPassword' : 'confirm.freeing')));
    try {
      const result = await api.clean(refs);
      delete sheet.dataset.busy;
      showResult(result, origin);
    } catch (e) {
      delete sheet.dataset.busy;
      const reason = String(/** @type {Error} */ (e).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      error.textContent = t('confirm.error', { reason: has(reason) ? t(reason) : reason });
      error.hidden = false;
      run.disabled = cancel.disabled = false;
      run.textContent = label;
    }
  }, 'primary', { 'data-autofocus': commands.length === 0 && inUse === 0 });

  /** @param {string} title @param {number} count */
  const groupHead = (title, count) => h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, title, h('span', { class: 'count' }, String(count))));
  const title = simulate ? t(total ? 'confirm.titleSimulate' : 'confirm.titleSimulateNoAmount', { bytes: total })
    : t(total ? 'confirm.title' : 'confirm.titleNoAmount', { bytes: total });
  present('confirm-title', previous,
    head('confirm-title', title, t(simulate ? 'confirm.subtitleSimulate' : 'confirm.subtitle')),
    h('div', { class: 'sheet-body' },
      trash.length > 0 && groupHead(t('confirm.toTrash'), trash.length), trash.length > 0 && lines(trash),
      commands.length > 0 && groupHead(t('confirm.byCommand'), commands.length), commands.length > 0 && lines(commands),
      inUse > 0 && h('p', { class: 'notice tone-attention' }, svg('warning', 14), h('span', {}, t('confirm.inUse', { n: inUse }))),
      admin > 0 && !simulate && h('p', { class: 'notice' }, svg('lock-simple', 14), h('span', {}, t('confirm.admin', { n: admin }))),
      trash.length > 0 && !simulate && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, t('confirm.trashNote'))),
      unknown > 0 && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, t('confirm.unknownNote'))),
      error),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), cancel, run));
}

/**
 * Volume Docker e Lixeira: um por vez, com aceite explícito.
 * @param {Category} c @param {Item} item @param {(() => void) | null} [previous]
 */
function confirmIndividual(c, item, previous = null) {
  const isTrash = c.id === 'trash';
  const simulate = state.prefs.simulate;
  const go = button(t(simulate ? 'individual.simulate' : isTrash ? 'individual.emptyTrash' : 'individual.deleteVolume'), async () => {
    sheet.dataset.busy = '1';
    go.disabled = true;
    go.replaceChildren(ring(14), h('span', {}, t(simulate ? 'confirm.simulating' : 'individual.deleting')));
    try {
      const result = await api.clean([ref(c, item)]);
      delete sheet.dataset.busy;
      showResult(result, previous && !isTrash ? c.id : null);
    } catch {
      delete sheet.dataset.busy;
      go.textContent = t('individual.retry');
      go.disabled = false;
    }
  }, 'destructive', { disabled: true });
  const accept = checkbox({ labelledBy: 'accept-label', onChange: (on) => { go.disabled = !on; } });

  present('individual-title', previous,
    head('individual-title', isTrash ? t('individual.trashTitle') : t('individual.volumeTitle', { name: tx(item.name) }),
      isTrash ? t('individual.trashText', { detail: item.detail ?? '', bytes: item.size }) : t('individual.volumeText', { bytes: item.size }),
      h('span', { class: 'alert-icon' }, svg('warning-octagon', 28))),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'confirm-check danger' }, accept,
        h('span', { id: 'accept-label', onclick: () => accept.click() }, t('individual.accept')))),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), backButton(previous, { 'data-autofocus': true }), go));
}

/**
 * Itens limpos saem do estado e os totais descem; a nova análise confirma depois.
 * Devolve como a categoria de origem estava, para o detalhe mostrar a saída.
 * @param {CleanResult} r @param {string | null} origin
 */
function applyResult(r, origin) {
  if (r.simulated || !r.done.length) return null;
  const before = origin ? structuredClone(state.categories.get(origin)) : undefined;
  for (const target of r.done.map(lookup)) {
    if (!target) continue;
    target.category.items = target.category.items.filter((i) => i !== target.item);
    target.category.size = Math.max(0, target.category.size - releases(target.item));
  }
  state.scanning = true;
  pendingRender = true;
  renderChrome();
  refreshDisk();
  return before ?? null;
}

/** @param {CleanResult} r @param {string | null} [origin] categoria do detalhe que iniciou a limpeza */
function showResult(r, origin = null) {
  /** @type {any[]} */
  const lines = [];
  /** @param {IconName} glyph @param {string} tone @param {...any} text */
  const line = (glyph, tone, ...text) => h('li', { class: tone }, svg(glyph, 16), h('span', {}, ...text));
  /** Número que conta de zero até o valor. @param {number} bytes */
  const num = (bytes) => {
    const el = h('span', { class: 'num' }, formatBytes(0));
    requestAnimationFrame(() => countTo(el, bytes, formatBytes, 0));
    return el;
  };
  if (r.simulated) {
    lines.push(line('eye', '', rich(r.unknown ? 'result.wouldFreeUnknown' : 'result.wouldFree', { bytes: num(r.freed) })));
    if (r.trashed) lines.push(line('trash', '', rich('result.wouldTrash', { bytes: num(r.trashed) })));
    lines.push(line('check-circle', 'tone-safe', t('result.nothingDeleted')));
  } else {
    if (r.freed) {
      lines.push(line('check-circle', 'tone-safe', rich('result.removed', { bytes: num(r.freed) })));
      lines.push(line('hard-drives', '', rich('result.diskGain', { bytes: num(Math.max(0, r.disk)) })));
      if (r.freed - r.disk > Math.max(500e6, r.freed * 0.3)) lines.push(line('info', '', t('result.gap')));
      else if (r.docker) lines.push(line('info', '', t('result.docker')));
    }
    if (r.trashed) lines.push(line('trash', '', rich('result.trashed', { bytes: num(r.trashed) })));
    if (r.unknown && !r.freed) lines.push(line('check-circle', 'tone-safe', t('result.unknownDone')));
  }
  for (const f of r.failed) lines.push(line('warning', 'tone-attention', t('result.failed', { name: tx(f.name), reason: f.message })));

  const before = applyResult(r, origin);
  const done = new Set(r.done);
  // Veio do detalhe e algo saiu: "Ver categoria" volta e mostra os itens saindo. Senão, só fecha.
  const toDetail = before && origin && state.categories.get(origin)?.items.length
    ? button(t('result.seeCategory'), () => openDetail(origin, { snapshot: before, leaving: done }), 'secondary') : null;
  const title = t(r.simulated ? 'result.titleSimulated' : r.done.length ? 'result.titleDone' : 'result.titleNothing');
  // Limpou algo do Docker Desktop: o espaço só volta ao macOS depois da ferramenta de devolução.
  const reclaimButton = r.docker && !r.simulated && !done.has('docker/reclaim') && lookup('docker/reclaim')
    ? button(t('docker.reclaim'), () => confirmClean(['docker/reclaim']), 'secondary') : null;
  present('result-title', null,
    head('result-title', title),
    h('div', { class: 'sheet-body' }, h('ul', { class: 'result-lines' }, lines)),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), toDetail, reclaimButton,
      button(t('sheet.ok'), () => sheet.close(), 'primary', { 'data-autofocus': true })));
  const summary = r.simulated
    ? t('result.summarySimulated', { bytes: r.freed })
    : [r.freed && t('result.summaryRemoved', { bytes: r.freed }), r.trashed && t('result.summaryTrashed', { bytes: r.trashed }),
      r.failed.length && t('result.summaryFailed', { n: r.failed.length })].filter(Boolean).join(' ');
  announce(`${title}. ${summary}`);
}

async function openPrefs() {
  const save = async (/** @type {Partial<import('../types.js').Prefs>} */ next) => {
    const before = state.prefs.locale;
    state.prefs = await api.setPrefs(next);
    if (state.prefs.locale !== before) {
      // Idioma novo: tela inteira e os próprios Ajustes trocam na hora.
      applyLocale();
      render();
      openPrefs();
      return;
    }
    renderChrome();
    renderSafe();
  };
  await refreshDisk();
  /** @param {string} id @param {string} label @param {string} text @param {any} control */
  const setting = (id, label, text, control) => h('div', { class: 'setting' },
    h('div', {}, h('span', { class: 'setting-label', id, onclick: () => control.matches?.('[role="switch"]') && control.click() }, label),
      text && h('p', { class: 'setting-text', id: `${id}-text` }, text)),
    control);

  const appearance = segmented({ label: t('prefs.appearance'), value: state.prefs.theme, onChange: (theme) => save({ theme: /** @type {import('../types.js').Theme} */ (theme) }),
    options: [{ value: 'system', label: t('theme.system') }, { value: 'light', label: t('theme.light') }, { value: 'dark', label: t('theme.dark') }] });
  const language = select({ value: state.prefs.locale, labelledBy: 'pref-language', onChange: (locale) => save({ locale }),
    options: [
      { value: /** @type {import('../types.js').LocalePref} */ ('system'), label: t('lang.system') },
      ...Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value: /** @type {import('../types.js').LocalePref} */ (value), label })),
    ] });
  const onLaunch = toggle({ checked: state.prefs.scanOnLaunch, labelledBy: 'pref-launch', describedBy: 'pref-launch-text', onChange: (on) => save({ scanOnLaunch: on }) });
  const menuBar = toggle({ checked: state.prefs.showInMenuBar, labelledBy: 'pref-menubar', describedBy: 'pref-menubar-text', onChange: (on) => save({ showInMenuBar: on }) });
  const lowDisk = select({ value: state.prefs.lowDiskAlert, labelledBy: 'pref-lowdisk', onChange: (lowDiskAlert) => save({ lowDiskAlert }),
    options: [{ value: /** @type {0 | 10 | 15 | 20} */ (0), label: t('prefs.lowDiskOff') },
      ...[10, 15, 20].map((n) => ({ value: /** @type {0 | 10 | 15 | 20} */ (n), label: t('prefs.percent', { n }) }))] });
  const login = toggle({ checked: state.prefs.openAtLogin, labelledBy: 'pref-login', describedBy: 'pref-login-text', onChange: (on) => save({ openAtLogin: on }) });
  const simulate = toggle({ checked: state.prefs.simulate, labelledBy: 'pref-simulate', describedBy: 'pref-simulate-text', onChange: (on) => save({ simulate: on }) });
  const stale = select({ value: state.prefs.staleDays, labelledBy: 'pref-stale', onChange: (days) => save({ staleDays: days }),
    options: [30, 60, 90].map((d) => ({ value: /** @type {30 | 60 | 90} */ (d), label: t('prefs.days', { n: d }) })) });
  const access = state.fullDiskAccess
    ? h('span', { class: 'status tone-safe' }, svg('check-circle', 14), t('prefs.accessGranted'))
    : button(t('prefs.accessOpen'), () => api.open('full-disk-access'), 'secondary small', { 'aria-describedby': 'pref-access-text' });

  // Itens ignorados: cada um volta com um clique (a categoria é reanalisada).
  const ignoredList = h('ul', { class: 'ignored' });
  const drawIgnored = () => ignoredList.replaceChildren(...(state.prefs.ignored.length
    ? state.prefs.ignored.map((i) => h('li', {},
      h('span', { class: 'ignored-name' }, i.name, h('span', { class: 'item-meta' }, ignoredCategory(i.category))),
      button(t('prefs.showAgain'), async () => {
        await save({ ignored: state.prefs.ignored.filter((j) => j.ref !== i.ref) });
        drawIgnored();
        announce(t('prefs.restored', { name: i.name, category: ignoredCategory(i.category) }));
      }, 'quiet small', { 'aria-label': t('prefs.showAgainLabel', { name: i.name }) })))
    : [h('li', { class: 'empty-line' }, t('prefs.ignoredEmpty'))]));
  drawIgnored();

  await present('prefs-title', null,
    head('prefs-title', t('prefs.title')),
    h('div', { class: 'sheet-body' },
      h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, t('prefs.general'))),
      h('div', { class: 'setting' }, h('div', {}, h('span', { class: 'setting-label' }, t('prefs.appearance')),
        h('p', { class: 'setting-text' }, t('prefs.appearanceText'))), appearance),
      setting('pref-language', t('prefs.language'), t('prefs.languageText'), language),
      setting('pref-launch', t('prefs.scanOnLaunch'), t('prefs.scanOnLaunchText'), onLaunch),
      setting('pref-menubar', t('prefs.menuBar'), t('prefs.menuBarText'), menuBar),
      setting('pref-lowdisk', t('prefs.lowDisk'), t('prefs.lowDiskText'), lowDisk),
      setting('pref-login', t('prefs.login'), t('prefs.loginText'), login),
      h('h3', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, t('prefs.cleaning'))),
      setting('pref-simulate', t('prefs.simulate'), t('prefs.simulateText'), simulate),
      setting('pref-stale', t('prefs.stale'), t('prefs.staleText'), stale),
      h('div', { class: 'setting column' }, h('div', {}, h('span', { class: 'setting-label' }, t('prefs.ignored')),
        h('p', { class: 'setting-text' }, t('prefs.ignoredText'))), ignoredList),
      h('h3', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, t('prefs.permissions'))),
      setting('pref-access', t('prefs.access'), t(state.fullDiskAccess ? 'prefs.accessTextGranted' : 'prefs.accessTextMissing'), access)),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), button(t('sheet.ok'), () => sheet.close(), 'primary', { 'data-autofocus': true })));
}

async function openHistory() {
  await refreshDisk();
  const total = state.history.reduce((s, e) => s + e.freed, 0);
  const disk = state.history.reduce((s, e) => s + Math.max(0, e.disk ?? 0), 0);
  const chart = h('div', { class: 'chart-box' }, freeChart(state.samples, state.history, 30));
  const range = segmented({ label: t('chart.range'), value: '30', onChange: (d) => chart.replaceChildren(freeChart(state.samples, state.history, Number(d))),
    options: [{ value: '30', label: t('chart.d30') }, { value: '90', label: t('chart.d90') }, { value: '365', label: t('chart.y1') }] });
  present('history-title', null,
    head('history-title', t('history.title')),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'chart-head' }, h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, t('chart.title'))), range),
      chart,
      state.history.length
        ? [h('p', { class: 'safe-label' }, t('history.removed')), h('p', { class: 'history-total' }, formatBytes(total)),
          h('p', { class: 'safe-note' }, t('history.diskGain', { bytes: disk })),
          h('ul', { class: 'history-list' }, state.history.map((e) => h('li', {},
            h('span', { class: 'when' }, formatDateTime(e.at)),
            h('span', { class: 'num' }, [e.freed && t('history.entryRemoved', { bytes: e.freed }),
              e.disk !== undefined && e.freed && t('history.entryDisk', { bytes: Math.max(0, e.disk) }),
              e.trashed && t('history.entryTrashed', { bytes: e.trashed })].filter(Boolean).join(' · ') || t('history.entryCount', { n: e.count })))))]
        : h('p', { class: 'empty' }, t('history.empty'))),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), button(t('sheet.ok'), () => sheet.close(), 'primary', { 'data-autofocus': true })));
}

// ---------- Dados ----------

/** Disco, preferências, histórico e permissão. Categorias ficam com a análise. */
async function refreshDisk() {
  const s = await api.state();
  state.disk = s.disk;
  state.prefs = s.prefs;
  state.history = s.history;
  state.samples = s.samples;
  state.fullDiskAccess = s.fullDiskAccess;
  renderDisk();
  renderChrome();
}

async function load() {
  const s = await api.state();
  state.disk = s.disk;
  state.prefs = s.prefs;
  applyLocale();
  state.history = s.history;
  state.samples = s.samples;
  state.fullDiskAccess = s.fullDiskAccess;
  state.catalog = s.catalog;
  if (s.scan) {
    state.categories = new Map(s.scan.categories.map((c) => [c.id, c]));
    state.scanAt = s.scan.at;
  } else {
    state.checklist = new Map(s.catalog.map((c) => [c.id, 'pending']));
  }
  state.scanning = s.scanning || !s.scan;
  render();
  if (!state.prefs.onboarded) {
    openWelcome({ state, api, catName, catIcon, safeTotal: () => freeable(sorted().flatMap(safeItems)),
      changeLocale: async (locale) => { state.prefs = await api.setPrefs({ locale }); applyLocale(); render(); },
      onClose: (accessChanged) => { if (accessChanged) rescan(); } });
  }
}

function rescan() {
  if (state.scanning) return;
  state.scanning = true;
  state.progress = { done: 0, total: 0 };
  renderChrome();
  api.scan();
}

api.onProgress((p) => {
  if (p.finished) {
    state.scanning = false;
    state.scanAt = p.finished.at;
    state.categories = new Map(p.finished.categories.map((c) => [c.id, c]));
    state.checklist.clear();
    // Com o sheet aberto, a lista atualiza quando ele fechar (com transição).
    if (sheet.open) {
      pendingRender = true;
      renderChrome();
    } else {
      render();
    }
    refreshDisk();
    const total = freeable(sorted().flatMap(safeItems));
    announce(total ? t('announce.scanDone', { bytes: total }) : t('announce.scanDoneNothing'));
    refreshWelcome();
    return;
  }
  state.scanning = true;
  state.progress = { done: p.done, total: p.total };
  if (firstScan()) {
    // Primeira análise: cada linha da lista de verificação se completa no lugar.
    if (p.category) { state.categories.set(p.category.id, p.category); state.checklist.set(p.category.id, 'done'); }
    if (p.absent) state.checklist.set(p.absent, 'absent');
    renderChrome();
    renderDisk();
    renderList();
    refreshWelcome();
  } else {
    // Já há resultado na tela: ele fica parado; a análise nova entra inteira no fim.
    renderChrome();
  }
});

api.onCommand((command) => {
  if (command === 'rescan') rescan();
  else if (command === 'preferences') openPrefs();
  else if (command === 'history') openHistory();
});

byId('btn-history').append(svg('clock-counter-clockwise', 18));
byId('btn-rescan').append(svg('arrow-clockwise', 18));
byId('btn-prefs').append(svg('gear-six', 18));
byId('sim-pill').prepend(svg('eye', 14));
byId('btn-history').addEventListener('click', openHistory);
byId('btn-rescan').addEventListener('click', rescan);
byId('btn-prefs').addEventListener('click', openPrefs);
byId('sim-pill').addEventListener('click', openPrefs);
byId('btn-free').addEventListener('click', () => confirmClean(sorted().flatMap((c) => safeItems(c).map((i) => ref(c, i)))));
byId('content').addEventListener('scroll', (e) => {
  byId('titlebar').toggleAttribute('data-scrolled', /** @type {HTMLElement} */ (e.target).scrollTop > 0);
}, { passive: true });
setInterval(renderChrome, 60_000);
installTooltips();
document.fonts.ready.then(load);
