import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeEaldholtTerrainSupport } from '../aethelgard/environment/terrain-support';
import { createEaldholtWoodlandSupportIndex } from '../aethelgard/environment/river-woodland';

test('actual adjoining owners retain exact coordinates, winding and rooted support without source mutation', () => {
  const seam = 1.123456789012345;
  const main = { positions: [0, 2, 0, 4, 3, 0, 0, 2, seam, 4, 3, seam], indices: [0, 2, 1, 1, 2, 3] };
  const apron = { positions: Float32Array.from([0, 2, seam, 4, 3, seam, 0, 4, 6, 4, 5, 6]), indices: Uint16Array.from([0, 2, 1, 1, 2, 3]) };
  // Real mesh seams are already coordinate-identical; use that exact owner value.
  main.positions[8] = main.positions[11] = apron.positions[2];
  const before = structuredClone([main, apron]), merged = mergeEaldholtTerrainSupport([main, apron]);
  assert.deepEqual([main, apron], before); assert.ok(merged.positions instanceof Float64Array); assert.ok(merged.indices instanceof Uint32Array);
  assert.equal(merged.positions[2], 0); assert.equal(merged.positions[8], merged.positions[14]);
  assert.deepEqual(Array.from(merged.positions).slice(0, main.positions.length), main.positions);
  const support = createEaldholtWoodlandSupportIndex([merged]);
  assert.ok(Math.abs(support.sample(2, .5)!.height - 2.5) < 1e-10);
  assert.ok(Math.abs(support.sample(2, apron.positions[2])!.height - 2.5) < 1e-10);
  assert.ok(support.sample(2, 5)!.height > 4, 'roots can sample the real continuation owner');
  assert.equal(support.sample(2, 7), null, 'joining does not invent exterior support');
  assert.equal(merged.positions[4], 3); main.positions[4] = 99; assert.equal(merged.positions[4], 3, 'the support view owns its copied arrays');
});

test('support joining preserves non-float32 local coordinates and offsets beyond the 16-bit render range', () => {
  const first = { positions: new Float64Array(65536 * 3), indices: [65533, 65534, 65535] };
  first.positions[0] = 123.1234567890123;
  const second = { positions: [0, 1, 0, 1, 1, 0, 0, 1, 1], indices: [0, 2, 1] };
  const merged = mergeEaldholtTerrainSupport([first, second]);
  assert.equal(merged.positions[0], first.positions[0]); assert.notEqual(merged.positions[0], Math.fround(first.positions[0]));
  assert.deepEqual(Array.from(merged.indices), [65533, 65534, 65535, 65536, 65538, 65537]);
});

test('incomplete, nonfinite and invalid indexed surfaces reject without modifying the owners', () => {
  const valid = { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 2, 1] }, before = structuredClone(valid);
  assert.throws(() => mergeEaldholtTerrainSupport([]), /actual land/);
  for (const surface of [
    { ...valid, positions: [0, 1] }, { ...valid, positions: [NaN, ...valid.positions.slice(1)] },
    { ...valid, indices: [0, 1] }, { ...valid, indices: [0, 1, 3] }, { ...valid, indices: [0, .5, 1] },
  ]) assert.throws(() => mergeEaldholtTerrainSupport([valid, surface]), /terrain-support/);
  assert.deepEqual(valid, before);
});
