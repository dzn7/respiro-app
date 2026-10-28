// Componentes próprios (UI.md › Componentes). Nenhum controle nativo de formulário:
// checkbox, switch, select, menu, tooltip e disclosure com teclado, foco visível e VoiceOver.
// Listas e menus abrem como popover "auto": Esc e clique fora fecham sem código extra.
import { icon } from './icons.js';

/** @typedef {Parameters<typeof icon>[0]} IconName */

let seq = 0;
/** @param {string} prefix */
export const uid = (prefix) => `${prefix}-${(seq += 1)}`;

/**
 * Cria elemento. Texto entra como nó de texto (nunca HTML).
 * @param {string} tag @param {Record<string, any>} [attrs] @param {...any} children
 * @returns {any}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') /** @type {any} */ (el)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return el;
}

/** Só SVGs do icons.js passam por innerHTML. @param {IconName} name @param {number} [size] */
export function svg(name, size = 16) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return /** @type {SVGElement} */ (t.content.firstChild);
}

/** @param {string} label @param {() => void} onclick @param {string} [variant] @param {Record<string, any>} [attrs] */
export const button = (label, onclick, variant = 'secondary', attrs = {}) =>
  h('button', { type: 'button', class: `button ${variant}`, onclick, ...attrs }, label);

// ---------- Checkbox e switch ----------

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.2 8.4l2.4 2.4 5.2-5.4" pathLength="1"/></svg>';

/**
 * Checkbox: role="checkbox", Espaço alterna. Nome vem de labelledBy (o texto do item) ou label.
 * @param {{ checked?: boolean, labelledBy?: string, label?: string, onChange?: (v: boolean) => void }} o
 */
export function checkbox({ checked = false, labelledBy, label, onChange }) {
  const box = h('button', { type: 'button', role: 'checkbox', class: 'checkbox', 'aria-checked': String(checked), 'aria-labelledby': labelledBy, 'aria-label': label });
  box.innerHTML = CHECK;
  box.addEventListener('click', () => {
    const next = box.getAttribute('aria-checked') !== 'true';
    box.setAttribute('aria-checked', String(next));
    onChange?.(next);
  });
  return /** @type {HTMLButtonElement} */ (box);
}

/**
 * Switch: role="switch", Espaço ou Enter alterna.
 * @param {{ checked?: boolean, labelledBy: string, describedBy?: string, onChange?: (v: boolean) => void }} o
 */
export function toggle({ checked = false, labelledBy, describedBy, onChange }) {
  const el = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(checked), 'aria-labelledby': labelledBy, 'aria-describedby': describedBy },
    h('span', { class: 'knob', 'aria-hidden': 'true' }));
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    onChange?.(next);
  });
  return el;
}

// ---------- Popover ancorado (select e menu) ----------

/**
 * Liga popover ao gatilho: âncora CSS, aria-expanded e foco de volta ao fechar.
 * @param {HTMLElement} trigger @param {HTMLElement} panel @param {(keyboard: boolean) => void} onOpen
 */
function anchor(trigger, panel, onOpen) {
  const name = `--${uid('anchor')}`;
  trigger.style.setProperty('anchor-name', name);
  panel.style.setProperty('position-anchor', name);
  /** @type {any} */ (trigger).popoverTargetElement = panel;
  trigger.setAttribute('aria-expanded', 'false');
  panel.addEventListener('toggle', (/** @type {any} */ e) => {
    const open = e.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (open) onOpen(trigger.matches(':focus-visible'));
    else if (!document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement)) trigger.focus();
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      /** @type {any} */ (panel).showPopover({ source: trigger });
    }
  });
}

/** Navegação comum de lista: setas, Home, End. @param {KeyboardEvent} e @param {number} index @param {number} count */
function moveKey(e, index, count) {
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[e.key];
  if (next === undefined) return null;
  e.preventDefault();
  return (next + count) % count;
}

/**
 * Select próprio (botão + listbox). Teclado: setas abrem e movem, Enter/Espaço escolhem, letra pula, Esc/Tab fecham.
 * @template T
 * @param {{ value: T, options: { value: T, label: string }[], labelledBy: string, onChange: (v: T) => void }} o
 */
export function select({ value, options, labelledBy, onChange }) {
  const id = uid('select');
  let current = value;
  let active = 0;
  const shown = h('span', { class: 'select-value' });
  const trigger = h('button', { type: 'button', class: 'select', id, 'aria-haspopup': 'listbox', 'aria-controls': `${id}-list`, 'aria-labelledby': `${labelledBy} ${id}` },
    shown, svg('caret-up-down', 12));
  const list = h('div', { class: 'popover listbox', role: 'listbox', popover: 'auto', id: `${id}-list`, tabindex: '-1', 'aria-labelledby': labelledBy });
  const rows = options.map((o, i) => h('div', { role: 'option', id: `${id}-${i}`, class: 'option', onclick: () => choose(i), onpointermove: () => focusRow(i) },
    svg('check', 14), h('span', {}, o.label)));
  list.append(...rows);

  const sync = () => {
    shown.textContent = options.find((o) => o.value === current)?.label ?? '';
    rows.forEach((r, i) => r.setAttribute('aria-selected', String(options[i].value === current)));
  };
  const focusRow = (/** @type {number} */ i) => {
    active = i;
    rows.forEach((r, j) => r.classList.toggle('active', j === i));
    list.setAttribute('aria-activedescendant', rows[i].id);
  };
  const choose = (/** @type {number} */ i) => {
    current = options[i].value;
    sync();
    list.hidePopover();
    onChange(current);
  };
  anchor(trigger, list, () => {
    focusRow(Math.max(0, options.findIndex((o) => o.value === current)));
    list.focus();
  });
  list.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const next = moveKey(e, active, rows.length);
    if (next !== null) return focusRow(next);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Tab') { e.preventDefault(); list.hidePopover(); }
    else if (e.key.length === 1) {
      const hit = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      const first = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit >= 0 || first >= 0) focusRow(hit >= 0 ? hit : first);
    }
  });
  sync();
  return h('span', { class: 'select-wrap' }, trigger, list);
}

/**
 * Menu de ações num botão de ícone. Setas, Home, End, Enter; Esc, Tab e clique fora fecham.
 * @param {{ label: string, icon: IconName, items: { label: string, icon: IconName, onSelect: () => void }[] }} o
 */
export function menu({ label, icon: glyph, items }) {
  const id = uid('menu');
  const trigger = h('button', { type: 'button', class: 'icon-button small', 'aria-label': label, 'data-tip': label, 'aria-haspopup': 'menu', 'aria-controls': id },
    svg(glyph, 16));
  const panel = h('div', { class: 'popover menu', role: 'menu', popover: 'auto', id, 'aria-label': label, tabindex: '-1' });
  const entries = items.map((item) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item', tabindex: '-1',
    onclick: () => { panel.hidePopover(); item.onSelect(); } }, svg(item.icon, 14), h('span', {}, item.label)));
  panel.append(...entries);
  // Aberto pelo teclado: foco no primeiro item. Pelo mouse: foco no menu, sem destacar nada ainda.
  anchor(trigger, panel, (keyboard) => (keyboard ? entries[0] : panel).focus());
  panel.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const next = moveKey(e, entries.indexOf(/** @type {any} */ (document.activeElement)), entries.length);
    if (next !== null) entries[next].focus();
    else if (e.key === 'Tab') { e.preventDefault(); panel.hidePopover(); }
  });
  panel.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.menu-item'))?.focus());
  return h('span', { class: 'menu-wrap' }, trigger, panel);
}

// ---------- Controle segmentado ----------

/**
 * Escolha única em linha (role="radiogroup"). Setas movem e escolhem, Home/End nas pontas; só a opção ativa entra no Tab.
 * @template T
 * @param {{ label: string, value: T, options: { value: T, label: string, count?: number }[], onChange: (v: T) => void }} o
 */
export function segmented({ label, value, options, onChange }) {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o, i) => h('button', { type: 'button', role: 'radio', class: 'seg-option', onclick: () => pick(i) },
    h('span', {}, o.label), o.count !== undefined && h('span', { class: 'count' }, String(o.count))));
  const sync = (/** @type {T} */ current) => buttons.forEach((b, i) => {
    const on = options[i].value === current;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const pick = (/** @type {number} */ i) => {
    sync(options[i].value);
    buttons[i].focus();
    onChange(options[i].value);
  };
  group.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const index = buttons.indexOf(/** @type {any} */ (document.activeElement));
    const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick((next + buttons.length) % buttons.length);
  });
  group.append(...buttons);
  sync(value);
  return group;
}

// ---------- Busca ----------

/**
 * Campo de busca: o único controle nativo permitido (texto), com visual próprio. Esc limpa antes de fechar o sheet.
 * @param {{ label: string, onInput: (text: string) => void }} o
 */
export function searchField({ label, onInput }) {
  const input = h('input', { type: 'search', class: 'search-input', placeholder: label, 'aria-label': label, spellcheck: false,
    oninput: () => onInput(input.value.trim().toLowerCase()) });
  input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      onInput('');
    }
  });
  return h('label', { class: 'search' }, svg('magnifying-glass', 14), input);
}

// ---------- Disclosure ----------

/**
 * Seção que expande e recolhe. Conteúdo recolhido fica inert (fora do Tab e do VoiceOver).
 * @param {{ label: any, content: any, open?: boolean }} o
 */
export function disclosure({ label, content, open = false }) {
  const id = uid('panel');
  const panel = h('div', { class: 'collapse', id, inert: !open }, h('div', { class: 'collapse-inner' }, content));
  panel.toggleAttribute('data-open', open);
  const trigger = h('button', { type: 'button', class: 'disclosure', 'aria-expanded': String(open), 'aria-controls': id,
    onclick: () => {
      const next = trigger.getAttribute('aria-expanded') !== 'true';
      trigger.setAttribute('aria-expanded', String(next));
      panel.toggleAttribute('data-open', next);
      panel.inert = !next;
    } }, svg('caret-right', 12), label);
  return [trigger, panel];
}

// ---------- Tooltip ----------

// Um tooltip só, para qualquer elemento com data-tip. Mouse: depois de uma pausa. Teclado: no foco. Esc esconde.
const tip = h('div', { class: 'tooltip', role: 'tooltip', popover: 'manual', id: 'tooltip' });
/** @type {HTMLElement | null} */
let owner = null;
let ownerAnchor = '';
let timer = 0;

/** @param {HTMLElement} el */
function showTip(el) {
  hideTip();
  owner = el;
  // Gatilho de menu já tem âncora própria: o tooltip soma a dele em vez de trocar.
  ownerAnchor = el.style.getPropertyValue('anchor-name');
  el.style.setProperty('anchor-name', ownerAnchor ? `${ownerAnchor}, --tip` : '--tip');
  tip.textContent = el.dataset.tip ?? '';
  (el.closest('dialog') ?? document.body).append(tip);
  tip.showPopover();
}
function hideTip() {
  clearTimeout(timer);
  if (tip.matches(':popover-open')) tip.hidePopover();
  if (owner && ownerAnchor) owner.style.setProperty('anchor-name', ownerAnchor);
  else owner?.style.removeProperty('anchor-name');
  owner = null;
}

export function installTooltips() {
  const delay = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-tooltip-delay')) || 0;
  document.addEventListener('pointerover', (e) => {
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-tip]'));
    if (!el || el === owner) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => showTip(el), delay());
  });
  document.addEventListener('pointerout', (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest?.('[data-tip]');
    if (el && !el.contains(/** @type {Node | null} */ (e.relatedTarget))) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (el.dataset?.tip && el.matches(':focus-visible') && el.getAttribute('aria-expanded') !== 'true') showTip(el);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); }, true);
  document.body.append(tip);
}
