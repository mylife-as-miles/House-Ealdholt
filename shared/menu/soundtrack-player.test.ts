import assert from 'node:assert/strict';
import test from 'node:test';
import { CrownfallSoundtrackPlayer, SoundtrackShuffleBag } from './soundtrack-player';
import { CROWNFALL_SOUNDTRACK, STARTUP_TRACK_ID, type CrownfallTrack } from './soundtrack';

function random(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

test('every shuffled six-track cycle is complete and cycle boundaries never repeat', () => {
  for (let seed = 1; seed < 30; seed++) {
    const bag = new SoundtrackShuffleBag(6, random(seed));
    let last: number | null = null;
    for (let cycle = 0; cycle < 20; cycle++) {
      const selected = Array.from({ length: 6 }, () => bag.next());
      assert.deepEqual([...selected].sort(), [0, 1, 2, 3, 4, 5]);
      if (last !== null) assert.notEqual(selected[0], last);
      last = selected[5];
    }
  }
});

test('first track is random and degenerate playlists or RNG values remain safe', () => {
  const firsts = new Set(Array.from({ length: 30 }, (_, seed) => new SoundtrackShuffleBag(6, random(seed * 7919 + 1)).next()));
  assert.equal(firsts.size, 6);
  const empty = new SoundtrackShuffleBag(0); assert.equal(empty.next(), null);
  const one = new SoundtrackShuffleBag(1); assert.equal(one.next(), 0); assert.equal(one.next(), 0);
  for (const value of [-100, 100, NaN, Infinity]) {
    const bag = new SoundtrackShuffleBag(6, () => value);
    assert.deepEqual(Array.from({ length: 6 }, () => bag.next()).sort(), [0, 1, 2, 3, 4, 5]);
  }
});

test('preferred opener is first without repeats or omissions in shuffled cycles', () => {
  for (let seed = 1; seed < 30; seed++) {
    const bag = new SoundtrackShuffleBag(6, random(seed), 2);
    const first = Array.from({ length: 6 }, () => bag.next());
    assert.equal(first[0], 2);
    assert.deepEqual([...first].sort(), [0, 1, 2, 3, 4, 5]);
    const second = Array.from({ length: 6 }, () => bag.next());
    assert.notEqual(second[0], first[5]);
    assert.deepEqual([...second].sort(), [0, 1, 2, 3, 4, 5]);
  }
});

class Media extends EventTarget {
  src = '';
  preload = '';
  loop = true;
  crossOrigin = '';
  muted = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  plays = 0;
  removedSources = 0;
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.removedSources++; } }
  load() {}
  signal(name: string) { this.dispatchEvent(new Event(name)); }
  start() { this.signal('playing'); }
  finish() { this.ended = true; this.paused = true; this.signal('ended'); }
  fail() { this.error = { code: 4 }; this.signal('error'); }
}
const tracks: CrownfallTrack[] = Array.from({ length: 6 }, (_, index) => ({
  id: `id-${index}`, title: `Title ${index}`, ...(index === 0 ? { artist: 'Supplied artist' } : {}),
  src: `https://example.test/music/${index}.mp3`, durationSeconds: 100,
}));
function fixture(options: { factoryFailure?: boolean; connectionFailure?: boolean; tracks?: readonly CrownfallTrack[] } = {}) {
  const media: Media[] = [];
  const sources: Array<{ connected: boolean; connect: () => void; disconnect: () => void }> = [];
  const context = {
    createMediaElementSource(element: Media) {
      assert.equal(element.muted, true); assert.equal(element.volume, 0); assert.equal(element.src, '', 'route is built before src can load');
      const source = { connected: false, connect() { if (options.connectionFailure) throw new Error('connect'); this.connected = true; }, disconnect() { this.connected = false; } };
      sources.push(source); return source;
    },
  } as unknown as AudioContext;
  let updates = 0;
  const player = new CrownfallSoundtrackPlayer({ tracks: options.tracks ?? tracks, random: () => 0.99,
    createMedia: () => { if (options.factoryFailure) throw new Error('factory'); const element = new Media(); media.push(element); return element as unknown as HTMLAudioElement; },
    onChange: () => { updates++; },
  });
  player.setOutput(context, {} as GainNode);
  return { player, media, sources, updates: () => updates };
}

test('supplied playlist opens with La Felure Demure, then continues without repeating it', () => {
  const { player, media } = fixture({ tracks: CROWNFALL_SOUNDTRACK });
  player.update(true, true); media[0].start();
  assert.equal(player.nowPlaying?.trackId, STARTUP_TRACK_ID);
  media[0].finish(); media[1].start();
  assert.notEqual(player.nowPlaying?.trackId, STARTUP_TRACK_ID);
  player.dispose();
});

test('ended advances a single serial stream through all six tracks without replaying the first announcement', () => {
  const { player, media, sources } = fixture();
  player.update(true, true);
  const firstCycle = new Set<string>();
  for (let index = 0; index < 6; index++) {
    assert.equal(media.length, index + 1);
    assert.equal(sources.filter(source => source.connected).length, 1);
    assert.equal(media.filter(element => element.src).length, 1, 'only one element retains a network source');
    assert.equal(Boolean(player.nowPlaying), false, 'loading never publishes a title');
    media[index].start();
    assert.equal(player.nowPlaying?.sequence, index + 1);
    assert.equal(player.nowPlaying?.playing, true);
    firstCycle.add(player.nowPlaying!.trackId);
    if (index === 0) assert.equal(player.nowPlaying?.artist, 'Supplied artist');
    else assert.equal(player.nowPlaying?.artist, undefined, 'no invented artist fallback');
    media[index].finish();
    assert.equal(media[index].src, ''); assert.equal(media[index].paused, true);
  }
  assert.equal(firstCycle.size, 6);
  media[6].start(); assert.notEqual(player.nowPlaying?.trackId, tracks[5].id);
  assert.equal(player.nowPlaying?.sequence, 7);
  player.dispose(); assert.equal(sources.filter(source => source.connected).length, 0);
});

test('media error events skip each broken candidate once and then stop until Next', () => {
  const { player, media } = fixture(); player.update(true, true);
  for (let index = 0; index < 6; index++) {
    media[index].fail();
    media[index].start(); media[index].finish(); media[index].fail();
    assert.equal(Boolean(player.nowPlaying), false, 'retired element events cannot publish playback');
  }
  assert.equal(media.length, 6); assert.equal(player.state, 'error');
  player.update(true, true); assert.equal(media.length, 6);
  player.next(); assert.equal(media.length, 7); media[6].start(); assert.equal(player.nowPlaying?.sequence, 1);
  player.dispose();
});

test('empty streams that end before becoming audible also stop after six candidates', () => {
  const { player, media } = fixture(); player.update(true, true);
  for (let index = 0; index < 6; index++) media[index].finish();
  assert.equal(media.length, 6); assert.equal(player.state, 'error'); assert.equal(Boolean(player.nowPlaying), false);
  player.dispose();
});

test('factory and source connection failures never attempt direct media playback', () => {
  for (const options of [{ factoryFailure: true }, { connectionFailure: true }]) {
    const { player, media, sources } = fixture(options);
    player.update(true, true);
    assert.equal(player.state, 'error'); assert.equal(Boolean(player.nowPlaying), false);
    assert.ok(media.every(element => element.plays === 0 && element.paused && element.src === '' && element.muted && element.volume === 0));
    assert.ok(sources.every(source => !source.connected));
    player.dispose();
  }
});

test('pre-resume playing and hidden load failures cannot publish or fetch another track until audible', () => {
  const { player, media } = fixture(); player.update(true, false); media[0].start();
  assert.equal(Boolean(player.nowPlaying), false); assert.equal(player.state, 'loading');
  player.update(false, false); media[0].fail();
  assert.equal(media.length, 1); assert.equal(Boolean(player.nowPlaying), false);
  player.update(true, true); assert.equal(media.length, 2); media[1].start();
  assert.equal(player.nowPlaying?.sequence, 1); assert.equal(player.nowPlaying?.trackId, tracks[1].id);
  player.dispose();
});
