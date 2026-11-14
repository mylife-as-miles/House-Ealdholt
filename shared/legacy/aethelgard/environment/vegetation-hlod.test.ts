import assert from 'node:assert/strict';
import test from 'node:test';
import {createVegetationHandoff, TREE_HLOD, GRASS_HLOD, vegetationLodDistance} from './vegetation-hlod';

test('all four default tree and grass levels resolve at their source-metre distances', () => {
  for (const [policy, samples] of [[TREE_HLOD, [0, 130, 300, 600]], [GRASS_HLOD, [0, 55, 115, 220]]] as const) {
    for (let level = 0; level < 4; level++) {
      const state = createVegetationHandoff(policy).update(0, samples[level], 15);
      assert.equal(state.requested, level); assert.equal(state.weights[level], 1);
    }
  }
});
test('pending captures never reserve pixels; completed capture starts a bounded complementary fade', () => {
  const handoff = createVegetationHandoff(TREE_HLOD);
  assert.equal(handoff.update(0, 600, 1).weights[0], 1);
  const state = handoff.update(10000, 600, 9);
  assert.ok(state.weights[0] > .7); assert.ok(state.weights[3] > 0 && state.weights[3] < .3);
  for (let t = 10050; t < 10500; t += 50) handoff.update(t, 600, 9);
  assert.equal(state.weights[3], 1); assert.equal(state.weights[0], 0);
  assert.equal(state.ranges[7], 1);
});
test('teleport, turn, quality change and missing resources keep complete coverage', () => {
  const handoff = createVegetationHandoff(TREE_HLOD);
  let now = 0;
  for (const [distance, ready] of [[0, 15], [600, 15], [0, 1], [190, 7], [420, 15], [600, 1]]) {
    const state = handoff.update(now += 17, distance, ready);
    assert.ok(Math.abs(state.weights.reduce((n, w) => n + w, 0) - 1) < 1e-6);
    let cursor = 0;
    for (let i = 3; i >= 0; i--) { assert.equal(state.ranges[i * 2], cursor); cursor = state.ranges[i * 2 + 1]; }
    assert.ok(Math.abs(cursor - 1) < 1e-6);
  }
});
test('screen projection and hardware budgets adapt thresholds without changing source positions', () => {
  assert.equal(vegetationLodDistance({distanceMetres: 100, projectionScale: 1, qualityScale: 1}), 100);
  assert.equal(vegetationLodDistance({distanceMetres: 100, projectionScale: 1, qualityScale: .5}), 200);
  assert.equal(vegetationLodDistance({distanceMetres: 100, projectionScale: .5, qualityScale: 1}), 50);
  assert.throws(() => vegetationLodDistance({distanceMetres: NaN, projectionScale: 1, qualityScale: 1}));
});
test('reduced motion presents the ready level immediately while retaining missing-level fallback', () => {
  const handoff = createVegetationHandoff(TREE_HLOD);
  assert.equal(handoff.update(0, 600, 1, true).weights[0], 1);
  const ready = handoff.update(1, 600, 15, true);
  assert.equal(ready.weights[3], 1); assert.equal(ready.weights[0], 0); assert.equal(ready.transitioning, false);
});
