import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { AnimationClip, AnimationMixer, Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, LoopRepeat, Matrix4, Mesh, MeshStandardMaterial,
  QuaternionKeyframeTrack, VectorKeyframeTrack, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CODEX_OWNER_MOTIONS } from '../../../../../shared/legacy/aethelgard/characters/crowd-binding';
import { EALDHOLT_VILLAGE_POPULATION as POP, type PopulationArchetype } from '../../../../../shared/legacy/aethelgard/characters/village-population';
import { selectVillagePresence, type PresenceRequest, type PresenceViewer } from '../../../../../shared/legacy/aethelgard/characters/village-presence';
import { createEaldholtResidentActors } from '../resident-actors';
import {
  bindCrowdTemplate, crowdAttachedPropBounds, createCrowdAssetCache, createCrowdPresenter, createDefaultCrowdLoader, crowdClipEnvelope, disposeCrowdGltf, prepareCrowdLibrary,
  type CrowdActorsLike, type CrowdFrame, type CrowdGltf, type CrowdLoaderPort, type CrowdOwnerFrame, type CrowdResidentFrameState,
} from './crowd-residents';

// Published crowd files (canonical desktop copy), parsed in Node with their WebP atlas removed (no image decoder here).
const ROOT = new URL('../../../../public/assets/legacy/environment/aethelgard/characters/', import.meta.url);
const INDEX = new URL('crowd-v1/residents/index.json', ROOT);
const published = existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, 'utf8')).residents as { residentId: string; archetype: PopulationArchetype }[]) : [];

function strippedGlb(file: URL): ArrayBuffer {
  const b = readFileSync(file), n = b.readUInt32LE(12), g = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
  delete g.images; delete g.textures; delete g.samplers; delete g.extensionsUsed; delete g.extensionsRequired;
  for (const m of g.materials ?? []) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  let json = Buffer.from(JSON.stringify(g)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = b.subarray(20 + n), out = Buffer.alloc(20 + json.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20); bin.copy(out, 20 + json.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
function diskPort() {
  const loader = new GLTFLoader(), counts = { loads: 0, releases: 0, json: 0 };
  const port: CrowdLoaderPort = {
    async loadGltf(url) { counts.loads++; return loader.parseAsync(strippedGlb(new URL(url)), ''); },
    releaseGltf(_url, gltf) { counts.releases++; disposeCrowdGltf(gltf); },
    async loadJson(url) { counts.json++; return JSON.parse(readFileSync(new URL(url), 'utf8')); },
  };
  return { port, counts };
}
const onePerArchetype = () => { const seen = new Set<string>(); return published.filter(r => !seen.has(r.archetype) && seen.add(r.archetype)); };

/** Skinned bounds of one clip on one resident at every 30th of a second (the reference the envelope must contain). */
function sampledSkinBounds(scene: Object3D, clip: AnimationClip): Box3 {
  const rig = scene.clone(true), mixer = new AnimationMixer(rig), action = mixer.clipAction(clip), out = new Box3(), box = new Box3();
  const meshes: SkinnedMesh[] = []; rig.traverse(n => { if (n instanceof SkinnedMesh) meshes.push(n); });
  // clone(true) keeps the source skeleton: rebind each clone to its own bones (SkeletonUtils-equivalent for this test)
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones.map(b => rig.getObjectByName(b.name) as Bone);
    mesh.bind(new Skeleton(bones, mesh.skeleton.boneInverses.map(m => m.clone())), mesh.bindMatrix.clone());
  }
  action.setLoop(LoopRepeat, Infinity).play();
  for (let t = 0; t <= clip.duration + 1e-9; t += 1 / 30) {
    action.time = Math.min(t, clip.duration); mixer.update(0); rig.updateMatrixWorld(true);
    for (const mesh of meshes) { mesh.skeleton.update(); mesh.computeBoundingBox(); box.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld); out.union(box); }
  }
  return out;
}

test('published crowd residents bind to their archetype libraries; envelopes contain every sampled skinned pose', { skip: !published.length && 'crowd-v1 not published' }, async () => {
  const { port } = diskPort();
  for (const r of onePerArchetype()) {
    const meta = JSON.parse(readFileSync(new URL(`crowd-v1/residents/${r.residentId}.json`, ROOT), 'utf8'));
    const resident = await port.loadGltf(new URL(`crowd-v1/residents/${r.residentId}.glb`, ROOT).href);
    const library = prepareCrowdLibrary(await port.loadGltf(new URL(`crowd-v1/clips/${meta.clipLibrary}`, ROOT).href));
    const bound = bindCrowdTemplate(resident, library);
    assert.ok(bound.restDifference.metres <= 0.002 && bound.restDifference.radians <= 0.5 * Math.PI / 180, `${r.residentId} shares the archetype skeleton`);
    assert.ok(bound.triangles > 1000 && bound.triangles <= 4500 && bound.drawsPerActor <= 2);
    for (const name of [meta.motion.idle, meta.motion.walk, meta.motion.talk, ...meta.motion.roleClips.slice(0, 2)]) {
      const env = crowdClipEnvelope(bound, name), sampled = sampledSkinBounds(resident.scene, library.clip(name));
      for (let a = 0; a < 3; a++) {
        assert.ok(env.min[a] <= sampled.min.getComponent(a) + 1e-4 && env.max[a] >= sampled.max.getComponent(a) - 1e-4, `${r.residentId} ${name} axis ${a}`);
        // conservative but not absurd: within 0.6 m of the sampled extent on every side
        assert.ok(sampled.min.getComponent(a) - env.min[a] < 0.6 && env.max[a] - sampled.max.getComponent(a) < 0.6, `${r.residentId} ${name} tightness`);
      }
    }
    disposeCrowdGltf(resident); disposeCrowdGltf(library.gltf);
  }
});

test('Codex\'s actor owner accepts the shared-library template unchanged and its measured box lies inside the envelope', { skip: !published.length && 'crowd-v1 not published' }, async () => {
  const { port } = diskPort();
  const r = published.find(x => x.archetype === 'adult-male') ?? published[0];
  const meta = JSON.parse(readFileSync(new URL(`crowd-v1/residents/${r.residentId}.json`, ROOT), 'utf8'));
  const resident = await port.loadGltf(new URL(`crowd-v1/residents/${r.residentId}.glb`, ROOT).href);
  const library = prepareCrowdLibrary(await port.loadGltf(new URL(`crowd-v1/clips/${meta.clipLibrary}`, ROOT).href));
  const bound = bindCrowdTemplate(resident, library);
  const actors = createEaldholtResidentActors(bound.template, [{ residentId: r.residentId, position: [0, 0, 0], yawRadians: 0, scale: 1 }],
    { clips: { idle: library.clip(meta.motion.idle), walk: library.clip(meta.motion.walk) } });
  try {
    assert.equal(actors.metrics.actors, 1);
    const env = [crowdClipEnvelope(bound, meta.motion.idle), crowdClipEnvelope(bound, meta.motion.walk)];
    const union = new Box3(new Vector3(...env[0].min), new Vector3(...env[0].max)).union(new Box3(new Vector3(...env[1].min), new Vector3(...env[1].max)));
    // the owner pads its sampled box analytically; the joint envelope must still cover the skinned extremes it sampled
    const frame = { clockSeconds: 0, paused: false, reducedMotion: false, residents: [{ residentId: r.residentId, motion: 'walk' as const }] };
    for (let i = 0; i < 40; i++) { frame.clockSeconds = i / 30; actors.update(1 / 30, frame); }
    const model = actors.actors[0].model, skinned: SkinnedMesh[] = []; model.traverse(n => { if (n instanceof SkinnedMesh) skinned.push(n); });
    model.updateMatrixWorld(true); skinned[0].computeBoundingBox();
    const now = skinned[0].boundingBox!.clone().applyMatrix4(skinned[0].matrixWorld);
    assert.ok(union.containsBox(now), 'a live walking pose lies inside the envelope');
    assert.ok(actors.metrics.envelopeSamples > 100, 'the unpatched owner measures every key and midpoint (setup cost the envelopes remove)');
  } finally { actors.dispose(); disposeCrowdGltf(resident); disposeCrowdGltf(library.gltf); }
});

// ------------------------------------------------------------------ synthetic fixtures

function rig(names: readonly string[], offset = 0): Group {
  const scene = new Group(), armature = new Group(); armature.name = 'Rig'; scene.add(armature);
  let parent: Object3D = armature;
  for (const [i, name] of names.entries()) { const b = new Bone(); b.name = name; b.position.y = i ? 0.3 : 0; if (name.startsWith('face_')) b.position.z = 0.05 + offset; parent.add(b); if (!name.startsWith('face_')) parent = b; }
  return scene;
}
const JOINTS = ['root', 'hips', 'spine_01', 'spine_02', 'spine_03', 'neck', 'head', 'face_jaw', 'face_eye_l', 'face_eye_r', 'face_lid_upper_l', 'face_lid_upper_r',
  'face_lid_lower_l', 'face_lid_lower_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'clavicle_l', 'clavicle_r'];
function syntheticLibrary(extraTrack?: string): CrowdGltf {
  const scene = rig(JOINTS);
  const q = (deg: number) => { const r = deg * Math.PI / 360; return [Math.sin(r), 0, 0, Math.cos(r)]; };
  const clip = (name: string, deg: number) => new AnimationClip(name, 1, [
    new QuaternionKeyframeTrack('spine_02.quaternion', [0, 0.5, 1], [...q(0), ...q(deg), ...q(0)]),
    ...(extraTrack ? [new QuaternionKeyframeTrack(`${extraTrack}.quaternion`, [0, 1], [...q(0), ...q(5)])] : []),
  ]);
  return { scene, animations: ['idle', 'walk', 'talk', 'sit', 'sit_down', 'stand_up', 'walk_start', 'walk_stop', 'work_hoe', 'work_hoe_enter', 'work_hoe_exit', 'carry_sack_walk']
    .map((n, i) => clip(n, 10 + i * 3)) };
}
function syntheticResident(options: { morph?: boolean; restShift?: number; faceOffset?: number } = {}) {
  const scene = rig(JOINTS, options.faceOffset ?? 0.004);
  const hips = scene.getObjectByName('hips')!; hips.position.x += options.restShift ?? 0;
  scene.updateMatrixWorld(true);
  const bones: Bone[] = []; scene.traverse(n => { if (n instanceof Bone) bones.push(n); });
  const head = bones.findIndex(b => b.name === 'head'), spine = bones.findIndex(b => b.name === 'spine_02');
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-0.2, 0.3, 0, 0.2, 0.3, 0, 0, 1.75, 0.1, 0.3, 1.0, 0.25], 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, head, 0, 0, 0, spine, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  if (options.morph) g.morphAttributes.position = [new Float32BufferAttribute(new Array(12).fill(0.01), 3)];
  const texture = new Texture(), material = new MeshStandardMaterial({ map: texture });
  const mesh = new SkinnedMesh(g, material); mesh.name = 'Crowd'; scene.getObjectByName('Rig')!.add(mesh);
  if (options.morph) mesh.updateMorphTargets();
  mesh.bind(new Skeleton(bones), new Matrix4());
  const disposals = { count: 0 };
  for (const r of [g, material, texture]) r.addEventListener('dispose', () => disposals.count++);
  return { gltf: { scene, animations: [] } as CrowdGltf, disposals };
}

test('binding refuses morphs, face-joint or root tracks, unknown nodes and a different skeleton', () => {
  const lib = prepareCrowdLibrary(syntheticLibrary());
  const ok = bindCrowdTemplate(syntheticResident().gltf, lib);
  assert.equal(ok.template.animations, lib.gltf.animations, 'clips belong to the template: the owner qualifies them unchanged');
  assert.ok(ok.restDifference.metres < 1e-9);
  const face = ok.library.joints.indexOf('face_jaw');
  assert.ok(Math.abs(ok.restOffset[face] - 0.004) < 1e-6, 'face joints may sit on each resident\'s own head; the offset widens the envelope');
  assert.throws(() => bindCrowdTemplate(syntheticResident({ morph: true }).gltf, lib), /morph/);
  assert.throws(() => bindCrowdTemplate(syntheticResident({ restShift: 0.01 }).gltf, lib), /differs from its archetype skeleton/);
  assert.throws(() => bindCrowdTemplate(syntheticResident().gltf, prepareCrowdLibrary(syntheticLibrary('face_jaw'))), /body joints only/);
  assert.throws(() => bindCrowdTemplate(syntheticResident().gltf, prepareCrowdLibrary(syntheticLibrary('root'))), /body joints only/);
  assert.throws(() => bindCrowdTemplate(syntheticResident().gltf, prepareCrowdLibrary(syntheticLibrary('tail_01'))), /lacks or repeats/);
});

test('asset cache: one load per file, shared references, release while loading, full disposal', async () => {
  const released: string[] = []; let loads = 0; const pending: (() => void)[] = [];
  const port: CrowdLoaderPort = {
    loadGltf: url => new Promise(resolve => { loads++; pending.push(() => resolve({ scene: new Group(), animations: [] })); void url; }),
    releaseGltf: url => { released.push(url); }, loadJson: async () => ({}),
  };
  const cache = createCrowdAssetCache(port);
  const a1 = cache.acquire('a'), a2 = cache.acquire('a'), b = cache.acquire('b');
  assert.equal(loads, 2);
  cache.release('b');                       // released before it arrives: handed back as soon as it loads
  pending.splice(0).forEach(f => f());
  assert.equal(await a1, await a2);
  await assert.rejects(b, /released while loading/);
  assert.deepEqual(released, ['b']);
  cache.release('a'); assert.equal(cache.stats.live, 1, 'one reference left');
  cache.release('a'); assert.deepEqual(released, ['b', 'a']); assert.equal(cache.stats.live, 0);
  void cache.acquire('c'); pending.splice(0).forEach(f => f()); await Promise.resolve(); await Promise.resolve();
  cache.dispose(); assert.deepEqual(released, ['b', 'a', 'c'], 'dispose releases whatever is still held');
  await assert.rejects(cache.acquire('d'), /disposed/);
});

// ------------------------------------------------------------------ presenter with a recording owner

const QUEST: PresenceViewer = { platform: 'quest', position: [0, 1.6, 0], forward: [0, -1], halfFovDegrees: 52, pixelsPerDegree: 25 };
const crowdIds = POP.residents.filter(r => r.appearance.kind === 'crowd').map(r => r.id);
function at(id: string, bearing: number, distance: number, extra: Partial<PresenceRequest> = {}): PresenceRequest {
  const a = bearing * Math.PI / 180;
  return { residentId: id, tier: 'persistent', position: [Math.sin(a) * distance, 0, -Math.cos(a) * distance], heightMetres: 1.7,
    presentable: true, moving: false, interaction: 'none', current: null, ...extra };
}
function syntheticPort(archetypeOf: (id: string) => PopulationArchetype) {
  const counts = { loads: 0, releases: 0, disposals: 0 };
  const port: CrowdLoaderPort = {
    async loadGltf(url) {
      counts.loads++;
      if (url.includes('/clips/')) return syntheticLibrary();
      const made = syntheticResident(); made.gltf.scene.userData.disposals = made.disposals; return made.gltf;
    },
    releaseGltf(_url, gltf) { counts.releases++; disposeCrowdGltf(gltf); counts.disposals += (gltf.scene.userData.disposals as { count: number } | undefined)?.count ?? 0; },
    async loadJson(url) {
      const id = url.slice(url.lastIndexOf('/') + 1, -5), archetype = archetypeOf(id);
      return { residentId: id, archetype, clipLibrary: `crowd-clips-${archetype}-v1.glb`, placementScale: 1.02, envelopeMarginMetres: 0.25,
        faceTier: 'face-joints-only', faceCalibration: { upperLidClosed: 0.48, lowerLidClosed: -0.15, jawOpen: 0.2 },
        motion: { idle: 'idle', walk: 'walk', talk: 'talk', rate: 1.04, roleClips: ['work_hoe', 'carry_sack_walk'] }, props: [],
        measured: { triangles: 3480, materials: 1, meshes: 1, joints: 22, morphTargets: 0, clips: 0, fileBytes: 240000 } };
    },
  };
  return { port, counts };
}
type Call = { delta: number; frame: CrowdOwnerFrame; interval: number | null | undefined; motion: string };
function recordingOwner() {
  const sets: { id: string; calls: Call[]; disposed: boolean; options: { clips: Record<string, AnimationClip>; envelopes?: Record<string, unknown> }; scale?: number }[] = [];
  const createActors = (template: { scene: Object3D }, placements: readonly { residentId: string; scale?: number }[], options: { clips: Record<string, AnimationClip> & { idle: AnimationClip }; envelopes?: Record<string, unknown> }): CrowdActorsLike => {
    const record = { id: placements[0].residentId, calls: [] as Call[], disposed: false, options, scale: placements[0].scale };
    sets.push(record);
    const object = new Group(), model = template.scene.clone(true); object.add(model);
    return { object, actors: [{ residentId: record.id, model, activeMotion: 'idle' }], bounds: new Box3(),
      metrics: { setupMilliseconds: 1, envelopeSamples: Object.keys(options.clips).length * 9 },
      get disposed() { return record.disposed; },
      update(delta, frame) { const s = frame.residents[0]; record.calls.push({ delta, frame, interval: s.animationUpdateIntervalSeconds, motion: s.motion }); },
      dispose() { record.disposed = true; object.removeFromParent(); } };
  };
  return { sets, createActors };
}
const archetypeOf = (id: string) => POP.residents.find(r => r.id === id)!.appearance.archetype;

test('presenter: lazy loads, setup spread over frames, presence modes as owner cadence, hidden residents skipped', async () => {
  const { port, counts } = syntheticPort(archetypeOf), owner = recordingOwner(), parent = new Group();
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent, loader: port, createActors: owner.createActors, maxSetupsPerFrame: 2,
    setupBudgetMilliseconds: 1e6, prefetchSets: false });
  const ids = crowdIds.slice(0, 14);
  const requests = ids.map((id, i) => at(id, -45 + i * 7, 7 + i * 1.2));
  const sel = selectVillagePresence(QUEST, [...requests, at(crowdIds[20], 180, 9), at(crowdIds[21], 0, 90)]);
  presenter.sync(sel);
  assert.equal(presenter.metrics.loading, 15, 'drawn residents plus the one kept loaded behind the viewer; the far one is not loaded');
  await presenter.settled();
  assert.equal(presenter.metrics.ready, 15);
  assert.equal(presenter.metrics.libraryLoads, new Set([...ids, crowdIds[20]].map(archetypeOf)).size, 'one library load per archetype');
  const states = new Map<string, CrowdResidentFrameState>(ids.map((id, i) => [id, { residentId: id, motion: 'idle', position: requests[i].position, yawRadians: 0 }]));
  const frame = (t: number): CrowdFrame => ({ clockSeconds: t, paused: false, reducedMotion: false, residents: states });
  presenter.update(1 / 72, frame(1));
  assert.equal(owner.sets.length, 2, 'two setups per frame at most');
  for (let f = 2; f < 12; f++) presenter.update(1 / 72, frame(1 + f / 72));
  assert.equal(owner.sets.length, sel.drawn.length, 'one actor set per drawn resident, none for the hidden one');
  assert.ok(owner.sets.every(s => Math.abs((s.scale ?? 0) - 1.02) < 1e-9), 'placement scale from the resident manifest');
  assert.ok(owner.sets.every(s => s.options.envelopes && Object.keys(s.options.envelopes).length === Object.keys(s.options.clips).length), 'an envelope for every clip');
  assert.deepEqual(Object.keys(owner.sets[0].options.clips).sort(), ['idle', 'talk', 'walk'], 'only motions the current owner accepts, seated clips only when needed');
  for (const s of owner.sets) s.calls.length = 0;
  for (let f = 0; f < 72; f++) presenter.update(1 / 72, frame(2 + f / 72));
  for (const s of owner.sets) {
    const d = sel.decisions[s.id];
    const zeros = s.calls.filter(c => c.interval === 0).length, nulls = s.calls.filter(c => c.interval === null).length;
    if (d.mode === 'animated') assert.equal(zeros, 72, `${s.id} animated every frame`);
    if (d.mode === 'low-rate') assert.ok(zeros >= 14 && zeros <= 16 && nulls === 72 - zeros, `${s.id} low-rate ${zeros}`);
    if (d.mode === 'posed') assert.equal(nulls, 72);
    assert.ok(s.calls.every(c => Math.abs(c.delta - 1.04 / 72) < 1e-9), 'the resident\'s playback rate scales the delta');
  }
  const m = presenter.metrics;
  assert.equal(m.drawn, sel.drawn.length);
  assert.equal(m.trianglesDrawn, sel.drawn.length * 2, 'synthetic residents have two triangles each');
  assert.equal(parent.children.length, sel.drawn.length);
  presenter.dispose();
  assert.equal(counts.releases, counts.loads, 'every loaded file is handed back');
  assert.ok(owner.sets.every(s => s.disposed));
  assert.equal(parent.children.length, 0);
});

test('presenter: role loops, unpresentable work never idles, swaps and unloading release everything', async () => {
  const { port, counts } = syntheticPort(archetypeOf), owner = recordingOwner(), parent = new Group();
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent, loader: port, createActors: owner.createActors,
    ownerMotions: CODEX_OWNER_MOTIONS.patched, maxSetupsPerFrame: 4, setupBudgetMilliseconds: 1e6 });
  const id = crowdIds[0], other = crowdIds[1];
  // the other resident stands in view but outside the near ring: presence does not guarantee it
  const reqs = [at(id, 0, 4), at(other, 10, 9)];
  let sel = selectVillagePresence(QUEST, reqs);
  presenter.sync(sel, new Map([[id, { roleClip: 'work_hoe' }]]));
  await presenter.settled();
  const states = new Map<string, CrowdResidentFrameState>([[id, { residentId: id, motion: 'work', position: [0, 0, -4], yawRadians: 0 }],
    [other, { residentId: other, motion: 'work', position: [1.6, 0, -8.9], yawRadians: 0 }]]);
  presenter.update(1 / 60, { clockSeconds: 1, paused: false, reducedMotion: false, residents: states });
  const first = owner.sets.find(s => s.id === id)!;
  assert.equal(first.options.clips.work.name, 'work_hoe');
  assert.equal(first.options.clips.workEnter.name, 'work_hoe_enter');
  assert.equal(first.calls[first.calls.length - 1].motion, 'work');
  const second = owner.sets.find(s => s.id === other)!;
  assert.equal(second.calls.length, 0, 'work without a role loop is not handed to the owner (it would idle)');
  assert.equal(presenter.actorsFor(other)!.object.visible, false);
  assert.equal(presenter.metrics.unpresentableFrames, 1);
  // a carry walk replaces walk: a new clip set, built before the old one is disposed
  presenter.sync(sel, new Map([[id, { roleClip: 'carry_sack_walk' }]]));
  presenter.update(1 / 60, { clockSeconds: 1.1, paused: false, reducedMotion: false, residents: states });
  const swapped = owner.sets.filter(s => s.id === id);
  assert.equal(swapped.length, 2);
  assert.equal(swapped[1].options.clips.walk.name, 'carry_sack_walk');
  assert.equal(swapped[1].options.clips.start, undefined, 'carry walks switch at matching phase, without start or stop');
  assert.ok(swapped[0].disposed && !swapped[1].disposed);
  // walking out of range: the actor set and the resident file are released, the shared library stays
  sel = selectVillagePresence(QUEST, [at(id, 0, 120), at(other, 10, 5)]);
  presenter.sync(sel);
  assert.ok(swapped[1].disposed);
  assert.equal(presenter.actorsFor(id), null);
  assert.equal(presenter.metrics.assets.live, 2 + new Set([id, other].map(archetypeOf)).size - 1, 'the other resident and the libraries remain');
  presenter.dispose();
  assert.equal(counts.releases, counts.loads);
  assert.ok(counts.disposals > 0, 'resident geometry, material and texture disposed');
});

test('presenter with Codex\'s owner and published files: a Quest view of up to 15 residents', { skip: !published.length && 'crowd-v1 not published' }, async () => {
  const { port, counts } = diskPort(), parent = new Group();
  const errors: unknown[] = [];
  const presenter = createCrowdPresenter({ root: ROOT.href, parent, loader: port, createActors: createEaldholtResidentActors,
    maxSetupsPerFrame: 15, envelopes: false, onError: (_id, e) => errors.push(e) });
  const ids = published.slice(0, 15).map(r => r.residentId);
  const reqs = ids.map((id, i) => at(id, -50 + i * 7, 4 + i * 0.8));
  const sel = selectVillagePresence(QUEST, reqs, { ...(await import('../../../../../shared/legacy/aethelgard/characters/village-presence')).VILLAGE_PRESENCE_CAPS.quest, maxDrawn: 15 });
  presenter.sync(sel);
  await presenter.settled();
  const states = new Map<string, CrowdResidentFrameState>(ids.map((id, i) => [id, { residentId: id, motion: i % 3 ? 'idle' : 'walk', position: reqs[i].position, yawRadians: 0 }]));
  presenter.update(1 / 72, { clockSeconds: 0, paused: false, reducedMotion: false, residents: states });
  for (let f = 1; f < 30; f++) presenter.update(1 / 72, { clockSeconds: f / 72, paused: false, reducedMotion: false, residents: states });
  assert.deepEqual(errors, []);
  const m = presenter.metrics;
  assert.equal(m.drawn, sel.drawn.length);
  assert.ok(m.trianglesDrawn <= 15 * 4500 && m.drawCallsDrawn <= 15 * 2, `${m.trianglesDrawn} triangles, ${m.drawCallsDrawn} draws`);
  assert.equal(parent.children.length, sel.drawn.length);
  presenter.dispose();
  assert.equal(counts.releases, counts.loads);
  assert.equal(parent.children.length, 0);
});

// ------------------------------------------------------------------ props, set-up budget, guaranteed residents (motion and runtime fixer, 8 November)

const M = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const PRESENTATION = {
  version: 1, kits: { guard: 'crowd-v1/props/crowd-props-guard-v1.glb', farm: 'crowd-v1/props/crowd-props-farm-v1.glb' },
  rest: [{ prop: 'round-shield', kit: 'guard', node: 'prop_round_shield', bone: 'spine_03', matrix: M(0, 0.1, -0.2) }],
  clips: {
    work_hoe: { held: [{ prop: 'hoe', kit: 'farm', node: 'prop_hoe', bone: 'spine_02', matrix: M(0.1, 0, 0) }],
      placed: [{ prop: 'sawhorse', kit: 'farm', node: 'prop_sawhorse', bone: null, matrix: M(0, 0, 0.5) }], hidesRest: [] },
    carry_sack_walk: { held: [{ prop: 'sack', kit: 'farm', node: 'prop_sack', bone: 'spine_03', matrix: M(0, 0.2, 0) }], placed: [], hidesRest: ['round-shield'] },
  },
};
function syntheticKit(names: readonly string[]): CrowdGltf {
  const scene = new Group();
  for (const name of names) {
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], 3));
    const mesh = new Mesh(g, new MeshStandardMaterial()); mesh.name = name; scene.add(mesh);
  }
  return { scene, animations: [] };
}
function propPort(extra: Record<string, unknown> = {}) {
  const { port, counts } = syntheticPort(archetypeOf), kitLoads: string[] = [];
  const wrapped: CrowdLoaderPort = {
    async loadGltf(url) {
      if (url.includes('/props/')) { counts.loads++; kitLoads.push(url); return syntheticKit(url.includes('guard') ? ['prop_round_shield'] : ['prop_hoe', 'prop_sawhorse', 'prop_sack']); }
      return port.loadGltf(url);
    },
    releaseGltf: (url, gltf) => port.releaseGltf(url, gltf),
    async loadJson(url) { return { ...(await port.loadJson(url) as object), presentation: PRESENTATION, ...extra }; },
  };
  return { port: wrapped, counts, kitLoads };
}
const visibleProps = (actors: CrowdActorsLike) => {
  const out: string[] = [];
  actors.actors[0].model.traverse(n => { if (n.name.startsWith('prop_') && n.visible) out.push(`${n.name}@${n.parent?.name || 'root'}`); });
  return out.sort();
};

test('presenter props: rest props, grips under their bones while their clip plays, placed props, kits released', async () => {
  const { port, counts, kitLoads } = propPort(), owner = recordingOwner(), parent = new Group();
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent, loader: port, createActors: owner.createActors,
    ownerMotions: CODEX_OWNER_MOTIONS.patched, setupBudgetMilliseconds: 1e6 });
  const id = crowdIds[0];
  presenter.sync(selectVillagePresence(QUEST, [at(id, 0, 4)]), new Map([[id, { roleClip: 'work_hoe' }]]));
  await presenter.settled();
  assert.equal(kitLoads.length, 2, 'the presentation\'s two kits load with the resident');
  const state = (motion: CrowdResidentFrameState['motion']): CrowdFrame => ({ clockSeconds: 1, paused: false, reducedMotion: false,
    residents: new Map([[id, { residentId: id, motion, position: [0, 0, -4], yawRadians: 0 }]]) });
  presenter.update(1 / 60, state('idle'));
  const actors = presenter.actorsFor(id)!;
  assert.deepEqual(visibleProps(actors), ['prop_round_shield@spine_03'], 'idle: the worn shield at rest only');
  presenter.update(1 / 60, state('work'));
  assert.deepEqual(visibleProps(actors), ['prop_hoe@spine_02', 'prop_round_shield@spine_03', 'prop_sawhorse@root'], 'work: the hoe in its grip, the workplace prop placed');
  const hoe = actors.actors[0].model.getObjectByName('prop_hoe')!;
  assert.deepEqual(hoe.matrix.toArray().map(v => Math.round(v * 1000) / 1000), M(0.1, 0, 0), 'the grip matrix is the node\'s local matrix');
  presenter.update(1 / 60, state('workEnter'));
  assert.deepEqual(visibleProps(actors), ['prop_round_shield@spine_03', 'prop_sawhorse@root'], 'entering work: the workplace prop is already there');
  const m = presenter.metrics;
  assert.equal(m.propsDrawn, 2); assert.equal(m.propTrianglesDrawn, 2); assert.equal(m.propDrawCallsDrawn, 2);
  // a carry walk replaces walk and hides the worn shield while the sack rides the shoulder
  presenter.sync(selectVillagePresence(QUEST, [at(id, 0, 4)]), new Map([[id, { roleClip: 'carry_sack_walk' }]]));
  presenter.update(1 / 60, state('walk'));
  assert.deepEqual(visibleProps(presenter.actorsFor(id)!), ['prop_sack@spine_03']);
  presenter.dispose();
  assert.equal(counts.releases, counts.loads, 'resident, library and kit files are all handed back');
});

test('presenter set-up budget: drawn residents first, at least one a frame; prefetch only when the measured cost fits', async () => {
  let clock = 0;
  const { port } = syntheticPort(archetypeOf), owner = recordingOwner(), parent = new Group();
  const costly = (template: { scene: Object3D }, placements: readonly { residentId: string; scale?: number }[], options: { clips: Record<string, AnimationClip> & { idle: AnimationClip }; envelopes?: Record<string, unknown> }) => {
    clock += 20; return owner.createActors(template, placements, options);   // every set costs 20 ms on the fake clock
  };
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent, loader: port, createActors: costly, maxSetupsPerFrame: 8,
    setupBudgetMilliseconds: 8, now: () => clock, envelopes: false });
  const drawnIds = crowdIds.slice(0, 3), behind = crowdIds.slice(3, 5);
  const sel = selectVillagePresence(QUEST, [...drawnIds.map((id, i) => at(id, -10 + i * 10, 8 + i)), ...behind.map((id, i) => at(id, 180, 9 + i))]);
  presenter.sync(sel);
  await presenter.settled();
  const frame = (t: number): CrowdFrame => ({ clockSeconds: t, paused: false, reducedMotion: false, residents: new Map() });
  const perFrame: number[] = [];
  for (let f = 0; f < 6; f++) { const before = owner.sets.length; presenter.update(1 / 72, frame(f / 72)); perFrame.push(owner.sets.length - before); }
  assert.deepEqual(perFrame.slice(0, 3), [1, 1, 1], 'a 20 ms set never shares a frame with another under an 8 ms budget');
  assert.deepEqual(owner.sets.slice(0, 3).map(s => s.id).sort(), [...drawnIds].sort(), 'drawn residents first');
  assert.equal(presenter.metrics.prefetchSetups, 0, 'prefetch waits while a set costs more than the budget');
  assert.ok(presenter.metrics.setupFrameMillisecondsMax <= 20 + 1e-9);
  // cheap sets (trusted envelopes): the prefetch ring fills within the budget, several a frame
  clock = 0;
  const cheap = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: syntheticPort(archetypeOf).port,
    createActors: (t, p, o) => { clock += 2; return owner.createActors(t, p, o); }, maxSetupsPerFrame: 8, setupBudgetMilliseconds: 8, now: () => clock, envelopes: false });
  cheap.sync(sel); await cheap.settled();
  cheap.update(1 / 72, frame(0));
  assert.equal(cheap.metrics.actorSets, 4, 'four 2 ms sets fit one 8 ms frame: the three drawn first, then one of the prefetch ring');
  cheap.update(1 / 72, frame(1 / 72));
  assert.equal(cheap.metrics.actorSets, 5);
  assert.equal(cheap.metrics.prefetchSetups, 2);
  assert.equal(cheap.actorsFor(behind[0])!.object.visible, false, 'a prefetched set stays hidden until presence draws it');
  presenter.dispose(); cheap.dispose();
});

test('presenter: unpresentable work is held even for guaranteed residents; sync reports it', async () => {
  const { port } = syntheticPort(archetypeOf), owner = recordingOwner(), parent = new Group();
  // Codex's owner as it is: no work motion, so a role loop is unpresentable
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent, loader: port, createActors: owner.createActors,
    ownerMotions: CODEX_OWNER_MOTIONS.current, setupBudgetMilliseconds: 1e6, maxSetupsPerFrame: 4 });
  const near = crowdIds[0], far = crowdIds[1];
  const sel = selectVillagePresence(QUEST, [at(near, 0, 2.5), at(far, 5, 12)]);
  const activities = new Map([[near, { roleClip: 'work_hoe' }], [far, { roleClip: 'work_hoe' }]]);
  presenter.sync(sel, activities);
  await presenter.settled();
  const report = presenter.sync(sel, activities);
  assert.deepEqual([...report.unpresentable].sort(), [near, far].sort(), 'both residents\' work is reported to the caller');
  const states = new Map<string, CrowdResidentFrameState>([[near, { residentId: near, motion: 'work', position: [0, 0, -2.5], yawRadians: 0 }],
    [far, { residentId: far, motion: 'work', position: [1, 0, -12], yawRadians: 0 }]]);
  presenter.update(1 / 60, { clockSeconds: 1, paused: false, reducedMotion: false, residents: states });
  assert.equal(sel.decisions[near].reason, 'near-in-front');
  assert.equal(presenter.actorsFor(near)!.object.visible, false, 'near visibility guarantee cannot misrepresent unavailable work');
  const nearSet = owner.sets.find(s => s.id === near)!;
  assert.equal(nearSet.calls.length, 0, 'no idle or old action is handed to the owner as work');
  assert.equal(presenter.actorsFor(far)!.object.visible, false, 'not guaranteed: hidden that frame and counted');
  assert.equal(presenter.metrics.fallbackFrames, 0);
  assert.equal(presenter.metrics.unpresentableFrames, 2);
  presenter.dispose();
});

test('published files with Codex\'s owner: props under the right bones, publisher envelopes, the cost estimate holds', { skip: !published.length && 'crowd-v1 not published' }, async () => {
  const { port, counts } = diskPort(), parent = new Group(), errors: unknown[] = [];
  const presenter = createCrowdPresenter({ root: ROOT.href, parent, loader: port, createActors: createEaldholtResidentActors, maxSetupsPerFrame: 4,
    setupBudgetMilliseconds: 1e6, onError: (_id, e) => errors.push(e) });
  const guard = 'ealdholt-gate-ward', farmer = 'ealdholt-east-farmer';
  const sel = selectVillagePresence(QUEST, [at(guard, -10, 5), at(farmer, 10, 6)]);
  presenter.sync(sel, new Map([[guard, { roleClip: 'guard_patrol_walk' }], [farmer, { roleClip: 'carry_sack_walk' }]]));
  await presenter.settled();
  const states = (motion: CrowdResidentFrameState['motion']) => new Map<string, CrowdResidentFrameState>([[guard, { residentId: guard, motion, position: [-0.9, 0, -4.9], yawRadians: 0 }],
    [farmer, { residentId: farmer, motion, position: [1, 0, -5.9], yawRadians: 0 }]]);
  presenter.update(1 / 72, { clockSeconds: 0, paused: false, reducedMotion: false, residents: states('idle') });
  assert.deepEqual(errors, []);
  const props = (id: string) => { const out: string[] = []; presenter.actorsFor(id)!.actors[0].model.traverse(n => { if (n.name.startsWith('prop_') && n.visible) out.push(`${n.name}@${n.parent!.name}`); }); return out.sort(); };
  assert.deepEqual(props(guard), ['prop_round_shield@spine_03'], 'idle: the shield slung on the back');
  assert.deepEqual(props(farmer), ['prop_seed_bag@hips', 'prop_sickle@hips'], 'idle: the seed bag and the sickle at the belt');
  presenter.update(1 / 72, { clockSeconds: 0.1, paused: false, reducedMotion: false, residents: states('walk') });
  assert.deepEqual(props(guard), ['prop_round_shield@spine_03', 'prop_spear@hand_r'], 'patrol: the spear in the right hand');
  assert.deepEqual(props(farmer), ['prop_sack@spine_03', 'prop_seed_bag@hips', 'prop_sickle@hips'], 'carry: the sack on the shoulder');
  assert.equal(presenter.metrics.publishedEnvelopeSetups, 0, 'a raw disk test loader cannot confer publisher trust');
  const m = presenter.metrics;
  const { estimatePresentationCost } = await import('../../../../../shared/legacy/aethelgard/characters/village-presence');
  const est = estimatePresentationCost({ [guard]: 'crowd', [farmer]: 'crowd' });
  assert.ok(m.propTrianglesDrawn <= est.props.trianglesMax && m.propDrawCallsDrawn <= est.props.drawsMax, `${m.propTrianglesDrawn} prop triangles, ${m.propDrawCallsDrawn} draws`);
  assert.ok(m.trianglesDrawn + m.propTrianglesDrawn <= est.trianglesMax);
  presenter.dispose();
  assert.equal(counts.releases, counts.loads);
});

test('disposeCrowdGltf releases geometry, material, texture and skeleton', () => {
  const { gltf, disposals } = syntheticResident();
  let skeletonDisposed = false;
  gltf.scene.traverse(n => { if (n instanceof SkinnedMesh) { const s = n.skeleton; const d = s.dispose.bind(s); s.dispose = () => { skeletonDisposed = true; d(); }; } });
  disposeCrowdGltf(gltf);
  assert.equal(disposals.count, 3);
  assert.ok(skeletonDisposed);
});

// Runtime integrity and complete prop reach (Codex integration).
const SHA = 'a'.repeat(64);
function tinyGlb(external = false): ArrayBuffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0,
    ...(external ? { images: [{ uri: 'https://example.invalid/unverified.webp' }] } : {}) }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), out = Buffer.alloc(20 + padded.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12); out.writeUInt32LE(0x4e4f534a, 16); padded.copy(out, 20);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

test('verified bytes and JSON reject mismatches before parsing, and external GLB resources cannot bypass verification', async t => {
  let bytes = tinyGlb();
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const loader = createDefaultCrowdLoader();
  await assert.rejects(loader.loadVerifiedGltf!('https://example.invalid/a.glb', SHA), /SHA-256/);
  bytes = tinyGlb(true);
  await assert.rejects(loader.loadVerifiedGltf!('https://example.invalid/a.glb', createHash('sha256').update(new Uint8Array(bytes)).digest('hex')), /self-contained/);
  bytes = new TextEncoder().encode('{"gate":true}').buffer;
  const hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  assert.deepEqual(await loader.loadVerifiedJson!('https://example.invalid/meta.json', hash), { gate: true });
  await assert.rejects(loader.loadVerifiedJson!('https://example.invalid/meta.json', SHA), /SHA-256/);
});

test('verified asset cache binds one identity, rejects unsupported verification, aborts pending work and releases a late result once', async () => {
  let signal: AbortSignal | undefined, resolve!: (g: CrowdGltf) => void, releases = 0;
  const base = syntheticPort(archetypeOf).port;
  const port: CrowdLoaderPort = { ...base, loadVerifiedGltf: async (_url, _hash, s) => {
    signal = s; return new Promise<CrowdGltf>(r => { resolve = r; });
  }, releaseGltf: () => { releases++; } };
  const cache = createCrowdAssetCache(port), promise = cache.acquire('a', SHA);
  assert.equal(cache.verified('a'), false);
  await assert.rejects(cache.acquire('a', 'b'.repeat(64)), /identity changed/);
  cache.release('a'); assert.equal(signal!.aborted, true);
  resolve({ scene: new Group(), animations: [] }); await assert.rejects(promise, /released while loading/);
  cache.dispose(); assert.equal(releases, 1);
  await assert.rejects(createCrowdAssetCache(base).acquire('missing', SHA), /cannot verify/);
});

test('publisher boxes are trusted only after resident, library and metadata verify against the supplied registry', async () => {
  const id = crowdIds[0], archetype = archetypeOf(id);
  const paths = [`crowd-v1/residents/${id}.json`, `crowd-v1/residents/${id}.glb`, `crowd-v1/clips/crowd-clips-${archetype}-v1.glb`];
  const selection = selectVillagePresence(QUEST, [at(id, 0, 3)]);
  for (const mode of ['absent', 'partial', 'verified', 'mismatch'] as const) {
    const { port: base } = syntheticPort(archetypeOf), owner = recordingOwner(), errors: unknown[] = [], trusted: boolean[] = [];
    const metadata = async (url: string) => ({ ...(await base.loadJson(url) as object),
      envelopes: Object.fromEntries(['idle', 'walk', 'talk'].map(n => [n, { min: [-99, -99, -99], max: [99, 99, 99] }])), envelopeGate: { pass: true } });
    const port: CrowdLoaderPort = { ...base, loadJson: metadata,
      loadVerifiedGltf: async (url) => { if (mode === 'mismatch') throw Error('SHA-256 mismatch'); return base.loadGltf(url); },
      loadVerifiedJson: async url => metadata(url) };
    const registry = mode === 'absent' ? undefined : Object.fromEntries((mode === 'partial' ? paths.slice(0, 2) : paths).map(p => [p, SHA]));
    const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, integritySha256: registry,
      createActors: (template, placements, options) => { trusted.push(options.trustEnvelopes === true); return owner.createActors(template, placements, options); },
      faceDistanceMetres: 0, onError: (_id, e) => errors.push(e) });
    presenter.sync(selection); await presenter.settled();
    presenter.update(1 / 60, { clockSeconds: 0, paused: false, reducedMotion: false, residents: new Map() });
    if (mode === 'mismatch') { assert.equal(owner.sets.length, 0); assert.equal(errors.length, 1); }
    else {
      assert.deepEqual(trusted, [mode === 'verified']);
      const idle = owner.sets[0].options.envelopes!.idle as { min: number[] };
      assert.equal(idle.min[0] === -99, mode === 'verified', 'unverified publisher boxes are ignored completely');
      assert.equal(presenter.metrics.publishedEnvelopeSetups, mode === 'verified' ? 1 : 0);
    }
    presenter.dispose();
  }
});

test('complete prop bounds cover held reach through scale/translation keys, placed equipment and source-frame placement', async () => {
  const model = new Group(), hand = new Bone(); hand.name = 'hand'; hand.position.y = 1; model.add(hand);
  const prop = syntheticKit(['prop_test']).scene.children[0]; prop.matrixAutoUpdate = false; prop.matrix.makeTranslation(2, 0, 0);
  const clip = new AnimationClip('reach', 1, [new VectorKeyframeTrack('hand.position', [0, 1], [0, 1, 0, 0, 3, 0]),
    new VectorKeyframeTrack('hand.scale', [0, 1], [1, 1, 1, 2, 2, 2])]);
  const held = crowdAttachedPropBounds(model, prop, hand, [clip]);
  assert.ok(held.max.x >= 7.2 && held.min.x <= -7.2, 'two-metre tool plus moving/scaling hand; arbitrary rotation/fades included');
  const placed = crowdAttachedPropBounds(model, prop, model, [clip]);
  assert.equal(placed.min.x, 2); assert.ok(placed.max.x > 2.09 && placed.max.x < 2.11);
  const owner = recordingOwner(), { port } = propPort(), id = crowdIds[0], presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port,
    createActors: owner.createActors, ownerMotions: CODEX_OWNER_MOTIONS.patched, faceDistanceMetres: 0 });
  presenter.sync(selectVillagePresence(QUEST, [at(id, 0, 3)]), new Map([[id, { roleClip: 'work_hoe' }]])); await presenter.settled();
  presenter.update(1 / 60, { clockSeconds: 0, paused: false, reducedMotion: false,
    residents: new Map([[id, { residentId: id, motion: 'work', position: [10, 2, 20], yawRadians: Math.PI / 2 }]]) });
  const first = presenter.completeBoundsFor(id)!;
  assert.ok(first.min.x < 10 && first.max.x > 10 && first.min.z < 20 && first.max.z > 20, 'complete props are transformed once into presenter source frame');
  assert.equal(presenter.completeBoundsFor(id), first, 'cached per-resident box'); assert.ok(presenter.completeBounds.containsBox(first));
  presenter.dispose(); assert.ok(presenter.completeBounds.isEmpty()); assert.equal(presenter.completeBoundsFor(id), null);
});

test('presenter global abort cancels verified metadata and creates no actor set', async () => {
  const controller = new AbortController(), base = syntheticPort(archetypeOf).port, id = crowdIds[0];
  let seen: AbortSignal | undefined;
  const port: CrowdLoaderPort = { ...base, loadVerifiedJson: (_url, _hash, signal) => new Promise((_resolve, reject) => {
    seen = signal; signal!.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }) };
  const owner = recordingOwner(), presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, createActors: owner.createActors,
    integritySha256: { [`crowd-v1/residents/${id}.json`]: SHA }, signal: controller.signal });
  presenter.sync(selectVillagePresence(QUEST, [at(id, 0, 3)])); controller.abort(); await presenter.settled();
  assert.equal(seen!.aborted, true); assert.equal(presenter.disposed, true); assert.equal(owner.sets.length, 0);
});

test('desktop verified loader parses its hashed bytes directly without a second URL load', async t => {
  const bytes = tinyGlb(), hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex'); let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response(bytes); });
  const loader = createDefaultCrowdLoader(), loaded = await loader.loadVerifiedGltf!('https://example.invalid/a.glb', hash);
  assert.ok(loaded.scene instanceof Group); assert.equal(fetches, 1);
  loader.releaseGltf('https://example.invalid/a.glb', loaded);
});

test('near guaranteed resident holds missing role after valid work, then resumes only the matching role', async () => {
  const { port } = syntheticPort(archetypeOf), owner = recordingOwner(), id = crowdIds[0];
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, createActors: owner.createActors,
    ownerMotions: CODEX_OWNER_MOTIONS.patched, faceDistanceMetres: 0 });
  const selection = selectVillagePresence(QUEST, [at(id, 0, 2.5)]);
  const frame: CrowdFrame = { clockSeconds: 1, paused: false, reducedMotion: false,
    residents: new Map([[id, { residentId: id, motion: 'work', position: [0, 0, -2.5], yawRadians: 0 }]]) };
  presenter.sync(selection, new Map([[id, { roleClip: 'work_hoe' }]])); await presenter.settled(); presenter.update(1 / 60, frame);
  assert.equal(presenter.actorsFor(id)!.object.visible, true); assert.equal(owner.sets[0].calls[owner.sets[0].calls.length - 1].motion, 'work');
  const before = owner.sets.reduce((sum, set) => sum + set.calls.length, 0);
  const report = presenter.sync(selection, new Map([[id, { roleClip: 'work_nonexistent' }]]));
  assert.deepEqual(report.unpresentable, [id]); assert.equal(presenter.actorsFor(id)!.object.visible, false, 'sync hides the old role immediately');
  presenter.update(1 / 60, frame);
  assert.equal(presenter.actorsFor(id)!.object.visible, false); assert.equal(owner.sets.reduce((sum, set) => sum + set.calls.length, 0), before);
  assert.equal(presenter.metrics.fallbackFrames, 0); assert.equal(presenter.metrics.unpresentableFrames, 1);
  presenter.sync(selection, new Map([[id, { roleClip: 'work_hoe' }]])); presenter.update(1 / 60, frame);
  assert.equal(presenter.actorsFor(id)!.object.visible, true);
  const resumed = owner.sets[owner.sets.length - 1]; assert.equal(resumed.calls[resumed.calls.length - 1].motion, 'work');
  presenter.dispose();
});

test('ordinary non-role missing motion keeps the near visibility fallback', async () => {
  const { port } = syntheticPort(archetypeOf), owner = recordingOwner(), id = crowdIds[0];
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, createActors: owner.createActors,
    ownerMotions: CODEX_OWNER_MOTIONS.current, faceDistanceMetres: 0 });
  presenter.sync(selectVillagePresence(QUEST, [at(id, 0, 2.5)])); await presenter.settled();
  presenter.update(1 / 60, { clockSeconds: 1, paused: false, reducedMotion: false,
    residents: new Map([[id, { residentId: id, motion: 'sitDown', position: [0, 0, -2.5], yawRadians: 0 }]]) });
  assert.equal(presenter.actorsFor(id)!.object.visible, true); assert.equal(owner.sets[0].calls[owner.sets[0].calls.length - 1].motion, 'idle');
  assert.equal(presenter.metrics.fallbackFrames, 1); assert.equal(presenter.metrics.unpresentableFrames, 0); presenter.dispose();
});

test('constrained neutral journeys hold stale carry plans while bounded setup prepares their exact clips and props',async()=>{
 const {port}=syntheticPort(archetypeOf),owner=recordingOwner(),ids=['ealdholt-swineherd','ealdholt-brewster'];
 const presenter=createCrowdPresenter({root:'file:///crowd/',parent:new Group(),loader:port,createActors:owner.createActors,
  ownerMotions:CODEX_OWNER_MOTIONS.patched,maxSetupsPerFrame:1,setupBudgetMilliseconds:1e6,prefetchSets:false,faceDistanceMetres:0});
 const selection=selectVillagePresence(QUEST,ids.map((id,i)=>at(id,i*2,4)));
 const states=new Map<string,CrowdResidentFrameState>(ids.map((id,i)=>[id,{residentId:id,motion:'walk',position:[i*2,0,-4],yawRadians:0}]));
 try{
  presenter.sync(selection,new Map(ids.map(id=>[id,{roleClip:'carry_sack_walk'}])));await presenter.settled();
  presenter.prepare();presenter.prepare();presenter.update(1/60,{clockSeconds:1,paused:false,reducedMotion:false,residents:states});
  assert.equal(owner.sets.length,2);assert.ok(ids.every(id=>presenter.actorsFor(id)?.object.visible));
  const oldCalls=owner.sets.map(set=>set.calls.length);
  presenter.sync(selection,new Map(ids.map(id=>[id,{}])));
  for(const[id,state]of states)states.set(id,{...state,strictMotionPlan:true,fadeSeconds:0});
  presenter.update(1/60,{clockSeconds:2,paused:false,reducedMotion:false,residents:states});
  assert.equal(owner.sets.length,3,'Only one of the two new plans may prepare in this frame.');
  const blocked=owner.sets.slice(0,2).filter((set,i)=>!set.disposed&&set.calls.length===oldCalls[i]);
  assert.equal(blocked.length,1);assert.equal(presenter.actorsFor(blocked[0].id)!.object.visible,false,'The old carry body cannot enter the neutral-only route.');
  presenter.update(1/60,{clockSeconds:3,paused:false,reducedMotion:false,residents:states});
  assert.equal(owner.sets.length,4);assert.ok(ids.every(id=>presenter.actorsFor(id)?.object.visible));
  for(const set of owner.sets.slice(2)){assert.equal(set.options.clips.walk.name.includes('carry'),false);assert.equal(set.calls[set.calls.length-1]!.frame.residents[0].fadeSeconds,0);}
  assert.equal(presenter.metrics.fallbackFrames,0);
 }finally{presenter.dispose();}
});


test('ready residents prepare in bounded batches without evaluating animation or waiting for a world frame', async () => {
  const { port } = syntheticPort(archetypeOf), owner = recordingOwner();
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port,
    createActors: owner.createActors, maxSetupsPerFrame: 1, setupBudgetMilliseconds: 1e6, prefetchSets: false });
  const ids = crowdIds.slice(0, 3);
  const selection = selectVillagePresence(QUEST, ids.map((id, i) => at(id, i * 2, 6)));
  presenter.sync(selection); await presenter.settled();
  assert.equal(presenter.metrics.actorSets, 0);
  assert.equal(presenter.prepare(), 1); assert.equal(presenter.metrics.actorSets, 1);
  assert.equal(presenter.prepare(), 1); assert.equal(presenter.prepare(), 1);
  assert.equal(presenter.prepare(), 0, 'Completed bodies must not be assembled twice.');
  assert.ok(owner.sets.every(set => set.calls.length === 0), 'Preparation must not evaluate a mixer or advance resident animation.');
  presenter.sync(selection);
  assert.ok(ids.every(id => presenter.actorsFor(id)?.object.visible === false), 'A decision tick must not reveal an unpositioned body.');
  assert.ok(ids.every(id => presenter.completeBoundsFor(id) === null), 'Culling must use the certified feet until an owner frame positions the body.');
  const residents = new Map<string, CrowdResidentFrameState>(ids.map((id, i) => [id, {
    residentId: id, motion: 'idle', position: [i * 2, 0, 6], yawRadians: 0 }]));
  presenter.update(1 / 60, { clockSeconds: 12, paused: false, reducedMotion: false, residents });
  assert.ok(owner.sets.every(set => set.calls.length === 1), 'The next actual presentation frame poses every ready body.');
  presenter.dispose(); assert.equal(presenter.prepare(), 0); assert.ok(owner.sets.every(set => set.disposed));
});

test('cold paused ordinary walk adopts the qualified placement and explicit pose once without advancing animation', async () => {
  const { port } = syntheticPort(archetypeOf), id = crowdIds[0];
  const created: ReturnType<typeof createEaldholtResidentActors>[] = [], walkClips: AnimationClip[] = [];
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, faceDistanceMetres: 0,
    createActors(template, placements, options) { const actors = createEaldholtResidentActors(template, placements, options); created.push(actors); walkClips.push(options.clips.walk!); return actors; } });
  const selection = selectVillagePresence(QUEST, [at(id, 0, 3, { moving: true })]);
  const state = Object.freeze({ residentId: id, motion: 'walk' as const, position: Object.freeze([14, 2, 9] as const), yawRadians: .71, animationTimeSeconds: .375 });
  const frame: CrowdFrame = Object.freeze({ clockSeconds: 720, paused: true, reducedMotion: false, residents: new Map([[id, state]]) });
  try {
    presenter.sync(selection); await presenter.settled(); presenter.prepare();
    const actors = created[0], actor = actors.actors[0], mixerTime = actor.mixer.time;
    assert.equal(actors.object.visible, false); assert.equal(presenter.completeBoundsFor(id), null);
    presenter.update(.5, frame);
    assert.deepEqual(actor.placement.position.toArray(), state.position); assert.equal(actor.placement.rotation.y, state.yawRadians);
    assert.equal(actor.activeMotion, 'walk'); assert.equal(actor.requestedMotion, 'walk');
    const action = actor.mixer.existingAction(walkClips[0])!;
    assert.equal(action.time, state.animationTimeSeconds); assert.equal(actor.mixer.time, mixerTime, 'Paused initialization samples the requested phase with zero mixer delta.');
    assert.equal(actors.object.visible, true); assert.ok(presenter.completeBoundsFor(id)!.min.x > 10, 'Published bounds now follow the qualified route placement instead of the setup origin.');
    const frozenBounds = presenter.completeBoundsFor(id)!.clone();
    presenter.update(.75, { ...frame, residents: new Map([[id, { ...state, position: [99, 3, 99], yawRadians: 2, animationTimeSeconds: .8 }]]) });
    assert.deepEqual(actor.placement.position.toArray(), state.position); assert.equal(actor.placement.rotation.y, state.yawRadians);
    assert.equal(action.time, state.animationTimeSeconds); assert.equal(actor.mixer.time, mixerTime); assert.ok(presenter.completeBoundsFor(id)!.equals(frozenBounds));
    assert.equal(frame.clockSeconds, 720); assert.equal(state.animationTimeSeconds, .375); assert.deepEqual(state.position, [14, 2, 9]);
  } finally { presenter.dispose(); }
});

test('cold paused posed residents evaluate their requested clip once before cadence suspends again', async () => {
  const { port } = syntheticPort(archetypeOf), id = crowdIds[0];
  const created: ReturnType<typeof createEaldholtResidentActors>[] = [], talkClips: AnimationClip[] = [];
  const presenter = createCrowdPresenter({ root: 'file:///crowd/', parent: new Group(), loader: port, faceDistanceMetres: 0,
    createActors(template, placements, options) { const actors = createEaldholtResidentActors(template, placements, options); created.push(actors); talkClips.push(options.clips.talk!); return actors; } });
  const selected = selectVillagePresence(QUEST, [at(id, 0, 3)]), selection = { ...selected, decisions: { ...selected.decisions, [id]: { ...selected.decisions[id], mode: 'posed' as const, updateHz: 0 as const } } };
  const state: CrowdResidentFrameState = { residentId: id, motion: 'talk', position: [14, 2, 9], yawRadians: .71, animationTimeSeconds: .375 };
  const frame: CrowdFrame = { clockSeconds: 720, paused: true, reducedMotion: false, residents: new Map([[id, state]]) };
  try {
    presenter.sync(selection); await presenter.settled(); presenter.prepare();
    presenter.update(.5, frame); const actor = created[0].actors[0];
    assert.equal(actor.activeMotion, 'talk', 'A suspended first cadence cannot expose the setup idle in place of the requested authored pose.');
    assert.deepEqual(actor.placement.position.toArray(), state.position); assert.equal(actor.mixer.existingAction(talkClips[0])!.time, .375);
    assert.equal(presenter.metrics.evaluated, 1); assert.equal(presenter.metrics.suspended, 0);
    presenter.update(.5, frame); assert.equal(presenter.metrics.evaluated, 0); assert.equal(presenter.metrics.suspended, 1);
    assert.equal(actor.mixer.existingAction(talkClips[0])!.time, .375); assert.equal(actor.activeMotion, 'talk');
  } finally { presenter.dispose(); }
});

test('crowd assets use the browser cache; a stale cached copy is fetched once more before refusal (L-07)', async () => {
  const {fetchVerifiedCrowdBytes} = await import('./crowd-residents');
  const good = new TextEncoder().encode('verified crowd bytes'), stale = new TextEncoder().encode('older cached bytes');
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', good)), b => b.toString(16).padStart(2, '0')).join('');
  const modes: (RequestCache | undefined)[] = [];
  const serve = (cached: Uint8Array<ArrayBuffer>, network: Uint8Array<ArrayBuffer>) => (async (_url: unknown, init?: RequestInit) => {
    modes.push(init?.cache); return new Response(init?.cache === 'reload' ? network : cached);
  }) as typeof fetch;
  assert.deepEqual(new Uint8Array(await fetchVerifiedCrowdBytes('/crowd.glb', sha, undefined, serve(good, good))), good);
  assert.deepEqual(modes, ['default'], 'a cached copy that verifies needs no second request');
  modes.length = 0;
  assert.deepEqual(new Uint8Array(await fetchVerifiedCrowdBytes('/crowd.glb', sha, undefined, serve(stale, good))), good);
  assert.deepEqual(modes, ['default', 'reload']);
  modes.length = 0;
  await assert.rejects(fetchVerifiedCrowdBytes('/crowd.glb', sha, undefined, serve(stale, stale)), /SHA-256 does not match/);
  assert.deepEqual(modes, ['default', 'reload']);
});
