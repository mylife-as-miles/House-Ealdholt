/**
 * The anatomy of a cinematic fatality's X-ray (gore tier 3), worked out from the figure's own skeleton: which bones
 * it has and where they run, what breaks under the blow, how it breaks, and when each part of the X-ray shows.
 * fatality/xray.ts draws it; nothing here is drawn.
 *
 * - The layout: the long bones of the limbs between their joints (and the hands and feet past theirs), the
 *   clavicles, the spine from the pelvis to the skull, the skull on the head, the rib cage on the chest and the pelvis
 *   on the hips. Joints are told apart by name (death/ragdoll/ragdollPlan.ts mapRig, as the ragdoll and the burst
 *   read them), so the four kingdoms' figures and Mixamo-named rigs alike get one. A rig without a pelvis, a spine,
 *   a head, two shoulders and two hips gets none (null): the fatality then plays without its X-ray.
 * - The frames: the chest, the pelvis and the skull each stand in a frame made from the joints round them (up along
 *   the spine, across between the shoulders or the hips, forward out of the chest), read again every frame.
 * - The fracture: the first bone the blow meets along its path through the body (a rib on the side it went in, the
 *   breastbone, a vertebra, the skull or a long bone), and where on it.
 * - The fragments: what breaks away, each thrown along the blow or back out of the wound, seeded, so the same game
 *   breaks the same way. Each trails out on a damped spring (the feel of what trails a movement, an idea taken from
 *   the creator's reference apekshik/procedural-arm-rig, which has no licence: nothing of its code is used), easing
 *   out to where it drifts and settling there, tumbling less and less.
 * - The knobs: at each hinge (elbows, knees) a knob turned half way between the two bones, so the joint keeps its
 *   volume as it bends instead of pinching (the same reference's half-bend helper bones, on our own skeleton only).
 * - The timeline ({@link XRAY}): about a second, on the player's clock, from the blow.
 *
 * Pure, no three.js: shared/play/fatality-anatomy.test.ts.
 */
import { hash01 } from "../death/physics/math";
import { mapRig, type RigJoint } from "../death/ragdoll/ragdollPlan";

export interface Point { x: number; y: number; z: number }

/** A bone drawn between two joints, or on past one (a hand: `to` is -1, and it runs on from `from` along the bone before it). */
export interface LongBone {
  name: string;
  from: number;
  to: number;
  /** For a stub: the joint before `from`, and how far it runs, a share of that bone's length. */
  before?: number;
  stub?: number;
  /** Radius at the ends (the shaft is under half of it), a share of the figure's height. */
  girth: number;
}

/** A hinge between two long bones (an elbow, a knee): a knob turned half way between them keeps its volume. */
export interface HingeKnob { name: string; before: number; joint: number; after: number; girth: number }

export interface AnatomyLayout {
  long: LongBone[];
  knobs: HingeKnob[];
  /** The spine, joint by joint, from the pelvis to the head. */
  spine: number[];
  /** The skull: the head joint at its base, the joint at its crown and the one in front of the face, where the rig has them. */
  skull: { head: number; top: number | null; front: number | null };
  /** What the chest frame is made from: the spine joints the ribs hang between, the neck, and the two shoulders (upper arms). */
  chest: { low: number; high: number; neck: number | null; armL: number; armR: number };
  /** What the pelvis frame is made from: the hips and the two thighs. */
  pelvis: { hips: number; legL: number; legR: number; above: number };
}

/** An orthonormal frame on the body: `side` is the figure's own left, `forward` out of its front. */
export interface BodyFrame { origin: Point; side: Point; up: Point; forward: Point }
/** The chest's frame, at the middle of the rib cage, with its half sizes (scene units). */
export interface ChestFrame extends BodyFrame { half: Point }

/** Ribs on each side, from the top. The last two float: they stop short of the front. */
export const RIBS = 9;
export const FLOATING_RIBS = 2;

/**
 * The rib cage in its own unit frame (x across to the left, y up, z forward; ±1 at its half sizes): each rib leaves
 * the spine at the back, sweeps out round the side and forward, falling as it goes, towards the breastbone.
 */
export const CAGE = {
  /** Where the spine runs, at the back of the cage. */
  spineZ: -0.78,
  /** The ellipse each rib follows from the back (theta 0) to the front (theta pi): z = centre - depth * cos(theta). */
  centre: 0.08, depth: 0.86,
  /** How far each rib falls from its back to its front, and the height of the first and last at the back. */
  fall: 0.36, top: 0.86, bottom: -0.74,
  /** How far round each rib reaches (radians from the back): a true rib to the breastbone, a floating one part way. */
  reach: 0.9 * Math.PI, floatReach: 0.62 * Math.PI, start: 0.07 * Math.PI,
  /** The breastbone: half its width, the height of its top and its foot, how far forward. */
  sternum: { half: 0.13, top: 0.8, bottom: -0.3, z: 0.93 },
  /** A rib's thickness, in the cage's unit frame. */
  rib: 0.055,
} as const;

/** How wide a rib sweeps out at its widest: the cage is narrow at the top and widest low down. */
export function ribWidth(index: number): number {
  return 0.5 + 0.5 * Math.sin(Math.PI * (index + 1.4) / (RIBS + 1.2));
}
/** The height of rib `index` where it leaves the spine, in the cage's unit frame. */
export function ribHeight(index: number): number {
  return CAGE.top + (CAGE.bottom - CAGE.top) * index / (RIBS - 1);
}
/** How far round rib `index` reaches (radians). */
export function ribReach(index: number): number {
  return index >= RIBS - FLOATING_RIBS ? CAGE.floatReach : CAGE.reach;
}
/** A point on rib `index` of side `side` (1 left, -1 right) at `theta` round from the back, in the cage's unit frame. */
export function ribPoint(index: number, side: 1 | -1, theta: number): Point {
  return { x: side * ribWidth(index) * Math.sin(theta), y: ribHeight(index) - CAGE.fall * theta / Math.PI, z: CAGE.centre - CAGE.depth * Math.cos(theta) };
}

/** Radii of the bones, a share of the figure's height (at their ends; the shafts are under half of it). */
export const GIRTH = { humerus: 0.019, forearm: 0.015, hand: 0.013, femur: 0.026, shin: 0.021, foot: 0.014, clavicle: 0.011, vertebra: 0.02 } as const;

const plain = (name: string) => name.toLowerCase().replace(/^mixamorig:?/, "").replace(/[^a-z0-9]/g, "");
function findJoint(joints: readonly RigJoint[], test: (name: string) => boolean): number | null {
  const index = joints.findIndex(joint => test(plain(joint.name)));
  return index >= 0 ? index : null;
}
const sided = (side: "l" | "r", stem: string) => (name: string) =>
  name === `${side === "l" ? "left" : "right"}${stem}` || name === `${side}${stem}` || name === `${stem}${side === "l" ? "left" : "right"}` || name === `${stem}${side}`;

/** The X-ray's skeleton for a rig, or null when its joints cannot be told apart. */
export function anatomyLayout(joints: readonly RigJoint[]): AnatomyLayout | null {
  const { key, spine } = mapRig(joints);
  const { hips, head, armL, armR, upLegL, upLegR } = key;
  if (hips === undefined || head === undefined || armL === undefined || armR === undefined || upLegL === undefined || upLegR === undefined || spine.length === 0) return null;
  const long: LongBone[] = [], knobs: HingeKnob[] = [];
  const knob = (name: string, before: number | undefined, joint: number | undefined, after: number | undefined, girth: number) => {
    if (before !== undefined && joint !== undefined && after !== undefined) knobs.push({ name, before, joint, after, girth });
  };
  const bone = (name: string, from: number | undefined | null, to: number | undefined | null, girth: number) => {
    if (from === undefined || from === null || to === undefined || to === null || from === to) return;
    long.push({ name, from, to, girth });
  };
  for (const side of ["l", "r"] as const) {
    const S = side === "l" ? "L" : "R";
    const shoulder = findJoint(joints, sided(side, "shoulder")) ?? findJoint(joints, sided(side, "clavicle"));
    bone(`clavicle${S}`, shoulder ?? key.neck ?? null, key[`arm${S}`], GIRTH.clavicle);
    bone(`humerus${S}`, key[`arm${S}`], key[`foreArm${S}`], GIRTH.humerus);
    bone(`forearm${S}`, key[`foreArm${S}`], key[`hand${S}`], GIRTH.forearm);
    const hand = key[`hand${S}`], wrist = key[`foreArm${S}`];
    if (hand !== undefined && wrist !== undefined) long.push({ name: `hand${S}`, from: hand, to: -1, before: wrist, stub: 0.42, girth: GIRTH.hand });
    bone(`femur${S}`, key[`upLeg${S}`], key[`leg${S}`], GIRTH.femur);
    bone(`shin${S}`, key[`leg${S}`], key[`foot${S}`], GIRTH.shin);
    bone(`foot${S}`, key[`foot${S}`], findJoint(joints, sided(side, "toebase")) ?? findJoint(joints, sided(side, "toe")), GIRTH.foot);
    knob(`elbow${S}`, key[`arm${S}`], key[`foreArm${S}`], key[`hand${S}`], GIRTH.humerus);
    knob(`knee${S}`, key[`upLeg${S}`], key[`leg${S}`], key[`foot${S}`], GIRTH.femur);
  }
  const chain = [hips, ...spine.filter(index => index !== hips)];
  if (key.neck !== undefined) chain.push(key.neck);
  chain.push(head);
  const front = findJoint(joints, name => name === "headfront" || name === "headfrontend");
  return {
    long, knobs, spine: chain,
    skull: { head, top: key.headEnd ?? null, front },
    chest: { low: spine[Math.min(1, spine.length - 1)], high: spine[spine.length - 1], neck: key.neck ?? null, armL, armR },
    pelvis: { hips, legL: upLegL, legR: upLegR, above: spine[0] },
  };
}

// ---------------------------------------------------------------- vectors

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Point) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Point, fallback: Point): Point => { const l = length(a); return l > 1e-9 ? scale(a, 1 / l) : { ...fallback }; };
const mix = (a: Point, b: Point, t: number): Point => add(a, scale(sub(b, a), t));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const UP: Point = { x: 0, y: 1, z: 0 };

/** A frame from an up direction and a direction across to the figure's left (made square to up). */
function frameOf(origin: Point, up: Point, across: Point, fallbackSide: Point): BodyFrame {
  const u = unit(up, UP);
  let side = sub(across, scale(u, dot(across, u)));
  side = unit(side, unit(sub(fallbackSide, scale(u, dot(fallbackSide, u))), { x: 1, y: 0, z: 0 }));
  return { origin, side, up: u, forward: cross(side, u) };
}

/** A local point (x across, y up, z forward, each times `half`) of a frame, in the world. */
export function fromFrame(frame: BodyFrame, local: Point, half: Point = { x: 1, y: 1, z: 1 }): Point {
  return add(frame.origin, add(add(scale(frame.side, local.x * half.x), scale(frame.up, local.y * half.y)), scale(frame.forward, local.z * half.z)));
}
/** A world point in a frame's local terms, divided by `half`. */
export function intoFrame(frame: BodyFrame, world: Point, half: Point = { x: 1, y: 1, z: 1 }): Point {
  const d = sub(world, frame.origin);
  return { x: dot(d, frame.side) / half.x, y: dot(d, frame.up) / half.y, z: dot(d, frame.forward) / half.z };
}

/**
 * The chest's frame, at the middle of the rib cage. The cage spans the spine from its lower chest joint to the
 * neck, as wide as the shoulders allow, and stands a little forward of the spine joints (which these rigs put in the
 * middle of the body), so the spine runs down its back.
 */
export function chestFrame(layout: AnatomyLayout, at: readonly Point[], height: number): ChestFrame {
  const low = at[layout.chest.low], neck = layout.chest.neck !== null ? at[layout.chest.neck] : at[layout.chest.high];
  const armL = at[layout.chest.armL], armR = at[layout.chest.armR];
  const frame = frameOf(mix(low, neck, 0.5), sub(neck, low), sub(armL, armR), { x: 1, y: 0, z: 0 });
  const span = length(sub(armL, armR)), tall = length(sub(neck, low));
  const half = {
    x: clamp(span * 0.4, height * 0.06, height * 0.12),
    y: clamp(tall * 0.62, height * 0.07, height * 0.14),
    z: 0,
  };
  half.z = half.x * 0.7;
  // Down a little and forward: the top ribs are under the shoulders, the spine at the back of the cage.
  const origin = add(add(frame.origin, scale(frame.up, -half.y * 0.18)), scale(frame.forward, -CAGE.spineZ * half.z * 0.55));
  return { ...frame, origin, half };
}

/** The pelvis's frame, at the hips: up along the spine, across between the thighs. Its half width is half the span of the hips. */
export function pelvisFrame(layout: AnatomyLayout, at: readonly Point[], height: number): BodyFrame & { width: number } {
  const hips = at[layout.pelvis.hips], above = at[layout.pelvis.above], legL = at[layout.pelvis.legL], legR = at[layout.pelvis.legR];
  const frame = frameOf(hips, sub(above, hips), sub(legL, legR), { x: 1, y: 0, z: 0 });
  return { ...frame, width: clamp(length(sub(legL, legR)) * 0.5, height * 0.05, height * 0.11) };
}

/**
 * The skull's frame, at the head joint (the base of the skull): up to the crown, forward to the face. Its size is
 * the height from the joint to the crown.
 */
export function skullFrame(layout: AnatomyLayout, at: readonly Point[], chest: BodyFrame, height: number): BodyFrame & { size: number } {
  const head = at[layout.skull.head];
  const top = layout.skull.top !== null ? at[layout.skull.top] : add(head, scale(chest.up, height * 0.12));
  const up = unit(sub(top, head), chest.up);
  let forward = layout.skull.front !== null ? sub(at[layout.skull.front], head) : chest.forward;
  forward = sub(forward, scale(up, dot(forward, up)));
  if (length(forward) < 1e-6) forward = chest.forward;
  const side = unit(cross(up, unit(forward, chest.forward)), chest.side);
  return { origin: head, side, up, forward: cross(side, up), size: clamp(length(sub(top, head)), height * 0.07, height * 0.2) };
}

/** Where a long bone runs: its two ends in the world. A stub runs on past its joint along the bone before it. */
export function boneEnds(bone: LongBone, at: readonly Point[]): [Point, Point] {
  const a = at[bone.from];
  if (bone.to >= 0) return [a, at[bone.to]];
  const before = at[bone.before ?? bone.from];
  return [a, add(a, scale(sub(a, before), bone.stub ?? 0.4))];
}

/**
 * The way a hinge's knob points: half way between the bone that comes into the joint and the one that leaves it, so
 * it fills the crease of a bent elbow or knee. Straight, it lies along the limb.
 */
export function halfBend(before: Point, joint: Point, after: Point): Point {
  const into = unit(sub(joint, before), UP), out = unit(sub(after, joint), into);
  return unit(add(into, out), into);
}

// ---------------------------------------------------------------- the fracture

export type BrokenBone =
  | { kind: "rib"; side: 1 | -1; index: number; theta: number }
  | { kind: "sternum" }
  | { kind: "vertebra"; index: number }
  | { kind: "skull" }
  | { kind: "long"; index: number; t: number };

export interface Fracture {
  bone: BrokenBone;
  /** Where it breaks, in the world as the blow lands. */
  at: Point;
  /** How far along the blow's path through the body it is met (scene units from where the blow went in). */
  along: number;
}

/** How far a blow is followed into the body: about a torso's depth and a little more (a share of the figure's height). */
export const BLOW_DEPTH = 0.36;

/** The point on segment a–b nearest a point, as a share along it. */
function nearestOn(a: Point, b: Point, p: Point): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  return l2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
}
/** The shares along two segments at which they come nearest each other. */
function nearestBetween(p0: Point, p1: Point, q0: Point, q1: Point): [number, number] {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  if (a < 1e-12 && e < 1e-12) return [0, 0];
  if (a < 1e-12) return [0, clamp(f / e, 0, 1)];
  const c = dot(d1, r);
  if (e < 1e-12) return [clamp(-c / a, 0, 1), 0];
  const b = dot(d1, d2), denom = a * e - b * b;
  let s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  return [s, t];
}

/** The rib (or the breastbone) under a point of the cage, in its unit frame. */
export function ribAt(local: Point): BrokenBone {
  if (Math.abs(local.x) < CAGE.sternum.half * 1.4 && local.z > 0.55 && local.y < CAGE.sternum.top + 0.1 && local.y > CAGE.sternum.bottom - 0.25) return { kind: "sternum" };
  const side: 1 | -1 = local.x >= 0 ? 1 : -1;
  let best = 0, gap = Infinity, angle = 0;
  for (let index = 0; index < RIBS; index += 1) {
    const theta = clamp(Math.atan2(Math.abs(local.x) / ribWidth(index), (CAGE.centre - local.z) / CAGE.depth), CAGE.start, ribReach(index));
    const off = Math.abs(local.y - ribPoint(index, side, theta).y);
    if (off < gap) { gap = off; best = index; angle = theta; }
  }
  return { kind: "rib", side, index: best, theta: angle };
}

/**
 * The first bone the blow meets on its way through the body, and where. `entry` is where it went in and
 * `direction` the way it travels into the body (unit). Every bone the path passes close enough to counts as met; of
 * those, the first along the path breaks. When it passes close to none, the nearest breaks.
 */
export function chooseFracture(layout: AnatomyLayout, at: readonly Point[], entry: Point, direction: Point, height: number): Fracture {
  const depth = height * BLOW_DEPTH, end = add(entry, scale(direction, depth));
  /** `miss` is how far the path passes outside the bone (0 or less: it is met); `reach` how far along the path it is met, and how near. */
  type Met = { bone: BrokenBone; at: Point; along: number; miss: number; reach?: number };
  const met: Met[] = [];
  const chest = chestFrame(layout, at, height);
  // A blow that goes in above the hips, or not clearly below them, breaks nothing in the legs.
  const aboveHips = dot(sub(entry, at[layout.pelvis.hips]), chest.up) > -height * 0.05;
  // The long bones of the limbs and the clavicles.
  layout.long.forEach((bone, index) => {
    if (aboveHips && /^(femur|shin|foot)/.test(bone.name)) return;
    const [a, b] = boneEnds(bone, at);
    const [s, t] = nearestBetween(entry, end, a, b);
    const onPath = add(entry, scale(direction, s * depth)), onBone = mix(a, b, t);
    met.push({ bone: { kind: "long", index, t }, at: onBone, along: s * depth, miss: length(sub(onPath, onBone)) - bone.girth * height * 1.6 });
  });
  // The skull.
  const skull = skullFrame(layout, at, chest, height);
  const crown = fromFrame(skull, { x: 0, y: 0.55, z: 0.05 }, { x: skull.size, y: skull.size, z: skull.size });
  {
    const s = nearestOn(entry, end, crown), onPath = add(entry, scale(direction, s * depth));
    const toward = sub(onPath, crown), surface = add(crown, scale(unit(toward, scale(direction, -1)), skull.size * 0.5));
    met.push({ bone: { kind: "skull" }, at: surface, along: s * depth, miss: length(toward) - skull.size * 0.55 });
  }
  // The vertebrae, at the joints of the spine, drawn at the back of the body.
  layout.spine.forEach((joint, index) => {
    const p = add(at[joint], scale(chest.forward, CAGE.spineZ * chest.half.z * 0.75));
    const s = nearestOn(entry, end, p), onPath = add(entry, scale(direction, s * depth));
    met.push({ bone: { kind: "vertebra", index }, at: p, along: s * depth, miss: length(sub(onPath, p)) - GIRTH.vertebra * height * 1.4 });
  });
  // The rib cage, a barrel as tall as its ribs fall: where the path first comes into it, or close by it (the
  // lowest ribs stand over a wound in the belly).
  const top = CAGE.top + 0.12, bottom = CAGE.bottom - CAGE.fall - 0.05, margin = height * 0.05;
  for (let step = 0; step <= 80; step += 1) {
    const s = step / 80, p = add(entry, scale(direction, s * depth)), local = intoFrame(chest, p, chest.half);
    const round = Math.sqrt(local.x * local.x + ((local.z - CAGE.centre) / CAGE.depth) ** 2);
    const outside = Math.hypot(Math.max(0, local.y - top, bottom - local.y) * chest.half.y, Math.max(0, round - 1.01) * chest.half.x);
    if (outside > margin) continue;
    const inside = { x: local.x / Math.max(1, round), y: clamp(local.y, bottom, top), z: CAGE.centre + (local.z - CAGE.centre) / Math.max(1, round) };
    const bone = ribAt(inside);
    const point = bone.kind === "rib" ? fromFrame(chest, ribPoint(bone.index, bone.side, bone.theta), chest.half)
      : fromFrame(chest, { x: clamp(inside.x, -CAGE.sternum.half, CAGE.sternum.half), y: clamp(inside.y, CAGE.sternum.bottom, CAGE.sternum.top), z: CAGE.sternum.z }, chest.half);
    // Met close by counts as met further on: a bone the path really goes into, first, breaks before it.
    met.push({ bone, at: point, along: s * depth, miss: outside - margin, reach: s * depth + outside });
    break;
  }
  const hits = met.filter(item => item.miss <= 0).sort((a, b) => (a.reach ?? a.along) - (b.reach ?? b.along));
  const chosen = hits[0] ?? met.sort((a, b) => a.miss - b.miss)[0];
  return { bone: chosen.bone, at: chosen.at, along: chosen.along };
}

/** How long the wound channel runs through the body from where the blow went in: twice the way to the chest's middle, within reason. */
export function channelLength(entry: Point, direction: Point, chestCentre: Point, height: number): number {
  return clamp(2 * dot(sub(chestCentre, entry), direction), height * 0.16, height * 0.5);
}

// ---------------------------------------------------------------- the fragments

export interface Fragment {
  /** Where it starts, from the break (scene units). */
  offset: Point;
  /** How fast it leaves (scene units a second), and where it drifts to and settles (from the break). */
  velocity: Point;
  rest: Point;
  /** How fast it tumbles as it leaves (radians a second about each axis): it slows with the spring. */
  spin: Point;
  /** Its size (scene units): a splinter is long and thin, a chip about as wide as it is long. */
  size: number;
  splinter: boolean;
}

/** Fragments of a broken bone. */
export const FRAGMENTS = 22;
/**
 * How the fragments move: how fast they leave and how far they drift (shares of the figure's height, a second and in
 * all), the share thrown back out of the wound, the cone round the blow (radians), the spring that carries each out
 * (its damping ratio, under 1 so it eases past and settles, and its rate in radians a scene second), and how much
 * they sink as they go (a share of the height a scene second squared).
 */
export const SCATTER = { slowest: 0.32, fastest: 1.05, near: 0.07, far: 0.26, back: 0.28, cone: 1.4, damping: 0.55, rate: 8.5, sink: 0.12 } as const;

/**
 * What breaks away from the bone: most of it on along the blow, a share of it back out of the wound, all of it in a
 * cone round the line of the blow; splinters and chips. Seeded: the same seed breaks the same way.
 */
export function fragmentsOf(direction: Point, height: number, seed: number, count = FRAGMENTS): Fragment[] {
  const along = unit(direction, { x: 0, y: 0, z: -1 });
  const across = unit(Math.abs(along.y) > 0.9 ? cross(along, { x: 1, y: 0, z: 0 }) : cross(along, UP), { x: 1, y: 0, z: 0 });
  const over = cross(along, across);
  const out: Fragment[] = [];
  for (let index = 0; index < count; index += 1) {
    const h = (k: number) => hash01(seed, index, k);
    const back = h(0) < SCATTER.back;
    const axis = back ? scale(along, -1) : along;
    // Out round the break more than along the blow: a weapon that runs on through hides what flies along its line.
    const tilt = SCATTER.cone * (0.3 + 0.7 * Math.sqrt(h(1))), turn = h(2) * Math.PI * 2;
    const heading = unit(add(scale(axis, Math.cos(tilt)), scale(add(scale(across, Math.cos(turn)), scale(over, Math.sin(turn))), Math.sin(tilt))), axis);
    const speed = height * (SCATTER.slowest + (SCATTER.fastest - SCATTER.slowest) * h(3)) * (back ? 0.7 : 1);
    const drift = height * (SCATTER.near + (SCATTER.far - SCATTER.near) * h(3)) * (back ? 0.6 : 1);
    const splinter = h(4) < 0.32;
    out.push({
      offset: scale(heading, height * 0.008 * h(5)),
      velocity: scale(heading, speed),
      rest: scale(heading, drift),
      spin: { x: (h(6) - 0.5) * 18, y: (h(7) - 0.5) * 18, z: (h(8) - 0.5) * 18 },
      size: height * (splinter ? 0.03 + 0.035 * h(9) : 0.01 + 0.016 * h(9)),
      splinter,
    });
  }
  return out;
}

/**
 * Where a fragment is `t` scene seconds after the break: carried out from the break on a damped spring toward where it
 * drifts (thrown at its own speed, easing a little past and settling back), sinking slowly as it goes. Closed form
 * (x'' = -2 z w x' - w^2 (x - rest)), so it moves the same at any frame rate.
 */
export function fragmentAt(fragment: Fragment, start: Point, t: number, height: number): Point {
  const z = SCATTER.damping, w = SCATTER.rate, wd = w * Math.sqrt(1 - z * z);
  const time = Math.max(0, t), decay = Math.exp(-z * w * time), c = Math.cos(wd * time), s = Math.sin(wd * time);
  const along = (rest: number, speed: number) => rest + decay * (-rest * c + ((speed - z * w * rest) / wd) * s);
  return {
    x: start.x + fragment.offset.x + along(fragment.rest.x, fragment.velocity.x),
    y: start.y + fragment.offset.y + along(fragment.rest.y, fragment.velocity.y) - SCATTER.sink * height * time * time,
    z: start.z + fragment.offset.z + along(fragment.rest.z, fragment.velocity.z),
  };
}

/** How far a fragment has tumbled `t` scene seconds after the break (radians about each axis): fast at first, slowing with the spring. */
export function fragmentTurn(fragment: Fragment, t: number): Point {
  const k = SCATTER.damping * SCATTER.rate, wound = (1 - Math.exp(-k * Math.max(0, t))) / k;
  return { x: fragment.spin.x * wound, y: fragment.spin.y * wound, z: fragment.spin.z * wound };
}

// ---------------------------------------------------------------- the timeline

/**
 * The X-ray, real seconds after the blow (the player's clock; the slow motion holds the body nearly still under it):
 * the skin goes ghostly and the bones come up bright; the wound channel opens along the blow; the bone at the wound
 * cracks, then shatters, and its fragments drift apart in the slow motion; the skin comes back. About a second.
 */
export const XRAY = {
  /** The skin turns to a ghost and the bones come up, from the first of these to the second. */
  in: [0.02, 0.2],
  /** The flash of the change: the ghost starts milky and clears. */
  milk: 0.22,
  /** The channel opens along the blow. */
  channel: [0.0, 0.32],
  /** The crack runs across the bone, then it shatters. */
  crack: [0.08, 0.36],
  shatter: 0.36,
  /** The skin comes back, from the first of these to the second. */
  out: [0.98, 1.22],
} as const;

export interface XrayState {
  /** How ghostly the skin is (0: the skin itself, 1: the full ghost), and how milky the ghost still is. */
  ghost: number;
  milk: number;
  /** How bright the bones are, 0 to 1. */
  bones: number;
  /** How far the crack has run (0 to 1), whether the bone has shattered, and how far the channel has opened. */
  crack: number;
  shattered: boolean;
  channel: number;
  /** False once the skin is back: nothing of the X-ray is drawn. */
  shown: boolean;
}

const ramp = (t: number, a: number, b: number) => clamp((t - a) / Math.max(1e-6, b - a), 0, 1);
const ease = (t: number) => t * t * (3 - 2 * t);

/** The X-ray `seconds` after the blow. */
export function xrayAt(seconds: number): XrayState {
  const rise = ease(ramp(seconds, XRAY.in[0], XRAY.in[1])), fall = 1 - ease(ramp(seconds, XRAY.out[0], XRAY.out[1]));
  const level = Math.min(rise, fall);
  const shown = seconds >= XRAY.in[0] && seconds < XRAY.out[1];
  return {
    ghost: shown ? level : 0,
    milk: shown ? Math.max(0, 1 - ramp(seconds, XRAY.in[0], XRAY.in[0] + XRAY.milk)) * 0.9 + (1 - fall) * 0.6 : 0,
    bones: shown ? level : 0,
    crack: ease(ramp(seconds, XRAY.crack[0], XRAY.crack[1])),
    shattered: seconds >= XRAY.shatter,
    channel: ease(ramp(seconds, XRAY.channel[0], XRAY.channel[1])),
    shown,
  };
}

/** Real seconds the X-ray lasts. */
export const XRAY_SECONDS: number = XRAY.out[1];
