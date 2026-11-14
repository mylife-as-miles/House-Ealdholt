import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleVoxelTerrainHeights} from './voxel-terrain';
test('voxel ground transport samples exact authored sloping triangles and leaves unsupported world empty', () => {
  const positions = new Float32Array([0, 0, 0, 4, 4, 0, 0, 4, 4, 4, 8, 4]), indices = new Uint16Array([0, 2, 1, 1, 2, 3]), before = positions.slice();
  const heights = sampleVoxelTerrainHeights({resolution: [8, 8, 8], min: [0, 0, 0], size: [8, 8, 8]}, [{positions, indices}]);
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    if (x < 4 && z < 4) assert.equal(heights[z * 8 + x], x + z + 1); else assert.ok(Number.isNaN(heights[z * 8 + x]));
  }
  assert.deepEqual(positions, before);
});
