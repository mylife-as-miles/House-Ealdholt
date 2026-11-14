import assert from 'node:assert/strict';
import test from 'node:test';
import { CrownfallMenuAudio, DEFAULT_MENU_AUDIO_PREFERENCES, normalizeMenuAudioPreferences } from './audio';
import type { CrownfallTrack } from './soundtrack';

class Parameter {
  value = 1;
  automation: Array<{ kind: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.automation.push({ kind: 'set', value, time }); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.automation.push({ kind: 'linear', value, time }); return this; }
  exponentialRampToValueAtTime(value: number, time: number) { this.value = value; this.automation.push({ kind: 'exponential', value, time }); return this; }
}
class Node {
  connections = new Set<Node>();
  disconnects = 0;
  connect(destination: Node) { this.connections.add(destination); return destination; }
  disconnect() { this.connections.clear(); this.disconnects++; }
}
class Gain extends Node { gain = new Parameter(); }
class Oscillator extends Node {
  frequency = new Parameter();
  type = 'sine';
  starts = 0;
  stops: Array<number | undefined> = [];
  onended: (() => void) | null = null;
  start() { this.starts++; }
  stop(time?: number) { this.stops.push(time); }
  end() { this.onended?.(); }
}
class Media extends EventTarget {
  src = '';
  preload = '';
  loop = false;
  crossOrigin = '';
  volume = 1;
  currentTime = 0;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  plays = 0;
  pauses = 0;
  loads = 0;
  autoPlaying = true;
  pendingPlay: Promise<void> | null = null;
  refusal = '';
  play() {
    this.plays++;
    if (this.refusal) return Promise.reject(Object.assign(new Error(this.refusal), { name: this.refusal }));
    this.paused = false;
    if (this.autoPlaying) queueMicrotask(() => { if (!this.paused && this.src) this.signal('playing'); });
    return this.pendingPlay ?? Promise.resolve();
  }
  pause() { this.pauses++; this.paused = true; this.signal('pause'); }
  load() { this.loads++; }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  signal(name: string) { this.dispatchEvent(new Event(name)); }
  finish() { this.ended = true; this.paused = true; this.signal('ended'); }
  fail() { this.error = { code: 4 }; this.signal('error'); }
}
class Source extends Node { constructor(readonly media: Media) { super(); } }
class Context {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = new Node();
  gains: Gain[] = [];
  oscillators: Oscillator[] = [];
  sources: Source[] = [];
  listeners = new Set<() => void>();
  resumes = 0;
  closes = 0;
  refuseResume = false;
  refuseBinding = false;
  pendingResume: Promise<void> | null = null;
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createOscillator() { const oscillator = new Oscillator(); this.oscillators.push(oscillator); return oscillator; }
  createMediaElementSource(media: Media) {
    if (this.refuseBinding) throw new Error('Binding unavailable');
    assert.ok(!this.sources.some(source => source.media === media), 'an element binds only once');
    const source = new Source(media); this.sources.push(source); return source;
  }
  addEventListener(_name: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_name: string, listener: () => void) { this.listeners.delete(listener); }
  async resume() {
    this.resumes++;
    if (this.refuseResume) throw new Error('NotAllowedError');
    if (this.pendingResume) await this.pendingResume;
    if (this.state !== 'closed') this.changeState('running');
  }
  async close() { this.closes++; this.changeState('closed'); }
  changeState(state: AudioContextState) { this.state = state; for (const listener of this.listeners) listener(); }
}
const tracks: CrownfallTrack[] = Array.from({ length: 6 }, (_, index) => ({
  id: `track-${index}`, title: `Track ${index}`, src: `https://example.test/crownfall/audio/${index}.mp3`, durationSeconds: 120,
  ...(index === 0 ? { artist: 'Supplied artist' } : {}),
}));
function fixture(setupMedia?: (media: Media) => void) {
  const context = new Context(); let creations = 0;
  const media: Media[] = [];
  const createMedia = () => { const element = new Media(); setupMedia?.(element); media.push(element); return element as unknown as HTMLAudioElement; };
  const audio = new CrownfallMenuAudio({ tracks, createMedia, random: () => 0.5, createContext: () => { creations++; return context as unknown as AudioContext; } });
  return { audio, context, media, createMedia, creations: () => creations };
}
async function settle() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

test('saved audio channels migrate safely and clamp malformed numeric preferences', () => {
  assert.deepEqual(normalizeMenuAudioPreferences({ volume: 25 }), { ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 25 });
  assert.deepEqual(normalizeMenuAudioPreferences({ volume: -1, musicVolume: 1000, sfxVolume: NaN, music: false, soundEffects: false }), {
    volume: 0, musicVolume: 100, sfxVolume: 70, music: false, soundEffects: false,
  });
  for (const value of [undefined, null, [], 'bad']) assert.deepEqual(normalizeMenuAudioPreferences(value), DEFAULT_MENU_AUDIO_PREFERENCES);
});

test('graph and media are lazy, gesture unlock is deduplicated, and streaming music uses its real channel', async () => {
  const { audio, context, creations, media } = fixture();
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 40, musicVolume: 20, sfxVolume: 80 });
  audio.play('select');
  assert.equal(creations(), 0); assert.equal(media.length, 0); assert.equal(Boolean(audio.status.nowPlaying), false);
  const first = audio.unlock(), second = audio.unlock();
  assert.equal(media[0].plays, 1, 'play is requested synchronously inside the gesture');
  assert.equal(first, second); assert.equal(await first, true); assert.equal(context.resumes, 1);
  assert.deepEqual([audio.status.masterGain, audio.status.musicGain, audio.status.sfxGain], [0.4, 0.2, 0.8]);
  assert.equal(audio.status.musicPlaying, true); assert.equal(audio.status.musicState, 'playing');
  assert.equal(context.oscillators.length, 0, 'music does not create synthetic pad oscillators');
  assert.equal(context.gains[0].connections.has(context.destination), true);
  assert.equal(context.sources[0].connections.has(context.gains[1]), true);
  assert.equal(context.gains[1].connections.has(context.gains[0]), true);
  assert.equal(context.gains[2].connections.has(context.gains[0]), true);
  audio.play('select');
  const effect = context.oscillators[0];
  assert.equal([...effect.connections][0].connections.has(context.gains[2]), true);
  assert.ok(effect.frequency.automation.some((event) => event.kind === 'exponential'));
  effect.end(); assert.equal(effect.connections.size, 0);
  const initial = audio.status.nowPlaying;
  for (let index = 0; index < 10; index++) { audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES); await audio.unlock(); }
  assert.deepEqual(audio.status.nowPlaying, initial);
  assert.equal(media.length, 1); assert.equal(media[0].plays, 1, 'navigation and refresh do not restart media');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, musicVolume: 75, sfxVolume: 15 });
  assert.equal(audio.status.musicGain, 0.75); assert.equal(audio.status.sfxGain, 0.15);
  audio.dispose();
});

test('explicit music mute preserves position, while returning from hidden/match suspension starts fresh', async () => {
  const { audio, context, media } = fixture(); await audio.unlock(); audio.play('confirm');
  const initial = audio.status.nowPlaying;
  media[0].currentTime = 42;
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false });
  assert.equal(audio.status.musicPlaying, false); assert.equal(audio.status.musicGain, 0); assert.equal(media[0].paused, true);
  assert.equal(context.oscillators[0].connections.size, 1, 'music off leaves an effect independent');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, soundEffects: false }); await settle();
  const count = context.oscillators.length; audio.play('confirm');
  assert.equal(context.oscillators.length, count); assert.equal(audio.status.sfxGain, 0); assert.equal(audio.status.musicPlaying, true);
  assert.equal(media[0].currentTime, 42); assert.deepEqual(audio.status.nowPlaying, initial);
  audio.setSuspended(true);
  assert.equal(audio.status.state, 'suspended'); assert.deepEqual([audio.status.masterGain, audio.status.musicGain, audio.status.sfxGain], [0, 0, 0]);
  assert.equal(media[0].paused, true); assert.ok(context.oscillators.every(node => node.connections.size === 0));
  audio.setSuspended(false); await settle();
  assert.equal(audio.status.musicPlaying, true); assert.equal(audio.status.masterGain, 0.65);
  assert.equal(media.at(-1)!.currentTime, 0); assert.notEqual(audio.status.nowPlaying?.trackId, initial?.trackId); assert.equal(media.length, 2);
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 0 });
  assert.equal(audio.status.masterGain, 0); assert.equal(audio.status.musicPlaying, false); assert.equal(media.at(-1)!.paused, true);
  audio.dispose();
});

test('music muted before gesture never creates a media element, while SFX still work', async () => {
  for (const preferences of [{ music: false }, { musicVolume: 0 }, { volume: 0 }]) {
    const { audio, context, media } = fixture();
    audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, ...preferences }); await audio.unlock();
    assert.equal(media.length, 0); assert.equal(Boolean(audio.status.nowPlaying), false);
    audio.play('confirm');
    assert.equal(context.oscillators.length, preferences.volume === 0 ? 0 : 1);
    audio.dispose();
  }
});

test('unlock completes independently of an unresolved MP3 play promise and announces only actual audible playback', async () => {
  let resolvePlay!: () => void;
  const { audio, media } = fixture(element => { element.autoPlaying = false; element.pendingPlay = new Promise(resolve => { resolvePlay = resolve; }); });
  assert.equal(await audio.unlock(), true);
  assert.equal(audio.status.musicState, 'loading'); assert.equal(Boolean(audio.status.nowPlaying), false);
  resolvePlay(); await settle();
  assert.equal(Boolean(audio.status.nowPlaying), false, 'a resolved play promise alone is not a playing event');
  media[0].signal('playing');
  assert.equal(audio.status.nowPlaying?.sequence, 1); assert.equal(audio.status.nowPlaying?.playing, true);
  audio.dispose();
});

test('browser-blocked context resume cannot announce a track and remains retryable on the next gesture', async () => {
  const { audio, context, media } = fixture(); context.refuseResume = true;
  assert.equal(await audio.unlock(), false); assert.equal(audio.status.state, 'locked'); assert.match(audio.status.error, /blocked/);
  assert.equal(Boolean(audio.status.nowPlaying), false); assert.equal(audio.status.masterGain, 0); assert.equal(media[0].paused, true);
  context.refuseResume = false;
  assert.equal(await audio.unlock(), true); assert.equal(audio.status.error, ''); assert.equal(audio.status.musicPlaying, true);
  const first = audio.status.nowPlaying;
  context.changeState('suspended'); assert.equal(audio.status.state, 'suspended'); assert.equal(audio.status.musicPlaying, false);
  assert.equal(await audio.unlock(), true); assert.equal(context.resumes, 3); assert.deepEqual(audio.status.nowPlaying, first);
  audio.dispose();
});

test('a resume that never settles (asked outside a gesture, by Esc or a gamepad button) does not swallow the next gesture', async () => {
  const { audio, context, media } = fixture();
  // Without a user activation a browser leaves resume() pending; it may never settle.
  context.pendingResume = new Promise<void>(() => {});
  let stuckSettled = false;
  void audio.unlock().then(() => { stuckSettled = true; });
  await settle();
  assert.equal(stuckSettled, false); assert.equal(audio.status.state, 'locked'); assert.equal(context.resumes, 1);
  assert.equal(audio.status.musicPlaying, false, 'nothing is audible while the context waits');
  // The next real click: the browser now lets the context start.
  context.pendingResume = null;
  assert.equal(await audio.unlock(), true, 'the second call asks again instead of returning the stuck request');
  assert.equal(context.resumes, 2);
  assert.equal(audio.status.state, 'running'); assert.equal(audio.status.unlocked, true); assert.equal(audio.status.error, '');
  assert.equal(audio.status.masterGain, 0.65); assert.equal(audio.status.musicPlaying, true); assert.equal(media.length, 1);
  // Calls inside one input turn still share one request.
  context.changeState('suspended');
  const first = audio.unlock(), second = audio.unlock();
  assert.equal(first, second); assert.equal(await first, true); assert.equal(context.resumes, 3);
  audio.dispose();
});

test('blocked media is silent without skipping songs or gating SFX, and only a new gesture retries it', async () => {
  const { audio, context, media } = fixture(element => { element.refusal = 'NotAllowedError'; });
  assert.equal(await audio.unlock(), true); await settle();
  assert.equal(audio.status.musicState, 'blocked'); assert.equal(Boolean(audio.status.nowPlaying), false); assert.equal(media.length, 1);
  for (let index = 0; index < 10; index++) audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES);
  assert.equal(media[0].plays, 1);
  audio.play('confirm'); assert.equal(context.oscillators.length, 1);
  media[0].refusal = ''; await audio.unlock(); await settle();
  assert.equal(media.length, 1); assert.equal(media[0].plays, 2); assert.equal(audio.status.nowPlaying?.sequence, 1);
  audio.dispose();
});

test('closed contexts replace the old media binding, preserving song position and announcement sequence', async () => {
  const first = new Context(), second = new Context(); let creations = 0;
  const base = fixture();
  const audio = new CrownfallMenuAudio({ tracks, createMedia: base.createMedia, random: () => 0.5,
    createContext: () => (++creations === 1 ? first : second) as unknown as AudioContext });
  await audio.unlock(); const initial = audio.status.nowPlaying; base.media[0].currentTime = 37;
  first.changeState('closed'); assert.equal(audio.status.state, 'closed'); assert.equal(audio.status.musicPlaying, false);
  assert.equal(creations, 1, 'browser loss never creates another graph before a gesture');
  assert.equal(await audio.unlock(), true);
  assert.equal(creations, 2); assert.equal(first.listeners.size, 0); assert.equal(base.media.length, 2);
  assert.ok(first.gains.every(node => node.connections.size === 0)); assert.equal(first.sources[0].connections.size, 0);
  assert.equal(base.media[0].src, ''); assert.equal(base.media[0].paused, true);
  assert.equal(base.media[1].currentTime, 37); assert.deepEqual(audio.status.nowPlaying, initial);
  assert.notEqual(first.sources[0].media, second.sources[0].media, 'fresh element avoids duplicate binding exceptions');
  audio.dispose(); base.audio.dispose(); assert.equal(second.closes, 1);
});

test('failed tracks are bounded to six attempts and Next can recover without false now-playing', async () => {
  let refuseMedia = true;
  const { audio, context, media } = fixture(element => { if (refuseMedia) element.refusal = 'NotSupportedError'; });
  assert.equal(await audio.unlock(), true); await settle();
  assert.equal(media.length, 6); assert.equal(audio.status.musicState, 'error'); assert.equal(Boolean(audio.status.nowPlaying), false);
  for (let index = 0; index < 10; index++) audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES);
  await settle(); assert.equal(media.length, 6, 'a failed playlist cannot spin on refresh');
  for (const element of media) assert.equal(element.src, '');
  context.refuseBinding = true; audio.nextTrack();
  assert.equal(audio.status.musicState, 'error'); assert.equal(Boolean(audio.status.nowPlaying), false);
  assert.equal(media[6].plays, 0, 'failed graph binding never starts a direct media output');
  context.refuseBinding = false; refuseMedia = false;
  audio.nextTrack(); await settle(); assert.equal(audio.status.nowPlaying?.sequence, 1);
  audio.dispose();
});

test('late playback/end/error callbacks after mute, next and dispose do not announce or advance the playlist', async () => {
  let resolve!: () => void;
  const { audio, media } = fixture(element => { element.autoPlaying = false; element.pendingPlay = new Promise(done => { resolve = done; }); });
  await audio.unlock(); const old = media[0];
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false });
  resolve(); old.signal('playing'); await settle();
  assert.equal(Boolean(audio.status.nowPlaying), false); assert.equal(media.length, 1); assert.equal(old.paused, true);
  audio.nextTrack(); assert.equal(media.length, 1, 'Next while muted makes no network request');
  old.finish(); old.fail(); assert.equal(media.length, 1);
  audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES); assert.equal(media.length, 2);
  audio.dispose(); resolve(); media[1].signal('playing'); media[1].finish(); media[1].fail(); await settle();
  assert.equal(audio.status.musicPlaying, false); assert.equal(Boolean(audio.status.nowPlaying), false); assert.equal(media.length, 2);
});

test('subscriptions announce the fresh return track exactly once', async () => {
  const { audio } = fixture(); const starts: number[] = [];
  const unsubscribe = audio.subscribe(status => { if (status.nowPlaying?.playing) starts.push(status.nowPlaying.sequence); });
  await audio.unlock(); assert.ok(starts.includes(1));
  audio.setSuspended(true); audio.setSuspended(false); await settle(); assert.equal(Math.max(...starts), 2);
  audio.nextTrack(); await settle(); assert.equal(Math.max(...starts), 3);
  unsubscribe(); const count = starts.length; audio.nextTrack(); await settle(); assert.equal(starts.length, count);
  audio.dispose();
});

test('unsupported audio, navigation bursts, completed effects and disposal during unlock are bounded and safe', async () => {
  const unsupported = new CrownfallMenuAudio({ createContext: () => null });
  assert.equal(await unsupported.unlock(), false); assert.equal(unsupported.status.state, 'unsupported'); unsupported.play('select'); unsupported.dispose();
  const { audio, context } = fixture(); audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false }); await audio.unlock();
  for (let index = 0; index < 100; index++) audio.play('navigate');
  assert.equal(context.oscillators.length, 1);
  context.currentTime = 0.1; audio.play('navigate'); assert.equal(context.oscillators.length, 2);
  for (let index = 0; index < 100; index++) audio.play('select');
  assert.equal(context.oscillators.length, 12, 'active effect voices have a finite ceiling');
  for (const node of context.oscillators) node.end();
  audio.play('select'); assert.equal(context.oscillators.length, 13);
  audio.dispose(); audio.dispose(); assert.equal(context.closes, 1); assert.equal(context.listeners.size, 0);
  assert.equal(audio.status.state, 'closed'); assert.equal(await audio.unlock(), false);
  assert.ok(context.oscillators.every(node => node.connections.size === 0));
  const pending = fixture(); let resume!: () => void;
  pending.context.pendingResume = new Promise<void>(resolve => { resume = resolve; });
  const unlocking = pending.audio.unlock(); pending.audio.dispose(); resume();
  assert.equal(await unlocking, false); assert.equal(pending.context.oscillators.length, 0); assert.equal(pending.audio.status.state, 'closed');
  assert.equal(pending.audio.status.nowPlaying, null); assert.ok(pending.media.every(element => element.src === '' && element.paused));
});

test('the end-credits film holds the channel and hands it back to a fresh shuffled track', async () => {
  const { audio, context, media } = fixture();
  await audio.unlock();
  const song = media[0]; song.currentTime = 31;
  const initial = audio.status.nowPlaying;
  const film = new Media();
  const release = audio.attachFilm(film as unknown as HTMLMediaElement);
  assert.equal(audio.status.filmAttached, true);
  assert.equal(song.paused, true, 'the soundtrack pauses while the film plays');
  assert.equal(audio.status.musicPlaying, false); assert.equal(audio.status.musicState, 'paused');
  const filmSource = context.sources.find(source => source.media === film)!;
  assert.ok(filmSource, 'the film is routed through the menu graph');
  assert.equal(filmSource.connections.has(context.gains[3]), true);
  assert.equal(context.gains[3].connections.has(context.gains[0]), true, 'the film bus feeds Master');
  assert.equal(film.volume, 1, 'the graph owns loudness once routed');
  assert.deepEqual([audio.status.masterGain, audio.status.filmGain], [0.65, 0.35], 'Master and Music volume apply to the film');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false });
  assert.equal(audio.status.filmGain, 0, 'the Music switch mutes the film score');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, musicVolume: 80, volume: 50 });
  assert.deepEqual([audio.status.masterGain, audio.status.filmGain], [0.5, 0.8]);
  audio.setSuspended(true);
  assert.deepEqual([audio.status.masterGain, audio.status.filmGain], [0, 0], 'pause and hidden pages silence the film');
  audio.setSuspended(false);
  assert.equal(song.paused, true, 'resuming the menu does not restart the soundtrack under the film');
  release(); await settle();
  assert.equal(audio.status.filmAttached, false); assert.equal(filmSource.connections.size, 0);
  assert.equal(song.paused, true, 'the interrupted song stays stopped');
  assert.equal(media.length, 2); assert.equal(media.at(-1)!.currentTime, 0);
  assert.notEqual(audio.status.nowPlaying?.trackId, initial?.trackId);
  release();
  assert.equal(audio.status.filmAttached, false, 'a release is idempotent');
  const again = audio.attachFilm(film as unknown as HTMLMediaElement);
  assert.equal(context.sources.filter(source => source.media === film).length, 1, 'a remounted element reuses its one source node');
  assert.equal(filmSource.connections.has(context.gains[3]), true);
  again(); audio.dispose();
});

test('a film attached before the first gesture uses its element volume, then joins the graph on unlock', async () => {
  const { audio, context, media } = fixture();
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 50, musicVolume: 40 });
  const film = new Media();
  const release = audio.attachFilm(film as unknown as HTMLMediaElement);
  assert.equal(film.volume, 0.2, 'Master x Music applies before any graph exists');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false });
  assert.equal(film.volume, 0);
  audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES);
  await audio.unlock();
  assert.equal(media.length, 0, 'no soundtrack element starts under the film');
  assert.ok(context.sources.some(source => source.media === film));
  assert.equal(film.volume, 1);
  release(); await settle();
  assert.equal(media.length, 1); assert.equal(media[0].paused, false, 'the soundtrack starts once the film is released');
  const unsupported = new CrownfallMenuAudio({ createContext: () => null });
  const silent = new Media();
  unsupported.attachFilm(silent as unknown as HTMLMediaElement);
  assert.equal(silent.volume, .65 * .35, 'without WebAudio the element still follows the preferences');
  unsupported.dispose(); audio.dispose();
  assert.equal(audio.attachFilm(film as unknown as HTMLMediaElement)(), undefined, 'a disposed graph ignores films');
});

test('a narrated cinematic (the opening) follows Master volume only, before and after the first gesture', async () => {
  const { audio, media } = fixture();
  const film = new Media();
  const release = audio.attachFilm(film as unknown as HTMLMediaElement, 'cinematic');
  assert.equal(film.volume, .65, 'Master alone applies before any graph exists');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false, musicVolume: 0 });
  assert.equal(film.volume, .65, 'the Music switch and Music volume leave its voice alone');
  audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES);
  await audio.unlock();
  assert.equal(media.length, 0, 'no soundtrack element starts under the opening');
  assert.deepEqual([audio.status.masterGain, audio.status.filmGain], [0.65, 1], 'routed: the film bus is at unity under Master');
  audio.configure({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false });
  assert.equal(audio.status.filmGain, 1);
  audio.setSuspended(true);
  assert.deepEqual([audio.status.masterGain, audio.status.filmGain], [0, 0], 'pause and hidden pages silence it');
  audio.setSuspended(false);
  audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES);
  release(); await settle();
  assert.equal(media.length, 1); assert.equal(media[0].paused, false, 'the soundtrack starts once the opening is released');
  // The same element re-attached as a scored film follows Music again.
  const scored = audio.attachFilm(film as unknown as HTMLMediaElement, 'music');
  assert.equal(audio.status.filmGain, 0.35);
  scored(); audio.dispose();
});


test('returning from a cinematic starts a different shuffled track at zero', async () => {
  const { audio, media } = fixture();
  await audio.unlock(); await settle();
  const previous = audio.status.nowPlaying!; media[0].currentTime = 37;
  const movie = new Media();
  const release = audio.attachFilm(movie as unknown as HTMLMediaElement, 'cinematic');
  assert.equal(audio.status.musicPlaying, false);
  release(); await settle();
  assert.notEqual(audio.status.nowPlaying!.trackId, previous.trackId);
  assert.equal(audio.status.nowPlaying!.sequence, previous.sequence + 1);
  assert.equal(media.at(-1)!.currentTime, 0);
  release(); await settle(); assert.equal(audio.status.nowPlaying!.sequence, previous.sequence + 1);
  audio.dispose();
});

test('returning from gameplay rotates once while ordinary menu configuration does not', async () => {
  const { audio, media } = fixture(); await audio.unlock(); await settle();
  const previous = audio.status.nowPlaying!; media[0].currentTime = 42;
  audio.setSuspended(true); audio.setSuspended(true);
  audio.setSuspended(false); await settle();
  assert.notEqual(audio.status.nowPlaying!.trackId, previous.trackId);
  assert.equal(audio.status.nowPlaying!.sequence, previous.sequence + 1);
  const resumed = audio.status.nowPlaying!;
  audio.configure(DEFAULT_MENU_AUDIO_PREFERENCES); audio.setSuspended(false); await settle();
  assert.equal(audio.status.nowPlaying!.trackId, resumed.trackId);
  assert.equal(audio.status.nowPlaying!.sequence, resumed.sequence);
  audio.dispose();
});


test('startup cinematics do not consume the preferred opening track before any menu music played', async () => {
  const control = fixture(); await control.audio.unlock(); await settle(); const opener = control.audio.status.nowPlaying!.trackId; control.audio.dispose();
  const { audio, media } = fixture(); const movie = new Media();
  const release = audio.attachFilm(movie as unknown as HTMLMediaElement, 'cinematic');
  await audio.unlock(); await settle(); assert.equal(media.length, 0);
  release(); await settle(); assert.equal(audio.status.nowPlaying!.trackId, opener);
  assert.equal(audio.status.nowPlaying!.sequence, 1); audio.dispose();
});
test('overlapping cinematic and suspended states defer one fresh song until the menu is audible', async () => {
  const { audio, media } = fixture(); await audio.unlock(); await settle();
  const before = audio.status.nowPlaying!.sequence; const release = audio.attachFilm(new Media() as unknown as HTMLMediaElement);
  audio.setSuspended(true); release(); await settle(); assert.equal(media.length, 1);
  audio.setSuspended(false); await settle(); assert.equal(audio.status.nowPlaying!.sequence, before + 1);
  audio.setSuspended(false); await settle(); assert.equal(audio.status.nowPlaying!.sequence, before + 1); audio.dispose();
});


test('environment ambience borrows only an unlocked effects bus and preserves its owner and volume controls', async () => {
  const {audio,context,creations}=fixture();
  assert.equal(audio.effectsOutput(),null);assert.equal(creations(),0,'reading an output cannot create an autoplay context');
  assert.equal(await audio.unlock(),true);
  const output=audio.effectsOutput();assert.equal(output?.context,context);
  assert.equal(output?.destination,context.gains[2]);
  audio.configure({...DEFAULT_MENU_AUDIO_PREFERENCES,soundEffects:false});
  assert.equal(output?.destination.gain.value,0,'borrowed ambience follows the same effects mute');
  audio.setSuspended(true);assert.equal(audio.status.masterGain,0);
  audio.dispose();assert.equal(audio.effectsOutput(),null);
});
