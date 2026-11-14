import assert from 'node:assert/strict';
import test from 'node:test';
import {hashVoxelRegionSource} from './voxel-source-hash';
import type {VoxelRegionSource} from './voxel-source-index';
test('static source digests change for actual generated geometry/reflectance even without a version bump', async () => {
  const source: VoxelRegionSource = {worldRegion: 'region', sourceSha256: 'a'.repeat(64), generatorVersion: '1', backend: 'webgl2-rgba8',
    terrain: [{positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), bounds: {min: [0, 0, 0], max: [1, 0, 1]}}],
    proxies: [{min: [1, 1, 1], max: [2, 2, 2], albedo: [.1, .2, .3], opacity: .5}]};
  const first = await hashVoxelRegionSource(source); assert.equal(await hashVoxelRegionSource(source), first);
  assert.notEqual(await hashVoxelRegionSource({...source, proxies: [{...source.proxies[0], opacity: .6}]}), first);
  const positions = source.terrain[0].positions.slice(); positions[1] = .25;
  assert.notEqual(await hashVoxelRegionSource({...source, terrain: [{...source.terrain[0], positions}]}), first);
});
