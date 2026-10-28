// Homebrew dentro de "Caches de pacotes": downloads em cache e versões antigas, pela prévia oficial (`brew cleanup -n`).
import { basename } from 'node:path';
import { brewPreview } from '../cleaner.js';
import { msg } from '../../shared/i18n.js';
import { has, parseSize, tilde } from '../sys.js';

/**
 * "Would remove: /opt/homebrew/Cellar/x/1.0 (12 files, 3.4MB)" → partes. Puro, testado.
 * @param {string} out
 */
export function parsePreview(out) {
  return [...out.matchAll(/^Would remove: (.+?) \((?:[\d,]+ files?, )?([\d.]+\s*[KMGT]?B)\)$/gm)]
    .map((m) => ({ name: m[1], size: parseSize(m[2], 1024) }));
}

/** @returns {Promise<import('../../types.js').Item | null>} */
export async function brewItem() {
  if (!(await has('brew'))) return null;
  const parts = parsePreview(await brewPreview());
  const size = parts.reduce((sum, p) => sum + p.size, 0);
  if (!size) return null;
  return {
    id: 'brew', name: msg('name.brewDownloads'), detail: msg('detail.items', { n: parts.length }), size, freeable: size, safe: true,
    parts: parts.sort((a, b) => b.size - a.size).map((p) => ({ name: p.name.includes('/Cellar/') ? tilde(p.name) : basename(p.name), size: p.size })),
    action: { kind: 'cmd', key: 'brew-cleanup' },
  };
}
