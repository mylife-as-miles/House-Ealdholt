import assert from 'node:assert/strict';
import test from 'node:test';
import { MOVE_SECONDS } from './catalog';
import { recordFromPGN } from './records';
import { ShowcaseSession } from './session';

const OPENING = '[Event "Test exhibition"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';

test('a cinematic stage paces the timeline: the timer leaves it alone, the stage reaches each move and ends it', async () => {
  const session = new ShowcaseSession({ storage: null });
  await session.load(recordFromPGN(OPENING, { id: 'cinematic', createdAt: '2026-01-01T00:00:00Z' }));
  session.setCinematic(true);
  session.play();
  session.update(MOVE_SECONDS * 3);
  assert.equal(session.snapshot.ply, 0, 'the timer does not advance a cinematic replay');
  session.reach(1); session.reach(2);
  assert.equal(session.snapshot.ply, 2); assert.equal(session.snapshot.playing, true);
  // Seeking a playing replay plays on from there; the procedural viewer's seek still pauses.
  session.seek(4, true);
  assert.equal(session.snapshot.ply, 4); assert.equal(session.snapshot.playing, true);
  session.reach(6);
  assert.equal(session.snapshot.ended, false, 'the last move and the ending are still being shown');
  session.finishPlayback();
  assert.equal(session.snapshot.playing, false); assert.equal(session.snapshot.ended, true);
  session.play();
  assert.equal(session.snapshot.ply, 0, 'played again from the start'); assert.equal(session.snapshot.playing, true);
  session.seek(3);
  assert.equal(session.snapshot.playing, false, 'a plain seek pauses');
  // Handed back, the timer paces the timeline again.
  session.setCinematic(false); session.play();
  // A delayed frame advances at most a quarter second: the timer's own pacing.
  for (let elapsed = 0; elapsed < MOVE_SECONDS + .1; elapsed += .25) session.update(.25);
  assert.equal(session.snapshot.ply, 4);
  session.dispose();
});
