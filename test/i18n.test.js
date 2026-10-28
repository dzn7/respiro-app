// Os três idiomas têm as mesmas chaves, os mesmos marcadores e plural completo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DICTS, msg, resolveLocale, setLocale, t, tx } from '../src/shared/i18n.js';

const placeholders = (/** @type {unknown} */ v) => JSON.stringify(v).match(/\{\w+(?:\|\w+)?\}/g)?.sort().join(',') ?? '';

test('mesmas chaves e marcadores em pt-BR, en e es', () => {
  const base = DICTS['pt-BR'];
  for (const [locale, dict] of Object.entries(DICTS)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(base).sort(), `chaves de ${locale}`);
    for (const [key, value] of Object.entries(dict)) {
      const ref = base[key];
      assert.equal(typeof value, typeof ref, `${locale}.${key}: tipo`);
      if (typeof value === 'object') assert.ok(value.one && value.other, `${locale}.${key}: plural incompleto`);
      // Plural pode omitir {n} no "one" ("Um item…"); o restante tem de bater.
      if (typeof value === 'string') assert.equal(placeholders(value), placeholders(ref), `${locale}.${key}: marcadores`);
      else assert.equal(placeholders(value.other), placeholders(/** @type {{ other: string }} */ (ref).other), `${locale}.${key}: marcadores`);
    }
  }
});

test('t interpola, escolhe plural, traduz Msg aninhada e marca chave ausente', () => {
  setLocale('pt-BR');
  assert.equal(t('row.attention', { n: 1 }), '1 item pede atenção');
  assert.equal(t('row.attention', { n: 3 }), '3 itens pedem atenção');
  assert.equal(t('row.safe', { bytes: 12_400_000_000 }), '12,4 GB seguros');
  assert.equal(t('row.trash', { detail: msg('detail.items', { n: 19 }) }), '19 itens · esvaziar apaga para sempre');
  assert.equal(t('nao.existe'), '⟦nao.existe⟧');
  assert.equal(tx('node_modules'), 'node_modules');
  setLocale('en');
  assert.equal(t('row.attention', { n: 3 }), '3 items need a look');
  assert.equal(tx(msg('name.buildCache')), 'Build cache');
});

test('idioma: preferência vence, sistema decide no automático, fora dos três vira inglês', () => {
  assert.equal(resolveLocale('es', 'pt-BR'), 'es');
  assert.equal(resolveLocale('system', 'pt-PT'), 'pt-BR');
  assert.equal(resolveLocale('system', 'es-419'), 'es');
  assert.equal(resolveLocale('system', 'de-DE'), 'en');
  assert.equal(resolveLocale(undefined, ''), 'en');
});
