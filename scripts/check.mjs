// Regras do projeto que lint genérico não cobre. Sem argumentos: projeto inteiro.
// Com arquivos: só esses (usado pelo hook). Imprime só falhas.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TOKENS = 'src/renderer/tokens.css';
const CLEANER = 'src/main/cleaner.js';

/** @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

const args = process.argv.slice(2).map((f) => relative(root, resolve(f)));
const files = (args.length ? args : [...walk('src'), 'package.json'])
  .filter((f) => /^(src\/|package\.json$)/.test(f) && /\.(m?js|cjs|css|html|json)$/.test(f));

/** @type {string[]} */
const errors = [];
/** @param {string} file @param {string} text @param {number} index @param {string} msg */
const fail = (file, text, index, msg) =>
  errors.push(`${file}:${text.slice(0, index).split('\n').length}: ${msg}`);

const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/gi;
// Texto (busca) é o único controle nativo permitido; escolha, seleção e menus são componentes próprios.
const NATIVE_CONTROL = /h\('(?:select|details|summary|datalist)'|<(?:select|details|summary|datalist)\b|type: ['"](?:checkbox|radio|range|color|date)['"]|<input\b[^>]*type="(?:checkbox|radio|range|color|date)"/g;
const DELETE_CALL = /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|trashItem|emptyDir)\s*\(/g;
const DELETE_WORD = /(['"`])(?:rm|rmi|prune|purge|clean|cleanup|delete)\1|empty trash/gi;

for (const file of files) {
  let text;
  try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }

  for (const m of text.matchAll(/lucide/gi)) fail(file, text, m.index, 'Lucide é proibido; use Phosphor (UI.md › Ícones)');

  if (file.startsWith('src/renderer/') && file !== TOKENS && !file.endsWith('icons.js')) {
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (c) => ' '.repeat(c.length));
    // Em CSS só valores de declaração; em JS/HTML qualquer literal de cor.
    const scan = file.endsWith('.css') ? [...code.matchAll(/:[^;{}]*;/g)] : [{ 0: code, index: 0 }];
    for (const chunk of scan) {
      for (const m of chunk[0].matchAll(COLOR)) {
        fail(file, text, (chunk.index ?? 0) + (m.index ?? 0), `cor fora dos tokens: "${m[0]}" (use var(--token) de ${TOKENS})`);
      }
    }
  }

  if (file.startsWith('src/renderer/')) {
    for (const m of text.matchAll(NATIVE_CONTROL)) fail(file, text, m.index, `controle nativo proibido: "${m[0]}" (use controls.js, UI.md › Componentes)`);
  }

  if (file.startsWith('src/') && file !== CLEANER) {
    for (const re of [DELETE_CALL, DELETE_WORD]) {
      for (const m of text.matchAll(re)) fail(file, text, m.index, `exclusão fora de ${CLEANER}: "${m[0]}" (PRD › S1)`);
    }
  }
}

// Contraste dos pares de texto definidos no UI.md, em claro e escuro.
if (!args.length || args.includes(TOKENS)) {
  const css = readFileSync(join(root, TOKENS), 'utf8');
  const light = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  const dark = css.match(/prefers-color-scheme:\s*dark[\s\S]*?\{[^{]*\{([^}]*)\}/)?.[1] ?? '';
  /** @param {string} block */
  const vars = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  /** @param {string} hex */
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** @param {string} a @param {string} b */
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const PAIRS = [['text', 'surface'], ['text', 'canvas'], ['text-secondary', 'surface'], ['text-secondary', 'canvas'],
    ['accent', 'surface'], ['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['on-accent', 'danger'],
    ['safe', 'surface'], ['attention', 'surface'], ['danger', 'surface'], ['text', 'popover'], ['text-secondary', 'popover']];
  for (const [mode, block] of [['claro', light], ['escuro', dark]]) {
    const v = vars(block);
    for (const [fg, bg] of PAIRS) {
      if (!v[fg] || !v[bg]) { errors.push(`${TOKENS}: ${mode}: token --${fg} ou --${bg} ausente ou não hex`); continue; }
      const r = ratio(v[fg], v[bg]);
      if (r < 4.5) errors.push(`${TOKENS}: ${mode}: --${fg} sobre --${bg} = ${r.toFixed(2)}:1 (mínimo 4,5)`);
    }
  }
}

if (errors.length) {
  console.error(errors.slice(0, 40).join('\n'));
  process.exit(1);
}
