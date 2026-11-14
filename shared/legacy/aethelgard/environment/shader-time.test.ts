import assert from 'node:assert/strict';
import test from 'node:test';
import {createShaderTime} from './shader-time';

test('a thirty-day-old save animates shaders as smoothly as a new one', () => {
  for (const age of [0, 7 * 86400, 30 * 86400, 365 * 86400]) {
    const clock = createShaderTime(), start = age + 1234.5;
    let previous = Math.fround(clock.seconds(start));
    for (let frame = 1; frame <= 600; frame++) {
      const uniform = Math.fround(clock.seconds(start + frame / 60)), step = uniform - previous;
      assert.ok(Math.abs(step - 1 / 60) < 1e-3, `age ${age}: frame step ${step} must stay close to 1/60 s`);
      previous = uniform;
    }
    assert.ok(previous < 3600 + 20, 'shader time stays near the hour-aligned epoch');
  }
  // The raw save-age float freezes between frames at thirty days and moves in 0.25 s steps.
  assert.equal(Math.fround(30 * 86400 + 1 / 60) - Math.fround(30 * 86400), 0);
  assert.equal(Math.fround(30 * 86400 + .2) - Math.fround(30 * 86400), .25);
});

test('reduced motion stays at zero; long sessions and rewinds rebase once', () => {
  const clock = createShaderTime(100);
  assert.equal(clock.seconds(0), 0); assert.equal(clock.seconds(Number.NaN), 0);
  assert.equal(clock.seconds(7230), 30); assert.equal(clock.epoch, 7200);
  assert.equal(clock.seconds(7299), 99); assert.equal(clock.seconds(7300), 100, 'past the rebase span the epoch moves to the hour');
  assert.equal(clock.seconds(7100), 3500, 'a rewind rebases rather than going negative'); assert.equal(clock.epoch, 3600);
  const film = createShaderTime(); assert.equal(film.seconds(12.5), 12.5, 'short clocks (films, tests) are unchanged');
});
