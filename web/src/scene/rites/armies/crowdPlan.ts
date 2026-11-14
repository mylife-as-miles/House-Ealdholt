/**
 * The arithmetic of an army a Queen calls onto the board: how many come, where each rises, the way each takes
 * between the pieces still standing, when each sets off and arrives, and the ring they close round the victim.
 * No Three.js in here, so the node tests reach it (shared/play/rite-armies.test.ts); armies/squad.ts moves the
 * figures by it.
 *
 * Everything is a function of the cast and its seed, decided once when the rite is made: the same capture calls
 * the same army onto the same squares on every machine and in every capture.
 *
 * The board is crowded and the figures on it are real, so the rules are hard ones:
 * - nothing rises, stands or walks within `clearance` of a piece still standing (the victim excepted at the end:
 *   the ring is closed round it);
 * - the ways round the pieces are found on a fine grid over the board (A*) and pulled taut, so a soldier walks a
 *   straight line wherever it can and bends round a piece only where it must;
 * - the ring round the victim is taken in order of bearing, so two soldiers' ways do not cross;
 * - a soldier sets off so as to arrive when the rite wants it, and never before it has risen.
 */
import type { QualityPreset } from "../../quality";

export interface Flat { x: number; z: number }

/** A seeded 0..1 sequence (the kit's): the same seed gives the same army on every machine. */
export function dice(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const distance = (a: Flat, b: Flat) => Math.hypot(a.x - b.x, a.z - b.z);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ budget

/** The most figures the match lends a rite (rites/rite.ts RiteCast.muster). */
export const MUSTER_LIMIT = 24;

export interface CrowdBudget {
  /** Soldiers lent by the match: whole figures of the Queen's own army, animated. The nearest to the eye. */
  troops: number;
  /** What is drawn behind them for next to nothing: silhouettes in the fog, hands at the seams. */
  extras: number;
}

/**
 * How many come at each tier. The lowest has no bloom and no lights and is meant for weak machines, so it has
 * about a third of the soldiers; every tier stays well under the match's limit, leaving room for the rite's own
 * extra figures (a colossus).
 */
export const CROWD_BUDGET: Readonly<Record<QualityPreset, CrowdBudget>> = {
  low: { troops: 5, extras: 6 },
  medium: { troops: 8, extras: 12 },
  high: { troops: 12, extras: 20 },
  ultra: { troops: 16, extras: 28 },
};

/** The budget at a tier, with `reserve` figures held back from the match's limit for the rite's own use. */
export function crowdBudget(quality: QualityPreset, reserve = 0): CrowdBudget {
  const base = CROWD_BUDGET[quality];
  return { troops: Math.max(0, Math.min(base.troops, MUSTER_LIMIT - Math.max(0, reserve))), extras: base.extras };
}

// ------------------------------------------------------------------ where they rise

export interface SpawnOptions {
  /** What they are called against: the victim's square. */
  centre: Flat;
  /** Every figure still standing, the Queen among them. */
  standing: readonly Flat[];
  count: number;
  /** The band round the centre they rise in. */
  inner: number;
  outer: number;
  /** How near a piece still standing a soldier may rise, and how near another soldier. */
  clearance: number;
  spacing: number;
  /** How far from the board's middle, along either axis, a soldier may stand. */
  bounds: number;
  seed: number;
  /** A way to favour (need not be unit): toward the player, so the charge is seen coming. 0..1 how strongly. */
  favour?: Flat;
  favourWeight?: number;
  /** Places nobody rises in: a seal something else comes through. */
  avoid?: readonly { at: Flat; radius: number }[];
}

/**
 * Where the soldiers rise: inside the band, clear of every piece and of each other, spread round the centre and
 * leaning toward the favoured side. Fewer than `count` when the board has no more room.
 */
export function planSpawns(options: SpawnOptions): Flat[] {
  const { centre, standing, count, inner, outer, clearance, bounds, seed } = options;
  const random = dice(seed ^ 0x51a7);
  const favour = options.favour && Math.hypot(options.favour.x, options.favour.z) > 1e-6 ? unit(options.favour) : null;
  const weight = favour ? clamp01(options.favourWeight ?? 0.5) : 0;
  const candidates: { at: Flat; score: number }[] = [];
  for (let i = 0; i < 520; i += 1) {
    const r = Math.sqrt(inner * inner + (outer * outer - inner * inner) * random()), turn = random() * TAU;
    const at = { x: centre.x + Math.cos(turn) * r, z: centre.z + Math.sin(turn) * r };
    if (Math.abs(at.x) > bounds || Math.abs(at.z) > bounds) continue;
    if (!clearOf(at, standing, clearance)) continue;
    if (options.avoid?.some((zone) => distance(at, zone.at) < zone.radius)) continue;
    const toward = favour ? ((at.x - centre.x) * favour.x + (at.z - centre.z) * favour.z) / Math.max(1e-6, r) : 0;
    candidates.push({ at, score: 1 + weight * toward + 0.15 * random() });
  }
  const picked: Flat[] = [];
  // the most favoured first, then each next as far from those taken as it can be, still leaning the favoured way
  for (let spacing = options.spacing; picked.length < count && spacing >= options.spacing * 0.6 - 1e-9; spacing *= 0.8) {
    while (picked.length < count) {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        let nearest = Infinity;
        for (const p of picked) nearest = Math.min(nearest, distance(c.at, p));
        if (nearest < spacing) continue;
        const score = picked.length === 0 ? c.score : Math.min(nearest, outer) * c.score;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) break;
      picked.push(candidates[best].at);
      candidates.splice(best, 1);
    }
  }
  return picked;
}

// ------------------------------------------------------------------ the ring round the victim

export interface Slot {
  at: Flat;
  /** Unit, toward the centre: the way a soldier on it faces. */
  facing: Flat;
  /** 0 for the ring nearest the victim, 1 for the one behind it. */
  rank: number;
}

export interface SlotOptions {
  centre: Flat;
  standing: readonly Flat[];
  count: number;
  /** The rings' radii, nearest first: the first is a weapon's reach from the victim. */
  radii: readonly number[];
  clearance: number;
  /** How near two soldiers on the rings may stand. */
  spacing: number;
  bounds: number;
  seed: number;
}

/**
 * The places round the victim the charge closes on: the nearest ring first, spread evenly round it so the victim
 * is surrounded rather than met from one side, and clear of every piece standing next to it.
 */
export function planSlots(options: SlotOptions): Slot[] {
  const { centre, standing, count, radii, clearance, spacing, bounds, seed } = options;
  const random = dice(seed ^ 0x2b07);
  const slots: Slot[] = [];
  radii.forEach((radius, rank) => {
    if (slots.length >= count) return;
    const room = Math.max(3, Math.floor((TAU * radius) / spacing));
    const start = random() * TAU, open: Slot[] = [];
    for (let k = 0; k < room; k += 1) {
      const turn = start + (k / room) * TAU + (rank % 2) * (Math.PI / room);
      const at = { x: centre.x + Math.cos(turn) * radius, z: centre.z + Math.sin(turn) * radius };
      if (Math.abs(at.x) > bounds || Math.abs(at.z) > bounds || !clearOf(at, standing, clearance)) continue;
      if (slots.some((slot) => distance(slot.at, at) < spacing * 0.98)) continue;
      open.push({ at, facing: unit({ x: centre.x - at.x, z: centre.z - at.z }), rank });
    }
    const wanted = Math.min(open.length, count - slots.length);
    // every so many round the ring, so a few soldiers still stand all round it
    for (let i = 0; i < wanted; i += 1) slots.push(open[Math.floor((i * open.length) / wanted)]);
  });
  return slots;
}

/** The bearing of a point round a centre, 0..2π. */
export function bearing(centre: Flat, at: Flat): number {
  const turn = Math.atan2(at.z - centre.z, at.x - centre.x);
  return turn < 0 ? turn + TAU : turn;
}

/**
 * Which slot each soldier makes for: soldiers and slots are both taken in order of bearing round the victim and
 * matched with the turn of one against the other that walks the least, so no two ways cross. A soldier with no
 * slot left gets -1.
 */
export function assignSlots(spawns: readonly Flat[], slots: readonly Slot[], centre: Flat): number[] {
  const out = spawns.map(() => -1);
  if (spawns.length === 0 || slots.length === 0) return out;
  const soldiers = spawns.map((at, index) => ({ index, turn: bearing(centre, at) })).sort((a, b) => a.turn - b.turn);
  const places = slots.map((slot, index) => ({ index, turn: bearing(centre, slot.at) })).sort((a, b) => a.turn - b.turn);
  const n = Math.min(soldiers.length, places.length);
  // with more soldiers than slots, the soldiers left without one are the ones furthest from any
  let chosen = soldiers;
  if (soldiers.length > n) {
    const reach = soldiers.map((s) => ({ ...s, near: Math.min(...slots.map((slot) => distance(spawns[s.index], slot.at))) }));
    const keep = new Set(reach.sort((a, b) => a.near - b.near).slice(0, n).map((s) => s.index));
    chosen = soldiers.filter((s) => keep.has(s.index));
  }
  let best = 0, bestCost = Infinity;
  for (let shift = 0; shift < places.length; shift += 1) {
    let cost = 0;
    for (let i = 0; i < n; i += 1) {
      const d = distance(spawns[chosen[i].index], slots[places[(i + shift) % places.length].index].at);
      cost += d * d;
    }
    if (cost < bestCost - 1e-9) { bestCost = cost; best = shift; }
  }
  for (let i = 0; i < n; i += 1) out[chosen[i].index] = places[(i + best) % places.length].index;
  return out;
}

// ------------------------------------------------------------------ the way between the pieces

/** Something a soldier walks round: a piece, or the victim, which may ask for a wider berth (`keep`) than the clearance. */
export interface Obstacle extends Flat { keep?: number }

export interface PathOptions {
  /** What must be walked round, and how near it the way may come (an obstacle's own `keep` where it has one). */
  obstacles: readonly Obstacle[];
  clearance: number;
  bounds: number;
  /** The grid's cell, in board units. A sixth of a square by default. */
  cell?: number;
}

/** Whether `at` is at least `clearance` (or an obstacle's own `keep`) from every one of `others`. */
export function clearOf(at: Flat, others: readonly Obstacle[], clearance: number): boolean {
  for (const other of others) if (distance(at, other) < (other.keep ?? clearance)) return false;
  return true;
}

/** The least distance from a point to a segment. */
export function segmentDistance(p: Flat, a: Flat, b: Flat): number {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length > 1e-12 ? clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / length) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Whether a soldier can walk straight from `a` to `b` without coming within `clearance` of any obstacle. */
export function lineClear(a: Flat, b: Flat, obstacles: readonly Obstacle[], clearance: number): boolean {
  for (const o of obstacles) {
    const keep = o.keep ?? clearance;
    // an obstacle the soldier already stands too near (its start, or its slot) only forbids walking further in
    const fromA = distance(o, a) < keep, fromB = distance(o, b) < keep;
    if (fromA || fromB) { if (segmentDistance(o, a, b) < Math.min(distance(o, a), distance(o, b)) - 1e-6) return false; continue; }
    if (segmentDistance(o, a, b) < keep) return false;
  }
  return true;
}

/**
 * The way from `from` to `to` round the obstacles: A* over a grid of cells (eight ways from each), pulled taut by
 * cutting every corner that can be cut in a straight line. Its ends are exactly the two points. When the grid has
 * no way through, the straight line.
 */
export function findPath(from: Flat, to: Flat, options: PathOptions): Flat[] {
  const { obstacles, clearance, bounds } = options;
  if (lineClear(from, to, obstacles, clearance)) return [from, to];
  const cell = options.cell ?? 0.17;
  const size = Math.max(4, Math.ceil((bounds * 2) / cell) + 1), origin = -bounds;
  const toCell = (p: Flat) => ({ i: clamp(Math.round((p.x - origin) / cell), 0, size - 1), j: clamp(Math.round((p.z - origin) / cell), 0, size - 1) });
  const centreOf = (i: number, j: number): Flat => ({ x: origin + i * cell, z: origin + j * cell });
  const start = toCell(from), goal = toCell(to);
  const blocked = new Uint8Array(size * size);
  for (let j = 0; j < size; j += 1) for (let i = 0; i < size; i += 1) if (!clearOf(centreOf(i, j), obstacles, clearance)) blocked[j * size + i] = 1;
  const startKey = start.j * size + start.i, goalKey = goal.j * size + goal.i;
  // the soldier's own start and goal may lie a little inside the clearance (a slot hard by a piece): let it out
  blocked[startKey] = 0; blocked[goalKey] = 0;
  const g = new Float64Array(size * size).fill(Infinity), came = new Int32Array(size * size).fill(-1), closed = new Uint8Array(size * size);
  const heuristic = (i: number, j: number) => { const dx = Math.abs(i - goal.i), dz = Math.abs(j - goal.j); return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cell; };
  const open = new OpenList();
  g[startKey] = 0; open.push(startKey, heuristic(start.i, start.j), heuristic(start.i, start.j));
  let found = false;
  while (open.size > 0) {
    const k = open.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goalKey) { found = true; break; }
    const i = k % size, j = Math.floor(k / size);
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
      if (di === 0 && dj === 0) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nk = nj * size + ni;
      if (blocked[nk] || closed[nk]) continue;
      // no squeezing diagonally between two blocked cells
      if (di !== 0 && dj !== 0 && (blocked[j * size + ni] || blocked[nj * size + i])) continue;
      const step = (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) * cell, next = g[k] + step;
      if (next < g[nk] - 1e-12) { g[nk] = next; came[nk] = k; const h = heuristic(ni, nj); open.push(nk, next + h, h); }
    }
  }
  if (!found) return [from, to];
  const cells: Flat[] = [];
  for (let k = goalKey; k !== -1 && k !== startKey; k = came[k]) cells.push(centreOf(k % size, Math.floor(k / size)));
  cells.reverse();
  const raw = [from, ...cells.slice(0, -1), to];
  // pulled taut: from each point, straight on to the furthest point it can see
  const taut: Flat[] = [from];
  let at = 0;
  while (at < raw.length - 1) {
    let next = at + 1;
    for (let k = raw.length - 1; k > at + 1; k -= 1) if (lineClear(raw[at], raw[k], obstacles, clearance)) { next = k; break; }
    taut.push(raw[next]);
    at = next;
  }
  return taut;
}

/** A binary heap of grid cells by cost, then by what is left to go, then by the order they were found: stable. */
class OpenList {
  private keys: number[] = [];
  private costs: number[] = [];
  private lefts: number[] = [];
  private orders: number[] = [];
  private count = 0;
  get size(): number { return this.keys.length; }
  push(key: number, cost: number, left: number): void {
    this.keys.push(key); this.costs.push(cost); this.lefts.push(left); this.orders.push(this.count++);
    let i = this.keys.length - 1;
    while (i > 0) { const up = (i - 1) >> 1; if (!this.before(i, up)) break; this.swap(i, up); i = up; }
  }
  pop(): number {
    const top = this.keys[0], last = this.keys.length - 1;
    this.swap(0, last);
    this.keys.pop(); this.costs.pop(); this.lefts.pop(); this.orders.pop();
    let i = 0;
    for (;;) {
      const a = 2 * i + 1, b = a + 1;
      let best = i;
      if (a < this.keys.length && this.before(a, best)) best = a;
      if (b < this.keys.length && this.before(b, best)) best = b;
      if (best === i) break;
      this.swap(i, best); i = best;
    }
    return top;
  }
  private before(a: number, b: number): boolean {
    if (Math.abs(this.costs[a] - this.costs[b]) > 1e-12) return this.costs[a] < this.costs[b];
    if (Math.abs(this.lefts[a] - this.lefts[b]) > 1e-12) return this.lefts[a] < this.lefts[b];
    return this.orders[a] < this.orders[b];
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]; [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
    [this.lefts[a], this.lefts[b]] = [this.lefts[b], this.lefts[a]]; [this.orders[a], this.orders[b]] = [this.orders[b], this.orders[a]];
  }
}

/** How long a way is. */
export function pathLength(path: readonly Flat[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) length += distance(path[i - 1], path[i]);
  return length;
}

/** The point `s` along a way (clamped to it), and the unit way it runs there. */
export function pointOnPath(path: readonly Flat[], s: number): { at: Flat; heading: Flat } {
  if (path.length === 1) return { at: { ...path[0] }, heading: { x: 0, z: 1 } };
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1], b = path[i], d = distance(a, b);
    if (left <= d || i === path.length - 1) {
      const t = d > 1e-9 ? clamp01(left / d) : 1;
      const heading = d > 1e-9 ? { x: (b.x - a.x) / d, z: (b.z - a.z) / d } : { x: 0, z: 1 };
      return { at: t >= 1 ? { ...b } : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, heading };
    }
    left -= d;
  }
  return { at: { ...path[path.length - 1] }, heading: { x: 0, z: 1 } };
}

// ------------------------------------------------------------------ the march

/**
 * The shape of a soldier's speed over its march, as knots of (share of the march's time, share of the top speed).
 * The march is drawn through them in straight lines, from a standstill to a standstill.
 */
export type SpeedShape = readonly (readonly [number, number])[];

/** March, then charge: up to a walk, held, up to a run, held, and pulled up at the ring. */
export const MARCH_THEN_CHARGE: SpeedShape = [[0, 0], [0.1, 0.42], [0.34, 0.42], [0.5, 1], [0.88, 1], [1, 0]];
/** One steady pace from a standstill to a standstill: a shamble. */
export const STEADY: SpeedShape = [[0, 0], [0.12, 1], [0.88, 1], [1, 0]];

/** The area under a shape: the share of the top speed its march averages. */
export function shapeArea(shape: SpeedShape): number {
  let area = 0;
  for (let i = 1; i < shape.length; i += 1) area += ((shape[i][0] - shape[i - 1][0]) * (shape[i][1] + shape[i - 1][1])) / 2;
  return area;
}

/** The share of the way covered by `u` of the march's time, and the share of the top speed then (unnormalised). */
export function shapeTravel(shape: SpeedShape, u: number): { covered: number; speed: number } {
  const area = Math.max(1e-9, shapeArea(shape));
  let covered = 0;
  for (let i = 1; i < shape.length; i += 1) {
    const [u0, v0] = shape[i - 1], [u1, v1] = shape[i];
    if (u <= u1 || i === shape.length - 1) {
      const t = clamp(u, u0, u1) - u0, span = u1 - u0, slope = span > 1e-9 ? (v1 - v0) / span : 0;
      covered += v0 * t + 0.5 * slope * t * t;
      return { covered: clamp01(covered / area), speed: v0 + slope * t };
    }
    covered += ((u1 - u0) * (v0 + v1)) / 2;
  }
  return { covered: 1, speed: 0 };
}

export interface March {
  path: Flat[];
  length: number;
  /** When it begins to rise, and how long rising takes. */
  riseAt: number;
  riseFor: number;
  /** When it sets off, and when it stands at its slot. */
  departAt: number;
  arriveAt: number;
  /** Its top speed, units a second, and the shape of its pace. */
  top: number;
  shape: SpeedShape;
  /** From this share of the march's time it is running rather than walking. */
  charge: number;
}

export interface MarchOptions {
  riseAt: number;
  riseFor: number;
  /** When it should stand at its slot: it leaves in time, unless rising holds it up, and then it is later. */
  arriveAt: number;
  /** Its top speed, and the least and most seconds a march may take whatever its length. */
  top: number;
  shape?: SpeedShape;
  least?: number;
  most?: number;
  /** A pause after rising before it may set off. */
  settle?: number;
}

/** Plans one soldier's march along a way. */
export function planMarch(path: readonly Flat[], options: MarchOptions): March {
  const shape = options.shape ?? MARCH_THEN_CHARGE;
  const length = pathLength(path);
  const ideal = length / Math.max(1e-6, options.top * shapeArea(shape));
  const time = clamp(ideal, options.least ?? 0.3, options.most ?? 4);
  const ready = options.riseAt + options.riseFor + (options.settle ?? 0);
  const arriveAt = Math.max(options.arriveAt, ready + time);
  // the share of the time from which it runs: the knot where the shape reaches its top
  const top = shape.findIndex(([, v]) => v >= 0.999);
  return {
    path: path.map((p) => ({ ...p })), length, riseAt: options.riseAt, riseFor: options.riseFor, departAt: arriveAt - time, arriveAt,
    top: length / Math.max(1e-6, time * shapeArea(shape)), shape, charge: top > 0 ? (shape[top - 1][0] + shape[top][0]) / 2 : 0,
  };
}

export type MarchPhase = "hidden" | "rising" | "waiting" | "walking" | "running" | "arrived";

export interface MarchState {
  at: Flat;
  /** The unit way it faces: along its way while it moves, then the way its last leg ran. */
  heading: Flat;
  /** Units a second. */
  speed: number;
  phase: MarchPhase;
  /** How far it has risen, 0..1, and how far through its march it is, 0..1. */
  risen: number;
  progress: number;
}

/** Where a soldier is and what it is doing `t` seconds into the rite. */
export function marchState(march: March, t: number): MarchState {
  const { path, length, riseAt, riseFor, departAt, arriveAt, shape, top } = march;
  const risen = riseFor > 0 ? clamp01((t - riseAt) / riseFor) : t >= riseAt ? 1 : 0;
  const span = Math.max(1e-6, arriveAt - departAt), u = clamp01((t - departAt) / span);
  const travel = shapeTravel(shape, u);
  const s = length * travel.covered;
  const here = u >= 1 ? { at: { ...path[path.length - 1] }, heading: pointOnPath(path, length).heading } : pointOnPath(path, s);
  // looking a little ahead along the way, so it turns into a bend rather than at it
  const ahead = pointOnPath(path, Math.min(length, s + 0.18));
  let heading = here.heading;
  const look = { x: ahead.at.x - here.at.x, z: ahead.at.z - here.at.z };
  if (Math.hypot(look.x, look.z) > 1e-4) heading = unit(look);
  const phase: MarchPhase = t < riseAt ? "hidden" : t < riseAt + riseFor ? "rising" : t < departAt ? "waiting" : t < arriveAt ? (u < march.charge ? "walking" : "running") : "arrived";
  return { at: here.at, heading, speed: t > departAt && t < arriveAt ? top * travel.speed : 0, phase, risen, progress: u };
}

// ------------------------------------------------------------------ the charge, whole

export interface ChargeInput {
  victim: Flat;
  standing: readonly Flat[];
  viewer: Flat;
  count: number;
  seed: number;
  /** Half the board's width, and how far in from its edge a soldier must keep. */
  half: number;
  margin?: number;
  spawn: { inner: number; outer: number; favourWeight?: number; avoid?: readonly { at: Flat; radius: number }[] };
  ring: { radii: readonly number[]; spacing: number };
  /** How near a piece still standing a soldier may come, and how near another soldier rises. */
  clearance: number;
  spacing: number;
  /** Rising: the first begins at `from`, the last by `from + spread`, each taking `length`. */
  rise: { from: number; spread: number; length: number; settle?: number };
  /** Arriving at the ring: the first at `first`, the last by `first + spread`. */
  arrive: { first: number; spread: number };
  gait: { top: number; shape?: SpeedShape; least?: number; most?: number };
}

export interface Charger {
  spawn: Flat;
  slot: Slot | null;
  march: March;
  /** Its distance from the player when the charge ends: the nearest come first in the list. */
  near: number;
}

/**
 * The whole charge: where each soldier rises, the slot it closes on, its way there between the pieces and its
 * timing. The list is ordered nearest the player first, so a rite lent fewer figures than it asked for drops the
 * furthest. A soldier with no slot left holds where it rose.
 */
export function planCharge(input: ChargeInput): Charger[] {
  const { victim, standing, viewer, count, seed, clearance } = input;
  const bounds = input.half - (input.margin ?? 0.25);
  const random = dice(seed ^ 0x9e37);
  const spawns = planSpawns({
    centre: victim, standing, count, inner: input.spawn.inner, outer: input.spawn.outer, clearance, spacing: input.spacing, bounds, seed,
    favour: { x: viewer.x - victim.x, z: viewer.z - victim.z }, favourWeight: input.spawn.favourWeight ?? 0.45, avoid: input.spawn.avoid,
  });
  const slots = planSlots({ centre: victim, standing, count: spawns.length, radii: input.ring.radii, clearance: clearance * 0.92, spacing: input.ring.spacing, bounds, seed });
  const assigned = assignSlots(spawns, slots, victim);
  // the order they arrive in: seeded, so the ring closes raggedly rather than all on one beat
  const order = spawns.map((_, i) => ({ i, key: random() })).sort((a, b) => a.key - b.key).map((entry, rank) => ({ ...entry, rank }));
  const rankOf = new Map(order.map((entry) => [entry.i, entry.rank]));
  const chargers = spawns.map((spawn, i): Charger => {
    const slot = assigned[i] >= 0 ? slots[assigned[i]] : null;
    const goal = slot ? slot.at : spawn;
    // the victim is walked round too, outside the nearest ring, until the soldier's own slot is reached
    const obstacles: Obstacle[] = [...standing, { ...victim, keep: Math.max(clearance, (input.ring.radii[0] ?? clearance) - 0.03) }];
    const path = slot ? findPath(spawn, goal, { obstacles, clearance, bounds }) : [spawn];
    const k = spawns.length > 1 ? i / (spawns.length - 1) : 0;
    const rank = rankOf.get(i) ?? 0, share = spawns.length > 1 ? rank / (spawns.length - 1) : 0;
    const march = planMarch(path, {
      riseAt: input.rise.from + input.rise.spread * (0.65 * k + 0.35 * random()), riseFor: input.rise.length, settle: input.rise.settle ?? 0.1,
      arriveAt: input.arrive.first + input.arrive.spread * share, top: input.gait.top, shape: input.gait.shape, least: input.gait.least, most: input.gait.most,
    });
    return { spawn, slot, march, near: distance(goal, viewer) };
  });
  return chargers.sort((a, b) => a.near - b.near);
}

export function unit(v: Flat): Flat {
  const length = Math.hypot(v.x, v.z);
  return length > 1e-9 ? { x: v.x / length, z: v.z / length } : { x: 0, z: 1 };
}
