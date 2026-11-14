import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { alphaAt, leafComponents, maskScores, selectComponentCoverage, prepareTreeLod, buildNativeTreePrototype } from './prepare-ealdholt-tree-lod.mjs';

test('selection preserves whole original leaf components and respects a hard triangle budget', () => {
  const groups = leafComponents(Uint32Array.from([0, 1, 2, 2, 1, 3, 4, 5, 6]), 7);
  assert.deepEqual(groups, [[0, 1], [2]]);
  const components = groups.map((triangles, i) => ({ triangles, pixels: Uint32Array.from(i ? [0] : [0, 1, 2, 3]) }));
  const chosen = selectComponentCoverage(components, 2, Float64Array.from([1, 1, 1, 1]));
  assert.deepEqual(chosen.triangleIds, [0, 1]); assert.equal(chosen.triangles, 2);
  const forced = selectComponentCoverage(components, 2, Float64Array.from([1, 1, 1, 1]), [1]);
  assert.deepEqual(forced.triangleIds, [2]); assert.equal(forced.triangles, 1);
  assert.throws(() => selectComponentCoverage(components, 1, Float64Array.from([1, 1, 1, 1]), [0]));
});

test('alpha sampling honors top-row glTF UV orientation, bilinear filtering and sampler edges', () => {
  const image = { width: 2, height: 2, data: Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  assert.equal(alphaAt(image, 0.25, 0.25), 1); assert.equal(alphaAt(image, 0.25, 0.75), 0);
  assert.equal(alphaAt(image, 0.5, 0.5), 0.25);
  assert.equal(alphaAt(image, -0.25, 0.25, { wrapS: 33071 }), 1);
  assert.equal(alphaAt(image, -0.25, 0.25, { wrapS: 10497 }), 0);
  assert.equal(alphaAt(image, -0.25, 0.25, { wrapS: 33648 }), 1);
});

test('coverage distinguishes source retention from invented pixels outside the source', () => {
  const [score] = maskScores(Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([1, 0, 1, 0]), [{ size: 2, cameraHeight: 2, azimuthDegrees: 0 }]);
  assert.equal(score.sourceCoverageRetained, 0.5); assert.equal(score.intersectionOverUnion, 1 / 3); assert.equal(score.addedPixelsOutsideSource, 1);
});

test('experiments refuse public, existing and aliased output directories before reading sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tree-lod-test-'));
  try {
    await assert.rejects(prepareTreeLod({ outputPath: new URL('../forbidden-tree-output', import.meta.url).pathname }), /outside the public repository/);
    await assert.rejects(prepareTreeLod({ outputPath: root }), /fresh private output/);
    await symlink(root, root + '-alias');
    await assert.rejects(prepareTreeLod({ outputPath: join(root + '-alias', 'fresh') }), /parent aliases/);
  } finally { await rm(root + '-alias', { force: true }); await rm(root, { recursive: true, force: true }); }
});

test('private packaging preserves Native bark/decor/map bytes and exact original leaf vertex attributes', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  function fixture(leafOffset) {
    const data = [], accessors = [], primitives = [];
    const add = (values, width, type = 5126) => { const bytes = Buffer.alloc(values.length * (type === 5126 ? 4 : 2)); values.forEach((v, i) => type === 5126 ? bytes.writeFloatLE(v, i * 4) : bytes.writeUInt16LE(v, i * 2)); const id = data.length; data.push(bytes); accessors.push({ componentType: type, count: values.length / width, type: width === 1 ? 'SCALAR' : width === 2 ? 'VEC2' : 'VEC3' }); return id; };
    for (let component = 0; component < 3; component++) {
      const offset = component === 1 ? leafOffset : component;
      const attributes = { POSITION: add([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0], 3), NORMAL: add([0, 0, 1, 0, 0, 1, 0, 0, 1], 3), TEXCOORD_2: add([0, 0, 1, 0, 0, 1], 2) };
      primitives.push({ attributes, indices: add([0, 1, 2], 1, 5123), material: component });
    }
    const j = { accessors, meshes: [{ primitives }], images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 10497, wrapT: 33071, minFilter: 9987 }], materials: [0, 1, 2].map(i => ({ name: `Native${i}`, pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 2, extensions: { KHR_texture_transform: { scale: [1, 1], offset: [0.1, 0.2] } } } }, alphaMode: i === 1 ? 'MASK' : 'OPAQUE', alphaCutoff: 0.33, doubleSided: true })) };
    return { j, raw: async id => data[id], view: async () => png, values: async id => { const a = accessors[id], b = data[id], size = a.componentType === 5126 ? 4 : 2; return Float64Array.from({ length: b.length / size }, (_, i) => a.componentType === 5126 ? b.readFloatLE(i * size) : b.readUInt16LE(i * size)); } };
  }
  const original = fixture(4.25), native = fixture(0.125), artifact = await buildNativeTreePrototype(original, native, 0, 0, [0]);
  const size = artifact.bytes.readUInt32LE(12), json = JSON.parse(artifact.bytes.subarray(20, 20 + size)), binary = artifact.bytes.subarray(28 + size);
  const raw = id => { const a = json.accessors[id], v = json.bufferViews[a.bufferView]; return binary.subarray(v.byteOffset, v.byteOffset + v.byteLength); };
  for (let component = 0; component < 3; component++) {
    const before = (component === 1 ? original : native).j.meshes[0].primitives[component], after = json.meshes[0].primitives[component], reader = component === 1 ? original : native;
    for (const name of Object.keys(before.attributes)) assert.deepEqual(raw(after.attributes[name]), await reader.raw(before.attributes[name]));
    assert.deepEqual(raw(after.indices), await reader.raw(before.indices));
  }
  assert.deepEqual(json.materials, native.j.materials); assert.deepEqual(json.samplers, native.j.samplers);
  const imageView = json.bufferViews[json.images[0].bufferView]; assert.deepEqual(binary.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength), png);
  assert.equal(artifact.imageProof.length, 1); assert.deepEqual(artifact.sourceLeafVertexIds, [0, 1, 2]);
});
