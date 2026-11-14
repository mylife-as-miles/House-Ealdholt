// Adapted from LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * A fire portal, as arithmetic: a circle struck in the air by a running spark, and a black way through that irises
 * open inside it. No Three.js in here, so the node tests reach it (shared/play/spell-fire-portal.test.ts);
 * portal/portal.ts draws what this decides.
 *
 * It is not the spell. The Fire portal spell (portal/firePortalPlan.ts) hangs one over its victim and breathes fire
 * through it; a summon can hang one anywhere, upright on the board as a door or tilted over a square, and run it on
 * a clock of its own. Everything here takes a placement and an age, and keeps nothing.
 *
 * From the reference's Fire Portal: the ring is drawn, not switched on. A spark is struck at the foot of the circle
 * and runs once round it, eased at both ends; the contour ahead of it does not exist yet, the stroke just behind it
 * is still white-hot, and the way through is held shut until the spark is nearly home. The ring is also an emitter
 * that throws stretched sparks off itself on a tangent, which drag bends into curves. What is ours: the sparks are
 * written once, with their whole flight, and the heavier ones fall to the board, hit it and bounce once before they
 * die; the ring cools from white through orange and red to dark and breaks up into embers at the end instead of
 * dimming; and the darkness inside has something stirring in it before anything comes through.
 */
import type { Point } from "../../mystic/beamPlan";
import { flightPoint, flightVelocity, PARTICLE_KIND, scatter, type Dice, type Particle } from "../shared/particlePlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const TAU = Math.PI * 2;

/** Where a portal hangs: its centre, the way its face looks, the way up within its face, and its clear radius. */
export interface PortalPlacement {
  centre: Point;
  /** Unit vector out of its face, toward whatever is to come through. */
  normal: Point;
  /** Unit vector in its plane: the top of the ring. Its foot, where the spark is struck, is the other way. */
  up: Point;
  /** Unit vector in its plane, square to `up`: `up` × `normal` order keeps the ring anticlockwise seen from the front. */
  right: Point;
  radius: number;
}

const unit = (p: Point): Point => { const length = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / length, y: p.y / length, z: p.z / length }; };
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * A portal at `centre` whose face looks toward `toward`. Its top is as near the world's up as its face allows, so
 * an upright door has its foot on the board side and a portal tilted down over a square has its foot toward it.
 */
export function portalFacing(centre: Point, toward: Point, radius: number): PortalPlacement {
  const normal = unit({ x: toward.x - centre.x, y: toward.y - centre.y, z: toward.z - centre.z });
  // the world's up with what lies along the normal taken off; a face looking straight up or down takes north
  let up = { x: -normal.x * normal.y, y: 1 - normal.y * normal.y, z: -normal.z * normal.y };
  if (Math.hypot(up.x, up.y, up.z) < 1e-4) up = { x: 0, y: 0, z: -1 };
  up = unit(up);
  return { centre, normal, up, right: unit(cross(up, normal)), radius };
}

/**
 * Where on the ring `turn` of the way round is: 0 at its foot, running up its right side (seen from the front) and
 * over the top back to the foot. `scale` is a factor on the radius.
 */
export function ringPoint(placement: PortalPlacement, turn: number, scale = 1): Point {
  const angle = -Math.PI / 2 + turn * TAU, { centre, up, right } = placement, r = placement.radius * scale;
  const a = Math.cos(angle) * r, b = Math.sin(angle) * r;
  return { x: centre.x + right.x * a + up.x * b, y: centre.y + right.y * a + up.y * b, z: centre.z + right.z * a + up.z * b };
}

/** The way round the ring at `turn`, and straight out of it there, as unit vectors. */
export function ringFrame(placement: PortalPlacement, turn: number): { tangent: Point; radial: Point } {
  const angle = -Math.PI / 2 + turn * TAU, { up, right } = placement, c = Math.cos(angle), s = Math.sin(angle);
  return {
    tangent: { x: -right.x * s + up.x * c, y: -right.y * s + up.y * c, z: -right.z * s + up.z * c },
    radial: { x: right.x * c + up.x * s, y: right.y * c + up.y * s, z: right.z * c + up.z * s },
  };
}

/**
 * How far round the running spark has got, `age` seconds after it was struck, 0..1. Eased in and out: a spark at
 * full speed on its first frame reads as a wipe, not as something struck. Once home it stays home.
 */
export function portalScribe(age: number, scribeTime: number): number {
  const t = clamp01(age / Math.max(0.05, scribeTime));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * How far the way through has opened, 0..1: held shut until the spark is `delay` of the way round, then irised open
 * over `apertureTime`, fast and settling.
 */
export function portalAperture(age: number, scribeTime: number, apertureTime: number, delay = 0.76): number {
  const t = clamp01((age - scribeTime * clamp01(delay)) / Math.max(0.05, apertureTime));
  return 1 - (1 - t) ** 3;
}

/** The ring's colour as a temperature, 0 dark to 1 white-hot: a stroke laid a moment ago is hottest, and cools behind the spark. */
export function strokeHeat(behind: number, trail: number): number {
  return behind < 0 ? 0 : Math.exp(-behind / Math.max(1e-3, trail));
}

export interface PortalSparkSchedule {
  /** When the spark is struck at the foot, and how long it takes to run round. */
  struck: number;
  scribeTime: number;
  /** While the ring stands lit after the spark is home, it keeps throwing sparks all round, until this moment. */
  until: number;
  /** Sparks thrown while the spark runs round, and while the ring stands. */
  running: number;
  standing: number;
  /** The height of the board: the heavier sparks fall to it, bounce once and die. */
  floor: number;
  /** Which way round the ring throws: 1 or -1. */
  swirl?: number;
}

/**
 * When a spark thrown from `origin` at `velocity` under `gravity` and `drag` comes down onto the board at `floor`,
 * or -1 if it does not within `life`. Found by halving, which the closed-form flight makes cheap and exact enough.
 */
export function landing(origin: Point, velocity: Point, gravity: number, drag: number, floor: number, life: number): number {
  if (flightPoint(origin, velocity, gravity, drag, life).y > floor) return -1;
  let low = 0, high = life;
  for (let i = 0; i < 24; i += 1) { const mid = (low + high) / 2; if (flightPoint(origin, velocity, gravity, drag, mid).y > floor) low = mid; else high = mid; }
  return high;
}

/**
 * The sparks a portal's ring throws, with their births and whole flights, written once. While the spark runs round
 * they leave from a short arc behind it, many of them, thrown wide and carrying some of its speed; once it is home
 * they leave from all round the ring. Most are light and the drag bends their tangent into a curve; one in three is
 * heavy and falls, and those that reach the board bounce once, low, and die.
 */
export function portalSparks(placement: PortalPlacement, schedule: PortalSparkSchedule, dice: Dice, scale = placement.radius / 0.55): Particle[] {
  const sparks: Particle[] = [], { struck, scribeTime, until, running, standing, floor } = schedule, swirl = schedule.swirl ?? 1;
  const throwOne = (turn: number, birth: number, drawing: boolean) => {
    const at = ringPoint(placement, turn), { tangent, radial } = ringFrame(placement, turn), heavy = dice() < 0.34;
    const out = drawing ? 0.85 : 0.3, speed = (drawing ? 1.9 : 1.55) * scale * (0.5 + dice()), spread = scatter(dice);
    const head = drawing ? 2.4 * scale * Math.sin(Math.PI * clamp01((birth - struck) / scribeTime)) : 0;
    const way = unit({
      x: tangent.x * swirl * 1.45 + radial.x * out + spread.x * (drawing ? 0.4 : 0.12), y: tangent.y * swirl * 1.45 + radial.y * out + spread.y * (drawing ? 0.4 : 0.12),
      z: tangent.z * swirl * 1.45 + radial.z * out + spread.z * (drawing ? 0.4 : 0.12),
    });
    const velocity = { x: way.x * speed + tangent.x * swirl * head * 0.15, y: way.y * speed + tangent.y * swirl * head * 0.15, z: way.z * speed + tangent.z * swirl * head * 0.15 };
    const gravity = heavy ? 3.6 * scale : 0.25 * scale, drag = heavy ? 1.1 : 3.4, life = heavy ? 0.8 + 0.5 * dice() : 0.45 + 0.5 * dice();
    const down = heavy ? landing(at, velocity, gravity, drag, floor + 0.015, life) : -1;
    sparks.push({ kind: PARTICLE_KIND.streak, origin: at, velocity, birth, life: down > 0 ? down : life, size: (heavy ? 0.011 : 0.008 + 0.006 * dice()) * scale, drag, gravity, tone: 0.85 + 0.15 * dice(), fadeIn: 0.02 });
    if (down > 0) {
      // it hits the board, skips once, low and slower, and goes out
      const hit = flightPoint(at, velocity, gravity, drag, down), coming = flightVelocity(velocity, gravity, drag, down);
      sparks.push({ kind: PARTICLE_KIND.streak, origin: { x: hit.x, y: floor + 0.016, z: hit.z }, velocity: { x: coming.x * 0.45, y: Math.abs(coming.y) * 0.3, z: coming.z * 0.45 }, birth: birth + down, life: 0.16 + 0.18 * dice(), size: 0.008 * scale, drag: 2.5, gravity: 6, tone: 0.55 + 0.2 * dice(), fadeIn: 0.02 });
    }
  };
  for (let i = 0; i < running; i += 1) {
    const share = (i + dice()) / Math.max(1, running), birth = struck + share * scribeTime, head = portalScribe(birth - struck, scribeTime);
    // from a hand's width of contour behind the running spark
    throwOne(head - dice() * (0.09 / scale) * (0.55 / Math.max(0.2, placement.radius)), birth, true);
  }
  const from = struck + scribeTime;
  for (let i = 0; i < standing; i += 1) throwOne((i * 0.618034) % 1, from + ((i + dice()) / Math.max(1, standing)) * Math.max(0, until - from), false);
  return sparks;
}
