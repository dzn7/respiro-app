// Containers parados, imagens sem uso, cache de build e volumes soltos. Lê só com `docker system df`.
import { msg } from '../../shared/i18n.js';
import { exists, has, parseSize, run } from '../sys.js';

export const id = 'docker';

/**
 * @typedef {{ Type: string, Size: string, Reclaimable: string }} DfRow
 * @typedef {{ ID: string, Names: string, Image: string, State: string, Status: string, Size: string }} DfContainer
 * @typedef {{ ID: string, Repository: string, Tag: string, Containers: string, UniqueSize: string, Size: string, CreatedAt: string }} DfImage
 * @typedef {{ Name: string, Links: string, Size: string, Labels: string }} DfVolume
 * @typedef {{ Containers: DfContainer[], Images: DfImage[], Volumes: DfVolume[] }} DfVerbose
 */

const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2_629_800_000, year: 31_557_600_000 };

/**
 * "Exited (137) 19 hours ago" → nota "Parado há 19 horas" no idioma de quem lê.
 * @param {string} status @param {number} [now]
 */
export function stoppedFor(status, now = Date.now()) {
  const m = /(\d+|an?|About an?) (second|minute|hour|day|week|month|year)s? ago/.exec(status);
  if (!m) return msg('note.containerStoppedUnknown');
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return msg('note.containerStopped', { at: now - n * UNIT_MS[/** @type {keyof typeof UNIT_MS} */ (m[2])] });
}

/**
 * Transforma a saída do docker em itens. Puro, testado em test/docker.test.js.
 * @param {DfRow[]} rows @param {DfVerbose} v
 * @returns {import('../../types.js').Item[]}
 */
export function toItems(rows, v) {
  /** @type {import('../../types.js').Item[]} */
  const items = [];
  for (const c of v.Containers ?? []) {
    const size = parseSize(c.Size);
    const running = c.State === 'running' || c.State === 'paused' || c.State === 'restarting';
    items.push({
      id: `container-${c.ID}`, name: c.Names, detail: msg('detail.container', { image: c.Image }), size, freeable: running ? 0 : size, safe: !running, inUse: running,
      note: running ? msg('note.containerRunning') : stoppedFor(c.Status),
      action: running ? null : { kind: 'cmd', key: 'docker-rm-container', arg: c.ID },
    });
  }
  for (const i of v.Images ?? []) {
    const size = parseSize(i.UniqueSize || i.Size);
    const users = Number(i.Containers) || 0;
    const label = i.Repository && i.Repository !== '<none>' ? `${i.Repository}:${i.Tag}` : msg('name.untaggedImage');
    const created = Date.parse(i.CreatedAt.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2}) .*$/, '$1:$2'));
    items.push({
      id: `image-${i.ID}`, name: label, detail: created ? msg('detail.imageCreated', { at: created }) : msg('detail.image'), size,
      freeable: users ? 0 : size, safe: !users, inUse: users > 0,
      note: users ? msg('note.imageUsed', { n: users }) : msg('note.imageUnused'),
      action: users ? null : { kind: 'cmd', key: 'docker-rm-image', arg: i.ID.replace(/^sha256:/, '') },
    });
  }
  const build = rows.find((r) => r.Type === 'Build Cache');
  const buildFree = parseSize(build?.Reclaimable ?? '');
  if (buildFree > 0) {
    items.push({ id: 'build-cache', name: msg('name.buildCache'), detail: msg('detail.buildLayers'), size: parseSize(build?.Size ?? ''),
      freeable: buildFree, safe: true, action: { kind: 'cmd', key: 'docker-builder-prune' } });
  }
  for (const vol of v.Volumes ?? []) {
    const size = parseSize(vol.Size);
    const links = Number(vol.Links) || 0;
    if (!size) continue;
    items.push({
      id: `volume-${vol.Name}`, name: vol.Name.length > 24 ? vol.Name.slice(0, 12) : vol.Name,
      detail: msg(vol.Labels.includes('com.docker.volume.anonymous') ? 'detail.anonVolume' : 'detail.volume'), size, freeable: links ? 0 : size, safe: false,
      individual: !links, inUse: links > 0,
      note: msg(links ? 'note.volumeLinked' : 'note.volumeLoose'),
      action: links ? null : { kind: 'cmd', key: 'docker-volume-rm', arg: vol.Name },
    });
  }
  return items;
}

/** Ferramenta oficial do Docker Desktop que devolve ao macOS o espaço livre do disco virtual. */
const reclaim = () => /** @type {import('../../types.js').Item} */ ({
  id: 'reclaim', name: msg('name.dockerReclaim'), size: 0, freeable: null, safe: false, tool: true,
  note: msg('note.dockerReclaim'), action: { kind: 'cmd', key: 'docker-reclaim' },
});

export async function scan() {
  if (!(await has('docker')) && !(await exists('/Applications/Docker.app'))) return null;
  const info = await run('docker', ['info', '--format', '{{.OperatingSystem}}'], { timeout: 8000 }).catch(() => null);
  if (info === null) {
    return { status: /** @type {const} */ ('unavailable'), message: msg('status.dockerClosed'), items: [] };
  }
  const [df, verbose] = await Promise.all([
    run('docker', ['system', 'df', '--format', '{{json .}}']),
    run('docker', ['system', 'df', '-v', '--format', '{{json .}}']),
  ]);
  /** @type {DfRow[]} */
  const rows = df.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    size: rows.reduce((sum, r) => sum + parseSize(r.Size), 0),
    notice: info.includes('Docker Desktop') ? msg('notice.dockerDesktop') : undefined,
    items: [...toItems(rows, JSON.parse(verbose)), ...(info.includes('Docker Desktop') ? [reclaim()] : [])],
  };
}
