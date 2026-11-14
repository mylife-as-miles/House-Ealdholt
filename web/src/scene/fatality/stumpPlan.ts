/**
 * A fatality that also takes a limb off (gore tier 3 with a sever, death/sever): its fluid blood pours from the stump
 * as well as from the wound. fatality/fluid.ts pours both into one fluid; the engine finds the stump
 * (sceneEngine.ts pourFatality and pourStump, through SeverSystem.stumps). docs/play/GORE_SYSTEM.md, "Detailed fluid
 * blood".
 *
 * - The budget: the fatality's own (`show.budget.fluid`, the preset's) is shared, never doubled. The wound pours the
 *   larger share and the stump the rest; where no limb is off and none can still come off, the wound keeps it all. A
 *   kill with no fatality (a tier 2 execution's cut) or no fluid (the Low preset) pours nothing, from either.
 * - When: as the limb comes off. A duel's killing blow and the undead army's killing tearing take it on the frame the
 *   fatality begins (before it, in the same frame), so the stump pours with the wound. A wyvern tears a limb off as it
 *   feeds, more than a second of scene time after its blow: the share is kept from the start, and the stump pours as
 *   the limb comes off, while the wound's blood still runs ({@link STUMP}.within). Later than that, the stump keeps
 *   its ordinary spurts alone (death/sever/SeverSystem.ts), as every stump has.
 * - Where: out of the cut's face, just past the cap of flesh that closes it, along the stump's own bone (the way the
 *   limb went), riding on that bone as the body falls or is carried (the engine's `follow`).
 * - How: the arteries' few ropy jets on the heart's beat, close round the stump's axis and leaning up a little so they
 *   arc, a share flung loose, and a share welling over the rim and spilling down; front-loaded, as the wound's pour.
 *   Where it lands, and the marks it leaves, are the wound's own closed form (fatality/fluidPlan.ts).
 *
 * Pure, no three.js: shared/play/fatality-stump.test.ts.
 */
import type { GoreShow } from "../gore/goreTiers";
import { hash01 } from "../death/physics/math";
import { FLUID, cone, pressure, type FluidLaunch, type Point } from "./fluidPlan";

export const STUMP = {
  /** The stump's share of the fatality's fluid budget, when a limb is off or may still come off; the least either pour is worth (particles). */
  share: 0.4, least: 256,
  /** Scene seconds after the wound began to pour that a limb coming off still pours: the wound's blood is still running. */
  within: FLUID.thin,
  /** How far out of the cut the blood leaves, a share of the cut's radius: over the cap that closes it, which stands a quarter out. */
  out: 0.3,
  /** The arteries' jets, how far each strays from the stump's axis (radians), how far it lies from the cut's middle (a share of its radius), and how far up they lean. */
  jets: 2, spread: 0.22, off: 0.45, lift: 0.15,
  /** The share that wells over the rim and spills down, and how wide (radians off the axis). */
  spill: 0.28, spillSpread: 1.0,
  /** Launch speeds, a share of the figure's height a second: a jet's own speed is between the first two, the spill's between the last two. */
  slowest: 1.4, fastest: 2.6, spillSlowest: 0.25, spillFastest: 0.8,
} as const;

/** What a fatality's stump may do when its wound begins to pour: none is off nor can come off, one is off already, or one may still come off (a summon's tearings to come). */
export type StumpChance = "none" | "off" | "may";

/**
 * How the fatality's fluid budget is shared between the wound and a stump: never more than the budget between them,
 * and nothing at all without a fatality that shows the fluid.
 */
export function pourShares(show: Pick<GoreShow, "fatality" | "fluid"> & { budget: { fluid: number } }, chance: StumpChance): { wound: number; stump: number } {
  const budget = show.fatality && show.fluid ? Math.max(0, Math.floor(show.budget.fluid)) : 0;
  if (chance === "none") return { wound: budget, stump: 0 };
  const stump = Math.floor(budget * STUMP.share);
  if (stump < STUMP.least || budget - stump < STUMP.least) return { wound: budget, stump: 0 };
  return { wound: budget - stump, stump };
}

/**
 * When the stump begins to pour, on the fluid's clock (scene seconds since the wound began to pour; 0 or less when its
 * limb came off first): with the wound, or as the limb comes off while the wound's blood still runs. Null when it comes
 * off later than that, or no share of the budget was kept for it.
 */
export function stumpStart(cut: number, kept: number): number | null {
  if (!(kept >= STUMP.least) || !(cut <= STUMP.within)) return null;
  return Math.max(0, cut);
}

/** A stump as a wound to pour from: where the blood leaves it, the way out (unit), the cut's radius, the figure's height, and its seed. */
export interface StumpWound {
  entry: Point;
  direction: Point;
  radius: number;
  height: number;
  seed: number;
}

/**
 * The stump to pour from: `joint` is where the limb was cut off (the folded bone's joint) and `axis` the way it went,
 * the stump's own bone, as SeverSystem's spurts take them. The blood leaves a little out along it, past the cap.
 */
export function stumpWound(cut: { joint: Point; axis: Point; radius: number }, height: number, seed: number): StumpWound {
  const direction = unit(cut.axis, { x: 0, y: 1, z: 0 });
  const radius = Math.max(0, cut.radius);
  return { entry: add(cut.joint, scale(direction, radius * STUMP.out)), direction, radius, height, seed: (seed ^ 0x5d1e7a3b) >>> 0 };
}

/** Particle `index` of `count` of a stump's pour: where on the cut and when it leaves, and how fast. */
export function stumpLaunch(stump: StumpWound, index: number, count: number): FluidLaunch {
  const h = (k: number) => hash01(stump.seed, index, k);
  const axis = unit(stump.direction, { x: 0, y: 1, z: 0 });
  // Front-loaded, as the wound's: most of it in the first moments, a thin last of it after.
  const birth = FLUID.pour * Math.pow((index + h(1)) / Math.max(1, count), 1.7);
  const spill = h(0) < STUMP.spill, loose = !spill && h(10) < FLUID.loose;
  // Each artery: its own place on the cut and its own lean off the axis, the whole leaning up so it arcs.
  const jet = Math.floor(h(2) * STUMP.jets);
  const jetTurn = hash01(stump.seed, 9300 + jet, 0) * Math.PI * 2;
  const jetTilt = STUMP.spread * (0.3 + 0.7 * hash01(stump.seed, 9310 + jet, 1));
  const lifted = unit(add(axis, { x: 0, y: STUMP.lift, z: 0 }), axis);
  // A rope that wanders a little as it pours; a drop keeps near its jet's line and speed.
  const wander = 0.15 * Math.sin(birth * 23 + jet * 1.7);
  let heading: Point, speed: number;
  if (spill) {
    // Welling over the rim, slow and wide: it falls down the stump and the body under it.
    heading = cone(axis, STUMP.spillSpread * Math.sqrt(h(3)), h(4) * Math.PI * 2);
    speed = STUMP.spillSlowest + (STUMP.spillFastest - STUMP.spillSlowest) * h(5);
  } else {
    heading = cone(cone(lifted, jetTilt, jetTurn + wander), (loose ? FLUID.flung : FLUID.scatter) * Math.sqrt(h(3)), h(4) * Math.PI * 2);
    const jetSpeed = STUMP.slowest + (STUMP.fastest - STUMP.slowest) * hash01(stump.seed, 9320 + jet, 2);
    speed = loose ? STUMP.slowest + (STUMP.fastest - STUMP.slowest) * h(5) : jetSpeed * (1 + FLUID.even * (h(5) - 0.5) * 2);
  }
  // Where on the cut's face it leaves: a jet from its artery, the spill from round the rim, a loose drop from anywhere.
  const across = unit(Math.abs(axis.y) > 0.92 ? cross(axis, { x: 1, y: 0, z: 0 }) : cross(axis, { x: 0, y: 1, z: 0 }), { x: 1, y: 0, z: 0 });
  const over = cross(axis, across);
  const reach = spill ? 0.75 + 0.25 * h(6) : loose ? Math.sqrt(h(6)) : STUMP.off * hash01(stump.seed, 9330 + jet, 3) + 0.1 * h(6);
  const bearing = spill || loose ? h(7) * Math.PI * 2 : hash01(stump.seed, 9340 + jet, 4) * Math.PI * 2 + 0.5 * (h(7) - 0.5);
  const r = stump.radius * reach, lip = stump.height * 0.004 * (h(8) - 0.5);
  const origin = add(add(stump.entry, scale(across, Math.cos(bearing) * r)), add(scale(over, Math.sin(bearing) * r), scale(axis, lip)));
  return {
    origin, velocity: scale(heading, stump.height * speed * pressure(birth)), drag: FLUID.drag, birth,
    size: stump.height * FLUID.radius * (0.7 + 0.6 * h(9)),
  };
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Point, fallback: Point): Point => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? scale(a, 1 / l) : { ...fallback }; };
