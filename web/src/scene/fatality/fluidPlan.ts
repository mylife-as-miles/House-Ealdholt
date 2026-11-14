/**
 * The fluid blood of a cinematic fatality (gore tier 3): how it leaves the wound, where it lands, and what it leaves
 * on the stone. fatality/fluid.ts simulates and draws it on the GPU; nothing here is drawn.
 *
 * The method is the creator's references' (dgreenheck/threejs-particle-fluids, MIT; APS4087/spill, no licence),
 * taken and not copied: both run on WebGPU, and the match draws with WebGL. Ours is GPU particles on WebGL2 (their
 * state in ping-pong float textures) drawn as one liquid surface in screen space (thickness and normals from the
 * particles' depth, smoothed, shaded wet and dark red).
 *
 * - The pour: the wound bursts in spurts on the heart's beat, a few ropy jets out of the far side along the blow and
 *   one back out of where it went in, each particle on its own launch (seeded: the same game pours the same way),
 *   most of it in the first moments, into the slow motion.
 * - The flight: gravity and drag in closed form (gore/ballistics.ts, as the droplets of the ordinary sprays), so the
 *   GPU's particles and this plan agree on where and when each one lands, at any frame rate.
 * - The stone: a landing splashes (some of it hops once), then runs and slows; the plan knows only where it landed.
 * - The marks: the landings gathered into stains, and a pool where most of it came down, handed to the gore system
 *   (its stain and pool calls) at the moment each lands, so the blood stays on the board after the fluid is gone.
 *   Each knows when the drops that made it left the wound: a wound that moves as it pours (a body carried off, a body
 *   falling) moves its drops with it, and their marks by as much.
 *
 * Pure, no three.js: shared/play/fatality-fluid.test.ts.
 */
import { flightPosition, flightVelocity, GORE_GRAVITY, landingTime, type Launch } from "../gore/ballistics";
import type { PoolPlan, StainPlan } from "../gore/GoreTypes";
import { hash01 } from "../death/physics/math";

export interface Point { x: number; y: number; z: number }

export const FLUID = {
  /** Scene seconds the wound pours for, the heart's beat over it (seconds a beat), and how strongly each beat pushes. */
  pour: 0.34, beat: 0.13, surge: 0.45,
  /** Jets out of the far side, and the share of all of it thrown back out of where the blow went in. */
  jets: 4, back: 0.26,
  /** How far a jet strays from the line of the blow, and a particle from its jet (radians); how far up they lean. */
  spread: 0.55, scatter: 0.045, lift: 0.42,
  /** The share of it thrown loose as spray (wider and less even than the jets' ropes), and how wide (radians). */
  loose: 0.08, flung: 0.3,
  /** Launch speeds, a share of the figure's height a second: a jet's own speed is between these, and a drop keeps near its jet's. */
  slowest: 1.5, fastest: 3.4, even: 0.12,
  /** Linear drag (1/s), as the ordinary droplets. */
  drag: 0.8,
  /** A particle's radius, a share of the figure's height. */
  radius: 0.02,
  /** The share of landings that hop once, how much of a landing's speed carries on along the stone, and how fast the stone takes it (1/s). */
  hop: 0.22, carry: 0.42, friction: 3.2,
  /** Scene seconds after the pour begins that the fluid starts to thin, and is gone: the stains and the pool stay. */
  thin: 2.8, gone: 3.6,
  /** Stains handed to the gore system at most, the cell the landings are gathered in (a share of the height), and the least a stain gathers. */
  stains: 8, cell: 0.16, least: 3,
} as const;

export interface FluidLaunch extends Launch {
  /** Scene seconds after the pour begins that it leaves the wound. */
  birth: number;
  /** Its radius, scene units. */
  size: number;
}

export interface FluidWound {
  /** Where the blow went in, and the way it travels into the body (unit). */
  entry: Point;
  direction: Point;
  /** How far the blow ran through the body: the far wound is that far along it. */
  depth: number;
  /** The figure's height. */
  height: number;
  seed: number;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Point) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Point, fallback: Point): Point => { const l = length(a); return l > 1e-9 ? scale(a, 1 / l) : { ...fallback }; };

/** A direction tilted off `axis` by `tilt` radians, turned `turn` round it (a stump's pour, fatality/stumpPlan.ts, leans its jets the same way). */
export function cone(axis: Point, tilt: number, turn: number): Point {
  const across = unit(Math.abs(axis.y) > 0.92 ? cross(axis, { x: 1, y: 0, z: 0 }) : cross(axis, { x: 0, y: 1, z: 0 }), { x: 1, y: 0, z: 0 });
  const over = cross(axis, across);
  return unit(add(scale(axis, Math.cos(tilt)), scale(add(scale(across, Math.cos(turn)), scale(over, Math.sin(turn))), Math.sin(tilt))), axis);
}

/** How hard the wound pushes at `t` scene seconds into the pour: a surge on each beat, weakening as it empties. */
export function pressure(t: number): number {
  const beat = 0.5 + 0.5 * Math.cos((t / FLUID.beat) * Math.PI * 2);
  return (1 - FLUID.surge + FLUID.surge * beat * beat) * (1 - 0.45 * Math.min(1, t / FLUID.pour));
}

/** Particle `index` of `count`: where and when it leaves the wound, and how fast. */
export function fluidLaunch(wound: FluidWound, index: number, count: number): FluidLaunch {
  const h = (k: number) => hash01(wound.seed, index, k);
  const along = unit(wound.direction, { x: 0, y: 0, z: -1 });
  const back = h(0) < FLUID.back;
  // Front-loaded: most of it in the first moments, a thin last of it after.
  const birth = FLUID.pour * Math.pow((index + h(1)) / Math.max(1, count), 1.7);
  // The far wound's jets and the entry's one, each leaning up so it arcs.
  const jet = back ? -1 : Math.floor(h(2) * FLUID.jets);
  const jetTurn = jet < 0 ? hash01(wound.seed, 9001, 0) * Math.PI * 2 : hash01(wound.seed, 9000 + jet, 0) * Math.PI * 2;
  const jetTilt = (jet < 0 ? 0.5 : 1) * FLUID.spread * (0.35 + 0.65 * hash01(wound.seed, 9100 + jet, 1));
  const axis0 = back ? scale(along, -1) : along;
  const axis = unit(add(axis0, { x: 0, y: FLUID.lift, z: 0 }), axis0);
  // Each jet wanders a little as it pours, so it reads as a rope of blood, not a fan.
  const wander = 0.18 * Math.sin(birth * 23 + jet * 1.7);
  // A rope: a drop keeps near its jet's line and speed, so what leaves together flies together. A share is flung loose.
  const loose = h(10) < FLUID.loose;
  const heading = cone(cone(axis, jetTilt, jetTurn + wander), (loose ? FLUID.flung : FLUID.scatter) * Math.sqrt(h(3)), h(4) * Math.PI * 2);
  const jetSpeed = FLUID.slowest + (FLUID.fastest - FLUID.slowest) * hash01(wound.seed, 9200 + jet, 2);
  const own = loose ? FLUID.slowest + (FLUID.fastest - FLUID.slowest) * h(5) : jetSpeed * (1 + FLUID.even * (h(5) - 0.5) * 2);
  const speed = wound.height * Math.min(FLUID.fastest, own) * pressure(birth) * (back ? 0.7 : 1);
  const exit = back ? wound.entry : add(wound.entry, scale(along, wound.depth));
  const jitter = wound.height * 0.012;
  const origin = { x: exit.x + (h(6) - 0.5) * jitter, y: exit.y + (h(7) - 0.5) * jitter, z: exit.z + (h(8) - 0.5) * jitter };
  return { origin, velocity: scale(heading, speed), drag: FLUID.drag, birth, size: wound.height * FLUID.radius * (0.7 + 0.6 * h(9)) };
}

export interface FluidLanding {
  /** Where it meets the stone, and when (scene seconds after the pour begins). */
  at: { x: number; z: number };
  time: number;
  /** Which way it was going as it landed, along the stone. */
  heading: number;
}

/** Where and when a particle first meets the stone (the closed form the GPU's flight uses), or null if it never leaves it. */
export function fluidLanding(launch: FluidLaunch, top: number): FluidLanding | null {
  const t = landingTime(launch, top + launch.size * 0.5, GORE_GRAVITY);
  if (t < 0) return null;
  const at = flightPosition(launch, t, { x: 0, y: 0, z: 0 }, GORE_GRAVITY), v = flightVelocity(launch, t, { x: 0, y: 0, z: 0 }, GORE_GRAVITY);
  return { at: { x: at.x, z: at.z }, time: launch.birth + t, heading: Math.atan2(v.x, v.z) };
}

export interface FluidMarks {
  /**
   * Stains for the gore system's board marks, each at the moment its first drop lands (scene seconds after the pour
   * begins), and when the drops that made it left the wound (`born`, their middle).
   */
  stains: (StainPlan & { born: number })[];
  /** The pool, where most of it came down, when it starts to spread, and when its drops left; null when too little landed to pool. */
  pool: (PoolPlan & { at: number; born: number }) | null;
}

/**
 * What the pour leaves on the stone: the landings gathered in cells, the fullest cells as stains (each as wide as
 * what fell in it), and a pool where the most fell, spreading from when the bulk of it is down.
 */
export function fluidMarks(launches: readonly FluidLaunch[], top: number, height: number, seed: number): FluidMarks {
  const cell = Math.max(1e-3, height * FLUID.cell);
  const cells = new Map<string, { n: number; x: number; z: number; first: number; heading: number; times: number[]; births: number[] }>();
  for (const launch of launches) {
    const landing = fluidLanding(launch, top);
    if (!landing) continue;
    const key = `${Math.round(landing.at.x / cell)},${Math.round(landing.at.z / cell)}`;
    const c = cells.get(key) ?? { n: 0, x: 0, z: 0, first: Infinity, heading: landing.heading, times: [], births: [] };
    c.n += 1; c.x += landing.at.x; c.z += landing.at.z; c.first = Math.min(c.first, landing.time); c.times.push(landing.time); c.births.push(launch.birth);
    cells.set(key, c);
  }
  const middle = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
  const full = [...cells.values()].filter(c => c.n >= FLUID.least).sort((a, b) => b.n - a.n);
  const radius = height * FLUID.radius;
  const stains: FluidMarks["stains"] = full.slice(0, FLUID.stains).map((c, i) => ({
    at: c.first, born: middle(c.births), x: c.x / c.n, z: c.z / c.n,
    radius: Math.min(height * 0.16, Math.max(height * 0.035, Math.sqrt(c.n) * radius * 1.6)),
    rotation: c.heading, stretch: 1.25 + 0.6 * hash01(seed, i, 31), shape: hash01(seed, i, 32), source: "spray",
  }));
  if (!full.length) return { stains, pool: null };
  // The pool: round the fullest cell, gathering its neighbours, spreading once half of what falls there is down.
  const heart = full[0];
  let n = 0, x = 0, z = 0;
  const times: number[] = [], births: number[] = [];
  for (const c of full) {
    if (Math.hypot(c.x / c.n - heart.x / heart.n, c.z / c.n - heart.z / heart.n) > cell * 2.5) continue;
    n += c.n; x += c.x; z += c.z; times.push(...c.times); births.push(...c.births);
  }
  times.sort((a, b) => a - b);
  const total = launches.length;
  if (n < Math.max(FLUID.least * 3, total * 0.04)) return { stains, pool: null };
  return {
    stains,
    pool: {
      x: x / n, z: z / n, delay: 0, grow: 2.2, grooveBias: 0.5, shape: hash01(seed, 99, 33),
      maxRadius: Math.min(height * 0.55, Math.max(height * 0.18, Math.sqrt(n / total) * height * 0.6)),
      at: times[Math.floor(times.length / 2)], born: middle(births),
    },
  };
}

/** How much of the fluid is still drawn `t` scene seconds after the pour begins: all of it, then thinning to nothing. */
export function fluidLevel(t: number): number {
  if (t <= FLUID.thin) return 1;
  return Math.max(0, 1 - (t - FLUID.thin) / (FLUID.gone - FLUID.thin));
}
