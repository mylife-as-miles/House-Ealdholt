import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { accessor, correctedStewardUvBytes, countGeometricComponents, createQualifiedReader, loadGltf, loadQualifiedGltf, preflightPrivateOutput, prepareSteward, retargetWorldRotation, simplifyStewardPart, stewardAtlasUv, validateNormalAliases, validateStewardGlb, verifySources } from './prepare-ealdholt-steward.mjs';
const coreRoot = new URL('../main-game-vr/node_modules/@iwsdk/core/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', coreRoot), 'utf8'));
const { Quaternion, Vector3 } = await import(new URL(metadata.exports['.'].import, coreRoot).href);
const output = process.env.CROWNFALL_STEWARD_TEST_OUTPUT;
const lodOutput = process.env.CROWNFALL_STEWARD_LOD_OUTPUT;
const uvOutput = process.env.CROWNFALL_STEWARD_UV_OUTPUT;
async function privateFixture(t) {
  const base = await mkdtemp(resolve(tmpdir(), 'crownfall-steward-safety-'));t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(resolve(base, 'raw'));await mkdir(resolve(base, 'derived'));await writeFile(resolve(base, 'raw/sentinel.bin'), 'original raw bytes');return base;
}
test('existing directory/license symlink exploit is refused before source processing or output writes', async t => {
  const base = await privateFixture(t), output = resolve(base, 'derived/existing');await mkdir(output);
  await symlink(resolve(base, 'raw/sentinel.bin'), resolve(output, 'mcof-License.txt'));
  await assert.rejects(prepareSteward(base, output), /fresh output directory/);
  assert.equal(await readFile(resolve(base, 'raw/sentinel.bin'), 'utf8'), 'original raw bytes');assert.deepEqual(await readdir(output), ['mcof-License.txt']);
  const file = resolve(base, 'derived/existing-file');await writeFile(file, 'existing result');await assert.rejects(prepareSteward(base, file), /fresh output directory/);assert.equal(await readFile(file, 'utf8'), 'existing result');
  const alias = resolve(base, 'derived/alias');await symlink(resolve(base, 'raw'), alias);await assert.rejects(prepareSteward(base, alias), /fresh output directory/);assert.deepEqual(await readdir(resolve(base, 'raw')), ['sentinel.bin']);
});
test('all targets are rechecked before writes and symlink/hardlink refusal preserves raw bytes and partial results', async t => {
  const base = await privateFixture(t), names = ['body.glb', 'mcof-License.txt'], path = resolve(base, 'derived/fresh'), plan = await preflightPrivateOutput(base, path, names), writer = await plan.create();
  try {
    await symlink(resolve(base, 'raw/sentinel.bin'), resolve(path, 'mcof-License.txt'));
    await assert.rejects(writer.write('body.glb', Buffer.from('new body')), /existing\/symlink output target/);assert.deepEqual(await readdir(path), ['mcof-License.txt']);
    await rm(resolve(path, 'mcof-License.txt'));await writer.write('body.glb', Buffer.from('retained partial'));
    await link(resolve(base, 'raw/sentinel.bin'), resolve(path, 'mcof-License.txt'));
    await assert.rejects(writer.write('mcof-License.txt', Buffer.from('CC0 replacement')), /existing\/symlink output target/);
    assert.equal(await readFile(resolve(path, 'body.glb'), 'utf8'), 'retained partial');assert.equal(await readFile(resolve(base, 'raw/sentinel.bin'), 'utf8'), 'original raw bytes');
  } finally { await writer.close(); }
});
test('a directory injected after preflight and a symlinked derived parent are refused without new outputs', async t => {
  const base = await privateFixture(t), path = resolve(base, 'derived/raced'), plan = await preflightPrivateOutput(base, path, ['body.glb']);
  await mkdir(path);await symlink(resolve(base, 'raw/sentinel.bin'), resolve(path, 'body.glb'));await assert.rejects(plan.create(), /fresh output directory/);assert.deepEqual(await readdir(path), ['body.glb']);
  await rm(resolve(base, 'derived'), { recursive: true });await symlink(resolve(base, 'raw'), resolve(base, 'derived'));
  await assert.rejects(preflightPrivateOutput(base, resolve(base, 'derived/new'), ['body.glb']), /symlink path refused/);assert.deepEqual(await readdir(resolve(base, 'raw')), ['sentinel.bin']);
});
test('consumed path membership, expected bytes and no-follow checks bind every model and BIN/image dependency', async t => {
  const base = await privateFixture(t), modelPath = resolve(base, 'raw/model.gltf'), binaryPath = resolve(base, 'raw/model.bin'), imagePath = resolve(base, 'raw/normal.png');
  const model = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin', byteLength: 3 }], images: [{ uri: 'normal.png' }] }));
  await writeFile(modelPath, model);await writeFile(binaryPath, 'BIN');await writeFile(imagePath, 'PNG');
  function entry(path, bytes) { return { path, archive_member: path.slice(resolve(base, 'raw').length + 1), pack: 'test', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
  const entries = [entry(modelPath, model), entry(binaryPath, Buffer.from('BIN')), entry(imagePath, Buffer.from('PNG'))];
  await assert.rejects(loadQualifiedGltf(modelPath, createQualifiedReader(base, entries.slice(0, 1))), /outside the archive-qualified intake/);
  await assert.rejects(loadQualifiedGltf(modelPath, createQualifiedReader(base, entries.slice(0, 2))), /outside the archive-qualified intake/);
  const read = createQualifiedReader(base, entries);assert.equal((await loadQualifiedGltf(modelPath, read)).binary.toString(), 'BIN');assert.equal(read.consumed.size, 3);
  const external = resolve(base, 'modified-copy.gltf');await writeFile(external, model);await assert.rejects(loadQualifiedGltf(external, read), /outside the archive-qualified intake/);
  await writeFile(binaryPath, 'BAD');await assert.rejects(loadQualifiedGltf(modelPath, createQualifiedReader(base, entries)), /byte hash changed/);
  await rm(binaryPath);await symlink(resolve(base, 'raw/sentinel.bin'), binaryPath);await assert.rejects(loadQualifiedGltf(modelPath, createQualifiedReader(base, entries)), /symlink path refused/);
  assert.deepEqual(await readdir(resolve(base, 'derived')), []);assert.equal(await readFile(resolve(base, 'raw/sentinel.bin'), 'utf8'), 'original raw bytes');
});
test('normal URI corrections accept only the two exact archive-qualified vendor aliases', () => {
  const head = '/private/raw/vendor/Superhero_Male_FullBody.gltf', hair = '/private/raw/vendor/T_Hair_1_Normal.png', eye = '/private/raw/vendor/T_Eye_Normal.png';
  const aliases = [{ referenced_by: head, incorrect_uri: 'T_Hair_1_Normal_png.png', available_original: hair }, { referenced_by: head, incorrect_uri: 'T_Eye_Normal_png.png', available_original: eye }], inventory = [{ path: hair }, { path: eye }];
  assert.deepEqual(validateNormalAliases(head, aliases, inventory), aliases);
  const changed = structuredClone(aliases);changed[0].available_original = eye;assert.throws(() => validateNormalAliases(head, changed, inventory), /normal aliases differ/);
  assert.throws(() => validateNormalAliases(head, aliases, inventory.slice(0, 1)), /outside the archive-qualified intake/);
});
test('archive qualification rejects unknown/prototype pack labels instead of skipping their member proof', async t => {
  const base = await privateFixture(t), bytes = Buffer.from('original raw bytes');
  const entries = Array.from({ length: 40 }, (_, i) => ({ pack: i === 0 ? 'toString' : 'mcof', archive_member: i === 0 ? 'sentinel.bin' : 'not-consumed-' + i,
    path: resolve(base, 'raw', i === 0 ? 'sentinel.bin' : 'not-consumed-' + i), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  await writeFile(resolve(base, 'raw-source-extraction.json'), JSON.stringify(entries));await assert.rejects(verifySources(base), /archive member\/path binding/);
  assert.equal(await readFile(resolve(base, 'raw/sentinel.bin'), 'utf8'), 'original raw bytes');assert.deepEqual(await readdir(resolve(base, 'derived')), []);
});
test('glTF top-origin UVs sample their own atlas row and preserve source-local V orientation', () => {
  for (const top of [0, 256]) for (const left of [0, 256]) for (const v of [0, .25, .75, 1]) {
    const uv = stewardAtlasUv(.4, v, left, top, 256);
    assert.ok(uv[0] * 512 >= left + 8 && uv[0] * 512 <= left + 248);assert.equal(uv[1] * 512, top + 8 + v * 240);
    assert.equal(Math.floor(uv[1] * 512 / 256), top / 256, 'atlas must not select the opposite eye/hair row');
  }
  assert.ok(stewardAtlasUv(.4, .75, 256, 0, 256)[1] < .5, 'head belongs in the top-right tile');
});
test('actual material correction changes only skin-atlas V bytes and retains all maps, geometry, bind and animation data', { skip: !output || !lodOutput || !uvOutput }, async () => {
  const paths = [[resolve(output, 'house-steward-atlas512-candidate.glb'), 'house-steward-atlas512-uv-corrected.glb'], [resolve(lodOutput, 'house-steward-lod-candidate.glb'), 'house-steward-lod-uv-corrected.glb']];
  for (const [path, name] of paths) {
    const before = await loadGltf(path), after = await loadGltf(resolve(uvOutput, name)), allowed = new Set();assert.equal(before.binary.length, after.binary.length);
    for (const mesh of before.json.meshes) for (const p of mesh.primitives) if (p.material === 1) {
      const id = p.attributes.TEXCOORD_0, a = before.json.accessors[id], view = before.json.bufferViews[a.bufferView], start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = view.byteStride ?? 8;
      for (let i = 0; i < a.count; i++) { const at = start + i * stride + 4, v = before.binary.readFloatLE(at);assert.equal(after.binary.readFloatLE(at), Math.fround(v < .5 ? v + .5 : v - .5));for (let c = 0; c < 4; c++) allowed.add(at + c); }
      const uv = accessor(after, id);for (let c = 0; c < 2; c++) { const values = Array.from(uv).filter((_, i) => i % 2 === c);assert.equal(after.json.accessors[id].min[c], Math.min(...values));assert.equal(after.json.accessors[id].max[c], Math.max(...values)); }
    }
    for (let i = 0; i < before.binary.length; i++) if (!allowed.has(i)) assert.equal(after.binary[i], before.binary[i], 'non-UV source data changed');
    for (const key of ['nodes', 'skins', 'animations', 'meshes', 'materials', 'textures', 'images', 'bufferViews']) assert.deepEqual(after.json[key], before.json[key]);
    assert.throws(() => correctedStewardUvBytes(after), /already applied/);const stats = await validateStewardGlb(after.path);assert.equal(stats.drawCalls, 2);assert.equal(stats.joints, 65);
  }
  const report = JSON.parse(await readFile(resolve(uvOutput, 'material-provenance.json')));assert.equal(report.rawSourceProof.archives.length, 3);assert.equal(report.rawSourceProof.rawMembers, 40);assert.equal(report.visualReviewPassed, false);
});

test('rest-aware retarget preserves source world motion while correcting different target bind and animated parent', () => {
  const axis = new Vector3(1, 0, 0), sourceRest = new Quaternion().setFromAxisAngle(axis, 17 * Math.PI / 180);
  const targetRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -.24), parent = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .3);
  const restLocal = retargetWorldRotation(sourceRest, sourceRest, targetRest, parent);
  assert.ok(parent.clone().multiply(restLocal).angleTo(targetRest) < 1e-7);
  for (const angle of [-.6, -.1, 0, .2, .7]) {
    const delta = new Quaternion().setFromAxisAngle(new Vector3(.3, .8, -.2).normalize(), angle), animated = delta.clone().multiply(sourceRest);
    const local = retargetWorldRotation(animated, sourceRest, targetRest, parent), actualDelta = parent.clone().multiply(local).multiply(targetRest.clone().invert());
    assert.ok(actualDelta.angleTo(delta) < 1e-7);assert.ok(Math.abs(local.length() - 1) < 1e-12);
  }
  assert.ok(sourceRest.angleTo(targetRest) > .2, 'direct clip copying would retain a material rest mismatch');
});
test('binary accessor decoding respects stride, normalization and rejects truncated or nonfinite data', () => {
  const binary = Buffer.alloc(32);[1, 2, 3].forEach((v, i) => binary.writeFloatLE(v, i * 4));[4, 5, 6].forEach((v, i) => binary.writeFloatLE(v, 16 + i * 4));
  const g = { binary, json: { accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteStride: 16, byteLength: 32 }] } };
  assert.deepEqual(Array.from(accessor(g, 0)), [1, 2, 3, 4, 5, 6]);
  assert.throws(() => accessor({ ...g, binary: binary.subarray(0, 20) }, 0), /range/);
  binary.writeFloatLE(NaN, 0);assert.throws(() => accessor(g, 0), /nonfinite/);
  const normalized = { binary: Buffer.from([0, 127, 255, 64]), json: { accessors: [{ bufferView: 0, componentType: 5121, count: 1, type: 'VEC4', normalized: true }], bufferViews: [{ buffer: 0, byteLength: 4 }] } };
  assert.deepEqual(Array.from(accessor(normalized, 0)), [0, 127 / 255, 1, 64 / 255]);
});
function triangles(g, include = () => true) {
  return g.json.meshes.flatMap(mesh => mesh.primitives.flatMap(primitive => {
    const p = accessor(g, primitive.attributes.POSITION), j = accessor(g, primitive.attributes.JOINTS_0), w = accessor(g, primitive.attributes.WEIGHTS_0), ids = accessor(g, primitive.indices), result = [];
    for (let i = 0; i < ids.length; i += 3) if (include(mesh.name, Array.from(ids.slice(i, i + 3)), j, w)) result.push(Array.from(ids.slice(i, i + 3), id => [...p.slice(id * 3, id * 3 + 3), ...j.slice(id * 4, id * 4 + 4), ...w.slice(id * 4, id * 4 + 4)].join(',')).join('|'));
    return result;
  })).sort();
}
test('actual private binaries retain full weighted topology while atlas meets draw/map dimensions and reports Quest triangle failure', { skip: !output }, async () => {
  const sourcePath = resolve(output, 'house-steward-source-detail.glb'), atlasPath = resolve(output, 'house-steward-atlas512-candidate.glb');
  const sourceStats = await validateStewardGlb(sourcePath), atlasStats = await validateStewardGlb(atlasPath);
  assert.equal(sourceStats.triangles, 18827);assert.equal(atlasStats.triangles, sourceStats.triangles);assert.equal(atlasStats.drawCalls, 2);assert.equal(atlasStats.materials, 2);
  assert.equal(atlasStats.questTriangleBudgetPassed, false);assert.equal(atlasStats.questDrawBudgetPassed, true);assert.equal(atlasStats.textureDimensionBudgetPassed, true);assert.equal(atlasStats.visualReviewPassed, false);
  const source = await loadGltf(sourcePath), atlas = await loadGltf(atlasPath);assert.deepEqual(triangles(source), triangles(atlas));
  assert.notEqual(source.json.nodes, atlas.json.nodes);assert.notEqual(source.json.skins[0].joints, atlas.json.skins[0].joints);
  assert.deepEqual(source.json.skins[0].joints.map(id => source.json.nodes[id].name), atlas.json.skins[0].joints.map(id => atlas.json.nodes[id].name));
  assert.equal(source.json.samplers[0].wrapS, 10497);assert.equal(atlas.json.samplers[0].wrapS, 33071);
});
test('actual source provenance retains CC0 pins, real normal aliases and corrected rest pose without asserting visual acceptance', { skip: !output }, async () => {
  const report = JSON.parse(await readFile(resolve(output, 'provenance.json'), 'utf8'));
  assert.equal(report.roleId, 'house-steward');assert.equal(report.archives.length, 3);assert.equal(report.rawFilesByteIdenticalToFrozenArchiveMembers, 40);
  for (const archive of report.archives) { const license = await readFile(resolve(output, archive.pack + '-License.txt'), 'utf8');assert.match(license, /CC0 1\.0 Universal/); }
  const neck = report.rig.restDifferences.find(joint => joint.joint === 'neck_01');assert.ok(neck.localRestRotationDegrees > 17 && neck.localRestRotationDegrees < 18);
  assert.ok(report.rig.maximumWorldDeltaErrorRadians < 2e-6);assert.ok(report.rig.discardedUnitScaleDeviation < 1e-4);
  const aliases = report.atlas.sources.filter(source => source.kind === 'normal' && source.alias);assert.equal(aliases.length, 2);
  assert.ok(aliases.every(source => source.path.endsWith('_Normal.png') && source.sha256.length === 64));
  assert.ok(report.atlas.families.some(family => family.repeatU > 1 || family.repeatV > 1), 'real eye repeat wrapping was baked, not clamped');
  assert.equal(report.atlas.visualReviewPassed, false);assert.ok(report.limits.some(limit => limit.includes('3000-triangle')));
});
test('the entire head bypasses simplification and geometric component counting detects lost islands', () => {
  const head = { label: 'UBC head and collar-covered neck', indices: [0, 1, 2], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], weights: [1, 0, 0, 0] };
  assert.equal(simplifyStewardPart(head).part, head);assert.equal(simplifyStewardPart(head).report.protectedWholePart, true);
  assert.equal(countGeometricComponents(head), 1);
  const islands = { positions: [...head.positions, 2, 0, 0, 3, 0, 0, 2, 1, 0], indices: [0, 1, 2, 3, 4, 5] };assert.equal(countGeometricComponents(islands), 2);
});
test('actual LOD preserves every head/hand triangle, inverse binds, clip values and map bytes', { skip: !output || !lodOutput }, async () => {
  const atlas = await loadGltf(resolve(output, 'house-steward-atlas512-candidate.glb')), detail = await loadGltf(resolve(output, 'house-steward-source-detail.glb'));
  const lod = await loadGltf(resolve(lodOutput, 'house-steward-lod-candidate.glb')), stats = await validateStewardGlb(lod.path), report = JSON.parse(await readFile(resolve(lodOutput, 'lod-provenance.json'), 'utf8'));
  assert.ok(stats.triangles < 18827 * .55);assert.ok(stats.triangles >= report.protectedHeadAndHandsTriangleFloor);assert.equal(stats.questTriangleBudgetPassed, false);assert.equal(stats.drawCalls, 2);assert.equal(stats.textureDimensionBudgetPassed, true);
  assert.deepEqual(lod.json.nodes, atlas.json.nodes);assert.deepEqual(accessor(lod, lod.json.skins[0].inverseBindMatrices), accessor(atlas, atlas.json.skins[0].inverseBindMatrices));
  assert.deepEqual(lod.json.animations[0].channels, atlas.json.animations[0].channels);
  atlas.json.animations[0].samplers.forEach((sampler, i) => { const other = lod.json.animations[0].samplers[i];assert.deepEqual(accessor(atlas, sampler.input), accessor(lod, other.input));assert.deepEqual(accessor(atlas, sampler.output), accessor(lod, other.output)); });
  function imageHash(g, image) { const v = g.json.bufferViews[image.bufferView];return createHash('sha256').update(g.binary.subarray(v.byteOffset, v.byteOffset + v.byteLength)).digest('hex'); }
  assert.deepEqual(lod.json.images.map(image => imageHash(lod, image)), atlas.json.images.map(image => imageHash(atlas, image)));
  const names = detail.json.skins[0].joints.map(id => detail.json.nodes[id].name), locked = triangles(detail, (name, ids, joints, weights) => name === 'UBC head and collar-covered neck'
    || name === 'Peasant Male_Peasant_Arms 1' && ids.every(id => { let sum = 0;for (let c = 0; c < 4; c++) if (/^hand_[lr]$|^(index|middle|pinky|ring|thumb)_\d+_/.test(names[joints[id * 4 + c]])) sum += weights[id * 4 + c];return sum > .01; }));
  const reduced = new Set(triangles(lod));assert.equal(locked.length, report.protectedHeadAndHandsTriangleFloor);assert.ok(locked.every(triangle => reduced.has(triangle)), 'protected weighted triangle lost');
  assert.ok(report.deformationError.maximumSampledSurfaceDistanceMetres < .025);assert.ok(report.deformationError.samples.every(sample => sample.maximumAabbCoordinateErrorMetres < .01));
  assert.equal(report.offDefault, true);assert.equal(report.visualReviewPassed, false);
});
test('actual LOD retains source vertex attributes and every geometric component of all nine source parts', { skip: !output || !lodOutput }, async () => {
  const source = await loadGltf(resolve(output, 'house-steward-source-detail.glb')), atlas = await loadGltf(resolve(output, 'house-steward-atlas512-candidate.glb')), lod = await loadGltf(resolve(lodOutput, 'house-steward-lod-candidate.glb'));
  function part(g, mesh) { const p = mesh.primitives[0];return { positions: accessor(g, p.attributes.POSITION), normals: accessor(g, p.attributes.NORMAL), uv: accessor(g, p.attributes.TEXCOORD_0), colors: accessor(g, p.attributes.COLOR_0), joints: accessor(g, p.attributes.JOINTS_0), weights: accessor(g, p.attributes.WEIGHTS_0), indices: accessor(g, p.indices) }; }
  function key(p, i, uv = false) { return [...p.positions.slice(i * 3, i * 3 + 3), ...p.normals.slice(i * 3, i * 3 + 3), ...p.joints.slice(i * 4, i * 4 + 4), ...p.weights.slice(i * 4, i * 4 + 4), ...(uv ? [...p.uv.slice(i * 2, i * 2 + 2), ...p.colors.slice(i * 4, i * 4 + 4)] : [])].join(','); }
  const original = source.json.meshes.map(mesh => part(source, mesh)), owners = new Map(), atlasKeys = new Set();
  original.forEach((p, owner) => { for (let i = 0; i < p.positions.length / 3; i++) { const k = key(p, i), set = owners.get(k) ?? new Set();set.add(owner);owners.set(k, set); } });
  for (const mesh of atlas.json.meshes) { const p = part(atlas, mesh);for (let i = 0; i < p.positions.length / 3; i++) atlasKeys.add(key(p, i, true)); }
  const reduced = original.map(() => ({ positions: [], indices: [] }));
  for (const mesh of lod.json.meshes) { const p = part(lod, mesh);for (let i = 0; i < p.positions.length / 3; i++) assert.ok(atlasKeys.has(key(p, i, true)), 'LOD introduced or modified a retained skin/UV/normal/color vertex');
    for (let i = 0; i < p.indices.length; i += 3) { const ids = Array.from(p.indices.slice(i, i + 3)), candidates = ids.map(id => owners.get(key(p, id)));assert.ok(candidates.every(Boolean));
      const common = [...candidates[0]].filter(owner => candidates.every(set => set.has(owner)));assert.equal(common.length, 1, 'LOD triangle crosses independent source parts');
      const out = reduced[common[0]];for (const id of ids) { out.indices.push(out.positions.length / 3);out.positions.push(...p.positions.slice(id * 3, id * 3 + 3)); }
    }
  }
  for (let i = 0; i < original.length; i++) { const full = { positions: Array.from(original[i].positions), indices: Array.from(original[i].indices) };assert.equal(countGeometricComponents(reduced[i]), countGeometricComponents(full), source.json.meshes[i].name + ' lost a component'); }
});
