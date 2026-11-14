import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoxelSourceIndex, type VoxelRegionSource} from './voxel-source-index';
test('voxel movement queries only nearby static sources and preserves deterministic identities across return visits', () => {
  const source: VoxelRegionSource = {worldRegion: 'region', sourceSha256: 'a'.repeat(64), generatorVersion: '1', backend: 'webgl2-rgba8', terrain: [], proxies: [
    {min: [1, 1, 1], max: [3, 3, 3], albedo: [.2, .3, .4], opacity: .7},
    {min: [1001, 1, 1001], max: [1003, 3, 1003], albedo: [.4, .3, .2], opacity: 1}]};
  const index = createVoxelSourceIndex(source), grid = {resolution: [8, 8, 8] as const, min: [0, 0, 0] as const, size: [8, 8, 8] as const};
  const near = index.prepare(grid), moved = index.prepare({...grid, min: [1000, 0, 1000]});
  assert.equal(near.sourceCounts.proxies, 1); assert.equal(moved.sourceCounts.proxies, 1); assert.notEqual(near.key, moved.key);
  assert.deepEqual(index.prepare(grid), near); assert.equal(near.volume.occupiedVoxels, 8); assert.notDeepEqual(near.volume.albedoOpacity, moved.volume.albedoOpacity);
  assert.throws(() => createVoxelSourceIndex({...source, terrain: [{positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), bounds: {min: [10, 10, 10], max: [11, 11, 11]}}]}), /bounds/);
});

test('kilometre-scale coarse land retains local lighting support without kingdom-wide hash allocation',()=>{
  const source:VoxelRegionSource={worldRegion:'regional',sourceSha256:'b'.repeat(64),generatorVersion:'1',backend:'webgl2-rgba8',proxies:[],terrain:[{
    positions:new Float32Array([-40000,0,-40000,40000,0,-40000,0,0,40000]),indices:new Uint32Array([0,2,1]),bounds:{min:[-40000,0,-40000],max:[40000,0,40000]}}]};
  const index=createVoxelSourceIndex(source);assert.ok(index.bytes<1024);
  const grid={resolution:[8,8,8] as const,min:[-4,-4,-4] as const,size:[8,8,8] as const};
  assert.equal(index.prepare(grid).sourceCounts.terrain,1);
  assert.equal(index.prepare({...grid,min:[50000,-4,50000]}).sourceCounts.terrain,0);
});
