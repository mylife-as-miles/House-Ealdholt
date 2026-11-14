// Adapted from LinearAbiltyCastingExtendedThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The arithmetic of what an army's summons does to the stone: slabs of the board heaved up and dropped back, the
 * front of the blow running out across it, and the board made whole again for the game to go on. No Three.js in
 * here, so the node tests reach it (shared/play/rite-armies-ground.test.ts); armies/ground.ts draws what this
 * decides.
 *
 * From the reference's Brutalist Earth Blast: slabs of the floor sheared up behind a front that slows as it
 * spreads, three sizes of them so the eye has something to judge the big ones by, and every one a record of dice
 * rather than of metres. Ours is a board a game is still being played on, so:
 * - a slab is a piece of one square, the square's own stone, and never lifts from under a piece still standing;
 * - each one falls back into its own place, bounces and lies flush, and is then put away: what is left is the board;
 * - the scars on the stone close the same way: nothing the rite opens is left open when it is done.
 */
import { dice, type Flat } from "./crowdPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const TAU = Math.PI * 2;

/**
 * How far the front of a blow has run, `since` seconds after it, toward `reach`: fast out of the blow and slowing,
 * as a wave carrying the same energy round an ever longer ring does (1 - (1 - t)^2 over `time`).
 */
export function frontRadius(since: number, reach: number, time: number): number {
  if (since <= 0) return 0;
  const t = clamp01(since / Math.max(1e-6, time));
  return reach * (1 - (1 - t) * (1 - t));
}

/** When the front reaches `distance` from the blow: the inverse of {@link frontRadius} (Infinity past its reach). */
export function frontArrival(distance: number, reach: number, time: number): number {
  if (distance <= 0) return 0;
  if (distance >= reach) return Infinity;
  return time * (1 - Math.sqrt(1 - distance / reach));
}

export interface Slab {
  /** Its centre at rest, on the stone, and its size: a piece of one square. */
  at: Flat;
  width: number;
  depth: number;
  thickness: number;
  /** Whether it is cut from a light square or a dark one. */
  light: boolean;
  /** The unit way from the blow to it: it is heaved up on the side nearer the blow, and tips away from it. */
  away: Flat;
  /** How high its middle is thrown, how far it tips (radians), and how far it turns while it is up. */
  lift: number;
  tilt: number;
  spin: number;
  /** When the front reaches it, and how long it takes to go up, to hang, to come down and to settle. */
  birth: number;
  rise: number;
  hang: number;
  fall: number;
  settle: number;
  seed: number;
}

export interface SlabOptions {
  /** Where the blow lands. */
  centre: Flat;
  standing: readonly Flat[];
  count: number;
  /** The band round the blow slabs come up in. */
  inner: number;
  outer: number;
  /** How near a piece still standing any edge of a slab may come. */
  clearance: number;
  /** How far from the board's middle, along either axis, a slab may lie. */
  bounds: number;
  tile: number;
  seed: number;
  /** When the blow lands, and the front that runs out from it. */
  blow: number;
  reach: number;
  spread: number;
  /** A slab's size as a share of a square: the largest few, then the rest. */
  size?: { big: number; small: number };
  /** How high the biggest is thrown; the rest less. */
  height?: number;
  /** Seconds it hangs at its height before it falls. */
  hang?: number;
  /** Places no slab lifts from: where something else is drawn on the stone. */
  avoid?: readonly { at: Flat; radius: number }[];
}

/** Which square a point is on: its file and rank as numbers from 0, or null off the board. */
export function squareAt(at: Flat, tile: number): { file: number; rank: number } | null {
  const file = Math.round(at.x / tile + 3.5), rank = Math.round(3.5 - at.z / tile);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return { file, rank };
}

/** Whether the square under a point is a light one (board.ts isLightSquare, with ranks counted from 0). */
export function lightAt(at: Flat, tile: number): boolean {
  const square = squareAt(at, tile);
  return square ? (square.file + square.rank + 1) % 2 === 0 : false;
}

/**
 * Where the slabs come up: the biggest nearest the blow, every one inside a single square so it is that square's
 * stone, clear of every piece and of each other. Fewer than `count` when the board has no more room.
 */
export function planSlabs(options: SlabOptions): Slab[] {
  const { centre, standing, count, inner, outer, clearance, bounds, tile, seed } = options;
  const random = dice(seed ^ 0x51ab);
  const size = options.size ?? { big: 0.62, small: 0.3 }, height = options.height ?? 0.55, hang = options.hang ?? 0.35;
  const slabs: Slab[] = [];
  const radiusOf = (slab: { width: number; depth: number }) => Math.hypot(slab.width, slab.depth) / 2;
  for (let attempt = 0; attempt < count * 40 && slabs.length < count; attempt += 1) {
    const k = slabs.length / Math.max(1, count - 1), share = size.big + (size.small - size.big) * Math.min(1, k * 1.6);
    const width = tile * share * (0.85 + 0.3 * random()), depth = tile * share * (0.75 + 0.35 * random());
    // nearer the blow for the big ones
    const band = inner + (outer - inner) * Math.min(1, 0.25 + 0.75 * k) * Math.sqrt(random());
    const turn = random() * TAU;
    const rough = { x: centre.x + Math.cos(turn) * band, z: centre.z + Math.sin(turn) * band };
    const square = squareAt(rough, tile);
    if (!square) continue;
    // kept inside its own square, a little in from the seams
    const mid = { x: (square.file - 3.5) * tile, z: (3.5 - square.rank) * tile };
    const roomX = Math.max(0, tile * 0.47 - width / 2), roomZ = Math.max(0, tile * 0.47 - depth / 2);
    const at = { x: Math.min(mid.x + roomX, Math.max(mid.x - roomX, rough.x)), z: Math.min(mid.z + roomZ, Math.max(mid.z - roomZ, rough.z)) };
    if (Math.abs(at.x) > bounds || Math.abs(at.z) > bounds) continue;
    const reach = radiusOf({ width, depth });
    const gap = Math.hypot(at.x - centre.x, at.z - centre.z);
    if (gap < inner * 0.9) continue;
    if (standing.some((s) => Math.hypot(s.x - at.x, s.z - at.z) < clearance + reach)) continue;
    if (options.avoid?.some((zone) => Math.hypot(zone.at.x - at.x, zone.at.z - at.z) < zone.radius + reach)) continue;
    if (slabs.some((other) => Math.hypot(other.at.x - at.x, other.at.z - at.z) < (radiusOf(other) + reach) * 0.92)) continue;
    const away = gap > 1e-6 ? { x: (at.x - centre.x) / gap, z: (at.z - centre.z) / gap } : { x: 0, z: 1 };
    const arrive = frontArrival(gap, options.reach, options.spread);
    if (!Number.isFinite(arrive)) continue;
    // the nearer the blow, the harder it is thrown
    const force = 1 - 0.55 * Math.min(1, gap / outer);
    const lift = height * force * (share / size.big) * (0.7 + 0.5 * random());
    slabs.push({
      at, width, depth, thickness: tile * (0.07 + 0.05 * random()) * (share / size.big + 0.4), light: lightAt(at, tile), away,
      lift, tilt: (0.35 + 0.65 * random()) * 0.9 * force, spin: (random() - 0.5) * 0.9,
      birth: options.blow + arrive, rise: 0.16 + 0.1 * random(), hang: hang * (0.7 + 0.6 * random()), fall: Math.sqrt((2 * Math.max(0.05, lift)) / 9.8) * 1.15, settle: 0.5 + 0.2 * random(),
      seed: Math.floor(random() * 1e6),
    });
  }
  return slabs;
}

export interface SlabPose {
  /** How high its middle stands above its place, how far it is tipped, and turned. */
  lift: number;
  tilt: number;
  spin: number;
  /** How dark the place it came out of is, 0..1: the hole it leaves, closing as it settles. */
  hole: number;
  /** False before it is heaved and once it lies flush again: the board itself is all there is to see. */
  shown: boolean;
}

/** When a slab lies flush again and is put away. */
export function slabEnd(slab: Slab): number {
  return slab.birth + slab.rise + slab.hang + slab.fall + slab.settle;
}

/**
 * What a slab is doing at `t`: heaved up fast, tipping away from the blow; held, rocking; dropped back under
 * gravity; bounced twice, less each time; and flush.
 */
export function slabPose(slab: Slab, t: number): SlabPose {
  const { birth, rise, hang, fall, settle } = slab;
  const since = t - birth;
  if (since <= 0) return { lift: 0, tilt: 0, spin: 0, hole: 0, shown: false };
  const up = birth + rise, down = up + hang, landed = down + fall, end = landed + settle;
  if (t >= end) return { lift: 0, tilt: 0, spin: 0, hole: 0, shown: false };
  if (t < up) {
    const u = clamp01(since / rise), eased = 1 - (1 - u) ** 3;
    return { lift: slab.lift * eased, tilt: slab.tilt * eased, spin: slab.spin * eased * 0.6, hole: eased, shown: true };
  }
  if (t < down) {
    const u = (t - up) / Math.max(1e-6, hang);
    // it rocks a little at the top of its throw, still rising a touch
    const rock = Math.sin(u * Math.PI * 2.2) * 0.12 * (1 - u);
    return { lift: slab.lift * (1 + 0.08 * Math.sin(u * Math.PI)), tilt: slab.tilt * (1 + rock), spin: slab.spin * (0.6 + 0.4 * u), hole: 1, shown: true };
  }
  if (t < landed) {
    const u = (t - down) / Math.max(1e-6, fall);
    // dropped: it falls as a dropped thing does, and lies down flat as it comes
    return { lift: slab.lift * (1 - u * u), tilt: slab.tilt * (1 - u) * (1 - u * 0.5), spin: slab.spin, hole: 1, shown: true };
  }
  const u = (t - landed) / Math.max(1e-6, settle);
  // two bounces, the second smaller, then still; the hole closes as it comes to rest in it
  const bounce = Math.abs(Math.sin(u * Math.PI * 2)) * Math.exp(-4 * u) * Math.min(0.05, slab.lift * 0.12);
  return { lift: bounce, tilt: slab.tilt * 0.06 * Math.sin(u * Math.PI * 3) * (1 - u), spin: slab.spin * (1 - u * u), hole: 1 - u * u * (3 - 2 * u), shown: true };
}

/**
 * How much of a scar on the stone is left: none before it opens, all of it from `open` to `close`, and none again by
 * `healed`, closing smoothly. The board must be whole again when the rite is done.
 */
export function scarLeft(t: number, open: number, close: number, healed: number): number {
  if (t <= open || t >= healed) return 0;
  if (t <= close) return 1;
  const u = clamp01((t - close) / Math.max(1e-6, healed - close));
  return 1 - u * u * (3 - 2 * u);
}
