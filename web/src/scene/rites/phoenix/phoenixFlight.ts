/**
 * The flight of Solforiz's phoenix: when each beat of the rite falls, where the bird is, which way it faces, and
 * what the camera keeps in frame. Pure maths, no Three.js and no clock, so the node tests reach it
 * (shared/play/rite-phoenix.test.ts) and the match, the drawing and the sound all read the same numbers.
 *
 * The phoenix carries its prey, as Aethelgard's wyvern does (rites/wyvern-path.ts), and burns it in its grip:
 *
 *   gather   light gathers in the Queen's raised hand and a thread of fire climbs from it into the sky
 *   pen      two pens write a seal of fire high in the sky behind her, facing the board
 *   flare    the seal flares
 *   burst    the phoenix comes through it head first, a bird of fire eighteen units across the wings, cut by the
 *            seal's plane as it crosses
 *   open     its wings open; it cries
 *   approach it banks down out of the sky on slow, heavy beats toward the victim
 *   dive     it swoops, wings half folded, legs thrown forward and talons open
 *   strike   the talons close on the victim's chest (`strikeAt`): the match kills it there, and it hangs in the
 *            bird's grip, set alight (the rite's death is "held-burn")
 *   carry    heavy beats up, the body in its talons, to a hover just past the victim's square
 *   hover    it holds there, beating hard and blazing, while the body burns in its grip
 *   release  the talons open and the charred body falls back onto its own square
 *   leave    the bird climbs, rears upright and folds into its own light
 *   sunburst it is a small sun over the square, which shines and gutters out
 *
 * The path is a piecewise cubic Hermite through eight knots, so position and velocity are continuous everywhere.
 * The talons are exactly on the chest at the strike: phoenixForm.ts poses the bird there, measures where its
 * talons close, and moves the strike so they close on the chest (moveStrike). Which way the swoop runs is chosen
 * to cross the player's view where it can and to keep the swoop and the hover inside the hall.
 */
import type { Point } from "../../vfx/mystic/beamPlan";
import { sequence } from "../../vfx/spells/shared/particlePlan";

export interface PhoenixTimeline {
  /** Light gathers in the Queen's hand, and the thread climbs to where the seal will be. */
  gather: readonly [number, number];
  /** The two pens write the seal. */
  pen: readonly [number, number];
  /** The seal flares. */
  flare: number;
  /** The bird comes through the seal. */
  burst: readonly [number, number];
  /** Its wings open; the cry. */
  open: readonly [number, number];
  cry: number;
  /** It banks down out of the sky. */
  approach: readonly [number, number];
  /** The swoop, ending with the talons on the victim's chest. */
  dive: readonly [number, number];
  strikeAt: number;
  /** It carries the body up to its hover. */
  carry: readonly [number, number];
  /** It hovers while the body burns in its grip. */
  hover: readonly [number, number];
  /** The talons open. */
  release: number;
  /** It climbs to the sun's place. */
  leave: readonly [number, number];
  /** It is the sun from here. */
  sunburst: number;
  shine: readonly [number, number];
  gutter: readonly [number, number];
  duration: number;
  brief: boolean;
}

const FULL: PhoenixTimeline = {
  gather: [0, 0.38], pen: [0.12, 0.62], flare: 0.66, burst: [0.62, 1.05], open: [0.95, 1.4], cry: 1.15,
  approach: [1.05, 1.95], dive: [1.95, 2.55], strikeAt: 2.55, carry: [2.55, 3.35], hover: [3.35, 5.35], release: 5.35,
  leave: [5.35, 5.75], sunburst: 5.75, shine: [5.75, 6.0], gutter: [6.0, 6.4], duration: 7.2, brief: false,
};

/**
 * The brief form (reduced motion, fast play): nothing rushes and the body is not carried. The seal comes up whole,
 * the bird glides down and passes over the victim, which burns where it stands, and the sun is a soft light.
 */
const BRIEF: PhoenixTimeline = {
  gather: [0, 0.3], pen: [0, 0.6], flare: 0.65, burst: [0.62, 1.2], open: [1.0, 1.5], cry: 1.2,
  approach: [1.5, 2.1], dive: [2.1, 2.75], strikeAt: 2.75, carry: [2.75, 3.2], hover: [3.2, 3.6], release: 3.6,
  leave: [3.6, 4.0], sunburst: 4.0, shine: [4.0, 4.4], gutter: [4.4, 4.9], duration: 5.1, brief: true,
};

export function phoenixTimeline(brief: boolean): PhoenixTimeline {
  return brief ? BRIEF : FULL;
}

/**
 * The bird's measures and the rite's, for a board whose square is 1.02 across (everything scales with the tile).
 * The bird is designed at a wingspan of 7.8 (phoenixForm.ts) and drawn `scale` times that.
 */
export const PHOENIX_SIZE = {
  wingspan: 18,
  scale: 18 / 7.8,
  /**
   * The seal in the sky: how far beyond the Queen (away from the player, so it hangs in the sky over the board
   * from the player's seat) and how high its centre is, its radius, and how far it keeps from the hall's wall.
   */
  seal: { beyond: 3.6, up: 8.2, radius: 2.6, wall: 2.5 },
  /** How far behind the seal the bird's middle is as it starts through (its beak just behind the plane), and how far out in front of it it is when through. */
  hidden: 3.2,
  out: 3.0,
  /** The top of the swoop: how far back along the swoop and how high above the strike. */
  dive: { back: 6.5, up: 3.0 },
  /**
   * Where the body is, relative to the talons, as they close on the chest (legs thrown forward): above and behind.
   * Near what phoenixForm.ts's legs reach; lockTalons there moves the strike the rest of the way.
   */
  grip: { up: 1.6, back: 0.9 },
  /** How fast it passes over the victim as the talons close, and how fast it is already climbing, in units a second. */
  strikeSpeed: 7,
  lift: 2,
  /** The hover: how far past the victim along the swoop, and how high the hanging chest is. */
  hover: { on: 1.1, chest: 3.6 },
  /** The talons hang this far under the body in the hover (phoenixForm.ts's legs, hanging straight). */
  hang: 2.45,
  /** The sun: how far above where the bird lets go. */
  sunUp: 1.2,
  /** Nothing of it is planned nearer the hall's wall than this. */
  wall: 3,
} as const;

/** The board's measure: everything above is for a 1.02 square. */
const UNIT_TILE = 1.02;

/** How high a figure's head stands. */
export const HEAD_HEIGHT = 1.7;

export interface PhoenixPlanInput {
  /** The stone under the Queen, the victim's chest and the stone under it. */
  queen: Point;
  chest: Point;
  stone: Point;
  /** Every other figure on the board. */
  standing: readonly { x: number; z: number }[];
  /** Where the player watches from. */
  viewer: Point;
  boardTop: number;
  tile: number;
  hall: number;
  seed: number;
  brief: boolean;
}

interface Knot { t: number; p: [number, number, number]; v: [number, number, number] }

export interface PhoenixSeal {
  centre: Point;
  /** Out of its face, toward the board: the way the bird comes through it. */
  normal: Point;
  /** In its plane: from the centre toward its lowest point (where the pens start), and square to that. */
  down: Point;
  across: Point;
  radius: number;
}

export interface PhoenixPlan {
  timeline: PhoenixTimeline;
  seed: number;
  /** Scene units per unit of the board's design (a 1.02 square), and per unit of the bird's design. */
  unit: number;
  bird: number;
  boardTop: number;
  /** +1 or -1: which way the approach swings out. Chosen by the seed. */
  side: number;
  seal: PhoenixSeal;
  /** Unit, flat: from the Queen toward the player. */
  toViewer: Point;
  /** Unit, flat: the way the bird flies over the victim as it seizes it. */
  heading: Point;
  /** The victim's chest and stone; where the talons close (the chest); the bird's body there. */
  chest: Point;
  stone: Point;
  strike: Point;
  /** Out of the seal, the bend of the approach, the top of the swoop, the hover, where it lets go, and the sun. */
  out: Point;
  bend: Point;
  apex: Point;
  hover: Point;
  release: Point;
  sun: Point;
  /** Where the talons hold the body in the hover (over the victim's square). */
  hold: Point;
  /** When the body it lets go of comes down onto its stone (a free fall from the hold, as the match drops it). */
  landAt: number;
  knots: readonly Knot[];
  /** Arc length along the path, sampled from before the burst (the path runs on behind the seal) to the end. */
  arc: { start: number; step: number; lengths: Float64Array };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3, fallback: V3 = [0, 1, 0]): V3 => { const l = len(a); return l < 1e-9 ? fallback : [a[0] / l, a[1] / l, a[2] / l]; };
const v3 = (p: Point): V3 => [p.x, p.y, p.z];
const pt = (a: V3): Point => ({ x: a[0], y: a[1], z: a[2] });
const flat = (x: number, z: number, fx: number, fz: number): V3 => { const l = Math.hypot(x, z); return l < 1e-6 ? [fx, 0, fz] : [x / l, 0, z / l]; };
/** `p` brought inside a circle of radius `room` about the hall's centre, flat. */
const dotFlat = (a: V3, b: V3) => a[0] * b[0] + a[2] * b[2];
const inside = (p: V3, room: number): V3 => { const off = Math.hypot(p[0], p[2]); return off > room ? [p[0] * room / off, p[1], p[2] * room / off] : p; };

interface Base {
  input: PhoenixPlanInput;
  timeline: PhoenixTimeline;
  unit: number;
  bird: number;
  seal: PhoenixSeal;
  chest: V3;
  side: number;
}

/** Builds the knots for a swoop that runs along `heading`. */
function knotsFor(base: Base, heading: V3): { knots: Knot[]; out: V3; bend: V3; apex: V3; strike: V3; hover: V3; release: V3; sun: V3; hold: V3; approach: number } {
  const { input, timeline: T, unit, seal, chest, side } = base, S = PHOENIX_SIZE, top = input.boardTop, brief = T.brief;
  const room = Math.max(2, input.hall - S.wall * unit);
  const n = v3(seal.normal), g = v3(seal.centre), up: V3 = [0, 1, 0];
  // The body as the talons close: above and behind the chest.
  const gripUp = S.grip.up * unit, gripBack = S.grip.back * unit;
  const strike: V3 = brief ? [chest[0], Math.max(chest[1] + 1.2 * unit, top + 2.2 * unit), chest[2]] : [chest[0] - heading[0] * gripBack, chest[1] + gripUp, chest[2] - heading[2] * gripBack];
  const apex = inside(brief
    ? [strike[0] - heading[0] * 3 * unit, strike[1] + 1.6 * unit, strike[2] - heading[2] * 3 * unit]
    : [strike[0] - heading[0] * S.dive.back * unit, strike[1] + S.dive.up * unit, strike[2] - heading[2] * S.dive.back * unit], room);
  // The bend: back from the top of the swoop and out to one side, the side it comes from, so it banks round into
  // the swoop in one sweep instead of turning on the spot.
  const square: V3 = [-heading[2], 0, heading[0]], from = dotFlat(sub(g, apex), square);
  const turn = Math.abs(from) > 1.5 * unit ? Math.sign(from) : side;
  const bend = inside(add(apex, add(mul(heading, -2.2 * unit), mul(square, turn * (brief ? 1.2 : 3) * unit))), room);
  // Through the seal leaning toward the bend, and out level toward it.
  const toBend = flat(bend[0] - g[0], bend[2] - g[2], -n[0], -n[2]);
  // (no more than about 45 degrees off the seal's face, so it comes through the seal rather than along it)
  let exit = n;
  for (const lean of [0.9, 0.7, 0.5, 0.3]) { exit = norm(add(n, mul(toBend, lean))); if (exit[0] * n[0] + exit[1] * n[1] + exit[2] * n[2] >= 0.7) break; exit = n; }
  const start = add(g, mul(exit, -S.hidden * unit));
  const out = add(g, mul(exit, S.out * unit));
  bend[1] = Math.max(out[1], apex[1]) * 0.5 + Math.min(out[1], apex[1]) * 0.5;
  // The hover: just past the victim along the swoop, the hanging chest well up; where it lets go; the sun above.
  const hold = inside([input.stone.x + heading[0] * S.hover.on * unit, top + (brief ? 2.4 : S.hover.chest) * unit, input.stone.z + heading[2] * S.hover.on * unit], room);
  const hover: V3 = [hold[0], hold[1] + S.hang * unit, hold[2]];
  const release: V3 = [hover[0] + heading[0] * 0.25 * unit, hover[1] + 0.3 * unit, hover[2] + heading[2] * 0.25 * unit];
  const sun = inside([release[0], release[1] + S.sunUp * unit, release[2]], room);
  // the bend falls where it would at an even speed round the approach
  const legs = [len(sub(bend, out)), len(sub(apex, bend))];
  const tBend = T.burst[1] + (T.dive[0] - T.burst[1]) * clamp(legs[0] / Math.max(1e-6, legs[0] + legs[1]), 0.3, 0.75);
  const knots: Knot[] = [
    { t: T.burst[0], p: start, v: mul(exit, (brief ? 8 : 14) * unit) },
    // Out of the seal it levels off toward the bend, so it comes down out of the sky and never dips to climb back.
    { t: T.burst[1], p: out, v: add(mul(exit, (brief ? 3 : 6) * unit), mul(norm(sub(bend, out)), 2 * unit)) },
    { t: tBend, p: bend, v: mul(sub(apex, out), 1 / (T.dive[0] - T.burst[1])) },
    { t: T.dive[0], p: apex, v: mul(sub(strike, bend), 1 / (T.strikeAt - tBend)) },
    // Level at the bottom of the swoop and already climbing as the talons close, so what they take is lifted at once.
    { t: T.strikeAt, p: strike, v: add(mul(heading, (brief ? 3.2 : S.strikeSpeed) * unit), [0, (brief ? 0 : S.lift) * unit, 0]) },
    { t: T.carry[1], p: hover, v: add(mul(heading, 0.6 * unit), [0, 0.4 * unit, 0]) },
    { t: T.release, p: release, v: [0, 0.8 * unit, 0] },
    { t: T.sunburst, p: sun, v: mul(up, 0.3 * unit) },
  ];
  return { knots, out, bend, apex, strike, hover, release, sun, hold, approach: legs[0] + legs[1] };
}

function hermite(knots: readonly Knot[], t: number, order: 0 | 1, out: V3): V3 {
  const first = knots[0], last = knots[knots.length - 1];
  if (t <= first.t) {
    // Before the burst the bird waits behind the seal, coming on along the way it will come through.
    if (order === 1) { out[0] = first.v[0]; out[1] = first.v[1]; out[2] = first.v[2]; return out; }
    const d = t - first.t;
    out[0] = first.p[0] + first.v[0] * d; out[1] = first.p[1] + first.v[1] * d; out[2] = first.p[2] + first.v[2] * d;
    return out;
  }
  if (t >= last.t) {
    if (order === 1) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
    out[0] = last.p[0]; out[1] = last.p[1]; out[2] = last.p[2];
    return out;
  }
  let i = knots.length - 2;
  while (i > 0 && t < knots[i].t) i -= 1;
  const a = knots[i], b = knots[i + 1], h = b.t - a.t, u = (t - a.t) / h, u2 = u * u, u3 = u2 * u;
  let h00: number, h10: number, h01: number, h11: number, k: number;
  if (order === 0) { h00 = 2 * u3 - 3 * u2 + 1; h10 = u3 - 2 * u2 + u; h01 = -2 * u3 + 3 * u2; h11 = u3 - u2; k = 1; }
  else { h00 = 6 * u2 - 6 * u; h10 = 3 * u2 - 4 * u + 1; h01 = -6 * u2 + 6 * u; h11 = 3 * u2 - 2 * u; k = 1 / h; }
  for (let c = 0; c < 3; c += 1) out[c] = (h00 * a.p[c] + h10 * h * a.v[c] + h01 * b.p[c] + h11 * h * b.v[c]) * k;
  return out;
}

/** Candidate headings tried for the swoop. */
const HEADINGS = 32;

/** Plans one rite: the seal, the way the swoop runs, the hover, the sun, and the path through them. */
export function planPhoenix(input: PhoenixPlanInput): PhoenixPlan {
  const timeline = phoenixTimeline(input.brief), unit = input.tile / UNIT_TILE, S = PHOENIX_SIZE, bird = unit * S.scale;
  const dice = sequence((input.seed ^ 0x51f15e) >>> 0);
  const side = dice() < 0.5 ? -1 : 1;
  const queen = v3(input.queen), chest = v3(input.chest), top = input.boardTop;
  const toViewer = flat(input.viewer.x - queen[0], input.viewer.z - queen[2], 0, 1);
  // The seal: high in the sky over and beyond the Queen (from the player's seat it hangs over the board), facing
  // down at the board and leaning to the player, so its face is seen.
  const line = flat(input.stone.x - queen[0], input.stone.z - queen[2], -toViewer[0], -toViewer[2]);
  const centre = inside([queen[0] - toViewer[0] * S.seal.beyond * unit, top + S.seal.up * unit, queen[2] - toViewer[2] * S.seal.beyond * unit], Math.max(2, input.hall - S.seal.wall * unit));
  const aim: V3 = [(queen[0] + input.stone.x) / 2, top + 1.5 * unit, (queen[2] + input.stone.z) / 2];
  const normal = norm(add(norm(sub(aim, centre)), mul(toViewer, 1.2)));
  const down = norm(sub([0, -1, 0], mul(normal, -normal[1])), [line[0], 0, line[2]]);
  const across = norm([normal[1] * down[2] - normal[2] * down[1], normal[2] * down[0] - normal[0] * down[2], normal[0] * down[1] - normal[1] * down[0]]);
  const seal: PhoenixSeal = { centre: pt(centre), normal: pt(normal), down: pt(down), across: pt(across), radius: S.seal.radius * unit };
  const base: Base = { input, timeline, unit, bird, seal, chest, side };

  // Which way the swoop runs: across the player's view where it can, inside the hall, and not so far from where
  // the bird comes out of the seal that the approach has to hurry.
  const view = flat(input.stone.x - input.viewer.x, input.stone.z - input.viewer.z, 0, -1);
  const room = input.hall - 2 * unit;
  let best: { score: number; heading: V3 } | null = null;
  for (let i = 0; i < HEADINGS; i += 1) {
    const turn = (i / HEADINGS) * Math.PI * 2 + 0.07;
    const heading: V3 = [Math.cos(turn), 0, Math.sin(turn)];
    const built = knotsFor(base, heading);
    const fits = Math.hypot(built.apex[0], built.apex[2]) <= room && Math.hypot(built.hover[0], built.hover[2]) <= room;
    const crossing = Math.abs(heading[0] * view[2] - heading[2] * view[0]);
    const toward = -(heading[0] * view[0] + heading[2] * view[2]);
    // not so far round from where it comes out of the seal that it has to hurry
    const score = 1.2 * crossing + 0.25 * toward - 0.15 * Math.max(0, built.approach / unit - 10) - (fits ? 0 : 10) + 0.04 * dice();
    if (!best || score > best.score) best = { score, heading };
  }
  const heading = best!.heading;
  const built = knotsFor(base, heading);
  // The body it lets go of falls from the hold to its stone, as the match drops it (sceneEngine's dropBody).
  const drop = Math.max(0, built.hold[1] - (chest[1] - input.stone.y) - input.stone.y);
  const landAt = timeline.release + (timeline.brief ? 0 : Math.max(0.25, Math.sqrt((2 * drop) / 9.8)));
  return {
    timeline, seed: input.seed >>> 0, unit, bird, boardTop: top, side, seal, toViewer: pt(toViewer), heading: pt(heading),
    chest: pt(chest), stone: { ...input.stone }, strike: pt(built.strike),
    out: pt(built.out), bend: pt(built.bend), apex: pt(built.apex), hover: pt(built.hover), release: pt(built.release), sun: pt(built.sun), hold: pt(built.hold),
    landAt, knots: built.knots, arc: arcTable(built.knots, timeline),
  };
}

/** Arc length from well before the burst (the path runs on behind the seal) to the end: the tail streams along it. */
function arcTable(knots: readonly Knot[], timeline: PhoenixTimeline): PhoenixPlan["arc"] {
  const step = 1 / 240, start = timeline.burst[0] - 1.5, count = Math.ceil((timeline.duration - start) / step) + 1;
  const lengths = new Float64Array(count), at: V3 = [0, 0, 0], last: V3 = [0, 0, 0];
  hermite(knots, start, 0, last);
  for (let i = 1; i < count; i += 1) {
    hermite(knots, start + i * step, 0, at);
    lengths[i] = lengths[i - 1] + Math.hypot(at[0] - last[0], at[1] - last[1], at[2] - last[2]);
    last[0] = at[0]; last[1] = at[1]; last[2] = at[2];
  }
  return { start, step, lengths };
}

/**
 * Moves where the bird's body is as its talons close by `by`, and the path with it: phoenixForm.ts measures where
 * the talons of the posed bird fall at the strike and moves the body so they close exactly on the chest.
 */
export function moveStrike(plan: PhoenixPlan, by: Point): void {
  const knot = plan.knots.find((each) => each.t === plan.timeline.strikeAt);
  if (!knot) return;
  knot.p[0] += by.x; knot.p[1] += by.y; knot.p[2] += by.z;
  plan.strike.x = knot.p[0]; plan.strike.y = knot.p[1]; plan.strike.z = knot.p[2];
  plan.arc = arcTable(plan.knots, plan.timeline);
}

/** Scratch for the evaluators below: each copies out of it at once, so one is enough. */
const scratch: V3 = [0, 0, 0];

/** The bird's centre at `t` (the middle of its trunk). Writes into `out` when given. */
export function phoenixPosition<T extends Point>(plan: PhoenixPlan, t: number, out?: T): T {
  const at = hermite(plan.knots, t, 0, scratch), result = out ?? ({ x: 0, y: 0, z: 0 } as T);
  result.x = at[0]; result.y = at[1]; result.z = at[2];
  return result;
}

/** Its velocity at `t`, in units a second. */
export function phoenixVelocity<T extends Point>(plan: PhoenixPlan, t: number, out?: T): T {
  const at = hermite(plan.knots, t, 1, scratch), result = out ?? ({ x: 0, y: 0, z: 0 } as T);
  result.x = at[0]; result.y = at[1]; result.z = at[2];
  return result;
}

/** How far along its path the bird has flown at `t`, from before the burst. */
export function phoenixArc(plan: PhoenixPlan, t: number): number {
  const { start, step, lengths } = plan.arc;
  const f = clamp((t - start) / step, 0, lengths.length - 1), i = Math.min(lengths.length - 2, Math.floor(f));
  return lengths[i] + (lengths[i + 1] - lengths[i]) * (f - i);
}

/** The moment at which the bird had flown `arc` along its path: what a streamer of its tail lies along. */
export function phoenixTimeAtArc(plan: PhoenixPlan, arc: number): number {
  const { start, step, lengths } = plan.arc;
  if (arc <= 0) return start;
  if (arc >= lengths[lengths.length - 1]) return start + (lengths.length - 1) * step;
  let low = 0, high = lengths.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (lengths[mid] <= arc) low = mid; else high = mid; }
  const span = lengths[high] - lengths[low];
  return start + (low + (span > 1e-12 ? (arc - lengths[low]) / span : 0)) * step;
}

export interface PhoenixFrame {
  /** Unit vectors: where its beak points, where its back faces, and its left. */
  forward: Point;
  up: Point;
  left: Point;
  /** Its speed, in units a second. */
  speed: number;
}

/** How hard it is pulled down, in units a second squared, for the bank of its turns. */
const GRAVITY = 9.8;
const frameV: V3 = [0, 0, 0], frameBefore: V3 = [0, 0, 0], frameAfter: V3 = [0, 0, 0];

/**
 * How much the bird holds itself for the player rather than flies: reared in its hover (pitched up, facing the
 * player, the body hanging under it), and upright as it becomes the sun. 1 is held, 0 is flying.
 */
export function phoenixDisplay(plan: PhoenixPlan, t: number): number {
  const T = plan.timeline;
  const hover = smooth(T.carry[0] + 0.45, T.hover[0] + 0.1, t) * (1 - smooth(T.release + 0.05, T.release + 0.35, t));
  const sun = smooth(T.leave[1] - 0.35, T.leave[1] - 0.05, t);
  return clamp(Math.max(hover, sun), 0, 1);
}

/**
 * Which way the bird faces at `t`. In flight its beak is along its velocity and it banks into its turns as a
 * bird does. Coming through the seal it flies head first along the seal's normal. In its hover it rears, pitched
 * up and turned to the player, as a hovering hawk does; and it rears upright before it becomes the sun.
 */
export function phoenixFrame(plan: PhoenixPlan, t: number, out?: PhoenixFrame): PhoenixFrame {
  const result = out ?? { forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, left: { x: 1, y: 0, z: 0 }, speed: 0 };
  const T = plan.timeline, unit = plan.unit;
  const v = hermite(plan.knots, t, 1, frameV), speed = len(v);
  const before = hermite(plan.knots, t - 0.08, 1, frameBefore), after = hermite(plan.knots, t + 0.08, 1, frameAfter);
  const toward: V3 = [plan.toViewer.x, 0, plan.toViewer.z], away: V3 = [-plan.toViewer.x, 0, -plan.toViewer.z];
  // Held: reared in the hover (pitched well up, breast to the player); upright for the sun.
  const sunward = t > T.release + 0.2;
  const heldForward = sunward ? ([0, 1, 0] as V3) : norm(add([0, 0.85, 0], mul(toward, 0.55)));
  const heldUp = norm(sub(away, mul(heldForward, away[0] * heldForward[0] + away[2] * heldForward[2])), away);
  // Flying: along the velocity, banked against the pull of the turn and its own weight.
  const n = v3(plan.seal.normal);
  let forward: V3 = speed > 0.5 * unit ? mul(v, 1 / speed) : t < T.approach[0] ? n : heldForward;
  const lift: V3 = [(after[0] - before[0]) / 0.16, (after[1] - before[1]) / 0.16 + GRAVITY * unit, (after[2] - before[2]) / 0.16];
  const along = lift[0] * forward[0] + lift[1] * forward[1] + lift[2] * forward[2];
  let up = sub(lift, mul(forward, along));
  if (len(up) < 0.3 * unit) {
    const world: V3 = Math.abs(forward[1]) > 0.95 ? away : [0, 1, 0];
    up = sub(world, mul(forward, world[0] * forward[0] + world[1] * forward[1] + world[2] * forward[2]));
  }
  up = norm(up, heldUp);
  const w = phoenixDisplay(plan, t);
  forward = norm(add(mul(forward, 1 - w), mul(heldForward, w)), heldForward);
  up = add(mul(up, 1 - w), mul(heldUp, w));
  up = norm(sub(up, mul(forward, up[0] * forward[0] + up[1] * forward[1] + up[2] * forward[2])), heldUp);
  const left: V3 = [up[1] * forward[2] - up[2] * forward[1], up[2] * forward[0] - up[0] * forward[2], up[0] * forward[1] - up[1] * forward[0]];
  result.forward.x = forward[0]; result.forward.y = forward[1]; result.forward.z = forward[2];
  result.up.x = up[0]; result.up.y = up[1]; result.up.z = up[2];
  result.left.x = left[0]; result.left.y = left[1]; result.left.z = left[2];
  result.speed = speed;
  return result;
}

/** One downstroke of the wings: when it starts, how long the whole beat takes, and how hard it is. */
export interface PhoenixWingbeat { time: number; period: number; power: number }

/**
 * Every wingbeat of the rite: slow and heavy, as a great bird beats. A great beat as its wings open out of the
 * seal, and as many as fit down the approach; none in the swoop; and hard, heavy beats one after another from the
 * moment its talons close until it lets go, as it labours up with the body and holds itself over the square.
 */
export function phoenixWingbeats(timeline: PhoenixTimeline): PhoenixWingbeat[] {
  const T = timeline, beats: PhoenixWingbeat[] = [], slow = T.brief ? 1.2 : 1;
  let t = T.open[0] + 0.22;
  while (t + 0.62 * slow <= T.dive[0] + 0.02 && beats.length < 3) { beats.push({ time: round3(t), period: round3(0.62 * slow), power: beats.length === 0 ? 1.25 : 1.1 }); t += 0.62 * slow; }
  // Up out of the strike with the body, and holding the hover: beats that end as it lets go.
  const from = T.strikeAt + 0.1, span = T.release - from, count = Math.max(1, Math.round(span / (0.58 * slow))), period = span / count;
  for (let i = 0; i < count; i += 1) beats.push({ time: round3(from + i * period), period: round3(period) - 0.001, power: i === 0 ? 1.4 : 1.32 });
  return beats;
}

/** Fraction of a beat spent on the downstroke. */
export const PHOENIX_DOWNSTROKE = 0.45;

export interface PhoenixFlap {
  /** 0 gliding, 1 fully into the beat. */
  amount: number;
  /** 0..1 through the beat: 0 is the top of the stroke, the downstroke runs to PHOENIX_DOWNSTROKE. */
  phase: number;
  power: number;
  /** Which beat, -1 for none. */
  index: number;
}

/** Where the wings are in their beat at `t`. Between beats they ease to the glide and back to the top of a stroke. */
export function phoenixFlap(beats: readonly PhoenixWingbeat[], t: number, out: PhoenixFlap = { amount: 0, phase: 0, power: 1, index: -1 }): PhoenixFlap {
  out.amount = 0; out.phase = 0; out.power = 1; out.index = -1;
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    if (t >= beat.time && t < beat.time + beat.period) { out.amount = 1; out.phase = (t - beat.time) / beat.period; out.power = beat.power; out.index = i; return out; }
  }
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    const rise = smooth(beat.time - 0.24, beat.time, t), settle = 1 - smooth(beat.time + beat.period, beat.time + beat.period + 0.22, t);
    const amount = t < beat.time ? rise : settle;
    if (amount > out.amount) { out.amount = amount; out.power = beat.power; out.index = i; out.phase = 0; }
  }
  return out;
}

/** What the rite asks the match to sound and shake, and when. */
export interface PhoenixEvent {
  at: number;
  cue: "rite.phoenix.cry" | "rite.phoenix.wingbeat" | "rite.phoenix.dive" | "rite.phoenix.ignite" | "rite.phoenix.sunburst" | null;
  /** Where it is heard: at the seal, at the bird, at the victim, or at the sun. */
  where: "seal" | "bird" | "victim" | "sun";
  volume: number;
  /** Camera shake added on that frame; 0 in the brief form. */
  shake: number;
}

/** The rite's sounds and shakes, in order. */
export function phoenixEvents(plan: PhoenixPlan): PhoenixEvent[] {
  const T = plan.timeline, brief = T.brief, events: PhoenixEvent[] = [];
  events.push({ at: T.flare, cue: null, where: "seal", volume: 0, shake: brief ? 0 : 0.05 });
  events.push({ at: T.cry, cue: "rite.phoenix.cry", where: "bird", volume: 1, shake: 0 });
  for (const beat of phoenixWingbeats(T)) events.push({ at: beat.time, cue: "rite.phoenix.wingbeat", where: "bird", volume: 0.6 + 0.35 * (beat.power - 1), shake: 0 });
  events.push({ at: T.dive[0], cue: "rite.phoenix.dive", where: "bird", volume: brief ? 0.5 : 1, shake: 0 });
  events.push({ at: T.strikeAt, cue: "rite.phoenix.ignite", where: "victim", volume: brief ? 0.6 : 1, shake: brief ? 0 : 0.24 });
  events.push({ at: T.hover[0] + 0.35, cue: "rite.phoenix.cry", where: "bird", volume: 0.9, shake: 0 });
  events.push({ at: T.sunburst, cue: "rite.phoenix.sunburst", where: "sun", volume: brief ? 0.5 : 1, shake: brief ? 0 : 0.1 });
  return events.sort((a, b) => a.at - b.at);
}

export interface PhoenixShot {
  /** The moment the camera moves on to this beat. */
  from: number;
  /** What it keeps in frame through it: where things will be. */
  frame: readonly Point[];
  /** Degrees it looks down at that (up, if negative), where the beat names it (rites/rite.ts RiteState.look). */
  look?: number;
  /** Watched up close (rites/riteShot.ts `close`): the burning body in the talons. */
  close?: boolean;
  /** The side it is watched from (rites/riteShot.ts facing), in place of the player's: the close look's is behind the bird. */
  facing?: Point;
}

/**
 * The burning in the sky, as the camera frames it: how far to either side of the bird it keeps (in the bird's own
 * units), how far under the hanging body, and how steeply it looks up. In the first filming it kept 3.2 to either
 * side of a bird 18 across, from a little over the body: the wings ran off the frame and the burning body was lost
 * against the bird's breast. From under it, the body hangs against the sky.
 */
export const PHOENIX_HOVER_SHOT = { side: 6, under: 1.4, look: -12 } as const;

/**
 * The close look in the hover, once the whole bird has been seen to cry: the body burning in the talons, framed
 * from `low` to `high` over the grip and `ahead` of it along the heading (the bird's units: where the body hangs in
 * the hover, measured on the model), seen from behind the bird and under it (`look` degrees up), between its legs,
 * for the hover's last `seconds` before the fall, from no sooner than `after` seconds into the hover. The match cuts
 * straight to a close beat (sceneEngine.ts updateRite), so the body is held for all of it: a 0.9 second move used it
 * all up, and even a 0.6 second one passed through the bird's flames and feathers on its way in.
 *
 * Measured in stills from eight eyes round the hover: from in front the legs, thrown forward, hide the body; from
 * the player's side the wing and the streamers do; from behind and under, the charred body hangs clear in the talons
 * against the wing. The first filming framed round the grip itself, so the camera watched the air under the body.
 */
export const PHOENIX_CLOSE_SHOT = { ahead: 0.4, low: 0.15, high: 1.75, look: -20, seconds: 1.3, after: 0.3 } as const;

/**
 * The beats the camera watches, from the player's side: the call (the Queen, and the seal in the sky the bird
 * bursts from); the seizing (the swoop onto the victim); the burning in the sky (the bird in its hover with the
 * body in its talons, seen from under the body: {@link PHOENIX_HOVER_SHOT}); and the fall (the husk coming down onto
 * its square under the sun the bird becomes). The match frames a beat as a sphere in the narrower half of its lens,
 * so a beat names the bird's height and only part of its span: the wide frame has room for the rest of the wings.
 */
export function phoenixShots(plan: PhoenixPlan, queen: Point): PhoenixShot[] {
  const T = plan.timeline, unit = plan.unit;
  const { centre, down, across, radius } = plan.seal, c = v3(centre);
  const call: Point[] = [
    { x: queen.x, y: plan.boardTop + 0.3 * unit, z: queen.z }, { x: queen.x, y: plan.boardTop + 1.2 * unit, z: queen.z },
    centre, pt(add(c, mul(v3(down), radius))), pt(add(c, mul(v3(across), radius * 0.8))), pt(sub(c, mul(v3(across), radius * 0.8))),
  ];
  const strike = v3(plan.strike), h = v3(plan.heading);
  const seize: Point[] = [plan.apex, pt(add(strike, [0, 2.4 * unit, 0])), plan.stone, plan.chest, pt(add(strike, mul(h, 2 * unit)))];
  const hv = v3(plan.hover), side: V3 = [plan.toViewer.z, 0, -plan.toViewer.x], H = PHOENIX_HOVER_SHOT;
  const burning: Point[] = [
    pt(add(hv, [0, 2.6 * unit, 0])), pt(add(v3(plan.hold), [0, -H.under * unit, 0])),
    pt(add(hv, mul(side, H.side * unit))), pt(add(hv, mul(side, -H.side * unit))),
  ];
  const fall: Point[] = [plan.stone, { x: plan.stone.x, y: plan.boardTop + 1.4 * unit, z: plan.stone.z }, plan.hold, pt(add(v3(plan.sun), [0, 1.2 * unit, 0]))];
  const burnFrom = round3(T.strikeAt + (T.brief ? 0.2 : 0.35));
  const fallFrom = round3(Math.max(T.release - 0.3, burnFrom + 0.95));
  const shots: PhoenixShot[] = [
    { from: 0, frame: call },
    { from: round3(T.cry + 0.1), frame: seize },
    { from: burnFrom, frame: burning, ...(T.brief ? {} : { look: H.look }) },
  ];
  // The body burning in the talons, up close, once the whole bird has cried over it (not in the brief form).
  const C = PHOENIX_CLOSE_SHOT, closeFrom = round3(fallFrom - C.seconds);
  if (!T.brief && closeFrom >= T.hover[0] + C.after) {
    const body = add(v3(plan.hold), mul(h, C.ahead * unit));
    shots.push({
      from: closeFrom, frame: [pt(add(body, [0, C.high * unit, 0])), pt(add(body, [0, C.low * unit, 0]))], look: C.look, close: true,
      facing: { x: -plan.heading.x, y: 0, z: -plan.heading.z },
    });
  }
  shots.push({ from: fallFrom, frame: fall });
  return shots;
}

/** Which shot the camera is on at `t`. */
export function phoenixShotAt(shots: readonly PhoenixShot[], t: number): number {
  let index = 0;
  for (let i = 0; i < shots.length; i += 1) if (t >= shots[i].from) index = i;
  return index;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
