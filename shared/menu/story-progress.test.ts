import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_STORY_PROGRESS, STORY_PROGRESS_KEY, completePrologue, hasWatchedPrologue, normalizeStoryProgress, readStoryProgress, saveStoryProgress, storyChapters } from './story-progress';
import { OPENING_FILM_CLOSED, prologueFinished, prologueFromChapters, reduceOpeningFilm } from './opening-film';
const at = '2026-11-11T12:00:00.000Z';
class Storage { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }

test('a fresh or corrupt save locks Chapter One with no Coming soon caption', () => {
  for (const value of [null, {}, { version: 99, prologue: { state: 'completed', completedAt: at } }, { version: 1, prologue: { state: 'completed', completedAt: 'broken' } }]) {
    const progress = normalizeStoryProgress(value), first = storyChapters(progress)[1];
    assert.equal(first.locked, true); assert.equal(first.previewable, false); assert.equal(first.status, undefined);
  }
});
test('a naturally ended Prologue unlocks only Chapter One and survives save/rehydration', () => {
  const before = reduceOpeningFilm(OPENING_FILM_CLOSED, prologueFromChapters());
  const after = reduceOpeningFilm(before, { type: 'ended' }); assert.equal(prologueFinished(before, after), true);
  const progress = completePrologue(EMPTY_STORY_PROGRESS, at), storage = new Storage();
  storage.setItem('crownfall.main-game.save', 'untouched'); storage.setItem('crownfall.opening.seen', 'untouched');
  assert.equal(saveStoryProgress(progress, storage), true);
  const restored = readStoryProgress(storage); assert.equal(hasWatchedPrologue(restored), true);
  const chapters = storyChapters(restored); assert.equal(chapters[1].locked, false); assert.equal(chapters[1].status, 'coming-soon');
  assert.ok(chapters.slice(2).every(chapter => chapter.locked));
  assert.equal(storage.getItem('crownfall.main-game.save'), 'untouched'); assert.equal(storage.getItem('crownfall.opening.seen'), 'untouched');
  assert.ok(storage.getItem(STORY_PROGRESS_KEY));
});
test('skip, failed load, pause and the separate startup film cannot unlock the story', () => {
  const story = reduceOpeningFilm(OPENING_FILM_CLOSED, prologueFromChapters());
  for (const type of ['skip', 'failed', 'pause'] as const) assert.equal(prologueFinished(story, reduceOpeningFilm(story, { type })), false);
  const launch = reduceOpeningFilm(OPENING_FILM_CLOSED, { type: 'open', cut: 'full', origin: 'startup' });
  assert.equal(prologueFinished(launch, reduceOpeningFilm(launch, { type: 'ended' })), false);
});
test('replays preserve the original completion and unavailable storage never throws', () => {
  const completed = completePrologue(EMPTY_STORY_PROGRESS, at); assert.equal(completePrologue(completed, '2027-01-01'), completed);
  assert.equal(saveStoryProgress(completed, null), false);
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(hasWatchedPrologue(readStoryProgress(unavailable)), false); assert.equal(saveStoryProgress(completed, unavailable), false);
});
