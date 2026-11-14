import assert from 'node:assert/strict';
import test from 'node:test';
import { CreditsFilmPlayer, type CreditsFilmMediaEvent } from './credits-film-player';

class Video extends EventTarget {
  src = '';
  muted = false;
  playsInline = false;
  loop = true;
  controls = true;
  preload = '';
  crossOrigin: string | null = null;
  volume = 1;
  currentTime = 0;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  attributes = new Map<string, string>();
  plays: boolean[] = [];
  loads = 0;
  /** Refuse play() with this name while unmuted (an autoplay policy) or always. */
  refuseUnmuted = '';
  refuseAlways = '';
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
  play() {
    this.plays.push(this.muted);
    const refusal = this.refuseAlways || (!this.muted && this.refuseUnmuted);
    if (refusal) return Promise.reject(Object.assign(new Error(refusal), { name: refusal }));
    this.paused = false;
    queueMicrotask(() => { if (!this.paused && this.src) this.dispatchEvent(new Event('playing')); });
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  load() { this.loads++; }
  finish() { this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
  fail() { this.error = { code: 4 }; this.dispatchEvent(new Event('error')); }
}
async function settle() { for (let index = 0; index < 10; index++) await Promise.resolve(); }
function fixture(setup?: (video: Video) => void) {
  const video = new Video(); setup?.(video);
  const events: CreditsFilmMediaEvent[] = [];
  const player = new CreditsFilmPlayer(video as unknown as HTMLVideoElement, { src: '/video/film.mp4', onEvent: event => events.push(event) });
  return { video, events, player };
}

test('the element is prepared inline and muted before any trusted input', () => {
  const { video } = fixture();
  assert.equal(video.playsInline, true);
  assert.ok(video.attributes.has('playsinline'));
  assert.ok(video.attributes.has('webkit-playsinline'));
  assert.equal(video.muted, true);
  assert.equal(video.loop, false); assert.equal(video.controls, false);
  assert.equal(video.preload, 'auto'); assert.equal(video.crossOrigin, 'anonymous');
  assert.equal(video.src, '/video/film.mp4');
  assert.deepEqual(video.plays, [], 'preparing never starts playback');
});

test('a trusted press unmutes and plays synchronously from the first frame', async () => {
  const { video, events, player } = fixture();
  video.currentTime = 40;
  player.start(true);
  assert.deepEqual(video.plays, [false], 'play() runs inside the press, unmuted');
  assert.equal(video.currentTime, 0);
  assert.equal(player.muted, false);
  await settle();
  assert.deepEqual(events, ['playing']);
  player.pause();
  assert.equal(video.paused, true);
  player.resume(false);
  assert.deepEqual(video.plays, [false, false], 'an untrusted resume keeps the current sound state');
});

test('an untrusted start stays muted; a later trusted resume restores sound', async () => {
  const { video, player } = fixture();
  player.start(false);
  assert.deepEqual(video.plays, [true]);
  player.pause();
  player.resume(true);
  assert.deepEqual(video.plays, [true, false]);
});

test('refused sound falls back to silent playback and reports muted, not failure', async () => {
  const { video, events, player } = fixture(v => { v.refuseUnmuted = 'NotAllowedError'; });
  player.start(true);
  await settle();
  assert.deepEqual(video.plays, [false, true]);
  assert.equal(video.muted, true);
  assert.deepEqual(events, ['muted', 'playing']);
});

test('ended and decoding errors are reported; a superseded play is not a failure', async () => {
  const ended = fixture();
  ended.player.start(true); await settle();
  ended.video.finish();
  assert.deepEqual(ended.events, ['playing', 'ended']);

  const broken = fixture(v => { v.refuseAlways = 'NotSupportedError'; });
  broken.player.start(true); await settle();
  assert.deepEqual(broken.events, ['failed']);

  const errored = fixture();
  errored.video.fail();
  assert.deepEqual(errored.events, ['failed']);

  const aborted = fixture(v => { v.refuseAlways = 'AbortError'; });
  aborted.player.start(true); await settle();
  assert.deepEqual(aborted.events, []);
});

test('dispose stops loading, removes the source and silences late events', async () => {
  const { video, events, player } = fixture();
  player.start(true);
  player.dispose();
  assert.equal(video.paused, true);
  assert.equal(video.src, '');
  assert.equal(video.loads, 1);
  await settle();
  video.finish(); video.fail();
  assert.deepEqual(events, [], 'no event reaches a closed player');
  player.start(true); player.resume(true); player.dispose();
  assert.equal(video.plays.length, 1, 'a disposed player never plays again');
  assert.equal(video.loads, 1);
});

test('a start that holds on refused sound stays paused and silent and reports blocked', async () => {
  const { video, events, player } = fixture(v => { v.refuseUnmuted = 'NotAllowedError'; });
  video.currentTime = 12;
  player.start(true, { holdIfRefused: true });
  await settle();
  assert.deepEqual(video.plays, [false], 'no silent retry: the film waits for a press');
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  assert.equal(video.currentTime, 0);
  assert.deepEqual(events, ['blocked']);
  // The press that follows starts it with sound.
  video.refuseUnmuted = '';
  player.start(true);
  await settle();
  assert.deepEqual(video.plays, [false, false]);
  assert.equal(video.muted, false);
  assert.deepEqual(events, ['blocked', 'playing']);
});

test('hold parks the film silent on its first frame and supersedes a pending start', async () => {
  const { video, events, player } = fixture(v => { v.refuseUnmuted = 'NotAllowedError'; });
  player.start(true, { holdIfRefused: true });
  player.hold();
  await settle();
  assert.deepEqual(events, [], 'the superseded refusal reports nothing');
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  assert.equal(video.currentTime, 0);
});
