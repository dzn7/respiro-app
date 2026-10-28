// Explorar e "Backups e snapshots": contas do treemap, árvore do du, duplicados, regra dos arquivos pessoais (S14),
// snapshots do Time Machine e backups de aparelho.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { kindOf, squarify } from '../src/renderer/treemap.js';
import { duplicates, keeper, treeFromDu } from '../src/main/explore.js';
import { adminCommand, personalRule, refuse, trashRule } from '../src/main/cleaner.js';
import { backupInfo, snapshots } from '../src/main/categories/backups.js';
import { CATEGORIES } from '../src/main/scan.js';

const H = '/Users/ana';
const key = (/** @type {{ key: string } | null} */ m) => m?.key ?? null;

test('squarify: área proporcional, dentro do retângulo e sem sobreposição', () => {
  const values = [500, 300, 120, 50, 20, 10];
  const rects = squarify(values, { x: 0, y: 0, w: 600, h: 400 });
  const total = values.reduce((s, v) => s + v, 0);
  rects.forEach((r, i) => {
    assert.ok(Math.abs(r.w * r.h - (values[i] / total) * 600 * 400) < 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6);
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      assert.ok(overlap < 1e-6, `${i} e ${j} se sobrepõem`);
    }
  }
  // Um valor só ocupa tudo; nada para dividir não quebra.
  assert.deepEqual(squarify([7], { x: 0, y: 0, w: 10, h: 5 }), [{ x: 0, y: 0, w: 10, h: 5 }]);
  assert.deepEqual(squarify([], { x: 0, y: 0, w: 10, h: 5 }), []);
});

test('tipo do arquivo para a cor do mapa', () => {
  assert.equal(kindOf('Fotos', true), 'folder');
  assert.equal(kindOf('Xcode.app', true), 'app');
  assert.equal(kindOf('aula.MOV', false), 'media');
  assert.equal(kindOf('IMG_1.heic', false), 'image');
  assert.equal(kindOf('macOS.dmg', false), 'archive');
  assert.equal(kindOf('dados.sqlite', false), 'other');
  assert.equal(kindOf('Docker.raw', false), 'other');
  assert.equal(kindOf('LEIAME', false), 'other');
});

test('du vira árvore: tamanhos em bytes, filhos do maior para o menor', () => {
  const tree = treeFromDu(['10\t/r/a/x', '30\t/r/a', '50\t/r/b', '100\t/r', 'du: /r/c: Permission denied', ''], '/r');
  assert.equal(tree?.size, 100 * 1024);
  assert.deepEqual(tree?.children?.map((c) => c.name), ['b', 'a']);
  assert.equal(tree?.children?.[1].children?.[0].path, '/r/a/x');
  assert.equal(treeFromDu([], '/r'), null);
});

test('cópia que fica: a mais antiga fora de Downloads e da Mesa', () => {
  const copies = [
    { path: `${H}/Downloads/a.mov`, mtime: 1 },
    { path: `${H}/Movies/a.mov`, mtime: 5 },
    { path: `${H}/Documents/a.mov`, mtime: 3 },
  ];
  assert.equal(keeper(copies, H), `${H}/Documents/a.mov`);
  assert.equal(keeper([{ path: `${H}/Desktop/b`, mtime: 9 }, { path: `${H}/Downloads/b`, mtime: 2 }], H), `${H}/Downloads/b`);
});

test('duplicados: só conteúdo igual agrupa (mesmo tamanho ou mesma cabeça e cauda não basta)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'respiro-dup-'));
  try {
    const size = 300_000;
    const base = Buffer.alloc(size, 7);
    const middle = Buffer.from(base);
    middle[size / 2] = 9; // cabeça e cauda iguais, meio diferente
    const files = {
      'Downloads/a.bin': base, 'Documents/a.bin': base, 'Movies/a.bin': base,
      'Documents/mesmo-tamanho.bin': Buffer.alloc(size, 1), 'Documents/meio.bin': middle, 'Documents/pequeno.bin': Buffer.alloc(10, 7),
    };
    const paths = Object.entries(files).map(([name, data]) => {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return path;
    });
    utimesSync(join(dir, 'Movies/a.bin'), 100, 100);
    utimesSync(join(dir, 'Documents/a.bin'), 200, 200);
    utimesSync(join(dir, 'Downloads/a.bin'), 50, 50);
    /** @type {number[]} */
    const progress = [];
    const groups = await duplicates((read) => progress.push(read), { paths, min: 1000, h: dir });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].size, size);
    assert.deepEqual(groups[0].copies.map((c) => c.name), ['a.bin', 'a.bin', 'a.bin']);
    // Fica a mais antiga fora de Downloads (Movies, mtime 100), não a mais antiga de todas (Downloads, 50).
    assert.deepEqual(groups[0].copies.filter((c) => c.keep).map((c) => c.id).length, 1);
    assert.ok(groups[0].copies.find((c) => c.keep)?.path.endsWith('Movies/a.bin'));
    // A cópia com o meio diferente passou pela cabeça e cauda: só o SHA-256 completo a separa.
    assert.equal(progress.at(-1), size * 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arquivos pessoais (S14): só Lixeira, só dentro da pasta pessoal, fora do que é do sistema', () => {
  for (const ok of [`${H}/Documents/viagem.mov`, `${H}/Downloads/macOS.dmg`, `${H}/Projetos/antigo`, `${H}/.ollama/models/blob`, `${H}/Applications/Velho.app`]) {
    assert.equal(personalRule(ok, H), null, ok);
  }
  /** @type {[string, string][]} */
  const refused = [
    [`${H}/Documents`, 'refuse.homeFolder'],
    [`${H}/.zshrc`, 'refuse.homeFolder'],
    [H, 'refuse.outsideHome'],
    ['/Applications/Xcode.app', 'refuse.outsideHome'],
    [`${H}/../bia/x`, 'refuse.outsideHome'],
    [`${H}/Library/Mobile Documents/com~apple~CloudDocs/a.pdf`, 'refuse.personalProtected'],
    [`${H}/Library/Keychains/login.keychain-db`, 'refuse.personalProtected'],
    [`${H}/.ssh/id_ed25519`, 'refuse.personalProtected'],
    [`${H}/code/app/.git/objects/pack/p.pack`, 'refuse.personalProtected'],
    [`${H}/Applications/Velho.app/Contents/MacOS/Velho`, 'refuse.personalProtected'],
    [`${H}/Pictures/Photos Library.photoslibrary`, 'refuse.mediaLibrary'],
    [`${H}/VMs/ubuntu.qcow2`, 'refuse.vmDisk'],
    [`${H}/Docker/Docker.raw`, 'refuse.vmDisk'],
  ];
  for (const [path, why] of refused) assert.equal(key(personalRule(path, H)), why, path);
});

test('item do Explorar que mudou depois de listado não sai', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'respiro-seen-'));
  try {
    const path = join(dir, 'a.bin');
    writeFileSync(path, 'abc');
    const item = { id: 'x', name: 'a.bin', size: 3, freeable: 3, safe: false, seen: { bytes: 2, mtime: 0 }, action: /** @type {const} */ ({ kind: 'trash', path }) };
    // Fora da pasta pessoal de verdade: a regra recusa antes de olhar o disco.
    assert.equal(key(await refuse({ ref: 'explore/x', category: 'explore', item }, 30)), 'refuse.outsideHome');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snapshots do Time Machine: só os locais do Time Machine, com data validada', async () => {
  const out = 'Snapshots for disk /:\ncom.apple.TimeMachine.2026-10-28-152657.local\ncom.apple.os.update-ABC123\ncom.apple.TimeMachine.lixo.local\n';
  const list = snapshots(out);
  assert.deepEqual(list.map((s) => s.date), ['2026-10-28-152657']);
  assert.equal(new Date(list[0].at).getHours(), 15);
  const item = (/** @type {string} */ arg) => ({ id: 't', name: 't', size: 0, freeable: null, safe: false, action: /** @type {const} */ ({ kind: 'cmd', key: 'tm-delete-snapshot', arg }) });
  assert.equal(await refuse({ ref: 'backups/t', category: 'backups', item: item('2026-10-28-152657') }, 30), null);
  assert.equal(key(await refuse({ ref: 'backups/t', category: 'backups', item: item('2026-10-28; rm -rf ~') }, 30)), 'refuse.badArg');
});

test('senha de administrador: cada parte vai citada, nada de texto livre no shell', () => {
  const script = adminCommand('/usr/bin/tmutil', ['deletelocalsnapshots', '2026-10-28-152657"; echo x']);
  assert.match(script, /^do shell script quoted form of "\/usr\/bin\/tmutil" & " " & quoted form of "deletelocalsnapshots" & " " & quoted form of "2026-10-28-152657\\"; echo x" with administrator privileges/);
});

test('backup de aparelho: Info.plist e pasta aceita na Lixeira', () => {
  const info = backupInfo({ 'Device Name': 'iPhone da Ana', 'Product Type': 'iPhone15,2', 'Serial Number': 'F2LX', 'Last Backup Date': '2026-09-01T10:00:00Z' });
  assert.deepEqual(info, { device: 'iPhone da Ana', product: 'iPhone15,2', serial: 'F2LX', at: Date.parse('2026-09-01T10:00:00Z') });
  assert.equal(backupInfo({}).at, 0);
  const base = `${H}/Library/Application Support/MobileSync/Backup`;
  assert.equal(trashRule(`${base}/00008110-001A2B3C4D5E801E`, H), null);
  assert.equal(trashRule(`${base}/00008110-001A2B3C4D5E801E-20260901-100000`, H), null);
  assert.equal(key(trashRule(`${base}/Info.plist`, H)), 'refuse.outside');
  assert.equal(key(trashRule(base, H)), 'refuse.outside');
});

test('categorias: Backups e snapshots entra, Homebrew vira parte de Caches de pacotes', () => {
  const ids = CATEGORIES.map((c) => c.id);
  assert.deepEqual(ids, ['packages', 'docker', 'node', 'xcode', 'browsers', 'backups', 'appcaches', 'trash']);
});
