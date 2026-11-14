import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decoderFixturePath, readEnvironmentDecoderFixture, verifyEnvironmentDecoders } from './verify-environment-decoders.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Container-only unit data, never decoded, attached to a scene or presented as
// application evidence. The real pipeline fixture supplies the browser proof.
async function fixture(imageUri = 'textures/map.png') {
  const parent = await mkdtemp(join(tmpdir(), 'crownfall-decoder-whitelist-')), root = join(parent, 'fixture');
  await mkdir(join(root, 'textures'), { recursive: true });
  const image = Buffer.from('unit image container'), document = { asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], buffers: [{ byteLength: 4 }], images: [{ uri: imageUri }] };
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]), glb = Buffer.alloc(28 + json.length + 4);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20); glb.writeUInt32LE(4, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length);
  const manifest = { schema: 'crownfall-megascans-derived-v1', source: { provenance: { rights: { confirmed: true }, license: 'CC0-1.0' } },
    files: [{ path: 'asset.glb', bytes: glb.length, sha256: hash(glb), kind: 'derived-runtime-model' }, { path: 'textures/map.png', bytes: image.length, sha256: hash(image), kind: 'unchanged-source-image' }],
    geometry: [{ mesh: 0, primitive: 0, compressed: true, vertices: 3, triangles: 1, attributes: {} }], textures: [] };
  await writeFile(join(root, 'asset.glb'), glb); await writeFile(join(root, 'textures/map.png'), image);
  const save = () => writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await save();
  return { root, parent, manifest, save, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

test('private decoder whitelist refuses traversal, URL schemes and non-asset files', () => {
  for (const path of ['../map.png', 'textures/../map.png', '/map.png', 'textures//map.png', 'textures/%2e%2e/map.png', 'textures\\map.png', 'https://other.test/map.png', 'settings.json', 'worker.js']) assert.throws(() => decoderFixturePath(path));
  assert.equal(decoderFixturePath('textures/image-0-srgb.ktx2'), 'textures/image-0-srgb.ktx2');
});

test('a changed file or an escaping symlink is rejected before browser use', async () => {
  const f = await fixture();
  try {
    const verified = await readEnvironmentDecoderFixture(f.root); assert.equal(verified.files.size, 2);
    const original = await readFile(join(f.root, 'textures/map.png')); await writeFile(join(f.root, 'textures/map.png'), Buffer.alloc(original.length));
    await assert.rejects(readEnvironmentDecoderFixture(f.root), /SHA mismatch/);
    await rm(join(f.root, 'textures/map.png')); await writeFile(join(f.parent, 'outside.png'), original); await symlink(join(f.parent, 'outside.png'), join(f.root, 'textures/map.png'));
    await assert.rejects(readEnvironmentDecoderFixture(f.root), /symlink escapes/);
  } finally { await f.cleanup(); }
});

test('unconfirmed rights and manifest escape cannot start a probe', async () => {
  const f = await fixture();
  try {
    f.manifest.source.provenance.rights.confirmed = false; await f.save();
    await assert.rejects(readEnvironmentDecoderFixture(f.root), /confirmed source rights/);
    f.manifest.source.provenance.rights.confirmed = true; await f.save();
    const raw = await readFile(join(f.root, 'manifest.json')); await rm(join(f.root, 'manifest.json')); await writeFile(join(f.parent, 'outside.json'), raw); await symlink(join(f.parent, 'outside.json'), join(f.root, 'manifest.json'));
    await assert.rejects(readEnvironmentDecoderFixture(f.root), /manifest escapes/);
  } finally { await f.cleanup(); }
});

test('unlisted or remote GLB images cannot escape the hash-verified fixture', async () => {
  for (const uri of ['textures/unlisted.png', 'https://other.test/map.png']) {
    const f = await fixture(uri);
    try { await assert.rejects(readEnvironmentDecoderFixture(f.root), /Unlisted fixture image|Unsafe decoder fixture path/); }
    finally { await f.cleanup(); }
  }
});

test('a failed decoder page is closed and only its own routes are removed', async () => {
  const f = await fixture(), navigation = []; let installed, removed;
  const page = { url: () => 'about:blank', request: { get: async () => ({ ok: () => true, text: async () => 'import {Mesh} from "/node_modules/.vite/deps/three.js?v=exact";' }) },
    route: async (pattern, handler) => { installed = { pattern, handler }; }, goto: async url => { navigation.push(url); },
    evaluate: async () => { throw Error('decoder GPU failure'); }, unroute: async (pattern, handler) => { removed = { pattern, handler }; } };
  try {
    const result = await verifyEnvironmentDecoders(page, f.root, 'http://127.0.0.1:4191/', { timeoutMs: 10000 });
    assert.equal(result.passed, false); assert.match(result.error, /decoder GPU failure/);
    assert.equal(result.routesRemoved, true); assert.equal(result.probeDocumentClosed, true);
    assert.equal(navigation.at(-1), 'about:blank'); assert.deepEqual(removed, installed);
    assert.equal(result.sceneActivated, false); assert.equal(result.screenshotTaken, false);
  } finally { await f.cleanup(); }
});
