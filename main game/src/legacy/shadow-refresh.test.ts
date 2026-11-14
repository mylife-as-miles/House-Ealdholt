import assert from "node:assert/strict";
import test from "node:test";
import { ShadowRefresh } from "./shadow-refresh";

const run = (refresh: ShadowRefresh, moving: readonly boolean[]) => moving.map((value) => refresh.frame(value));

test("a still scene draws its shadows once, then never again", () => {
  const refresh = new ShadowRefresh();
  assert.deepEqual(run(refresh, [false, false, false, false]), [true, false, false, false]);
  assert.equal(refresh.owed, false);
  assert.deepEqual(refresh.counts(), { frames: 4, redraws: 1 });
});

test("a one-off change redraws on the next frame", () => {
  const refresh = new ShadowRefresh();
  run(refresh, [false]);
  refresh.invalidate();
  assert.deepEqual(run(refresh, [false, false]), [true, false]);
});

test("continuous motion redraws every other frame and settles once it stops", () => {
  const refresh = new ShadowRefresh();
  run(refresh, [false]);
  assert.deepEqual(run(refresh, [true, true, true, true, true, true]), [false, true, false, true, false, true]);
  // Motion stopped right after a skipped redraw: the skip is made up on the next frame.
  assert.deepEqual(run(refresh, [true, false, false]), [false, true, false]);
  assert.equal(refresh.owed, false);
});

test("an on-demand renderer that draws while shadows are owed ends with current shadows", () => {
  const refresh = new ShadowRefresh();
  run(refresh, [false]);
  // One camera nudge: the first frame skips, so the renderer must draw one more.
  assert.equal(refresh.frame(true), false);
  assert.equal(refresh.owed, true);
  assert.equal(refresh.frame(true), true);
  assert.equal(refresh.owed, false);
});
