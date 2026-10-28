// Movimento com propósito (UI.md › Movimento). Durações vêm dos tokens: com "reduzir movimento"
// o CSS já zera deslocamento e contagem, então nada aqui precisa de caminho especial além de reduced().
const media = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => media.matches;

/** Valor numérico de um token (ms ou px). @param {string} token */
export const token = (token) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0;
/** Curva de um token. @param {string} name */
export const curve = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease-out';

/**
 * Atualiza o DOM com View Transition: linhas trocam de lugar e saem suaves.
 * Com sheet aberto, movimento reduzido ou sem suporte, atualiza direto.
 * @param {() => void} update
 */
export function morph(update) {
  if (reduced() || !document.startViewTransition || document.querySelector('dialog[open]')) {
    update();
    return;
  }
  // Uma transição nova pula a anterior; isso é esperado, não erro.
  const t = document.startViewTransition(update);
  t.ready.catch(() => {});
  t.finished.catch(() => {});
}

/** @type {WeakMap<Element, number>} */
const shown = new WeakMap();
/** @type {WeakMap<Element, number>} */
const frames = new WeakMap();

/**
 * Conta do valor anterior até o novo. Primeira exibição não conta (a não ser com `from`).
 * @param {HTMLElement} el @param {number} to @param {(n: number) => string} format @param {number} [from]
 */
export function countTo(el, to, format, from = shown.get(el)) {
  cancelAnimationFrame(frames.get(el) ?? 0);
  shown.set(el, to);
  const duration = token('--dur-number');
  if (from === undefined || from === to || !duration) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (/** @type {number} */ now) => {
    const p = Math.min(1, (now - start) / duration);
    el.textContent = format(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) frames.set(el, requestAnimationFrame(step));
  };
  frames.set(el, requestAnimationFrame(step));
}

/**
 * Troca o conteúdo de um sheet aberto: o atual some, a altura acompanha, o novo entra.
 * @param {HTMLElement} box @param {HTMLElement} next
 */
export async function swap(box, next) {
  const prev = /** @type {HTMLElement | null} */ (box.firstElementChild);
  if (!prev) {
    box.replaceChildren(next);
    return;
  }
  await prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: token('--dur-exit'), easing: curve('--ease-in'), fill: 'forwards' }).finished;
  const before = box.getBoundingClientRect().height;
  box.replaceChildren(next);
  const after = box.getBoundingClientRect().height;
  box.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: token('--dur-collapse'), easing: curve('--ease-out') });
  next.animate([{ opacity: 0, transform: `translateY(${token('--distance-item')}px)` }, { opacity: 1, transform: 'none' }],
    { duration: token('--dur-state'), easing: curve('--ease-out') });
}

/** Item sai da lista: encolhe e some, depois é removido. @param {HTMLElement} el */
export function leave(el) {
  const height = el.getBoundingClientRect().height;
  el.style.overflow = 'hidden';
  el.inert = true;
  const done = () => el.remove();
  el.animate([
    { height: `${height}px`, opacity: 1 },
    { height: `${height}px`, opacity: 0, offset: 0.4 },
    { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px' },
  ], { duration: token('--dur-collapse') + token('--dur-exit'), easing: curve('--ease-in-out') }).finished.then(done, done);
}
