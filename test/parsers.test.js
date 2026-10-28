// Saídas reais de docker e brew viram itens com as proteções certas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stoppedFor, toItems } from '../src/main/categories/docker.js';
import { parsePreview } from '../src/main/categories/homebrew.js';
import { ownerRunning, parseSize } from '../src/main/sys.js';
import { setLocale, tx } from '../src/shared/i18n.js';

test('parseSize nas bases de cada ferramenta', () => {
  assert.equal(parseSize('1.093GB'), 1_093_000_000);
  assert.equal(parseSize('8.19kB'), 8190);
  assert.equal(parseSize('0B'), 0);
  assert.equal(parseSize('14.6GB (virtual 15GB)'), 14_600_000_000);
  assert.equal(parseSize('2MB', 1024), 2 * 1024 ** 2);
  assert.equal(parseSize(''), 0);
});

test('docker: rodando, em uso e volume ligado ficam protegidos; volume solto é individual', () => {
  const items = toItems(
    [{ Type: 'Build Cache', Size: '7.792GB', Reclaimable: '3.603GB' }],
    {
      Containers: [
        { ID: '588ae05df553', Names: 'web', Image: 'api', State: 'exited', Status: 'Exited (137) 5 days ago', Size: '8.19kB' },
        { ID: '1111aaaa2222', Names: 'db', Image: 'postgres', State: 'running', Status: 'Up 2 hours', Size: '20.5kB' },
      ],
      Images: [
        { ID: 'sha256:d2c0dada681450df', Repository: 'app-web', Tag: 'latest', Containers: '0', UniqueSize: '1.406GB', Size: '1.55GB', CreatedAt: '2026-10-27 19:37:30 -0300 -03' },
        { ID: 'sha256:e7f64ce6f5aa56c3', Repository: 'api', Tag: 'latest', Containers: '1', UniqueSize: '2.233GB', Size: '2.23GB', CreatedAt: '2026-10-22 21:16:33 -0300 -03' },
      ],
      Volumes: [
        { Name: 'pg_data', Links: '1', Size: '145.6MB', Labels: '' },
        { Name: '15e312ae2764bc821e463613b69ed8c9075e47320c218ae87379347782e994dd', Links: '0', Size: '920MB', Labels: 'com.docker.volume.anonymous=' },
        { Name: 'vazio', Links: '0', Size: '0B', Labels: '' },
      ],
    });
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(by['container-588ae05df553'].action, { kind: 'cmd', key: 'docker-rm-container', arg: '588ae05df553' });
  assert.equal(by['container-1111aaaa2222'].action, null);
  assert.deepEqual(by['image-sha256:d2c0dada681450df'].action, { kind: 'cmd', key: 'docker-rm-image', arg: 'd2c0dada681450df' });
  assert.equal(by['image-sha256:e7f64ce6f5aa56c3'].action, null);
  assert.equal(by['build-cache'].freeable, 3_603_000_000);
  assert.equal(by['volume-pg_data'].action, null);
  const loose = by['volume-15e312ae2764bc821e463613b69ed8c9075e47320c218ae87379347782e994dd'];
  assert.deepEqual([loose.safe, loose.individual], [false, true]);
  assert.equal(by['volume-vazio'], undefined);
  setLocale('pt-BR');
  assert.equal(tx(by['image-sha256:d2c0dada681450df'].detail), 'Imagem · criada em 27 de out. de 2026');
});

test('brew cleanup -n vira partes com tamanho em base 1024', () => {
  const parts = parsePreview([
    'Would remove: /Users/ana/Library/Caches/Homebrew/downloads/abc--node-24.tar.gz (30.5MB)',
    'Would remove: /opt/homebrew/Cellar/node/23.1.0 (2,345 files, 120.4MB)',
    'Warning: Skipping x: most recent version 1 not installed',
  ].join('\n'));
  assert.deepEqual(parts.map((p) => p.size), [Math.round(30.5 * 1024 ** 2), Math.round(120.4 * 1024 ** 2)]);
});

test('status do docker vira nota traduzível', () => {
  setLocale('pt-BR');
  const now = Date.now();
  assert.equal(tx(stoppedFor('Exited (0) 19 hours ago', now)), 'Parado há 19 horas.');
  assert.equal(tx(stoppedFor('Exited (137) 5 days ago', now)), 'Parado há 5 dias.');
  assert.equal(tx(stoppedFor('Exited (1) About an hour ago', now)), 'Parado há 1 hora.');
  assert.equal(tx(stoppedFor('Exited (0) a minute ago', now)), 'Parado há 1 minuto.');
  assert.equal(tx(stoppedFor('Created', now)), 'Parado.');
  setLocale('en');
  assert.equal(tx(stoppedFor('Exited (0) 19 hours ago', now)), 'Stopped 19 hours ago.');
});

test('cache de app aberto é reconhecido pelo bundle ID ou fabricante', () => {
  const running = ['finder', 'com.apple.finder', 'google chrome', 'com.google.chrome', 'firefox', 'org.mozilla.firefox', 'brave browser', 'com.brave.browser'];
  for (const folder of ['Google', 'Firefox', 'Mozilla', 'BraveSoftware', 'com.google.Chrome']) assert.equal(ownerRunning(folder, running), true, folder);
  for (const folder of ['com.spotify.client', 'electron-builder', 'node-gyp', 'pip']) assert.equal(ownerRunning(folder, running), false, folder);
});
