import { storyChapters, completePrologue, EMPTY_STORY_PROGRESS } from './story-progress';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAPTERS, getModalContent } from './content';
import { OPENING_FILM_CLOSED, prologueFinished, prologueFromChapters, reduceOpeningFilm } from './opening-film';
import { usesInkReveal, inkSpread, INK_REVEAL } from './ink-transition';

test('Chapter One introduces the canonical title as Coming soon; every later chapter is locked', () => {
  const first = storyChapters(completePrologue(EMPTY_STORY_PROGRESS, '2026-11-11T12:00:00Z')).find(c => c.id === 'chapter-01')!;
  assert.equal(first.locked, false); assert.equal(first.status, 'coming-soon');
  assert.equal(getModalContent('chapter-preview', first).description, 'The Pawn Who Would Not Die');
  assert.equal(getModalContent('chapter-preview', first).note, 'Coming soon');
  assert.ok(CHAPTERS.filter(c => c.id !== 'prologue' && c.id !== first.id).every(c => c.locked && !c.previewable));
});
test('only a naturally ended story Prologue introduces Chapter One', () => {
  const story = reduceOpeningFilm(OPENING_FILM_CLOSED, prologueFromChapters());
  for (const type of ['ended'] as const) assert.equal(prologueFinished(story, reduceOpeningFilm(story, { type })), true);
  for (const type of ['skip', 'pause', 'failed'] as const) assert.equal(prologueFinished(story, reduceOpeningFilm(story, { type })), false);
  const start = reduceOpeningFilm(OPENING_FILM_CLOSED, { type: 'open', cut: 'full', origin: 'startup' });
  assert.equal(prologueFinished(start, reduceOpeningFilm(start, { type: 'ended' })), false);
});
test('the ink reveal is scoped to Chapters, Chronicles and the story introduction', () => {
  for (const view of ['chapters', 'chronicles', 'chapter-preview']) assert.equal(usesInkReveal(view), true);
  for (const view of ['home', 'play', 'settings', 'showcase', 'match']) assert.equal(usesInkReveal(view), false);
});

test('the ink reveal reaches a fully open frame monotonically and clamps late frames', () => {
  assert.equal(inkSpread(-1), 0); assert.equal(inkSpread(2), INK_REVEAL.finalScale);
  let previous = 0;
  for (let i = 0; i <= 100; i++) { const next = inkSpread(i / 100); assert.ok(next >= previous); previous = next; }
});
