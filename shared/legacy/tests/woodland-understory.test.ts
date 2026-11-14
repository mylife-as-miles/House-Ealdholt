import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtUnderstoryPlacements, EALDHOLT_WOODLAND_UNDERSTORY, type EaldholtUnderstoryInput } from '../aethelgard/environment/woodland-understory';
import { createEaldholtRiverValleyBuffers } from '../aethelgard/environment/river-valley';
import { createEaldholtWoodlandPlacements, sampleEaldholtWoodlandSupport, type EaldholtWoodlandSurface } from '../aethelgard/environment/river-woodland';

// Numeric triangle fixtures only; no renderer, substitute scene or screenshot.
function grid(xs: number[], zs: number[], height = (_x: number, _z: number) => 2, omit = (_x: number, _z: number) => false): EaldholtWoodlandSurface {
  const positions: number[] = [], indices: number[] = [];
  for (const z of zs) for (const x of xs) positions.push(x, height(x, z), z);
  for (let z = 0; z < zs.length - 1; z++) for (let x = 0; x < xs.length - 1; x++) {
    if (omit(x, z)) continue;
    const a = z * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1; indices.push(a, c, b, b, c, d);
  }
  return { positions, indices };
}
function input(): EaldholtUnderstoryInput {
  return { land: grid([-40, 40], [-40, 40]), water: [], sourceEnvelope: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
    woodlandPlacements: [[-20, -12], [20, -12], [-20, 20], [20, 20]].map(([x, z]) => ({ x, z, y: 2, yaw: 0, scale: 1 })),
    canopyRadius: 4, grassRadius: .65, maximumActors: 128, profile: 'quest' };
}
test('deterministic tree crescents fill only supported exterior, with gaps and geographically spread quality prefixes', () => {
  const data = input(), a = createEaldholtUnderstoryPlacements(data), b = createEaldholtUnderstoryPlacements(data);
  assert.deepEqual(a, b); assert.ok(a.length > 64 && a.length <= 128); assert.equal(new Set(a.slice(0, 32).map(p => p.anchor)).size, 4);
  for (const p of a) {
    assert.ok(p.x + p.footprint < -8.25 || p.x - p.footprint > 8.25 || p.z + p.footprint < -8.25 || p.z - p.footprint > 8.25);
    assert.ok(Math.abs(p.x) + p.footprint < 38 && Math.abs(p.z) + p.footprint < 38);
    assert.deepEqual(p.normal, [-0, 1, -0]); assert.equal(p.y, 2);
    const root = data.woodlandPlacements[p.anchor], distance = Math.hypot(root.x - p.x, root.z - p.z);
    assert.ok(distance >= 4 * .48 && distance <= 4 * 1.33);
    const inward = Math.atan2(-root.z, -root.x), towardVillage = Math.cos(inward) * (p.x - root.x) + Math.sin(inward) * (p.z - root.z);
    assert.ok(towardVillage < Math.cos(1.05) * distance + 1e-8, 'the inward route sector stays open');
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
    assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= .76 * (a[i].footprint + a[j].footprint));
});
test('a thin wet triangle between support samples excludes the complete dry footprint and shore buffer', () => {
  const data = input(), first = createEaldholtUnderstoryPlacements(data)[0], x = first.x + first.footprint * .42, z = first.z + first.footprint * .31;
  const water = { positions: [x, -10, z, x + .00001, -10, z + .001, x - .00001, -10, z + .001], indices: [0, 1, 2] };
  const placements = createEaldholtUnderstoryPlacements({ ...data, water: [water] });
  assert.ok(placements.length > 0); assert.ok(placements.every(p => Math.hypot(p.x - x, p.z - z) >= p.footprint + .35 - .002));
  assert.ok(!placements.some(p => p.x === first.x && p.z === first.z));
});
test('actual open triangle boundaries exclude tiny unsupported holes, including between radial samples', () => {
  const data = input(), first = createEaldholtUnderstoryPlacements(data)[0], x = first.x + first.footprint * .4, z = first.z + first.footprint * .3;
  const land = grid([-40, x - .01, x + .01, 40], [-40, z - .01, z + .01, 40], undefined, (ix, iz) => ix === 1 && iz === 1);
  const placements = createEaldholtUnderstoryPlacements({ ...data, land });
  assert.ok(placements.length > 0); assert.ok(!placements.some(p => p.x === first.x && p.z === first.z));
  for (const p of placements) assert.ok(Math.hypot(p.x - x, p.z - z) > p.footprint + .18);
});
test('whole intersecting triangles satisfy the tangent error bound instead of merely checking a root height', () => {
  const data = input(), slope = createEaldholtUnderstoryPlacements({ ...data, land: grid([-40, 40], [-40, 40], (x, z) => 2 + .12 * x + .08 * z) });
  assert.ok(slope.length > 64 && slope.length <= 128);
  for (const p of slope) { assert.ok(Math.abs(p.normal[0] + .12 / Math.hypot(.12, 1, .08)) < 1e-10); assert.ok(Math.abs(p.y - (2 + .12 * p.x + .08 * p.z)) < 1e-10); }
  assert.equal(createEaldholtUnderstoryPlacements({ ...data, land: grid([-40, 40], [-40, 40], x => 2 + x) }).length, 0);
  const first = createEaldholtUnderstoryPlacements(data)[0], crease = first.x + first.footprint * .2;
  const land = grid([-40, crease, 40], [-40, 40], x => 2 + Math.max(0, x - crease) * .6);
  const creased = createEaldholtUnderstoryPlacements({ ...data, land });
  assert.ok(!creased.some(p => p.x === first.x && p.z === first.z));
});
test('the real valley and woodland generators provide terrain-supported dry clusters under explicit platform caps', () => {
  const envelope = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, edge = [[-10, 2], [10, 2]] as const;
  const valley = createEaldholtRiverValleyBuffers({ ...envelope, west: edge, east: edge, north: edge, south: edge }, 'quest');
  const roots = createEaldholtWoodlandPlacements({ land: valley.land, water: valley.water, village: envelope, sourceEnvelope: envelope, canopyRadius: 3, maximumTrees: 76, profile: 'quest' });
  const placements = createEaldholtUnderstoryPlacements({ land: valley.land, water: [valley.water], sourceEnvelope: envelope,
    woodlandPlacements: roots, canopyRadius: 3, grassRadius: .65, maximumActors: 128, profile: 'quest' });
  assert.ok(placements.length > 32 && placements.length <= 128); assert.ok(new Set(placements.map(p => p.anchor)).size > 8);
  for (const p of placements) { assert.ok(sampleEaldholtWoodlandSupport(valley.land, p.x, p.z)); assert.equal(sampleEaldholtWoodlandSupport(valley.water, p.x, p.z), null); }
  assert.equal(EALDHOLT_WOODLAND_UNDERSTORY.quest.maximumTriangles, 16000); assert.equal(EALDHOLT_WOODLAND_UNDERSTORY.desktop.maximumTriangles, 64000);
});
test('source-only roots, absent support and invalid contracts never force a replacement or floating patch', () => {
  const data = input();
  assert.deepEqual(createEaldholtUnderstoryPlacements({ ...data, woodlandPlacements: [{ x: 0, y: 2, z: 0, yaw: 0, scale: 1 }] }), []);
  assert.deepEqual(createEaldholtUnderstoryPlacements({ ...data, land: { positions: [], indices: [] } }), []);
  assert.throws(() => createEaldholtUnderstoryPlacements({ ...data, maximumActors: 129 }), /contract/);
  assert.throws(() => createEaldholtUnderstoryPlacements({ ...data, water: [{ positions: [NaN, 0, 0], indices: [0, 0, 0] }] }), /triangle/);
  assert.throws(() => createEaldholtUnderstoryPlacements({ ...data, woodlandPlacements: [{ x: NaN, y: 0, z: 0, yaw: 0, scale: 1 }] }), /root/);
});
