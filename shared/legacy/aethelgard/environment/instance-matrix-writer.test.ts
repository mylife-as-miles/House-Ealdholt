import assert from 'node:assert/strict';
import test from 'node:test';
import {createInstanceMatrixUploads, type InstanceMatrixAttribute} from './instance-matrix-writer';

function attribute(slots: number) {
  const ranges: {start: number; count: number}[] = []; let uploads = 0;
  const value: InstanceMatrixAttribute & {ranges: typeof ranges; readonly uploads: number} = {
    array: new Float32Array(slots * 16), ranges,
    get needsUpdate() { return false; }, set needsUpdate(flag: boolean) { if (flag) uploads++; },
    addUpdateRange(start, count) { ranges.push({start, count}); },
    get uploads() { return uploads; },
  };
  return value;
}
const matrix = (seed: number) => Array.from({length: 16}, (_, i) => seed + i / 10);

test('an unchanged rebuild queues no upload; a change uploads only its span', () => {
  const a = attribute(8), b = attribute(2), uploads = createInstanceMatrixUploads();
  for (let slot = 0; slot < 8; slot++) uploads.write(a, slot, matrix(slot));
  uploads.write(b, 0, matrix(9));
  assert.equal(uploads.commit(), 8 * 16 + 16); assert.deepEqual(a.ranges, [{start: 0, count: 128}]); assert.deepEqual(b.ranges, [{start: 0, count: 16}]);
  // A still camera rebuilds the same lists: nothing to upload.
  for (let slot = 0; slot < 8; slot++) uploads.write(a, slot, matrix(slot));
  uploads.write(b, 0, matrix(9));
  assert.equal(uploads.commit(), 0); assert.equal(a.uploads, 1); assert.equal(b.uploads, 1);
  // Two slots change in one buffer: only that span is queued.
  for (let slot = 0; slot < 8; slot++) uploads.write(a, slot, matrix(slot === 5 || slot === 6 ? 40 + slot : slot));
  assert.equal(uploads.commit(), 32); assert.deepEqual(a.ranges[1], {start: 80, count: 32}); assert.equal(a.uploads, 2); assert.equal(b.uploads, 1);
  assert.deepEqual(uploads.stats, {commits: 3, uploads: 3, floatsQueued: 176});
});

test('values are compared as stored Float32, and slots outside the buffer are refused', () => {
  const target = attribute(1), uploads = createInstanceMatrixUploads(), precise = matrix(1 / 3);
  uploads.write(target, 0, precise); assert.equal(uploads.commit(), 16);
  uploads.write(target, 0, precise.map(v => v + 1e-12)); assert.equal(uploads.commit(), 0, 'sub-Float32 noise is not a change');
  assert.throws(() => uploads.write(target, 1, precise), /outside/); assert.throws(() => uploads.write(target, -1, precise), /outside/);
  uploads.release(target); assert.equal(uploads.commit(), 0);
});
