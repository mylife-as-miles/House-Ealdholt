import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtRiverValleyBuffers } from '../aethelgard/environment/river-valley';
import { createEaldholtWoodlandPlacements, sampleEaldholtWoodlandSupport } from '../aethelgard/environment/river-woodland';

test('woodland support interpolates actual triangles and rejects unsupported or steep roots', () => {
  const land = { positions: [0, 0, 0, 10, 2, 0, 0, 4, 10], indices: [0, 1, 2] };
  const sample = sampleEaldholtWoodlandSupport(land, 2, 3)!;
  assert.ok(Math.abs(sample.height - 1.6) < 1e-10); assert.ok(Math.abs(sample.slope - Math.hypot(.2, .4)) < 1e-10);
  assert.equal(sampleEaldholtWoodlandSupport(land, 12, 8), null);
});

test('woodland clumps are deterministic, fully supported and leave the river and village clear', () => {
  const edge = [[-10, 2], [10, 2]] as const;
  const data = createEaldholtRiverValleyBuffers({ minX: -10, maxX: 10, minZ: -10, maxZ: 10, west: edge, east: edge, north: edge, south: edge }, 'desktop');
  const input = { land: { positions: data.land.positions, indices: data.land.indices }, water: { positions: data.water.positions, indices: data.water.indices },
    village: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, canopyRadius: 2.3, maximumTrees: 24, profile: 'desktop' as const };
  const a = createEaldholtWoodlandPlacements(input), b = createEaldholtWoodlandPlacements(input);
  assert.deepEqual(a, b); assert.equal(a.length, 24);
  for (const tree of a) {
    const support = sampleEaldholtWoodlandSupport(input.land, tree.x, tree.z)!;
    assert.ok(Math.abs(support.height - tree.y) < 1e-9); assert.ok(support.slope <= .58);
    assert.equal(sampleEaldholtWoodlandSupport(input.water, tree.x, tree.z), null);
    assert.ok(tree.x < -10 || tree.x > 10 || tree.z < -10 || tree.z > 10);
  }
  assert.ok(new Set(a.map(tree => tree.yaw.toFixed(2))).size > 16, 'trees need varied complete-actor orientations');
  assert.ok(new Set(a.map(tree => Math.round(tree.z))).size > 8, 'clusters must not form one bank row');
});
