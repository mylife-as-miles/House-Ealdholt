/**
 * Which clip carries a figure a pace in a given direction. Plain data and
 * arithmetic, apart from the stage so it runs in node tests.
 */

/** Which way a figure is being moved, against the way it faces. */
export function travelHeading(facing: { x: number; z: number }, delta: { x: number; z: number }): "forward" | "back" | "left" | "right" {
  const along = facing.x * delta.x + facing.z * delta.z;
  // The left of a figure facing along (x, z) is (z, -x).
  const left = facing.z * delta.x - facing.x * delta.z;
  return Math.abs(along) >= Math.abs(left) ? (along >= 0 ? "forward" : "back") : left >= 0 ? "left" : "right";
}

/** The combat-v2 clip that carries a figure that way: guarded steps along the line, hops off it or back in a hurry. */
export const TRAVEL_CLIPS = {
  step: { forward: "ready.step-forward", back: "ready.step-back", left: "defend.dodge-left", right: "defend.dodge-right" },
  dodge: { forward: "ready.step-forward", back: "defend.dodge-back", left: "defend.dodge-left", right: "defend.dodge-right" },
} as const;
