import * as THREE from "three";

const finitePoint = (value: THREE.Vector3 | null) => value !== null && Number.isFinite(value.x+value.y+value.z);

/** Analytic two-bone solve in world space. Segment lengths and local joint
 * translations are invariant; unreachable goals clamp to the limb's reach. */
export class TwoBoneIK {
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private bend = new THREE.Vector3(0, 0, 1);
  private desired = new THREE.Vector3();
  private target = new THREE.Vector3();
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private parent = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private delta = new THREE.Quaternion();
  private rotation = new THREE.Quaternion();

  constructor(readonly upper: THREE.Bone, readonly lower: THREE.Bone, readonly end: THREE.Bone, private readonly maxCorrection = Math.PI) {}

  private aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
    this.delta.setFromUnitVectors(from.normalize(), to.normalize());
    if (bone.parent) bone.parent.getWorldQuaternion(this.parent); else this.parent.identity();
    this.inverse.copy(this.parent).invert();
    this.rotation.copy(this.inverse).multiply(this.delta).multiply(this.parent).multiply(bone.quaternion);
    const angle = bone.quaternion.angleTo(this.rotation);
    bone.quaternion.slerp(this.rotation, Math.min(weight, this.maxCorrection / Math.max(angle, 1e-9))).normalize();
    bone.updateWorldMatrix(false, true);
  }

  /** `pole`, when given, is the world direction the middle joint bends toward (a knee forward), instead of
   * wherever the pose already bends it: a nearly straight limb has no bend of its own to keep. */
  solve(goal: THREE.Vector3, weight = 1, pole?: THREE.Vector3): boolean {
    if (!Number.isFinite(goal.x + goal.y + goal.z) || !Number.isFinite(weight) || weight <= 0) return false;
    weight = THREE.MathUtils.clamp(weight, 0, 1);
    this.upper.getWorldPosition(this.a); this.lower.getWorldPosition(this.b); this.end.getWorldPosition(this.c);
    const first = this.a.distanceTo(this.b), second = this.b.distanceTo(this.c);
    if (!Number.isFinite(first+second) || Math.min(first, second) < 1e-6) return false;
    this.direction.copy(goal).sub(this.a);
    const distance = this.direction.length();
    if (!Number.isFinite(distance) || distance < 1e-7) return false;
    this.direction.divideScalar(distance);
    const reach = THREE.MathUtils.clamp(distance, Math.abs(first - second) + 1e-6, first + second - 1e-6);
    this.target.copy(this.a).addScaledVector(this.direction, reach);
    if (pole && Number.isFinite(pole.x + pole.y + pole.z)) this.pole.copy(pole);
    else this.pole.copy(this.b).sub(this.a);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction));
    if (this.pole.lengthSq() < 1e-8) {
      this.pole.copy(this.bend).addScaledVector(this.direction, -this.bend.dot(this.direction));
      if (this.pole.lengthSq() < 1e-8) this.pole.set(1, 0, 0).addScaledVector(this.direction, -this.direction.x);
      if (this.pole.lengthSq() < 1e-8) this.pole.set(0, 1, 0).addScaledVector(this.direction, -this.direction.y);
    }
    this.pole.normalize(); this.bend.copy(this.pole);
    const along = (first * first - second * second + reach * reach) / (2 * reach);
    this.desired.copy(this.a).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, first * first - along * along)));
    this.aim(this.upper, this.from.copy(this.b).sub(this.a), this.to.copy(this.desired).sub(this.a), weight);
    this.lower.getWorldPosition(this.b); this.end.getWorldPosition(this.c);
    this.aim(this.lower, this.from.copy(this.c).sub(this.b), this.to.copy(this.target).sub(this.b), weight);
    return distance <= first + second;
  }
}

export type FootContactMode = "off" | "ground" | "plant";
/** A foot being re-set is in the air for this long and rises this far (world units). */
const RESTEP_SECONDS = 0.2, RESTEP_LIFT = 0.06;
interface Foot {
  side: "left" | "right";
  planted: boolean;
  chain: TwoBoneIK;
  offset: number;
  anchor: THREE.Vector3;
  orientation: THREE.Quaternion;
  /** A planted foot being lifted to where the body now needs it: 0 to 1, or null when it is down. */
  restep: { from: THREE.Vector3; to: THREE.Vector3; turn: THREE.Quaternion; progress: number } | null;
  /** Off the floor: mid-step, being re-set, or lifted by the clip's own foot marker. */
  aloft: boolean;
}
interface Pose { bone: THREE.Bone; quaternion: THREE.Quaternion; }

/** Optional corrections after the authored pose and secondary body reactions.
 * Restore before the next mixer sample, in reverse overlay order. */
export class ContactIK {
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly poses: Pose[] = [];
  private readonly feet: Foot[] = [];
  private readonly right: TwoBoneIK | null;
  private readonly left: TwoBoneIK | null;
  private readonly current = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly shaft = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly parent = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly correction = new THREE.Quaternion();
  private readonly normal = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private applied = false;
  private enabled = true;
  /** A staged step in progress: each foot is lifted and set down in turn while the body travels. */
  private stride: { delta: THREE.Vector3; progress: number; lift: number; starts: THREE.Vector3[]; windows: [number, number][] } | null = null;
  contactError: number | null = null;
  shieldError: number | null = null;
  /** Seconds since the last {@link apply}: what a foot being re-set advances by. */
  delta = 1 / 60;
  /**
   * A planted foot stays where it is while the body shifts over it, until the
   * pose wants it further than this from where it stands (world units). Then it
   * is picked up and set down there, one foot at a time: a step, not a slide.
   * 0 leaves planted feet where they are for good.
   */
  restepDistance = 0;
  /**
   * Told each time a foot that was off the floor is set down: the end of its half of a staged step, a
   * re-step landing, or the clip's own `foot_*_plant` marker. World x and z of the foot. Null: nobody asks.
   */
  onFootDown: ((x: number, z: number) => void) | null = null;

  constructor(
    private readonly frame: THREE.Object3D, model: THREE.Object3D,
    private readonly weapon: THREE.Object3D | null, private readonly shield: THREE.Object3D | null,
  ) {
    model.traverse(node => {
      if ((node as THREE.Bone).isBone) this.bones.set(node.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, ""), node as THREE.Bone);
    });
    this.right = this.chain("right", "arm");
    this.left = this.chain("left", "arm");
    frame.updateWorldMatrix(true, true); frame.getWorldPosition(this.goal);
    for (const side of ["left", "right"] as const) {
      const chain = this.chain(side, "leg");
      if (chain) {
        chain.end.getWorldPosition(this.current);
        this.feet.push({ side, planted: false, chain, offset: Math.max(0, this.current.y - this.goal.y), anchor: new THREE.Vector3(), orientation: new THREE.Quaternion(), restep: null, aloft: false });
      }
    }
    const affected = new Set<THREE.Bone>();
    for (const chain of [this.right, this.left, ...this.feet.map(foot => foot.chain)]) {
      if (chain) for (const bone of [chain.upper, chain.lower, chain.end]) affected.add(bone);
    }
    for (const bone of affected) this.poses.push({ bone, quaternion: new THREE.Quaternion() });
  }

  private chain(side: "left" | "right", type: "arm" | "leg"): TwoBoneIK | null {
    // Alias and hierarchy checks adapted from PR #3. Matching names alone do
    // not establish a compatible skeleton (twist helpers may sit in between).
    const find = (names: string[]) => names.map(name => this.bones.get(name)).find(Boolean);
    const upper = find((type === "arm" ? ["arm", "upperarm", "uparm"] : ["upleg", "thigh", "upperleg"]).map(n => side+n));
    const lower = find((type === "arm" ? ["forearm", "lowerarm", "elbow"] : ["leg", "calf", "lowerleg"]).map(n => side+n));
    const end = find(type === "arm" ? [side+"hand", "hand"+side] : [side+"foot", "foot"+side]);
    const ancestor = (parent: THREE.Bone, child: THREE.Bone) => {
      for (let node = child.parent; node; node = node.parent) if (node === parent) return true;
      return false;
    };
    return upper && lower && end && ancestor(upper, lower) && ancestor(lower, end)
      ? new TwoBoneIK(upper, lower, end, type === "leg" ? .65 : .35) : null;
  }

  restore(): void {
    if (!this.applied) return;
    for (const pose of this.poses) pose.bone.quaternion.copy(pose.quaternion);
    this.applied = false;
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.reset(); }
  reset(): void { this.restore(); this.releaseFeet(); this.contactError = this.shieldError = null; }
  releaseFeet(): void { for (const foot of this.feet) { foot.planted = false; foot.restep = null; foot.aloft = false; } this.stride = null; }

  /**
   * Starts a step that carries the body `delta` across the floor. The foot
   * that is ahead in the direction of travel goes first; the other stays where
   * it is until the first is down, then follows. Drive it with {@link stepTo}.
   */
  beginStep(delta: THREE.Vector3, lift = .07): boolean {
    if (!this.enabled || this.feet.length < 2 || !Number.isFinite(delta.x + delta.z) || delta.lengthSq() < 1e-6) return false;
    this.frame.updateWorldMatrix(true, true);
    const starts = this.feet.map(foot => {
      if (!foot.planted) { foot.chain.end.getWorldPosition(foot.anchor); foot.chain.end.getWorldQuaternion(foot.orientation); }
      return foot.anchor.clone();
    });
    const ahead = starts.map(start => start.x * delta.x + start.z * delta.z);
    const first = ahead[0] >= ahead[1] ? 0 : 1;
    this.stride = { delta: delta.clone().setY(0), progress: 0, lift, starts, windows: this.feet.map((_, index) => index === first ? [0, .56] : [.44, 1]) };
    for (const foot of this.feet) { foot.planted = true; foot.restep = null; }
    return true;
  }
  /** 0 to 1 along the step begun with {@link beginStep}; 1 sets both feet down and ends it. */
  stepTo(progress: number): void {
    if (!this.stride) return;
    this.stride.progress = THREE.MathUtils.clamp(progress, 0, 1);
  }
  get stepping(): boolean { return this.stride !== null; }
  /** The right hand: the grip end of the weapon line. */
  handPoint(out: THREE.Vector3): THREE.Vector3 | null { return this.right?.end.getWorldPosition(out) ?? null; }
  /** Where the foot nearer the floor is now, in the world: on a march's footfall, the boot that has just come down. Null with no legs. */
  lowerFoot(out: THREE.Vector3): THREE.Vector3 | null {
    let found = false;
    for (const foot of this.feet) {
      foot.chain.end.getWorldPosition(this.current);
      if (!found || this.current.y < out.y) out.copy(this.current);
      found = true;
    }
    return found ? out : null;
  }
  /** The way the shield's face points. */
  shieldNormal(out: THREE.Vector3): THREE.Vector3 | null { return this.shield?.getWorldDirection(out) ?? null; }
  plantFeet(): void {
    this.frame.updateWorldMatrix(true, true);
    for (const foot of this.feet) {
      // With re-stepping on, a foot already down stays down: it is moved by a step when the body needs it elsewhere.
      if (this.restepDistance > 0 && foot.planted) continue;
      foot.chain.end.getWorldPosition(foot.anchor); foot.chain.end.getWorldQuaternion(foot.orientation);
      foot.planted = true; foot.restep = null;
    }
  }

  torsoPoint(out: THREE.Vector3): THREE.Vector3 {
    const torso = this.bones.get("spine02") ?? this.bones.get("spine2") ?? this.bones.get("chest") ?? this.bones.get("spine");
    if (torso) return torso.getWorldPosition(out);
    this.frame.getWorldPosition(out); out.y += .4; return out;
  }

  /** The torso bone itself and the weapon socket, for marks that ride on them (gore/WoundRenderer.ts). */
  torsoNode(): THREE.Object3D | null { return this.bones.get("spine02") ?? this.bones.get("spine2") ?? this.bones.get("chest") ?? this.bones.get("spine") ?? null; }
  weaponNode(): THREE.Object3D | null { return this.weapon; }
  weaponPoint(out: THREE.Vector3): THREE.Vector3 | null { return this.weapon?.getWorldPosition(out) ?? null; }
  shieldPoint(out: THREE.Vector3): THREE.Vector3 | null { return this.shield?.getWorldPosition(out) ?? null; }
  /** Optional VFX must not turn a missing bone into a synthetic body contact. */
  bodyPoint(name: "torso" | "head", out: THREE.Vector3): THREE.Vector3 | null {
    const bone = name === "head" ? this.bones.get("head")
      : this.bones.get("spine02") ?? this.bones.get("spine2") ?? this.bones.get("chest") ?? this.bones.get("spine");
    return bone?.getWorldPosition(out) ?? null;
  }
  preferredReach(): number | null {
    if (!this.weapon || !this.right) return null;
    this.right.upper.getWorldPosition(this.current); this.right.lower.getWorldPosition(this.hand);
    const upper = this.current.distanceTo(this.hand);
    this.right.end.getWorldPosition(this.goal);
    const lower = this.hand.distanceTo(this.goal);
    this.weapon.getWorldPosition(this.current);
    return this.current.distanceTo(this.goal) + (upper + lower) * .7;
  }

  private orient(bone: THREE.Bone, world: THREE.Quaternion, weight: number): void {
    if (bone.parent) bone.parent.getWorldQuaternion(this.parent); else this.parent.identity();
    this.rotation.copy(this.parent).invert().multiply(world);
    const angle = bone.quaternion.angleTo(this.rotation);
    bone.quaternion.slerp(this.rotation, Math.min(weight, .5 / Math.max(angle, 1e-9))).normalize(); bone.updateWorldMatrix(false, true);
  }

  private solveSocket(chain: TwoBoneIK, marker: THREE.Object3D, target: THREE.Vector3, weight: number): number {
    marker.getWorldPosition(this.current); chain.end.getWorldPosition(this.hand);
    const length = this.current.distanceTo(this.hand);
    chain.upper.getWorldPosition(this.current); this.desired.copy(target).sub(this.current).normalize();
    this.goal.copy(target).addScaledVector(this.desired, -length); chain.solve(this.goal, weight);
    marker.getWorldPosition(this.current); chain.end.getWorldPosition(this.hand);
    this.shaft.copy(this.current).sub(this.hand).normalize(); this.desired.copy(target).sub(this.hand).normalize();
    if (this.shaft.lengthSq() > .1 && this.desired.lengthSq() > .1) {
      this.correction.setFromUnitVectors(this.shaft, this.desired);
      chain.end.getWorldQuaternion(this.rotation); this.correction.multiply(this.rotation);
      this.orient(chain.end, this.correction, weight);
    }
    marker.getWorldPosition(this.current); return this.current.distanceTo(target);
  }

  private solveShield(target: THREE.Vector3, threat: THREE.Vector3 | null, weight: number): number {
    const chain = this.left!, marker = this.shield!;
    marker.getWorldPosition(this.current); chain.end.getWorldPosition(this.hand);
    this.shaft.copy(this.current).sub(this.hand);
    chain.end.getWorldQuaternion(this.rotation);
    if (threat) {
      marker.getWorldDirection(this.normal);
      this.desired.copy(threat).sub(this.current).setY(0).normalize();
      if (this.desired.lengthSq() > .1) {
        this.correction.setFromUnitVectors(this.normal, this.desired);
        const angle = this.identity.angleTo(this.correction);
        this.correction.slerp(this.identity, 1-Math.min(weight, .35/Math.max(angle, 1e-9)));
        this.shaft.applyQuaternion(this.correction);
        this.rotation.premultiply(this.correction);
      }
    }
    // Keep the shield's face orientation while solving its centre. Treating
    // this short offset as a spear shaft can flip the shield back to front.
    this.goal.copy(target).sub(this.shaft);
    this.correction.copy(this.rotation);
    chain.solve(this.goal, weight);
    this.orient(chain.end, this.correction, 1);
    marker.getWorldPosition(this.current); return this.current.distanceTo(target);
  }

  apply(groundY: number, footMode: FootContactMode, weaponGoal: THREE.Vector3 | null, weaponWeight: number, shieldGoal: THREE.Vector3 | null, shieldWeight = .8, contacts?: { left: boolean | null; right: boolean | null }, shieldThreat: THREE.Vector3 | null = null): void {
    this.contactError = this.shieldError = null;
    if (!finitePoint(weaponGoal)) weaponGoal = null;
    if (!finitePoint(shieldGoal)) shieldGoal = null;
    if (!finitePoint(shieldThreat)) shieldThreat = null;
    weaponWeight = Number.isFinite(weaponWeight) ? THREE.MathUtils.clamp(weaponWeight, 0, 1) : 0;
    shieldWeight = Number.isFinite(shieldWeight) ? THREE.MathUtils.clamp(shieldWeight, 0, 1) : 0;
    if (!Number.isFinite(groundY)) footMode = "off";
    if (!this.enabled || ((!weaponGoal || weaponWeight <= 0) && (!shieldGoal || shieldWeight <= 0) && footMode === "off")) return;
    this.frame.updateWorldMatrix(true, true);
    for (const pose of this.poses) pose.quaternion.copy(pose.bone.quaternion);
    this.applied = true; this.contactError = this.shieldError = null;
    if (footMode !== "off") {
      const stride = this.stride;
      if (stride) {
        this.feet.forEach((foot, index) => {
          const [from, to] = stride.windows[index];
          const u = THREE.MathUtils.smootherstep(stride.progress, from, to);
          foot.anchor.copy(stride.starts[index]).addScaledVector(stride.delta, u);
          this.goal.copy(foot.anchor);
          this.goal.y = groundY + foot.offset + Math.sin(Math.PI * u) * stride.lift;
          foot.chain.solve(this.goal);
          this.orient(foot.chain.end, foot.orientation, 1);
          foot.planted = true;
          if (u > 0 && u < 1) foot.aloft = true;
          else if (u >= 1 && foot.aloft) { foot.aloft = false; this.onFootDown?.(foot.anchor.x, foot.anchor.z); }
        });
        if (stride.progress >= 1) this.stride = null;
      } else for (const foot of this.feet) {
        const mode = contacts?.[foot.side] === true ? "plant" : contacts?.[foot.side] === false ? "ground" : footMode;
        foot.chain.end.getWorldPosition(this.current);
        if (!foot.planted) {
          foot.anchor.copy(this.current); foot.chain.end.getWorldQuaternion(foot.orientation);
        }
        let lift = 0;
        if (mode === "plant" && foot.planted && this.restepDistance > 0) {
          const step = foot.restep;
          if (step) {
            step.progress = Math.min(1, step.progress + this.delta / RESTEP_SECONDS);
            const u = THREE.MathUtils.smootherstep(step.progress, 0, 1);
            foot.anchor.lerpVectors(step.from, step.to, u); foot.orientation.slerp(step.turn, u);
            lift = Math.sin(Math.PI * u) * RESTEP_LIFT;
            foot.aloft = true;
            if (step.progress >= 1) { foot.restep = null; foot.aloft = false; this.onFootDown?.(foot.anchor.x, foot.anchor.z); }
          } else if (Math.hypot(this.current.x - foot.anchor.x, this.current.z - foot.anchor.z) > this.restepDistance && !this.feet.some(other => other.restep)) {
            foot.restep = { from: foot.anchor.clone(), to: this.current.clone(), turn: foot.chain.end.getWorldQuaternion(new THREE.Quaternion()), progress: 0 };
          }
        } else foot.restep = null;
        this.goal.copy(mode === "plant" ? foot.anchor : this.current);
        this.goal.y = groundY + foot.offset + lift;
        if (mode === "plant" || this.current.y < this.goal.y) {
          foot.chain.solve(this.goal);
          if (mode === "plant") this.orient(foot.chain.end, foot.orientation, 1);
        }
        foot.planted = mode === "plant";
        // The clip's own foot markers: lifted, then set down. A clip with no markers says nothing either way.
        const marked = contacts?.[foot.side];
        if (marked === false) foot.aloft = true;
        else if (marked === true) { if (foot.aloft && !foot.restep) { foot.aloft = false; this.onFootDown?.(this.current.x, this.current.z); } }
        else if (!foot.restep) foot.aloft = false;
      }
    } else this.releaseFeet();
    if (weaponGoal && this.weapon && this.right && weaponWeight > 0) {
      // Treat the real grip-to-tip vector as the third rigid segment. Solve
      // the arm to its grip FIRST; then wrist orientation can put the socket
      // on contact without chasing a changing offset between iterations.
      this.contactError = this.solveSocket(this.right, this.weapon, weaponGoal, weaponWeight);
    }
    if (shieldGoal && this.shield && this.left && shieldWeight > 0) {
      this.shieldError = this.solveShield(shieldGoal, shieldThreat, shieldWeight);
    }
  }
}
