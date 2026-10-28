// Gera src/renderer/icons.js com os SVGs Phosphor (peso regular) usados no app.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NAMES = [
  'package', 'shipping-container', 'tree-structure', 'hammer', 'browsers', 'beer-stein', 'stack', 'trash',
  'check-circle', 'warning', 'warning-octagon', 'lock-simple', 'arrow-clockwise', 'clock-counter-clockwise',
  'gear-six', 'caret-right', 'folder-open', 'info', 'eye', 'hard-drives', 'check', 'caret-up-down', 'dots-three', 'copy', 'magnifying-glass', 'eye-slash', 'sun', 'moon', 'circle-half', 'terminal-window', 'shield-check', 'arrow-left', 'archive', 'squares-four', 'file', 'copy-simple', 'magnifying-glass-plus', 'arrow-up-left',
];

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = Object.fromEntries(NAMES.map((name) => {
  const svg = readFileSync(`${root}node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, 'utf8');
  return [name, svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')];
}));

writeFileSync(`${root}src/renderer/icons.js`, `// Gerado por scripts/icons.mjs (Phosphor Icons, regular, MIT). Não edite à mão.
const PATHS = ${JSON.stringify(paths, null, 1)};

/**
 * @param {keyof typeof PATHS} name
 * @param {number} [size]
 */
export function icon(name, size = 16) {
  return \`<svg class="icon" width="\${size}" height="\${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">\${PATHS[name]}</svg>\`;
}
`);
console.log(`icons.js: ${NAMES.length} ícones`);
