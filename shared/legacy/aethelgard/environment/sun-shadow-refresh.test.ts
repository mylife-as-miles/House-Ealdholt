import test from 'node:test';
import assert from 'node:assert/strict';
import { sunShadowNeedsRefresh } from './sun-shadow-refresh';

const direction = (degrees: number) => ({ x: Math.sin(degrees * Math.PI / 180), y: Math.cos(degrees * Math.PI / 180), z: 0 });
test('sunlight can move continuously without rebuilding the static shadow map every frame', () => {
  let previous: ReturnType<typeof direction> | null = null, refreshes = 0;
  // One real minute of the village clock: 240 ticks, 0.25° of sun per 4 s world minute.
  for (let tick = 0; tick < 240; tick++) {
    const sun = direction(tick * .25 / 16);
    if (sunShadowNeedsRefresh(previous, sun, 'medium')) { previous = sun; refreshes++; }
  }
  assert.ok(refreshes > 1 && refreshes <= 9, `Expected a handful of refreshes a minute, not 240; got ${refreshes}`);
  assert.equal(sunShadowNeedsRefresh(previous, direction(35), 'medium'), true, 'A clock jump must invalidate immediately.');
});
test('High limits angular shadow error more tightly and identical directions remain cached', () => {
  assert.equal(sunShadowNeedsRefresh(null, direction(0), 'high'), true);
  assert.equal(sunShadowNeedsRefresh(direction(0), direction(.3), 'medium'), false);
  assert.equal(sunShadowNeedsRefresh(direction(0), direction(.3), 'high'), true);
  assert.equal(sunShadowNeedsRefresh(direction(0), direction(.6), 'medium'), true);
  assert.equal(sunShadowNeedsRefresh(direction(0), direction(.016), 'high'), false, 'One clock tick of sun never redraws the map.');
  assert.equal(sunShadowNeedsRefresh(direction(0), direction(0), 'high'), false);
});
