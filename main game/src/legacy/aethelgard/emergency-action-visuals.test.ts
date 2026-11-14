import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AnimationMixer, BufferGeometry, Group, Line, Matrix4, Mesh, Points, PointsMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EALDHOLT_POPULATION_ASSET_SHA256 } from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import { createCrowdPresenter, disposeCrowdGltf, type CrowdLoaderPort } from './characters/crowd-residents';
import { createEaldholtResidentActors } from './resident-actors';
import { selectVillagePresence } from '../../../../shared/legacy/aethelgard/characters/village-presence';
import { CODEX_OWNER_MOTIONS } from '../../../../shared/legacy/aethelgard/characters/crowd-binding';
import { createEmergencyActionVisuals, emergencyBucketPose0, emergencyPropSocket, emergencyWorkpieceSocket, type EmergencyActionVisualRecord,
  type EmergencyHeldProp, type EmergencyActionStation } from './emergency-action-visuals';
import type { ResidentAnimationEvent, ResidentAnimationExecutionSnapshot } from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';

function fixture(repair = false) {
  const scene = new Group(), source = new Group(), placement = new Group(), model = new Group(), hand = new Group(), prop = new Group();
  scene.add(source); source.add(placement); placement.add(model); model.add(hand); hand.add(prop); hand.position.y = 1;
  const sourceActor = new Group(); sourceActor.name = 'actual-source-mesh'; source.add(sourceActor);
  const execution: ResidentAnimationExecutionSnapshot = { ownerId: 'resident-a', requestId: 3, requestedMotion: repair ? 'work' : 'walk',
    clipId: repair ? 'work_hammer_bench' : 'carry_bucket_walk', state: 'playing', hold: 'none',
    timeSeconds: .64, evaluatedTimeSeconds: .64, loop: 0, lastOutcome: null, lastOutcomeMotion: null, lastOutcomeRequestId: null,
    markerEvents: 1, lifecycleEvents: 2, droppedEvents: 0 };
  const actor = { residentId: 'resident-a', model, activeMotion: execution.requestedMotion, animationExecution: execution, status: 'ready' as const, fadingFrom: null };
  const proof: EmergencyHeldProp = { residentId: 'resident-a', rigId: 'verified-rig@sha', sourceAssetId: 'verified-kit@sha',
    clipId: execution.clipId!, actor, kind: repair ? 'repair-tool' : 'bucket', node: prop,
    point: repair ? [0, -.04, -.28] : [0, -.165, -.0015], radiusMetres: repair ? .025 : .085, completeEnvelopeQualified: true };
  const station: EmergencyActionStation = { id: 'station-a', sourceId: 'site-a', frame: source, sourceActor,
    kind: repair ? 'repair-surface' : 'fire-surface', position: repair ? [0, .96, -.28] : [0, .5, -.0015],
    residentStandPosition: [0, 0, 0], maxStandDistanceMetres: .15, maxToolReachMetres: .65, clearanceQualified: true,
    transferBounds: { min: [-.2, .3, -.5], max: [.2, 1.2, .3] } };
  const event: ResidentAnimationEvent = { ownerId: 'resident-a', requestId: 3, motion: 'work', clipId: 'work_hammer_bench', kind: 'marker',
    state: 'playing', seconds: .64, loop: 0, hold: 'none', markerId: 'impactSeconds:0', markerName: 'impactSeconds', markerKind: 'contact' };
  const record: EmergencyActionVisualRecord = { residentId: 'resident-a', incidentId: 'incident-a', qualified: true,
    phase: repair ? 'repairing' : 'delivering-water', waterUnits: repair ? 0 : 1, prop: proof,
    stationId: 'station-a', contactSourceActor: sourceActor.name, station, contactEvent: repair ? event : null };
  const effects = createEmergencyActionVisuals({ maxResidents: 2 }); source.add(effects.object);
  const update = (change: Partial<EmergencyActionVisualRecord> = {}, time = 1, paused = false, reducedMotion = false) =>
    effects.update({ clockSeconds: time, paused, reducedMotion, residents: [{ ...record, ...change }] });
  return { scene, source, placement, model, hand, prop, proof, actor, execution, station, sourceActor, record, event, effects, update };
}
function near(actual: Vector3, expected: Vector3) { assert.ok(actual.distanceTo(expected) < 1e-6, `${actual.toArray()} != ${expected.toArray()}`); }

test('water belongs to the factual carrier phase and current evaluated held bucket, not a nearby actor', () => {
  const f = fixture();
  f.update(); assert.equal(f.effects.diagnostics.waterSurfaces, 1); assert.equal(f.effects.diagnostics.sourceTransfers, 1);
  for (const change of [{ qualified: false }, { phase: 'held' as const }, { phase: 'evacuating' as const }, { waterUnits: 0 },
    { prop: null }, { residentId: 'other' }, { prop: { ...f.proof, clipId: 'idle' } },
    { prop: { ...f.proof, actor: { ...f.actor, status: 'unavailable-motion' as const } } }]) {
    f.update(change); assert.equal(f.effects.diagnostics.waterSurfaces, 0); assert.equal(f.effects.diagnostics.sourceTransfers, 0);
  }
  f.prop.visible = false; f.update(); assert.equal(f.effects.diagnostics.waterSurfaces, 0);
  f.prop.visible = true; f.model.remove(f.hand); f.source.add(f.hand); f.update(); assert.equal(f.effects.diagnostics.waterSurfaces, 0);
  f.effects.dispose();
});

test('source contact rejects wrong identity, wrong stand, corridor clipping, detached frames, excessive reach and uphill spills', () => {
  const f = fixture();
  const invalid = [{ stationId: 'other' }, { contactSourceActor: 'other' }, { station: { ...f.station, sourceActor: new Group() } },
    { station: { ...f.station, residentStandPosition: [1, 0, 0] as const } },
    { station: { ...f.station, transferBounds: { min: [0, 0, 0] as const, max: [.01, 1, .01] as const } } },
    { station: { ...f.station, position: [1, .5, 0] as const, maxToolReachMetres: 4 } },
    { station: { ...f.station, position: [0, .9, 0] as const } }];
  for (const change of invalid) { f.update(change); assert.equal(f.effects.diagnostics.sourceTransfers, 0); }
  f.update({ phase: 'drawing-water', waterUnits: 0, station: { ...f.station, kind: 'water-source' } });
  assert.equal(f.effects.diagnostics.sourceTransfers, 1); assert.equal(f.effects.diagnostics.waterSurfaces, 0);
  f.placement.position.x = .2; f.update(); assert.equal(f.effects.diagnostics.sourceTransfers, 0); f.effects.dispose();
});

test('bucket surface, spill endpoints and particle offsets retain source metres through rotated/scaled parents', () => {
  const f = fixture(); f.source.position.set(4, 2, -7); f.source.rotation.y = .9; f.source.scale.setScalar(.17);
  const effectParent = new Group(); effectParent.position.set(-3, 6, 2); effectParent.rotation.y = -.3; effectParent.scale.setScalar(.7);
  f.scene.add(effectParent); effectParent.add(f.effects.object); f.effects.object.position.set(2, 1, -1); f.effects.object.rotation.z = .1;
  f.update(); f.scene.updateMatrixWorld(true);
  const surface = f.effects.object.getObjectByName('Existing held bucket water') as Mesh;
  near(surface.getWorldPosition(new Vector3()), f.prop.localToWorld(new Vector3().fromArray(f.proof.point)));
  const line = f.effects.object.getObjectByName('Qualified controlled water spill') as Line, p = line.geometry.getAttribute('position');
  near(line.localToWorld(new Vector3().fromBufferAttribute(p, 0)), f.prop.localToWorld(new Vector3().fromArray(f.proof.point)));
  near(line.localToWorld(new Vector3().fromBufferAttribute(p, p.count - 1)), f.source.localToWorld(new Vector3().fromArray(f.station.position)));
  const drops = f.effects.object.getObjectByName('Source contact water droplets') as Points, dp = drops.geometry.getAttribute('position');
  assert.ok(Math.abs((drops.material as PointsMaterial).size - .025 * .17) < 1e-8, 'point sprite size follows source-frame scale');
  const local = f.source.worldToLocal(drops.localToWorld(new Vector3().fromBufferAttribute(dp, 2)));
  assert.ok(local.distanceTo(new Vector3().fromArray(f.station.position)) < .08, 'droplet envelope is in source metres');
  f.effects.dispose();
});

test('paused water freezes and reduced motion keeps static source contact without motion particles', () => {
  const f = fixture(); f.update({}, 1);
  const drops = f.effects.object.getObjectByName('Source contact water droplets') as Points;
  const before = Array.from(drops.geometry.getAttribute('position').array);
  f.update({}, 20, true); assert.deepEqual(Array.from(drops.geometry.getAttribute('position').array), before);
  f.update({}, 20, false, true); assert.equal(drops.visible, false); assert.equal(f.effects.diagnostics.sourceTransfers, 1);
  f.effects.dispose();
});

test('repair contact needs a current matching authored event and actual tip contact; a retained event cannot replay', () => {
  const f = fixture(true); f.update(); assert.equal(f.effects.diagnostics.repairContacts, 1);
  f.update({}, 1.1); assert.equal(f.effects.diagnostics.repairContacts, 1);
  f.update({}, 1.3); assert.equal(f.effects.diagnostics.repairContacts, 0);
  f.update({ incidentId: 'new', contactEvent: { ...f.event, requestId: 2 } }, 2); assert.equal(f.effects.diagnostics.repairContacts, 0);
  f.update({ incidentId: 'new', station: { ...f.station, position: [0, .7, -.28] } }, 2); assert.equal(f.effects.diagnostics.repairContacts, 0);
  f.update({}, 3, false, true); assert.equal(f.effects.diagnostics.repairContacts, 0);
  f.update({}, 3, true); assert.equal(f.effects.diagnostics.repairContacts, 0); f.effects.dispose();
});

test('bounded pool deduplicates residents and disposal releases only effect-owned resources once', () => {
  const f = fixture(); const propMatrix = f.prop.matrix.clone(), placementMatrix = f.placement.matrix.clone();
  f.effects.update({ clockSeconds: 1, paused: false, reducedMotion: false, residents: [f.record, f.record, f.record] });
  assert.equal(f.effects.diagnostics.activeResidents, 1); assert.equal(f.effects.diagnostics.sourceTransfers, 1);
  assert.ok(f.prop.matrix.equals(propMatrix)); assert.ok(f.placement.matrix.equals(placementMatrix));
  const owned = new Set<BufferGeometry>(); let releases = 0;
  f.effects.object.traverse(n => { if (n instanceof Mesh || n instanceof Line || n instanceof Points) owned.add(n.geometry); });
  for (const geometry of owned) geometry.addEventListener('dispose', () => releases++);
  f.effects.dispose(); f.effects.dispose(); f.update(); assert.equal(releases, owned.size); assert.equal(f.effects.object.parent, null);
  assert.equal(f.prop.parent, f.hand); assert.equal(f.sourceActor.parent, f.source); assert.equal(f.effects.diagnostics.activeResidents, 0);
  assert.throws(() => createEmergencyActionVisuals({ maxResidents: 33 }));
});

test('socket contracts reject another asset version and preserve the published tool axes', () => {
  const everyday = '7136c2a4f0e88504352021ef81444deccdd21c47431de2ebdcf207cdd63626bc';
  const craft = '9295ac763d90a7622b90d32f7d7f6e590a627481984f5680e5cd4932b6895873';
  assert.equal(emergencyPropSocket('bucket', craft), null); assert.equal(emergencyPropSocket('bucket', 'other'), null);
  assert.deepEqual(emergencyPropSocket('hammer-small', craft)?.point, [0, -.04, -.28]);
  assert.deepEqual(emergencyPropSocket('chisel', craft)?.point, [0, .16, 0]);
  assert.equal(emergencyPropSocket('bucket', everyday)?.radiusMetres, .085);
  assert.ok(new Matrix4().makeTranslation(0, 1, 0).elements.every(Number.isFinite));
  const workplace = 'e0fba22ea8442981124d53973427a37849c638d015c2de16288c53fcad394548';
  assert.equal(emergencyWorkpieceSocket('stone-block', craft), null);
  assert.equal(emergencyWorkpieceSocket('other', workplace), null);
  assert.deepEqual(emergencyWorkpieceSocket('stone-block', workplace)?.point, [0, .96, 0]);
  assert.deepEqual(emergencyWorkpieceSocket('stone-block', workplace)?.impactSeconds, [.6, 1.2, 1.8, 2.4]);
});

test('construction equipment outside the village source hierarchy requires exact current actor, published source and placed contact', () => {
  const f = fixture(true), piece = new Group(); piece.name = 'prop_stone_block'; piece.position.z = -.28; f.model.add(piece);
  // Character presentation and original village source have separate parents.
  f.scene.add(f.placement);
  const sourceAssetId = 'crowd-v1/props/crowd-props-workplace-v1.glb@e0fba22ea8442981124d53973427a37849c638d015c2de16288c53fcad394548';
  Object.assign(f.execution, { clipId: 'work_chisel', evaluatedTimeSeconds: .6 });
  const prop = { ...f.proof, clipId: 'work_chisel' }, workpiece = { residentId: 'resident-a', sourceAssetId,
    clipId: 'work_chisel', node: piece, actor: f.actor, point: [0, .96, 0] as const, radiusMetres: .08 };
  const station = { ...f.station, sourceId: sourceAssetId, sourceActor: piece, workpiece };
  const event = { ...f.event, clipId: 'work_chisel', seconds: .6 };
  const change = { prop, station, contactSourceActor: piece.name, contactEvent: event };
  f.update(change); assert.equal(f.effects.diagnostics.repairContacts, 1);
  const invalid = [
    { ...station, workpiece: undefined },
    { ...station, sourceId: 'different source' },
    { ...station, workpiece: { ...workpiece, sourceAssetId: 'other@sha' } },
    { ...station, workpiece: { ...workpiece, actor: { ...f.actor } } },
    { ...station, workpiece: { ...workpiece, point: [0, .86, 0] as const } },
    { ...station, workpiece: { ...workpiece, clipId: 'idle' } },
    { ...station, position: [0, .96, -.25] as const },
  ];
  for (const wrong of invalid) { f.update({ ...change, station: wrong, incidentId: 'fresh' }, 2); assert.equal(f.effects.diagnostics.repairContacts, 0); }
  piece.visible = false; f.update({ ...change, incidentId: 'hidden' }, 3); assert.equal(f.effects.diagnostics.repairContacts, 0);
  piece.visible = true; f.scene.add(piece); f.update({ ...change, incidentId: 'detached' }, 4); assert.equal(f.effects.diagnostics.repairContacts, 0);
  f.effects.dispose();
});

test('a source-qualified well rope follows measured bends from the actual handle and rejects a stale pose or route', () => {
  const f = fixture(), everyday = '7136c2a4f0e88504352021ef81444deccdd21c47431de2ebdcf207cdd63626bc';
  const socket = emergencyPropSocket('bucket', everyday)!, handle = socket.handlePoint!;
  const prop = { ...f.proof, handlePoint: handle, sourceAssetId: 'crowd-v1/props/crowd-props-everyday-v1.glb@' + everyday };
  const station: EmergencyActionStation = { ...f.station, kind: 'water-source', maxToolReachMetres: 2,
    sourceStartPoint: [handle[0], 1 + handle[1], handle[2]], sourceWaypoints: [[handle[0], 1.05, .1], [0, 1.05, -.0015]] };
  const change = { prop, station, phase: 'drawing-water' as const, waterUnits: 0 };
  f.update(change); assert.equal(f.effects.diagnostics.sourceTransfers, 1); f.scene.updateMatrixWorld(true);
  const rope = f.effects.object.getObjectByName('Qualified well rope') as Line, positions = rope.geometry.getAttribute('position');
  assert.equal(rope.geometry.drawRange.count, 4);
  near(rope.localToWorld(new Vector3().fromBufferAttribute(positions, 0)), f.prop.localToWorld(new Vector3().fromArray(handle)));
  near(rope.localToWorld(new Vector3().fromBufferAttribute(positions, 1)), f.source.localToWorld(new Vector3().fromArray(station.sourceWaypoints![0])));
  const invalid = [
    { ...station, sourceStartPoint: undefined }, { ...station, sourceStartPoint: [0, .9, 0] as const },
    { ...station, sourceWaypoints: [[NaN, 1, 0] as const] }, { ...station, sourceWaypoints: [[0, 2, 0] as const] },
    { ...station, sourceWaypoints: Array(4).fill([0, 1, 0]) }, { ...station, maxToolReachMetres: .65 },
  ];
  for (const wrong of invalid) { f.update({ ...change, station: wrong }); assert.equal(f.effects.diagnostics.sourceTransfers, 0); }
  f.update({ ...change, prop: { ...prop, sourceAssetId: 'other' } }); assert.equal(f.effects.diagnostics.sourceTransfers, 0);
  f.prop.position.x = .03; f.update(change); assert.equal(f.effects.diagnostics.sourceTransfers, 0); f.effects.dispose();
  assert.equal(emergencyBucketPose0('unknown', {}), null); assert.equal(emergencyBucketPose0('ealdholt-brewster', {}), null);
});

// Source evidence uses the real canonical published bytes. Node has no WebP
// decoder; only image references are removed after their original hash verifies.
const ROOT = new URL('../../../public/assets/legacy/environment/aethelgard/characters/', import.meta.url);
function verifiedBytes(path: string, hash: string): Buffer {
  const bytes = readFileSync(new URL(path, ROOT));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, path + ' source identity'); return bytes;
}
function sourceGlb(path: string, hash: string) {
  const bytes = verifiedBytes(path, hash), length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers; delete json.extensionsUsed; delete json.extensionsRequired;
  for (const material of json.materials ?? []) if (material.pbrMetallicRoughness) delete material.pbrMetallicRoughness.baseColorTexture;
  let head = Buffer.from(JSON.stringify(json)); head = Buffer.concat([head, Buffer.alloc((4 - head.length % 4) % 4, 0x20)]);
  const bin = bytes.subarray(20 + length), output = Buffer.alloc(20 + head.length + bin.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(head.length, 12); output.writeUInt32LE(0x4e4f534a, 16); head.copy(output, 20); bin.copy(output, 20 + head.length);
  return new GLTFLoader().parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.length), '');
}

test('published mason workpiece loads without drawing an actor and shares the verified source owner until disposal', async () => {
  const loaded: string[] = [], released: string[] = []; let failOnce = true;
  const relative = (url: string) => url.slice(ROOT.href.length);
  const port: CrowdLoaderPort = {
    loadJson: async () => { throw Error('unverified path'); }, loadGltf: async () => { throw Error('unverified path'); },
    loadVerifiedJson: async (url, hash) => JSON.parse(verifiedBytes(relative(url), hash).toString('utf8')),
    loadVerifiedGltf: async (url, hash) => { if (failOnce) { failOnce = false; throw Error('temporary source request failure'); }
      loaded.push(relative(url)); return sourceGlb(relative(url), hash); },
    releaseGltf: (url, gltf) => { released.push(relative(url)); disposeCrowdGltf(gltf); },
  };
  const parent = new Group(), presenter = createCrowdPresenter({ root: ROOT.href, parent, loader: port,
    integritySha256: EALDHOLT_POPULATION_ASSET_SHA256, createActors: () => { throw Error('must not spawn any actor'); } });
  await assert.rejects(presenter.loadEmergencyWorkpieceTemplate('ealdholt-master-mason'), /temporary source request failure/);
  const a = presenter.loadEmergencyWorkpieceTemplate('ealdholt-master-mason'), b = presenter.loadEmergencyWorkpieceTemplate('ealdholt-master-mason');
  assert.equal(a, b); const equipment = await a; assert.ok(equipment);
  assert.equal(equipment.template.name, 'prop_stone_block'); assert.equal(equipment.clipId, 'work_chisel');
  assert.deepEqual(equipment.localContactPoint, [0, .96, 0]); assert.equal(equipment.localPlacementMatrix[14], .44);
  assert.equal(presenter.actorsFor('ealdholt-master-mason'), null); assert.equal(presenter.emergencyWorkpieceFor('ealdholt-master-mason'), null);
  assert.equal(parent.children.length, 0); assert.deepEqual(loaded, ['crowd-v1/props/crowd-props-workplace-v1.glb']);
  assert.equal(presenter.metrics.assets.references, 1);
  presenter.dispose(); presenter.dispose(); assert.deepEqual(released, loaded);
});

test('published mason chisel edge meets its actual stone-block at the authored impact times', async () => {
  const id = 'ealdholt-master-mason', metaPath = `crowd-v1/residents/${id}.json`;
  const meta = JSON.parse(verifiedBytes(metaPath, EALDHOLT_POPULATION_ASSET_SHA256[metaPath]).toString('utf8'));
  const load = (path: string) => sourceGlb(path, EALDHOLT_POPULATION_ASSET_SHA256[path]);
  const [body, library, craft, workplace] = await Promise.all([load(`crowd-v1/residents/${id}.glb`),
    load('crowd-v1/clips/' + meta.clipLibrary), load(meta.presentation.kits.craft), load(meta.presentation.kits.workplace)]);
  const model = body.scene, clip = library.animations.find(c => c.name === 'work_chisel')!;
  assert.ok(clip); const mixer = new AnimationMixer(model), action = mixer.clipAction(clip); action.play();
  const held = meta.presentation.clips.work_chisel.held.find((p: { prop: string }) => p.prop === 'chisel');
  const placed = meta.presentation.clips.work_chisel.placed[0];
  const tool = craft.scene.getObjectByName(held.node)!.clone(true), workpiece = workplace.scene.getObjectByName(placed.node)!.clone(true);
  tool.matrixAutoUpdate = false; tool.matrix.fromArray(held.matrix); model.getObjectByName(held.bone)!.add(tool);
  workpiece.matrixAutoUpdate = false; workpiece.matrix.fromArray(placed.matrix); model.add(workpiece); model.scale.setScalar(meta.placementScale);
  const socket = emergencyPropSocket('chisel', EALDHOLT_POPULATION_ASSET_SHA256[meta.presentation.kits.craft])!;
  const equipment = emergencyWorkpieceSocket('stone-block', EALDHOLT_POPULATION_ASSET_SHA256[meta.presentation.kits.workplace])!;
  try {
    for (const time of equipment.impactSeconds) {
      action.time = time; mixer.update(0); model.updateMatrixWorld(true);
      const edge = tool.localToWorld(new Vector3().fromArray(socket.point)), top = workpiece.localToWorld(new Vector3().fromArray(equipment.point));
      assert.ok(edge.distanceTo(top) <= .12, `${time}: real chisel ${edge.toArray()} misses stone top ${top.toArray()} by ${edge.distanceTo(top)}`);
    }
  } finally { tool.removeFromParent(); workpiece.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(model);
    for (const item of [body, library, craft, workplace]) disposeCrowdGltf(item); }
});

test('the existing actor presenter delivers authored repair contact events and actual prop nodes to the effects owner', async () => {
  const relative = (url: string) => url.slice(ROOT.href.length), events: ResidentAnimationEvent[] = [], errors: unknown[] = [];
  const port: CrowdLoaderPort = {
    loadJson: async () => { throw Error('unverified path'); }, loadGltf: async () => { throw Error('unverified path'); },
    loadVerifiedJson: async (url, hash) => JSON.parse(verifiedBytes(relative(url), hash).toString('utf8')),
    loadVerifiedGltf: (url, hash) => sourceGlb(relative(url), hash), releaseGltf: (_url, gltf) => disposeCrowdGltf(gltf),
  };
  const id = 'ealdholt-master-mason', scene = new Group(), source = new Group(), actors = new Group(); scene.add(source, actors);
  const presenter = createCrowdPresenter({ root: ROOT.href, parent: actors, loader: port, integritySha256: EALDHOLT_POPULATION_ASSET_SHA256,
    createActors: createEaldholtResidentActors, ownerMotions: CODEX_OWNER_MOTIONS.patched, faceDistanceMetres: 0,
    onAnimationEvent: event => events.push({ ...event }), onError: (_id, error) => errors.push(error) });
  const selection = selectVillagePresence({ platform: 'desktop-isometric', position: [0, 1.6, 4], forward: [0, -1], halfFovDegrees: 60, pixelsPerDegree: 25 },
    [{ residentId: id, tier: 'major', position: [0, 0, 0], heightMetres: 1.72, presentable: true, moving: false,
      interaction: 'engaged', current: null, inFrustum: true }]);
  const template = await presenter.loadEmergencyWorkpieceTemplate(id); assert.ok(template);
  presenter.sync(selection, new Map([[id, { roleClip: 'work_chisel' }]])); await presenter.settled();
  const residents = new Map([[id, { residentId: id, motion: 'work' as const, position: [0, 0, 0] as const, yawRadians: 0 }]]);
  const effects = createEmergencyActionVisuals(); source.add(effects.object); let contacts = 0, visibleProps = 0;
  const contactPoint = new Vector3().fromArray(template.localContactPoint).applyMatrix4(new Matrix4().fromArray(template.localPlacementMatrix)).multiplyScalar(template.placementScale);
  const position = contactPoint.toArray() as [number, number, number];
  try {
    for (let frame = 0; frame < 180; frame++) {
      const clockSeconds = frame / 60; presenter.update(1 / 60, { clockSeconds, paused: false, reducedMotion: false, residents });
      const prop = presenter.emergencyPropFor(id, 'repair-tool'), workpiece = presenter.emergencyWorkpieceFor(id);
      if (!prop || !workpiece) continue; visibleProps++;
      const contactEvent = events.filter(event => event.markerKind === 'contact').slice(-1)[0];
      const station: EmergencyActionStation = { id: 'source-qualified-construction-workplace', sourceId: workpiece.sourceAssetId, sourceActor: workpiece.node,
        frame: source, workpiece, kind: 'repair-surface', position, residentStandPosition: [0, 0, 0], maxStandDistanceMetres: .1,
        maxToolReachMetres: 4, clearanceQualified: true, transferBounds: { min: [-.5, .3, -.1], max: [.5, 1.5, .9] } };
      effects.update({ clockSeconds, paused: false, reducedMotion: false, residents: [{ residentId: id, incidentId: 'building-repair', phase: 'repairing',
        qualified: true, waterUnits: 0, prop, station, stationId: station.id, contactSourceActor: workpiece.node.name, contactEvent }] });
      contacts += effects.diagnostics.repairContacts;
    }
    assert.deepEqual(errors, []); assert.ok(visibleProps > 100, 'existing current held and placed props remain available: ' + JSON.stringify({ visibleProps,
      metrics: presenter.metrics, execution: presenter.actorsFor(id)?.actors[0].animationExecution, plan: presenter.planFor(id), events: events.slice(-2) }));
    assert.ok(events.some(event => event.markerKind === 'contact' && event.clipId === 'work_chisel' && event.markerId === 'impactSeconds:0'),
      'authored .6 second impact crosses in an unwrapped animation loop');
    assert.ok(contacts > 0, 'actual source-authored contact produces repair flecks from the current owner');
    presenter.sync({ ...selection, decisions: {}, drawn: [], counts: { animated: 0, lowRate: 0, posed: 0, hidden: 0 } });
    assert.equal(presenter.emergencyWorkpieceFor(id), null, 'unloaded actor cannot leave a stale workpiece handle');
    assert.equal(await presenter.loadEmergencyWorkpieceTemplate(id), template, 'simulation template outlives visual streaming');
  } finally { effects.dispose(); presenter.dispose(); }
});

test('fixed emergency bucket sockets match original pose0 and invalidate when any contributing source changes', async () => {
  for (const id of ['ealdholt-brewster', 'ealdholt-swineherd']) {
    const metaPath = `crowd-v1/residents/${id}.json`, bodyPath = `crowd-v1/residents/${id}.glb`;
    const meta = JSON.parse(verifiedBytes(metaPath, EALDHOLT_POPULATION_ASSET_SHA256[metaPath]).toString('utf8'));
    const libraryPath = 'crowd-v1/clips/' + meta.clipLibrary, kitPath = meta.presentation.kits.everyday;
    const [body, library, kit] = await Promise.all([bodyPath, libraryPath, kitPath].map(path => sourceGlb(path, EALDHOLT_POPULATION_ASSET_SHA256[path])));
    const clip = library.animations.find(c => c.name === 'carry_bucket_walk')!; assert.ok(clip);
    const attached = meta.presentation.clips.carry_bucket_walk.held.find((p: { prop: string }) => p.prop === 'bucket'); assert.ok(attached);
    const tool = kit.scene.getObjectByName(attached.node)!.clone(true), mixer = new AnimationMixer(body.scene);
    tool.matrixAutoUpdate = false; tool.matrix.fromArray(attached.matrix); body.scene.getObjectByName(attached.bone)!.add(tool);
    body.scene.scale.setScalar(meta.placementScale); const action = mixer.clipAction(clip); action.play(); action.time = 0; mixer.update(0); body.scene.updateMatrixWorld(true);
    const socket = emergencyPropSocket('bucket', EALDHOLT_POPULATION_ASSET_SHA256[kitPath])!;
    const mouth = tool.localToWorld(new Vector3().fromArray(socket.point));
    assert.ok(tool instanceof Mesh); tool.geometry.computeBoundingBox();
    const attribute = tool.geometry.getAttribute('position'), top = new Vector3(); let topIndex = 0;
    for (let n = 1; n < attribute.count; n++) if (attribute.getY(n) > attribute.getY(topIndex)) topIndex = n;
    top.fromBufferAttribute(attribute, topIndex); const handleVertex = tool.localToWorld(top.clone());
    const files = Object.fromEntries([metaPath, bodyPath, libraryPath, kitPath].map(path => [path, EALDHOLT_POPULATION_ASSET_SHA256[path]]));
    const pose = emergencyBucketPose0(id, files); assert.ok(pose);
    near(mouth, new Vector3().fromArray(pose.mouth)); near(handleVertex, new Vector3().fromArray(pose.handle));
    near(top, new Vector3().fromArray(socket.handlePoint!));
    for (const path of Object.keys(files)) assert.equal(emergencyBucketPose0(id, { ...files, [path]: 'other' }), null, path);
    tool.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(body.scene); for (const gltf of [body, library, kit]) disposeCrowdGltf(gltf);
  }
});
