// Downloads em cache e versões antigas. A lista vem da prévia oficial (`brew cleanup -n`).
import { basename } from 'node:path';
import { brewPreview } from '../cleaner.js';
import { has, parseSize, tilde } from '../sys.js';

export const id = 'homebrew';
export const name = 'Homebrew';
export const blurb = 'Instaladores baixados e versões antigas de fórmulas. O Homebrew baixa de novo se precisar.';

/**
 * "Would remove: /opt/homebrew/Cellar/x/1.0 (12 files, 3.4MB)" → partes. Puro, testado.
 * @param {string} out
 */
export function parsePreview(out) {
  return [...out.matchAll(/^Would remove: (.+?) \((?:[\d,]+ files?, )?([\d.]+\s*[KMGT]?B)\)$/gm)]
    .map((m) => ({ name: m[1], size: parseSize(m[2], 1024) }));
}

export async function scan() {
  if (!(await has('brew'))) return null;
  const parts = parsePreview(await brewPreview());
  const size = parts.reduce((sum, p) => sum + p.size, 0);
  if (!size) return null;
  return {
    items: [{
      id: 'downloads', name: 'Downloads e versões antigas', detail: `${parts.length} itens`, size, freeable: size, safe: true,
      parts: parts.sort((a, b) => b.size - a.size).map((p) => ({ name: p.name.includes('/Cellar/') ? tilde(p.name) : basename(p.name), size: p.size })),
      action: /** @type {const} */ ({ kind: 'cmd', key: 'brew-cleanup' }),
    }],
  };
}
