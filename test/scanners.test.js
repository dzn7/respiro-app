// Regras puras dos achados novos: versão mais nova, AVD, extensões obsoletas, pastas de projeto e worktrees.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { obsoleteExtensions } from '../src/main/categories/app-caches.js';
import { newestVersion } from '../src/main/categories/browsers.js';
import { findArtifacts, worktreeMain } from '../src/main/categories/node-modules.js';
import { avdImage, newestDeviceSupport } from '../src/main/categories/xcode.js';

const root = mkdtempSync(join(tmpdir(), 'respiro-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** @param {string} p @param {string} [text] */
function file(p, text = '{}') {
  mkdirSync(join(root, p, '..'), { recursive: true });
  writeFileSync(join(root, p), text);
}

test('versão mais nova compara número a número', () => {
  assert.equal(newestVersion(['13.9.2', '13.10.0', '12.17.4']), '13.10.0');
  assert.equal(newestVersion(['mac_arm-121.0.6167.85', 'mac_arm-119.0.6045.105']), 'mac_arm-121.0.6167.85');
});

test('DeviceSupport mantém a mais nova de cada aparelho', () => {
  const keep = newestDeviceSupport(['iPhone14,2 17.0 (21A329)', 'iPhone14,2 17.2 (21C62)', 'iPhone15,3 16.4 (20E247)', '16.1 (20B82)', '16.4 (20E247)']);
  assert.deepEqual([...keep].sort(), ['16.4 (20E247)', 'iPhone14,2 17.2 (21C62)', 'iPhone15,3 16.4 (20E247)']);
});

test('AVD aponta para a system image que usa', () => {
  assert.equal(avdImage('hw.ramSize=2048\nimage.sysdir.1=system-images/android-34/google_apis/arm64-v8a/\n'), 'system-images/android-34/google_apis/arm64-v8a');
  assert.equal(avdImage('image.sysdir.1=../../etc/'), null);
  assert.equal(avdImage(''), null);
});

test('extensão obsoleta só conta se não estiver instalada', () => {
  const obsolete = JSON.stringify({ 'a.b-1.0.0': true, 'a.b-2.0.0': true, '../fora': true });
  const installed = JSON.stringify([{ relativeLocation: 'a.b-2.0.0' }]);
  assert.deepEqual(obsoleteExtensions(obsolete, installed), ['a.b-1.0.0']);
  assert.deepEqual(obsoleteExtensions('quebrado', installed), []);
});

test('pasta gerada só conta ao lado do arquivo do projeto; worktree é .git em arquivo', async () => {
  file('code/web/package.json');
  file('code/web/.next/cache/a');
  file('code/web/dist/index.js');
  file('code/rust/Cargo.toml', '');
  file('code/rust/target/debug/x');
  file('code/py/pyproject.toml', '');
  file('code/py/.venv/pyvenv.cfg', '');
  file('code/solto/target/x');
  file('code/solto/dist/x');
  file('code/wt/.git', 'gitdir: /tmp/repo/.git/worktrees/wt');
  const { artifacts, worktrees } = await findArtifacts(root);
  assert.deepEqual(artifacts.map((a) => a.path.slice(root.length + 1)), ['code/py/.venv', 'code/rust/target', 'code/web/.next', 'code/web/dist']);
  assert.deepEqual(worktrees, [join(root, 'code/wt')]);
  await assert.rejects(worktreeMain(join(root, 'code/wt')), 'repositório fora da pasta pessoal é recusado');
});
