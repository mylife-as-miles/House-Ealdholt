/**
 * Crowd binding contract: how one published crowd resident (`crowd-v1/residents/<id>.glb` + `.json`) is paired with its
 * archetype clip library (`crowd-v1/clips/crowd-clips-<archetype>-v1.glb`) for the actor owner.
 *
 * WORKING PLACEHOLDER, Claude's character-art contract (runtime builder, 7 November 2026; see
 * docs/legacy/claude-integration/characters/population-README.md). The desktop and Quest crowd adapters
 * (`characters/crowd-residents.ts` in each app) use it; Codex's actor owner and callers can use it directly.
 *
 * - `parseCrowdResidentMeta` reads and checks the resident JSON the crowd publisher writes (placement scale, clip
 *   library, joints-only face calibration, motion variants, props, measured budgets).
 * - `planCrowdClips` maps the actor owner's motions onto library clip names for one activity: idle, talk and walk are
 *   the resident's variants; a carry or patrol walk replaces walk (it keeps walk's legs and timing); a role loop is
 *   `work` with its `<loop>_enter` / `<loop>_exit`; `<walk>_start` / `<walk>_stop` and the seated set join where the
 *   library has them. A role loop the library lacks is reported `unpresentable` (the resident keeps walking between
 *   places: never idle or talk in place of work, the household-art-sets rule). Only motions the owner supports are
 *   planned (`CODEX_OWNER_MOTIONS`).
 * - `crowdFaceCalibration` merges the resident's measured lid and jaw angles into the shared face contract.
 *
 * Pure and deterministic: no three, DOM, timers, clock reads, randomness or scene access. ES2020.
 */
import { DEFAULT_FACE_CALIBRATION, type FaceCalibration } from './face-performance';
import { parseCrowdPresentation, parseCrowdPublishedEnvelopes, type CrowdPresentation, type CrowdPublishedEnvelopes } from './crowd-presentation';
import { publishedGuardWatch, GUARD_WATCH_LOOP, GUARD_WATCH_WALK, GUARD_WATCH_ENTER, GUARD_WATCH_EXIT } from './guard-watch-dwell';
import {
  POPULATION_ARCHETYPES, crowdClipLibraryFile, getPopulationClip, type PopulationArchetype,
} from './village-population';

export const CROWD_BINDING_STATUS = 'working-placeholder' as const;

/** The actor owner's motion vocabulary once patches 2, 4 and 5 are applied (characters-README.md). */
export type CrowdOwnerMotion = 'idle' | 'talk' | 'walk' | 'sit' | 'work' | 'start' | 'stop' | 'sitDown' | 'standUp' | 'workEnter' | 'workExit';
export const CROWD_OWNER_MOTIONS_ALL: readonly CrowdOwnerMotion[] = Object.freeze(
  ['idle', 'talk', 'walk', 'sit', 'work', 'start', 'stop', 'sitDown', 'standUp', 'workEnter', 'workExit'] as const);
/** What Codex's resident-actors.ts accepts as it is (codex/play-baked-arenas 499535b, unchanged since 502057e). */
export const CODEX_OWNER_MOTIONS: Readonly<Record<'current' | 'patched', readonly CrowdOwnerMotion[]>> = Object.freeze({
  current: Object.freeze(['idle', 'talk', 'walk', 'sit'] as const),
  patched: CROWD_OWNER_MOTIONS_ALL,
});
/** One-shot motions (play once, hold the last frame) in the patched owner. */
export const CROWD_ONE_SHOT_MOTIONS: readonly CrowdOwnerMotion[] = Object.freeze(['start', 'stop', 'sitDown', 'standUp', 'workEnter', 'workExit'] as const);

export interface CrowdResidentMeta {
  readonly residentId: string;
  readonly archetype: PopulationArchetype;
  /** Library file name inside crowd-v1/clips (crowd-clips-<archetype>-v1.glb). */
  readonly clipLibrary: string;
  /** Actor placement scale: the resident's stature on the shared archetype skeleton. */
  readonly placementScale: number;
  /** Rest-pose estimate the publisher adds to library envelopes (metres). */
  readonly envelopeMarginMetres: number;
  readonly face: { readonly tier: 'face-joints-only'; readonly upperLidClosed: number; readonly lowerLidClosed: number; readonly jawOpen: number };
  readonly motion: { readonly idle: string; readonly walk: string; readonly talk: string; readonly rate: number; readonly roleClips: readonly string[] };
  readonly props: readonly { readonly id: string; readonly kit: string; readonly socket: string }[];
  readonly measured: { readonly triangles: number; readonly materials: number; readonly meshes: number; readonly joints: number; readonly morphTargets: number; readonly clips: number; readonly fileBytes: number };
  /** Props per clip and worn props at rest (crowd_motion_publish.ts, crowd-presentation.ts); null for older files. */
  readonly presentation: CrowdPresentation | null;
  /** Per-clip envelopes computed and gated by the publisher (no runtime sampling); null for older files. */
  readonly envelopes: CrowdPublishedEnvelopes | null;
}

const CLIP_NAME = /^[a-z][a-z0-9_]*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string, min = -Infinity, max = Infinity): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Crowd resident ${what} must be a number in [${min}, ${max}].`);
  return v;
};
const clipName = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !CLIP_NAME.test(v)) throw new Error(`Crowd resident ${what} must be a clip name.`);
  return v;
};

/** Reads the publisher's resident JSON (crowd-v1/residents/<id>.json). Throws on anything it cannot trust. */
export function parseCrowdResidentMeta(json: unknown, expectedResidentId?: string): CrowdResidentMeta {
  if (!isObj(json)) throw new Error('Crowd resident manifest must be an object.');
  const id = json.residentId;
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error('Crowd resident manifest needs a resident ID.');
  if (expectedResidentId !== undefined && id !== expectedResidentId) throw new Error(`Crowd resident manifest is for ${id}, not ${expectedResidentId}.`);
  const archetype = json.archetype as PopulationArchetype;
  if (POPULATION_ARCHETYPES.indexOf(archetype) < 0) throw new Error(`Crowd resident ${id} has an unknown archetype.`);
  const library = json.clipLibrary;
  if (typeof library !== 'string' || library !== crowdClipLibraryFile(archetype).split('/').pop()) throw new Error(`Crowd resident ${id} must use the ${archetype} clip library.`);
  if (json.faceTier !== 'face-joints-only') throw new Error(`Crowd resident ${id} must be the joints-only face tier.`);
  const fc = json.faceCalibration;
  if (!isObj(fc)) throw new Error(`Crowd resident ${id} needs its face calibration.`);
  const m = json.motion;
  if (!isObj(m) || !Array.isArray(m.roleClips)) throw new Error(`Crowd resident ${id} needs its motion variants.`);
  const measured = json.measured;
  if (!isObj(measured)) throw new Error(`Crowd resident ${id} needs its measured budgets.`);
  const props = Array.isArray(json.props) ? json.props : [];
  const out: CrowdResidentMeta = {
    residentId: id, archetype, clipLibrary: library,
    placementScale: num(json.placementScale, 'placementScale', 0.5, 1.5),
    envelopeMarginMetres: num(json.envelopeMarginMetres ?? 0, 'envelopeMarginMetres', 0, 2),
    face: { tier: 'face-joints-only', upperLidClosed: num(fc.upperLidClosed, 'upperLidClosed', 0.05, 1.5),
      lowerLidClosed: num(fc.lowerLidClosed, 'lowerLidClosed', -1, 0.5), jawOpen: num(fc.jawOpen, 'jawOpen', 0.02, 0.8) },
    motion: { idle: clipName(m.idle, 'idle'), walk: clipName(m.walk, 'walk'), talk: clipName(m.talk, 'talk'), rate: num(m.rate, 'rate', 0.5, 1.5),
      roleClips: Object.freeze(m.roleClips.map((c, i) => clipName(c, `roleClips[${i}]`))) },
    props: Object.freeze(props.map(p => {
      if (!isObj(p) || typeof p.id !== 'string' || typeof p.kit !== 'string' || typeof p.socket !== 'string') throw new Error(`Crowd resident ${id} has an invalid prop.`);
      return Object.freeze({ id: p.id, kit: p.kit, socket: p.socket });
    })),
    measured: { triangles: num(measured.triangles, 'triangles', 1), materials: num(measured.materials, 'materials', 1, 8),
      meshes: num(measured.meshes ?? 1, 'meshes', 1, 8), joints: num(measured.joints, 'joints', 1, 256),
      morphTargets: num(measured.morphTargets ?? 0, 'morphTargets', 0), clips: num(measured.clips ?? 0, 'clips', 0), fileBytes: num(measured.fileBytes, 'fileBytes', 1) },
    presentation: parseCrowdPresentation(json.presentation),
    envelopes: parseCrowdPublishedEnvelopes(json.envelopes, json.envelopeGate),
  };
  if (out.measured.morphTargets !== 0 || out.measured.clips !== 0) throw new Error(`Crowd resident ${id} must carry no morphs and no clips.`);
  return deepFreeze(out);
}

/** File paths (relative to the shared `aethelgard/characters` asset folder) for one crowd resident. */
export function crowdResidentPaths(residentId: string, archetype: PopulationArchetype): { readonly glb: string; readonly json: string; readonly library: string } {
  return Object.freeze({ glb: `crowd-v1/residents/${residentId}.glb`, json: `crowd-v1/residents/${residentId}.json`, library: crowdClipLibraryFile(archetype) });
}

/** What the resident is doing, as far as clip choice is concerned (the caller's simulation decides). */
export interface CrowdActivity {
  /** Source-qualified patrol presentation with separately measured compact
   * transitions; never an occupation or a substitute for an unmapped post. */
  readonly guardWatch?: true;
  /** A role loop or carry from `motion.roleClips` (null or omitted: no role clip this slot). */
  readonly roleClip?: string | null;
  /** The slot may seat the resident (a bench outdoors): plans sit, sit_down and stand_up. Seated work loops imply it. */
  readonly seated?: boolean;
}

export interface CrowdClipPlan {
  /** Owner motion to library clip name. `idle` is always present. */
  readonly clips: Readonly<Partial<Record<CrowdOwnerMotion, string>>> & { readonly idle: string };
  /** The role loop the resident should show but cannot (not in its library or not its own); null when none. */
  readonly unpresentable: string | null;
  /** True when `walk` is a carry or patrol walk (switch from the plain walk at the same normalised time). */
  readonly walkIsOverlay: boolean;
  /** True when the work loop is seated (enter and exit from `sit`). */
  readonly seatedWork: boolean;
  /** Stable key of the clip set: an actor set built for one plan can serve another plan with the same key. */
  readonly key: string;
}

/** Walk-like role clips: carries and the patrol walk keep walk's legs and timing; locomotion variants are walks. */
export function isWalkLikeClip(name: string): boolean {
  const spec = getPopulationClip(name);
  if (name === 'guard_patrol_walk') return true;
  // travelling role clips (the running chase) replace walk too; the caller moves the resident at their manifest speed
  return spec !== null && (spec.kind === 'carry' || spec.kind === 'locomotion' || spec.travels === true);
}

/**
 * Clip names for the owner's motions. `available` lists the library's clip names (the loaded GLB's animation names, or
 * the library manifest). Every planned name is in `available`, no name serves two motions (the owner refuses that) and
 * only motions in `ownerMotions` are planned.
 */
export function planCrowdClips(meta: CrowdResidentMeta, available: ReadonlySet<string> | readonly string[], activity: CrowdActivity = {},
  ownerMotions: readonly CrowdOwnerMotion[] = CODEX_OWNER_MOTIONS.current): CrowdClipPlan {
  const has = Array.isArray(available) ? new Set(available as readonly string[]) : available as ReadonlySet<string>;
  const owner = new Set(ownerMotions);
  if (!owner.has('idle')) throw new Error('The actor owner needs an idle motion.');
  const m = meta.motion;
  for (const base of [m.idle, m.walk, m.talk]) if (!has.has(base)) throw new Error(`Clip ${base} of ${meta.residentId} is not in its library.`);
  const clips: Partial<Record<CrowdOwnerMotion, string>> = { idle: m.idle };
  const used = new Set<string>([m.idle]);
  const put = (motion: CrowdOwnerMotion, name: string | null | undefined): boolean => {
    if (!name || !owner.has(motion) || !has.has(name) || used.has(name)) return false;
    clips[motion] = name; used.add(name); return true;
  };
  let unpresentable: string | null = null, walkIsOverlay = false, seatedWork = false;
  if (activity.guardWatch) {
    const names=[GUARD_WATCH_WALK,GUARD_WATCH_LOOP,GUARD_WATCH_ENTER,GUARD_WATCH_EXIT];
    if (!publishedGuardWatch(meta.residentId) || !m.roleClips.includes(GUARD_WATCH_WALK) || !m.roleClips.includes(GUARD_WATCH_LOOP)
      || names.some(name=>!has.has(name)) || !['walk','work','workEnter','workExit'].every(motion=>owner.has(motion as CrowdOwnerMotion))) {
      return Object.freeze({clips:Object.freeze(clips) as CrowdClipPlan['clips'],unpresentable:GUARD_WATCH_LOOP,walkIsOverlay:false,seatedWork:false,key:'guard-watch-held'});
    }
    put('walk',GUARD_WATCH_WALK);put('work',GUARD_WATCH_LOOP);put('workEnter',GUARD_WATCH_ENTER);put('workExit',GUARD_WATCH_EXIT);
    const key=CROWD_OWNER_MOTIONS_ALL.filter(k=>clips[k]).map(k=>`${k}=${clips[k]}`).join(',');
    return Object.freeze({clips:Object.freeze(clips) as CrowdClipPlan['clips'],unpresentable:null,walkIsOverlay:true,seatedWork:false,key});
  }
  const role = activity.roleClip ?? null;
  if (role !== null && (m.roleClips.indexOf(role) < 0 || !has.has(role))) unpresentable = role;
  const roleIsWalk = role !== null && unpresentable === null && isWalkLikeClip(role);
  put('talk', m.talk);
  if (roleIsWalk && owner.has('walk')) { walkIsOverlay = role !== m.walk && put('walk', role); }
  if (clips.walk === undefined) put('walk', m.walk);
  if (!walkIsOverlay && clips.walk) { put('start', `${clips.walk}_start`); put('stop', `${clips.walk}_stop`); }
  if (role !== null && unpresentable === null && !roleIsWalk) {
    if (!owner.has('work')) unpresentable = role;
    else if (put('work', role)) {
      seatedWork = getPopulationClip(role)?.kind === 'seated';
      put('workEnter', `${role}_enter`); put('workExit', `${role}_exit`);
    } else unpresentable = role;
  }
  // every planned clip costs the owner setup time (about 15 ms per clip with envelopes, measured): seat only when needed
  if (activity.seated || seatedWork) { put('sit', 'sit'); put('sitDown', 'sit_down'); put('standUp', 'stand_up'); }
  const key = CROWD_OWNER_MOTIONS_ALL.filter(k => clips[k]).map(k => `${k}=${clips[k]}`).join(',');
  return Object.freeze({ clips: Object.freeze(clips) as CrowdClipPlan['clips'], unpresentable, walkIsOverlay, seatedWork, key });
}

/** The shared face contract's calibration with the crowd resident's measured joints-only lid and jaw angles. */
export function crowdFaceCalibration(meta: CrowdResidentMeta, base: FaceCalibration = DEFAULT_FACE_CALIBRATION): FaceCalibration {
  return Object.freeze({ ...base, upperLidClosed: meta.face.upperLidClosed, lowerLidClosed: meta.face.lowerLidClosed, jawOpen: meta.face.jawOpen });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
