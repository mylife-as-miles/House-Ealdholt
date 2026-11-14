import assert from 'node:assert/strict';
import test from 'node:test';
import {compactVegetationIndices} from './vegetation-indexing';
test('compaction preserves triangle identity, order, winding and source UV/normal lookup', () => {
  const source = new Uint32Array([17, 4, 9, 9, 4, 12]), before = source.slice();
  const compact = compactVegetationIndices(source, 20);
  assert.deepEqual(Array.from(compact.sourceVertices), [17, 4, 9, 12]);
  assert.deepEqual(Array.from(compact.indices, i => compact.sourceVertices[i]), Array.from(source));
  assert.deepEqual(source, before); assert.equal(compact.sourceVertices.length, 4);
});
test('invalid derived triangles cannot read unrelated source attributes', () => {
  assert.throws(() => compactVegetationIndices(new Uint32Array([0, 1, 20]), 20), /source vertex/);
  assert.throws(() => compactVegetationIndices(new Uint32Array([0, 1]), 20), /budget/);
});
