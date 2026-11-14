import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, VectorKeyframeTrack } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOUSEHOLD_ART_SETS, type HouseholdArtSet } from '../../../../../shared/legacy/aethelgard/characters/household-art-sets';
import { EALDHOLT_POPULATION_ASSET_SHA256 as HASHES } from '../../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import { getPopulationArt } from '../../../../../shared/legacy/aethelgard/characters/village-population-art';
import { type PresenceDecision, type PresenceSelection } from '../../../../../shared/legacy/aethelgard/characters/village-presence';
import { createEaldholtResidentActors } from '../resident-actors';
import { type CrowdFrame, type CrowdGltf, type CrowdLoaderPort } from './crowd-residents';
import { createHouseholdPresenter } from './household-residents';

const SMITH = HOUSEHOLD_ART_SETS[0], ROOT = 'https://assets.test/characters/';
const relative = (path: string) => path.replace(/^aethelgard\/characters\//, '');
const names = (spec: HouseholdArtSet) => [...new Set([spec.actorMotions.idle, spec.actorMotions.talk, spec.actorMotions.walk,
  spec.actorMotions.work, ...Object.values(spec.actorMotions.extra), ...(spec.actorMotions.sit ? [spec.actorMotions.sit] : [])])];
function body(spec: HouseholdArtSet): CrowdGltf {
  const scene = new Group(), rig = new Group(); rig.name = 'Rig'; scene.add(rig);
  const mesh = new Mesh(new BoxGeometry(.4, 1.5, .3), new MeshStandardMaterial()); mesh.position.y = .75; rig.add(mesh);
  for (const name of ['hand_l', 'hand_r', 'hips']) { const bone = new Group(); bone.name = name; bone.position.y = name === 'hips' ? .8 : 1; rig.add(bone); }
  return { scene, animations: names(spec).map(name => {
    const duration = Math.max(2, ...Object.values(spec.events[name] ?? {}).flat().map(seconds => seconds + .5));
    return new AnimationClip(name, duration, [new VectorKeyframeTrack('Rig.position', [0, duration], [0, 0, 0, 0, 0, 0])]);
  }) };
}
function props(spec: HouseholdArtSet): CrowdGltf {
  const scene = new Group(), workplace = new Group(); workplace.name = 'workplace'; scene.add(workplace);
  const anvil = new Mesh(new BoxGeometry(.4, .5, .4), new MeshStandardMaterial()); anvil.position.y = .25; workplace.add(anvil);
  const nodes = new Map([...Object.values(spec.propsByClip), ...Object.values(spec.restingProps)].flat().map(a => [a.node, a]));
  for (const name of nodes.keys()) { const mesh = new Mesh(new BoxGeometry(.1, .1, .3), new MeshStandardMaterial()); mesh.name = name; scene.add(mesh); }
  return { scene, animations: [...new Set(Object.values(spec.propClips))].map(name => new AnimationClip(name, 2, [])) };
}
function manifest(spec: HouseholdArtSet) {
  const envelopes = Object.fromEntries(['desktop-lod0', 'desktop-lod1', 'quest'].map(level => [level,
    Object.fromEntries(names(spec).map(name => [name, { min: [-1, -1, -1], max: [1, 3, 1] }]))]));
  return { residentId: spec.residentId, set: spec.set, envelopes };
}
function selection(ids = [SMITH.residentId], extra: Partial<PresenceDecision> = {}): PresenceSelection {
  const decisions = Object.fromEntries(ids.map(residentId => [residentId, { residentId, mode: 'animated', updateHz: 'display', updatePhase: 0,
    reason: 'priority', priority: 1, distanceMetres: 3, projectedPixels: 100, inView: true, keepLoaded: true, overCapacity: false, ...extra }])) as Record<string, PresenceDecision>;
  return { platform: 'desktop-isometric', decisions, drawn: ids.filter(id => decisions[id].mode !== 'hidden'), overCapacity: [], counts: { animated: ids.length, lowRate: 0, posed: 0, hidden: 0 } };
}
function frame(ids = [SMITH.residentId], motion: 'idle' | 'walk' | 'work' = 'idle', x = 0, clockSeconds = 0): CrowdFrame {
  return { clockSeconds, paused: false, reducedMotion: false, residents: new Map(ids.map(residentId => [residentId,
    { residentId, motion, position: [x, 0, 0] as const, yawRadians: 0, animationTimeSeconds: clockSeconds, fadeSeconds: 0 }])) };
}
function loader(verified = true) {
  const loads: string[] = [], releases: string[] = [], signals: AbortSignal[] = [], verifiedCalls: string[] = [];
  const specFor = (url: string) => HOUSEHOLD_ART_SETS.find(s => url.includes('/' + s.set + '/'))!;
  const port: CrowdLoaderPort = {
    async loadGltf(url) { loads.push(url); const spec = specFor(url); return /props/.test(url) ? props(spec) : body(spec); },
    releaseGltf(url) { releases.push(url); },
    async loadJson(url) { return manifest(specFor(url)); },
  };
  if (verified) {
    port.loadVerifiedGltf = async (url, sha, signal) => { assert.equal(sha, HASHES[url.slice(ROOT.length)]); verifiedCalls.push(url); if (signal) signals.push(signal); return port.loadGltf(url); };
    port.loadVerifiedJson = async (url, sha) => { assert.equal(sha, HASHES[url.slice(ROOT.length)]); verifiedCalls.push(url); return port.loadJson(url); };
  }
  return { port, loads, releases, signals, verifiedCalls };
}
function make(options: { verified?: boolean; all?: boolean; props?: boolean; port?: CrowdLoaderPort } = {}) {
  const fake = loader(options.verified), parent = new Group(), errors: unknown[] = [], trusted: boolean[] = [];
  const presenter = createHouseholdPresenter({ root: ROOT, parent, platform: 'desktop', integritySha256: HASHES,
    artSets: options.all ? HOUSEHOLD_ART_SETS : [SMITH], props: options.props ?? false, loader: options.port ?? fake.port,
    createActors(template, placements, ownerOptions) { trusted.push(ownerOptions?.trustEnvelopes === true); return createEaldholtResidentActors(template, placements, ownerOptions); },
    onError(_id, error) { errors.push(error); } });
  return { presenter, parent, errors, trusted, ...fake };
}

test('four actual household identities load lazily and spend at most one actor setup per update', async () => {
  const r = make({ all: true }), ids = HOUSEHOLD_ART_SETS.map(s => s.residentId);
  assert.equal(r.loads.length, 0); r.presenter.sync(selection(ids)); await r.presenter.settled();
  assert.equal(r.presenter.metrics.actorSets, 0, 'network completion never creates actors');
  for (let i = 0; i < 4; i++) { r.presenter.update(.016, frame(ids)); assert.equal(r.presenter.metrics.actorSets, i + 1); }
  assert.equal(r.presenter.metrics.householdResidents, 4); assert.equal(r.presenter.metrics.drawn, 4);
  assert.equal(r.presenter.metrics.verifiedEnvelopeSetups, 4); assert.deepEqual(r.errors, []);
  r.presenter.dispose(); r.presenter.dispose(); assert.equal(r.parent.children.length, 0);
  assert.equal(r.releases.length, 4); assert.equal(r.presenter.metrics.assets.live, 0);
});

test('only verified versions enable offline envelopes; mismatched body identity fails before setup', async () => {
  const raw = make({ verified: false }); raw.presenter.sync(selection()); await raw.presenter.settled(); raw.presenter.update(.016, frame());
  assert.deepEqual(raw.trusted, [false]); assert.equal(raw.presenter.metrics.verifiedEnvelopeSetups, 0); raw.presenter.dispose();
  const fake = loader(), art = getPopulationArt(SMITH.residentId)!, key = relative(art.levels.find(l => l.level === 'desktop-lod0')!.path);
  const errors: unknown[] = [], p = createHouseholdPresenter({ root: ROOT, parent: new Group(), platform: 'desktop', artSets: [SMITH],
    integritySha256: { ...HASHES, [key]: '0'.repeat(64) }, loader: fake.port, onError(_id, error) { errors.push(error); } });
  p.sync(selection()); await p.settled(); p.update(.016, frame()); assert.equal(p.metrics.failed, 1); assert.equal(p.metrics.setups, 0);
  assert.match(String(errors[0]), /registry version differs/); p.dispose();
});

test('role props follow hands while the workstation stays at its first work anchor', async () => {
  const r = make({ props: true }); r.presenter.sync(selection()); await r.presenter.settled(); r.presenter.update(.016, frame());
  const station = r.parent.getObjectByName('Household work anchor ' + SMITH.residentId)!;
  assert.equal(station.visible, false, 'no guessed workstation appears at the origin');
  r.presenter.update(.016, frame(undefined, 'work', 8, .5));
  assert.equal(station.visible, true); assert.equal(station.position.x, 8);
  assert.equal(r.presenter.actorsFor(SMITH.residentId)!.actors[0].activeMotion, 'work');
  const hammer = r.parent.getObjectByName('prop_hammer')!;
  assert.equal(hammer.parent!.name, 'hand_r'); assert.equal(hammer.visible, true);
  r.presenter.update(.016, frame(undefined, 'walk', 30, 1)); assert.equal(station.position.x, 8);
  assert.equal(hammer.visible, false); assert.equal(r.parent.getObjectByName('prop_hammer_rest')!.visible, true);
  assert.ok(r.presenter.completeBoundsFor(SMITH.residentId)!.min.x > 20, 'resident frustum bounds do not include the distant forge');
  assert.ok(r.presenter.bounds.min.x < 8 && r.presenter.bounds.max.x > 30, 'complete scene bounds include body and independent workstation');
  assert.deepEqual(r.errors, []); r.presenter.dispose(); assert.equal(r.releases.length, 2);
});

test('hidden retained residents keep identity and current placement without evaluating their pose', async () => {
  const r = make(); r.presenter.sync(selection()); await r.presenter.settled(); r.presenter.update(.016, frame());
  const owner = r.presenter.actorsFor(SMITH.residentId)!; r.presenter.sync(selection(undefined, { mode: 'hidden', updateHz: 0 }));
  r.presenter.update(.016, frame(undefined, 'walk', 50, 5)); assert.equal(owner.object.visible, false);
  assert.ok(r.presenter.completeBoundsFor(SMITH.residentId)!.min.x > 45); assert.equal(r.presenter.metrics.evaluated, 0);
  r.presenter.sync(selection()); r.presenter.update(.016, frame(undefined, 'walk', 51, 6));
  assert.equal(r.presenter.actorsFor(SMITH.residentId), owner); assert.equal(owner.object.visible, true); assert.equal(r.presenter.metrics.setups, 1);
  assert.deepEqual(r.errors, []); r.presenter.dispose();
});

test('a prefetched hidden body initializes its independent workstation at the supplied source anchor', async () => {
  const fake = loader(), parent = new Group(), p = createHouseholdPresenter({ root: ROOT, parent, platform: 'desktop',
    artSets: [SMITH], loader: fake.port, integritySha256: HASHES, workplaceAnchors: { [SMITH.residentId]: { position: [71, 2, -6], yawRadians: .7 } } });
  p.sync(selection(undefined, { mode: 'hidden', updateHz: 0 })); await p.settled(); p.update(.016, frame(undefined, 'idle', 100));
  const station = parent.getObjectByName('Household work anchor ' + SMITH.residentId)!;
  assert.deepEqual(station.position.toArray(), [71, 2, -6]); assert.equal(station.visible, true);
  assert.equal(parent.getObjectByName('prop_hammer_rest')!.visible, true);
  assert.equal(p.actorsFor(SMITH.residentId)!.object.visible, false); assert.ok(p.bounds.min.x < 71 && p.bounds.max.x > 100); p.dispose();
});

test('unload aborts pending verified body requests and late responses cannot bind or leak', async () => {
  const fake = loader(), original = fake.port.loadVerifiedGltf!;
  let resolve!: (g: CrowdGltf) => void, signal: AbortSignal | undefined;
  fake.port.loadVerifiedGltf = (url, sha, supplied) => { signal = supplied; return new Promise<CrowdGltf>(done => { resolve = done; void original; void url; void sha; }); };
  const r = make({ port: fake.port }); r.presenter.sync(selection()); await new Promise<void>(done => setImmediate(done));
  assert.ok(signal); r.presenter.sync(selection(undefined, { mode: 'hidden', keepLoaded: false })); assert.equal(signal!.aborted, true);
  resolve(body(SMITH)); await r.presenter.settled(); r.presenter.update(.016, frame());
  assert.equal(r.presenter.metrics.setups, 0); assert.equal(fake.releases.length, 1); assert.equal(r.presenter.metrics.assets.live, 0); r.presenter.dispose();
});

test('LOD replacement holds the visible actor until its replacement is ready and retains the work anchor', async () => {
  const r = make({ props: true }); r.presenter.sync(selection()); await r.presenter.settled(); r.presenter.update(.016, frame(undefined, 'work', 9, .5));
  const old = r.presenter.actorsFor(SMITH.residentId)!;
  r.presenter.sync(selection(undefined, { distanceMetres: 45 })); assert.equal(r.presenter.actorsFor(SMITH.residentId), old);
  await r.presenter.settled(); assert.equal(r.presenter.actorsFor(SMITH.residentId), old, 'network completion cannot replace an actor mid-frame');
  r.presenter.update(.016, frame(undefined, 'walk', 40, 2)); assert.notEqual(r.presenter.actorsFor(SMITH.residentId), old);
  assert.equal(old.disposed, true); assert.equal(r.parent.getObjectByName('Household work anchor ' + SMITH.residentId)!.position.x, 9);
  assert.equal(r.presenter.metrics.actorSets, 1); assert.equal(r.presenter.metrics.setups, 2); assert.deepEqual(r.errors, []); r.presenter.dispose();
});

test('an unsupported occupation is reported and never silently shown as the household work clip', async () => {
  const r = make(); const activities = new Map([[SMITH.residentId, { roleClip: 'work_hoe' }]]);
  assert.deepEqual(r.presenter.sync(selection(undefined, { reason: 'engaged' }), activities).unpresentable, [SMITH.residentId]);
  await r.presenter.settled(); r.presenter.update(.016, frame(undefined, 'work'));
  assert.equal(r.presenter.actorsFor(SMITH.residentId)!.actors[0].activeMotion, 'idle'); assert.equal(r.presenter.metrics.fallbackFrames, 1);
  assert.equal(r.presenter.planFor(SMITH.residentId)!.unpresentable, 'work_hoe'); r.presenter.dispose();
});

// CPU-only integration of the published geometry/rig/animations. Original bytes
// are hashed first; only image references are removed to avoid needing a browser
// image decoder in Node. Runtime byte verification is tested by the loader suite.
const DISK = new URL('../../../../public/assets/legacy/environment/aethelgard/characters/', import.meta.url);
function cpuGlb(bytes: Buffer): ArrayBuffer {
  const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + n).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((s: string) => s !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((s: string) => s !== 'EXT_texture_webp');
  for (const material of json.materials ?? []) {
    if (material.pbrMetallicRoughness) { delete material.pbrMetallicRoughness.baseColorTexture; delete material.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const bin = bytes.subarray(20 + n), out = Buffer.alloc(20 + text.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20); bin.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
test('published desktop and Quest household bodies, tools, mechanisms and envelope versions bind to the actual owner', {
  skip: !existsSync(new URL('village-smith-v1/manifest.json', DISK)) && 'published household assets unavailable',
}, async () => {
  const parser = new GLTFLoader(), loaded: string[] = [], released: string[] = [];
  const raw = (url: string, sha: string) => { const data = readFileSync(new URL(url)); assert.equal(createHash('sha256').update(data).digest('hex'), sha); return data; };
  const port: CrowdLoaderPort = {
    async loadGltf() { throw Error('Integration requires original-byte verification.'); },
    async loadJson() { throw Error('Integration requires original-byte verification.'); },
    async loadVerifiedGltf(url, sha) { loaded.push(url); return parser.parseAsync(cpuGlb(raw(url, sha)), ''); },
    async loadVerifiedJson(url, sha) { return JSON.parse(raw(url, sha).toString('utf8')); },
    releaseGltf(url) { released.push(url); },
  };
  for (const platform of ['desktop', 'quest'] as const) for (const spec of HOUSEHOLD_ART_SETS) {
    const errors: unknown[] = [], parent = new Group(), p = createHouseholdPresenter({ root: DISK.href, parent, platform,
      artSets: [spec], loader: port, integritySha256: HASHES, onError(_id, error) { errors.push(error); } });
    p.sync(selection([spec.residentId])); await p.settled(); p.update(1 / 60, frame([spec.residentId], 'work', 7, .4));
    try {
      assert.deepEqual(errors, [], spec.residentId + ' ' + platform); assert.equal(p.metrics.actorSets, 1);
      assert.equal(p.metrics.verifiedEnvelopeSetups, 1); assert.ok(p.metrics.trianglesDrawn > 1000);
      assert.equal(p.actorsFor(spec.residentId)!.actors[0].activeMotion, 'work');
      assert.ok(p.metrics.propTrianglesDrawn > 0); assert.ok(!p.completeBoundsFor(spec.residentId)!.isEmpty());
      for (const motion of ['idle', 'walk', 'workEnter', 'workExit', ...(spec.actorMotions.sit ? ['sit', 'sitDown', 'standUp'] : [])] as const) {
        p.update(1 / 60, { ...frame([spec.residentId], 'idle', 8, .7), residents: new Map([[spec.residentId,
          { residentId: spec.residentId, motion: motion as 'idle', position: [8, 0, 0] as const, yawRadians: .2, animationTimeSeconds: .7, fadeSeconds: 0 }]]) });
      }
      assert.deepEqual(errors, [], spec.residentId + ' mechanism and transitions');
    } finally { p.dispose(); }
  }
  assert.equal(loaded.length, 16); assert.equal(released.length, 16, 'every published body and prop file is released once');
});

test('household runtime consumes exact authored hammer crossings and exposes presentation diagnostics', async () => {
  const r = make(); r.presenter.sync(selection()); await r.presenter.settled(); r.presenter.update(0, frame());
  const workFrame: CrowdFrame = { clockSeconds: 1, paused: false, reducedMotion: false,
    residents: new Map([[SMITH.residentId, { residentId: SMITH.residentId, motion: 'work', position: [7, 0, 3], yawRadians: 0 }]]) };
  r.presenter.update(1, workFrame);
  const owner = r.presenter.actorsFor(SMITH.residentId)!;
  assert.equal(owner.actors[0].animationExecution.state, 'playing'); assert.equal(r.presenter.metrics.animation.playing, 1);
  assert.equal(r.presenter.metrics.animation.markerEvents, 1, 'the genuine first 19/30s impact was consumed');
  assert.ok(r.presenter.metrics.animation.lifecycleEvents >= 6);
  const remaining: unknown[] = []; owner.drainAnimationEvents(e => remaining.push(e)); assert.deepEqual(remaining, []);
  r.presenter.update(1, { ...workFrame, clockSeconds: 2, paused: true });
  assert.equal(r.presenter.metrics.animation.markerEvents, 1); assert.equal(r.presenter.metrics.animation.held, 1);
  assert.deepEqual(owner.actors[0].placement.position.toArray(), [7, 0, 3]);
  assert.deepEqual(r.errors, []); r.presenter.dispose();
});

test('cold held household body adopts its source phase once without crossing old work markers', async () => {
  const r = make(); r.presenter.sync(selection(undefined, { mode: 'posed', updateHz: 0 })); await r.presenter.settled();
  const held = { ...frame(undefined, 'work', 9, 1), paused: true };
  r.presenter.update(1, held);
  const actor = r.presenter.actorsFor(SMITH.residentId)!.actors[0];
  assert.equal(actor.activeMotion, 'work'); assert.equal(actor.animationExecution.evaluatedTimeSeconds, 1);
  assert.deepEqual(actor.placement.position.toArray(), [9, 0, 0]); assert.equal(r.presenter.metrics.animation.markerEvents, 0);
  r.presenter.update(1, { ...frame(undefined, 'walk', 99, 99), paused: true });
  assert.equal(actor.activeMotion, 'work'); assert.deepEqual(actor.placement.position.toArray(), [9, 0, 0]);
  assert.deepEqual(r.errors, []); r.presenter.dispose();
});

test('an unverified body cannot borrow the published contact marker table', async () => {
  const r = make({ verified: false }); r.presenter.sync(selection()); await r.presenter.settled(); r.presenter.update(0, frame());
  r.presenter.update(1, { clockSeconds: 1, paused: false, reducedMotion: false, residents: new Map([[SMITH.residentId,
    { residentId: SMITH.residentId, motion: 'work', position: [0, 0, 0] as const, yawRadians: 0 }]]) });
  assert.equal(r.presenter.actorsFor(SMITH.residentId)!.actors[0].activeMotion, 'work');
  assert.equal(r.presenter.metrics.animation.markerEvents, 0); assert.deepEqual(r.errors, []); r.presenter.dispose();
});
