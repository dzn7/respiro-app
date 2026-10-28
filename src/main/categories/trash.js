// Lixeira do disco de inicialização. Ler ~/.Trash exige Acesso Total ao Disco num app empacotado.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { msg } from '../../shared/i18n.js';
import { home, size } from '../sys.js';

export const id = 'trash';

export const TRASH = join(home, '.Trash');

export async function scan() {
  let entries;
  try {
    entries = (await readdir(TRASH)).filter((n) => n !== '.DS_Store');
  } catch (/** @type {any} */ e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') return null;
    return { status: /** @type {const} */ ('needs-access'), message: msg('status.trashAccess'), items: [] };
  }
  if (!entries.length) return null;
  const bytes = await size(TRASH);
  if (!bytes) return null;
  return {
    items: [{
      id: 'empty', name: msg('name.emptyTrash'), detail: msg('detail.items', { n: entries.length }), size: bytes, freeable: bytes,
      safe: false, individual: true, note: msg('note.trash'), path: TRASH,
      action: /** @type {const} */ ({ kind: 'cmd', key: 'empty-trash' }),
    }],
  };
}
