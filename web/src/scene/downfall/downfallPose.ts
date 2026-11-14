import * as THREE from "three";
import { TwoBoneIK } from "../contactIK";
import { KNEEL_FRONT, KNEEL_SINK, KNEEL_STEP, KNEEL_TOTAL, type DefeatRole, type VictorRole } from "./downfallPlan";

/**
 * A figure's part in the downfall, layered over its held stance like the living rig's reactions: the beaten
 * look up, bow, let their arms fall slack and go down on one knee (or, the Queen, stand with her head bowed);
 * the victors raise their weapons, breathe out or watch the beaten King. Every weight is a function of the
 * downfall's clock, so a skip or a replay lands on exactly the same pose.
 *
 * Restored before the next mixer sample, like `LivingPieceRig` and `ContactIK`. The kneel is solved, not
 * keyed: from the figure's own leg lengths it finds where the rear knee touches the stone, steps that foot back
 * (a lifted step, never a slide), lowers the hips over it while the front foot stays planted where it stood,
 * and pivots the rear foot up onto its toes about the ball of the foot, which stays where it was set down.
 */

export interface DownfallClock { time: number; }

export type DownfallCast =
  | { readonly side: "defeat"; readonly role: DefeatRole }
  | { readonly side: "victor"; readonly role: VictorRole; readonly longArm: boolean };

interface Leg { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone; toe: THREE.Bone | null; ik: TwoBoneIK; }
interface Arm { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; ik: TwoBoneIK; }

/** What the kneel was solved to, once, from the held stance. All world space. */
interface Kneel {
  ground: number;
  front: Leg; rear: Leg;
  frontSide: 1 | -1;
  /** The front ankle standing, and where it is set down when the kneel steps it forward to fit the square. */
  frontAnkle: THREE.Vector3; frontLanding: THREE.Vector3; frontFoot: THREE.Quaternion;
  rearAnkle: THREE.Vector3; rearFoot: THREE.Quaternion; rearToe: THREE.Quaternion | null;
  /** Ball of the rear foot standing, and where it is set down behind. */
  rearBall: THREE.Vector3; ball: THREE.Vector3;
  /** The rear ankle where the step lands it: the heel already a little off the stone. */
  landing: THREE.Vector3;
  /** Turns the standing rear foot onto its toes. */
  pivot: THREE.Quaternion;
  /** The toes' own length axis in the toe bone's frame. */
  toeAxis: THREE.Vector3 | null;
  hips: THREE.Vector3; kneeled: THREE.Vector3;
  /** How far along their path the hips are when the front foot is down, and when the rear foot is. */
  frontShare: number;
  stepShare: number;
  tilt: number;
  forward: THREE.Vector3;
}

interface Stand { ground: number; legs: { leg: Leg; ankle: THREE.Vector3; foot: THREE.Quaternion }[]; hips: THREE.Vector3; raised: THREE.Vector3; }

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, "");
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ramp = (t: number, from: number, to: number) => clamp01((t - from) / Math.max(1e-6, to - from));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
/** Seconds over which a beaten figure's living layer (its glance, breath and the army's mood) gives way to its part. */
export const LIVING_HANDOVER = 0.6;
const inOut = (t: number) => { const c = clamp01(t); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
const bump = (t: number) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
/** The last small give of the hips as the knee takes the weight, in figure heights. */
const SINK_GIVE = 0.008;
const UP = new THREE.Vector3(0, 1, 0);

/** Seconds the held stance takes to settle before the legs are measured (PieceView.holdStance's fade). */
export const STANCE_FADE = 0.35;
/** How far onto its toes the rear foot already is when the step sets it down. */
const LANDING_PITCH = 0.35;

export class DownfallPose {
  /**
   * Whether the downfall now has this figure's body: a beaten figure's, from the moment its own part begins (before,
   * it lives and breathes as it did). The living layer under it is eased out over {@link LIVING_HANDOVER}.
   */
  get ownsBody(): boolean { return this.cast.side === "defeat" && this.clock.time >= this.cast.role.start; }
  /** How much of the living layer (glance, breath, the army's mood) a figure still keeps: 1 until its part begins, then down to 0. */
  get livingWeight(): number {
    if (this.cast.side !== "defeat") return 1;
    const since = this.clock.time - this.cast.role.start;
    return since <= 0 ? 1 : 1 - smooth(since / LIVING_HANDOVER);
  }
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly saved: { bone: THREE.Bone; base: THREE.Quaternion }[] = [];
  private readonly hips: THREE.Bone | null;
  private readonly hipsBase = new THREE.Vector3();
  private readonly spine: THREE.Bone[] = [];
  private readonly neck: THREE.Bone | null;
  private readonly head: THREE.Bone | null;
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private applied = false;
  /**
   * A beaten figure at rest (its part over, the downfall's clock stopped): its pose, without the breath, kept so
   * the final tableau costs a copy and a breath a frame instead of a solve. The stance under it is a held frame.
   */
  private rest: { at: number; quaternions: THREE.Quaternion[]; hips: THREE.Vector3 } | null = null;
  private lastTime = -1;
  private kneel: Kneel | null = null;
  private contact: number | null = null;
  /** How far down a kneeling figure is, 0 standing to 1 on its knee (its crest comes down with it). */
  sink = 0;
  private stand: Stand | null = null;
  private failed = false;
  // scratch
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly bowAxis = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly parentQ = new THREE.Quaternion();
  // each helper's own scratch, so a direction handed to it is never the vector it writes
  private readonly sideA = new THREE.Vector3();
  private readonly sideB = new THREE.Vector3();
  private readonly aimFrom = new THREE.Vector3();
  private readonly aimTo = new THREE.Vector3();
  private readonly aimTurn = new THREE.Quaternion();
  private readonly aimLocal = new THREE.Quaternion();
  private readonly chain = new THREE.Vector3();
  private readonly chainRoot = new THREE.Vector3();
  private readonly turnAxis = new THREE.Vector3();
  private readonly turnInverse = new THREE.Quaternion();
  private readonly turnBy = new THREE.Quaternion();
  private readonly placed = new THREE.Vector3();
  private readonly footTurn = new THREE.Quaternion();

  /**
   * @param reachBack how far behind the middle of its square (world units) a kneeling figure may set its rear foot:
   *   it stays on its own square.
   */
  constructor(private readonly container: THREE.Object3D, private readonly frame: THREE.Object3D, private readonly cast: DownfallCast,
    private readonly clock: DownfallClock, private readonly height: number, private readonly reachBack = 0.46) {
    frame.traverse(node => { if ((node as THREE.Bone).isBone) { const name = key(node.name); if (!this.bones.has(name)) this.bones.set(name, node as THREE.Bone); } });
    const find = (...names: string[]) => names.map(name => this.bones.get(name)).find(Boolean) ?? null;
    this.hips = find("hips", "pelvis");
    this.head = find("head");
    this.neck = find("neck");
    // The spine is whatever stands between the hips and the neck, read from the hierarchy (Meshy's rig numbers it downward).
    const top = this.neck ?? this.head;
    if (top && this.hips) for (let node = top.parent; node && node !== this.hips; node = node.parent) if ((node as THREE.Bone).isBone) this.spine.unshift(node as THREE.Bone);
    const ancestor = (parent: THREE.Object3D, child: THREE.Object3D) => { for (let n = child.parent; n; n = n.parent) if (n === parent) return true; return false; };
    for (const side of ["left", "right"]) {
      const upper = find(`${side}upleg`, `${side}thigh`, `${side}upperleg`), lower = find(`${side}leg`, `${side}calf`, `${side}lowerleg`), foot = find(`${side}foot`);
      if (upper && lower && foot && ancestor(upper, lower) && ancestor(lower, foot)) this.legs.push({ upper, lower, foot, toe: find(`${side}toebase`, `${side}toe`), ik: new TwoBoneIK(upper, lower, foot) });
      const arm = find(`${side}arm`, `${side}upperarm`), fore = find(`${side}forearm`, `${side}lowerarm`), hand = find(`${side}hand`);
      if (arm && fore && hand && ancestor(arm, fore) && ancestor(fore, hand)) this.arms.push({ upper: arm, lower: fore, hand, ik: new TwoBoneIK(arm, fore, hand) });
    }
    const touched = new Set<THREE.Bone>();
    for (const bone of [this.hips, ...this.spine, this.neck, this.head]) if (bone) touched.add(bone);
    for (const leg of this.legs) for (const bone of [leg.upper, leg.lower, leg.foot, leg.toe]) if (bone) touched.add(bone);
    for (const arm of this.arms) for (const bone of [arm.upper, arm.lower, arm.hand]) touched.add(bone);
    for (const bone of touched) this.saved.push({ bone, base: new THREE.Quaternion() });
  }

  /** Whether the rig has what a kneel needs. */
  get canKneel(): boolean { return !!this.hips && this.legs.length === 2; }

  /**
   * The instant (downfall clock) the rear knee meets the stone: the hips come down to the height the kneel was
   * solved for, the knee resting on the stone there (the last small give carries them through it). Null until the
   * kneel is solved, a moment after the figure learns of the defeat, and for a figure that does not kneel.
   */
  get kneelContact(): number | null {
    const k = this.kneel, cast = this.cast;
    if (!k || cast.side !== "defeat") return null;
    if (this.contact === null) {
      const drop = k.hips.y - k.kneeled.y, give = SINK_GIVE * this.height;
      const above = (s: number) => (1 - (k.stepShare + (1 - k.stepShare) * inOut(s))) * drop - give * bump((s - 0.8) / 0.2);
      let s = 1;
      for (let i = 1; i <= 400; i += 1) if (above(i / 400) <= 0) { s = i / 400; break; }
      if (s < 1) { let lo = s - 1 / 400, hi = s; for (let i = 0; i < 20; i += 1) { const mid = (lo + hi) / 2; if (above(mid) <= 0) hi = mid; else lo = mid; } s = hi; }
      this.contact = cast.role.kneel + KNEEL_FRONT + KNEEL_STEP + s * KNEEL_SINK;
    }
    return this.contact;
  }

  /** Always before the animation mixer: puts back exactly what the mixer sampled. */
  restore(): void {
    if (!this.applied) return;
    for (const entry of this.saved) entry.bone.quaternion.copy(entry.base);
    this.hips?.position.copy(this.hipsBase);
    this.applied = false;
  }

  /**
   * After the mixer and the living rig. `elapsed` is the scene's running time: the slow breath of the beaten goes on
   * after the downfall's own clock has stopped.
   */
  apply(elapsed = this.clock.time): void {
    if (!this.saved.length) return;
    const t = this.clock.time;
    for (const entry of this.saved) entry.base.copy(entry.bone.quaternion);
    if (this.hips) this.hipsBase.copy(this.hips.position);
    this.applied = true;
    const still = t === this.lastTime;
    this.lastTime = t;
    if (this.rest && still && this.rest.at === t && this.cast.side === "defeat") {
      this.saved.forEach((entry, index) => entry.bone.quaternion.copy(this.rest!.quaternions[index]));
      this.hips?.position.copy(this.rest.hips);
      this.frame.updateWorldMatrix(true, true);
      this.prepareAxes();
      this.breathe(this.cast.role, elapsed);
      return;
    }
    this.rest = null;
    this.frame.updateWorldMatrix(true, true);
    this.prepareAxes();
    try {
      if (this.cast.side === "defeat") {
        this.defeat(this.cast.role, t);
        // At rest and the clock stopped: keep the pose (before its breath) for the frames that follow.
        if (still && t >= this.restsAt(this.cast.role)) {
          this.rest = { at: t, quaternions: this.saved.map(entry => entry.bone.quaternion.clone()), hips: this.hips ? this.hips.position.clone() : new THREE.Vector3() };
        }
        this.breathe(this.cast.role, elapsed);
      } else this.victor(this.cast.role, this.cast.longArm, t);
    } catch (error) {
      // A rig this cannot pose is left as its clips have it, rather than torn.
      if (!this.failed) console.warn("[downfall] pose skipped", error);
      this.failed = true;
      this.restore();
    }
  }

  private prepareAxes(): void {
    this.container.getWorldPosition(this.origin);
    this.frame.getWorldDirection(this.forward).setY(0);
    if (this.forward.lengthSq() < 1e-8) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    // Rotating about up x forward by a positive angle leans a figure forward.
    this.bowAxis.crossVectors(UP, this.forward).normalize();
  }

  /** When a beaten figure's part is over and it only breathes. */
  private restsAt(role: DefeatRole): number {
    return Math.max(role.kneel + KNEEL_TOTAL, role.breaks + 2.2, role.drop + 0.8, role.start + 2.4) + 0.05;
  }

  /**
   * The breath: hard and fast while the King still stands defiant, slow and heavy once they are down. Last, on the
   * chest and the head, so a figure at rest needs nothing else redone.
   */
  private breathe(role: DefeatRole, elapsed: number): void {
    const t = this.clock.time;
    if (t < role.start) return;
    const heave = role.royal ? ramp(t, 0.3, 0.9) * (1 - inOut((t - role.breaks) / 0.9)) : 0;
    const calm = ramp(t, (role.royal ? role.breaks : role.start) + 0.8, (role.royal ? role.breaks : role.start) + 2.2);
    const breath = Math.sin((elapsed / 4.6 + role.phase) * Math.PI * 2) * 0.024 * calm * (1 - heave)
      + Math.sin((elapsed / 1.5 + role.phase) * Math.PI * 2) * 0.03 * heave;
    if (Math.abs(breath) < 1e-6) return;
    const chest = this.spine[this.spine.length - 1];
    if (chest) this.rotateWorld(chest, this.bowAxis, breath);
    if (this.head) this.rotateWorld(this.head, this.bowAxis, -breath * 0.4);
  }

  // ------------------------------------------------------------------ the beaten

  private defeat(role: DefeatRole, t: number): void {
    if (t < role.start) return;
    const kneeling = role.gesture === "kneel" && this.canKneel;
    const measureAt = role.start + STANCE_FADE + 0.03;
    // ---- the legs and the hips first: everything above rides on them
    let down = 0, settled = 0;
    if (kneeling && t >= measureAt) {
      this.kneel ??= this.solveKneel(role);
      if (this.kneel) { const progress = this.kneelPose(this.kneel, role, t); down = progress.down; settled = progress.settled; this.sink = down; }
    } else if (!kneeling && this.canKneel && t >= Math.max(role.breaks, measureAt)) {
      this.stand ??= this.solveStand();
      if (this.stand) this.standPose(this.stand, inOut((t - role.breaks) / 1.2));
    }
    // ---- the realization: the King draws breath and stands defiant; the rest look to him
    const king = role.royal;
    let bow = 0, head = 0, gaze = 0;
    if (king) {
      const breaking = inOut((t - role.breaks) / 0.9);
      const defiance = ramp(t, 0.3, 0.9) * (1 - breaking);
      bow = -0.07 * defiance - 0.06 * bump((t - 0.05) / 0.7);
      head = -0.1 * defiance;
      gaze = smooth(ramp(t, 0.05, 0.4)) * (1 - smooth((t - role.breaks) / 1.2));
      const bowing = inOut((t - role.breaks - 0.15) / 1.3);
      bow += 0.26 * bowing + 0.1 * down;
      head += 0.5 * bowing;
    } else {
      gaze = smooth(ramp(t, role.start, role.start + 0.3)) * (1 - smooth((t - role.breaks) / 0.45));
      const bowing = inOut((t - role.breaks) / 1.0);
      bow = (role.gesture === "bow" ? 0.2 : 0.28) * bowing + 0.1 * down;
      head = (role.gesture === "bow" ? 0.46 : 0.4) * bowing;
    }
    this.upperBody(bow, head, gaze, role.glance);
    // ---- the arms: slack once the hands have opened; on a knee, the hand on the raised knee rests on it
    const slack = inOut((t - role.drop - 0.05) / 0.6);
    const rest = this.kneel ? smooth(ramp(settled, 0.35, 1)) : 0;
    for (const arm of this.arms) {
      const side = this.sideOf(arm.upper);
      if (this.kneel && side === this.kneel.frontSide && rest > 0) {
        this.hang(arm, side, slack * (1 - rest));
        this.handOnKnee(arm, side, this.kneel, rest);
      } else this.hang(arm, side, slack);
    }
  }

  private sideOf(bone: THREE.Bone): 1 | -1 {
    bone.getWorldPosition(this.sideA);
    if (this.hips) this.hips.getWorldPosition(this.sideB); else this.sideB.copy(this.origin);
    return this.sideA.sub(this.sideB).dot(this.right) >= 0 ? 1 : -1;
  }

  /** Finds where this figure's rear knee meets the stone and everything that follows from it. */
  private solveKneel(role: DefeatRole): Kneel | null {
    const hips = this.hips;
    if (!hips || this.legs.length !== 2) return null;
    const h = this.height, ground = this.origin.y;
    const f = this.forward.clone();
    const H0 = hips.getWorldPosition(new THREE.Vector3());
    const position = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3());
    // The foot already behind goes back to the stone: a stance that stands one foot back kneels on that knee. Only
    // with the feet side by side does the plan's choice decide.
    const [first, second] = this.legs;
    const back = (leg: Leg) => position(leg.foot).sub(H0).dot(f);
    const gap = back(first) - back(second);
    const want = role.rearSide === "right" ? 1 : -1;
    const rear = Math.abs(gap) > 0.05 * h ? (gap < 0 ? first : second) : this.sideOf(first.upper) === want ? first : second;
    const front = rear === first ? second : first;
    const frontSide: 1 | -1 = this.sideOf(front.upper);
    const rotation = (bone: THREE.Bone) => bone.getWorldQuaternion(new THREE.Quaternion());
    const Af0 = position(front.upper), Ar0 = position(rear.upper);
    const l1 = Ar0.distanceTo(position(rear.lower)), l2 = position(rear.lower).distanceTo(position(rear.foot));
    const lf1 = Af0.distanceTo(position(front.lower)), lf2 = position(front.lower).distanceTo(position(front.foot));
    const Cf0 = position(front.foot), Cr0 = position(rear.foot);
    const Tr0 = rear.toe ? position(rear.toe) : Cr0.clone().addScaledVector(f, 0.08 * h).setY(ground + 0.02 * h);
    const footLength = Math.max(0.03 * h, Cr0.distanceTo(Tr0));
    const ballHeight = Math.max(0.004 * h, Tr0.y - ground);
    // Where the rear knee rests: on the stone, as thick as a knee.
    const kneeHeight = 0.03 * h;
    const ankleHeight = ballHeight + footLength * 0.96;
    const lift = THREE.MathUtils.clamp((ankleHeight - kneeHeight) / l2, 0.05, 0.75), across = Math.sqrt(1 - lift * lift);
    const tilt = 0.12;
    const turn = new THREE.Quaternion().setFromAxisAngle(this.bowAxis, tilt);
    const frontOffset = Af0.clone().sub(H0).applyQuaternion(turn), rearOffset = Ar0.clone().sub(H0).applyQuaternion(turn);
    const lateral = Ar0.clone().sub(this.origin).dot(this.right);
    const lean = 0.14;
    // The hip joints for a rear knee `s` along the facing: the thigh stands almost upright over the knee.
    const frontHip = (s: number) => this.origin.clone().addScaledVector(f, s).addScaledVector(this.right, lateral).setY(ground + kneeHeight)
      .addScaledVector(UP, l1 * Math.cos(lean)).addScaledVector(f, l1 * Math.sin(lean)).sub(rearOffset).add(frontOffset);
    // The front leg bends to about a right angle at the knee: its foot as far from its hip as the two bones' diagonal.
    const reachFront = Math.min(0.74 * (lf1 + lf2), Math.hypot(lf1, lf2) * 1.02);
    const base = frontHip(0), toFoot = Cf0.clone().sub(base);
    const along = toFoot.dot(f), aside = toFoot.clone().addScaledVector(f, -along).length();
    let s = along - Math.sqrt(Math.max(0, reachFront * reachFront - aside * aside));
    const onToes = new THREE.Vector3().copy(UP).multiplyScalar(-0.96).addScaledVector(f, -0.28).normalize();
    // The ball of the rear foot, for a rear knee `s` along the facing: behind the knee by the shin, then the foot.
    const ballFor = (at: number) => this.origin.clone().addScaledVector(f, at - l2 * across).addScaledVector(this.right, lateral)
      .setY(ground + kneeHeight + l2 * lift).addScaledVector(onToes, footLength);
    // Never off its own square: the rear foot rests within reachBack of the square's middle. Where the stance would
    // carry it over the edge, the whole kneel moves forward: the front foot steps forward first (no further than
    // reachBack ahead either), and what that cannot give the front leg gives by folding (never past 0.42 of its length).
    const behind = -ballFor(s).sub(this.origin).dot(f);
    let advance = 0;
    if (behind > this.reachBack) {
      const need = behind - this.reachBack;
      advance = Math.min(need, Math.max(0, this.reachBack - Cf0.clone().sub(this.origin).dot(f)));
      const fold = 0.42 * (lf1 + lf2);
      const tightest = along + advance - Math.sqrt(Math.max(0, fold * fold - aside * aside));
      s = Math.min(s + need, Math.max(s + advance, tightest));
    }
    const Cf1 = Cf0.clone().addScaledVector(f, advance);
    const knee = this.origin.clone().addScaledVector(f, s).addScaledVector(this.right, lateral).setY(ground + kneeHeight);
    const rearHip = knee.clone().addScaledVector(UP, l1 * Math.cos(lean)).addScaledVector(f, l1 * Math.sin(lean));
    const kneeled = rearHip.clone().sub(rearOffset);
    const ankle = knee.clone().addScaledVector(f, -l2 * across).addScaledVector(UP, l2 * lift);
    const ball = ankle.clone().addScaledVector(onToes, footLength);
    const pivot = new THREE.Quaternion().setFromUnitVectors(Tr0.clone().sub(Cr0).normalize(), onToes);
    // The foot comes down on its ball with the heel already rising (LANDING_PITCH of the way onto its toes).
    const landing = Cr0.clone().sub(Tr0).applyQuaternion(new THREE.Quaternion().slerp(pivot, LANDING_PITCH)).add(ball);
    let toeAxis: THREE.Vector3 | null = null;
    if (rear.toe) {
      const flat = Tr0.clone().sub(Cr0).setY(0);
      if (flat.lengthSq() > 1e-10) toeAxis = flat.normalize().applyQuaternion(rotation(rear.toe).invert());
    }
    // The hips go down (and forward or back) with the steps, as far as each stepping leg needs to reach where it is
    // set down: a body lowers itself as it steps into a kneel. A foot is never set down where its leg cannot reach,
    // and the foot that stays down is never pulled off the stone.
    const reach = 0.98 * (l1 + l2), reachF = 0.98 * (lf1 + lf2);
    const hipAt = (offset: THREE.Vector3, p: number) => H0.clone().lerp(kneeled, p).add(offset.clone().applyQuaternion(this.q.setFromAxisAngle(this.bowAxis, tilt * p)));
    const rearStanding = Ar0.clone().sub(H0), frontStanding = Af0.clone().sub(H0);
    const least = (from: number, to: number, fits: (p: number) => boolean) => {
      if (fits(from)) return from;
      let found = to;
      for (let lo = from, hi = to, i = 0; i < 16; i += 1) { const mid = (lo + hi) / 2; if (fits(mid)) { hi = mid; found = mid; } else lo = mid; }
      return found;
    };
    const frontShare = advance > 0.005
      ? least(0, 0.6, p => hipAt(frontStanding, p).distanceTo(Cf1) <= reachF && hipAt(rearStanding, p).distanceTo(Cr0) <= reach)
      : 0.06;
    const stepShare = least(Math.max(0.12, frontShare), 0.92, p => hipAt(rearStanding, p).distanceTo(landing) <= reach && hipAt(frontStanding, p).distanceTo(Cf1) <= reachF);
    return {
      ground, front, rear, frontSide, frontAnkle: Cf0, frontLanding: Cf1, frontFoot: rotation(front.foot), rearAnkle: Cr0, rearFoot: rotation(rear.foot),
      rearToe: rear.toe ? rotation(rear.toe) : null, rearBall: Tr0, ball, landing, pivot, toeAxis, hips: H0, kneeled,
      frontShare, stepShare, tilt, forward: f,
    };
  }

  /** The kneel at time `t`. Returns how far down the figure is (0..1) and how settled (0..1, the hand's cue). */
  private kneelPose(k: Kneel, role: DefeatRole, t: number): { down: number; settled: number } {
    const h = this.height;
    const forward = clamp01((t - role.kneel) / KNEEL_FRONT);
    const step = clamp01((t - role.kneel - KNEEL_FRONT) / KNEEL_STEP);
    const sink = clamp01((t - role.kneel - KNEEL_FRONT - KNEEL_STEP) / KNEEL_SINK);
    const p = sink > 0 ? k.stepShare + (1 - k.stepShare) * inOut(sink)
      : step > 0 ? k.frontShare + (k.stepShare - k.frontShare) * inOut(step)
      : k.frontShare * inOut(forward);
    // ---- hips: down and back over the rear knee, the pelvis tipping forward; a last small give as the knee takes the weight
    const hips = this.hips!;
    this.goal.lerpVectors(k.hips, k.kneeled, p);
    this.goal.y -= SINK_GIVE * h * bump((sink - 0.8) / 0.2);
    this.setWorldPosition(hips, this.goal);
    this.rotateWorld(hips, this.bowAxis, k.tilt * p);
    // ---- the front foot stays exactly where it stood, or is lifted and set down a little ahead first
    const ahead = forward * forward * forward * (forward * (forward * 6 - 15) + 10);
    this.goal.lerpVectors(k.frontAnkle, k.frontLanding, ahead);
    if (k.frontLanding.distanceToSquared(k.frontAnkle) > 1e-8) this.goal.addScaledVector(UP, Math.sin(Math.PI * forward) * 0.03 * h);
    this.pole.copy(k.forward).addScaledVector(this.right, 0.12 * k.frontSide);
    k.front.ik.solve(this.goal, 1, this.pole);
    this.setWorldQuaternion(k.front.foot, k.frontFoot);
    // ---- the rear foot: lifted and set down behind (foot flat), then up onto its toes about the ball
    const turned = this.footTurn.identity();
    if (sink <= 0) {
      const u = step * step * step * (step * (step * 6 - 15) + 10);
      turned.slerpQuaternions(this.q2.identity(), k.pivot, LANDING_PITCH * u);
      this.goal.lerpVectors(k.rearAnkle, k.landing, u).addScaledVector(UP, Math.sin(Math.PI * step) * 0.03 * h);
    } else {
      turned.slerpQuaternions(this.q2.identity(), k.pivot, LANDING_PITCH + (1 - LANDING_PITCH) * smooth(ramp(sink, 0.05, 0.85)));
      this.goal.copy(k.rearAnkle).sub(k.rearBall).applyQuaternion(turned).add(k.ball);
    }
    this.pole.copy(k.forward).addScaledVector(this.right, -0.08 * k.frontSide);
    k.rear.ik.solve(this.goal, 1, this.pole);
    this.q2.copy(turned).multiply(k.rearFoot);
    this.setWorldQuaternion(k.rear.foot, this.q2);
    // The toes stay on the stone: as the heel rises they bend back to lie flat behind the ball.
    if (k.rear.toe && k.toeAxis && (sink > 0 || step > 0)) {
      const bend = sink > 0 ? LANDING_PITCH + (1 - LANDING_PITCH) * smooth(ramp(sink, 0.05, 0.85)) : LANDING_PITCH * smooth(step);
      k.rear.toe.getWorldQuaternion(this.q2);
      this.a.copy(k.toeAxis).applyQuaternion(this.q2);
      this.b.copy(k.forward).negate().setY(-0.08).normalize();
      this.c.copy(this.a).lerp(this.b, bend).normalize();
      this.aimWorld(k.rear.toe, this.a, this.c, 1);
    }
    return { down: p, settled: sink };
  }

  /** The Queen stands to bow: her stance comes up out of its crouch, her feet where they stood. */
  private solveStand(): Stand | null {
    const hips = this.hips;
    if (!hips || this.legs.length !== 2) return null;
    const ground = this.origin.y, h = this.height;
    const H0 = hips.getWorldPosition(new THREE.Vector3());
    const legs = this.legs.map(leg => ({ leg, ankle: leg.foot.getWorldPosition(new THREE.Vector3()), foot: leg.foot.getWorldQuaternion(new THREE.Quaternion()) }));
    let lift = 0;
    for (let lo = 0, hi = 0.08 * h, i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      const ok = legs.every(({ leg, ankle }) => {
        const hip = leg.upper.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, mid);
        return hip.distanceTo(ankle) <= 0.97 * (leg.upper.getWorldPosition(this.a).distanceTo(leg.lower.getWorldPosition(this.b)) + this.b.distanceTo(leg.foot.getWorldPosition(this.c)));
      });
      if (ok) { lift = mid; lo = mid; } else hi = mid;
    }
    return { ground, legs, hips: H0, raised: H0.clone().addScaledVector(UP, lift) };
  }

  private standPose(stand: Stand, p: number): void {
    const hips = this.hips!;
    this.goal.lerpVectors(stand.hips, stand.raised, p);
    this.setWorldPosition(hips, this.goal);
    for (const { leg, ankle, foot } of stand.legs) {
      this.pole.copy(this.forward);
      leg.ik.solve(ankle, 1, this.pole);
      this.setWorldQuaternion(leg.foot, foot);
    }
  }

  // ------------------------------------------------------------------ the victors

  private victor(role: VictorRole, longArm: boolean, t: number): void {
    if (t < role.start) return;
    let bow = 0, head = 0, gaze = 0;
    if (role.gesture === "raise") {
      const up = smooth((t - role.start) / 0.5), back = smooth((t - role.start - 2.7) / 1.4);
      const w = up * (1 - 0.65 * back);
      bow = -0.04 * w; head = -0.08 * w;
      for (const arm of this.arms) {
        const side = this.sideOf(arm.upper);
        // The weapon hand, and both hands on a long arm that is held in both.
        if (side !== 1 && !longArm) continue;
        this.a.copy(this.forward).multiplyScalar(0.42).addScaledVector(UP, 0.9).addScaledVector(this.right, 0.16 * side).normalize();
        this.b.copy(this.forward).multiplyScalar(0.2).addScaledVector(UP, 0.98).normalize();
        this.aimChain(arm, this.a, this.b, w);
      }
    } else if (role.gesture === "relief") {
      const inhale = bump((t - role.start) / 0.7), out = smooth((t - role.start - 0.6) / 1.6);
      bow = -0.05 * inhale + 0.04 * out; head = -0.07 * smooth((t - role.start) / 0.8);
    } else {
      // The Queen and the victorious sovereign: chin up, watching the beaten King; the sovereign nods once.
      const w = smooth((t - role.start) / 0.9);
      head = -0.05 * w + (role.nod !== null ? 0.2 * bump((t - role.nod) / 1.5) : 0);
      bow = -0.02 * w;
      gaze = w;
    }
    this.upperBody(bow, head, gaze, role.look);
  }

  // ------------------------------------------------------------------ shared moves

  /** Bends the spine and head forward (positive) or back, and turns the head toward `look`. */
  private upperBody(bow: number, head: number, gaze: number, look: { x: number; z: number } | null): void {
    let yaw = 0;
    if (look && gaze > 0) {
      this.a.set(look.x - this.origin.x, 0, look.z - this.origin.z);
      if (this.a.lengthSq() > 1e-6) {
        this.a.normalize();
        const dot = THREE.MathUtils.clamp(this.forward.dot(this.a), -1, 1), cross = this.forward.z * this.a.x - this.forward.x * this.a.z;
        yaw = THREE.MathUtils.clamp(Math.atan2(cross, dot), -0.7, 0.7) * gaze;
      }
    }
    const count = this.spine.length;
    this.spine.forEach((bone, index) => {
      const share = count === 1 ? 1 : [0.38, 0.34, 0.28, 0.2][Math.min(3, index)] / (count >= 3 ? 1 : 0.72);
      this.rotateWorld(bone, this.bowAxis, bow * share);
      if (index === count - 1) this.rotateWorld(bone, UP, yaw * 0.2);
    });
    if (this.neck) { this.rotateWorld(this.neck, this.bowAxis, head * 0.3); this.rotateWorld(this.neck, UP, yaw * 0.3); }
    if (this.head) { this.rotateWorld(this.head, this.bowAxis, head * 0.7); this.rotateWorld(this.head, UP, yaw * 0.5); }
  }

  /** The arm let fall: hanging a little out from the body and a little forward, the elbow soft. */
  private hang(arm: Arm, side: 1 | -1, weight: number): void {
    if (weight <= 0.001) return;
    this.a.copy(UP).multiplyScalar(-0.94).addScaledVector(this.forward, 0.1).addScaledVector(this.right, 0.2 * side).normalize();
    this.b.copy(UP).multiplyScalar(-0.9).addScaledVector(this.forward, 0.32).addScaledVector(this.right, 0.05 * side).normalize();
    this.aimChain(arm, this.a, this.b, weight);
  }

  /** The hand on the raised knee: the wrist just above and behind the kneecap, the elbow out. */
  private handOnKnee(arm: Arm, side: 1 | -1, k: Kneel, weight: number): void {
    const h = this.height;
    k.front.lower.getWorldPosition(this.goal);
    this.goal.addScaledVector(UP, 0.05 * h).addScaledVector(this.forward, -0.03 * h).addScaledVector(this.right, -0.012 * h * side);
    this.pole.copy(this.right).multiplyScalar(0.6 * side).addScaledVector(this.forward, -0.6).addScaledVector(UP, -0.3);
    arm.ik.solve(this.goal, weight, this.pole);
  }

  private aimChain(arm: Arm, upperDirection: THREE.Vector3, lowerDirection: THREE.Vector3, weight: number): void {
    arm.lower.getWorldPosition(this.chain); arm.upper.getWorldPosition(this.chainRoot);
    this.chain.sub(this.chainRoot);
    this.aimWorld(arm.upper, this.chain, upperDirection, weight);
    arm.hand.getWorldPosition(this.chain); arm.lower.getWorldPosition(this.chainRoot);
    this.chain.sub(this.chainRoot);
    this.aimWorld(arm.lower, this.chain, lowerDirection, weight);
  }

  /** Turns `bone` so the world direction `from` (from the bone) goes toward `to`, by `weight`. */
  private aimWorld(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12 || weight <= 0) return;
    this.aimTurn.setFromUnitVectors(this.aimFrom.copy(from).normalize(), this.aimTo.copy(to).normalize());
    if (bone.parent) bone.parent.getWorldQuaternion(this.parentQ); else this.parentQ.identity();
    this.aimLocal.copy(this.parentQ).invert().multiply(this.aimTurn).multiply(this.parentQ).multiply(bone.quaternion);
    bone.quaternion.slerp(this.aimLocal, clamp01(weight)).normalize();
    bone.updateWorldMatrix(false, true);
  }

  private rotateWorld(bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-6) return;
    bone.getWorldQuaternion(this.turnInverse).invert();
    this.turnAxis.copy(axis).applyQuaternion(this.turnInverse).normalize();
    bone.quaternion.multiply(this.turnBy.setFromAxisAngle(this.turnAxis, angle)).normalize();
    bone.updateWorldMatrix(false, true);
  }

  private setWorldPosition(bone: THREE.Bone, world: THREE.Vector3): void {
    if (bone.parent) { bone.parent.updateWorldMatrix(true, false); bone.position.copy(bone.parent.worldToLocal(this.placed.copy(world))); }
    else bone.position.copy(world);
    bone.updateWorldMatrix(false, true);
  }

  private setWorldQuaternion(bone: THREE.Bone, world: THREE.Quaternion): void {
    if (bone.parent) bone.parent.getWorldQuaternion(this.parentQ); else this.parentQ.identity();
    bone.quaternion.copy(this.parentQ.invert().multiply(world)).normalize();
    bone.updateWorldMatrix(false, true);
  }
}
