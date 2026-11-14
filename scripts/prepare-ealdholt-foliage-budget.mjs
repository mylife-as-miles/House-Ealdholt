// CPU-only PRIVATE additions-only foliage experiment; never selects a runtime asset.
import {readFile, writeFile, lstat, realpath, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {MeshoptSimplifier} = require('meshoptimizer');
const sharp = require('sharp');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const widths = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const allowed = /^native-source-(field04|forest05|grass[123]|poppy|daisy|lupine)-v1$/;
function finite(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Non-finite source data.');
  if (value && typeof value === 'object') for (const v of Object.values(value)) finite(v);
}
function decode(bytes) {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('Expected GLB2 JSON+BIN.');
  const end = 20 + bytes.readUInt32LE(12);
  if (end + 8 > bytes.length || bytes.readUInt32LE(end + 4) !== 0x004e4942 || end + 8 + bytes.readUInt32LE(end) !== bytes.length) throw Error('Expected exactly one BIN chunk.');
  const j = JSON.parse(bytes.subarray(20, end).toString()), bin = bytes.subarray(end + 8);
  finite(j);
  if (j.buffers?.length !== 1 || j.buffers[0].uri || j.buffers[0].byteLength > bin.length) throw Error('Expected one embedded buffer.');
  for (const v of j.bufferViews ?? []) if (v.buffer !== 0 || !Number.isSafeInteger(v.byteLength) || v.byteLength < 0 || !Number.isSafeInteger(v.byteOffset ?? 0) || (v.byteOffset ?? 0) < 0 || (v.byteOffset ?? 0) + v.byteLength > bin.length) throw Error('Invalid embedded buffer view.');
  const raw = index => {
    const a = j.accessors[index], v = j.bufferViews[a?.bufferView], width = widths[a?.type], size = sizes[a?.componentType];
    if (!v || v.buffer !== 0 || a.sparse || !width || !size || !Number.isSafeInteger(a.count) || a.count < 0) throw Error('Expected dense supported accessors.');
    const stride = v.byteStride ?? width * size, start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (stride < width * size || start < 0 || start + Math.max(0, a.count - 1) * stride + width * size > (v.byteOffset ?? 0) + v.byteLength || (v.byteOffset ?? 0) + v.byteLength > bin.length) throw Error('Accessor outside its buffer view.');
    const out = Buffer.alloc(a.count * width * size);
    for (let i = 0; i < a.count; i++) bin.copy(out, i * width * size, start + i * stride, start + i * stride + width * size);
    return out;
  };
  const values = index => {
    const a = j.accessors[index], bytes = raw(index), size = sizes[a.componentType], out = new Float64Array(bytes.length / size);
    const readers = {5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE'};
    for (let i = 0; i < out.length; i++) {
      let x = bytes[readers[a.componentType]](i * size);
      if (a.normalized) x = Math.max(-1, x / ({5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a.componentType] ?? 1));
      if (!Number.isFinite(x)) throw Error('Non-finite accessor data.');
      out[i] = x;
    }
    return out;
  };
  for (let i = 0; i < (j.accessors?.length ?? 0); i++) values(i);
  for (const image of j.images ?? []) if (image.uri || !j.bufferViews[image.bufferView]) throw Error('Expected embedded images.');
  return {j, bin, raw, values};
}
function encode(j, binary) {
  const json = Buffer.from(JSON.stringify(j)), text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]), out = Buffer.alloc(28 + text.length + bin.length), at = 20 + text.length;
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); out.writeUInt32LE(bin.length, at); out.writeUInt32LE(0x004e4942, at + 4); bin.copy(out, at + 8);
  return out;
}
function topology(indices, vertices) {
  const parent = Array.from({length: vertices}, (_, i) => i), find = i => parent[i] === i ? i : parent[i] = find(parent[i]);
  const edges = new Map(), used = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const t = Array.from(indices.subarray(i, i + 3));
    if (t.length !== 3 || t.some(x => !Number.isSafeInteger(x) || x < 0 || x >= vertices)) throw Error('Invalid triangle indices.');
    for (let c = 0; c < 3; c++) {
      const a = t[c], b = t[(c + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1); used.add(a); parent[find(b)] = find(a);
    }
  }
  const parts = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const key = find(indices[i]), part = parts.get(key) ?? [];
    part.push(indices[i], indices[i + 1], indices[i + 2]); parts.set(key, part);
  }
  return {parts: [...parts.values()], boundaries: [...edges].filter(([, n]) => n === 1).map(([edge]) => edge).sort(), euler: used.size - edges.size + indices.length / 3, nonmanifoldEdges: [...edges.values()].filter(n => n > 2).length};
}
function preparePrimitive(m, p, maxError) {
  if (p.mode !== undefined && p.mode !== 4 || p.indices === undefined || p.targets || p.extensions) throw Error('Unsupported foliage primitive topology.');
  const indexAccessor = m.j.accessors[p.indices];
  if (indexAccessor?.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indexAccessor.componentType) || indexAccessor.normalized) throw Error('Expected unsigned integer triangle indices.');
  const pos = Float32Array.from(m.values(p.attributes.POSITION)), indices = Uint32Array.from(m.values(p.indices)), count = pos.length / 3;
  if (m.j.accessors[p.attributes.POSITION].type !== 'VEC3' || indices.length % 3) throw Error('Expected indexed triangle positions.');
  const names = Object.keys(p.attributes).filter(n => n !== 'POSITION').sort(), data = names.map(n => m.values(p.attributes[n]));
  const ws = names.map(n => widths[m.j.accessors[p.attributes[n]].type]), stride = ws.reduce((s, n) => s + n, 0), attrs = new Float32Array(count * stride);
  const weights = names.flatMap((n, k) => Array(ws[k]).fill(n.startsWith('TEXCOORD_') ? .2 : .05));
  for (let i = 0; i < count; i++) {
    let at = i * stride;
    for (let k = 0; k < names.length; k++) {
      if (data[k].length !== count * ws[k]) throw Error('Mismatched vertex attribute count.');
      for (let c = 0; c < ws[k]; c++) attrs[at++] = data[k][i * ws[k] + c];
    }
  }
  const source = topology(indices, count), locks = new Uint8Array(count), used = [...new Set(indices)];
  for (const edge of source.boundaries) for (const id of edge.split(',').map(Number)) locks[id] = 1;
  for (let c = 0; c < 3; c++) for (const sign of [-1, 1]) {
    let chosen = used[0];
    for (const id of used) if (sign * pos[id * 3 + c] > sign * pos[chosen * 3 + c]) chosen = id;
    locks[chosen] = 1;
  }
  let maxReportedError = 0, rejectedComponents = 0;
  const changed = source.parts.map(part => {
    const input = Uint32Array.from(part);
    if (input.length <= 6) return input;
    const [out, error] = MeshoptSimplifier.simplifyWithAttributes(input, pos, 3, attrs, stride, weights, locks, Math.max(3, Math.floor(input.length * .25 / 3) * 3), maxError, ['ErrorAbsolute', 'LockBorder']);
    const before = topology(input, count), after = topology(out, count);
    if (!out.length || out.length > input.length || !Number.isFinite(error) || error > maxError + 1e-7 || after.parts.length !== 1 || after.euler !== before.euler || after.nonmanifoldEdges > before.nonmanifoldEdges || !same(before.boundaries, after.boundaries)) {
      rejectedComponents++; return input;
    }
    maxReportedError = Math.max(maxReportedError, error); return out;
  });
  const output = Uint32Array.from(changed.flatMap(ix => [...ix]));
  const after = topology(output, count);
  if (after.parts.length !== source.parts.length || !same(source.boundaries, after.boundaries) || after.euler !== source.euler) throw Error('Foliage topology preservation failed.');
  return {pos, indices, output, sourceTopology: source, maxReportedError, rejectedComponents, vertexAttributesByteIdentical: true, sourceComponents: source.parts.length, outputComponents: after.parts.length, sourceBoundaryEdges: source.boundaries.length, outputBoundaryEdges: after.boundaries.length, sourceSingleTriangleComponents: source.parts.filter(p => p.length === 3).length, sourceTwoTriangleComponents: source.parts.filter(p => p.length === 6).length};
}
async function coverage(m, mesh, plans, size = 96) {
  const images = new Map();
  const alphaTests = await Promise.all(mesh.primitives.map(async p => {
    const mat = m.j.materials[p.material], tex = mat.pbrMetallicRoughness?.baseColorTexture, factor = mat.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
    if ((mat.alphaMode ?? 'OPAQUE') === 'OPAQUE') return () => true;
    if (mat.alphaMode !== 'MASK') throw Error('Coverage proxy supports opaque/masked foliage only.');
    if (!tex) return () => factor >= (mat.alphaCutoff ?? .5);
    const transform = tex.extensions?.KHR_texture_transform ?? {}, channel = transform.texCoord ?? tex.texCoord ?? 0, uv = m.values(p.attributes[`TEXCOORD_${channel}`]);
    const texture = m.j.textures[tex.index], imageId = texture.extensions?.EXT_texture_webp?.source ?? texture.source, view = m.j.bufferViews[m.j.images[imageId].bufferView];
    if (!images.has(imageId)) images.set(imageId, sharp(m.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject: true}));
    const image = await images.get(imageId), sampler = m.j.samplers?.[texture.sampler] ?? {}, scale = transform.scale ?? [1, 1], offset = transform.offset ?? [0, 0], rotation = transform.rotation ?? 0;
    const wrap = (x, mode) => mode === 33071 ? Math.max(0, Math.min(1, x)) : mode === 33648 ? 1 - Math.abs(((x % 2) + 2) % 2 - 1) : ((x % 1) + 1) % 1;
    return (ids, bary) => {
      let u = 0, v = 0;
      for (let i = 0; i < 3; i++) { u += uv[ids[i] * 2] * bary[i]; v += uv[ids[i] * 2 + 1] * bary[i]; }
      const a = u * scale[0], b = v * scale[1];
      u = wrap(a * Math.cos(rotation) - b * Math.sin(rotation) + offset[0], sampler.wrapS);
      v = wrap(a * Math.sin(rotation) + b * Math.cos(rotation) + offset[1], sampler.wrapT);
      const x = Math.min(image.info.width - 1, Math.floor(u * image.info.width)), y = Math.min(image.info.height - 1, Math.floor(v * image.info.height));
      return image.data[(y * image.info.width + x) * 4 + 3] / 255 * factor >= (mat.alphaCutoff ?? .5);
    };
  }));
  const normalize = a => { const d = Math.hypot(...a); return a.map(x => x / d); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const views = [['front', [0, 0, 1]], ['right', [1, 0, 0]], ['top', [0, 1, 0]], ['quarter', [1, .5, 1]], ['backQuarter', [1, .5, -1]]], results = [];
  for (const [name, direction] of views) {
    const forward = normalize(direction), right = normalize(cross(Math.abs(forward[1]) > .9 ? [0, 0, 1] : [0, 1, 0], forward)), up = cross(forward, right);
    const projected = plans.map(p => Array.from({length: p.pos.length / 3}, (_, i) => [0, 1].map(c => [right, up][c].reduce((s, n, k) => s + n * p.pos[i * 3 + k], 0))));
    const used = plans.flatMap((p, k) => [...new Set(p.indices)].map(i => projected[k][i]));
    const lo = [0, 1].map(c => Math.min(...used.map(p => p[c]))), hi = [0, 1].map(c => Math.max(...used.map(p => p[c]))), span = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-9);
    const coords = projected.map(ps => ps.map(p => p.map((x, c) => (x - (lo[c] + hi[c]) * .5) / span * (size - 4) + size * .5)));
    const raster = which => {
      const mask = new Uint8Array(size * size);
      for (let k = 0; k < plans.length; k++) {
        const ix = plans[k][which], ps = coords[k];
        for (let t = 0; t < ix.length; t += 3) {
          const ids = Array.from(ix.subarray(t, t + 3)), [a, b, c] = ids.map(i => ps[i]), den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
          if (Math.abs(den) < 1e-12) continue;
          const min = [0, 1].map(d => Math.max(0, Math.floor(Math.min(a[d], b[d], c[d])))), max = [0, 1].map(d => Math.min(size - 1, Math.ceil(Math.max(a[d], b[d], c[d]))));
          for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) {
            if (mask[y * size + x]) continue;
            const u = ((b[1] - c[1]) * (x + .5 - c[0]) + (c[0] - b[0]) * (y + .5 - c[1])) / den;
            const v = ((c[1] - a[1]) * (x + .5 - c[0]) + (a[0] - c[0]) * (y + .5 - c[1])) / den, w = 1 - u - v;
            if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9 && alphaTests[k](ids, [u, v, w])) mask[y * size + x] = 1;
          }
        }
      }
      return mask;
    };
    const before = raster('indices'), after = raster('output'); let sourcePixels = 0, outputPixels = 0, intersection = 0, union = 0;
    for (let i = 0; i < before.length; i++) { sourcePixels += before[i]; outputPixels += after[i]; intersection += before[i] && after[i] ? 1 : 0; union += before[i] || after[i] ? 1 : 0; }
    results.push({view: name, sourcePixels, outputPixels, intersectionOverUnion: union ? intersection / union : 1, lostSourceCoverageRatio: sourcePixels ? (sourcePixels - intersection) / sourcePixels : 0, gainedCoveragePixels: outputPixels - intersection});
  }
  return {method: '96px orthographic, five fixed local directions, two-sided triangle union, nearest embedded base-colour alpha, exact texture transforms; no depth/light/wind/occlusion simulation', views: results, worstLostSourceCoverageRatio: Math.max(...results.map(r => r.lostSourceCoverageRatio)), minimumIntersectionOverUnion: Math.min(...results.map(r => r.intersectionOverUnion))};
}
function families(m) {
  const roots = [], owned = new Map(), seen = new Set();
  for (let i = 0; i < m.j.nodes.length; i++) {
    const tag = m.j.nodes[i].extras?.crownfallFoliageDensity;
    if (!tag) continue;
    if (tag.schema !== 1 || typeof tag.family !== 'string' || seen.has(tag.family)) throw Error('Expected unique versioned foliage families.');
    seen.add(tag.family);
    const counts = tag.counts;
    if (!counts || ['low', 'medium', 'high'].some(t => !Number.isSafeInteger(counts[t]) || counts[t] < 0) || counts.low > counts.medium || counts.medium > counts.high) throw Error('Invalid foliage tier counts.');
    const row = {owner: i, family: tag.family, counts: {...counts}, nodes: [], protectedHero: !allowed.test(tag.family)};
    const visit = id => {
      if (owned.has(id)) throw Error('Repeated or nested tagged family node.');
      owned.set(id, row);
      const n = m.j.nodes[id];
      if (!n || id !== i && n.extras?.crownfallFoliageDensity) throw Error('Invalid family hierarchy.');
      if (n.mesh !== undefined) {
        const attrs = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
        if (!attrs || !Object.values(attrs).length || Object.values(attrs).some(a => m.j.accessors[a]?.count !== counts.high)) throw Error('Exact complete High instance buffers required.');
        row.nodes.push(id);
      }
      for (const child of n.children ?? []) visit(child);
    };
    visit(i);
    if (!row.nodes.length) throw Error('Family has no placed geometry.');
    roots.push(row);
  }
  if (!roots.length) throw Error('Expected additions-only foliage tags.');
  return {roots, owned};
}
function tierCosts(m, ownership) {
  return ['low', 'medium', 'high'].map(tier => {
    const seen = new Set(), geometry = new Set(), instance = new Set(); let triangles = 0, draws = 0, taggedActors = 0, otherActors = 0;
    const visit = id => {
      if (seen.has(id)) throw Error('Repeated or cyclic active scene node.');
      seen.add(id);
      const n = m.j.nodes[id];
      if (!n) throw Error('Missing scene node.');
      if (n.mesh !== undefined) {
        const attrs = n.extensions?.EXT_mesh_gpu_instancing?.attributes, family = ownership.owned.get(id), actors = family ? family.counts[tier] : attrs ? m.j.accessors[Object.values(attrs)[0]].count : 1;
        if (family) taggedActors += actors; else otherActors += actors;
        if (actors) for (const p of m.j.meshes[n.mesh].primitives) {
          if ((p.mode ?? 4) !== 4) throw Error('Expected triangle meshes.');
          triangles += actors * m.j.accessors[p.indices ?? p.attributes.POSITION].count / 3; draws++;
          for (const a of Object.values(p.attributes)) geometry.add(a);
          if (p.indices !== undefined) geometry.add(p.indices);
        }
        // Full High instance buffers remain allocated even when a tier submits fewer actors.
        for (const a of Object.values(attrs ?? {})) instance.add(a);
      }
      for (const child of n.children ?? []) visit(child);
    };
    for (const id of m.j.scenes[m.j.scene ?? 0].nodes) visit(id);
    const accessorBytes = ids => { const views = new Set(); let bytes = 0; for (const id of ids) { const a = m.j.accessors[id], v = m.j.bufferViews[a.bufferView]; if (v.byteStride) { if (!views.has(a.bufferView)) bytes += v.byteLength; views.add(a.bufferView); } else bytes += a.count * widths[a.type] * sizes[a.componentType]; } return bytes; };
    return {tier, modelTriangles: triangles, modelDraws: draws, taggedActors, otherActors, referencedGeometryBytes: accessorBytes(geometry), completeHighInstanceAccessorBytes: accessorBytes(instance), exceeds250kTriangles: triangles > 250000};
  });
}
async function newPrivatePath(path) {
  const output = resolve(path), parent = await realpath(dirname(output));
  if (parent !== dirname(output)) throw Error('Output parent must not traverse symlinks.');
  if (parent === repository || parent.startsWith(repository + '/')) throw Error('Fab derivatives must stay PRIVATE outside the repository.');
  try { await lstat(output); } catch (e) { if (e.code === 'ENOENT') return output; throw e; }
  throw Error('Output exists; overwriting or following a symlink is forbidden.');
}
export function evaluateFoliageBudgetAcceptance(rows, tiers) {
  const maximumLostCoverageRatio = .02, minimumIntersectionOverUnion = .98, targetTriangles = 250000;
  const coverageFailures = [];
  for (const row of rows) for (const node of row.nodes) {
    if (node.protected) continue;
    const proxy = node.alphaSilhouetteProxy;
    if (!proxy || !Number.isFinite(proxy.worstLostSourceCoverageRatio) || !Number.isFinite(proxy.minimumIntersectionOverUnion) || proxy.worstLostSourceCoverageRatio > maximumLostCoverageRatio || proxy.minimumIntersectionOverUnion < minimumIntersectionOverUnion) coverageFailures.push({family: row.family, node: node.node, worstLostSourceCoverageRatio: proxy?.worstLostSourceCoverageRatio ?? null, minimumIntersectionOverUnion: proxy?.minimumIntersectionOverUnion ?? null});
  }
  const budgetFailures = tiers.filter(t => !Number.isFinite(t.modelTriangles) || t.modelTriangles > targetTriangles).map(t => ({tier: t.tier, modelTriangles: t.modelTriangles, overBudgetTriangles: Math.max(0, t.modelTriangles - targetTriangles)}));
  return {accepted: false, decision: coverageFailures.length || budgetFailures.length ? 'rejected' : 'awaiting-separate-visual-review', cpuCoverageGate: {passed: coverageFailures.length === 0, maximumLostCoverageRatio, minimumIntersectionOverUnion, failures: coverageFailures}, triangleBudgetGate: {passed: budgetFailures.length === 0, targetTriangles, failures: budgetFailures}, cpuEvidenceCannotEstablishVisualOrHeadsetAcceptance: true};
}
export async function prepareEaldholtFoliageBudget(inputPath, outputPath, options = {}) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedSha256 ?? '')) throw Error('An operator-supplied expected SHA-256 is required.');
  const maxError = options.maxErrorMetres ?? .02;
  if (!Number.isFinite(maxError) || maxError <= 0 || maxError > .02) throw Error('Absolute source-space error must be in (0, .02] metres.');
  const input = await realpath(resolve(inputPath));
  if ((await stat(input)).size > 256 * 1024 * 1024) throw Error('Use an optimized input below 256 MiB.');
  const sourceBytes = await readFile(input);
  if (hash(sourceBytes) !== options.expectedSha256) throw Error('Qualified input SHA-256 differs.');
  const output = await newPrivatePath(outputPath), reportPath = await newPrivatePath(output + '.foliage-budget-report.json');
  if (input === output) throw Error('Use a separate private candidate.');
  const m = decode(sourceBytes), ownership = families(m), j = structuredClone(m.j), chunks = [m.bin];
  let length = m.bin.length;
  const appendIndices = ix => {
    const pad = (4 - length % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    const bytes = Buffer.alloc(ix.length * 4); ix.forEach((x, i) => bytes.writeUInt32LE(x, i * 4));
    const view = j.bufferViews.length; j.bufferViews.push({buffer: 0, byteOffset: length, byteLength: bytes.length, target: 34963});
    chunks.push(bytes); length += bytes.length;
    const id = j.accessors.length; j.accessors.push({bufferView: view, componentType: 5125, count: ix.length, type: 'SCALAR', min: [Math.min(...ix)], max: [Math.max(...ix)]}); return id;
  };
  await MeshoptSimplifier.ready;
  const rows = [], changedNodes = new Map();
  for (const family of ownership.roots) {
    const row = {...family, nodes: [], sourceTrianglesPerActor: 0, outputTrianglesPerActor: 0};
    for (const node of family.nodes) {
      const sourceMesh = m.j.nodes[node].mesh, mesh = m.j.meshes[sourceMesh], sourceTri = mesh.primitives.reduce((s, p) => s + m.j.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);
      if (family.protectedHero) {
        row.sourceTrianglesPerActor += sourceTri; row.outputTrianglesPerActor += sourceTri;
        row.nodes.push({node, sourceMesh, outputMesh: sourceMesh, protected: true}); continue;
      }
      const plans = mesh.primitives.map(p => preparePrimitive(m, p, maxError)), clone = structuredClone(mesh), changed = plans.some(p => p.output.length < p.indices.length);
      let outputMesh = sourceMesh;
      if (changed) {
        for (let p = 0; p < plans.length; p++) if (plans[p].output.length < plans[p].indices.length) clone.primitives[p].indices = appendIndices(plans[p].output);
        clone.name = (mesh.name ?? family.family) + '_BudgetExperiment';
        outputMesh = j.meshes.length; j.meshes.push(clone); j.nodes[node].mesh = outputMesh; changedNodes.set(node, outputMesh);
      }
      const outputTri = plans.reduce((s, p) => s + p.output.length / 3, 0);
      row.sourceTrianglesPerActor += sourceTri; row.outputTrianglesPerActor += outputTri;
      row.nodes.push({node, sourceMesh, outputMesh, changed, primitives: plans.map((p, primitive) => ({primitive, sourceTriangles: p.indices.length / 3, outputTriangles: p.output.length / 3, sourceComponents: p.sourceComponents, outputComponents: p.outputComponents, sourceBoundaryEdges: p.sourceBoundaryEdges, outputBoundaryEdges: p.outputBoundaryEdges, sourceSingleTriangleComponents: p.sourceSingleTriangleComponents, sourceTwoTriangleComponents: p.sourceTwoTriangleComponents, maximumReportedErrorSourceMetres: p.maxReportedError, rejectedComponents: p.rejectedComponents, vertexAttributesByteIdentical: true})), alphaSilhouetteProxy: changed ? await coverage(m, mesh, plans) : {unchangedIndexAndAttributeBytes: true, worstLostSourceCoverageRatio: 0, minimumIntersectionOverUnion: 1}});
    }
    row.savingByTier = Object.fromEntries(['low', 'medium', 'high'].map(t => [t, family.counts[t] * (row.sourceTrianglesPerActor - row.outputTrianglesPerActor)]));
    rows.push(row);
  }
  if (!changedNodes.size) throw Error('No topology-preserving simplification was feasible; no candidate written.');
  const binary = Buffer.concat(chunks);
  j.buffers[0].byteLength = Math.ceil(binary.length / 4) * 4;
  j.asset.extras ??= {};
  j.asset.extras.crownfallFoliageBudgetExperiment = {schema: 1, offByDefault: true, cpuOnly: true, inputSha256: options.expectedSha256, generator: 'scripts/prepare-ealdholt-foliage-budget.mjs', originalInstancesAndHeroGeometryExact: true, maxErrorSourceMetres: maxError};
  const candidateBytes = encode(j, binary), candidate = decode(candidateBytes);
  // Protect every existing table entry and every original byte. Only the exact tagged
  // nonhero child mesh references and the explicit asset experiment record may change.
  for (const key of ['meshes', 'accessors', 'bufferViews']) if (!same(j[key].slice(0, m.j[key].length), m.j[key])) throw Error('Original ' + key + ' changed.');
  for (const key of ['materials', 'images', 'textures', 'samplers', 'scenes', 'skins', 'animations', 'extensionsUsed', 'extensionsRequired']) if (!same(j[key], m.j[key])) throw Error('Protected ' + key + ' changed.');
  for (let i = 0; i < j.nodes.length; i++) {
    const n = structuredClone(j.nodes[i]);
    if (changedNodes.has(i)) n.mesh = m.j.nodes[i].mesh;
    if (!same(n, m.j.nodes[i])) throw Error('Node, source frame, instance attributes or family metadata changed.');
  }
  if (!candidate.bin.subarray(0, m.bin.length).equals(m.bin)) throw Error('Original geometry/image/instance BIN prefix changed.');
  const assetBefore = structuredClone(j.asset); delete assetBefore.extras.crownfallFoliageBudgetExperiment;
  if (!m.j.asset.extras) delete assetBefore.extras;
  if (!same(assetBefore, m.j.asset)) throw Error('Original asset provenance changed.');
  const before = tierCosts(m, ownership), after = tierCosts(candidate, ownership), tiers = after.map((r, i) => ({...r, sourceModelTriangles: before[i].modelTriangles, triangleSaving: before[i].modelTriangles - r.modelTriangles, sourceModelDraws: before[i].modelDraws, sourceReferencedGeometryBytes: before[i].referencedGeometryBytes}));
  const acceptance = evaluateFoliageBudgetAcceptance(rows, tiers);
  const scopeFloor = before.map(t => ({tier: t.tier, eligibleAddedTriangles: rows.filter(r => !r.protectedHero).reduce((s, r) => s + r.counts[t.tier] * r.sourceTrianglesPerActor, 0), protectedTriangles: t.modelTriangles - rows.filter(r => !r.protectedHero).reduce((s, r) => s + r.counts[t.tier] * r.sourceTrianglesPerActor, 0), explanation: 'Protected geometry alone; even the impossible zero-triangle bound for every eligible prototype cannot reduce this total.'}));
  const images = (m.j.images ?? []).map((image, index) => {const view = m.j.bufferViews[image.bufferView]; return {index, bytes: view.byteLength, sha256: hash(m.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))};});
  const frameNodes = m.j.nodes.map(n => { const v = structuredClone(n); delete v.mesh; return v; });
  const report = {kind: 'PRIVATE CPU-only additions-only foliage budget inspect/reject experiment', accepted: false, acceptance, selectedByDefault: false, input: {path: input, sha256: options.expectedSha256, bytes: sourceBytes.length}, output: {path: output, sha256: hash(candidateBytes), bytes: candidateBytes.length, byteChange: candidateBytes.length - sourceBytes.length},
    method: {absoluteErrorSourceMetres: maxError, targetIndexRatio: .25, flags: ['ErrorAbsolute', 'LockBorder'], noPrune: true, eachIndexedConnectedComponentIndependent: true, everySourceBoundaryVertexLocked: true, sixPrimitiveExtremaLocked: true, attributeWeights: {uv: .2, normalAndTangent: .05}, onlyOriginalVerticesAndAttributesUsed: true},
    conservation: {allOriginalNodes: m.j.nodes.length, nodeCount: j.nodes.length, changedAddedMeshReferences: [...changedNodes.keys()], originalMeshTableAndGeometryBytesExact: true, originalBinPrefixBytes: m.bin.length, originalBinPrefixSha256: hash(m.bin), imageCount: images.length, encodedImageBytes: images.reduce((s, i) => s + i.bytes, 0), imageHashes: images, materialCount: (m.j.materials ?? []).length, materialsAndMapsAndAlphaExact: true, sourceNodeFramesAndInstanceAccessorBytesExact: true, allNodeFrameAndPlacementSha256: hash(Buffer.from(JSON.stringify(frameNodes))), allFamilyCountsAndMetadataExact: true, protectedHeroFamilies: rows.filter(r => r.protectedHero).map(r => r.family), sourcePondTerrainStructuresAndFoliageGeometryExact: true},
    tiers, protectedGeometryFloor: scopeFloor, families: rows, limits: ['Potential model triangles/draws assume every selected actor is submitted once; excludes frustum/occlusion, stereo, shadows, UI and hands.', 'All instance counts, quality tier choices, root locations and frames remain exact. No density or actor removal. Source originals and all fixed heroes remain exact.', 'CPU silhouette is a coarse orthographic alpha-coverage proxy. It does not establish visual parity, perspective silhouette, material lighting, animated wind, ground contact, overdraw or headset performance.', 'Preserving the entire source BIN makes this derivative larger on disk. No file, image or total GPU-memory saving is claimed.', 'Input provenance and its historical estimates are retained unchanged; use this report for the experimental derivative costs.', 'This tool produces inspection artifacts only. Coverage or triangle-budget gate failure rejects the experiment; a CPU gate pass still cannot select or visually approve a derivative.']};
  if (hash(await readFile(input)) !== options.expectedSha256) throw Error('Source changed during experiment.');
  await writeFile(output, candidateBytes, {flag: 'wx', mode: 0o600});
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3) { console.error('Usage: node scripts/prepare-ealdholt-foliage-budget.mjs input.glb separate-private-output.glb EXPECTED_INPUT_SHA256'); process.exitCode = 1; }
  else prepareEaldholtFoliageBudget(args[0], args[1], {expectedSha256: args[2]}).then(r => console.log(JSON.stringify({accepted: false, acceptance: r.acceptance, output: r.output, tiers: r.tiers, protectedGeometryFloor: r.protectedGeometryFloor, families: r.families.map(f => ({family: f.family, sourceTrianglesPerActor: f.sourceTrianglesPerActor, outputTrianglesPerActor: f.outputTrianglesPerActor, savingByTier: f.savingByTier}))}, null, 2))).catch(e => {console.error(e.stack ?? e.message); process.exitCode = 1;});
}
