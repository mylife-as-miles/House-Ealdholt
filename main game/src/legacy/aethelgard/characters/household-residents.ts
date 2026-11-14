import type { EmergencyHeldProp, EmergencyWorkpiece, EmergencyRepairEquipment } from '../emergency-action-visuals';
import { householdResidentAnimationMarkers, type ResidentAnimationEvent, type ResidentAnimationMarker, type ResidentAnimationMetrics } from '../../../../../shared/legacy/aethelgard/characters/resident-animation-execution';
import { AnimationMixer, Box3, Group, LoopOnce, LoopRepeat, Mesh, Vector3,
  type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentActors, type EaldholtResidentClips,
  type EaldholtResidentEnvelope, type EaldholtResidentMotion } from '../resident-actors';
import { HOUSEHOLD_ART_SETS, type HouseholdArtSet, type HouseholdArtLevel, type HouseholdPropAttachment } from '../../../../../shared/legacy/aethelgard/characters/household-art-sets';
import { getPopulationArt, type PopulationArtEntry, type PopulationArtLevel } from '../../../../../shared/legacy/aethelgard/characters/village-population-art';
import { selectHouseholdArtLevelsDetailed } from '../../../../../shared/legacy/aethelgard/characters/household-art-sets';
import { isGuaranteedPresence, lowRateDue, type PresenceDecision, type PresenceSelection } from '../../../../../shared/legacy/aethelgard/characters/village-presence';
import { createFacePose, evaluateFacePose, faceCueAt, faceSeed, type FacePose } from '../../../../../shared/legacy/aethelgard/characters/face-performance';
import { type CrowdActivity, type CrowdClipPlan } from '../../../../../shared/legacy/aethelgard/characters/crowd-binding';
import { bindResidentFaceRig, type ResidentFaceRig } from './resident-face-rig';
import { createCrowdAssetCache, createDefaultCrowdLoader, type CrowdAssetCache, type CrowdAssetStats,
  type CrowdFrame, type CrowdGltf, type CrowdLoaderPort } from './crowd-residents';

type VerifiedPort = CrowdLoaderPort & {
  loadVerifiedGltf?(url: string, sha256: string, signal?: AbortSignal): Promise<CrowdGltf>;
  loadVerifiedJson?(url: string, sha256: string, signal?: AbortSignal): Promise<unknown>;
};
export interface HouseholdWorkplaceAnchor { readonly position: readonly [number, number, number]; readonly yawRadians: number }
export interface HouseholdPresenterOptions {
  /** Characters asset folder, ending in aethelgard/characters/. */
  readonly root: string;
  readonly parent: Object3D;
  readonly platform: 'desktop' | 'quest';
  /** Published raw-byte identities, relative to that characters folder. */
  readonly integritySha256: Readonly<Record<string, string>>;
  readonly loader?: CrowdLoaderPort;
  readonly artSets?: readonly HouseholdArtSet[];
  readonly artRegistry?: readonly PopulationArtEntry[];
  readonly props?: boolean;
  /** Prefer resident IDs; a place ID may be used when it has one work position. */
  readonly workplaceAnchors?: Readonly<Record<string, HouseholdWorkplaceAnchor>>;
  readonly createActors?: typeof createEaldholtResidentActors;
  readonly onError?: (residentId: string, error: unknown) => void;
}
export interface HouseholdPresenterMetrics {
  readonly animation: ResidentAnimationMetrics;
  readonly householdResidents: number; readonly loading: number; readonly ready: number; readonly failed: number;
  readonly pending: number; readonly actorSets: number; readonly drawn: number;
  readonly animated: number; readonly lowRate: number; readonly posed: number;
  readonly trianglesDrawn: number; readonly drawCallsDrawn: number;
  readonly propsDrawn: number; readonly propTrianglesDrawn: number; readonly propDrawCallsDrawn: number;
  readonly setups: number; readonly setupMillisecondsTotal: number; readonly setupMillisecondsMax: number;
  readonly verifiedEnvelopeSetups: number; readonly evaluated: number; readonly suspended: number;
  readonly fallbackFrames: number; readonly unpresentableFrames: number; readonly assets: CrowdAssetStats;
}
export interface HouseholdPresenter {
  sync(selection: PresenceSelection, activities?: ReadonlyMap<string, CrowdActivity>): { readonly unpresentable: readonly string[] };
  update(deltaSeconds: number, frame: CrowdFrame): void;
  actorsFor(id: string): EaldholtResidentActors | null;
  planFor(id: string): CrowdClipPlan | null;
  emergencyPropFor(id: string, kind: EmergencyHeldProp['kind']): EmergencyHeldProp | null;
  loadEmergencyWorkpieceTemplate(id: string): Promise<EmergencyRepairEquipment | null>;
  emergencyWorkpieceFor(id: string): EmergencyWorkpiece | null;
  completeBoundsFor(id: string): Box3 | null;
  /** Source-frame body/attached-prop bounds plus independent workstations. */
  readonly bounds: Box3;
  settled(): Promise<void>;
  readonly metrics: HouseholdPresenterMetrics;
  readonly disposed: boolean;
  dispose(): void;
}

type Motion = EaldholtResidentMotion;
type MutableState = { residentId: string; motion: Motion; position: [number, number, number]; yawRadians: number;
  animationTimeSeconds?: number; animationTimeMode?: 'seek' | 'advance'; animationPlaybackId?: string; animationUpdateIntervalSeconds: number | null; fadeSeconds?: number };
type OwnerFrame = { clockSeconds: number; paused: boolean; reducedMotion: boolean; residents: MutableState[]; initializePausedPose?: true };
type Manifest = Record<string, unknown>;
type Loaded = { level: HouseholdArtLevel; art: PopulationArtLevel; gltf: CrowdGltf; props: CrowdGltf | null;
  manifest: Manifest; holds: string[]; verified: boolean };
type PropNode = { node: Object3D; name: string; attachment: HouseholdPropAttachment; triangles: number; draws: number; radius: number };
type PropRig = { nodes: PropNode[]; station: Group; anchor: { position: [number, number, number]; yawRadians: number }; anchored: boolean; mixer: AnimationMixer;
  actions: Map<string, AnimationAction>; indices: Map<string, number>; masks: Map<string, Uint8Array>; scratchMask: Uint8Array; emptyMask: Uint8Array; rests: readonly (readonly [number, number])[];
  clip: string | null; maxHeldRadius: number; stationRadius: number; stationBounds: Box3 };
type RecordSet = { actors: EaldholtResidentActors; group: Group; resource: Loaded; clips: EaldholtResidentClips;
  names: Partial<Record<Motion, string>>; scale: number; triangles: number; draws: number; state: MutableState; frame: OwnerFrame; props: PropRig | null;
  face: { rig: ResidentFaceRig; pose: FacePose } | null; bounds: Box3; shown: Motion; positioned: boolean };
type Slot = { id: string; spec: HouseholdArtSet; art: PopulationArtEntry; decision: PresenceDecision | null;
  desired: HouseholdArtLevel | null; activity: CrowdActivity; plan: CrowdClipPlan; status: 'idle' | 'loading' | 'ready' | 'failed';
  generation: number; loaded: Loaded | null; active: RecordSet | null; previousClock: number | null; previousMode: string | null;
  last: MutableState };
const PREFIX = 'aethelgard/characters/';
const SHA = /^[a-f0-9]{64}$/i;
const relative = (path: string) => path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite3 = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
function namesOf(spec: HouseholdArtSet): Partial<Record<Motion, string>> & { idle: string } {
  const a = spec.actorMotions;
  return { idle: a.idle, talk: a.talk, walk: a.walk, work: a.work, ...(a.sit ? { sit: a.sit } : {}), ...a.extra };
}
function readEnvelopes(manifest: Manifest, level: HouseholdArtLevel, names: Partial<Record<Motion, string>>): Partial<Record<Motion, EaldholtResidentEnvelope>> | null {
  if (!object(manifest.envelopes) || !object(manifest.envelopes[level])) return null;
  const values = manifest.envelopes[level], result: Partial<Record<Motion, EaldholtResidentEnvelope>> = {};
  for (const [motion, name] of Object.entries(names)) {
    const box = values[name];
    if (!object(box)) return null;
    if (!finite3(box.min) || !finite3(box.max) || box.min.some((n, i) => n >= (box.max as number[])[i])) throw Error('Household envelope is not a finite positive box.');
    result[motion as Motion] = { min: [...box.min], max: [...box.max] };
  }
  return result;
}
function unique(root: Object3D, name: string): Object3D {
  let found: Object3D | null = null;
  root.traverse(n => { if (n.name === name) { if (found) throw Error(`Ambiguous household node ${name}.`); found = n; } });
  if (!found) throw Error(`Missing household node ${name}.`);
  return found;
}

/** Rigid prop reach, including translation/scale keys. Rotation cannot enlarge
 * a sphere; geometry is read once and never scanned while updating residents. */
function propRadius(root: Object3D, animations: readonly AnimationClip[]): number {
  const limits = new Map<string, { translation: number; scale: number }>();
  for (const clip of animations) for (const track of clip.tracks) {
    const at = track.name.lastIndexOf('.'), name = track.name.slice(0, at), property = track.name.slice(at + 1);
    if (property !== 'position' && property !== 'scale') continue;
    const size = track.getValueSize(); if (size !== 3) throw Error('Unsupported prop transform track.');
    const limit = limits.get(name) ?? { translation: 0, scale: 0 };
    for (let i = 0; i < track.values.length; i += 3) {
      const x = track.values[i], y = track.values[i + 1], z = track.values[i + 2];
      if (![x, y, z].every(Number.isFinite)) throw Error('Nonfinite prop transform.');
      if (property === 'position') limit.translation = Math.max(limit.translation, Math.hypot(x, y, z));
      else limit.scale = Math.max(limit.scale, Math.abs(x), Math.abs(y), Math.abs(z));
    }
    limits.set(name, limit);
  }
  let radius = 0;
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (node.geometry.morphAttributes.position?.length || 'isSkinnedMesh' in node) throw Error('Household prop must be rigid.');
    const p = node.geometry.getAttribute('position'); if (!p) return;
    let r = 0;
    for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    for (let n: Object3D | null = node; n; n = n.parent) {
      const limit = limits.get(n.name), scale = Math.max(Math.abs(n.scale.x), Math.abs(n.scale.y), Math.abs(n.scale.z), limit?.scale ?? 0);
      r = Math.max(n.position.length(), limit?.translation ?? 0) + scale * r;
      if (n === root) break;
    }
    radius = Math.max(radius, r);
  });
  return radius + .01;
}
function makeProps(slot: Slot, actors: EaldholtResidentActors, group: Group, gltf: CrowdGltf, anchors?: HouseholdPresenterOptions['workplaceAnchors']): PropRig {
  const source = gltf.scene.clone(true), station = new Group(), sourceNodes = new Map<string, Object3D>();
  source.traverse(n => { if (n.name) { if (sourceNodes.has(n.name)) throw Error(`Ambiguous household prop ${n.name}.`); sourceNodes.set(n.name, n); } }); station.name = `Household work anchor ${slot.id}`;
  group.add(station);
  const workplace = unique(source, slot.spec.workstation.node); workplace.removeFromParent(); station.add(workplace);
  const nodes: PropNode[] = [], attached = new Map<string, HouseholdPropAttachment>();
  for (const list of [...Object.values(slot.spec.propsByClip), ...Object.values(slot.spec.restingProps)]) for (const a of list) {
    const previous = attached.get(a.node);
    if (previous && previous.bone !== a.bone) throw Error(`Household prop ${a.node} changes attachment bone.`);
    attached.set(a.node, a);
  }
  let maxHeldRadius = 0;
  for (const attachment of attached.values()) {
    // Workstation children remain findable after their parent is detached.
    const node = sourceNodes.get(attachment.node);
    if (!node) throw Error(`Missing household prop ${attachment.node}.`);
    const radius = propRadius(node, gltf.animations);
    node.removeFromParent();
    const parent = attachment.bone ? unique(actors.actors[0].model, attachment.bone) : station;
    parent.add(node); node.visible = false;
    let triangles = 0, draws = 0;
    node.traverse(n => { if (n instanceof Mesh) { triangles += (n.geometry.index?.count ?? n.geometry.getAttribute('position')?.count ?? 0) / 3; draws += Array.isArray(n.material) ? n.material.length : 1; } });
    nodes.push({ node, name: attachment.node, attachment, triangles, draws, radius });
    if (attachment.bone) maxHeldRadius = Math.max(maxHeldRadius, radius);
  }
  let workplaceTriangles = 0, workplaceDraws = 0;
  workplace.traverse(n => { if (n instanceof Mesh) { workplaceTriangles += (n.geometry.index?.count ?? n.geometry.getAttribute('position')?.count ?? 0) / 3; workplaceDraws += Array.isArray(n.material) ? n.material.length : 1; } });
  nodes.push({ node: workplace, name: '__workplace', attachment: { node: 'workplace', bone: null }, triangles: workplaceTriangles,
    draws: workplaceDraws, radius: propRadius(workplace, gltf.animations) });
  let stationRadius = 0; for (const n of nodes) if (!n.attachment.bone) stationRadius = Math.max(stationRadius, n.radius);
  source.clear();
  const supplied = anchors?.[slot.id] ?? anchors?.[slot.spec.workPlaceId];
  station.visible = !!supplied;
  const anchor = { position: supplied ? [...supplied.position] as [number, number, number] : [0, 0, 0] as [number, number, number], yawRadians: supplied?.yawRadians ?? 0 };
  const mixer = new AnimationMixer(group), actions = new Map<string, AnimationAction>();
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip).setLoop(LoopRepeat, Infinity));
  for (const clip of Object.values(slot.spec.propClips)) if (!actions.has(clip)) throw Error(`Missing household mechanism clip ${clip}.`);
  const indices = new Map(nodes.map((n, i) => [n.name, i])), masks = new Map<string, Uint8Array>();
  for (const clip of Object.values(namesOf(slot.spec))) {
    if (!clip) continue; const mask = new Uint8Array(nodes.length);
    for (const attachment of slot.spec.propsByClip[clip] ?? []) { const id = indices.get(attachment.node); if (id !== undefined) mask[id] = 1; }
    const seen = new Set<string>();
    for (const swap of slot.spec.workTransitions.swaps[clip] ?? []) if (!seen.has(swap.node)) { seen.add(swap.node); const id = indices.get(swap.node); if (id !== undefined) mask[id] = swap.to === 'rest' ? 1 : 0; }
    masks.set(clip, mask);
  }
  const rests: [number, number][] = [];
  for (const [held, copies] of Object.entries(slot.spec.restingProps)) for (const copy of copies) {
    const from = indices.get(held), to = indices.get(copy.node); if (from === undefined || to === undefined) throw Error('Incomplete household prop resting copies.'); rests.push([from, to]);
  }
  return { nodes, station, anchor, anchored: !!supplied, mixer, actions, indices, masks, rests,
    scratchMask: new Uint8Array(nodes.length), emptyMask: new Uint8Array(nodes.length), clip: null, maxHeldRadius, stationRadius, stationBounds: new Box3() };
}
function visible(node: Object3D): boolean { for (let n: Object3D | null = node; n; n = n.parent) if (!n.visible) return false; return true; }
function applyProps(slot: Slot, record: RecordSet, time: number, evaluate: boolean): void {
  const rig = record.props; if (!rig) return;
  const motion = record.actors.actors[0].activeMotion, clip = record.names[motion] ?? record.names.idle!;
  if (!rig.anchored && (motion === 'work' || motion === 'workEnter' || motion === 'workExit')) {
    rig.anchor.position[0] = slot.last.position[0]; rig.anchor.position[1] = slot.last.position[1]; rig.anchor.position[2] = slot.last.position[2];
    rig.anchor.yawRadians = slot.last.yawRadians; rig.anchored = true;
  }
  rig.station.visible = rig.anchored;
  if (rig.anchored) { rig.station.position.fromArray(rig.anchor.position); rig.station.rotation.set(0, rig.anchor.yawRadians, 0); rig.station.scale.setScalar(slot.art.placementScale); }
  rig.scratchMask.set(rig.masks.get(clip) ?? rig.emptyMask);
  const swaps = slot.spec.workTransitions.swaps[clip];
  if (swaps) for (const swap of swaps) if (time >= swap.seconds) { const id = rig.indices.get(swap.node); if (id !== undefined) rig.scratchMask[id] = swap.to === 'hand' ? 1 : 0; }
  for (const [held, rest] of rig.rests) rig.scratchMask[rest] = rig.scratchMask[held] ? 0 : 1;
  for (let i = 0; i < rig.nodes.length; i++) if (rig.nodes[i].name !== '__workplace') rig.nodes[i].node.visible = rig.scratchMask[i] === 1;
  const propClip = slot.spec.propClips[clip] ?? null;
  if (propClip !== rig.clip) {
    rig.mixer.stopAllAction(); rig.clip = propClip;
    if (propClip) {
      const action = rig.actions.get(propClip); if (!action) throw Error(`Missing household mechanism clip ${propClip}.`);
      const once = motion === 'workEnter' || motion === 'workExit'; action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity); action.clampWhenFinished = true; action.reset().play();
    }
  }
  if (evaluate && propClip) { const action = rig.actions.get(propClip); if (action) { action.time = time; rig.mixer.update(0); } }
}

export function createHouseholdPresenter(options: HouseholdPresenterOptions): HouseholdPresenter {
  const root = options.root.endsWith('/') ? options.root : options.root + '/', port = (options.loader ?? createDefaultCrowdLoader()) as VerifiedPort;
  const abort = new AbortController(), controllers = new Map<string, AbortController>(), refs = new Map<string, number>();
  const expected = new Map<string, string>(), verified = new Set<string>();
  const pathHash = (path: string, registryHash?: string) => {
    const key = relative(path), hash = options.integritySha256[key];
    if (registryHash && hash && registryHash !== hash) throw Error(`Household registry version differs for ${key}.`);
    const result = hash ?? registryHash;
    if (!result || !SHA.test(result)) throw Error(`No published household asset identity for ${key}.`);
    expected.set(root + key, result); return root + key;
  };
  const cache: CrowdAssetCache = createCrowdAssetCache({
    async loadGltf(url) {
      const sha = expected.get(url); if (!sha) throw Error('Unregistered household GLB.');
      const gltf = port.loadVerifiedGltf ? await port.loadVerifiedGltf(url, sha, controllers.get(url)?.signal) : await port.loadGltf(url);
      if (port.loadVerifiedGltf) verified.add(url); return gltf;
    },
    releaseGltf(url, gltf) { verified.delete(url); port.releaseGltf(url, gltf); },
    async loadJson(url) {
      const sha = expected.get(url); if (!sha) throw Error('Unregistered household manifest.');
      const value = port.loadVerifiedJson ? await port.loadVerifiedJson(url, sha, abort.signal) : await port.loadJson(url);
      if (port.loadVerifiedJson) verified.add(url); return value;
    },
  });
  const take = (url: string, holds: string[]) => {
    if (!refs.has(url)) controllers.set(url, new AbortController());
    refs.set(url, (refs.get(url) ?? 0) + 1); holds.push(url); return cache.acquire(url);
  };
  const release = (holds: string[]) => {
    while (holds.length) { const url = holds.pop()!, count = (refs.get(url) ?? 1) - 1;
      if (count <= 0) { refs.delete(url); controllers.get(url)?.abort(); controllers.delete(url); } else refs.set(url, count);
      cache.release(url);
    }
  };
  const slots: Slot[] = (options.artSets ?? HOUSEHOLD_ART_SETS).map(spec => {
    const art = getPopulationArt(spec.residentId, options.artRegistry); if (!art || art.kind !== 'existing-set') throw Error(`Household art registry is missing ${spec.residentId}.`);
    return { id: spec.residentId, spec, art, decision: null, desired: null, activity: {}, plan: { clips: namesOf(spec), unpresentable: null, walkIsOverlay: false, seatedWork: spec.workTransitions.from === 'sit', key: spec.set },
      status: 'idle', generation: 0, loaded: null, active: null, previousClock: null, previousMode: null,
      last: { residentId: spec.residentId, motion: 'idle', position: [0, 0, 0], yawRadians: 0, animationUpdateIntervalSeconds: 0 } };
  });
  const byId = new Map(slots.map(s => [s.id, s])), inflight = new Set<Promise<void>>(), loadingHolds = new Map<Slot, string[]>();
  let disposed = false, setups = 0, setupTotal = 0, setupMax = 0, trustedSetups = 0;
  let evaluated = 0, suspended = 0, fallbackFrames = 0, unpresentableFrames = 0;
  let animationMarkerEvents = 0, animationLifecycleEvents = 0;
  const observeAnimation = (event: ResidentAnimationEvent) => { if (event.kind === 'marker') animationMarkerEvents++; else animationLifecycleEvents++; };
  const combinedBounds = new Box3(), candidates: Slot[] = [];
  const fail = (slot: Slot, error: unknown) => { options.onError?.(slot.id, error); };
  function drop(record: RecordSet): void {
    record.face?.rig.dispose(); record.props?.mixer.stopAllAction(); record.props?.mixer.uncacheRoot(record.group);
    record.actors.dispose(); record.actors.drainAnimationEvents?.(observeAnimation); record.group.removeFromParent(); record.group.clear(); release(record.resource.holds);
  }
  function unload(slot: Slot): void {
    slot.generation++; const loading = loadingHolds.get(slot); if (loading) { release(loading); loadingHolds.delete(slot); }
    if (slot.loaded) { release(slot.loaded.holds); slot.loaded = null; }
    if (slot.active) { drop(slot.active); slot.active = null; }
    slot.status = 'idle'; slot.previousClock = null;
  }
  function load(slot: Slot, level: HouseholdArtLevel): void {
    const prior = loadingHolds.get(slot); if (prior) release(prior);
    if (slot.loaded) { release(slot.loaded.holds); slot.loaded = null; }
    const generation = ++slot.generation, holds: string[] = []; loadingHolds.set(slot, holds); slot.status = 'loading';
    const job = (async () => {
      const art = slot.art.levels.find(l => l.level === level); if (!art) throw Error(`Household level ${level} is unavailable.`);
      const manifestUrl = pathHash(slot.art.manifest), bodyUrl = pathHash(art.path, art.sha256);
      const json = await cache.json(manifestUrl);
      if (!object(json) || json.residentId !== slot.id || json.set !== slot.spec.set) throw Error('Household manifest identifies another resident or set.');
      if (disposed || generation !== slot.generation) return;
      const propPath = options.props === false ? null : slot.art.propsFiles?.[options.platform] ?? null;
      const propsUrl = propPath ? pathHash(propPath) : null;
      const [gltf, props] = await Promise.all([take(bodyUrl, holds), propsUrl ? take(propsUrl, holds) : Promise.resolve(null)]);
      if (disposed || generation !== slot.generation) { release(holds); return; }
      slot.loaded = { level, art, gltf, props, manifest: json, holds,
        verified: verified.has(bodyUrl) && verified.has(manifestUrl) && (!propsUrl || verified.has(propsUrl)) };
      loadingHolds.delete(slot); slot.status = 'ready';
    })().catch(error => {
      release(holds); if (loadingHolds.get(slot) === holds) loadingHolds.delete(slot);
      if (disposed || generation !== slot.generation) return;
      slot.status = 'failed'; fail(slot, error);
    });
    const tracked = job.finally(() => inflight.delete(tracked)); inflight.add(tracked);
  }
  function setup(slot: Slot): void {
    const resource = slot.loaded!, previous = slot.active; const started = performance.now(), names = namesOf(slot.spec), clips = {} as { idle: AnimationClip } & Partial<Record<Motion, AnimationClip>>;
    for (const [motion, name] of Object.entries(names)) { const found = resource.gltf.animations.find(c => c.name === name); if (!found) throw Error(`Household clip ${name} is missing.`); clips[motion as Motion] = found; }
    const envelopes = resource.verified ? readEnvelopes(resource.manifest, resource.level, names) : null;
    const markers: Partial<Record<Motion, readonly ResidentAnimationMarker[]>> = {};
    // Published event tables, like published envelopes, require the exact body
    // and manifest bytes. An unverified fallback never claims their contacts.
    if (resource.verified) for (const [motion, clipName] of Object.entries(names)) markers[motion as Motion] = householdResidentAnimationMarkers(
      slot.spec.events[clipName], slot.spec.workTransitions?.swaps[clipName]);
    const actors = (options.createActors ?? createEaldholtResidentActors)(resource.gltf, [{ residentId: slot.id, position: slot.last.position,
      yawRadians: slot.last.yawRadians, scale: slot.art.placementScale, phaseSeconds: ((faceSeed(slot.id) >>> 0) % 997) / 997 * clips.idle.duration }],
      envelopes ? { clips, markers, envelopes, trustEnvelopes: true } : { clips, markers });
    const group = new Group(); group.name = `Household presentation ${slot.id}`; group.add(actors.object);
    let face: RecordSet['face'] = null, props: PropRig | null = null;
    try {
      const rig = bindResidentFaceRig(actors.actors[0].model); if (rig.tier !== 'none') face = { rig, pose: createFacePose() }; else rig.dispose();
      if (resource.props) props = makeProps(slot, actors, group, resource.props, options.workplaceAnchors);
    } catch (error) { face?.rig.dispose(); props?.mixer.stopAllAction(); props?.mixer.uncacheRoot(group); actors.dispose(); group.clear(); throw error; }
    const state: MutableState = { ...slot.last, position: [...slot.last.position] };
    let triangles = 0, draws = 0; resource.gltf.scene.traverse(n => { if (n instanceof Mesh) { triangles += (n.geometry.index?.count ?? n.geometry.getAttribute('position')?.count ?? 0) / 3; draws += Array.isArray(n.material) ? n.material.length : 1; } });
    if (props && !props.anchored && previous?.props?.anchored) { props.anchor.position[0] = previous.props.anchor.position[0]; props.anchor.position[1] = previous.props.anchor.position[1]; props.anchor.position[2] = previous.props.anchor.position[2]; props.anchor.yawRadians = previous.props.anchor.yawRadians; props.anchored = true; }
    const record: RecordSet = { actors, group, resource, clips, names, scale: slot.art.placementScale, triangles, draws, state, frame: { clockSeconds: 0, paused: false, reducedMotion: false, residents: [state] }, props, face, bounds: new Box3(), shown: 'idle', positioned: false };
    // Initialise the independent station and resting copies even when the body
    // is prefetched hidden; supplied anchors never briefly appear at the origin.
    applyProps(slot, record, 0, false);
    options.parent.add(group); slot.active = record; slot.loaded = null;
    if (previous) drop(previous); slot.previousClock = null;
    const elapsed = performance.now() - started; setups++; setupTotal += elapsed; setupMax = Math.max(setupMax, elapsed);
    if (envelopes) trustedSetups++;
  }
  function updateBounds(record: RecordSet): void {
    record.bounds.copy(record.actors.bounds);
    if (record.props) {
      record.bounds.expandByScalar(record.props.maxHeldRadius * record.scale);
      record.props.station.updateMatrix();
      const radius = record.props.stationRadius;
      record.props.stationBounds.min.setScalar(-radius); record.props.stationBounds.max.setScalar(radius);
      record.props.stationBounds.applyMatrix4(record.props.station.matrix);
    }
  }
  const presenter: HouseholdPresenter = {
    sync(selection, activities) {
      const unpresentable: string[] = [];
      if (disposed) return { unpresentable };
      const requests = slots.filter(s => selection.decisions[s.id]?.mode !== 'hidden' && !!selection.decisions[s.id]).map(s => ({ residentId: s.id,
        distanceMetres: selection.decisions[s.id].distanceMetres, inConversation: selection.decisions[s.id].reason === 'engaged', current: s.active?.resource.level ?? null }));
      const levels = selectHouseholdArtLevelsDetailed(requests, options.platform).levels;
      for (const slot of slots) {
        const decision = selection.decisions[slot.id] ?? null; slot.decision = decision;
        if (activities) slot.activity = activities.get(slot.id) ?? {};
        const invalid = !!slot.activity.roleClip && slot.activity.roleClip !== slot.spec.actorMotions.work;
        slot.plan = { ...slot.plan, unpresentable: invalid ? slot.activity.roleClip! : null };
        if (invalid) unpresentable.push(slot.id);
        const keep = !!decision && (decision.mode !== 'hidden' || decision.keepLoaded);
        if (!keep) { if (slot.status !== 'idle' || slot.active) unload(slot); slot.desired = null; continue; }
        const level: HouseholdArtLevel = decision!.mode === 'hidden' ? slot.active?.resource.level ?? (options.platform === 'quest' ? 'quest' : 'desktop-lod1')
          : levels[slot.id] ?? (options.platform === 'quest' ? 'quest' : 'desktop-lod1');
        const changed = slot.desired !== level; slot.desired = level;
        if (changed || slot.status === 'idle') load(slot, level);
        if (slot.active) slot.active.actors.object.visible = decision!.mode !== 'hidden';
        if (slot.previousMode !== decision!.mode) { slot.previousClock = null; slot.previousMode = decision!.mode; }
      }
      return { unpresentable };
    },
    update(deltaSeconds, frame) {
      if (disposed) return; evaluated = 0; suspended = 0;
      for (const slot of slots) {
        const state = frame.residents.get(slot.id); if (!state) continue;
        slot.last.motion = state.motion; slot.last.position[0] = state.position[0]; slot.last.position[1] = state.position[1]; slot.last.position[2] = state.position[2];
        slot.last.yawRadians = state.yawRadians; slot.last.animationTimeSeconds = state.animationTimeSeconds; slot.last.animationTimeMode = state.animationTimeMode; slot.last.animationPlaybackId = state.animationPlaybackId; slot.last.fadeSeconds = state.fadeSeconds;
      }
      candidates.length = 0;
      for (const slot of slots) if (slot.loaded && slot.status === 'ready' && slot.decision && (slot.decision.mode !== 'hidden' || slot.decision.keepLoaded)) candidates.push(slot);
      candidates.sort((a, b) => Number(b.decision!.mode !== 'hidden') - Number(a.decision!.mode !== 'hidden') || b.decision!.priority - a.decision!.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // All four detailed sets share one setup slot; network completion never creates an actor.
      if (candidates.length) {
        const slot = candidates[0];
        try { setup(slot); } catch (error) { if (slot.loaded) { release(slot.loaded.holds); slot.loaded = null; } slot.status = 'failed'; fail(slot, error); }
      }
      for (const slot of slots) {
        const record = slot.active, decision = slot.decision; if (!record || !decision) continue;
        let shouldDraw = decision.mode !== 'hidden', motion = slot.last.motion;
        if (!record.clips[motion] || (motion === 'work' && slot.plan.unpresentable)) {
          if (!isGuaranteedPresence(decision)) { if (shouldDraw) unpresentableFrames++; shouldDraw = false; }
          else fallbackFrames++;
          motion = slot.plan.unpresentable ? 'idle' : record.clips[record.shown] ? record.shown : 'idle';
        }
        const due = shouldDraw && lowRateDue(decision, slot.previousClock, frame.clockSeconds); slot.previousClock = frame.clockSeconds;
        const s = record.state; s.motion = motion;
        s.position[0] = slot.last.position[0]; s.position[1] = slot.last.position[1]; s.position[2] = slot.last.position[2];
        s.yawRadians = slot.last.yawRadians; s.animationTimeSeconds = slot.last.animationTimeSeconds; s.animationTimeMode = slot.last.animationTimeMode; s.animationPlaybackId = slot.last.animationPlaybackId; s.fadeSeconds = slot.last.fadeSeconds;
        const initializePose = shouldDraw && !record.positioned;
        s.animationUpdateIntervalSeconds = initializePose || due ? 0 : null;
        record.frame.initializePausedPose = initializePose ? true : undefined;
        record.frame.clockSeconds = frame.clockSeconds; record.frame.paused = frame.paused; record.frame.reducedMotion = frame.reducedMotion;
        record.actors.object.visible = shouldDraw;
        try {
          // Hidden retained residents still move their placement/bounds while
          // their pose evaluation is suspended. Presence never rewinds lives.
          record.actors.update(Math.min(1, Math.max(0, deltaSeconds)), record.frame);
          record.actors.drainAnimationEvents?.(observeAnimation);
          if (initializePose) record.positioned = true;
          record.shown = record.actors.actors[0].activeMotion;
          if (shouldDraw) {
            const clip = record.clips[record.shown]!, clipTime = record.actors.actors[0].mixer.existingAction(clip)?.time ?? 0;
            applyProps(slot, record, clipTime, due && !frame.paused);
            if (record.face && due && !frame.paused && decision.distanceMetres <= 8) {
              const cues = slot.spec.faceCues[record.names[record.shown]!] ?? [];
              evaluateFacePose({ timeSeconds: frame.clockSeconds, seed: faceSeed(slot.id), reducedMotion: frame.reducedMotion,
                talking: frame.residents.get(slot.id)?.talking ?? record.shown === 'talk', expression: faceCueAt(cues, clipTime) }, slot.spec.faceCalibration, record.face.pose);
              record.face.rig.apply(record.face.pose);
            }
            if (due) evaluated++; else suspended++;
          }
          updateBounds(record);
        } catch (error) { fail(slot, error); }
      }
    },
    actorsFor(id) { return byId.get(id)?.active?.actors ?? null; },
    planFor(id) { return byId.get(id)?.plan ?? null; },
    // Household props have separate source frames and no qualified emergency socket contract.
    emergencyPropFor() { return null; },
    async loadEmergencyWorkpieceTemplate() { return null; },
    emergencyWorkpieceFor() { return null; },
    completeBoundsFor(id) { return byId.get(id)?.active?.bounds ?? null; },
    get bounds() {
      combinedBounds.makeEmpty();
      for (const slot of slots) if (slot.active) {
        combinedBounds.union(slot.active.bounds);
        if (slot.active.props?.anchored) combinedBounds.union(slot.active.props.stationBounds);
      }
      return combinedBounds;
    },
    async settled() { while (inflight.size) await Promise.all([...inflight]); },
    get metrics() {
      const animation = { ready: 0, playing: 0, finishing: 0, completed: 0, failed: 0, held: 0,
        markerEvents: animationMarkerEvents, lifecycleEvents: animationLifecycleEvents, droppedEvents: 0 };
      let loading = 0, ready = 0, failed = 0, pending = 0, actorSets = 0, drawn = 0, animated = 0, lowRate = 0, posed = 0;
      let triangles = 0, draws = 0, propsDrawn = 0, propTriangles = 0, propDraws = 0;
      for (const slot of slots) {
        if (slot.status === 'loading') loading++; else if (slot.status === 'ready') ready++; else if (slot.status === 'failed') failed++;
        if (slot.loaded || slot.status === 'loading') pending++;
        const record = slot.active; if (!record) continue; actorSets++;
        for (const actor of record.actors.actors) {
          const execution = actor.animationExecution;
          if (!execution) continue;
          if (execution.state === 'ready' || execution.state === 'playing' || execution.state === 'finishing' || execution.state === 'completed' || execution.state === 'failed') animation[execution.state]++;
          if (execution.hold !== 'none') animation.held++;
          animation.droppedEvents += execution.droppedEvents;
        }
        if (record.actors.object.visible) { drawn++; triangles += record.triangles; draws += record.draws;
          if (slot.decision?.mode === 'animated') animated++; else if (slot.decision?.mode === 'low-rate') lowRate++; else posed++;
        }
        for (const n of record.props?.nodes ?? []) if (n.draws > 0 && visible(n.node)) { propsDrawn++; propTriangles += n.triangles; propDraws += n.draws; }
      }
      return { animation, householdResidents: slots.length, loading, ready, failed, pending, actorSets, drawn, animated, lowRate, posed,
        trianglesDrawn: triangles, drawCallsDrawn: draws, propsDrawn, propTrianglesDrawn: propTriangles, propDrawCallsDrawn: propDraws,
        setups, setupMillisecondsTotal: setupTotal, setupMillisecondsMax: setupMax, verifiedEnvelopeSetups: trustedSetups,
        evaluated, suspended, fallbackFrames, unpresentableFrames, assets: cache.stats };
    },
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return; disposed = true; abort.abort();
      for (const slot of slots) unload(slot);
      for (const c of controllers.values()) c.abort(); controllers.clear(); refs.clear(); cache.dispose(); combinedBounds.makeEmpty();
    },
  };
  return presenter;
}
