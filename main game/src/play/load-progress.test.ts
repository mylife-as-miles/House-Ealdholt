import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoadProgress } from "./load-progress";

test("weighs each file by its bytes, guessed until the server gives its size (A-07)", () => {
  const seen: number[] = [];
  const progress = createLoadProgress((ratio) => seen.push(ratio));
  const big = progress.file("big.glb", 300), small = progress.file("small.exr", 100);
  big(150, 300);
  assert.equal(progress.ratio, 150 / 400);
  small(100, 100);
  assert.equal(progress.ratio, 250 / 400);
  progress.done("big.glb");
  assert.equal(progress.ratio, 1);
  // Steadily up, never back.
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test("never goes back when a file turns out larger than its guess, and counts a finished file whole", () => {
  const progress = createLoadProgress();
  const a = progress.file("a", 100), b = progress.file("b", 100);
  a(100, 100);
  assert.equal(progress.ratio, 0.5);
  // b is really 1000 bytes: the bar holds where it was rather than dropping to a tenth.
  b(10, 1000);
  assert.equal(progress.ratio, 0.5);
  b(900, 1000);
  assert.equal(progress.ratio, 1000 / 1100);
  // A size the server does not give (0) keeps the guess; a file that fails still counts whole once done.
  const c = progress.file("c", 100);
  c(50, 0);
  progress.done("c");
  progress.done("b");
  assert.equal(progress.ratio, 1);
});
