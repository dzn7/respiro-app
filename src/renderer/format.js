// Números e datas como o UI.md › Escrita define. Puro: testado em test/format.test.js.

const UNITS = ['KB', 'MB', 'GB', 'TB'];
/** @type {Record<number, Intl.NumberFormat>} */
const nf = {
  0: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
  1: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }),
};

/** Decimal como o Finder: 12,4 GB; 245 GB; 512 MB. @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1000) return bytes > 0 ? '1 KB' : '0 KB';
  let i = Math.min(Math.floor(Math.log10(bytes) / 3) - 1, UNITS.length - 1);
  let value = bytes / 1000 ** (i + 1);
  const digits = () => (i >= 2 && value < 100 ? 1 : 0);
  if (Number(value.toFixed(digits())) >= 1000 && i < UNITS.length - 1) { i += 1; value /= 1000; }
  return `${nf[digits()].format(value)} ${UNITS[i]}`;
}

/** @param {number} ts @param {number} [now] */
export function formatAgo(ts, now = Date.now()) {
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return months <= 1 ? 'há 1 mês' : `há ${months} meses`;
  const years = Math.floor(days / 365.25);
  return years <= 1 ? 'há 1 ano' : `há ${years} anos`;
}

/** "agora", "há 5 min", "há 2 h", depois formatAgo. @param {number} ts @param {number} [now] */
export function formatUpdated(ts, now = Date.now()) {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`;
  return formatAgo(ts, now);
}

/** @param {number} n @param {string} one @param {string} many */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
