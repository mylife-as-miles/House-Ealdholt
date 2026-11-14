import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPackedVegetationGeometry} from './vegetation-packed-geometry';
import type {VegetationSimplifier} from './vegetation-simplify';

test('worker remap preserves retained positions, all attribute channels, winding and bounds', async () => {
  const input = {positions: new Float32Array([50, 50, 50, 0, 0, 0, 1, 0, 0, 0, 2, 0]),
    attributes: new Float32Array([.9, .9, 0, 1, 0, .1, .2, 0, 1, 0, .3, .4, 0, 1, 0, .5, .6, 0, 1, 0]),
    indices: new Uint32Array([3, 1, 2]), stride: 5, channels: [{name: 'uv', size: 2}, {name: 'normal', size: 3}],
    attributeWeights: [1, 1, .1, .1, .1], foliage: true, ratio: .5, error: .01};
  const simplifier = {ready: Promise.resolve(), simplifyWithAttributes: (indices: Uint32Array) => [indices, 0]} as VegetationSimplifier;
  const output = await buildPackedVegetationGeometry(input, simplifier);
  assert.deepEqual([...output.indices], [0, 1, 2]); assert.deepEqual([...output.positions], [0, 2, 0, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(output.bounds, [0, 0, 0, 1, 2, 0]); assert.equal(output.sourceTriangles, 1);
  assert.deepEqual([...output.attributes[0].values], [...Float32Array.from([.5, .6, .1, .2, .3, .4])]);
  assert.deepEqual([...input.indices], [3, 1, 2]);
});
