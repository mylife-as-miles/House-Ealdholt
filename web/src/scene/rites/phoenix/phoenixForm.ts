/**
 * The phoenix's form: a raptor of fire, eighteen units across the wings. A body of white-hot light; wings laid out
 * as a great eagle's are, every feather a long flame; a fanned tail with the phoenix's streamers trailing from it;
 * a hooked beak and fierce eyes; and legs that hang under it with four taloned toes on each foot, which close on
 * the victim and carry it. Pure maths, no Three.js, so the node tests reach it (shared/play/rite-phoenix-form.test.ts);
 * phoenix/plumes.ts and phoenix/body.ts draw it.
 *
 * There is no model. Each frame the skeleton is posed from the flight (phoenixFlight.ts) and the wingbeat, and
 * every flame of the bird is laid out as a ribbon: a centreline, a width and a temperature at each cut. The
 * drawing turns each ribbon to face the eye and burns it by its temperature (phoenix/fire.ts); nothing here knows
 * what colour anything is. The bird is designed at a wingspan of 7.8 (in units of a 1.02 square) and drawn at
 * PHOENIX_SIZE.scale times that: every measure below is the design's, multiplied by the plan's `bird`.
 *
 * The wing: three bones (upper arm, forearm, hand) from a shoulder on the trunk. Spread, they make the M of a
 * soaring bird; folded, they lie back along the body; half folded they sweep back for the swoop; flared, they are
 * thrown up and forward with the primaries fanned open; raised, they stand in a high V over its back as it seizes
 * its prey. The beat swings the arm about the body's long axis, the forearm and the hand a little behind it, so the
 * stroke runs out along the wing; on the upstroke the wing half folds, as a real wing does. The feathers are laid
 * as a raptor's: tertials on the upper arm and secondaries along the forearm, all pointing back, making the straight
 * trailing edge of the arm; primaries on the hand, longest a little in from the tip, fanning from pointing back to
 * pointing along it, the outer ones narrowed past their middles into the slotted fingers of an eagle's wingtip;
 * a row of greater coverts over their roots and a row of shorter, hotter lesser coverts over those.
 *
 * The legs: a feathered thigh from a hip under the trunk and a bare tarsus, solved as two bones whose heel bends
 * back. Tucked under the tail in flight; thrown forward and down with the toes spread as it swoops; hanging under
 * it with the toes closed while it carries. Each foot has three toes forward and one back, each ending in a hooked
 * talon. Where the closed toes of the two feet meet is the socket: what the rite holds the victim's chest at.
 */
import type { QualityPreset } from "../../quality";
import type { Point } from "../../vfx/mystic/beamPlan";
import { sequence } from "../../vfx/spells/shared/particlePlan";
import {
  PHOENIX_DOWNSTROKE, moveStrike, phoenixArc, phoenixFlap, phoenixFrame, phoenixPosition, phoenixTimeAtArc, phoenixWingbeats,
  type PhoenixFlap, type PhoenixFrame, type PhoenixPlan, type PhoenixWingbeat,
} from "./phoenixFlight";

export interface PhoenixBudget {
  /** Flight feathers per wing: on the hand, the forearm and the upper arm; greater coverts over them, and lesser coverts over those. */
  primaries: number;
  secondaries: number;
  tertials: number;
  coverts: number;
  lesser: number;
  /** Broad feathers in the tail's fan, and the phoenix's long streamers trailing from it. */
  rectrices: number;
  streamers: number;
  /** Cuts along a feather, and along a streamer. */
  segments: number;
  tailSegments: number;
  /** Embers shed from the wings and the tail through the flight. */
  embers: number;
  /** Sparks: thrown off the seal as it flares, and round the victim as the talons close. */
  sparks: number;
  /** Embers rained by the sun. */
  rain: number;
  /** Puffs of smoke off the burnt square. */
  smoke: number;
  /** Tongues of flame that stand up round the body as it comes down. */
  flames: number;
  /** Strength of the drawn glow under every flame: the lowest tier has no bloom and leans on it. */
  halo: number;
  /** Flames standing on the burning bird (the game's fire flipbook), fire shed along its flight that rolls into soot, and soot. */
  blaze: number;
  trail: number;
  soot: number;
}

/** What the phoenix is drawn with at each quality tier. The lowest keeps about a third of the flames. */
export const PHOENIX_BUDGET: Readonly<Record<QualityPreset, PhoenixBudget>> = {
  low: { primaries: 8, secondaries: 7, tertials: 3, coverts: 6, lesser: 0, rectrices: 6, streamers: 4, segments: 6, tailSegments: 12, embers: 140, sparks: 60, rain: 60, smoke: 8, flames: 12, halo: 1, blaze: 40, trail: 70, soot: 24 },
  medium: { primaries: 9, secondaries: 9, tertials: 4, coverts: 8, lesser: 6, rectrices: 8, streamers: 5, segments: 8, tailSegments: 16, embers: 260, sparks: 110, rain: 120, smoke: 14, flames: 20, halo: 0.7, blaze: 72, trail: 130, soot: 44 },
  high: { primaries: 10, secondaries: 11, tertials: 5, coverts: 10, lesser: 8, rectrices: 10, streamers: 6, segments: 10, tailSegments: 20, embers: 400, sparks: 170, rain: 180, smoke: 20, flames: 30, halo: 0.6, blaze: 104, trail: 200, soot: 64 },
  ultra: { primaries: 11, secondaries: 13, tertials: 6, coverts: 12, lesser: 10, rectrices: 12, streamers: 7, segments: 12, tailSegments: 24, embers: 560, sparks: 230, rain: 240, smoke: 26, flames: 40, halo: 0.55, blaze: 136, trail: 280, soot: 90 },
};

/** What a ribbon of the bird is, for the shader: each burns a little differently. */
export const PLUME_KIND = { feather: 0, covert: 1, streamer: 2, plume: 3, beak: 4, neck: 5, edge: 6, thread: 7, vane: 8, leg: 9, toe: 10, rectrix: 11, eye: 12 } as const;

export interface PlumeSpec {
  kind: number;
  segments: number;
  /** Wing feathers: +1 the left wing, -1 the right; which bone (0 upper arm, 1 forearm, 2 hand) and where on it (0..1). Legs and toes: which leg, and which toe (3 is the one behind). */
  wing: number;
  bone: number;
  u: number;
  /** Its length, its half-width where it is widest, and how hot its root burns (1 is white). */
  length: number;
  width: number;
  heat: number;
  /** Feathers: how far it turns from pointing back toward pointing out along its bone (0..1). */
  fan: number;
  /** Streamers, rectrices and plumes: where they spread to, across and up (-1..1). Coverts: 1 for a lesser covert. */
  spread: number;
  lift: number;
  /** Its own dice, 0..1. */
  seed: number;
}

export interface PlumeLayout {
  specs: PlumeSpec[];
  /** Two vertices at every cut of every ribbon, and the triangles between. */
  vertices: number;
  index: Uint32Array;
  /** Where each ribbon's first vertex is. */
  first: Int32Array;
}

/**
 * The bones of a wing in the bird's design (upper arm, forearm, hand), the shoulder on the trunk, and the lengths
 * of its feathers. With the wing spread these give a wingspan of 7.8 from tip to tip.
 */
export const WING = { bones: [0.75, 0.9, 0.95], shoulder: [0.17, 0.1, 0.22], primary: 1.3, secondary: 1.0, tertial: 0.8, covert: 0.5 } as const;
/** The trunk: from the root of the tail to the front of the chest, and its girth. */
export const TRUNK = { tail: 0.55, chest: 0.6, radius: 0.25 } as const;
/**
 * The legs: the hip (out to the side, up, forward from the trunk's middle), the feathered thigh, the bare tarsus,
 * a front toe and the one behind, and the talon at the end of each (part of its length); the thigh's half-width.
 */
export const LEG = { hip: [0.1, -0.17, -0.04], thigh: 0.36, tarsus: 0.4, toe: 0.2, hallux: 0.15, talon: 0.11, width: 0.085 } as const;

/** Lays out every ribbon of the bird once: which feathers it has, how long and how hot. `bird` scales the bird, `unit` the board. */
export function plumeLayout(budget: PhoenixBudget, seed: number, bird: number, unit: number): PlumeLayout {
  const dice = sequence((seed ^ 0x7e57) >>> 0), specs: PlumeSpec[] = [], seg = budget.segments;
  const feather = (kind: number, wing: number, bone: number, u: number, length: number, width: number, heat: number, fan: number, lift = 0) =>
    specs.push({ kind, segments: seg, wing, bone, u, length: length * (0.92 + 0.16 * dice()) * bird, width: width * (0.92 + 0.16 * dice()) * bird, heat, fan: fan + (dice() - 0.5) * 0.05, spread: lift, lift, seed: dice() });
  // The legs first, under everything: each a thigh and a tarsus, and four toes ending in talons.
  for (const leg of [1, -1]) {
    specs.push({ kind: PLUME_KIND.leg, segments: 8, wing: leg, bone: 0, u: 0, length: 0, width: LEG.width * bird, heat: 0.74, fan: 0, spread: 0, lift: 0, seed: dice() });
    for (let toe = 0; toe < 4; toe += 1) specs.push({ kind: PLUME_KIND.toe, segments: 6, wing: leg, bone: toe, u: 0, length: ((toe === 3 ? LEG.hallux : LEG.toe) + LEG.talon) * bird, width: 0.028 * bird, heat: 0.62, fan: 0, spread: 0, lift: 0, seed: dice() });
  }
  // The tail: the phoenix's long streamers, the middle ones longest, and the raptor's fan of broad feathers over their roots.
  for (let i = 0; i < budget.streamers; i += 1) {
    const spread = budget.streamers > 1 ? (i / (budget.streamers - 1)) * 2 - 1 : 0;
    specs.push({ kind: PLUME_KIND.streamer, segments: budget.tailSegments, wing: 0, bone: 0, u: 0, length: (3.0 - 0.8 * spread * spread) * (0.94 + 0.12 * dice()) * bird, width: 0.1 * bird, heat: 0.95, fan: 0, spread, lift: (dice() - 0.5) * 0.6, seed: dice() });
  }
  for (let i = 0; i < budget.rectrices; i += 1) {
    const spread = budget.rectrices > 1 ? (i / (budget.rectrices - 1)) * 2 - 1 : 0;
    specs.push({ kind: PLUME_KIND.rectrix, segments: seg, wing: 0, bone: 0, u: 0, length: 1.05 * (1 - 0.1 * spread * spread) * (0.95 + 0.1 * dice()) * bird, width: 0.12 * bird, heat: 0.86, fan: 0, spread, lift: 0, seed: dice() });
  }
  for (const wing of [1, -1]) {
    // A soft band of light along the bones first, under the feathers: the wing's own surface, so no dark shows between the roots.
    specs.push({ kind: PLUME_KIND.vane, segments: 12, wing, bone: 0, u: 0, length: 0.22 * bird, width: 0.22 * bird, heat: 0.8, fan: 0, spread: 0, lift: 0, seed: dice() });
    // The flight feathers. The arm's (tertials, secondaries) point back and make a straight trailing edge; the
    // hand's primaries are longest a little in from the tip and fan out to it, the outer ones slotted.
    for (let i = 0; i < budget.tertials; i += 1) { const u = (i + 0.5) / budget.tertials; feather(PLUME_KIND.feather, wing, 0, u, WING.tertial * (0.8 + 0.2 * u), 0.13, 0.84, -0.1 + 0.06 * u); }
    for (let i = 0; i < budget.secondaries; i += 1) { const u = (i + 0.5) / budget.secondaries; feather(PLUME_KIND.feather, wing, 1, u, WING.secondary * (1 - 0.05 * u), 0.135, 0.86, 0.0 + 0.08 * u); }
    for (let i = 0; i < budget.primaries; i += 1) {
      const u = (i + 0.5) / budget.primaries, longest = Math.sin(Math.min(1, u / 0.75) * Math.PI * 0.5) - 0.14 * smooth(0.8, 1, u);
      feather(PLUME_KIND.feather, wing, 2, u, WING.primary * (0.74 + 0.28 * longest), 0.125 - 0.02 * u, 0.9, 0.12 + 0.82 * Math.pow(u, 1.1));
    }
    // The greater coverts over the roots of the secondaries and the primaries, and the lesser coverts over theirs.
    for (let i = 0; i < budget.coverts; i += 1) {
      const along = (i + 0.5) / budget.coverts, bone = along < 0.5 ? 1 : 2, u = bone === 1 ? along / 0.5 : (along - 0.5) / 0.5;
      feather(PLUME_KIND.covert, wing, bone, u, WING.covert * (0.85 + 0.3 * along), 0.14, 0.92, bone === 2 ? 0.1 + 0.42 * u : 0.05);
    }
    for (let i = 0; i < budget.lesser; i += 1) {
      const along = (i + 0.5) / budget.lesser, bone = along < 0.3 ? 0 : along < 0.75 ? 1 : 2, from = bone === 0 ? 0 : bone === 1 ? 0.3 : 0.75, to = bone === 0 ? 0.3 : bone === 1 ? 0.75 : 1;
      feather(PLUME_KIND.covert, wing, bone, (along - from) / (to - from), WING.covert * 0.55, 0.12, 0.96, bone === 2 ? 0.1 + 0.3 * along : 0.03, 1);
    }
  }
  // The hot leading edge of each wing.
  for (const wing of [1, -1]) specs.push({ kind: PLUME_KIND.edge, segments: 12, wing, bone: 0, u: 0, length: 0, width: 0.05 * bird, heat: 1.05, fan: 0, spread: 0, lift: 0, seed: dice() });
  // The neck; the crown: three plumes standing up off the head, and two long crests trailing back from it.
  specs.push({ kind: PLUME_KIND.neck, segments: 6, wing: 0, bone: 0, u: 0, length: 0, width: 0.15 * bird, heat: 0.9, fan: 0, spread: 0, lift: 0, seed: dice() });
  for (const spread of [-1, 0, 1]) specs.push({ kind: PLUME_KIND.plume, segments: 6, wing: 0, bone: 0, u: 0, length: (spread === 0 ? 0.5 : 0.4) * bird, width: 0.05 * bird, heat: 1.0, fan: 0, spread, lift: 1, seed: dice() });
  for (const spread of [-1, 1]) specs.push({ kind: PLUME_KIND.plume, segments: 8, wing: 0, bone: 0, u: 0, length: 0.8 * bird, width: 0.045 * bird, heat: 0.92, fan: 0, spread, lift: 0, seed: dice() });
  // The beak: a long upper half ending in a hook, and a shorter lower half. Then the eyes, white-hot.
  for (const lift of [1, -1]) specs.push({ kind: PLUME_KIND.beak, segments: 6, wing: 0, bone: 0, u: 0, length: (lift > 0 ? 0.36 : 0.24) * bird, width: (lift > 0 ? 0.07 : 0.05) * bird, heat: 1.0, fan: 0, spread: 0, lift, seed: dice() });
  for (const side of [1, -1]) specs.push({ kind: PLUME_KIND.eye, segments: 1, wing: 0, bone: 0, u: 0, length: 0.035 * bird, width: 0.03 * bird, heat: 1.25, fan: 0, spread: side, lift: 0, seed: dice() });
  // The thread of fire from the Queen's hand to where the pens start.
  specs.push({ kind: PLUME_KIND.thread, segments: 16, wing: 0, bone: 0, u: 0, length: 0, width: 0.03 * unit, heat: 1.0, fan: 0, spread: 0, lift: 0, seed: dice() });

  const first = new Int32Array(specs.length);
  let vertices = 0, indices = 0;
  specs.forEach((spec, i) => { first[i] = vertices; vertices += (spec.segments + 1) * 2; indices += spec.segments * 6; });
  const index = new Uint32Array(indices);
  let k = 0;
  specs.forEach((spec, i) => {
    for (let s = 0; s < spec.segments; s += 1) { const a = first[i] + s * 2; index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k); k += 6; }
  });
  return { specs, vertices, index, first };
}

type V3 = [number, number, number];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/**
 * The stone as a soft floor: a height above `base + margin` is kept, and one below is pressed smoothly toward
 * `base`, so a flame that reaches the board spreads along it instead of passing into it.
 */
export function softFloor(y: number, base: number, margin: number): number {
  return y >= base + margin ? y : base + margin * Math.exp((y - base - margin) / margin);
}
function smooth(from: number, to: number, value: number): number { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); }

/** The wing's three bones, in the body's own frame (x out along the left wing, y up its back, z along its beak), for each pose. */
const SPREAD: readonly V3[] = [[1, 0.12, -0.18], [1, 0.02, 0.18], [1, -0.04, -0.32]];
const FOLDED: readonly V3[] = [[0.5, 0.15, -0.85], [0.18, 0.06, -1], [0.06, 0.04, -1]];
const FLARED: readonly V3[] = [[0.75, 0.62, 0.25], [0.9, 0.38, 0.22], [0.88, 0.2, -0.1]];
/** Thrown up over its back as it seizes the victim, as a raptor's are: a high V, clear of the figures round about. */
const RAISED: readonly V3[] = [[0.55, 0.8, -0.15], [0.45, 0.85, -0.05], [0.3, 0.9, -0.3]];
/** The stroke at a power of 1, in radians about the body's long axis: up at the top, down at the bottom; and the glide. */
const STROKE = { up: 0.95, down: -0.7, glide: 0.1 };
/** How far behind the upper arm the forearm and the hand follow the stroke, as shares of a beat. */
const LAG = [0, 0.05, 0.1];

export interface PhoenixPose {
  /** How much of the bird is there: 0 before it comes through the seal and once it is the sun. */
  shown: number;
  /** The trunk's middle, and its frame (unit vectors). */
  centre: V3;
  forward: V3;
  up: V3;
  left: V3;
  speed: number;
  /** Per wing (0 left, 1 right): shoulder, elbow, wrist, tip; and the wing's surface normal along each bone. */
  joints: V3[][];
  normals: V3[][];
  /** How far the wings are folded back (0..1), how far flared (0..1), and how wide the primaries are fanned (about 1). */
  fold: number;
  flare: number;
  fan: number;
  /** How wide the tail is fanned (0 closed, 1 wide). */
  tailFan: number;
  /** Per leg (0 left, 1 right): hip, heel, ankle; and the foot's frame: down through the sole, where the front toes point, and across. */
  legs: V3[][];
  feet: { down: V3; forward: V3; across: V3 }[];
  /** How far the toes are closed (0 spread open, 1 closed), and the socket: where the closed toes of both feet meet. */
  clutch: number;
  socket: V3;
  /** The base of the neck, the head, which way the beak points, and the head's own up. */
  neck: V3;
  head: V3;
  beak: V3;
  crown: V3;
  /** Where the tail leaves the trunk, and how far the bird has flown (for the tail). */
  tail: V3;
  arc: number;
  /** The cry: head thrown back and beak open (0..1). How hot the bird burns (1 at rest, more in the swoop and the hover). */
  cry: number;
  heat: number;
  /** 0..1: how far the bird has gone into its own light; the whole form is drawn in toward the sun. */
  collapse: number;
  time: number;
}

const v = (): V3 => [0, 0, 0];

export function emptyPose(): PhoenixPose {
  return {
    shown: 0, centre: v(), forward: [0, 0, 1], up: [0, 1, 0], left: [1, 0, 0], speed: 0,
    joints: [[v(), v(), v(), v()], [v(), v(), v(), v()]], normals: [[v(), v(), v()], [v(), v(), v()]],
    fold: 1, flare: 0, fan: 1, tailFan: 0,
    legs: [[v(), v(), v()], [v(), v(), v()]], feet: [{ down: [0, -1, 0], forward: [0, 0, 1], across: [1, 0, 0] }, { down: [0, -1, 0], forward: [0, 0, 1], across: [1, 0, 0] }],
    clutch: 1, socket: v(),
    neck: v(), head: v(), beak: [0, 0, 1], crown: [0, 1, 0], tail: v(), arc: 0, cry: 0, heat: 1, collapse: 0, time: 0,
  };
}

/** Where a beat's stroke is at `phase` (0..1), at power 1. */
function stroke(phase: number, power: number): number {
  const down = STROKE.down * (0.8 + 0.2 * power);
  if (phase <= 0) return STROKE.up;
  if (phase < PHOENIX_DOWNSTROKE) { const k = 0.5 - 0.5 * Math.cos(Math.PI * phase / PHOENIX_DOWNSTROKE); return STROKE.up + (down - STROKE.up) * k; }
  const k = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (phase - PHOENIX_DOWNSTROKE) / (1 - PHOENIX_DOWNSTROKE)));
  return down + (STROKE.up - down) * k;
}

/** How much the bird is hovering with its prey (0..1): reared, beating hard, the body hanging under it. */
export function hovering(plan: PhoenixPlan, t: number): number {
  const T = plan.timeline;
  return smooth(T.carry[0] + 0.4, T.hover[0] + 0.1, t) * (1 - smooth(T.release + 0.05, T.release + 0.35, t));
}

/** How far the wings are folded back, flared, raised and fanned at `t`, and the tail fanned, before the beat's own half fold on the upstroke. */
export function wingShape(plan: PhoenixPlan, t: number): { fold: number; flare: number; raise: number; fan: number; tail: number } {
  const T = plan.timeline;
  // Folded as it comes through the seal; opened out of it; half folded for the swoop; thrown up as the talons close.
  let fold = 1 - smooth(T.open[0], T.open[0] + 0.3, t);
  fold = Math.max(fold, 0.55 * smooth(T.dive[0] - 0.1, T.dive[0] + 0.15, t) * (1 - smooth(T.strikeAt - 0.32, T.strikeAt - 0.14, t)));
  const raise = smooth(T.strikeAt - 0.3, T.strikeAt - 0.08, t) * (1 - smooth(T.strikeAt + 0.04, T.strikeAt + 0.24, t));
  // Flared as they open out of the seal, braking as the talons close, and wide as it rears for the sun.
  const opening = smooth(T.open[0] + 0.04, T.open[0] + 0.26, t) * (1 - smooth(T.open[1] - 0.1, T.open[1] + 0.15, t));
  const braking = smooth(T.strikeAt - 0.02, T.strikeAt + 0.1, t) * (1 - smooth(T.strikeAt + 0.2, T.strikeAt + 0.45, t));
  const rearing = smooth(T.leave[1] - 0.4, T.leave[1] - 0.15, t);
  const flare = Math.max(opening, braking, rearing);
  const hover = hovering(plan, t);
  const fan = 1 + 0.25 * flare + 0.15 * hover - 0.6 * fold - 0.3 * raise;
  const tail = clamp(0.25 + 0.75 * Math.max(braking, hover, opening, rearing, raise) - 0.25 * fold, 0, 1);
  return { fold, flare, raise, fan, tail };
}

/**
 * The legs at `t`: how far thrown forward for the seizing, how far hanging under it with the body, and how far the
 * toes are closed. Tucked under the tail otherwise. The brief form carries nothing: the legs only reach as it passes.
 */
export function legShape(plan: PhoenixPlan, t: number): { reach: number; hang: number; clutch: number } {
  const T = plan.timeline;
  const reach = smooth(T.strikeAt - 0.5, T.strikeAt - 0.18, t) * (1 - smooth(T.strikeAt + 0.05, T.strikeAt + 0.5, t));
  if (T.brief) return { reach: 0.6 * reach, hang: 0, clutch: 1 - 0.8 * reach };
  const hang = smooth(T.strikeAt + 0.05, T.strikeAt + 0.5, t) * (1 - smooth(T.release + 0.15, T.release + 0.5, t));
  const open = smooth(T.strikeAt - 0.45, T.strikeAt - 0.25, t) * (1 - smooth(T.strikeAt - 0.03, T.strikeAt + 0.03, t))
    + smooth(T.release - 0.03, T.release + 0.03, t) * (1 - smooth(T.release + 0.3, T.release + 0.55, t));
  return { reach, hang, clutch: clamp(1 - open, 0, 1) };
}

const flapScratch: PhoenixFlap = { amount: 0, phase: 0, power: 1, index: -1 };
const frameScratch: PhoenixFrame = { forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, left: { x: 1, y: 0, z: 0 }, speed: 0 };
const pointScratch: Point = { x: 0, y: 0, z: 0 };
const footScratch: V3 = [0, 0, 0], toward: V3 = [0, 0, 0];

/** Poses the whole bird at `t`. `beats` is phoenixWingbeats(plan.timeline), made once. */
export function phoenixPose(plan: PhoenixPlan, beats: readonly PhoenixWingbeat[], t: number, out: PhoenixPose = emptyPose()): PhoenixPose {
  const T = plan.timeline, unit = plan.bird, board = plan.unit;
  out.time = t;
  out.shown = smooth(T.burst[0], T.burst[0] + 0.05, t) * (1 - smooth(T.sunburst - 0.02, T.sunburst + 0.12, t));
  out.collapse = smooth(T.sunburst - 0.32, T.sunburst + 0.06, t);
  const hover = hovering(plan, t);
  // The cry out of the seal, a scream as it swoops, and the cry over its prey.
  out.cry = Math.exp(-(((t - T.cry - 0.12) / 0.22) ** 2)) + 0.5 * Math.exp(-(((t - T.dive[0] + 0.1) / 0.16) ** 2)) + Math.exp(-(((t - T.hover[0] - 0.47) / 0.22) ** 2));
  out.heat = 1 + 0.2 * smooth(T.dive[0], T.strikeAt, t) * (1 - smooth(T.strikeAt, T.strikeAt + 0.5, t)) + 0.18 * hover + 0.5 * out.collapse;
  const frame = phoenixFrame(plan, t, frameScratch), at = phoenixPosition(plan, t, pointScratch);
  // Each heavy downstroke lifts it and it sinks a little on the upstroke: it is carrying.
  const flap = phoenixFlap(beats, t, flapScratch);
  const heave = flap.amount * (flap.phase < PHOENIX_DOWNSTROKE ? Math.sin(Math.PI * flap.phase / PHOENIX_DOWNSTROKE) : -0.6 * Math.sin(Math.PI * (flap.phase - PHOENIX_DOWNSTROKE) / (1 - PHOENIX_DOWNSTROKE)));
  out.centre[0] = at.x; out.centre[1] = at.y + 0.16 * board * hover * heave; out.centre[2] = at.z;
  const F = out.forward, U = out.up, L = out.left;
  F[0] = frame.forward.x; F[1] = frame.forward.y; F[2] = frame.forward.z;
  U[0] = frame.up.x; U[1] = frame.up.y; U[2] = frame.up.z;
  L[0] = frame.left.x; L[1] = frame.left.y; L[2] = frame.left.z;
  out.speed = frame.speed;
  out.arc = phoenixArc(plan, t);

  // The wings.
  const shape = wingShape(plan, t);
  const upstroke = flap.amount * (flap.phase > PHOENIX_DOWNSTROKE ? Math.sin(Math.PI * (flap.phase - PHOENIX_DOWNSTROKE) / (1 - PHOENIX_DOWNSTROKE)) : 0);
  const fold = clamp(shape.fold + 0.32 * upstroke * (1 - shape.fold), 0, 1);
  out.fold = fold; out.flare = shape.flare; out.fan = shape.fan; out.tailFan = shape.tail;
  const swing = (1 - fold) * (1 - 0.75 * shape.flare) * (1 - shape.raise);
  for (let w = 0; w < 2; w += 1) {
    const sign = w === 0 ? 1 : -1, joints = out.joints[w], normals = out.normals[w];
    const sh = WING.shoulder;
    for (let c = 0; c < 3; c += 1) joints[0][c] = out.centre[c] + (L[c] * sh[0] * sign + U[c] * sh[1] + F[c] * sh[2]) * unit;
    for (let b = 0; b < 3; b += 1) {
      // the bone's direction in the body's frame: the poses blended, then swung by the stroke
      let x = SPREAD[b][0] + (FLARED[b][0] - SPREAD[b][0]) * shape.flare, y = SPREAD[b][1] + (FLARED[b][1] - SPREAD[b][1]) * shape.flare, z = SPREAD[b][2] + (FLARED[b][2] - SPREAD[b][2]) * shape.flare;
      x += (RAISED[b][0] - x) * shape.raise; y += (RAISED[b][1] - y) * shape.raise; z += (RAISED[b][2] - z) * shape.raise;
      x += (FOLDED[b][0] - x) * fold; y += (FOLDED[b][1] - y) * fold; z += (FOLDED[b][2] - z) * fold;
      const angle = (flap.amount * stroke(flap.phase - LAG[b], flap.power) + (1 - flap.amount) * STROKE.glide) * swing;
      const c0 = Math.cos(angle), s0 = Math.sin(angle), rx = x * c0 - y * s0, ry = x * s0 + y * c0;
      const l = Math.hypot(rx, ry, z) || 1, length = WING.bones[b] * unit;
      for (let c = 0; c < 3; c += 1) joints[b + 1][c] = joints[b][c] + (L[c] * (rx / l) * sign + U[c] * (ry / l) + F[c] * (z / l)) * length;
      // its surface normal: square to the bone and to the way the air comes, turned to the back
      const bx = joints[b + 1][0] - joints[b][0], by = joints[b + 1][1] - joints[b][1], bz = joints[b + 1][2] - joints[b][2];
      let nx = (by * -F[2] - bz * -F[1]) * sign, ny = (bz * -F[0] - bx * -F[2]) * sign, nz = (bx * -F[1] - by * -F[0]) * sign;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 0.15 * length) { nx = U[0]; ny = U[1]; nz = U[2]; } else { nx /= nl; ny /= nl; nz /= nl; }
      normals[b][0] = nx; normals[b][1] = ny; normals[b][2] = nz;
    }
  }

  // The legs: tucked under the tail, thrown forward and down for the seizing, hanging straight under it with the body.
  const legs = legShape(plan, t);
  out.clutch = legs.clutch;
  out.socket[0] = 0; out.socket[1] = 0; out.socket[2] = 0;
  for (let w = 0; w < 2; w += 1) {
    const sign = w === 0 ? 1 : -1, [hip, heel, ankle] = out.legs[w], foot = out.feet[w];
    for (let c = 0; c < 3; c += 1) {
      hip[c] = out.centre[c] + (L[c] * LEG.hip[0] * sign + U[c] * LEG.hip[1] + F[c] * LEG.hip[2]) * unit;
      const tuck = out.centre[c] + (L[c] * 0.07 * sign - U[c] * 0.22 - F[c] * 0.74) * unit;
      const reach = out.centre[c] + (L[c] * 0.12 * sign - U[c] * 0.74 + F[c] * 0.3) * unit;
      const hang = out.centre[c] + (L[c] * 0.06 * sign) * unit + (c === 1 ? -0.92 * unit : 0) + U[c] * 0.04 * unit;
      footScratch[c] = tuck + (reach - tuck) * legs.reach;
      footScratch[c] += (hang - footScratch[c]) * legs.hang;
    }
    // two bones from the hip to the foot, the heel bending back
    solveLeg(hip, footScratch, LEG.thigh * unit, LEG.tarsus * unit, [-F[0] - U[0] * 0.3, -F[1] - U[1] * 0.3, -F[2] - U[2] * 0.3], heel, ankle);
    // the foot: its sole down along the tarsus as it reaches, straight down as it hangs, back along the belly tucked
    const tx = ankle[0] - heel[0], ty = ankle[1] - heel[1], tz = ankle[2] - heel[2], tl = Math.hypot(tx, ty, tz) || 1;
    for (let c = 0; c < 3; c += 1) {
      const tucked = -F[c] * 0.9 - U[c] * 0.4, along = [tx, ty, tz][c] / tl, hanging = c === 1 ? -1 : 0;
      toward[c] = tucked + (along - tucked) * legs.reach;
      toward[c] += (hanging - toward[c]) * legs.hang;
    }
    unitInto(toward, foot.down);
    // the front toes point the bird's way, square to the sole
    const d = foot.down, dot = F[0] * d[0] + F[1] * d[1] + F[2] * d[2];
    const fx = F[0] - d[0] * dot, fy = F[1] - d[1] * dot, fz = F[2] - d[2] * dot;
    if (Math.hypot(fx, fy, fz) > 1e-4) unitInto([fx, fy, fz], foot.forward); else unitInto([-U[0], -U[1], -U[2]], foot.forward);
    const f = foot.forward;
    foot.across[0] = d[1] * f[2] - d[2] * f[1]; foot.across[1] = d[2] * f[0] - d[0] * f[2]; foot.across[2] = d[0] * f[1] - d[1] * f[0];
    for (let c = 0; c < 3; c += 1) out.socket[c] += (ankle[c] + (d[c] * 0.17 + f[c] * 0.02) * unit) / 2;
  }

  // The neck and the head: stretched out in the swoop, thrown back in the cry.
  const stretch = smooth(T.dive[0] - 0.1, T.dive[0] + 0.15, t) * (1 - smooth(T.strikeAt + 0.05, T.strikeAt + 0.35, t));
  const n0 = out.neck, head = out.head;
  for (let c = 0; c < 3; c += 1) {
    n0[c] = out.centre[c] + (F[c] * 0.45 + U[c] * 0.08) * unit;
    head[c] = n0[c] + (F[c] * (0.36 + 0.12 * stretch - 0.06 * out.cry) + U[c] * (0.2 - 0.14 * stretch + 0.12 * out.cry)) * unit;
  }
  head[1] = softFloor(head[1], plan.boardTop + 0.22 * board, 0.12 * board);
  // The beak points along the flight, a little down; up in the cry. The crown stands off the head's back.
  const tilt = -0.3 + 0.55 * Math.min(1, out.cry);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let c = 0; c < 3; c += 1) { out.beak[c] = F[c] * ct + U[c] * st; out.crown[c] = U[c] * ct - F[c] * st; }
  for (let c = 0; c < 3; c += 1) out.tail[c] = out.centre[c] - F[c] * TRUNK.tail * unit;
  return out;
}

function unitInto(from: readonly number[], out: V3): V3 {
  const l = Math.hypot(from[0], from[1], from[2]) || 1;
  out[0] = from[0] / l; out[1] = from[1] / l; out[2] = from[2] / l;
  return out;
}

/** Two bones of lengths `a` and `b` from `root` toward `target`, the joint bending toward `hint`: writes the joint and the end. */
function solveLeg(root: V3, target: V3, a: number, b: number, hint: V3, joint: V3, end: V3): void {
  let dx = target[0] - root[0], dy = target[1] - root[1], dz = target[2] - root[2];
  const want = Math.hypot(dx, dy, dz) || 1e-6, reach = clamp(want, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  dx /= want; dy /= want; dz /= want;
  // the bend, square to the line from the root
  const along = hint[0] * dx + hint[1] * dy + hint[2] * dz;
  let bx = hint[0] - dx * along, by = hint[1] - dy * along, bz = hint[2] - dz * along;
  const bl = Math.hypot(bx, by, bz);
  if (bl < 1e-5) { bx = 0; by = 0; bz = 1; } else { bx /= bl; by /= bl; bz /= bl; }
  const x = (a * a - b * b + reach * reach) / (2 * reach), y = Math.sqrt(Math.max(0, a * a - x * x));
  joint[0] = root[0] + dx * x + bx * y; joint[1] = root[1] + dy * x + by * y; joint[2] = root[2] + dz * x + bz * y;
  end[0] = root[0] + dx * reach; end[1] = root[1] + dy * reach; end[2] = root[2] + dz * reach;
}

/**
 * Moves the strike so the posed bird's talons close exactly on the victim's chest: poses the bird there, measures
 * the socket, and moves the body by what is left over, a few times (the bird's bearing at the strike depends a
 * little on where the strike is). Returns how far off the socket is left, in scene units.
 */
export function lockTalons(plan: PhoenixPlan, beats: readonly PhoenixWingbeat[]): number {
  if (plan.timeline.brief) return 0;
  const pose = emptyPose();
  let off = Infinity;
  for (let i = 0; i < 12; i += 1) {
    phoenixPose(plan, beats, plan.timeline.strikeAt, pose);
    const by = { x: plan.chest.x - pose.socket[0], y: plan.chest.y - pose.socket[1], z: plan.chest.z - pose.socket[2] };
    off = Math.hypot(by.x, by.y, by.z);
    if (off < 1e-5) break;
    moveStrike(plan, by);
  }
  phoenixPose(plan, beats, plan.timeline.strikeAt, pose);
  return Math.hypot(plan.chest.x - pose.socket[0], plan.chest.y - pose.socket[1], plan.chest.z - pose.socket[2]);
}

/** The wing's bones as shares of its whole length, for placing the leading edge. */
const BONE_SHARE = (() => { const total = WING.bones[0] + WING.bones[1] + WING.bones[2]; return [WING.bones[0] / total, (WING.bones[0] + WING.bones[1]) / total]; })();

/** Where things are that a ribbon may hang from, but which the pose does not know: the Queen's hand and the seal's first point. */
export interface PlumeAnchors {
  hand: Point;
  /** How far the thread has climbed from the hand (0..1), and how bright it is (0 hides it). */
  thread: number;
  threadGlow: number;
  pen: Point;
}

const tmp: V3 = [0, 0, 0];
const histScratch: Point = { x: 0, y: 0, z: 0 };
const dirScratch: V3 = [0, 0, 0];

/**
 * The cuts of one ribbon at the pose: its centreline (three numbers a cut), half-width and temperature (two
 * numbers a cut) into `points` and `profile`. A ribbon not drawn now has every width 0.
 */
export function plumePoints(spec: PlumeSpec, pose: PhoenixPose, plan: PhoenixPlan, anchors: PlumeAnchors, points: Float32Array, profile: Float32Array): void {
  const unit = plan.bird, board = plan.unit, F = pose.forward, U = pose.up, L = pose.left, n = spec.segments, time = pose.time;
  const speedy = clamp(pose.speed / (12 * board), 0, 1);
  const flick = (rate: number, phase: number) => Math.sin(time * rate + spec.seed * 6.283 + phase);
  const put = (i: number, x: number, y: number, z: number, width: number, heat: number) => {
    points[i * 3] = x; points[i * 3 + 1] = y; points[i * 3 + 2] = z; profile[i * 2] = width; profile[i * 2 + 1] = heat;
  };
  if (spec.kind === PLUME_KIND.feather || spec.kind === PLUME_KIND.covert) {
    const w = spec.wing > 0 ? 0 : 1, joints = pose.joints[w], b = spec.bone, normal = pose.normals[w][b];
    const a = joints[b], z = joints[b + 1];
    const bx = z[0] - a[0], by = z[1] - a[1], bz = z[2] - a[2], bl = Math.hypot(bx, by, bz) || 1;
    const ox = bx / bl, oy = by / bl, oz = bz / bl;
    // back, square to the bone; along the bone when the bone itself lies back (folded)
    const dot = -(F[0] * ox + F[1] * oy + F[2] * oz);
    let tx = -F[0] - dot * ox, ty = -F[1] - dot * oy, tz = -F[2] - dot * oz;
    const tl = Math.hypot(tx, ty, tz), keep = 1 - smooth(0.05, 0.4, tl);
    tx = tx + -F[0] * keep; ty = ty + -F[1] * keep; tz = tz + -F[2] * keep;
    const tn = Math.hypot(tx, ty, tz) || 1; tx /= tn; ty /= tn; tz /= tn;
    // fanned from back toward along the bone; and laid back along the body as the wing folds
    const angle = clamp(spec.fan * pose.fan, -0.3, 1.15) * Math.PI * 0.5, ca = Math.cos(angle), sa = Math.sin(angle);
    let dx = tx * ca + ox * sa, dy = ty * ca + oy * sa, dz = tz * ca + oz * sa;
    const lay = 0.75 * pose.fold;
    dx = dx * (1 - lay) - F[0] * lay; dy = dy * (1 - lay) - F[1] * lay; dz = dz * (1 - lay) - F[2] * lay;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    // a covert roots a little forward of the bone, over the flight feathers; a lesser covert further forward still
    const forward = spec.kind === PLUME_KIND.covert ? (spec.lift > 0.5 ? 0.11 : 0.06) * unit : 0;
    const rx = a[0] + bx * spec.u - tx * forward + normal[0] * forward * 0.5, ry = a[1] + by * spec.u - ty * forward + normal[1] * forward * 0.5, rz = a[2] + bz * spec.u - tz * forward + normal[2] * forward * 0.5;
    const length = spec.length * (1 + 0.06 * flick(9.3, 0)) * (1 - 0.12 * pose.fold);
    const sweep = 0.08 + 0.22 * speedy;
    // the outer primaries narrow past their middles into the slotted fingers of the wingtip
    const slot = spec.kind === PLUME_KIND.feather && spec.bone === 2 ? smooth(0.4, 0.75, spec.u) * (1 - 0.6 * pose.fold) : 0;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, s2 = s * s, reach = length * s;
      // swept back by the air, a little cupped, and fluttering at the tip
      const flutter = 0.06 * length * s2 * flick(13 + 5 * spec.seed, -s * 2.6), cup = -0.06 * length * s2;
      put(i,
        rx + dx * reach - F[0] * sweep * length * s2 + normal[0] * (flutter + cup),
        ry + dy * reach - F[1] * sweep * length * s2 + normal[1] * (flutter + cup),
        rz + dz * reach - F[2] * sweep * length * s2 + normal[2] * (flutter + cup),
        spec.width * (0.85 + 1.1 * s * (1 - s)) * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.6) * (1 - 0.55 * slot * smooth(0.35, 0.6, s)),
        spec.heat * (1 - 0.8 * Math.pow(s, 0.85)));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.streamer) {
    // Along the path it has flown, by arc length; hanging down behind the body when it is nearly still.
    const rigid = 1 - smooth(1.8 * board, 5 * board, pose.speed);
    const offX = pose.tail[0] - pose.centre[0], offY = pose.tail[1] - pose.centre[1], offZ = pose.tail[2] - pose.centre[2];
    // hanging: back from the tail and down behind its back, so what hangs in its talons is seen in front of them
    const hx0 = -F[0] * 0.6 + U[0] * 0.55, hy0 = -F[1] * 0.6 + U[1] * 0.55 - 0.5, hz0 = -F[2] * 0.6 + U[2] * 0.55;
    const hl = Math.hypot(hx0, hy0, hz0) || 1, hangX = hx0 / hl, hangY = hy0 / hl, hangZ = hz0 / hl;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, d = s * spec.length;
      const when = phoenixTimeAtArc(plan, pose.arc - d), past = phoenixPosition(plan, when, histScratch);
      const hx = past.x + offX, hy = past.y + offY, hz = past.z + offZ;
      const qx = pose.tail[0] + hangX * d, qy = pose.tail[1] + hangY * d, qz = pose.tail[2] + hangZ * d;
      const fanOut = d * (0.3 + 0.7 * s), wave = s * board * (0.5 + 0.5 * speedy);
      const across = spec.spread * 0.3 * fanOut + 0.2 * wave * flick(4.2, -s * 5), lift = spec.lift * 0.12 * fanOut + 0.14 * wave * flick(3.1, -s * 4 + 1.7);
      put(i,
        hx + (qx - hx) * rigid + L[0] * across + U[0] * lift,
        hy + (qy - hy) * rigid + L[1] * across + U[1] * lift,
        hz + (qz - hz) * rigid + L[2] * across + U[2] * lift,
        spec.width * (0.45 + 0.55 * Math.sqrt(s)) * Math.pow(Math.max(0, 1 - s * s * s), 0.7) + spec.width * 0.75 * Math.exp(-(((s - 0.86) / 0.07) ** 2)),
        spec.heat * (1 - 0.82 * Math.pow(s, 0.7)) + 0.25 * Math.exp(-(((s - 0.86) / 0.07) ** 2)));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.rectrix) {
    // The tail's fan: broad feathers from the root of the tail, spread wide as it brakes and hovers, closed in the glide.
    const angle = spec.spread * (0.12 + 0.62 * pose.tailFan), ca = Math.cos(angle), sa = Math.sin(angle);
    let dx = -F[0] * ca + L[0] * sa - U[0] * 0.1, dy = -F[1] * ca + L[1] * sa - U[1] * 0.1, dz = -F[2] * ca + L[2] * sa - U[2] * 0.1;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const length = spec.length * (1 + 0.04 * flick(8.1, 0)) * (1 - 0.1 * (1 - pose.tailFan));
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, reach = length * s, droop = 0.1 * length * s * s + 0.05 * length * s * s * flick(11, -s * 3);
      put(i, pose.tail[0] + dx * reach - U[0] * droop, pose.tail[1] + dy * reach - U[1] * droop, pose.tail[2] + dz * reach - U[2] * droop,
        spec.width * (0.55 + 0.6 * Math.sqrt(s)) * Math.pow(Math.max(0, 1 - Math.pow(s, 3)), 0.5),
        spec.heat * (1 - 0.78 * Math.pow(s, 0.85)));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.plume) {
    // Crown plumes stand up off the head; the crests trail back from it, dragged by the air.
    const crown = spec.lift > 0.5, C = pose.crown, H = pose.head;
    let dx: number, dy: number, dz: number;
    if (crown) { dx = C[0] - F[0] * 0.5 + L[0] * spec.spread * 0.45; dy = C[1] - F[1] * 0.5 + L[1] * spec.spread * 0.45; dz = C[2] - F[2] * 0.5 + L[2] * spec.spread * 0.45; }
    else { dx = -F[0] + C[0] * 0.55 + L[0] * spec.spread * 0.18; dy = -F[1] + C[1] * 0.55 + L[1] * spec.spread * 0.18; dz = -F[2] + C[2] * 0.55 + L[2] * spec.spread * 0.18; }
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const root = crown ? 0.1 : 0.06, back = crown ? 0.03 : 0.1;
    const rx = H[0] + (C[0] * root - F[0] * back) * unit, ry = H[1] + (C[1] * root - F[1] * back) * unit, rz = H[2] + (C[2] * root - F[2] * back) * unit;
    const length = spec.length * (1 + 0.1 * flick(10.5, 0));
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, reach = length * s, drag = (crown ? 0.25 : 0.12) * length * s * s, sway = 0.08 * length * s * s * flick(8, -s * 3);
      put(i,
        rx + dx * reach - F[0] * drag - C[0] * (crown ? 0 : drag * 0.6) + L[0] * sway,
        ry + dy * reach - F[1] * drag - C[1] * (crown ? 0 : drag * 0.6) + L[1] * sway,
        rz + dz * reach - F[2] * drag - C[2] * (crown ? 0 : drag * 0.6) + L[2] * sway,
        spec.width * (0.6 + 0.8 * s * (1 - s)) * Math.pow(Math.max(0, 1 - s * s), 0.5),
        spec.heat * (1 - 0.7 * s));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.beak) {
    // Two halves: a deep hooked upper half and a shorter lower one, parted in the cry.
    const B = pose.beak, C = pose.crown, H = pose.head, upper = spec.lift > 0, part = spec.lift * (0.04 + 0.34 * Math.min(1, pose.cry));
    let dx = B[0] + C[0] * part, dy = B[1] + C[1] * part, dz = B[2] + C[2] * part;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const rx = H[0] + B[0] * 0.1 * unit, ry = H[1] + B[1] * 0.1 * unit, rz = H[2] + B[2] * 0.1 * unit;
    for (let i = 0; i <= n; i += 1) {
      // the upper half curls down over the lower at its tip: a raptor's hook
      const s = i / n, reach = spec.length * s * (upper ? 1 - 0.25 * s * s * s : 1), hook = upper ? -0.45 * spec.length * Math.pow(s, 3) : 0;
      put(i, rx + dx * reach + C[0] * hook, ry + dy * reach + C[1] * hook, rz + dz * reach + C[2] * hook,
        spec.width * Math.pow(Math.max(0, 1 - s), 0.75) * (upper ? 1 + 0.25 * Math.sin(Math.PI * s) : 1), spec.heat * (0.9 + 0.15 * s));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.eye) {
    // A white-hot spark on each side of the head, a little above and behind the beak's root.
    const H = pose.head, C = pose.crown, B = pose.beak, side = spec.spread;
    const ax = L[0] * side, ay = L[1] * side, az = L[2] * side;
    const cx = H[0] + (ax * 0.075 + B[0] * 0.045 + C[0] * 0.035) * unit, cy = H[1] + (ay * 0.075 + B[1] * 0.045 + C[1] * 0.035) * unit, cz = H[2] + (az * 0.075 + B[2] * 0.045 + C[2] * 0.035) * unit;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n - 0.5;
      put(i, cx + B[0] * spec.length * s, cy + B[1] * spec.length * s, cz + B[2] * spec.length * s, spec.width, spec.heat);
    }
    return;
  }
  if (spec.kind === PLUME_KIND.neck) {
    // From the chest to the head, short and thick, bowed forward.
    const a = pose.neck, h = pose.head;
    const cx = a[0] + F[0] * 0.22 * unit, cy = a[1] + F[1] * 0.22 * unit, cz = a[2] + F[2] * 0.22 * unit;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, p = 1 - s;
      put(i, p * p * a[0] + 2 * p * s * cx + s * s * h[0], p * p * a[1] + 2 * p * s * cy + s * s * h[1], p * p * a[2] + 2 * p * s * cz + s * s * h[2], spec.width * (1 - 0.35 * s), spec.heat);
    }
    return;
  }
  if (spec.kind === PLUME_KIND.vane) {
    // A soft band along the three bones, set back from the leading edge over the roots of the feathers.
    const w = spec.wing > 0 ? 0 : 1, joints = pose.joints[w];
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, b = s < BONE_SHARE[0] ? 0 : s < BONE_SHARE[1] ? 1 : 2;
      const from = b === 0 ? 0 : BONE_SHARE[b - 1], to = b === 2 ? 1 : BONE_SHARE[b], k = (s - from) / (to - from);
      const j0 = joints[b], j1 = joints[b + 1];
      const ox = j1[0] - j0[0], oy = j1[1] - j0[1], oz = j1[2] - j0[2], ol = Math.hypot(ox, oy, oz) || 1;
      const dot = -(F[0] * ox + F[1] * oy + F[2] * oz) / ol;
      let tx = -F[0] - dot * ox / ol, ty = -F[1] - dot * oy / ol, tz = -F[2] - dot * oz / ol;
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 0.2) { tx = -F[0]; ty = -F[1]; tz = -F[2]; } else { tx /= tl; ty /= tl; tz /= tl; }
      const back = spec.length * (0.6 + 0.4 * (1 - s));
      put(i, j0[0] + ox * k + tx * back, j0[1] + oy * k + ty * back, j0[2] + oz * k + tz * back, spec.width * (1 - 0.45 * s) * Math.min(1, s * 6 + 0.3) * (1 - 0.5 * pose.fold), spec.heat * (1 - 0.2 * s));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.edge) {
    // The wing's hot leading edge, along its three bones.
    const joints = pose.joints[spec.wing > 0 ? 0 : 1];
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, b = s < BONE_SHARE[0] ? 0 : s < BONE_SHARE[1] ? 1 : 2;
      const from = b === 0 ? 0 : BONE_SHARE[b - 1], to = b === 2 ? 1 : BONE_SHARE[b], k = (s - from) / (to - from);
      const j0 = joints[b], j1 = joints[b + 1];
      put(i, j0[0] + (j1[0] - j0[0]) * k, j0[1] + (j1[1] - j0[1]) * k, j0[2] + (j1[2] - j0[2]) * k, spec.width * (1 - 0.55 * s), spec.heat * (1 - 0.2 * s));
    }
    return;
  }
  if (spec.kind === PLUME_KIND.leg) {
    // The thigh, feathered and broad, burning; then the bare tarsus, a darker ember, down to the ankle.
    const [hip, heel, ankle] = pose.legs[spec.wing > 0 ? 0 : 1];
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, thigh = s <= 0.5, k = thigh ? s / 0.5 : (s - 0.5) / 0.5, a = thigh ? hip : heel, b = thigh ? heel : ankle;
      const width = thigh ? spec.width * (1 - 0.35 * k) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, k * 1.3))) : spec.width * (0.42 - 0.1 * k);
      put(i, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, width, thigh ? spec.heat * (1 - 0.15 * k) : spec.heat * 0.78);
    }
    return;
  }
  if (spec.kind === PLUME_KIND.toe) {
    // A toe from the ankle, curling as the foot closes, its talon hooking further; three forward and one behind.
    const w = spec.wing > 0 ? 0 : 1, sign = w === 0 ? 1 : -1, ankle = pose.legs[w][2], foot = pose.feet[w], toe = spec.bone;
    const open = 1 - pose.clutch, behind = toe === 3;
    const splay = behind ? Math.PI : (toe - 1) * (0.42 + 0.3 * open) * sign;
    const cs = Math.cos(splay), sn = Math.sin(splay), D = foot.down, Fw = foot.forward, A = foot.across;
    // pointing out from the foot along the sole, a little down; curling toward the sole and on under it as it closes
    const d0x = Fw[0] * cs + A[0] * sn, d0y = Fw[1] * cs + A[1] * sn, d0z = Fw[2] * cs + A[2] * sn;
    const curl = 0.25 + 0.9 * pose.clutch, talonAt = 1 - LEG.talon / (behind ? LEG.hallux + LEG.talon : LEG.toe + LEG.talon);
    let x = ankle[0] + D[0] * 0.03 * unit, y = ankle[1] + D[1] * 0.03 * unit, z = ankle[2] + D[2] * 0.03 * unit;
    const step = spec.length / n;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n, talon = s > talonAt;
      put(i, x, y, z, spec.width * (talon ? 0.75 * (1 - (s - talonAt) / (1 - talonAt)) + 0.12 : 1 - 0.25 * s), talon ? 1.12 : spec.heat * (1 - 0.15 * s));
      const bend = curl * (0.15 + 1.5 * s) + (talon ? 0.8 * pose.clutch + 0.35 : 0);
      const cb = Math.cos(bend), sb = Math.sin(bend);
      dirScratch[0] = d0x * cb + D[0] * sb; dirScratch[1] = d0y * cb + D[1] * sb; dirScratch[2] = d0z * cb + D[2] * sb;
      x += dirScratch[0] * step; y += dirScratch[1] * step; z += dirScratch[2] * step;
    }
    return;
  }
  // The thread: from the hand to where the pens start, climbing; lit behind its head.
  const h = anchors.hand, p = anchors.pen;
  for (let i = 0; i <= n; i += 1) {
    const s = i / n, lit = s <= anchors.thread ? 1 : 0, sway = Math.sin(time * 6 + s * 7) * 0.04 * board * Math.sin(Math.PI * s);
    tmp[0] = h.x + (p.x - h.x) * s + sway; tmp[1] = h.y + (p.y - h.y) * s; tmp[2] = h.z + (p.z - h.z) * s + sway;
    put(i, tmp[0], tmp[1], tmp[2], spec.width * lit * anchors.threadGlow * (0.6 + 0.4 * Math.sin(Math.PI * s)), spec.heat * (0.8 + 0.2 * s));
  }
}

/** The buffers the drawing reads: per vertex a centreline point, the way the ribbon runs there, and (along, side, half-width, temperature). */
export interface PlumeBuffers {
  position: Float32Array;
  tangent: Float32Array;
  ribbon: Float32Array;
}

export function plumeBuffers(layout: PlumeLayout): PlumeBuffers {
  return { position: new Float32Array(layout.vertices * 3), tangent: new Float32Array(layout.vertices * 3), ribbon: new Float32Array(layout.vertices * 4) };
}

/**
 * Writes every ribbon of the bird at the pose into `buffers`. As the bird goes into the sun every flame is drawn
 * in toward it, hotter, and narrower; before it comes through the seal and after, nothing has any width.
 */
export function writePlumes(layout: PlumeLayout, pose: PhoenixPose, plan: PhoenixPlan, anchors: PlumeAnchors, buffers: PlumeBuffers, scratch?: { points: Float32Array; profile: Float32Array }): void {
  const most = layout.specs.reduce((m, spec) => Math.max(m, spec.segments + 1), 0);
  const points = scratch?.points ?? new Float32Array(most * 3), profile = scratch?.profile ?? new Float32Array(most * 2);
  const sun = plan.sun, c = pose.collapse, pull = Math.pow(1 - c, 1.5), floor = plan.boardTop + 0.04 * plan.unit, margin = 0.12 * plan.unit;
  const { position, tangent, ribbon } = buffers;
  layout.specs.forEach((spec, index) => {
    plumePoints(spec, pose, plan, anchors, points, profile);
    const n = spec.segments, first = layout.first[index], bird = spec.kind !== PLUME_KIND.thread;
    if (bird && c > 0) for (let i = 0; i <= n; i += 1) {
      points[i * 3] = sun.x + (points[i * 3] - sun.x) * pull; points[i * 3 + 1] = sun.y + (points[i * 3 + 1] - sun.y) * pull; points[i * 3 + 2] = sun.z + (points[i * 3 + 2] - sun.z) * pull;
    }
    if (bird) for (let i = 0; i <= n; i += 1) points[i * 3 + 1] = softFloor(points[i * 3 + 1], floor, margin);
    const shown = bird ? pose.shown : 1, hotter = bird ? pose.heat : 1;
    for (let i = 0; i <= n; i += 1) {
      const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
      let tx = points[b * 3] - points[a * 3], ty = points[b * 3 + 1] - points[a * 3 + 1], tz = points[b * 3 + 2] - points[a * 3 + 2];
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-9) { tx /= tl; ty /= tl; tz /= tl; } else { tx = pose.forward[0]; ty = pose.forward[1]; tz = pose.forward[2]; }
      const width = profile[i * 2] * shown * (bird ? 1 - 0.6 * c : 1), heat = profile[i * 2 + 1] * hotter;
      for (let side = 0; side < 2; side += 1) {
        const vtx = first + i * 2 + side;
        position[vtx * 3] = points[i * 3]; position[vtx * 3 + 1] = points[i * 3 + 1]; position[vtx * 3 + 2] = points[i * 3 + 2];
        tangent[vtx * 3] = tx; tangent[vtx * 3 + 1] = ty; tangent[vtx * 3 + 2] = tz;
        ribbon[vtx * 4] = i / n; ribbon[vtx * 4 + 1] = side === 0 ? -1 : 1; ribbon[vtx * 4 + 2] = width; ribbon[vtx * 4 + 3] = heat;
      }
    }
  });
}

/** The tip of the wing's outermost primary, and the wingspan from one to the other: what the tests measure. */
export function wingTips(layout: PlumeLayout, pose: PhoenixPose, plan: PhoenixPlan, anchors: PlumeAnchors): { left: V3; right: V3; span: number } {
  const most = layout.specs.reduce((m, spec) => Math.max(m, spec.segments + 1), 0);
  const points = new Float32Array(most * 3), profile = new Float32Array(most * 2);
  const tips: V3[] = [];
  for (const wing of [1, -1]) {
    let best: V3 = [...pose.joints[wing > 0 ? 0 : 1][3]] as V3, far = -1;
    for (const spec of layout.specs) {
      if (spec.kind !== PLUME_KIND.feather || spec.wing !== wing) continue;
      plumePoints(spec, pose, plan, anchors, points, profile);
      const n = spec.segments, x = points[n * 3], y = points[n * 3 + 1], z = points[n * 3 + 2];
      const out = (x - pose.centre[0]) * pose.left[0] * wing + (y - pose.centre[1]) * pose.left[1] * wing + (z - pose.centre[2]) * pose.left[2] * wing;
      if (out > far) { far = out; best = [x, y, z]; }
    }
    tips.push(best);
  }
  return { left: tips[0], right: tips[1], span: Math.hypot(tips[0][0] - tips[1][0], tips[0][1] - tips[1][1], tips[0][2] - tips[1][2]) };
}

export { phoenixWingbeats };
