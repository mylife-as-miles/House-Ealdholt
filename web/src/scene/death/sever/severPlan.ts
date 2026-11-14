// Adapted from Lim-Young/SkeletalMeshDestruction (MIT). Copyright (c) 2025 Lim Young. See public/licenses/SkeletalMeshDestruction-MIT.txt.
/**
 * Dismemberment: which killing blows take a limb off, which limb, how it is cut from the skin and thrown, how long it
 * flies through everything before it collides, and how the stump bleeds.
 *
 * The technique is SkeletalMeshDestruction's. The mesh is never split where it is drawn: the limb's bones are hidden
 * on the figure (collapsed to the joint, as the plugin hides a bone), and a piece cut from the posed skin is thrown
 * from the same place with a linear and an angular impulse. For a time inversely proportional to how fast it was
 * thrown, and never less than one physics step, the piece collides with nothing at all (not the body it came off,
 * not any other piece): its "physical avoidance phase", so its first flight is clean. Then it collides like any other
 * piece, lands, settles and sleeps. (The plugin swaps in a collision profile that ignores everything; here the body
 * is put in a physics layer that meets nothing, death/physics/PhysicsWorld.ts, and moved to the ordinary one.)
 *
 * The rule (docs/play/GORE_SYSTEM.md, "Dismemberment"):
 *  - a limb comes off only where the gore tiers allow it (gore/goreTiers.ts `goreShow(...).sever`: tier 2 or 3, at
 *    Full; never at Cinematic or Minimal, under reduced motion, on the map or the menu's board), the physics deaths
 *    are there, and the blow cuts: a blade's slash or an axe's cleave in a duel, a summon's tearing. A thrust, a
 *    crushing blow, a shot, a spell that runs the piece through and a burning never take one;
 *  - a duel's killing blow takes one limb; a summon's tearings take one each, from its killing blow on, until the
 *    tier's budget for the preset is spent (`budget.severs`: 1, 2 on Ultra, up to 3 in a fatality);
 *  - the limb taken is the head, upper arm, forearm, leg or lower leg whose bone runs nearest the wound's point.
 *
 * Everything is seeded from the kill, so a replay or an Undo and the same capture severs the same way.
 *
 * Pure: plain arrays in and out, no three.js and no Jolt (shared/play/sever-plan.test.ts).
 */
import type { ArsenalId } from "../../../assets/generated";
import type { PieceKind } from "../../../core/types";
import { GORE_GRAVITY, flightVelocity } from "../../gore/ballistics";
import { expandSpray } from "../../gore/GoreDirector";
import type { GoreIntensity, GoreKind, GoreKingdom, GoreWeapon, SprayPlan, StainPlan, SurfaceMaterial, Vec3, WoundPlan } from "../../gore/GoreTypes";
import { regionsOf, type CutRegion } from "../../gore/ImpactResolver";
import type { GoreShow, GoreTier } from "../../gore/goreTiers";
import { STUMP_WOUND, planStumpMask } from "../../gore/woundMaskPlan";
import type { QualityPreset } from "../../quality";
import { PHYSICS_STEP } from "../physics/fixedStep";
import { add, clamp, cross, dot, hash01, length, perpendicular, qRotate, scale, sub, unit, type Q4, type V3 } from "../physics/math";
import { mapRig, type PartName, type RigJoint, type RigPose } from "../ragdoll/ragdollPlan";

/** What can come off: the head, an upper arm (at the shoulder), a forearm (at the elbow), a leg (at the hip), a lower leg (at the knee). */
export type SeverLimb = "head" | "armL" | "armR" | "foreArmL" | "foreArmR" | "legL" | "legR" | "shinL" | "shinR";
export const SEVER_LIMBS: readonly SeverLimb[] = ["head", "armL", "armR", "foreArmL", "foreArmR", "legL", "legR", "shinL", "shinR"];

/** How a blow cuts. */
export type SeverCut = "slash" | "cleave" | "tear" | "thrust" | "crush" | "pierce" | "burn" | "shot";
/** The cuts that take a limb off: a blade's slash, an axe's cleave, a summon's tearing. */
export const SEVERING_CUTS: readonly SeverCut[] = ["slash", "cleave", "tear"];

/** How each weapon the gore system knows cuts. */
export const WEAPON_CUT: Readonly<Record<GoreWeapon, SeverCut>> = {
  sword: "slash", axe: "cleave", spear: "thrust", lance: "thrust", mace: "crush", staff: "crush", fist: "crush", musket: "shot",
};

/**
 * What each figure strikes with, as the gore system names weapons: its main hand in scene/weapons.ts (LOADOUT). The
 * Knights' longsword and sabre and the Kings' blades slash, Solforiz's Dune Reaver swings a hooked cleaver, the Rooks
 * hammers and mauls, the Pawns spears, a pike and a bayonet. Kwind-09's courier kicks. Casters hold a staff (a wand, a
 * lantern, a censer): they kill by spell or summon, never by it.
 */
const ARMED: Readonly<Record<ArsenalId, Readonly<Record<PieceKind, GoreWeapon>>>> = {
  kingdom: { k: "sword", q: "staff", b: "staff", n: "sword", r: "mace", p: "spear" },
  sun: { k: "sword", q: "staff", b: "staff", n: "axe", r: "mace", p: "spear" },
  empire: { k: "musket", q: "staff", b: "staff", n: "sword", r: "musket", p: "spear" },
  kwind: { k: "staff", q: "staff", b: "staff", n: "fist", r: "mace", p: "spear" },
};

/** The weapon a figure of this army and rank kills with in a duel. */
export function weaponOf(arsenal: ArsenalId, kind: PieceKind): GoreWeapon {
  return ARMED[arsenal]?.[kind] ?? "fist";
}

// ---------------------------------------------------------------- the rule

/** One kill, as far as dismemberment cares. */
export interface SeverKill {
  /** The gore tiers' answer for this kill (gore/goreTiers.ts goreShow): a limb comes off only where it says `sever`. */
  show: Pick<GoreShow, "sever" | "tier"> & { budget: { severs: number } };
  /** The physics deaths are loaded and allowed (death/physics): a limb that comes off is a body in that world. */
  physics: boolean;
  /** How its blows cut: the duel's weapon (WEAPON_CUT), `tear` for a summon that tears, `burn` or `pierce` for one that does not. */
  cut: SeverCut;
  /** One killing blow (a duel, directed or not), or a summon's wounds. */
  by: "duel" | "summon";
  seed: number;
}

/** What one kill may take, decided once when it begins. */
export interface SeverRule {
  /** Limbs that may come off in this kill: 0 for none. */
  limbs: number;
  by: "duel" | "summon";
  seed: number;
  /** The kill's gore tier: its stumps' wound masks are painted at that tier's size (2 when not known). */
  tier?: GoreTier;
}

/**
 * Decided once per kill. Nothing comes off unless the tiers allow it, the physics deaths are there and the blow cuts;
 * then a duel's one killing blow takes one limb and a summon's tearings take up to the tier's budget.
 */
export function planSevers(kill: SeverKill): SeverRule {
  const allowed = kill.show.sever && kill.physics && SEVERING_CUTS.includes(kill.cut) ? Math.max(0, Math.floor(kill.show.budget.severs)) : 0;
  return { limbs: kill.by === "duel" ? Math.min(1, allowed) : allowed, by: kill.by, seed: kill.seed >>> 0, tier: kill.show.tier };
}

/** A summon's wound past this power tears (rites/rite.ts RiteWound: about 0.3 a nick, 1 a killing blow, more a tearing). */
export const TEARING = 1;

/**
 * Whether this wound takes a limb: the kill's limbs are not all taken yet, the wound lands on or after the killing
 * blow (`struck`), and it is a duel's killing blow or a summon's tearing. A summon's talons or a bite (a wound of power
 * 1 or less) only wound.
 */
export function woundSevers(rule: SeverRule, wound: { struck: boolean; power: number }, taken: number): boolean {
  if (taken >= rule.limbs || !wound.struck) return false;
  return rule.by === "duel" || wound.power > TEARING;
}

// ---------------------------------------------------------------- the stump's wound

/** What decides how a stump's wound looks: the kill's gore, and its seed. */
export interface StumpLook {
  intensity: GoreIntensity;
  quality: QualityPreset;
  tier: GoreTier;
  reducedMotion: boolean;
  seed: number;
}

/**
 * The heavy wound a stump paints into its figure's own wound mask (gore/WoundMasks.ts, after zulubo/SkinGore): torn,
 * wet and opened round `stump.point`, broad and ragged as a burst (gore/woundMaskPlan.ts planStumpMask), facing out
 * of the cut along `stump.axis`, bleeding down the body. Null where nothing is painted (limbs come off at tier 2 and
 * up at Full only). The cap is drawn by the cut itself (SeverSystem's `flesh`); the mask stains and tears the
 * skin round it, and its gates keep it to both sides of the cut. Pure: shared/play/stump-wound.test.ts.
 */
export function stumpWoundPlan(stump: { point: Vec3; axis: Vec3; radius: number }, look: StumpLook): WoundPlan | null {
  const bleed = look.reducedMotion ? 0 : STUMP_WOUND.bleed;
  const mask = planStumpMask({ radius: stump.radius, intensity: look.intensity, quality: look.quality, tier: look.tier, bleed, seed: look.seed });
  if (!mask) return null;
  return {
    kind: "burst", anchor: "torso", point: { x: stump.point.x, y: stump.point.y, z: stump.point.z }, offset: { x: 0, y: 0, z: 0 },
    normal: { x: stump.axis.x, y: stump.axis.y, z: stump.axis.z }, size: stump.radius * STUMP_WOUND.size, shape: 0, bleed, bind: "skin", mask,
  };
}

// ---------------------------------------------------------------- which limb

export interface LimbBone {
  limb: SeverLimb;
  /** The joint the limb is cut off at: it and every joint under it go with the limb. */
  joint: number;
  /** The joint its bone runs to (the next one down the limb), or -1: the bone is drawn on past the joint instead. */
  end: number;
  /** The joint it hangs from: the stump. */
  parent: number;
}

/** The limbs of a skeleton that can come off, by the names ragdollPlan.ts reads (`mapRig`). Empty for a rig with none. */
export function severableLimbs(joints: readonly RigJoint[]): LimbBone[] {
  const { key } = mapRig(joints);
  const limbs: LimbBone[] = [];
  const add = (limb: SeverLimb, joint: number | undefined, end: number | undefined) => {
    if (joint === undefined || joints[joint].parent < 0) return;
    limbs.push({ limb, joint, end: end ?? -1, parent: joints[joint].parent });
  };
  add("head", key.head, key.headEnd);
  for (const side of ["L", "R"] as const) {
    add(`arm${side}`, key[`arm${side}`], key[`foreArm${side}`]);
    add(`foreArm${side}`, key[`foreArm${side}`], key[`hand${side}`]);
    add(`leg${side}`, key[`upLeg${side}`], key[`leg${side}`]);
    add(`shin${side}`, key[`leg${side}`], key[`foot${side}`]);
  }
  return limbs;
}

/** Where a limb's bone runs now: from its joint to the next one down, or as far again past the joint as the bone above it. */
export function limbSegment(bone: LimbBone, pose: RigPose): [V3, V3] {
  const from = pose.positions[bone.joint];
  if (bone.end >= 0) return [from, pose.positions[bone.end]];
  const above = sub(from, pose.positions[bone.parent]);
  return [from, add(from, scale(unit(above), Math.max(length(above), 1e-3)))];
}

/** Distance from a point to a segment. */
export function segmentDistance(point: V3, a: V3, b: V3): number {
  const ab = sub(b, a), span = dot(ab, ab);
  const t = span > 1e-12 ? clamp(dot(sub(point, a), ab) / span, 0, 1) : 0;
  return length(sub(point, add(a, scale(ab, t))));
}

/** True when one joint is the other or above it: two limbs that share bones cannot both come off. */
function overlaps(joints: readonly RigJoint[], a: number, b: number): boolean {
  for (let at = a; at >= 0; at = joints[at].parent) if (at === b) return true;
  for (let at = b; at >= 0; at = joints[at].parent) if (at === a) return true;
  return false;
}

/**
 * The limb whose bone runs nearest `point` (a world point, the wound), among those that can still come off: not one
 * already taken, nor one that shares bones with it (an arm taken at the elbow keeps its upper arm, which then stays).
 * The first of equals wins. Null when nothing is left.
 */
export function nearestLimb(point: V3, pose: RigPose, joints: readonly RigJoint[], limbs: readonly LimbBone[], taken: readonly SeverLimb[] = []): LimbBone | null {
  const gone = limbs.filter(bone => taken.includes(bone.limb));
  let best: LimbBone | null = null, nearest = Infinity;
  for (const bone of limbs) {
    if (gone.some(other => overlaps(joints, bone.joint, other.joint))) continue;
    const [a, b] = limbSegment(bone, pose), distance = segmentDistance(point, a, b);
    if (distance < nearest - 1e-12) { nearest = distance; best = bone; }
  }
  return best;
}

/** Every joint that goes with a limb: its own and all under it. */
export function limbJoints(joints: readonly RigJoint[], bone: LimbBone): number[] {
  return joints.flatMap((_, index) => { for (let at = index; at >= 0; at = joints[at].parent) if (at === bone.joint) return [index]; return []; });
}

/** The ragdoll bodies (ragdollPlan.ts) that go with a limb: the ragdoll keeps none for a hidden bone. */
export function ragdollParts(limb: SeverLimb): PartName[] {
  if (limb === "head") return ["head"];
  const side = limb.slice(-1) as "L" | "R";
  if (limb.startsWith("arm")) return [`arm${side}`, `foreArm${side}`];
  if (limb.startsWith("foreArm")) return [`foreArm${side}`];
  if (limb.startsWith("leg")) return [`thigh${side}`, `shin${side}`];
  return [`shin${side}`];
}

// ---------------------------------------------------------------- the throw

/** How a severing blow of power 1 throws the limb. Scene units and radians a second. */
export const SEVER_THROW = {
  /** Along the blow: a square or so before it lands, near the body the Claiming takes with it. */
  speed: [1.0, 1.5] as const,
  /** Up: it arcs, it does not skid. */
  lift: [1.1, 1.6] as const,
  /** A head is thrown higher than an arm or a leg: it is the one everybody watches. */
  head: 1.25,
  /** Radians either side of the blow's line, seeded. */
  scatter: 0.55,
  /** Tumble, end over end about the line across the blow, with a little roll. */
  spin: 12,
  /** Nothing is thrown faster: about two squares at most, as a burst's pieces. */
  cap: 2.4,
} as const;

/**
 * The linear and angular velocity a severed limb leaves with: along the blow's line on the board, scattered either
 * side by the seed, thrown up, and tumbling. The `index`-th limb of a kill takes its own scatter.
 */
export function limbLaunch(direction: V3, power: number, seed: number, index: number, limb: SeverLimb): { velocity: V3; spin: V3 } {
  const turn = hash01(seed, index, 20) * Math.PI * 2;
  const flat = unit([direction[0], 0, direction[2]], [Math.cos(turn), 0, Math.sin(turn)]);
  const jitter = (hash01(seed, index, 21) - 0.5) * 2 * SEVER_THROW.scatter, cos = Math.cos(jitter), sin = Math.sin(jitter);
  const heading: V3 = [flat[0] * cos - flat[2] * sin, 0, flat[0] * sin + flat[2] * cos];
  const force = Math.sqrt(clamp(Number.isFinite(power) ? power : 1, 0.6, 1.8));
  const speed = (SEVER_THROW.speed[0] + (SEVER_THROW.speed[1] - SEVER_THROW.speed[0]) * hash01(seed, index, 22)) * force;
  const lift = (SEVER_THROW.lift[0] + (SEVER_THROW.lift[1] - SEVER_THROW.lift[0]) * hash01(seed, index, 23)) * force * (limb === "head" ? SEVER_THROW.head : 1);
  let velocity = add(scale(heading, speed), [0, lift, 0]);
  if (length(velocity) > SEVER_THROW.cap) velocity = scale(velocity, SEVER_THROW.cap / length(velocity));
  const across = cross([0, 1, 0], heading), over = hash01(seed, index, 24) < 0.5 ? -1 : 1;
  const tumble = (0.6 + 0.4 * hash01(seed, index, 25)) * SEVER_THROW.spin * over;
  const spin = add(add(scale(across, tumble), scale(heading, (hash01(seed, index, 26) - 0.5) * SEVER_THROW.spin * 0.5)), [0, (hash01(seed, index, 27) - 0.5) * SEVER_THROW.spin * 0.5, 0]);
  return { velocity, spin };
}

/** The velocity of a point `at` of a body moving at `velocity` about `from` and turning at `spin`: what a held weapon leaves with. */
export function carriedVelocity(velocity: V3, spin: V3, from: V3, at: V3): V3 {
  return add(velocity, cross(spin, sub(at, from)));
}

/** The avoidance phase's bounds: how far a limb must fly to be clear of the body (scene units), and the longest it may last. */
export const AVOID = { clear: 0.3, max: 0.4 } as const;

/**
 * How long a limb thrown at `speed` (scene units a second) collides with nothing: inversely proportional to the speed,
 * the time it takes to fly `AVOID.clear` from where it was cut, and never less than one physics step (a limb that
 * barely moves still gets a frame) nor more than `AVOID.max`.
 */
export function avoidSeconds(speed: number): number {
  const fast = Number.isFinite(speed) ? Math.abs(speed) : 0;
  return clamp(AVOID.clear / Math.max(1e-6, fast), PHYSICS_STEP, AVOID.max);
}

/** The height of a box's lowest corner: the avoidance phase ends before a limb could pass into the stone. */
export function boxBottom(centre: V3, rotation: Q4, half: V3): number {
  let reach = 0;
  for (let k = 0; k < 3; k += 1) {
    const axis: V3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
    reach += Math.abs(qRotate(rotation, axis)[1]) * half[k];
  }
  return centre[1] - reach;
}

// ---------------------------------------------------------------- the stump

/** A beat of the stump's bleeding: seconds after the cut, and how hard the heart still pushes (1 the first). */
export interface SpurtPulse { at: number; strength: number }

/** Beats of the stump: about two seconds of a heart slowing as the body empties. */
export const SPURT = { beats: 6, first: 0.04, gap: 0.3, slowing: 0.045, jitter: 0.03, fade: 0.8, share: 0.5 } as const;

/** The stump's beats, seeded: each a little later than the last, and weaker. */
export function spurtPulses(seed: number, beats: number = SPURT.beats): SpurtPulse[] {
  const pulses: SpurtPulse[] = [];
  let at = SPURT.first;
  for (let i = 0; i < beats; i += 1) {
    pulses.push({ at: +at.toFixed(4), strength: +Math.pow(SPURT.fade, i).toFixed(4) });
    at += SPURT.gap + SPURT.slowing * i + (hash01(seed, i, 30) - 0.5) * 2 * SPURT.jitter;
  }
  return pulses;
}

/** What a spurt is made from: the size of the gore system's own first spray for a wound there (GoreDirector planGore). */
export interface SprayTemplate { droplets: number; mist: number; speed: readonly [number, number]; size: readonly [number, number] }

/**
 * One beat of the stump as a spray for the gore system (GoreSystem.spray): out along the bone's axis from where the
 * limb was, in a narrow cone, fewer and slower droplets with every beat. Null for a beat too weak to throw two.
 */
export function spurtSpray(template: SprayTemplate, pulse: SpurtPulse, index: number, origin: Vec3, axis: Vec3, seed: number): SprayPlan | null {
  const droplets = Math.round(template.droplets * SPURT.share * pulse.strength);
  if (droplets < 2) return null;
  const a = unit([axis.x, axis.y, axis.z], [0, 1, 0]);
  return {
    id: "spurt", seed: (seed ^ Math.imul(index + 1, 0x2c1b3c6d)) >>> 0, delay: 0, origin: { x: origin.x, y: origin.y, z: origin.z },
    axis: { x: a[0], y: a[1], z: a[2] }, spread: 0.2 + 0.12 * (1 - pulse.strength), droplets, mist: index === 0 ? template.mist : 0,
    speed: [template.speed[0] * (0.5 + 0.5 * pulse.strength), template.speed[1] * (0.55 + 0.45 * pulse.strength)], size: template.size,
  };
}

/**
 * Where a spray's heaviest droplets come down (at most `max`, kept a little apart, inside the board): the stains it
 * leaves, each at the moment its droplet lands. As GoreDirector plans a wound's stains, from the same closed-form flight.
 */
export function spurtStains(spray: SprayPlan, top: number, tile: number, max: number, squares = 8): StainPlan[] {
  const half = squares * tile / 2, kept: { stain: StainPlan; size: number }[] = [], landed: Vec3 = { x: 0, y: 0, z: 0 };
  if (max <= 0) return [];
  expandSpray(spray, top, droplet => {
    if (!droplet.lands) return;
    const radius = clamp(droplet.size * 7, 0.05 * tile, 0.16 * tile) * (0.85 + 0.3 * droplet.shape);
    if (Math.abs(droplet.landX) > half - radius || Math.abs(droplet.landZ) > half - radius) return;
    if (kept.some(other => Math.hypot(other.stain.x - droplet.landX, other.stain.z - droplet.landZ) < 0.14 * tile)) return;
    if (kept.length >= max && droplet.size <= kept[kept.length - 1].size) return;
    flightVelocity(droplet, droplet.life, landed, GORE_GRAVITY);
    const run = Math.hypot(landed.x, landed.z);
    const stain: StainPlan = {
      at: droplet.delay + droplet.life, x: droplet.landX, z: droplet.landZ, radius,
      rotation: run > 1e-6 ? Math.atan2(-landed.z, landed.x) : Math.PI * 2 * droplet.shape,
      stretch: 1 + Math.min(1.4, run * 0.45), shape: droplet.shape, source: "spray",
    };
    let slot = kept.length;
    while (slot > 0 && kept[slot - 1].size < droplet.size) slot -= 1;
    kept.splice(slot, 0, { stain, size: droplet.size });
    if (kept.length > max) kept.pop();
  });
  return kept.map(item => item.stain).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- the cut

/** A skinned mesh to cut, read by the caller (the scene skins only the vertices asked for). */
export interface SeverSkinSource {
  /** Vertices in the mesh. */
  count: number;
  /** Triangles, three vertex indices each; null for a mesh drawn without an index. */
  index: ArrayLike<number> | null;
  /** 1 for a vertex the limb's bones move most (it goes with the limb), 0 for one the body keeps. */
  owner: ArrayLike<number>;
  /** Writes the vertex as posed now, in the world: its position into `out[0..2]` and its normal into `out[3..5]`. */
  pose(vertex: number, out: number[]): void;
  /** Writes the vertex's texture coordinates into `out[0..1]`; null for a mesh with none. */
  uv: ((vertex: number, out: number[]) => void) | null;
}

/** The limb cut from a mesh: posed in the world, its open ends closed, ready to be drawn and thrown. */
export interface SeverPiece {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array;
  /** The first `skin` indices are the figure's own surface; the remaining `cap` close the cut. */
  skin: number; cap: number;
  /** Three a vertex, for the flesh drawn on a cut (SeverSystem.ts): how far out from the cut's middle (0 there, 1 at its rim), and the cosine and sine of its bearing round it. 0 on the skin. */
  cut: Float32Array;
}

/** The body's side of the cut: the edges of the body's own triangles along it, and the loop (one round of the cut) each lies on. */
export interface SeverStump {
  /** Pairs of the mesh's own vertex indices, in the winding of the body's triangle they belong to. */
  edges: Int32Array;
  /** The loop each edge lies on. */
  loops: Int32Array;
  /** How many loops. */
  count: number;
}

/** Vertices closer than this are one point when a cut is matched across a texture seam. Scene units. */
const WELD = 2e-4;

/**
 * Cuts a posed skin along a limb: the triangles the limb's bones own (as gibPlan.ts splitSkin decides a triangle's
 * piece: by the piece most of its corners belong to) become the limb, every cut it has against the body closed by a
 * fan from the cut's middle, and the body's side of every cut is returned as edges of its own vertices, from which the
 * stump is closed on the figure. Only the triangles that touch the limb are read: the cost is the limb's, not the
 * figure's.
 */
export function severSkin(source: SeverSkinSource): { limb: SeverPiece | null; stump: SeverStump | null } {
  const { owner, index } = source;
  const triangles = Math.floor((index ? index.length : source.count) / 3);
  const corner = (t: number, k: number) => index ? index[t * 3 + k] : t * 3 + k;
  const sideOf = (t: number): number => majority(owner[corner(t, 0)], owner[corner(t, 1)], owner[corner(t, 2)]);
  // Every triangle with a corner on the limb: the limb itself and the ring of the body round it. Every edge of a limb
  // triangle has a corner the limb owns, so every cut lies among these.
  const near: number[] = [];
  for (let t = 0; t < triangles; t += 1) if (owner[corner(t, 0)] === 1 || owner[corner(t, 1)] === 1 || owner[corner(t, 2)] === 1) near.push(t);
  if (!near.length) return { limb: null, stump: null };
  // The posed vertices those triangles use, each skinned once, and welded by position across seams.
  const slot = new Map<number, number>(), posed: number[] = [], scratch = [0, 0, 0, 0, 0, 0];
  const at = (v: number): number => {
    let found = slot.get(v);
    if (found === undefined) { found = posed.length / 6; slot.set(v, found); source.pose(v, scratch); posed.push(...scratch); }
    return found;
  };
  const weld = new Map<string, number>(), welded = new Map<number, number>();
  const weldOf = (v: number): number => {
    let id = welded.get(v);
    if (id !== undefined) return id;
    const s = at(v) * 6, key = `${Math.round(posed[s] / WELD)},${Math.round(posed[s + 1] / WELD)},${Math.round(posed[s + 2] / WELD)}`;
    id = weld.get(key);
    if (id === undefined) { id = weld.size; weld.set(key, id); }
    welded.set(v, id);
    return id;
  };
  for (const t of near) for (let k = 0; k < 3; k += 1) weldOf(corner(t, k));
  const points = weld.size, edgeKey = (a: number, b: number) => a < b ? a * points + b : b * points + a;
  /** Each welded edge: bit 1 when a limb triangle has it, bit 2 when a body triangle does. */
  const edges = new Map<number, number>();
  for (const t of near) {
    const side = sideOf(t) === 1 ? 1 : 2;
    for (let k = 0; k < 3; k += 1) { const id = edgeKey(weldOf(corner(t, k)), weldOf(corner(t, (k + 1) % 3))); edges.set(id, (edges.get(id) ?? 0) | side); }
  }
  const cutEdge = (a: number, b: number) => edges.get(edgeKey(weldOf(a), weldOf(b))) === 3;

  // ---- the limb
  const remap = new Map<number, number>(), P: number[] = [], N: number[] = [], U: number[] = [], C: number[] = [], out: number[] = [];
  const uv = source.uv, texture = [0, 0];
  const vertex = (v: number): number => {
    let found = remap.get(v);
    if (found === undefined) {
      found = P.length / 3; remap.set(v, found);
      const s = at(v) * 6;
      P.push(posed[s], posed[s + 1], posed[s + 2]); N.push(posed[s + 3], posed[s + 4], posed[s + 5]); C.push(0, 0, 0);
      if (uv) { uv(v, texture); U.push(texture[0], texture[1]); }
    }
    return found;
  };
  const limbCuts: [number, number][] = [], stumpEdges: [number, number][] = [];
  for (const t of near) {
    const limb = sideOf(t) === 1;
    for (let k = 0; k < 3; k += 1) {
      const a = corner(t, k), b = corner(t, (k + 1) % 3);
      if (limb) out.push(vertex(a));
      if (cutEdge(a, b)) (limb ? limbCuts : stumpEdges).push([a, b]);
    }
  }
  const skin = out.length;
  let limb: SeverPiece | null = null;
  if (skin) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
    const middle: V3 = [cx / (P.length / 3), cy / (P.length / 3), cz / (P.length / 3)];
    for (const fan of loopsOf(limbCuts, weldOf)) {
      if (fan.length < 3) continue;
      let x = 0, y = 0, z = 0;
      for (const [a] of fan) { const s = at(a) * 6; x += posed[s]; y += posed[s + 1]; z += posed[s + 2]; }
      const hub: V3 = [x / fan.length, y / fan.length, z / fan.length], facing = unit(sub(hub, middle));
      const across = perpendicular(facing), along = cross(facing, across);
      // Every rim vertex is marked 1, as the stump's cap marks its own: the section's rings follow the torn edge all
      // round, so the armour's rim lies on the skin it was cut from wherever the edge runs in or out.
      const cap = (v: number | null): number => {
        const found = P.length / 3;
        const p: V3 = v === null ? hub : [posed[at(v) * 6], posed[at(v) * 6 + 1], posed[at(v) * 6 + 2]];
        P.push(p[0], p[1], p[2]); N.push(facing[0], facing[1], facing[2]);
        if (uv) U.push(0, 0);
        if (v === null) C.push(0, 0, 0);
        else { const d = sub(p, hub), bearing = Math.atan2(dot(d, along), dot(d, across)); C.push(1, Math.cos(bearing), Math.sin(bearing)); }
        return found;
      };
      const centre = cap(null);
      // Wound the other way round from the skin it closes, so the cap faces out of the cut.
      for (const [a, b] of fan) out.push(cap(b), cap(a), centre);
    }
    limb = {
      positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: uv ? Float32Array.from(U) : null, index: Uint32Array.from(out),
      skin, cap: out.length - skin, cut: Float32Array.from(C),
    };
  }

  // ---- the body's side
  let stump: SeverStump | null = null;
  const rounds = loopsOf(stumpEdges, weldOf).filter(round => round.length >= 3);
  if (rounds.length) {
    const flat: number[] = [], loops: number[] = [];
    rounds.forEach((round, loop) => { for (const [a, b] of round) { flat.push(a, b); loops.push(loop); } });
    stump = { edges: Int32Array.from(flat), loops: Int32Array.from(loops), count: rounds.length };
  }
  return { limb, stump };
}

/** The side a triangle goes to: the side most of its three corners are on (1 the limb, 0 the body). */
const majority = (a: number, b: number, c: number): number => b === c ? b : a;

/** A range of a skin's index drawn with one material, as three.js keeps it (start and count in indices). */
export interface SkinGroup { start: number; count: number; materialIndex?: number }

/** A skinned mesh's surface and skin, for the body's side of a cut. */
export interface StumpSkinSource {
  /** Vertices in the mesh. */
  count: number;
  /** Triangles, three vertex indices each; null for a mesh drawn without an index. */
  index: ArrayLike<number> | null;
  /** 1 for a vertex the limb's bones move most, as severSkin was given it. */
  owner: ArrayLike<number>;
  /** The mesh's draw groups; empty for one material over everything. */
  groups: readonly SkinGroup[];
  /** Four bones a vertex, by their index in the skin: rewritten in place. */
  skinIndex: { [slot: number]: number; readonly length: number };
  /** True for each bone of the skin that goes with the limb. */
  limbBones: ArrayLike<boolean>;
  /** The bone the stump hangs from (or the nearest above it the skin uses), by its index in the skin. */
  hold: number;
}

export interface StumpSkin {
  /** The body's triangles, without the limb's. */
  index: Uint32Array;
  /** The draw groups over them, in the same order. */
  groups: SkinGroup[];
  /** Triangles left out (the limb's), and vertices still drawn whose limb bones went to `hold`. */
  dropped: number; moved: number;
}

/**
 * The skin the body wears once a limb is off it, in place of its own (SeverSystem.ts gives each severed figure its own
 * copy, and gives its own back when it stands again). Its triangles are the body's side of the cut, as severSkin
 * decides them: the limb's leave it. Every vertex they still use has the limb's bones in its skin given to the bone
 * the stump hangs from, its weights kept: nothing the body draws is pulled into the joint where the limb's bones are
 * folded, so the cut stays the torn edge it was, as the body bends, falls or is carried, and the stump's cap closes it
 * on those same vertices. A vertex only the limb used keeps its skin: it is drawn no more, and whatever reads the skin
 * by its bones (a ragdoll measuring the body, a burst) still finds it on the folded limb.
 */
export function stumpSkin(source: StumpSkinSource): StumpSkin {
  const { owner, index, skinIndex, limbBones, hold } = source;
  const total = index ? index.length : source.count;
  const corner = (i: number) => index ? index[i] : i;
  const kept: number[] = [], groups: SkinGroup[] = [], used = new Uint8Array(source.count);
  let dropped = 0;
  const take = (start: number, end: number) => {
    for (let i = Math.max(0, start); i + 3 <= end; i += 3) {
      const a = corner(i), b = corner(i + 1), c = corner(i + 2);
      if (majority(owner[a], owner[b], owner[c]) === 1) { dropped += 1; continue; }
      kept.push(a, b, c); used[a] = 1; used[b] = 1; used[c] = 1;
    }
  };
  if (!source.groups.length) take(0, total);
  for (const group of source.groups) {
    const from = kept.length;
    take(group.start, Math.min(total, group.start + group.count));
    groups.push(group.materialIndex === undefined ? { start: from, count: kept.length - from } : { start: from, count: kept.length - from, materialIndex: group.materialIndex });
  }
  let moved = 0;
  for (let v = 0; v < source.count; v += 1) {
    if (!used[v]) continue;
    let any = false;
    for (let k = 0; k < 4; k += 1) if (limbBones[skinIndex[v * 4 + k]]) { skinIndex[v * 4 + k] = hold; any = true; }
    if (any) moved += 1;
  }
  return { index: Uint32Array.from(kept), groups, dropped, moved };
}

// ---------------------------------------------------------------- what the cut goes through

/** What a cut shows in section at its rim, outermost first: bare flesh, cloth, mail over padding, plate over padding. */
export type CutSection = "flesh" | "cloth" | "mail" | "plate";
export const CUT_SECTIONS: readonly CutSection[] = ["flesh", "cloth", "mail", "plate"];
/** How the flesh drawn on a cut (SeverSystem.ts) is told a section: its `section` attribute, the same on every vertex of a cap. */
export const CUT_SECTION_CODE: Readonly<Record<CutSection, number>> = { flesh: 0, cloth: 1, mail: 2, plate: 3 };

/** The section a surface of the gore system's armour tables (gore/ImpactResolver.ts) shows when it is cut through. */
export function surfaceSection(material: SurfaceMaterial): CutSection {
  if (material === "plate" || material === "iron" || material === "steel") return "plate";
  if (material === "mail") return "mail";
  return material === "cloth" ? "cloth" : "flesh";
}

/** The region of the armour tables (gore/ImpactResolver.ts CutRegion) each limb is cut through. */
export const LIMB_CUT_REGION: Readonly<Record<SeverLimb, CutRegion>> = {
  head: "neck", armL: "arm", armR: "arm", foreArmL: "forearm", foreArmR: "forearm", legL: "leg", legR: "leg", shinL: "shin", shinR: "shin",
};

/**
 * What a figure wears where a limb comes off, by its own armour table (gore/ImpactResolver.ts): the top of the neck for
 * a head, the shoulder for an arm, the elbow, the hip, the knee. The Aethelgard knight's arm comes off through plate
 * and its pawn's through the mail of its short sleeve, but that pawn's leg through cloth; the Solforiz knight comes
 * apart through cloth everywhere; the Korvenia cuirassier's steel stops at his chest, and a bare-headed queen's head
 * comes off through flesh.
 */
export function wornSection(kind: GoreKind, kingdom: GoreKingdom, limb: SeverLimb): CutSection {
  return surfaceSection(regionsOf(kind, kingdom).cut[LIMB_CUT_REGION[limb]]);
}

/** Words a mesh's or its material's name may call armour by, for the section it shows. */
const NAMED: readonly [CutSection, readonly string[]][] = [
  ["plate", ["plate", "armor", "armour", "helm", "gorget", "pauldron", "spaulder", "vambrace", "rerebrace", "gauntlet", "greave", "cuirass", "breastplate", "cuisse", "poleyn", "sabaton", "steel", "iron", "metal"]],
  ["mail", ["mail", "chainmail", "chain", "hauberk", "coif", "byrnie", "haubergeon"]],
  ["cloth", ["gambeson", "padding", "padded", "quilt", "quilted", "aketon", "cloth", "robe", "tabard", "surcoat", "cloak", "cape", "tunic", "linen", "wool", "silk", "fabric"]],
  ["flesh", ["skin", "flesh"]],
];
/** A mesh is plate by its metal alone when it is at least this metal, and this much more than the least metal of its figure. */
export const CUT_METAL = { plate: 0.35, apart: 0.2 } as const;

/** The section a name says, word by word (`Knight_HelmetMat` says plate), or null when it says none. */
export function namedSection(name: string): CutSection | null {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const [section, names] of NAMED) if (words.some(word => names.some(known => word === known || word.startsWith(known)))) return section;
  return null;
}

/**
 * What each skinned mesh of a figure shows where a limb is cut through it. A mesh made as armour says so by its own
 * name or its material's (a helm or a gorget is plate, a hauberk mail, a gambeson cloth), or is clearly more metal
 * than the figure's others (the faction look, pieces.ts applyFactionLook, keeps a figure in its own livery between
 * 0.08 and 0.4 and gives every material of any other one value, so metal alone tells nothing on most figures); where
 * any mesh is told apart so, the rest are the flesh under it. Where none is, which is every figure the game has now
 * (one mesh, armour and skin painted on one surface), each shows what the armour tables say is worn there (`worn`,
 * wornSection).
 */
export function cutSections(meshes: readonly { name: string; metalness: number }[], worn: CutSection): CutSection[] {
  const metal = meshes.map(mesh => Number.isFinite(mesh.metalness) ? mesh.metalness : 0), least = Math.min(...metal);
  const own = meshes.map((mesh, i) => namedSection(mesh.name) ?? (meshes.length > 1 && metal[i] >= CUT_METAL.plate && metal[i] - least >= CUT_METAL.apart ? "plate" : null));
  return own.some(Boolean) ? own.map(section => section ?? "flesh") : meshes.map(() => worn);
}

/** Edges sorted into the separate rounds they make (two shoulders against one chest are two), by their welded ends. */
function loopsOf(list: readonly [number, number][], weldOf: (v: number) => number): [number, number][][] {
  const parent = new Map<number, number>();
  const find = (v: number): number => { let at = v; while (parent.get(at)! !== at) at = parent.get(at)!; parent.set(v, at); return at; };
  for (const [a, b] of list) {
    const wa = weldOf(a), wb = weldOf(b);
    if (!parent.has(wa)) parent.set(wa, wa);
    if (!parent.has(wb)) parent.set(wb, wb);
    parent.set(find(wa), find(wb));
  }
  const rounds = new Map<number, [number, number][]>();
  for (const edge of list) { const id = find(weldOf(edge[0])); const round = rounds.get(id); if (round) round.push(edge); else rounds.set(id, [edge]); }
  return [...rounds.values()];
}

/**
 * A skinned vertex as the vertex shader poses it, into the world: the bind matrix, the weighted bone matrices, and back
 * out (`post` is the mesh's world matrix times its inverse bind matrix). Column-major 4x4s, as three.js keeps them.
 * Writes the position into `out[0..2]` and the unit normal into `out[3..5]`.
 */
export function skinVertex(
  position: V3, normal: V3, bones: ArrayLike<number>, weights: ArrayLike<number>, matrices: ArrayLike<number>, pre: ArrayLike<number>, post: ArrayLike<number>, out: number[],
): void {
  const [x, y, z] = position, [nx, ny, nz] = normal;
  const bx = pre[0] * x + pre[4] * y + pre[8] * z + pre[12], by = pre[1] * x + pre[5] * y + pre[9] * z + pre[13], bz = pre[2] * x + pre[6] * y + pre[10] * z + pre[14];
  const dx = pre[0] * nx + pre[4] * ny + pre[8] * nz, dy = pre[1] * nx + pre[5] * ny + pre[9] * nz, dz = pre[2] * nx + pre[6] * ny + pre[10] * nz;
  let sx = 0, sy = 0, sz = 0, tx = 0, ty = 0, tz = 0, total = 0;
  for (let k = 0; k < 4; k += 1) {
    const w = weights[k];
    if (!(w > 0)) continue;
    const B = matrices, o = bones[k] * 16;
    sx += w * (B[o] * bx + B[o + 4] * by + B[o + 8] * bz + B[o + 12]); sy += w * (B[o + 1] * bx + B[o + 5] * by + B[o + 9] * bz + B[o + 13]); sz += w * (B[o + 2] * bx + B[o + 6] * by + B[o + 10] * bz + B[o + 14]);
    tx += w * (B[o] * dx + B[o + 4] * dy + B[o + 8] * dz); ty += w * (B[o + 1] * dx + B[o + 5] * dy + B[o + 9] * dz); tz += w * (B[o + 2] * dx + B[o + 6] * dy + B[o + 10] * dz);
    total += w;
  }
  // A vertex no bone holds stays where the bind pose has it.
  if (total <= 0) { sx = bx; sy = by; sz = bz; tx = dx; ty = dy; tz = dz; }
  out[0] = post[0] * sx + post[4] * sy + post[8] * sz + post[12]; out[1] = post[1] * sx + post[5] * sy + post[9] * sz + post[13]; out[2] = post[2] * sx + post[6] * sy + post[10] * sz + post[14];
  const ox = post[0] * tx + post[4] * ty + post[8] * tz, oy = post[1] * tx + post[5] * ty + post[9] * tz, oz = post[2] * tx + post[6] * ty + post[10] * tz, l = Math.hypot(ox, oy, oz) || 1;
  out[3] = ox / l; out[4] = oy / l; out[5] = oz / l;
}
