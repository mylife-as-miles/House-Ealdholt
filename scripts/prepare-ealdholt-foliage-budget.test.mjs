import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareEaldholtFoliageBudget, evaluateFoliageBudgetAcceptance} from './prepare-ealdholt-foliage-budget.mjs';
const require = createRequire(import.meta.url), sharp = require('sharp');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function parse(bytes) {
  const end = 20 + bytes.readUInt32LE(12);
  return {j: JSON.parse(bytes.subarray(20, end)), bin: bytes.subarray(end + 8)};
}
async function fixture() {
  const j = {asset: {version: '2.0', extras: {sourcePond: {unchanged: true}}}, scene: 0, scenes: [{nodes: [0, 1, 3]}], nodes: [], meshes: [], buffers: [{byteLength: 0}], bufferViews: [], accessors: [], materials: [], images: [], textures: [], samplers: [{}]}, chunks = [];
  let length = 0;
  const append = (bytes, target) => {
    const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    const id = j.bufferViews.length; j.bufferViews.push({buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? {target} : {})}); chunks.push(bytes); length += bytes.length; return id;
  };
  const accessor = (values, type, indices = false) => {
    const array = indices ? Uint32Array.from(values) : Float32Array.from(values), id = j.accessors.length;
    j.accessors.push({bufferView: append(Buffer.from(array.buffer), indices ? 34963 : 34962), componentType: indices ? 5125 : 5126, count: values.length / ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[type]), type}); return id;
  };
  const pos = [], uv = [], normal = [], tangent = [], indices = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {pos.push(x / 9, y / 9, 0); uv.push(x / 9, y / 9); normal.push(0, 0, 1); tangent.push(1, 0, 0, 1);}
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {const a = y * 10 + x; indices.push(a, a + 1, a + 10, a + 1, a + 11, a + 10);}
  // A separate minimal triangle must survive unchanged alongside the dense grid.
  pos.push(1.2, 0, 0, 1.3, 0, 0, 1.2, .1, 0); uv.push(0, 0, 1, 0, 0, 1);
  for (let i = 0; i < 3; i++) {normal.push(0, 0, 1); tangent.push(1, 0, 0, 1);} indices.push(100, 101, 102);
  const p = {attributes: {POSITION: accessor(pos, 'VEC3'), NORMAL: accessor(normal, 'VEC3'), TANGENT: accessor(tangent, 'VEC4'), TEXCOORD_0: accessor(uv, 'VEC2')}, indices: accessor(indices, 'SCALAR', true), material: 0};
  j.meshes = [{name: 'SourcePondAndFoliageControl', primitives: [p]}, {name: 'ProtectedHero', primitives: [structuredClone(p)]}];
  const png = await sharp(Buffer.from([255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255]), {raw: {width: 2, height: 2, channels: 4}}).png().toBuffer();
  j.images.push({bufferView: append(png), mimeType: 'image/png'}); j.textures.push({source: 0, sampler: 0});
  j.materials.push({alphaMode: 'MASK', alphaCutoff: .5, doubleSided: true, pbrMetallicRoughness: {baseColorTexture: {index: 0, extensions: {KHR_texture_transform: {offset: [.1, .1], scale: [.8, .8], rotation: .1}}}}});
  const attrs = {TRANSLATION: accessor([0, 0, 0, 3, 0, 1, -2, 0, 2], 'VEC3'), ROTATION: accessor([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 'VEC4'), SCALE: accessor([1, 1, 1, 2, 1, 2, 1, 1, 1], 'VEC3')};
  const hero = {TRANSLATION: accessor([5, 0, 5], 'VEC3')};
  j.nodes = [{name: 'Untouched pond/source actor', mesh: 0, translation: [-1, 2, 3]}, {name: 'Added family', children: [2], extras: {crownfallFoliageDensity: {schema: 1, family: 'native-source-grass2-v1', components: 1, counts: {low: 1, medium: 2, high: 3}}}}, {mesh: 0, extensions: {EXT_mesh_gpu_instancing: {attributes: attrs}}}, {children: [4], extras: {crownfallFoliageDensity: {schema: 1, family: 'native-source-forest01-hero-v1', components: 1, counts: {low: 1, medium: 1, high: 1}}}}, {name: 'Fixed hero', mesh: 1, extensions: {EXT_mesh_gpu_instancing: {attributes: hero}}}];
  const binary = Buffer.concat(chunks), bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]); j.buffers[0].byteLength = bin.length;
  const json = Buffer.from(JSON.stringify(j)), text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]), out = Buffer.alloc(28 + text.length + bin.length), at = 20 + text.length;
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20); out.writeUInt32LE(bin.length, at); out.writeUInt32LE(0x004e4942, at + 4); bin.copy(out, at + 8); return out;
}
async function inFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'crownfall-foliage-budget-'));
  try {const bytes = await fixture(), input = join(dir, 'source.glb'); await writeFile(input, bytes); await fn({dir, bytes, input, expectedSha256: hash(bytes)});} finally {await rm(dir, {recursive: true, force: true});}
}
test('reduces only added prototype indices while preserving original actors, heroes, cards, maps and matrices', async () => inFixture(async ({dir, bytes, input, expectedSha256}) => {
  const output = join(dir, 'candidate.glb'), report = await prepareEaldholtFoliageBudget(input, output, {expectedSha256}), source = parse(bytes), candidate = parse(await readFile(output));
  assert.equal(report.selectedByDefault, false); assert.equal(report.accepted, false); assert.equal(report.acceptance.cpuCoverageGate.passed, true); assert.equal(candidate.j.asset.extras.crownfallFoliageBudgetExperiment.offByDefault, true);
  assert.deepEqual(candidate.bin.subarray(0, source.bin.length), source.bin); assert.deepEqual(await readFile(input), bytes);
  for (const key of ['materials', 'images', 'textures', 'samplers', 'scenes']) assert.deepEqual(candidate.j[key], source.j[key]);
  assert.deepEqual(candidate.j.meshes.slice(0, source.j.meshes.length), source.j.meshes);
  assert.equal(candidate.j.nodes.length, source.j.nodes.length);
  for (let i = 0; i < candidate.j.nodes.length; i++) {const copy = structuredClone(candidate.j.nodes[i]); if (i === 2) copy.mesh = 0; assert.deepEqual(copy, source.j.nodes[i]);}
  const p = candidate.j.meshes[candidate.j.nodes[2].mesh].primitives[0];
  assert.deepEqual(p.attributes, source.j.meshes[0].primitives[0].attributes); assert.equal(p.material, 0);
  assert.ok(candidate.j.accessors[p.indices].count < source.j.accessors[source.j.meshes[0].primitives[0].indices].count);
  const family = report.families[0], part = family.nodes[0].primitives[0];
  assert.equal(part.sourceComponents, 2); assert.equal(part.outputComponents, 2); assert.equal(part.sourceBoundaryEdges, part.outputBoundaryEdges); assert.equal(part.sourceSingleTriangleComponents, 1);
  assert.ok(report.tiers[1].triangleSaving > 100); assert.equal(report.tiers[1].taggedActors, 3); assert.equal(report.tiers[1].modelDraws, 3);
  assert.equal(report.families[1].sourceTrianglesPerActor, report.families[1].outputTrianglesPerActor);
  assert.ok(family.nodes[0].alphaSilhouetteProxy.worstLostSourceCoverageRatio < .01);
  assert.ok(report.output.byteChange > 0); assert.equal(report.conservation.imageCount, 1);
  assert.equal(JSON.parse(await readFile(output + '.foliage-budget-report.json')).output.sha256, hash(await readFile(output)));
  await assert.rejects(prepareEaldholtFoliageBudget(input, output, {expectedSha256}), /Output exists/);
}));
test('requires an exact operator SHA and refuses source/candidate overwrite or symlink targets', async () => inFixture(async ({dir, bytes, input, expectedSha256}) => {
  const output = join(dir, 'candidate.glb');
  await assert.rejects(prepareEaldholtFoliageBudget(input, output), /operator-supplied/);
  await assert.rejects(prepareEaldholtFoliageBudget(input, output, {expectedSha256: '0'.repeat(64)}), /SHA-256 differs/);
  await assert.rejects(prepareEaldholtFoliageBudget(input, input, {expectedSha256}), /Output exists/);
  await symlink(input, output);
  await assert.rejects(prepareEaldholtFoliageBudget(input, output, {expectedSha256}), /symlink/);
  assert.deepEqual(await readFile(input), bytes);
}));
test('rejects nonfinite geometry, invalid tier counts, excessive error and untagged inputs before writing', async () => inFixture(async ({dir, bytes, input, expectedSha256}) => {
  await assert.rejects(prepareEaldholtFoliageBudget(input, join(dir, 'too-loose.glb'), {expectedSha256, maxErrorMetres: .1}), /Absolute source-space error/);
  const nonfinite = Buffer.from(bytes), {j} = parse(bytes), start = 28 + bytes.readUInt32LE(12) + j.bufferViews[j.accessors[0].bufferView].byteOffset;
  nonfinite.writeFloatLE(NaN, start); await writeFile(join(dir, 'bad.glb'), nonfinite);
  await assert.rejects(prepareEaldholtFoliageBudget(join(dir, 'bad.glb'), join(dir, 'no.glb'), {expectedSha256: hash(nonfinite)}), /Non-finite accessor/);
  const invalid = Buffer.from(bytes), old = Buffer.from('"low":1,"medium":2,"high":3'), at = invalid.indexOf(old); assert.ok(at > 0);
  Buffer.from('"low":4,"medium":2,"high":3').copy(invalid, at); await writeFile(join(dir, 'counts.glb'), invalid);
  await assert.rejects(prepareEaldholtFoliageBudget(join(dir, 'counts.glb'), join(dir, 'no-counts.glb'), {expectedSha256: hash(invalid)}), /tier counts/);
  const untagged = Buffer.from(bytes), needle = Buffer.from('crownfallFoliageDensity'), replacement = Buffer.from('untrustedFoliageDensity');
  assert.equal(needle.length, replacement.length);
  for (let at = untagged.indexOf(needle); at >= 0; at = untagged.indexOf(needle, at + replacement.length)) replacement.copy(untagged, at);
  await writeFile(join(dir, 'untagged.glb'), untagged);
  await assert.rejects(prepareEaldholtFoliageBudget(join(dir, 'untagged.glb'), join(dir, 'no-tags.glb'), {expectedSha256: hash(untagged)}), /Expected additions-only foliage tags/);
}));
test('default CPU acceptance rejects flower coverage loss and over-budget tiers, and never implies visual acceptance', () => {
  const rows = [{family: 'flower', nodes: [{node: 1, alphaSilhouetteProxy: {worstLostSourceCoverageRatio: .088, minimumIntersectionOverUnion: .879}}]}];
  const result = evaluateFoliageBudgetAcceptance(rows, [{tier: 'medium', modelTriangles: 364384}]);
  assert.equal(result.accepted, false); assert.equal(result.decision, 'rejected'); assert.equal(result.cpuCoverageGate.passed, false); assert.equal(result.triangleBudgetGate.passed, false);
  assert.equal(result.cpuCoverageGate.failures[0].family, 'flower'); assert.equal(result.triangleBudgetGate.failures[0].overBudgetTriangles, 114384);
  const clean = evaluateFoliageBudgetAcceptance([{family: 'identical', nodes: [{node: 2, alphaSilhouetteProxy: {worstLostSourceCoverageRatio: 0, minimumIntersectionOverUnion: 1}}]}], [{tier: 'medium', modelTriangles: 200000}]);
  assert.equal(clean.accepted, false); assert.equal(clean.decision, 'awaiting-separate-visual-review');
  assert.equal(evaluateFoliageBudgetAcceptance([{family: 'missing-proof', nodes: [{node: 3}]}], []).cpuCoverageGate.passed, false);
});
