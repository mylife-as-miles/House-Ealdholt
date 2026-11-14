import assert from 'node:assert/strict';
import test from 'node:test';
import { ATLAS_BOOK, atlasBookInteractive, atlasBookParts, createAtlasBookState, dragAtlasBook, releaseAtlasBook, setAtlasBookOpen, stepAtlasBook } from './book';

test('opening is a simulated hinge with flexible pages, and settles on the original flat spread', () => {
  const state = createAtlasBookState(); let bent = false, moving = false;
  assert.equal(state.angle, -Math.PI); assert.equal(atlasBookInteractive(state), false);
  for (let i = 0; i < 600; i++) {
    stepAtlasBook(state, 1 / 120); bent ||= state.curl > .02; moving ||= state.angle > -3 && state.angle < -.2;
    assert.ok(state.angle >= -Math.PI && state.angle <= 0);
    assert.ok([...state.curve, state.angle, state.velocity].every(Number.isFinite));
  }
  assert.ok(moving && bent, 'the cover moves and the leaf flexes before settling');
  assert.equal(state.settled, true); assert.equal(atlasBookInteractive(state), true); assert.equal(state.relief, 1);
  assert.ok(Math.abs(state.curve.at(-3)! + .5) < 1e-6); assert.equal(state.curve.at(-2), 0);
});

test('the opening lifts deliberately instead of snapping through its readable motion', () => {
  const state = createAtlasBookState(); let first = 0, last = 0;
  for (let i = 0; i < 600; i++) {
    stepAtlasBook(state, ATLAS_BOOK.step);
    const progress = 1 + state.angle / Math.PI;
    if (!first && progress >= .1) first = i * ATLAS_BOOK.step;
    if (!last && progress >= .9) last = i * ATLAS_BOOK.step;
  }
  assert.ok(last - first >= .8 && last - first < 1.5, 'the main lift takes about a second');
  assert.ok(state.settled, 'the slower hinge still comes to rest');
});
test('reversal and a released drag retain angular momentum instead of restarting a tween', () => {
  const state = createAtlasBookState(true); setAtlasBookOpen(state, false);
  for (let i = 0; i < 12; i++) stepAtlasBook(state, ATLAS_BOOK.step);
  const [angle, velocity] = [state.angle, state.velocity]; setAtlasBookOpen(state, true);
  assert.equal(state.angle, angle); assert.equal(state.velocity, velocity);
  dragAtlasBook(state, -2.1, .05); dragAtlasBook(state, -1.7, .05); releaseAtlasBook(state);
  assert.equal(state.goal, 0); assert.ok(state.velocity > 0);
  for (let i = 0; i < 600; i++) stepAtlasBook(state, ATLAS_BOOK.step);
  assert.equal(atlasBookInteractive(state), true);
});
test('reduced motion snaps safely, and a delayed tab cannot inject an unbounded physics step', () => {
  const state = createAtlasBookState(); stepAtlasBook(state, 1 / 60, true);
  assert.equal(atlasBookInteractive(state), true); assert.equal(state.curl, 0);
  setAtlasBookOpen(state, false, true); assert.equal(state.angle, -Math.PI); assert.equal(state.settled, true);
  setAtlasBookOpen(state, true); stepAtlasBook(state, 1000);
  assert.ok(state.angle < 0 && state.angle > -Math.PI); assert.ok(Number.isFinite(state.velocity));
  const old = state.angle; stepAtlasBook(state, NaN); assert.equal(state.angle, old);
});
test('the shared book model has paired covers, a spine and nine actual page layers per side', () => {
  const parts = atlasBookParts(.7466);
  for (const side of ['left', 'right']) assert.equal(parts.filter(p => p.side === side && p.family === 'paper').length, 9);
  assert.ok(parts.some(p => p.side === 'spine'));
  assert.ok(parts.filter(p => p.family === 'paper').every(p => p.at[1] + p.size[1] / 2 < -.012), 'paper stays below the map sea beds');
  assert.ok(parts.every(p => [...p.at, ...p.size, p.yaw].every(Number.isFinite) && p.size.every(n => n > 0)));
});
