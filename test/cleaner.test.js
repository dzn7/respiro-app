// O módulo que apaga: caminhos permitidos, comandos fechados e recusas antes de tocar o disco.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminScript, clean, commandLine, friendly, refuse, reportedFreed, trashRule } from '../src/main/cleaner.js';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { home, movable } from '../src/main/sys.js';

const H = '/Users/ana';

test('trashRule aceita só as raízes de cache conhecidas', () => {
  for (const ok of [
    `${H}/Library/Caches/com.google.Chrome`, `${H}/Library/Caches/com.apple.dt.Xcode`, `${H}/Library/Logs/Code`,
    `${H}/Library/Developer/Xcode/DerivedData/App-abc`, `${H}/Library/Developer/CoreSimulator/Devices/084A56ED-2D58-43CA-9F64-99A255A795BA`,
    `${H}/Library/pnpm/store/v3`, `${H}/.bun/install/cache`, `${H}/code/app/node_modules`,
    `${H}/code/app/.next`, `${H}/code/rust/target`, `${H}/code/py/.venv`, `${H}/.cache/uv`, `${H}/.cargo/registry/cache`,
    `${H}/.gradle/caches`, `${H}/.m2/repository`, `${H}/.pub-cache`, `${H}/Library/Developer/Xcode/iOS DeviceSupport/iPhone14,2 17.0 (21A329)`,
    `${H}/Library/Caches/Cypress/13.6.0`, `${H}/.cache/puppeteer/chrome/mac_arm-121.0.6167.85`, `${H}/.vscode/extensions/ms-python.python-2024.1.0`,
    `${H}/Library/Caches/JetBrains/WebStorm2024.1`, `${H}/Library/Android/sdk/system-images/android-34/google_apis/arm64-v8a`,
  ]) assert.equal(trashRule(ok, H), null, ok);
});

test('trashRule recusa pessoal, sistema, raiz e truques de caminho', () => {
  for (const bad of [
    H, `${H}/Documents`, `${H}/Desktop/projeto`, `${H}/.ssh`, `${H}/Library/Caches`, `${H}/Library/Caches/com.apple.Safari`,
    `${H}/Library/Caches/Google/Chrome`, `${H}/Library/Preferences/x.plist`, `${H}/Library/Developer/CoreSimulator/Devices/device_set.plist`,
    `${H}/code/app/node_modules/../src`, `${H}/code/app/node_modules/`, `${H}/code/app/node_modules/x/node_modules`,
    `${H}/.config/app/node_modules`, `${H}/Library/Application Support/x/node_modules`, `/tmp/node_modules`, '/Users/outro/Library/Caches/x',
    'node_modules', `${H}/code/src`,
    `${H}/code/app/node_modules/x/dist`, `${H}/.config/x/target`, `${H}/Library/Application Support/x/.next`, `${H}/.cargo/registry`,
    `${H}/.m2`, `${H}/.cache`, `${H}/.vscode/extensions`, `${H}/.vscode/extensions/.obsolete`, `${H}/Library/Caches/Cypress/binary_state.json`,
    `${H}/.cache/puppeteer/chrome`, `${H}/Library/Android/sdk/system-images/android-34`, `${H}/Library/Android/sdk/platforms/android-34`,
  ]) assert.notEqual(trashRule(bad, H), null, bad);
});

test('comando oficial: tabela fechada e argumento validado', async () => {
  const docker = /** @type {const} */ ('docker');
  const item = (/** @type {any} */ action) => ({ ref: 'x/y', category: docker, item: { id: 'y', name: 'y', size: 1, freeable: 1, safe: true, action } });
  assert.equal(await refuse(item({ kind: 'cmd', key: 'docker-rm-image', arg: 'a8e042598834300d' }), 30), null);
  assert.ok(await refuse(item({ kind: 'cmd', key: 'docker-rm-image', arg: 'abc; rm -rf ~' }), 30));
  assert.ok(await refuse(item({ kind: 'cmd', key: 'docker-volume-rm', arg: '-f' }), 30));
  assert.ok(await refuse(item({ kind: 'cmd', key: 'npm-clean', arg: '--prefix=/' }), 30));
  assert.ok(await refuse(item({ kind: 'cmd', key: 'rm-everything' }), 30));
  assert.ok(await refuse(item(null), 30));
  assert.equal(commandLine({ kind: 'cmd', key: 'pnpm-prune' }), 'pnpm store prune');
  assert.equal(commandLine({ kind: 'cmd', key: 'go-clean-modcache' }), 'go clean -modcache');

  const ok = async (/** @type {any} */ action) => assert.equal(await refuse(item(action), 30), null, JSON.stringify(action));
  const no = async (/** @type {any} */ action) => assert.ok(await refuse(item(action), 30), JSON.stringify(action));
  await ok({ kind: 'cmd', key: 'cargo-clean', arg: `${home}/code/rust/Cargo.toml` });
  await no({ kind: 'cmd', key: 'cargo-clean', arg: '/etc/Cargo.toml' });
  await no({ kind: 'cmd', key: 'cargo-clean', arg: `${home}/code/rust/../../Cargo.toml` });
  await no({ kind: 'cmd', key: 'cargo-clean', arg: `${home}/Library/x/Cargo.toml` });
  await no({ kind: 'cmd', key: 'git-worktree-remove', arg: 'code/wt' });
  await no({ kind: 'cmd', key: 'git-worktree-remove', arg: `${home}/Library/wt` });
  await ok({ kind: 'cmd', key: 'avd-delete', arg: 'Pixel_8_API_34' });
  await no({ kind: 'cmd', key: 'avd-delete', arg: '../Pixel' });
  await ok({ kind: 'cmd', key: 'sdk-uninstall', arg: 'system-images;android-34;google_apis;arm64-v8a' });
  await no({ kind: 'cmd', key: 'sdk-uninstall', arg: 'platforms;android-34' });
  await no({ kind: 'cmd', key: 'uv-prune', arg: '--force' });
});

test('clean recusa protegido, fora das raízes e individual em lote, sem tocar no disco', async () => {
  /** @param {string} id @param {any} action @param {object} [extra] */
  const t = (id, action, extra = {}) => ({ ref: `appcaches/${id}`, category: /** @type {const} */ ('appcaches'),
    item: { id, name: id, size: 10, freeable: 10, safe: true, action, ...extra } });
  const r = await clean([t('a', null, { note: { key: 'note.containerRunning' } }), t('b', { kind: 'trash', path: `${home}/Documents` }), t('c', { kind: 'trash', path: '/etc' })],
    { simulate: false, staleDays: 30 });
  assert.deepEqual(r.done, []);
  assert.deepEqual(r.failed.map((f) => f.message.key), ['note.containerRunning', 'refuse.outside', 'refuse.invalidPath']);

  const solo = await clean([t('v', { kind: 'cmd', key: 'docker-volume-rm', arg: 'db' }, { individual: true }), t('w', null)], { simulate: true, staleDays: 30 });
  assert.equal(solo.failed[0].message.key, 'error.solo');
});

test('simular soma o previsto e não executa', async () => {
  const r = await clean([
    { ref: 'packages/npm', category: 'packages', item: { id: 'npm', name: 'npm', size: 500, freeable: 500, safe: true, action: { kind: 'cmd', key: 'npm-clean' } } },
    { ref: 'packages/pnpm', category: 'packages', item: { id: 'pnpm', name: 'pnpm', size: 900, freeable: null, safe: true, action: { kind: 'cmd', key: 'pnpm-prune' } } },
  ], { simulate: true, staleDays: 30 });
  assert.deepEqual({ freed: r.freed, unknown: r.unknown, simulated: r.simulated, done: r.done.length }, { freed: 500, unknown: 1, simulated: true, done: 2 });
});

test('lê o valor liberado que a ferramenta informa', () => {
  assert.equal(reportedFreed('Deleted build cache objects:\nabc\nTotal:\t3.603GB\n', 'docker-builder-prune'), 3_603_000_000);
  assert.equal(reportedFreed('Total reclaimed space: 512kB', 'docker-rm-image'), 512_000);
  assert.equal(reportedFreed('==> This operation has freed approximately 1.5GB of disk space.', 'brew-cleanup'), 1.5 * 1024 ** 3);
  assert.equal(reportedFreed('Removed 120 packages', 'pnpm-prune'), null);
});

test('pasta sem escrita não é movível sem senha', async () => {
  const root = mkdtempSync(join(tmpdir(), 'respiro-perm-'));
  const locked = join(root, 'node-gyp');
  mkdirSync(join(locked, '24.18.0'), { recursive: true });
  try {
    assert.equal(await movable(locked), true);
    chmodSync(locked, 0o555); // como uma pasta do root vista pelo usuário
    assert.equal(await movable(locked), false);
  } finally {
    chmodSync(locked, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test('senha de administrador só faz chown, com caminhos citados', () => {
  const script = adminScript(['/Users/ana/Library/Caches/node-gyp', '/Users/ana/Library/Caches/a"b'], { uid: 501, gid: 20 });
  assert.match(script, /^do shell script "\/usr\/sbin\/chown -R 501:20 " & quoted form of "\/Users\/ana\/Library\/Caches\/node-gyp" & " " & quoted form of "\/Users\/ana\/Library\/Caches\/a\\"b" with administrator privileges/);
  assert.doesNotMatch(script, /\brm\b/);
  assert.equal(friendly(new Error("EACCES: permission denied, rename '/x'")).key, 'error.permission');
});
