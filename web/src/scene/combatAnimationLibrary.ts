import type * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { COMBAT_LIBRARY_VERSION } from "../../../shared/play/combat-sequences";
import { installCombatEvents, type CombatEventName } from "./animationContacts";

export interface AnimationMarker { name: string; frame: number; time: number; }
export interface CombatClipMetadata {
  id: string;
  version: string;
  archetype: string;
  tags: readonly string[];
  fps: number;
  duration: number;
  markers: readonly AnimationMarker[];
  /** combat-v2: an idle that repeats instead of holding its last frame. */
  loop?: boolean;
  /** combat-v2: the clip is a turned or re-timed copy of another, not authored that way. */
  derived?: string;
}
/**
 * What a clip carries the pelvis across the floor, read from its own keyframes:
 * rig-local x and z relative to the first key, and how far along the net travel
 * each key is (0 at the start, 1 where the clip ends). The stage moves the
 * figure by it and takes the same amount back out of the pelvis, so the body
 * steps across the board instead of sliding back when the clip is over.
 */
export interface RootTravel { times: Float32Array; x: Float32Array; z: Float32Array; progress: Float32Array; /** Net travel in rig-local units. */ net: { x: number; z: number }; }
export interface CombatVariant { clip: THREE.AnimationClip; metadata: CombatClipMetadata; travel?: RootTravel; }
export type CombatAnimationLibrary = ReadonlyMap<string, CombatVariant> & {
  /** Original duplicate ids are retained for faithful version-1 replay. */
  readonly versions?: ReadonlyMap<string, ReadonlyMap<string, CombatVariant>>;
};

/** The retargeted CC0 library (`assets/chess/combat-v2`, see docs/play/COMBAT_LIBRARY_V2.md): what a Pawn duel is played on. */
export const COMBAT_LIBRARY_V2_VERSION = "crownfall-pawn-combat-2";

/**
 * Knights, Rooks and Kings (`assets/chess/combat-ranks`, scripts/chess/build_rank_combat_library.py): one library per
 * figure's rig, holding its own strike and death with markers read off the motion, and the guards and hits bought for
 * it on Meshy (or moved onto it from a class-mate's rig). Played by combat/rankDuel.ts.
 */
export const COMBAT_RANK_LIBRARY_VERSION = "crownfall-rank-combat-1";
const rank = (url: string): readonly { url: string; version: string }[] => [{ url, version: COMBAT_RANK_LIBRARY_VERSION }];

const both = (v2: string, v1: string): readonly { url: string; version: string }[] => [
  { url: v2, version: COMBAT_LIBRARY_V2_VERSION },
  { url: v1, version: COMBAT_LIBRARY_VERSION },
];

/**
 * Both libraries are loaded for a Pawn rig, for every kingdom (Aethelgard wp,
 * Solforiz bp, Korvenia ep, Kwind-09 kp). combat-v2 holds the duel; combat-v1
 * (keyframed procedurally) is kept for the clips v2 has no counterpart of: the
 * raised stance of a selected Pawn and the tuple the plain cinematic plays.
 * Where both name a clip (`attack.thrust`, `defend.parry`, `death.backward`,
 * `recovery.victory`) the v2 motion is the one installed. Both are baked from
 * the same rig and the same sockets (combat-v1/prop-sockets-kingdoms.json; a
 * forearm guard stands in for the shield Korvenia and Kwind-09 do not carry).
 */
const SOURCES: Record<string, readonly { url: string; version: string }[]> = {
  wp: both(new URL("../assets/chess/combat-v2/wp.glb", import.meta.url).href, new URL("../assets/chess/combat-v1/wp.glb", import.meta.url).href),
  bp: both(new URL("../assets/chess/combat-v2/bp.glb", import.meta.url).href, new URL("../assets/chess/combat-v1/bp.glb", import.meta.url).href),
  ep: both(new URL("../assets/chess/combat-v2/ep.glb", import.meta.url).href, new URL("../assets/chess/combat-v1/ep.glb", import.meta.url).href),
  kp: both(new URL("../assets/chess/combat-v2/kp.glb", import.meta.url).href, new URL("../assets/chess/combat-v1/kp.glb", import.meta.url).href),
  // The rank libraries, by kingdom: Aethelgard w, Solforiz b, Korvenia e (its Knight alone closes), Kwind-09 k.
  wn: rank(new URL("../assets/chess/combat-ranks/wn.glb", import.meta.url).href),
  wr: rank(new URL("../assets/chess/combat-ranks/wr.glb", import.meta.url).href),
  wk: rank(new URL("../assets/chess/combat-ranks/wk.glb", import.meta.url).href),
  bn: rank(new URL("../assets/chess/combat-ranks/bn.glb", import.meta.url).href),
  br: rank(new URL("../assets/chess/combat-ranks/br.glb", import.meta.url).href),
  bk: rank(new URL("../assets/chess/combat-ranks/bk.glb", import.meta.url).href),
  en: rank(new URL("../assets/chess/combat-ranks/en.glb", import.meta.url).href),
  kn: rank(new URL("../assets/chess/combat-ranks/kn.glb", import.meta.url).href),
  kr: rank(new URL("../assets/chess/combat-ranks/kr.glb", import.meta.url).href),
  kk: rank(new URL("../assets/chess/combat-ranks/kk.glb", import.meta.url).href),
};

/** These clips are authored against these exact source rigs. A new kingdom's
 * Pawn needs its own qualified/retargeted library, even if bone names match. */
const SOURCE_RIGS: Record<string, string> = {
  wp: "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/36d8c7d4-2f42-4672-8908-e9298fce9b69-rigged.glb",
  // Solforiz's Ash Legionnaire (10 November 2026); bp was rebaked from this rig, in both libraries.
  bp: "/models/solforiz/p-rigged.glb",
  ep: "/models/korvenia/p-rigged.glb",
  kp: "/models/kwind09/p-rigged.glb",
  wn: "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/43f08150-5463-4112-9949-2e1a9a9a6bd2-rigged.glb",
  wr: "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/211b0ba5-2c7f-44ff-8143-b625bca41df1-rigged.glb",
  wk: "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/704a772c-4a50-4619-b5ad-6e2bbf9703b8-rigged.glb",
  bn: "/models/solforiz/n-rigged.glb",
  br: "/models/solforiz/r-rigged.glb",
  bk: "/models/solforiz/k-rigged.glb",
  en: "/models/korvenia/n-rigged.glb",
  kn: "/models/kwind09/n-rigged.glb",
  kr: "/models/kwind09/r-rigged.glb",
  kk: "/models/kwind09/k-rigged.glb",
};
export function supportsCombatSource(archetype: string, riggedUrl: string | undefined): boolean {
  return typeof riggedUrl === "string" && Object.prototype.hasOwnProperty.call(SOURCE_RIGS, archetype) && SOURCE_RIGS[archetype] === riggedUrl;
}

export function validateCombatMetadata(value: unknown, archetype: string, clip: THREE.AnimationClip, version: string = COMBAT_LIBRARY_VERSION): CombatClipMetadata {
  if (!value || typeof value !== "object") throw new Error("Missing Blender combat markers");
  const meta = value as CombatClipMetadata;
  if (meta.version !== version || meta.archetype !== archetype || meta.id !== clip.name
    || !Number.isFinite(meta.fps) || meta.fps <= 0 || !Number.isFinite(meta.duration) || meta.duration <= 0
    || Math.abs(meta.duration - clip.duration) > .002 || !Array.isArray(meta.markers) || meta.markers.length > 128
    || !Array.isArray(meta.tags) || meta.tags.some(tag => typeof tag !== "string")) {
    throw new Error("Incompatible combat animation metadata");
  }
  const events = new Set<string>();
  for (const marker of meta.markers) {
    if (!marker || typeof marker !== "object") throw new Error("Invalid Blender animation event");
    const identity = `${marker.name}:${marker.frame}`;
    if (typeof marker.name !== "string" || events.has(identity) || !Number.isInteger(marker.frame) || marker.frame < 0
      || !Number.isFinite(marker.time) || marker.time < 0 || marker.time > meta.duration + .001
      || Math.abs(marker.frame / meta.fps - marker.time) > .0001) throw new Error("Invalid Blender animation event");
    events.add(identity);
  }
  const roles: Record<string, string> = { attack: "attack", defend: "defense", hit: "hit", death: "death", ready: "ready", recovery: "recovery" };
  const role = roles[meta.id.split(".")[0]];
  if (!role || !meta.tags.includes(role)) throw new Error("Combat animation role mismatch");
  if (role === "attack") {
    const contacts = meta.markers.filter(marker => marker.name === "contact");
    const impacts = meta.markers.filter(marker => marker.name === "impact");
    if (contacts.length !== 1 || impacts.length > 1 || (impacts.length && Math.abs(impacts[0].time-contacts[0].time) > .0001)) throw new Error("Attack lacks one consistent authored contact marker");
  }
  if (meta.loop !== undefined && typeof meta.loop !== "boolean") throw new Error("Incompatible combat animation metadata");
  return { ...meta, tags: [...meta.tags], markers: [...meta.markers].sort((a, b) => a.time-b.time || a.name.localeCompare(b.name)) };
}

export function validateCombatTracks(clip: THREE.AnimationClip): void {
  if (!clip.tracks.length) throw new Error("Combat animation has no skeletal channels");
  for (const track of clip.tracks) {
    if (!track.times.length || track.times[0] < 0 || track.times[track.times.length-1] > clip.duration+.002
      || !Number.isInteger(track.getValueSize()) || track.getValueSize() <= 0) throw new Error("Invalid combat animation channel");
    for (let i = 0; i < track.times.length; i++) if (!Number.isFinite(track.times[i]) || (i > 0 && track.times[i] <= track.times[i-1])) throw new Error("Invalid combat keyframe times");
    for (const value of track.values) if (!Number.isFinite(value)) throw new Error("Nonfinite combat animation pose");
  }
}

/** Both embedded Blender markers and PR #3's JSON sidecars use one event API. */
export function installCombatMetadataEvents(variant: CombatVariant): void {
  const names = new Set(["impact", "cast_release", "guard", "foot_left_plant", "foot_left_lift", "foot_right_plant", "foot_right_lift"]);
  const events = variant.metadata.markers.flatMap(marker => {
    if (marker.name === "impact") return [];
    const name = marker.name === "contact" ? "impact" : marker.name === "evade" ? "guard" : marker.name;
    return names.has(name) ? [{ name: name as CombatEventName, time: marker.time }] : [];
  });
  if (!installCombatEvents(variant.clip, { version: 1, action: variant.clip.name, events })) throw new Error("Invalid embedded combat events");
}

/** Net pelvis travel below this share of the pelvis's own height (about a centimetre on the board) is sway, not a step. */
const TRAVEL_MIN = 0.04;

/**
 * The floor travel of a clip, from its pelvis channel (both libraries keep
 * travel in the pelvis; no other joint's translation changes). Undefined for a clip
 * that ends where it began, and for deaths, whose body stays where it falls.
 */
export function rootTravelOf(clip: THREE.AnimationClip): RootTravel | undefined {
  if (clip.name.startsWith("death.")) return undefined;
  // Every joint carries a translation channel; only the pelvis's changes. It is the one that ends furthest from where it began.
  let track: THREE.KeyframeTrack | null = null, length = 0;
  for (const candidate of clip.tracks) {
    if (!candidate.name.endsWith(".position") || candidate.getValueSize() !== 3 || candidate.times.length < 2) continue;
    const v = candidate.values, last = (candidate.times.length - 1) * 3, travelled = Math.hypot(v[last] - v[0], v[last + 2] - v[2]);
    if (travelled > length) { track = candidate; length = travelled; }
  }
  if (!track || !(length >= TRAVEL_MIN * Math.max(1e-6, Math.abs(track.values[1])))) return undefined;
  const { times, values } = track, count = times.length;
  const net = { x: values[(count - 1) * 3] - values[0], z: values[(count - 1) * 3 + 2] - values[2] };
  const x = new Float32Array(count), z = new Float32Array(count), progress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = values[i * 3] - values[0]; z[i] = values[i * 3 + 2] - values[2];
    progress[i] = Math.min(1, Math.max(0, (x[i] * net.x + z[i] * net.z) / (length * length)));
  }
  progress[count - 1] = 1;
  return { times: Float32Array.from(times), x, z, progress, net };
}

/** A travel track read at a clip time: rig-local offset from the first key, and progress along the net travel. */
export function sampleRootTravel(travel: RootTravel, time: number, out: { x: number; z: number; progress: number }): { x: number; z: number; progress: number } {
  const times = travel.times, last = times.length - 1;
  if (time <= times[0]) { out.x = travel.x[0]; out.z = travel.z[0]; out.progress = travel.progress[0]; return out; }
  if (time >= times[last]) { out.x = travel.x[last]; out.z = travel.z[last]; out.progress = 1; return out; }
  let low = 0, high = last;
  while (high - low > 1) { const middle = (low + high) >> 1; if (times[middle] <= time) low = middle; else high = middle; }
  const t = (time - times[low]) / Math.max(1e-9, times[high] - times[low]);
  out.x = travel.x[low] + (travel.x[high] - travel.x[low]) * t; out.z = travel.z[low] + (travel.z[high] - travel.z[low]) * t;
  out.progress = travel.progress[low] + (travel.progress[high] - travel.progress[low]) * t;
  return out;
}

export async function loadCombatAnimationLibrary(archetype: string, loader: GLTFLoader): Promise<CombatAnimationLibrary | null> {
  if (!Object.prototype.hasOwnProperty.call(SOURCES, archetype)) return null;
  const sources = SOURCES[archetype];
  if (!sources?.length) return null;
  const library = new Map<string, CombatVariant>(), versions = new Map<string, Map<string, CombatVariant>>();
  for (const source of sources) {
    const gltf = await loader.loadAsync(source.url);
    const seen = new Set<string>();
    for (let i = 0; i < gltf.animations.length; i++) {
      const clip = gltf.animations[i];
      validateCombatTracks(clip);
      const metadata = validateCombatMetadata(gltf.parser.json.animations?.[i]?.extras?.crownfall, archetype, clip, source.version);
      if (seen.has(metadata.id)) throw new Error("Duplicate combat animation id");
      seen.add(metadata.id);
      const variant: CombatVariant = { clip, metadata };
      // Both keep their travel in the pelvis: a step or a lunge moves the figure across the board instead of sliding back.
      if (source.version === COMBAT_LIBRARY_V2_VERSION || source.version === COMBAT_RANK_LIBRARY_VERSION) { const travel = rootTravelOf(clip); if (travel) variant.travel = travel; }
      installCombatMetadataEvents(variant);
      let profile = versions.get(source.version); if (!profile) { profile = new Map(); versions.set(source.version, profile); }
      profile.set(metadata.id, variant);
      // The default view keeps v2 precedence, while v1 remains selectable.
      if (!library.has(metadata.id)) library.set(metadata.id, variant);
    }
  }
  return Object.assign(library, { versions });
}
