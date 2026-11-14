import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createEaldholtEnvironmentAssetLoader, ownEaldholtEnvironmentAssetLoader } from './environment-asset-loader';

test('local Basis runtime copies match the installed Three decoder bytes and retain their licences and notice', async () => {
  const base = new URL('../../../public/decoders/basis/', import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.schema, 'crownfall-local-basis-runtime-v1'); assert.equal(manifest.threeVersion, '0.185.1');
  for (const file of manifest.files) {
    assert.match(file.file, /^[A-Za-z0-9_.-]+$/);
    const bytes = await readFile(new URL(file.file, base));
    assert.equal(bytes.length, file.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    const official = await readFile(new URL('../../../node_modules/three/examples/jsm/libs/basis/' + name, import.meta.url));
    assert.deepEqual(await readFile(new URL(name, base)), official);
  }
  assert.match(await readFile(new URL('LICENSE-Basis.txt', base), 'utf8'), /Apache License/);
  assert.match(await readFile(new URL('NOTICE-Basis.txt', base), 'utf8'), /Binomial LLC/);
  assert.match(await readFile(new URL('LICENSE-Three.txt', base), 'utf8'), /MIT License/);
});

function model(scene = new Group()): GLTF {
  return { scene, scenes: [scene], cameras: [], animations: [], asset: { version: '2.0' }, parser: {} as GLTF['parser'], userData: {} };
}

test('decoder retirement waits for a cancelled import, then releases its unreturned shared resources exactly once', async () => {
  const abort = new AbortController(), geometry = new BoxGeometry(), texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture, normalMap: texture }), scene = new Group();
  scene.add(new Mesh(geometry, material), new Mesh(geometry, material));
  let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0, decoderDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  let resolve!: (value: GLTF) => void;
  const decoder = { dispose() { decoderDisposals++; } };
  const pool = ownEaldholtEnvironmentAssetLoader({ loadAsync: () => new Promise<GLTF>(done => { resolve = done; }) }, [decoder, decoder], abort.signal);
  const pending = pool.loadAsync('owned-rock.glb'), rejected = assert.rejects(pending, /abort/i);
  let idle = false; const barrier = pool.whenIdle().then(() => { idle = true; });
  abort.abort(); pool.dispose(); await Promise.resolve();
  assert.equal(idle, false); assert.equal(decoderDisposals, 0, 'Do not terminate a worker still needed by GLTFLoader');
  resolve(model(scene)); await rejected; await barrier;
  assert.equal(pool.stats.lateReleased, 1); assert.equal(pool.stats.pending, 0);
  assert.equal(decoderDisposals, 1); assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1); assert.equal(textureDisposals, 1);
  assert.equal(scene.children.length, 0);
  await assert.rejects(pool.loadAsync('another-rock.glb'), /abort/i);
});

test('successful models retain caller ownership and an unrelated failed import does not poison the pool', async () => {
  const abort = new AbortController(), geometry = new BoxGeometry(), material = new MeshStandardMaterial(), scene = new Group();
  scene.add(new Mesh(geometry, material)); let releases = 0, decoders = 0;
  geometry.addEventListener('dispose', () => releases++); material.addEventListener('dispose', () => releases++);
  const gltf = model(scene), pool = ownEaldholtEnvironmentAssetLoader({ async loadAsync(url) { if (url === 'broken.glb') throw Error('bad input'); return gltf; } }, [{ dispose() { decoders++; } }], abort.signal);
  await assert.rejects(pool.loadAsync('broken.glb'), /bad input/);
  assert.equal(await pool.loadAsync('rock.glb'), gltf); await pool.whenIdle(); pool.dispose(); pool.dispose();
  assert.equal(decoders, 1); assert.equal(releases, 0); assert.equal(scene.children.length, 1);
  await assert.rejects(pool.loadAsync('late.glb'), /retired/);
  geometry.dispose(); material.dispose();
});

test('the real CC0 regional rock geometry remains loadable through the Draco-ready pool without changing its plain format', async () => {
  const bytes = await readFile(new URL('../../../public/assets/legacy/environment/aethelgard/namaqualand-rocks-v1/rocks-desktop.glb', import.meta.url));
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString()), binary = bytes.subarray(28 + length);
  assert.equal(json.extensionsRequired?.includes('KHR_draco_mesh_compression') ?? false, false);
  // Node has no image decoder. Preserve real geometry/accessors/node frames;
  // photographic image/material compatibility is checked by the asset pipeline
  // and the actual application, not fabricated by this CPU geometry test.
  json.images = []; json.textures = []; json.materials = [];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const raw = Buffer.from(JSON.stringify(json)), padded = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]), output = Buffer.alloc(28 + padded.length + binary.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20);
  output.writeUInt32LE(binary.length, 20 + padded.length); output.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(output, 28 + padded.length);
  // Use the real GLTF parser through the same owned-loading barrier. The
  // browser factory supplies the same parser plus its lazy decoder workers.
  const parser = new GLTFLoader(), pool = ownEaldholtEnvironmentAssetLoader({ loadAsync: () => parser.parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), '') }, [], new AbortController().signal);
  const gltf = await pool.loadAsync('actual-namaqualand-desktop.glb'); let triangles = 0, parts = 0;
  gltf.scene.traverse(node => { if (node instanceof Mesh) { parts++; triangles += node.geometry.index!.count / 3; assert.ok(node.geometry.hasAttribute('normal')); assert.ok(node.geometry.hasAttribute('uv')); } });
  assert.equal(parts, 3); assert.equal(triangles, 5400); assert.equal(pool.stats.loaded, 1);
  pool.dispose(); assert.equal(gltf.scene.children.length, 3);
  gltf.scene.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } });
  const aborted = new AbortController(); aborted.abort();
  assert.throws(() => createEaldholtEnvironmentAssetLoader({ baseUrl: '/crownfall/', signal: aborted.signal }), /abort/i);
});
