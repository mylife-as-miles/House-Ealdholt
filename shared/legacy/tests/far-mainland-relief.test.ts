import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtMainlandRelief, sampleEaldholtMainlandRelief } from '../aethelgard/environment/far-mainland-relief';
const boundary = [-50, -50, 100, -50, 100, 100, -50, 100];
const source = { minX: -50, maxX: 100, minZ: -50, maxZ: 100 };
const bounds = { min: [-270, -3, -120], max: [170, 25, 240] } as const;
test('Relief respects completed land, coastline and river protection independently', () => {
  const form = createEaldholtMainlandRelief(boundary, source, bounds);
  assert.notEqual(form.protectedBoundaryXZ, boundary);
  assert.equal(sampleEaldholtMainlandRelief(form, 25, 25, 100, Infinity), 0);
  assert.equal(sampleEaldholtMainlandRelief(form, -50, 25, 100, Infinity), 0);
  assert.equal(sampleEaldholtMainlandRelief(form, 20, 330, 3.2, Infinity), 0);
  assert.equal(sampleEaldholtMainlandRelief(form, 320, 20, 100, 6), 0);
  assert.equal(sampleEaldholtMainlandRelief(undefined, 320, 20, 100, 100), 0);
  assert.ok(sampleEaldholtMainlandRelief(form, 20, 330, 100, 100) > 4);
});
test('Overlapping rises remain positive and below the explicit ten-metre cap', () => {
  const form = createEaldholtMainlandRelief(boundary, source, bounds); let largest = 0;
  for (let z = -700; z <= 700; z += 25) for (let x = -100; x <= 700; x += 25) {
    const y = sampleEaldholtMainlandRelief(form, x, z, 100, Infinity);
    assert.ok(y >= 0 && y <= 10); largest = Math.max(largest, y);
  }
  assert.ok(largest > 8);
  assert.throws(() => createEaldholtMainlandRelief([], source, bounds), /boundary/);
  assert.throws(() => sampleEaldholtMainlandRelief(form, NaN, 0, 100, 100), /Nonfinite/);
});
