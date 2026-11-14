import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EALDHOLT_OPENING_SEEN_KEY, OPENING_FILMS, OPENING_FILM_CLOSED, OPENING_FILM_COPY, OPENING_SEEN_KEY, STORY_CINEMATIC_COPY,
  ealdholtFromLegacy, ealdholtOpeningClosed, ealdholtOpeningSeen, ealdholtOpeningShouldPlay, markEaldholtOpeningSeen, markOpeningSeen, openingAtStartup,
  openingFilmIsOpen, openingFilmIsStory, openingFilmPlayback, openingFilmRow, openingFilmStatus, openingSeen, openingStartupFinished, openingStartupSeen, prologueFinished,
  prologueFromChapters, reduceOpeningFilm, resolveOpeningFilm,
  type OpeningFilmEvent, type OpeningFilmState,
} from './opening-film';

const run = (events: OpeningFilmEvent[], from: OpeningFilmState = OPENING_FILM_CLOSED) => events.reduce(reduceOpeningFilm, from);

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.has(key) ? this.values.get(key)! : null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const refusing = { getItem(): string | null { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };

test('the first start plays the whole film, later starts the title sequence, reduced motion neither', () => {
  assert.equal(openingAtStartup({ seen: false, reducedMotion: false }), 'full');
  assert.equal(openingAtStartup({ seen: true, reducedMotion: false }), 'short');
  assert.equal(openingAtStartup({ seen: false, reducedMotion: true }), null);
  assert.equal(openingAtStartup({ seen: true, reducedMotion: true }), null);
});

test('the first start is remembered; storage that refuses counts as a first start', () => {
  const storage = new MemoryStorage();
  assert.equal(openingSeen(storage), false);
  assert.equal(markOpeningSeen(storage), true);
  assert.equal(openingSeen(storage), true);
  assert.equal(storage.getItem(OPENING_SEEN_KEY), OPENING_FILMS.full.id);
  assert.equal(openingSeen(refusing), false);
  assert.equal(markOpeningSeen(refusing), false);
  assert.equal(openingSeen(null), false);
  assert.equal(markOpeningSeen(undefined), false);
});

test('a startup with sound allowed starts at once; refused sound waits for a press that begins it', () => {
  const started = run([{ type: 'open', cut: 'full', origin: 'startup' }]);
  assert.deepEqual(started, { phase: 'starting', notice: null, sequence: 1, cut: 'full', origin: 'startup' });
  const waiting = reduceOpeningFilm(started, { type: 'blocked' });
  assert.equal(waiting.phase, 'waiting');
  assert.equal(openingFilmPlayback(waiting, false), 'hold');
  assert.equal(openingFilmStatus(waiting), '', 'the press prompt speaks for itself');
  const begun = reduceOpeningFilm(waiting, { type: 'begin' });
  assert.equal(begun.phase, 'starting');
  assert.equal(begun.sequence, 2, 'beginning is a new playthrough from the first frame');
  assert.equal(reduceOpeningFilm(begun, { type: 'playing' }).phase, 'playing');
  // Any select press while waiting begins rather than pausing.
  assert.equal(reduceOpeningFilm(waiting, { type: 'toggle' }).phase, 'starting');
});

test('a startup with no press yet can open straight into waiting', () => {
  const waiting = run([{ type: 'open', cut: 'short', origin: 'startup', awaitPress: true }]);
  assert.deepEqual(waiting, { phase: 'waiting', notice: null, sequence: 0, cut: 'short', origin: 'startup' });
  assert.equal(reduceOpeningFilm(waiting, { type: 'begin' }).sequence, 1);
  assert.equal(reduceOpeningFilm(waiting, { type: 'muted' }), waiting, 'a waiting film is silent by design, not muted');
  assert.equal(reduceOpeningFilm(waiting, { type: 'pause' }), waiting);
});

test('pause, resume, mute and failure follow the end-credits film rules', () => {
  const playing = run([{ type: 'open', cut: 'full', origin: 'credits' }, { type: 'playing' }]);
  const paused = reduceOpeningFilm(playing, { type: 'toggle' });
  assert.equal(paused.phase, 'paused');
  assert.equal(openingFilmPlayback(paused, false), 'pause');
  assert.equal(openingFilmStatus(paused), OPENING_FILM_COPY.status.paused);
  assert.equal(reduceOpeningFilm(paused, { type: 'toggle' }).phase, 'playing');
  const muted = reduceOpeningFilm(playing, { type: 'muted' });
  assert.equal(openingFilmStatus(muted), OPENING_FILM_COPY.status.muted);
  assert.equal(reduceOpeningFilm(reduceOpeningFilm(muted, { type: 'pause' }), { type: 'resume' }).notice, null, 'a trusted resume restores sound');
  assert.equal(openingFilmPlayback(playing, true), 'pause', 'hidden or obscured pauses it');
  const failed = reduceOpeningFilm(playing, { type: 'failed' });
  assert.deepEqual([failed.phase, failed.notice], ['closed', 'failed']);
  assert.equal(openingFilmStatus(failed), OPENING_FILM_COPY.status.failed);
  assert.equal(openingFilmPlayback(failed, false), 'stop');
});

test('a no-op returns the very same state', () => {
  assert.equal(reduceOpeningFilm(OPENING_FILM_CLOSED, { type: 'skip' }), OPENING_FILM_CLOSED);
  assert.equal(reduceOpeningFilm(OPENING_FILM_CLOSED, { type: 'begin' }), OPENING_FILM_CLOSED);
  assert.equal(reduceOpeningFilm(OPENING_FILM_CLOSED, { type: 'blocked' }), OPENING_FILM_CLOSED);
  const playing = run([{ type: 'open', cut: 'full', origin: 'startup' }, { type: 'playing' }]);
  assert.equal(reduceOpeningFilm(playing, { type: 'playing' }), playing);
  assert.equal(reduceOpeningFilm(playing, { type: 'blocked' }), playing, 'only a start can be blocked');
});

test('a startup opening finishes when it closes by any route; a replay from Credits does not count', () => {
  for (const end of ['skip', 'ended', 'failed'] as const) {
    const open = run([{ type: 'open', cut: 'full', origin: 'startup' }, { type: 'playing' }]);
    assert.equal(openingStartupFinished(open, reduceOpeningFilm(open, { type: end })), true, end);
  }
  const waiting = run([{ type: 'open', cut: 'full', origin: 'startup', awaitPress: true }]);
  assert.equal(openingStartupFinished(waiting, reduceOpeningFilm(waiting, { type: 'skip' })), true, 'skipping the press prompt also starts Crownfall');
  const replay = run([{ type: 'open', cut: 'full', origin: 'credits' }]);
  assert.equal(openingStartupFinished(replay, reduceOpeningFilm(replay, { type: 'ended' })), false);
  assert.equal(openingFilmIsOpen(OPENING_FILM_CLOSED), false);
});

test('a startup opening that could not play is not recorded as seen, and its failure stays readable once closed', () => {
  for (const end of ['skip', 'ended'] as const) {
    const open = run([{ type: 'open', cut: 'full', origin: 'startup' }, { type: 'playing' }]);
    assert.equal(openingStartupSeen(open, reduceOpeningFilm(open, { type: end })), true, end);
  }
  const waiting = run([{ type: 'open', cut: 'full', origin: 'startup', awaitPress: true }]);
  assert.equal(openingStartupSeen(waiting, reduceOpeningFilm(waiting, { type: 'skip' })), true, 'skipping the press prompt is a start');
  const starting = run([{ type: 'open', cut: 'full', origin: 'startup' }]);
  const failed = reduceOpeningFilm(starting, { type: 'failed' });
  assert.equal(openingStartupFinished(starting, failed), true, 'the film has closed');
  assert.equal(openingStartupSeen(starting, failed), false, 'the next start tries the whole film again');
  assert.equal(openingFilmStatus(failed), OPENING_FILM_COPY.status.failed, 'the closed film still names its failure for the menu to show');
  const replay = run([{ type: 'open', cut: 'full', origin: 'credits' }]);
  assert.equal(openingStartupSeen(replay, reduceOpeningFilm(replay, { type: 'ended' })), false);
});

test('both cuts resolve under the deployment path; the replay row is shared copy', () => {
  assert.equal(resolveOpeningFilm('full', 'https://example.test/crownfall/?x=1#y'), 'https://example.test/crownfall/video/crownfall-opening.mp4');
  assert.equal(resolveOpeningFilm('short', 'https://example.test/crownfall'), 'https://example.test/crownfall/video/crownfall-opening-titles.mp4');
  assert.notEqual(OPENING_FILMS.full.src, OPENING_FILMS.short.src);
  const row = openingFilmRow({ reducedMotion: false });
  assert.deepEqual([row.id, row.label, row.value], ['play-opening', 'Play the opening', 'Play']);
  assert.ok(openingFilmRow({ reducedMotion: true }).description.endsWith(OPENING_FILM_COPY.row.reducedMotion));
});

test('the Prologue entry plays the prologue from Chapters at once, and closing it is not a start', () => {
  const event = prologueFromChapters();
  assert.deepEqual(event, { type: 'open', cut: 'prologue', origin: 'chapters' });
  const open = reduceOpeningFilm(OPENING_FILM_CLOSED, event);
  assert.deepEqual([open.phase, open.cut, open.origin], ['starting', 'prologue', 'chapters'], 'the tile press is its gesture: no waiting');
  const playing = reduceOpeningFilm(open, { type: 'playing' });
  for (const end of ['skip', 'ended', 'failed'] as const) {
    assert.equal(openingStartupFinished(playing, reduceOpeningFilm(playing, { type: end })), false, end);
  }
  assert.equal(resolveOpeningFilm('prologue', 'https://example.test/crownfall/'), 'https://example.test/crownfall/video/crownfall-prologue.mp4');
  assert.equal(OPENING_FILMS.prologue.cut, 'prologue');
  assert.notEqual(OPENING_FILMS.prologue.src, OPENING_FILMS.full.src);
});

test('every film has its own title, accessible name, description and byline', () => {
  for (const cut of ['full', 'short', 'prologue', 'ealdholt'] as const) {
    for (const field of ['titles', 'accessibleName', 'description', 'bylines'] as const) assert.ok(OPENING_FILM_COPY[field][cut], `${field}.${cut}`);
  }
  assert.match(OPENING_FILM_COPY.titles.prologue, /Prologue/);
  assert.match(OPENING_FILM_COPY.accessibleName.prologue, /The Name They Buried/);
  assert.match(OPENING_FILM_COPY.bylines.prologue, /Krom Shahid/);
  assert.doesNotMatch(OPENING_FILM_COPY.status.starting, /opening/i, 'status lines serve every film');
  assert.equal(OPENING_FILM_COPY.titles.ealdholt, 'House Ealdholt');
  assert.match(OPENING_FILM_COPY.description.ealdholt, /House Ealdholt title/);
  assert.deepEqual(Object.keys(OPENING_FILMS), ['full', 'short', 'prologue', 'ealdholt']);
});

test('the House Ealdholt opening is its own thirty-second film and plays as a story cinematic', () => {
  const film = OPENING_FILMS.ealdholt;
  assert.deepEqual([film.id, film.cut, film.src, film.width, film.height, film.framesPerSecond, film.durationSeconds],
    ['crownfall-ealdholt-opening', 'ealdholt', 'video/crownfall-ealdholt-opening.mp4', 1280, 720, 30, 30]);
  assert.match(film.sha256, /^[0-9a-f]{64}$/);
  assert.ok(film.bytes > 0);
  assert.equal(resolveOpeningFilm('ealdholt', 'https://example.test/crownfall/'), 'https://example.test/crownfall/video/crownfall-ealdholt-opening.mp4');
  assert.deepEqual((['full', 'short', 'prologue', 'ealdholt'] as const).map(openingFilmIsStory), [false, false, true, true]);
  assert.equal(STORY_CINEMATIC_COPY.skip, 'Skip cinematic');
});

test('the House Ealdholt opening is remembered under its own key, apart from the first start', () => {
  const storage = new MemoryStorage();
  assert.equal(EALDHOLT_OPENING_SEEN_KEY, 'crownfall.legacy.ealdholt-opening.seen.v1');
  assert.equal(ealdholtOpeningSeen(storage), false);
  markOpeningSeen(storage);
  assert.equal(ealdholtOpeningSeen(storage), false, 'starting Crownfall is not entering My Legacy');
  assert.equal(markEaldholtOpeningSeen(storage), true);
  assert.equal(ealdholtOpeningSeen(storage), true);
  assert.equal(storage.getItem(EALDHOLT_OPENING_SEEN_KEY), OPENING_FILMS.ealdholt.id);
  assert.equal(new MemoryStorage().getItem(OPENING_SEEN_KEY), null);
  assert.equal(ealdholtOpeningSeen(refusing), false);
  assert.equal(markEaldholtOpeningSeen(refusing), false);
  assert.equal(ealdholtOpeningSeen(null), false);
  assert.equal(markEaldholtOpeningSeen(undefined), false);
});

test('the House Ealdholt opening plays once: not when seen, not with reduced motion, and under automation only when asked', () => {
  const first = { seen: false, reducedMotion: false, automated: false, search: '' };
  assert.equal(ealdholtOpeningShouldPlay(first), true);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, seen: true }), false);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, reducedMotion: true }), false);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true }), false);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true, search: '?opening=legacy' }), true);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true, search: '?ealdholt-house=1&opening=legacy' }), true);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true, search: '?opening=match' }), false, "the match opening's override is not this film's");
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true, search: '?opening=legacy', seen: true }), false, 'the override never replays a seen film');
  assert.equal(ealdholtOpeningShouldPlay({ ...first, automated: true, search: '?opening=legacy', reducedMotion: true }), false);
  assert.equal(ealdholtOpeningShouldPlay({ ...first, search: '?opening=match' }), true, 'a player is not automation');
});

test('the My Legacy tile plays the film at once; ended and skipped count as shown, a failure does not', () => {
  const event = ealdholtFromLegacy();
  assert.deepEqual(event, { type: 'open', cut: 'ealdholt', origin: 'legacy' });
  const open = reduceOpeningFilm(OPENING_FILM_CLOSED, event);
  assert.deepEqual([open.phase, open.cut, open.origin], ['starting', 'ealdholt', 'legacy'], 'the tile press is its gesture: no waiting');
  const playing = reduceOpeningFilm(open, { type: 'playing' });
  assert.equal(ealdholtOpeningClosed(OPENING_FILM_CLOSED, open), null, 'opening is not closing');
  assert.equal(ealdholtOpeningClosed(open, playing), null);
  assert.equal(ealdholtOpeningClosed(playing, reduceOpeningFilm(playing, { type: 'ended' })), 'ended');
  assert.equal(ealdholtOpeningClosed(playing, reduceOpeningFilm(playing, { type: 'skip' })), 'skipped');
  assert.equal(ealdholtOpeningClosed(open, reduceOpeningFilm(open, { type: 'skip' })), 'skipped', 'skipping before the first frame also counts');
  assert.equal(ealdholtOpeningClosed(playing, reduceOpeningFilm(playing, { type: 'failed' })), 'failed');
  const paused = reduceOpeningFilm(playing, { type: 'toggle' });
  assert.equal(paused.phase, 'paused');
  assert.equal(ealdholtOpeningClosed(paused, reduceOpeningFilm(paused, { type: 'skip' })), 'skipped');
  const closed = reduceOpeningFilm(playing, { type: 'skip' });
  assert.equal(ealdholtOpeningClosed(closed, closed), null, 'reported once, as it closes');
  for (const end of ['skip', 'ended', 'failed'] as const) {
    const next = reduceOpeningFilm(playing, { type: end });
    assert.equal(openingStartupFinished(playing, next), false, `${end} is not a start`);
    assert.equal(prologueFinished(playing, next), false, `${end} unlocks no chapter`);
  }
  // No other film reports as this one.
  const prologue = run([prologueFromChapters(), { type: 'playing' }]);
  assert.equal(ealdholtOpeningClosed(prologue, reduceOpeningFilm(prologue, { type: 'ended' })), null);
  const startup = run([{ type: 'open', cut: 'full', origin: 'startup' }, { type: 'playing' }]);
  assert.equal(ealdholtOpeningClosed(startup, reduceOpeningFilm(startup, { type: 'skip' })), null);
});
