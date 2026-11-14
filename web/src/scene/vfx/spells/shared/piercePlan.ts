/**
 * Running a piece through: where a blade that comes up out of the stone enters the victim's torso, where it comes
 * out, and the wounds it opens. No Three.js in here, so the node tests reach it (shared/play/spell-pierce.test.ts);
 * the ice spells (glacial/, frost/) raise their blades along these lines and report these wounds to the match, which
 * draws their blood through its gore system (vfx/spells/spell.ts `pierce`).
 *
 * The spell knows only the victim's chest and the stone under it, so the torso is a stand-in: an upright capsule
 * round the chest, from the hips to the shoulders, in proportion to the chest's height (the match aims at the chest,
 * about three fifths of a figure's height), facing the caster (a piece turns to face the one that takes it). A blade
 * is a straight line from where it stands in the stone toward a point inside the far side of the torso, high; where
 * that line meets the capsule is where it went in, and where it leaves the capsule is where it came out.
 *
 * At Minimal nothing is run through: the blades rise as bars round the body instead, a hand's width off it, and hold
 * it upright between them, and no wound is opened.
 */
import type { Point } from "../../mystic/beamPlan";
import { sequence } from "./particlePlan";

export type Violence = "minimal" | "cinematic" | "full";

/** The victim's torso as the spell imagines it. */
export interface TorsoFrame {
  /** The chest (above the stone's centre), and the height of the stone. */
  chest: Point;
  floor: number;
  /** Unit vectors on the board: toward the caster (the way it faces), and to its right. */
  forward: { x: number; z: number };
  right: { x: number; z: number };
  /** The capsule: its radius, and the heights of its hips and shoulders. */
  radius: number;
  low: number;
  high: number;
}

/**
 * The torso of a figure standing on `stone` with its chest at `chest`, facing `toward`. Its hips are a fifth of the
 * chest's height below the chest, its shoulders three tenths above, and it is a little under a fifth of that height
 * in radius: for the match's chest at 0.62 over the stone, hips at 0.5, shoulders at 0.81, a radius of 0.11.
 */
export function torsoFrame(stone: Point, toward: Point, chest: Point): TorsoFrame {
  const dx = toward.x - stone.x, dz = toward.z - stone.z, far = Math.hypot(dx, dz);
  const forward = far > 1e-5 ? { x: dx / far, z: dz / far } : { x: 0, z: 1 };
  const c = Math.max(0.3, chest.y - stone.y);
  return {
    chest: { x: stone.x, y: stone.y + c, z: stone.z }, floor: stone.y, forward, right: { x: -forward.z, z: forward.x },
    radius: 0.18 * c, low: stone.y + 0.8 * c, high: stone.y + 1.3 * c,
  };
}

/** A point of the torso's frame: `forward` toward the caster, `across` to the right, `up` above the chest. */
export function torsoPoint(frame: TorsoFrame, forward: number, across: number, up: number): Point {
  return {
    x: frame.chest.x + frame.forward.x * forward + frame.right.x * across, y: frame.chest.y + up,
    z: frame.chest.z + frame.forward.z * forward + frame.right.z * across,
  };
}

/** How far `point` is outside the torso's capsule (negative inside): an upright segment from hips to shoulders, `radius` round it. */
export function torsoDistance(frame: TorsoFrame, point: Point): number {
  const out = Math.hypot(point.x - frame.chest.x, point.z - frame.chest.z), y = Math.min(frame.high, Math.max(frame.low, point.y));
  return Math.hypot(out, point.y - y) - frame.radius;
}

/** Whether `point` lies within `slack` of the torso's capsule. */
export function insideTorso(frame: TorsoFrame, point: Point, slack = 0): boolean {
  return torsoDistance(frame, point) <= slack + 1e-9;
}

/** One blade that runs the torso through (or, at Minimal, rises beside it). */
export interface PierceLine {
  /** Where it stands in the stone, where it enters the torso and where it comes out, and its tip beyond. */
  root: Point;
  entry: Point;
  exit: Point;
  tip: Point;
  /** Unit vector from its root to its tip. */
  axis: Point;
  /** Its length, root to tip, and where along it (0..1) it enters and leaves the torso: 0 for both when it does not. */
  length: number;
  entryAt: number;
  exitAt: number;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const along = (p: Point, d: Point, t: number): Point => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });
const STEP = 0.005;

/** Where between `outside` and `inside` along the line the capsule's surface is: halving, twenty times. */
function surface(frame: TorsoFrame, root: Point, axis: Point, outside: number, inside: number): number {
  let out = outside, into = inside;
  for (let i = 0; i < 20; i += 1) { const mid = (out + into) / 2; if (insideTorso(frame, along(root, axis, mid))) into = mid; else out = mid; }
  return into;
}

/**
 * Where the line from `root` along `axis` meets the torso's capsule within `reach`, as distances along it: where it
 * goes in and where it comes out, or null if it misses. Found by marching and halving; the capsule is convex, so a
 * line goes in once and comes out once.
 */
export function torsoCrossing(frame: TorsoFrame, root: Point, axis: Point, reach: number): { enters: number; leaves: number } | null {
  let t = 0;
  while (t <= reach && !insideTorso(frame, along(root, axis, t))) t += STEP;
  if (t > reach) return null;
  const enters = t === 0 ? 0 : surface(frame, root, axis, t - STEP, t);
  while (t <= reach && insideTorso(frame, along(root, axis, t))) t += STEP;
  return { enters, leaves: surface(frame, root, axis, t, t - STEP) };
}

/**
 * A blade from `root` in the stone toward `aim`, its tip `beyond` past where it comes out of the torso; or, if it
 * misses the torso, `beyond` past the aim.
 */
export function pierceLine(frame: TorsoFrame, root: Point, aim: Point, beyond: number): PierceLine {
  const run = sub(aim, root), toAim = Math.hypot(run.x, run.y, run.z) || 1e-6, axis = { x: run.x / toAim, y: run.y / toAim, z: run.z / toAim };
  const crossing = torsoCrossing(frame, root, axis, toAim + 2 * frame.radius + (frame.high - frame.low));
  if (!crossing) {
    const length = toAim + beyond;
    return { root, entry: aim, exit: aim, tip: along(root, axis, length), axis, length, entryAt: 0, exitAt: 0 };
  }
  const length = crossing.leaves + beyond;
  return {
    root, entry: along(root, axis, crossing.enters), exit: along(root, axis, crossing.leaves), tip: along(root, axis, length), axis, length,
    entryAt: crossing.enters / length, exitAt: crossing.leaves / length,
  };
}

/** A blade's place on the stone and in the torso, as dice: its bearing round the victim, how far out it stands, where it aims. */
interface ThrustPlan {
  /** From the way the victim faces: 0 straight in front, π/2 its right. */
  bearing: number;
  /** How far out from the victim's feet, in torso radii. */
  out: number;
  /** Where inside the torso it aims: how far up from the chest toward the shoulders (0..1), and across (torso radii, to the right). */
  rise: number;
  across: number;
}

/**
 * A blade that rises beside the torso instead of through it, at `bearing`: from the stone a little way out, up past
 * the shoulder a hand's width off the body, and on `beyond` past that. It closes in on the body as it rises, so a few
 * of them hold it, but never touches it, nor the head above it.
 */
function besideLine(frame: TorsoFrame, bearing: number, blade: number, beyond: number): PierceLine {
  const way = { x: frame.forward.x * Math.cos(bearing) + frame.right.x * Math.sin(bearing), z: frame.forward.z * Math.cos(bearing) + frame.right.z * Math.sin(bearing) };
  const foot = frame.radius + 1.5 * blade + 0.07, top = frame.radius + 0.6 * blade + 0.05;
  const root = { x: frame.chest.x + way.x * foot, y: frame.floor, z: frame.chest.z + way.z * foot };
  const aim = { x: frame.chest.x + way.x * top, y: frame.high + 0.06, z: frame.chest.z + way.z * top };
  return pierceLine(frame, root, aim, beyond);
}

/**
 * The blades of a Glacial crown that run the torso through, `count` of them (at most four), standing on the stone
 * round the victim within `reach` of its feet. The first two come from in front of it, either side, in at the belly
 * and out of the upper back; a third from its right flank and out of its left shoulder blade; a fourth from behind
 * and out of the front of its chest. `blade` is a blade's radius at its foot. At Minimal each rises beside the body
 * instead.
 */
export function crownThrusts(frame: TorsoFrame, count: number, reach: number, seed: number, violence: Violence, blade: number): PierceLine[] {
  const dice = sequence(seed ^ 0x7e13), lines: PierceLine[] = [], r = frame.radius;
  const plans: ThrustPlan[] = [
    { bearing: -0.42, out: 3.4, rise: 0.44, across: -0.3 },
    { bearing: 0.45, out: 3.5, rise: 0.5, across: 0.35 },
    { bearing: Math.PI / 2 + 0.3, out: 3.5, rise: 0.5, across: -0.25 },
    { bearing: Math.PI - 0.5, out: 3.3, rise: 0.42, across: -0.3 },
  ];
  for (let i = 0; i < Math.min(count, plans.length); i += 1) {
    const plan = plans[i], bearing = plan.bearing + (dice() - 0.5) * 0.18, size = 0.94 + 0.12 * dice(), lift = 0.9 + 0.2 * dice(), beyond = 0.28 + 0.1 * dice();
    if (violence === "minimal") { lines.push(besideLine(frame, bearing, blade, beyond + 0.08)); continue; }
    const way = { x: frame.forward.x * Math.cos(bearing) + frame.right.x * Math.sin(bearing), z: frame.forward.z * Math.cos(bearing) + frame.right.z * Math.sin(bearing) };
    const out = Math.max(r + blade + 0.04, Math.min(reach, r * plan.out * size));
    const root = { x: frame.chest.x + way.x * out, y: frame.floor, z: frame.chest.z + way.z * out };
    // it aims inside the far side of the body, high, and comes out where that line leaves it
    const across = r * plan.across * Math.abs(Math.cos(bearing)), up = (frame.high - frame.chest.y) * plan.rise * lift;
    const aim = { x: frame.chest.x - way.x * r * 0.45 + frame.right.x * across, y: frame.chest.y + up, z: frame.chest.z - way.z * r * 0.45 + frame.right.z * across };
    lines.push(pierceLine(frame, root, aim, beyond));
  }
  return lines;
}

/**
 * The great spike of a frost line, `length` long: it comes up out of the stone a little in front of the victim, at
 * the end of the line the frost ran, and leans back through the torso, in at the belly and out of the back, standing
 * on past it, clear of the head. At Minimal it rises beside the body instead, in front of a shoulder.
 */
export function spikeThrust(frame: TorsoFrame, seed: number, violence: Violence, length: number, blade: number): PierceLine {
  const dice = sequence(seed ^ 0x2b5d), r = frame.radius;
  if (violence === "minimal") {
    const bearing = (dice() < 0.5 ? -1 : 1) * (0.6 + 0.2 * dice()), beside = besideLine(frame, bearing, blade, 0);
    return besideLine(frame, bearing, blade, Math.max(0.2, length - beside.length));
  }
  const out = r * (3.0 + 0.3 * dice()), across = r * (dice() - 0.5) * 0.4;
  const root = { x: frame.chest.x + frame.forward.x * out + frame.right.x * across, y: frame.floor, z: frame.chest.z + frame.forward.z * out + frame.right.z * across };
  const aim = torsoPoint(frame, -r * 0.4, r * (dice() - 0.5) * 0.5, (frame.high - frame.chest.y) * (0.22 + 0.16 * dice()));
  const through = pierceLine(frame, root, aim, 0);
  return pierceLine(frame, root, aim, Math.max(0.1, length - through.length));
}

/** How much blood the spell itself shows on its blades and its ice, by the Violence setting: none at Minimal. */
export function bloodOf(violence: Violence): number {
  return violence === "full" ? 1.6 : violence === "cinematic" ? 1 : 0;
}

/**
 * Seconds after a blade has gone through until the first of its blood has run down it to the stone: the fastest
 * rivulet of shared/blood.ts, from where it went in.
 */
export function bloodReachesStone(line: PierceLine, amount: number): number {
  return line.entryAt / (0.48 * (0.75 + 0.25 * amount));
}

/** What a wound is told to the match: where, which way its blood goes, how much. */
export interface PierceWound { at: Point; direction: Point; power: number }

/** How hard a wound bleeds at each setting: a deep thrust, more at Full. */
export const WOUND_POWER = { cinematic: 1.2, full: 1.6 } as const;

/**
 * The wounds a blade opens as it runs the torso through: where it went in (the blood comes back out along the blade)
 * and where it came out (the blood goes on with the tip). None at Minimal, and none for a blade that went beside it.
 */
export function pierceWounds(lines: readonly PierceLine[], violence: Violence): PierceWound[] {
  if (violence === "minimal") return [];
  const power = WOUND_POWER[violence], wounds: PierceWound[] = [];
  for (const line of lines) {
    if (line.exitAt <= 0) continue;
    wounds.push({ at: line.entry, direction: { x: -line.axis.x, y: -line.axis.y, z: -line.axis.z }, power });
    wounds.push({ at: line.exit, direction: { ...line.axis }, power });
  }
  return wounds;
}

/** The second burst, at Full only, as the blades twist or crack in the body: each exit bleeds again, a little less, and lower. */
export function twistWounds(lines: readonly PierceLine[], violence: Violence): PierceWound[] {
  if (violence !== "full") return [];
  return lines.filter((line) => line.exitAt > 0).map((line) => {
    const d = { x: line.axis.x * 0.8, y: line.axis.y * 0.8 - 0.6, z: line.axis.z * 0.8 }, l = Math.hypot(d.x, d.y, d.z) || 1;
    return { at: line.exit, direction: { x: d.x / l, y: d.y / l, z: d.z / l }, power: WOUND_POWER.cinematic };
  });
}

/** The tilt of a line's axis from upright, and the way it leans on the board, as a rooted solid's lean (radians toward +x and +z). */
export function leanOf(line: PierceLine): { x: number; z: number } {
  const tilt = Math.acos(Math.max(-1, Math.min(1, line.axis.y))), flat = Math.hypot(line.axis.x, line.axis.z);
  return flat < 1e-6 ? { x: 0, z: 0 } : { x: (line.axis.x / flat) * tilt, z: (line.axis.z / flat) * tilt };
}
