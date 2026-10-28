// A marca do Respiro em movimento: o anel aberto do ícone, que respira enquanto algo carrega.
// ring() serve linha de lista, botão e barra de título; hero() é o anel com o nome e uma frase ao lado.
// Com "reduzir movimento", o anel fica parado e o nome aparece direto (app.css › Marca em movimento).
import { h } from './controls.js';

const NS = 'http://www.w3.org/2000/svg';
/** Um ciclo do giro, em ms. Precisa bater com ring-spin em app.css. */
const SPIN = 2400;

/**
 * Anel aberto (pathLength 100, abertura à direita como no ícone). Anéis recriados a cada render seguem o mesmo
 * relógio, então não voltam ao início quando a lista é redesenhada.
 * @param {number} [size] px
 */
export function ring(size = 16) {
  const el = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 48 48'], ['width', String(size)], ['height', String(size)], ['class', 'ring'], ['aria-hidden', 'true']]) el.setAttribute(k, v);
  for (const cls of ['ring-track', 'ring-arc']) {
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of [['cx', '24'], ['cy', '24'], ['r', '17'], ['pathLength', '100'], ['class', cls]]) c.setAttribute(k, v);
    el.append(c);
  }
  el.style.setProperty('--phase', `${-(performance.now() % SPIN)}ms`);
  return el;
}

/**
 * Anel que se forma girando e abre espaço para o nome e a frase. Anuncia a frase a leitores de tela.
 * @param {string} text @param {number} [size]
 */
export const hero = (text, size = 40) =>
  h('div', { class: 'loader-hero', role: 'status' }, ring(size),
    h('div', { class: 'loader-words' }, h('span', { class: 'loader-name' }, 'Respiro'), h('span', { class: 'loader-text' }, text)));
