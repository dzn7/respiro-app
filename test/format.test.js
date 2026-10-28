import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAgo, formatBytes, formatUpdated, setLocale } from '../src/shared/i18n.js';

test('formatBytes segue o Finder: decimal, uma casa abaixo de 100, separador do idioma', () => {
  setLocale('pt-BR');
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(5_000), '5 KB');
  assert.equal(formatBytes(512_000_000), '512 MB');
  assert.equal(formatBytes(999_600_000), '1 GB');
  assert.equal(formatBytes(12_400_000_000), '12,4 GB');
  assert.equal(formatBytes(12_000_000_000), '12 GB');
  assert.equal(formatBytes(245_100_000_000), '245 GB');
  assert.equal(formatBytes(1_500_000_000_000), '1,5 TB');
  setLocale('en');
  assert.equal(formatBytes(12_400_000_000), '12.4 GB');
  setLocale('es');
  assert.equal(formatBytes(12_400_000_000), '12,4 GB');
});

test('datas relativas no idioma de quem lê', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const day = 86_400_000;
  setLocale('pt-BR');
  assert.equal(formatAgo(now - 1000, now), 'hoje');
  assert.equal(formatAgo(now - day, now), 'ontem');
  assert.equal(formatAgo(now - 3 * day, now), 'há 3 dias');
  assert.equal(formatAgo(now - 40 * day, now), 'há 1 mês');
  assert.equal(formatAgo(now - 100 * day, now), 'há 3 meses');
  assert.equal(formatAgo(now - 800 * day, now), 'há 2 anos');
  assert.equal(formatUpdated(now - 5 * 60_000, now), 'há 5 minutos');
  assert.equal(formatUpdated(now, now), 'agora');
  setLocale('en');
  assert.equal(formatAgo(now - day, now), 'yesterday');
  assert.equal(formatAgo(now - 3 * day, now), '3 days ago');
  setLocale('es');
  assert.equal(formatAgo(now - 3 * day, now), 'hace 3 días');
});
