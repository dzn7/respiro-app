// Gráfico de linha no tempo: o espaço livre do Histórico (série única) e a memória do Desempenho (em uso e swap, mesmo
// eixo, em bytes). Cores --chart-line e --chart-line-2, validadas no claro e no escuro; ponto em cada limpeza; dica no
// hover e nas setas do teclado; tabela para leitor de tela.
import { h } from './controls.js';
import { formatBytes, formatDateTime, t } from '../shared/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 560;
const H = 176;
const PAD = { top: 12, right: 12, bottom: 24, left: 58 };
const DAY = 86_400_000;

/** @param {string} tag @param {Record<string, string | number>} attrs */
function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Teto "redondo" do eixo: 1, 2 ou 5 × 10^n. @param {number} v */
export function niceMax(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * step >= v) ?? 10) * step;
}

/**
 * @typedef {{ at: number } & Record<string, number>} Point
 * @typedef {{
 *   series: { key: string, label: string }[], from: number, now: number, x: (at: number) => string,
 *   label: (start: number, min: number, max: number) => string, title: string, date: string, empty: string,
 *   marks?: number[], markLabel?: string,
 * }} ChartOptions
 */

/**
 * Uma ou duas séries no mesmo eixo; a primeira com área. Duas séries = legenda em cima (cor nunca sozinha).
 * @param {{ at: number }[]} data @param {ChartOptions} o
 */
export function timeChart(data, o) {
  const points = /** @type {Point[]} */ (data).filter((p) => p.at >= o.from).sort((a, b) => a.at - b.at);
  if (points.length < 2) return h('p', { class: 'empty chart-empty' }, o.empty);
  const { series, now } = o;
  const first = points.map((p) => p[series[0].key]);

  const start = points[0].at;
  const top = niceMax(Math.max(...points.flatMap((p) => series.map((s) => p[s.key]))) * 1.1);
  const x = (/** @type {number} */ at) => PAD.left + ((at - start) / Math.max(1, now - start)) * (W - PAD.left - PAD.right);
  const y = (/** @type {number} */ v) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const base = y(0);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', tabindex: 0, 'aria-label': o.label(start, Math.min(...first), Math.max(...first)) });
  for (const v of [0, top / 2, top]) {
    svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: 'chart-grid' }));
    const label = el('text', { x: PAD.left - 8, y: y(v) + 4, class: 'chart-axis', 'text-anchor': 'end' });
    // Zero na mesma unidade do teto: "0 GB", não "0 KB".
    label.textContent = v ? formatBytes(v) : formatBytes(top).replace(/[\d.,\s]+/, '0 ');
    svg.append(label);
  }
  for (const [at, anchor] of /** @type {const} */ ([[start, 'start'], [now, 'end']])) {
    const label = el('text', { x: x(at), y: H - 6, class: 'chart-axis', 'text-anchor': anchor });
    label.textContent = o.x(at);
    svg.append(label);
  }

  series.forEach((s, i) => {
    const line = points.map((p, j) => `${j ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    if (i === 0) svg.append(el('path', { d: `${line}L${x(points.at(-1)?.at ?? now).toFixed(1)},${base}L${x(start).toFixed(1)},${base}Z`, class: 'chart-area' }));
    svg.append(el('path', { d: line, class: 'chart-line', 'data-series': i }));
  });

  // Limpeza: ponto na amostra tirada logo depois dela.
  const marks = (o.marks ?? []).filter((at) => at >= start).map((at) => points.find((p) => p.at >= at) ?? points.at(-1)).filter((p) => p !== undefined);
  for (const p of marks) svg.append(el('circle', { cx: x(p.at), cy: y(p[series[0].key]), r: 4, class: 'chart-mark' }));

  const cross = el('line', { y1: PAD.top, y2: base, class: 'chart-cross', visibility: 'hidden' });
  const dots = series.map((_, i) => el('circle', { r: 4.5, class: 'chart-dot', 'data-series': i, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const legend = series.length > 1 && h('div', { class: 'chart-legend', 'aria-hidden': 'true' },
    series.map((s, i) => h('span', { class: 'chart-key', 'data-series': i }, s.label)));
  const wrap = h('div', { class: 'chart' }, svg, tip);

  let index = -1;
  /** @param {number} i */
  const show = (i) => {
    index = Math.max(0, Math.min(points.length - 1, i));
    const p = points[index];
    for (const node of [cross, ...dots]) node.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', String(x(p.at)));
    cross.setAttribute('x2', String(x(p.at)));
    dots.forEach((dot, j) => {
      dot.setAttribute('cx', String(x(p.at)));
      dot.setAttribute('cy', String(y(p[series[j].key])));
    });
    const values = series.length > 1
      ? series.map((s, j) => h('span', { class: 'chart-tip-series', 'data-series': j }, `${s.label} `, h('span', { class: 'chart-tip-value' }, formatBytes(p[s.key]))))
      : [h('span', { class: 'chart-tip-value' }, formatBytes(p[series[0].key]))];
    tip.replaceChildren(...values, h('span', {}, formatDateTime(p.at)),
      ...(marks.includes(p) ? [h('span', { class: 'chart-tip-mark' }, o.markLabel ?? '')] : []));
    tip.hidden = false;
    const left = (x(p.at) / W) * 100;
    tip.style.setProperty('--x', `${left}%`);
    tip.toggleAttribute('data-flip', left > 70);
  };
  const hide = () => { index = -1; tip.hidden = true; for (const node of [cross, ...dots]) node.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const at = start + (((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right) * (now - start);
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.at - at) < Math.abs(points[best].at - at)) best = i; });
    show(best);
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) { e.preventDefault(); show(index < 0 ? points.length - 1 : index + step); }
    if (e.key === 'Home') { e.preventDefault(); show(0); }
    if (e.key === 'End') { e.preventDefault(); show(points.length - 1); }
  });

  const table = h('table', { class: 'sr-only' }, h('caption', {}, o.title),
    h('tr', {}, h('th', {}, o.date), series.map((s) => h('th', {}, s.label))),
    points.map((p) => h('tr', {}, h('td', {}, formatDateTime(p.at)), series.map((s) => h('td', {}, formatBytes(p[s.key]))))));
  return h('div', {}, legend, wrap, table);
}

/**
 * Espaço livre do Histórico nos últimos `days` dias, com um ponto em cada limpeza.
 * @param {import('../types.js').Sample[]} samples @param {import('../types.js').HistoryEntry[]} cleanups
 * @param {number} days @param {number} [now]
 */
export function freeChart(samples, cleanups, days, now = Date.now()) {
  const day = new Intl.DateTimeFormat(document.documentElement.lang, { day: 'numeric', month: 'short' });
  return timeChart(samples, {
    series: [{ key: 'free', label: t('chart.free') }], from: now - days * DAY, now, x: (at) => day.format(at),
    label: (start, min, max) => t('chart.label', { start, min, max }), title: t('chart.title'), date: t('chart.date'), empty: t('chart.empty'),
    marks: cleanups.map((c) => c.at), markLabel: t('chart.cleanup'),
  });
}
