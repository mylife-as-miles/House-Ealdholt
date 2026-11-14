/**
 * The combat feel layer: what makes a blow land. Pure numbers and clocks, free
 * of three.js and of the engine, so every rule here runs in node tests.
 *
 * The techniques are ideas taken from four melee combat projects the creator
 * chose as the standard (Cussk/Soulslike-Combat-System, nbertoa/ue5-warrior-
 * action-rpg, KevinRusev/MedievalCombatGame, georgehuan1994/Unreal-Melee-
 * Combat-System); no code of theirs is used. Ported to a directed duel:
 *
 *  - hit-stop: on contact the whole board holds for a few frames, then lets
 *    time back in through a short slow motion on a killing blow. The board's
 *    clock is scaled, not the skeletons one by one, so the fight's own clock,
 *    both mixers, every tween and every particle stop and restart together
 *    and nothing drifts out of step (the runner waits only on that clock);
 *  - the struck body shudders along the blow while time is held, so the stop
 *    reads as force arriving, not as a dropped frame;
 *  - the camera is kicked along the blow and springs back, on real time, so
 *    it moves while the world is held;
 *  - the killing blow is wound up slower and thrown faster (anticipation),
 *    with its contact frame kept exactly where the plan put it;
 *  - the weapon leaves a short trail while it moves fast, in its kingdom's
 *    colour, and a glint marks the start of the killing blow.
 *
 * Nothing here may make a capture longer than about what it was: every hold
 * is a fraction of a second and the slow motion is short. Reduced motion and
 * the skip turn all of it off.
 */
import type { Kind, Kingdom } from "./choreography";

/** Set `globalThis.__crownfallCombatFeel = false` before a fight to play it without this layer (before/after checks). */
export function combatFeelEnabled(): boolean {
  return (globalThis as { __crownfallCombatFeel?: unknown }).__crownfallCombatFeel !== false;
}

/** What kind of contact a moment is: a blow stopped by a guard, the killing blow, a ball or a spell arriving. */
export type BlowKind = "clash" | "kill" | "shot" | "blast";

export interface ImpactShape {
  /** Real seconds the board is held. */
  freeze: number;
  /** Real seconds of slow motion after the hold, easing back to normal speed. Zero: none. */
  slow: number;
  /** The board's speed at the start of that slow motion (0 to 1). */
  slowScale: number;
  /** How far the struck body shudders along the blow, in world units. */
  shudder: number;
  /** Real seconds the shudder lasts. */
  shudderSeconds: number;
  /** How far the camera is kicked along the blow, in world units. */
  kick: number;
}

export const FEEL = {
  /** The board's speed while it is held: not zero, so no clock stalls for good. */
  frozen: 0.03,
  /** No hold is ever longer than this, however hard the blow. */
  maxFreeze: 0.12,
  /** No slow motion is ever longer than this. */
  maxSlow: 0.24,
  /** The shudder's frequency, cycles per real second. */
  shudderHz: 34,
  /** The camera kick's spring: frequency in cycles per second and damping ratio. */
  kickHz: 7.5,
  kickDamping: 0.42,
  /** A kick is thrown a little down as well as along the blow: the weight lands. */
  kickDip: 0.45,
  /** How far each rank's weapon is hauled round: a pike is light, a tower guardian's hammer is not. */
  heft: { p: 0, n: 0.35, b: 0.25, r: 0.9, q: 0.45, k: 0.75 } satisfies Record<Kind, number>,
  /** The killing blow's wind-up runs at this share of the speed the plan gave it; the thrust makes the time up. */
  windup: 0.62,
  /** The fastest the thrust after a slowed wind-up may run, as a multiple of the speed the plan gave the clip. */
  windupBurst: 1.9,
  /** A weapon's trail: real seconds each sample of it stays visible, and the tip speeds (world units a second,
   * against the body) between which it fades in. */
  trail: { life: 0.15, lifeLow: 0.11, samples: 14, slow: 0.7, fast: 2.4 },
} as const;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * How hard a contact lands, from what it is, the plan's power (about 0.6 to
 * 2) and the attacker's rank. A stopped blow holds briefly and has no slow
 * motion; the killing blow holds longer and lets time back in slowly; heavy
 * weapons and upsets hold longest. A ball or a spell holds for less: there is
 * no weapon in the body to feel it through.
 */
export function impactShape(blow: BlowKind, power: number, attacker: Kind, heavy = false): ImpactShape {
  const p = clamp(Number.isFinite(power) ? power : 1, 0.3, 2.25);
  const heft = FEEL.heft[attacker] ?? 0;
  if (blow === "clash") {
    return { freeze: clamp(0.04 + 0.018 * p + 0.02 * heft, 0.04, 0.075), slow: 0, slowScale: 1, shudder: 0.009 + 0.004 * p, shudderSeconds: 0.12, kick: 0.012 + 0.006 * p };
  }
  if (blow === "shot") {
    return { freeze: clamp(0.04 + 0.012 * p, 0.04, 0.07), slow: 0.1, slowScale: 0.5, shudder: 0.014 + 0.004 * p, shudderSeconds: 0.14, kick: 0.016 + 0.006 * p };
  }
  if (blow === "blast") {
    return { freeze: clamp(0.045 + 0.012 * p, 0.045, 0.075), slow: 0.12, slowScale: 0.45, shudder: 0.014 + 0.004 * p, shudderSeconds: 0.15, kick: 0.016 + 0.007 * p };
  }
  const weighty = heavy || p >= 1.15 || heft >= 0.7;
  return {
    freeze: clamp(0.06 + 0.026 * p + 0.025 * heft, 0.075, FEEL.maxFreeze),
    slow: weighty ? 0.2 : 0.13,
    slowScale: weighty ? 0.3 : 0.42,
    shudder: clamp(0.014 + 0.006 * p + 0.006 * heft, 0.014, 0.03),
    shudderSeconds: 0.17 + 0.04 * heft,
    kick: clamp(0.02 + 0.012 * p + 0.01 * heft, 0.02, 0.05),
  };
}

/** Real seconds a shape adds to a capture: the hold, plus what the slow motion holds back. */
export function addedSeconds(shape: Pick<ImpactShape, "freeze" | "slow" | "slowScale">): number {
  const freeze = Math.min(FEEL.maxFreeze, Math.max(0, shape.freeze));
  const slow = Math.min(FEEL.maxSlow, Math.max(0, shape.slow));
  // The board's speed over the slow motion averages half-way between its start and normal speed.
  return freeze * (1 - FEEL.frozen) + slow * (1 - (Math.max(0, Math.min(1, shape.slowScale)) + 1) / 2);
}

/** A smooth 0 to 1 ease with zero speed at both ends. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The board's clock under the hit-stop: hold, then slow motion easing back.
 * Driven by real time. `timeScale` returns the share of this frame's real
 * time the board is given, integrated across the phases a frame spans, so a
 * hold is the same length at 30 frames a second as at 144.
 */
export class ImpactClock {
  private freezeLeft = 0;
  private slowLeft = 0;
  private slowLength = 0;
  private slowFrom = 1;

  /** True while the board is held or slowed. */
  get active(): boolean { return this.freezeLeft > 0 || this.slowLeft > 0; }

  /** A blow lands. A second one inside a hold extends it to the longer of the two; holds never add up. */
  hit(shape: Pick<ImpactShape, "freeze" | "slow" | "slowScale">): void {
    const freeze = clamp(shape.freeze, 0, FEEL.maxFreeze), slow = clamp(shape.slow, 0, FEEL.maxSlow);
    this.freezeLeft = Math.max(this.freezeLeft, freeze);
    if (slow <= 0) return;
    const scale = clamp(shape.slowScale, FEEL.frozen, 1);
    // A deeper or longer slow motion replaces a shallower one already running.
    if (this.slowLeft <= 0 || scale <= this.currentSlow() || slow > this.slowLeft) {
      this.slowLength = slow; this.slowLeft = slow; this.slowFrom = scale;
    }
  }

  /** The board's speed in the slow motion right now (1 when there is none). */
  private currentSlow(): number {
    if (this.slowLeft <= 0 || this.slowLength <= 0) return 1;
    return this.slowFrom + (1 - this.slowFrom) * ease(1 - this.slowLeft / this.slowLength);
  }

  /**
   * The share of `real` seconds the board's clock should advance this frame.
   * `bypass` (reduced motion, a hurried skip) drops whatever is pending and answers 1.
   */
  timeScale(real: number, bypass = false): number {
    if (bypass) { this.clear(); return 1; }
    if (!(real > 0) || !this.active) return 1;
    let left = real, game = 0;
    const held = Math.min(left, this.freezeLeft);
    this.freezeLeft -= held; left -= held; game += held * FEEL.frozen;
    if (left > 0 && this.slowLeft > 0) {
      const used = Math.min(left, this.slowLeft);
      const a = 1 - this.slowLeft / this.slowLength, b = 1 - (this.slowLeft - used) / this.slowLength;
      // The ease is smooth and a frame is short: its middle stands for the whole step.
      game += used * (this.slowFrom + (1 - this.slowFrom) * ease((a + b) / 2));
      this.slowLeft -= used; left -= used;
    }
    game += left;
    if (this.freezeLeft <= 1e-9) this.freezeLeft = 0;
    if (this.slowLeft <= 1e-9) this.slowLeft = 0;
    return game / real;
  }

  clear(): void { this.freezeLeft = 0; this.slowLeft = 0; this.slowLength = 0; this.slowFrom = 1; }
}

/** Where a shuddering body is pushed, as a share of its amplitude along and across the blow, `t` real seconds in. */
export function shudderOffset(t: number, seconds: number): { along: number; across: number } {
  if (!(t >= 0) || !(seconds > 0) || t >= seconds) return { along: 0, across: 0 };
  const fade = (1 - t / seconds) ** 2;
  return { along: fade * Math.sin(2 * Math.PI * FEEL.shudderHz * t), across: fade * 0.35 * Math.sin(2 * Math.PI * FEEL.shudderHz * 0.71 * t + 1.1) };
}

/**
 * The camera kick: an underdamped spring started with a push along the blow.
 * Returns the displacement, in units of the kick's size, `t` real seconds after it.
 */
export function kickOffset(t: number): number {
  if (!(t > 0)) return 0;
  const w = 2 * Math.PI * FEEL.kickHz, z = FEEL.kickDamping, wd = w * Math.sqrt(1 - z * z);
  // Normalised so the first swing peaks at 1.
  const peakTime = Math.atan(wd / (z * w)) / wd;
  const peak = Math.exp(-z * w * peakTime) * Math.sin(wd * peakTime);
  return Math.exp(-z * w * t) * Math.sin(wd * t) / peak;
}

/** Seconds after which a kick has settled to nothing anyone can see. */
export const KICK_SECONDS = 0.6;

/**
 * Anticipation for one attack clip whose contact the plan lands on a moment:
 * the clip runs slower up to its own `ready` frame (the last still frame
 * before the drive) and faster from there, so the contact frame arrives at
 * the same moment as before. Null when the clip has no usable `ready`, or the
 * thrust would have to run faster than `burst` times the planned speed.
 *
 * `rate` is the clip's planned speed and `start` the plan time it starts at;
 * `from` is how far into the clip it is joined (normally 0).
 */
export function windupTiming(clip: { events: Readonly<Record<string, number>> }, contact: number, start: number, rate: number, share = FEEL.windup, burst = FEEL.windupBurst, from = 0):
  { slowRate: number; driveAt: number; driveRate: number } | null {
  const ready = clip.events.ready;
  if (ready === undefined || !(rate > 0) || !(share > 0 && share < 1)) return null;
  if (!(ready > from + 0.05) || !(contact > ready + 0.05)) return null;
  const total = (contact - from) / rate;
  const slowRate = rate * share;
  const windup = (ready - from) / slowRate;
  const drive = total - windup;
  if (!(drive > 0.08)) return null;
  const driveRate = (contact - ready) / drive;
  if (driveRate > rate * burst) return null;
  return { slowRate, driveAt: start + windup, driveRate };
}

/** The colour a kingdom's steel leaves in the air. */
export const TRAIL_COLOR: Readonly<Record<Kingdom, number>> = {
  // Aethelgard: witchfire, a cold pale blue off the swords.
  ivory: 0xbfdcff,
  // Solforiz: furnace light off the sunblades and ash spears.
  sun: 0xffa64a,
  // Korvenia: bright sabre steel with a little gold in it.
  empire: 0xf3e6c8,
  // Kwind-09: the shock pikes' arc.
  kwind: 0x6ff4ff,
};
