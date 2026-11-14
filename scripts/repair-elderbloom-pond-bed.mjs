// Offline, private derivative repair. No source geometry arrays are embedded.
// Only dense low-LOD terrain Y inside the verified reference's wet pond surface
// and coherent incident normals may change. Water, X/Z, actors, topology,
// material/texture bytes and outside positions stay unchanged.
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, mkdir, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const require = createRequire(new URL('../main game/package.json', import.meta.url));
const { Matrix4, Quaternion, Vector3 } = require('three');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const POND_REPAIR_STRUCTURE = Object.freeze({
  terrainComponents: 1, referenceTerrainComponents: 64,
});
// Source identities belong in the operator's private configuration, never in
// repository defaults. Computing a file's hash here must not authorize it.
function requirePondRepairIdentity(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)
    || typeof expected.inputSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expected.inputSha256)
    || typeof expected.referenceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expected.referenceSha256)) {
    throw Error('Explicit expected input/reference SHA-256 identities are required (64 hexadecimal characters each).');
  }
  const result = { ...POND_REPAIR_STRUCTURE, ...expected,
    inputSha256: expected.inputSha256.toLowerCase(), referenceSha256: expected.referenceSha256.toLowerCase() };
  if (![result.terrainComponents, result.referenceTerrainComponents].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw Error('Expected terrain component counts must be positive safe integers.');
  }
  return result;
}

export function decodePondRepairGlb(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 28 || bytes.length > 256 * 1024 * 1024
    || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Expected a complete optimized GLB2 smaller than256MiB.');
  const length = bytes.readUInt32LE(12), header = 20 + length;
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || header + 8 > bytes.length || bytes.readUInt32LE(header + 4) !== 0x004e4942 || header + 8 + bytes.readUInt32LE(header) !== bytes.length) throw Error('Expected embedded JSON and BIN chunks.');
  const json = JSON.parse(bytes.subarray(20, header).toString('utf8')), bin = bytes.subarray(header + 8);
  if (json.buffers?.length !== 1 || json.buffers[0].uri || json.buffers[0].byteLength > bin.length) throw Error('Expected one embedded source buffer.');
  return { json, bin };
}
function encode(json, bin) {
  const raw = Buffer.from(JSON.stringify(json)), text = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]), header = Buffer.alloc(20), binary = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + bin.length, 8); header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binary.writeUInt32LE(bin.length); binary.writeUInt32LE(0x004e4942, 4); return Buffer.concat([header, text, binary, bin]);
}
function accessor(g, id, vector = true) {
  const a = g.json.accessors?.[id], v = g.json.bufferViews?.[a?.bufferView], sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, size = sizes[a?.componentType], width = vector ? 3 : 1;
  if (!a || !v || v.buffer !== 0 || a.sparse || a.normalized || !Number.isInteger(a.count) || a.count < 1 || !size || (vector ? a.type !== 'VEC3' || a.componentType !== 5126 : a.type !== 'SCALAR' || a.componentType === 5126)) throw Error('Unsupported dense terrain accessor.');
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? size * width;
  if (stride < width * size || offset + (a.count - 1) * stride + width * size > (v.byteOffset ?? 0) + v.byteLength || (v.byteOffset ?? 0) + v.byteLength > g.bin.length) throw Error('Accessor exceeds its source view.');
  return { id, a, offset, stride, width, size, read(i, c = 0) { const at = offset + i * stride + c * size; return vector ? g.bin.readFloatLE(at) : size === 1 ? g.bin.readUInt8(at) : size === 2 ? g.bin.readUInt16LE(at) : g.bin.readUInt32LE(at); } };
}
function local(node) { return node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(node.scale ?? [1, 1, 1])); }
function placed(g) {
  const nodes = [];
  function visit(id, parent, ancestry) {
    if (ancestry.has(id)) throw Error('Cyclic source hierarchy.');
    const n = g.json.nodes[id]; if (!n) throw Error('Missing source node.');
    const world = parent.clone().multiply(local(n));
    if (n.mesh !== undefined) nodes.push({ id, node: n, meshId: n.mesh, mesh: g.json.meshes[n.mesh], world });
    const next = new Set(ancestry); next.add(id); for (const child of n.children ?? []) visit(child, world, next);
  }
  for (const id of g.json.scenes[g.json.scene ?? 0].nodes ?? []) visit(id, new Matrix4(), new Set()); return nodes;
}
function terrain(g, expected) {
  const nodes = placed(g).filter(n => /^LandscapeComponent_\d+(?:_\d+)?$/.test(n.mesh?.name ?? ''));
  if (nodes.length !== expected) throw Error('Unrecognized landscape component count.');
  const groups = [], meshIds = new Set(nodes.map(n => n.meshId));
  for (const node of nodes) {
    if (g.json.nodes.filter(n => n.mesh === node.meshId).length !== 1 || node.node.extensions?.EXT_mesh_gpu_instancing) throw Error('Shared or instanced terrain needs a different repair.');
    const w = node.world.elements;
    if (Math.abs(w[4]) > 1e-8 || Math.abs(w[6]) > 1e-8 || w[5] <= 0 || !w.every(Number.isFinite)) throw Error('Unsupported terrain vertical transform.');
    const byAttribute = new Map();
    for (const p of node.mesh.primitives) {
      if ((p.mode ?? 4) !== 4 || p.targets?.length || p.attributes.TANGENT !== undefined || !g.json.materials[p.material]?.name?.startsWith('Crownfall_LAAS_')) throw Error('Unrecognized reconstructed triangle terrain.');
      const positions = accessor(g, p.attributes.POSITION), normals = accessor(g, p.attributes.NORMAL), indices = accessor(g, p.indices, false);
      if (positions.a.count !== normals.a.count || indices.a.count % 3) throw Error('Inconsistent terrain attributes.');
      const key = positions.id + ':' + normals.id; let group = byAttribute.get(key);
      if (!group) { group = { ...node, positions, normals, faces: [], vertices: [] }; byAttribute.set(key, group); groups.push(group); }
      for (let i = 0; i < indices.a.count; i += 3) { const face = [indices.read(i), indices.read(i + 1), indices.read(i + 2)]; if (face.some(i => i >= positions.a.count)) throw Error('Terrain index out of bounds.'); group.faces.push(face); }
    }
  }
  return { groups, meshIds };
}
function triangles(g, node, primitive) {
  const p = accessor(g, primitive.attributes.POSITION), indices = accessor(g, primitive.indices, false), points = [];
  for (let i = 0; i < p.a.count; i++) points.push(new Vector3(p.read(i, 0), p.read(i, 1), p.read(i, 2)).applyMatrix4(node.world).toArray());
  const result = []; for (let i = 0; i < indices.a.count; i += 3) result.push([points[indices.read(i)], points[indices.read(i + 1)], points[indices.read(i + 2)]]); return result;
}
function height(tris, x, z) {
  let top = null;
  for (const [a, b, c] of tris) {
    if (x < Math.min(a[0], b[0], c[0]) - 1e-6 || x > Math.max(a[0], b[0], c[0]) + 1e-6 || z < Math.min(a[2], b[2], c[2]) - 1e-6 || z > Math.max(a[2], b[2], c[2]) + 1e-6) continue;
    const dx1 = b[0] - a[0], dz1 = b[2] - a[2], dx2 = c[0] - a[0], dz2 = c[2] - a[2], d = dx1 * dz2 - dx2 * dz1;
    if (Math.abs(d) < 1e-10) continue;
    const u = ((x - a[0]) * dz2 - (z - a[2]) * dx2) / d, v = (dx1 * (z - a[2]) - dz1 * (x - a[0])) / d;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]); if (top === null || y > top) top = y;
  }
  return top;
}
function pond(g) {
  const result = [];
  for (const n of placed(g)) for (const p of n.mesh.primitives) if (g.json.materials[p.material]?.name === 'Crownfall_Pond_Water_Review') {
    if (n.node.extensions?.EXT_mesh_gpu_instancing || (p.mode ?? 4) !== 4) throw Error('Unrecognized pond placement.'); result.push(...triangles(g, n, p));
  }
  if (!result.length) throw Error('Verified pond surface unavailable.'); return result;
}
const vertexKey = p => p.map(v => Math.round(v * 1e5)).join(':');

export function repairElderbloomPondBedYOnly(inputBytes, referenceBytes, expected) {
  expected = requirePondRepairIdentity(expected);
  if (hash(inputBytes) !== expected.inputSha256 || hash(referenceBytes) !== expected.referenceSha256) throw Error('Unknown input/reference hashes; source inspection is required.');
  const input = decodePondRepairGlb(inputBytes), reference = decodePondRepairGlb(referenceBytes);
  if (input.json.asset?.extras?.crownfallPondBedRepair) throw Error('Pond bed is already repaired.');
  const output = { json: structuredClone(input.json), bin: Buffer.from(input.bin) }, low = terrain(input, expected.terrainComponents), high = terrain(reference, expected.referenceTerrainComponents ?? expected.terrainComponents);
  const lowWater = pond(input), highWater = pond(reference), wetBounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const tri of lowWater) for (const p of tri) { wetBounds.minX = Math.min(wetBounds.minX, p[0]); wetBounds.maxX = Math.max(wetBounds.maxX, p[0]); wetBounds.minZ = Math.min(wetBounds.minZ, p[2]); wetBounds.maxZ = Math.max(wetBounds.maxZ, p[2]); }
  const referenceTriangles = [];
  for (const group of high.groups) {
    const p = group.positions, vertices = Array.from({ length: p.a.count }, (_, i) => new Vector3(p.read(i, 0), p.read(i, 1), p.read(i, 2)).applyMatrix4(group.world).toArray());
    for (const face of group.faces) { const tri = face.map(i => vertices[i]); if (Math.max(...tri.map(p => p[0])) >= wetBounds.minX && Math.min(...tri.map(p => p[0])) <= wetBounds.maxX && Math.max(...tri.map(p => p[2])) >= wetBounds.minZ && Math.min(...tri.map(p => p[2])) <= wetBounds.maxZ) referenceTriangles.push(tri); }
  }
  const records = new Map(), changed = new Set(), changes = [], allowed = [], positionIds = new Set(), normalIds = new Set();
  let lowered = 0, raised = 0, maximumWorldYChange = 0;
  for (const group of low.groups) {
    const p = group.positions, w = group.world.elements;
    if (group.world.determinant() <= 0) throw Error('Reflected terrain needs a different normal repair.');
    for (let i = 0; i < p.a.count; i++) {
      const id = p.id + ':' + i, localPoint = [p.read(i, 0), p.read(i, 1), p.read(i, 2)];
      const world = new Vector3(...localPoint).applyMatrix4(group.world).toArray(); let record = records.get(id);
      if (record) { if (world.some((n, c) => Math.abs(n - record.before[c]) > 1e-7)) throw Error('Position accessor is shared across distinct source frames.'); }
      else {
        record = { id, index: i, accessor: p, before: [...world], world, changed: false }; records.set(id, record);
        if (world[0] >= wetBounds.minX && world[0] <= wetBounds.maxX && world[2] >= wetBounds.minZ && world[2] <= wetBounds.maxZ) {
          const surface = height(lowWater, world[0], world[2]), referenceSurface = height(highWater, world[0], world[2]);
          if (surface !== null && referenceSurface !== null) {
            const bed = height(referenceTriangles, world[0], world[2]);
            if (bed === null) throw Error('Reference bed does not support an actual pond vertex.');
            if (bed < Math.min(surface, referenceSurface) - .005 && Math.abs(world[1] - bed) > .0005) {
              if (Math.abs(world[1] - bed) > .3) throw Error('Pond bed deviation exceeds the reviewed LOD error envelope.');
              const nextY = Math.fround((bed - w[1] * localPoint[0] - w[9] * localPoint[2] - w[13]) / w[5]);
              const offset = p.offset + i * p.stride + 4; output.bin.writeFloatLE(nextY, offset);
              const nextWorld = new Vector3(localPoint[0], nextY, localPoint[2]).applyMatrix4(group.world).toArray();
              const delta = nextWorld[1] - world[1]; if (delta < 0) lowered++; else raised++; maximumWorldYChange = Math.max(maximumWorldYChange, Math.abs(delta));
              record.world = nextWorld; record.changed = true; changed.add(id); positionIds.add(p.id);
              allowed.push({ offset, length: 4, kind: 'POSITION_Y', accessor: p.id, vertex: i }); changes.push({ accessor: p.id, vertex: i, sourceXZ: [world[0], world[2]], previousWorldY: world[1], referenceWorldY: bed, repairedWorldY: nextWorld[1] });
            }
          }
        }
      }
      group.vertices.push(record);
    }
  }
  if (!changed.size) throw Error('No measured in-footprint bed defect to repair.');
  const affectedKeys = new Set(), normalUsers = new Map();
  for (const group of low.groups) for (const face of group.faces) if (face.some(i => group.vertices[i].changed)) for (const i of face) affectedKeys.add(vertexKey(group.vertices[i].world));
  const sums = new Map([...affectedKeys].map(key => [key, [0, 0, 0]]));
  for (const group of low.groups) for (const face of group.faces) {
    const [a, b, c] = face.map(i => group.vertices[i].world), ab = b.map((n, i) => n - a[i]), ac = c.map((n, i) => n - a[i]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    for (const i of face) { const sum = sums.get(vertexKey(group.vertices[i].world)); if (sum) for (let c = 0; c < 3; c++) sum[c] += normal[c]; }
  }
  const normalWrites = new Set();
  for (const group of low.groups) for (let i = 0; i < group.vertices.length; i++) {
    const key = vertexKey(group.vertices[i].world), id = group.normals.id + ':' + i, before = normalUsers.get(id);
    if (before && before !== key) throw Error('Normal accessor is shared across distinct source vertices.'); normalUsers.set(id, key);
    const sum = sums.get(key); if (!sum || normalWrites.has(id)) continue;
    const w = group.world.elements, local = [w[0] * sum[0] + w[1] * sum[1] + w[2] * sum[2], w[4] * sum[0] + w[5] * sum[1] + w[6] * sum[2], w[8] * sum[0] + w[9] * sum[1] + w[10] * sum[2]], length = Math.hypot(...local);
    if (!(length > 1e-10)) throw Error('Affected normal has no coherent supporting faces.');
    const offset = group.normals.offset + i * group.normals.stride; for (let c = 0; c < 3; c++) output.bin.writeFloatLE(local[c] / length, offset + c * 4);
    normalWrites.add(id); normalIds.add(group.normals.id); allowed.push({ offset, length: 12, kind: 'INCIDENT_NORMAL', accessor: group.normals.id, vertex: i });
  }
  const bytesAllowed = new Set(allowed.flatMap(r => Array.from({ length: r.length }, (_, i) => r.offset + i)));
  for (let meshId = 0; meshId < input.json.meshes.length; meshId++) for (const p of input.json.meshes[meshId].primitives) for (const [semantic, id] of Object.entries(p.attributes)) {
    if (positionIds.has(id) && (!low.meshIds.has(meshId) || semantic !== 'POSITION') || normalIds.has(id) && (!low.meshIds.has(meshId) || semantic !== 'NORMAL')) throw Error('Edited accessors are shared with an unrelated source binding.');
  }
  const changedIds = new Set([...positionIds, ...normalIds]), widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }, sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  for (let id = 0; id < input.json.accessors.length; id++) {
    if (changedIds.has(id)) continue; const a = input.json.accessors[id], v = input.json.bufferViews[a.bufferView]; if (!v || !allowed.some(r => r.offset < (v.byteOffset ?? 0) + v.byteLength && r.offset + r.length > (v.byteOffset ?? 0))) continue;
    const width = widths[a.type], size = sizes[a.componentType], stride = v.byteStride ?? width * size, offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (!width || !size || a.sparse) throw Error('Unknown accessor overlaps the repair region.');
    for (let i = 0; i < a.count; i++) for (let k = 0; k < width * size; k++) if (bytesAllowed.has(offset + i * stride + k)) throw Error('Edited byte range overlaps a shared unrelated accessor.');
  }
  for (const image of input.json.images ?? []) { const v = input.json.bufferViews[image.bufferView]; if (v && allowed.some(r => r.offset < (v.byteOffset ?? 0) + v.byteLength && r.offset + r.length > (v.byteOffset ?? 0))) throw Error('Geometry edits overlap an image region.'); }
  for (const id of changedIds) {
    const a = output.json.accessors[id], values = accessor(output, id); if (!a.min || !a.max) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) { const n = values.read(i, c); min[c] = Math.min(min[c], n); max[c] = Math.max(max[c], n); }
    if (positionIds.has(id)) { a.min[1] = min[1]; a.max[1] = max[1]; } else { a.min = min; a.max = max; }
  }
  let changedBinaryBytes = 0; for (let i = 0; i < input.bin.length; i++) if (input.bin[i] !== output.bin[i]) { if (!bytesAllowed.has(i)) throw Error('Unapproved binary change.'); changedBinaryBytes++; }
  output.json.asset.extras = { ...output.json.asset.extras, crownfallPondBedRepair: { generator: 'scripts/repair-elderbloom-pond-bed.mjs', inputSha256: expected.inputSha256, referenceSha256: expected.referenceSha256, method: 'Reference triangle heights inside the original wet pond footprint; welded incident-face normals', changedPositionVertices: changed.size, sourceGeometryAndWaterUnchanged: true } };
  const bytes = encode(output.json, output.bin);
  return { bytes, report: { inputSha256: expected.inputSha256, referenceSha256: expected.referenceSha256, outputSha256: hash(bytes), changedPositionVertices: changed.size, lowered, raised, maximumWorldYChange, changedNormalVertices: normalWrites.size, changedBinaryBytes, originalBinaryBytes: input.bin.length, outputBinaryBytes: output.bin.length, geometryCountUnchanged: true, gpuGeometryBytesUnchanged: true, actorTransformsUnchanged: true, waterMaterialsTexturesAndTopologyUnchanged: true, outsideFootprintPositionsByteExact: true, normalScope: 'Changed faces plus their incident welded vertices; may include a one-ring outside the Y-edit footprint', allowedBinaryRegions: allowed, positionChanges: changes } };
}

function hull(points) {
  const unique = new Map(points.map(p => [p[0].toFixed(6) + ':' + p[2].toFixed(6), [p[0], p[2]]])), sorted = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), lo = [], hi = [];
  for (const p of sorted) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 1e-9) lo.pop(); lo.push(p); }
  for (const p of sorted.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), p) <= 1e-9) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
function polygonInside(p, edges, epsilon = 1e-6) { return edges.every((a, i) => { const b = edges[(i + 1) % edges.length]; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -epsilon; }); }
function clipPiece(poly, a, b, inside) {
  const result = [], distance = p => ((b[0] - a[0]) * (p.z - a[1]) - (b[1] - a[1]) * (p.x - a[0])) * (inside ? 1 : -1);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = distance(p), dq = distance(q), keepP = dp >= 0, keepQ = dq >= 0;
    if (keepP) result.push(p);
    if (keepP !== keepQ) { const t = dp / (dp - dq); result.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, weights: p.weights.map((v, c) => v + (q.weights[c] - v) * t) }); }
  }
  return result.filter((p, i) => Math.hypot(p.x - result[(i + result.length - 1) % result.length].x, p.z - result[(i + result.length - 1) % result.length].z) > 1e-7);
}
function splitPolygon(poly, edges) {
  const outside = []; let remainder = poly;
  for (let i = 0; i < edges.length && remainder.length >= 3; i++) { const next = edges[(i + 1) % edges.length], piece = clipPiece(remainder, edges[i], next, false); if (piece.length >= 3) outside.push(piece); remainder = clipPiece(remainder, edges[i], next, true); }
  return { outside, inside: remainder };
}

function subdividePondBed(inputBytes, referenceBytes, expected) {
  if (hash(inputBytes) !== expected.inputSha256 || hash(referenceBytes) !== expected.referenceSha256) throw Error('Unknown input/reference hashes; source inspection is required.');
  const input = decodePondRepairGlb(inputBytes), reference = decodePondRepairGlb(referenceBytes), output = structuredClone(input.json), low = terrain(input, expected.terrainComponents), high = terrain(reference, expected.referenceTerrainComponents ?? expected.terrainComponents);
  const water = pond(input), referenceWater = pond(reference), outer = hull(water.flat());
  if (outer.length < 8 || outer.length > 128) throw Error('Pond footprint is not a reviewed bounded convex surface.');
  const center = outer.reduce((a, b) => [a[0] + b[0] / outer.length, a[1] + b[1] / outer.length], [0, 0]);
  // Validate convex hull against actual triangles; never fill a concave inlet.
  for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length]; if (height(water, (a[0] + b[0] + center[0]) / 3, (a[1] + b[1] + center[1]) / 3) === null) throw Error('Convex pond hull would invent a water footprint.'); }
  const inset = outer.map(p => [center[0] + (p[0] - center[0]) * .96, center[1] + (p[1] - center[1]) * .96]);
  let inner = inset; const wetReferenceVertices = [];
  const referenceTriangles = [];
  for (const group of high.groups) { const p = group.positions, vertices = Array.from({ length: p.a.count }, (_, i) => new Vector3(p.read(i, 0), p.read(i, 1), p.read(i, 2)).applyMatrix4(group.world).toArray()); for (const vertex of vertices) { if (Math.hypot(vertex[0] - center[0], vertex[2] - center[1]) >= 24) continue; const lowSurface = height(water, vertex[0], vertex[2]), highSurface = height(referenceWater, vertex[0], vertex[2]); if (lowSurface !== null && highSurface !== null && vertex[1] < Math.min(lowSurface, highSurface) - .005) wetReferenceVertices.push(vertex); } for (const face of group.faces) { const tri = face.map(i => vertices[i]); if (tri.some(p => Math.hypot(p[0] - center[0], p[2] - center[1]) < 24)) referenceTriangles.push(tri); } }
  if (wetReferenceVertices.length >= 3) { const wetHull = hull(wetReferenceVertices), clipped = splitPolygon(wetHull.map(p => ({ x: p[0], z: p[1], weights: [0, 0, 0] })), inset).inside; if (clipped.length >= 3) inner = clipped.map(p => [p.x, p.z]); }
  const candidateInner = inner; let referenceWetHullInsetScale = null;
  for (const factor of [1, .99, .98, .97, .95, .93, .9, .87, .84]) {
    const candidate = candidateInner.map(p => [center[0] + (p[0] - center[0]) * factor, center[1] + (p[1] - center[1]) * factor]);
    const wet = candidate.every((p, i) => { const q = candidate[(i + 1) % candidate.length]; return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]].every(sample => { const bed = height(referenceTriangles, sample[0], sample[1]), surface = height(water, sample[0], sample[1]); return bed !== null && surface !== null && bed < surface - .002; }); });
    if (wet) { inner = candidate; referenceWetHullInsetScale = factor; break; }
  }
  if (referenceWetHullInsetScale === null) throw Error('No verified conservative wetbed hull; a nonconvex patch is required.');
  const chunks = [input.bin], changes = []; let binaryLength = input.bin.length, addedTriangles = 0, addedVertices = 0, addedGeometryBytes = 0, affectedFaces = 0;
  function append(data, type, count, componentType = 5126, target = 34962) {
    const padding = (4 - binaryLength % 4) % 4; if (padding) { chunks.push(Buffer.alloc(padding)); binaryLength += padding; }
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength), view = output.bufferViews.length, id = output.accessors.length;
    output.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length, target }); chunks.push(bytes); binaryLength += bytes.length;
    output.accessors.push({ bufferView: view, componentType, type, count }); return id;
  }
  for (const node of placed(input).filter(n => low.meshIds.has(n.meshId))) {
    const primitives = node.mesh.primitives, positionIds = new Set(primitives.map(p => p.attributes.POSITION)); if (positionIds.size !== 1) throw Error('Subdivision requires a shared bounded terrain position pool.');
    const positionId = [...positionIds][0], p = accessor(input, positionId), w = node.world.elements, inverse = node.world.clone().invert();
    const attributeIds = new Set(primitives.flatMap(p => Object.values(p.attributes))), attributeData = new Map(), attributeWidths = { VEC2: 2, VEC3: 3, VEC4: 4 };
    for (const id of attributeIds) {
      const a = input.json.accessors[id], v = input.json.bufferViews[a.bufferView], width = attributeWidths[a.type];
      if (!width || a.componentType !== 5126 || a.sparse || a.normalized || a.count !== p.a.count || v.buffer !== 0) throw Error('Unsupported shared terrain attribute for interpolation.');
      const values = [], offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? width * 4;
      if (offset + (a.count - 1) * stride + width * 4 > (v.byteOffset ?? 0) + v.byteLength) throw Error('Shared terrain attribute exceeds its buffer.');
      for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) values.push(input.bin.readFloatLE(offset + i * stride + c * 4)); attributeData.set(id, { a, width, values });
    }
    const positions = attributeData.get(positionId).values, originalCount = p.a.count, worldVertices = Array.from({ length: originalCount }, (_, i) => new Vector3(p.read(i, 0), p.read(i, 1), p.read(i, 2)).applyMatrix4(node.world).toArray());
    const cacheKey = p => p.map(v => Math.round(v * 1e8)).join(':');
    const pointCache = new Map(worldVertices.map((p, i) => [cacheKey(p), i])), newNormals = new Set(), results = [], editedOriginalVertices = new Set(); let nodeAddedFaces = 0;
    function makeVertex(v, face, restore) {
      const originalWorld = [0, 1, 2].map(c => face.reduce((n, id, i) => n + worldVertices[id][c] * v.weights[i], 0)); let y = originalWorld[1];
      if (restore) { const bed = height(referenceTriangles, v.x, v.z), surface = height(water, v.x, v.z), highSurface = height(referenceWater, v.x, v.z); if (bed === null || surface === null || highSurface === null) throw Error('Reference does not support an inset pond vertex.'); if (bed < Math.min(surface, highSurface) - .005) { if (Math.abs(bed - y) > .3) throw Error('Subdivision bed exceeds the measured error envelope.'); y = bed; } }
      const key = cacheKey([v.x, y, v.z]), cached = pointCache.get(key); if (cached !== undefined) { if (restore) newNormals.add(cached); return cached; }
      const index = positions.length / 3, local = new Vector3(v.x, y, v.z).applyMatrix4(inverse);
      for (const [id, data] of attributeData) for (let c = 0; c < data.width; c++) data.values.push(id === positionId ? local.getComponent(c) : face.reduce((n, source, i) => n + data.values[source * data.width + c] * v.weights[i], 0));
      worldVertices.push([v.x, y, v.z]); pointCache.set(key, index); if (polygonInside([v.x, v.z], outer)) newNormals.add(index);
      changes.push({ worldXZ: [v.x, v.z], originalWorldY: originalWorld[1], repairedWorldY: y, insideFootprint: polygonInside([v.x, v.z], outer), restoredFromReference: restore && Math.abs(y - originalWorld[1]) > 1e-7 }); return index;
    }
    function fan(poly, face, interior) {
      if (poly.length < 3) return [];
      const center = { x: poly.reduce((n, p) => n + p.x / poly.length, 0), z: poly.reduce((n, p) => n + p.z / poly.length, 0), weights: [0, 1, 2].map(c => poly.reduce((n, p) => n + p.weights[c] / poly.length, 0)) };
      const index = makeVertex(center, face, interior && polygonInside([center.x, center.z], inner)), ids = poly.map(p => makeVertex(p, face, interior && polygonInside([p.x, p.z], inner))), out = [];
      for (let i = 0; i < ids.length; i++) { const a = worldVertices[index], b = worldVertices[ids[i]], c = worldVertices[ids[(i + 1) % ids.length]], area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); if (Math.abs(area) > 1e-9) out.push(index, ids[i], ids[(i + 1) % ids.length]); } return out;
    }
    for (const primitive of primitives) {
      const sourceIndex = accessor(input, primitive.indices, false), indices = []; let edited = 0;
      for (let at = 0; at < sourceIndex.a.count; at += 3) {
        const face = [sourceIndex.read(at), sourceIndex.read(at + 1), sourceIndex.read(at + 2)], poly = face.map((id, i) => ({ x: worldVertices[id][0], z: worldVertices[id][2], weights: [0, 1, 2].map(c => c === i ? 1 : 0) })), cut = splitPolygon(poly, outer);
        if (cut.inside.length < 3) { indices.push(...face); continue; }
        const second = splitPolygon(cut.inside, inner); if (second.inside.length < 3) { indices.push(...face); continue; }
        const replacement = [...cut.outside.flatMap(poly => fan(poly, face, false)), ...second.outside.flatMap(poly => fan(poly, face, true)), ...fan(second.inside, face, true)];
        if (replacement.length < 3) throw Error('Subdivision produced an empty supporting face.'); indices.push(...replacement); edited++; for (const id of face) editedOriginalVertices.add(id); addedTriangles += replacement.length / 3 - 1;
      }
      results.push({ primitive, indices, edited }); nodeAddedFaces += edited;
    }
    if (!nodeAddedFaces) continue;
    // BSP clipping can leave collinear vertices on an earlier fragment edge.
    // Split both sides at every shared XZ point before finalizing the mesh.
    const candidates = [...editedOriginalVertices, ...Array.from({ length: worldVertices.length - originalCount }, (_, i) => i + originalCount)];
    for (const result of results) {
      const stitched = [];
      for (let at = 0; at < result.indices.length; at += 3) {
        const face = result.indices.slice(at, at + 3), perimeter = []; let changed = false;
        for (let e = 0; e < 3; e++) {
          const ai = face[e], bi = face[(e + 1) % 3], a = worldVertices[ai], b = worldVertices[bi], dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz, cuts = [];
          perimeter.push(ai);
          for (const id of candidates) {
            if (id === ai || id === bi) continue; const p = worldVertices[id];
            if (p[0] < Math.min(a[0], b[0]) - 1e-5 || p[0] > Math.max(a[0], b[0]) + 1e-5 || p[2] < Math.min(a[2], b[2]) - 1e-5 || p[2] > Math.max(a[2], b[2]) + 1e-5) continue;
            const t = ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / length;
            if (t <= 1e-7 || t >= 1 - 1e-7 || Math.hypot(p[0] - a[0] - t * dx, p[2] - a[2] - t * dz) > 1e-8) continue;
            if (!polygonInside([p[0], p[2]], outer) && Math.abs(p[1] - a[1] - t * (b[1] - a[1])) > 1e-5) throw Error('Stitching would move the outside surface.');
            cuts.push({ id, t });
          }
          cuts.sort((a, b) => a.t - b.t); let previous = -1;
          for (const cut of cuts) if (cut.t - previous > 1e-7) { perimeter.push(cut.id); previous = cut.t; changed = true; }
        }
        if (!changed) { stitched.push(...face); continue; }
        const id = positions.length / 3, world = [0, 1, 2].map(c => face.reduce((n, v) => n + worldVertices[v][c] / 3, 0));
        for (const data of attributeData.values()) for (let c = 0; c < data.width; c++) data.values.push(face.reduce((n, v) => n + data.values[v * data.width + c] / 3, 0));
        worldVertices.push(world); if (polygonInside([world[0], world[2]], outer)) newNormals.add(id);
        for (let i = 0; i < perimeter.length; i++) stitched.push(id, perimeter[i], perimeter[(i + 1) % perimeter.length]);
        addedTriangles += perimeter.length - 1;
      }
      result.indices = stitched;
    }
    const used = new Set(results.flatMap(result => result.indices)), keep = Array.from({ length: originalCount }, (_, i) => i);
    for (let i = originalCount; i < worldVertices.length; i++) if (used.has(i)) keep.push(i);
    if (keep.length !== worldVertices.length) {
      const remap = new Map(keep.map((id, next) => [id, next])), frames = keep.map(id => worldVertices[id]);
      for (const data of attributeData.values()) { const compact = keep.flatMap(id => data.values.slice(id * data.width, id * data.width + data.width)); data.values.length = compact.length; for (let i = 0; i < compact.length; i++) data.values[i] = compact[i]; }
      worldVertices.length = frames.length; for (let i = 0; i < frames.length; i++) worldVertices[i] = frames[i];
      const normals = [...newNormals].filter(id => used.has(id)).map(id => remap.get(id)); newNormals.clear(); for (const id of normals) newNormals.add(id);
      for (const result of results) result.indices = result.indices.map(id => remap.get(id));
    }
    affectedFaces += nodeAddedFaces; addedVertices += positions.length / 3 - originalCount;
    const sums = new Map([...newNormals].map(id => [id, [0, 0, 0]]));
    for (const result of results) for (let i = 0; i < result.indices.length; i += 3) {
      const ids = result.indices.slice(i, i + 3), [a, b, c] = ids.map(id => worldVertices[id]), ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]), normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      for (const id of ids) { const sum = sums.get(id); if (sum) for (let c = 0; c < 3; c++) sum[c] += normal[c]; }
    }
    for (const normalId of new Set(primitives.map(p => p.attributes.NORMAL))) for (const [id, sum] of sums) {
      const data = attributeData.get(normalId), local = [w[0] * sum[0] + w[1] * sum[1] + w[2] * sum[2], w[4] * sum[0] + w[5] * sum[1] + w[6] * sum[2], w[8] * sum[0] + w[9] * sum[1] + w[10] * sum[2]], length = Math.hypot(...local); if (!(length > 1e-10)) throw Error('Subdivision produced unsupported normals: ' + JSON.stringify({id,point:worldVertices[id],sum,incident:results.flatMap(r=>Array.from({length:r.indices.length/3},(_,i)=>r.indices.slice(i*3,i*3+3))).filter(f=>f.includes(id)).slice(0,4).map(f=>({ids:f,points:f.map(v=>worldVertices[v])}))})); for (let c = 0; c < 3; c++) data.values[id * 3 + c] = local[c] / length;
    }
    for (const normalId of new Set(primitives.map(p => p.attributes.NORMAL))) { const data = attributeData.get(normalId); for (let i = originalCount; i < positions.length / 3; i++) { const length = Math.hypot(...data.values.slice(i * 3, i * 3 + 3)); if (!(length > 1e-10)) throw Error('Interpolated normal is invalid.'); for (let c = 0; c < 3; c++) data.values[i * 3 + c] /= length; } }
    const remap = new Map(); for (const [id, data] of attributeData) { const values = Float32Array.from(data.values), next = append(values, data.a.type, positions.length / 3); remap.set(id, next); const a = output.accessors[next], min = Array(data.width).fill(Infinity), max = Array(data.width).fill(-Infinity); for (let i = 0; i < values.length; i++) { min[i % data.width] = Math.min(min[i % data.width], values[i]); max[i % data.width] = Math.max(max[i % data.width], values[i]); } a.min = min; a.max = max; addedGeometryBytes += (positions.length / 3 - originalCount) * data.width * 4; }
    for (let i = 0; i < results.length; i++) { const result = results[i], target = output.meshes[node.meshId].primitives[i]; target.attributes = Object.fromEntries(Object.entries(target.attributes).map(([name, id]) => [name, remap.get(id)])); const Index = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array, values = Index.from(result.indices); target.indices = append(values, 'SCALAR', values.length, Index === Uint16Array ? 5123 : 5125, 34963); addedGeometryBytes += values.byteLength - accessor(input, result.primitive.indices, false).a.count * accessor(input, result.primitive.indices, false).size; }
  }
  if (!affectedFaces || addedTriangles > 2000 || addedTriangles < 1) throw Error('No bounded local pond subdivision, or added triangle budget exceeded.');
  const padding = (4 - binaryLength % 4) % 4; if (padding) { chunks.push(Buffer.alloc(padding)); binaryLength += padding; } output.buffers[0].byteLength = binaryLength;
  output.asset.extras = { ...output.asset.extras, crownfallPondBedRepair: { generator: 'scripts/repair-elderbloom-pond-bed.mjs', inputSha256: expected.inputSha256, referenceSha256: expected.referenceSha256, method: 'Local convex-footprint subdivision with original-plane outside fragments, stitched inset reference wetbed and interpolated source UVs', addedTriangles, addedVertices } };
  const bin = Buffer.concat(chunks), bytes = encode(output, bin); if (!bin.subarray(0, input.bin.length).equals(input.bin)) throw Error('Original source binary prefix changed.');
  return { bytes, report: { inputSha256: expected.inputSha256, referenceSha256: expected.referenceSha256, outputSha256: hash(bytes), localSubdivision: true, affectedFaces, addedTriangles, addedVertices, addedGpuGeometryBytesEstimate: addedGeometryBytes, appendedBinaryBytes: bin.length - input.bin.length, originalBinaryPrefixByteExact: true, originalVerticesAndWorldXZUnchanged: true, outsideSurfacePositionsExact: true, waterMaterialsTexturesAndActorsUnchanged: true, shorelineInsetScale: .96, referenceWetHullInsetScale, positionChanges: changes } };
}

export function repairElderbloomPondBed(inputBytes, referenceBytes, expected) {
  expected = requirePondRepairIdentity(expected);
  try { return repairElderbloomPondBedYOnly(inputBytes, referenceBytes, expected); }
  catch (error) { if (error.message !== 'No measured in-footprint bed defect to repair.') throw error; return subdividePondBed(inputBytes, referenceBytes, expected); }
}

export async function repairElderbloomPondBedFiles(inputPath, referencePath, outputPath, expected) {
  expected = requirePondRepairIdentity(expected);
  const input = resolve(inputPath), reference = resolve(referencePath), output = resolve(outputPath), reportPath = output + '.pond-bed-report.json';
  if (output === input || output === reference) throw Error('Use a new private output; never overwrite either input.');
  for (const path of [output, reportPath]) { try { await lstat(path); throw Error('Output already exists; refuse overwrite.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  for (const path of [input, reference]) if ((await stat(path)).size > 256 * 1024 * 1024) throw Error('Use optimized derivatives smaller than256MiB, never the original source.');
  const inputBytes = await readFile(input), referenceBytes = await readFile(reference), result = repairElderbloomPondBed(inputBytes, referenceBytes, expected);
  await mkdir(dirname(output), { recursive: true }); const canonicalOutput = resolve(await realpath(dirname(output)), basename(output)), canonicalRepository = await realpath(repository), local = relative(canonicalRepository, canonicalOutput);
  if (local === '' || !local.startsWith('..') && !isAbsolute(local)) throw Error('Keep private derivative GLBs outside the public repository.');
  await writeFile(output, result.bytes, { flag: 'wx' });
  const report = { inputPath: input, referencePath: reference, outputPath: output, ...result.report };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' }); return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'input-sha256': { type: 'string' }, 'reference-sha256': { type: 'string' },
  } });
  const [input, reference, output] = positionals;
  if (!input || !reference || !output || positionals.length !== 3) throw Error('Usage: node scripts/repair-elderbloom-pond-bed.mjs <known-low.glb> <known-high.glb> <new-private.glb> --input-sha256 <expected-low-sha256> --reference-sha256 <expected-high-sha256>');
  const report = await repairElderbloomPondBedFiles(input, reference, output, {
    inputSha256: values['input-sha256'], referenceSha256: values['reference-sha256'],
  });
  const { allowedBinaryRegions, positionChanges, ...summary } = report; console.log(JSON.stringify(summary, null, 2));
}
