import assert from 'node:assert/strict';
import test from 'node:test';
import { updateResidentFollowCamera } from './resident-follow-camera';
import type { VillageResidentAvailability } from '../../../../../shared/legacy/aethelgard/characters/village-resident-availability';

const availability: VillageResidentAvailability = { residentId: 'ealdholt-garrison-spearman', position: [5, 0, 7],
  body: 'qualified', reason: null, bodyReady: false, drawnFrame: null, renderFrame: null };
const offset = (camera: { x: number; y: number; z: number }, target: typeof camera) => [camera.x - target.x, camera.y - target.y, camera.z - target.z];

test('Reduce Motion follows a real qualified location in one update and preserves observer offset/distance/orientation', () => {
  const camera = { x: 10, y: 20, z: 30 }, target = { x: 0, y: 0, z: 0 }, before = offset(camera, target), focus = { x: 5, y: 6, z: 7 };
  assert.equal(updateResidentFollowCamera(camera, target, focus, availability, 0, true), true);
  assert.deepEqual(target, focus); assert.deepEqual(offset(camera, target), before);
  assert.equal(Math.hypot(...offset(camera, target)), Math.hypot(...before));
});

test('ordinary Follow depends on elapsed time instead of submitted frame count', () => {
  const focus = { x: 12, y: 3, z: -8 }, oneCamera = { x: 10, y: 20, z: 30 }, oneTarget = { x: 0, y: 0, z: 0 };
  const manyCamera = { ...oneCamera }, manyTarget = { ...oneTarget };
  updateResidentFollowCamera(oneCamera, oneTarget, focus, availability, 1, false);
  for (let i = 0; i < 60; i++) updateResidentFollowCamera(manyCamera, manyTarget, focus, availability, 1 / 60, false);
  for (const key of ['x', 'y', 'z'] as const) { assert.ok(Math.abs(oneCamera[key] - manyCamera[key]) < 1e-10); assert.ok(Math.abs(oneTarget[key] - manyTarget[key]) < 1e-10); }
  assert.ok(Math.abs(oneTarget.x - focus.x) > 1e-3);
  offset(oneCamera, oneTarget).forEach((value, i) => assert.ok(Math.abs(value - [10, 20, 30][i]) < 1e-10));
});

test('unknown, pending and held source selections leave the camera unchanged even when a numeric point is known', () => {
  for (const value of [null, { ...availability, body: 'unknown' as const }, { ...availability, body: 'pending' as const },
    { ...availability, body: 'held' as const }, { ...availability, position: null }]) {
    const camera = { x: 10, y: 20, z: 30 }, target = { x: 0, y: 0, z: 0 };
    assert.equal(updateResidentFollowCamera(camera, target, { x: 5, y: 6, z: 7 }, value, 1, true), false);
    assert.deepEqual(camera, { x: 10, y: 20, z: 30 }); assert.deepEqual(target, { x: 0, y: 0, z: 0 });
  }
});
