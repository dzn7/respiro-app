// Descoberta de projetos e proteção de projetos ativos (inclusive monorepo).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { findNodeModules, groupActivity, lastActivity } from '../src/main/categories/node-modules.js';

const root = mkdtempSync(join(tmpdir(), 'respiro-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** @param {string} p @param {number} [daysAgo] */
function file(p, daysAgo = 0) {
  mkdirSync(join(root, p, '..'), { recursive: true });
  writeFileSync(join(root, p), '{}');
  const t = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(join(root, p), t, t);
}

test('acha node_modules ao lado de package.json, sem entrar em ocultas nem em outra node_modules', async () => {
  file('code/app/package.json');
  file('code/app/node_modules/dep/package.json');
  file('code/app/node_modules/dep/node_modules/x/package.json');
  file('code/sem-pacote/node_modules/a.js');
  file('.escondido/proj/package.json');
  file('.escondido/proj/node_modules/a.js');
  file('Library/proj/package.json');
  file('Library/proj/node_modules/a.js');
  const found = await findNodeModules(root);
  assert.deepEqual(found, [join(root, 'code/app/node_modules')]);
});

test('atividade ignora node_modules e build; monorepo herda da raiz', async () => {
  const old = join(root, 'velho');
  file('velho/package.json', 90);
  file('velho/node_modules/dep/index.js', 0);
  file('velho/dist/bundle.js', 0);
  for (const d of ['velho', 'velho/node_modules', 'velho/node_modules/dep', 'velho/dist']) {
    const t = new Date(Date.now() - 90 * 86_400_000);
    utimesSync(join(root, d), t, t);
  }
  const last = await lastActivity(old);
  assert.ok(Date.now() - last > 80 * 86_400_000, 'mudança dentro de node_modules/dist não conta como uso');

  const grouped = groupActivity(new Map([['/m', 100], ['/m/packages/a', 5], ['/outro', 7]]));
  assert.deepEqual([grouped.get('/m'), grouped.get('/m/packages/a'), grouped.get('/outro')], [100, 100, 7]);
});
