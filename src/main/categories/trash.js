// Lixeira do disco de inicialização. Ler ~/.Trash exige Acesso Total ao Disco num app empacotado.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { home, size } from '../sys.js';

export const id = 'trash';
export const name = 'Lixeira';
export const blurb = 'O que já foi para a Lixeira, inclusive o que o Respiro mandou para lá. Esvaziar apaga para sempre.';

export const TRASH = join(home, '.Trash');

export async function scan() {
  let entries;
  try {
    entries = (await readdir(TRASH)).filter((n) => n !== '.DS_Store');
  } catch (/** @type {any} */ e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') return null;
    return { status: /** @type {const} */ ('needs-access'), message: 'Para medir a Lixeira, o Respiro precisa de Acesso Total ao Disco.', items: [] };
  }
  if (!entries.length) return null;
  const bytes = await size(TRASH);
  if (!bytes) return null;
  return {
    items: [{
      id: 'empty', name: 'Esvaziar a Lixeira', detail: `${entries.length} ${entries.length === 1 ? 'item' : 'itens'}`, size: bytes, freeable: bytes,
      safe: false, individual: true, note: 'Apaga para sempre tudo o que está na Lixeira.', path: TRASH,
      action: /** @type {const} */ ({ kind: 'cmd', key: 'empty-trash' }),
    }],
  };
}
