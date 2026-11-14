import assert from 'node:assert/strict';
import test from 'node:test';
import { readGlb, slimGlb, writeGlb } from './glb-slim.mjs';

// A small skinned-looking GLB: one mesh, two clips sharing a time accessor in one view, one image.
function fixture() {
  const floats = (values) => Buffer.from(new Float32Array(values).buffer);
  const position = floats([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = Buffer.from(new Uint16Array([0, 1, 2, 0]).buffer); // padded to 8 bytes
  const times = floats([0, 1]), idle = floats([0, 0, 0, 1, 0, 0, 0, 1]), attack = floats([5, 5, 5, 5, 6, 6, 6, 6]);
  const animation = Buffer.concat([times, attack, idle]);
  const image = Buffer.from('original-image-bytes');
  const bin = Buffer.concat([position, indices, animation, image, Buffer.alloc((4 - image.length % 4) % 4)]);
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 44, byteLength: animation.length },
      { buffer: 0, byteOffset: 44 + animation.length, byteLength: image.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, byteOffset: 0, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 2, byteOffset: 8, componentType: 5126, count: 2, type: 'VEC4' },
      { bufferView: 2, byteOffset: 40, componentType: 5126, count: 2, type: 'VEC4' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    images: [{ name: 'Albedo', mimeType: 'image/webp', bufferView: 3 }],
    animations: [
      { name: 'Attack', samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] },
      { name: 'Idle', samplers: [{ input: 2, output: 4 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] },
    ],
  };
  return { glb: writeGlb(json, bin), idle, times, position, image };
}

const accessorBytes = ({ json, bin }, index, length) => {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return bin.subarray(start, start + length);
};

test('keeps only the named clips and drops the bytes the others used', async () => {
  const source = fixture();
  const { glb, report } = await slimGlb(source.glb, { keepAnimations: ['Idle'] });
  const result = readGlb(glb);
  assert.deepEqual(result.json.animations.map((animation) => animation.name), ['Idle']);
  assert.equal(result.json.accessors.length, 4);
  assert.deepEqual(report.clips, ['Idle']);
  const sampler = result.json.animations[0].samplers[0];
  assert.deepEqual(accessorBytes(result, sampler.input, 8), source.times);
  assert.deepEqual(accessorBytes(result, sampler.output, 32), source.idle);
  assert.deepEqual(accessorBytes(result, result.json.meshes[0].primitives[0].attributes.POSITION, 36), source.position);
  assert.ok(glb.length < source.glb.length - 24, 'the dropped clip no longer ships');
  // Every accessor stays aligned to its component size inside its view, as three.js slices views.
  for (const accessor of result.json.accessors) assert.equal((accessor.byteOffset ?? 0) % (accessor.componentType === 5123 ? 2 : 4), 0);
  for (const view of result.json.bufferViews) assert.equal(view.byteOffset % 4, 0);
});

test('re-encodes the named images through the supplied encoder', async () => {
  const source = fixture();
  const calls = [];
  const { glb, report } = await slimGlb(source.glb, {
    keepAnimations: ['Idle', 'Attack'], images: { Albedo: { maxSize: 64, quality: 80 } },
    encodeImage: async (bytes, mimeType, options) => { calls.push([bytes.toString(), mimeType, options.maxSize]); return Buffer.from('small'); },
  });
  assert.deepEqual(calls, [['original-image-bytes', 'image/webp', 64]]);
  const result = readGlb(glb), view = result.json.bufferViews[result.json.images[0].bufferView];
  assert.equal(result.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength).toString(), 'small');
  assert.deepEqual(report.images, [{ name: 'Albedo', before: source.image.length, after: 5 }]);
});

test('refuses to drop a clip that is asked for', async () => {
  await assert.rejects(slimGlb(fixture().glb, { keepAnimations: ['Walk'] }), /Walk/);
});
