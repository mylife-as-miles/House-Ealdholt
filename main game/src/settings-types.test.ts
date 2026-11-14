import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BINDINGS, INITIAL_PREFERENCES, normalizeBindings, normalizePreferences } from './settings-types';

test('fullscreen is the default while an explicit windowed preference survives a restart', () => {
  assert.equal(normalizePreferences({}).fullscreen, true);
  assert.equal(normalizePreferences({ fullscreen: false }).fullscreen, false);
  assert.equal(normalizePreferences({ fullscreen: 'yes' }).fullscreen, true);
});

test('automatic battlefield graphics is saved in the shared video preferences, with Medium as the default', () => {
  assert.equal(normalizePreferences({}).quality, 'medium');
  assert.equal(normalizePreferences({}).automaticGraphics, false);
  assert.equal(normalizePreferences({ automaticGraphics: true }).automaticGraphics, true);
  assert.equal(normalizePreferences({ automaticGraphics: 'yes' }).automaticGraphics, false);
});

test('language preference survives storage while old and malformed settings stay English', () => {
  for (const locale of ['en', 'es', 'fr', 'zh-CN', 'ja', 'pcm']) assert.equal(normalizePreferences({ locale }).locale, locale);
  assert.equal(normalizePreferences({}).locale, 'en');
  assert.equal(normalizePreferences({ locale: 'not-a-language' }).locale, 'en');
  assert.equal(normalizePreferences({ quality: 'low', locale: 'ja' }).quality, 'low');
});

// Persisted device data includes files from before the audio channels existed.
test('old preferences acquire independent audio channels without losing existing controls', () => {
  const old = { quality: 'medium', volume: 40, motion: false, showHints: false, renderScale: 85, frameLimit: 60, bindings: { ...DEFAULT_BINDINGS, right: 'KeyD' } };
  const current = normalizePreferences(old);
  assert.equal(current.volume, 40);
  assert.equal(current.musicVolume, INITIAL_PREFERENCES.musicVolume);
  assert.equal(current.sfxVolume, INITIAL_PREFERENCES.sfxVolume);
  assert.equal(current.music, true); assert.equal(current.soundEffects, true);
  assert.equal(current.quality, 'medium'); assert.equal(current.renderScale, 85); assert.equal(current.frameLimit, 60);
  assert.equal(current.motion, false); assert.equal(current.showHints, false);
  assert.equal(current.bindings.right, 'KeyD');
  assert.notEqual(current.bindings, old.bindings);
});

test('malformed or out-of-range storage cannot create invalid audio, rendering or key states', () => {
  for (const value of [null, undefined, [], 'invalid', 42]) assert.deepEqual(normalizePreferences(value), INITIAL_PREFERENCES);
  const invalid = normalizePreferences({ quality: 'ultra', volume: Infinity, musicVolume: -20, sfxVolume: 300, music: 'yes', soundEffects: null, motion: 'off', showHints: 0, renderScale: NaN, frameLimit: 17, bindings: { ...DEFAULT_BINDINGS, right: 'Escape' } });
  assert.equal(invalid.quality, 'medium'); assert.equal(invalid.renderScale, 90); assert.equal(invalid.frameLimit, 0);
  assert.equal(invalid.volume, INITIAL_PREFERENCES.volume); assert.equal(invalid.musicVolume, 0); assert.equal(invalid.sfxVolume, 100);
  assert.equal(invalid.motion, true); assert.equal(invalid.showHints, true);
  assert.deepEqual(invalid.bindings, DEFAULT_BINDINGS);
  assert.equal(normalizePreferences({ renderScale: 10 }).renderScale, 50);
  assert.equal(normalizePreferences({ renderScale: 900 }).renderScale, 100);
});

test('match subtitles default on at medium size, survive a reload and refuse unknown sizes', () => {
  const old = normalizePreferences({ quality: 'high', volume: 40 });
  assert.equal(old.subtitles, true); assert.equal(old.subtitleSize, 'medium');
  const saved = normalizePreferences({ subtitles: false, subtitleSize: 'large' });
  assert.equal(saved.subtitles, false); assert.equal(saved.subtitleSize, 'large');
  const invalid = normalizePreferences({ subtitles: 'no', subtitleSize: 'huge' });
  assert.equal(invalid.subtitles, true); assert.equal(invalid.subtitleSize, 'medium');
});

test('conflicting or reserved stored bindings are refused, and normalized defaults are isolated', () => {
  assert.deepEqual(normalizeBindings({ ...DEFAULT_BINDINGS, right: 'KeyQ' }), DEFAULT_BINDINGS);
  assert.deepEqual(normalizeBindings({ ...DEFAULT_BINDINGS, select: 'Tab' }), DEFAULT_BINDINGS);
  const first = normalizePreferences(null), second = normalizePreferences(null);
  first.bindings.right = 'KeyD';
  assert.equal(second.bindings.right, 'ArrowRight');
  assert.equal(INITIAL_PREFERENCES.bindings.right, 'ArrowRight');
});
