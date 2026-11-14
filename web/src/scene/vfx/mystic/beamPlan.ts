/**
 * The arithmetic of a thread of light: the curve it hangs along, how far it has reached, and how many strands,
 * rings and motes it is drawn with. No Three.js in here, so the node tests reach it
 * (shared/play/mystic-beam.test.ts); mystic/beam.ts draws what this decides, and its shaders evaluate the same
 * curve.
 *
 * A beam is a quadratic Bézier from where it is cast to where it lands. It is never a straight rod: it bows under
 * its own length and sways, and everything on it (the core, the strands wound round it, the rings travelling down
 * it, the motes drawn along it) is placed by one parameter `u`, 0 at the hand and 1 at the target.
 */
import type { QualityPreset } from "../../quality";

export interface Point { x: number; y: number; z: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Hermite ease between two edges, as GLSL's smoothstep. */
export const smooth = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

/**
 * The control point of the beam's curve. `bow` drops the middle of the thread by that fraction of its length, so a
 * long cast from on high arrives from above rather than along the line of sight; `sway` (scene units, each -1..1
 * times an amplitude the caller chooses) pushes the middle sideways and is what a slow wind does to it.
 */
export function beamControl(from: Point, to: Point, bow: number, sway: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return { x: (from.x + to.x) / 2 + sway.x, y: (from.y + to.y) / 2 - bow * length + sway.y, z: (from.z + to.z) / 2 + sway.z };
}

/** The point at `u` on the curve. */
export function beamPoint(from: Point, control: Point, to: Point, u: number): Point {
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return { x: a * from.x + b * control.x + c * to.x, y: a * from.y + b * control.y + c * to.y, z: a * from.z + b * control.z + c * to.z };
}

/** The curve's direction of travel at `u`, not normalised. */
export function beamTangent(from: Point, control: Point, to: Point, u: number): Point {
  return {
    x: 2 * (1 - u) * (control.x - from.x) + 2 * u * (to.x - control.x),
    y: 2 * (1 - u) * (control.y - from.y) + 2 * u * (to.y - control.y),
    z: 2 * (1 - u) * (control.z - from.z) + 2 * u * (to.z - control.z),
  };
}

/** The curve's length, by sixteen chords: within a fraction of a percent for the gentle bows used here. */
export function beamLength(from: Point, control: Point, to: Point): number {
  let length = 0, last = from;
  for (let i = 1; i <= 16; i += 1) {
    const next = beamPoint(from, control, to, i / 16);
    length += Math.hypot(next.x - last.x, next.y - last.y, next.z - last.z);
    last = next;
  }
  return length;
}

/**
 * How far a strand stands off the core at `u`: nothing at either end, where every strand is gathered into the hand
 * and into the target, and `radius` in between. The strands breathe: `pulse` is a slow -1..1 wave.
 */
export function strandRadius(u: number, radius: number, pulse = 0): number {
  return radius * Math.sqrt(Math.max(0, Math.sin(Math.PI * clamp01(u)))) * (1 + 0.22 * pulse);
}

/** The angle of strand `index` of `count` round the core at `u`, after `seconds`: wound `turns` times and turning. */
export function strandAngle(index: number, count: number, u: number, turns: number, seconds: number, spin: number): number {
  return (index / Math.max(1, count)) * Math.PI * 2 + u * turns * Math.PI * 2 + seconds * spin;
}

/**
 * How bright the beam is at `u` when it has reached `reach` of the way: lit behind the tip, dark ahead of it, with a
 * hot head `tip` wide at the tip itself. Returns the body's brightness and the tip's, each 0..1. The lit edge runs
 * a little ahead of the tip ({@link REACH_LEAD}), so a thread that has landed is lit to its very end.
 */
export function beamReach(u: number, reach: number, tip = 0.06): { body: number; head: number } {
  const edge = reach * REACH_LEAD;
  const body = 1 - smooth(edge - 0.012, edge + 0.012, u);
  const head = reach >= 1 ? 0 : Math.exp(-(((u - reach) / tip) ** 2));
  return { body, head };
}
/** How far ahead of the tip the lit edge runs, as a factor of the reach. */
export const REACH_LEAD = 1.03;

export interface BeamBudget {
  /** Strands wound round the core. */
  strands: number;
  /** Rune rings travelling along it. */
  rings: number;
  /** Motes drawn along it. */
  motes: number;
  /** Sparks thrown where it lands. */
  sparks: number;
  /** Segments each ribbon is cut into. */
  segments: number;
}

/** What a beam is drawn with at each quality tier. The lowest tier keeps the core, one strand and a few motes. */
export const BEAM_BUDGET: Readonly<Record<QualityPreset, BeamBudget>> = {
  low: { strands: 1, rings: 2, motes: 48, sparks: 24, segments: 40 },
  medium: { strands: 2, rings: 4, motes: 120, sparks: 56, segments: 64 },
  high: { strands: 3, rings: 5, motes: 220, sparks: 96, segments: 96 },
  ultra: { strands: 3, rings: 6, motes: 320, sparks: 140, segments: 128 },
};

/** Where ring `index` of `count` sits on the beam after `seconds`, travelling `speed` beam-lengths a second from the hand. */
export function ringPosition(index: number, count: number, seconds: number, speed: number): number {
  const u = (index / Math.max(1, count) + seconds * speed) % 1;
  return u < 0 ? u + 1 : u;
}

/**
 * Where on the beam a ring is when it is `phase` of the way through its journey: it slows as it comes down on the
 * target, so the rings gather over it instead of passing through at one speed.
 */
export function ringTravel(phase: number): number {
  const left = 1 - clamp01(phase);
  return 1 - left * left;
}

/** A ring is born small at the hand, opens along the beam, and closes into the target. */
export function ringScale(u: number): number {
  return 0.55 + 0.45 * Math.sin(Math.PI * clamp01(u));
}

/**
 * How much larger the strands, rings and motes are drawn at `u` than at the target. A cast from across the arena
 * starts several times further from the eye than it lands; drawn at one size it would dwindle to nothing at the
 * hand. `far` is the scale at the hand, 1 for a cast between two figures on the board.
 */
export function farScale(u: number, far: number): number {
  return lerp(far, 1, smooth(0, 1, u));
}

/** A ring fades in out of the hand and out into the target, so it never pops at either end. */
export function ringFade(u: number): number {
  return smooth(0, 0.12, u) * (1 - smooth(0.86, 1, u));
}

export { lerp };
