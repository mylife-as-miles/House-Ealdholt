// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The arithmetic of the spells' loose light and loose air: sparks, shards of light, embers, glitter, mist, dust.
 * No Three.js in here, so the node tests reach it (shared/play/spell-particles.test.ts); shared/particles.ts draws
 * what this decides, and its vertex shader evaluates the same flight.
 *
 * What is kept from the reference (its EmberSystem): a particle is only ever born. Its whole path is the exact
 * solution of linear drag under a constant pull, so nothing is integrated and nothing depends on the frame rate.
 * What is ours: a spell's whole life is known when it is made, so every particle of a cast is written once, with a
 * birth time that may lie seconds ahead, and the pool is never touched again; the dice are seeded; the floor is
 * the board; and one pool carries five kinds of sprite.
 */

export interface Vec { x: number; y: number; z: number }

/** A seeded 0..1 sequence (the kit's), so a cast is the same on every machine and in every capture. */
export type Dice = () => number;
export function sequence(seed: number): Dice {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A number between `low` and `high` off the dice. */
export const between = (dice: Dice, low: number, high: number) => low + (high - low) * dice();

/**
 * How a particle is drawn.
 * - `mote`: a soft round light with a hot heart: embers, motes, the glow in a hand, the flash of a blow.
 * - `streak`: the same, drawn out along its own motion on the screen: sparks and flying splinters.
 * - `glint`: a hard four-pointed star that flashes as it tumbles: glitter, ice dust catching the light.
 * - `puff`: a soft body eroded by noise and lit from above; only in a covering pool: mist, dust, smoke.
 * - `halo`: a wide soft light with no heart: the glow round something bright, drawn because the lowest tier has no bloom.
 */
export const PARTICLE_KIND = { mote: 0, streak: 1, glint: 2, puff: 3, halo: 4 } as const;

export interface Particle {
  kind: number;
  /** Where it is born, and how fast it leaves. */
  origin: Vec;
  velocity: Vec;
  /** Seconds from the cast to its birth, and how long it lives. */
  birth: number;
  life: number;
  /** Its radius, in scene units. */
  size: number;
  /** How hard the air holds it, per second: 0 flies free, 4 is stopped within a hand's breadth. */
  drag?: number;
  /** Its fall, in units a second squared. Negative rises: hot air under an ember. */
  gravity?: number;
  /** 0..1, where it sits between the pool's cool colour and its hot one. It cools toward 0 as it ages. */
  tone?: number;
  /** Its size at the end of its life, as a factor of `size`: mist swells, an ember shrinks. */
  grow?: number;
  /** Born relative to the pool's anchor (a hand that moves) instead of in the scene. */
  anchored?: boolean;
  /** The fraction of its life it takes to appear. */
  fadeIn?: number;
  /** How far it wanders off its path by the end of its life, in scene units. */
  wander?: number;
}

/** How far a particle has travelled per unit of launch speed after `age` seconds in air of `drag`. */
export function flightTravel(age: number, drag: number): number {
  return drag < 1e-4 ? age : (1 - Math.exp(-drag * age)) / drag;
}

/**
 * Where a particle is `age` seconds after its birth: p0 + v0 (1 - e^-kt)/k + a (t - (1 - e^-kt)/k)/k, the exact
 * path under linear drag `k` and a constant pull `a` (here gravity, straight down). With no drag it is the
 * schoolbook parabola.
 */
export function flightPoint(origin: Vec, velocity: Vec, gravity: number, drag: number, age: number): Vec {
  const travel = flightTravel(age, drag);
  const fall = drag < 1e-4 ? 0.5 * age * age : (age - travel) / drag;
  return { x: origin.x + velocity.x * travel, y: origin.y + velocity.y * travel - gravity * fall, z: origin.z + velocity.z * travel };
}

/** Its velocity at that moment: what a streak is drawn out along. */
export function flightVelocity(velocity: Vec, gravity: number, drag: number, age: number): Vec {
  const decay = Math.exp(-drag * age), travel = flightTravel(age, drag);
  return { x: velocity.x * decay, y: velocity.y * decay - gravity * travel, z: velocity.z * decay };
}

/**
 * How bright a particle is `u` of the way through its life: it appears over `fadeIn` and is gone before the end,
 * so nothing pops in or out.
 */
export function particleFade(u: number, fadeIn = 0.08): number {
  if (u <= 0 || u >= 1) return 0;
  const t = Math.min(1, u / Math.max(1e-4, fadeIn));
  return t * t * (3 - 2 * t) * (1 - u) ** 1.5;
}

/**
 * The same for what hangs in the air (a puff of mist, a halo): it comes up over `fadeIn`, stays for half its life,
 * and thins away over the rest.
 */
export function hangingFade(u: number, fadeIn = 0.2): number {
  if (u <= 0 || u >= 1) return 0;
  const t = Math.min(1, u / Math.max(1e-4, fadeIn)), out = Math.min(1, Math.max(0, (u - 0.5) / 0.5));
  return t * t * (3 - 2 * t) * (1 - out * out * (3 - 2 * out));
}

/** A unit vector off the dice whose climb lies between `low` and `high` (-1 straight down, 1 straight up). */
export function scatter(dice: Dice, low = -1, high = 1): Vec {
  const y = between(dice, low, high), turn = dice() * Math.PI * 2, flat = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: Math.cos(turn) * flat, y, z: Math.sin(turn) * flat };
}

/** The pool's buffers: one row per particle, written once. */
export interface ParticleBuffers {
  count: number;
  origin: Float32Array;
  velocity: Float32Array;
  /** birth, life, drag, gravity */
  times: Float32Array;
  /** size, seed, kind, tone */
  look: Float32Array;
  /** grow, anchored, fadeIn, wander */
  extra: Float32Array;
  /** The moment the last of them dies. */
  spent: number;
}

/**
 * Lays `particles` out for the pool. No more than `capacity` are kept: the ones dropped are spread evenly through
 * the list, so a smaller budget thins every part of a spell instead of cutting off its end.
 */
export function packParticles(particles: readonly Particle[], capacity: number, seed = 1): ParticleBuffers {
  const kept = Math.max(0, Math.min(capacity, particles.length)), dice = sequence(seed);
  const buffers: ParticleBuffers = {
    count: kept, origin: new Float32Array(kept * 3), velocity: new Float32Array(kept * 3), times: new Float32Array(kept * 4),
    look: new Float32Array(kept * 4), extra: new Float32Array(kept * 4), spent: 0,
  };
  for (let i = 0; i < kept; i += 1) {
    const p = particles[kept === particles.length ? i : Math.floor((i * particles.length) / kept)];
    buffers.origin.set([p.origin.x, p.origin.y, p.origin.z], i * 3);
    buffers.velocity.set([p.velocity.x, p.velocity.y, p.velocity.z], i * 3);
    buffers.times.set([p.birth, p.life, p.drag ?? 0, p.gravity ?? 0], i * 4);
    buffers.look.set([p.size, dice(), p.kind, p.tone ?? 0.5], i * 4);
    buffers.extra.set([p.grow ?? 1, p.anchored ? 1 : 0, p.fadeIn ?? 0.08, p.wander ?? 0], i * 4);
    buffers.spent = Math.max(buffers.spent, p.birth + p.life);
  }
  return buffers;
}

/** How many of something a cast gets: the tier's count, larger for a Queen than for a Bishop. */
export function byPower(count: number, power: number): number {
  return Math.max(0, Math.round(count * (0.55 + 0.45 * power)));
}
