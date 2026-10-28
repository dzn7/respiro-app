// DerivedData, simuladores, cache e DeviceSupport do Xcode; emuladores e system images do Android.
import { basename, join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { readdir, readFile } from 'node:fs/promises';
import { exists, has, home, measure, newestMtime, run, tilde } from '../sys.js';

export const id = 'xcode';

const DERIVED = join(home, 'Library/Developer/Xcode/DerivedData');
const DEVICES = join(home, 'Library/Developer/CoreSimulator/Devices');
const CACHE = join(home, 'Library/Caches/com.apple.dt.Xcode');
const DEVICE_SUPPORT = ['iOS', 'watchOS', 'tvOS', 'visionOS'].map((os) => join(home, `Library/Developer/Xcode/${os} DeviceSupport`));
export const ANDROID_SDK = process.env.ANDROID_HOME || join(home, 'Library/Android/sdk');
const AVD = join(home, '.android/avd');
const byVersion = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b, 'en', { numeric: true });

/**
 * A pasta mais nova de cada aparelho fica; as outras o Xcode recria ao conectar o aparelho de novo.
 * "iPhone14,2 17.0 (21A329)" agrupa por iPhone14,2; nomes antigos ("16.4 (20E247)") formam um grupo só.
 * @param {string[]} names @returns {Set<string>}
 */
export function newestDeviceSupport(names) {
  /** @type {Map<string, string>} */
  const newest = new Map();
  for (const name of names) {
    const model = /^\S+,\S+ /.test(name) ? name.split(' ')[0] : '';
    const current = newest.get(model);
    if (!current || byVersion(name.slice(model.length), current.slice(model.length)) > 0) newest.set(model, name);
  }
  return new Set(newest.values());
}

/** config.ini de um AVD → system-images/android-34/google_apis/arm64-v8a @param {string} text */
export function avdImage(text) {
  const dir = /^image\.sysdir\.1\s*=\s*(.+)$/m.exec(text)?.[1].trim().replace(/\/+$/, '');
  return dir && /^system-images\/[^/]+\/[^/]+\/[^/]+$/.test(dir) ? dir : null;
}

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
  const busyNote = msg('note.xcodeOpen');

  for (const entry of await readdir(DERIVED, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = join(DERIVED, entry.name);
    items.push({
      id: `derived-${entry.name}`, name: entry.name.replace(/-[a-z]{28}$/, ''), detail: 'DerivedData', path, size: 0, freeable: 0,
      safe: !busy, inUse: busy, lastUsed: await newestMtime(path), note: busy ? busyNote : undefined, action: { kind: 'trash', path },
    });
  }

  if (await exists(CACHE)) {
    items.push({ id: 'cache', name: msg('name.xcodeCache'), detail: tilde(CACHE), path: CACHE, size: 0, freeable: 0, safe: !busy, inUse: busy,
      note: busy ? busyNote : undefined, action: { kind: 'trash', path: CACHE } });
  }

  const unavailable = await unavailableSimulators();
  if (unavailable) {
    // Xcode instalado: o comando oficial apaga só os simuladores que o Xcode atual não abre mais.
    const parts = await measure(unavailable.map((d) => ({ id: d.udid, name: `${d.name} (${prettyRuntime(d.runtime)})`, path: join(DEVICES, d.udid),
      size: 0, freeable: 0, safe: true, action: null })));
    if (parts.length) {
      const total = parts.reduce((sum, p) => sum + p.size, 0);
      items.push({ id: 'simulators', name: msg('name.simsUnavailable'), detail: msg('detail.simulators', { n: parts.length }), size: total, freeable: total, safe: true, parts: parts.map((p) => ({ name: String(p.name), size: p.size })), action: { kind: 'cmd', key: 'simctl-delete-unavailable' } });
    }
  } else if (!(await readdir('/Applications').catch(() => [])).some((n) => /^Xcode.*\.app$/.test(n))) {
    // Sem Xcode (só Command Line Tools): nenhum simulador abre. Com Xcode instalado e simctl falhando
    // (xcode-select apontando para as CLT, tempo esgotado), não dá para saber: os simuladores ficam de fora. Atenção, não seguro: voltam se o Xcode for reinstalado.
    for (const udid of await readdir(DEVICES).catch(() => [])) {
      if (!/^[0-9A-F-]{36}$/.test(udid)) continue;
      const path = join(DEVICES, udid);
      /** @type {{ name?: string, runtime?: string }} */
      const plist = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(path, 'device.plist')], { timeout: 5000 })
        .then((o) => JSON.parse(o), () => ({}));
      items.push({
        id: `sim-${udid}`, name: plist.name ?? msg('name.simulator'), detail: plist.runtime ? prettyRuntime(plist.runtime) : msg('name.simulator'), path, size: 0, freeable: 0,
        safe: false, lastUsed: await newestMtime(path), note: msg('note.simNoXcode'),
        action: { kind: 'trash', path },
      });
    }
  }

  for (const root of DEVICE_SUPPORT) {
    const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
    const keep = newestDeviceSupport(names);
    for (const name of names) {
      const path = join(root, name);
      const latest = keep.has(name);
      items.push({ id: `devsupport-${basename(root)}-${name}`, name, detail: basename(root), path, size: 0, freeable: 0, lastUsed: await newestMtime(path),
        safe: !busy && !latest, inUse: busy, note: busy ? busyNote : msg(latest ? 'note.deviceSupportLatest' : 'note.deviceSupportOld'),
        action: { kind: 'trash', path } });
    }
  }

  items.push(...(await android()));
  if (!items.length) return null;
  return { items: await measure(items) };
}

/** Emuladores (AVD) e system images do SDK. Image citada por um AVD está em uso. */
async function android() {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  const [avdmanager, sdkmanager] = await Promise.all([has('avdmanager'), has('sdkmanager')]);
  const emulator = await run('/usr/bin/pgrep', ['-f', 'qemu-system'], { timeout: 5000 }).then(() => true, () => false);
  const used = new Set();
  for (const entry of await readdir(AVD).catch(() => [])) {
    const name = /^([\w.-]{1,100})\.avd$/.exec(entry)?.[1];
    if (!name) continue;
    const path = join(AVD, entry);
    const image = avdImage(await readFile(join(path, 'config.ini'), 'utf8').catch(() => ''));
    if (image) used.add(image);
    // Sem avdmanager não há como apagar o AVD inteiro (pasta + .ini); fica só informativo.
    items.push({ id: `avd-${name}`, name: name.replace(/_/g, ' '), detail: msg('detail.avd'), path, size: 0, freeable: 0, lastUsed: await newestMtime(path),
      safe: false, inUse: emulator, note: msg(emulator ? 'note.emulatorOpen' : avdmanager ? 'note.avd' : 'note.avdNoTool'),
      action: avdmanager ? { kind: 'cmd', key: 'avd-delete', arg: name } : null });
  }
  const images = join(ANDROID_SDK, 'system-images');
  for (const api of await readdir(images).catch(() => [])) {
    for (const tag of await readdir(join(images, api)).catch(() => [])) {
      for (const abi of await readdir(join(images, api, tag)).catch(() => [])) {
        const rel = `system-images/${api}/${tag}/${abi}`;
        const path = join(ANDROID_SDK, rel);
        const pkg = rel.replace(/\//g, ';');
        const inUse = used.has(rel);
        items.push({ id: `sysimg-${api}-${tag}-${abi}`, name: `Android ${api.replace(/^android-/, '')} · ${tag}`, detail: abi, path, size: 0, freeable: 0,
          safe: !inUse, inUse, note: msg(inUse ? 'note.sysImageUsed' : 'note.sysImageUnused'),
          action: sdkmanager && /^system-images;android-[\w.-]+;[\w-]+;[\w-]+$/.test(pkg) ? { kind: 'cmd', key: 'sdk-uninstall', arg: pkg } : { kind: 'trash', path } });
      }
    }
  }
  return items;
}
