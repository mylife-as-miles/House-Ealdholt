import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MENU_AUDIO_PREFERENCES } from './audio';
import {
  CREDITS_FILM, CREDITS_FILM_CLOSED, CREDITS_FILM_COPY, creditsEntry, creditsFilmGain, creditsFilmIsOpen,
  creditsFilmPlayback, creditsFilmRow, creditsFilmStatus, reduceCreditsFilm, resolveCreditsFilm,
  type CreditsFilmEvent, type CreditsFilmState,
} from './credits-film';
import { SETTINGS_CATEGORIES } from './content';

const run = (...events: CreditsFilmEvent['type'][]): CreditsFilmState =>
  events.reduce<CreditsFilmState>((state, type) => reduceCreditsFilm(state, { type } as CreditsFilmEvent), CREDITS_FILM_CLOSED);

test('the film record describes the supplied web encode and resolves under each deployment base', () => {
  assert.equal(CREDITS_FILM.src, 'video/crownfall-end-credits.mp4');
  assert.deepEqual([CREDITS_FILM.width, CREDITS_FILM.height, CREDITS_FILM.framesPerSecond], [1920, 1080, 24]);
  assert.equal(CREDITS_FILM.bytes, 7606715);
  assert.match(CREDITS_FILM.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(CREDITS_FILM.durationSeconds - 182.25) < .01);
  assert.equal(resolveCreditsFilm('https://example.test/crownfall/?model=none#x'), 'https://example.test/crownfall/video/crownfall-end-credits.mp4');
  assert.equal(resolveCreditsFilm('https://example.test/quest'), 'https://example.test/quest/video/crownfall-end-credits.mp4');
  assert.ok(SETTINGS_CATEGORIES.includes('credits'), 'Credits stays a Settings category on both menus');
});

test('opening plays from starting to playing; pause, toggle and resume never close the film', () => {
  const opened = reduceCreditsFilm(CREDITS_FILM_CLOSED, { type: 'open' });
  assert.deepEqual(opened, { phase: 'starting', notice: null, sequence: 1 });
  assert.equal(creditsFilmIsOpen(opened), true);
  assert.equal(run('open', 'playing').phase, 'playing');
  assert.equal(run('open', 'toggle').phase, 'paused', 'a press before the first frame still pauses');
  assert.equal(run('open', 'playing', 'toggle').phase, 'paused');
  assert.equal(run('open', 'playing', 'toggle', 'toggle').phase, 'playing');
  assert.equal(run('open', 'playing', 'pause', 'resume').phase, 'playing');
  const paused = run('open', 'playing', 'pause');
  assert.equal(reduceCreditsFilm(paused, { type: 'playing' }), paused, 'a late playing event cannot override Pause');
  assert.equal(reduceCreditsFilm(paused, { type: 'pause' }), paused);
  const playing = run('open', 'playing');
  assert.equal(reduceCreditsFilm(playing, { type: 'resume' }), playing);
});

test('skip and the natural end return to the notices; a failure returns there with a notice', () => {
  for (const type of ['skip', 'ended'] as const) {
    assert.deepEqual(run('open', 'playing', type), { phase: 'closed', notice: null, sequence: 1 });
    assert.deepEqual(run('open', type), { phase: 'closed', notice: null, sequence: 1 });
    assert.deepEqual(run('open', 'playing', 'pause', type), { phase: 'closed', notice: null, sequence: 1 });
  }
  const failed = run('open', 'failed');
  assert.deepEqual(failed, { phase: 'closed', notice: 'failed', sequence: 1 });
  assert.equal(creditsFilmStatus(failed), CREDITS_FILM_COPY.status.failed);
  assert.deepEqual(run('open', 'failed', 'open'), { phase: 'starting', notice: null, sequence: 2 }, 'playing again clears the notice');
  for (const type of ['playing', 'toggle', 'pause', 'resume', 'skip', 'ended', 'failed', 'muted'] as const) {
    assert.equal(reduceCreditsFilm(CREDITS_FILM_CLOSED, { type }), CREDITS_FILM_CLOSED, `${type} is a no-op while closed`);
  }
});

test('refused sound keeps the film playing silently until a trusted resume', () => {
  const muted = run('open', 'muted', 'playing');
  assert.deepEqual(muted, { phase: 'playing', notice: 'muted', sequence: 1 });
  assert.equal(reduceCreditsFilm(muted, { type: 'muted' }), muted);
  assert.equal(creditsFilmStatus(muted), CREDITS_FILM_COPY.status.muted);
  assert.equal(run('open', 'muted', 'playing', 'toggle').notice, 'muted', 'pausing keeps the notice');
  assert.equal(run('open', 'muted', 'playing', 'toggle', 'toggle').notice, null, 'resuming in a press restores sound');
});

test('reduced motion opens the notices page instead of autoplaying', () => {
  assert.equal(creditsEntry({ reducedMotion: false }), 'film');
  assert.equal(creditsEntry({ reducedMotion: true }), 'notices');
  const row = creditsFilmRow({ reducedMotion: false });
  assert.deepEqual([row.id, row.label, row.value], ['play-credits', 'Play end credits', 'Play']);
  assert.match(row.description, /Osita Miles/);
  assert.match(row.description, /Sanguis et Terra/);
  assert.ok(creditsFilmRow({ reducedMotion: true }).description.endsWith(CREDITS_FILM_COPY.row.reducedMotion));
});

test('playback follows the film phase and any blocking pause, hidden page or modal', () => {
  assert.equal(creditsFilmPlayback(CREDITS_FILM_CLOSED, false), 'stop');
  assert.equal(creditsFilmPlayback(run('open'), false), 'play');
  assert.equal(creditsFilmPlayback(run('open', 'playing'), false), 'play');
  assert.equal(creditsFilmPlayback(run('open', 'playing'), true), 'pause');
  assert.equal(creditsFilmPlayback(run('open', 'playing', 'pause'), false), 'pause');
  assert.equal(creditsFilmStatus(run('open')), CREDITS_FILM_COPY.status.starting);
  assert.equal(creditsFilmStatus(run('open', 'playing')), '');
  assert.equal(creditsFilmStatus(run('open', 'playing', 'pause')), CREDITS_FILM_COPY.status.paused);
  assert.equal(creditsFilmStatus(CREDITS_FILM_CLOSED), '');
});

test('the film score follows Master, Music volume and the Music switch', () => {
  assert.equal(creditsFilmGain(DEFAULT_MENU_AUDIO_PREFERENCES), .65 * .35);
  assert.equal(creditsFilmGain({ ...DEFAULT_MENU_AUDIO_PREFERENCES, music: false }), 0);
  assert.equal(creditsFilmGain({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 0 }), 0);
  assert.equal(creditsFilmGain({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 100, musicVolume: 100 }), 1);
  assert.equal(creditsFilmGain({ ...DEFAULT_MENU_AUDIO_PREFERENCES, volume: 500, musicVolume: 50 }), .5, 'malformed values clamp');
});

test('film copy names the creator, the studio mark and accessible labels', () => {
  assert.match(CREDITS_FILM_COPY.description, /Project EON/);
  assert.match(CREDITS_FILM_COPY.description, /Crownfall: Aethelgard/);
  assert.match(CREDITS_FILM_COPY.byline, /Osita Miles/);
  assert.ok(CREDITS_FILM_COPY.accessibleName.length > 0);
  for (const value of Object.values(CREDITS_FILM_COPY.status)) assert.match(value, /^[\x20-\x7e]+$/, 'status lines render in the Quest ASCII atlas');
  assert.match(CREDITS_FILM_COPY.questHint, /^[\x20-\x7e]+$/);
  assert.match(CREDITS_FILM_COPY.row.description, /^[\x20-\x7e]+$/);
});

test('the Quest plays a 720p encode of the same cut, recorded beside the original', async () => {
  const { CREDITS_FILM_QUEST } = await import('./credits-film');
  const { QUEST_CREDITS_FILM_PATH } = await import('./derived-assets');
  assert.equal(CREDITS_FILM_QUEST.src, QUEST_CREDITS_FILM_PATH);
  assert.deepEqual([CREDITS_FILM_QUEST.width, CREDITS_FILM_QUEST.height, CREDITS_FILM_QUEST.framesPerSecond], [1280, 720, 24]);
  assert.ok(Math.abs(CREDITS_FILM_QUEST.durationSeconds - CREDITS_FILM.durationSeconds) < 0.05, 'same cut, same length');
  assert.equal(CREDITS_FILM_QUEST.sourceSha256, CREDITS_FILM.sha256);
  assert.match(CREDITS_FILM_QUEST.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(CREDITS_FILM_QUEST.sha256, CREDITS_FILM.sha256);
});
