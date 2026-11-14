// Decoder API proof only. No browser launch, Scene, camera, render or screenshot.
import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = { '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function decoderFixturePath(value) {
  assert.ok(typeof value === 'string' && value.length <= 220 && /^[A-Za-z0-9_./-]+$/.test(value), 'Unsafe decoder fixture path.');
  assert.ok(!value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe decoder fixture traversal.');
  assert.ok(mime[extname(value)], 'Unsupported decoder fixture file type.');
  return value;
}

/** Read only manifest-listed files beneath this selected private fixture.
 * Holding verified bytes prevents a changed file being served after hashing. */
export async function readEnvironmentDecoderFixture(fixtureRoot) {
  const directory = await realpath(resolve(fixtureRoot));
  const manifestPath = await realpath(resolve(directory, 'manifest.json')), manifestWithin = relative(directory, manifestPath);
  assert.ok(manifestWithin && !manifestWithin.startsWith('..') && !isAbsolute(manifestWithin), 'Decoder manifest escapes its root.');
  assert.ok((await stat(manifestPath)).size <= 1024 * 1024, 'Decoder manifest exceeds its bound.');
  const raw = await readFile(manifestPath), manifest = JSON.parse(raw);
  assert.equal(manifest.schema, 'crownfall-megascans-derived-v1');
  assert.equal(manifest.source?.provenance?.rights?.confirmed, true, 'Fixture needs confirmed source rights.');
  assert.ok(typeof manifest.source.provenance.license === 'string' && manifest.source.provenance.license.length > 0);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 64);
  const files = new Map(); let total = 0;
  for (const file of manifest.files) {
    const name = decoderFixturePath(file.path);
    assert.ok(!files.has(name), 'Duplicate decoder fixture path.');
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 16 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid fixture size/hash.');
    total += file.bytes; assert.ok(total <= 64 * 1024 * 1024, 'Decoder fixture exceeds its total bound.');
    const target = await realpath(resolve(directory, name)), within = relative(directory, target);
    assert.ok(within && !within.startsWith('..') && !isAbsolute(within), 'Decoder fixture symlink escapes its root.');
    assert.equal((await stat(target)).size, file.bytes, 'Decoder fixture size mismatch: ' + name);
    const bytes = await readFile(target); assert.equal(hash(bytes), file.sha256, 'Decoder fixture SHA mismatch: ' + name);
    files.set(name, { bytes, contentType: mime[extname(name)], sha256: file.sha256 });
  }
  const models = manifest.files.filter(file => file.kind === 'derived-runtime-model' && extname(file.path) === '.glb');
  assert.equal(models.length, 1, 'Decoder proof needs one derived model.');
  const model = models[0], bytes = files.get(model.path).bytes;
  assert.ok(bytes.length >= 28 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length && bytes.readUInt32LE(16) === 0x4e4f534a, 'Invalid fixture GLB.');
  const length = bytes.readUInt32LE(12); assert.ok(length > 0 && length % 4 === 0 && 20 + length + 8 <= bytes.length, 'Invalid fixture JSON chunk.');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  assert.equal(gltf.asset?.version, '2.0');
  assert.ok(gltf.extensionsRequired?.includes('KHR_draco_mesh_compression'), 'Fixture must exercise Draco.');
  for (const buffer of gltf.buffers ?? []) assert.equal(buffer.uri, undefined, 'Fixture geometry must be embedded.');
  for (const image of gltf.images ?? []) if (image.uri !== undefined) assert.ok(files.has(decoderFixturePath(image.uri)), 'Unlisted fixture image.');
  assert.ok(Array.isArray(manifest.geometry) && manifest.geometry.length > 0 && manifest.geometry.length <= 32);
  for (const part of manifest.geometry) assert.ok(part.compressed === true && Number.isSafeInteger(part.vertices) && part.vertices > 0 && part.vertices <= 200000 && Number.isSafeInteger(part.triangles) && part.triangles > 0 && part.triangles <= 200000, 'Unbounded geometry proof.');
  assert.ok(Array.isArray(manifest.textures) && manifest.textures.length <= 64);
  for (const texture of manifest.textures) {
    const file = files.get(decoderFixturePath(texture.output));
    assert.ok(file && file.sha256 === texture.sha256 && ['srgb', 'normal', 'orm'].includes(texture.role), 'Unqualified texture proof.');
    assert.ok([texture.width, texture.height].every(value => Number.isInteger(value) && value > 0 && value <= 4096) && Number.isInteger(texture.levels) && texture.levels > 0 && texture.levels <= 13, 'Unbounded texture proof.');
  }
  return { files, model: model.path, modelSha256: model.sha256, manifestSha256: hash(raw), sourceLicense: manifest.source.provenance.license,
    expected: { geometry: manifest.geometry, textures: manifest.textures, gltf }, bytes: total };
}

/** Called before game entry on a task-owned blank page. The exact resolved
 * Vite Three URL avoids importing a second Three instance into the probe. */
export async function verifyEnvironmentDecoders(page, fixtureRoot, baseURL, { timeoutMs = 120000 } = {}) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 10000 && timeoutMs <= 180000);
  const base = new URL(baseURL); assert.ok(['http:', 'https:'].includes(base.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && !base.username && !base.password && !base.search && !base.hash, 'Decoder proof requires the task loopback app.');
  assert.equal(page.url(), 'about:blank', 'Decoder proof must precede game entry on a blank task page.');
  const fixture = await readEnvironmentDecoderFixture(fixtureRoot);
  const directory = new URL(base.href.endsWith('/') ? base.href : base.href + '/');
  const factoryURL = new URL('src/legacy/aethelgard/environment-asset-loader.ts', directory).href;
  const response = await page.request.get(factoryURL, { timeout: 20000 }); assert.ok(response.ok(), 'Vite environment decoder module unavailable.');
  const source = await response.text(), specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]);
  const threeSpecifier = specifiers.find(specifier => /\/three(?:\.module)?\.js(?:\?|$)/.test(specifier));
  assert.ok(threeSpecifier, 'Could not identify Vite-resolved Three URL.');
  const threeURL = new URL(threeSpecifier, factoryURL); assert.equal(threeURL.origin, base.origin, 'Three probe import must stay on the app origin.');
  const prefix = new URL('__crownfall_decoder_probe_' + randomUUID() + '/', directory), blank = new URL('index.html', prefix).href;
  const pattern = prefix.href + '**', requests = [], blocked = [];
  const handler = async route => {
    const url = new URL(route.request().url()), key = url.href.startsWith(prefix.href) ? url.href.slice(prefix.href.length) : '';
    if (url.origin !== base.origin || url.search || url.hash || !key) { blocked.push(url.pathname); await route.fulfill({ status: 404, body: 'Unlisted decoder fixture.' }); return; }
    if (key === 'index.html') { await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Crownfall decoder API proof</title>' }); return; }
    const file = fixture.files.get(key);
    if (!file) { blocked.push(key); await route.fulfill({ status: 404, body: 'Unlisted decoder fixture.' }); return; }
    requests.push({ file: key, sha256: file.sha256 });
    await route.fulfill({ status: 200, contentType: file.contentType, body: file.bytes });
  };
  const report = { passed: false, kind: 'actual-derived-asset-decoder-api-without-world-or-image', modelSha256: fixture.modelSha256, manifestSha256: fixture.manifestSha256,
    sourceLicense: fixture.sourceLicense, fixtureBytes: fixture.bytes, requests, blocked, sceneActivated: false, screenshotTaken: false, routesRemoved: false, probeDocumentClosed: false };
  let timer;
  await page.route(pattern, handler);
  try {
    await page.goto(blank, { waitUntil: 'domcontentloaded', timeout: 20000 });
    report.result = await Promise.race([
      page.evaluate(async ({ factoryURL, threeURL, modelURL, expected, basePath, timeoutMs }) => {
        const out = { passed: false, meshes: [], textures: [], compressedPreferred: 0, rgbaPreferredFallbacks: 0, gpuErrors: [], cleanup: {} };
        let renderer, pool, gltf; const controller = new AbortController(); let deadline;
        const check = (condition, message) => { if (!condition) throw Error(message); };
        try {
          const [factory, three] = await Promise.all([import(factoryURL), import(threeURL)]);
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          renderer = new three.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' }); renderer.setSize(1, 1, false);
          pool = factory.createEaldholtEnvironmentAssetLoader({ baseUrl: basePath, signal: controller.signal, renderer });
          const load = pool.loadAsync(modelURL);
          const timeout = new Promise((_, reject) => { deadline = setTimeout(() => { controller.abort(); reject(Error('Decoder API proof deadline exceeded.')); }, timeoutMs); });
          gltf = await Promise.race([load, timeout]); clearTimeout(deadline);
          const semantics = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TANGENT: 'tangent', COLOR_0: 'color', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' };
          const slots = [['map', 'baseColorTexture', 'srgb'], ['normalMap', 'normalTexture', 'normal'], ['roughnessMap', 'metallicRoughnessTexture', 'orm'], ['metalnessMap', 'metallicRoughnessTexture', 'orm'], ['aoMap', 'occlusionTexture', 'orm']];
          const textures = new Map(), parts = new Set();
          gltf.scene.traverse(node => {
            if (!node.isMesh) return;
            check(node instanceof three.Mesh, 'Probe imported a different Three instance.');
            const association = gltf.parser.associations.get(node) ?? {}, meshIndex = association.meshes ?? expected.gltf.nodes?.[association.nodes]?.mesh, primitive = association.primitives ?? 0;
            const part = expected.geometry.find(value => value.mesh === meshIndex && value.primitive === primitive);
            check(part && !parts.has(meshIndex + ':' + primitive), 'Unexpected or duplicate decoded primitive.'); parts.add(meshIndex + ':' + primitive);
            const geometry = node.geometry; check(geometry.index && geometry.index.count === part.triangles * 3, 'Decoded index count differs.');
            for (const [semantic, attribute] of Object.entries(part.attributes)) {
              const actual = geometry.getAttribute(semantics[semantic]);
              check(actual && actual.count === part.vertices && actual.array.length === attribute.values && actual.normalized === attribute.normalized, 'Decoded attribute differs: ' + semantic);
              for (const value of actual.array) check(Number.isFinite(value), 'Nonfinite decoded geometry.');
            }
            out.meshes.push({ mesh: meshIndex, primitive, vertices: part.vertices, triangles: geometry.index.count / 3 });
            const materialIndex = expected.gltf.meshes[meshIndex].primitives[primitive].material, definition = expected.gltf.materials[materialIndex], material = node.material;
            check(material && !Array.isArray(material), 'Expected one PBR material per primitive.');
            for (const [slot, key, role] of slots) {
              const info = definition[key] ?? definition.pbrMetallicRoughness?.[key]; if (!info) continue;
              const texture = material[slot], texdef = expected.gltf.textures[info.index], sourceImage = texdef.source;
              const encoded = expected.textures.find(value => value.sourceImage === sourceImage && value.role === role);
              check(texture && encoded, 'Missing decoded PBR map: ' + slot);
              check(role === 'srgb' ? texture.colorSpace === three.SRGBColorSpace : [three.NoColorSpace, three.LinearSRGBColorSpace].includes(texture.colorSpace), 'Incorrect PBR colour space: ' + slot);
              const image = texture.image; check(image?.width === encoded.width && image.height === encoded.height, 'Decoded texture dimensions differ.');
              if (!textures.has(texture)) textures.set(texture, { role, sourceImage, encoding: encoded.encoding, expectedLevels: encoded.levels });
            }
          });
          check(parts.size === expected.geometry.length, 'A source primitive is missing.');
          const gl = renderer.getContext(); for (let i = 0; i < 32 && gl.getError() !== gl.NO_ERROR; i++) {}
          const preferred = new Set();
          for (const [texture, details] of textures) {
            const levels = texture.mipmaps?.length || 1;
            if (details.encoding === 'uastc-ktx2') {
              check(levels === details.expectedLevels, 'Preferred KTX2 mip chain differs.'); preferred.add(details.sourceImage);
              if (texture.isCompressedTexture) out.compressedPreferred++; else out.rgbaPreferredFallbacks++;
            }
            renderer.initTexture(texture); const error = gl.getError(); if (error !== gl.NO_ERROR) out.gpuErrors.push(error);
            out.textures.push({ ...details, width: texture.image.width, height: texture.image.height, levels, format: texture.format, type: texture.type, colorSpace: texture.colorSpace,
              compressed: !!texture.isCompressedTexture, dataTexture: !!texture.isDataTexture });
          }
          check(preferred.size === expected.textures.filter(value => value.encoding === 'uastc-ktx2').length, 'Not all preferred KTX2 images were exercised.');
          check(!out.gpuErrors.length && !gl.isContextLost(), 'Texture upload produced a WebGL error.');
          out.renderer = gl.getParameter(gl.RENDERER); out.passed = true;
        } catch (error) { out.error = String(error?.stack ?? error); }
        finally {
          clearTimeout(deadline); controller.abort(); pool?.dispose();
          if (gltf) {
            const geometry = new Set(), materials = new Set(), textures = new Set();
            for (const root of new Set([gltf.scene, ...gltf.scenes])) { root.traverse(node => { if (!node.isMesh) return; geometry.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material); }); root.clear(); }
            for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); material.dispose(); }
            for (const texture of textures) texture.dispose(); for (const value of geometry) value.dispose();
            out.cleanup.fixtureResourcesReleased = true;
          }
          if (pool) { await Promise.race([pool.whenIdle(), new Promise(resolve => setTimeout(resolve, 2500))]); out.cleanup.pool = { ...pool.stats }; }
          if (renderer) { renderer.dispose(); renderer.forceContextLoss(); out.cleanup.detachedContextReleased = true; }
        }
        return out;
      }, { factoryURL, threeURL: threeURL.href, modelURL: new URL(fixture.model, prefix).href, expected: fixture.expected, basePath: directory.pathname, timeoutMs }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Decoder probe page response timed out.')), timeoutMs + 10000); }),
    ]);
    for (const texture of fixture.expected.textures.filter(value => value.encoding === 'uastc-ktx2')) assert.ok(requests.some(request => request.file === texture.output), 'Preferred texture was not requested: ' + texture.output);
    report.passed = report.result.passed && blocked.length === 0;
  } catch (error) { report.error = String(error?.stack ?? error); }
  finally {
    clearTimeout(timer);
    try { await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 }); report.probeDocumentClosed = true; } catch (error) { report.cleanupError = String(error); report.passed = false; }
    try { await page.unroute(pattern, handler); report.routesRemoved = true; } catch (error) { report.cleanupError = String(error); report.passed = false; }
  }
  return report;
}
