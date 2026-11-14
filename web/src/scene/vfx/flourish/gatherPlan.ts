/**
 * The ribbons a caster draws in as it gathers a spell, as arithmetic: three to five tapered streamers of the kingdom's
 * light, each running a spiral path in to the hand, again and again until the spell leaves it. No Three.js in here, so
 * the node tests reach it (shared/play/flourish-gather.test.ts); gather.ts draws it, and its vertex shader is this path.
 *
 * Every ribbon of a cast turns the same way round the hand, so together they read as one vortex being drawn in, not as
 * loose threads. Each is a window sliding along its own spiral: its head runs from far out to the hand and its tail
 * follows it in, so it arrives, narrows and is gone into the hand before the next pass begins.
 */
import { clamp01, smoothstep } from "./flourishPlan";

export const GATHER = Object.freeze({
  /** How far out a ribbon begins (scene units), before each strand's own dice. */
  radius: 0.85,
  /** Turns round the hand on the way in. */
  turns: 1.15,
  /** How much of its path one ribbon covers at once, as a fraction of the path. */
  run: 0.42,
  /** Seconds one pass takes, at most and at least: a short gather takes quicker passes. */
  period: 0.62,
  quickest: 0.38,
  /** Half its width at its widest. */
  width: 0.03,
  /** How it comes up and goes out. */
  fadeIn: 0.16,
  fadeOut: 0.12,
  /** A Kwind-09 cast's little arcs: how far they reach from the hand, and how often they jump. */
  arcReach: 0.32,
  arcRate: 18,
});

/** The seconds one pass takes in a gather `seconds` long: a whole number of passes ending as the spell leaves the hand. */
export function gatherPeriod(seconds: number): number {
  if (!(seconds > 0)) return GATHER.period;
  const passes = Math.max(1, Math.round(seconds / GATHER.period));
  return Math.max(GATHER.quickest, Math.min(1.2, seconds / passes));
}

/** How strongly the ribbons show `t` seconds into a gather `seconds` long: up over fadeIn, out over the last fadeOut. */
export function gatherEnvelope(t: number, seconds: number): number {
  if (!(t >= 0) || !(seconds > 0) || t >= seconds) return 0;
  return smoothstep(0, GATHER.fadeIn, t) * (1 - smoothstep(seconds - GATHER.fadeOut, seconds, t));
}

/** A strand's own numbers: its place in the bundle (0..1) and three dice. As ribbonPlan.strandSeeds lays them out. */
export interface Strand { place: number; a: number; b: number; c: number }

/**
 * Where a strand's path is at `s` (0 far out, 1 at the hand), relative to the hand: a spiral that tightens and levels in
 * as it nears it. The same expression as gather.ts's `spiral`.
 */
export function spiralPoint(s: number, strand: Strand, radius: number = GATHER.radius, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const k = clamp01(s);
  const turn = strand.a * Math.PI * 2 + GATHER.turns * Math.PI * 2 * k;
  const r = radius * (0.75 + 0.5 * strand.c) * Math.pow(1 - k, 1.25);
  const h = (-0.45 + 1.1 * strand.b) * radius * (1 - k * k);
  out.x = Math.cos(turn) * r; out.y = h; out.z = Math.sin(turn) * r;
  return out;
}

/** Where a strand's head is on its path at `time` in passes of `period`: 0 to 1 + run, so its tail reaches the hand too. */
export function strandHead(time: number, period: number, strand: Strand): number {
  const phase = ((time / period + strand.place * 0.37 + strand.a) % 1 + 1) % 1;
  return phase * (1 + GATHER.run);
}

/** The width of a strand at `t` along its window (0 its tail, 1 its head) with its head at `head`; 0 where it is off its path. */
export function strandWidth(t: number, head: number): number {
  const s = head - (1 - clamp01(t)) * GATHER.run;
  if (s <= 0 || s >= 1) return 0;
  const taper = smoothstep(0, 0.55, t) * (1 - 0.75 * smoothstep(0.88, 1, t));
  return GATHER.width * taper * (0.55 + 0.45 * (1 - s));
}
