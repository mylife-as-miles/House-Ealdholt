import assert from 'node:assert/strict';
import test from 'node:test';
import {buildVegetationAtlasMips, vegetationAtlasByteLength} from './vegetation-atlas';

test('rectangular and square atlas reservations equal the full generated colour/normal mip chain', () => {
  for (const views of [8, 16] as const) for (const tileSize of [32, 64, 128, 256]) {
    const length = tileSize * tileSize * views * 4;
    const record = buildVegetationAtlasMips({schema: 1, views, tileSize, columns: 4, rows: views / 4,
      centre: [0, 1, 0], extent: [2, 2], colour: new Uint8Array(length), normal: new Uint8Array(length)});
    assert.equal(vegetationAtlasByteLength(tileSize, views), record.mips.reduce((sum, m) => sum + m.colour.byteLength + m.normal.byteLength, 0));
  }
  assert.equal(vegetationAtlasByteLength(64, 8), 349528);
});
test('capture views filter separately with alpha-weighted colour and normalized normals', () => {
  const tileSize = 32, width = 128, height = 64, colour = new Uint8Array(width * height * 4), normal = new Uint8Array(colour.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, view = Math.floor(x / tileSize) + Math.floor(y / tileSize) * 4;
    colour[i + view % 3] = 240; colour[i + 3] = x % 4 < 2 ? 255 : 0;
    normal.set([128, 255, 128, 255], i);
  }
  const record = buildVegetationAtlasMips({schema: 1, views: 8, tileSize, columns: 4, rows: 2, centre: [0, 5, 0], extent: [8, 10], colour, normal});
  assert.equal(record.mips.at(-1)?.width, 1); assert.equal(record.mips.at(-1)?.height, 1);
  const mip = record.mips[1]; assert.equal(mip.colour[0], 240); assert.equal(mip.colour[1], 0);
  assert.equal(mip.colour[(16 * 4) + 1], 240, 'adjacent view retains its independent green capture');
  assert.equal(mip.normal[1], 255); assert.equal(mip.normal[0], 128);
});
test('incomplete captures fail before allocating a mip pyramid', () => {
  assert.throws(() => buildVegetationAtlasMips({schema: 1, views: 8, tileSize: 32, columns: 4, rows: 2, centre: [0, 0, 0], extent: [8, 10], colour: new Uint8Array(4), normal: new Uint8Array(4)}), /Incomplete/);
});
