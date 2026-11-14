import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtCoastalValleyBuffers } from '../aethelgard/environment/coastal-valley';
import { createEaldholtBankLandformBuffers, createEaldholtLandformBankSampler, type EaldholtLandformRect, type EaldholtRiparianCorridor } from '../aethelgard/environment/bank-landform';
import { createEaldholtCoastalContinuityPatch, type EaldholtCoastalContinuityInput } from '../aethelgard/environment/coastal-continuity';
import { createEaldholtWoodlandSupportIndex } from '../aethelgard/environment/river-woodland';
function fixture(profile: 'desktop' | 'quest', riparianCorridor?: EaldholtRiparianCorridor): EaldholtCoastalContinuityInput {
  const edge = [[-50, 2], [0, 3], [50, 3], [100, 2]] as const;
  const sourceEnvelope = { minX: -50, maxX: 100, minZ: -50, maxZ: 100 };
  const valley = createEaldholtCoastalValleyBuffers({ ...sourceEnvelope, west: edge, east: edge, north: edge, south: edge }, profile);
  const protectedFootprints = [{ minX: -28, maxX: -14, minZ: -68, maxZ: -58 }];
  const water = [valley.channel, valley.sea] as const;
  const land = createEaldholtBankLandformBuffers({ land: { ...valley.land, wetness: valley.landWetness }, water, sourceEnvelope, protectedFootprints, profile, riparianCorridor });
  return { profile, land, water, sourceEnvelope, protectedFootprints, riparianCorridor, fullBounds: { min: valley.bounds.min, max: [valley.bounds.max[0], 20, valley.bounds.max[2]] } };
}
function apply(input: EaldholtCoastalContinuityInput) {
  const patch = createEaldholtCoastalContinuityPatch(input), positions = Float32Array.from(input.land.positions), normals = Float32Array.from(input.land.normals);
  patch.vertices.forEach((id, at) => { positions[id * 3 + 1] = patch.afterY[at]; normals.set(patch.afterNormals.subarray(at * 3, at * 3 + 3), id * 3); });
  return { patch, positions, normals };
}
const overlap = (a: EaldholtLandformRect, b: EaldholtLandformRect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
for (const profile of ['desktop', 'quest'] as const) {
  test(`${profile}: meaningful bounded outer relief keeps source, crown support and southern bank exact`, () => {
    const input = fixture(profile), before = structuredClone(input), { patch, positions, normals } = apply(input);
    assert.deepEqual(input, before, 'pure construction cannot mutate any borrowed array');
    assert.deepEqual(patch, createEaldholtCoastalContinuityPatch(input), 'deterministic output');
    assert.ok(patch.vertices.length > 20); assert.ok(patch.maximumRaise > 1); assert.ok(patch.outerBoundaryVerticesChanged > 2);
    const changed = new Set(patch.vertices), p = input.land.positions, index = input.land.indices;
    const guards = [input.sourceEnvelope, ...input.protectedFootprints].map(r => ({ minX: r.minX - .8, maxX: r.maxX + .8, minZ: r.minZ - .8, maxZ: r.maxZ + .8 }));
    for (let at = 0; at < p.length; at += 3) {
      assert.equal(positions[at], p[at]); assert.equal(positions[at + 2], p[at + 2]);
      for (let k = 0; k < 3; k++) assert.ok(positions[at + k] >= input.fullBounds.min[k] - .00002 && positions[at + k] <= input.fullBounds.max[k]);
    }
    for (let at = 0; at < index.length; at += 3) {
      const ids = [index[at], index[at + 1], index[at + 2]], xs = ids.map(id => p[id * 3]), zs = ids.map(id => p[id * 3 + 2]);
      const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      if (guards.some(r => overlap(r, box)) || ids.some(id => input.land.wetness[id] > .015)) for (const id of ids) {
        assert.ok(!changed.has(id)); assert.deepEqual(Array.from(normals.slice(id * 3, id * 3 + 3)), [input.land.normals[id * 3], input.land.normals[id * 3 + 1], input.land.normals[id * 3 + 2]]);
      }
    }
    const southernLimit = Math.min(...Array.from(input.water[0].positions).filter((_, i) => i % 6 === 2));
    for (let id = 0; id < p.length / 3; id++) if (p[id * 3 + 2] >= southernLimit) assert.ok(!changed.has(id), 'far/southern bank cannot move');
    const support = (points: ArrayLike<number>) => createEaldholtWoodlandSupportIndex([{ positions: points, indices: index }]);
    const old = support(p), next = support(positions); let probes = 0;
    for (const r of input.protectedFootprints) for (let x = r.minX; x <= r.maxX; x++) for (let z = r.minZ; z <= r.maxZ; z++) {
      const a = old.sample(x, z), b = next.sample(x, z); if (!a) continue; assert.deepEqual(b, a); probes++;
    }
    assert.ok(probes > 20); assert.equal(patch.cpuPatchBytes, patch.vertices.length * 42);
  });
}
test('bad direction, invalid envelope and missing water are refused without mutation', () => {
  const input = fixture('quest');
  assert.throws(() => createEaldholtCoastalContinuityPatch({ ...input, fullBounds: { ...input.fullBounds, max: [0, 20, 0] } }), /envelope/);
  assert.throws(() => createEaldholtCoastalContinuityPatch({ ...input, water: [{ positions: [], indices: [] }, input.water[1]] }), /paired water/);
  const sea = { ...input.water[1], positions: Float32Array.from(input.water[1].positions, (v, i) => i % 3 === 0 ? v + 500 : v) };
  assert.throws(() => createEaldholtCoastalContinuityPatch({ ...input, water: [input.water[0], sea] }), /west sea/);
});

for(const profile of ['desktop','quest']as const)test(`${profile}: final-chain continuity retains the continuous riparian grade and bounded inland relief`,()=>{
  const riparianCorridor={width:profile==='quest'?18:26,blendWidth:profile==='quest'?8:12},input=fixture(profile,riparianCorridor),before=structuredClone(input);
  const {patch,positions,normals}=apply(input),old=createEaldholtWoodlandSupportIndex([input.land]),next=createEaldholtWoodlandSupportIndex([{positions,indices:input.land.indices}]);
  const bank=createEaldholtLandformBankSampler(input.water);let unchanged=0;
  for(let x=-85;x<145;x+=3.7)for(let z=-95;z<205;z+=3.1){const distance=bank(x,z).distance,a=old.sample(x,z),b=next.sample(x,z);if(!a||!b||distance<=0||distance>=riparianCorridor.width-.5)continue;
    assert.ok(Math.abs(a.height-b.height)<.00002&&Math.abs(a.slope-b.slope)<.00002,'continuity cannot disturb the final riparian support corridor');unchanged++;
  }
  assert.ok(unchanged>100&&patch.vertices.length>20&&patch.maximumRaise>1);
  assert.deepEqual(input,before);assert.deepEqual(patch,createEaldholtCoastalContinuityPatch(input));
  for(let i=0;i<positions.length;i+=3){assert.equal(positions[i],input.land.positions[i]);assert.equal(positions[i+2],input.land.positions[i+2]);
    assert.ok(positions[i+1]>=input.fullBounds.min[1]-.00002&&positions[i+1]<=input.fullBounds.max[1]);
    if(bank(positions[i],positions[i+2]).distance<=riparianCorridor.width)assert.deepEqual(Array.from(normals.slice(i,i+3)),Array.from(input.land.normals).slice(i,i+3));
  }
});
