// Contas puras do Explorar (sem DOM): o treemap e o tipo de cada arquivo. Testadas em test/explore.test.js.

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

/** @param {number[]} row */
const sum = (row) => row.reduce((s, a) => s + a, 0);

/** Pior proporção (lado maior / menor) de uma faixa encostada num lado de comprimento `side`. @param {number[]} row @param {number} side */
function worst(row, side) {
  const s = sum(row);
  return Math.max((side * side * Math.max(...row)) / (s * s), (s * s) / (side * side * Math.min(...row)));
}

/**
 * Treemap squarified (Bruls, Huizing e van Wijk): área proporcional ao valor, retângulos o mais perto possível de
 * quadrados. Valores positivos, do maior para o menor; devolve os retângulos na mesma ordem.
 * @param {number[]} values @param {Rect} rect @returns {Rect[]}
 */
export function squarify(values, { x, y, w, h }) {
  const total = sum(values);
  if (!total || w <= 0 || h <= 0) return values.map(() => ({ x, y, w: 0, h: 0 }));
  const areas = values.map((v) => (v * w * h) / total);
  /** @type {Rect[]} */
  const out = [];
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    // A faixa cresce enquanto o pior retângulo dela fica mais quadrado.
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const thick = sum(row) / side;
    let offset = 0;
    for (const a of row) {
      const len = a / thick;
      out.push(w >= h ? { x, y: y + offset, w: thick, h: len } : { x: x + offset, y, w: len, h: thick });
      offset += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}

const KINDS = /** @type {const} */ ({
  media: /^(mp4|mov|m4v|mkv|avi|webm|wmv|mp3|m4a|wav|aif|aiff|flac|aac|ogg)$/,
  image: /^(jpe?g|png|heic|heif|gif|tiff?|webp|cr2|cr3|nef|arw|dng|psd|svg)$/,
  archive: /^(zip|dmg|iso|pkg|tar|gz|tgz|bz2|xz|7z|rar|xip|ipsw|img|sparseimage)$/,
});

/**
 * Tipo para a cor do treemap e a legenda: pasta, app, mídia, imagem, compactado ou outro.
 * @param {string} name @param {boolean} dir @returns {'folder' | 'app' | 'media' | 'image' | 'archive' | 'other'}
 */
export function kindOf(name, dir) {
  if (/\.app$/i.test(name)) return 'app';
  if (dir) return 'folder';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return /** @type {(keyof typeof KINDS)[]} */ (Object.keys(KINDS)).find((k) => KINDS[k].test(ext)) ?? 'other';
}
