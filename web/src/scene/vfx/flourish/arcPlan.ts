/**
 * The killing blow's crescent of light, as arithmetic: how long it is and how it fades, the shape of its body, the
 * history of the blade it is drawn from, and the strip of vertices that history becomes. No Three.js in here, so the
 * node tests reach every vertex of it (shared/play/flourish-arc.test.ts); arcs.ts uploads what this writes and shades it.
 *
 * The blade is sampled at two points every frame, after animation and contact IK: its tip, and a point part-way back
 * along it toward the hand (the "root"). The arc is the surface those two points sweep: its outer edge is the path of
 * the tip itself, crisp, and its body reaches back toward the root, so a swing leaves a crescent as thick as the outer
 * part of the blade and exactly where the blade went. Where the two points move together (a thrust, the blade running
 * along its own line) the body turns to face the eye instead, so a stab still leaves a stroke of light.
 */
import { clamp01, smoothstep } from "./flourishPlan";

/** The arc's limits. Distances in scene units (a square is 1.02), times in seconds. */
export const ARC = Object.freeze({
  /** Samples of the blade kept: about 0.65 s at 60 frames a second, more than any arc shows. */
  history: 40,
  /** How much of the swing one arc shows: the blade's last 0.3 s before the blow. */
  span: 0.3,
  /** After it is revealed (the blow lands) it is held whole for `hold`, then fades over `fade`: 0.34 s in all. */
  hold: 0.1,
  fade: 0.24,
  /** It keeps tracing the blade's follow-through this long after the blow. */
  follow: 0.1,
  /** Once revealed its shape ages at this fraction of the clock, so the fade, not the tail, is what takes it away. */
  drift: 0.4,
  /** The share of the weapon, from the tip toward the hand, its body covers. */
  share: 0.5,
  /** Its body's least and greatest thickness. The least is what a thrust gets. */
  minWidth: 0.14,
  maxWidth: 0.42,
  /** The soft halo beyond its leading edge and beyond its inner side, as fractions of its thickness. */
  haloOut: 0.32,
  haloIn: 0.55,
  /**
   * A blade that jumps further than this in a sixtieth of a second has been moved, not swung: the arc breaks there. A
   * long blade may go further, `stepBlades` times its traced half (a giant's sabre sweeps metres a frame); see
   * arcStepLimit.
   */
  maxStep: 0.9,
  stepBlades: 2.5,
  /** Below this the swept surface is seen nearly edge on, and its body leans toward the eye so it is never a hairline. */
  edgeOn: 0.35,
});

/** The arc's envelope since the blow: how opaque it is and how thick, as factors. Zero before the blow and once over. */
export interface ArcEnvelope { alpha: number; width: number; done: boolean }

/**
 * How far a blade's tip may move from one sample to the next and still be one stroke, `seconds` after the last: the
 * board's jump (ARC.maxStep, times `scale` for a giant), or ARC.stepBlades times `blade` (the traced half of the blade,
 * tip to root) if that is further, for each sixtieth of a second between the samples (up to six). So a giant's chop,
 * or any swing filmed at thirty frames a second or caught across a slow frame, stays one stroke, and only a figure put
 * somewhere else breaks it.
 */
export function arcStepLimit(blade: number, scale: number, seconds: number): number {
  const reach = Math.max(ARC.maxStep * Math.max(0.5, Number.isFinite(scale) ? scale : 1), Number.isFinite(blade) ? Math.max(0, blade) * ARC.stepBlades : 0);
  return reach * Math.max(1, Math.min(6, (Number.isFinite(seconds) ? seconds : 0) * 60));
}

/**
 * The envelope `since` seconds after the arc was revealed, `hold` being any extra time it is held (a summon's virtual
 * blade is revealed as its sweep begins, and held while it sweeps). Fast in, fast out: the arc is whole on the frame of
 * the blow and gone 0.3 s later, thinning as it fades.
 */
export function arcEnvelope(since: number, hold = 0, out: ArcEnvelope = { alpha: 0, width: 0, done: false }): ArcEnvelope {
  if (!(since >= 0)) { out.alpha = 0; out.width = 0; out.done = false; return out; }
  const holdFor = ARC.hold + Math.max(0, hold);
  const left = 1 - smoothstep(holdFor, holdFor + ARC.fade, since);
  out.alpha = left > 0 ? Math.pow(left, 1.3) : 0;
  out.width = left > 0 ? 0.62 + 0.38 * left : 0;
  out.done = since >= holdFor + ARC.fade;
  return out;
}

/**
 * How thick the arc's body is along its length, as a factor of the blade's thickness: `u` is 0 at the weapon and 1 at
 * its oldest end. A crescent: not pinched at the weapon (the blade is there), fullest a little behind it, and drawn to a
 * point at its tail.
 */
export function arcWidthAlong(u: number): number {
  const t = clamp01(u);
  const head = 0.72 + 0.28 * smoothstep(0, 0.14, t);
  const tail = 1 - smoothstep(0.28, 1, t);
  return head * Math.pow(tail, 0.9);
}

/** How bright the arc is along its length: whole for most of it, fading out over its last part. */
export function arcAlphaAlong(u: number): number {
  return 1 - smoothstep(0.55, 1, clamp01(u));
}

/** One coordinate of a uniform Catmull-Rom spline through p1 and p2 (p0 and p3 their neighbours) at `t` in 0..1. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/**
 * The blade's recent past: a ring of samples (tip, root, the clock when each was taken, and whether the arc breaks
 * before it). Written in place, never grown: a frame's sample allocates nothing.
 */
export class ArcHistory {
  readonly capacity: number;
  readonly tip: Float32Array;
  readonly root: Float32Array;
  readonly birth: Float64Array;
  readonly broken: Uint8Array;
  start = 0;
  count = 0;
  private pendingBreak = true;

  constructor(capacity: number = ARC.history) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.tip = new Float32Array(this.capacity * 3);
    this.root = new Float32Array(this.capacity * 3);
    this.birth = new Float64Array(this.capacity);
    this.broken = new Uint8Array(this.capacity);
  }

  /** The buffer index of the `i`-th oldest sample. */
  index(i: number): number { return (this.start + i) % this.capacity; }

  clear(): void { this.start = 0; this.count = 0; this.pendingBreak = true; }

  /** The next sample starts a new stroke: the socket went missing, or the blade was moved rather than swung. */
  breakNext(): void { this.pendingBreak = true; }

  /** Forgets samples taken more than `keep` seconds before `now`. */
  expire(now: number, keep: number): void {
    while (this.count > 0 && now - this.birth[this.start] > keep) { this.start = (this.start + 1) % this.capacity; this.count -= 1; }
    if (this.count === 0) this.pendingBreak = true;
  }

  /**
   * Keeps a sample. A blade that has not moved since the last one is not kept twice (the arc would fold on itself);
   * one that jumped further than `maxStep` starts a new stroke. False when nothing was kept.
   */
  push(now: number, tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, maxStep: number = ARC.maxStep): boolean {
    if (!(Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz) && Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz))) { this.pendingBreak = true; return false; }
    if (this.count > 0) {
      const last = this.index(this.count - 1) * 3;
      const step = Math.hypot(tx - this.tip[last], ty - this.tip[last + 1], tz - this.tip[last + 2]);
      if (step > maxStep) this.pendingBreak = true;
      else if (step < 1e-5 && !this.pendingBreak) return false;
    } else this.pendingBreak = true;
    let at: number;
    if (this.count === this.capacity) { at = this.start; this.start = (this.start + 1) % this.capacity; } else { at = this.index(this.count); this.count += 1; }
    this.tip[at * 3] = tx; this.tip[at * 3 + 1] = ty; this.tip[at * 3 + 2] = tz;
    this.root[at * 3] = rx; this.root[at * 3 + 1] = ry; this.root[at * 3 + 2] = rz;
    this.birth[at] = now; this.broken[at] = this.pendingBreak ? 1 : 0;
    this.pendingBreak = false;
    return true;
  }

  /** How many of the newest samples run on without a break: the stroke the arc draws. */
  newestRun(): number {
    let run = 0;
    for (let i = this.count - 1; i >= 0; i -= 1) { run += 1; if (this.broken[this.index(i)]) break; }
    return run;
  }
}

/** What the strip is drawn with beyond the history: the eye, the arc's clock, its envelope, and how finely it is cut. */
export interface ArcStripInput {
  /** The clock the arc's shape is measured on (the flourish clock, slowed once revealed: ARC.drift). */
  shapeNow: number;
  eye: { x: number; y: number; z: number };
  envelope: { alpha: number; width: number };
  /** Cuts between two samples. */
  subdivide: number;
  /** Seconds of swing shown. */
  span?: number;
  /** The blade's scale: a giant's sabre (a summoned colossus) has a thicker arc. 1 for a figure of the board. */
  scale?: number;
}

/** Vertices across one section of the strip: the halo beyond the leading edge, the edge, the inner side, its halo. */
export const ARC_ACROSS = Object.freeze([-ARC.haloOut, 0, 1, 1 + ARC.haloIn]);
/**
 * Where those four lie across a thrust's stroke, as fractions of its thickness: centred on the line of the thrust, with
 * an even halo either side (a thrust has no leading edge and no inner side).
 */
export const THRUST_ACROSS = Object.freeze([-0.5 - ARC.haloIn, -0.5, 0.5, 0.5 + ARC.haloIn]);

/**
 * Builds the strip an arc is drawn as, into buffers allocated once. Each section of the strip has four vertices
 * (ARC_ACROSS): `across` carries where a vertex lies across the body (0 the leading edge, 1 the inner side, beyond
 * either the halo), `along` how far down the arc (0 at the weapon, 1 at its tail), `alpha` how opaque it is there, and
 * `sweep` how much of a swing it is (1) rather than a thrust (0): a thrust's stroke is centred on its line
 * (THRUST_ACROSS) and shaded hot down its middle.
 * The leading edge of every section is the blade tip's own path. The tips and the way the arc runs at each section
 * are kept too, for the sparks it sheds.
 */
export class ArcStrip {
  readonly maxSections: number;
  readonly positions: Float32Array;
  readonly across: Float32Array;
  readonly along: Float32Array;
  readonly alpha: Float32Array;
  readonly sweep: Float32Array;
  /** Per section: the tip, the way the tip was travelling (unit), and the body's inward direction (unit). */
  readonly tips: Float32Array;
  readonly tangents: Float32Array;
  readonly normals: Float32Array;
  readonly us: Float32Array;
  sections = 0;
  private readonly roots: Float32Array;
  private readonly births: Float64Array;

  constructor(history: number = ARC.history, subdivide = 6) {
    this.maxSections = (Math.max(2, history) - 1) * Math.max(1, subdivide) + 1;
    const vertices = this.maxSections * 4;
    this.positions = new Float32Array(vertices * 3);
    this.across = new Float32Array(vertices);
    this.along = new Float32Array(vertices);
    this.alpha = new Float32Array(vertices);
    this.sweep = new Float32Array(vertices);
    this.tips = new Float32Array(this.maxSections * 3);
    this.tangents = new Float32Array(this.maxSections * 3);
    this.normals = new Float32Array(this.maxSections * 3);
    this.us = new Float32Array(this.maxSections);
    this.roots = new Float32Array(this.maxSections * 3);
    this.births = new Float64Array(this.maxSections);
  }

  /** The index buffer for `maxSections`: three quads (halo, body, halo) between each pair of sections. */
  static indices(maxSections: number): Uint16Array | Uint32Array {
    const count = Math.max(0, maxSections - 1) * 18;
    const out = maxSections * 4 > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let s = 0; s < maxSections - 1; s += 1) for (let q = 0; q < 3; q += 1) {
      const a = s * 4 + q, b = a + 4, at = (s * 3 + q) * 6;
      out[at] = a; out[at + 1] = b; out[at + 2] = a + 1; out[at + 3] = a + 1; out[at + 4] = b; out[at + 5] = b + 1;
    }
    return out;
  }

  /**
   * Lays the newest unbroken stroke of `history` out as the strip. Returns the number of sections written (0 or at
   * least 2); `sections - 1` quads of each kind are drawn.
   */
  build(history: ArcHistory, input: ArcStripInput): number {
    const span = input.span ?? ARC.span, cut = Math.max(1, Math.floor(input.subdivide)), scale = Math.max(0.25, input.scale ?? 1);
    const least = ARC.minWidth * scale, most = ARC.maxWidth * scale;
    const run = history.newestRun();
    this.sections = 0;
    if (run < 2 || input.envelope.alpha <= 0) return 0;
    // the samples still within the span, newest last
    let first = history.count - run;
    while (first < history.count - 1 && input.shapeNow - history.birth[history.index(first)] >= span) first += 1;
    const samples = history.count - first;
    if (samples < 2) return 0;
    // 1. the sections: the samples, and Catmull-Rom cuts between them, on the tip's path and on the root's
    // the ring index of the i-th sample from `first`, clamped to the run (no closure: a frame allocates nothing)
    const end = samples - 1;
    let n = 0;
    for (let i = 0; i < samples - 1 && n < this.maxSections - 1; i += 1) {
      const a = history.index(first + Math.max(0, i - 1)), b = history.index(first + i);
      const c = history.index(first + Math.min(end, i + 1)), d = history.index(first + Math.min(end, i + 2));
      for (let k = 0; k < cut && n < this.maxSections - 1; k += 1) {
        const t = k / cut;
        for (let axis = 0; axis < 3; axis += 1) {
          this.tips[n * 3 + axis] = catmullRom(history.tip[a * 3 + axis], history.tip[b * 3 + axis], history.tip[c * 3 + axis], history.tip[d * 3 + axis], t);
          this.roots[n * 3 + axis] = catmullRom(history.root[a * 3 + axis], history.root[b * 3 + axis], history.root[c * 3 + axis], history.root[d * 3 + axis], t);
        }
        this.births[n] = history.birth[b] + (history.birth[c] - history.birth[b]) * t;
        n += 1;
      }
    }
    const last = history.index(first + end);
    for (let axis = 0; axis < 3; axis += 1) { this.tips[n * 3 + axis] = history.tip[last * 3 + axis]; this.roots[n * 3 + axis] = history.root[last * 3 + axis]; }
    this.births[n] = history.birth[last];
    n += 1;
    // 2. the frame of each section, and its four vertices
    let px = 0, py = 0, pz = 0, haveNormal = false;
    let tx0 = 0, ty0 = 0, tz0 = 0;
    for (let s = 0; s < n; s += 1) {
      const o = s * 3, before = Math.max(0, s - 1) * 3, after = Math.min(n - 1, s + 1) * 3;
      let tx = this.tips[after] - this.tips[before], ty = this.tips[after + 1] - this.tips[before + 1], tz = this.tips[after + 2] - this.tips[before + 2];
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-7) { tx = tx0; ty = ty0; tz = tz0; tl = Math.hypot(tx, ty, tz); }
      if (tl < 1e-7) { tx = 1; ty = 0; tz = 0; tl = 1; }
      tx /= tl; ty /= tl; tz /= tl; tx0 = tx; ty0 = ty; tz0 = tz;
      const x = this.tips[o], y = this.tips[o + 1], z = this.tips[o + 2];
      // toward the root, square to the path; how much the blade sweeps rather than runs along its own line
      let bx = this.roots[o] - x, by = this.roots[o + 1] - y, bz = this.roots[o + 2] - z;
      const full = Math.hypot(bx, by, bz);
      const along = bx * tx + by * ty + bz * tz;
      bx -= along * tx; by -= along * ty; bz -= along * tz;
      const blade = Math.hypot(bx, by, bz), sweep = blade / Math.max(full, 1e-6);
      // toward the eye, and the side of the path that faces it
      let ex = input.eye.x - x, ey = input.eye.y - y, ez = input.eye.z - z;
      const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
      let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-7) { sx /= sl; sy /= sl; sz /= sl; } else { sx = 0; sy = 1; sz = 0; }
      // the blade's own way across, where it sweeps; and how far to trust it: a thrust, or a swing seen edge on, turns
      // its body toward the eye instead, on the side the blade (or the last section) already reaches
      let trust = 0, wx = sx, wy = sy, wz = sz;
      if (blade > 1e-5) {
        wx = bx / blade; wy = by / blade; wz = bz / blade;
        const mx = ty * wz - tz * wy, my = tz * wx - tx * wz, mz = tx * wy - ty * wx;
        trust = smoothstep(0.12, 0.4, sweep) * smoothstep(0, ARC.edgeOn, Math.abs(mx * ex + my * ey + mz * ez));
      }
      const sign = blade > 1e-5 ? (sx * wx + sy * wy + sz * wz >= 0 ? 1 : -1) : (haveNormal && sx * px + sy * py + sz * pz < 0 ? -1 : 1);
      let nx = wx * trust + sx * sign * (1 - trust), ny = wy * trust + sy * sign * (1 - trust), nz = wz * trust + sz * sign * (1 - trust);
      const nl = Math.hypot(nx, ny, nz);
      if (nl > 1e-6) { nx /= nl; ny /= nl; nz /= nl; } else { nx = sx; ny = sy; nz = sz; }
      // a section's thickness: the blade's share where it sweeps, a thrust's where it does not
      const thickness = least + (Math.min(most, Math.max(least, blade)) - least) * trust;
      px = nx; py = ny; pz = nz; haveNormal = true;
      const u = clamp01((input.shapeNow - this.births[s]) / span);
      const thick = thickness * arcWidthAlong(u) * input.envelope.width;
      const fade = arcAlphaAlong(u) * input.envelope.alpha;
      this.tangents[o] = tx; this.tangents[o + 1] = ty; this.tangents[o + 2] = tz;
      this.normals[o] = nx; this.normals[o + 1] = ny; this.normals[o + 2] = nz;
      this.us[s] = u;
      for (let k = 0; k < 4; k += 1) {
        const v = s * 4 + k, reach = (THRUST_ACROSS[k] + (ARC_ACROSS[k] - THRUST_ACROSS[k]) * trust) * thick;
        this.positions[v * 3] = x + nx * reach; this.positions[v * 3 + 1] = y + ny * reach; this.positions[v * 3 + 2] = z + nz * reach;
        this.across[v] = ARC_ACROSS[k]; this.along[v] = u; this.alpha[v] = fade; this.sweep[v] = trust;
      }
    }
    this.sections = n;
    return n;
  }
}

/** Where along an arc's visible stroke a spark leaves (0 at the weapon, 1 at the tail), most near the weapon. */
export function sparkAlong(roll: number): number {
  return Math.pow(clamp01(roll), 1.8) * 0.85;
}
