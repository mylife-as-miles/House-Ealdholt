// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The arithmetic of solid matter a spell raises and breaks: the cut of a crystal, how it comes out of the stone,
 * and how a broken piece of it flies, lands, skids and lies. No Three.js in here, so the node tests reach it
 * (shared/play/spell-solids.test.ts); shared/solids.ts draws what this decides, and its vertex shader evaluates
 * the same rise and the same flight.
 *
 * What is kept from the reference (its ice field): a crystal is a tapered faceted prism in a unit space, base on
 * y = 0 and tip at y = 1, so one cut serves every size; and a spike is a record of dice, never of metres. What is
 * ours: nothing is placed on the CPU after the cast is made (the reference rebuilds every matrix every frame);
 * the rise is the step response of a sprung mass, so the overshoot and the settling are one formula; the cut
 * twists as it climbs so its faces are gem facets and not the sides of a cone; and a spike ends by breaking into
 * pieces that fly, land, skid and melt where they stop.
 */
import { sequence, type Vec } from "./particlePlan";

export interface CrystalCut {
  /** Faces round the prism: 5 to 7 read as ice. */
  sides?: number;
  /** How ragged: 0 a clean prism, 1 a torn one. */
  rough?: number;
  /** How far the tip stands off the axis, in base radii. */
  bend?: number;
}

/**
 * One crystal, as loose triangles (nine numbers each) wound to face outward. Unit space: the base ring lies on
 * y = 0 inside a radius of 0.5 and the tip is at y = 1. There is no underside: a crystal stands in the stone.
 *
 * Three rings and a tip. Each ring is turned a little against the one below, so every side is two triangles that
 * do not share a plane, and the tip is off the axis, so it reads as chipped.
 */
export function crystalGeometry(seed: number, cut: CrystalCut = {}): Float32Array {
  const dice = sequence(seed), sides = Math.max(3, Math.round(cut.sides ?? 6)), rough = cut.rough ?? 0.5, bend = cut.bend ?? 0.3;
  const lean = dice() * Math.PI * 2, leanX = Math.cos(lean) * bend * 0.5, leanZ = Math.sin(lean) * bend * 0.5;
  const angles = Array.from({ length: sides }, (_, i) => ((i + (dice() - 0.5) * 0.5 * rough) / sides) * Math.PI * 2);
  // height, radius as a share of the base, twist against the ring below
  const shoulder = 0.42 + 0.2 * dice(), neck = 0.8 + 0.1 * dice();
  const levels = [
    { y: 0, r: 1, twist: 0 },
    { y: shoulder, r: 0.74 + 0.14 * dice(), twist: (dice() - 0.5) * 0.5 * rough },
    { y: neck, r: 0.3 + 0.16 * dice(), twist: (dice() - 0.5) * 0.7 * rough },
  ];
  const rings = levels.map((level) => angles.map((angle) => {
    // rounder where it leaves the stone, more torn toward the tip
    const r = 0.5 * level.r * (1 + (dice() - 0.5) * 0.5 * rough * (0.25 + 0.75 * level.y));
    const drift = level.y ** 1.6, a = angle + level.twist;
    return [Math.cos(a) * r + leanX * drift, level.y + (level.y > 0 ? (dice() - 0.5) * 0.08 * rough : 0), Math.sin(a) * r + leanZ * drift];
  }));
  const tip = [leanX + (dice() - 0.5) * 0.1 * rough, 1, leanZ + (dice() - 0.5) * 0.1 * rough];
  const out: number[] = [];
  for (let ring = 0; ring < rings.length - 1; ring += 1) for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides, a = rings[ring][i], b = rings[ring][j], c = rings[ring + 1][i], d = rings[ring + 1][j];
    out.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const top = rings[rings.length - 1];
  for (let i = 0; i < sides; i += 1) out.push(...top[i], ...tip, ...top[(i + 1) % sides]);
  return new Float32Array(out);
}

/**
 * A broken piece: two uneven points over a five-sided waist, as loose triangles wound outward. Unit space: it
 * fits a sphere of radius 0.5 about the origin.
 */
export function chunkGeometry(seed: number): Float32Array {
  const dice = sequence(seed), sides = 5;
  const waist = Array.from({ length: sides }, (_, i) => {
    const a = ((i + (dice() - 0.5) * 0.6) / sides) * Math.PI * 2, r = 0.28 + 0.2 * dice();
    return [Math.cos(a) * r, (dice() - 0.5) * 0.24, Math.sin(a) * r];
  });
  const up = [(dice() - 0.5) * 0.2, 0.3 + 0.18 * dice(), (dice() - 0.5) * 0.2], down = [(dice() - 0.5) * 0.2, -0.22 - 0.16 * dice(), (dice() - 0.5) * 0.2];
  const out: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = waist[i], b = waist[(i + 1) % sides];
    out.push(...a, ...up, ...b, ...a, ...b, ...down);
  }
  return new Float32Array(out);
}

/** What the springs under a rising spike are tuned to: how many radians of swing in one `rise`. */
const SWING = 3.6;

/**
 * How far out of the stone a spike is, `age` seconds after it broke through: 0 buried, 1 at its full height.
 * It is the step response of a sprung mass: it leaves slowly for an instant, comes up fast, passes its height by
 * `bounce` (0.16 is a sixth too tall) at 0.87 of `rise`, and settles. With no bounce it eases up and stops: the
 * form for reduced motion.
 */
export function emergence(age: number, rise: number, bounce: number): number {
  if (age <= 0) return 0;
  const s = age / Math.max(0.02, rise);
  if (bounce < 0.005) { const t = Math.min(1, s); return t * t * (3 - 2 * t); }
  const damping = (-Math.log(bounce) * SWING) / Math.PI;
  return 1 - Math.exp(-damping * s) * (Math.cos(SWING * s) + (damping / SWING) * Math.sin(SWING * s));
}
/** The moment of a spike's greatest height, as a share of its `rise`. */
export const EMERGENCE_PEAK = Math.PI / SWING;

/** How a loose piece meets the stone. */
export const CHUNK_FLIGHT = { gravity: 9.5, restitution: 0.26, friction: 4.2 } as const;

/**
 * Where a broken piece is `age` seconds after it was thrown from `from` at `fling`, over a floor at `floor`
 * (the height its centre rests at). It flies free, lands, hops once at a quarter of the speed it came down with,
 * and skids to a stop against friction. `turned` is how long it has effectively been tumbling: it stops turning as
 * it stops sliding.
 */
export function chunkFlight(from: Vec, fling: Vec, floor: number, age: number): Vec & { landed: boolean; turned: number } {
  const { gravity, restitution, friction } = CHUNK_FLIGHT, t = Math.max(0, age);
  const landing = (fling.y + Math.sqrt(fling.y * fling.y + 2 * gravity * Math.max(0, from.y - floor))) / gravity;
  if (t < landing) return { x: from.x + fling.x * t, y: from.y + fling.y * t - 0.5 * gravity * t * t, z: from.z + fling.z * t, landed: false, turned: t };
  const since = t - landing, hop = (gravity * landing - fling.y) * restitution, aloft = (2 * hop) / gravity;
  const slide = (1 - Math.exp(-friction * since)) / friction;
  return {
    x: from.x + fling.x * (landing + slide), y: floor + (since < aloft ? hop * since - 0.5 * gravity * since * since : 0), z: from.z + fling.z * (landing + slide),
    landed: true, turned: landing + slide,
  };
}

/** One solid: a spike rooted in the stone, or a loose piece thrown across it. */
export interface Solid {
  loose: boolean;
  /** Where it breaks the stone (rooted), or where it is thrown from (loose). */
  root: Vec;
  /** Its radius at the base and its height (rooted); its half-width and half-length (loose). */
  radius: number;
  height: number;
  /** Rooted: the way its tip leans, as radians toward +x and +z. Loose: how fast it tumbles, radians a second. */
  lean: { x: number; z: number };
  spin?: number;
  yaw: number;
  seed: number;
  /** Seconds from the cast until it breaks through (rooted) or is thrown (loose). */
  birth: number;
  /** Rooted: seconds to its full height. Loose: seconds it takes to melt away at the end. */
  rise: number;
  /** Rooted: when it breaks or sinks, and how long that takes. Loose: `end` is when it is gone. */
  breakAt: number;
  end: number;
  fling?: Vec;
  /**
   * Rooted, and run through a body (shared/piercePlan.ts): where along its height (0..1) it entered and left it.
   * The field coats that length and runs blood down from it when told to (SolidField.setBlood). Left out, none.
   */
  blood?: { entry: number; exit: number };
}

export interface SolidBuffers {
  count: number;
  /** root x, y, z */
  root: Float32Array;
  /** lean x, lean z (or spin, 0), yaw, seed */
  lean: Float32Array;
  /** radius, height, loose */
  size: Float32Array;
  /** birth, rise, breakAt, end */
  life: Float32Array;
  /** fling x, y, z */
  fling: Float32Array;
  /** where it entered and left a body it ran through, along its height: 0, 0 for none */
  blood: Float32Array;
  /** The moment the last of them is gone. */
  spent: number;
}

/** Lays `solids` out for the field. No more than `capacity` are kept, the first ones: put what matters first. */
export function packSolids(solids: readonly Solid[], capacity: number): SolidBuffers {
  const kept = Math.max(0, Math.min(capacity, solids.length));
  const buffers: SolidBuffers = { count: kept, root: new Float32Array(kept * 3), lean: new Float32Array(kept * 4), size: new Float32Array(kept * 3), life: new Float32Array(kept * 4), fling: new Float32Array(kept * 3), blood: new Float32Array(kept * 2), spent: 0 };
  for (let i = 0; i < kept; i += 1) {
    const s = solids[i];
    buffers.root.set([s.root.x, s.root.y, s.root.z], i * 3);
    buffers.lean.set(s.loose ? [s.spin ?? 0, 0, s.yaw, s.seed] : [s.lean.x, s.lean.z, s.yaw, s.seed], i * 4);
    buffers.size.set([s.radius, s.height, s.loose ? 1 : 0], i * 3);
    buffers.life.set([s.birth, s.rise, s.breakAt, s.end], i * 4);
    buffers.fling.set([s.fling?.x ?? 0, s.fling?.y ?? 0, s.fling?.z ?? 0], i * 3);
    if (s.blood && !s.loose) buffers.blood.set([s.blood.entry, s.blood.exit], i * 2);
    buffers.spent = Math.max(buffers.spent, s.loose ? s.end : s.breakAt + s.end);
  }
  return buffers;
}
