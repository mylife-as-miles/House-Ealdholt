// Adapted from Lim-Young/SkeletalMeshDestruction (MIT). Copyright (c) 2025 Lim Young. See public/licenses/SkeletalMeshDestruction-MIT.txt.
/**
 * Dismemberment in the scene: a limb taken off a figure by a killing blow (severPlan.ts decides when and which).
 *
 *   severs.sever(victim, { point, direction, power, ply, seed, index })   // the limb taken, or null
 *   severs.update(delta)                                                   // every frame, after the ragdolls have posed
 *   severs.without(victim); severs.hidden(victim)                          // what the ragdoll and a burst must leave out
 *   severs.undoTo(ply); severs.clear();
 *
 * As SkeletalMeshDestruction does it, the figure is never split where it is drawn:
 *  - The limb's skin is cut from the figure as it is posed on the frame of the blow (severPlan.ts severSkin): the
 *    triangles its bones own, with the open end closed by raw flesh. That piece is thrown along the blow, tumbling,
 *    as a body in the death physics world (SeverSim.ts), and collides with nothing for its avoidance phase.
 *  - On the figure the limb's bones are folded to nothing at the joint, every frame after the clip and the ragdoll
 *    have posed them, so anything still on them collapses into the stump. The figure wears its own copy of each skin
 *    it was cut from (severPlan.ts stumpSkin; the skin itself is shared by every figure of its kind): without the
 *    limb's triangles, and with the limb's bones given to the stump's in the skin of every vertex it still draws, so
 *    nothing it draws is pulled into the joint and the cut stays a clean torn edge. The stump is closed with a cap of
 *    raw, wet flesh and bone (`flesh` below) bound to the figure's own skeleton: its rim is the body's own vertices
 *    along the cut with their skin, so it seals the skin exactly as the body bends, falls, is thrown or is carried.
 *    Where the cut goes through armour, the cap and the limb's cut end show its section (severPlan.ts cutSections):
 *    a bright rim of plate or a ring of mail, the padding under it, then the flesh.
 *  - What the hand held goes with the arm: the weapon is hidden on the figure and leaves as a piece of its own,
 *    thrown with the arm as the dead hand lets it go, and lands beside it (the idea is Thyke/Dismemberment's, MIT,
 *    Copyright (c) 2025 Thyke: a severed arm takes its weapon, or drops it, and never leaves it hanging at the stump;
 *    no code was taken from it).
 *  - The stump spurts in beats along the bone's axis through the gore system's own spray, with stains where the
 *    droplets come down; a pool forms under it where the body comes to rest; the limb throws a little blood where it
 *    lands. The gore planner gates all of it as it gates every wound (nothing at Minimal or under reduced motion).
 *
 * The body goes on with its death (its clip, its ragdoll without the severed part, its carry by a summon). The
 * pieces wear the figure's own materials, so the Claiming's unmaking takes the limb with the body; the flesh follows
 * by hand. When the figure stands again (the tray, an Undo) its bones, its own skin and its weapon are given back
 * whole and everything here goes; Undo and a new game take the blood of the plies taken back.
 */
import * as THREE from "three";
import { planGore } from "../../gore/GoreDirector";
import type { GoreTier } from "../../gore/goreTiers";
import type { GoreEvent, GoreIntensity, GoreKind, GoreKingdom, GorePlan, PoolPlan, SprayPlan, StainPlan } from "../../gore/GoreTypes";
import type { PieceView } from "../../pieces";
import type { QualityPreset } from "../../quality";
import type { GibBlood } from "../gibs/GibSystem";
import { fitBox, intoFrame } from "../gibs/gibPlan";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { decompose, type Q4, type V3 } from "../physics/math";
import type { PartName, RigJoint, RigPose } from "../ragdoll/ragdollPlan";
import { SeverSim, type SeverBody } from "./SeverSim";
import {
  CUT_SECTION_CODE, carriedVelocity, cutSections, limbJoints, limbLaunch, limbSegment, nearestLimb, ragdollParts, severSkin, severableLimbs, skinVertex, spurtPulses, spurtSpray, spurtStains,
  stumpSkin, stumpWoundPlan, wornSection, type CutSection, type LimbBone, type SeverLimb, type SeverPiece, type SeverStump, type SkinGroup, type SprayTemplate,
} from "./severPlan";

export interface SeverRequest {
  /** Where the blow met the body, world: the limb whose bone runs nearest it comes off. */
  point: { x: number; y: number; z: number };
  /** The way the blow travels, world: the limb is thrown along it. */
  direction: { x: number; y: number; z: number };
  /** About 1 for a killing blow, more for a heavy one or a tearing. */
  power: number;
  /** Half-moves played when this kill is on the board: Undo past it takes it back. */
  ply: number;
  /** The kill's seed: the same game severs the same way. */
  seed: number;
  /** How many limbs this kill has taken before this one: each is thrown its own way. */
  index?: number;
  /** The victim's kingdom, for the gore planner. */
  kingdom?: GoreKingdom;
  /** The Violence setting, and the flags every gore event carries: the gore planner's own gate on the blood. */
  intensity?: GoreIntensity;
  flags?: { menuBoard: boolean; reducedMotion: boolean; tactical: boolean };
  /** The kill's gore tier (gore/goreTiers.ts): the size of the stump's wound mask. 2 if not given. */
  tier?: GoreTier;
}

/** A stump, as the wound mask painted at it needs it (severPlan.ts stumpWoundPlan, SeverSystem.paintStumpWound). */
export interface StumpWound {
  victim: PieceView;
  limb: SeverLimb;
  /** The bone the stump hangs from (the cap is bound to it), and the bone folded away at the cut. */
  bone: THREE.Object3D;
  cutBone: THREE.Bone;
  /** The middle of the cut and the way out of it (unit), world, on the frame it was cut; its radius, scene units. */
  point: THREE.Vector3;
  axis: THREE.Vector3;
  radius: number;
  /** Each skinned mesh that was cut, with its own vertices along the cut on the body's side. */
  rims: { mesh: THREE.SkinnedMesh; vertices: Int32Array }[];
  /** The gore impact the sever's blood is filed under, and its ply: what Undo removes it with. */
  impact: string;
  ply: number;
}


interface Piece { group: THREE.Group; geometries: THREE.BufferGeometry[] }
interface Cut {
  limb: SeverLimb;
  /** The bone the limb was cut off at, folded to no size every frame, and the scale it is given back. */
  bone: THREE.Bone;
  scale: THREE.Vector3;
  /** The bone it hung from, and the way out of the stump in that bone's own frame (unit). */
  stump: THREE.Object3D;
  axis: THREE.Vector3;
  radius: number;
  /** Things under the limb's bones hidden while it is off: the weapon it held, which leaves as its own piece. */
  hidden: THREE.Object3D[];
  caps: THREE.SkinnedMesh[];
  /** The limb, then what it held. */
  pieces: Piece[];
  sim: SeverSim | null;
  /** The stump's beats still to come, on this system's clock. */
  pulses: { at: number; strength: number; index: number }[];
  /** The planner's answer for a wound at the stump: the size of its spray, its pool; null when the gore system shows none. */
  blood: GorePlan | null;
  impact: string;
  landed: boolean;
  /** For the pool: whether it is laid, how long the stump has been still, and where it was last frame. */
  pooled: boolean;
  quiet: number;
  last: THREE.Vector3 | null;
  born: number;
}
interface Entry {
  victim: PieceView;
  ply: number;
  seed: number;
  kingdom: GoreKingdom;
  intensity: GoreIntensity;
  flags: NonNullable<SeverRequest["flags"]>;
  /** The kill's gore tier: the size of its stumps' wound masks. */
  tier: GoreTier;
  cuts: Cut[];
  /** Each skin it was cut from: its own, given back when it stands again, and the copy it wears without its limbs. */
  skins: { mesh: THREE.SkinnedMesh; own: THREE.BufferGeometry; copy: THREE.BufferGeometry }[];
  /** The raw, wet flesh of every cut on this figure and its limbs. */
  flesh: THREE.MeshStandardMaterial;
  /** Whether it has been seen dead: a figure that stands again after that is given back whole. */
  slain: boolean;
  born: number;
}

export interface SeverStats {
  /** Figures with a limb off now, limbs off now, and limbs still in the air or rolling. */
  figures: number; severed: number; flying: number;
  /** The last limb taken, how long cutting it took (ms), and each of its pieces' avoidance phase (s). */
  lastLimb: SeverLimb | null; lastMs: number | null; lastAvoid: number[] | null; lastRest: number | null;
  /** Blood laid by severs (impacts), for Undo checks. */
  blood: number;
  /** Stumps whose wound was painted into the figure's own mask, since the system was made. */
  stumpMasks: number;
}

/** A bone folded away is scaled by this: small enough to vanish, large enough to keep every matrix invertible. */
const FOLD = 1e-4;
/** The middle of the stump's cap stands out of the cut by this share of its radius, as flesh swells from a cut. */
const DOME = 0.25;
/** A weapon a severed hand lets go of, kilograms. */
const WEAPON_MASS = 2;
/** Beats of the stump that leave stains (the first few), and how many each. */
const STAINED_BEATS = 3, STAINS_A_BEAT = 2;
/** A body is at rest for its pool when its stump has moved less than this (scene units) a frame for this long (s). */
const STILL = 0.004, STILL_FOR = 0.35;
/** A figure struck but never seen dead within this long (a fight cut short) is given back. */
const ORPHAN = 12;

const p = new THREE.Vector3(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4();
const at: V3 = [0, 0, 0], turn: Q4 = [0, 0, 0, 1];

export class SeverSystem {
  private readonly entries: Entry[] = [];
  private quality: QualityPreset;
  private readonly laid: { ply: number; impact: string }[] = [];
  private readonly queue: { at: number; run: () => void }[] = [];
  private clock = 0;
  private lastLimb: SeverLimb | null = null;
  private lastMs: number | null = null;
  private lastAvoid: number[] | null = null;
  private lastRest: number | null = null;
  private stumpMasks = 0;

  constructor(
    private readonly world: () => PhysicsWorld | null, private readonly root: THREE.Group, quality: QualityPreset,
    private readonly blood: GibBlood | null, private readonly board: { top: number; tile: number },
    /** A limb has reached the stone: for the sound of it. */
    private readonly onLanding: ((at: THREE.Vector3, trunk: boolean) => void) | null,
    /** What the rest of the death physics is doing with a body: thrown about still, or burst into pieces. */
    private readonly body: { falling(victim: PieceView): boolean; burst(victim: PieceView): boolean },
  ) { this.quality = quality; }

  setQuality(quality: QualityPreset): void { this.quality = quality; }
  get busy(): boolean { return this.entries.some(entry => entry.cuts.some(cut => cut.sim !== null)); }
  owns(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim); }
  /** Whether a limb taken off this figure is still in the air or rolling. */
  flying(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim && entry.cuts.some(cut => cut.sim !== null)); }
  /** The ragdoll bodies this figure no longer has. */
  without(victim: PieceView): PartName[] { return this.entries.find(entry => entry.victim === victim)?.cuts.flatMap(cut => ragdollParts(cut.limb)) ?? []; }
  /** Every bone folded away on this figure (a burst leaves their skin out). */
  hidden(victim: PieceView): Set<THREE.Object3D> {
    const found = new Set<THREE.Object3D>();
    for (const cut of this.entries.find(entry => entry.victim === victim)?.cuts ?? []) cut.bone.traverse(node => { if ((node as THREE.Bone).isBone) found.add(node); });
    return found;
  }
  /** This figure's stumps, first cut first (a fatality's fluid pours from one): the bone each hangs from and the way out in its frame, the folded bone at the cut, the cut's radius. */
  stumps(victim: PieceView): { limb: SeverLimb; bone: THREE.Object3D; axis: THREE.Vector3; joint: THREE.Bone; radius: number }[] {
    return this.entries.find(entry => entry.victim === victim)?.cuts.map(cut => ({ limb: cut.limb, bone: cut.stump, axis: cut.axis, joint: cut.bone, radius: cut.radius })) ?? [];
  }
  get stats(): SeverStats {
    return {
      figures: this.entries.length, severed: this.entries.reduce((sum, entry) => sum + entry.cuts.length, 0),
      flying: this.entries.reduce((sum, entry) => sum + entry.cuts.filter(cut => cut.sim).length, 0),
      lastLimb: this.lastLimb, lastMs: this.lastMs, lastAvoid: this.lastAvoid, lastRest: this.lastRest, blood: this.laid.length, stumpMasks: this.stumpMasks,
    };
  }

  /**
   * Takes off the limb of `victim` whose bone runs nearest `request.point`, and throws it along `request.direction`.
   * Returns the limb, or null when nothing can come off (no physics world, no skeleton with limbs, every limb taken,
   * a skin that cannot be read): the death goes on as it would have. The caller decides whether this blow severs at
   * all (severPlan.ts planSevers and woundSevers).
   */
  sever(victim: PieceView, request: SeverRequest): SeverLimb | null {
    const world = this.world();
    if (!world || !victim.container.parent) return null;
    const started = performance.now();
    victim.container.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [];
    victim.visual.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone); });
    if (bones.length < 2) return null;
    const index = new Map<THREE.Object3D, number>(bones.map((bone, i) => [bone, i]));
    const joints: RigJoint[] = bones.map(bone => ({ name: bone.name, parent: index.get(bone.parent as THREE.Object3D) ?? -1 }));
    const pose: RigPose = { positions: [], rotations: [] };
    bones.forEach((bone, i) => { const world = decompose(bone.matrixWorld.elements); pose.positions[i] = world.position; pose.rotations[i] = world.rotation; });
    let entry = this.entries.find(found => found.victim === victim) ?? null;
    const choice = nearestLimb([request.point.x, request.point.y, request.point.z], pose, joints, severableLimbs(joints), entry?.cuts.map(cut => cut.limb) ?? []);
    if (!choice) return null;
    const bone = bones[choice.joint], stump = bones[choice.parent];
    const going = new Set<THREE.Object3D>(limbJoints(joints, choice).map(i => bones[i]));
    const flesh = entry?.flesh ?? fleshMaterial();
    const worn = wornSection(victim.kind as GoreKind, request.kingdom ?? "ivory", choice.limb);
    // The vertices on a stump made before stay with the body, so its cap stays on the skin it closes.
    const earlier = (mesh: THREE.SkinnedMesh) => new Set((entry?.cuts ?? []).flatMap(cut => cut.caps.flatMap(cap => { const held = capRims.get(cap); return held?.skin === mesh ? [...held.rim].filter(v => v >= 0) : []; })));
    let made: ReturnType<typeof cutLimb>;
    // Reading and cutting changes nothing on the figure: a mesh this cannot cut costs the sever, not the death.
    try { made = cutLimb(victim, choice, pose, going, bone, stump, flesh, worn, earlier); } catch (error) { console.warn("[death] could not sever the limb; the death goes on whole", error); made = null; }
    if (!made || !made.limb) {
      if (!entry) flesh.dispose();
      if (made) for (const cap of made.caps) { cap.removeFromParent(); cap.geometry.dispose(); }
      return null;
    }
    if (!entry) {
      entry = {
        victim, ply: request.ply, seed: request.seed >>> 0, kingdom: request.kingdom ?? "ivory", intensity: request.intensity ?? "full",
        flags: request.flags ?? { menuBoard: false, reducedMotion: false, tactical: false }, tier: request.tier ?? 2, cuts: [], skins: [], flesh, slain: victim.isSlain, born: this.clock,
      };
      this.entries.push(entry);
    }
    const number = request.index ?? entry.cuts.length, seed = (entry.seed ^ Math.imul(number + 1, 0x51ed270b)) >>> 0;

    // The limb leaves along the blow, tumbling; what the hand held leaves with it, as the hand lets go.
    const throwOf = limbLaunch([request.direction.x, request.direction.y, request.direction.z], request.power, seed, number, choice.limb);
    const bodies: SeverBody[] = [{ centre: made.limb.centre, rotation: made.limb.rotation, half: made.limb.half, velocity: throwOf.velocity, spin: throwOf.spin }];
    const pieces: Piece[] = [made.limb.piece];
    for (const held of made.held) {
      bodies.push({ centre: held.centre, rotation: held.rotation, half: held.half, velocity: carriedVelocity(throwOf.velocity, throwOf.spin, made.limb.centre, held.centre), spin: throwOf.spin, mass: WEAPON_MASS });
      pieces.push(held.piece);
    }
    for (const piece of pieces) this.root.add(piece.group);
    const sim = new SeverSim(world, bodies);

    // The limb's bones fold into the joint, and stay folded (re-applied every frame in update) until it stands again.
    const scale = bone.scale.clone();
    bone.scale.copy(scale).multiplyScalar(FOLD);
    for (const node of made.hiddenProps) node.visible = false;
    // The body wears its skin without the limb: nothing it draws is pulled into that joint.
    for (const body of made.bodies) wearBody(entry, body);
    // A stump made before this one takes up the skin its rim now wears (two legs share the vertices between them).
    for (const before of entry.cuts) for (const cap of before.caps) reskinCap(cap);

    const impact = `${entry.ply}:sever.${entry.seed.toString(36)}.${number}`;
    const cut: Cut = {
      limb: choice.limb, bone, scale, stump, axis: made.axisLocal, radius: made.radius, hidden: made.hiddenProps, caps: made.caps, pieces, sim,
      pulses: spurtPulses(seed).map((pulse, i) => ({ at: this.clock + pulse.at, strength: pulse.strength, index: i })),
      blood: null, impact, landed: false, pooled: false, quiet: 0, last: null, born: this.clock,
    };
    entry.cuts.push(cut);
    cut.blood = this.planStump(entry, cut, made.point, made.axisWorld);
    if (!cut.blood || !cut.blood.sprays.length) cut.pulses.length = 0;
    if (!cut.blood?.pool) cut.pooled = true;

    this.paintStumpWound(entry, cut, { victim, limb: choice.limb, bone: stump, cutBone: bone, point: made.point.clone(), axis: made.axisWorld.clone(), radius: made.radius, rims: made.rims, impact, ply: entry.ply }, seed);
    this.lastLimb = choice.limb; this.lastMs = Math.round((performance.now() - started) * 10) / 10; this.lastAvoid = [...sim.avoid];
    return choice.limb;
  }

  /**
   * Called once for every stump, on the frame its limb comes off, after the cap is on and before anything bleeds: its
   * wound ({@link stumpWoundPlan}) painted into the figure's own mask through the gore system, on the bone the stump
   * hangs from, its runs of blood down the body on this system's clock. It is filed under the sever's own impact, so
   * Undo takes it back with the rest of the sever's blood, and it goes with the figure when it stands again. Nothing
   * where the planner shows no blood at the stump (cut.blood) or the figure wears no mask.
   */
  private paintStumpWound(entry: Entry, cut: Cut, stump: StumpWound, seed: number): void {
    const blood = this.blood;
    if (!cut.blood || !blood?.stumpWound) return;
    const wound = stumpWoundPlan(stump, { intensity: entry.intensity, quality: this.quality, tier: entry.tier, reducedMotion: entry.flags.reducedMotion, seed });
    if (!wound?.mask || !blood.stumpWound(cut.impact, entry.victim, stump.bone, wound)) return;
    this.stumpMasks += 1;
    wound.mask.runs.forEach((run, index) => this.later(run.at, () => {
      if (this.laid.some(item => item.impact === cut.impact)) blood.stumpRun?.(cut.impact, index);
    }));
  }

  /** The planner's answer for a wound at the stump (its spray's size, its pool), filed for Undo; null when it shows none. */
  private planStump(entry: Entry, cut: Cut, point: THREE.Vector3, axis: THREE.Vector3): GorePlan | null {
    if (!this.blood) return null;
    const event: GoreEvent = {
      impactId: cut.impact, seed: (entry.seed ^ Math.imul(entry.cuts.length, 0x68e31da4)) >>> 0, ply: entry.ply,
      // What takes a limb off is past any armour: the planner is asked for flesh, as a burst asks it.
      attacker: { kind: "q", kingdom: entry.kingdom, weapon: "musket" }, defender: { kind: entry.victim.kind as GoreKind, kingdom: entry.kingdom },
      contact: { point: { x: point.x, y: point.y, z: point.z }, normal: { x: axis.x, y: axis.y, z: axis.z }, direction: { x: axis.x, y: axis.y, z: axis.z }, anchor: "torso" },
      power: 1.5, outcome: "kill", intensity: entry.intensity, quality: this.quality, flags: entry.flags, board: this.board,
    };
    const plan = planGore(event);
    if (plan.silent) return null;
    this.laid.push({ ply: entry.ply, impact: cut.impact });
    return plan;
  }

  /** A little blood where a limb lands: a short spray and the stains it leaves, through the planner like any wound. */
  private splash(entry: Entry, cut: Cut, where: V3): void {
    const blood = this.blood;
    if (!blood) return;
    const impact = `${cut.impact}.land`;
    const plan = planGore({
      impactId: impact, seed: (entry.seed ^ 0x2545f491 ^ Math.imul(entry.cuts.indexOf(cut) + 1, 0x9e3779b1)) >>> 0, ply: entry.ply,
      attacker: { kind: "q", kingdom: entry.kingdom, weapon: "musket" }, defender: { kind: entry.victim.kind as GoreKind, kingdom: entry.kingdom },
      contact: { point: { x: where[0], y: this.board.top + 0.04, z: where[2] }, normal: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 1, z: 0 }, anchor: "torso" },
      power: 1, outcome: "kill", intensity: entry.intensity, quality: this.quality, flags: entry.flags, board: this.board,
    });
    if (plan.silent) return;
    this.laid.push({ ply: entry.ply, impact });
    const live = () => this.laid.some(item => item.impact === impact);
    for (const spray of plan.sprays) {
      if (spray.id !== "spray") continue;
      const thrown: SprayPlan = { ...spray, droplets: Math.max(2, Math.round(spray.droplets * 0.3)), mist: Math.round(spray.mist * 0.3), speed: [spray.speed[0] * 0.55, spray.speed[1] * 0.55] };
      this.later(spray.delay, () => { if (live()) blood.spray(plan, thrown); });
    }
    for (const stain of plan.stains.slice(0, 2)) this.later(stain.at, () => { if (live()) blood.stain(plan, stain); });
  }

  private later(seconds: number, run: () => void): void {
    this.queue.push({ at: this.clock + seconds, run });
    this.queue.sort((a, b) => a.at - b.at);
  }

  update(delta: number): void {
    this.clock += Math.max(0, delta);
    while (this.queue.length && this.queue[0].at <= this.clock + 1e-9) this.queue.shift()!.run();
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i], victim = entry.victim;
      // Freed with the board: everything here goes. Standing again (the tray, an Undo): it is given back whole.
      if (!victim.container.parent) { this.remove(entry, false); continue; }
      if (victim.isSlain) entry.slain = true;
      else if (entry.slain || this.clock - entry.born > ORPHAN) { this.remove(entry, true); continue; }
      const burst = this.body.burst(victim), settled = !this.body.falling(victim);
      for (const cut of entry.cuts) {
        // The clip and the ragdoll have posed the bones this frame: the limb's are folded again.
        cut.bone.scale.copy(cut.scale).multiplyScalar(FOLD);
        this.fly(entry, cut);
        this.bleed(entry, cut, burst);
        if (!cut.pooled) this.pool(entry, cut, delta, burst, settled);
      }
      // The flesh is not the figure's material: it follows the body's unmaking by hand, and goes when the body has.
      const gone = victim.dissolveLevel;
      entry.flesh.transparent = gone > 0; entry.flesh.opacity = Math.max(0, 1 - gone * 1.4);
      // On the map the sculpts are hidden (`visual.visible`), and so is what came off this one.
      const shown = gone < 0.98 && victim.visual.visible;
      for (const cut of entry.cuts) for (const piece of cut.pieces) piece.group.visible = shown;
    }
  }

  /** The limb and what it held follow their bodies; each landing throws a little blood, the limb's once. */
  private fly(entry: Entry, cut: Cut): void {
    const sim = cut.sim;
    if (!sim) return;
    cut.pieces.forEach((piece, index) => {
      sim.position(index, at); sim.rotation(index, turn);
      piece.group.position.set(at[0], at[1], at[2]); piece.group.quaternion.set(turn[0], turn[1], turn[2], turn[3]);
    });
    for (const index of sim.landings()) {
      sim.position(index, at);
      this.onLanding?.(p.set(at[0], at[1], at[2]), false);
      if (index === 0 && !cut.landed) { cut.landed = true; this.splash(entry, cut, at); }
    }
    if (sim.atRest) { this.lastRest = sim.age; sim.release(); cut.sim = null; }
  }

  /** The stump's beats: each a spray out along the bone from where the limb was, the first few leaving stains. */
  private bleed(entry: Entry, cut: Cut, burst: boolean): void {
    const blood = this.blood, plan = cut.blood;
    if (!blood || !plan) { cut.pulses.length = 0; return; }
    // A body torn apart after its limb came off bleeds as a burst does: its stump is no longer anywhere.
    if (burst) { cut.pulses.length = 0; return; }
    const template = plan.sprays.find(spray => spray.id === "spray") ?? plan.sprays[0];
    while (cut.pulses.length && cut.pulses[0].at <= this.clock + 1e-9) {
      const pulse = cut.pulses.shift()!;
      if (!template) continue;
      const origin = cut.bone.getWorldPosition(p), axis = this.stumpAxis(cut);
      const spray = spurtSpray(template as SprayTemplate, pulse, pulse.index, { x: origin.x, y: origin.y, z: origin.z }, axis, plan.seed);
      if (!spray) continue;
      blood.spray(plan, spray);
      if (pulse.index < STAINED_BEATS) for (const stain of spurtStains(spray, this.board.top, this.board.tile, STAINS_A_BEAT)) this.stainLater(plan, stain);
    }
  }

  private stainLater(plan: GorePlan, stain: StainPlan): void {
    const blood = this.blood;
    if (!blood) return;
    this.later(stain.at, () => { if (this.laid.some(item => item.impact === plan.impactId)) blood.stain(plan, stain); });
  }

  /** The way out of the stump now, world. */
  private stumpAxis(cut: Cut): { x: number; y: number; z: number } {
    cut.stump.getWorldQuaternion(q);
    const axis = p.copy(cut.axis).applyQuaternion(q).normalize();
    return { x: axis.x, y: axis.y, z: axis.z };
  }

  /** The pool, under the stump, once the body has come to rest on the stone. */
  private pool(entry: Entry, cut: Cut, delta: number, burst: boolean, settled: boolean): void {
    const blood = this.blood, plan = cut.blood;
    if (!blood || !plan?.pool || burst || this.clock - cut.born > ORPHAN) { cut.pooled = true; return; }
    if (!entry.victim.isSlain || !settled) { cut.quiet = 0; cut.last = null; return; }
    const here = cut.bone.getWorldPosition(new THREE.Vector3());
    cut.quiet = cut.last && here.distanceTo(cut.last) < STILL ? cut.quiet + delta : 0;
    cut.last = here;
    if (cut.quiet < STILL_FOR || here.y > this.board.top + 0.5) return;
    cut.pooled = true;
    const lake: PoolPlan = plan.pool;
    this.later(lake.delay, () => { if (this.laid.some(item => item.impact === plan.impactId)) blood.pool(plan, lake, { x: here.x, z: here.z }); });
  }

  private remove(entry: Entry, giveBack: boolean): void {
    for (const cut of entry.cuts) {
      cut.sim?.release(); cut.sim = null;
      if (giveBack) { cut.bone.scale.copy(cut.scale); for (const node of cut.hidden) node.visible = true; }
      for (const cap of cut.caps) { cap.removeFromParent(); cap.geometry.dispose(); }
      for (const piece of cut.pieces) { piece.group.removeFromParent(); for (const geometry of piece.geometries) geometry.dispose(); }
    }
    // Its own skins back, whether it stands again or was freed; the copies it wore go.
    for (const skin of entry.skins) { if (skin.mesh.geometry === skin.copy) skin.mesh.geometry = skin.own; skin.copy.dispose(); }
    entry.skins.length = 0;
    entry.flesh.dispose();
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  /** Undo: every limb goes (the engine rebuilds the figures whole), and so does the blood of the plies taken back. */
  undoTo(ply: number): void {
    for (const entry of [...this.entries]) this.remove(entry, entry.victim.container.parent !== null);
    for (let i = this.laid.length - 1; i >= 0; i -= 1) if (this.laid[i].ply > ply) { this.blood?.remove(this.laid[i].impact); this.laid.splice(i, 1); }
    this.queue.length = 0;
  }

  /** A new game: nothing of the last one remains. */
  clear(): void { this.undoTo(-1); this.lastRest = null; }
}

// ---------------------------------------------------------------- the cut

interface Made {
  limb: { piece: Piece; centre: V3; rotation: Q4; half: V3 } | null;
  held: { piece: Piece; centre: V3; rotation: Q4; half: V3 }[];
  hiddenProps: THREE.Object3D[];
  caps: THREE.SkinnedMesh[];
  rims: StumpWound["rims"];
  /** Each cut mesh's skin without the limb, for the figure to wear once the limb is off. */
  bodies: BodyCut[];
  /** The middle of the cut and the way out of it, world; the way out in the stump bone's frame; its radius. */
  point: THREE.Vector3; axisWorld: THREE.Vector3; axisLocal: THREE.Vector3; radius: number;
}

/** One mesh's body side of a cut (severPlan.ts stumpSkin), read from the figure and not yet worn by it. */
interface BodyCut {
  mesh: THREE.SkinnedMesh;
  index: Uint32Array; groups: SkinGroup[];
  /** Four bones a vertex: the mesh's own, with the limb's given to `hold` on every vertex the body still draws. */
  skinIndex: Uint16Array;
  /** The bone of the mesh's skeleton the stump hangs from (or the nearest above it the skin uses). */
  hold: number;
}

const clampHalf = (half: V3): V3 => [Math.max(0.012, half[0]), Math.max(0.012, half[1]), Math.max(0.012, half[2])];

/**
 * Cuts the limb from every skinned mesh of the figure as it is posed now, closes each stump with a cap bound to the
 * skeleton, and gathers what the limb holds. `worn` is what the armour tables say the figure wears there (each mesh's
 * own material may say otherwise: severPlan.ts cutSections); `earlier`, the vertices of a mesh on its stumps made before,
 * which stay with the body. Reads the figure and adds the caps; changes nothing else on it (the skins it is to wear
 * without the limb are handed back, for the caller to put on: wearBody).
 */
function cutLimb(
  victim: PieceView, choice: LimbBone, pose: RigPose, going: ReadonlySet<THREE.Object3D>, cutBone: THREE.Object3D, stump: THREE.Object3D, flesh: THREE.MeshStandardMaterial,
  worn: CutSection, earlier: (mesh: THREE.SkinnedMesh) => ReadonlySet<number>,
): Made | null {
  const meshes: THREE.SkinnedMesh[] = [], solids: THREE.Mesh[] = [], weapons: THREE.Object3D[] = [];
  victim.visual.traverseVisible(node => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) { if (mesh.name !== CAP_NAME && mesh.name !== "gore-decal" && mesh.geometry.getAttribute("skinIndex")) meshes.push(mesh); return; }
  });
  // What each mesh shows in section where it is cut: plate, mail, cloth or bare flesh.
  const sections = cutSections(meshes.map(mesh => {
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    return { name: `${mesh.name} ${material?.name ?? ""}`, metalness: material?.metalness ?? 0 };
  }), worn);
  // What hangs under the limb's bones: a weapon leaves on its own; anything else rides on the limb.
  for (const bone of going) for (const child of bone.children) {
    if ((child as THREE.Bone).isBone || !child.visible) continue;
    if (/^weapon_/.test(child.name)) { weapons.push(child); continue; }
    child.traverseVisible(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh && mesh.name !== "gore-decal" && mesh.name !== "gore-mark") solids.push(mesh); });
  }
  // The way out of the stump: down the limb's own bone, from the joint it is cut at.
  const [from, to] = limbSegment(choice, pose);
  const outward = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (outward.lengthSq() < 1e-12) outward.set(0, 1, 0);
  outward.normalize();
  const joint = new THREE.Vector3(from[0], from[1], from[2]);
  // The limb's box is squared to the bone it was cut at.
  const frame = decompose(cutBone.matrixWorld.elements).rotation;

  const skins: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [], clouds: Float32Array[] = [];
  const caps: THREE.SkinnedMesh[] = [], rims: StumpWound["rims"] = [], bodies: BodyCut[] = [];
  let rimSum = 0, rimCount = 0;
  const middle = new THREE.Vector3();
  let middles = 0;
  meshes.forEach((mesh, m) => {
    const cut = cutMesh(mesh, going, stump, earlier(mesh));
    if (!cut) return;
    const section = CUT_SECTION_CODE[sections[m]];
    if (cut.limb) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(cut.limb.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(cut.limb.normals, 3));
      if (cut.limb.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(cut.limb.uvs, 2));
      geometry.setAttribute("cut", new THREE.BufferAttribute(cut.limb.cut, 3));
      geometry.setAttribute("section", new THREE.BufferAttribute(new Float32Array(cut.limb.positions.length / 3).fill(section), 1));
      geometry.setIndex(new THREE.BufferAttribute(cut.limb.index, 1));
      geometry.addGroup(0, cut.limb.skin, 0); geometry.addGroup(cut.limb.skin, cut.limb.cap, 1);
      skins.push({ geometry, material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material });
      clouds.push(cut.limb.positions);
    }
    if (!cut.body) return;
    bodies.push(cut.body);
    if (cut.stump) {
      const cap = stumpCap(cut.body, cut.stump, cut.posed, outward, flesh, section);
      if (cap) {
        caps.push(cap.mesh); rims.push({ mesh, vertices: cap.rim });
        rimSum += cap.radius * cap.rimCount; rimCount += cap.rimCount; middle.addScaledVector(cap.middle, cap.rimCount); middles += cap.rimCount;
      }
    }
  });
  const limbPiece = skins.length ? buildPiece(`sever_${choice.limb}`, skins, clouds, frame, solids, flesh) : null;
  // Every weapon under the limb is hidden on the figure while it is off (a gun's hold would otherwise keep it full size at
  // the stump); each that has anything to draw leaves as its own piece.
  const held = limbPiece ? weapons.map(weapon => heldPiece(weapon)).filter((item): item is NonNullable<typeof item> => item !== null) : [];
  const point = middles ? middle.multiplyScalar(1 / middles) : joint.clone();
  // The way out in the stump bone's own frame, so the spurts follow it as the body moves.
  stump.getWorldQuaternion(q);
  const axisLocal = outward.clone().applyQuaternion(q.invert()).normalize();
  return {
    limb: limbPiece, held, hiddenProps: limbPiece ? weapons : [], caps, rims, bodies,
    point, axisWorld: outward.clone(), axisLocal, radius: rimCount ? rimSum / rimCount : 0.04,
  };
}

/**
 * The figure puts on a mesh's body side of a cut: its own copy of the skin (made on the first cut of that mesh, so a
 * skin every figure of its kind shares is never changed, and given back in `remove`), its triangles without the
 * limb's, and its bones with the limb's given to the stump. A second limb taken off the same figure cuts the copy.
 */
function wearBody(entry: Entry, cut: BodyCut): void {
  let skin = entry.skins.find(item => item.mesh === cut.mesh);
  if (!skin) {
    skin = { mesh: cut.mesh, own: cut.mesh.geometry, copy: cut.mesh.geometry.clone() };
    entry.skins.push(skin);
    cut.mesh.geometry = skin.copy;
  }
  const geometry = skin.copy;
  geometry.setIndex(new THREE.BufferAttribute(cut.index, 1));
  geometry.clearGroups();
  for (const group of cut.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(cut.skinIndex, 4));
}

const CAP_NAME = "sever-stump";
/** Each stump's cap: the skin it closes, and the vertex of that skin each of its own vertices is on (-1 for a middle). */
const capRims = new WeakMap<THREE.SkinnedMesh, { skin: THREE.SkinnedMesh; rim: Int32Array }>();

/** A cap takes up the skin its rim's vertices wear now: a limb taken off after it gives its bones to its own stump. */
function reskinCap(cap: THREE.SkinnedMesh): void {
  const held = capRims.get(cap);
  if (!held) return;
  const worn = held.skin.geometry.getAttribute("skinIndex"), own = cap.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
  held.rim.forEach((v, i) => { if (v >= 0) for (let k = 0; k < 4; k += 1) own.setComponent(i, k, worn.getComponent(v, k)); });
  own.needsUpdate = true;
}

/**
 * One skinned mesh cut along the limb: the limb's piece, the body's side of the cut, the body's skin without the limb
 * (severPlan.ts stumpSkin: null when no bone of this skin can hold the stump), and a vertex of the body's side as it
 * is posed now in that skin. A vertex goes with the limb when the bone that moves it most, its slots summed (an
 * earlier cut may have given two of them to its stump), is the limb's, unless it is in `keep`.
 */
function cutMesh(mesh: THREE.SkinnedMesh, going: ReadonlySet<THREE.Object3D>, stump: THREE.Object3D, keep: ReadonlySet<number>): { limb: SeverPiece | null; stump: SeverStump | null; body: BodyCut | null; posed: (v: number) => THREE.Vector3 } | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
  const skinIndex = geometry.getAttribute("skinIndex"), skinWeight = geometry.getAttribute("skinWeight");
  if (!position || !skinIndex || !skinWeight) return null;
  const cutBones = mesh.skeleton.bones.map(bone => going.has(bone));
  if (!cutBones.some(Boolean)) return null;
  mesh.skeleton.update();
  const matrices = mesh.skeleton.boneMatrices as Float32Array | null;
  if (!matrices) return null;
  const pre = mesh.bindMatrix.elements, post = m4.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).elements.slice();
  const count = position.count, owner = new Uint8Array(count), bones = new Uint16Array(count * 4);
  let any = false;
  const weights = [0, 0, 0, 0];
  for (let v = 0; v < count; v += 1) {
    for (let k = 0; k < 4; k += 1) { bones[v * 4 + k] = skinIndex.getComponent(v, k); weights[k] = skinWeight.getComponent(v, k); }
    let best = 0, most = -1;
    for (let k = 0; k < 4; k += 1) {
      let w = 0;
      for (let j = 0; j < 4; j += 1) if (bones[v * 4 + j] === bones[v * 4 + k]) w += weights[j];
      if (w > most) { most = w; best = bones[v * 4 + k]; }
    }
    if (cutBones[best] && !keep.has(v)) { owner[v] = 1; any = true; }
  }
  if (!any) return null;
  const bonesOf = [0, 0, 0, 0], weightsOf = [0, 0, 0, 0], out = [0, 0, 0, 0, 0, 0];
  const reader = (slots: ArrayLike<number>) => (v: number, target: number[]) => {
    for (let k = 0; k < 4; k += 1) { bonesOf[k] = slots[v * 4 + k]; weightsOf[k] = skinWeight.getComponent(v, k); }
    skinVertex([position.getX(v), position.getY(v), position.getZ(v)], normal ? [normal.getX(v), normal.getY(v), normal.getZ(v)] : [0, 1, 0], bonesOf, weightsOf, matrices, pre, post, target);
  };
  const index = geometry.index ? geometry.index.array : null;
  const cut = severSkin({ count, index, owner, pose: reader(bones), uv: uv ? (v, target) => { target[0] = uv.getX(v); target[1] = uv.getY(v); } : null });
  // The body's side holds on the bone the stump hangs from, or the nearest above it that this skin uses.
  let hold = -1;
  for (let node: THREE.Object3D | null = stump; node && hold < 0; node = node.parent) hold = mesh.skeleton.bones.indexOf(node as THREE.Bone);
  if (hold < 0) return { ...cut, body: null, posed: v => { reader(bones)(v, out); return new THREE.Vector3(out[0], out[1], out[2]); } };
  const skin = new Uint16Array(bones), body = stumpSkin({ count, index, owner, groups: geometry.groups, skinIndex: skin, limbBones: cutBones, hold });
  const pose = reader(skin);
  return { ...cut, body: { mesh, index: body.index, groups: body.groups, skinIndex: skin, hold }, posed: v => { pose(v, out); return new THREE.Vector3(out[0], out[1], out[2]); } };
}

/**
 * The cap closing a stump on one mesh: a fan over each round of the cut, its rim on the body's own vertices along the
 * cut (their positions and the skin the body wears without the limb, so it seals the skin wherever the bones take it),
 * its middle held by the bone the stump hangs from, standing out a little from the cut as flesh swells from it.
 * `section` is what the cut goes through (severPlan.ts CUT_SECTION_CODE), drawn by the flesh.
 */
function stumpCap(
  body: BodyCut, stump: SeverStump, posed: (v: number) => THREE.Vector3, outward: THREE.Vector3, flesh: THREE.MeshStandardMaterial, section: number,
): { mesh: THREE.SkinnedMesh; rim: Int32Array; radius: number; rimCount: number; middle: THREE.Vector3 } | null {
  const mesh = body.mesh, skeleton = mesh.skeleton, geometry = mesh.geometry, hold = body.hold;
  const position = geometry.getAttribute("position"), skinWeight = geometry.getAttribute("skinWeight");
  // World to this skin's bind space for a vertex the holding bone carries alone.
  const toBind = m4b.copy(skeleton.bones[hold].matrixWorld).multiply(skeleton.boneInverses[hold]).multiply(mesh.bindMatrix).invert();
  const axisBind = outward.clone().transformDirection(toBind);
  const P: number[] = [], N: number[] = [], I: number[] = [], W: number[] = [], C: number[] = [], index: number[] = [], on: number[] = [], rimVertices = new Set<number>();
  let radiusSum = 0, rimCount = 0;
  const middleAll = new THREE.Vector3();
  for (let loop = 0; loop < stump.count; loop += 1) {
    const edges: [number, number][] = [];
    for (let e = 0; e < stump.loops.length; e += 1) if (stump.loops[e] === loop) edges.push([stump.edges[e * 2], stump.edges[e * 2 + 1]]);
    const rim = [...new Set(edges.flat())], world = new Map(rim.map(v => [v, posed(v)]));
    const centre = new THREE.Vector3();
    for (const v of rim) centre.add(world.get(v)!);
    centre.multiplyScalar(1 / rim.length);
    let radius = 0;
    for (const v of rim) radius += world.get(v)!.distanceTo(centre);
    radius /= rim.length;
    // Nothing the body draws is folded under it now: it stands out of the cut only as far as flesh swells.
    const hub = centre.clone().addScaledVector(outward, DOME * radius);
    const across = new THREE.Vector3().copy(Math.abs(outward.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).cross(outward).normalize();
    const along = new THREE.Vector3().crossVectors(outward, across);
    const slot = new Map<number, number>();
    for (const v of rim) {
      slot.set(v, P.length / 3);
      P.push(position.getX(v), position.getY(v), position.getZ(v));
      N.push(axisBind.x, axisBind.y, axisBind.z);
      for (let k = 0; k < 4; k += 1) { I.push(body.skinIndex[v * 4 + k]); W.push(skinWeight.getComponent(v, k)); }
      const d = world.get(v)!.clone().sub(centre), bearing = Math.atan2(d.dot(along), d.dot(across));
      C.push(1, Math.cos(bearing), Math.sin(bearing));
      rimVertices.add(v); on.push(v);
    }
    const middle = P.length / 3, bind = hub.clone().applyMatrix4(toBind);
    P.push(bind.x, bind.y, bind.z); N.push(axisBind.x, axisBind.y, axisBind.z); I.push(hold, 0, 0, 0); W.push(1, 0, 0, 0); C.push(0, 0, 0); on.push(-1);
    // The other way round from the body's triangle along each edge: the cap faces out of the body.
    for (const [a, b] of edges) index.push(slot.get(b)!, slot.get(a)!, middle);
    radiusSum += radius * rim.length; rimCount += rim.length; middleAll.addScaledVector(centre, rim.length);
  }
  if (!index.length) return null;
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  cap.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  cap.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(I, 4));
  cap.setAttribute("skinWeight", new THREE.Float32BufferAttribute(W, 4));
  cap.setAttribute("cut", new THREE.Float32BufferAttribute(C, 3));
  cap.setAttribute("section", new THREE.BufferAttribute(new Float32Array(P.length / 3).fill(section), 1));
  cap.setIndex(index);
  const skinned = new THREE.SkinnedMesh(cap, flesh);
  skinned.name = CAP_NAME;
  capRims.set(skinned, { skin: mesh, rim: Int32Array.from(on) });
  skinned.bindMode = mesh.bindMode;
  // The same skeleton and bind matrix as the skin it closes: it moves exactly as that skin does.
  skinned.bind(skeleton, mesh.bindMatrix);
  skinned.position.copy(mesh.position); skinned.quaternion.copy(mesh.quaternion); skinned.scale.copy(mesh.scale);
  skinned.frustumCulled = false;
  skinned.castShadow = false; skinned.receiveShadow = true;
  (mesh.parent ?? mesh).add(skinned);
  if (!mesh.parent) { skinned.position.set(0, 0, 0); skinned.quaternion.identity(); skinned.scale.set(1, 1, 1); }
  return { mesh: skinned, rim: Int32Array.from(rimVertices), radius: rimCount ? radiusSum / rimCount : 0, rimCount, middle: middleAll.multiplyScalar(1 / Math.max(1, rimCount)) };
}

/** The limb's piece: its cut skin in a box squared to the cut bone, with anything rigid it carried riding on it. */
function buildPiece(name: string, skins: { geometry: THREE.BufferGeometry; material: THREE.Material }[], clouds: Float32Array[], rotation: Q4, carried: THREE.Mesh[], flesh: THREE.Material): { piece: Piece; centre: V3; rotation: Q4; half: V3 } {
  const box = fitBox(clouds, rotation), centre = box.centre;
  const group = new THREE.Group();
  group.name = name;
  group.position.set(centre[0], centre[1], centre[2]);
  group.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  const geometries: THREE.BufferGeometry[] = [];
  for (const skin of skins) {
    const positions = skin.geometry.getAttribute("position").array as Float32Array, normals = skin.geometry.getAttribute("normal").array as Float32Array;
    intoFrame(positions, normals, centre, rotation);
    skin.geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(skin.geometry, [skin.material, flesh]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); geometries.push(skin.geometry);
  }
  const frame = m4.compose(p.set(centre[0], centre[1], centre[2]), q.set(rotation[0], rotation[1], rotation[2], rotation[3]), new THREE.Vector3(1, 1, 1)).clone().invert();
  for (const mesh of carried) {
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(frame).multiply(mesh.matrixWorld);
    copy.castShadow = true;
    group.add(copy);
  }
  return { piece: { group, geometries }, centre, rotation, half: clampHalf(box.half) };
}

/** What a severed hand held, as a piece of its own: a box round its meshes, squared to the weapon, wearing its own materials. */
function heldPiece(weapon: THREE.Object3D): { piece: Piece; centre: V3; rotation: Q4; half: V3 } | null {
  weapon.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  weapon.traverseVisible(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh && mesh.name !== "gore-decal" && mesh.name !== "gore-mark") meshes.push(mesh); });
  if (!meshes.length) return null;
  const corners = new Float32Array(meshes.length * 24), box = new THREE.Box3();
  meshes.forEach((mesh, n) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!);
    for (let c = 0; c < 8; c += 1) {
      p.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld);
      corners[n * 24 + c * 3] = p.x; corners[n * 24 + c * 3 + 1] = p.y; corners[n * 24 + c * 3 + 2] = p.z;
    }
  });
  const rotation = decompose(weapon.matrixWorld.elements).rotation, fitted = fitBox([corners], rotation), centre = fitted.centre;
  const group = new THREE.Group();
  group.name = `sever_${weapon.name}`;
  group.position.set(centre[0], centre[1], centre[2]);
  group.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  const frame = m4.compose(p.set(centre[0], centre[1], centre[2]), q.set(rotation[0], rotation[1], rotation[2], rotation[3]), new THREE.Vector3(1, 1, 1)).clone().invert();
  for (const mesh of meshes) {
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(frame).multiply(mesh.matrixWorld);
    copy.castShadow = true;
    group.add(copy);
  }
  return { piece: { group, geometries: [] }, centre, rotation, half: clampHalf(fitted.half) };
}

/**
 * Raw, wet flesh for a cut, drawn by hand as a burst's caps are, with no texture: the cut's own noise draws it. It
 * reads the `cut` attribute that severPlan.ts and the stump caps write: how far out from the cut's middle (1 on the
 * torn rim all round), and the bearing round it, which also lays the cut out as a disc. Out from the middle:
 *  - bone, a little off the middle, its outline lumpy: a pale cortex round dark, spongy marrow;
 *  - muscle, dark and wet, in a few bellies parted by thin pale sheaths, each belly a little darker or lighter and
 *    with its own grain, and the open ends of a few vessels in it;
 *  - fat under the skin, its inner edge wandering, stained by the blood;
 *  - a dark line where the skin was.
 * Fresh blood lies over it in patches, the glossiest thing on it, thickest round the vessels and towards the rim. The
 * surface is bent by its own relief (the bellies' swell, the bone standing out of flesh shrinking back from it, the
 * vessels' holes; a height turned into a bent normal, as the wound masks bend theirs), so the scene's lights catch it
 * as wet meat. Where the cut went through armour (the `section` attribute, the same on every vertex of a cap:
 * severPlan.ts CUT_SECTION_CODE) the rim shows its section first and the flesh lies inside it:
 *  - plate: a thin bright rim of steel, its inner edge in shadow, over a band of quilted padding;
 *  - mail: a ring of links, dark between them, over the padding;
 *  - cloth: a thin band of soaked cloth.
 * Every edge between them wanders by the noise. Drawn as even rings in flat colours, the layers read as a diagram of a
 * cut (the gore polish batch's stump stills). Detail too fine for the cut's size on screen fades out rather than
 * shimmer. One material a figure, for every cut on it and its limbs: what differs between them is in their attributes.
 * Pulled a hair towards the camera, so a cap is drawn over anything still folded into the joint under it.
 */
function fleshMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x5a0d0a, roughness: 0.24, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  material.name = "sever-flesh";
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 cut;\nattribute float section;\nvarying vec3 vCut;\nvarying float vSection;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCut = cut;\nvSection = section;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SECTION_PARS}`)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", SECTION_FRAGMENT)
      // Lit by its own normal on either face: a cap's fan folds over itself where its torn rim runs back on itself,
      // and a limb's cut end on a skin that is not closed is wound both ways; lit from behind, those show as lines.
      // Then bent by the cut's own relief.
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;\n${SECTION_NORMAL}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = cutRoughness;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = cutMetal;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += cutGleam;");
  };
  material.customProgramCacheKey = () => "crownfall-sever-flesh-3";
  return material;
}

/** Declared after `#include <common>`: the cut's attributes, and the noise that draws it. */
const SECTION_PARS = [
  "varying vec3 vCut;",
  "varying float vSection;",
  // A hash and a value noise over the cut laid out as a disc.
  "float cutHash( vec2 p ) {",
  "  vec3 q = fract( p.xyx * 0.1031 );",
  "  q += dot( q, q.yzx + 33.33 );",
  "  return fract( ( q.x + q.y ) * q.z );",
  "}",
  "float cutNoise( vec2 p ) {",
  "  vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );",
  "  return mix( mix( cutHash( i ), cutHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( cutHash( i + vec2( 0.0, 1.0 ) ), cutHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );",
  "}",
  // Cells (the muscle's bellies): how far inside its cell a point lies (the second-nearest centre's distance less the
  // nearest's: 0 on the wall between two cells), and its cell's own number.
  "vec2 cutCells( vec2 p ) {",
  "  vec2 i = floor( p ), f = fract( p );",
  "  float near = 8.0, next = 8.0, id = 0.0;",
  "  for ( int y = -1; y <= 1; y ++ ) {",
  "    for ( int x = -1; x <= 1; x ++ ) {",
  "      vec2 g = vec2( float( x ), float( y ) );",
  "      float d = length( g + vec2( cutHash( i + g ), cutHash( i + g + 17.31 ) ) - f );",
  "      if ( d < near ) { next = near; near = d; id = cutHash( i + g + 41.7 ); }",
  "      else if ( d < next ) next = d;",
  "    }",
  "  }",
  "  return vec2( next - near, id );",
  "}",
  // A height's screen-space slope turned into a bent normal (bump mapping on a surface with no tangents).
  "vec3 cutBend( vec3 at, vec3 n, vec2 slope ) {",
  "  vec3 across = dFdx( at ), down = dFdy( at );",
  "  vec3 r1 = cross( down, n ), r2 = cross( n, across );",
  "  float det = dot( across, r1 );",
  "  return normalize( abs( det ) * n - sign( det ) * ( slope.x * r1 + slope.y * r2 ) );",
  "}",
].join("\n");

/**
 * The colour, roughness, metal, gleam and relief (`cutH`) of a cut: out from its middle by `cutR` (0 to 1, following
 * the torn rim) and over the disc it is laid out as by `cutP` (round, whatever corners the rim has).
 */
const SECTION_FRAGMENT = [
  "float cutR = clamp( vCut.x, 0.0, 1.0 );",
  "vec2 cutP = vCut.yz;",
  "float cutA = atan( vCut.z, vCut.y + 1e-5 );",
  "float edgeAA = max( fwidth( cutR ), 1e-4 );",
  // How much of the disc a pixel covers: a pattern finer than about three pixels fades to its mean.
  "float cutPx = max( length( vec2( fwidth( cutP.x ), fwidth( cutP.y ) ) ) * 0.7, 1e-4 );",
  "float nBig = cutNoise( cutP * 2.6 + 7.1 ), nMid = cutNoise( cutP * 6.3 + 2.7 );",
  "float nFine = mix( 0.5, cutNoise( cutP * 19.0 + 11.3 ), 1.0 - smoothstep( 0.1, 0.3, cutPx * 19.0 ) );",
  // What was worn over the flesh, as shares of the cut's radius: the metal (plate's edge, mail's links), then the
  // padding under it (or the cloth itself), frayed unevenly. The flesh fills what is left.
  "float isPlate = step( 2.5, vSection ), isMail = step( 1.5, vSection ) - isPlate, isCloth = step( 0.5, vSection ) - step( 1.5, vSection );",
  "float shell = ( 0.075 * isPlate + 0.11 * isMail ) * ( 0.88 + 0.24 * nMid );",
  "float padding = ( 0.14 * ( isPlate + isMail ) + 0.09 * isCloth ) * ( 0.7 + 0.6 * nBig );",
  "float skinR = 1.0 - shell - padding;",
  "float fleshR = clamp( cutR / skinR, 0.0, 1.0 );",
  // The edges between the layers wander, at two scales.
  "float wander = ( nBig - 0.5 ) * 0.12 + ( nMid - 0.5 ) * 0.06;",
  "float dermis = smoothstep( 0.955 - edgeAA, 0.955 + edgeAA, fleshR + wander * 0.25 );",
  "float fat = smoothstep( 0.83 - 2.0 * edgeAA, 0.83 + 2.0 * edgeAA, fleshR + wander ) * ( 1.0 - dermis );",
  // Muscle: a few bellies, each a little darker or lighter with its own grain, parted by thin pale sheaths.
  "vec2 cells = cutCells( cutP * 1.9 + vec2( 3.1, 5.7 ) + ( vec2( nMid, nBig ) - 0.5 ) * 0.5 );",
  "float cellPx = max( fwidth( cells.x ), 1e-4 );",
  "float sheath = ( 1.0 - smoothstep( 0.02, 0.02 + max( 1.5 * cellPx, 0.02 ), cells.x ) ) * ( 1.0 - smoothstep( 0.015, 0.04, cellPx ) );",
  "float turn = cells.y * 6.2831853;",
  "vec2 fibre = vec2( cos( turn ), sin( turn ) );",
  "float grain = mix( 0.5, cutNoise( vec2( dot( cutP, fibre ) * 30.0, dot( cutP, vec2( -fibre.y, fibre.x ) ) * 4.0 ) + cells.y * 53.0 ), 1.0 - smoothstep( 0.1, 0.3, cutPx * 30.0 ) );",
  "vec3 cutColour = mix( vec3( 0.12, 0.013, 0.01 ), vec3( 0.3, 0.04, 0.03 ), clamp( 0.35 + 0.3 * cells.y + 0.3 * ( nMid - 0.5 ) + 0.35 * ( grain - 0.5 ), 0.0, 1.0 ) );",
  "cutColour = mix( cutColour, vec3( 0.3, 0.14, 0.11 ), 0.45 * sheath );",
  // Bone, a little off the middle, its outline lumpy: a pale cortex round dark, spongy marrow.
  "vec2 fromBone = cutP - vec2( 0.13, -0.09 );",
  "float boneD = length( fromBone ) / ( 0.22 * ( 0.8 + 0.4 * cutNoise( fromBone * 6.0 + 19.0 ) ) );",
  "float boneAA = max( fwidth( boneD ), 1e-3 );",
  "float bone = 1.0 - smoothstep( 1.0 - boneAA, 1.0 + boneAA, boneD );",
  "float marrow = 1.0 - smoothstep( 0.62 - boneAA, 0.62 + boneAA, boneD + ( nFine - 0.5 ) * 0.16 );",
  "float pores = mix( 0.5, cutNoise( cutP * 46.0 + 3.3 ), 1.0 - smoothstep( 0.1, 0.3, cutPx * 46.0 ) );",
  "vec3 boneColour = mix( vec3( 0.7, 0.62, 0.48 ) * ( 0.86 + 0.24 * nFine ), mix( vec3( 0.16, 0.035, 0.022 ), vec3( 0.4, 0.15, 0.075 ), pores ), marrow );",
  // The open ends of a few vessels, with blood welling round them.
  "float vessels = min( min( length( cutP - vec2( -0.34, 0.24 ) ) - 0.036, length( cutP - vec2( -0.12, -0.46 ) ) - 0.028 ), length( cutP - vec2( 0.42, 0.28 ) ) - 0.024 );",
  "float vesselAA = max( fwidth( vessels ), 1e-4 );",
  "float vessel = ( 1.0 - smoothstep( -vesselAA, vesselAA, vessels ) ) * ( 1.0 - bone );",
  "float welling = ( 1.0 - smoothstep( 0.0, 0.12, vessels ) ) * ( 1.0 - bone );",
  "vec3 fatColour = mix( mix( vec3( 0.5, 0.36, 0.17 ), vec3( 0.64, 0.48, 0.25 ), nFine ), vec3( 0.26, 0.045, 0.03 ), 0.2 + 0.5 * nMid );",
  "cutColour = mix( cutColour, fatColour, fat );",
  "cutColour = mix( cutColour, vec3( 0.17, 0.05, 0.038 ), dermis );",
  "cutColour = mix( cutColour, boneColour, bone );",
  // Fresh blood over it in patches, thickest round the vessels and out towards the rim: dark, and the glossiest
  // thing on it.
  "float film = max( smoothstep( 0.56, 0.82, nBig * 0.55 + nMid * 0.3 + nFine * 0.15 + 0.2 * fleshR - 0.12 * bone ), welling );",
  "cutColour = mix( cutColour, vec3( 0.07, 0.005, 0.004 ), 0.85 * film );",
  "cutColour = mix( cutColour, vec3( 0.02, 0.0016, 0.0014 ), vessel );",
  "float cutRoughness = mix( 0.42, 0.6, nFine );",
  "cutRoughness = mix( cutRoughness, 0.5, sheath );",
  "cutRoughness = mix( cutRoughness, 0.55, fat );",
  "cutRoughness = mix( cutRoughness, mix( 0.55, 0.36, marrow ), bone );",
  "cutRoughness = mix( cutRoughness, 0.18, film );",
  // Its relief: each belly swells a little from its sheath, the grain and the noise ripple it, the bone stands out
  // of the flesh shrinking back from it; blood lies smooth over what it fills; the vessels are holes.
  "float cutH = 0.35 * smoothstep( 0.0, 0.4, cells.x ) + 0.45 * ( nMid - 0.5 ) + 0.15 * ( grain - 0.5 ) + 0.45 * bone - 0.15 * fat;",
  "cutH = mix( cutH, 0.3 + 0.2 * nBig, 0.75 * film ) - 0.9 * vessel;",
  // Padding (a gambeson's linen, quilted in channels, each puffed between its seams) or the cloth (a plain weave),
  // soaked dark with blood towards the flesh, unevenly.
  "float padAt = clamp( ( cutR - skinR ) / max( padding, 1e-3 ), 0.0, 1.0 );",
  "float channel = fract( cutA * ( 22.0 / 6.2831853 ) );",
  "float seam = ( 1.0 - smoothstep( 0.0, 0.1, channel ) * ( 1.0 - smoothstep( 0.9, 1.0, channel ) ) ) * ( 1.0 - isCloth );",
  "vec3 padColour = mix( vec3( 0.6, 0.53, 0.4 ), vec3( 0.22, 0.17, 0.12 ), 0.85 * seam );",
  "padColour *= mix( 0.7 + 0.3 * sin( 3.14159265 * channel ), 1.0, isCloth ) * ( 0.9 + 0.1 * sin( cutA * 97.0 + padAt * 23.0 ) );",
  "padColour = mix( padColour, vec3( 0.2, 0.024, 0.016 ), clamp( 0.9 - 0.5 * padAt + 0.5 * ( nMid - 0.5 ) + 0.3 * ( nBig - 0.5 ), 0.3, 0.97 ) );",
  // Mail: a row of round links about the rim, dark between them, every other one catching the light.
  "float metalAt = clamp( ( cutR - ( 1.0 - shell ) ) / max( shell, 1e-3 ), 0.0, 1.0 );",
  "float around = cutA * ( 64.0 / 6.2831853 );",
  "float link = length( vec2( fract( around ) - 0.5, metalAt - 0.5 ) ) * 2.0;",
  "float ring = smoothstep( 0.36, 0.5, link ) * ( 1.0 - smoothstep( 0.82, 0.97, link ) );",
  "vec3 mailColour = mix( vec3( 0.05, 0.04, 0.04 ), vec3( 0.56, 0.57, 0.6 ) * ( 0.78 + 0.22 * step( 0.5, fract( around * 0.5 ) ) ), ring );",
  // Plate: bright steel, its inner edge (the thickness of the plate, seen across) in shadow.
  "vec3 plateColour = mix( vec3( 0.3, 0.31, 0.33 ), vec3( 0.8, 0.81, 0.84 ), smoothstep( 0.0, 0.35, metalAt ) );",
  "float inMetal = smoothstep( 1.0 - shell - edgeAA, 1.0 - shell + edgeAA, cutR ) * step( 1e-3, shell );",
  "float inWorn = smoothstep( skinR - edgeAA, skinR + edgeAA, cutR ) * step( 1e-3, shell + padding );",
  // The same blood thrown over the steel.
  "float onSteel = 1.0 - 0.6 * film;",
  "vec3 metalColour = mix( vec3( 0.07, 0.005, 0.004 ), isPlate * plateColour + isMail * mailColour, onSteel );",
  "cutColour = mix( cutColour, mix( padColour, metalColour, inMetal ), inWorn );",
  "cutRoughness = mix( cutRoughness, mix( 0.92, mix( 0.15, isPlate * 0.26 + isMail * mix( 0.9, 0.36, ring ), onSteel ), inMetal ), inWorn );",
  "float cutMetal = inWorn * inMetal * ( isPlate * 0.9 + isMail * 0.85 * ring ) * onSteel;",
  "cutH = mix( cutH, mix( 0.25 * sin( 3.14159265 * channel ) * ( 1.0 - isCloth ), 0.5 * ring * isMail + 0.3 * isPlate, inMetal ), inWorn );",
  // A little light of its own, so the steel reads bright in a dark hall too.
  "vec3 cutGleam = inWorn * inMetal * ( isPlate * 0.07 * plateColour + isMail * 0.04 * ring * mailColour ) * onSteel;",
  "vec4 diffuseColor = vec4( cutColour, opacity );",
].join("\n");

/**
 * After the normal is set: bent by the cut's relief, `CUT_RELIEF` of the cut's radius for each unit of `cutH`. The
 * radius is read off the screen (how far one pixel goes in view space against across the disc), so a Pawn's neck and
 * a Rook's arm are as deeply marked.
 */
const SECTION_NORMAL = [
  "const float CUT_RELIEF = 0.035;",
  "float cutSize = min( length( dFdx( vViewPosition ) ) / max( length( dFdx( cutP ) ), 1e-6 ), 0.5 );",
  "normal = cutBend( -vViewPosition, normal, vec2( dFdx( cutH ), dFdy( cutH ) ) * CUT_RELIEF * cutSize * ( 1.0 - smoothstep( 0.012, 0.035, cutPx ) ) );",
].join("\n");
