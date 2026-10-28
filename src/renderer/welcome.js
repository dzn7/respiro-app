// Boas-vindas do primeiro uso: cinco passos curtos em tela cheia. Nada é encenado: o passo 2 mostra a análise
// real que já roda por trás, o 4 mostra o status real do Acesso Total ao Disco e o 5 traz o número encontrado.
import { button, h, select, svg, toggle } from './controls.js';
import { LANGUAGE_NAMES, formatBytes, t } from '../shared/i18n.js';
import { ring } from './loader.js';
import { curve, reduced, token } from './motion.js';

/**
 * @typedef {{
 *   state: { prefs: import('../types.js').Prefs, catalog: { id: string }[], checklist: Map<string, string>,
 *     categories: Map<string, import('../types.js').Category>, scanning: boolean, fullDiskAccess: boolean },
 *   api: any,
 *   catName: (id: string) => string,
 *   catIcon: (id: string, size?: number) => SVGElement,
 *   safeTotal: () => number,
 *   changeLocale: (pref: import('../types.js').LocalePref) => Promise<void>,
 *   onClose: (accessChanged: boolean) => void,
 * }} Ctx
 */

const STEPS = /** @type {const} */ (['brand', 'find', 'safe', 'access', 'ready']);
const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('welcome'));

/** @type {Ctx} */
let ctx;
let step = 0;
let accessAtStart = false;
let moving = false;

/** @param {Ctx} c */
export function openWelcome(c) {
  ctx = c;
  step = 0;
  accessAtStart = c.state.fullDiskAccess;
  const d = dialog();
  d.onkeydown = onKey;
  // Esc não fecha por engano: "Pular" está sempre à vista.
  d.oncancel = (e) => e.preventDefault();
  window.addEventListener('focus', refreshAccess);
  d.replaceChildren(...frame());
  d.showModal();
  focusPrimary();
}

/** A análise andou: atualiza o que está na tela sem refazer o passo. */
export function refreshWelcome() {
  const d = dialog();
  if (!d?.open) return;
  for (const tile of /** @type {NodeListOf<HTMLElement>} */ (d.querySelectorAll('.tile'))) {
    const id = tile.dataset.cat ?? '';
    const status = statusOf(id);
    if (tile.dataset.status === status) continue;
    tile.dataset.status = status;
    tile.querySelector('.tile-status')?.replaceChildren(...tileStatus(id, status));
  }
  const ready = d.querySelector('[data-live="ready"]');
  if (ready) ready.textContent = readyText();
  const access = d.querySelector('[data-live="access"]');
  if (access) access.replaceChildren(...accessStatus());
}

// ---------- Moldura ----------

function frame() {
  const last = step === STEPS.length - 1;
  return [
    h('div', { class: 'welcome-drag', 'aria-hidden': 'true' }),
    h('button', { type: 'button', class: 'button quiet small welcome-skip', onclick: finish }, t('welcome.skip')),
    h('div', { class: 'welcome-stage' }, content()),
    h('footer', { class: 'welcome-foot' },
      h('ol', { class: 'welcome-dots', 'aria-hidden': 'true' }, STEPS.map((_, i) => h('li', { 'data-on': i === step, 'data-done': i < step }))),
      h('p', { class: 'sr-only' }, t('welcome.step', { n: step + 1, total: STEPS.length })),
      h('span', { class: 'spacer' }),
      step > 0 && button(t('welcome.back'), () => go(-1), 'secondary'),
      button(t(last ? 'welcome.finish' : step === 0 ? 'welcome.start' : 'welcome.next'), last ? finish : () => go(1), 'primary', { 'data-primary': true })),
  ];
}

/** @param {1 | -1} dir */
async function go(dir) {
  const next = step + dir;
  if (moving || next < 0 || next >= STEPS.length) return;
  moving = true;
  const d = dialog();
  const old = /** @type {HTMLElement} */ (d.querySelector('.welcome-stage > *'));
  const shift = reduced() ? 0 : 24 * dir;
  await old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-shift}px)` }],
    { duration: token('--dur-exit'), easing: curve('--ease-in'), fill: 'forwards' }).finished.catch(() => {});
  step = next;
  d.replaceChildren(...frame());
  /** @type {HTMLElement} */ (d.querySelector('.welcome-stage > *')).animate([{ opacity: 0, transform: `translateX(${shift}px)` }, { opacity: 1, transform: 'none' }],
    { duration: token('--dur-enter') || token('--dur-state'), easing: curve('--ease-out') });
  focusPrimary();
  moving = false;
}

async function finish() {
  const d = dialog();
  window.removeEventListener('focus', refreshAccess);
  ctx.state.prefs = await ctx.api.setPrefs({ onboarded: true });
  await d.animate([{ opacity: 1 }, { opacity: 0, transform: reduced() ? 'none' : 'scale(1.02)' }],
    { duration: token('--dur-collapse') || token('--dur-exit'), easing: curve('--ease-in'), fill: 'forwards' }).finished.catch(() => {});
  d.close();
  d.replaceChildren();
  d.getAnimations().forEach((a) => a.cancel());
  ctx.onClose(ctx.state.fullDiskAccess !== accessAtStart);
}

/** @param {KeyboardEvent} e */
function onKey(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.closest('[aria-haspopup], [role="listbox"]')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); if (step < STEPS.length - 1) go(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
}

const focusPrimary = () => /** @type {HTMLElement | null} */ (dialog().querySelector('[data-primary]'))?.focus();

// ---------- Passos ----------

function content() {
  const name = STEPS[step];
  /** @param {any} art @param {string} title @param {any[]} body */
  const page = (art, title, ...body) => h('div', { class: `welcome-page page-${name}` },
    h('div', { class: 'welcome-art', 'aria-hidden': name === 'find' ? null : 'true' }, art),
    h('h1', { class: 'welcome-title', id: 'welcome-title' }, title), ...body);

  if (name === 'brand') {
    const language = select({ value: ctx.state.prefs.locale, labelledBy: 'welcome-language',
      onChange: async (locale) => { await ctx.changeLocale(locale); dialog().replaceChildren(...frame()); focusPrimary(); },
      options: [
        { value: /** @type {import('../types.js').LocalePref} */ ('system'), label: t('lang.system') },
        ...Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value: /** @type {import('../types.js').LocalePref} */ (value), label })),
      ] });
    return page([h('span', { class: 'welcome-glow' }), ring(104)], t('welcome.brand.title'),
      h('p', { class: 'welcome-text' }, t('welcome.brand.text')),
      h('div', { class: 'welcome-field' }, h('span', { id: 'welcome-language' }, t('welcome.language')), language));
  }

  if (name === 'find') {
    const tiles = h('ul', { class: 'welcome-tiles', 'aria-label': t('welcome.find.label') }, ctx.state.catalog.map((c, i) => {
      const status = statusOf(c.id);
      const tile = h('li', { class: 'tile', 'data-cat': c.id, 'data-status': status },
        h('span', { class: 'tile-icon' }, ctx.catIcon(c.id, 18)),
        h('span', { class: 'tile-name' }, ctx.catName(c.id)),
        h('span', { class: 'tile-status' }, tileStatus(c.id, status)));
      tile.style.setProperty('--i', String(i));
      return tile;
    }));
    return page(tiles, t('welcome.find.title'), h('p', { class: 'welcome-text' }, t('welcome.find.text')));
  }

  if (name === 'safe') {
    /** @param {import('./controls.js').IconName} glyph @param {string} text @param {string} cls */
    const sceneRow = (glyph, text, cls) => h('li', { class: `scene-row ${cls}` }, svg(glyph, 16), h('span', {}, text), cls === 'kept' && svg('lock-simple', 14));
    const art = h('div', { class: 'scene' },
      h('ul', { class: 'scene-rows' },
        sceneRow('package', t('welcome.safe.demoCache'), 'go'),
        sceneRow('folder-open', t('welcome.safe.demoDocs'), 'kept'),
        sceneRow('shipping-container', t('welcome.safe.demoRunning'), 'kept')),
      h('span', { class: 'scene-trash' }, svg('trash', 30)));
    /** @param {import('./controls.js').IconName} glyph @param {string} key */
    const point = (glyph, key) => h('li', {}, svg(glyph, 16), h('span', {}, t(key)));
    return page(art, t('welcome.safe.title'),
      h('ul', { class: 'welcome-points' },
        point('trash', 'welcome.safe.trash'), point('terminal-window', 'welcome.safe.official'),
        point('lock-simple', 'welcome.safe.never'), point('eye', 'welcome.safe.simulate')));
  }

  if (name === 'access') {
    const { prefs } = ctx.state;
    /** @param {string} id @param {string} label @param {string} text @param {keyof import('../types.js').Prefs} key */
    const option = (id, label, text, key) => h('div', { class: 'setting' },
      h('div', {}, h('span', { class: 'setting-label', id }, label), h('p', { class: 'setting-text', id: `${id}-text` }, text)),
      toggle({ checked: Boolean(prefs[key]), labelledBy: id, describedBy: `${id}-text`,
        onChange: async (on) => { ctx.state.prefs = await ctx.api.setPrefs({ [key]: on }); } }));
    return page([h('span', { class: 'welcome-glow' }), h('span', { class: 'access-badge' }, svg('shield-check', 44))], t('welcome.access.title'),
      h('p', { class: 'welcome-text' }, t('welcome.access.text')),
      h('div', { class: 'welcome-card' },
        h('div', { class: 'setting' },
          h('div', {}, h('span', { class: 'setting-label', id: 'welcome-fda' }, t('welcome.access.fda')),
            h('p', { class: 'setting-text' }, t('welcome.access.hint'))),
          h('div', { class: 'access-status', 'data-live': 'access', 'aria-live': 'polite' }, accessStatus())),
        option('welcome-menubar', t('welcome.access.menuBar'), t('welcome.access.menuBarText'), 'showInMenuBar'),
        option('welcome-login', t('welcome.access.login'), t('welcome.access.loginText'), 'openAtLogin')));
  }

  return page([h('span', { class: 'welcome-glow' }), ring(104), h('span', { class: 'ready-check' }, svg('check', 40))], t('welcome.ready.title'),
    h('p', { class: 'welcome-text', 'data-live': 'ready', 'aria-live': 'polite' }, readyText()));
}

// ---------- Partes ao vivo ----------

/** @param {string} id */
function statusOf(id) {
  const { checklist, categories } = ctx.state;
  if (checklist.size) return checklist.get(id) ?? 'pending';
  return categories.has(id) ? 'done' : 'absent';
}

/** @param {string} id @param {string} status */
function tileStatus(id, status) {
  if (status === 'pending') return [ring(10), h('span', {}, t('checklist.scanning'))];
  if (status === 'absent') return [h('span', {}, t('checklist.absent'))];
  return [h('span', { class: 'num' }, formatBytes(ctx.state.categories.get(id)?.size ?? 0))];
}

function accessStatus() {
  return ctx.state.fullDiskAccess
    ? [h('span', { class: 'status tone-safe' }, svg('check-circle', 14), t('welcome.access.granted'))]
    : [button(t('welcome.access.open'), () => ctx.api.open('full-disk-access'), 'secondary small', { 'aria-describedby': 'welcome-fda' })];
}

function readyText() {
  if (ctx.state.scanning) return t('welcome.ready.scanning');
  const total = ctx.safeTotal();
  return total ? t('welcome.ready.found', { bytes: total }) : t('welcome.ready.nothing');
}

/** Voltou dos Ajustes do Sistema: o status do acesso pode ter mudado. */
async function refreshAccess() {
  const s = await ctx.api.state();
  ctx.state.fullDiskAccess = s.fullDiskAccess;
  refreshWelcome();
}
