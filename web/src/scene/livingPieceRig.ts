import * as THREE from "three";
import type { BoardReactionCue } from "./boardReactionDirector";
import { cueEnvelope, partingWeight } from "./battleEmotion";

interface Joint {
  bone: THREE.Bone;
  base: THREE.Quaternion;
  torso: number;
  head: number;
  arm: number;
  /** The pelvis: only the duel layer turns it (the hips lead a thrust). */
  hips: number;
  /** The shield arm: it trails the torso's turn. */
  shield: number;
  applied: boolean;
}

/** Additive reactions on each figure's own skeleton, layered over its clips.
 * Restores the exact sampled pose before the next mixer evaluation. No joint
 * translation, board anchor, material, geometry or shared clip is modified. */
export class LivingPieceRig {
  private readonly joints: Joint[] = [];
  private readonly inverse = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly recoilAxis = new THREE.Vector3(1, 0, 0);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private enabled = true;
  private dying = false;
  private guard = false;
  private attention = 0;
  private strength = 0;
  private recoil = 0;
  private recoilVelocity = 0;
  private heldSeconds = 0;
  private observation: BoardReactionCue | null = null;
  private observationTime = 0;
  private readonly observerTarget = new THREE.Vector3();
  private readonly observerAxis = new THREE.Vector3(1, 0, 0);
  /** The look's weight at the last frame, handed on when it is let go. */
  private observationWeight = 0;
  // ---- the look being let go: it fades from where it stood while the next one comes in, so no look snaps off
  private parting: BoardReactionCue | null = null;
  private partingTime = 0;
  private partingSince = 0;
  private partingFrom = 0;
  private partingDelay = 0;
  private partingFade = .32;
  private readonly partingTarget = new THREE.Vector3();
  private readonly partingAxis = new THREE.Vector3(1, 0, 0);
  /** Eased to 0 while the figure marches: a held look gives way to the walk instead of snapping off. */
  private watch = 1;
  private readonly flinchHead = new THREE.Vector3();
  private readonly flinchBody = new THREE.Vector3();
  private readonly flinchAxis = new THREE.Vector3();
  // ---- mood: the army's morale in the figure's carriage and breath while it stands (battleBonds.ts)
  private slump = 0;
  private tension = 0;
  private pride = 0;
  private slumpTarget = 0;
  private tensionTarget = 0;
  private prideTarget = 0;
  private moodWeight = 0;
  private breathPhase: number;
  private quiet = false;
  // ---- the duel layer: life between and through the beats of a fight
  /** The opponent's chest, read every frame while a duel is on. */
  private opponent: ((out: THREE.Vector3) => THREE.Vector3 | null) | null = null;
  private duelWeight = 0;
  /** The guard's weight, eased while a duel is on so a dropped guard never snaps the chest round. */
  private guardWeight = 0;
  private track = 0;
  private lead = 0;
  private leadVelocity = 0;
  private leadSeconds = 0;
  private armLag = 0;
  private chestYaw: number | null = null;
  private readonly rival = new THREE.Vector3();
  private readonly chestForward = new THREE.Vector3();
  private readonly chestQuaternion = new THREE.Quaternion();

  constructor(private readonly frame: THREE.Object3D, model: THREE.Object3D, private readonly phase = 0) {
    this.breathPhase = phase;
    model.traverse(node => {
      if (!(node as THREE.Bone).isBone) return;
      const name = node.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, "");
      const torso = /^(spine(?:0?[0-3])?|chest|upperchest)$/.test(name) ? .36 : 0;
      const head = name === "head" ? .75 : name === "neck" ? .25 : 0;
      const arm = /^(leftarm|rightarm|leftupperarm|rightupperarm|upperarml|upperarmr)$/.test(name) ? 1 : 0;
      const hips = /^(hips|pelvis)$/.test(name) ? 1 : 0;
      const shield = arm && /^(left|upperarml)/.test(name) ? 1 : 0;
      if (torso || head || arm || hips) this.joints.push({ bone: node as THREE.Bone, base: new THREE.Quaternion(), torso, head, arm, hips, shield, applied: false });
    });
  }

  get jointCount(): number { return this.joints.length; }
  get hasReaction(): boolean {
    return this.guard || this.attention > 0 || this.observation !== null || this.parting !== null || Math.abs(this.recoil) + Math.abs(this.recoilVelocity) > .0001
      || this.opponent !== null || this.duelWeight > .001 || this.guardWeight > .001 || Math.abs(this.lead) + Math.abs(this.leadVelocity) > .0001
      || (this.moodWeight > .002 && this.slump + this.tension + this.pride > .002);
  }
  get inDuel(): boolean { return this.opponent !== null; }

  /**
   * A duel begins: until {@link disengage} the head and spine follow the
   * opponent, the chest breathes hard, the weight shifts from foot to foot,
   * the shield arm trails the torso's turns, and a hit rings and settles
   * instead of stopping dead. `opponent` writes the rival's chest into `out`.
   */
  engage(opponent: (out: THREE.Vector3) => THREE.Vector3 | null): void {
    if (!this.enabled || this.dying || !this.joints.length) return;
    this.opponent = opponent; this.chestYaw = null;
  }
  disengage(): void { this.opponent = null; this.leadSeconds = 0; }
  /** The hips turn into a thrust for `seconds`, ahead of the chest, then swing back past rest and settle. */
  drive(seconds: number): void {
    if (this.enabled && !this.dying && this.opponent) this.leadSeconds = THREE.MathUtils.clamp(seconds, 0, .6);
  }

  /** A new look. One already held fades out as this one comes in, so a change of look never snaps. */
  observe(cue: BoardReactionCue): void {
    if (!this.enabled || this.dying || !this.joints.length) return;
    this.part(cue.delay, cue.onset ?? .18);
    this.observation = cue; this.observationTime = 0; this.observationWeight = 0;
    this.observerTarget.set(cue.target.x, cue.target.y, cue.target.z);
  }
  /** Lets the look go: it eases back from where it stands, unless `immediate` (a reset, a death). */
  clearObservation(immediate = false): void {
    if (immediate) this.parting = null; else this.part(0, .32);
    this.observation = null; this.observationTime = 0; this.observationWeight = 0;
  }
  setQuiet(quiet: boolean): void { this.quiet = quiet; }
  /**
   * The army's morale as the figure carries it while it stands: `slump` (0..1) bows the head, drops the arms and slows
   * and deepens the breath; `tension` (0..1) lifts the guard and quickens the breath and the glances; `pride` (0..1)
   * lifts the chin. It changes over a few seconds; `immediate` sets it at once (a figure just placed on a rebuilt board).
   */
  setMood(slump: number, tension: number, pride: number, immediate = false): void {
    const unit = (value: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    this.slumpTarget = unit(slump); this.tensionTarget = unit(tension); this.prideTarget = unit(pride);
    if (immediate) { this.slump = this.slumpTarget; this.tension = this.tensionTarget; this.pride = this.prideTarget; }
  }

  /** The held look becomes the parting one (or a parting one keeps fading from where it is). */
  private part(delay: number, fade: number): void {
    const current = this.observation ? this.observationWeight : 0, fading = this.partingNow();
    if (this.observation && current > .002 && current >= fading) {
      this.parting = this.observation; this.partingTime = this.observationTime; this.partingFrom = current;
      this.partingTarget.copy(this.observerTarget); this.partingAxis.copy(this.observerAxis);
    } else if (this.parting && fading > .002) this.partingFrom = fading;
    else { this.parting = null; return; }
    this.partingSince = 0; this.partingDelay = Math.max(0, delay); this.partingFade = Math.max(.05, fade);
  }
  private partingNow(): number {
    return this.parting ? partingWeight(this.partingFrom, this.partingSince, this.partingDelay, this.partingFade) : 0;
  }

  /**
   * After apply: keeps only `weight` (0..1) of what it added this frame, so another layer can take the body over
   * without a snap (the downfall eases it out as a beaten figure's own part begins).
   */
  fade(weight: number): void {
    const w = THREE.MathUtils.clamp(weight, 0, 1);
    if (w >= 1) return;
    for (const joint of this.joints) if (joint.applied) joint.bone.quaternion.slerpQuaternions(joint.base, joint.bone.quaternion.clone(), w);
  }

  /** Always call before the animation mixer (including a zero-time pose). */
  restore(): void {
    for (const joint of this.joints) if (joint.applied) {
      joint.bone.quaternion.copy(joint.base); joint.applied = false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  brace(point: THREE.Vector3): void {
    if (!this.enabled || this.dying) return;
    this.target.copy(point); this.guard = true; this.attention = 1.8; this.strength = 1;
  }

  notice(point: THREE.Vector3, strength: number): void {
    if (!this.enabled || this.dying) return;
    this.target.copy(point); this.attention = 1.2;
    this.strength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  impact(direction: THREE.Vector3, strength = 1): void {
    if (!this.enabled || this.dying) return;
    this.direction.copy(direction).setY(0);
    if (this.direction.lengthSq() < .000001) return;
    this.direction.normalize();
    this.recoilAxis.crossVectors(this.up, this.direction).normalize();
    this.guard = false; this.attention = 0;
    // An angular impulse gives an immediate flinch, followed by a damped
    // recovery. Clamp repeated hits so a figure never folds inside out.
    const power = THREE.MathUtils.clamp(strength, .2, 2);
    this.recoil = Math.min(.3, this.recoil + .09 * power);
    this.recoilVelocity = Math.min(4.5, this.recoilVelocity + 2.3 * power);
  }

  hold(seconds: number): void {
    if (this.enabled) this.heldSeconds = Math.max(this.heldSeconds, THREE.MathUtils.clamp(seconds, 0, .14));
  }

  /** Holds just the actor's clip on contact, never the game/world clock. */
  animationDelta(delta: number): number {
    const step = Math.max(0, delta), held = Math.min(step, this.heldSeconds);
    this.heldSeconds -= held;
    return step - held;
  }

  beginDeath(): void {
    this.dying = true; this.guard = false; this.attention = 0; this.heldSeconds = 0;
    this.opponent = null; this.leadSeconds = 0;
    // The blow that kills it hides any look it held; the corpse carries no mood.
    this.clearObservation(true); this.moodWeight = 0;
  }

  reset(): void {
    this.restore(); this.guard = false; this.dying = false; this.attention = 0;
    this.strength = 0; this.recoil = 0; this.recoilVelocity = 0; this.heldSeconds = 0;
    this.clearObservation(true); this.quiet = false; this.watch = 1;
    this.slump = this.tension = this.pride = this.slumpTarget = this.tensionTarget = this.prideTarget = this.moodWeight = 0;
    this.opponent = null; this.duelWeight = 0; this.guardWeight = 0; this.track = 0; this.lead = 0; this.leadVelocity = 0;
    this.leadSeconds = 0; this.armLag = 0; this.chestYaw = null;
  }

  private rotate(joint: Joint, worldAxis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < .00001) return;
    joint.bone.getWorldQuaternion(this.inverse).invert();
    this.axis.copy(worldAxis).applyQuaternion(this.inverse).normalize();
    this.rotation.setFromAxisAngle(this.axis, angle);
    joint.bone.quaternion.multiply(this.rotation).normalize();
  }

  /** The clamped turn toward a target on the board, writing the axis a flinch away from it recoils about. */
  private bearing(target: THREE.Vector3, axis: THREE.Vector3): number {
    this.direction.copy(target).sub(this.origin).setY(0);
    if (this.direction.lengthSq() < 1e-8) return 0;
    this.direction.normalize();
    const dot = THREE.MathUtils.clamp(this.forward.dot(this.direction), -1, 1);
    const cross = this.forward.z*this.direction.x-this.forward.x*this.direction.z;
    axis.crossVectors(this.direction, this.up).normalize();
    return THREE.MathUtils.clamp(Math.atan2(cross, dot), -.6, .6);
  }

  /** After the mixer. Scratch objects are reused; idle needs only head/chest. */
  apply(delta: number, elapsed: number, idle: boolean, marching: boolean): void {
    if (!this.enabled || !this.joints.length) return;
    const step = THREE.MathUtils.clamp(delta, 0, .1);
    this.observationTime += step;
    if (this.observation && !this.observation.sustained && this.observationTime > this.observation.delay+this.observation.duration) { this.observation = null; this.observationWeight = 0; }
    if (this.parting) {
      this.partingTime += step; this.partingSince += step;
      if (this.partingSince >= this.partingDelay+this.partingFade) this.parting = null;
    }
    // Both weights move at a steady pace and are read through a smoothstep: they start and stop without a jolt.
    this.watch = THREE.MathUtils.clamp(this.watch + (marching || this.dying ? -step : step) * 3, 0, 1);
    // Morale changes over seconds, and only shows while the figure stands idle.
    const settle = 1 - Math.exp(-step * .9);
    this.slump += (this.slumpTarget - this.slump) * settle;
    this.tension += (this.tensionTarget - this.tension) * settle;
    this.pride += (this.prideTarget - this.pride) * settle;
    this.moodWeight = THREE.MathUtils.clamp(this.moodWeight + (idle && !marching && !this.dying ? step : -step) * 2, 0, 1);
    this.attention = Math.max(0, this.attention - step);
    const duel = this.opponent !== null && !this.dying;
    if (duel || this.duelWeight > .001) {
      // In a fight a hit rings: an underdamped spring overshoots and settles. Small fixed steps keep it stable.
      for (let left = step; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        this.recoilVelocity += (-121 * this.recoil - 8.4 * this.recoilVelocity) * h;
        this.recoil += this.recoilVelocity * h;
        const want = this.leadSeconds > 0 ? 1 : 0;
        this.leadVelocity += (144 * (want - this.lead) - 11 * this.leadVelocity) * h;
        this.lead += this.leadVelocity * h;
        this.leadSeconds = Math.max(0, this.leadSeconds - h);
      }
      this.duelWeight += ((duel ? 1 : 0) - this.duelWeight) * (1 - Math.exp(-step * 6));
      this.guardWeight += ((this.guard ? 1 : 0) - this.guardWeight) * (1 - Math.exp(-step * 14));
    } else {
      // Exact critically damped spring: stable for uneven browser frame times.
      const frequency = 14, c = this.recoilVelocity + frequency * this.recoil, decay = Math.exp(-frequency * step);
      this.recoil = (this.recoil + c * step) * decay;
      this.recoilVelocity = (this.recoilVelocity - frequency * c * step) * decay;
      this.guardWeight = this.guard ? 1 : 0; this.lead = 0; this.leadVelocity = 0;
    }
    if (!this.hasReaction && (!idle || this.dying)) return;
    // Only the figure's own frame is read here, and `rotate` brings each joint's ancestors up to date itself. The
    // whole skeleton is refreshed only while something reacts (a fight, a guard, a watched capture), whose readers
    // after this (trails, wounds) want this frame's bones; for the breath and glance of the thirty-odd idle figures
    // it was most of the cost of a frame's figure updates, and the renderer refreshes them all again anyway.
    this.frame.updateWorldMatrix(true, this.hasReaction);
    this.frame.getWorldPosition(this.origin);
    this.frame.getWorldDirection(this.forward).setY(0).normalize();
    this.side.crossVectors(this.up, this.forward).normalize();
    let yaw = 0;
    if (this.guardWeight > .001 || this.attention > 0) {
      this.direction.copy(this.target).sub(this.origin).setY(0).normalize();
      const dot = THREE.MathUtils.clamp(this.forward.dot(this.direction), -1, 1);
      const cross = this.forward.z * this.direction.x - this.forward.x * this.direction.z;
      yaw = THREE.MathUtils.clamp(Math.atan2(cross, dot), -.55, .55) * Math.max(this.guardWeight, Math.min(1, this.attention * 3)) * this.strength;
    }
    // ---- the duel layer
    const life = this.duelWeight;
    let pant = 0, shift = 0, lag = 0;
    if (life > .001) {
      const rival = duel ? this.opponent!(this.rival) : null;
      let want = 0;
      if (rival) {
        this.direction.copy(rival).sub(this.origin).setY(0);
        if (this.direction.lengthSq() > 1e-6) {
          this.direction.normalize();
          want = THREE.MathUtils.clamp(Math.atan2(this.forward.z * this.direction.x - this.forward.x * this.direction.z, THREE.MathUtils.clamp(this.forward.dot(this.direction), -1, 1)), -.6, .6);
        }
      }
      this.track += (want - this.track) * (1 - Math.exp(-step * 9));
      // The guard already turns the chest to the threat: the two never add up.
      yaw = yaw * (1 - life) + Math.max(-.6, Math.min(.6, this.track + yaw * .35)) * life;
      pant = Math.sin(elapsed * 4.4 + this.phase) * .02 * life;
      shift = Math.sin(elapsed * 1.7 + this.phase * 1.3) * .024 * life;
      // The shield arm is carried, not welded on: it lags behind every turn of the chest.
      const chest = this.joints.find(joint => joint.torso > 0);
      if (chest && step > 0) {
        this.chestForward.set(0, 0, 1).applyQuaternion(chest.bone.getWorldQuaternion(this.chestQuaternion));
        const heading = Math.atan2(this.chestForward.x, this.chestForward.z);
        const turned = this.chestYaw === null ? 0 : Math.atan2(Math.sin(heading - this.chestYaw), Math.cos(heading - this.chestYaw));
        this.chestYaw = heading;
        this.armLag += (THREE.MathUtils.clamp(-turned / step * .05, -.24, .24) - this.armLag) * (1 - Math.exp(-step * 10));
      }
      lag = this.armLag * life;
    }
    const lead = this.lead * .15;
    // ---- the observer layer: the look held now, and the one it replaced still fading out
    const cue = this.dying ? null : this.observation;
    const t = cue ? this.observationTime-cue.delay : -1;
    this.observationWeight = cue ? cueEnvelope(cue, this.observationTime) : 0;
    const watch = this.watch * this.watch * (3 - 2 * this.watch);
    const now = this.observationWeight * watch;
    const parting = this.dying ? null : this.parting, then = parting ? this.partingNow() * watch : 0;
    let gaze = 0, gazeBody = 0, posture = 0, grip = 0, bow = 0;
    this.flinchHead.set(0, 0, 0); this.flinchBody.set(0, 0, 0);
    if (cue && now > 0) {
      const turn = this.bearing(this.observerTarget, this.observerAxis)*cue.gaze*now, flinch = cue.flinch*now*Math.exp(-Math.max(0, t)*5);
      gaze += turn; this.flinchHead.addScaledVector(this.observerAxis, flinch);
      // A slow breath drawn and let go through a grief or a vindication: the chest lifts, the shoulders with it.
      const sigh = (cue.sigh ?? 0)*now*(.5-.5*Math.cos(this.observationTime*2.1));
      if (!cue.headOnly) { gazeBody += turn; this.flinchBody.addScaledVector(this.observerAxis, flinch); posture += cue.posture*now-sigh; grip += cue.grip*now+sigh*.4; }
      bow += (cue.bow ?? 0)*now;
    }
    if (parting && then > 0) {
      const turn = this.bearing(this.partingTarget, this.partingAxis)*parting.gaze*then, flinch = parting.flinch*then*Math.exp(-Math.max(0, this.partingTime-parting.delay)*5);
      const sigh = (parting.sigh ?? 0)*then*(.5-.5*Math.cos(this.partingTime*2.1));
      gaze += turn; this.flinchHead.addScaledVector(this.partingAxis, flinch);
      if (!parting.headOnly) { gazeBody += turn; this.flinchBody.addScaledVector(this.partingAxis, flinch); posture += parting.posture*then-sigh; grip += parting.grip*then+sigh*.4; }
      bow += (parting.bow ?? 0)*then;
    }
    // ---- the army's mood, in the figure's carriage
    const mood = this.moodWeight * this.moodWeight * (3 - 2 * this.moodWeight);
    bow += (this.slump*.07-this.pride*.035)*mood;
    posture += (this.slump*.04-this.pride*.02)*mood;
    grip += (this.tension*.06-this.slump*.05)*mood;
    bow = THREE.MathUtils.clamp(bow, -.12, .24); posture = THREE.MathUtils.clamp(posture, -.1, .16); grip = THREE.MathUtils.clamp(grip, -.14, .26);
    // Low morale breathes slower and deeper; a pressed King quicker. The phase is carried, so a change of pace never jumps.
    // What the mood adds fades with it; the plain breath and glance are as they were.
    this.breathPhase += step*(this.quiet ? .7 : 1.6)*(1-this.slump*.22*mood+this.tension*.45*mood);
    const depth = this.quiet ? .003 : .012;
    const breath = Math.sin(this.breathPhase) * ((idle && !this.dying ? depth : 0) + depth*(this.slump*.6+this.tension*.25)*mood);
    const glance = this.dying || this.quiet ? 0 : Math.sin(elapsed * .45 + this.phase) * ((idle && !marching ? .04 : 0) + .032*this.tension*mood);
    const brace = .12 * this.guardWeight;
    for (const joint of this.joints) {
      joint.base.copy(joint.bone.quaternion); joint.applied = true;
      this.rotate(joint, this.recoilAxis, this.recoil * (joint.torso + joint.head * .8 + joint.arm * .4));
      this.rotate(joint, this.side, breath * joint.torso - brace * (joint.torso + joint.arm));
      // Recoil from what was seen: the head always, the body unless the look is the head's alone (Low).
      this.flinchAxis.copy(this.flinchHead).multiplyScalar(joint.head*.45).addScaledVector(this.flinchBody, joint.torso+joint.arm*.25);
      const flinch = this.flinchAxis.length();
      if (flinch > .00001) this.rotate(joint, this.flinchAxis.multiplyScalar(1/flinch), flinch);
      this.rotate(joint, this.side, posture*joint.torso-grip*joint.arm+bow*joint.head);
      this.rotate(joint, this.up, THREE.MathUtils.clamp(yaw+gaze, -.65, .65)*joint.head+(yaw+gazeBody)*joint.torso*.25+glance*joint.head);
      if (life > .001 || lead) {
        this.rotate(joint, this.side, pant * (joint.torso - joint.arm * .5));
        this.rotate(joint, this.forward, shift * (joint.torso - joint.head * .5));
        // Hips first, chest held back against them: the thrust is thrown from the ground up.
        this.rotate(joint, this.up, lead * (joint.hips - joint.torso * .45) + lag * joint.shield);
      }
    }
  }
}
