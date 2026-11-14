import assert from 'node:assert/strict';
import test from 'node:test';
import {buildGrassGroundField, type GrassGroundPatch} from './grass-ground-field';
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 8, 0, 8, 1];
function patch(id = 'grass:source:0'): GrassGroundPatch {
  const pixels = new Uint8Array(16 * 16 * 4), normals = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {pixels.set([30, 150, 40, 255], i); normals.set([128, 255, 128, 255], i);}
  return {id, matrix, bounds: [-1, -1, 1, 1], pixels, normals, size: 16};
}
test('far-grass colour and normals remain limited to existing source footprints', () => {
  const source = patch(), field = buildGrassGroundField({resolution: 64, bounds: [0, 0, 16, 16], patches: [source]});
  const centre = (32 * 64 + 32) * 4;
  assert.equal(field.colour[centre + 1], 150); assert.equal(field.normal[centre + 1], 255);
  assert.equal(field.colour[3], 0); assert.equal(field.colour[(40 * 64 + 40) * 4 + 3], 0);
  assert.deepEqual(source.matrix, matrix); assert.equal(field.sourcePatches, 1);
});
test('reordered loading produces byte-identical fields and duplicate source identities reject', () => {
  const a = patch('a'), b = {...patch('b'), matrix: [...matrix.slice(0, 12), 8.5, 0, 8.5, 1]};
  const build = (patches: GrassGroundPatch[]) => buildGrassGroundField({resolution: 64, bounds: [0, 0, 16, 16], patches});
  assert.deepEqual(build([a, b]).colour, build([b, a]).colour);
  assert.throws(() => build([a, a]), /Invalid source/);
});
test('captured normals follow sloped, nonuniform and reflected source frames', () => {
  const c = Math.SQRT1_2, tilted = [2 * c, 2 * c, 0, 0, -3 * c, 3 * c, 0, 0, 0, 0, 4, 0, 8, 0, 8, 1];
  const sample = {...patch(), matrix: tilted};
  const field = buildGrassGroundField({resolution: 64, bounds: [0, 0, 16, 16], patches: [sample]});
  const centre = (32 * 64 + 32) * 4;
  assert.ok(Math.abs(field.normal[centre] - 37) <= 2); assert.ok(Math.abs(field.normal[centre + 1] - 218) <= 2);
  const reflected = [...matrix]; reflected[0] = -2; reflected[5] = 3; reflected[10] = 4;
  const mirror = buildGrassGroundField({resolution: 64, bounds: [0, 0, 16, 16], patches: [{...patch(), matrix: reflected}]});
  assert.ok(mirror.normal[centre + 1] > 250, 'negative horizontal scale must not invert the up normal');
});
test('raised source plants keep their base height for terrain admission instead of tinting the ground beneath a roof', () => {
  const raised = [...matrix]; raised[13] = 4;
  const field = buildGrassGroundField({resolution: 64, bounds: [0, 0, 16, 16], patches: [{...patch(), matrix: raised, groundY: .2}]});
  assert.ok(Math.abs(field.height[32 * 64 + 32] - 4.2) < 1e-5);
  assert.equal(field.height[0], 0);
});
