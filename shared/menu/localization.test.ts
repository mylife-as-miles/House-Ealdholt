import assert from 'node:assert/strict';
import test from 'node:test';
import { MENU_TRANSLATIONS, SUPPORTED_LOCALES, normalizeLocale, translate, localeCharset } from './localization';
import { PIDGIN_TRANSLATIONS } from './pidgin';

test('Nigerian Pidgin covers the shared interface and preserves unknown text', () => {
  assert.equal(normalizeLocale('pcm-NG'), 'pcm');
  for (const source of Object.keys(MENU_TRANSLATIONS)) assert.ok(PIDGIN_TRANSLATIONS[source]?.trim(), source);
  assert.equal(translate('Back', 'pcm'), 'Go back');
  assert.equal(translate('NOW PLAYING', 'pcm'), 'WETIN DEY PLAY');
  assert.equal(translate('A player-authored banner', 'pcm'), 'A player-authored banner');
});

test('all offered languages normalize safely and have native names', () => {
  assert.deepEqual(SUPPORTED_LOCALES.map(item => item.value), ['en', 'es', 'fr', 'zh-CN', 'ja', 'pcm']);
  for (const item of SUPPORTED_LOCALES) {
    assert.equal(normalizeLocale(item.value), item.value);
    assert.ok(item.label.length > 0);
  }
  assert.equal(normalizeLocale('es-MX'), 'es');
  assert.equal(normalizeLocale('fr_CA'), 'fr');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  for (const value of [null, undefined, '', 'unknown', 1, {}]) assert.equal(normalizeLocale(value), 'en');
});

test('each shared source string has four nonempty translations', () => {
  assert.ok(Object.keys(MENU_TRANSLATIONS).length >= 180);
  for (const [source, row] of Object.entries(MENU_TRANSLATIONS)) {
    assert.equal(row.length, 4, source);
    for (const item of row) assert.ok(item.trim().length > 0, source);
    assert.equal(translate(source, 'en'), source);
  }
});

test('visible casing, numbered chapters and whitespace survive localization', () => {
  assert.equal(translate('HOME', 'es'), 'INICIO');
  assert.equal(translate('general', 'fr'), 'Général');
  assert.equal(translate('  Back  ', 'ja'), '  戻る  ');
  assert.equal(translate('Chapter 02', 'zh-CN'), '章节 02');
  assert.equal(translate('Arena 01', 'fr'), 'Arène 01');
  assert.equal(translate('La Felure Demure', 'ja'), 'La Felure Demure');
  assert.equal(translate('A player-authored banner', 'es'), 'A player-authored banner');
});

test('native font charsets include translated text, uppercase accents and language-picker names', () => {
  for (const { value } of SUPPORTED_LOCALES) {
    const chars = localeCharset(value);
    assert.equal(new Set(Array.from(chars)).size, Array.from(chars).length);
    for (const { label } of SUPPORTED_LOCALES) for (const char of label) assert.ok(chars.includes(char), `${value}: ${char}`);
    for (const char of translate('Settings', value)) assert.ok(chars.includes(char));
  }
  assert.ok(localeCharset('fr').includes('É'));
  assert.ok(localeCharset('zh-CN').includes('设'));
  assert.ok(localeCharset('ja').includes('定'));
});
