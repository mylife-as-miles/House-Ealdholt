import assert from 'node:assert/strict';
import test from 'node:test';
import {MeshoptSimplifier} from 'meshoptimizer';
import {simplifyVegetationIndices} from './vegetation-simplify';
test('derived wood simplifies while retaining source ground contact and attribute ownership', async () => {
  const columns = 24, rows = 24, positions: number[] = [], attributes: number[] = [], indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const angle = x / columns * Math.PI * 2;
    positions.push(Math.cos(angle), y * .5, Math.sin(angle)); attributes.push(Math.cos(angle), 0, Math.sin(angle), x / columns, y / rows);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {const a = y * (columns + 1) + x, b = a + columns + 1; indices.push(a, b, a + 1, b, b + 1, a + 1);}
  const input = {positions: Float32Array.from(positions), attributes: Float32Array.from(attributes), indices: Uint32Array.from(indices),
    stride: 5, ratio: .35, error: .015, foliage: false, attributeWeights: [.1, .1, .1, .2, .2]};
  const before = input.positions.slice(), result = await simplifyVegetationIndices(input, MeshoptSimplifier);
  assert.ok(result.indices.length < input.indices.length * .7); assert.ok(result.error <= input.error + 1e-6);
  assert.equal(Math.min(...Array.from(result.indices, i => input.positions[i * 3 + 1])), 0);
  assert.deepEqual(input.positions, before); assert.ok(result.indices.every(i => i < input.positions.length / 3));
});
test('invalid source data cannot enter the WASM worker', async () => {
  await assert.rejects(simplifyVegetationIndices({positions: new Float32Array(), attributes: new Float32Array(), indices: new Uint32Array(),
    stride: 5, ratio: .35, error: .015, foliage: false, attributeWeights: [.1, .1, .1, .2, .2]}, MeshoptSimplifier), /budget/);
});
