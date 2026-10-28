// Textos do Respiro em três idiomas. O processo principal e a tela usam este mesmo módulo:
// o main devolve chaves (Msg) e quem mostra traduz, então a análise salva não depende de idioma.
import en from './locales/en.js';
import es from './locales/es.js';
import ptBR from './locales/pt-BR.js';

/**
 * @typedef {'pt-BR' | 'en' | 'es'} Locale
 * @typedef {import('../types.js').Msg} Msg
 * @typedef {import('../types.js').Text} Text
 * @typedef {Record<string, string | { one: string, other: string }>} Dict
 */

export const LOCALES = /** @type {const} */ (['pt-BR', 'en', 'es']);
/** Cada idioma escrito nele mesmo, como no seletor do macOS. */
export const LANGUAGE_NAMES = { 'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español' };
/** @type {Record<Locale, Dict>} */
export const DICTS = { 'pt-BR': ptBR, en, es };

/** @type {Locale} */
let current = 'pt-BR';

/**
 * Preferência da pessoa ou idioma do sistema → um dos três. Fora deles, inglês.
 * @param {string | undefined} pref 'system' ou um Locale @param {string} [system] ex.: 'pt-BR', 'es-419', 'en-US'
 * @returns {Locale}
 */
export function resolveLocale(pref, system = '') {
  if (pref && pref !== 'system' && pref in DICTS) return /** @type {Locale} */ (pref);
  const s = system.toLowerCase();
  if (s.startsWith('pt')) return 'pt-BR';
  if (s.startsWith('es')) return 'es';
  return 'en';
}

/** @param {Locale} locale */
export function setLocale(locale) { current = locale in DICTS ? locale : 'en'; }
export const getLocale = () => current;

/** @param {string} key @param {Record<string, unknown>} [params] */
export const msg = (key, params) => /** @type {Msg} */ (params ? { key, params } : { key });

/** @param {string} key */
export const has = (key) => key in DICTS[current];

/**
 * Molde cru da chave já com o plural escolhido. Serve para quem precisa encaixar elementos no texto.
 * @param {string} key @param {number} [n]
 */
export function template(key, n = 0) {
  const entry = DICTS[current][key];
  if (entry === undefined) return `⟦${key}⟧`;
  if (typeof entry === 'string') return entry;
  return new Intl.PluralRules(current).select(n) === 'one' ? entry.one : entry.other;
}

/**
 * Texto final. Marcadores: {nome} e {nome|bytes}, {nome|date}, {nome|ago}, {nome|since}.
 * Parâmetro que é Msg é traduzido também. Plural escolhe pelo parâmetro `n`.
 * @param {string} key @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
  return template(key, Number(params.n ?? 0)).replace(/\{(\w+)(?:\|(\w+))?\}/g, (/** @type {string} */ _, /** @type {string} */ name, /** @type {string | undefined} */ fmt) => formatParam(params[name], fmt));
}

/** String passa direto; Msg vira texto no idioma atual. @param {Text | undefined | null} value @returns {string} */
export function tx(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : t(value.key, value.params);
}

/** @param {unknown} value @param {string | undefined} fmt @returns {string} */
function formatParam(value, fmt) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return tx(/** @type {Msg} */ (value));
  if (fmt === 'bytes') return formatBytes(Number(value));
  if (fmt === 'date') return new Intl.DateTimeFormat(current, { day: 'numeric', month: 'short', year: 'numeric' }).format(Number(value));
  if (fmt === 'ago') return formatAgo(Number(value));
  if (fmt === 'since') return formatUpdated(Number(value));
  return String(value);
}

// ---------- Números e datas ----------

const UNITS = ['KB', 'MB', 'GB', 'TB'];

/** Decimal como o Finder, no formato do idioma: 12,4 GB · 12.4 GB · 245 GB · 512 MB. @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1000) return bytes > 0 ? '1 KB' : '0 KB';
  let i = Math.min(Math.floor(Math.log10(bytes) / 3) - 1, UNITS.length - 1);
  let value = bytes / 1000 ** (i + 1);
  const digits = () => (i >= 2 && value < 100 ? 1 : 0);
  if (Number(value.toFixed(digits())) >= 1000 && i < UNITS.length - 1) { i += 1; value /= 1000; }
  return `${new Intl.NumberFormat(current, { maximumFractionDigits: digits() }).format(value)} ${UNITS[i]}`;
}

/** Dia como menor unidade: hoje, ontem, há 3 dias, há 2 meses. @param {number} ts @param {number} [now] */
export function formatAgo(ts, now = Date.now()) {
  // "hoje" e "ontem" por extenso; mês e ano sempre com número ("há 1 mês", não "mês passado").
  const words = new Intl.RelativeTimeFormat(current, { numeric: 'auto' });
  const numbers = new Intl.RelativeTimeFormat(current, { numeric: 'always' });
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return words.format(0, 'day');
  if (days < 30) return words.format(-days, 'day');
  const months = Math.floor(days / 30.44);
  if (months < 12) return numbers.format(-Math.max(1, months), 'month');
  return numbers.format(-Math.max(1, Math.floor(days / 365.25)), 'year');
}

/** Minuto como menor unidade: agora, há 5 minutos, há 2 horas, depois formatAgo. @param {number} ts @param {number} [now] */
export function formatUpdated(ts, now = Date.now()) {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return new Intl.RelativeTimeFormat(current, { numeric: 'auto' }).format(0, 'second');
  const numbers = new Intl.RelativeTimeFormat(current, { numeric: 'always' });
  if (min < 60) return numbers.format(-min, 'minute');
  if (min < 24 * 60) return numbers.format(-Math.floor(min / 60), 'hour');
  return formatAgo(ts, now);
}

/** Data e hora curtas para o histórico. @param {number} ts */
export const formatDateTime = (ts) =>
  new Intl.DateTimeFormat(current, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
