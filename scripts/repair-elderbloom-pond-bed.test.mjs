import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, symlink, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePondRepairGlb, repairElderbloomPondBedYOnly, repairElderbloomPondBed, repairElderbloomPondBedFiles } from './repair-elderbloom-pond-bed.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
function encode(json, bin) { const raw = Buffer.from(JSON.stringify(json)), text = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]), h = Buffer.alloc(20), b = Buffer.alloc(8); h.writeUInt32LE(0x46546c67); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + text.length + bin.length, 8); h.writeUInt32LE(text.length, 12); h.writeUInt32LE(0x4e4f534a, 16); b.writeUInt32LE(bin.length); b.writeUInt32LE(0x004e4942, 4); return Buffer.concat([h, text, b, bin]); }
function fixture(y) {
  const parts = [], g = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], materials: [{ name: 'Crownfall_LAAS_Test' }, { name: 'Crownfall_Pond_Water_Review' }], images: [], textures: [] }; let length = 0;
  function add(data, type, width) { const padding = (4 - length % 4) % 4; if (padding) { parts.push(Buffer.alloc(padding)); length += padding; } const id = g.accessors.length; g.accessors.push({ bufferView: g.bufferViews.length, componentType: data instanceof Uint16Array ? 5123 : 5126, type, count: data.length / width }); g.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.byteLength }); parts.push(Buffer.from(data.buffer)); length += data.byteLength; return id; }
  const position = add(Float32Array.from([-6, y, -6, 6, y, -6, 6, y, 6, -6, y, 6]), 'VEC3', 3), normal = add(Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 'VEC3', 3), uv = add(Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]), 'VEC2', 2), indices = add(Uint16Array.from([0, 2, 1, 0, 3, 2]), 'SCALAR', 1);
  g.meshes.push({ name: 'LandscapeComponent_0', primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv, TEXCOORD_1: uv, TEXCOORD_2: uv }, indices, material: 0 }] });
  const water = [0, .1, 0], wi = []; for (let i = 0; i < 12; i++) water.push(Math.cos(i * Math.PI / 6) * 3, .1, Math.sin(i * Math.PI / 6) * 3); for (let i = 0; i < 12; i++) wi.push(0, (i + 1) % 12 + 1, i + 1);
  const wp = add(Float32Array.from(water), 'VEC3', 3), wix = add(Uint16Array.from(wi), 'SCALAR', 1); g.meshes.push({ name: 'Pond', primitives: [{ attributes: { POSITION: wp }, indices: wix, material: 1 }] });
  g.meshes.push({ name: 'UnrelatedProp', primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material: 0 }] });
  g.nodes.push({ name: 'Ground', mesh: 0 }, { name: 'Water', mesh: 1 }, { name: 'SharedSourceActor', mesh: 2, translation: [30, 2, 0] });
  const pad = (4 - length % 4) % 4; if (pad) { parts.push(Buffer.alloc(pad)); length += pad; } g.buffers[0].byteLength = length; return encode(g, Buffer.concat(parts));
}
function values(g, bin, id) { const a = g.accessors[id], v = g.bufferViews[a.bufferView], width = { VEC2: 2, VEC3: 3, SCALAR: 1 }[a.type], size = a.componentType === 5123 ? 2 : 4, result = []; for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) { const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? width * size) + c * size; result.push(a.componentType === 5126 ? bin.readFloatLE(at) : size === 2 ? bin.readUInt16LE(at) : bin.readUInt32LE(at)); } return result; }
function ground(bytes) { const { json, bin } = decodePondRepairGlb(bytes), p = json.meshes[0].primitives[0]; return { json, bin, p, positions: values(json, bin, p.attributes.POSITION), normals: values(json, bin, p.attributes.NORMAL), uv: values(json, bin, p.attributes.TEXCOORD_0), indices: values(json, bin, p.indices) }; }
function at(data, x, z) { let top = null; for (let i = 0; i < data.indices.length; i += 3) { const [a, b, c] = data.indices.slice(i, i + 3).map(id => data.positions.slice(id * 3, id * 3 + 3)), dx1 = b[0] - a[0], dz1 = b[2] - a[2], dx2 = c[0] - a[0], dz2 = c[2] - a[2], d = dx1 * dz2 - dx2 * dz1; if (Math.abs(d) < 1e-10) continue; const u = ((x - a[0]) * dz2 - (z - a[2]) * dx2) / d, v = (dx1 * (z - a[2]) - dz1 * (x - a[0])) / d; if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue; const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]); if (top === null || y > top) top = y; } return top; }

test('local pond subdivision preserves source bytes/actors/vertices/UVs and the exact outside surface', () => {
  const source = fixture(.15), reference = fixture(0), expected = { inputSha256: hash(source), referenceSha256: hash(reference), terrainComponents: 1, referenceTerrainComponents: 1 }, result = repairElderbloomPondBed(source, reference, expected), before = ground(source), after = ground(result.bytes);
  assert.equal(result.report.localSubdivision, true); assert.ok(result.report.addedTriangles > 0 && result.report.addedTriangles <= 2000);
  assert.ok(after.bin.subarray(0, before.bin.length).equals(before.bin)); assert.deepEqual(after.positions.slice(0, before.positions.length), before.positions);
  for (const key of ['nodes', 'materials', 'images', 'textures']) assert.deepEqual(after.json[key], before.json[key]); assert.deepEqual(after.json.meshes.slice(1), before.json.meshes.slice(1));
  for (let z = -5.5; z <= 5.5; z += .25) for (let x = -5.5; x <= 5.5; x += .25) { const y = at(after, x, z); assert.notEqual(y, null); if (Math.hypot(x, z) > 3.01) assert.ok(Math.abs(y - .15) < 1e-6); if (Math.hypot(x, z) < 2.5) assert.ok(Math.abs(y) < 1e-5); }
  for (let i = 0; i < after.positions.length / 3; i++) { assert.ok(Math.abs(after.uv[i * 2] - (after.positions[i * 3] + 6) / 12) < 1e-6); assert.ok(Math.abs(after.uv[i * 2 + 1] - (after.positions[i * 3 + 2] + 6) / 12) < 1e-6); assert.ok(Math.abs(Math.hypot(...after.normals.slice(i * 3, i * 3 + 3)) - 1) < 1e-5); }
  let area = 0; const edges = new Map(); for (let i = 0; i < after.indices.length; i += 3) { const ids = after.indices.slice(i, i + 3), [a, b, c] = ids.map(id => after.positions.slice(id * 3, id * 3 + 3)), signed = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); assert.ok(signed < -1e-8, 'all new faces must be nondegenerate with original winding'); area -= signed / 2; for (let e = 0; e < 3; e++) { const pair = [ids[e], ids[(e + 1) % 3]].sort((a, b) => a - b).join(':'); edges.set(pair, (edges.get(pair) ?? 0) + 1); } }
  assert.ok(Math.abs(area - 144) < 1e-4, 'local subdivision must neither overlap nor remove surface area');
  for (const [edge, count] of edges) { assert.ok(count <= 2); if (count === 1) { const [a, b] = edge.split(':').map(Number).map(id => after.positions.slice(id * 3, id * 3 + 3)); assert.ok(Math.abs(a[0]) === 6 && Math.abs(b[0]) === 6 || Math.abs(a[2]) === 6 && Math.abs(b[2]) === 6, 'no open internal shoreline or T-junction edges'); } }
});

test('every repair entry requires explicit valid identities and both exact source matches', async () => {
  const a = fixture(.15), b = fixture(0), expected = { inputSha256: hash(a), referenceSha256: hash(b), terrainComponents: 1, referenceTerrainComponents: 1 };
  for (const repair of [repairElderbloomPondBed, repairElderbloomPondBedYOnly]) {
    for (const missing of [undefined, null, [], {}, 'private-config']) assert.throws(() => repair(a, b, missing), /Explicit expected input\/reference SHA-256/);
    for (const key of ['inputSha256', 'referenceSha256']) {
      for (const invalid of ['', 'a'.repeat(63), 'g'.repeat(64), ' ' + 'a'.repeat(64), 1]) {
        assert.throws(() => repair(a, b, { ...expected, [key]: invalid }), /64 hexadecimal characters/);
      }
      assert.throws(() => repair(a, b, { ...expected, [key]: 'a'.repeat(64) }), /Unknown input\/reference hashes/);
    }
    for (const key of ['terrainComponents', 'referenceTerrainComponents']) {
      for (const invalid of [0, -1, 1.5, Infinity]) assert.throws(() => repair(a, b, { ...expected, [key]: invalid }), /component counts/);
    }
  }
  assert.throws(() => repairElderbloomPondBed(a, b, { inputSha256: hash(a), referenceSha256: hash(b) }), /landscape component count/, 'default structure still requires the reviewed 64-component reference');
  const upper = repairElderbloomPondBed(a, b, { ...expected, inputSha256: hash(a).toUpperCase(), referenceSha256: hash(b).toUpperCase() });
  assert.equal(upper.report.inputSha256, hash(a)); assert.equal(upper.report.referenceSha256, hash(b));
  await assert.rejects(repairElderbloomPondBedFiles('unused-low.glb', 'unused-high.glb', 'unused-output.glb'), /Explicit expected input\/reference SHA-256/);
});

test('unknown inputs, in-place paths, existing/symlink outputs and original-size sources are refused', async () => {
  const a = fixture(.15), b = fixture(0), expected = { inputSha256: hash(a), referenceSha256: hash(b), terrainComponents: 1, referenceTerrainComponents: 1 };
  const dir = await mkdtemp(join(tmpdir(), 'pond-repair-')); try { const input = join(dir, 'low.glb'), reference = join(dir, 'high.glb'), output = join(dir, 'out.glb'); await writeFile(input, a); await writeFile(reference, b); await writeFile(output, 'preserve');
    await assert.rejects(repairElderbloomPondBedFiles(input, reference, input, expected), /never overwrite/); await assert.rejects(repairElderbloomPondBedFiles(input, reference, output, expected), /already exists/); assert.equal(await readFile(output, 'utf8'), 'preserve');
    await symlink(input, join(dir, 'alias.glb')); await assert.rejects(repairElderbloomPondBedFiles(input, reference, join(dir, 'alias.glb'), expected), /already exists/);
    await assert.rejects(repairElderbloomPondBedFiles(input, reference, join(dir, 'unknown.glb'), { ...expected, inputSha256: 'a'.repeat(64) }), /Unknown input/);
    const fresh = join(dir, 'repaired.glb'), report = await repairElderbloomPondBedFiles(input, reference, fresh, expected);
    assert.equal(report.localSubdivision, true); assert.equal(report.inputSha256, hash(a)); assert.equal(report.referenceSha256, hash(b));
    assert.equal(hash(await readFile(fresh)), report.outputSha256); assert.equal(JSON.parse(await readFile(fresh + '.pond-bed-report.json', 'utf8')).outputSha256, report.outputSha256);
    await truncate(input, 256 * 1024 * 1024 + 1); await assert.rejects(repairElderbloomPondBedFiles(input, reference, join(dir, 'too-large.glb'), expected), /never the original/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI requires operator hash flags and never authorizes the input from its observed digest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pond-repair-cli-'));
  try {
    const input = join(dir, 'low.glb'), reference = join(dir, 'high.glb'), output = join(dir, 'out.glb');
    await writeFile(input, fixture(.15)); await writeFile(reference, fixture(0));
    const script = fileURLToPath(new URL('./repair-elderbloom-pond-bed.mjs', import.meta.url));
    const run = flags => spawnSync(process.execPath, [script, input, reference, output, ...flags], { encoding: 'utf8' });
    const absent = run([]); assert.notEqual(absent.status, 0); assert.match(absent.stderr, /Explicit expected input\/reference SHA-256/);
    const invalid = run(['--input-sha256', 'invalid', '--reference-sha256', 'b'.repeat(64)]);
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /64 hexadecimal characters/);
    const wrong = run(['--input-sha256', 'a'.repeat(64), '--reference-sha256', 'b'.repeat(64)]);
    assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /Unknown input\/reference hashes/);
    await assert.rejects(readFile(output), { code: 'ENOENT' }); await assert.rejects(readFile(output + '.pond-bed-report.json'), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
