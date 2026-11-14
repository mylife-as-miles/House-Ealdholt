import assert from "node:assert/strict";
import test from "node:test";
import { consumeNowPlayingSequence } from "./now-playing-state";

test("an actual new eligible start announces once; navigation and metadata updates do not repeat it", () => {
  const started = Object.freeze({ sequence: 1, playing: true });
  const first = consumeNowPlayingSequence(null, started, true);
  assert.deepEqual(first, { seenSequence: 1, show: true });
  assert.deepEqual(consumeNowPlayingSequence(first.seenSequence, { ...started }, true), { seenSequence: 1, show: false });
  assert.deepEqual(consumeNowPlayingSequence(1, { sequence: 2, playing: true }, true), { seenSequence: 2, show: true });
  assert.deepEqual(started, { sequence: 1, playing: true });
});

test("a start first observed paused is consumed before resume can become eligible", () => {
  const paused = consumeNowPlayingSequence(null, { sequence: 1, playing: false }, false);
  assert.deepEqual(paused, { seenSequence: 1, show: false });
  assert.deepEqual(consumeNowPlayingSequence(paused.seenSequence, { sequence: 1, playing: true }, true), { seenSequence: 1, show: false });
});

test("hidden or blocked batched starts never reappear after the surface returns", () => {
  for (const playing of [false, true]) {
    const hidden = consumeNowPlayingSequence(1, { sequence: 2, playing }, false);
    assert.deepEqual(hidden, { seenSequence: 2, show: false });
    assert.deepEqual(consumeNowPlayingSequence(hidden.seenSequence, { sequence: 2, playing: true }, true), { seenSequence: 2, show: false });
  }
});

test("loading without an audible sequence consumes nothing, while a muted observed start is consumed", () => {
  assert.deepEqual(consumeNowPlayingSequence(1, null, false), { seenSequence: 1, show: false });
  const muted = consumeNowPlayingSequence(1, { sequence: 2, playing: false }, true);
  assert.deepEqual(muted, { seenSequence: 2, show: false });
  assert.deepEqual(consumeNowPlayingSequence(muted.seenSequence, { sequence: 2, playing: true }, true), { seenSequence: 2, show: false });
  assert.deepEqual(consumeNowPlayingSequence(2, { sequence: 3, playing: true }, true), { seenSequence: 3, show: true });
});
