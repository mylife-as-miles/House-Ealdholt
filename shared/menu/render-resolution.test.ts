import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRenderTimestamp, scaledPixelRatio, type FrameLimit } from './render-resolution';

/** Frames drawn in one second of a display refreshing at `hz` under a cap, as every renderer's loop asks. */
function drawnInOneSecond(hz: number, limit: FrameLimit): number {
  let previous = 0, drawn = 0;
  for (let frame = 1; frame <= hz; frame++) {
    const at = nextRenderTimestamp(frame * 1000 / hz, previous, limit);
    if (at === null) continue;
    previous = at; drawn++;
  }
  return drawn;
}

test('a frame limit holds a fast display to the chosen rate; none draws every frame (A-09)', () => {
  assert.equal(drawnInOneSecond(144, 0), 144);
  assert.ok(Math.abs(drawnInOneSecond(144, 60) - 60) <= 2, String(drawnInOneSecond(144, 60)));
  assert.ok(Math.abs(drawnInOneSecond(144, 30) - 30) <= 1, String(drawnInOneSecond(144, 30)));
  assert.equal(drawnInOneSecond(60, 60), 60, 'a 60 Hz display under a 60 cap loses no frame to timestamp jitter');
  assert.equal(drawnInOneSecond(60, 120), 60);
});

test('the render scale is bounded and the device ratio capped at 1.5', () => {
  assert.equal(scaledPixelRatio(3, 100), 1.5);
  assert.equal(scaledPixelRatio(1, 10), 0.5);
  assert.equal(scaledPixelRatio(2, Number.NaN), 1.5);
});
