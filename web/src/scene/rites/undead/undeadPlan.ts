// Adapted from LinearAbilityExtThreeJS and AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Kwind-09's summons, as a timeline: what the undead army is doing at each moment, what it is drawn with at each
 * tier, where the dead come up, how they shamble, and every wound they open. No Three.js in here, so the node
 * tests reach it (shared/play/rite-undead.test.ts); undead/undeadRite.ts draws what this decides.
 *
 * The beats, on one clock from the Queen's call:
 *
 *   split    current runs out from the victim's square along the seams between the squares, and they split
 *   rise     at the corners where four squares meet the stone heaves, and the Queen's own soldiers haul
 *            themselves up out of the board as the dead: greyed, corroded, torn, their eyes lit by the arc
 *   shamble  they come on in lurches, the current jumping from corpse to corpse
 *   swarm    they close on the victim and tear at it, wound after wound, until one blow kills (`strikeAt`)
 *   feed     at Full they keep tearing at what is left
 *   sink     each falls where it stands and sinks back into the stone; the seams close and go dark
 *
 * Violence decides what is shown of a body being torn (the gore system itself draws the blood): at Full a
 * frenzy of wounds and the body torn apart; at Cinematic fewer wounds and the body thrown down; at Minimal no
 * wound at all, nothing torn on the dead themselves, and the body falls as it does.
 *
 * From the reference: limbs hauling out of a rift in the floor (Kraken Crown), plates of stone heaving round
 * what breaks through (Earthen Spire), the lightning channel jumping from body to body (Stormheart Gyroscope's
 * LightningBolt, our shared strike). Ours: the dead are the Queen's own figures, the board's seams are the rift,
 * and every wound goes through the match's gore system.
 */
import type { QualityPreset } from "../../quality";
import type { Point } from "../../vfx/mystic/beamPlan";
import { crowdBudget, dice, type Flat } from "../armies/crowdPlan";
import { lightAt, type Slab } from "../armies/groundPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

export type Violence = "minimal" | "cinematic" | "full";

export interface UndeadBudget {
  /** The dead lent by the match: the Queen's own figures. */
  troops: number;
  /** Arcs jumping between corpses, and running along the seams. */
  chains: number;
  seamArcs: number;
  /** Sparks spat from the holes and the arcs; grit and smoke where the stone heaves. */
  sparks: number;
  grit: number;
  smoke: number;
}

/** What the undead army is drawn with at each tier. The lowest has no bloom and no lights. */
export const UNDEAD_BUDGET: Readonly<Record<QualityPreset, Omit<UndeadBudget, "troops">>> = {
  low: { chains: 3, seamArcs: 2, sparks: 50, grit: 30, smoke: 16 },
  medium: { chains: 5, seamArcs: 3, sparks: 110, grit: 60, smoke: 28 },
  high: { chains: 7, seamArcs: 4, sparks: 180, grit: 100, smoke: 40 },
  ultra: { chains: 9, seamArcs: 6, sparks: 260, grit: 140, smoke: 56 },
};

export function undeadCounts(quality: QualityPreset): UndeadBudget {
  return { troops: crowdBudget(quality).troops, ...UNDEAD_BUDGET[quality] };
}

/**
 * Wounds the dead open, by the Violence setting and the tier: the gore system's own budget for a wound grows with
 * the tier, and a lower tier is a weaker machine, so it gets fewer of them. None at Minimal.
 */
export const UNDEAD_WOUNDS: Readonly<Record<Violence, Readonly<Record<QualityPreset, number>>>> = {
  minimal: { low: 0, medium: 0, high: 0, ultra: 0 },
  cinematic: { low: 2, medium: 3, high: 4, ultra: 5 },
  full: { low: 5, medium: 7, high: 9, ultra: 11 },
};

/** What the dead show of tearing on their own bodies: torn cloth, and bone under it. Nothing at Minimal. */
export const UNDEAD_TORN: Readonly<Record<Violence, { tear: number; bone: number }>> = {
  minimal: { tear: 0, bone: 0 },
  cinematic: { tear: 0.1, bone: 0 },
  full: { tear: 0.24, bone: 1 },
};

/** The clock, in seconds from the call. */
export const UNDEAD_TIMING = {
  /** The current runs out along the seams, and how far it gets. */
  split: 0, splitFor: 0.75, seamReach: 3.1,
  /** The dead rise: the first at `from`, the last by `from + spread`, each taking `length`. */
  rise: { from: 0.25, spread: 0.5, length: 0.75 },
  /** They close on the victim between `first` and `first + spread`. */
  arrive: { first: 1.75, spread: 0.4 },
  /** The killing blow. */
  strike: 2.85,
  /** At Full they tear at what is left until `feed`. */
  feed: 3.5,
  /** They sink: the first at `from`, the last by `from + spread`, each taking `length`. */
  sink: { from: 3.65, spread: 0.6, length: 0.9 },
  /** The current dies, the seams close, the scar heals. */
  dim: 4.4, healed: 6.3,
  done: 6.6,
} as const;

/** Each dead's march: a steady shamble, slow, broken into lurches. */
export const SHAMBLE = { top: 1.9, least: 0.55, most: 1.3 } as const;

/**
 * Where the dead come up: the corners where four squares meet, inside the band round the victim, spaced and
 * clear of every piece (a corner is never on a piece, but may be hard by one). Fewer when the board has no room.
 */
export function seamCorners(options: { centre: Flat; standing: readonly Flat[]; count: number; inner: number; outer: number; clearance: number; spacing: number; tile: number; seed: number; favour?: Flat }): Flat[] {
  const { centre, standing, count, inner, outer, clearance, spacing, tile, seed } = options;
  const random = dice(seed ^ 0xc0a1);
  const favour = options.favour && Math.hypot(options.favour.x, options.favour.z) > 1e-6 ? options.favour : null;
  const corners: { at: Flat; score: number }[] = [];
  // interior corners only: a corner on the board's rim has no square beyond it to heave
  for (let i = -3; i <= 3; i += 1) for (let j = -3; j <= 3; j += 1) {
    const at = { x: i * tile, z: j * tile }, r = Math.hypot(at.x - centre.x, at.z - centre.z);
    if (r < inner || r > outer) continue;
    if (standing.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < clearance)) continue;
    const toward = favour ? ((at.x - centre.x) * favour.x + (at.z - centre.z) * favour.z) / (r * Math.hypot(favour.x, favour.z)) : 0;
    corners.push({ at, score: 1 + 0.35 * toward + 0.4 * random() - 0.15 * Math.abs(r - (inner + outer) / 2) });
  }
  corners.sort((a, b) => b.score - a.score);
  const picked: Flat[] = [];
  for (const corner of corners) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.hypot(p.x - corner.at.x, p.z - corner.at.z) < spacing)) continue;
    picked.push(corner.at);
  }
  return picked;
}

/**
 * The four plates of stone round a corner the dead come up through: a quarter of each of its squares, heaved
 * up on the side nearer the corner as the body pushes through, held while it climbs, and dropped back.
 */
export function cornerPlates(corner: Flat, tile: number, riseAt: number, riseFor: number, seed: number, standing: readonly Flat[], clearance: number): Slab[] {
  const random = dice(seed ^ 0x9a7e);
  const plates: Slab[] = [];
  const size = tile * 0.4;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const at = { x: corner.x + sx * (size / 2 + 0.03), z: corner.z + sz * (size / 2 + 0.03) };
    // a piece standing on the square keeps its stone down
    if (standing.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < clearance)) continue;
    const away = { x: sx / Math.SQRT2, z: sz / Math.SQRT2 };
    const lift = 0.045 + 0.05 * random();
    plates.push({
      at, width: size * (0.9 + 0.12 * random()), depth: size * (0.9 + 0.12 * random()), thickness: 0.07, light: lightAt(at, tile), away,
      lift, tilt: 0.3 + 0.35 * random(), spin: (random() - 0.5) * 0.25,
      birth: riseAt + 0.03 * random(), rise: 0.18, hang: Math.max(0.1, riseFor - 0.2), fall: Math.sqrt((2 * lift) / 9.8) * 1.3, settle: 0.35, seed: Math.floor(random() * 1e6),
    });
  }
  return plates;
}

/**
 * How far through its march a dead body is when `u` of the march's time has passed: the same start and end, but
 * covered in lurches, each a surge and a near stop. Never goes backward (the surge's depth is under 1).
 */
export function shambleWarp(u: number, lurches: number, depth = 0.82): number {
  const t = clamp01(u), k = Math.max(1, Math.round(lurches));
  return clamp01(t - (depth * Math.sin(2 * Math.PI * k * t)) / (2 * Math.PI * k));
}

/**
 * How far up out of the stone a body has hauled itself, `u` of the way through its rise: in three heaves, each a
 * pull and a hang, the last the longest, so it climbs rather than slides.
 */
export function haulRise(u: number): number {
  const t = clamp01(u);
  const heaves = [[0, 0.3, 0.38], [0.36, 0.62, 0.72], [0.68, 1, 1]] as const;
  let height = 0;
  for (const [from, to, reach] of heaves) {
    if (t <= from) break;
    const before = height;
    const p = clamp01((t - from) / (to - from));
    height = before + (reach - before) * (1 - (1 - p) ** 3);
  }
  return height;
}

/** A twitch of the body: a sudden turn and back, `seed`'s own, a few times a second at most. Radians. */
export function twitch(t: number, seed: number): number {
  const random = dice(seed ^ 0x7c), beats = 6, out: number[] = [];
  for (let i = 0; i < beats; i += 1) out.push(random() * 7 + random() * 0.4);
  let turn = 0;
  for (const at of out) {
    const since = t - at;
    if (since > 0 && since < 0.35) turn += Math.sin(since / 0.35 * Math.PI) * (0.18 + 0.12 * Math.sin(at * 17)) * (Math.sin(at * 31) > 0 ? 1 : -1) * Math.exp(-since * 6);
  }
  return turn;
}

export interface UndeadWound {
  /** When it is opened, by which of the dead, and how hard. */
  at: number;
  by: number;
  power: number;
  /** True for the blow that kills. */
  kills: boolean;
}

/**
 * Every wound the dead open, in order: one blow that kills at `strikeAt`, by whoever has reached the victim by
 * then; the rest before it while the victim stands, and at Full some after it, on what is left. Each is dealt by
 * one of the dead who has reached the victim. None at Minimal.
 */
export function woundSchedule(violence: Violence, quality: QualityPreset, arrivals: readonly number[], seed: number): UndeadWound[] {
  const T = UNDEAD_TIMING;
  const count = UNDEAD_WOUNDS[violence][quality];
  if (count === 0 || arrivals.length === 0) return [];
  const random = dice(seed ^ 0x3a7);
  const order = arrivals.map((at, i) => ({ at, i })).sort((a, b) => a.at - b.at);
  const there = (t: number) => order.filter((o) => o.at + 0.12 <= t).map((o) => o.i);
  const killer = (there(T.strike)[0] ?? order[0].i);
  const after = violence === "full" ? Math.max(1, Math.round(count * 0.35)) : 0;
  const before = Math.max(0, count - 1 - after);
  const wounds: UndeadWound[] = [];
  const first = Math.max(order[0].at + 0.15, T.strike - 0.75);
  for (let k = 0; k < before; k += 1) {
    const t = first + ((k + 0.25 + 0.5 * random()) / Math.max(1, before)) * (T.strike - 0.08 - first);
    const ready = there(t);
    wounds.push({ at: +t.toFixed(4), by: ready.length ? ready[Math.floor(random() * ready.length)] : killer, power: +(0.55 + 0.45 * random()).toFixed(3), kills: false });
  }
  wounds.push({ at: T.strike, by: killer, power: violence === "full" ? 1.6 : 1.1, kills: true });
  for (let k = 0; k < after; k += 1) {
    const t = T.strike + 0.12 + ((k + 0.3 * random()) / after) * (T.feed - T.strike - 0.15);
    const ready = there(t);
    wounds.push({ at: +t.toFixed(4), by: ready[Math.floor(random() * ready.length)] ?? killer, power: +(1 + 0.5 * random()).toFixed(3), kills: false });
  }
  return wounds.sort((a, b) => a.at - b.at);
}

export interface UndeadEnvelope {
  /** The current in the seams (0..1), how far it has run, how much of the scar is left. */
  seams: number;
  seamFront: number;
  scar: number;
  /** Camera shake this frame. */
  shake: number;
  /** The light the rite asks for, about 1 at rest. */
  light: number;
  /** Current flickers: a quick stutter, about 1. */
  flicker: number;
  done: boolean;
}

/** The rite's envelopes at `t`. */
export function undeadEnvelope(t: number, seed: number, brief = false): UndeadEnvelope {
  const T = UNDEAD_TIMING;
  const flicker = 0.7 + 0.3 * Math.abs(Math.sin(t * 23 + seed)) * (Math.sin(t * 61 + seed * 1.7) > -0.6 ? 1 : 0.2);
  const seams = smooth(T.split, T.split + 0.12, t) * (1 - smooth(T.dim, T.healed - 0.3, t));
  const seamFront = T.seamReach * (1 - (1 - clamp01((t - T.split) / T.splitFor)) ** 2);
  const scar = t < T.split ? 0 : 1 - smooth(T.dim + 0.2, T.healed, t);
  const rising = t > T.rise.from && t < T.rise.from + T.rise.spread + T.rise.length ? 0.05 : 0;
  const blow = t >= T.strike ? Math.exp(-(t - T.strike) / 0.14) : 0;
  const shake = brief ? 0 : Math.min(0.6, rising + 0.38 * blow + (t > T.split && t < T.split + 0.5 ? 0.06 : 0));
  return { seams, seamFront, scar, shake, light: t >= T.done ? 0 : (0.6 + 0.6 * seams + 2.5 * blow) * flicker, flicker, done: t >= T.done };
}

/** How far above the victim every beat's frame reaches. */
export const UNDEAD_SKY = 3.2;

/** The beats the camera watches, and when each begins. */
export const UNDEAD_SHOTS = { split: 0, rise: 0.4, swarm: 1.65, after: 3.55 } as const;

export function undeadShot(t: number): number {
  const S = UNDEAD_SHOTS;
  return t >= S.after ? 3 : t >= S.swarm ? 2 : t >= S.rise ? 1 : 0;
}

/** What each beat keeps in frame. */
export function undeadFrames(input: { queen: Point; victim: Point; spawns: readonly Flat[]; boardTop: number }): Point[][] {
  const { queen, victim, spawns, boardTop } = input;
  const up = (p: Flat, y: number): Point => ({ x: p.x, y: boardTop + y, z: p.z });
  const v = { x: victim.x, z: victim.z };
  const ring = (r: number, y: number) => [0, 1, 2, 3].map((k) => up({ x: v.x + Math.cos(k * Math.PI / 2) * r, z: v.z + Math.sin(k * Math.PI / 2) * r }, y));
  // every beat keeps a point well above the victim, so the shot stands high enough to look over the pieces
  // between it and the player instead of through them
  const sky = up(v, UNDEAD_SKY);
  const split = [up(queen, 1.3), up(v, 0.9), ...ring(2.2, 0), sky];
  const rise = [up(v, 0), up(v, 1.2), ...spawns.map((s) => up(s, 0.9)), sky];
  const swarm = [up(v, 0), up(v, 1.35), ...ring(1.15, 0.2), sky];
  const after = [up(v, 0), up(v, 1.1), ...ring(1.5, 0), sky];
  return [split, rise, swarm, after];
}

export interface SeamHand {
  /** Where it reaches up out of a seam, which way it leans (unit), and how far over (radians). */
  at: Flat;
  lean: Flat;
  tilt: number;
  /** How far its wrist comes up above the stone, and its turn about the up axis. */
  reach: number;
  yaw: number;
  /** When it breaks out (the current reaches its seam), and when it is dragged back down. */
  rise: number;
  sink: number;
  seed: number;
}

/**
 * The dead who never get out: arms reaching up through the seams the current has split, round the victim, clear of
 * every piece and of the places the risen climb out and stand. The crowd budget's extras for this army.
 */
export function seamHands(options: { centre: Flat; standing: readonly Flat[]; keepOut: readonly Flat[]; count: number; tile: number; seed: number }): SeamHand[] {
  const { centre, standing, keepOut, count, tile, seed } = options;
  const T = UNDEAD_TIMING, random = dice(seed ^ 0x4a4d);
  const hands: SeamHand[] = [];
  for (let attempt = 0; attempt < count * 30 && hands.length < count; attempt += 1) {
    const r = 0.9 + random() * 1.9, turn = random() * Math.PI * 2;
    const near = { x: centre.x + Math.cos(turn) * r, z: centre.z + Math.sin(turn) * r };
    // onto the nearest seam: one of its two lines through the nearest corner, part way along
    const cx = Math.round(near.x / tile) * tile, cz = Math.round(near.z / tile) * tile, along = (random() - 0.5) * 0.7 * tile;
    const at = random() < 0.5 ? { x: cx + along, z: cz } : { x: cx, z: cz + along };
    if (Math.abs(at.x) > 3.9 * tile || Math.abs(at.z) > 3.9 * tile) continue;
    if (standing.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 0.36)) continue;
    if (keepOut.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 0.34)) continue;
    if (hands.some((h) => Math.hypot(h.at.x - at.x, h.at.z - at.z) < 0.3)) continue;
    const d = Math.hypot(at.x - centre.x, at.z - centre.z);
    const arrive = T.split + T.splitFor * (1 - Math.sqrt(Math.max(0, 1 - Math.min(1, d / T.seamReach))));
    const leanTurn = random() * Math.PI * 2;
    hands.push({
      at, lean: { x: Math.cos(leanTurn), z: Math.sin(leanTurn) }, tilt: 0.15 + 0.45 * random(), reach: 0.12 + 0.2 * random(), yaw: random() * Math.PI * 2,
      rise: arrive + 0.15 + 0.9 * random(), sink: T.sink.from - 0.3 + 0.9 * random(), seed: Math.floor(random() * 1e6),
    });
  }
  return hands;
}

export interface HandPose {
  /** How far up out of the seam it is, 0..1 (1 is its full reach), and how closed its fingers are, 0..1. */
  up: number;
  grasp: number;
  /** A sway about its lean, radians. */
  sway: number;
  shown: boolean;
}

/** What a hand is doing at `t`: it claws up, grasps at the air again and again, and is dragged back under. */
export function handPose(hand: SeamHand, t: number): HandPose {
  if (t < hand.rise || t > hand.sink + 0.5) return { up: 0, grasp: 0, sway: 0, shown: false };
  const out = 1 - (1 - clamp01((t - hand.rise) / 0.45)) ** 3;
  const under = clamp01((t - hand.sink) / 0.5);
  const phase = (t - hand.rise) * (2.2 + (hand.seed % 7) * 0.15) + (hand.seed % 13);
  const grasp = 0.5 + 0.5 * Math.sin(phase * Math.PI) ** 3;
  return { up: out * (1 - under * under), grasp: under > 0 ? 1 : grasp, sway: 0.25 * Math.sin(phase * 1.3) * (1 - under), shown: true };
}
