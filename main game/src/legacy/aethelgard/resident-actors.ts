import { AnimationMixer, Box3, Group, InterpolateDiscrete, InterpolateLinear, LoopOnce, LoopRepeat, Matrix4,
  Mesh, PropertyBinding, Quaternion, Skeleton, SkinnedMesh, Vector3,
  type AnimationAction, type AnimationClip, type Camera, type Object3D } from 'three';
import { ResidentAnimationExecution, qualifyResidentAnimationClip, type ResidentAnimationClip,
  type ResidentAnimationExecutionSnapshot, type ResidentAnimationEvent, type ResidentAnimationMarker } from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';

/** Loops: idle, talk, walk, sit, work. One-shot transitions play once and hold their last frame: start (idle into
 * walk), stop (walk into idle), sitDown (idle into sit), standUp (sit into idle), workEnter (idle or sit into work)
 * and workExit (work back out). The caller sequences them: it knows each clip's duration and selects the next motion
 * when its own clock reaches it. Execution and optional authored marker events are cosmetic only;
 * this owner never completes a duty, advances a save or displaces the route placement. */
export type EaldholtResidentMotion = 'idle' | 'talk' | 'walk' | 'sit' | 'work' | 'start' | 'stop' | 'sitDown' | 'standUp' | 'workEnter' | 'workExit';
/** A motion's animated envelope measured offline (the asset pipeline's manifest), in the resident's model frame. */
export interface EaldholtResidentEnvelope { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
export interface EaldholtResidentTemplate { readonly scene: Object3D; readonly animations: readonly AnimationClip[] }
export interface EaldholtResidentPlacement {
  readonly residentId: string; readonly position: readonly [number, number, number]; readonly yawRadians: number;
  readonly scale?: number; readonly phaseSeconds?: number;
}
export interface EaldholtResidentFrameState {
  readonly residentId: string; readonly motion: EaldholtResidentMotion;
  readonly position?: readonly [number, number, number]; readonly yawRadians?: number;
  /** Explicit selected-clip timeline, in seconds. A route can derive this from
   * travelled distance to align steps; it overrides the placement phase offset.
   * Omission resumes delta-based animation from the latest accepted phase,
   * including phases held by the cadence. This never advances a save. */
  readonly animationTimeSeconds?: number;
  /** Absolute samples are pose-only seeks by default. 'advance' explicitly
   * certifies forward clip progress for cosmetic marker crossings. */
  readonly animationTimeMode?: 'seek' | 'advance';
  /** Change this stable token to replay the same motion as a new request. A seek
   * alone never re-arms already crossed markers or a completed request. */
  readonly animationPlaybackId?: string;
  /** Presentation cadence only: 0/omitted evaluates every frame, a positive
   * interval throttles pose evaluation, null suspends it. Identity, placement
   * and conservative bounds remain present. Logical clip time keeps advancing
   * while evaluation is suspended. Pause/reduced motion discard their delta. */
  readonly animationUpdateIntervalSeconds?: number | null;
  /** Crossfade, in seconds (0..2), applied when this frame changes the evaluated motion: the previous motion keeps
   * advancing with the frame delta while its weight falls linearly to zero and the new motion's rises. 0/omitted cuts
   * (the original behaviour); reduced motion always cuts. A change during a fade fades from the motion that was
   * fading in (the older pose is dropped). While fading, bounds are the owner's rotation-independent reach box. */
  readonly fadeSeconds?: number;
}
/** Caller reuses this DTO; the owner reads no clock, schedule, save or world singleton. */
export interface EaldholtResidentFrame {
  readonly clockSeconds: number; readonly paused: boolean; readonly reducedMotion: boolean;
  /** A cold, externally qualified streamed actor may adopt its current frozen
   * pose while paused. Delta is forced to zero; this advances no animation. */
  readonly initializePausedPose?:true;
  readonly residents: readonly EaldholtResidentFrameState[];
}
export interface EaldholtResidentActor {
  readonly residentId: string; readonly placement: Group; readonly model: Object3D; readonly mixer: AnimationMixer;
  readonly requestedMotion: EaldholtResidentMotion;
  /** Last evaluated pose and envelope; cadence may defer a requested change. */
  readonly activeMotion: EaldholtResidentMotion;
  /** Motion still fading out of the evaluated pose; null when no crossfade is in progress. */
  readonly fadingFrom: EaldholtResidentMotion | null;
  readonly status: 'ready' | 'unavailable-motion'; readonly bounds: Box3;
  readonly animationExecution: ResidentAnimationExecutionSnapshot;
  /** Body submission evidence only; it does not prove unobscured pixels. */
  readonly lastRenderedFrame: number | null; readonly lastRenderedCamera: Camera | null;
  readonly lastRenderedPosition: readonly [number, number, number]; readonly lastRenderedMotion: EaldholtResidentMotion | null;
}
export interface EaldholtResidentActors {
  readonly object: Group; readonly actors: readonly EaldholtResidentActor[]; readonly bounds: Box3;
  readonly metrics: { readonly actors: number; readonly skeletons: number; readonly verticesPerActor: number;
    readonly envelopeSamples: number; readonly envelopePaddingMetres: number; readonly setupMilliseconds: number;
    readonly perFrameVertexScans: 0; readonly borrowedGeometryAndMaterials: true; readonly frustumCulling: 'disabled-conservative' };
  readonly disposed: boolean; readonly clockSeconds: number;
  update(deltaSeconds: number, frame: EaldholtResidentFrame): void;
  /** Bounded cosmetic records only; borrowed during the callback. */
  drainAnimationEvents(consume: (event: ResidentAnimationEvent) => void): void;
  dispose(): void;
}
type Clone = { model: Object3D; nodes: Object3D[]; meshes: Mesh[]; skeletons: Skeleton[] };
type Track = { node: number; property: 'position' | 'quaternion' | 'scale'; track: AnimationClip['tracks'][number] };
type QualifiedClip = { clip: AnimationClip; tracks: Track[]; bounds: Box3; samples: number; padding: number;
  /** Largest translation length and scale each node reaches in this clip (rest included). */
  translation: number[]; scale: number[] };
type SelectedClip = Omit<QualifiedClip, 'bounds' | 'samples' | 'padding' | 'translation' | 'scale'>;
const motions: readonly EaldholtResidentMotion[] = ['idle', 'talk', 'walk', 'sit', 'work', 'start', 'stop', 'sitDown', 'standUp', 'workEnter', 'workExit'];
const oneShots: ReadonlySet<EaldholtResidentMotion> = new Set<EaldholtResidentMotion>(['start', 'stop', 'sitDown', 'standUp', 'workEnter', 'workExit']);
/** Times at which a precomputed envelope is checked against the clip (evenly spaced, both ends included). */
const ENVELOPE_CHECKS = 9;
/** Most morph channels the shared face contract (evaluateFacePose) drives at once: two blinks, a brow raise, up to
 * eight expression channels and up to three overlapping visemes, plus a margin. */
const MAX_ACTIVE_MORPHS = 16;
const invalidIdentifierControls = /[\u0000-\u001f\u007f]/u;
const finite3 = (p: readonly number[]) => p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
function finiteBounds(box: Box3): boolean { return !box.isEmpty() && finite3(box.min.toArray()) && finite3(box.max.toArray()); }

/** Equivalent bone remapping to SkeletonUtils, without a second Three runtime or addon import.
 * Geometry/materials/clips stay borrowed; bone inverses and GPU bone textures are owned. */
function cloneResident(source: Object3D): Clone {
  const model = source.clone(true), nodes: Object3D[] = [], originals: Object3D[] = [], map = new Map<Object3D, Object3D>();
  source.traverse(node => originals.push(node)); model.traverse(node => nodes.push(node));
  if (originals.length !== nodes.length) throw Error('Resident hierarchy clone changed shape.');
  for (let i = 0; i < nodes.length; i++) {
    map.set(originals[i], nodes[i]); nodes[i].onBeforeRender = originals[i].onBeforeRender;
    nodes[i].onAfterRender = originals[i].onAfterRender;
  }
  const skeletonMap = new Map<Skeleton, Skeleton>(), meshes: Mesh[] = [];
  try {
    for (let i = 0; i < originals.length; i++) {
      const original = originals[i], cloned = nodes[i];
      if (cloned instanceof Mesh) {
        meshes.push(cloned); cloned.frustumCulled = false;
        if (original instanceof Mesh) { cloned.onBeforeShadow = original.onBeforeShadow; cloned.onAfterShadow = original.onAfterShadow; }
      }
      if (!(original instanceof SkinnedMesh) || !(cloned instanceof SkinnedMesh)) continue;
      if (!original.skeleton.bones.length || original.skeleton.boneInverses.length !== original.skeleton.bones.length
        || original.skeleton.boneInverses.some(matrix => !matrix.elements.every(Number.isFinite))
        || !original.bindMatrix.elements.every(Number.isFinite) || Math.abs(original.bindMatrix.determinant()) < 1e-12) throw Error('Resident skin requires complete finite inverse bind matrices.');
      let skeleton = skeletonMap.get(original.skeleton);
      if (!skeleton) {
        const bones = original.skeleton.bones.map(bone => {
          const replacement = map.get(bone);
          if (!replacement || !('isBone' in replacement) || !replacement.isBone) throw Error('Resident bone lies outside the supplied template.');
          return replacement as typeof bone;
        });
        skeleton = new Skeleton(bones, original.skeleton.boneInverses.map(matrix => matrix.clone()));
        skeletonMap.set(original.skeleton, skeleton);
      }
      cloned.skeleton = skeleton;
      cloned.bindMatrix.copy(original.bindMatrix); cloned.bindMatrixInverse.copy(original.bindMatrixInverse);
    }
    return { model, nodes, meshes, skeletons: [...skeletonMap.values()] };
  } catch (error) { for (const skeleton of skeletonMap.values()) skeleton.dispose(); throw error; }
}

function qualifyTracks(template: EaldholtResidentTemplate, clip: AnimationClip, nodes: Object3D[]): Track[] {
  if (!template.animations.includes(clip)) throw Error('Resident clips must belong to the already loaded template.');
  if (!Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks.length) throw Error('Resident clip needs a finite positive duration and tracks.');
  const used = new Set<string>();
  return clip.tracks.map(track => {
    const parsed = PropertyBinding.parseTrackName(track.name), property = parsed.propertyName;
    if (parsed.objectName || parsed.propertyIndex !== undefined || !['position', 'quaternion', 'scale'].includes(property)) throw Error('Resident clips may change cloned node transforms only.');
    const target = PropertyBinding.findNode(template.scene, parsed.nodeName);
    const node = nodes.findIndex(n => n === target);
    if (node < 0 || parsed.nodeName === nodes[node].uuid) throw Error('Resident track target must resolve by stable node name inside the template.');
    if (parsed.nodeName && nodes.filter(n => n.name === parsed.nodeName).length > 1) throw Error('Resident track target is ambiguous.');
    const key = node + ':' + property; if (used.has(key)) throw Error('Resident clip has competing transform tracks.'); used.add(key);
    if (track.getInterpolation() !== InterpolateDiscrete && track.getInterpolation() !== InterpolateLinear) throw Error('Resident envelope requires linear or discrete tracks.');
    const width = property === 'quaternion' ? 4 : 3;
    if (!track.times.length || track.values.length !== track.times.length * width) throw Error('Resident track dimensions are invalid.');
    for (let i = 0; i < track.times.length; i++) {
      if (!Number.isFinite(track.times[i]) || track.times[i] < 0 || track.times[i] > clip.duration + 1e-6 || i > 0 && track.times[i] <= track.times[i - 1]) throw Error('Resident key times must be finite and strictly increasing.');
      for (let c = 0; c < width; c++) if (!Number.isFinite(track.values[i * width + c])) throw Error('Resident track values must be finite.');
      if (property === 'scale' && Math.min(...track.values.slice(i * 3, i * 3 + 3)) <= 0) throw Error('Resident animated scales must stay positive.');
    }
    return { node, property: property as Track['property'], track };
  });
}

type Support = { end: number; radius: number };
/** Vertices that morph targets can move, with each one's largest possible displacement (the sum of its deltas). */
type MorphSubset = { indices: Uint32Array; pad: Float32Array };
function geometrySupport(clone: Clone): { support: Support[]; staticBounds: Map<Mesh, Box3>; vertices: number; morphPad: number;
  morphSubsets: Map<Mesh, MorphSubset> } {
  const support: Support[] = [], staticBounds = new Map<Mesh, Box3>(), morphSubsets = new Map<Mesh, MorphSubset>(), point = new Vector3();
  let vertices = 0, maxMorphPad = 0;
  for (const mesh of clone.meshes) {
    if ('isInstancedMesh' in mesh || 'isBatchedMesh' in mesh) throw Error('Resident template requires ordinary meshes.');
    // Relative morph targets (face blendshapes) are allowed. Each vertex's support is padded by the sum of its
    // largest deltas (MAX_ACTIVE_MORPHS of them), which bounds any mix of that many targets with influences within
    // 0..1. Unskinned static bounds take the largest such sum; skinned meshes keep the moving vertices and their
    // sums, and each envelope sample pads only those, where they are (patch 1's uniform pad of the sum over all 44
    // targets grew the whole-body box on every side by up to 19 cm).
    const morphs = mesh.geometry.morphAttributes.position ?? [];
    if (morphs.length && (!mesh.geometry.morphTargetsRelative || (mesh.morphTargetInfluences?.length ?? 0) !== morphs.length)) throw Error('Resident morph targets must be relative and complete.');
    const position = mesh.geometry.getAttribute('position');
    const vertexPad = morphs.length && position ? new Float64Array(position.count) : null;
    let morphPad = 0;
    const lengths: Float64Array[] = [];
    for (const target of morphs) {
      if (target.itemSize !== 3 || !vertexPad || target.count !== vertexPad.length) throw Error('Resident morph targets need one XYZ delta per vertex.');
      const l = new Float64Array(target.count);
      for (let i = 0; i < target.count; i++) {
        point.fromBufferAttribute(target, i); if (!finite3(point.toArray())) throw Error('Resident morph target contains a nonfinite delta.');
        l[i] = point.length();
      }
      lengths.push(l);
    }
    // the face contract drives at most MAX_ACTIVE_MORPHS channels at once: a vertex moves at most the sum of its
    // largest deltas (with every target counted when there are fewer)
    if (vertexPad) for (let i = 0; i < vertexPad.length; i++) {
      const own = lengths.map(l => l[i]).sort((a, b) => b - a);
      for (let k = 0; k < Math.min(MAX_ACTIVE_MORPHS, own.length); k++) vertexPad[i] += own[k];
    }
    if (vertexPad) {
      const moving: number[] = [];
      for (let i = 0; i < vertexPad.length; i++) { morphPad = Math.max(morphPad, vertexPad[i]); if (vertexPad[i] > 0) moving.push(i); }
      morphSubsets.set(mesh, { indices: Uint32Array.from(moving), pad: Float32Array.from(moving.map(i => vertexPad[i])) });
    }
    maxMorphPad = Math.max(maxMorphPad, morphPad);
    if (!position || position.itemSize !== 3 || !position.count) throw Error('Resident meshes need finite XYZ geometry.');
    vertices += position.count; const box = new Box3();
    const skin = mesh instanceof SkinnedMesh ? mesh : null, radii = skin ? new Float64Array(skin.skeleton.bones.length) : null;
    const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    if (skin && (skin.bindMode !== 'attached' || !joints || !weights || joints.itemSize !== 4 || weights.itemSize !== 4 || joints.count !== position.count || weights.count !== position.count)) throw Error('Resident skin requires attached four-weight geometry.');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i); if (!finite3(point.toArray())) throw Error('Resident geometry contains a nonfinite vertex.'); box.expandByPoint(point);
      if (!skin || !radii) continue; let total = 0;
      for (let c = 0; c < 4; c++) {
        const joint = joints.getComponent(i, c), weight = weights.getComponent(i, c); total += weight;
        if (!Number.isInteger(joint) || joint < 0 || joint >= radii.length || !Number.isFinite(weight) || weight < 0) throw Error('Resident skin influences are invalid.');
        if (!weight) continue;
        point.fromBufferAttribute(position, i).applyMatrix4(skin.bindMatrix).applyMatrix4(skin.skeleton.boneInverses[joint]);
        if (!finite3(point.toArray())) throw Error('Resident inverse bind support is nonfinite.');
        radii[joint] = Math.max(radii[joint], point.length() + (vertexPad ? vertexPad[i] : 0));
      }
      if (Math.abs(total - 1) > 1e-4) throw Error('Resident skin weights must sum to one.');
    }
    if (skin && radii) {
      for (let i = 0; i < radii.length; i++) if (radii[i] > 0) support.push({ end: clone.nodes.indexOf(skin.skeleton.bones[i]), radius: radii[i] });
    } else { box.expandByScalar(morphPad); staticBounds.set(mesh, box); support.push({ end: clone.nodes.indexOf(mesh), radius: Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.y), Math.abs(box.max.y)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z))) }); }
  }
  if (!vertices || !support.length || support.some(s => s.end < 0)) throw Error('Resident template has no complete geometry support.');
  return { support, staticBounds, vertices, morphPad: maxMorphPad, morphSubsets };
}

/** Sample every key and interval midpoint. An analytic TRS travel bound pads
 * the union for unsampled times; it does not assume extrema fall on keys.
 * Geometry and bind data are read only, and all skin scans happen during setup. */
function qualifyEnvelope(clone: Clone, qualified: SelectedClip,
  support: Support[], staticBounds: Map<Mesh, Box3>, morphSubsets: Map<Mesh, MorphSubset> = new Map(),
  precomputed: Box3 | null = null, trusted = false): QualifiedClip {
  const { clip, tracks } = qualified, nodes = clone.nodes, indices = new Map(nodes.map((n, i) => [n, i]));
  const parents = nodes.map(n => indices.get(n.parent!) ?? -1), translation = nodes.map(n => n.position.length()), scale = nodes.map(n => Math.max(n.scale.x, n.scale.y, n.scale.z));
  for (const node of nodes) if (!node.matrixAutoUpdate || !finite3(node.position.toArray()) || !finite3(node.scale.toArray()) || Math.min(node.scale.x, node.scale.y, node.scale.z) <= 0 || Math.abs(node.quaternion.lengthSq() - 1) > 1e-4) throw Error('Resident envelope requires finite positive-scale TRS nodes.');
  const keyTimes = new Set<number>([0, clip.duration]);
  for (const { node, property, track } of tracks) {
    for (let i = 0; i < track.times.length; i++) {
      keyTimes.add(track.times[i]); const v = track.values, at = i * (property === 'quaternion' ? 4 : 3);
      if (property === 'position') translation[node] = Math.max(translation[node], Math.hypot(v[at], v[at + 1], v[at + 2]));
      if (property === 'scale') scale[node] = Math.max(scale[node], v[at], v[at + 1], v[at + 2]);
      if (property === 'quaternion' && (track.ValueTypeName !== 'quaternion' || Math.abs(Math.hypot(v[at], v[at + 1], v[at + 2], v[at + 3]) - 1) > 1e-4)) throw Error('Resident rotation tracks need normalized quaternion interpolation.');
    }
  }
  // A trusted envelope (the asset publisher sampled the skinned clip densely and gated it offline) is used as given:
  // no skinning at setup, only the track scan above that bounds crossfades (patch 8).
  if (precomputed && trusted) return { ...qualified, bounds: precomputed.clone(), samples: 0, padding: 0, translation, scale };
  const keys = [...keyTimes].sort((a, b) => a - b), times: number[] = [];
  // A precomputed envelope (measured offline at every frame with its own between-frame margin) is checked at a few
  // evenly spaced times instead of being re-measured at every key and midpoint (multi-second setups on LOD0 files).
  if (precomputed) for (let i = 0; i < ENVELOPE_CHECKS; i++) times.push(clip.duration * i / (ENVELOPE_CHECKS - 1));
  else for (let i = 0; i < keys.length; i++) { if (i) times.push((keys[i - 1] + keys[i]) * .5); times.push(keys[i]); }
  if (times.length > 8193) throw Error('Resident clip exceeds the bounded envelope sampling budget.');
  const prefix = nodes.map(() => 1);
  for (let i = 0; i < nodes.length; i++) if (parents[i] >= 0) prefix[i] = prefix[parents[i]] * scale[parents[i]];
  const chains = support.map(s => {
    const chain: { node: number; rotation: number; translation: number; scale: number }[] = []; let radius = s.radius;
    for (let n = s.end; n >= 0; n = parents[n]) {
      chain.push({ node: n, rotation: prefix[n] * scale[n] * radius, translation: prefix[n], scale: prefix[n] * radius });
      radius = translation[n] + scale[n] * radius;
    }
    return chain;
  });
  const mixer = new AnimationMixer(clone.model), action = mixer.clipAction(clip), bounds = new Box3(), box = new Box3();
  const previous = new Float64Array(nodes.length * 10), current = new Float64Array(previous.length), angular = new Float64Array(nodes.length), linear = new Float64Array(nodes.length), scaling = new Float64Array(nodes.length);
  const a = new Quaternion(), b = new Quaternion(), point = new Vector3(); let padding = 0;
  action.setLoop(LoopRepeat, Infinity).play();
  try {
    for (let sample = 0; sample < times.length; sample++) {
      action.enabled = true; action.paused = true; action.time = times[sample]; mixer.update(0);
      // Use the render traversal: SkinnedMesh.updateMatrixWorld also refreshes
      // the attached bind inverse when a common mesh/bone parent is animated.
      clone.model.updateMatrixWorld(true); for (const skeleton of clone.skeletons) skeleton.update();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], at = i * 10; n.position.toArray(current, at); n.quaternion.toArray(current, at + 3); n.scale.toArray(current, at + 7);
        if (sample) {
          angular[i] = a.fromArray(previous, at + 3).angleTo(b.fromArray(current, at + 3));
          linear[i] = Math.hypot(current[at] - previous[at], current[at + 1] - previous[at + 1], current[at + 2] - previous[at + 2]);
          scaling[i] = Math.max(Math.abs(current[at + 7] - previous[at + 7]), Math.abs(current[at + 8] - previous[at + 8]), Math.abs(current[at + 9] - previous[at + 9]));
        }
      }
      if (sample) for (const chain of chains) { let travel = 0; for (const c of chain) travel += c.rotation * angular[c.node] + c.translation * linear[c.node] + c.scale * scaling[c.node]; padding = Math.max(padding, travel); }
      previous.set(current);
      for (const mesh of clone.meshes) {
        if (mesh instanceof SkinnedMesh) {
          mesh.computeBoundingBox(); box.copy(mesh.boundingBox!);
          // morphing vertices (the face) can move by their summed deltas: pad only those, where they are this sample
          const subset = morphSubsets.get(mesh);
          if (subset) for (let k = 0; k < subset.indices.length; k++) {
            mesh.getVertexPosition(subset.indices[k], point); const r = subset.pad[k];
            box.min.set(Math.min(box.min.x, point.x - r), Math.min(box.min.y, point.y - r), Math.min(box.min.z, point.z - r));
            box.max.set(Math.max(box.max.x, point.x + r), Math.max(box.max.y, point.y + r), Math.max(box.max.z, point.z + r));
          }
        } else box.copy(staticBounds.get(mesh)!);
        box.applyMatrix4(mesh.matrixWorld); if (!finiteBounds(box)) throw Error('Resident animated geometry has nonfinite bounds.'); bounds.union(box);
      }
      if (precomputed && !precomputed.containsBox(bounds.clone().expandByScalar(-1e-3))) throw Error('Resident precomputed envelope does not contain the clip.');
    }
    if (precomputed) return { ...qualified, bounds: precomputed.clone(), samples: times.length, padding: 0, translation, scale };
    bounds.expandByScalar(padding + 1e-5); if (!finiteBounds(bounds) || !Number.isFinite(padding)) throw Error('Resident animated envelope is invalid.');
    return { ...qualified, bounds, samples: times.length, padding, translation, scale };
  } finally { mixer.stopAllAction(); mixer.uncacheRoot(clone.model); }
}

type Actor = { execution: ResidentAnimationExecution; animationExecution: ResidentAnimationExecutionSnapshot; residentId: string; placement: Group; model: Object3D; mixer: AnimationMixer; bounds: Box3;
  requestedMotion: EaldholtResidentMotion; activeMotion: EaldholtResidentMotion; status: 'ready' | 'unavailable-motion';
  lastRenderedFrame: number | null; lastRenderedCamera: Camera | null;
  lastRenderedPosition: [number, number, number]; lastRenderedMotion: EaldholtResidentMotion | null;
  clone: Clone; actions: Partial<Record<EaldholtResidentMotion, AnimationAction>>; phase: number; seen: number;
  logicalMotion: EaldholtResidentMotion; restartPending: boolean; timeline: number; pendingDelta: number; absolutePose: boolean;
  cadenceElapsed: number; interval: number | null;
  fadingFrom: EaldholtResidentMotion | null; fade: { seconds: number; elapsed: number; time: number } | null };
export interface EaldholtResidentClips {
  readonly idle: AnimationClip; readonly talk?: AnimationClip; readonly walk?: AnimationClip; readonly sit?: AnimationClip;
  /** A qualified role work loop (for example the smith's work_hammer); never a talking or idle clip. */
  readonly work?: AnimationClip;
  /** One-shot transitions, each authored to begin and end on the poses of the loops it joins. */
  readonly start?: AnimationClip; readonly stop?: AnimationClip; readonly sitDown?: AnimationClip; readonly standUp?: AnimationClip;
  /** One-shot work entry and exit: from the idle (or the seated rest) into the work loop's first frame and back. */
  readonly workEnter?: AnimationClip; readonly workExit?: AnimationClip;
}

/** NPC-only renderer owner. Authored appearance, identity, places and activities
 * are supplied externally; no implicit residents, routes, work or avatar exist.
 * Setup scans are shared across actors. Skinned meshes deliberately disable
 * per-mesh culling; the owner exposes the full qualified animation envelope. */
export function createEaldholtResidentActors(template: EaldholtResidentTemplate,
  placements: readonly EaldholtResidentPlacement[], options: { readonly clips: EaldholtResidentClips;
    /** Optional offline envelopes per motion (manifest `envelopes`): each is checked at a few times, not re-measured. */
    readonly envelopes?: Partial<Record<EaldholtResidentMotion, EaldholtResidentEnvelope>>;
    /** The envelopes were sampled densely on the skinned clip and gated by the asset publisher: use them as given, with
     * no setup sampling (patch 8; set-up time then no longer grows with the vertex count). Default false. */
    readonly trustEnvelopes?: boolean;
    /** Authored seconds for the exact selected clips; never synthesized from clip fractions. */
    readonly markers?: Partial<Record<EaldholtResidentMotion, readonly ResidentAnimationMarker[]>> }): EaldholtResidentActors {
  const started = performance.now(), object = new Group(), bounds = new Box3(), rows: Actor[] = [], byId = new Map<string, Actor>();
  object.name = 'Ealdholt resident actors';
  const sourceNodes: Object3D[] = []; template.scene.traverse(node => sourceNodes.push(node));
  const selected = new Map<EaldholtResidentMotion, SelectedClip>(), identities = new Set<AnimationClip>();
  for (const motion of motions) {
    const clip = options.clips[motion]; if (!clip) { if (motion === 'idle') throw Error('An explicitly qualified neutral idle clip is required.'); continue; }
    if (identities.has(clip)) throw Error('A clip cannot stand in for a different resident motion.'); identities.add(clip);
    selected.set(motion, { clip, tracks: qualifyTracks(template, clip, sourceNodes) });
  }
  const executionClips = new Map<EaldholtResidentMotion, ResidentAnimationClip>();
  // Navigation supplies the outer placement. Travelling clips may articulate
  // the body but cannot also animate horizontal displacement of its rig roots
  // or their outer ancestors. Hold an unsupported clip rather than alter its
  // tracks or invalidate its published envelope/contact proof.
  const rigRoots = new Set<Object3D>([template.scene]);
  for (const node of sourceNodes) if (node instanceof SkinnedMesh) for (const bone of node.skeleton.bones) {
    if (node.skeleton.bones.includes(bone.parent as typeof bone)) continue;
    for (let root: Object3D | null = bone; root; root = root.parent) { rigRoots.add(root); if (root === template.scene) break; }
  }
  const rootMotionHolds = new Set<EaldholtResidentMotion>();
  for (const [motion, selectedClip] of selected) {
    executionClips.set(motion, qualifyResidentAnimationClip(selectedClip.clip.name || motion, selectedClip.clip.duration, !oneShots.has(motion), options.markers?.[motion]));
    if (motion !== 'walk' && motion !== 'start' && motion !== 'stop') continue;
    for (const track of selectedClip.tracks) if (track.property === 'position' && rigRoots.has(sourceNodes[track.node])) {
      const values = track.track.values;
      for (let i = 3; i < values.length; i += 3) if (Math.abs(values[i] - values[0]) > 1e-6 || Math.abs(values[i + 2] - values[2]) > 1e-6) { rootMotionHolds.add(motion); break; }
    }
  }
  const placementIds = new Set<string>();
  for (const p of placements) {
    if (typeof p.residentId !== 'string' || !p.residentId.length || p.residentId.length > 256 || p.residentId.trim() !== p.residentId
      || invalidIdentifierControls.test(p.residentId) || placementIds.has(p.residentId) || !finite3(p.position) || !Number.isFinite(p.yawRadians)
      || !Number.isFinite(p.scale ?? 1) || (p.scale ?? 1) <= 0 || !Number.isFinite(p.phaseSeconds ?? 0) || (p.phaseSeconds ?? 0) < 0) throw Error('Resident placements require distinct IDs and finite positive-scale transforms.');
    placementIds.add(p.residentId);
  }
  const qualified = new Map<EaldholtResidentMotion, QualifiedClip>(), probe = cloneResident(template.scene), reach = new Box3();
  let vertices = 0, envelopeSamples = 0, envelopePadding = 0, disposed = false, clock = 0, generation = 0;
  const release = (row: Actor) => {
    row.execution.cancel(true);
    row.lastRenderedFrame = null; row.lastRenderedCamera = null; row.lastRenderedMotion = null;
    row.mixer.stopAllAction(); row.mixer.uncacheRoot(row.model);
    for (const skeleton of row.clone.skeletons) skeleton.dispose();
    row.placement.removeFromParent(); row.model.removeFromParent();
  };
  try {
    try {
      const support = geometrySupport(probe); vertices = support.vertices;
      for (const [motion, clip] of selected) {
        const given = options.envelopes?.[motion];
        if (given && !(finite3(given.min) && finite3(given.max) && given.min.every((v, i) => v < given.max[i]))) throw Error('Resident precomputed envelope must be a finite box.');
        const box = given ? new Box3(new Vector3().fromArray(given.min), new Vector3().fromArray(given.max)) : null;
        const q = qualifyEnvelope(probe, clip, support.support, support.staticBounds, support.morphSubsets, box, options.trustEnvelopes === true); qualified.set(motion, q);
        envelopeSamples += q.samples; envelopePadding = Math.max(envelopePadding, q.padding);
      }
      // A crossfade blends two poses, which need not lie inside either clip's sampled envelope. The reach box bounds
      // every vertex about the placement origin under any rotations, from each node's largest translation and scale in
      // any qualified clip (blends interpolate between them); support radii already include morph deltas.
      const parents = probe.nodes.map(node => probe.nodes.indexOf(node.parent!)), clips = [...qualified.values()];
      let radius = 0;
      for (const s of support.support) {
        let r = s.radius;
        for (let n = s.end; n >= 0; n = parents[n]) r = Math.max(...clips.map(q => q.translation[n])) + Math.max(...clips.map(q => q.scale[n])) * r;
        radius = Math.max(radius, r);
      }
      reach.min.setScalar(-radius - 1e-5); reach.max.setScalar(radius + 1e-5);
    } finally { for (const skeleton of probe.skeletons) skeleton.dispose(); }
    for (const p of placements) {
      const clone = cloneResident(template.scene), placement = new Group(), mixer = new AnimationMixer(clone.model);
      const execution = new ResidentAnimationExecution(p.residentId);
      const row: Actor = { execution, animationExecution: execution.snapshot, residentId: p.residentId, placement, model: clone.model, mixer, clone, bounds: new Box3(),
        requestedMotion: 'idle', activeMotion: 'idle', status: 'ready', actions: {}, phase: p.phaseSeconds ?? 0, seen: 0,
        lastRenderedFrame: null, lastRenderedCamera: null, lastRenderedPosition: [0, 0, 0], lastRenderedMotion: null,
        logicalMotion: 'idle', restartPending: false, timeline: (p.phaseSeconds ?? 0) % qualified.get('idle')!.clip.duration,
        pendingDelta: 0, absolutePose: false, cadenceElapsed: 0, interval: 0, fadingFrom: null, fade: null };
      rows.push(row); byId.set(row.residentId, row);
      for (const mesh of clone.meshes) if (mesh instanceof SkinnedMesh) {
        const original = mesh.onAfterRender;
        mesh.onAfterRender = function(renderer, scene, camera, geometry, material, group) {
          original.call(this, renderer, scene, camera, geometry, material, group);
          if (disposed) return;
          row.lastRenderedFrame = renderer.info.render.frame; row.lastRenderedCamera = camera;
          row.lastRenderedPosition[0] = row.placement.position.x; row.lastRenderedPosition[1] = row.placement.position.y; row.lastRenderedPosition[2] = row.placement.position.z;
          row.lastRenderedMotion = row.activeMotion;
        };
      }
      placement.name = 'Resident placement ' + p.residentId; placement.position.fromArray(p.position);
      placement.rotation.y = p.yawRadians; placement.scale.setScalar(p.scale ?? 1); placement.add(clone.model); object.add(placement);
      for (const [motion, q] of qualified) {
        const action = mixer.clipAction(q.clip), once = oneShots.has(motion);
        action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity).play().stop(); action.clampWhenFinished = once; row.actions[motion] = action;
      }
      const idle = row.actions.idle!; idle.reset(); idle.time = row.phase % qualified.get('idle')!.clip.duration; idle.play(); mixer.update(0);
      execution.request('idle', executionClips.get('idle')!, undefined, row.timeline); execution.evaluate();
    }
  } catch (error) { for (const row of rows) release(row); throw error; }
  function updateBounds(): void {
    bounds.makeEmpty();
    for (const row of rows) {
      row.placement.updateMatrix(); row.bounds.copy(row.fade ? reach : qualified.get(row.activeMotion)!.bounds).applyMatrix4(row.placement.matrix); bounds.union(row.bounds);
    }
  }
  updateBounds();
  const metrics = Object.freeze({ actors: rows.length, skeletons: rows.reduce((sum, row) => sum + row.clone.skeletons.length, 0),
    verticesPerActor: vertices, envelopeSamples, envelopePaddingMetres: envelopePadding, setupMilliseconds: performance.now() - started,
    perFrameVertexScans: 0 as const, borrowedGeometryAndMaterials: true as const, frustumCulling: 'disabled-conservative' as const });
  return {
    object, actors: Object.freeze(rows), bounds, metrics,
    get disposed() { return disposed; }, get clockSeconds() { return clock; },
    update(deltaSeconds, frame) {
      if (disposed) return;
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > 1 || !Number.isFinite(frame.clockSeconds) || frame.clockSeconds < 0
        || typeof frame.paused !== 'boolean' || typeof frame.reducedMotion !== 'boolean'
        || frame.initializePausedPose!==undefined&&frame.initializePausedPose!==true
        || frame.residents.length !== rows.length) throw Error('Resident update requires a complete explicit active-frame DTO (0..1 seconds).');
      generation++; if (!Number.isSafeInteger(generation)) { generation = 1; for (const row of rows) row.seen = 0; }
      for (const state of frame.residents) {
        const row = byId.get(state.residentId);
        if (!row || row.seen === generation || !motions.includes(state.motion) || state.position && !finite3(state.position)
          || state.yawRadians !== undefined && !Number.isFinite(state.yawRadians)
          || state.animationTimeSeconds !== undefined && (!Number.isFinite(state.animationTimeSeconds) || state.animationTimeSeconds < 0)
          || state.animationTimeMode !== undefined && state.animationTimeMode !== 'seek' && state.animationTimeMode !== 'advance'
          || state.animationTimeMode !== undefined && state.animationTimeSeconds === undefined
          || state.animationPlaybackId !== undefined && (typeof state.animationPlaybackId !== 'string' || !state.animationPlaybackId.length
            || state.animationPlaybackId.length > 256 || state.animationPlaybackId.trim() !== state.animationPlaybackId || invalidIdentifierControls.test(state.animationPlaybackId))
          || state.animationUpdateIntervalSeconds !== undefined && state.animationUpdateIntervalSeconds !== null
            && (!Number.isFinite(state.animationUpdateIntervalSeconds) || state.animationUpdateIntervalSeconds < 0)
          || state.fadeSeconds !== undefined && (!Number.isFinite(state.fadeSeconds) || state.fadeSeconds < 0 || state.fadeSeconds > 2)) throw Error('Resident frame has an unknown, duplicate or invalid actor state.');
        row.seen = generation;
      }
      const clockRewound = frame.clockSeconds < clock;
      clock = frame.clockSeconds;
      if (frame.paused&&!frame.initializePausedPose) { for (const row of rows) row.execution.hold('paused'); return; }
      if(frame.paused)deltaSeconds=0;
      for (const state of frame.residents) {
        const row = byId.get(state.residentId)!, available = qualified.has(state.motion) && !rootMotionHolds.has(state.motion), active = available ? state.motion : row.activeMotion;
        const duration = qualified.get(active)!.clip.duration, once = oneShots.has(active);
        const interval = state.animationUpdateIntervalSeconds === undefined ? 0 : state.animationUpdateIntervalSeconds;
        row.requestedMotion = state.motion; row.status = available ? 'ready' : 'unavailable-motion';
        const replay = row.execution.request(state.motion, available ? executionClips.get(state.motion)! : null, state.animationPlaybackId,
          once ? 0 : row.phase % duration,
          rootMotionHolds.has(state.motion) ? 'root-motion-unqualified' : 'clip-unavailable');
        if (state.position) row.placement.position.fromArray(state.position);
        if (state.yawRadians !== undefined) row.placement.rotation.y = state.yawRadians;
        if (!available) {
          // Keep the actual last qualified pose, including a partially mixed
          // pose. No unsupported timeline, phase or fade can advance it.
          row.execution.hold(rootMotionHolds.has(state.motion) ? 'root-motion-unqualified' : 'clip-unavailable');
          row.pendingDelta = 0; row.absolutePose = false; row.cadenceElapsed = 0;
          continue;
        }
        if (active !== row.logicalMotion || replay) {
          row.logicalMotion = active; row.restartPending = true; row.timeline = once ? 0 : row.phase % duration;
          row.pendingDelta = 0; row.absolutePose = true;
        }
        if (!frame.reducedMotion || frame.initializePausedPose) {
          // Completed one-shots hold without redundant mixer advancement. An
          // explicit earlier pose remains playable; only a replay re-arms events.
          const poseDelta = frame.reducedMotion || once && row.execution.snapshot.state === 'completed' && row.timeline >= duration ? 0 : deltaSeconds;
          if (active === state.motion && state.animationTimeSeconds !== undefined) {
            row.timeline = once ? Math.min(state.animationTimeSeconds, duration) : state.animationTimeSeconds;
            row.pendingDelta = 0; row.absolutePose = true;
          } else {
            row.timeline = once ? Math.min(row.timeline + poseDelta, duration) : row.timeline + poseDelta;
            row.pendingDelta += poseDelta;
            // Looping pose debt stays bounded during arbitrarily long suspension; a one-shot stops on its last frame.
            // This owner emits no activity-completion events or world-time changes.
            if (row.pendingDelta > duration + 1) row.pendingDelta = once ? duration : row.pendingDelta % duration;
          }
          if (row.fade) {
            const from = row.fadingFrom!, length = qualified.get(from)!.clip.duration, fadeDelta = frame.reducedMotion ? 0 : deltaSeconds;
            // The outgoing fade has its own clock even after the incoming
            // one-shot clamps. Only pause/reduced motion can freeze this clock.
            row.fade.elapsed += fadeDelta;
            row.fade.time = oneShots.has(from) ? Math.min(row.fade.time + fadeDelta, length) : (row.fade.time + fadeDelta) % length;
          }
          if (interval === null) row.cadenceElapsed = 0;
          else row.cadenceElapsed += poseDelta;
        }
        row.execution.hold(frame.paused ? 'paused' : frame.reducedMotion ? 'reduced-motion' : 'cadence');
        row.execution.stage(row.timeline, frame.paused || frame.reducedMotion || clockRewound || state.animationTimeSeconds !== undefined && state.animationTimeMode !== 'advance');
        const tolerance = interval === null ? 0 : Math.min(interval * 1e-9, 1e-12);
        const promoted = row.interval === null || interval !== null && row.interval !== null && interval < row.interval;
        const due = interval !== null && (frame.initializePausedPose || !frame.reducedMotion
          && (interval === 0 || promoted || row.cadenceElapsed + tolerance >= interval)
          || frame.reducedMotion && interval === 0 && (row.activeMotion !== row.logicalMotion || row.restartPending || row.fade !== null));
        if (due) {
          let refresh = false;
          if (row.activeMotion !== row.logicalMotion || row.restartPending) {
            const fade = frame.reducedMotion||frame.paused||row.activeMotion===row.logicalMotion ? 0 : state.fadeSeconds ?? 0, from = row.activeMotion, outgoing = row.actions[from]!;
            for (const motion of motions) if (motion !== from || !fade) row.actions[motion]?.stop();
            row.actions[active]!.reset().setEffectiveWeight(1).play(); row.activeMotion = active; row.restartPending = false;
            // The outgoing action is paused so mixer deltas leave it alone; its time is set from the fade clock below.
            if (fade) { row.fade = { seconds: fade, elapsed: 0, time: outgoing.time }; row.fadingFrom = from; outgoing.paused = true; }
            else { row.fade = null; row.fadingFrom = null; }
          }
          if (row.fade) {
            const outgoing = row.actions[row.fadingFrom!]!, incoming = row.actions[active]!;
            const weight = frame.reducedMotion ? 1 : Math.min(1, row.fade.elapsed / row.fade.seconds);
            if (weight >= 1) { outgoing.stop(); incoming.setEffectiveWeight(1); row.fade = null; row.fadingFrom = null; }
            else { outgoing.time = row.fade.time; outgoing.setEffectiveWeight(1 - weight); incoming.setEffectiveWeight(weight); }
            refresh = true;
          }
          if (row.absolutePose) {
            const action = row.actions[active]!; action.time = once ? row.timeline : row.timeline % duration; if (once) action.paused = false;
            row.mixer.update(0);
          } else if (row.pendingDelta) row.mixer.update(row.pendingDelta);
          else if (refresh) row.mixer.update(0);
          if (row.actions[active]!.getEffectiveWeight() > 0) row.execution.evaluate(row.fade === null);
          else {
            // Three skips interpolants for zero-weight actions. Treat that
            // interval as pose-only, so its contacts cannot catch up later.
            row.execution.stage(row.timeline, true); row.execution.hold('blend-zero-weight');
          }
          if (frame.paused || frame.reducedMotion) row.execution.hold(frame.paused ? 'paused' : 'reduced-motion');
          row.pendingDelta = 0; row.absolutePose = false;
          row.cadenceElapsed = interval === 0 ? 0 : row.cadenceElapsed % interval;
          if (interval - row.cadenceElapsed <= tolerance) row.cadenceElapsed = 0;
        }
        if (!frame.reducedMotion) row.interval = interval;
      }
      updateBounds();
    },
    drainAnimationEvents(consume) { for (const row of rows) row.execution.drainEvents(consume); },
    dispose() { if (disposed) return; disposed = true; for (const row of rows) release(row); object.removeFromParent(); },
  };
}
