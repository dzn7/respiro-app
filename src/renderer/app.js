// Tela principal e o sheet único (detalhe → confirmação → resultado). Texto dinâmico entra só por textContent.
import { button, checkbox, disclosure, h, installTooltips, menu, searchField, segmented, select, svg, toggle } from './controls.js';
import { formatAgo, formatBytes, formatUpdated, plural } from './format.js';
import { countTo, leave, morph, swap } from './motion.js';

/**
 * @typedef {import('../types.js').Category} Category
 * @typedef {import('../types.js').Item} Item
 * @typedef {import('../types.js').CleanResult} CleanResult
 * @typedef {import('./controls.js').IconName} IconName
 */

const api = window.respiro;
const ICONS = /** @type {const} */ ({
  packages: 'package', docker: 'shipping-container', node: 'tree-structure', xcode: 'hammer',
  browsers: 'browsers', homebrew: 'beer-stein', appcaches: 'stack', trash: 'trash',
});
const ORDER = Object.keys(ICONS);
const UNKNOWN_NOTE = 'mais o que só se mede ao limpar';

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
  /** @type {import('../types.js').Prefs} */ prefs: { simulate: false, staleDays: 30, theme: 'system', scanOnLaunch: true, ignored: [] },
};

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @param {number} [size] */
const catIcon = (id, size = 16) => svg(ICONS[/** @type {keyof typeof ICONS} */ (id)] ?? 'stack', size);
/** Caminho de pasta vai em Geist Mono. @param {string | undefined} text */
const isPath = (text) => Boolean(text && (text.startsWith('~/') || text.startsWith('/')));

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
  progress.style.setProperty('--p', total ? `${Math.round((done / total) * 100)}%` : '6%');
  progress.setAttribute('aria-valuemax', String(total || 1));
  progress.setAttribute('aria-valuenow', String(done));
  progress.setAttribute('aria-hidden', String(!state.scanning));
  /** @type {HTMLButtonElement} */ (byId('btn-rescan')).disabled = state.scanning;
  byId('sim-pill').hidden = !state.prefs.simulate;
  byId('footer').textContent = state.scanning
    ? (total ? `Analisando… ${done} de ${total}` : 'Analisando…')
    : state.scanAt ? `Atualizado ${formatUpdated(state.scanAt)}` : '';
  byId('categories').setAttribute('aria-busy', String(state.scanning));
}

function renderDisk() {
  const { disk } = state;
  if (!disk) return;
  byId('disk-name').textContent = disk.name;
  countTo(byId('disk-free'), disk.free, formatBytes);
  byId('disk-total').textContent = ` de ${formatBytes(disk.total)}`;

  const used = disk.total - disk.free;
  const cats = ORDER.map((id) => state.categories.get(id)).filter((c) => c && c.size > 0).map((c) => /** @type {Category} */ (c));
  const counted = cats.reduce((sum, c) => sum + c.size, 0);
  const segments = [
    ...cats.map((c) => ({ id: c.id, name: c.name, size: c.size })),
    { id: 'system', name: firstScan() ? 'Ocupado' : 'Sistema e outros', size: Math.max(0, used - counted) },
    { id: 'free', name: 'Livre', size: disk.free },
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
  bar.setAttribute('aria-label', `${disk.name}: ${formatBytes(disk.free)} livres de ${formatBytes(disk.total)}. `
    + segments.filter((s) => s.id !== 'free').map((s) => `${s.name}, ${formatBytes(s.size)}`).join('; '));

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
  free.textContent = state.prefs.simulate ? 'Simular limpeza…' : 'Revisar e liberar…';

  // Primeira análise: o número ainda não existe. Placeholder do mesmo tamanho, nada pula quando ele chega.
  if (firstScan()) {
    value.hidden = false;
    value.replaceChildren(h('span', { class: 'skeleton', 'aria-hidden': 'true' }));
    note.textContent = 'Somando o que dá para liberar sem risco…';
    free.hidden = true;
    return;
  }
  free.hidden = !items.length;
  value.hidden = !items.length || !total;
  if (!value.hidden) countTo(value, total, formatBytes);
  if (!items.length) note.textContent = state.scanning ? 'Ainda analisando…' : 'Nada seguro para liberar agora.';
  else note.textContent = !unknown ? '' : total ? 'Mais o que só se mede ao limpar.' : 'O valor só aparece depois de limpar.';
}

/** @param {Category} c */
function rowSummary(c) {
  if (c.status !== 'ok') return { tone: 'attention', icon: /** @type {IconName} */ ('info'), text: c.message ?? '' };
  if (c.id === 'trash') return { tone: '', icon: null, text: `${c.items[0]?.detail ?? 'Itens'} · esvaziar apaga para sempre` };
  const safe = safeItems(c);
  const bytes = freeable(safe);
  if (safe.length) {
    const text = bytes ? `${formatBytes(bytes)} seguros${unknowns(safe) ? `, ${UNKNOWN_NOTE}` : ''}` : 'Seguro · o valor aparece ao limpar';
    return { tone: 'safe', icon: /** @type {IconName} */ ('check-circle'), text };
  }
  const attention = c.items.filter((i) => !i.safe && i.action && !i.inUse).length;
  if (attention) return { tone: 'attention', icon: /** @type {IconName} */ ('warning'), text: `${plural(attention, 'item pede', 'itens pedem')} atenção` };
  const inUse = c.items.filter((i) => i.inUse).length;
  return { tone: '', icon: null, text: inUse ? `Nada seguro agora · ${inUse} em uso` : 'Nada para liberar agora' };
}

/** @param {Category} c */
function rowAction(c) {
  if (c.status === 'unavailable' && c.id === 'docker') return button('Abrir Docker', () => api.open('docker'), 'quiet small');
  if (c.status === 'needs-access') return button('Abrir Ajustes', () => api.open('full-disk-access'), 'quiet small');
  if (c.status === 'error') return button('Tentar de novo', rescan, 'quiet small');
  const empty = c.id === 'trash' && c.items[0];
  if (empty) return button('Esvaziar…', () => confirmIndividual(c, empty), 'quiet small danger', { 'aria-label': 'Esvaziar a Lixeira', 'data-role': 'free' });
  const safe = safeItems(c);
  if (c.status !== 'ok' || !safe.length) return h('span');
  return button('Limpar', () => confirmClean(safe.map((i) => ref(c, i))), 'quiet small', { 'aria-label': `Limpar ${c.name}`, 'data-role': 'free' });
}

/** @param {Category} c */
function row(c) {
  const sum = rowSummary(c);
  return h('li', { class: 'row', 'data-cat': c.id },
    h('button', { type: 'button', class: 'row-main', 'data-role': 'main', onclick: () => openDetail(c.id),
      'aria-label': `${c.name}, ${c.status === 'ok' ? formatBytes(c.size) : ''}. ${sum.text}. Ver detalhes` }),
    h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, catIcon(c.id)),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, c.name),
      h('span', { class: `row-sub ${sum.tone ? `tone-${sum.tone}` : ''}` }, sum.icon && svg(sum.icon, 14), h('span', {}, sum.text))),
    h('span', { class: 'row-size' }, c.status === 'ok' ? formatBytes(c.size) : '—'),
    rowAction(c),
    h('span', { class: 'chevron', 'aria-hidden': 'true' }, svg('caret-right', 12)));
}

/** Linha da lista de verificação da primeira análise: posição fixa, só o conteúdo muda. @param {{ id: string, name: string }} entry */
function checklistRow(entry) {
  const status = state.checklist.get(entry.id) ?? 'pending';
  const c = state.categories.get(entry.id);
  const sub = status === 'pending' ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Analisando…')]
    : status === 'absent' ? [h('span', {}, 'Não encontrado neste Mac')]
      : c ? [rowSummary(c).text] : [];
  return h('li', { class: `row checklist ${status}`, 'data-cat': entry.id, 'aria-label': `${entry.name}: ${status === 'pending' ? 'analisando' : status === 'absent' ? 'não encontrado' : formatBytes(c?.size ?? 0)}` },
    h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, catIcon(entry.id)),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, entry.name), h('span', { class: 'row-sub' }, sub)),
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
  button(previous ? 'Voltar' : 'Cancelar', () => (previous ? previous() : sheet.close()), 'secondary', attrs);

/** @param {Item} item */
function itemMeta(item) {
  return h('span', { class: 'item-meta' },
    item.detail && h('span', { class: isPath(item.detail) ? 'mono' : '' }, item.detail),
    item.detail && item.lastUsed ? ' · ' : '',
    item.lastUsed ? `usado ${formatAgo(item.lastUsed)}` : '');
}

/** @param {Item} item */
function itemNote(item) {
  if (!item.note) return null;
  const tone = !item.action ? '' : !item.safe ? 'tone-attention' : '';
  const glyph = !item.action ? 'lock-simple' : item.admin ? 'lock-simple' : !item.safe ? 'warning' : 'info';
  return h('span', { class: `item-note ${tone}` }, svg(glyph, 14), h('span', {}, item.note));
}

/** @param {Item} item */
function parts(item) {
  if (!item.parts?.length) return null;
  const [trigger, panel] = disclosure({
    label: h('span', {}, `Ver ${plural(item.parts.length, 'item', 'itens')}`),
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
  if (item.individual) {
    actions.push(button(c.id === 'trash' ? 'Esvaziar…' : 'Apagar…', () => confirmIndividual(c, item, () => openDetail(c.id)), 'quiet small danger',
      { 'aria-label': `${c.id === 'trash' ? 'Esvaziar' : 'Apagar'} ${item.name}` }));
  }
  const path = item.path;
  actions.push(menu({ label: `Ações para ${item.name}`, icon: 'dots-three', items: [
    ...(path ? [
      { label: 'Mostrar no Finder', icon: /** @type {IconName} */ ('folder-open'), onSelect: () => api.reveal(ref(c, item)) },
      { label: 'Copiar caminho', icon: /** @type {IconName} */ ('copy'), onSelect: () => { navigator.clipboard.writeText(path); announce('Caminho copiado.'); } },
    ] : []),
    { label: 'Ignorar sempre', icon: 'eye-slash', onSelect: () => onIgnore(item) },
  ] }));
  return h('li', { class: 'item', 'data-ref': ref(c, item) },
    control,
    h('div', { class: 'item-text' },
      h('span', { class: 'item-name', id: nameId, onclick: () => box?.click() }, item.name),
      itemMeta(item), showNote && itemNote(item), parts(item)),
    h('span', { class: 'item-size' }, formatBytes(item.size)),
    h('span', { class: 'item-actions' }, actions));
}

/**
 * Detalhe da categoria. Depois de uma limpeza, volta mostrando os itens limpos saindo da lista.
 * @param {string} id @param {{ snapshot?: Category, leaving?: Set<string> }} [after]
 */
async function openDetail(id, after = {}) {
  const c = after.snapshot ?? state.categories.get(id);
  if (!c) return;
  const leaving = after.leaving ?? new Set();
  const selected = new Set(safeItems(c).filter((i) => !leaving.has(ref(c, i))).map((i) => i.id));
  const total = h('span', { class: 'total', 'aria-live': 'polite' });
  const go = button(state.prefs.simulate ? 'Simular selecionados' : 'Limpar selecionados',
    () => confirmClean([...selected].map((i) => `${c.id}/${i}`), () => openDetail(id)), 'primary', { 'data-autofocus': selected.size > 0 });

  const update = () => {
    const chosen = c.items.filter((i) => selected.has(i.id));
    const bytes = chosen.reduce((s, i) => s + releases(i), 0);
    const amount = bytes ? `${formatBytes(bytes)}${unknowns(chosen) ? ' + valor ao limpar' : ''}` : 'valor aparece ao limpar';
    total.textContent = chosen.length ? `${plural(chosen.length, 'item', 'itens')} · ${amount}` : 'Nada selecionado';
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
    const entry = { ref: ref(c, item), name: item.name, category: c.name };
    state.prefs = await api.setPrefs({ ignored: [...state.prefs.ignored, entry] });
    for (const cat of [c, state.categories.get(c.id)]) if (cat) cat.items = cat.items.filter((i) => i.id !== item.id);
    selected.delete(item.id);
    pendingRender = true;
    const el = /** @type {HTMLElement | null} */ (list.querySelector(`.item[data-ref="${CSS.escape(entry.ref)}"]`));
    if (el) leave(el);
    update();
    announce(`${item.name} fica de fora das próximas análises. Dá para voltar em Ajustes.`);
  };

  /** @param {Item[]} items @param {boolean} showNote */
  const ul = (items, showNote) => h('ul', { class: 'items' }, items.map((item) => itemRow(c, item, { selected, update, showNote, onIgnore })));

  const draw = () => {
    const match = (/** @type {Item} */ i) => !view.query || `${i.name} ${i.detail ?? ''}`.toLowerCase().includes(view.query);
    /** @type {Record<string, (a: Item, b: Item) => number>} */
    const order = {
      size: (a, b) => b.size - a.size,
      age: (a, b) => (a.lastUsed ?? Infinity) - (b.lastUsed ?? Infinity),
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    };
    if (view.filter === 'all' && !view.query && view.sort === 'size') {
      const groups = [
        { title: 'Seguros', items: c.items.filter(kinds.safe), collapsed: false },
        { title: 'Pedem atenção', items: c.items.filter(kinds.attention), collapsed: false },
        { title: 'Em uso', items: c.items.filter(kinds.inUse), collapsed: true },
      ].filter((g) => g.items.length);
      list.replaceChildren(...(groups.length ? groups.map((g) => {
        const notes = new Set(g.items.map((i) => i.note));
        const shared = notes.size === 1 && g.items.length > 1 ? [...notes][0] : undefined;
        const note = shared && h('p', { class: 'group-note' }, shared);
        const label = h('span', { class: 'group-label' }, g.title, h('span', { class: 'count' }, String(g.items.length)));
        if (g.collapsed) {
          const [trigger, panel] = disclosure({ label, content: [note, ul(g.items, !shared)], open: groups.length === 1 });
          return h('section', { class: 'group-section' }, trigger, panel);
        }
        return h('section', { class: 'group-section' }, h('h3', { class: 'group-heading' }, label), note, ul(g.items, !shared));
      }) : [h('p', { class: 'empty' }, 'Nada encontrado nesta categoria.')]));
    } else {
      const items = c.items.filter(kinds[view.filter]).filter(match).sort(order[view.sort]);
      list.replaceChildren(items.length ? ul(items, true) : h('p', { class: 'empty' }, view.query ? `Nada com “${view.query}”.` : 'Nada neste filtro.'));
    }
    syncMark();
  };

  // Marcar ou desmarcar de uma vez o que está visível (só itens com checkbox).
  const mark = button('Marcar visíveis', () => {
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
    mark.textContent = visible.length && visible.every((i) => selected.has(i.id)) ? 'Desmarcar visíveis' : 'Marcar visíveis';
  };

  const counts = Object.fromEntries(Object.entries(kinds).map(([k, fn]) => [k, c.items.filter(fn).length]));
  const filters = c.items.length > 6 && h('div', { class: 'filters' },
    segmented({ label: 'Filtrar itens', value: 'all', onChange: (v) => { view.filter = v; draw(); },
      options: [
        { value: 'all', label: 'Todos', count: counts.all },
        { value: 'safe', label: 'Seguros', count: counts.safe },
        { value: 'attention', label: 'Atenção', count: counts.attention },
        { value: 'inUse', label: 'Em uso', count: counts.inUse },
      ].filter((o) => o.value === 'all' || o.count) }),
    h('div', { class: 'filters-row' },
      searchField({ label: 'Buscar por nome ou pasta', onInput: (q) => { view.query = q; draw(); } }),
      h('span', { class: 'filter-label', id: `sort-${c.id}` }, 'Ordenar'),
      select({ value: 'size', labelledBy: `sort-${c.id}`, onChange: (v) => { view.sort = v; draw(); },
        options: [{ value: 'size', label: 'Tamanho' }, { value: 'age', label: 'Uso mais antigo' }, { value: 'name', label: 'Nome' }] }),
      mark));

  await present('detail-title', null,
    head('detail-title', c.name, c.blurb, h('span', { class: 'cat-icon', 'data-cat': c.id, 'aria-hidden': 'true' }, catIcon(c.id, 18))),
    filters,
    h('div', { class: 'sheet-body' },
      c.notice && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, c.notice)),
      c.status !== 'ok' && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, c.message ?? '')),
      list),
    h('div', { class: 'sheet-foot' }, total, h('span', { class: 'spacer' }),
      button('Fechar', () => sheet.close(), 'secondary', { 'data-autofocus': !selected.size }),
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
  const amount = total ? formatBytes(total) : '';
  const label = simulate ? 'Simular' : amount ? `Liberar ${amount}` : 'Limpar';
  const origin = new Set(targets.map((t) => t.category.id)).size === 1 && previous ? targets[0].category.id : null;

  /** @param {typeof targets} list */
  const lines = (list) => h('ul', { class: 'items compact' }, list.map((t) => h('li', { class: 'item' },
    h('span', { class: 'control', 'data-cat': t.category.id }, h('span', { class: 'legend-dot' })),
    h('div', { class: 'item-text' }, h('span', { class: 'item-name' }, t.item.name),
      h('span', { class: 'item-meta' }, t.category.name, t.item.detail && ' · ', t.item.detail && h('span', { class: isPath(t.item.detail) ? 'mono' : '' }, t.item.detail)),
      t.item.command && h('code', { class: 'item-command' }, t.item.command)),
    h('span', { class: 'item-size' }, t.item.freeable === null && t.item.action?.kind === 'cmd' ? 'ao limpar' : formatBytes(releases(t.item))),
    h('span', { class: 'item-actions' }, t.item.admin && h('span', { class: 'badge', 'data-tip': 'Pede sua senha' }, svg('lock-simple', 12), 'senha')))));

  const error = h('p', { class: 'error-text', role: 'alert', hidden: true });
  const cancel = backButton(previous, { 'data-autofocus': commands.length > 0 || inUse > 0 });
  const run = button(label, async () => {
    sheet.dataset.busy = '1';
    run.disabled = cancel.disabled = true;
    run.textContent = simulate ? 'Simulando…' : admin ? 'Aguardando a senha…' : 'Liberando…';
    try {
      const result = await api.clean(refs);
      delete sheet.dataset.busy;
      showResult(result, origin);
    } catch (e) {
      delete sheet.dataset.busy;
      error.textContent = `Não foi possível limpar: ${String(/** @type {Error} */ (e).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}. Nada foi apagado.`;
      error.hidden = false;
      run.disabled = cancel.disabled = false;
      run.textContent = label;
    }
  }, 'primary', { 'data-autofocus': commands.length === 0 && inUse === 0 });

  /** @param {string} title @param {number} count */
  const groupHead = (title, count) => h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, title, h('span', { class: 'count' }, String(count))));
  present('confirm-title', previous,
    head('confirm-title', simulate ? `Simular a limpeza${amount ? ` de ${amount}` : ''}?` : amount ? `Liberar ${amount}?` : 'Limpar agora?',
      simulate ? 'Modo simular: nada será apagado.' : 'Confira o que vai ser removido.'),
    h('div', { class: 'sheet-body' },
      trash.length > 0 && groupHead('Vai para a Lixeira', trash.length), trash.length > 0 && lines(trash),
      commands.length > 0 && groupHead('Limpo pelo comando oficial', commands.length), commands.length > 0 && lines(commands),
      inUse > 0 && h('p', { class: 'notice tone-attention' }, svg('warning', 14),
        h('span', {}, `${inUse === 1 ? 'Um item está' : `${inUse} itens estão`} em uso. Projetos vão pedir pnpm install (ou npm install) e apps abertos recriam o cache. Tudo vai para a Lixeira: dá para recuperar.`)),
      admin > 0 && !simulate && h('p', { class: 'notice' }, svg('lock-simple', 14),
        h('span', {}, `${admin === 1 ? 'Um item foi criado' : `${admin} itens foram criados`} pelo administrador (sudo). O macOS vai pedir sua senha uma vez para devolvê-los ao seu usuário; depois eles vão para a Lixeira.`)),
      trash.length > 0 && !simulate && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, 'O espaço volta quando você esvaziar a Lixeira.')),
      unknown > 0 && h('p', { class: 'notice' }, svg('info', 14), h('span', {}, 'Alguns caches só dizem quanto liberaram depois de limpar.')),
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
  const go = button(simulate ? 'Simular' : isTrash ? 'Esvaziar Lixeira' : 'Apagar volume', async () => {
    sheet.dataset.busy = '1';
    go.disabled = true;
    go.textContent = simulate ? 'Simulando…' : 'Apagando…';
    try {
      const result = await api.clean([ref(c, item)]);
      delete sheet.dataset.busy;
      showResult(result, previous && !isTrash ? c.id : null);
    } catch {
      delete sheet.dataset.busy;
      go.textContent = 'Tentar de novo';
      go.disabled = false;
    }
  }, 'destructive', { disabled: true });
  const accept = checkbox({ labelledBy: 'accept-label', onChange: (on) => { go.disabled = !on; } });

  present('individual-title', previous,
    head('individual-title', isTrash ? 'Esvaziar a Lixeira?' : `Apagar o volume “${item.name}”?`,
      isTrash ? `Apaga para sempre ${item.detail ?? 'os itens'} (${formatBytes(item.size)}). Não dá para desfazer.`
        : `Volumes guardam dados de containers, como bancos de dados. Isso libera ${formatBytes(item.size)}, não passa pela Lixeira e não dá para desfazer.`,
      h('span', { class: 'alert-icon' }, svg('warning-octagon', 28))),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'confirm-check danger' }, accept,
        h('span', { id: 'accept-label', onclick: () => accept.click() }, 'Entendo que os dados serão apagados para sempre.'))),
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
    lines.push(line('eye', '', 'Seriam liberados ', num(r.freed), r.unknown ? `, ${UNKNOWN_NOTE}.` : '.'));
    if (r.trashed) lines.push(line('trash', '', num(r.trashed), ' iriam para a Lixeira.'));
    lines.push(line('check-circle', 'tone-safe', 'Nada foi apagado.'));
  } else {
    if (r.freed) {
      lines.push(line('check-circle', 'tone-safe', num(r.freed), ' removidos pelas ferramentas.'));
      lines.push(line('hard-drives', '', 'O espaço livre do disco aumentou ', num(Math.max(0, r.disk)), '.'));
      if (r.freed - r.disk > Math.max(500e6, r.freed * 0.3)) {
        lines.push(line('info', '', 'A diferença é de arquivos que projetos ainda usam (o APFS compartilha cópias entre pastas) ou de espaço que volta depois, como no Docker Desktop.'));
      } else if (r.docker) {
        lines.push(line('info', '', 'O Docker Desktop pode levar alguns minutos para devolver esse espaço ao macOS.'));
      }
    }
    if (r.trashed) lines.push(line('trash', '', num(r.trashed), ' foram para a Lixeira. O espaço volta quando você esvaziar a Lixeira.'));
    if (r.unknown && !r.freed) lines.push(line('check-circle', 'tone-safe', 'Limpeza feita. A ferramenta não informou quanto liberou.'));
  }
  for (const f of r.failed) lines.push(line('warning', 'tone-attention', `${f.name}: ${f.message}`));

  const before = applyResult(r, origin);
  const done = new Set(r.done);
  // Veio do detalhe e algo saiu: "Ver categoria" volta e mostra os itens saindo. Senão, só fecha.
  const toDetail = before && origin && state.categories.get(origin)?.items.length
    ? button('Ver categoria', () => openDetail(origin, { snapshot: before, leaving: done }), 'secondary') : null;
  const title = r.simulated ? 'Simulação concluída' : r.done.length ? 'Pronto' : 'Nada foi limpo';
  present('result-title', null,
    head('result-title', title),
    h('div', { class: 'sheet-body' }, h('ul', { class: 'result-lines' }, lines)),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), toDetail,
      button('OK', () => sheet.close(), 'primary', { 'data-autofocus': true })));
  const summary = r.simulated
    ? `Seriam liberados ${formatBytes(r.freed)}. Nada foi apagado.`
    : [r.freed && `${formatBytes(r.freed)} removidos.`, r.trashed && `${formatBytes(r.trashed)} foram para a Lixeira.`,
      r.failed.length && `${plural(r.failed.length, 'item falhou', 'itens falharam')}.`].filter(Boolean).join(' ');
  announce(`${title}. ${summary}`);
}

async function openPrefs() {
  const save = async (/** @type {Partial<import('../types.js').Prefs>} */ next) => {
    state.prefs = await api.setPrefs(next);
    renderChrome();
    renderSafe();
  };
  await refreshDisk();
  /** @param {string} id @param {string} label @param {string} text @param {any} control */
  const setting = (id, label, text, control) => h('div', { class: 'setting' },
    h('div', {}, h('span', { class: 'setting-label', id, onclick: () => control.matches?.('[role="switch"]') && control.click() }, label),
      text && h('p', { class: 'setting-text', id: `${id}-text` }, text)),
    control);

  const appearance = segmented({ label: 'Aparência', value: state.prefs.theme, onChange: (theme) => save({ theme: /** @type {import('../types.js').Theme} */ (theme) }),
    options: [{ value: 'system', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }] });
  const onLaunch = toggle({ checked: state.prefs.scanOnLaunch, labelledBy: 'pref-launch', describedBy: 'pref-launch-text', onChange: (on) => save({ scanOnLaunch: on }) });
  const simulate = toggle({ checked: state.prefs.simulate, labelledBy: 'pref-simulate', describedBy: 'pref-simulate-text', onChange: (on) => save({ simulate: on }) });
  const stale = select({ value: state.prefs.staleDays, labelledBy: 'pref-stale', onChange: (days) => save({ staleDays: days }),
    options: [30, 60, 90].map((d) => ({ value: /** @type {30 | 60 | 90} */ (d), label: `${d} dias` })) });
  const access = state.fullDiskAccess
    ? h('span', { class: 'status tone-safe' }, svg('check-circle', 14), 'Concedido')
    : button('Abrir Ajustes do Sistema…', () => api.open('full-disk-access'), 'secondary small', { 'aria-describedby': 'pref-access-text' });

  // Itens ignorados: cada um volta com um clique (a categoria é reanalisada).
  const ignoredList = h('ul', { class: 'ignored' });
  const drawIgnored = () => ignoredList.replaceChildren(...(state.prefs.ignored.length
    ? state.prefs.ignored.map((i) => h('li', {},
      h('span', { class: 'ignored-name' }, i.name, h('span', { class: 'item-meta' }, i.category)),
      button('Mostrar de novo', async () => {
        await save({ ignored: state.prefs.ignored.filter((j) => j.ref !== i.ref) });
        drawIgnored();
        announce(`${i.name} volta na próxima análise de ${i.category}.`);
      }, 'quiet small', { 'aria-label': `Mostrar ${i.name} de novo` })))
    : [h('li', { class: 'empty-line' }, 'Nenhum. Use o menu ··· de um item para ignorá-lo.')]));
  drawIgnored();

  await present('prefs-title', null,
    head('prefs-title', 'Ajustes'),
    h('div', { class: 'sheet-body' },
      h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, 'Geral')),
      h('div', { class: 'setting' }, h('div', {}, h('span', { class: 'setting-label' }, 'Aparência'),
        h('p', { class: 'setting-text' }, 'Automático segue o macOS.')), appearance),
      setting('pref-launch', 'Analisar ao abrir', 'Desligado, o Respiro mostra a última análise e só analisa quando você pedir (⌘R).', onLaunch),
      h('h3', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, 'Limpeza')),
      setting('pref-simulate', 'Modo simular', 'Mostra o que seria liberado, sem apagar nada.', simulate),
      setting('pref-stale', 'Projetos parados há mais de', 'node_modules de projetos sem uso nesse período entram como seguros.', stale),
      h('div', { class: 'setting column' }, h('div', {}, h('span', { class: 'setting-label' }, 'Itens ignorados'),
        h('p', { class: 'setting-text' }, 'Ficam fora das análises até você mostrá-los de novo.')), ignoredList),
      h('h3', { class: 'group-heading spaced' }, h('span', { class: 'group-label' }, 'Permissões')),
      setting('pref-access', 'Acesso Total ao Disco', state.fullDiskAccess
        ? 'O Respiro consegue medir a Lixeira e pastas protegidas pelo macOS. Pastas criadas com sudo pedem sua senha na hora de limpar.'
        : 'Permite medir a Lixeira e pastas protegidas pelo macOS. Ative o Respiro na lista e reabra o app. Pastas criadas com sudo pedem sua senha na hora de limpar.', access)),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), button('OK', () => sheet.close(), 'primary', { 'data-autofocus': true })));
}

function openHistory() {
  const total = state.history.reduce((s, e) => s + e.freed, 0);
  const disk = state.history.reduce((s, e) => s + Math.max(0, e.disk ?? 0), 0);
  const when = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  present('history-title', null,
    head('history-title', 'Histórico'),
    h('div', { class: 'sheet-body' },
      state.history.length
        ? [h('p', { class: 'safe-label' }, 'Removido pelas limpezas'), h('p', { class: 'history-total' }, formatBytes(total)),
          h('p', { class: 'safe-note' }, `O espaço livre do disco aumentou ${formatBytes(disk)} logo depois delas.`),
          h('ul', { class: 'history-list' }, state.history.map((e) => h('li', {},
            h('span', { class: 'when' }, when.format(e.at)),
            h('span', { class: 'num' }, [e.freed && `${formatBytes(e.freed)} removidos`, e.disk !== undefined && e.freed && `disco +${formatBytes(Math.max(0, e.disk))}`,
              e.trashed && `${formatBytes(e.trashed)} para a Lixeira`].filter(Boolean).join(' · ') || plural(e.count, 'item limpo', 'itens limpos')))))]
        : h('p', { class: 'empty' }, 'Nenhuma limpeza ainda.')),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), button('OK', () => sheet.close(), 'primary', { 'data-autofocus': true })));
}

// ---------- Dados ----------

/** Disco, preferências, histórico e permissão. Categorias ficam com a análise. */
async function refreshDisk() {
  const s = await api.state();
  state.disk = s.disk;
  state.prefs = s.prefs;
  state.history = s.history;
  state.fullDiskAccess = s.fullDiskAccess;
  renderDisk();
  renderChrome();
}

async function load() {
  const s = await api.state();
  state.disk = s.disk;
  state.prefs = s.prefs;
  state.history = s.history;
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
    announce(`Análise concluída. ${total ? `${formatBytes(total)} podem ser liberados com segurança.` : 'Nada seguro para liberar agora.'}`);
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
