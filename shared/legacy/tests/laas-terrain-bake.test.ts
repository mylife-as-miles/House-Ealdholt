import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeDryVillageTerrain, LAAS_DRY_REVIEW_PALETTE } from '../aethelgard/environment/terrain-bake';
import { mat4, mat4Compose } from '../environment/kernel/math';

test('actual normal slopes drive dry soil/rock colours without fabricated grass or wet masks', () => {
  const normals = new Float32Array([0, 1, 0, 1, 0, 0]);
  const before = normals.slice();
  const result = bakeDryVillageTerrain(normals, mat4());
  assert.equal(result.vertices, 2);
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(result.colors[c] - LAAS_DRY_REVIEW_PALETTE.soil[c]) < 1e-7);
    assert.ok(Math.abs(result.colors[c + 3] - LAAS_DRY_REVIEW_PALETTE.rock[c]) < 1e-7);
  }
  assert.ok(Math.abs(result.meanRoughness - 0.87) < 1e-12);
  assert.deepEqual(normals, before);
});

test('terrain normals use inverse-transpose world transforms rather than local upness', () => {
  const world = mat4Compose(mat4(), 3, 7, 8, 0, 0, Math.PI / 2, 1, 2, 1);
  const result = bakeDryVillageTerrain(new Float32Array([0, 1, 0]), world);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(result.colors[c] - LAAS_DRY_REVIEW_PALETTE.rock[c]) < 1e-7);
  assert.equal(result.meanRoughness, 0.8);
});

test('terrain bake rejects missing, degenerate and invalid numeric inputs', () => {
  for (const normals of [[], [0, 1], [0, 0, 0], [NaN, 1, 0]]) assert.throws(() => bakeDryVillageTerrain(normals, mat4()), RangeError);
  assert.throws(() => bakeDryVillageTerrain([0, 1, 0], new Float64Array(16)), RangeError);
  assert.throws(() => bakeDryVillageTerrain([0, 1, 0], mat4(), { ...LAAS_DRY_REVIEW_PALETTE, soil: [Infinity, 0, 0] }), RangeError);
});
