// DerivedData, simuladores e cache do Xcode.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, home, measure, newestMtime, run, tilde } from '../sys.js';

export const id = 'xcode';
export const name = 'Xcode';
export const blurb = 'Builds intermediários (DerivedData), simuladores que não abrem mais e cache do Xcode. O Xcode recria o que precisar.';

const DERIVED = join(home, 'Library/Developer/Xcode/DerivedData');
const DEVICES = join(home, 'Library/Developer/CoreSimulator/Devices');
const CACHE = join(home, 'Library/Caches/com.apple.dt.Xcode');

export const xcodeRunning = () => run('/usr/bin/pgrep', ['-x', 'Xcode'], { timeout: 5000 }).then(() => true, () => false);

/** @returns {Promise<{ udid: string, name: string, runtime: string }[] | null>} null quando o simctl não existe */
async function unavailableSimulators() {
  try {
    const out = JSON.parse(await run('xcrun', ['simctl', 'list', 'devices', 'unavailable', '-j'], { timeout: 20_000 }));
    return Object.entries(out.devices ?? {}).flatMap(([runtime, list]) =>
      /** @type {{ udid: string, name: string }[]} */ (list).map((d) => ({ udid: d.udid, name: d.name, runtime })));
  } catch { return null; }
}

/** @param {string} runtime */
const prettyRuntime = (runtime) => runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');

export async function scan() {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  const busy = await xcodeRunning();
  const busyNote = 'O Xcode está aberto. Limpar agora pode atrapalhar um build em andamento.';

  for (const entry of await readdir(DERIVED, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = join(DERIVED, entry.name);
    items.push({
      id: `derived-${entry.name}`, name: entry.name.replace(/-[a-z]{28}$/, ''), detail: 'DerivedData', path, size: 0, freeable: 0,
      safe: !busy, inUse: busy, lastUsed: await newestMtime(path), note: busy ? busyNote : undefined, action: { kind: 'trash', path },
    });
  }

  if (await exists(CACHE)) {
    items.push({ id: 'cache', name: 'Cache do Xcode', detail: tilde(CACHE), path: CACHE, size: 0, freeable: 0, safe: !busy, inUse: busy,
      note: busy ? busyNote : undefined, action: { kind: 'trash', path: CACHE } });
  }

  const unavailable = await unavailableSimulators();
  if (unavailable) {
    // Xcode instalado: o comando oficial apaga só os simuladores que o Xcode atual não abre mais.
    const parts = await measure(unavailable.map((d) => ({ id: d.udid, name: `${d.name} (${prettyRuntime(d.runtime)})`, path: join(DEVICES, d.udid),
      size: 0, freeable: 0, safe: true, action: null })));
    if (parts.length) {
      const total = parts.reduce((sum, p) => sum + p.size, 0);
      items.push({ id: 'simulators', name: 'Simuladores indisponíveis', detail: `${parts.length} simuladores`, size: total, freeable: total, safe: true, parts: parts.map((p) => ({ name: p.name, size: p.size })), action: { kind: 'cmd', key: 'simctl-delete-unavailable' } });
    }
  } else {
    // Sem Xcode (só Command Line Tools): nenhum simulador abre. Atenção, não seguro: voltam se o Xcode for reinstalado.
    for (const udid of await readdir(DEVICES).catch(() => [])) {
      if (!/^[0-9A-F-]{36}$/.test(udid)) continue;
      const path = join(DEVICES, udid);
      /** @type {{ name?: string, runtime?: string }} */
      const plist = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(path, 'device.plist')], { timeout: 5000 })
        .then((o) => JSON.parse(o), () => ({}));
      items.push({
        id: `sim-${udid}`, name: plist.name ?? 'Simulador', detail: plist.runtime ? prettyRuntime(plist.runtime) : 'Simulador', path, size: 0, freeable: 0,
        safe: false, lastUsed: await newestMtime(path), note: 'O Xcode não está instalado. Este simulador só volta a abrir se você reinstalar o Xcode.',
        action: { kind: 'trash', path },
      });
    }
  }

  if (!items.length) return null;
  return { items: await measure(items) };
}
