import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoliageCoverageMipmaps } from '../aethelgard/environment/foliage-coverage-mips';

function rgba(width: number, height: number, alpha: (i: number) => number, color = [40, 100, 160]): Uint8Array {
  return Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? alpha(Math.floor(i / 4)) : color[i % 4]);
}

test('base bytes and caller ownership are preserved; repeated builds are deterministic', () => {
  const source = rgba(8, 8, i => i % 3 === 0 ? 255 : 0), original = source.slice();
  const a = buildFoliageCoverageMipmaps(source, 8, 8, 0.3333), b = buildFoliageCoverageMipmaps(source, 8, 8, 0.3333);
  assert.deepEqual(source, original); assert.deepEqual(a, b); assert.deepEqual(a.levels[0].rgba, original);
  assert.notEqual(a.levels[0].rgba.buffer, source.buffer);
  a.levels[0].rgba[0] = 222; assert.deepEqual(source, original); assert.deepEqual(b.levels[0].rgba, original);
});

test('every mip reaches nearest-pixel cutoff coverage, including quantized alpha ties', () => {
  const source = rgba(16, 16, i => i % 4 === 0 ? 255 : 0), chain = buildFoliageCoverageMipmaps(source, 16, 16, 0.5);
  assert.equal(chain.baseCoverage, 0.25);
  assert.ok(chain.levels.some(level => level.boundaryCorrections > 0), 'uniform alpha ties need explicit quantization correction');
  for (const level of chain.levels) {
    const count = level.rgba.filter((_, i) => i % 4 === 3).filter(alpha => alpha / 255 >= 0.5).length;
    assert.equal(count, Math.round(chain.baseCoverage * level.width * level.height));
    assert.equal(count, level.coveredPixels);
    assert.ok(Math.abs(level.coverageError) <= 0.5 / (level.width * level.height) + 1e-12);
  }
  assert.equal(chain.levels[chain.levels.length - 1].coverageError, -0.25);
});

test('RGB filtering uses linear light and premultiplied alpha without transparent color halos', () => {
  const opaque = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual([...buildFoliageCoverageMipmaps(opaque, 2, 1, 0.5).levels[1].rgba], [188, 188, 188, 255]);
  const edge = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]);
  assert.deepEqual([...buildFoliageCoverageMipmaps(edge, 2, 1, 0.5).levels[1].rgba.subarray(0, 3)], [255, 0, 0]);
  const sparse = Uint8Array.from([20, 160, 80, 255, 20, 160, 80, 0, 20, 160, 80, 0, 20, 160, 80, 0]);
  const level = buildFoliageCoverageMipmaps(sparse, 4, 1, 0.6).levels[1];
  assert.deepEqual([...level.rgba.subarray(0, 3)], [20, 160, 80]); assert.ok(level.rgba[3] / 255 >= 0.6);
});

test('alpha corrections never feed back into RGB at later mip levels', () => {
  const source = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255]);
  const corrected = buildFoliageCoverageMipmaps(source, 4, 1, 0.7), otherCutoff = buildFoliageCoverageMipmaps(source, 4, 1, 0.2);
  assert.ok(corrected.levels[1].adjustedAlphaPixels > 0);
  assert.deepEqual([...corrected.levels[2].rgba.subarray(0, 3)], [156, 213, 0]);
  for (let level = 0; level < corrected.levels.length; level++) {
    for (let i = 0; i < corrected.levels[level].rgba.length; i++) if (i % 4 !== 3) assert.equal(corrected.levels[level].rgba[i], otherCutoff.levels[level].rgba[i]);
  }
});

test('opaque and transparent inputs remain stable and include complete memory accounting', () => {
  const opaque = buildFoliageCoverageMipmaps(rgba(8, 8, () => 255), 8, 8, 1);
  assert.deepEqual(opaque.levels.map(level => [level.width, level.height]), [[8, 8], [4, 4], [2, 2], [1, 1]]);
  assert.equal(opaque.totalByteLength, (64 + 16 + 4 + 1) * 4);
  for (const level of opaque.levels) { assert.equal(level.coverage, 1); assert.equal(level.adjustedAlphaPixels, 0); }
  const transparent = buildFoliageCoverageMipmaps(rgba(4, 4, () => 0), 4, 4, 0.3);
  for (const level of transparent.levels) assert.equal(level.coverage, 0);
  assert.deepEqual([...transparent.levels[1].rgba], Array(16).fill(0));
});

test('odd and one-dimensional inputs retain edge samples and reach a valid 1x1 mip', () => {
  const source = rgba(3, 1, i => i === 2 ? 255 : 0, [255, 120, 10]);
  const chain = buildFoliageCoverageMipmaps(source, 3, 1, 0.1);
  assert.deepEqual(chain.levels.map(level => [level.width, level.height]), [[3, 1], [1, 1]]);
  assert.deepEqual([...chain.levels[1].rgba.subarray(0, 3)], [255, 120, 10]);
  for (const [width, height] of [[1, 9], [5, 7], [17, 3]]) {
    const mips = buildFoliageCoverageMipmaps(rgba(width, height, i => (i * 53) % 256), width, height, 0.3333);
    assert.equal(mips.levels[mips.levels.length - 1].width, 1); assert.equal(mips.levels[mips.levels.length - 1].height, 1);
    for (const level of mips.levels) assert.equal(level.coveredPixels, Math.round(mips.baseCoverage * level.width * level.height));
  }
});

test('very faint source support survives coverage selection before RGBA8 rounding', () => {
  const chain = buildFoliageCoverageMipmaps(rgba(8, 8, i => i % 4 === 0 ? 1 : 0), 8, 8, 1 / 255);
  assert.equal(chain.baseCoverage, 0.25); assert.equal(chain.levels[1].coveredPixels, 4); assert.equal(chain.levels[2].coveredPixels, 1);
});

test('invalid dimensions, byte storage and cutoff are rejected without mutating input', () => {
  const source = rgba(2, 2, () => 255), before = source.slice();
  for (const [width, height] of [[0, 2], [-1, 2], [1.5, 2], [2, NaN], [4, 4], [Number.MAX_SAFE_INTEGER, 2]]) assert.throws(() => buildFoliageCoverageMipmaps(source, width, height, 0.5), RangeError);
  for (const cutoff of [NaN, Infinity, -0.1, 1.01]) assert.throws(() => buildFoliageCoverageMipmaps(source, 2, 2, cutoff), RangeError);
  assert.throws(() => buildFoliageCoverageMipmaps(new Float32Array(16) as unknown as Uint8Array, 2, 2, 0.5), TypeError);
  assert.deepEqual(source, before);
});
