/**
 * The shape of the arena's lava, worked out once when the look loads (arena-lava.ts draws it). The look's lava meshes
 * are a few dozen triangles with no UVs: pools are fans, rivers are ladders draped over the terrain, the abyss is a
 * coarse sheet. From each this builds a finer surface that keeps the footprint and carries, per vertex, what the
 * shader needs: where the crust pattern sits, which way and how fast it moves, how hot it is, and how far the shore
 * is. Nothing here touches WebGL, so it can be tested as plain numbers.
 *
 * Lengths are Blender metres throughout (the look's files), y up.
 */

export type Vec3 = [number, number, number];

/** A lava surface ready to become a BufferGeometry. */
export interface LavaSurface {
  positions: Float32Array;
  normals: Float32Array;
  /** Where the crust pattern sits, in metres of pattern (two per vertex). */
  pattern: Float32Array;
  /** How the pattern moves: metres a second along each pattern axis, then 1 if it scrolls for ever (a river) or 0 if
   *  it is carried a little and reset (a pool or the abyss, see the two phases in the shader). Three per vertex. */
  flow: Float32Array;
  /** Heat (about 0 to 1.3), metres to the shore, how much of a fall this is (0 to 1), and how much fresh lava wells
   *  up or lands here (0 to 1). Four per vertex. */
  state: Float32Array;
  index: Uint32Array;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => { const l = length(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A small seeded generator (mulberry32): the lava must look the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- welding and outlines ------------------------------------------------------------------------------------------

export interface Welded {
  /** One entry per distinct position. */
  points: Vec3[];
  triangles: Uint32Array;
  /** For each source vertex, its welded point. */
  remap: Uint32Array;
}

/** Joins vertices that share a position. The look's meshes are flat shaded, so every face has its own corners. */
export function weld(positions: ArrayLike<number>, index: ArrayLike<number> | null, tolerance = 1e-3): Welded {
  const count = positions.length / 3;
  // a position's cell on a grid of `tolerance`, as one number: 17 bits an axis from the least on that axis, which is
  // room for a mesh 131 000 tolerances across (the abyss is 30 000 of its own)
  const least = [Infinity, Infinity, Infinity];
  for (let i = 0; i < positions.length; i++) least[i % 3] = Math.min(least[i % 3], Math.round(positions[i] / tolerance));
  const seen = new Map<number, number>();
  const points: Vec3[] = [];
  const remap = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = ((Math.round(x / tolerance) - least[0]) * 131072 + (Math.round(y / tolerance) - least[1])) * 131072 + (Math.round(z / tolerance) - least[2]);
    let at = seen.get(key);
    if (at === undefined) { at = points.length; seen.set(key, at); points.push([x, y, z]); }
    remap[i] = at;
  }
  const corners = index ? index.length : count;
  const triangles: number[] = [];
  for (let i = 0; i + 2 < corners; i += 3) {
    const a = remap[index ? index[i] : i], b = remap[index ? index[i + 1] : i + 1], c = remap[index ? index[i + 2] : i + 2];
    if (a !== b && b !== c && c !== a) triangles.push(a, b, c);
  }
  return { points, triangles: Uint32Array.from(triangles), remap };
}

/** The outlines of a welded mesh: each closed run of edges that belong to one triangle only, in winding order. */
export function boundaryLoops(triangles: ArrayLike<number>): number[][] {
  const uses = new Map<string, number>();
  for (let i = 0; i < triangles.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[i + e], b = triangles[i + (e + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const next = new Map<number, number>();
  for (let i = 0; i < triangles.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[i + e], b = triangles[i + (e + 1) % 3];
      if (uses.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) next.set(a, b);
    }
  }
  const loops: number[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && !done.has(at)) { done.add(at); loop.push(at); at = next.get(at); }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** The distance in the ground plane from a point to a closed outline. */
export function distanceToLoop(x: number, z: number, loop: readonly Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    best = Math.min(best, distanceToSegment(x, z, a[0], a[2], b[0], b[2]));
  }
  return best;
}

export function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = clamp01(((x - ax) * dx + (z - az) * dz) / Math.max(dx * dx + dz * dz, 1e-12));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** True if a point of the ground plane lies inside a closed outline (even-odd rule). */
export function insideLoop(x: number, z: number, loop: readonly Vec3[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[2] > z) !== (b[2] > z) && x < ((b[0] - a[0]) * (z - a[2])) / (b[2] - a[2]) + a[0]) inside = !inside;
  }
  return inside;
}

// --- pools ---------------------------------------------------------------------------------------------------------

export interface PoolShape {
  /** The rim, in order. */
  rim: Vec3[];
  /** A point every rim point can be seen from (the look's pools are fans about one). */
  centre: Vec3;
  level: number;
  area: number;
  /** The radius of a disc of the same area. */
  radius: number;
}

/** Reads a pool: a flat fan about one inner point. */
export function poolShape(mesh: Welded): PoolShape | null {
  const loops = boundaryLoops(mesh.triangles);
  if (loops.length !== 1) return null;
  const rim = loops[0].map((i) => mesh.points[i]);
  const onRim = new Set(loops[0]);
  const inner = mesh.points.filter((_, i) => !onRim.has(i));
  const centre: Vec3 = inner.length === 1 ? inner[0]
    : scale(rim.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3), 1 / rim.length);
  let area = 0;
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    area += (a[0] - centre[0]) * (b[2] - centre[2]) - (b[0] - centre[0]) * (a[2] - centre[2]);
  }
  area = Math.abs(area) / 2;
  return { rim, centre, level: centre[1], area, radius: Math.sqrt(area / Math.PI) };
}

export interface PoolOptions {
  /** Rings between the centre and the rim. More near the rim, where the shore cools. */
  rings?: number;
  /** The fastest the crust drifts, metres a second. */
  drift?: number;
  heat?: number;
  seed?: number;
  /** What the ground makes of the pool (arena-lava-ground.ts poolGround): metres to the nearest rock standing in the
   *  lava, and metres to where nothing holds the lava (negative inside such a place). */
  ground?: { rock(x: number, z: number): number; held(x: number, z: number): number };
}

/** Metres from a point of a pool to its shore: the rim, rock standing in it, or the edge of what holds it. Negative
 * where nothing holds lava; the shader leaves that part of the disc out. */
export function poolShore(shape: PoolShape, ground: PoolOptions["ground"], x: number, z: number): number {
  const rim = distanceToLoop(x, z, shape.rim);
  if (!ground) return rim;
  const held = ground.held(x, z);
  return held < 0 ? held : Math.min(rim, ground.rock(x, z), held);
}

/**
 * Rebuilds a pool as rings inside its own rim. Lava wells up at one place, well inside the open lava, and its crust
 * drifts outward from there, slowing to a stop at the shore, where it has cooled the longest.
 */
export function buildPool(shape: PoolShape, options: PoolOptions = {}): LavaSurface & { upwelling: Vec3 } {
  const rings = options.rings ?? 12, drift = options.drift ?? 0.12, heat = options.heat ?? 1;
  const random = seeded(options.seed ?? 1);
  const { rim, centre } = shape;
  // twice the rim's points per ring, so the shore's cooling is not strung between the look's 48 corners
  const outline: Vec3[] = [];
  for (let i = 0; i < rim.length; i++) { outline.push(rim[i], mix(rim[i], rim[(i + 1) % rim.length], 0.5)); }
  const n = outline.length;
  // of a dozen places, the one furthest from any shore
  let upwelling = centre, open = poolShore(shape, options.ground, centre[0], centre[2]);
  for (let tries = 0; tries < 12; tries++) {
    const candidate = mix(centre, outline[Math.floor(random() * n) % n], 0.15 + 0.6 * random());
    const shore = poolShore(shape, options.ground, candidate[0], candidate[2]);
    if (shore > open) { open = shore; upwelling = candidate; }
  }
  const count = 1 + rings * n;
  const surface = emptySurface(count, (rings - 1) * n * 2 + n);
  const put = (at: number, p: Vec3) => {
    surface.positions.set(p, at * 3);
    surface.normals.set([0, 1, 0], at * 3);
    surface.pattern.set([p[0], p[2]], at * 2);
    const shore = poolShore(shape, options.ground, p[0], p[2]);
    // outward from where it wells up; nothing moves at the source itself or at the shore
    const dx = p[0] - upwelling[0], dz = p[2] - upwelling[2], d = Math.hypot(dx, dz);
    const speed = drift * smoothstep(0, 0.35 * shape.radius, d) * smoothstep(0, 0.9, shore);
    surface.flow.set([d > 1e-6 ? (dx / d) * speed : 0, d > 1e-6 ? (dz / d) * speed : 0, 0], at * 3);
    surface.state.set([heat, shore, 0, 0.6 * (1 - smoothstep(0.03 * shape.radius, 0.14 * shape.radius, d))], at * 4);
  };
  put(0, centre);
  for (let r = 1; r <= rings; r++) {
    // rings crowd toward the rim: t = 1 - (1 - r/rings)^1.6
    const t = 1 - Math.pow(1 - r / rings, 1.6);
    for (let i = 0; i < n; i++) put(1 + (r - 1) * n + i, mix(centre, outline[i], t));
  }
  let k = 0;
  for (let i = 0; i < n; i++) { surface.index.set([0, 1 + (i + 1) % n, 1 + i], k); k += 3; }
  for (let r = 1; r < rings; r++) {
    for (let i = 0; i < n; i++) {
      const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + (i + 1) % n, c = a + n, d = b + n;
      surface.index.set([a, b, d, a, d, c], k); k += 6;
    }
  }
  orientUp(surface);
  return { ...surface, upwelling };
}

function emptySurface(vertices: number, triangles: number): LavaSurface {
  return {
    positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), pattern: new Float32Array(vertices * 2),
    flow: new Float32Array(vertices * 3), state: new Float32Array(vertices * 4), index: new Uint32Array(triangles * 3),
  };
}

/** Winds every triangle so that its face normal agrees with its vertices' normals. */
function orientUp(surface: LavaSurface) {
  const { positions: p, normals: n, index } = surface;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const face = cross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]);
    if (face[0] * (n[a] + n[b] + n[c]) + face[1] * (n[a + 1] + n[b + 1] + n[c + 1]) + face[2] * (n[a + 2] + n[b + 2] + n[c + 2]) < 0) {
      const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t;
    }
  }
}

// --- rivers --------------------------------------------------------------------------------------------------------

/** A river as the look has it: a ladder, one rung per cross-section. */
export interface Strip { left: Vec3[]; right: Vec3[] }

/**
 * Reads a ladder mesh as its two rails. Every vertex of a ladder is on its outline, which runs down one rail, across
 * an end, back up the other rail and across the other end; of all the ways to split the outline in two halves, the
 * right one pairs the nearest points, so it has the shortest rungs.
 */
export function ladderRails(mesh: Welded): Strip | null {
  const loops = boundaryLoops(mesh.triangles);
  if (loops.length !== 1 || loops[0].length !== mesh.points.length || loops[0].length % 2 !== 0) return null;
  const loop = loops[0], half = loop.length / 2;
  let best = Infinity, bestAt = 0;
  for (let r = 0; r < half; r++) {
    let total = 0;
    for (let i = 0; i < half; i++) {
      total += length(sub(mesh.points[loop[(r + i) % loop.length]], mesh.points[loop[(r + 2 * half - 1 - i) % loop.length]]));
    }
    if (total < best) { best = total; bestAt = r; }
  }
  const left: Vec3[] = [], right: Vec3[] = [];
  for (let i = 0; i < half; i++) {
    left.push(mesh.points[loop[(bestAt + i) % loop.length]]);
    right.push(mesh.points[loop[(bestAt + 2 * half - 1 - i) % loop.length]]);
  }
  return { left, right };
}

/** Adds rungs until none is further than `step` from the next, measured along the middle. */
export function refineStrip(strip: Strip, step: number): Strip {
  const left: Vec3[] = [strip.left[0]], right: Vec3[] = [strip.right[0]];
  for (let i = 0; i + 1 < strip.left.length; i++) {
    const span = length(sub(mix(strip.left[i + 1], strip.right[i + 1], 0.5), mix(strip.left[i], strip.right[i], 0.5)));
    const pieces = Math.max(1, Math.ceil(span / step));
    for (let k = 1; k <= pieces; k++) {
      left.push(mix(strip.left[i], strip.left[i + 1], k / pieces));
      right.push(mix(strip.right[i], strip.right[i + 1], k / pieces));
    }
  }
  return { left, right };
}

/**
 * Lays a strip's level stretches on the ground (`heightAt` gives the ground under a point, or -Infinity). The look's
 * rivers touch the ground only at their own rungs, a metre apart, and hang in the air or run through the rock
 * between them. A rail point is moved only if the ground is within `reach` metres of it, and never on a slope
 * steeper than about 35 degrees: a fall hangs free of the rock behind it.
 */
export function drapeStrip(strip: Strip, heightAt: (x: number, z: number) => number, reach = 0.7): Strip {
  const n = strip.left.length;
  const middle = strip.left.map((l, i) => mix(l, strip.right[i], 0.5));
  const snap = (p: Vec3): Vec3 => { const h = heightAt(p[0], p[2]); return Math.abs(h - p[1]) <= reach ? [p[0], h, p[2]] : p; };
  const left: Vec3[] = [], right: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = middle[Math.max(0, i - 1)], b = middle[Math.min(n - 1, i + 1)];
    const level = Math.abs(b[1] - a[1]) < 0.7 * Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), 1e-6);
    left.push(level ? snap(strip.left[i]) : strip.left[i]);
    right.push(level ? snap(strip.right[i]) : strip.right[i]);
  }
  return { left, right };
}

/**
 * Cuts a strip where it is under something else's surface (`covered` says so for a point), into the stretches that
 * are left. A stretch's end rung is moved to where the strip meets that surface, found by bisection.
 */
export function cutStrip(strip: Strip, covered: (p: Vec3) => boolean): { strip: Strip; cutStart: boolean; cutEnd: boolean }[] {
  const middle = (i: number) => mix(strip.left[i], strip.right[i], 0.5);
  const hidden = strip.left.map((_, i) => covered(middle(i)));
  // the rung between a shown one and a hidden one, at the surface
  const meet = (shown: number, gone: number): [Vec3, Vec3] => {
    let lo = 0, hi = 1;
    for (let step = 0; step < 12; step++) {
      const t = (lo + hi) / 2;
      if (covered(mix(middle(shown), middle(gone), t))) hi = t; else lo = t;
    }
    return [mix(strip.left[shown], strip.left[gone], lo), mix(strip.right[shown], strip.right[gone], lo)];
  };
  const pieces: { strip: Strip; cutStart: boolean; cutEnd: boolean }[] = [];
  let i = 0;
  while (i < hidden.length) {
    if (hidden[i]) { i++; continue; }
    let j = i;
    while (j + 1 < hidden.length && !hidden[j + 1]) j++;
    const left = strip.left.slice(i, j + 1), right = strip.right.slice(i, j + 1);
    const cutStart = i > 0, cutEnd = j + 1 < hidden.length;
    if (cutStart) { const [l, r] = meet(i, i - 1); left.unshift(l); right.unshift(r); }
    if (cutEnd) { const [l, r] = meet(j, j + 1); left.push(l); right.push(r); }
    if (left.length >= 2) pieces.push({ strip: { left, right }, cutStart, cutEnd });
    i = j + 1;
  }
  return pieces;
}

export interface StripFlow {
  /** Metres along the middle of the strip to each rung. */
  arc: Float32Array;
  /** Metres a second along the strip at each rung; negative runs toward the first rung. */
  speed: Float32Array;
  /** 0 on the level to 1 where the lava falls. */
  steep: Float32Array;
  /** Where the crust pattern sits along the strip, in metres at `still` speed: it grows downstream, slowly where the
   *  lava is fast, so that scrolling it at one speed moves it at the lava's speed everywhere and stretches it in falls. */
  travel: Float32Array;
  /** 1 at a rung where lava wells up (flow leaves both ways) or lands (flow meets), fading over `wash` metres. */
  fresh: Float32Array;
  /** Which stretch of one direction each rung is in. */
  run: Int32Array;
}

export interface FlowOptions {
  /** Speed on the level and in free fall, metres a second. */
  still?: number;
  fall?: number;
  /** How far the lie of the land is averaged to decide which way lava runs, metres. The look's rivers are draped
   *  over rough ground: a bump of half a metre must not turn a river round. */
  reach?: number;
  /** The least lean (rise over run, averaged over `reach`) that says which way is downhill. */
  lean?: number;
  /** A stretch running against its neighbours for less than this many metres is taken to run with them. */
  shortest?: number;
  wash?: number;
}

/**
 * Which way and how fast lava runs along a strip, from its own heights: downhill, faster where steeper. Where the
 * strip is level the lava keeps the way the nearest slope sends it, so a stretch at the foot of a fall runs away
 * from the fall.
 */
export function stripFlow(middle: readonly Vec3[], options: FlowOptions = {}): StripFlow {
  const still = options.still ?? 0.5, fall = options.fall ?? 4, reach = options.reach ?? 3, wash = options.wash ?? 1.2;
  const least = options.lean ?? 0.15, shortest = options.shortest ?? 2.5;
  const n = middle.length;
  const arc = new Float32Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + length(sub(middle[i], middle[i - 1]));
  const height = middle.map((p) => p[1]);
  const lean = new Float32Array(n), steep = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, weight = 0;
    for (let j = 0; j < n; j++) {
      const d = (arc[j] - arc[i]) / reach;
      if (Math.abs(d) > 1.5) continue;
      const w = Math.exp(-2 * d * d) * (j > 0 && j + 1 < n ? (arc[j + 1] - arc[j - 1]) / 2 : j > 0 ? arc[j] - arc[j - 1] : n > 1 ? arc[1] - arc[0] : 1);
      // the slope of a line fitted through the heights nearby, weighted toward this rung
      sum += w * (height[j] - height[i]) * (arc[j] - arc[i]); weight += w * (arc[j] - arc[i]) * (arc[j] - arc[i]);
    }
    lean[i] = weight > 1e-9 ? sum / weight : 0;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const run = Math.max(arc[b] - arc[a], 1e-6);
    steep[i] = smoothstep(0.26, 0.85, Math.abs(height[b] - height[a]) / run);
  }
  // downhill; a rung on the level takes the direction of the nearest rung on a slope
  const sign = new Int8Array(n);
  for (let i = 0; i < n; i++) sign[i] = lean[i] < -least ? 1 : lean[i] > least ? -1 : 0;
  if (sign.every((s) => s === 0)) {
    // level all along: toward the lower end
    sign.fill(height[n - 1] <= height[0] ? 1 : -1);
  }
  const slopes = Array.from(sign);
  for (let i = 0; i < n; i++) {
    if (slopes[i] !== 0) continue;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (slopes[j] === 0) continue;
      const d = Math.abs(arc[j] - arc[i]);
      if (d < best) { best = d; sign[i] = slopes[j]; }
    }
  }
  // a short stretch against the flow on both sides of it is rough ground, not a turn of the river
  for (let pass = 0; pass < 4; pass++) {
    let start = 0, changed = false;
    while (start < n) {
      let end = start;
      while (end + 1 < n && sign[end + 1] === sign[start]) end++;
      const span = arc[Math.min(n - 1, end + 1)] - arc[Math.max(0, start - 1)];
      if (span < shortest && (start > 0 || end + 1 < n)) {
        const before = start > 0 ? sign[start - 1] : sign[end + 1], after = end + 1 < n ? sign[end + 1] : sign[start - 1];
        if (before === after) { sign.fill(before, start, end + 1); changed = true; }
      }
      start = end + 1;
    }
    if (!changed) break;
  }
  const speed = new Float32Array(n), run = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    speed[i] = sign[i] * (still + (fall - still) * steep[i]);
    run[i] = i > 0 ? run[i - 1] + (sign[i] !== sign[i - 1] ? 1 : 0) : 0;
  }
  const travel = new Float32Array(n), fresh = new Float32Array(n);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && run[end + 1] === run[start]) end++;
    // seconds from this run's upstream end to each rung, as metres at the still speed
    if (sign[start] > 0) {
      for (let i = start + 1; i <= end; i++) travel[i] = travel[i - 1] + (arc[i] - arc[i - 1]) * still / ((Math.abs(speed[i]) + Math.abs(speed[i - 1])) / 2);
    } else {
      for (let i = end - 1; i >= start; i--) travel[i] = travel[i + 1] + (arc[i + 1] - arc[i]) * still / ((Math.abs(speed[i]) + Math.abs(speed[i + 1])) / 2);
    }
    // where two runs meet, lava either wells up or lands; both show fresh lava
    for (const node of [start > 0 ? start : -1, end + 1 < n ? end : -1]) {
      if (node < 0) continue;
      for (let i = start; i <= end; i++) fresh[i] = Math.max(fresh[i], 1 - smoothstep(0, wash, Math.abs(arc[i] - arc[node])));
    }
    start = end + 1;
  }
  return { arc, speed, steep, travel, fresh, run };
}

export interface RiverOptions {
  /** Vertices across the river. */
  across?: number;
  heat?: number;
  flow?: FlowOptions;
  /** How far a fall stands out from the surface it runs down, as a share of its half width. */
  body?: number;
  /** The ends that were cut where the river goes under another surface: lava lands there. */
  cutStart?: boolean;
  cutEnd?: boolean;
  /** Keeps two rivers, or two stretches of one, from showing the same crust. */
  offset?: number;
  /** How far the lava stands above the ground it lies on, metres. The look's rivers lie in the ground's own surface. */
  lift?: number;
  /** The width of the cooled margin the material gives a shore, metres. A river too narrow for one each side and
   *  open lava between has its distances to the bank stretched, so that the margin takes 45 % of its half width. */
  margin?: number;
  seed?: number;
}

/** Where a river's lava arrives at the surface it goes under. */
export interface Landing {
  position: Vec3;
  halfWidth: number;
  /** 0 where a level river runs in, to 1 at the foot of a fall. */
  steep: number;
}

export interface River extends LavaSurface {
  flowAlong: StripFlow;
  landings: Landing[];
  middle: Vec3[];
  /** Half the river's width at each rung. */
  halfWidth: Float32Array;
  /** Which way the surface faces at each rung. */
  facing: Vec3[];
}

/**
 * Builds a river from a strip of rungs (already refined). Level stretches get a low crown; a fall is wrapped round
 * into more than half a tube standing out from the rock, so that it has a body from the side too. The lip a fall
 * pours over is rounded outward, by easing both the way the surface faces and how far it stands out along the strip
 * (cutting the corner instead would bury the lip in the rock).
 */
export function buildRiver(strip: Strip, options: RiverOptions = {}): River {
  const across = options.across ?? 9, heat = options.heat ?? 1, body = options.body ?? 0.45, offset = options.offset ?? 0;
  const lift = options.lift ?? 0.1, margin = options.margin ?? 0.7;
  const n = strip.left.length;
  const middle = strip.left.map((l, i) => mix(l, strip.right[i], 0.5));
  const flowAlong = stripFlow(middle, options.flow);
  // the banks wander in and out by up to a quarter of the width, over a metre or two: a straight bank is a ruler's
  const random = seeded(options.seed ?? 1);
  const wander: number[] = [];
  for (let i = 0, a = random(), b = random(), from = 0; i < n; i++) {
    const span = 1.6;
    while (flowAlong.arc[i] - from > span) { from += span; a = b; b = random(); }
    const t = (flowAlong.arc[i] - from) / span;
    wander.push(0.75 + 0.25 * (a + (b - a) * t * t * (3 - 2 * t)));
  }
  const still = options.flow?.still ?? 0.5, fall = options.flow?.fall ?? 4;
  const halfWidth = new Float32Array(n);
  const facing: Vec3[] = [];
  const surface = emptySurface(n * across, (n - 1) * (across - 1) * 2);
  // lava lands where a cut end is downstream of its neighbours
  const lands = (i: number) => {
    let amount = 0;
    if (options.cutStart && flowAlong.speed[0] < 0) amount = Math.max(amount, 1 - smoothstep(0, 1.5, flowAlong.arc[i]));
    if (options.cutEnd && flowAlong.speed[n - 1] > 0) amount = Math.max(amount, 1 - smoothstep(0, 1.5, flowAlong.arc[n - 1] - flowAlong.arc[i]));
    return amount;
  };
  const halves: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    // (a fall keeps its full width: its edges are in the air, not on a bank)
    const half = scale(sub(strip.right[i], strip.left[i]), 0.5 * (wander[i] + (1 - wander[i]) * flowAlong.steep[i]));
    halves.push(half);
    halfWidth[i] = length(half);
    const along = normalize(sub(middle[Math.min(n - 1, i + 1)], middle[Math.max(0, i - 1)]));
    let out = normalize(cross(along, half));
    // the look's rivers lie on ground that faces up; on a sheer face keep the side the last rung chose
    if (Math.abs(out[1]) > 0.05 ? out[1] < 0 : i > 0 && dot(out, facing[i - 1]) < 0) out = scale(out, -1);
    facing.push(out);
  }
  // ease the facing and the steepness over about a metre of strip, for the body's shape only
  let shape = Float32Array.from(flowAlong.steep), faces = facing;
  for (let pass = 0; pass < 3; pass++) {
    const nextShape = new Float32Array(n), nextFaces: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      nextShape[i] = (shape[a] + 2 * shape[i] + shape[b]) / 4;
      nextFaces.push(normalize(add(add(faces[a], scale(faces[i], 2)), faces[b])));
    }
    shape = nextShape; faces = nextFaces;
  }
  for (let i = 0; i < n; i++) {
    const half = halves[i], out = faces[i], steep = shape[i];
    const widest = (Math.PI / 2) * (1 + 0.28 * steep);
    const stand = halfWidth[i] * (body * steep + 0.07 * (1 - steep));
    const fresh = Math.max(flowAlong.fresh[i], lands(i));
    // shore: the banks, and the two ends unless lava arrives or leaves there under something else
    const endShore = Math.min(options.cutStart ? Infinity : flowAlong.arc[i], options.cutEnd ? Infinity : flowAlong.arc[n - 1] - flowAlong.arc[i]);
    for (let c = 0; c < across; c++) {
      const a = (c / (across - 1)) * 2 - 1, turn = a * widest;
      const at = i * across + c;
      const p = add(add(middle[i], scale(half, Math.sin(turn))), scale(out, lift + stand * (Math.cos(turn) - Math.cos(widest))));
      surface.positions.set(p, at * 3);
      // (across a fall the pattern is three times finer: it is already drawn out eight times along it, and a fall
      // is streaked, not blotched)
      surface.pattern.set([a * halfWidth[i] * (1 + 2 * steep) + offset + 7.3 * flowAlong.run[i], flowAlong.travel[i]], at * 2);
      surface.flow.set([0, still, 1], at * 3);
      const pace = (Math.abs(flowAlong.speed[i]) - still) / Math.max(fall - still, 1e-6);
      const bank = (1 - Math.abs(a)) * halfWidth[i] * Math.max(1, margin / Math.max(0.45 * halfWidth[i], 1e-6));
      // running lava is hotter than a pool's: its crust is torn as fast as it forms
      surface.state.set([heat * (0.95 + 0.3 * pace), Math.min(bank, endShore), flowAlong.steep[i], fresh], at * 4);
    }
  }
  let k = 0;
  for (let i = 0; i + 1 < n; i++) {
    for (let c = 0; c + 1 < across; c++) {
      const a = i * across + c, b = a + 1, d = a + across, e = d + 1;
      surface.index.set([a, d, e, a, e, b], k); k += 6;
    }
  }
  smoothNormals(surface, faces, across);
  orientUp(surface);
  // how steeply the lava arrives: the steepest rung within two metres of the end
  const arriving = (end: number, step: number): Landing => {
    let steep = 0;
    for (let i = end; i >= 0 && i < n && Math.abs(flowAlong.arc[i] - flowAlong.arc[end]) < 2; i += step) steep = Math.max(steep, flowAlong.steep[i]);
    return { position: middle[end], halfWidth: halfWidth[end], steep };
  };
  const landings: Landing[] = [];
  if (options.cutStart && flowAlong.speed[0] < 0) landings.push(arriving(0, 1));
  if (options.cutEnd && flowAlong.speed[n - 1] > 0) landings.push(arriving(n - 1, -1));
  return { ...surface, flowAlong, landings, middle, halfWidth, facing: faces };
}

/** Normals of a river's grid from its neighbours. Each rung's are turned to the side its middle faces, as one: where
 * a fall's edges wrap round behind it they rightly face away from that side. */
function smoothNormals(surface: LavaSurface, facing: Vec3[], across: number) {
  const { positions: p, normals } = surface;
  const rows = facing.length, mid = (across - 1) >> 1;
  const at = (i: number, c: number): Vec3 => { const k = (i * across + c) * 3; return [p[k], p[k + 1], p[k + 2]]; };
  const normalAt = (i: number, c: number) => normalize(cross(
    sub(at(Math.min(rows - 1, i + 1), c), at(Math.max(0, i - 1), c)), sub(at(i, Math.min(across - 1, c + 1)), at(i, Math.max(0, c - 1)))));
  for (let i = 0; i < rows; i++) {
    const turn = dot(normalAt(i, mid), facing[i]) < 0 ? -1 : 1;
    for (let c = 0; c < across; c++) normals.set(scale(normalAt(i, c), turn), (i * across + c) * 3);
  }
}

/** A stretch of a river that falls: where it starts and where it lands (the middle of the river at each). */
export interface Fall { top: Vec3; foot: Vec3; halfWidth: number; /** True if the foot is the river's cut end. */ footAtEnd: boolean }

/** The falls of a river: each run of rungs steeper than about 45 degrees, read downstream. */
export function riverFalls(river: River): Fall[] {
  const { middle, halfWidth, flowAlong } = river;
  const falls: Fall[] = [];
  let from = -1;
  for (let i = 0; i <= middle.length; i++) {
    const falling = i < middle.length && flowAlong.steep[i] > 0.5 && (from < 0 || flowAlong.run[i] === flowAlong.run[from]);
    if (falling && from < 0) from = i;
    if (!falling && from >= 0) {
      const to = i - 1, down = flowAlong.speed[from] > 0;
      const foot = down ? to : from, top = down ? from : to;
      let width = 0;
      for (let k = from; k <= to; k++) width += halfWidth[k];
      if (Math.abs(middle[top][1] - middle[foot][1]) > 1) {
        falls.push({ top: middle[top], foot: middle[foot], halfWidth: width / (to - from + 1), footAtEnd: foot <= 1 || foot >= middle.length - 2 });
      }
      from = i < middle.length && flowAlong.steep[i] > 0.5 ? i : -1;
    }
  }
  return falls;
}

// --- the abyss -----------------------------------------------------------------------------------------------------

export interface SheetPart { positions: ArrayLike<number>; index: ArrayLike<number> | null; heat: number }

export interface Sheet {
  welded: Welded;
  /** Per welded point. */
  heat: Float32Array;
  flow: Float32Array;
  normals: Float32Array;
  /** For each part, its source vertices' welded points. */
  remaps: Uint32Array[];
  /** For each part, its triangles as welded points. */
  triangles: Uint32Array[];
}

/**
 * Reads the abyss: one sheet in several parts, each of one heat. Heat is blended across the parts' seams (the parts
 * are cut along the sheet's grid, so their edges are staircases), and the lava runs down the sheet's own slope.
 */
export function readSheet(parts: readonly SheetPart[], options: { blend?: number; fastest?: number } = {}): Sheet {
  const blend = options.blend ?? 3, fastest = options.fastest ?? 0.5;
  const offsets: number[] = [];
  let total = 0;
  for (const part of parts) { offsets.push(total); total += part.positions.length / 3; }
  const all = new Float32Array(total * 3);
  parts.forEach((part, i) => all.set(part.positions as ArrayLike<number>, offsets[i] * 3));
  const welded = weld(all, null, 1e-2);
  const count = welded.points.length;
  const heat = new Float32Array(count), weight = new Float32Array(count), normals = new Float32Array(count * 3);
  const remaps: Uint32Array[] = [], triangles: Uint32Array[] = [];
  parts.forEach((part, at) => {
    const vertices = part.positions.length / 3;
    const remap = welded.remap.subarray(offsets[at], offsets[at] + vertices);
    remaps.push(remap);
    const corners = part.index ? part.index.length : vertices;
    const tris = new Uint32Array(corners);
    for (let i = 0; i < corners; i++) tris[i] = remap[part.index ? part.index[i] : i];
    triangles.push(tris);
    for (let i = 0; i + 2 < corners; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const pa = welded.points[a], pb = welded.points[b], pc = welded.points[c];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const area = Math.hypot(fx, fy, fz) / 2;
      if (fy < 0) { fx = -fx; fy = -fy; fz = -fz; }
      for (let k = 0; k < 3; k++) {
        const v = tris[i + k];
        heat[v] += part.heat * area; weight[v] += area;
        normals[v * 3] += fx; normals[v * 3 + 1] += fy; normals[v * 3 + 2] += fz;
      }
    }
  });
  for (let v = 0; v < count; v++) heat[v] = weight[v] > 0 ? heat[v] / weight[v] : 0;
  const flow = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const normal = normalize([normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
    normals.set(normal, v * 3);
    // a surface's normal leans the way it runs downhill; a tenth of a radian is a fast slope for a sheet of lava
    const slope = Math.hypot(normal[0], normal[2]) / Math.max(normal[1], 1e-3);
    const pace = fastest * smoothstep(0.0, 0.18, slope);
    const lean = Math.hypot(normal[0], normal[2]);
    flow[v * 2] = lean > 1e-6 ? (normal[0] / lean) * pace : 0;
    flow[v * 2 + 1] = lean > 1e-6 ? (normal[2] / lean) * pace : 0;
  }
  // blend each value with those round it a few times (every point takes the mean of the corners of the faces it
  // is a corner of): seams soften, and the slope's noise goes out of the flow
  const relax = (values: Float32Array, stride: number) => {
    const sum = new Float32Array(values.length), shares = new Float32Array(count);
    for (let pass = 0; pass < blend; pass++) {
      sum.fill(0); shares.fill(0);
      for (const tris of triangles) {
        for (let i = 0; i + 2 < tris.length; i += 3) {
          const a = tris[i], b = tris[i + 1], c = tris[i + 2];
          for (let s = 0; s < stride; s++) {
            const mean = values[a * stride + s] + values[b * stride + s] + values[c * stride + s];
            sum[a * stride + s] += mean; sum[b * stride + s] += mean; sum[c * stride + s] += mean;
          }
          shares[a] += 3; shares[b] += 3; shares[c] += 3;
        }
      }
      for (let v = 0; v < count; v++) if (shares[v] > 0) for (let s = 0; s < stride; s++) values[v * stride + s] = sum[v * stride + s] / shares[v];
    }
  };
  relax(heat, 1); relax(flow, 2);
  return { welded, heat, flow, normals, remaps, triangles };
}

/** One part of the abyss as a surface, in the part's own vertex order (so its index is unchanged). The heat the
 * shader is given runs from `least` (for heat 0) to 1. */
export function buildSheetPart(sheet: Sheet, part: number, source: SheetPart, tile: number, least = 0): LavaSurface {
  const remap = sheet.remaps[part];
  const vertices = remap.length;
  const corners = source.index ? source.index.length : vertices;
  const surface = emptySurface(vertices, corners / 3);
  for (let i = 0; i < vertices; i++) {
    const v = remap[i], p = sheet.welded.points[v];
    surface.positions.set(p, i * 3);
    surface.normals.set(sheet.normals.subarray(v * 3, v * 3 + 3), i * 3);
    surface.pattern.set([p[0] * tile, p[2] * tile], i * 2);
    // the heat drives the lava as well: cold crust barely moves
    const pace = 0.3 + 0.7 * clamp01(sheet.heat[v]);
    surface.flow.set([sheet.flow[v * 2] * tile * pace, sheet.flow[v * 2 + 1] * tile * pace, 0], i * 3);
    surface.state.set([least + (1 - least) * sheet.heat[v], 10, 0, 0], i * 4);
  }
  for (let i = 0; i < corners; i++) surface.index[i] = source.index ? source.index[i] : i;
  return surface;
}

/** The height of a sheet's surface under a point, or null where the sheet has none within `reach` metres. */
export function sheetHeightLookup(points: readonly Vec3[], cell = 2.5): (x: number, z: number, reach?: number) => number | null {
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
    const list = grid.get(key);
    if (list) list.push(i); else grid.set(key, [i]);
  });
  return (x, z, reach = cell) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell), span = Math.ceil(reach / cell);
    let best = reach * reach, height: number | null = null;
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        for (const i of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const p = points[i], d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z);
          if (d < best) { best = d; height = p[1]; }
        }
      }
    }
    return height;
  };
}

// --- light ---------------------------------------------------------------------------------------------------------

/** A stretch of lava that could be listed as a light (see ArenaEmitter in arena-kit.ts), before the best are chosen. */
export interface GlowSource {
  kind: "pool" | "fall" | "river" | "abyss";
  position: Vec3;
  /** The radius of a disc with the lava's area, metres. */
  radius: number;
  /** Area times heat: how much light it gives. */
  power: number;
}

/**
 * Chooses the lava that matters most as light for the board and what stands round it: the most light arriving at
 * the edge of the board's surroundings (`boardReach` metres out), falling off with the square of the distance.
 */
export function chooseGlowSources(sources: readonly GlowSource[], limit: number, boardReach = 12): GlowSource[] {
  const score = (s: GlowSource) => {
    const d = Math.max(Math.hypot(s.position[0], s.position[2]) - boardReach, 2);
    return s.power / (d * d + s.position[1] * s.position[1]);
  };
  return [...sources].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/**
 * Gathers the hot faces of a sheet (heat above `hot`) within `within` metres of the middle into `count` groups by
 * where they are (k-means from a ring of starting places), each a glow source at its faces' centre. `shown` is the
 * share of the lava taken to show (the abyss's channels run under the arena's floor and are seen through its
 * cracks): each source is a disc of that share of its faces' area.
 */
export function sheetGlowSources(sheet: Sheet, options: { hot?: number; within?: number; count?: number; shown?: number } = {}): GlowSource[] {
  const hot = options.hot ?? 0.75, within = options.within ?? 55, count = options.count ?? 4, shown = options.shown ?? 1;
  const faces: number[] = [];
  for (const tris of sheet.triangles) {
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const a = sheet.welded.points[tris[i]], b = sheet.welded.points[tris[i + 1]], c = sheet.welded.points[tris[i + 2]];
      const heat = (sheet.heat[tris[i]] + sheet.heat[tris[i + 1]] + sheet.heat[tris[i + 2]]) / 3;
      const x = (a[0] + b[0] + c[0]) / 3, z = (a[2] + b[2] + c[2]) / 3;
      if (heat < hot || x * x + z * z > within * within) continue;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      faces.push(x, (a[1] + b[1] + c[1]) / 3, z, Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2, heat);
    }
  }
  if (!faces.length) return [];
  const centres = new Float64Array(count * 2), sums = new Float64Array(count * 5);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.6;
    centres[i * 2] = Math.cos(angle) * within * 0.5; centres[i * 2 + 1] = Math.sin(angle) * within * 0.5;
  }
  for (let pass = 0; pass < 6; pass++) {
    sums.fill(0);
    for (let f = 0; f < faces.length; f += 5) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < count; i++) {
        const dx = faces[f] - centres[i * 2], dz = faces[f + 2] - centres[i * 2 + 1], d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      const area = faces[f + 3];
      sums[best * 5] += faces[f] * area; sums[best * 5 + 1] += faces[f + 1] * area; sums[best * 5 + 2] += faces[f + 2] * area;
      sums[best * 5 + 3] += area; sums[best * 5 + 4] += area * faces[f + 4];
    }
    for (let i = 0; i < count; i++) if (sums[i * 5 + 3] > 0) { centres[i * 2] = sums[i * 5] / sums[i * 5 + 3]; centres[i * 2 + 1] = sums[i * 5 + 2] / sums[i * 5 + 3]; }
  }
  const out: GlowSource[] = [];
  for (let i = 0; i < count; i++) {
    const area = sums[i * 5 + 3];
    if (area > 0) out.push({ kind: "abyss", position: [sums[i * 5] / area, sums[i * 5 + 1] / area, sums[i * 5 + 2] / area],
                             radius: Math.sqrt((area * shown) / Math.PI), power: sums[i * 5 + 4] * shown });
  }
  return out;
}

// --- places on a surface -------------------------------------------------------------------------------------------

/** Points spread over a surface by area times `weight` (of a vertex, by its index), with the surface's normal there. */
export function scatterOnSurface(surface: LavaSurface, count: number, random: () => number,
  weight: (vertex: number) => number = () => 1): { position: Vec3; normal: Vec3; vertex: number }[] {
  const { positions: p, normals: n, index } = surface;
  const at = (i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = at(index[i]), b = at(index[i + 1]), c = at(index[i + 2]);
    total += (length(cross(sub(b, a), sub(c, a))) / 2) * (weight(index[i]) + weight(index[i + 1]) + weight(index[i + 2])) / 3;
    cumulative.push(total);
  }
  const out: { position: Vec3; normal: Vec3; vertex: number }[] = [];
  if (total <= 0) return out;
  for (let k = 0; k < count; k++) {
    const pick = random() * total;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < pick) lo = mid + 1; else hi = mid; }
    const ia = index[lo * 3], ib = index[lo * 3 + 1], ic = index[lo * 3 + 2];
    let u = random(), v = random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const position = add(add(scale(at(ia), 1 - u - v), scale(at(ib), u)), scale(at(ic), v));
    out.push({ position, normal: normalize([n[ia * 3], n[ia * 3 + 1], n[ia * 3 + 2]]), vertex: ia });
  }
  return out;
}

/** Several surfaces as one. */
export function mergeSurfaces(surfaces: readonly LavaSurface[]): LavaSurface {
  const vertices = surfaces.reduce((sum, s) => sum + s.positions.length / 3, 0);
  const merged = emptySurface(vertices, surfaces.reduce((sum, s) => sum + s.index.length / 3, 0));
  let v = 0, k = 0;
  for (const s of surfaces) {
    merged.positions.set(s.positions, v * 3); merged.normals.set(s.normals, v * 3); merged.pattern.set(s.pattern, v * 2);
    merged.flow.set(s.flow, v * 3); merged.state.set(s.state, v * 4);
    for (let i = 0; i < s.index.length; i++) merged.index[k + i] = s.index[i] + v;
    v += s.positions.length / 3; k += s.index.length;
  }
  return merged;
}

/** A lava mesh of a shape this file does not know, as it is: still lava, with a crust that stays where it is. */
export function plainSurface(positions: ArrayLike<number>, normals: ArrayLike<number> | null, index: ArrayLike<number> | null, heat: number): LavaSurface {
  const vertices = positions.length / 3;
  const surface = emptySurface(vertices, (index ? index.length : vertices) / 3);
  surface.positions.set(positions as ArrayLike<number>);
  for (let i = 0; i < vertices; i++) {
    surface.normals.set(normals ? [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]] : [0, 1, 0], i * 3);
    surface.pattern.set([positions[i * 3], positions[i * 3 + 2]], i * 2);
    surface.state.set([heat, 10, 0, 0], i * 4);
  }
  for (let i = 0; i < surface.index.length; i++) surface.index[i] = index ? index[i] : i;
  return surface;
}
