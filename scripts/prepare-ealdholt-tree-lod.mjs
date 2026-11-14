// CPU-only original-face tree experiment. Inputs and runtime selections remain
// unchanged; the output must be a fresh private directory outside this repo.
import assert from 'node:assert/strict';
import { open, readFile, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const formats = { 5120: [1, 'readInt8'], 5121: [1, 'readUInt8'], 5122: [2, 'readInt16LE'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
async function fileHash(path) { const h = createHash('sha256'); for await (const bytes of createReadStream(path)) h.update(bytes); return h.digest('hex'); }
export async function readSource(path) {
  path = resolve(path); assert.equal(await realpath(path), path, 'source aliases refused'); assert.ok((await lstat(path)).isFile());
  const handle = await open(path, 'r'), header = Buffer.alloc(20); await handle.read(header, 0, 20, 0);
  assert.equal(header.readUInt32LE(0), 0x46546c67); assert.equal(header.readUInt32LE(4), 2); assert.equal(header.readUInt32LE(16), 0x4e4f534a);
  const text = Buffer.alloc(header.readUInt32LE(12)); await handle.read(text, 0, text.length, 20); const j = JSON.parse(text), binAt = 28 + text.length;
  const binHeader = Buffer.alloc(8); await handle.read(binHeader, 0, 8, 20 + text.length); assert.equal(binHeader.readUInt32LE(4), 0x004e4942);
  assert.equal(header.readUInt32LE(8), (await handle.stat()).size); assert.equal(j.buffers.length, 1); assert.ok(!j.buffers[0].uri);
  const cache = new Map();
  const view = async id => { if (!cache.has(id)) { const v = j.bufferViews[id]; assert.equal(v.buffer, 0); const b = Buffer.alloc(v.byteLength); const r = await handle.read(b, 0, b.length, binAt + (v.byteOffset ?? 0)); assert.equal(r.bytesRead, b.length); cache.set(id, b); } return cache.get(id); };
  const raw = async id => {
    const a = j.accessors[id], v = j.bufferViews[a.bufferView], [size] = formats[a.componentType] ?? [], width = widths[a.type]; assert.ok(size && width && !a.sparse);
    const bytes = await view(a.bufferView), stride = v.byteStride ?? size * width, start = a.byteOffset ?? 0, out = Buffer.alloc(a.count * size * width);
    assert.ok(start + (a.count - 1) * stride + size * width <= bytes.length);
    for (let i = 0; i < a.count; i++) bytes.copy(out, i * size * width, start + i * stride, start + i * stride + size * width); return out;
  };
  const values = async id => {
    const a = j.accessors[id], b = await raw(id), [size, read] = formats[a.componentType], out = new Float64Array(b.length / size);
    for (let i = 0; i < out.length; i++) { let value = b[read](i * size); if (a.normalized) value = Math.max(-1, value / ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] ?? 1)); assert.ok(Number.isFinite(value)); out[i] = value; } return out;
  };
  return { path, j, view, raw, values, close: () => handle.close() };
}
export function leafComponents(indices, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < indices.length; i += 3) { const a = find(indices[i]); parent[find(indices[i + 1])] = a; parent[find(indices[i + 2])] = a; }
  const groups = new Map(); for (let i = 0; i < indices.length; i += 3) { const key = find(indices[i]), group = groups.get(key) ?? []; group.push(i / 3); groups.set(key, group); } return [...groups.values()];
}
async function geometry(reader, meshId, primitiveId) {
  const primitive = reader.j.meshes[meshId].primitives[primitiveId]; assert.equal(primitive.mode ?? 4, 4); assert.ok(primitive.indices !== undefined && !primitive.targets && !primitive.extensions);
  const p = await reader.values(primitive.attributes.POSITION), indices = Uint32Array.from(await reader.values(primitive.indices)); assert.equal(indices.length % 3, 0);
  assert.ok([...indices].every(i => i >= 0 && i < p.length / 3));
  return { reader, primitive, p, indices, meshId, primitiveId, material: reader.j.materials[primitive.material] };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const length = Math.hypot(...a); return a.map(v => v / length); };
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
export function viewFrames(p, size) {
  const lo = [0, 1, 2].map(c => Math.min(...p.filter((_, i) => i % 3 === c))), hi = [0, 1, 2].map(c => Math.max(...p.filter((_, i) => i % 3 === c))), centre = lo.map((v, c) => (v + hi[c]) / 2), frames = [];
  for (const cameraHeight of [2, 18]) for (let direction = 0; direction < 8; direction++) {
    const azimuth = direction * Math.PI / 4, forward = normalize([20 * Math.sin(azimuth), cameraHeight - centre[1], 20 * Math.cos(azimuth)]), right = normalize(cross([0, 1, 0], forward)), up = cross(forward, right);
    const points = Array.from({ length: p.length / 3 }, (_, i) => [dot(p.slice(i * 3, i * 3 + 3), right), dot(p.slice(i * 3, i * 3 + 3), up)]);
    const min = [0, 1].map(c => Math.min(...points.map(v => v[c]))), max = [0, 1].map(c => Math.max(...points.map(v => v[c]))), span = Math.max(max[0] - min[0], max[1] - min[1]);
    frames.push({ cameraHeight, azimuthDegrees: direction * 45, right, up, centre2: min.map((v, c) => (v + max[c]) / 2), scale: (size - 8) / span, size });
  } return frames;
}
const decodedImages = new Map();
export function alphaAt(image, u, v, sampler = {}) {
  const wrap = (x, mode) => mode === 33071 ? Math.max(0, Math.min(1, x)) : mode === 33648 ? 1 - Math.abs(((x % 2) + 2) % 2 - 1) : ((x % 1) + 1) % 1;
  u = wrap(u, sampler.wrapS); v = wrap(v, sampler.wrapT);
  const x = u * image.width - 0.5, y = v * image.height - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const wrappedIndex = (i, length, mode) => { if (mode === 33071) return Math.max(0, Math.min(length - 1, i)); if (mode === 33648) { const at = ((i % (2 * length)) + 2 * length) % (2 * length); return at < length ? at : 2 * length - 1 - at; } return ((i % length) + length) % length; };
  const pixel = (px, py) => image.data[(wrappedIndex(py, image.height, sampler.wrapT) * image.width + wrappedIndex(px, image.width, sampler.wrapS)) * 4 + 3] / 255;
  return pixel(x0, y0) * (1 - fx) * (1 - fy) + pixel(x0 + 1, y0) * fx * (1 - fy) + pixel(x0, y0 + 1) * (1 - fx) * fy + pixel(x0 + 1, y0 + 1) * fx * fy;
}
async function alphaSampler(g, materialSource = g) {
  const material = materialSource.material, descriptor = material.pbrMetallicRoughness?.baseColorTexture, factor = material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
  assert.equal(material.alphaMode, 'MASK', 'leaf coverage requires the real masked material'); assert.ok(descriptor);
  const r = materialSource.reader, transform = descriptor.extensions?.KHR_texture_transform ?? {}, channel = transform.texCoord ?? descriptor.texCoord ?? 0;
  const uv = await g.reader.values(g.primitive.attributes[`TEXCOORD_${channel}`]), texture = r.j.textures[descriptor.index], imageId = texture.extensions?.EXT_texture_webp?.source ?? texture.source, key = r.path + ':' + imageId;
  if (!decodedImages.has(key)) { const original = r.j.images[imageId]; assert.ok(original.bufferView !== undefined && !original.uri); const result = await sharp(await r.view(original.bufferView)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); decodedImages.set(key, { width: result.info.width, height: result.info.height, data: result.data }); }
  const image = decodedImages.get(key), scale = transform.scale ?? [1, 1], offset = transform.offset ?? [0, 0], angle = transform.rotation ?? 0, sampler = r.j.samplers?.[texture.sampler] ?? {};
  const sample = (ids, bary) => {
    let u = 0, v = 0; for (let i = 0; i < 3; i++) { u += uv[ids[i] * 2] * bary[i]; v += uv[ids[i] * 2 + 1] * bary[i]; }
    const a = u * scale[0], b = v * scale[1]; return alphaAt(image, a * Math.cos(angle) - b * Math.sin(angle) + offset[0], a * Math.sin(angle) + b * Math.cos(angle) + offset[1], sampler) * factor >= (material.alphaCutoff ?? 0.5);
  };
  return { sample, imageWidth: image.width, imageHeight: image.height, channel, cutoff: material.alphaCutoff ?? 0.5 };
}
function project(p, frame) {
  const out = new Float64Array(p.length / 3 * 2);
  for (let i = 0; i < p.length / 3; i++) { const v = p.subarray(i * 3, i * 3 + 3); out[i * 2] = (dot(v, frame.right) - frame.centre2[0]) * frame.scale + frame.size / 2; out[i * 2 + 1] = (dot(v, frame.up) - frame.centre2[1]) * frame.scale + frame.size / 2; } return out;
}
function rasterTriangles(g, triangleIds, frame, coords, alpha, emit, already) {
  for (const triangle of triangleIds) {
    const ids = Array.from(g.indices.subarray(triangle * 3, triangle * 3 + 3)), [a, b, c] = ids.map(id => coords.subarray(id * 2, id * 2 + 2));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(den) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(frame.size - 1, Math.ceil(Math.max(a[0], b[0], c[0]))), minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(frame.size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const pixel = y * frame.size + x; if (already?.(pixel)) continue;
      const u = ((b[1] - c[1]) * (x + 0.5 - c[0]) + (c[0] - b[0]) * (y + 0.5 - c[1])) / den, v = ((c[1] - a[1]) * (x + 0.5 - c[0]) + (a[0] - c[0]) * (y + 0.5 - c[1])) / den, w = 1 - u - v;
      if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9 && alpha.sample(ids, [u, v, w])) emit(pixel);
    }
  }
}
async function raster(g, triangles, frames, materialSource = g) {
  const alpha = await alphaSampler(g, materialSource), size = frames[0].size, mask = new Uint8Array(frames.length * size * size);
  frames.forEach((frame, view) => { const offset = view * size * size; rasterTriangles(g, triangles, frame, project(g.p, frame), alpha, pixel => { mask[offset + pixel] = 1; }, pixel => mask[offset + pixel] !== 0); }); return { mask, alpha };
}
export function maskScores(source, candidate, frames) {
  const size = frames[0].size, pixels = size * size; return frames.map((frame, view) => {
    let before = 0, after = 0, intersection = 0, union = 0; for (let i = view * pixels; i < (view + 1) * pixels; i++) { before += source[i]; after += candidate[i]; intersection += source[i] && candidate[i] ? 1 : 0; union += source[i] || candidate[i] ? 1 : 0; }
    return { cameraHeight: frame.cameraHeight, azimuthDegrees: frame.azimuthDegrees, sourcePixels: before, candidatePixels: after, intersectionOverUnion: union ? intersection / union : 1, sourceCoverageRetained: before ? intersection / before : 1, addedPixelsOutsideSource: after - intersection };
  });
}
export function selectComponentCoverage(components, triangleBudget, weights, required = []) {
  const covered = new Uint8Array(weights.length), selected = new Set(), heap = []; let triangles = 0, epoch = 0;
  const better = (a, b) => a.score > b.score || a.score === b.score && a.id < b.id;
  const push = item => { heap.push(item); let at = heap.length - 1; while (at) { const parent = (at - 1) >> 1; if (!better(item, heap[parent])) break; heap[at] = heap[parent]; at = parent; } heap[at] = item; };
  const pop = () => { const result = heap[0], last = heap.pop(); if (heap.length) { let at = 0; while (true) { let child = at * 2 + 1; if (child >= heap.length) break; if (child + 1 < heap.length && better(heap[child + 1], heap[child])) child++; if (!better(heap[child], last)) break; heap[at] = heap[child]; at = child; } heap[at] = last; } return result; };
  const gain = component => { let value = 0; for (const pixel of component.pixels) if (!covered[pixel]) value += weights[pixel]; return value; };
  const take = id => { const component = components[id]; assert.ok(!selected.has(id) && triangles + component.triangles.length <= triangleBudget); selected.add(id); triangles += component.triangles.length; for (const pixel of component.pixels) covered[pixel] = 1; epoch++; };
  for (const id of new Set(required)) take(id);
  components.forEach((component, id) => { if (!selected.has(id)) push({ id, score: gain(component) / component.triangles.length, epoch }); });
  while (heap.length) {
    const item = pop(), component = components[item.id]; if (triangles + component.triangles.length > triangleBudget) continue;
    if (item.epoch !== epoch) { item.score = gain(component) / component.triangles.length; item.epoch = epoch; if (item.score > 0) push(item); continue; }
    if (item.score <= 0) break; take(item.id);
  }
  return { selected: [...selected].sort((a, b) => a - b), triangleIds: [...selected].flatMap(id => components[id].triangles).sort((a, b) => a - b), triangles, covered };
}
async function chooseLeaves(g, budget, materialSource = g) {
  const size = 256, frames = viewFrames(g.p, size), alpha = await alphaSampler(g, materialSource), coords = frames.map(frame => project(g.p, frame)), totalPixels = 16 * size * size, sourceMask = new Uint8Array(totalPixels);
  const groups = leafComponents(g.indices, g.p.length / 3), components = groups.map(triangles => ({ triangles, pixels: null }));
  for (const component of components) {
    const pixels = new Set(); frames.forEach((frame, view) => { const offset = view * size * size; rasterTriangles(g, component.triangles, frame, coords[view], alpha, pixel => pixels.add(offset + pixel), pixel => pixels.has(offset + pixel)); });
    component.pixels = Uint32Array.from([...pixels].sort((a, b) => a - b)); for (const pixel of component.pixels) sourceMask[pixel] = 1;
  }
  const weights = new Float64Array(totalPixels);
  for (let view = 0; view < 16; view++) {
    const offset = view * size * size, count = sourceMask.subarray(offset, offset + size * size).reduce((n, v) => n + v, 0);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const at = offset + y * size + x; if (!sourceMask[at]) continue; const boundary = x === 0 || y === 0 || x === size - 1 || y === size - 1 || !sourceMask[at - 1] || !sourceMask[at + 1] || !sourceMask[at - size] || !sourceMask[at + size]; weights[at] = (boundary ? 1.5 : 1) / Math.max(1, count); }
  }
  const componentByVertex = new Map(); components.forEach((component, id) => { for (const triangle of component.triangles) for (const index of g.indices.subarray(triangle * 3, triangle * 3 + 3)) componentByVertex.set(index, id); });
  const active = [...componentByVertex.keys()], required = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) { let best = active[0]; for (const index of active) if (sign * g.p[index * 3 + axis] > sign * g.p[best * 3 + axis]) best = index; required.push(componentByVertex.get(best)); }
  const selection = selectComponentCoverage(components, budget, weights, required);
  return { ...selection, components, weights, required: [...new Set(required)], method: 'Whole original indexed leaf components; six source geometric extrema mandatory; lazy greedy256px alpha-union gain per triangle, balanced across16views with1.5x silhouette-boundary weight. Finer selection avoids tiny-card grid overfit; no new triangles or vertex edits.', trainingCoverage: summary(maskScores(sourceMask, selection.covered, frames)) };
}
function leafArea(g, triangleIds) {
  let area = 0; for (const triangle of triangleIds) { const ids = g.indices.subarray(triangle * 3, triangle * 3 + 3), a = g.p.subarray(ids[0] * 3, ids[0] * 3 + 3), b = g.p.subarray(ids[1] * 3, ids[1] * 3 + 3), c = g.p.subarray(ids[2] * 3, ids[2] * 3 + 3); area += Math.hypot(...cross(b.map((v, i) => v - a[i]), c.map((v, i) => v - a[i]))) * 0.5; } return area;
}
function summary(scores) { return { minimumSourceCoverageRetained: Math.min(...scores.map(v => v.sourceCoverageRetained)), meanSourceCoverageRetained: scores.reduce((n, v) => n + v.sourceCoverageRetained, 0) / scores.length, minimumIntersectionOverUnion: Math.min(...scores.map(v => v.intersectionOverUnion)) }; }
async function qualifyFrames(original, desktop, native) {
  assert.equal(original.indices.length, desktop.indices.length, 'desktop original reference triangle count mismatch');
  assert.ok(original.indices.every((v, i) => v === desktop.indices[i]), 'desktop reference changed source topology');
  for (const [name, id] of Object.entries(original.primitive.attributes)) assert.ok((await original.reader.raw(id)).equals(await desktop.reader.raw(desktop.primitive.attributes[name])), `desktop reference changed original ${name}`);
  const uvOriginal = await original.reader.values(original.primitive.attributes.TEXCOORD_2), uvNative = await native.reader.values(native.primitive.attributes.TEXCOORD_2), originalVertices = new Set();
  for (let i = 0; i < original.p.length / 3; i++) originalVertices.add([...original.p.subarray(i * 3, i * 3 + 3), ...uvOriginal.subarray(i * 2, i * 2 + 2)].join(','));
  let exact = 0; for (let i = 0; i < native.p.length / 3; i++) if (originalVertices.has([...native.p.subarray(i * 3, i * 3 + 3), ...uvNative.subarray(i * 2, i * 2 + 2)].join(','))) exact++;
  assert.equal(exact, native.p.length / 3, 'Native vertices/UVs do not establish the exact original local frame');
  for (const node of native.reader.j.nodes.filter(n => n.mesh === native.meshId)) { assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, 'non-identity Native prototype frame requires explicit conversion'); }
  const a = original.material.pbrMetallicRoughness.baseColorTexture, b = native.material.pbrMetallicRoughness.baseColorTexture;
  assert.deepEqual({ ...a, index: 0 }, { ...b, index: 0 }, 'leaf UV transform/channel differs'); assert.equal(original.material.alphaCutoff, native.material.alphaCutoff);
  return { desktopOriginalAttributesAndIndicesExact: true, nativePositionAndUvVerticesMatchedExactly: exact, nativeLocalFrameIdentity: true, leafUvTransformChannelAndCutoffIdentical: true };
}
export async function buildNativeTreePrototype(raw, native, sourceMeshId, nativeMeshId, selectedTriangles) {
  const j = { asset: { version: '2.0', generator: 'Crownfall private original-leaf-component coverage LOD' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Forest05 coverage LOD private prototype', mesh: 0 }], meshes: [{ name: 'SM_BlackAlder_Forest_05_PP3_CoveragePrototype', primitives: [] }], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], materials: [], textures: [], samplers: [], images: [] }, chunks = []; let length = 0;
  const append = bytes => { const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; } const id = j.bufferViews.length; j.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); chunks.push(bytes); length += bytes.length; return id; };
  const texMap = new Map(), imageMap = new Map(), samplerMap = new Map(), imageProof = [], geometryProof = []; let sourceLeafVertexIds;
  async function copyImage(id) {
    if (imageMap.has(id)) return imageMap.get(id); const image = native.j.images[id]; assert.ok(!image.uri && image.bufferView !== undefined); const bytes = await native.view(image.bufferView), copied = { ...structuredClone(image), bufferView: append(bytes) }, at = j.images.length, meta = await sharp(bytes).metadata();
    imageMap.set(id, at); j.images.push(copied); imageProof.push({ sourceImage: id, outputImage: at, bytes: bytes.length, sha256: hash(bytes), width: meta.width, height: meta.height }); return at;
  }
  async function copyTexture(id) {
    if (texMap.has(id)) return texMap.get(id); const texture = structuredClone(native.j.textures[id]), at = j.textures.length; texMap.set(id, at); j.textures.push(texture);
    if (texture.source !== undefined) texture.source = await copyImage(texture.source);
    if (texture.extensions?.EXT_texture_webp) texture.extensions.EXT_texture_webp.source = await copyImage(texture.extensions.EXT_texture_webp.source);
    if (texture.sampler !== undefined) { if (!samplerMap.has(texture.sampler)) { samplerMap.set(texture.sampler, j.samplers.length); j.samplers.push(structuredClone(native.j.samplers[texture.sampler])); } texture.sampler = samplerMap.get(texture.sampler); } return at;
  }
  async function material(value) {
    if (!value || typeof value !== 'object') return value; if (Array.isArray(value)) return Promise.all(value.map(material)); const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = key.endsWith('Texture') && Number.isInteger(child?.index) ? { ...structuredClone(child), index: await copyTexture(child.index) } : await material(child); return out;
  }
  for (const p of native.j.meshes[nativeMeshId].primitives) j.materials.push(await material(native.j.materials[p.material]));
  for (let component = 0; component < 3; component++) {
    const reader = component === 1 ? raw : native, source = reader.j.meshes[component === 1 ? sourceMeshId : nativeMeshId].primitives[component], attributes = {}, indices = Uint32Array.from(await reader.values(source.indices));
    const chosen = component === 1 ? selectedTriangles.flatMap(t => Array.from(indices.subarray(t * 3, t * 3 + 3))) : Array.from(indices), remap = new Map(); for (const id of chosen) if (!remap.has(id)) remap.set(id, remap.size);
    const sourceIds = [...remap.keys()], proof = { component, role: ['Native bark unchanged', 'Original leaf components selected', 'Native decoration unchanged'][component], triangles: chosen.length / 3, attributes: {} };
    if (component === 1) { assert.ok(remap.size <= 65535); sourceLeafVertexIds = sourceIds; }
    for (const [name, id] of Object.entries(source.attributes)) {
      const a = reader.j.accessors[id], bytes = await reader.raw(id), stride = widths[a.type] * formats[a.componentType][0], out = component === 1 ? Buffer.concat(sourceIds.map(i => bytes.subarray(i * stride, (i + 1) * stride))) : bytes;
      const definition = { ...structuredClone(a), bufferView: append(out), byteOffset: 0, count: component === 1 ? sourceIds.length : a.count }; delete definition.min; delete definition.max;
      if (name === 'POSITION') { const p = await reader.values(id), used = component === 1 ? sourceIds : Array.from({ length: a.count }, (_, i) => i); definition.min = [0, 1, 2].map(c => Math.min(...used.map(i => p[i * 3 + c]))); definition.max = [0, 1, 2].map(c => Math.max(...used.map(i => p[i * 3 + c]))); }
      attributes[name] = j.accessors.length; j.accessors.push(definition); proof.attributes[name] = { sourceAccessor: id, bytes: out.length, sha256: hash(out), sourceValuesExact: true };
    }
    let indexBytes, indexDefinition;
    if (component === 1) { indexBytes = Buffer.alloc(chosen.length * 2); chosen.forEach((v, i) => indexBytes.writeUInt16LE(remap.get(v), i * 2)); indexDefinition = { componentType: 5123, count: chosen.length, type: 'SCALAR' }; }
    else { indexBytes = await reader.raw(source.indices); indexDefinition = { ...structuredClone(reader.j.accessors[source.indices]) }; }
    indexDefinition.bufferView = append(indexBytes); indexDefinition.byteOffset = 0; const indexId = j.accessors.length; j.accessors.push(indexDefinition); j.meshes[0].primitives.push({ attributes, indices: indexId, material: component }); proof.indexSha256 = hash(indexBytes); geometryProof.push(proof);
  }
  const extensions = new Set(); const visit = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (key === 'extensions') for (const name of Object.keys(child)) extensions.add(name); visit(child); } }; visit(j.materials); visit(j.textures); if (extensions.size) j.extensionsUsed = [...extensions].sort();
  const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; } j.buffers[0].byteLength = length;
  const text0 = Buffer.from(JSON.stringify(j)), text = Buffer.concat([text0, Buffer.alloc((4 - text0.length % 4) % 4, 32)]), binary = Buffer.concat(chunks), bytes = Buffer.alloc(28 + text.length + binary.length), at = 20 + text.length;
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(text.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); text.copy(bytes, 20); bytes.writeUInt32LE(binary.length, at); bytes.writeUInt32LE(0x004e4942, at + 4); binary.copy(bytes, at + 8);
  return { bytes, geometryProof, imageProof, textureRgbaMipBytes: imageProof.reduce((n, i) => n + Math.ceil(i.width * i.height * 4 * 4 / 3), 0), sourceLeafVertexIds };
}
async function alphaArea(g, triangles, materialSource = g) {
  const alpha = await alphaSampler(g, materialSource); let total = 0;
  for (const triangle of triangles) { const ids = Array.from(g.indices.subarray(triangle * 3, triangle * 3 + 3)); let passing = 0; for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) { const a = Math.sqrt((i + 0.5) / 6), b = (k + 0.5) / 6; if (alpha.sample(ids, [1 - a, a * (1 - b), a * b])) passing++; } total += leafArea(g, [triangle]) * passing / 36; } return total;
}
async function freshPrivateDirectory(path) {
  path = resolve(path); assert.ok(path !== repository && !path.startsWith(repository + '/'), 'output must stay outside the public repository');
  assert.equal(await realpath(dirname(path)), dirname(path), 'output parent aliases refused'); let exists = false; try { await lstat(path); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; } assert.ok(!exists, 'fresh private output directory required'); return path;
}
export async function prepareTreeLod({ sourcePath, desktopPath, nativePath, referencePath, outputPath, leafBudget = 1500 }) {
  assert.ok(Number.isInteger(leafBudget) && leafBudget >= 1000 && leafBudget <= 1500, 'bounded upper experiment must be1000–1500leaf triangles');
  const output = await freshPrivateDirectory(outputPath), readers = await Promise.all([sourcePath, desktopPath, nativePath, referencePath].map(readSource));
  const [raw, desktop, native, reference] = readers;
  try {
    const sources = await Promise.all(readers.map(async reader => ({ path: reader.path, bytes: (await lstat(reader.path)).size, sha256: await fileHash(reader.path) })));
    const findMesh = (reader, name) => { const matches = reader.j.meshes.map((m, i) => m.name === name ? i : -1).filter(i => i >= 0); assert.equal(matches.length, 1, 'exact source family identity required'); return matches[0]; };
    const rawId = findMesh(raw, 'SM_BlackAlder_Forest_05_PP3'), desktopId = findMesh(desktop, 'SM_BlackAlder_Forest_05_PP3_ExteriorPrototype'), nativeId = findMesh(native, 'SM_BlackAlder_Forest_05_PP3');
    const original = await geometry(raw, rawId, 1), desktopLeaf = await geometry(desktop, desktopId, 1), baseline = await geometry(native, nativeId, 1), referenceLeaf = await geometry(reference, 0, 1);
    const frameProof = await qualifyFrames(original, desktopLeaf, baseline), referenceProof = await qualifyFrames(original, referenceLeaf, baseline);
    assert.equal(original.indices.length / 3, 8345); assert.equal(baseline.indices.length / 3, 200);
    const selection = await chooseLeaves(original, leafBudget, baseline), low = selectComponentCoverage(selection.components, 500, selection.weights, selection.required), frames = viewFrames(original.p, 192);
    const allOriginal = Array.from({ length: original.indices.length / 3 }, (_, i) => i), allNative = Array.from({ length: baseline.indices.length / 3 }, (_, i) => i);
    const [sourceOwn, sourceNativeMaps, current, highCoverage, lowCoverage] = await Promise.all([raster(original, allOriginal, frames), raster(original, allOriginal, frames, baseline), raster(baseline, allNative, frames), raster(original, selection.triangleIds, frames, baseline), raster(original, low.triangleIds, frames, baseline)]);
    const baselineScores = maskScores(sourceNativeMaps.mask, current.mask, frames), upperScores = maskScores(sourceNativeMaps.mask, highCoverage.mask, frames), lowScores = maskScores(sourceNativeMaps.mask, lowCoverage.mask, frames);
    const baseSummary = summary(baselineScores), upperSummary = summary(upperScores), lowSummary = summary(lowScores);
    const lowMeaningful = lowSummary.minimumSourceCoverageRetained >= 0.70 && lowSummary.meanSourceCoverageRetained - baseSummary.meanSourceCoverageRetained >= 0.20;
    const chosen = lowMeaningful ? low : selection, chosenCoverage = lowMeaningful ? lowCoverage : highCoverage, chosenScores = lowMeaningful ? lowScores : upperScores, chosenSummary = lowMeaningful ? lowSummary : upperSummary;
    const accepted = chosenSummary.minimumSourceCoverageRetained >= 0.70 && chosenSummary.meanSourceCoverageRetained - baseSummary.meanSourceCoverageRetained >= 0.20;
    const [sourceArea, commonArea, nativeArea, selectedArea] = await Promise.all([alphaArea(original, allOriginal), alphaArea(original, allOriginal, baseline), alphaArea(baseline, allNative), alphaArea(original, chosen.triangleIds, baseline)]);
    const nativeTriangles = native.j.meshes[nativeId].primitives.map(p => native.j.accessors[p.indices].count / 3), triangles = nativeTriangles[0] + chosen.triangles + nativeTriangles[2], delta = chosen.triangles - nativeTriangles[1];
    const report = { privateOnly: true, acceptedByCpuCoverageGate: accepted, gate: 'All16 views retain>=70% source alpha coverage using identical Native maps; mean gain>=20 percentage points over current Native geometry. Proxy only, not a visual or performance acceptance.', family: 'SM_BlackAlder_Forest_05_PP3', sources, frameProof, referenceProof, selection: { method: selection.method, upperLeafBudget: leafBudget, upperActualLeafTriangles: selection.triangles, chosenLeafTriangles: chosen.triangles, chosenConnectedComponents: chosen.selected.length, originalConnectedComponents: selection.components.length, mandatoryExtremaComponents: selection.required, trainingCoverage: selection.trainingCoverage, sourceTriangleIds: chosen.triangleIds, leafIndicesOnlyFromOriginalFaces: true }, comparison: { method: 'CPU two-sided alpha-tested orthographic union, bilinear base-level alpha, source UV2/transforms/cutoff;8azimuths × cameraheights2m/18m at20m radius;192px validation independent of256px selection. No wind, depth, lighting, minified GPU derivatives or actual headset view.', fullSourceGeometryWithNativeMaps: { referenceTriangleCount: original.indices.length / 3, imageDimensions: [sourceNativeMaps.alpha.imageWidth, sourceNativeMaps.alpha.imageHeight] }, currentNative: { ...baseSummary, views: baselineScores }, upperExperiment: { ...upperSummary, leafTriangles: selection.triangles, views: upperScores }, lowCostDiagnostic: { ...lowSummary, leafTriangles: low.triangles, meaningfulGatePassed: lowMeaningful, emittedAsSeparateModel: false, views: lowScores }, candidate: { ...chosenSummary, views: chosenScores }, versusFullOriginalMapReference: { ...summary(maskScores(sourceOwn.mask, chosenCoverage.mask, frames)), views: maskScores(sourceOwn.mask, chosenCoverage.mask, frames) } }, surfaces: { method: 'Area weighted by36 deterministic alpha samples per triangle; base-level bilinear alpha; estimates only.', originalRawWithOriginalMapsSquareMetres: sourceArea, originalRawWithNativeMapsSquareMetres: commonArea, nativeCurrentSquareMetres: nativeArea, candidateSquareMetres: selectedArea, candidateRetentionAgainstSameMapOriginal: selectedArea / commonArea }, cost: { currentPerTreeTriangles: nativeTriangles.reduce((n, v) => n + v, 0), candidatePerTreeTriangles: triangles, currentBarkLeafDecoration: nativeTriangles, candidateBarkLeafDecoration: [nativeTriangles[0], chosen.triangles, nativeTriangles[2]], drawsPerTree: 3, sharedGeometryTriangleIncrease: delta, exterior56ActorTriangleIncrease: delta * 56, embeddedSixPlusMediumFiveIfAlsoReplacedTriangleIncrease: delta * 11, hypotheticalCombined67ActorTriangleIncrease: delta * 67, currentWholeProfileAlreadyOver250k: true, actualActorIntegrationAndFrustumQualificationPerformed: false }, preservation: { nativeBarkAndDecorationExact: true, nativeMaterialsMapsAndSamplersUnchangedExceptLocalIndexRemap: true, originalLeafPositionNormalTangentAndAllUvValuesExact: true, originalActorPositionsVillagePondProtectedHeroesAndSelectedRuntimeFileUnchanged: true }, limits: ['CPU alpha-union proxy can preserve silhouette while losing internal leaf layering; GPU material/clay review remains required.', 'Native256px leaf alpha and ordinary mip-chain collapse remain unchanged; base-level improvement does not prove distant canopy density.', 'Upper1000–1500leaf test is not a deployment default;56x/67x cost must be reconciled against the already-exceeded whole-frame budget.', 'No runtime selection, environment/probe hash change, GPU or public binary output.'] };
    await mkdir(output, { mode: 0o700 });
    if (accepted) {
      const artifact = await buildNativeTreePrototype(raw, native, rawId, nativeId, chosen.triangleIds), path = resolve(output, 'forest05-native-coverage-candidate.glb'); await writeFile(path, artifact.bytes, { flag: 'wx', mode: 0o600 });
      Object.assign(report, { artifact: { path, bytes: artifact.bytes.length, sha256: hash(artifact.bytes) }, geometryProof: artifact.geometryProof, imageProof: artifact.imageProof, sourceLeafVertexIds: artifact.sourceLeafVertexIds }); report.cost.textureRgba8WithMipsEstimate = artifact.textureRgbaMipBytes;
    } else report.artifact = null;
    for (const source of sources) assert.equal(await fileHash(source.path), source.sha256, 'immutable source changed');
    const path = resolve(output, 'tree-lod-provenance.json'); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { reportPath: path, ...report };
  } finally { await Promise.all(readers.map(reader => reader.close())); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = new Map(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  prepareTreeLod({ sourcePath: args.get('--source'), desktopPath: args.get('--desktop'), nativePath: args.get('--native'), referencePath: args.get('--reference'), outputPath: args.get('--output'), leafBudget: Number(args.get('--leaf-triangles') ?? 1500) }).then(report => console.log(JSON.stringify({ reportPath: report.reportPath, accepted: report.acceptedByCpuCoverageGate, artifact: report.artifact, candidate: report.comparison.candidate, surfaces: report.surfaces, cost: report.cost }, null, 2))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
