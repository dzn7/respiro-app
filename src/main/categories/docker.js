// Containers parados, imagens sem uso, cache de build e volumes soltos. Lê só com `docker system df`.
import { exists, has, parseSize, run } from '../sys.js';

export const id = 'docker';
export const name = 'Docker';
export const blurb = 'Containers parados, imagens que nenhum container usa, cache de build e volumes soltos.';
export const DESKTOP_NOTICE = 'O Docker Desktop guarda tudo num disco virtual, que pode levar alguns minutos para devolver o espaço ao macOS.';

/**
 * @typedef {{ Type: string, Size: string, Reclaimable: string }} DfRow
 * @typedef {{ ID: string, Names: string, Image: string, State: string, Status: string, Size: string }} DfContainer
 * @typedef {{ ID: string, Repository: string, Tag: string, Containers: string, UniqueSize: string, Size: string, CreatedAt: string }} DfImage
 * @typedef {{ Name: string, Links: string, Size: string, Labels: string }} DfVolume
 * @typedef {{ Containers: DfContainer[], Images: DfImage[], Volumes: DfVolume[] }} DfVerbose
 */

const UNITS = { second: ['segundo', 'segundos'], minute: ['minuto', 'minutos'], hour: ['hora', 'horas'], day: ['dia', 'dias'],
  week: ['semana', 'semanas'], month: ['mês', 'meses'], year: ['ano', 'anos'] };
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Exited (137) 19 hours ago" → "Parado há 19 horas". @param {string} status */
export function stoppedFor(status) {
  const m = /(\d+|an?|About an?) (second|minute|hour|day|week|month|year)s? ago/.exec(status);
  if (!m) return 'Parado';
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unit = UNITS[/** @type {keyof typeof UNITS} */ (m[2])];
  return `Parado há ${m[1].startsWith('About') ? 'cerca de ' : ''}${n} ${n === 1 ? unit[0] : unit[1]}`;
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
      id: `container-${c.ID}`, name: c.Names, detail: `Container · ${c.Image}`, size, freeable: running ? 0 : size, safe: !running, inUse: running,
      note: running ? 'Em execução. Pare o container no Docker para poder remover.' : `${stoppedFor(c.Status)}.`,
      action: running ? null : { kind: 'cmd', key: 'docker-rm-container', arg: c.ID },
    });
  }
  for (const i of v.Images ?? []) {
    const size = parseSize(i.UniqueSize || i.Size);
    const users = Number(i.Containers) || 0;
    const label = i.Repository && i.Repository !== '<none>' ? `${i.Repository}:${i.Tag}` : 'Imagem sem nome';
    const created = Date.parse(i.CreatedAt.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2}) .*$/, '$1:$2'));
    items.push({
      id: `image-${i.ID}`, name: label, detail: created ? `Imagem · criada em ${shortDate.format(created)}` : 'Imagem', size,
      freeable: users ? 0 : size, safe: !users, inUse: users > 0,
      note: users ? `Usada por ${users === 1 ? 'um container' : `${users} containers`}. Remova o container antes.` : 'Nenhum container usa esta imagem.',
      action: users ? null : { kind: 'cmd', key: 'docker-rm-image', arg: i.ID.replace(/^sha256:/, '') },
    });
  }
  const build = rows.find((r) => r.Type === 'Build Cache');
  const buildFree = parseSize(build?.Reclaimable ?? '');
  if (buildFree > 0) {
    items.push({ id: 'build-cache', name: 'Cache de build', detail: 'Camadas guardadas pelo docker build', size: parseSize(build?.Size ?? ''),
      freeable: buildFree, safe: true, action: { kind: 'cmd', key: 'docker-builder-prune' } });
  }
  for (const vol of v.Volumes ?? []) {
    const size = parseSize(vol.Size);
    const links = Number(vol.Links) || 0;
    if (!size) continue;
    items.push({
      id: `volume-${vol.Name}`, name: vol.Name.length > 24 ? vol.Name.slice(0, 12) : vol.Name,
      detail: vol.Labels.includes('com.docker.volume.anonymous') ? 'Volume anônimo' : 'Volume', size, freeable: links ? 0 : size, safe: false,
      individual: !links, inUse: links > 0,
      note: links ? 'Ligado a um container. Remova o container antes.' : 'Pode guardar um banco de dados. Apague um de cada vez, só se tiver certeza.',
      action: links ? null : { kind: 'cmd', key: 'docker-volume-rm', arg: vol.Name },
    });
  }
  return items;
}

export async function scan() {
  if (!(await has('docker')) && !(await exists('/Applications/Docker.app'))) return null;
  const info = await run('docker', ['info', '--format', '{{.OperatingSystem}}'], { timeout: 8000 }).catch(() => null);
  if (info === null) {
    return { status: /** @type {const} */ ('unavailable'), message: 'O Docker está fechado. Abra o Docker Desktop para analisar.', items: [] };
  }
  const [df, verbose] = await Promise.all([
    run('docker', ['system', 'df', '--format', '{{json .}}']),
    run('docker', ['system', 'df', '-v', '--format', '{{json .}}']),
  ]);
  /** @type {DfRow[]} */
  const rows = df.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    size: rows.reduce((sum, r) => sum + parseSize(r.Size), 0),
    notice: info.includes('Docker Desktop') ? DESKTOP_NOTICE : undefined,
    items: toItems(rows, JSON.parse(verbose)),
  };
}
