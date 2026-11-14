import { householdResidentAnimationMarkers, type ResidentAnimationMarker, type ResidentAnimationExecutionSnapshot, type ResidentAnimationEvent, type ResidentAnimationMetrics } from '../../../../../shared/legacy/aethelgard/characters/resident-animation-execution';
import type { Camera } from 'three';
import { AnimationMixer, Box3, Group, LoopRepeat, Matrix4, Mesh, Quaternion, SkinnedMesh, Texture, Vector3,
  type AnimationClip, type Material, type Object3D, type Skeleton } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CODEX_OWNER_MOTIONS, crowdFaceCalibration, crowdResidentPaths, parseCrowdResidentMeta, planCrowdClips,
  type CrowdActivity, type CrowdClipPlan, type CrowdOwnerMotion, type CrowdResidentMeta,
} from '../../../../../shared/legacy/aethelgard/characters/crowd-binding';
import { planCrowdProps, type CrowdPropPlan } from '../../../../../shared/legacy/aethelgard/characters/crowd-presentation';
import { publishedGuardWatch, guardWatchCrowdMeta, GUARD_WATCH_ENTER, GUARD_WATCH_EXIT, GUARD_WATCH_HELPER, GUARD_WATCH_TRANSPORTS } from '../../../../../shared/legacy/aethelgard/characters/guard-watch-dwell';
import {communityWoodCrowdMeta,COMMUNITY_WOOD_CLIP,COMMUNITY_WOOD_IMPACTS} from '../../../../../shared/legacy/aethelgard/characters/community-wood-presentation';
import {
  FACE_JOINT_NAMES, createFacePose, evaluateFacePose, faceSeed, hashUnit, type FaceCalibration, type FacePose,
} from '../../../../../shared/legacy/aethelgard/characters/face-performance';
import {
  EALDHOLT_VILLAGE_POPULATION, type PopulationResident, type VillagePopulation,
} from '../../../../../shared/legacy/aethelgard/characters/village-population';
import { isGuaranteedPresence, lowRateDue, type PresenceDecision, type PresenceSelection } from '../../../../../shared/legacy/aethelgard/characters/village-presence';
import { bindResidentFaceRig, type ResidentFaceRig } from './resident-face-rig';
import {createGuardWatchPoseCorrection} from './guard-watch-pose-correction';
import {guardWatchTransitionFade} from '../../../../../shared/legacy/aethelgard/characters/guard-watch-transition';
import { emergencyPropSocket, emergencyWorkpieceSocket, type EmergencyHeldProp, type EmergencyWorkpiece, type EmergencyRepairEquipment } from '../emergency-action-visuals';

/**
 * Crowd residents for the village view (desktop, three). WORKING PLACEHOLDER, Claude's character adapter
 * (runtime builder, 7 November 2026); the Quest twin is main-game-vr/src/legacy/aethelgard/characters/crowd-residents.ts
 * and differs only in its imports and default loader. Integration notes: docs/legacy/claude-integration/characters/
 * population-README.md. Nothing here simulates: identity, routines, routes and saves stay with Codex's household
 * kernel; this module presents the 96 crowd residents of village-population.ts the way the presence contract says.
 *
 * - Lazy, reference-counted loading (`createCrowdAssetCache`): a resident's GLB and JSON load when presence first keeps
 *   it loaded; its archetype clip library loads once and is shared by every resident of that archetype; everything is
 *   released when nobody uses it (desktop: geometry, materials, textures and image bitmaps disposed).
 * - Shared clip libraries (`bindCrowdTemplate`): the actor template is `{ scene: resident.scene, animations:
 *   library.animations }`. Binding checks that every library track names exactly one resident node, that no track keys
 *   a face joint or the root, that the resident carries no morphs, and that the body joints' rest pose matches the
 *   library skeleton (the shared archetype skeleton); it also measures each joint's skin radius.
 * - Envelopes (`crowdClipEnvelope`): a conservative animated box per clip from the library skeleton sampled at every key
 *   and midpoint (computed once per archetype and clip) grown by the resident's own skin radii: microseconds per
 *   resident instead of the owner's per-vertex measurement. Passed as the owner's `envelopes` option (patch 5);
 *   an owner without that option ignores it and measures as before.
 * - Level: a crowd resident has one level (its crowd file, desktop and Quest alike); the smithy four keep their
 *   household levels and are presented by the household path (`selectVillageArtLevels` names their level).
 * - Presence (`createCrowdPresenter`): one actor set per drawn resident (each resident has its own mesh); `hidden` hides
 *   the set and skips its update; `posed` passes the owner's `animationUpdateIntervalSeconds: null`; `low-rate` passes 0
 *   on its phase-staggered frames and null between (`lowRateDue`); `animated` passes 0. Owners without the cadence field
 *   evaluate every frame (correct, unthrottled).
 * - Set-up budget (motion and runtime fixer, 8 November): sets are created against a per-frame millisecond budget, drawn
 *   residents first (at least one a frame), then residents in the prefetch ring before they are drawn, but only when the
 *   measured set-up cost fits what is left of the budget. The publisher's gated envelopes (resident JSON `envelopes`)
 *   replace runtime sampling only after the exact metadata, resident, library and prop-kit bytes verify against the
 *   caller's authoritative SHA-256 registry. Otherwise the runtime computes and qualifies its own envelopes.
 * - Props (motion and runtime fixer, 8 November): clones of the shared prop-kit nodes from the resident JSON's
 *   `presentation` (crowd-presentation.ts): grips under their bones while a clip that holds them plays, workplace props,
 *   goods and the stool in the model root frame, worn props at rest otherwise. Kit GLBs load through the same
 *   reference-counted cache as the residents and are released with them.
 * - Unpresentable activities: `sync()` returns the residents whose activity names a role loop their plan cannot show, so
 *   the caller marks them not presentable. Missing or mismatched work/role clips stay hidden and are counted by
 *   `unpresentableFrames`, including engaged/near residents. Ordinary non-role requests may keep their last shown motion
 *   or idle when presence guarantees them, counted in `fallbackFrames`.
 * - Full disposal: actor sets, face rigs and asset references are released on hide-and-unload, on role swaps (the old
 *   set after the new one exists) and on `dispose()`.
 */

export interface CrowdGltf { readonly scene: Object3D; readonly animations: readonly AnimationClip[] }

/** Platform loading. The desktop default uses GLTFLoader and disposes what it loaded; Quest uses IWSDK transactions. */
export interface CrowdLoaderPort {
  loadGltf(url: string): Promise<CrowdGltf>;
  /** Releases a result of `loadGltf` that no resident uses any more. */
  releaseGltf(url: string, gltf: CrowdGltf): void;
  loadJson(url: string): Promise<unknown>;
  /** Resolve only after hashing the exact bytes subsequently parsed. */
  loadVerifiedGltf?(url: string, sha256: string, signal?: AbortSignal): Promise<CrowdGltf>;
  loadVerifiedJson?(url: string, sha256: string, signal?: AbortSignal): Promise<unknown>;
}

export interface CrowdAssetStats { readonly loads: number; readonly releases: number; readonly live: number; readonly resolved: number; readonly pending: number; readonly references: number; readonly failures: number }
export interface CrowdAssetCache {
  acquire(url: string, sha256?: string): Promise<CrowdGltf>;
  release(url: string): void;
  json(url: string, sha256?: string): Promise<unknown>;
  verified(url: string): boolean;
  readonly stats: CrowdAssetStats;
  dispose(): void;
}
type CacheEntry = { refs: number; promise: Promise<CrowdGltf>; value: CrowdGltf | null; dead: boolean; hash: string | null; abort: AbortController };
type JsonEntry = { promise: Promise<unknown>; hash: string | null; ready: boolean; abort: AbortController };
const validHash = (hash: string) => /^[a-f0-9]{64}$/i.test(hash);
export function createCrowdAssetCache(port: CrowdLoaderPort): CrowdAssetCache {
  const entries = new Map<string, CacheEntry>(), jsons = new Map<string, JsonEntry>();
  let loads = 0, releases = 0, failures = 0, disposed = false;
  const drop = (url: string, entry: CacheEntry) => {
    entry.dead = true; entry.abort.abort();
    if (entries.get(url) === entry) entries.delete(url);
    if (entry.value) { const value = entry.value; entry.value = null; releases++; port.releaseGltf(url, value); }
  };
  return {
    acquire(url, sha256) {
      if (disposed) return Promise.reject(Error('Crowd asset cache is disposed.'));
      if (sha256 && !validHash(sha256)) return Promise.reject(Error('Invalid crowd asset SHA-256.'));
      const hash = sha256?.toLowerCase() ?? null;
      let entry = entries.get(url);
      if (entry && hash && entry.hash !== hash) return Promise.reject(Error('Crowd asset identity changed while cached.'));
      if (!entry) {
        loads++;
        const created: CacheEntry = { refs: 0, value: null, dead: false, hash, abort: new AbortController(), promise: null as unknown as Promise<CrowdGltf> };
        const request = hash ? (port.loadVerifiedGltf ? port.loadVerifiedGltf(url, hash, created.abort.signal)
          : Promise.reject(Error('Crowd loader cannot verify the configured GLB identity.'))) : port.loadGltf(url);
        created.promise = request.then(gltf => {
          created.value = gltf;
          if (created.dead) { releases++; created.value = null; port.releaseGltf(url, gltf); throw Error(`Crowd asset ${url} was released while loading.`); }
          return gltf;
        }, error => { failures++; if (entries.get(url) === created) entries.delete(url); created.dead = true; throw error; });
        entry = created; entries.set(url, entry);
      }
      entry.refs++;
      return entry.promise;
    },
    release(url) { const entry = entries.get(url); if (entry && entry.refs > 0 && --entry.refs === 0) drop(url, entry); },
    json(url, sha256) {
      if (disposed) return Promise.reject(Error('Crowd asset cache is disposed.'));
      if (sha256 && !validHash(sha256)) return Promise.reject(Error('Invalid crowd metadata SHA-256.'));
      const hash = sha256?.toLowerCase() ?? null;
      let entry = jsons.get(url);
      if (entry && hash && entry.hash !== hash) return Promise.reject(Error('Crowd metadata identity changed while cached.'));
      if (!entry) {
        const created: JsonEntry = { hash, ready: false, abort: new AbortController(), promise: null as unknown as Promise<unknown> };
        const request = hash ? (port.loadVerifiedJson ? port.loadVerifiedJson(url, hash, created.abort.signal)
          : Promise.reject(Error('Crowd loader cannot verify the configured metadata identity.'))) : port.loadJson(url);
        created.promise = request.then(value => { if (disposed) throw Error('Crowd metadata was released while loading.'); created.ready = true; return value; });
        created.promise.catch(() => { if (jsons.get(url) === created) jsons.delete(url); });
        entry = created; jsons.set(url, created);
      }
      return entry.promise;
    },
    verified(url) { const glb = entries.get(url), json = jsons.get(url); return !!(glb?.hash && glb.value && !glb.dead || json?.hash && json.ready); },
    get stats() { let references = 0, resolved = 0; for (const e of entries.values()) { references += e.refs; if(e.value)resolved++; } return { loads, releases, live: entries.size, resolved, pending: entries.size-resolved, references, failures }; },
    dispose() { if (disposed) return; disposed = true; for (const [url, entry] of [...entries]) drop(url, entry); for (const entry of jsons.values()) entry.abort.abort(); jsons.clear(); },
  };
}

// ------------------------------------------------------------------ libraries and binding

const FACE_JOINTS = new Set<string>(Object.values(FACE_JOINT_NAMES));
const ROOT_JOINT = 'root';
/** Rest-pose identity between a resident's body joints and its archetype library (the publisher measured 0 mm, 0.05 deg). */
const REST_POSITION_TOLERANCE = 0.002, REST_ANGLE_TOLERANCE = 0.5 * Math.PI / 180;
/** Added to every sampled joint box: covers the arc between samples (keys and midpoints at 30 frames a second). */
const ENVELOPE_SAMPLE_MARGIN = 0.005;

/**
 * Per joint over one clip (library skeleton, every key and midpoint): position range (3 per joint) and the range of
 * each entry of the joint's 3x3 linear part (9 per joint, row-major), plus the largest absolute value of each entry.
 */
interface JointBoxes {
  readonly pmin: Float64Array; readonly pmax: Float64Array;
  readonly rmin: Float64Array; readonly rmax: Float64Array; readonly rabs: Float64Array;
}

/** A loaded archetype library with its rest pose and per-clip joint boxes (computed once per clip, shared by residents). */
export interface CrowdLibrary {
  readonly gltf: CrowdGltf;
  readonly names: ReadonlySet<string>;
  /** Joint names in a fixed order and their rest world matrices relative to the library scene root. */
  readonly joints: readonly string[];
  readonly restWorld: readonly Matrix4[];
  clip(name: string): AnimationClip;
  jointBoxes(name: string): JointBoxes;
  /** Milliseconds spent sampling joint boxes so far. */
  readonly samplingMilliseconds: number;
}

function nodesByName(root: Object3D): Map<string, Object3D[]> {
  const map = new Map<string, Object3D[]>();
  root.traverse(node => { const list = map.get(node.name); if (list) list.push(node); else map.set(node.name, [node]); });
  return map;
}

function relativeWorld(root: Object3D, node: Object3D, out: Matrix4): Matrix4 {
  // matrices relative to the scene root, whatever the root's own transform or parent
  out.identity();
  const chain: Object3D[] = [];
  for (let n: Object3D | null = node; n && n !== root; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) { chain[i].updateMatrix(); out.multiply(chain[i].matrix); }
  return out;
}

const maxColumnScale = (m: Matrix4): number => {
  const e = m.elements;
  const a = Math.hypot(e[0], e[1], e[2]), b = Math.hypot(e[4], e[5], e[6]), c = Math.hypot(e[8], e[9], e[10]);
  // uniform scale (rotation x s): every column has length s; otherwise the Frobenius norm bounds the stretch
  return Math.abs(a - b) < 1e-6 && Math.abs(b - c) < 1e-6 ? a : Math.hypot(a, b, c);
};

export function prepareCrowdLibrary(gltf: CrowdGltf): CrowdLibrary {
  const names = new Set(gltf.animations.map(c => c.name));
  if (names.size !== gltf.animations.length) throw Error('Crowd clip library has duplicate clip names.');
  const byName = nodesByName(gltf.scene), joints: string[] = [], restWorld: Matrix4[] = [];
  // the library carries the skeleton as plain nodes (no mesh): use every named descendant joint under the root joint
  const root = byName.get(ROOT_JOINT)?.[0];
  if (!root) throw Error('Crowd clip library has no root joint.');
  root.traverse(node => { if (node.name) { joints.push(node.name); restWorld.push(relativeWorld(gltf.scene, node, new Matrix4())); } });
  if (joints.length < 20 || new Set(joints).size !== joints.length) throw Error('Crowd clip library skeleton is incomplete or ambiguous.');
  const boxes = new Map<string, JointBoxes>();
  let sampler: { rig: Object3D; nodes: Object3D[]; mixer: AnimationMixer } | null = null, sampling = 0;
  const m = new Matrix4();
  function jointBoxes(name: string): JointBoxes {
    const cached = boxes.get(name); if (cached) return cached;
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw Error(`Clip ${name} is not in the crowd library.`);
    const started = performance.now();
    if (!sampler) {
      const rig = gltf.scene.clone(true), map = nodesByName(rig);
      sampler = { rig, nodes: joints.map(j => map.get(j)![0]), mixer: new AnimationMixer(rig) };
    }
    const times = new Set<number>([0, clip.duration]);
    for (const track of clip.tracks) for (let i = 0; i < track.times.length; i++) times.add(track.times[i]);
    const keys = [...times].sort((a, b) => a - b), samples: number[] = [];
    for (let i = 0; i < keys.length; i++) { if (i) samples.push((keys[i - 1] + keys[i]) / 2); samples.push(keys[i]); }
    const n = joints.length;
    const pmin = new Float64Array(n * 3).fill(Infinity), pmax = new Float64Array(n * 3).fill(-Infinity);
    const rmin = new Float64Array(n * 9).fill(Infinity), rmax = new Float64Array(n * 9).fill(-Infinity), rabs = new Float64Array(n * 9);
    const prev = new Float64Array(n * 12), step = new Float64Array(n * 12);
    const action = sampler.mixer.clipAction(clip); action.setLoop(LoopRepeat, Infinity).play();
    try {
      for (let s = 0; s < samples.length; s++) {
        action.time = samples[s]; sampler.mixer.update(0);
        for (let j = 0; j < n; j++) {
          const e = relativeWorld(sampler.rig, sampler.nodes[j], m).elements;
          for (let a = 0; a < 3; a++) {
            const v = e[12 + a];
            if (v < pmin[j * 3 + a]) pmin[j * 3 + a] = v; if (v > pmax[j * 3 + a]) pmax[j * 3 + a] = v;
            if (s) step[j * 12 + 9 + a] = Math.max(step[j * 12 + 9 + a], Math.abs(v - prev[j * 12 + 9 + a]));
            prev[j * 12 + 9 + a] = v;
          }
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            const k = j * 9 + r * 3 + c, v = e[c * 4 + r];   // three stores column-major: entry (r, c) is e[c * 4 + r]
            if (v < rmin[k]) rmin[k] = v; if (v > rmax[k]) rmax[k] = v; if (Math.abs(v) > rabs[k]) rabs[k] = Math.abs(v);
            if (s) step[j * 12 + r * 3 + c] = Math.max(step[j * 12 + r * 3 + c], Math.abs(v - prev[j * 12 + r * 3 + c]));
            prev[j * 12 + r * 3 + c] = v;
          }
        }
      }
    } finally { action.stop(); sampler.mixer.uncacheAction(clip); }
    // between samples an entry moves at most about half its largest step away from both neighbours
    for (let j = 0; j < n; j++) {
      for (let a = 0; a < 3; a++) { const pad = step[j * 12 + 9 + a] / 2 + ENVELOPE_SAMPLE_MARGIN; pmin[j * 3 + a] -= pad; pmax[j * 3 + a] += pad; }
      for (let k = 0; k < 9; k++) { const pad = step[j * 12 + k] / 2; rmin[j * 9 + k] -= pad; rmax[j * 9 + k] += pad; rabs[j * 9 + k] += pad; }
    }
    const out = { pmin, pmax, rmin, rmax, rabs };
    boxes.set(name, out); sampling += performance.now() - started;
    return out;
  }
  return {
    gltf, names, joints, restWorld,
    clip(name) { const c = gltf.animations.find(x => x.name === name); if (!c) throw Error(`Clip ${name} is not in the crowd library.`); return c; },
    jointBoxes,
    get samplingMilliseconds() { return sampling; },
  };
}

/** A resident bound to its library: the owner template plus what the envelope needs. */
export interface CrowdTemplate {
  readonly template: { readonly scene: Object3D; readonly animations: readonly AnimationClip[] };
  readonly library: CrowdLibrary;
  /** Per library joint: centre and half extent (3 + 3) of the resident's vertices it influences, in the joint's own frame; NaN when none. */
  readonly localBox: Float64Array;
  /** Per library joint: the resident's largest skin distance in the joint's own frame (bone units). */
  readonly skinRadius: Float64Array;
  /** Per library joint: rest rotation difference to the library (radians; face joints excluded from the check). */
  readonly restAngle: Float64Array;
  /** Per library joint: how far the resident's joint rests from the library's (model metres; face joints differ per head). */
  readonly restOffset: Float64Array;
  /** Mesh frame correction (mesh world times inverse bind), identity for the published files. */
  readonly meshToModel: Matrix4;
  readonly triangles: number;
  readonly drawsPerActor: number;
  /** Largest body-joint rest difference to the library (metres, radians). */
  readonly restDifference: { readonly metres: number; readonly radians: number };
}

/** Join additive byte-bound prop tracks; every original body track is retained. */
export function prepareGuardWatchLibrary(base: CrowdLibrary, addon: CrowdLibrary): CrowdLibrary {
  if (base.joints.length !== addon.joints.length || base.joints.some((name,i) => name !== addon.joints[i]
    || base.restWorld[i].elements.some((v,j) => Math.abs(v-addon.restWorld[i].elements[j])>1e-7)))
    throw Error('Guard addon must retain the exact published skeleton.');
  const required = [GUARD_WATCH_ENTER,GUARD_WATCH_EXIT,...Object.values(GUARD_WATCH_TRANSPORTS)];
  if (addon.names.size !== required.length || required.some(name => !addon.names.has(name)))
    throw Error('Guard addon must contain exactly its two transitions and two source-loop prop tracks.');
  const scene = base.gltf.scene.clone(true), helper = addon.gltf.scene.getObjectByName(GUARD_WATCH_HELPER);
  if (!helper || helper.children.length || helper instanceof Mesh || scene.getObjectByName(GUARD_WATCH_HELPER))
    throw Error('Guard addon helper must be a unique empty node outside the body skeleton.');
  scene.add(helper.clone(false));
  const animations = base.gltf.animations.map(clip => {
    const auxiliary = GUARD_WATCH_TRANSPORTS[clip.name];
    if (!auxiliary) return clip;
    const transport = addon.clip(auxiliary);
    if (Math.abs(transport.duration-clip.duration)>1e-4 || transport.tracks.length!==3
      || transport.tracks.some(track=>!track.name.startsWith(GUARD_WATCH_HELPER+'.')))
      throw Error('Guard loop prop transport must match the original loop timeline.');
    const combined=clip.clone();combined.tracks.push(...transport.tracks.map(track=>track.clone()));return combined;
  });
  animations.push(addon.clip(GUARD_WATCH_ENTER),addon.clip(GUARD_WATCH_EXIT));
  return prepareCrowdLibrary({scene,animations});
}

export function bindCrowdTemplate(resident: CrowdGltf, library: CrowdLibrary, guardWatch = false): CrowdTemplate {
  if (guardWatch) {
    if (resident.scene.getObjectByName(GUARD_WATCH_HELPER)) throw Error('A source resident cannot predeclare the guard prop helper.');
    const helper = library.gltf.scene.getObjectByName(GUARD_WATCH_HELPER);
    if (!helper || helper.children.length || helper instanceof Mesh) throw Error('Published guard prop helper is absent or contains geometry.');
    resident.scene.add(helper.clone(false));
  }
  const byName = nodesByName(resident.scene);
  const skinned: SkinnedMesh[] = [];
  let triangles = 0, draws = 0;
  resident.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (node.morphTargetInfluences?.length || node.geometry.morphAttributes.position?.length) throw Error('Crowd residents carry no morph targets.');
    const index = node.geometry.getIndex(), position = node.geometry.getAttribute('position');
    triangles += (index ? index.count : position.count) / 3;
    draws += Array.isArray(node.material) ? node.material.length : 1;
    if (node instanceof SkinnedMesh) skinned.push(node);
  });
  if (!skinned.length) throw Error('Crowd resident has no skinned mesh.');
  for (const clip of library.gltf.animations) for (const track of clip.tracks) {
    const node = track.name.slice(0, track.name.lastIndexOf('.'));
    if (FACE_JOINTS.has(node) || node === ROOT_JOINT) throw Error(`Library clip ${clip.name} keys ${node}; crowd clips key body joints only.`);
    if ((byName.get(node)?.length ?? 0) !== 1) throw Error(`Library clip ${clip.name} names ${node}, which the resident lacks or repeats.`);
  }
  const m = new Matrix4(), rot = new Matrix4(), a = new Vector3(), b = new Vector3(), qr = new Quaternion(), ql = new Quaternion();
  const skinRadius = new Float64Array(library.joints.length), restOffset = new Float64Array(library.joints.length);
  const restAngle = new Float64Array(library.joints.length), lo = new Float64Array(library.joints.length * 3).fill(Infinity);
  const hi = new Float64Array(library.joints.length * 3).fill(-Infinity);
  const index = new Map(library.joints.map((j, i) => [j, i]));
  let metres = 0, radians = 0;
  for (let i = 0; i < library.joints.length; i++) {
    const name = library.joints[i], found = byName.get(name);
    if (!found || found.length !== 1) throw Error(`Crowd resident lacks joint ${name} of its archetype skeleton.`);
    relativeWorld(resident.scene, found[0], m);
    a.setFromMatrixPosition(m); b.setFromMatrixPosition(library.restWorld[i]);
    restOffset[i] = a.distanceTo(b);
    qr.setFromRotationMatrix(rot.extractRotation(m)); ql.setFromRotationMatrix(rot.extractRotation(library.restWorld[i]));
    const angle = qr.angleTo(ql); restAngle[i] = angle;
    if (FACE_JOINTS.has(name)) continue;   // face joints sit on each resident's own head; their offset widens the box
    metres = Math.max(metres, restOffset[i]); radians = Math.max(radians, angle);
    if (restOffset[i] > REST_POSITION_TOLERANCE || angle > REST_ANGLE_TOLERANCE) {
      throw Error(`Crowd resident joint ${name} differs from its archetype skeleton by ${(restOffset[i] * 1000).toFixed(1)} mm, ${(angle * 180 / Math.PI).toFixed(2)} deg.`);
    }
  }
  // skin radii, measured in each bone's frame like the owner's support radii
  const v = new Vector3(), meshToModel = new Matrix4();
  for (const mesh of skinned) {
    const position = mesh.geometry.getAttribute('position'), joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    if (!joints || !weights) throw Error('Crowd resident skin needs joints and weights.');
    const bones = mesh.skeleton.bones.map(bone => index.get(bone.name) ?? -1);
    if (bones.some(i => i < 0)) throw Error('Crowd resident skin uses a joint outside its archetype skeleton.');
    for (let i = 0; i < position.count; i++) {
      for (let c = 0; c < 4; c++) {
        if (!(weights.getComponent(i, c) > 0)) continue;
        const bone = joints.getComponent(i, c);
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[bone]);
        const j = bones[bone];
        if (v.length() > skinRadius[j]) skinRadius[j] = v.length();
        for (let a = 0; a < 3; a++) { const x = v.getComponent(a); if (x < lo[j * 3 + a]) lo[j * 3 + a] = x; if (x > hi[j * 3 + a]) hi[j * 3 + a] = x; }
      }
    }
    relativeWorld(resident.scene, mesh, m); meshToModel.copy(m).multiply(mesh.bindMatrixInverse);
  }
  const localBox = new Float64Array(library.joints.length * 6).fill(NaN);
  for (let j = 0; j < library.joints.length; j++) {
    if (!(hi[j * 3] >= lo[j * 3])) continue;
    for (let a = 0; a < 3; a++) { localBox[j * 6 + a] = (lo[j * 3 + a] + hi[j * 3 + a]) / 2; localBox[j * 6 + 3 + a] = (hi[j * 3 + a] - lo[j * 3 + a]) / 2; }
  }
  return { template: { scene: resident.scene, animations: library.gltf.animations }, library, localBox, skinRadius, restAngle, restOffset, meshToModel,
    triangles: Math.round(triangles), drawsPerActor: draws, restDifference: { metres, radians } };
}

export interface CrowdEnvelope { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }

/**
 * Conservative animated box of one library clip on one resident, in the resident's model frame (before placement).
 * Linear blend skinning puts a vertex at sum_b w_b * T_b(t) * u_b with u_b inside joint b's local box of the vertices it
 * influences, so every vertex lies in the convex hull of the boxes T_b(t) * localBox_b. Each such box is bounded over
 * the clip from the joint's sampled position range and the ranges of its 3x3 entries (interval arithmetic), then
 * widened by the resident's rest difference to the library (offset plus angle times the largest skin distance).
 */
export function crowdClipEnvelope(bound: CrowdTemplate, clipName: string): CrowdEnvelope {
  const k = bound.library.jointBoxes(clipName), out = new Box3(), corner = new Vector3(), lb = bound.localBox;
  const lo = [0, 0, 0], hi = [0, 0, 0];
  let any = false;
  for (let j = 0; j < bound.library.joints.length; j++) {
    if (Number.isNaN(lb[j * 6])) continue;
    const margin = bound.restOffset[j] + bound.restAngle[j] * bound.skinRadius[j];
    for (let r = 0; r < 3; r++) {
      let a = k.pmin[j * 3 + r], b = k.pmax[j * 3 + r];
      for (let c = 0; c < 3; c++) {
        const centre = lb[j * 6 + c], half = lb[j * 6 + 3 + c], idx = j * 9 + r * 3 + c;
        const p = k.rmin[idx] * centre, q = k.rmax[idx] * centre;
        a += Math.min(p, q) - k.rabs[idx] * half; b += Math.max(p, q) + k.rabs[idx] * half;
      }
      lo[r] = a - margin; hi[r] = b + margin;
    }
    for (let c = 0; c < 8; c++) {
      corner.set(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]).applyMatrix4(bound.meshToModel);
      out.expandByPoint(corner);
    }
    any = true;
  }
  if (!any) throw Error('Crowd resident has no skinned vertices to bound.');
  return { min: [out.min.x, out.min.y, out.min.z], max: [out.max.x, out.max.y, out.max.z] };
}

/**
 * Complete prop reach in the model frame. Placed props use their exact static box; bone props use a rotation-independent
 * chain sphere, including every planned translation/scale key, so intermediate rotations and crossfades remain inside.
 * Setup only: never scans vertices or joints during frame updates. This is a visual/clearance envelope, not a capsule.
 */
export function crowdAttachedPropBounds(model: Object3D, prop: Object3D, parent: Object3D, clips: readonly AnimationClip[]): Box3 {
  const bounds = new Box3(), box = new Box3(), matrix = new Matrix4();
  prop.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (node instanceof SkinnedMesh || node.morphTargetInfluences?.length) throw Error('Crowd prop bounds require static prop geometry.');
    const position = node.geometry.getAttribute('position'); if (!position) return;
    box.setFromBufferAttribute(position);
    relativeWorld(prop, node, matrix); matrix.premultiply(prop.matrix);
    bounds.union(box.applyMatrix4(matrix));
  });
  if (bounds.isEmpty() || parent === model) return bounds;
  let radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
  const translation = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
  let node: Object3D | null = parent;
  for (; node && node !== model; node = node.parent) {
    node.updateMatrix(); node.matrix.decompose(translation, rotation, scale);
    let distance = translation.length(), stretch = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    for (const clip of clips) for (const track of clip.tracks) {
      const split = track.name.lastIndexOf('.'); if (track.name.slice(0, split) !== node.name) continue;
      const property = track.name.slice(split + 1); if (property !== 'position' && property !== 'scale') continue;
      // Linear/discrete vector keys have no overshoot; reject smooth/cubic tracks rather than call them complete.
      if (track.getValueSize() !== 3 || ![2300, 2301].includes(track.getInterpolation())) throw Error('Crowd prop reach cannot bound smooth translation/scale tracks.');
      for (let i = 0; i < track.values.length; i += 3) {
        const x = track.values[i], y = track.values[i + 1], z = track.values[i + 2];
        if (![x, y, z].every(Number.isFinite)) throw Error('Crowd prop reach has nonfinite animation values.');
        if (property === 'position') distance = Math.max(distance, Math.hypot(x, y, z));
        else stretch = Math.max(stretch, Math.abs(x), Math.abs(y), Math.abs(z));
      }
    }
    radius = distance + stretch * radius;
  }
  if (node !== model || !Number.isFinite(radius)) throw Error('Crowd prop parent is outside its resident model.');
  return bounds.set(new Vector3(-radius, -radius, -radius), new Vector3(radius, radius, radius));
}

// ------------------------------------------------------------------ presenter

/** The part of the actor owner's set the presenter uses (Codex's EaldholtResidentActors satisfies it). */
export interface CrowdActorsLike {
  readonly object: Object3D;
  readonly actors: readonly { readonly residentId: string; readonly model: Object3D; readonly activeMotion: string;
    readonly animationExecution?: ResidentAnimationExecutionSnapshot;
    readonly mixer?:AnimationMixer;
    readonly fadingFrom?:string|null;
    /** Optional submission facts from the real actor owner; minimal/test owners remain unobserved. */
    readonly status?: 'ready' | 'unavailable-motion'; readonly lastRenderedFrame?: number | null;
    readonly lastRenderedCamera?: Camera | null; readonly lastRenderedPosition?: readonly [number, number, number]; readonly lastRenderedMotion?: string | null }[];
  readonly bounds: Box3;
  readonly metrics: { readonly setupMilliseconds: number; readonly envelopeSamples: number };
  readonly disposed: boolean;
  drainAnimationEvents?(consume: (event: ResidentAnimationEvent) => void): void;
  update(deltaSeconds: number, frame: CrowdOwnerFrame): void;
  dispose(): void;
}
export interface CrowdOwnerState {
  residentId: string; motion: CrowdOwnerMotion; position?: readonly [number, number, number]; yawRadians?: number;
  animationTimeSeconds?: number; animationTimeMode?: 'seek' | 'advance'; animationPlaybackId?: string; animationUpdateIntervalSeconds?: number | null; fadeSeconds?: number;
}
export interface CrowdOwnerFrame { clockSeconds: number; paused: boolean; reducedMotion: boolean; residents: readonly CrowdOwnerState[];initializePausedPose?:true }

/** The caller's per-frame state for one drawn crowd resident (from its simulation and route presentation). */
export interface CrowdResidentFrameState {
  readonly residentId: string;
  readonly motion: CrowdOwnerMotion;
  readonly position: readonly [number, number, number];
  readonly yawRadians: number;
  readonly animationTimeSeconds?: number;
  readonly animationTimeMode?: 'seek' | 'advance'; readonly animationPlaybackId?: string;
  readonly fadeSeconds?: number;
  /** A source-constrained journey must wait for its exact prepared clip/prop plan. */
  readonly strictMotionPlan?: true;
  /** In conversation: drives the shared babble on the joints-only face. */
  readonly talking?: boolean;
}
export interface CrowdFrame {
  readonly clockSeconds: number; readonly paused: boolean; readonly reducedMotion: boolean;
  /** States by resident ID; residents without a state keep their last placement and motion. */
  readonly residents: ReadonlyMap<string, CrowdResidentFrameState>;
}

export interface CrowdPresenterOptions {
  /** URL of the shared `aethelgard/characters/` asset folder, ending in '/'. */
  readonly root: string;
  /** Where actor sets are added (a village group in the scene). */
  readonly parent: Object3D;
  readonly population?: VillagePopulation;
  readonly loader?: CrowdLoaderPort;
  /** Authoritative raw-byte SHA-256 values, keyed relative to root. */
  readonly integritySha256?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Motions the actor owner accepts (CODEX_OWNER_MOTIONS.current until patches 2, 4 and 5 land). */
  readonly ownerMotions?: readonly CrowdOwnerMotion[];
  /** Actor sets created per update at most (setup cost is spread over frames). Default 1. */
  readonly maxSetupsPerFrame?: number;
  /**
   * Set-up time per frame (milliseconds). A drawn resident without its set always gets one per frame; further sets, and
   * sets for residents in the prefetch ring (kept loaded, not drawn yet), are created only while the measured set-up cost
   * fits what is left of this budget. Default 8.
   */
  readonly setupBudgetMilliseconds?: number;
  /** Create sets for residents in the prefetch ring before presence draws them (when the budget allows). Default true. */
  readonly prefetchSets?: boolean;
  /** Attach the shared prop-kit props from the resident JSON's presentation block. Default true. */
  readonly props?: boolean;
  /** Allow publisher envelopes after all participating assets verify against integritySha256. Default true. */
  readonly trustPublishedEnvelopes?: boolean;
  /** Clock for the set-up budget (tests); default performance.now. */
  readonly now?: () => number;
  /** Drive blink, gaze drift and babble on the joints-only face for drawn residents nearer than this (metres; 0 = off). */
  readonly faceDistanceMetres?: number;
  /** Pass the conservative envelopes to the owner (honoured by patch 5; ignored otherwise). Default true. */
  readonly envelopes?: boolean;
  /** Codex's createEaldholtResidentActors (or a compatible owner). */
  createActors(template: CrowdTemplate['template'], placements: readonly { readonly residentId: string; readonly position: readonly [number, number, number];
    readonly yawRadians: number; readonly scale?: number; readonly phaseSeconds?: number }[],
    options: { readonly clips: { readonly idle: AnimationClip } & Partial<Record<CrowdOwnerMotion, AnimationClip>>;
      readonly envelopes?: Partial<Record<CrowdOwnerMotion, CrowdEnvelope>>; readonly trustEnvelopes?: boolean;
      readonly markers?: Partial<Record<CrowdOwnerMotion, readonly ResidentAnimationMarker[]>> }): CrowdActorsLike;
  /** Borrowed actual evaluated animation records; copy only records retained by the caller. */
  readonly onAnimationEvent?: (event: ResidentAnimationEvent) => void;
  readonly onError?: (residentId: string, error: unknown) => void;
}

export interface CrowdPresenterMetrics {
  readonly animation: ResidentAnimationMetrics;
  readonly crowdResidents: number; readonly loading: number; readonly ready: number; readonly failed: number;
  readonly actorSets: number; readonly drawn: number; readonly animated: number; readonly lowRate: number; readonly posed: number;
  /** Owner evaluations requested this frame (cadence 0) and suspended (null). */
  readonly evaluated: number; readonly suspended: number;
  readonly trianglesDrawn: number; readonly drawCallsDrawn: number;
  readonly setups: number; readonly setupMillisecondsTotal: number; readonly setupMillisecondsMax: number;
  readonly bindMillisecondsTotal: number; readonly envelopeSamples: number; readonly libraryLoads: number;
  readonly unpresentableFrames: number; readonly assets: CrowdAssetStats;
  /** Frames a guaranteed resident kept its last motion/idle for an ordinary non-role request; work never uses this fallback. */
  readonly fallbackFrames: number;
  /** Props shown on drawn residents now: count, triangles and draws (one per prop mesh material). */
  readonly propsDrawn: number; readonly propTrianglesDrawn: number; readonly propDrawCallsDrawn: number;
  /** Sets created for residents in the prefetch ring (not drawn yet) and the largest set-up time spent in one frame. */
  readonly prefetchSetups: number; readonly setupFrameMillisecondsMax: number;
  /** Sets whose envelopes all came from the publisher (no library sampling) and were passed as trusted. */
  readonly publishedEnvelopeSetups: number;
}

/** What `sync` reports back to the caller. */
export interface CrowdSyncReport {
  /** Residents whose loaded role plan the library or owner cannot show. Hold their role presentation and pass
   * `presentable: false` at the next presence decision so the slot goes to someone else. */
  readonly unpresentable: readonly string[];
}

export interface CrowdPresenter {
  /** Applies a presence selection (at the decision tick) and the residents' current activities. */
  sync(selection: PresenceSelection, activities?: ReadonlyMap<string, CrowdActivity>): CrowdSyncReport;
  /** Bounded actor assembly only; no animation, clock advancement or rendering. */
  prepare(): number;
  update(deltaSeconds: number, frame: CrowdFrame): void;
  /** The clip plan a resident is presented with (null until loaded). */
  planFor(residentId: string): CrowdClipPlan | null;
  /** The actor set drawing a resident (null when none). */
  actorsFor(residentId: string): CrowdActorsLike | null;
  /** Exact visible, byte-verified held prop and socket; null for an unsupported or held pose. */
  emergencyPropFor(residentId: string, kind: EmergencyHeldProp['kind']): EmergencyHeldProp | null;
  /** Verified original source kit/placement, available without creating a visible actor. */
  loadEmergencyWorkpieceTemplate(residentId: string): Promise<EmergencyRepairEquipment | null>;
  /** Current existing placed prop only; never used as simulation availability. */
  emergencyWorkpieceFor(residentId: string): EmergencyWorkpiece | null;
  /** Resolves when every resident presence keeps loaded has loaded or failed (tests and measurement). */
  settled(): Promise<void>;
  readonly metrics: CrowdPresenterMetrics;
  /** Cached complete bounds in presenter-parent coordinates; includes held and placed props. Do not mutate. */
  completeBoundsFor(residentId: string): Box3 | null;
  readonly completeBounds: Box3;
  readonly disposed: boolean;
  dispose(): void;
}

interface PropRecord {
  readonly nodes: Object3D[];
  readonly emergency: readonly (EmergencyHeldProp | null)[];
  readonly workpieces: readonly (EmergencyWorkpiece | null)[];
  readonly triangles: number[]; readonly draws: number[];
  /** Per planned motion: 1 where the attachment shows. */
  readonly byMotion: Partial<Record<CrowdOwnerMotion, Uint8Array>>;
  shownFor: CrowdOwnerMotion | null;
  readonly localBounds: Box3;
}
interface SetRecord {
  actors: CrowdActorsLike; plan: CrowdClipPlan; frame: CrowdOwnerFrame; state: CrowdOwnerState; residents: CrowdOwnerState[];
  triangles: number; draws: number; face: { rig: ResidentFaceRig; pose: FacePose } | null;
  props: PropRecord | null;
  guardWatch:ReturnType<typeof createGuardWatchPoseCorrection>|null;
  readonly completeBounds: Box3;
  /** The motion shown last (the fallback for a guaranteed resident asked for a motion this set lacks). */
  shown: CrowdOwnerMotion;
  positioned: boolean;
}
interface Slot {
  readonly id: string; readonly resident: PopulationResident; readonly paths: ReturnType<typeof crowdResidentPaths>;
  status: 'idle' | 'loading' | 'ready' | 'failed'; token: number; holds: string[];
  verified: boolean; meta: CrowdResidentMeta | null; bound: CrowdTemplate | null; calibration: FaceCalibration | null;
  kits: Map<string, CrowdGltf>;
  decision: PresenceDecision | null; activity: CrowdActivity; plan: CrowdClipPlan | null;
  set: SetRecord | null; pending: boolean; previousClock: number | null; previousMode: string | null;
  last: { motion: CrowdOwnerMotion; position: [number, number, number]; yaw: number; strictMotionPlan: boolean };
}

export function createCrowdPresenter(options: CrowdPresenterOptions): CrowdPresenter {
  const population = options.population ?? EALDHOLT_VILLAGE_POPULATION;
  const port = options.loader ?? createDefaultCrowdLoader();
  const cache = createCrowdAssetCache(port);
  const ownerMotions = options.ownerMotions ?? CODEX_OWNER_MOTIONS.current;
  const maxSetups = Math.max(1, Math.floor(options.maxSetupsPerFrame ?? 1));
  const budget = Math.max(0, options.setupBudgetMilliseconds ?? 8), prefetchSets = options.prefetchSets !== false;
  const useProps = options.props !== false, trustPublished = options.trustPublishedEnvelopes !== false;
  const now = options.now ?? (() => performance.now());
  const faceDistance = options.faceDistanceMetres ?? 8, useEnvelopes = options.envelopes !== false;
  let animationMarkerEvents = 0, animationLifecycleEvents = 0;
  const observeAnimation = (event: ResidentAnimationEvent) => { if (event.kind === 'marker') animationMarkerEvents++; else animationLifecycleEvents++; options.onAnimationEvent?.(event); };
  const root = options.root.endsWith('/') ? options.root : options.root + '/';
  const integrity = Object.freeze({ ...options.integritySha256 });
  for (const [path, hash] of Object.entries(integrity)) {
    if (!path || path.startsWith('/') || path.split('/').some(p => p === '..') || !validHash(hash)) throw Error('Crowd integrity registry has an invalid entry.');
  }
  const expected = (path: string) => integrity[path];
  const completeBounds = new Box3(), propWorldBounds = new Box3(), placementMatrix = new Matrix4();
  const placementPosition = new Vector3(), placementScale = new Vector3(), placementRotation = new Quaternion(), up = new Vector3(0, 1, 0);
  const libraries = new Map<string, Promise<CrowdLibrary>>();
  const emergencyEquipment = new Map<string, Promise<EmergencyRepairEquipment | null>>();
  const slots: Slot[] = [], byId = new Map<string, Slot>();
  for (const r of population.residents) {
    if (r.appearance.kind !== 'crowd') continue;
    const slot: Slot = { id: r.id, resident: r, paths: crowdResidentPaths(r.id, r.appearance.archetype), status: 'idle', token: 0, holds: [],
      verified: false, meta: null, bound: null, calibration: null, kits: new Map(), decision: null, activity: {}, plan: null, set: null, pending: false,
      previousClock: null, previousMode: null, last: { motion: 'idle', position: [0, 0, 0], yaw: 0, strictMotionPlan: false } };
    slots.push(slot); byId.set(r.id, slot);
  }
  const inflight = new Set<Promise<void>>();
  let disposed = false, setups = 0, setupTotal = 0, setupMax = 0, bindTotal = 0, envelopeSamples = 0, libraryLoads = 0, unpresentable = 0;
  let evaluated = 0, suspended = 0, fallbackFrames = 0, prefetchSetups = 0, setupFrameMax = 0, publishedEnvelopeSetups = 0;
  /** Running estimate of one set's set-up time (ms), from the sets created so far; null until the first. */
  let setupEstimate: number | null = null;
  const candidates: Slot[] = [];

  const report = (id: string, error: unknown) => { if (options.onError) options.onError(id, error); };
  function library(path: string): Promise<CrowdLibrary> {
    const url = root + path;
    let p = libraries.get(url);
    if (!p) {
      libraryLoads++;
      // the library stays acquired for the presenter's lifetime: six files, shared by every resident of an archetype
      p = cache.acquire(url, expected(path)).then(prepareCrowdLibrary);
      p.catch(() => { if (libraries.get(url) === p) libraries.delete(url); });
      libraries.set(url, p);
    }
    return p;
  }
  function disposeSet(slot: Slot): void {
    const set = slot.set; if (!set) return;
    slot.set = null;
    set.face?.rig.dispose();
    set.actors.dispose(); set.actors.drainAnimationEvents?.(observeAnimation); set.actors.object.removeFromParent();
  }
  function unload(slot: Slot): void {
    disposeSet(slot);
    slot.token++; slot.pending = false; slot.status = slot.status === 'failed' ? 'failed' : 'idle';
    for (const url of slot.holds) cache.release(url);
    slot.holds = []; slot.verified = false; slot.bound = null; slot.plan = null; slot.kits.clear();
  }
  function load(slot: Slot): void {
    const token = ++slot.token; slot.status = 'loading';
    const job = (async () => {
      const parsed = parseCrowdResidentMeta(await cache.json(root + slot.paths.json, expected(slot.paths.json)), slot.id);
      const candidate = useProps ? publishedGuardWatch(slot.id) : null;
      // Legacy/unverified loader ports retain their original clip/prop path.
      // New work presentation still cannot plan absent compact clips.
      const addon = candidate && expected(candidate.file) === candidate.sources[candidate.file] ? candidate : null;
      if (addon && Object.entries(addon.sources).some(([path,hash])=>expected(path)!==hash))
        throw Error('Guard addon integrity registry differs from its measured sources.');
      const meta = communityWoodCrowdMeta(parsed);
      if (token !== slot.token || disposed) return;
      if (meta.archetype !== slot.resident.appearance.archetype) throw Error(`Crowd resident ${slot.id} archetype differs from the population.`);
      const residentUrl = root + slot.paths.glb, libraryUrl = root + slot.paths.library;
      const kitEntries = useProps && meta.presentation ? Object.entries(meta.presentation.kits) : [];
      const acquired: string[] = [];
      const take = (path: string) => { const url = root + path; acquired.push(url); return cache.acquire(url, expected(path)); };
      let gltf: CrowdGltf, lib: CrowdLibrary, kitGltfs: CrowdGltf[];
      try {
        [gltf, lib, kitGltfs] = await Promise.all([take(slot.paths.glb), library(slot.paths.library), Promise.all(kitEntries.map(([, path]) => take(path)))]);
      } catch (error) { for (const url of acquired) cache.release(url); throw error; }
      if (token !== slot.token || disposed) { for (const url of acquired) cache.release(url); return; }
      if (addon) {
        try { lib = prepareGuardWatchLibrary(lib, await library(addon.file)); }
        catch (error) { for (const url of acquired) cache.release(url); throw error; }
        if (token !== slot.token || disposed) { for (const url of acquired) cache.release(url); return; }
      }
      slot.holds.push(...acquired);
      kitEntries.forEach(([kit], i) => slot.kits.set(kit, kitGltfs[i]));
      const started = now();
      slot.bound = bindCrowdTemplate(gltf, lib, !!addon); slot.meta = meta;
      slot.verified = cache.verified(root + slot.paths.json) && cache.verified(residentUrl) && cache.verified(libraryUrl)
        && kitEntries.every(([, path]) => cache.verified(root + path)) && (!addon || cache.verified(root+addon.file)); slot.calibration = crowdFaceCalibration(meta);
      bindTotal += now() - started;
      slot.status = 'ready'; replan(slot);
    })().catch(error => {
      if (token !== slot.token) return;
      slot.status = 'failed'; report(slot.id, error);
      for (const url of slot.holds) cache.release(url); slot.holds = []; slot.kits.clear();
    });
    const tracked = job.finally(() => inflight.delete(tracked)); inflight.add(tracked);
  }
  function replan(slot: Slot): void {
    if (!slot.meta || !slot.bound) return;
    const plan = planCrowdClips(slot.meta, slot.bound.library.names, slot.activity, ownerMotions);
    if (slot.plan && slot.plan.key === plan.key) { slot.plan = plan; return; }
    slot.plan = plan;
    if (slot.decision && (slot.decision.mode !== 'hidden' || slot.decision.keepLoaded)) slot.pending = true;
  }
  function attachProps(slot: Slot, actor: CrowdActorsLike['actors'][number], plan: CrowdPropPlan): PropRecord | null {
    const model = actor.model;
    if (!plan.attachments.length) return null;
    const nodes: Object3D[] = [], triangles: number[] = [], draws: number[] = [], emergency: (EmergencyHeldProp | null)[] = [], workpieces: (EmergencyWorkpiece | null)[] = [];
    const localBounds = new Box3(), clips = Object.values(slot.plan!.clips).map(name => slot.bound!.library.clip(name!));
    const bones = new Map<string, Object3D | null>();
    for (const a of plan.attachments) {
      const source = slot.kits.get(a.kit)?.scene.getObjectByName(a.node) ?? null;
      let parent: Object3D | null = model;
      if (a.bone) { if (!bones.has(a.bone)) bones.set(a.bone, model.getObjectByName(a.bone) ?? null); parent = bones.get(a.bone)!; }
      if (!source || !parent) throw Error(`Crowd prop ${a.prop} (${a.node}${a.bone ? ' on ' + a.bone : ''}) cannot be attached.`);
      const node = source.clone(true);   // shares the kit's geometry and material; the kit file owns and disposes them
      node.matrixAutoUpdate = false; node.matrix.fromArray(a.matrix as number[]); node.matrixWorldNeedsUpdate = true; node.visible = false;
      let t = 0, d = 0;
      node.traverse(n => {
        if (!(n instanceof Mesh)) return;
        const index = n.geometry.getIndex(), position = n.geometry.getAttribute('position');
        t += (index ? index.count : position.count) / 3; d += Array.isArray(n.material) ? n.material.length : 1;
      });
      localBounds.union(crowdAttachedPropBounds(model, node, parent, clips));
      parent.add(node); nodes.push(node); triangles.push(Math.round(t)); draws.push(d);
      const kitPath = slot.meta!.presentation?.kits[a.kit], kitSha = kitPath ? expected(kitPath) : undefined;
      const socket = slot.verified && kitSha && (a.bone === 'hand_l' || a.bone === 'hand_r') ? emergencyPropSocket(a.prop, kitSha) : null;
      emergency.push(socket && kitPath ? Object.freeze({ ...socket, residentId: slot.id,
        rigId: slot.paths.glb + '@' + expected(slot.paths.glb), sourceAssetId: kitPath + '@' + kitSha,
        clipId: a.prop === 'bucket' ? 'carry_bucket_walk' : a.prop === 'chisel' ? 'work_chisel' : 'work_hammer_bench',
        node, actor, completeEnvelopeQualified: true as const }) : null);
      const workpiece = slot.verified && kitSha && a.bone === null ? emergencyWorkpieceSocket(a.prop, kitSha) : null;
      workpieces.push(workpiece && kitPath && a.node === workpiece.nodeName ? Object.freeze({ residentId: slot.id,
        sourceAssetId: kitPath + '@' + kitSha, clipId: workpiece.clipId, node, actor, point: workpiece.point, radiusMetres: workpiece.radiusMetres }) : null);
    }
    const byMotion: Partial<Record<CrowdOwnerMotion, Uint8Array>> = {};
    for (const [motion, shown] of Object.entries(plan.visible) as [CrowdOwnerMotion, readonly number[]][]) {
      const mask = new Uint8Array(nodes.length); for (const i of shown) mask[i] = 1; byMotion[motion] = mask;
    }
    return { nodes, emergency, workpieces, triangles, draws, byMotion, shownFor: null, localBounds };
  }
  function showProps(props: PropRecord | null, motion: CrowdOwnerMotion): void {
    if (!props || props.shownFor === motion) return;
    const mask = props.byMotion[motion];
    for (let i = 0; i < props.nodes.length; i++) props.nodes[i].visible = !!mask && mask[i] === 1;
    props.shownFor = motion;
  }
  function createSet(slot: Slot): number {
    const bound = slot.bound!, plan = slot.plan!, meta = slot.activity.guardWatch ? guardWatchCrowdMeta(slot.meta!) : slot.meta!;
    const clips = {} as { idle: AnimationClip } & Partial<Record<CrowdOwnerMotion, AnimationClip>>;
    const envelopes: Partial<Record<CrowdOwnerMotion, CrowdEnvelope>> = {};
    let published = useEnvelopes && slot.verified && !!meta.envelopes?.gated;
    const started = now();
    for (const [motion, name] of Object.entries(plan.clips) as [CrowdOwnerMotion, string][]) {
      clips[motion] = bound.library.clip(name);
      if (!useEnvelopes) continue;
      // the publisher's envelope (gated offline against the densely sampled skin) when it has one; else sample here
      const given = published ? meta.envelopes?.byClip[name] : undefined;
      if (given) envelopes[motion] = given; else { envelopes[motion] = crowdClipEnvelope(bound, name); published = false; }
    }
    const markers: Partial<Record<CrowdOwnerMotion, readonly ResidentAnimationMarker[]>> = {};
    const librarySha = expected(slot.paths.library);
    // Exact authored source timing, never inferred contact fractions.
    if (slot.verified && (librarySha === 'ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5'
      || librarySha === '42cc4203942b8d7a657d814b6c85471b7d23ba4078ea573448105e187b2e6ddf')) {
      for (const [motion, name] of Object.entries(plan.clips) as [CrowdOwnerMotion, string][]) {
        if (Math.abs(clips[motion]!.duration - 2.4) > 1e-5) continue;
        const times = name === 'work_hammer_bench' ? [.64, 1.44, 2.24] : name === 'work_chisel' ? [.6, 1.2, 1.8, 2.4] : name===COMMUNITY_WOOD_CLIP&&librarySha==='ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5'?COMMUNITY_WOOD_IMPACTS:null;
        if (times) markers[motion] = householdResidentAnimationMarkers({ impactSeconds: times });
      }
    }
    const trust = published && trustPublished && !!meta.envelopes?.gated;
    const idle = clips.idle, phase = hashUnit(faceSeed(slot.id), 7) * idle.duration;
    const actors = options.createActors(bound.template, [{ residentId: slot.id, position: slot.last.position, yawRadians: slot.last.yaw,
      scale: meta.placementScale, phaseSeconds: phase }], useEnvelopes ? (trust ? { clips, envelopes, trustEnvelopes: true, markers } : { clips, envelopes, markers }) : { clips, markers });
    const model = actors.actors[0].model;
    let props: PropRecord | null,guardWatch:SetRecord['guardWatch']=null;
    try { props = useProps ? attachProps(slot, actors.actors[0], planCrowdProps(meta.presentation, plan)) : null;
      if(slot.activity.guardWatch){
        const spec=publishedGuardWatch(slot.id);if(!spec||!props)throw Error('Guard watch needs its verified rig and actual held spear.');
        guardWatch=createGuardWatchPoseCorrection(model,spec);
      }
    }
    catch (error) { actors.dispose(); actors.object.removeFromParent(); throw error; }
    const elapsed = now() - started;
    setups++; setupTotal += elapsed; setupMax = Math.max(setupMax, elapsed); envelopeSamples += actors.metrics.envelopeSamples;
    if (trust) publishedEnvelopeSetups++;
    setupEstimate = setupEstimate === null ? elapsed : setupEstimate * 0.7 + elapsed * 0.3;
    const old = slot.set;
    const state: CrowdOwnerState = { residentId: slot.id, motion: 'idle', animationUpdateIntervalSeconds: 0 };
    const residents = [state];
    let face: SetRecord['face'] = null;
    if (faceDistance > 0) {
      try { const rig = bindResidentFaceRig(model); face = rig.tier === 'none' ? (rig.dispose(), null) : { rig, pose: createFacePose() }; }
      catch (error) { report(slot.id, error); }
    }
    slot.set = { actors, plan, frame: { clockSeconds: 0, paused: false, reducedMotion: false, residents }, state, residents,
      triangles: bound.triangles, draws: bound.drawsPerActor, face, props,
      guardWatch,
      completeBounds: new Box3(), shown: 'idle', positioned: false };
    refreshBounds(slot);
    showProps(props, 'idle');
    options.parent.add(actors.object);
    // Assembly may run between world frames: expose neither a rest pose at
    // the origin nor its unpositioned bounds as an already presented resident.
    actors.object.visible = false;
    if (old) { old.face?.rig.dispose(); old.actors.dispose(); old.actors.drainAnimationEvents?.(observeAnimation); old.actors.object.removeFromParent(); }
    slot.pending = false; slot.previousClock = null;
    return elapsed;
  }
  function refreshBounds(slot: Slot): void {
    const set = slot.set; if (!set) return;
    set.completeBounds.copy(set.actors.bounds);
    if (set.props && !set.props.localBounds.isEmpty()) {
      placementPosition.set(...slot.last.position); placementScale.setScalar(slot.meta!.placementScale);
      placementRotation.setFromAxisAngle(up, slot.last.yaw);
      placementMatrix.compose(placementPosition, placementRotation, placementScale);
      const model = set.actors.actors[0].model; model.updateMatrix(); placementMatrix.multiply(model.matrix);
      set.completeBounds.union(propWorldBounds.copy(set.props.localBounds).applyMatrix4(placementMatrix));
    }
  }
  function refreshAggregateBounds(): void {
    completeBounds.makeEmpty();
    for (const slot of slots) if (slot.set?.actors.object.visible) completeBounds.union(slot.set.completeBounds);
  }
  const drawnNow = (slot: Slot) => slot.decision !== null && slot.decision.mode !== 'hidden';

  function prepare(): number {
    if (disposed) return 0;
    // set creation against the frame budget: drawn residents first (highest presence priority first, at least one a
    // frame), then residents in the prefetch ring while the measured set-up cost fits what is left of the budget
    candidates.length = 0;
    for (const slot of slots) if (slot.pending && slot.status === 'ready' && slot.decision && (drawnNow(slot) || (prefetchSets && slot.decision.keepLoaded))) candidates.push(slot);
    if (candidates.length > 1) candidates.sort((a, b) => (Number(drawnNow(b)) - Number(drawnNow(a))) || (b.decision!.priority - a.decision!.priority) || (a.id < b.id ? -1 : 1));
    let created = 0, spent = 0;
    for (const slot of candidates) {
      if (created >= maxSetups) break;
      const mustDraw = drawnNow(slot) && created === 0;
      if (!mustDraw && spent + (setupEstimate ?? budget) > budget) break;
      try { spent += createSet(slot); created++; if (!drawnNow(slot)) prefetchSetups++; }
      catch (error) { slot.pending = false; slot.status = 'failed'; report(slot.id, error); unload(slot); slot.status = 'failed'; }
    }
    setupFrameMax = Math.max(setupFrameMax, spent);
    return created;
  }

  const presenter: CrowdPresenter = {
    prepare,
    sync(selection, activities) {
      const unpresentableIds: string[] = [];
      if (disposed) return { unpresentable: unpresentableIds };
      for (const slot of slots) {
        const d = selection.decisions[slot.id] ?? null;
        slot.decision = d;
        if (activities) {
          const next = activities.get(slot.id) ?? {};
          if ((next.roleClip ?? null) !== (slot.activity.roleClip ?? null) || !!next.seated !== !!slot.activity.seated
            || !!next.guardWatch !== !!slot.activity.guardWatch) { slot.activity = next; replan(slot); }
        }
        if (slot.plan?.unpresentable) unpresentableIds.push(slot.id);
        const drawn = d !== null && d.mode !== 'hidden', keep = d !== null && (drawn || d.keepLoaded);
        if (!keep) { if (slot.status !== 'idle' || slot.set) unload(slot); continue; }
        if (slot.status === 'idle') load(slot);
        if (slot.status === 'ready' && (!slot.set || slot.set.plan.key !== slot.plan?.key)) slot.pending = true;
        if (slot.set) slot.set.actors.object.visible = drawn && slot.set.positioned && !slot.plan?.unpresentable;
        if (d && slot.previousMode !== d.mode) { slot.previousClock = null; slot.previousMode = d.mode; }
      }
      refreshAggregateBounds();
      return { unpresentable: unpresentableIds };
    },
    update(deltaSeconds, frame) {
      if (disposed) return;
      evaluated = 0; suspended = 0;
      prepare();
      for (const slot of slots) {
        const set = slot.set, d = slot.decision;
        if (!set || !d) continue;
        const given = frame.residents.get(slot.id);
        if (given) {
          slot.last.motion = given.motion; slot.last.yaw = given.yawRadians; slot.last.strictMotionPlan = given.strictMotionPlan === true;
          slot.last.position[0] = given.position[0]; slot.last.position[1] = given.position[1]; slot.last.position[2] = given.position[2];
        }
        if (d.mode === 'hidden') { set.actors.object.visible = false; continue; }
        let motion = slot.last.motion;
        const workRequested = motion === 'work' || motion === 'workEnter' || motion === 'workExit';
        const roleRequested = slot.activity.roleClip != null;
        const actualClip = set.plan.clips[motion], wantedClip = slot.plan?.clips[motion];
        // A near/engaged presence guarantee cannot turn a missing occupation into idle, a previous role, or a plain
        // walking clip. Report the held role through sync/unpresentableFrames and wait for a matching valid set.
        if (slot.plan?.unpresentable || (slot.last.strictMotionPlan && (set.plan.key !== slot.plan?.key || !actualClip || actualClip !== wantedClip)) || ((workRequested || roleRequested) && (!actualClip || actualClip !== wantedClip))) {
          unpresentable++; set.actors.object.visible = false; slot.previousClock = null; continue;
        }
        if (ownerMotions.indexOf(motion) < 0 || !actualClip) {
          // Preserve the existing visibility fallback only for ordinary non-role presentation requests.
          if (slot.last.strictMotionPlan || !isGuaranteedPresence(d)) { unpresentable++; set.actors.object.visible = false; continue; }
          fallbackFrames++; motion = set.shown in set.plan.clips ? set.shown : 'idle';
        }
        set.actors.object.visible = true; set.shown = motion;
        showProps(set.props, motion);
        const due = lowRateDue(d, slot.previousClock, frame.clockSeconds);
        slot.previousClock = frame.clockSeconds;
        const s = set.state;
        s.motion = motion; s.position = slot.last.position; s.yawRadians = slot.last.yaw;
        s.animationTimeSeconds = given?.animationTimeSeconds; s.animationTimeMode = given?.animationTimeMode; s.animationPlaybackId = given?.animationPlaybackId; s.fadeSeconds = slot.last.strictMotionPlan ? 0 : given?.fadeSeconds;
        const evaluatedActor=set.actors.actors[0],guardSpec=set.guardWatch?publishedGuardWatch(slot.id):null;
        if(guardSpec && !slot.last.strictMotionPlan){
          const previousClip=set.plan.clips[evaluatedActor.activeMotion as CrowdOwnerMotion];
          const previous=previousClip&&evaluatedActor.mixer?.existingAction(slot.bound!.library.clip(previousClip));
          if(motion==='walk'&&evaluatedActor.activeMotion!==motion)s.animationTimeSeconds=0;
          if(evaluatedActor.activeMotion!==motion)s.fadeSeconds=guardWatchTransitionFade(evaluatedActor.activeMotion,previous ? previous.time ?? null : null,motion,
            s.animationTimeSeconds,!!evaluatedActor.fadingFrom,set.positioned,guardSpec.seconds,guardSpec.fadeSeconds);
          // Complete an accepted <=120ms fade on the owner's evaluated clock,
          // independently of slower read-only sample publication. Afterwards
          // the explicit current world-clock pose resumes; no life state moves.
          if(evaluatedActor.activeMotion===motion&&evaluatedActor.fadingFrom)s.animationTimeSeconds=undefined;
        }
        // A frozen distant guard may adopt its newly selected authored phase
        // once. It never exposes the setup idle in place of a watch transition.
        const adoptGuardPhase=!!set.guardWatch&&set.actors.actors[0].activeMotion!==motion;
        // A newly streamed, qualified body adopts its current source placement
        // and requested pose once, including during Hold or a suspended cadence.
        const initializePose=!set.positioned;
        s.animationUpdateIntervalSeconds = initializePose||due||adoptGuardPhase||!!(set.guardWatch&&evaluatedActor.fadingFrom) ? 0 : null;
        if (initializePose||due||adoptGuardPhase||!!(set.guardWatch&&evaluatedActor.fadingFrom)) evaluated++; else suspended++;
        set.frame.clockSeconds = frame.clockSeconds; set.frame.paused = frame.paused; set.frame.reducedMotion = frame.reducedMotion;
        set.frame.initializePausedPose=initializePose?true:undefined;
        // These synchronized authored transitions use world seconds. Other
        // plans retain the resident's published variation rate unchanged.
        const rate = set.guardWatch ? 1 : slot.meta ? slot.meta.motion.rate : 1;
        set.guardWatch?.restore();
        set.actors.update(Math.min(1, Math.max(0, deltaSeconds * rate)), set.frame);
        set.actors.drainAnimationEvents?.(observeAnimation);
        if(set.guardWatch){
          const actor=set.actors.actors[0],clip=set.plan.clips[actor.activeMotion as CrowdOwnerMotion];
          const action=clip&&actor.mixer?.existingAction(slot.bound!.library.clip(clip));
          const correction=action?set.guardWatch.apply(actor.activeMotion,action.time):null;
          if(!correction?.ok){unpresentable++;set.actors.object.visible=false;slot.previousClock=null;continue;}
        }
        set.positioned = true;
        if (set.face && due && !frame.paused && d.distanceMetres <= faceDistance) {
          evaluateFacePose({ timeSeconds: frame.clockSeconds, seed: faceSeed(slot.id), reducedMotion: frame.reducedMotion,
            sensitivity: slot.resident.influenceSensitivity, talking: given?.talking ?? motion === 'talk' }, slot.calibration!, set.face.pose);
          set.face.rig.apply(set.face.pose);
        }
        refreshBounds(slot);
      }
      refreshAggregateBounds();
    },
    planFor(id) { return byId.get(id)?.plan ?? null; },
    actorsFor(id) { return byId.get(id)?.set?.actors ?? null; },
    emergencyPropFor(id, kind) {
      const slot = byId.get(id), set = slot?.set, actor = set?.actors.actors[0], execution = actor?.animationExecution;
      if (!slot?.verified || !set?.positioned || !set.actors.object.visible || set.actors.disposed || actor?.status !== 'ready'
        || actor.fadingFrom || !execution || execution.requestedMotion !== actor.activeMotion
        || execution.state !== 'playing' || execution.hold !== 'none' && execution.hold !== 'paused' && execution.hold !== 'reduced-motion') return null;
      for (const proof of set.props?.emergency ?? []) if (proof?.kind === kind && proof.node.visible
        && proof.clipId === execution.clipId && set.plan.clips[actor.activeMotion as CrowdOwnerMotion] === proof.clipId) return proof;
      return null;
    },
    loadEmergencyWorkpieceTemplate(id) {
      const existing = emergencyEquipment.get(id); if (existing) return existing;
      const slot = byId.get(id); if (!slot || !useProps || disposed) return Promise.resolve(null);
      const request = (async (): Promise<EmergencyRepairEquipment | null> => {
        const metaSha = expected(slot.paths.json), bodySha = expected(slot.paths.glb), librarySha = expected(slot.paths.library);
        if (!metaSha || !bodySha || librarySha !== 'ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5'
          && librarySha !== '42cc4203942b8d7a657d814b6c85471b7d23ba4078ea573448105e187b2e6ddf') return null;
        const meta = parseCrowdResidentMeta(await cache.json(root + slot.paths.json, metaSha), id);
        if (disposed || !cache.verified(root + slot.paths.json) || meta.archetype !== slot.resident.appearance.archetype
          || !meta.motion.roleClips.includes('work_chisel')) return null;
        const placement = meta.presentation?.clips.work_chisel?.placed.find(p => p.prop === 'stone-block' && p.bone === null);
        const assetPath = placement && meta.presentation?.kits[placement.kit], sha = assetPath && expected(assetPath);
        const socket = placement && sha && emergencyWorkpieceSocket(placement.prop, sha);
        if (!placement || !assetPath || !sha || !socket || placement.node !== socket.nodeName) return null;
        const source = await cache.acquire(root + assetPath, sha);
        if (disposed || !cache.verified(root + assetPath)) return null;
        const template = source.scene.getObjectByName(placement.node);
        if (!template) return null;
        const files = Object.freeze({ [slot.paths.json]: metaSha, [slot.paths.glb]: bodySha,
          [slot.paths.library]: librarySha, [assetPath]: sha });
        return Object.freeze({ residentId: id, assetPath, sourceSha256: sha, template,
          localPlacementMatrix: Object.freeze([...placement.matrix]), localContactPoint: socket.point,
          placementScale: meta.placementScale, clipId: socket.clipId, contactMarkerSeconds: socket.impactSeconds, files });
      })();
      emergencyEquipment.set(id, request);
      request.catch(() => { if (emergencyEquipment.get(id) === request) emergencyEquipment.delete(id); });
      return request;
    },
    emergencyWorkpieceFor(id) {
      const slot = byId.get(id), set = slot?.set, actor = set?.actors.actors[0], execution = actor?.animationExecution;
      if (!slot?.verified || !set?.positioned || !set.actors.object.visible || set.actors.disposed || actor?.status !== 'ready'
        || actor.fadingFrom || !execution || execution.state !== 'playing' || execution.clipId !== 'work_chisel'
        || execution.requestedMotion !== actor.activeMotion
        || execution.hold !== 'none' && execution.hold !== 'paused' && execution.hold !== 'reduced-motion') return null;
      for (const piece of set.props?.workpieces ?? []) if (piece && piece.node.visible
        && set.plan.clips[actor.activeMotion as CrowdOwnerMotion] === piece.clipId) return piece;
      return null;
    },
    completeBoundsFor(id) { const set = byId.get(id)?.set; return set?.positioned ? set.completeBounds : null; },
    get completeBounds() { return completeBounds; },
    async settled() { while (inflight.size) await Promise.all([...inflight]); },
    get metrics() {
      const animation = { ready: 0, playing: 0, finishing: 0, completed: 0, failed: 0, held: 0,
        markerEvents: animationMarkerEvents, lifecycleEvents: animationLifecycleEvents, droppedEvents: 0 };
      let loading = 0, ready = 0, failed = 0, sets = 0, drawn = 0, animated = 0, lowRate = 0, posed = 0, triangles = 0, draws = 0;
      let propsDrawn = 0, propTriangles = 0, propDraws = 0;
      for (const slot of slots) {
        if (slot.status === 'loading') loading++; else if (slot.status === 'ready') ready++; else if (slot.status === 'failed') failed++;
        if (slot.set) {
          for (const actor of slot.set.actors.actors) {
            const execution = actor.animationExecution;
            if (!execution) continue;
            if (execution.state === 'ready' || execution.state === 'playing' || execution.state === 'finishing' || execution.state === 'completed' || execution.state === 'failed') animation[execution.state]++;
            if (execution.hold !== 'none') animation.held++;
            animation.droppedEvents += execution.droppedEvents;
          }
          sets++;
          if (slot.set.actors.object.visible) {
            drawn++; triangles += slot.set.triangles; draws += slot.set.draws;
            const mode = slot.decision?.mode; if (mode === 'animated') animated++; else if (mode === 'low-rate') lowRate++; else if (mode === 'posed') posed++;
            const p = slot.set.props;
            if (p) for (let i = 0; i < p.nodes.length; i++) if (p.nodes[i].visible) { propsDrawn++; propTriangles += p.triangles[i]; propDraws += p.draws[i]; }
          }
        }
      }
      return { animation, crowdResidents: slots.length, loading, ready, failed, actorSets: sets, drawn, animated, lowRate, posed, evaluated, suspended,
        trianglesDrawn: triangles, drawCallsDrawn: draws, setups, setupMillisecondsTotal: setupTotal, setupMillisecondsMax: setupMax,
        bindMillisecondsTotal: bindTotal, envelopeSamples, libraryLoads, unpresentableFrames: unpresentable, assets: cache.stats,
        fallbackFrames, propsDrawn, propTrianglesDrawn: propTriangles, propDrawCallsDrawn: propDraws, prefetchSetups,
        setupFrameMillisecondsMax: setupFrameMax, publishedEnvelopeSetups };
    },
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return; disposed = true;
      options.signal?.removeEventListener('abort', abort);
      completeBounds.makeEmpty();
      for (const slot of slots) unload(slot);
      libraries.clear(); emergencyEquipment.clear(); cache.dispose();
    },
  };
  const abort = () => presenter.dispose();
  if (options.signal?.aborted) presenter.dispose(); else options.signal?.addEventListener('abort', abort, { once: true });
  return presenter;
}

// ------------------------------------------------------------------ platform loader (desktop)

/** Disposes a loaded GLB's geometry, materials, textures, skeleton bone textures and decoded image bitmaps. */
export function disposeCrowdGltf(gltf: CrowdGltf): void {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>(), skeletons = new Set<Skeleton>();
  gltf.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    const image: unknown = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  }
  gltf.scene.removeFromParent();
}

const CROWD_ASSET_BYTE_LIMIT = 32 * 1024 * 1024;
/** Hash the same bytes the platform parser consumes, not a separate preflight.
 * The browser's normal HTTP cache serves repeat visits (35 MB for the crowd,
 * audit L-07); a cached copy that fails the hash is fetched again once,
 * bypassing the cache, before the asset is refused. */
export async function fetchVerifiedCrowdBytes(url: string, expectedSha256: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  if (!validHash(expectedSha256)) throw Error('Crowd asset requires an authoritative SHA-256.');
  const read = async (cache: RequestCache) => {
    const response = await fetcher(url, { signal, cache, credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw Error(`Crowd asset request failed: ${response.status}.`);
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || +length > CROWD_ASSET_BYTE_LIMIT)) throw Error('Crowd asset exceeds its byte budget.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > CROWD_ASSET_BYTE_LIMIT) throw Error('Crowd asset exceeds its byte budget.');
    signal?.throwIfAborted();
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return actual === expectedSha256.toLowerCase() ? bytes : null;
  };
  const bytes = await read('default') ?? await read('reload');
  if (!bytes) throw Error('Crowd asset SHA-256 does not match the authoritative registry.');
  signal?.throwIfAborted(); return bytes;
}
function assertSelfContainedCrowdGlb(bytes: ArrayBuffer): void {
  const d = new DataView(bytes);
  if (bytes.byteLength < 20 || d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2
    || d.getUint32(8, true) !== bytes.byteLength || d.getUint32(16, true) !== 0x4e4f534a || d.getUint32(12, true) > bytes.byteLength - 20)
    throw Error('Crowd asset must be a complete GLB2.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, d.getUint32(12, true)))) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  for (const rows of [json.buffers, json.images]) for (const item of rows ?? [])
    if (item.uri !== undefined && (typeof item.uri !== 'string' || !item.uri.startsWith('data:'))) throw Error('Verified crowd GLBs must be self-contained.');
}
async function verifiedCrowdJson(url: string, hash: string, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await fetchVerifiedCrowdBytes(url, hash, signal)));
}

export function createDefaultCrowdLoader(): CrowdLoaderPort {
  const loader = new GLTFLoader();
  return {
    loadGltf: url => loader.loadAsync(url),
    async loadVerifiedGltf(url, hash, signal) {
      const bytes = await fetchVerifiedCrowdBytes(url, hash, signal); assertSelfContainedCrowdGlb(bytes);
      const base = new URL('.', new URL(url, globalThis.location?.href ?? 'http://localhost/')).href;
      const gltf = await loader.parseAsync(bytes, base);
      if (signal?.aborted) { disposeCrowdGltf(gltf); signal.throwIfAborted(); }
      return gltf;
    },
    releaseGltf: (_url, gltf) => disposeCrowdGltf(gltf),
    async loadJson(url) { const response = await fetch(url); if (!response.ok) throw Error(`Crowd manifest ${url}: ${response.status}`); return response.json(); },
    loadVerifiedJson: verifiedCrowdJson,
  };
}
