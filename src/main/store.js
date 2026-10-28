// Último resultado, histórico, preferências e cache de tamanhos, num JSON em userData.
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {{ scan: import('../types.js').Scan | null, history: import('../types.js').HistoryEntry[], samples: import('../types.js').Sample[],
 *   deferred: string[], lastAlert: number,
 *   prefs: import('../types.js').Prefs, sizeCache: import('../types.js').ScanContext['sizeCache'] }} Data
 */

/** @type {Data} */
export let data = { scan: null, history: [], samples: [], deferred: [], lastAlert: 0, prefs: { simulate: false, staleDays: 30, theme: 'system', scanOnLaunch: true, ignored: [], locale: 'system',
  onboarded: false, showInMenuBar: true, openAtLogin: false, lowDiskAlert: 10 }, sizeCache: {} };
const file = () => join(app.getPath('userData'), 'respiro.json');

export function load() {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8'));
    data = { ...data, ...saved, prefs: { ...data.prefs, ...saved.prefs } };
  } catch { /* primeira abertura */ }
}

let writing = Promise.resolve();
export function save() {
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file());
  }).catch((e) => console.error('[store]', e));
  return writing;
}
