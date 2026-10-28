// A pílula: nasce embaixo do ícone da barra de menus com o resultado da limpeza, fica 5 s (espera com o mouse
// em cima) e recolhe para o ícone. Só transform e opacity animam. Texto chega pronto do main.
import { svg } from './controls.js';
import { curve, reduced } from './motion.js';

/** @typedef {import('../main/island.js').Payload} Payload */

const box = /** @type {HTMLElement} */ (document.getElementById('island'));
const api = /** @type {any} */ (window).island;
const STAY = 5000;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
let hovering = false;
let shown = false;

box.addEventListener('mouseenter', () => { hovering = true; api.hover(true); clearTimeout(timer); });
box.addEventListener('mouseleave', () => { hovering = false; api.hover(false); if (shown) timer = setTimeout(hide, 1600); });
box.addEventListener('click', () => { api.act('open'); hide(); });

/** @param {string} tag @param {string} cls @param {...any} children */
const el = (tag, cls, ...children) => {
  const node = document.createElement(tag);
  node.className = cls;
  node.append(...children);
  return node;
};

/** @param {Payload & { tip?: number }} p */
async function show(p) {
  clearTimeout(timer);
  if (p.kind === 'hide') { hide(); return; }
  box.getAnimations().forEach((a) => a.cancel());
  box.style.setProperty('--tip', `${p.tip ?? 200}px`);
  box.replaceChildren(
    el('span', `island-glyph tone-${p.tone}`, svg(p.tone === 'ok' ? 'check-circle' : p.tone === 'later' ? 'lock-simple' : 'warning', 24)),
    el('span', 'island-text', el('span', 'island-title', p.title), el('span', 'island-detail', p.detail)),
    el('span', 'island-action', p.action));
  box.dataset.shown = '';
  shown = true;
  if (!reduced()) {
    // Sai do ícone: cresce a partir da ponta que aponta para ele.
    box.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.94)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, easing: curve('--ease-out') });
  }
  if (!hovering) timer = setTimeout(hide, STAY);
}

async function hide() {
  clearTimeout(timer);
  if (!shown) return;
  shown = false;
  if (!reduced()) {
    await box.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.96)' }],
      { duration: 220, easing: curve('--ease-in'), fill: 'forwards' }).finished.catch(() => {});
  }
  if (shown) return;
  box.getAnimations().forEach((a) => a.cancel());
  delete box.dataset.shown;
  box.replaceChildren();
  api.act('hidden');
}

api.on(show);
