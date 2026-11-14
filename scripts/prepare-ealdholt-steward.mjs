// PRIVATE offline prototype only. No app imports, manifest edits or source writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, realpath, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

const coreRoot = new URL('../main-game-vr/node_modules/@iwsdk/core/', import.meta.url);
const corePackage = JSON.parse(await readFile(new URL('package.json', coreRoot), 'utf8'));
const { Matrix4, Matrix3, Quaternion, Vector3, Box3, BufferGeometry, Float32BufferAttribute } = await import(new URL(corePackage.exports['.'].import, coreRoot).href);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function absent(path) { try { await lstat(path);return false; } catch (error) { if (error.code === 'ENOENT') return true;throw error; } }
async function noSymlinkComponents(path) {
  const absolute = resolve(path);let current = sep;
  for (const segment of absolute.split(sep).filter(Boolean)) { current = resolve(current, segment);assert.ok(!(await lstat(current)).isSymbolicLink(), 'symlink path refused: ' + current); }
  return absolute;
}
export async function preflightPrivateOutput(base, outputDirectory, targets) {
  base = await noSymlinkComponents(base);assert.equal(await realpath(base), base);
  const derived = resolve(base, 'derived'), output = resolve(outputDirectory);
  assert.ok(dirname(output) === derived && !output.startsWith(repository + sep), 'output must be a fresh direct child of private derived/');
  assert.ok(targets.length && new Set(targets).size === targets.length && targets.every(name => basename(name) === name && name !== '.' && name !== '..'), 'invalid output targets');
  const derivedMissing = await absent(derived);if (!derivedMissing) { await noSymlinkComponents(derived);assert.ok((await lstat(derived)).isDirectory()); }
  assert.ok(await absent(output), 'fresh output directory required; existing file/directory/symlink refused');
  for (const name of targets) assert.ok(await absent(resolve(output, name)), 'existing output target refused: ' + name);
  return { path: output, async create() {
    // Recheck the whole plan before the first side effect. Never reuse a
    // directory or delete a partial attempt, including after later failure.
    await preflightPrivateOutput(base, output, targets);
    if (derivedMissing) await mkdir(derived, { mode: 0o700 });
    const parent = await open(derived, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let directory;
    try {
      await mkdir('/proc/self/fd/' + parent.fd + '/' + basename(output), { mode: 0o700 });
      directory = await open('/proc/self/fd/' + parent.fd + '/' + basename(output), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } finally { await parent.close(); }
    const completed = new Map();return { path: output, async write(name, bytes) {
      assert.ok(targets.includes(name) && !completed.has(name), 'unplanned or duplicate output');
      const anchor = '/proc/self/fd/' + directory.fd + '/';
      for (const target of targets) {
        if (!completed.has(target)) assert.ok(await absent(anchor + target), 'existing/symlink output target refused: ' + target);
        else { const stat = await lstat(anchor + target), owned = completed.get(target);assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.dev === owned.dev && stat.ino === owned.ino, 'completed output was replaced or aliased'); }
      }
      const handle = await open(anchor + name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes);completed.set(name, await handle.stat()); } finally { await handle.close(); }
    }, async close() { await directory.close(); } };
  } };
}
export function createQualifiedReader(base, inventory) {
  for (const entry of inventory) assert.ok(resolve(entry.path) === resolve(base, 'raw', entry.archive_member) && resolve(entry.path).startsWith(resolve(base, 'raw') + sep), 'qualified path/member mismatch');
  const entries = new Map(inventory.map(entry => [resolve(entry.path), entry])), cache = new Map(), consumed = new Map();
  const read = async path => {
    path = resolve(path);const entry = entries.get(path);assert.ok(entry, 'consumed path is outside the archive-qualified intake: ' + path);
    await noSymlinkComponents(path);assert.equal(await realpath(path), path, 'source alias refused');const stat = await lstat(path);assert.ok(stat.isFile() && stat.nlink === 1, 'source must be an unaliased regular file');
    if (!cache.has(path)) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);let bytes;try { bytes = await handle.readFile(); } finally { await handle.close(); }
      assert.equal(bytes.length, entry.bytes, 'consumed source byte length changed');assert.equal(digest(bytes), entry.sha256, 'consumed source byte hash changed');cache.set(path, bytes);
    }
    consumed.set(path, { path, pack: entry.pack, archiveMember: entry.archive_member, bytes: entry.bytes, sha256: entry.sha256 });return Buffer.from(cache.get(path));
  };
  read.consumed = consumed;return read;
}
const frozen = {
  mcof: { bytes: 294347394, sha256: 'c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70', license: '2202cc2f608c4210790b112e5f121bc2e7f8dced7b5b1c7f4be6203461bdebbb' },
  ubc: { bytes: 128968391, sha256: 'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40', license: '0f4beaf0fe360a7732e58bbe3dbf60a2422367fbea60cb9ea4add968f383268e' },
  ual1: { bytes: 15904933, sha256: 'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724', license: '6d01f55c6e4c49a2c9963e147e561945ae2c83958c8ca667d90a6bffdbfac061' },
};
export async function verifySources(base) {
  base = await noSymlinkComponents(base);assert.equal(await realpath(base), base);
  const inventory = JSON.parse(await readFile(resolve(base, 'raw-source-extraction.json'), 'utf8'));
  assert.equal(inventory.length, 40, 'expected complete qualified intake');assert.equal(new Set(inventory.map(entry => entry.path)).size, 40, 'aliased inventory entries');
  for (const entry of inventory) {
    assert.ok(Object.hasOwn(frozen, entry.pack) && entry.path === resolve(base, 'raw', entry.archive_member) && entry.path.startsWith(resolve(base, 'raw') + sep), 'archive member/path binding');
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^[0-9a-f]{64}$/.test(entry.sha256), 'invalid archive entry proof');await noSymlinkComponents(entry.path);
  }
  const archives = [];
  for (const [pack, expected] of Object.entries(frozen)) {
    const path = resolve(base, pack + '-Standard.zip');await noSymlinkComponents(path);const bytes = await readFile(path);
    assert.equal(bytes.length, expected.bytes, pack + ' archive size');assert.equal(digest(bytes), expected.sha256, pack + ' frozen archive hash');
    const licenseEntry = inventory.find(entry => entry.pack === pack && /License(?:_Standard)?\.txt$/.test(entry.archive_member));
    assert.ok(licenseEntry, pack + ' internal license');
    const license = await readFile(licenseEntry.path);
    assert.equal(digest(license), expected.license, pack + ' frozen internal license');
    assert.match(license.toString(), /CC0 1\.0 Universal \(CC0 1\.0\)/);assert.match(license.toString(), /creativecommons\.org\/publicdomain\/zero\/1\.0/);
    archives.push({ pack, path, bytes: bytes.length, sha256: expected.sha256, license: licenseEntry.path, licenseSha256: expected.license });
  }
  for (const entry of inventory) {
    const path = await realpath(entry.path);assert.ok(path.startsWith(resolve(base, 'raw') + sep), 'raw proof path must remain inside intake');
    const bytes = await readFile(path);assert.equal(bytes.length, entry.bytes);assert.equal(digest(bytes), entry.sha256, 'raw source changed: ' + entry.archive_member);
  }
  const verification = spawnSync('python', ['-c', `import json,sys,zipfile,hashlib,pathlib
b=pathlib.Path(sys.argv[1]); entries=json.loads((b/'raw-source-extraction.json').read_text()); verified=0
for pack in ('mcof','ubc','ual1'):
 with zipfile.ZipFile(b/(pack+'-Standard.zip')) as z:
  for e in entries:
   if e['pack']==pack:
    data=z.read(e['archive_member']); assert hashlib.sha256(data).hexdigest()==e['sha256']; assert data==pathlib.Path(e['path']).read_bytes(); verified+=1
print(verified)`, base], { encoding: 'utf8' });
  assert.equal(verification.status, 0, verification.stderr || 'archive-member proof failed');
  assert.equal(Number(verification.stdout.trim()), inventory.length, 'every intake entry must match a frozen archive member');
  return { base, archives, rawFilesByteIdenticalToFrozenArchiveMembers: Number(verification.stdout.trim()), inventory, readQualified: createQualifiedReader(base, inventory) };
}
export async function loadGltf(path, readQualified) {
  const read = readQualified ?? readFile, bytes = await read(path);let json, binary;
  if (path.endsWith('.glb')) {
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);assert.equal(bytes.readUInt32LE(4), 2);assert.equal(bytes.readUInt32LE(8), bytes.length);
    const length = bytes.readUInt32LE(12), at = 20 + length;
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);assert.equal(bytes.readUInt32LE(at + 4), 0x004e4942);
    json = JSON.parse(bytes.subarray(20, at));binary = bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at));
  } else { json = JSON.parse(bytes);assert.equal(json.buffers.length, 1);binary = await read(resolve(dirname(path), decodeURIComponent(json.buffers[0].uri))); }
  assert.equal(json.asset.version, '2.0');assert.equal(json.buffers.length, 1);assert.ok(binary.length >= json.buffers[0].byteLength);
  return { path, json, binary, sha256: digest(bytes), readQualified };
}
export function validateNormalAliases(headPath, aliases, inventory) {
  const expected = [{ referenced_by: headPath, incorrect_uri: 'T_Hair_1_Normal_png.png', available_original: resolve(dirname(headPath), 'T_Hair_1_Normal.png') },
    { referenced_by: headPath, incorrect_uri: 'T_Eye_Normal_png.png', available_original: resolve(dirname(headPath), 'T_Eye_Normal.png') }];
  assert.deepEqual(aliases, expected, 'normal aliases differ from the two qualified vendor URI corrections');
  for (const alias of expected) assert.ok(inventory.some(entry => entry.path === alias.available_original), 'normal alias is outside the archive-qualified intake');return expected;
}
async function bindStewardIntake(proof, intake) {
  function member(pack, suffix) { const found = proof.inventory.filter(entry => entry.pack === pack && entry.archive_member.endsWith(suffix));assert.equal(found.length, 1, 'qualified source member missing/ambiguous');return found[0].path; }
  const selected = { body: member('mcof', '/Outfits/Male_Peasant.gltf'), head: member('ubc', '/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf'),
    hair: member('ubc', '/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf'), animation: member('ual1', '/Unreal-Godot/UAL1_Standard.glb') };
  assert.equal(intake.body, selected.body, 'intake body is not the qualified member');assert.equal(intake.head_source, selected.head, 'intake head is not the qualified member');assert.equal(intake.animation_glb, selected.animation, 'intake animation is not the qualified member');
  const hairPaths = intake.hair_candidates.filter(path => path.endsWith('/Hair_SimpleParted.gltf'));assert.deepEqual(hairPaths, [selected.hair], 'intake hair is not the qualified member');
  const aliases = validateNormalAliases(selected.head, intake.normal_uri_aliases, proof.inventory), models = {};
  // Snapshot every consumed model, BIN, image and license from the verified ZIP
  // members before model processing or any output-side effect.
  for (const [role, path] of Object.entries(selected)) models[role] = await loadQualifiedGltf(path, proof.readQualified, aliases);
  const licenses = [];for (const archive of proof.archives) licenses.push({ name: archive.pack + '-License.txt', bytes: await proof.readQualified(archive.license) });
  return { ...models, aliases, licenses };
}
export async function loadQualifiedGltf(path, readQualified, aliases = []) {
  assert.equal(typeof readQualified, 'function', 'qualified source reader required');const g = await loadGltf(path, readQualified);
  for (const image of g.json.images ?? []) {
    assert.ok(image.uri && !image.uri.startsWith('data:'), 'qualified external image required');const uri = decodeURIComponent(image.uri), alias = aliases.find(a => a.referenced_by === path && a.incorrect_uri === uri);
    await readQualified(alias?.available_original ?? resolve(dirname(path), uri));
  }
  return g;
}
export async function preflightStewardSources(base) {
  const proof = await verifySources(base), intake = JSON.parse(await readFile(resolve(base, 'steward-source-intake.json'), 'utf8'));
  return { proof, ...(await bindStewardIntake(proof, intake)) };
}
export function accessor(g, id) {
  const a = g.json.accessors[id], v = g.json.bufferViews[a?.bufferView], width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a?.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a?.componentType];
  assert.ok(a && v && width && size && !a.sparse && v.buffer === 0, 'dense embedded accessor required');
  const out = new Float64Array(a.count * width), start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? width * size;
  const readers = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
  assert.ok(start >= 0 && start + (a.count - 1) * stride + width * size <= g.binary.length, 'accessor range');
  for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) {
    let value = g.binary[readers[a.componentType]](start + i * stride + c * size);
    if (a.normalized) value = a.componentType === 5120 ? Math.max(-1, value / 127) : a.componentType === 5121 ? value / 255 : a.componentType === 5122 ? Math.max(-1, value / 32767) : a.componentType === 5123 ? value / 65535 : value;
    assert.ok(Number.isFinite(value), 'nonfinite accessor');out[i * width + c] = value;
  }
  return out;
}
function local(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])).normalize(), new Vector3(...(node.scale ?? [1, 1, 1])));
}
function worlds(json, overrides = new Map()) {
  const result = new Map(), seen = new Set();
  function walk(id, parent) {
    assert.ok(!seen.has(id), 'bone/node alias or cycle');seen.add(id);
    const matrix = parent.clone().multiply(overrides.get(id) ?? local(json.nodes[id]));result.set(id, matrix);
    for (const child of json.nodes[id].children ?? []) walk(child, matrix);
  }
  for (const id of json.scenes[json.scene ?? 0].nodes) walk(id, new Matrix4());
  return result;
}
export function inspectRig(g) {
  assert.equal(g.json.skins.length, 1);const skin = g.json.skins[0], frames = worlds(g.json);
  const names = skin.joints.map(id => g.json.nodes[id].name);assert.equal(new Set(names).size, names.length, 'unique joint names');assert.equal(names.length, 65);
  const inverse = accessor(g, skin.inverseBindMatrices), bind = skin.joints.map((id, i) => new Matrix4().fromArray(inverse, i * 16));
  let bindError = 0;
  for (let i = 0; i < names.length; i++) {
    const identity = frames.get(skin.joints[i]).clone().multiply(bind[i]);
    identity.elements.forEach((value, k) => { bindError = Math.max(bindError, Math.abs(value - (k % 5 === 0 ? 1 : 0))); });
  }
  assert.ok(bindError < 2e-5, 'source inverse bind disagrees with rest hierarchy');
  return { skin, names, frames, bind, bindError, byName: new Map(names.map((name, i) => [name, i])) };
}
export function extractPart(g, rig, targetRig, meshId, primitiveId, label, filter) {
  const primitive = g.json.meshes[meshId].primitives[primitiveId];assert.ok(!primitive.targets?.length, 'morphs require explicit transfer');
  const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([name, id]) => [name, accessor(g, id)]));
  const nodeId = g.json.nodes.findIndex(node => node.mesh === meshId);assert.ok(nodeId >= 0);
  const nodeFrame = rig.frames.get(nodeId);assert.ok(nodeFrame.elements.every((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)) < 1e-6), 'mesh bind frame requires explicit qualification');
  const mapping = rig.names.map(name => { const index = targetRig.byName.get(name);assert.notEqual(index, undefined);return index; });
  const deformation = rig.bind.map((inverse, i) => targetRig.frames.get(targetRig.skin.joints[mapping[i]]).clone().multiply(inverse));
  const normals = deformation.map(matrix => new Matrix3().getNormalMatrix(matrix)), sourceIndices = accessor(g, primitive.indices), kept = [];
  for (let i = 0; i < sourceIndices.length; i += 3) {
    const triangle = Array.from(sourceIndices.slice(i, i + 3));if (!filter || filter(triangle, attributes, rig.names)) kept.push(...triangle);
  }
  assert.ok(kept.length > 0, 'empty selected part');
  const used = [...new Set(kept)], remap = new Map(used.map((id, i) => [id, i]));
  const part = { label, source: g, material: primitive.material, indices: kept.map(id => remap.get(id)), positions: [], normals: [], uv: [], colors: [], joints: [], weights: [] };
  for (const id of used) {
    const p = new Vector3().fromArray(attributes.POSITION, id * 3), n = new Vector3().fromArray(attributes.NORMAL, id * 3), out = new Vector3(), normal = new Vector3();
    let total = 0;for (let c = 0; c < 4; c++) total += attributes.WEIGHTS_0[id * 4 + c];assert.ok(Math.abs(total - 1) < 2e-5, 'skin weight normalization');
    for (let c = 0; c < 4; c++) {
      const sourceJoint = attributes.JOINTS_0[id * 4 + c], weight = attributes.WEIGHTS_0[id * 4 + c] / total;
      assert.ok(Number.isSafeInteger(sourceJoint) && sourceJoint >= 0 && sourceJoint < mapping.length && weight >= 0);
      out.addScaledVector(p.clone().applyMatrix4(deformation[sourceJoint]), weight);normal.addScaledVector(n.clone().applyMatrix3(normals[sourceJoint]), weight);
      part.joints.push(mapping[sourceJoint]);part.weights.push(weight);
    }
    normal.normalize();part.positions.push(...out.toArray());part.normals.push(...normal.toArray());part.uv.push(...attributes.TEXCOORD_0.slice(id * 2, id * 2 + 2));
    const color = attributes.COLOR_0, width = color ? g.json.accessors[primitive.attributes.COLOR_0].type === 'VEC4' ? 4 : 3 : 0;
    part.colors.push(...(color ? [...color.slice(id * width, id * width + 3), width === 4 ? color[id * width + 3] : 1] : [1, 1, 1, 1]));
  }
  assert.ok([...part.positions, ...part.normals, ...part.uv, ...part.weights].every(Number.isFinite));
  return part;
}
export function retargetWorldRotation(sourceAnimatedWorld, sourceRestWorld, targetRestWorld, targetParentAnimatedWorld) {
  return targetParentAnimatedWorld.clone().invert().multiply(sourceAnimatedWorld).multiply(sourceRestWorld.clone().invert()).multiply(targetRestWorld).normalize();
}
function skinnedBounds(parts, matrices, normalization = new Matrix4()) {
  const bounds = new Box3();
  for (const part of parts) for (let i = 0; i < part.positions.length / 3; i++) {
    const p = new Vector3().fromArray(part.positions, i * 3), skinned = new Vector3();
    for (let c = 0; c < 4; c++) skinned.addScaledVector(p.clone().applyMatrix4(matrices[part.joints[i * 4 + c]]), part.weights[i * 4 + c]);
    skinned.applyMatrix4(normalization);assert.ok(skinned.toArray().every(Number.isFinite), 'nonfinite posed vertex');bounds.expandByPoint(skinned);
  }
  return bounds;
}
function rotation(matrix) { const q = new Quaternion();matrix.decompose(new Vector3(), q, new Vector3());return q.normalize(); }
function sampleTrack(track, time) {
  const { times, values, path, interpolation } = track, width = path === 'rotation' ? 4 : 3;
  let i = 0;while (i < times.length - 2 && times[i + 1] <= time) i++;
  const next = Math.min(i + 1, times.length - 1), t = interpolation === 'STEP' || times[next] === times[i] ? 0 : Math.max(0, Math.min(1, (time - times[i]) / (times[next] - times[i])));
  if (path === 'rotation') return new Quaternion().fromArray(values, i * 4).normalize().slerp(new Quaternion().fromArray(values, next * 4).normalize(), t).normalize().toArray();
  return Array.from({ length: width }, (_, c) => values[i * width + c] * (1 - t) + values[next * width + c] * t);
}
export function bakeTalking(source, sourceRig, target, targetRig, parts) {
  const clip = source.json.animations.find(animation => animation.name === 'Idle_Talking_Loop');assert.ok(clip, 'free talking clip required');
  const tracks = clip.channels.map(channel => {
    const sampler = clip.samplers[channel.sampler];assert.ok(['LINEAR', 'STEP'].includes(sampler.interpolation ?? 'LINEAR'), 'unsupported animation interpolation');
    const name = source.json.nodes[channel.target.node].name;assert.ok(targetRig.byName.has(name), 'unmapped animation joint');
    return { name, node: channel.target.node, path: channel.target.path, interpolation: sampler.interpolation ?? 'LINEAR', times: accessor(source, sampler.input), values: accessor(source, sampler.output) };
  });
  const times = [...new Set(tracks.flatMap(track => Array.from(track.times)))].sort((a, b) => a - b);assert.ok(times.length > 2 && times.at(-1) > 2 && times.at(-1) < 4);
  const scales = tracks.filter(track => track.path === 'scale');let maxDiscardedScaleDeviation = 0;
  for (const track of scales) for (const value of track.values) maxDiscardedScaleDeviation = Math.max(maxDiscardedScaleDeviation, Math.abs(value - 1));
  assert.ok(maxDiscardedScaleDeviation < 1e-4, 'animated scale is substantive; refusing to discard');
  const sourceParents = new Map(), targetParents = new Map();
  source.json.nodes.forEach((node, i) => (node.children ?? []).forEach(child => sourceParents.set(child, i)));
  target.json.nodes.forEach((node, i) => (node.children ?? []).forEach(child => targetParents.set(child, i)));
  const bindInverse = targetRig.skin.joints.map(id => targetRig.frames.get(id).clone().invert());
  const bindBounds = skinnedBounds(parts, bindInverse.map((inverse, i) => targetRig.frames.get(targetRig.skin.joints[i]).clone().multiply(inverse)));
  const height = bindBounds.max.y - bindBounds.min.y, scale = 1.8 / height;assert.ok(height > 1.6 && height < 2.1, 'source character units must be metres');
  const rootOffsets = [], translations = targetRig.names.map(() => []), rotations = targetRig.names.map(() => []), matricesByFrame = [];
  let rotationDeltaError = 0, minGrounding = Infinity, maxGrounding = -Infinity;
  for (const time of times) {
    const values = new Map();for (const track of tracks) { if (track.path === 'scale') continue;const v = values.get(track.node) ?? { ...source.json.nodes[track.node] };v[track.path] = sampleTrack(track, time);values.set(track.node, v); }
    const sourceFrames = worlds(source.json, new Map([...values].map(([id, node]) => [id, local(node)]))), targetFrames = new Map(), targetWorldRotations = new Map();
    for (let i = 0; i < targetRig.names.length; i++) {
      const name = targetRig.names[i], targetId = targetRig.skin.joints[i], sourceId = sourceRig.skin.joints[sourceRig.byName.get(name)];
      const targetParent = targetParents.get(targetId), sourceParent = sourceParents.get(sourceId), parentQ = targetWorldRotations.get(targetParent) ?? new Quaternion();
      const q = retargetWorldRotation(rotation(sourceFrames.get(sourceId)), rotation(sourceRig.frames.get(sourceId)), rotation(targetRig.frames.get(targetId)), parentQ);
      const previous = rotations[i].slice(-4);if (previous.length && q.dot(new Quaternion().fromArray(previous)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const sourceNode = source.json.nodes[sourceId], targetNode = target.json.nodes[targetId], sampled = values.get(sourceId) ?? sourceNode;
      const delta = new Vector3(...(sampled.translation ?? [0, 0, 0])).sub(new Vector3(...(sourceNode.translation ?? [0, 0, 0])));
      if (sourceParent !== undefined) delta.applyQuaternion(rotation(sourceRig.frames.get(sourceParent)));
      if (targetParent !== undefined) delta.applyQuaternion(rotation(targetRig.frames.get(targetParent)).invert());
      const t = new Vector3(...(targetNode.translation ?? [0, 0, 0])).add(delta), matrix = new Matrix4().compose(t, q, new Vector3(...(targetNode.scale ?? [1, 1, 1])));
      const frame = (targetFrames.get(targetParent) ?? new Matrix4()).clone().multiply(matrix);targetFrames.set(targetId, frame);targetWorldRotations.set(targetId, rotation(frame));
      const expectedDelta = rotation(sourceFrames.get(sourceId)).multiply(rotation(sourceRig.frames.get(sourceId)).invert());
      const actualDelta = rotation(frame).multiply(rotation(targetRig.frames.get(targetId)).invert());rotationDeltaError = Math.max(rotationDeltaError, expectedDelta.angleTo(actualDelta));
      rotations[i].push(...q.toArray());translations[i].push(...t.toArray());
    }
    const skinMatrices = targetRig.skin.joints.map((id, i) => targetFrames.get(id).clone().multiply(bindInverse[i]));matricesByFrame.push(skinMatrices);
    const poseBounds = skinnedBounds(parts, skinMatrices), offset = -poseBounds.min.y * scale;
    minGrounding = Math.min(minGrounding, offset);maxGrounding = Math.max(maxGrounding, offset);rootOffsets.push(0, offset, 0);
  }
  assert.ok(rotationDeltaError < 2e-6, 'world rotation delta transfer mismatch');
  const samples = [0, Math.floor(times.length / 2), times.length - 1].map(index => {
    const normalizer = new Matrix4().compose(new Vector3().fromArray(rootOffsets, index * 3), new Quaternion(), new Vector3(scale, scale, scale));
    const bounds = skinnedBounds(parts, matricesByFrame[index], normalizer);
    return { time: times[index], min: bounds.min.toArray(), max: bounds.max.toArray(), finite: true, feetY: bounds.min.y };
  });
  return { times, rotations, translations, rootOffsets, scale, bindInverse, bindBounds, samples, duration: times.at(-1), rotationDeltaError, maxDiscardedScaleDeviation,
    rootGroundingOffsetRangeMetres: [minGrounding, maxGrounding], retarget: 'source animated-world * inverse(source rest-world) * target rest-world; derive target locals against animated target parent; preserve translated deltas in parent rest basis; discard only verified unit scales' };
}
async function sourceImage(g, textureId, aliases) {
  const texture = g.json.textures[textureId], image = g.json.images[texture.source];assert.ok(image.uri && !image.uri.startsWith('data:'), 'qualified external source image required');
  const uri = decodeURIComponent(image.uri), alias = aliases.find(item => item.referenced_by === g.path && item.incorrect_uri === uri);
  assert.equal(typeof g.readQualified, 'function', 'raw images require an archive-qualified reader');
  const path = alias?.available_original ?? resolve(dirname(g.path), uri), bytes = await g.readQualified(path), metadata = await sharp(bytes).metadata();
  assert.ok(metadata.width > 0 && metadata.height > 0);return { path, bytes, width: metadata.width, height: metadata.height, sha256: digest(bytes), alias: alias ? { incorrectUri: uri, actualFile: path } : null };
}
async function atlasTile(g, materialId, kind, aliases, size, repeatU = 1, repeatV = 1) {
  const material = g.json.materials[materialId], pbr = material.pbrMetallicRoughness ?? {}, texture = kind === 'normal' ? material.normalTexture : kind === 'base' ? pbr.baseColorTexture : pbr.metallicRoughnessTexture;
  assert.equal(texture?.texCoord ?? 0, 0);assert.ok(!texture?.extensions?.KHR_texture_transform, 'texture transforms need explicit atlas adaptation');
  let bytes, source = null;
  if (!texture) {
    assert.equal(kind, 'orm', 'base/normal source maps must be real');
    bytes = await sharp({ create: { width: size, height: size, channels: 3, background: { r: 255, g: Math.round((pbr.roughnessFactor ?? 1) * 255), b: Math.round((pbr.metallicFactor ?? 1) * 255) } } }).png().toBuffer();
  } else {
    source = await sourceImage(g, texture.index, aliases);
    const sampler = g.json.samplers?.[g.json.textures[texture.index].sampler] ?? {};
    if (repeatU > 1 || repeatV > 1) assert.ok((sampler.wrapS ?? 10497) === 10497 && (sampler.wrapT ?? 10497) === 10497, 'only authored repeat wrapping can be baked');
    const tiled = repeatU > 1 || repeatV > 1 ? await sharp({ create: { width: source.width * repeatU, height: source.height * repeatV, channels: 3, background: '#000' } }).composite([{ input: source.bytes, tile: true }]).png().toBuffer() : source.bytes;
    const raw = await sharp(tiled).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });assert.equal(raw.info.channels, 3);
    for (let i = 0; i < raw.data.length; i += 3) {
      if (kind === 'normal') { const x = raw.data[i] / 127.5 - 1, y = raw.data[i + 1] / 127.5 - 1, z = raw.data[i + 2] / 127.5 - 1, length = Math.hypot(x, y, z) || 1;raw.data[i] = Math.round((x / length + 1) * 127.5);raw.data[i + 1] = Math.round((y / length + 1) * 127.5);raw.data[i + 2] = Math.round((z / length + 1) * 127.5); }
      if (kind === 'orm') { raw.data[i + 1] = Math.round(raw.data[i + 1] * (pbr.roughnessFactor ?? 1));raw.data[i + 2] = Math.round(raw.data[i + 2] * (pbr.metallicFactor ?? 1)); }
    }
    bytes = await sharp(raw.data, { raw: raw.info }).png().toBuffer();
  }
  bytes = await sharp(bytes).extend({ top: 8, bottom: 8, left: 8, right: 8, extendWith: 'copy' }).png().toBuffer();
  return { bytes, source: source ? { path: source.path, sha256: source.sha256, width: source.width, height: source.height, alias: source.alias } : null };
}
export function stewardAtlasUv(u, v, left, top, size) {
  assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1);
  // glTF textures use flipY=false: v=0 addresses the image's top row.
  return [(left + 8 + u * (size - 16)) / 512, (top + 8 + v * (size - 16)) / 512];
}
async function createAtlases(parts, aliases) {
  const familyKey = part => part.source.json.materials[part.material].name === 'MI_Hair_1' ? 'shared-hair' : part.source.path + ':' + part.material;
  const keys = new Map();for (const part of parts) if (!keys.has(familyKey(part))) keys.set(familyKey(part), { source: part.source, material: part.material });
  assert.equal(keys.size, 5, 'qualified five material families expected');
  const families = [...keys].map(([key, value], index) => ({ key, ...value, atlas: index === 0 ? 0 : 1, tile: index === 0 ? 0 : index - 1 }));
  for (const family of families) {
    const uv = parts.filter(part => familyKey(part) === family.key).flatMap(part => part.uv), us = uv.filter((_, i) => i % 2 === 0), vs = uv.filter((_, i) => i % 2 === 1);
    family.minU = Math.floor(Math.min(...us));family.minV = Math.floor(Math.min(...vs));family.repeatU = Math.max(1, Math.ceil(Math.max(...us)) - family.minU);family.repeatV = Math.max(1, Math.ceil(Math.max(...vs)) - family.minV);
    assert.ok(family.repeatU <= 4 && family.repeatV <= 4, 'UV repetition exceeds qualified atlas coverage');
  }
  const images = [], sources = [];
  for (let atlas = 0; atlas < 2; atlas++) for (const kind of ['base', 'normal', 'orm']) {
    const composites = [];
    for (const family of families.filter(item => item.atlas === atlas)) {
      const tileSize = atlas === 0 ? 512 : 256, tile = await atlasTile(family.source, family.material, kind, aliases, tileSize - 16, family.repeatU, family.repeatV);
      composites.push({ input: tile.bytes, left: atlas === 0 ? 0 : family.tile % 2 * 256, top: atlas === 0 ? 0 : Math.floor(family.tile / 2) * 256 });
      if (tile.source) sources.push({ family: family.key, kind, ...tile.source });
    }
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite(composites).png().toBuffer();
    images.push({ atlas, kind, bytes });
  }
  const merged = [0, 1].map(atlas => ({ label: atlas === 0 ? 'Peasant clothing' : 'Steward skin eyes and hair', positions: [], normals: [], uv: [], colors: [], joints: [], weights: [], indices: [], material: atlas }));
  for (const part of parts) {
    const family = families.find(item => item.key === familyKey(part)), target = merged[family.atlas], offset = target.positions.length / 3;
    for (const key of ['positions', 'normals', 'colors', 'joints', 'weights']) target[key].push(...part[key]);
    target.indices.push(...part.indices.map(id => id + offset));
    const size = family.atlas === 0 ? 512 : 256, left = family.atlas === 0 ? 0 : family.tile % 2 * 256, top = family.atlas === 0 ? 0 : Math.floor(family.tile / 2) * 256;
    for (let i = 0; i < part.uv.length; i += 2) {
      const u = (part.uv[i] - family.minU) / family.repeatU, v = (part.uv[i + 1] - family.minV) / family.repeatV;assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, 'UV outside baked repeat coverage');
      target.uv.push(...stewardAtlasUv(u, v, left, top, size));
    }
  }
  return { merged, images, sources, families: families.map(f => ({ key: f.key, atlas: f.atlas, tile: f.tile, minU: f.minU, minV: f.minV, repeatU: f.repeatU, repeatV: f.repeatV })) };
}
async function buildGlb(parts, target, rig, animation, atlas, aliases) {
  const j = { asset: { version: '2.0', generator: 'Crownfall private steward CPU preparation', extras: { roleId: 'house-steward', appearanceWorkingAndReplaceable: true, visualReviewPassed: false, questLodQualified: false,
      ...(atlas ? { crownfallAtlasUvOrigin: 'glTF top-left; direct atlas placement' } : {}) } },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], animations: [], materials: [], images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: atlas ? 33071 : 10497, wrapT: atlas ? 33071 : 10497 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = [];let length = 0;
  function view(bytes, target) { const pad = (4 - length % 4) % 4;if (pad) { chunks.push(Buffer.alloc(pad));length += pad; }const id = j.bufferViews.length;j.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });chunks.push(bytes);length += bytes.length;return id; }
  function data(values, width, componentType = 5126, target) {
    assert.equal(values.length % width, 0);assert.ok(values.every(Number.isFinite));const typed = componentType === 5126 ? Float32Array.from(values) : componentType === 5123 ? Uint16Array.from(values) : Uint32Array.from(values);
    const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);for (let i = 0; i < typed.length; i++) { min[i % width] = Math.min(min[i % width], typed[i]);max[i % width] = Math.max(max[i % width], typed[i]); }
    const id = j.accessors.length;j.accessors.push({ bufferView: view(Buffer.from(typed.buffer), target), componentType, count: values.length / width, type: { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4' }[width], ...(width === 16 ? {} : { min, max }) });return id;
  }
  const imageCache = new Map();function image(bytes, name) { const key = digest(bytes);if (imageCache.has(key)) return imageCache.get(key);const id = j.textures.length;j.images.push({ name, bufferView: view(bytes), mimeType: 'image/png' });j.textures.push({ source: j.images.length - 1, sampler: 0 });imageCache.set(key, id);return id; }
  const materialCache = new Map();
  if (atlas) for (let i = 0; i < 2; i++) {
    const textures = Object.fromEntries(atlas.images.filter(item => item.atlas === i).map(item => [item.kind, image(item.bytes, 'steward-' + i + '-' + item.kind)]));
    j.materials.push({ name: i === 0 ? 'Peasant clothing atlas' : 'Steward skin eyes hair atlas', doubleSided: true, normalTexture: { index: textures.normal }, pbrMetallicRoughness: { baseColorTexture: { index: textures.base }, metallicRoughnessTexture: { index: textures.orm }, metallicFactor: 1, roughnessFactor: 1 } });
  }
  async function material(part) {
    if (atlas) return part.material;const key = part.source.path + ':' + part.material;if (materialCache.has(key)) return materialCache.get(key);
    const value = structuredClone(part.source.json.materials[part.material]);
    async function walk(object) { for (const [key, child] of Object.entries(object)) { if (key.endsWith('Texture') && child && Number.isSafeInteger(child.index)) { const source = await sourceImage(part.source, child.index, aliases);child.index = image(source.bytes, source.path.split('/').at(-1)); } else if (child && typeof child === 'object') await walk(child); } }
    await walk(value);const id = j.materials.length;j.materials.push(value);materialCache.set(key, id);return id;
  }
  const boneMap = new Map(rig.skin.joints.map((id, i) => [id, i]));
  for (const id of rig.skin.joints) { const node = structuredClone(target.json.nodes[id]);delete node.mesh;delete node.skin;node.children = (node.children ?? []).filter(child => boneMap.has(child)).map(child => boneMap.get(child));if (!node.children.length) delete node.children;j.nodes.push(node); }
  const meshNodes = [];
  for (const part of parts) {
    const primitive = { attributes: { POSITION: data(part.positions, 3, 5126, 34962), NORMAL: data(part.normals, 3, 5126, 34962), TEXCOORD_0: data(part.uv, 2, 5126, 34962), COLOR_0: data(part.colors, 4, 5126, 34962), JOINTS_0: data(part.joints, 4, 5123, 34962), WEIGHTS_0: data(part.weights, 4, 5126, 34962) },
      indices: data(part.indices, 1, part.positions.length / 3 < 65536 ? 5123 : 5125, 34963), material: await material(part) };
    const mesh = j.meshes.length;j.meshes.push({ name: part.label, primitives: [primitive] });meshNodes.push(j.nodes.length);j.nodes.push({ name: part.label, mesh, skin: 0 });
  }
  const skeletonRoots = rig.skin.joints.filter(id => !rig.skin.joints.some(parent => target.json.nodes[parent].children?.includes(id)));assert.equal(skeletonRoots.length, 1);
  const root = j.nodes.length;j.nodes.push({ name: 'house-steward', children: [boneMap.get(skeletonRoots[0]), ...meshNodes],
    translation: [0, -animation.bindBounds.min.y * animation.scale, 0], scale: [animation.scale, animation.scale, animation.scale], extras: { roleId: 'house-steward', workingAppearance: true, forward: '+Z', units: 'metres', restHeightMetres: 1.8, feetAtRestY: 0 } });j.scenes[0].nodes = [root];
  j.skins.push({ name: 'Steward shared 65-joint rig', joints: rig.names.map((_, i) => i), skeleton: 0, inverseBindMatrices: data(animation.bindInverse.flatMap(m => m.toArray()), 16) });
  const clip = { name: 'Idle_Talking_Loop', samplers: [], channels: [] }, timeAccessor = data(animation.times, 1);
  function channel(node, path, values, width) { const sampler = clip.samplers.length;clip.samplers.push({ input: timeAccessor, output: data(values, width), interpolation: 'LINEAR' });clip.channels.push({ sampler, target: { node, path } }); }
  for (let i = 0; i < rig.names.length; i++) { channel(i, 'rotation', animation.rotations[i], 4);channel(i, 'translation', animation.translations[i], 3); }
  channel(root, 'translation', animation.rootOffsets, 3);j.animations.push(clip);
  const pad = (4 - length % 4) % 4;if (pad) { chunks.push(Buffer.alloc(pad));length += pad; }j.buffers[0].byteLength = length;
  let json = Buffer.from(JSON.stringify(j));json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);const bin = Buffer.concat(chunks), bytes = Buffer.alloc(28 + json.length + bin.length), at = 20 + json.length;
  bytes.writeUInt32LE(0x46546c67, 0);bytes.writeUInt32LE(2, 4);bytes.writeUInt32LE(bytes.length, 8);bytes.writeUInt32LE(json.length, 12);bytes.writeUInt32LE(0x4e4f534a, 16);json.copy(bytes, 20);bytes.writeUInt32LE(bin.length, at);bytes.writeUInt32LE(0x004e4942, at + 4);bin.copy(bytes, at + 8);return bytes;
}
export async function validateStewardGlb(path) {
  const g = await loadGltf(path), j = g.json, skin = j.skins[0];assert.equal(j.skins.length, 1);assert.equal(skin.joints.length, 65);
  const names = skin.joints.map(id => j.nodes[id].name);assert.equal(new Set(names).size, 65, 'aliased output bones');assert.ok(names.includes('Head') && names.includes('neck_01'));
  assert.ok(![...j.buffers, ...j.images].some(item => item.uri), 'output must be self-contained');assert.equal(j.animations.length, 1);assert.equal(j.animations[0].name, 'Idle_Talking_Loop');
  const parts = j.meshes.flatMap(mesh => mesh.primitives.map(p => ({ label: mesh.name, positions: Array.from(accessor(g, p.attributes.POSITION)),
    joints: Array.from(accessor(g, p.attributes.JOINTS_0)), weights: Array.from(accessor(g, p.attributes.WEIGHTS_0)), indices: Array.from(accessor(g, p.indices)), normals: Array.from(accessor(g, p.attributes.NORMAL)) })));
  let maxWeightError = 0, maxNormalError = 0;
  for (const part of parts) {
    const count = part.positions.length / 3;assert.equal(part.weights.length, count * 4);assert.equal(part.joints.length, count * 4);assert.equal(part.normals.length, count * 3);
    assert.ok(part.indices.every(id => Number.isInteger(id) && id >= 0 && id < count));assert.ok(part.joints.every(id => Number.isInteger(id) && id >= 0 && id < 65));
    for (let i = 0; i < count; i++) { maxWeightError = Math.max(maxWeightError, Math.abs(part.weights.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0) - 1));maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(...part.normals.slice(i * 3, i * 3 + 3)) - 1)); }
  }
  assert.ok(maxWeightError < 2e-5 && maxNormalError < 2e-5, 'output weights/normals');
  const clip = j.animations[0], tracks = clip.channels.map(channel => { const sampler = clip.samplers[channel.sampler];return { node: channel.target.node, path: channel.target.path, interpolation: sampler.interpolation, times: accessor(g, sampler.input), values: accessor(g, sampler.output) }; });
  assert.ok(tracks.every(track => track.path !== 'scale'), 'scale tracks must be removed');const duration = Math.max(...tracks.map(track => track.times.at(-1))), inverse = accessor(g, skin.inverseBindMatrices);
  const samples = [];
  for (const time of [0, duration / 4, duration / 2, duration * .75, duration]) {
    const overrides = new Map();for (const track of tracks) { const node = overrides.get(track.node) ?? { ...j.nodes[track.node] };node[track.path] = sampleTrack(track, time);overrides.set(track.node, node); }
    const frames = worlds(j, new Map([...overrides].map(([id, node]) => [id, local(node)]))), matrices = skin.joints.map((id, i) => frames.get(id).clone().multiply(new Matrix4().fromArray(inverse, i * 16)));
    const bounds = skinnedBounds(parts, matrices);assert.ok(bounds.max.y - bounds.min.y > 1.4 && bounds.max.y - bounds.min.y < 2.2, 'posed body exploded');
    assert.ok(Math.abs(bounds.min.y) < .004, 'sampled feet grounding');samples.push({ time, min: bounds.min.toArray(), max: bounds.max.toArray(), finite: true });
  }
  const images = [];for (const image of j.images) { const view = j.bufferViews[image.bufferView], metadata = await sharp(g.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)).metadata();images.push({ name: image.name, width: metadata.width, height: metadata.height }); }
  return { sha256: g.sha256, bytes: (await readFile(path)).length, triangles: parts.reduce((n, part) => n + part.indices.length / 3, 0), drawCalls: parts.length, materials: j.materials.length,
    vertices: parts.reduce((n, part) => n + part.positions.length / 3, 0), joints: 65, skins: 1, morphTargets: 0, clips: 1, channels: tracks.length, clipDurationSeconds: duration,
    maxWeightError, maxNormalError, noBoneAliasOrCycles: true, samples, images, textureGpuBytesRgbaWithMipsEstimate: images.reduce((n, image) => n + Math.ceil(image.width * image.height * 4 * 4 / 3), 0),
    questTriangleBudgetPassed: parts.reduce((n, part) => n + part.indices.length / 3, 0) <= 3000, questDrawBudgetPassed: parts.length <= 2, textureDimensionBudgetPassed: images.every(image => image.width <= 512 && image.height <= 512), visualReviewPassed: false };
}
export async function prepareSteward(base = '/workspace/private-assets/crownfall-characters', outputDirectory = resolve(base, 'derived', 'steward-v1')) {
  const plan = await preflightPrivateOutput(base, outputDirectory, ['house-steward-source-detail.glb', 'house-steward-atlas512-candidate.glb', 'mcof-License.txt', 'ubc-License.txt', 'ual1-License.txt', 'provenance.json']);outputDirectory = plan.path;
  const { proof, body, head, hair, animation: sourceAnimation, aliases, licenses } = await preflightStewardSources(base);
  const targetRig = inspectRig(body), headRig = inspectRig(head), hairRig = inspectRig(hair), animationRig = inspectRig(sourceAnimation), parts = [];
  body.json.meshes.forEach((mesh, mi) => mesh.primitives.forEach((_, pi) => parts.push(extractPart(body, targetRig, targetRig, mi, pi, 'Peasant ' + mesh.name + ' ' + pi))));
  const headMesh = head.json.meshes.findIndex(mesh => mesh.name === 'Sphere.005_Retopology.004');assert.ok(headMesh >= 0);
  parts.push(extractPart(head, headRig, targetRig, headMesh, 0, 'UBC head and collar-covered neck', (triangle, attributes) => triangle.every(id => attributes.POSITION[id * 3 + 1] >= 1.54)));
  for (const mi of [0, 1]) parts.push(extractPart(head, headRig, targetRig, mi, 0, mi === 0 ? 'UBC eyebrows' : 'UBC eyes'));
  parts.push(extractPart(hair, hairRig, targetRig, 0, 0, 'UBC SimpleParted hair'));
  const bake = bakeTalking(sourceAnimation, animationRig, body, targetRig, parts), atlas = await createAtlases(parts, aliases);
  const files = [], output = await plan.create();
  try {
  for (const variant of ['source-detail', 'atlas512-candidate']) {
    const path = resolve(outputDirectory, 'house-steward-' + variant + '.glb'), useAtlas = variant === 'atlas512-candidate';
    const bytes = await buildGlb(useAtlas ? atlas.merged : parts, body, targetRig, bake, useAtlas ? atlas : null, aliases);await output.write(basename(path), bytes);
    files.push({ variant, path, ...(await validateStewardGlb(path)) });
  }
  for (const license of licenses) await output.write(license.name, license.bytes);
  const restDifferences = targetRig.names.map((name, i) => { const targetNode = body.json.nodes[targetRig.skin.joints[i]], sourceNode = sourceAnimation.json.nodes[animationRig.skin.joints[animationRig.byName.get(name)]];return { joint: name,
    localRestRotationDegrees: new Quaternion(...(targetNode.rotation ?? [0, 0, 0, 1])).normalize().angleTo(new Quaternion(...(sourceNode.rotation ?? [0, 0, 0, 1])).normalize()) * 180 / Math.PI,
    localRestTranslationMetres: new Vector3(...(targetNode.translation ?? [0, 0, 0])).distanceTo(new Vector3(...(sourceNode.translation ?? [0, 0, 0]))) }; });
  const report = { roleId: 'house-steward', sourceMode: 'Free Standard CC0 only; working appearance; no approved costume/name/history claims', archives: proof.archives, rawFilesByteIdenticalToFrozenArchiveMembers: proof.rawFilesByteIdenticalToFrozenArchiveMembers,
    sources: [body, head, hair, sourceAnimation].map(g => ({ path: g.path, sha256: g.sha256 })), consumedArchiveMembers: [...proof.readQualified.consumed.values()], outputDirectory, files, sourcePartTriangles: parts.map(part => ({ part: part.label, triangles: part.indices.length / 3 })),
    rig: { joints: 65, sharedSkeleton: true, bindErrors: { body: targetRig.bindError, head: headRig.bindError, hair: hairRig.bindError, animation: animationRig.bindError }, restDifferences,
      retarget: bake.retarget, maximumWorldDeltaErrorRadians: bake.rotationDeltaError, discardedUnitScaleDeviation: bake.maxDiscardedScaleDeviation, rootGroundingOffsetRangeMetres: bake.rootGroundingOffsetRangeMetres, normalizedRestHeightMetres: 1.8, normalizedScale: bake.scale },
    neckJoin: { cutSelectionMinimumSourceY: 1.54, collarTopSourceY: Math.max(...parts.filter(p => p.label.includes('Peasant_Body')).flatMap(p => p.positions.filter((_, i) => i % 3 === 1))), constraint: 'Head/neck baked into master bind; source neck overlaps shirt collar vertically. Visual seam/silhouette and animated cloth penetration remain unverified.' },
    atlas: { families: atlas.families, sources: atlas.sources, paddingPixels: 8, normalsRenormalizedFromActualSourceMaps: true, hairRoughnessHarmonizedToEyebrowMaterialInAtlasOnly: true, visualReviewPassed: false },
    limits: ['CPU structural prototype only; no runtime NPC/world integration or visual approval.', 'No blind mesh decimation: source-detail geometry exceeds the 3000-triangle Quest target.', 'Atlas512 meets two draws and map dimensions structurally; face/hand/hair texture quality and neck seam require isolated visual review.', 'Both adapters must instantiate an independent skeleton using SkeletonUtils.clone or an equivalent verified clone; map roleId house-steward to existing cast state; one owned AnimationMixer/action for Idle_Talking_Loop, pause/reduced-motion/teardown under adapter ownership. No app code was changed.'] };
  await output.write('provenance.json', JSON.stringify(report, null, 2));
  await verifySources(base);return report;
  } finally { await output.close(); }
}
function decodedPart(g, mesh) {
  assert.equal(mesh.primitives.length, 1);const p = mesh.primitives[0], read = name => Array.from(accessor(g, p.attributes[name]));
  return { label: mesh.name, material: p.material, positions: read('POSITION'), normals: read('NORMAL'), uv: read('TEXCOORD_0'), colors: read('COLOR_0'), joints: read('JOINTS_0'), weights: read('WEIGHTS_0'), indices: Array.from(accessor(g, p.indices)) };
}
export function countGeometricComponents(part) {
  const parents = new Map();function root(key) { if (!parents.has(key)) parents.set(key, key);let r = parents.get(key);while (parents.get(r) !== r) r = parents.get(r);parents.set(key, r);return r; }
  for (let i = 0; i < part.indices.length; i += 3) {
    const keys = part.indices.slice(i, i + 3).map(id => part.positions.slice(id * 3, id * 3 + 3).map(value => Math.round(value * 1e6)).join(':')), parent = root(keys[0]);
    for (const key of keys.slice(1)) parents.set(root(key), parent);
  }
  return new Set([...parents.keys()].map(root)).size;
}
export function simplifyStewardPart(part, jointNames = [], profile = 'strict') {
  const protectedPart = (profile === 'strict' && part.label === 'Peasant Male_Peasant_Arms 1') || part.label === 'UBC head and collar-covered neck';
  if (protectedPart) return { part, report: { part: part.label, inputTriangles: part.indices.length / 3, outputTriangles: part.indices.length / 3, protectedWholePart: true, error: 0 } };
  const count = part.positions.length / 3, active = [...new Set(part.joints.filter((_, i) => part.weights[i] > 1e-7))].sort((a, b) => a - b), stride = 9 + active.length;
  assert.ok(stride <= 32, 'active skin palette exceeds qualified Meshopt attribute count');
  const attributes = new Float32Array(count * stride), locks = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    attributes.set([...part.normals.slice(i * 3, i * 3 + 3), ...part.uv.slice(i * 2, i * 2 + 2), ...part.colors.slice(i * 4, i * 4 + 4)], i * stride);
    for (let c = 0; c < 4; c++) if (part.weights[i * 4 + c] > 1e-7) attributes[i * stride + 9 + active.indexOf(part.joints[i * 4 + c])] += part.weights[i * 4 + c];
    const x = part.positions[i * 3], y = part.positions[i * 3 + 1];
    // Preserve the complete collar attachment and the sole's floor contact.
    let handWeight = 0;for (let c = 0; c < 4; c++) if (/^hand_[lr]$|^(index|middle|pinky|ring|thumb)_\d+_/.test(jointNames[part.joints[i * 4 + c]] ?? '')) handWeight += part.weights[i * 4 + c];
    if (handWeight > .01 || (part.label.includes('Peasant_Body') && y > 1.49 && Math.abs(x) < .24) || (part.label.includes('Peasant_Feet') && y < .02)) locks[i] = 1;
  }
  const miniature = profile.startsWith('miniature'), smallDisplay = profile === 'miniature-35mm';
  const absoluteError = part.label.startsWith('UBC ') ? (miniature && part.label.includes('hair') ? .006 : .004) : smallDisplay ? .03 : miniature ? .02 : .012, flags = ['LockBorder', 'ErrorAbsolute', 'Regularize'];
  const weights = miniature ? [...Array(3).fill(smallDisplay ? .15 : .3), ...Array(2).fill(smallDisplay ? .5 : 1), ...Array(4).fill(.2), ...active.map(() => 2)] : [...Array(3).fill(.5), ...Array(2).fill(2), ...Array(4).fill(.25), ...active.map(() => 4)];
  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(part.indices), Float32Array.from(part.positions), 3, attributes, stride, weights, locks, 3, absoluteError, flags);
  assert.ok(indices.length > 0 && indices.length % 3 === 0);const used = [...new Set(indices)], remap = new Map(used.map((id, i) => [id, i])), result = { label: part.label, material: part.material, indices: Array.from(indices, id => remap.get(id)) };
  for (const [key, width] of Object.entries({ positions: 3, normals: 3, uv: 2, colors: 4, joints: 4, weights: 4 })) result[key] = used.flatMap(id => part[key].slice(id * width, id * width + width));
  const protectedTriangles = [];for (let i = 0; i < part.indices.length; i += 3) if (part.indices.slice(i, i + 3).every(id => locks[id])) protectedTriangles.push(part.indices.slice(i, i + 3));
  const retainedTriangles = new Set();for (let i = 0; i < indices.length; i += 3) retainedTriangles.add(Array.from(indices.slice(i, i + 3)).join(':'));
  assert.ok(protectedTriangles.every(triangle => retainedTriangles.has(triangle.join(':'))), 'simplification modified a fully locked head/hand/collar/sole triangle');
  const inputComponents = countGeometricComponents(part), outputComponents = countGeometricComponents(result);assert.equal(outputComponents, inputComponents, 'simplification dropped or merged a geometric component');
  return { part: result, report: { part: part.label, inputTriangles: part.indices.length / 3, outputTriangles: indices.length / 3, protectedWholePart: false, lockedVertices: locks.reduce((n, v) => n + v, 0), protectedTrianglesRetainedExact: protectedTriangles.length,
    method: 'simplifyWithAttributes; no vertex/attribute updates; compact retained source vertices only', inputComponents, outputComponents, activeSkinJoints: active, attributeStride: stride, attributeWeights: weights, targetIndices: 3, absoluteErrorLimitMetres: absoluteError, error, flags } };
}
function replaceGeometry(g, parts) {
  const j = structuredClone(g.json), buffers = [g.binary];let length = g.binary.length;
  function data(values, width, type = 5126) {
    const array = type === 5126 ? Float32Array.from(values) : type === 5123 ? Uint16Array.from(values) : Uint32Array.from(values), pad = (4 - length % 4) % 4;
    if (pad) { buffers.push(Buffer.alloc(pad));length += pad; }const view = j.bufferViews.length;j.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: array.byteLength });buffers.push(Buffer.from(array.buffer));length += array.byteLength;
    const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);array.forEach((v, i) => { min[i % width] = Math.min(min[i % width], v);max[i % width] = Math.max(max[i % width], v); });
    const id = j.accessors.length;j.accessors.push({ bufferView: view, componentType: type, count: values.length / width, type: { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' }[width], min, max });return id;
  }
  j.meshes = parts.map(part => ({ name: part.label, primitives: [{ material: part.material, indices: data(part.indices, 1, part.positions.length / 3 < 65536 ? 5123 : 5125), attributes: {
    POSITION: data(part.positions, 3), NORMAL: data(part.normals, 3), TEXCOORD_0: data(part.uv, 2), COLOR_0: data(part.colors, 4), JOINTS_0: data(part.joints, 4, 5123), WEIGHTS_0: data(part.weights, 4) } }] }));
  const binary = Buffer.concat(buffers), views = [], accessors = [], chunks = [], viewMap = new Map(), accessorMap = new Map();let outLength = 0;
  function view(id) { if (viewMap.has(id)) return viewMap.get(id);const old = j.bufferViews[id], pad = (4 - outLength % 4) % 4;if (pad) { chunks.push(Buffer.alloc(pad));outLength += pad; }const next = views.length;views.push({ ...old, byteOffset: outLength });const bytes = binary.subarray(old.byteOffset ?? 0, (old.byteOffset ?? 0) + old.byteLength);chunks.push(bytes);outLength += bytes.length;viewMap.set(id, next);return next; }
  function acc(id) { if (accessorMap.has(id)) return accessorMap.get(id);const next = accessors.length;accessors.push({ ...j.accessors[id], bufferView: view(j.accessors[id].bufferView) });accessorMap.set(id, next);return next; }
  for (const mesh of j.meshes) for (const p of mesh.primitives) { p.indices = acc(p.indices);for (const key of Object.keys(p.attributes)) p.attributes[key] = acc(p.attributes[key]); }
  for (const skin of j.skins) skin.inverseBindMatrices = acc(skin.inverseBindMatrices);
  for (const animation of j.animations) for (const sampler of animation.samplers) { sampler.input = acc(sampler.input);sampler.output = acc(sampler.output); }
  for (const image of j.images) image.bufferView = view(image.bufferView);
  const pad = (4 - outLength % 4) % 4;if (pad) { chunks.push(Buffer.alloc(pad));outLength += pad; }j.bufferViews = views;j.accessors = accessors;j.buffers[0].byteLength = outLength;j.asset.extras.offDefaultLodCandidate = true;
  let json = Buffer.from(JSON.stringify(j));json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);const bin = Buffer.concat(chunks), bytes = Buffer.alloc(28 + json.length + bin.length), at = 20 + json.length;
  bytes.writeUInt32LE(0x46546c67, 0);bytes.writeUInt32LE(2, 4);bytes.writeUInt32LE(bytes.length, 8);bytes.writeUInt32LE(json.length, 12);bytes.writeUInt32LE(0x4e4f534a, 16);json.copy(bytes, 20);bytes.writeUInt32LE(bin.length, at);bytes.writeUInt32LE(0x004e4942, at + 4);bin.copy(bytes, at + 8);return bytes;
}
function posedGeometry(g, time) {
  const overrides = new Map();
  for (const channel of g.json.animations[0].channels) { const sampler = g.json.animations[0].samplers[channel.sampler], node = overrides.get(channel.target.node) ?? { ...g.json.nodes[channel.target.node] };
    node[channel.target.path] = sampleTrack({ path: channel.target.path, interpolation: sampler.interpolation, times: accessor(g, sampler.input), values: accessor(g, sampler.output) }, time);overrides.set(channel.target.node, node); }
  const frames = worlds(g.json, new Map([...overrides].map(([id, node]) => [id, local(node)]))), skin = g.json.skins[0], inverse = accessor(g, skin.inverseBindMatrices);
  const matrices = skin.joints.map((id, i) => frames.get(id).clone().multiply(new Matrix4().fromArray(inverse, i * 16))), positions = [], indices = [];
  for (const mesh of g.json.meshes) { const part = decodedPart(g, mesh), offset = positions.length / 3;
    for (let i = 0; i < part.positions.length / 3; i++) { const p = new Vector3().fromArray(part.positions, i * 3), out = new Vector3();for (let c = 0; c < 4; c++) out.addScaledVector(p.clone().applyMatrix4(matrices[part.joints[i * 4 + c]]), part.weights[i * 4 + c]);positions.push(...out.toArray()); }
    indices.push(...part.indices.map(id => id + offset)); }
  const geometry = new BufferGeometry();geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));geometry.setIndex(indices);return geometry;
}
export async function measureStewardLodError(full, lod) {
  const bvhRoot = new URL('../main-game-vr/node_modules/three-mesh-bvh/', import.meta.url), metadata = JSON.parse(await readFile(new URL('package.json', bvhRoot), 'utf8'));
  const { MeshBVH } = await import(new URL(metadata.exports['.'].import, bvhRoot).href), duration = accessor(full, full.json.animations[0].samplers[0].input).at(-1), samples = [];
  function compare(source, destination) {
    const tree = new MeshBVH(destination, { targetLeafSize: 10 }), p = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3(), target = { point: new Vector3() }, positions = source.getAttribute('position'), ids = source.index;
    let max = 0, sum = 0, count = 0;
    function observe(point) { const result = tree.closestPointToPoint(point, target);assert.ok(result && Number.isFinite(result.distance));max = Math.max(max, result.distance);sum += result.distance * result.distance;count++; }
    for (let i = 0; i < positions.count; i++) observe(p.fromBufferAttribute(positions, i));
    for (let i = 0; i < ids.count; i += 3) { a.fromBufferAttribute(positions, ids.getX(i));b.fromBufferAttribute(positions, ids.getX(i + 1));c.fromBufferAttribute(positions, ids.getX(i + 2));observe(p.copy(a).add(b).add(c).multiplyScalar(1 / 3)); }
    return { maximumDistanceMetres: max, rmsDistanceMetres: Math.sqrt(sum / count), points: count };
  }
  for (const time of [0, duration / 2, duration]) { const source = posedGeometry(full, time), reduced = posedGeometry(lod, time), forward = compare(source, reduced), reverse = compare(reduced, source);
    source.computeBoundingBox();reduced.computeBoundingBox();const boundError = Math.max(...source.boundingBox.min.toArray().map((v, i) => Math.abs(v - reduced.boundingBox.min.toArray()[i])), ...source.boundingBox.max.toArray().map((v, i) => Math.abs(v - reduced.boundingBox.max.toArray()[i])));
    samples.push({ time, sourceToLod: forward, lodToSource: reverse, maximumAabbCoordinateErrorMetres: boundError });source.dispose();reduced.dispose(); }
  return { method: 'CPU closest triangle surface for every vertex and every triangle centroid, both directions, at start/mid/end; sampled metric, not continuous Hausdorff proof', samples,
    maximumSampledSurfaceDistanceMetres: Math.max(...samples.flatMap(sample => [sample.sourceToLod.maximumDistanceMetres, sample.lodToSource.maximumDistanceMetres])) };
}
export async function prepareStewardLod(atlasPath, detailPath, outputDirectory, profile = 'strict') {
  assert.ok(atlasPath && detailPath && outputDirectory, 'LOD requires atlas input, retained detail input and a fresh private output directory');
  atlasPath = await noSymlinkComponents(atlasPath);detailPath = await noSymlinkComponents(detailPath);assert.equal(dirname(atlasPath), dirname(detailPath), 'derived inputs must share their identity report directory');const base = await realpath(resolve(dirname(atlasPath), '..', '..'));
  const plan = await preflightPrivateOutput(base, outputDirectory, ['house-steward-lod-candidate.glb', 'lod-provenance.json']);outputDirectory = plan.path;
  const atlas = await loadGltf(atlasPath), detail = await loadGltf(detailPath), provenance = JSON.parse(await readFile(resolve(dirname(atlasPath), 'provenance.json'), 'utf8'));
  for (const g of [atlas, detail]) assert.equal(provenance.files.find(file => file.path === g.path)?.sha256, g.sha256, 'LOD input no longer matches structural provenance');
  assert.equal(atlas.json.asset.extras.roleId, 'house-steward');assert.equal(atlas.json.meshes.length, 2);await MeshoptSimplifier.ready;
  assert.ok(['strict', 'miniature', 'miniature-35mm'].includes(profile));const jointNames = atlas.json.skins[0].joints.map(id => atlas.json.nodes[id].name);
  const atlasParts = atlas.json.meshes.map(mesh => decodedPart(atlas, mesh)), offsets = [0, 0], parts = [];
  for (const mesh of detail.json.meshes) { const part = decodedPart(detail, mesh), material = detail.json.materials[part.material].name === 'MI_Peasant' ? 0 : 1, full = atlasParts[material], offset = offsets[material];
    for (const [key, width] of Object.entries({ positions: 3, normals: 3, colors: 4, joints: 4, weights: 4 })) assert.deepEqual(part[key], full[key].slice(offset * width, (offset + part.positions.length / 3) * width), 'atlas lineage mismatch');
    part.uv = full.uv.slice(offset * 2, (offset + part.positions.length / 3) * 2);part.material = material;offsets[material] += part.positions.length / 3;
    if (profile.startsWith('miniature') && part.label === 'Peasant Male_Peasant_Arms 1') {
      let covered = 0;for (const side of [-1, 1]) { const indices = [];for (let i = 0; i < part.indices.length; i += 3) { const triangle = part.indices.slice(i, i + 3);if (triangle.every(id => part.positions[id * 3] * side >= 0)) indices.push(...triangle); }
        covered += indices.length;const used = [...new Set(indices)], remap = new Map(used.map((id, i) => [id, i])), half = { label: part.label + (side < 0 ? ' right' : ' left'), material, indices: indices.map(id => remap.get(id)) };
        for (const [key, width] of Object.entries({ positions: 3, normals: 3, uv: 2, colors: 4, joints: 4, weights: 4 })) half[key] = used.flatMap(id => part[key].slice(id * width, id * width + width));parts.push(simplifyStewardPart(half, jointNames, profile)); }
      assert.equal(covered, part.indices.length, 'arm palette split lost or duplicated a triangle');
    } else parts.push(simplifyStewardPart(part, jointNames, profile)); }
  const merged = atlasParts.map(part => ({ ...part, positions: [], normals: [], colors: [], joints: [], weights: [], uv: [], indices: [] }));
  for (const { part } of parts) { const target = merged[part.material], offset = target.positions.length / 3;for (const key of ['positions', 'normals', 'colors', 'joints', 'weights', 'uv']) target[key].push(...part[key]);target.indices.push(...part.indices.map(id => id + offset)); }
  const path = resolve(outputDirectory, 'house-steward-lod-candidate.glb'), bytes = replaceGeometry(atlas, merged), output = await plan.create();
  try {
  await output.write(basename(path), bytes);const stats = await validateStewardGlb(path), lod = await loadGltf(path), error = await measureStewardLodError(atlas, lod);
  const poseErrorCapMetres = profile === 'miniature-35mm' ? .035 : .025;
  assert.ok(error.maximumSampledSurfaceDistanceMetres <= poseErrorCapMetres, 'LOD deformation exceeds its recorded sampled pose-error cap');
  for (const key of ['nodes', 'skins', 'animations', 'materials', 'textures', 'images']) {
    if (key === 'skins' || key === 'animations' || key === 'images') continue;assert.deepEqual(lod.json[key], atlas.json[key], 'LOD changed ' + key);
  }
  const report = { roleId: 'house-steward', offDefault: true, profile, path, provenanceScope: 'Derived-input byte identity and structure only. Editable adjacent metadata does not independently establish CC0 or frozen-archive origin; source-mode archive qualification is separate.', archiveOriginIndependentlyVerifiedByLod: false,
    input: { atlasPath, atlasSha256: atlas.sha256, detailPath, detailSha256: detail.sha256 }, stats, parts: parts.map(p => p.report),
    requestedQuestTriangles: 3000, protectedHeadAndHandsTriangleFloor: parts.filter(p => p.report.protectedWholePart || p.report.part.startsWith('Peasant Male_Peasant_Arms 1')).reduce((n, p) => n + (p.report.protectedWholePart ? p.report.outputTriangles : p.report.protectedTrianglesRetainedExact), 0), actualTriangleFloorAtRecordedErrorAndAttributeSettings: stats.triangles,
    noComponentsDropped: true, retainedVertexAttributesExact: true, skinWeightsNotInterpolated: true, jointsRetained: 65, UVsAndMapsFromAtlasExact: true, shaderAndAnimationDataChanged: false,
    deformationError: error, sampledPoseErrorCapMetres: poseErrorCapMetres, normalizedHeight: 1.8, intendedMiniatureHeightMetres: .036, maximumSampledDisplayErrorAtOneToFiftyMetres: error.maximumSampledSurfaceDistanceMetres / 50,
    visualReviewPassed: false, limits: 'Off-default structural LOD only. No runtime integration or GPU image. Protected head/hands retain all triangles; collar/sole vertices and topological borders locked. The reported floor is for these exact settings, not a mathematically minimal mesh.' };
  await output.write('lod-provenance.json', JSON.stringify(report, null, 2));
  assert.equal(digest(await readFile(atlasPath)), atlas.sha256);assert.equal(digest(await readFile(detailPath)), detail.sha256);return report;
  } finally { await output.close(); }
}
export function correctedStewardUvBytes(g) {
  assert.equal(g.json.meshes.length, 2);assert.ok(!g.json.asset.extras.crownfallAtlasUvOrigin, 'UV correction already applied');
  const binary = Buffer.from(g.binary), changed = [], uvRanges = new Map();
  for (const mesh of g.json.meshes) for (const p of mesh.primitives) if (p.material === 1) {
    const a = g.json.accessors[p.attributes.TEXCOORD_0], view = g.json.bufferViews[a.bufferView];assert.equal(a.componentType, 5126);assert.equal(a.type, 'VEC2');
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = view.byteStride ?? 8;
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (let i = 0; i < a.count; i++) { const at = start + i * stride + 4, value = binary.readFloatLE(at);assert.ok(value > 0 && value < 1 && Math.abs(value - .5) > .01);binary.writeFloatLE(value < .5 ? value + .5 : value - .5, at);changed.push([at, at + 4]);
      for (let c = 0; c < 2; c++) { const v = binary.readFloatLE(start + i * stride + c * 4);min[c] = Math.min(min[c], v);max[c] = Math.max(max[c], v); } }
    uvRanges.set(p.attributes.TEXCOORD_0, { min, max });
  }
  assert.ok(changed.length);const json = structuredClone(g.json);json.asset.extras.crownfallAtlasUvOrigin = 'glTF top-left; corrected four-tile row selection';
  for (const [id, range] of uvRanges) Object.assign(json.accessors[id], range);
  let text = Buffer.from(JSON.stringify(json));text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);const bytes = Buffer.alloc(28 + text.length + binary.length), at = 20 + text.length;
  bytes.writeUInt32LE(0x46546c67, 0);bytes.writeUInt32LE(2, 4);bytes.writeUInt32LE(bytes.length, 8);bytes.writeUInt32LE(text.length, 12);bytes.writeUInt32LE(0x4e4f534a, 16);text.copy(bytes, 20);bytes.writeUInt32LE(binary.length, at);bytes.writeUInt32LE(0x004e4942, at + 4);binary.copy(bytes, at + 8);return { bytes, changedVertices: changed.length };
}
export async function prepareStewardUvCorrection(base, outputDirectory) {
  const names = ['house-steward-atlas512-uv-corrected.glb', 'house-steward-lod-uv-corrected.glb', 'material-provenance.json', 'mcof-License.txt', 'ubc-License.txt', 'ual1-License.txt'];
  const plan = await preflightPrivateOutput(base, outputDirectory, names), sources = await preflightStewardSources(base);
  const sourceReport = JSON.parse(await readFile(resolve(base, 'derived/steward-v1/provenance.json'))), lodReport = JSON.parse(await readFile(resolve(base, 'derived/steward-lod-v3/lod-provenance.json')));
  const paths = [resolve(base, 'derived/steward-v1/house-steward-atlas512-candidate.glb'), resolve(base, 'derived/steward-lod-v3/house-steward-lod-candidate.glb')];
  const models = await Promise.all(paths.map(path => loadGltf(path)));assert.equal(models[0].sha256, sourceReport.files.find(f => f.variant === 'atlas512-candidate').sha256);assert.equal(models[1].sha256, lodReport.stats.sha256);
  const output = await plan.create(), files = [];
  try {
    for (let i = 0; i < models.length; i++) { const corrected = correctedStewardUvBytes(models[i]), path = resolve(plan.path, names[i]);await output.write(names[i], corrected.bytes);const stats = await validateStewardGlb(path);files.push({ source: paths[i], sourceSha256: models[i].sha256, path, changedVertices: corrected.changedVertices, ...stats }); }
    for (const license of sources.licenses) await output.write(license.name, license.bytes);
    const report = { roleId: 'house-steward', provenanceScope: 'Raw archive members verified independently; existing derived inputs are byte-identity checked against their prior structural reports. This correction does not recreate their raw-to-derived processing chain.',
      cause: 'glTF flipY=false atlas row-origin mismatch: old head sampled eye tile and old hands sampled hair tile; source factors/COLOR_0 are white, no KHR UV transforms',
      correction: 'Only material1 TEXCOORD_0 V shifts exactly +/-0.5; source UVs/maps/colors/normal maps and all topology/bind/animation data remain unchanged. No tint or lighting changes.',
      rawSourceProof: { archives: sources.proof.archives, rawMembers: sources.proof.rawFilesByteIdenticalToFrozenArchiveMembers, consumed: [...sources.proof.readQualified.consumed.values()] }, files, visualReviewPassed: false };
    await output.write('material-provenance.json', JSON.stringify(report, null, 2));for (const model of models) assert.equal(digest(await readFile(model.path)), model.sha256);return report;
  } finally { await output.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const operation = process.argv[2] === '--correct-uv' ? prepareStewardUvCorrection(process.argv[3], process.argv[4]) : process.argv[2] === '--lod' ? prepareStewardLod(process.argv[3], process.argv[4], process.argv[5], process.argv[6]) : prepareSteward(process.argv[2], process.argv[3]);
  operation.then(report => console.log(JSON.stringify(report.files ? { outputDirectory: report.outputDirectory, files: report.files.map(({ variant, path, triangles, drawCalls, joints, clipDurationSeconds, questTriangleBudgetPassed }) => ({ variant, path, triangles, drawCalls, joints, clipDurationSeconds, questTriangleBudgetPassed })) } : { path: report.path, triangles: report.stats.triangles, protectedFloor: report.protectedHeadAndHandsTriangleFloor, maximumSampledPoseErrorMetres: report.deformationError.maximumSampledSurfaceDistanceMetres }, null, 2))).catch(error => { console.error(error.stack ?? error.message);process.exitCode = 1; });
}
