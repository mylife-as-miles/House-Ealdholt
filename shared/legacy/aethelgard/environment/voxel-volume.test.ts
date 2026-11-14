import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStaticVoxelVolume, centredVoxelGrid, packVoxelAtlas, voxelOccupancyIdentity, type VoxelVolumeGrid} from './voxel-volume';
const grid: VoxelVolumeGrid = {resolution: [8, 8, 8], min: [0, 0, 0], size: [8, 8, 8]};
test('fractional source proxies retain linear albedo and empty source regions stay empty', () => {
  const p = {min: [2, 2, 2] as const, max: [2.5, 3, 3] as const, albedo: [.2, .4, .6] as const, opacity: 1};
  const volume = buildStaticVoxelVolume({grid, proxies: [p]});
  const index = (2 + 8 * (2 + 8 * 2)) * 4;
  assert.deepEqual(Array.from(volume.albedoOpacity.subarray(index, index + 4)), [51, 102, 153, 128]);
  assert.equal(volume.occupiedVoxels, 1); assert.equal(volume.albedoOpacity[3], 0);
  assert.equal(volume.transport[3], 255);
});
test('static canopy/roof coverage darkens sky transport without depending on sunlight', () => {
  const open = buildStaticVoxelVolume({grid, proxies: []}), covered = buildStaticVoxelVolume({grid, proxies: [{min: [0, 4, 0], max: [8, 5, 8], albedo: [.1, .2, .05], opacity: 1}]});
  const sample = (4 + 8 * (2 + 8 * 4)) * 4 + 3;
  assert.equal(open.transport[sample], 255); assert.equal(covered.transport[sample], 0);
  assert.deepEqual(buildStaticVoxelVolume({grid, proxies: []}), open);
});
test('only measured terrain fills columns and source heights remain unchanged', () => {
  const heights = new Float32Array(64).fill(NaN); heights[0] = 2.5; const before = heights.slice();
  const result = buildStaticVoxelVolume({grid, proxies: [], terrainHeights: heights});
  assert.equal(result.albedoOpacity[3], 255); assert.equal(result.albedoOpacity[(8 * 2) * 4 + 3], 128);
  assert.equal(result.albedoOpacity[7], 0); assert.deepEqual(heights, before);
});
test('2D voxel atlas preserves every voxel and slice boundary without needing storage textures', () => {
  const data = new Uint8Array(8 * 8 * 8 * 4); for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data.set([x, y, z, 255], (x + 8 * (y + 8 * z)) * 4);
  const atlas = packVoxelAtlas(data, grid);
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = ((Math.floor(z / atlas.columns) * 8 + y) * atlas.width + z % atlas.columns * 8 + x) * 4;
    assert.deepEqual(Array.from(atlas.pixels.subarray(offset, offset + 4)), [x, y, z, 255]);
  }
});
test('occupancy identities follow content, backend and quantized region, with no sun/time cache entries', () => {
  const a = centredVoxelGrid([5, 5, 5], [32, 16, 32], [128, 64, 128]), b = centredVoxelGrid([6, 6, 6], [32, 16, 32], [128, 64, 128]);
  const base = {worldRegion: 'test-region', sourceSha256: 'a'.repeat(64), generatorVersion: '1', backend: 'webgl2-rgba8', grid: a};
  assert.equal(voxelOccupancyIdentity(base), voxelOccupancyIdentity({...base, grid: b}));
  assert.notEqual(voxelOccupancyIdentity(base), voxelOccupancyIdentity({...base, sourceSha256: 'b'.repeat(64)}));
  assert.notEqual(voxelOccupancyIdentity(base), voxelOccupancyIdentity({...base, backend: 'different'}));
  assert.notEqual(voxelOccupancyIdentity(base), voxelOccupancyIdentity({...base, grid: centredVoxelGrid([40, 5, 5], [32, 16, 32], [128, 64, 128])}));
  assert.throws(() => voxelOccupancyIdentity({...base, sourceSha256: 'unverified-url'}));
});
