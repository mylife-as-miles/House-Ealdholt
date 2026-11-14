import type * as THREE from "three";

/**
 * Blender-exported Action markers, carried in a sidecar next to the GLB.
 *
 * glTF 2.0 does not standardise animation notifies; these are intentionally
 * authored in Blender and exported with scripts/export-blender-animation-events.py,
 * not fabricated by guessing at a percentage of the attack's duration.
 */
export type CombatEventName =
  | "impact"
  | "cast_release"
  | "guard"
  | "foot_left_plant"
  | "foot_left_lift"
  | "foot_right_plant"
  | "foot_right_lift";

export interface CombatEvent {
  name: CombatEventName;
  /** Seconds from the animation Action's first exported frame. */
  time: number;
}

export interface CombatEventSidecar {
  version: 1;
  action: string;
  events: CombatEvent[];
}

const names = new Set<CombatEventName>([
  "impact", "cast_release", "guard",
  "foot_left_plant", "foot_left_lift",
  "foot_right_plant", "foot_right_lift",
]);

/** Shared between all instances of a loaded, immutable AnimationClip. */
const clipEvents = new WeakMap<THREE.AnimationClip, readonly CombatEvent[]>();

/** Reject malformed and out-of-clip marker data; never corrupt playback. */
export function parseCombatEvents(input: unknown, duration: number): readonly CombatEvent[] | null {
  if (!input || typeof input !== "object" || !Number.isFinite(duration) || duration <= 0) return null;
  const data = input as Partial<CombatEventSidecar>;
  if (data.version !== 1 || typeof data.action !== "string" || !data.action.trim() ||
      !Array.isArray(data.events) || data.events.length > 128) return null;
  const events: CombatEvent[] = [];
  for (const value of data.events) {
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<CombatEvent>;
    if (!names.has(item.name as CombatEventName) || typeof item.time !== "number" ||
        !Number.isFinite(item.time) || item.time < 0 || item.time > duration + 0.025) return null;
    events.push({ name: item.name as CombatEventName, time: Math.min(duration, item.time) });
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

export function installCombatEvents(clip: THREE.AnimationClip, input: unknown): boolean {
  const events = parseCombatEvents(input, clip.duration);
  if (!events) return false;
  clipEvents.set(clip, events);
  return true;
}

export function combatEventTime(clip: THREE.AnimationClip, name: CombatEventName): number | null {
  return clipEvents.get(clip)?.find((event) => event.name === name)?.time ?? null;
}

/** Correctly retimes Blender's event time when AnimationAction speed is changed. */
export function retimedCombatEvent(
  clip: THREE.AnimationClip,
  name: CombatEventName,
  playbackDuration: number,
): number | null {
  const authored = combatEventTime(clip, name);
  if (authored === null || clip.duration <= 0 || !Number.isFinite(playbackDuration) || playbackDuration <= 0) return null;
  return Math.max(0, Math.min(playbackDuration, authored / clip.duration * playbackDuration));
}

/**
 * Stance-foot contact from Blender's plant/lift notifies. If an animation has
 * no authored foot markers, return null: no made-up planting during motion.
 */
export function plantedAt(
  clip: THREE.AnimationClip,
  side: "left" | "right",
  clipTime: number,
): boolean | null {
  const events = clipEvents.get(clip);
  if (!events || !Number.isFinite(clipTime)) return null;
  const time = Math.max(0, Math.min(clip.duration, clipTime));
  let planted = false;
  let found = false;
  for (const event of events) {
    if (event.name !== `foot_${side}_plant` && event.name !== `foot_${side}_lift`) continue;
    found = true;
    if (event.time > time) break;
    planted = event.name.endsWith("_plant");
  }
  return found ? planted : null;
}
