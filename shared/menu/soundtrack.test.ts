import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import test from 'node:test';
import { CROWNFALL_SOUNDTRACK, resolveCrownfallSoundtrack } from './soundtrack';

test('the supplied six-track list keeps exact display titles and only the known artist', () => {
  assert.deepEqual(CROWNFALL_SOUNDTRACK.map(track => track.title), [
    'Sanguis et Terra', 'Le Roi Muet', 'La Felure Demure',
    'Krom Shahid', 'Cyning Slieht', 'Slay the Iron Slave',
  ]);
  assert.equal(new Set(CROWNFALL_SOUNDTRACK.map(track => track.id)).size, 6);
  assert.deepEqual(CROWNFALL_SOUNDTRACK.filter(track => track.artist).map(track => [track.id, track.artist]), [
    ['la-felure-demure', 'myles4miles'],
  ]);
  assert.ok(Object.isFrozen(CROWNFALL_SOUNDTRACK));
  for (const track of CROWNFALL_SOUNDTRACK) {
    assert.ok(Object.isFrozen(track));
    assert.match(track.src, /^audio\/soundtrack\/[a-z0-9-]+\.mp3$/);
    assert.ok(Number.isFinite(track.durationSeconds) && track.durationSeconds > 0);
  }
});

test('absolute public bases preserve subpath deployments and return independent descriptors', () => {
  const base = new URL('https://example.test/games/crownfall/?preview=1#menu');
  const resolved = resolveCrownfallSoundtrack(base);
  assert.equal(resolved[0].src, 'https://example.test/games/crownfall/audio/soundtrack/sanguis-et-terra.mp3');
  assert.equal(base.href, 'https://example.test/games/crownfall/?preview=1#menu');
  assert.equal(resolveCrownfallSoundtrack('https://cdn.example.test/crownfall')[5].src,
    'https://cdn.example.test/crownfall/audio/soundtrack/slay-the-iron-slave.mp3');
  assert.equal(resolveCrownfallSoundtrack('https://example.test/')[0].src,
    'https://example.test/audio/soundtrack/sanguis-et-terra.mp3');
  assert.notEqual(resolved[0], CROWNFALL_SOUNDTRACK[0]);
  assert.notEqual(resolved[0], resolveCrownfallSoundtrack(base)[0]);
  assert.equal(CROWNFALL_SOUNDTRACK[0].src, 'audio/soundtrack/sanguis-et-terra.mp3');
  assert.throws(() => resolveCrownfallSoundtrack('/relative-base/'), TypeError);
});

test('both generated audio sets preserve the supplied MP3 sizes and SHA-256 hashes', async () => {
  const root = new URL('../../', import.meta.url);
  const source = new URL('main%20game/public/', root);
  const native = new URL('main-game-vr/public/', root);
  const provenance = JSON.parse(await readFile(new URL('audio/soundtrack/provenance.json', source), 'utf8'));
  assert.equal(provenance.tracks.length, CROWNFALL_SOUNDTRACK.length);
  for (const [index, track] of CROWNFALL_SOUNDTRACK.entries()) {
    const recorded = provenance.tracks[index];
    assert.equal(recorded.id, track.id);
    assert.equal(recorded.src, track.src);
    assert.equal(recorded.title, track.title);
    assert.equal(recorded.artist, track.artist);
    assert.equal(recorded.durationSeconds, track.durationSeconds);
    for (const publicRoot of [source, native]) {
      const path = new URL(track.src, publicRoot);
      assert.equal((await lstat(path)).isSymbolicLink(), false);
      const bytes = await readFile(path);
      assert.equal(bytes.length, recorded.bytes, track.id);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), recorded.sha256, track.id);
    }
  }
  assert.equal(provenance.tracks[2].originalTags.title, 'La Fêlure Demeure');
  assert.equal(provenance.tracks[2].originalTags.artist, 'myles4miles');
});
