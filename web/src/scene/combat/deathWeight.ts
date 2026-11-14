/**
 * A death with weight: what the killing blow does to the body between the hit
 * and the floor.
 *
 * The hit is treated as an impulse at the contact point. Its part through the
 * body's axis drives the root as a projectile that leaves the ground for an
 * instant and is then dragged to a stop by friction; its off-centre part turns
 * the torso towards the blow. On top of that the knees give, the body rocks
 * back over its heels, and it bounces once when it lands.
 *
 * This stands in for a ragdoll. The same impulse (direction, strength, contact
 * offset) is what a physics body would be given later.
 *
 * Pure functions of time: no three.js, no engine, no randomness, so the same
 * capture always falls the same way (Undo and replay included).
 */
export interface Ground { x: number; z: number }

export interface KnockbackInput {
  /** Ground direction the blow travels in. Need not be unit length. */
  blow: Ground;
  /** Impact strength, as the plan's `power` (about 0.6 to 1.6). */
  power: number;
  /** Seconds from the hit to the body reaching the floor. */
  hitToLand: number;
  /** Sideways offset of the contact point from the body's axis, in world units: + is the body's left. */
  offCentre?: number;
  /** One square, in world units. */
  tile: number;
  /** Most the root may travel, in squares. */
  cap?: number;
  /** What the death clip itself travels, in world units, so the cap covers both. */
  clipTravel?: number;
}

export interface KnockbackPose {
  /** Root offset on the ground, world units. */
  x: number; z: number;
  /** Root height: above 0 while the feet are off the stone, below while the knees give. */
  y: number;
  /** Radians about the vertical: the torso turning with the blow. */
  twist: number;
  /** Radians the body rocks back over its heels, about the axis across the blow. */
  lean: number;
  /** True while the feet are off the ground or sliding: they must not be planted. */
  feetReleased: boolean;
}

export interface Knockback {
  /** Unit ground direction of travel. */
  direction: Ground;
  /** Total ground travel, world units. */
  travel: number;
  /** Seconds after the hit at which the root stops sliding. */
  stop: number;
  /** Seconds after the hit at which the body is down. */
  land: number;
  /** Seconds after the hit at which everything is at rest (after the bounce). */
  rest: number;
  at(seconds: number): KnockbackPose;
}

export const DEATH_WEIGHT = {
  /** Squares the root travels for a blow of power 1, before the cap. */
  travel: 0.13,
  /** Horizontal travel cap in squares, clip root motion included. */
  cap: 0.45,
  /** The hop as the feet lose the floor: seconds in the air and height at power 1. */
  airtime: 0.2, hop: 0.03,
  /** Knees giving under the hit: depth and when it is deepest. */
  buckle: 0.032, buckleAt: 0.16,
  /** Rock back over the heels: radians at power 1 and when it peaks. */
  lean: 0.15, leanAt: 0.13,
  /** Radians of twist per world unit of off-centre contact, its limit and its time constant. */
  twist: 2.6, twistLimit: 0.5, twistTau: 0.14,
  /** The body's own twist when the hit is dead centre, so a fall is never a straight topple. */
  minTwist: 0.12,
  /** Landing bounce: height, period, and how fast it dies. */
  bounce: 0.03, bouncePeriod: 0.17, bounceDecay: 9,
} as const;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The body's motion from the hit to rest. Deterministic; `at(0)` is the untouched pose. */
export function planKnockback(input: KnockbackInput): Knockback {
  const length = Math.hypot(input.blow.x, input.blow.z);
  const direction = length < 1e-9 ? { x: 0, z: 1 } : { x: input.blow.x / length, z: input.blow.z / length };
  const power = clamp(input.power, 0.3, 2), W = DEATH_WEIGHT;
  const land = Math.max(0.2, input.hitToLand);
  const room = Math.max(0, (input.cap ?? W.cap) * input.tile - Math.max(0, input.clipTravel ?? 0));
  const travel = Math.min(room, W.travel * power * input.tile);
  // A projectile along the ground: launched at v0, dragged down by constant friction, stopped before the body is down.
  const stop = Math.min(land * 0.8, 0.55);
  const v0 = 2 * travel / stop, friction = v0 / stop;
  const airtime = Math.min(W.airtime, land * 0.4), hop = W.hop * power;
  const offCentre = input.offCentre ?? 0;
  const turn = clamp(offCentre * W.twist * power, -W.twistLimit, W.twistLimit);
  const twist = Math.abs(turn) < W.minTwist ? (offCentre < 0 ? -1 : 1) * W.minTwist * Math.min(1, power) : turn;
  const lean = W.lean * power, buckle = W.buckle * Math.min(1.4, power), bounce = W.bounce * Math.min(1.4, power);
  const rest = land + W.bouncePeriod * 2;
  // t * e^(1 - t) peaks at 1 when t = 1: a pulse that rises fast and lets go slowly.
  const pulse = (t: number, peak: number) => { const u = t / peak; return u <= 0 ? 0 : u * Math.exp(1 - u); };
  return {
    direction, travel, stop, land, rest,
    at(seconds: number): KnockbackPose {
      const t = Math.max(0, seconds);
      const slide = t >= stop ? travel : v0 * t - 0.5 * friction * t * t;
      const air = t < airtime ? 4 * hop * (t / airtime) * (1 - t / airtime) : 0;
      // The knees give after the feet come back down, and the clip's own fall takes over from there.
      const give = -buckle * pulse(t - airtime * 0.5, W.buckleAt) * (t < land ? 1 - Math.pow(t / land, 3) : 0);
      const after = t - land;
      const hopAgain = after > 0 && after < W.bouncePeriod * 2 ? bounce * Math.exp(-W.bounceDecay * after) * Math.abs(Math.sin(Math.PI * after / W.bouncePeriod)) : 0;
      return {
        x: direction.x * slide, z: direction.z * slide,
        y: air + give + hopAgain,
        twist: twist * (1 - Math.exp(-t / W.twistTau)),
        lean: lean * pulse(t, W.leanAt) * (t < land ? 1 - t / land : 0),
        feetReleased: t < Math.max(stop, airtime),
      };
    },
  };
}

export interface FallHeading { x: number; z: number; /** Degrees the fall was turned off the blow. */ turned: number; /** True when every direction was taken. */ blocked: boolean }

/**
 * Where the body may fall. It goes with the blow unless that would lay it into
 * an occupied square; then the nearest free direction is taken, turning as
 * little as possible, and to the same side every time.
 */
export function fallHeading(spot: Ground, blow: Ground, occupied: readonly Ground[], options: { reach: number; tile: number; clearance?: number }): FallHeading {
  const length = Math.hypot(blow.x, blow.z);
  const base = length < 1e-9 ? { x: 0, z: 1 } : { x: blow.x / length, z: blow.z / length };
  const clear = (options.clearance ?? 0.5) * options.tile;
  const free = (direction: Ground): boolean => {
    for (const share of [1, 0.6]) {
      const x = spot.x + direction.x * options.reach * share, z = spot.z + direction.z * options.reach * share;
      if (occupied.some(other => Math.hypot(other.x - x, other.z - z) < clear)) return false;
    }
    return true;
  };
  for (const degrees of [0, 30, -30, 60, -60, 90, -90, 125, -125, 180]) {
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const direction = { x: base.x * cos + base.z * sin, z: -base.x * sin + base.z * cos };
    if (free(direction)) return { ...direction, turned: degrees, blocked: false };
  }
  return { ...base, turned: 0, blocked: true };
}

export type BlowSide = "front" | "back" | "left" | "right";

/** Which side of the defender the blow comes in on: the angle between where it faces and where the blow comes from. */
export function blowSide(facing: Ground, blow: Ground): { side: BlowSide; degrees: number } {
  const towards = { x: -blow.x, z: -blow.z };
  const degrees = Math.atan2(facing.z * towards.x - facing.x * towards.z, facing.x * towards.x + facing.z * towards.z) * 180 / Math.PI;
  const side: BlowSide = Math.abs(degrees) <= 60 ? "front" : Math.abs(degrees) >= 120 ? "back" : degrees > 0 ? "left" : "right";
  return { side, degrees };
}

/**
 * The hit and death clips for a blow from that side. The sequence's authored
 * choice stands when the blow comes from the front. With the combat-v2 library
 * a blow from behind pitches the body forward and one from a flank reels it
 * away from the blow and lays it down on the far side; the older library has
 * only frontal reactions, so there a blow from behind pitches the body forward
 * and one from the flank takes the heaviest stagger. Never random.
 */
export function directionalReaction(side: BlowSide, authored: { hit: string; death: string }, held: (id: string) => boolean): { hit: string; death: string } {
  if (side === "front") return authored;
  const first = (wanted: readonly string[], fallback: string) => wanted.find(held) ?? fallback;
  if (side === "back") return { hit: first(["hit.back", "hit.heavy"], authored.hit), death: first(["death.forward", "death.front"], authored.death) };
  // Struck on the left he goes over to his right, and the other way about.
  const away = side === "left" ? "death.right" : "death.left";
  const sideways = authored.death === "death.left" || authored.death === "death.right";
  return {
    hit: first([side === "left" ? "hit.left" : "hit.right", "hit.heavy"], authored.hit),
    death: held(away) ? away : sideways ? authored.death : authored.death === "death.front" ? first(["death.backward"], authored.death) : authored.death,
  };
}

/**
 * Where to join a death clip and how fast to play it, so the body is on the
 * floor `budget` seconds after the fall begins without the clip being hurried
 * past a natural speed. The clip's first beat repeats the hit reaction the
 * defender has just played, so it is joined after its own `hit` marker.
 */
export function deathTiming(clip: { duration: number; events: Readonly<Record<string, number>> }, budget: number, limits: { minRate?: number; maxRate?: number; maxSkip?: number } = {}): { from: number; rate: number; land: number; length: number } {
  const land = clip.events.land ?? clip.duration * 0.85, hit = clip.events.hit ?? 0;
  const minRate = limits.minRate ?? 1, maxRate = limits.maxRate ?? 1.25;
  const maxSkip = Math.min(limits.maxSkip ?? land * 0.25, land * 0.45);
  // Play at the fastest natural rate first, then join later in the clip only as far as is needed.
  let rate = clamp(land / Math.max(budget, 1e-3), minRate, maxRate);
  let from = clamp(land - budget * rate, 0, Math.max(hit, maxSkip));
  if (from > 0 && from < hit) from = hit;
  if (from > 0) rate = clamp((land - from) / Math.max(budget, 1e-3), minRate, maxRate);
  return { from, rate, land: (land - from) / rate, length: (clip.duration - from) / rate };
}
