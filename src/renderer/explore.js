// Explorar: onde está o espaço do disco, além dos caches. Página em tela cheia, como a da limpeza.
// Mapa (treemap da pasta atual com a lista ao lado), Arquivos grandes e Duplicados. Só o que é da pessoa e passa na
// regra do main (S14) pode ir para a Lixeira, marcado um a um e com confirmação própria; quem limpa é a página de
// limpeza que já existe. O renderer manda só ids ("explore/<id>"), nunca caminho.
import { button, checkbox, h, searchField, segmented, svg, uid } from './controls.js';
import { formatBytes, has, t } from '../shared/i18n.js';
import { ring } from './loader.js';
import { kindOf, squarify } from './treemap.js';

/**
 * @typedef {import('../types.js').ExploreNode} ExploreNode
 * @typedef {import('../types.js').ExploreFile} ExploreFile
 * @typedef {import('../types.js').DuplicateGroup} DuplicateGroup
 * @typedef {import('../types.js').CleanResult} CleanResult
 * @typedef {{ id: string, name: string, path: string, size: number }} Pick
 * @typedef {'home' | 'apps' | 'disk'} Scope
 * @typedef {{ status: 'idle' | 'loading' | 'done' | 'error', error?: string }} Load
 */

const api = window.respiro;
const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('explore'));

const state = {
  tab: /** @type {'map' | 'large' | 'dupes'} */ ('map'),
  scope: /** @type {Scope} */ ('home'),
  /** @type {Record<Scope, ExploreNode | null>} */ roots: { home: null, apps: null, disk: null },
  /** pasta atual e as de cima, para a trilha */
  /** @type {ExploreNode[]} */ trail: [],
  /** @type {ExploreFile[]} */ large: [],
  /** @type {DuplicateGroup[]} */ dupes: [],
  /** @type {Record<string, Load>} */ load: {},
  /** pastas que já ganharam o nível de baixo com arquivos */
  /** @type {Set<string>} */ deep: new Set(),
  sort: /** @type {'size' | 'date' | 'name'} */ ('size'),
  query: '',
  /** @type {Map<string, Pick>} */ selected: new Map(),
  confirming: false,
  progress: '',
};
/** @type {(picks: Pick[]) => Promise<CleanResult | null | undefined>} */
let trash = async () => null;
/** @type {{ body?: HTMLElement, foot?: HTMLElement, progress?: HTMLElement }} */
const ui = {};

/** Erro do IPC em frase (a chave vem do main). @param {unknown} e */
function reason(e) {
  const text = String(/** @type {Error} */ (e)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return has(text) ? t(text) : text;
}

/** Roda uma leitura uma vez só por chave; a tela redesenha no fim. @param {string} key @param {() => Promise<void>} fn */
async function run(key, fn) {
  if (state.load[key]?.status === 'loading') return;
  state.load[key] = { status: 'loading' };
  state.progress = '';
  render();
  try {
    await fn();
    state.load[key] = { status: 'done' };
  } catch (e) {
    state.load[key] = { status: 'error', error: reason(e) };
  }
  if (dialog().open) render();
}

const status = (/** @type {string} */ key) => state.load[key]?.status ?? 'idle';

// ---------- Abrir, fechar, Lixeira ----------

/**
 * Abre a página (com o que já foi lido). `onTrash` leva os itens marcados para a página de limpeza.
 * @param {{ onTrash: (picks: Pick[]) => Promise<CleanResult | null | undefined> }} o
 */
export function openExplore({ onTrash }) {
  trash = onTrash;
  const d = dialog();
  d.onkeydown = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    // Esc sobe um nível no mapa e volta da confirmação; no topo, fecha.
    if (state.confirming) { state.confirming = false; render(); } else if (state.tab === 'map' && state.trail.length > 1) up(state.trail.length - 2); else d.close();
  };
  d.oncancel = (e) => e.preventDefault();
  if (!d.open) d.showModal();
  render();
  if (state.tab === 'map' && state.scope !== 'disk' && status(`map:${state.scope}`) === 'idle') map(state.scope);
}

/** Tira da tela o que foi para a Lixeira. @param {CleanResult} r */
function prune(r) {
  if (r.simulated || !r.done.length) return;
  const gone = new Set(r.done.filter((x) => x.startsWith('explore/')).map((x) => x.slice(8)));
  /** @param {ExploreNode} node @returns {number} */
  const cut = (node) => {
    let removed = 0;
    node.children = (node.children ?? []).filter((c) => {
      if (gone.has(c.id)) { removed += c.size; return false; }
      removed += cut(c);
      return true;
    });
    node.size = Math.max(0, node.size - removed);
    return removed;
  };
  for (const root of Object.values(state.roots)) if (root) cut(root);
  state.large = state.large.filter((f) => !gone.has(f.id));
  state.dupes = state.dupes.map((g) => ({ ...g, copies: g.copies.filter((c) => !gone.has(c.id)) })).filter((g) => g.copies.length > 1);
  for (const id of gone) state.selected.delete(id);
}

async function confirmTrash() {
  const picks = [...state.selected.values()];
  dialog().close();
  const r = await trash(picks);
  state.confirming = false;
  if (r) prune(r);
}

// ---------- Leituras ----------

/** @param {Scope} scope @param {boolean} [fresh] lê de novo em vez de usar a leitura guardada */
function map(scope, fresh = false) {
  if (fresh) {
    state.load[`map:${scope}`] = { status: 'idle' };
    state.deep.clear();
  }
  run(`map:${scope}`, async () => {
    const root = await api.explore(scope, fresh ? 'fresh' : undefined);
    state.roots[scope] = root;
    if (state.scope === scope) state.trail = root ? [root] : [];
    if (root) deepen(root);
  });
}

/** Nível de baixo de uma pasta (subpastas e arquivos de 1 MB para cima), em segundo plano. @param {ExploreNode} node */
async function deepen(node) {
  if (!node.dir || state.deep.has(node.id)) return;
  state.deep.add(node.id);
  const fresh = await api.explore('dir', node.id).catch(() => null);
  if (!fresh) return;
  // Subpastas: as que o mapa já leu continuam com o que tinham; o main só manda subpastas quando não as conhecia.
  const known = new Map((node.children ?? []).map((c) => [c.id, c]));
  const got = fresh.children ?? [];
  const dirs = got.some((c) => c.dir) ? got.filter((c) => c.dir).map((c) => (known.get(c.id)?.children?.length ? /** @type {ExploreNode} */ (known.get(c.id)) : c))
    : (node.children ?? []).filter((c) => c.dir);
  node.children = [...dirs, ...got.filter((c) => !c.dir)].sort((a, b) => b.size - a.size);
  if (dialog().open && state.trail.at(-1) === node && !state.confirming) render();
}

/** @param {ExploreNode} node */
function enter(node) {
  if (!node.dir) return;
  state.trail.push(node);
  render();
  deepen(node);
  /** @type {HTMLElement | null} */ (ui.body?.querySelector('.x-crumbs [aria-current]'))?.focus();
}

/** @param {number} index */
function up(index) {
  state.trail = state.trail.slice(0, index + 1);
  render();
  /** @type {HTMLElement | null} */ (ui.body?.querySelector('.x-crumbs [aria-current]'))?.focus();
}

api.onExploreProgress((p) => {
  state.progress = p.kind === 'count' ? t('explore.readingCount', { n: p.n }) : t('explore.comparing', { read: p.read, total: p.total });
  if (ui.progress) ui.progress.textContent = state.progress;
});

// ---------- Desenho ----------

function render() {
  const d = dialog();
  // Redesenho (pasta que terminou de ler, aba nova) não tira o foco de quem está no teclado.
  const focused = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.focus;
  const body = h('div', { class: 'x-body' }, state.confirming ? confirmView() : state.tab === 'map' ? mapView() : state.tab === 'large' ? largeView() : dupesView());
  const foot = h('footer', { class: 'x-foot' });
  ui.body = body;
  ui.foot = foot;
  d.replaceChildren(
    h('div', { class: 'welcome-drag', 'aria-hidden': 'true' }),
    h('div', { class: 'x-doc' },
      h('header', { class: 'x-head' },
        h('h1', { class: 'x-title', id: 'explore-title' }, t(state.confirming ? 'explore.confirmTitle' : 'explore.title', { n: state.selected.size })),
        h('p', { class: 'x-subtitle' }, t(state.confirming ? 'explore.confirmText' : 'explore.subtitle')),
        !state.confirming && segmented({ label: t('explore.tabs'), value: state.tab, onChange: (tab) => { state.tab = tab; render(); refocus('.x-head'); openTab(); },
          options: /** @type {const} */ (['map', 'large', 'dupes']).map((value) => ({ value, label: t(`explore.tab.${value}`) })) })),
      body),
    foot);
  renderFoot();
  if (focused) /** @type {HTMLElement | null} */ (d.querySelector(`[data-focus="${CSS.escape(focused)}"]`))?.focus();
}

/** Depois de redesenhar, o foco volta para a opção escolhida do segmentado. @param {string} where */
const refocus = (where) => /** @type {HTMLElement | null} */ (dialog().querySelector(`${where} .seg-option[aria-checked="true"]`))?.focus();

/** Primeira visita a uma aba: começa a ler o que ela mostra (duplicados esperam o pedido). */
function openTab() {
  if (state.tab === 'large' && status('large') === 'idle') run('large', async () => { state.large = await api.explore('large'); });
  if (state.tab === 'map' && state.scope !== 'disk' && status(`map:${state.scope}`) === 'idle') map(state.scope);
}

function renderFoot() {
  const foot = /** @type {HTMLElement} */ (ui.foot);
  const total = [...state.selected.values()].reduce((s, p) => s + p.size, 0);
  const n = state.selected.size;
  if (state.confirming) {
    const go = button(t('explore.trashNow', { n }), confirmTrash, 'primary', { disabled: true });
    const accept = checkbox({ labelledBy: 'x-accept', onChange: (on) => { go.disabled = !on; } });
    foot.replaceChildren(h('div', { class: 'confirm-check' }, accept, h('span', { id: 'x-accept', onclick: () => accept.click() }, t('explore.accept'))),
      h('span', { class: 'spacer' }), button(t('explore.back'), () => { state.confirming = false; render(); }, 'secondary', { 'data-autofocus': true }), go);
    /** @type {HTMLElement} */ (foot.querySelector('[data-autofocus]')).focus();
    return;
  }
  foot.replaceChildren(
    h('p', { class: 'x-picked', 'aria-live': 'polite' }, n ? t('explore.picked', { n, bytes: total }) : t('explore.pickHint')),
    button(t('explore.close'), () => dialog().close(), 'secondary'),
    button(t('explore.review', { n }), () => { state.confirming = true; render(); }, 'primary', { disabled: !n }));
}

/** Marcar ou desmarcar um item para a Lixeira. @param {Pick} pick @param {boolean} on */
function choose(pick, on) {
  if (on) state.selected.set(pick.id, pick);
  else state.selected.delete(pick.id);
  renderFoot();
}

/** Carregando, erro ou vazio, no lugar do conteúdo. @param {string} key @param {string} loading @param {() => void} retry */
function placeholder(key, loading, retry) {
  const s = state.load[key];
  if (s?.status === 'error') {
    return h('div', { class: 'x-state' }, h('p', { class: 'notice tone-attention' }, svg('warning', 14), h('span', {}, t('explore.error', { reason: s.error ?? '' }))),
      button(t('explore.retry'), retry, 'secondary small'));
  }
  ui.progress = h('span', { class: 'x-progress num' }, state.progress);
  return h('div', { class: 'x-state', role: 'status' }, h('p', { class: 'x-loading' }, ring(16), h('span', {}, loading)), ui.progress);
}

/** Linha de item: marcar (se a regra deixa), nome, onde está, tamanho e "Mostrar no Finder".
 * @param {{ id: string, name: string, path: string, size: number, dir?: boolean, mtime?: number, trashable?: boolean }} x
 * @param {{ open?: () => void, extra?: any, keep?: boolean }} [o] */
function row(x, { open, extra, keep } = {}) {
  const nameId = uid('x-name');
  const kind = kindOf(x.name, Boolean(x.dir));
  const meta = [t(`explore.kind.${kind}`), x.mtime && t('explore.modified', { at: x.mtime })].filter(Boolean).join(' · ');
  const text = h('span', { class: 'x-text' },
    h('span', { class: 'x-name', id: nameId }, h('span', { class: 'x-swatch', 'data-kind': kind, 'aria-hidden': 'true' }), x.name),
    h('span', { class: 'x-meta' }, meta, ' · ', h('span', { class: 'mono' }, x.path)));
  const mark = x.trashable && !keep && checkbox({ labelledBy: nameId, checked: state.selected.has(x.id), onChange: (on) => choose({ id: x.id, name: x.name, path: x.path, size: x.size }, on) });
  if (mark) mark.dataset.focus = `${x.id}:mark`;
  const lead = keep ? h('span', { class: 'badge', 'data-tip': t('explore.keepTip') }, t('explore.keep'))
    : mark || h('span', { class: 'x-lock', 'data-tip': t('explore.protectedTip'), tabindex: '0', 'aria-label': t('explore.protectedTip'), 'data-focus': `${x.id}:lock` }, svg('lock-simple', 12));
  return h('li', { class: 'x-row' }, lead,
    open ? h('button', { type: 'button', class: 'x-open', onclick: open, 'aria-label': t('explore.openFolder', { name: x.name }), 'data-focus': `${x.id}:open` }, text, svg('caret-right', 12)) : text,
    h('span', { class: 'x-size num' }, formatBytes(x.size)),
    extra,
    h('button', { type: 'button', class: 'icon-button small', 'aria-label': t('explore.reveal'), 'data-tip': t('explore.reveal'), 'data-focus': `${x.id}:reveal`,
      onclick: () => api.reveal(`explore/${x.id}`) }, svg('folder-open', 14)));
}

// ---------- Mapa ----------

function mapView() {
  const scopes = segmented({ label: t('explore.scope'), value: state.scope,
    onChange: (scope) => { state.scope = scope; state.trail = state.roots[scope] ? [/** @type {ExploreNode} */ (state.roots[scope])] : []; render(); refocus('.x-body'); openTab(); },
    options: [{ value: /** @type {Scope} */ ('home'), label: t('explore.scopeHome') }, { value: /** @type {Scope} */ ('apps'), label: t('explore.scopeApps') },
      { value: /** @type {Scope} */ ('disk'), label: t('explore.scopeDisk') }] });
  const key = `map:${state.scope}`;
  const top = h('div', { class: 'x-tools' }, scopes);
  if (state.scope === 'disk' && status(key) === 'idle') {
    return [top, h('div', { class: 'x-state' }, h('p', { class: 'x-explain' }, t('explore.diskText')),
      button(t('explore.diskStart'), () => map('disk'), 'primary', { 'data-autofocus': true }))];
  }
  const node = state.trail.at(-1);
  if (status(key) !== 'done' || !node) {
    return [top, status(key) === 'done' ? h('p', { class: 'x-empty' }, t('explore.emptyMap'))
      : [placeholder(key, t('explore.reading'), () => map(state.scope)), status(key) === 'loading' && h('p', { class: 'x-explain' }, t('explore.readingSlow'))]];
  }
  const at = state.roots[state.scope]?.at;
  if (at) top.append(h('span', { class: 'x-at' }, t('explore.readAt', { at })), button(t('explore.reread'), () => map(state.scope, true), 'secondary small'));

  const crumbs = h('nav', { class: 'x-crumbs', 'aria-label': t('explore.trail') }, state.trail.map((n, i) => {
    const last = i === state.trail.length - 1;
    return [i > 0 && svg('caret-right', 12), h('button', { type: 'button', class: 'x-crumb', 'aria-current': last ? 'location' : undefined, onclick: () => up(i), 'data-focus': `crumb:${i}` },
      i === 0 ? t(`explore.scope${state.scope === 'home' ? 'Home' : state.scope === 'apps' ? 'Apps' : 'Disk'}`) : n.name)];
  }), h('span', { class: 'x-crumb-size num' }, formatBytes(node.size)));

  const children = (node.children ?? []).filter((c) => c.size > 0);
  // ponytail: o treemap mostra as 60 maiores; o resto vira um bloco só (a lista embaixo mostra todas).
  const shown = children.slice(0, 60);
  const rest = node.size - shown.reduce((s, c) => s + c.size, 0);
  const tiles = shown.map((c) => ({ node: c, size: c.size }));
  if (rest > node.size * 0.01) tiles.push({ node: /** @type {any} */ (null), size: rest });
  const box = h('div', { class: 'treemap', 'aria-hidden': 'true' });
  const draw = () => {
    const rects = squarify(tiles.map((x) => x.size), { x: 0, y: 0, w: box.clientWidth, h: box.clientHeight });
    box.replaceChildren(...tiles.map((x, i) => {
      const r = rects[i];
      const tile = h('div', { class: 'tm-tile', 'data-kind': x.node ? kindOf(x.node.name, x.node.dir) : 'rest',
        'data-tip': `${x.node?.name ?? t('explore.rest')} · ${formatBytes(x.size)}`,
        onclick: () => (x.node?.dir ? enter(x.node) : undefined) });
      tile.style.cssText = `left:${r.x + 1}px;top:${r.y + 1}px;width:${Math.max(0, r.w - 2)}px;height:${Math.max(0, r.h - 2)}px`;
      if (r.w > 72 && r.h > 36) tile.append(h('span', { class: 'tm-name' }, x.node?.name ?? t('explore.rest')), h('span', { class: 'tm-size num' }, formatBytes(x.size)));
      return tile;
    }));
  };
  new ResizeObserver(draw).observe(box);

  const kinds = [...new Set(children.map((c) => kindOf(c.name, c.dir)))];
  const legend = h('ul', { class: 'legend x-legend' }, kinds.map((k) => h('li', {}, h('span', { class: 'x-swatch', 'data-kind': k }), t(`explore.kind.${k}`))));
  const list = h('ul', { class: 'x-list', 'aria-label': t('explore.listLabel', { name: node.name }) },
    children.map((c) => row(c, { open: c.dir ? () => enter(c) : undefined })));
  return [top, crumbs, box, legend, children.length ? list : h('p', { class: 'x-empty' }, t('explore.emptyFolder'))];
}

// ---------- Arquivos grandes ----------

function largeView() {
  if (status('large') !== 'done') return placeholder('large', t('explore.searchingLarge'), () => run('large', async () => { state.large = await api.explore('large'); }));
  const list = h('ul', { class: 'x-list', 'aria-label': t('explore.tab.large') });
  const fill = () => {
    const by = { size: (/** @type {ExploreFile} */ a, /** @type {ExploreFile} */ b) => b.size - a.size, date: (/** @type {ExploreFile} */ a, /** @type {ExploreFile} */ b) => a.mtime - b.mtime,
      name: (/** @type {ExploreFile} */ a, /** @type {ExploreFile} */ b) => a.name.localeCompare(b.name) }[state.sort];
    const files = state.large.filter((f) => !state.query || f.name.toLowerCase().includes(state.query) || f.path.toLowerCase().includes(state.query)).sort(by);
    list.replaceChildren(...(files.length ? files.map((f) => row(f)) : [h('li', { class: 'x-empty' }, t(state.large.length ? 'explore.noMatch' : 'explore.noLarge'))]));
  };
  fill();
  return [h('div', { class: 'x-tools' },
    searchField({ label: t('explore.search'), onInput: (q) => { state.query = q; fill(); } }),
    segmented({ label: t('explore.sort'), value: state.sort, onChange: (sort) => { state.sort = sort; fill(); },
      options: [{ value: /** @type {'size' | 'date' | 'name'} */ ('size'), label: t('explore.sortSize') }, { value: /** @type {'size' | 'date' | 'name'} */ ('date'), label: t('explore.sortDate') },
        { value: /** @type {'size' | 'date' | 'name'} */ ('name'), label: t('explore.sortName') }] })),
  list];
}

// ---------- Duplicados ----------

function findDupes() {
  run('dupes', async () => {
    state.dupes = await api.explore('duplicates');
    // Vem marcado o que pode sair: todas as cópias menos a que fica.
    for (const g of state.dupes) for (const c of g.copies) if (!c.keep && c.trashable) state.selected.set(c.id, { id: c.id, name: c.name, path: c.path, size: c.size });
  });
}

/** Troca a cópia que fica no grupo. @param {DuplicateGroup} g @param {string} id */
function keepCopy(g, id) {
  for (const c of g.copies) {
    c.keep = c.id === id;
    if (c.keep) state.selected.delete(c.id);
    else if (c.trashable) state.selected.set(c.id, { id: c.id, name: c.name, path: c.path, size: c.size });
  }
  render();
}

function dupesView() {
  if (status('dupes') === 'idle') {
    return h('div', { class: 'x-state' }, h('p', { class: 'x-explain' }, t('explore.dupesText')), button(t('explore.dupesStart'), findDupes, 'primary', { 'data-autofocus': true }));
  }
  if (status('dupes') !== 'done') return placeholder('dupes', t('explore.searchingDupes'), findDupes);
  if (!state.dupes.length) return h('p', { class: 'x-empty' }, t('explore.noDupes'));
  const total = state.dupes.reduce((s, g) => s + g.size * (g.copies.length - 1), 0);
  return [h('p', { class: 'x-explain' }, t('explore.dupesFound', { n: state.dupes.length, bytes: total })),
    ...state.dupes.map((g) => h('section', { class: 'x-group' },
      h('h3', { class: 'group-heading' }, h('span', { class: 'group-label' }, t('explore.copies', { n: g.copies.length, name: g.copies[0].name })),
        h('span', { class: 'x-meta' }, t('explore.copiesMeta', { size: g.size, bytes: g.size * (g.copies.length - 1) }))),
      h('ul', { class: 'x-list' }, g.copies.map((c) => row(c, { keep: c.keep,
        extra: !c.keep && button(t('explore.keepThis'), () => keepCopy(g, c.id), 'secondary small', { 'data-focus': `${c.id}:keep` }) })))))];
}

// ---------- Confirmação ----------

function confirmView() {
  const picks = [...state.selected.values()].sort((a, b) => b.size - a.size);
  return [h('p', { class: 'notice' }, svg('info', 14), h('span', {}, t('explore.confirmNote'))),
    h('ul', { class: 'x-list' }, picks.map((p) => h('li', { class: 'x-row plain' },
      h('span', { class: 'x-text' }, h('span', { class: 'x-name' }, p.name), h('span', { class: 'x-meta mono' }, p.path)),
      h('span', { class: 'x-size num' }, formatBytes(p.size)))))];
}
