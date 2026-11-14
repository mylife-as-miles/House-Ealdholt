// Vegetation geometry kit: procedural tree / shrub / ground-cover meshes, built per species at a few
// levels of detail. Everything is solid geometry (no alpha cards): fronds, pads and strands are thin
// double-sided sheets, so there is no alpha-test shimmer and no overdraw from transparent quads.
//
// Every vertex carries, besides position/normal/colour, an `aVeg` vec4 read by the vegetation shader:
//   x  leaf     0 = bark/wood, 1 = foliage (tint, translucency, flutter apply to foliage only)
//   y  sway     0 at the base .. 1 at the top: how far the whole-plant wind sway moves this vertex
//   z  flutter  local leaf/strand flutter amplitude (0 = rigid)
//   w  ao       baked ambient occlusion (crown interior / lower tiers / undersides are darker)
// and an `aVeg2` vec2: the part it belongs to (anchor height, kind + random; see PART below), which
// lets the shader vary every instance's form (missing branches, lifted crown base, broken top).
// Foliage normals are blended toward the direction out of the crown centre, so a crown shades like
// one soft volume instead of hundreds of flat sheets.
//
// Reference sizes (instance scale 1): spire conifer 34 m, parasol pine 22 m, aspen 19 m, ghost tree
// 16 m, giants ~78 m, fallen log 18 m, shrub ~2.4 m, grass tuft ~0.55 m, reed clump ~2 m.

import * as THREE from 'crownfall-world-three';
import { mergeVertices } from '../core/geometry-utils.js';

const TAU = Math.PI * 2;
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------------------------------------------------------------------------
// accumulator
// ---------------------------------------------------------------------------

// Part kinds (aVeg2.y integer part), read by the vegetation shader's per-instance form pass:
//   RIGID  never removed (trunks, limbs, the main crown mass); clipped at a broken top
//   PART   a branch spray / pad / strand: removed per instance (random gaps), below the crown base
//          (self-pruned lower branches) and above a broken top — it collapses onto its anchor
//   TIER   like PART but never a random gap (whole tiers of the coarse LODs)
//   CORE   the dark inner cone: vertices below the crown base / above a broken top fold onto the axis
//   CONE   far-LOD cone vertices: heights clamped between crown base and broken top
export const PART = { RIGID: 0, PART: 1, TIER: 2, CORE: 3, CONE: 4 };

export class VegGeo {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.veg = [];
    this.veg2 = [];
    this.idx = [];
    this.pk = 0;
    this.pa = null;
    this.pr = 0;
  }

  get count() {
    return this.pos.length / 3;
  }

  /** Following vertices belong to one part: kind (PART.*), anchor height (m; null = own height), random 0..1. */
  part(kind = 0, anchor = null, rnd = 0) {
    this.pk = kind;
    this.pa = anchor;
    this.pr = Math.min(0.999, Math.max(0, rnd));
    return this;
  }

  v(p, n, c, leaf, sway, flut, ao) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.veg.push(leaf, sway, flut, ao);
    this.veg2.push(this.pa === null ? p[1] : this.pa, this.pk + this.pr);
    return this.count - 1;
  }

  t(a, b, c) {
    this.idx.push(a, b, c);
  }

  q(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Set the sway weight of every vertex from its height: ((y - y0) / H) ^ exp, keeping larger values. */
  swayByHeight(H, exp = 1.6, y0 = 0) {
    for (let i = 0, n = this.count; i < n; i++) {
      const y = this.pos[i * 3 + 1];
      const s = Math.pow(clamp01((y - y0) / H), exp);
      if (s > this.veg[i * 4 + 1]) this.veg[i * 4 + 1] = s;
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    const n = this.count;
    const nrm = new Float32Array(this.nrm);
    for (let i = 0; i < n; i++) {
      const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      // a zero normal would turn into NaN in the shader (white specks after post): point it up
      if (!(l > 1e-6)) {
        nrm[i * 3] = 0;
        nrm[i * 3 + 1] = 1;
        nrm[i * 3 + 2] = 0;
        continue;
      }
      nrm[i * 3] = x / l;
      nrm[i * 3 + 1] = y / l;
      nrm[i * 3 + 2] = z / l;
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aVeg', new THREE.BufferAttribute(new Float32Array(this.veg), 4));
    g.setAttribute('aVeg2', new THREE.BufferAttribute(new Float32Array(this.veg2), 2));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.tris = this.idx.length / 3;
    return g;
  }
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

/**
 * Generalised cylinder along a polyline (parallel-transport frames). Normals come from the actual
 * surface (so flared buttress fins shade correctly).
 *   radius(t)            radius along the path (t 0..1)
 *   shape(t, a)          radius multiplier around the ring (fins, ridges)
 *   color(t, a) / ao(t, a)
 */
export function tube(g, path, { sides = 6, radius, shape = null, color, ao = null, leaf = 0, flutter = 0, cap = false, angle0 = 0 }) {
  const n = path.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    T.push(norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  }
  // initial normal: perpendicular to T0, preferring world x
  let N = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  N = norm3(cross(cross(T[0], N), T[0]));
  const rings = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const d = dot(N, T[i]);
      N = norm3([N[0] - T[i][0] * d, N[1] - T[i][1] * d, N[2] - T[i][2] * d]);
    }
    const B = cross(T[i], N);
    const t = i / (n - 1);
    const r0 = radius(t);
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = angle0 + (k / sides) * TAU;
      const r = r0 * (shape ? shape(t, a) : 1);
      const ca = Math.cos(a), sa = Math.sin(a);
      const d = [N[0] * ca + B[0] * sa, N[1] * ca + B[1] * sa, N[2] * ca + B[2] * sa];
      ring.push([path[i][0] + d[0] * r, path[i][1] + d[1] * r, path[i][2] + d[2] * r, d]);
    }
    rings.push(ring);
  }
  const base = g.count;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    for (let k = 0; k < sides; k++) {
      const p = rings[i][k];
      // surface normal from neighbours (ring tangent x path tangent)
      const pk1 = rings[i][(k + 1) % sides];
      const pk0 = rings[i][(k - 1 + sides) % sides];
      const pi1 = rings[Math.min(n - 1, i + 1)][k];
      const pi0 = rings[Math.max(0, i - 1)][k];
      const du = [pk1[0] - pk0[0], pk1[1] - pk0[1], pk1[2] - pk0[2]];
      const dv = [pi1[0] - pi0[0], pi1[1] - pi0[1], pi1[2] - pi0[2]];
      let nn = norm3(cross(dv, du));
      if (dot(nn, p[3]) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      const a = angle0 + (k / sides) * TAU;
      g.v([p[0], p[1], p[2]], nn, color(t, a), leaf, 0, flutter * t, ao ? ao(t, a) : 1);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k;
      const b = base + i * sides + ((k + 1) % sides);
      const c = base + (i + 1) * sides + ((k + 1) % sides);
      const d = base + (i + 1) * sides + k;
      g.q(a, b, c, d);
    }
  }
  if (cap) {
    const e = path[n - 1];
    const c = g.v(e, T[n - 1], color(1, 0), leaf, 0, flutter, ao ? ao(1, 0) : 1);
    const r = base + (n - 1) * sides;
    for (let k = 0; k < sides; k++) g.t(r + k, r + ((k + 1) % sides), c);
  }
  return g;
}

/** Quadratic/cubic Bezier sampled into a polyline of `segs` segments. */
export function bezier(p0, p1, p2, p3, segs) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
    ]);
  }
  return out;
}

/**
 * Conifer frond: a drooping, gabled ("roof" cross-section), serrated branch spray.
 * o: origin on the trunk; az: azimuth; L: length; W: half width; droop: tip drop (m).
 */
export function frond(g, o, az, L, W, droop, segs, { base, tip, aoIn = 0.35, aoOut = 1, flutter = 0.6, roof = 0.45, serr = 0.5, lift = 0, curl = 0.12, crown = null, rnd = null, blunt = 0 }) {
  const dx = Math.cos(az), dz = Math.sin(az);
  const side = [-dz, 0, dx];
  const spine = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const drop = droop * Math.pow(t, 1.6) - lift * t - curl * L * sstep(0.75, 1, t);
    spine.push([o[0] + dx * L * t, o[1] - drop, o[2] + dz * L * t]);
  }
  const cc = crown || [0, o[1], 0];
  const verts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = spine[i];
    // width: swells from the trunk, tapers (to a point, or blunt); edges are ragged needle tufts
    let w = W * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * Math.min(1, t * (1 - blunt * 0.35)))), 0.65) * (1 - 0.25 * t);
    if (i === segs && !blunt) w = 0;
    const jl = rnd ? 0.55 + 0.45 * rnd() : 1;
    const jr = rnd ? 0.55 + 0.45 * rnd() : 1;
    const odd = i % 2 === 1 ? 1 - serr : 1;
    const wl = w * odd * jl, wr = w * odd * jr;
    const hl = rnd ? 0.25 * w * rnd() : 0, hr = rnd ? 0.25 * w * rnd() : 0;
    const radial = norm3([p[0] - cc[0], (p[1] - cc[1]) * 0.6 + 0.35, p[2] - cc[2]]);
    const c = mixc(base, tip, Math.pow(t, 1.3));
    const ao = aoIn + (aoOut - aoIn) * Math.pow(t, 0.8);
    const fl = flutter * t * t;
    const ridgeN = norm3([radial[0] * 0.7, radial[1] * 0.7 + 0.3, radial[2] * 0.7]);
    const lN = norm3([radial[0] * 0.6 + side[0] * 0.25, radial[1] * 0.6 + 0.3, radial[2] * 0.6 + side[2] * 0.25]);
    const rN = norm3([radial[0] * 0.6 - side[0] * 0.25, radial[1] * 0.6 + 0.3, radial[2] * 0.6 - side[2] * 0.25]);
    const sv = g.v([p[0], p[1] + w * 0.12, p[2]], ridgeN, c, 1, 0, fl, ao);
    const l = g.v([p[0] + side[0] * wl, p[1] - wl * roof - hl, p[2] + side[2] * wl], lN, mulc(c, 0.9), 1, 0, fl * 1.2, ao * 0.93);
    const r = g.v([p[0] - side[0] * wr, p[1] - wr * roof - hr, p[2] - side[2] * wr], rN, mulc(c, 0.9), 1, 0, fl * 1.2, ao * 0.93);
    verts.push([sv, l, r]);
  }
  for (let i = 0; i < segs; i++) {
    const [s0, l0, r0] = verts[i];
    const [s1, l1, r1] = verts[i + 1];
    g.q(s0, l0, l1, s1);
    g.q(s0, s1, r1, r0);
  }
  return g;
}

// unit icospheres (indexed, merged) cached per detail level
const sphereCache = new Map();
function unitSphere(detail) {
  if (!sphereCache.has(detail)) {
    let s = new THREE.IcosahedronGeometry(1, detail);
    s.deleteAttribute('normal');
    s.deleteAttribute('uv');
    s = mergeVertices(s, 1e-4);
    sphereCache.set(detail, s);
  }
  return sphereCache.get(detail);
}

/**
 * Displaced, squashed icosphere: a foliage pad / cloud of leaves / shrub lobe.
 *   c: centre, r: [rx, ry, rz], flatTop: 0..1 flattens the upper half into a table (parasol pads)
 *   crown: point the soft normals radiate from (defaults to the pad centre)
 */
export function blob(g, c, r, detail, noise, { seed = 0, amp = 0.25, freq = 1.2, color, ao = null, leaf = 1, flutter = 0.25, crown = null, flatTop = 0, under = 0.55, soft = 0.55 }) {
  const s = unitSphere(detail);
  const P = s.attributes.position;
  const idx = s.index.array;
  const n = P.count;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const d = 1 + amp * noise.noise3(x * freq + seed * 7.1, y * freq + seed * 3.3, z * freq - seed * 5.7) + amp * 0.5 * noise.noise3(x * freq * 2.3 - seed, y * freq * 2.3, z * freq * 2.3 + seed);
    x *= d;
    y *= d;
    z *= d;
    if (flatTop > 0 && y > 0) y *= 1 - flatTop * 0.6;
    if (y < 0) y *= under;
    pos[i * 3] = c[0] + x * r[0];
    pos[i * 3 + 1] = c[1] + y * r[1];
    pos[i * 3 + 2] = c[2] + z * r[2];
  }
  // geometric normals
  const nrm = new Float32Array(n * 3);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, cc = idx[k + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[cc] - pos[a], pos[cc + 1] - pos[a + 1], pos[cc + 2] - pos[a + 2]];
    const f = cross(e1, e2);
    for (const v of [a, b, cc]) {
      nrm[v] += f[0];
      nrm[v + 1] += f[1];
      nrm[v + 2] += f[2];
    }
  }
  const cr = crown || c;
  const base = g.count;
  for (let i = 0; i < n; i++) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const gn = norm3([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]);
    const rd = norm3([p[0] - cr[0], p[1] - cr[1] + 0.001, p[2] - cr[2]]);
    const nn = norm3([gn[0] * (1 - soft) + rd[0] * soft, gn[1] * (1 - soft) + rd[1] * soft, gn[2] * (1 - soft) + rd[2] * soft]);
    const ly = (p[1] - c[1]) / r[1]; // -1 .. 1 within the pad
    g.v(p, nn, color(p, gn, ly), leaf, 0, flutter, ao ? ao(p, gn, ly) : 1);
  }
  for (let k = 0; k < idx.length; k += 3) g.t(base + idx[k], base + idx[k + 1], base + idx[k + 2]);
  return g;
}

/** Hanging strand (hair-like foliage): a ribbon from `top` falling `len` metres, facing `out`. */
export function strand(g, top, len, width, segs, out, { colTop, colTip, aoTop = 0.7, aoTip = 1, flutter = 1, curl = 0.3, twist = 0 }) {
  const side = [-out[2], 0, out[0]];
  const base = g.count;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * (1 - 0.75 * t) * 0.5;
    const tw = twist * t;
    const sx = side[0] * Math.cos(tw) + out[0] * Math.sin(tw);
    const sz = side[2] * Math.cos(tw) + out[2] * Math.sin(tw);
    const p = [top[0] + out[0] * curl * len * t * t, top[1] - len * t, top[2] + out[2] * curl * len * t * t];
    const nrm = norm3([out[0], 0.35, out[2]]);
    const c = mixc(colTop, colTip, t);
    const ao = aoTop + (aoTip - aoTop) * t;
    g.v([p[0] - sx * w, p[1], p[2] - sz * w], nrm, c, 1, 0, flutter * (0.25 + t), ao);
    g.v([p[0] + sx * w, p[1], p[2] + sz * w], nrm, c, 1, 0, flutter * (0.25 + t), ao);
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    g.q(a, a + 1, a + 3, a + 2);
  }
  return g;
}

/** Grass blade / reed leaf: tapered, bending strip. Normals lean up (shades like the ground). */
export function blade(g, b, az, h, w, bend, segs, { colBase, colTip, aoBase = 0.55, flutter = 1, upN = 0.75, tipCol = null, leaf = 1 }) {
  const dx = Math.cos(az), dz = Math.sin(az);
  const side = [-dz, 0, dx];
  const base = g.count;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const out = bend * t * t;
    const p = [b[0] + dx * out, b[1] + h * t * (1 - 0.25 * bend * t / Math.max(h, 0.01)), b[2] + dz * out];
    const ww = i === segs ? 0 : w * (1 - 0.8 * t) * 0.5;
    const n = norm3([dx * (1 - upN), upN, dz * (1 - upN)]);
    let c = mixc(colBase, colTip, Math.pow(t, 0.8));
    if (tipCol && i === segs) c = tipCol;
    const ao = aoBase + (1 - aoBase) * t;
    if (i === segs) {
      g.v(p, n, c, leaf, t, flutter * t, ao);
    } else {
      g.v([p[0] - side[0] * ww, p[1], p[2] - side[2] * ww], n, c, leaf, t, flutter * t, ao);
      g.v([p[0] + side[0] * ww, p[1], p[2] + side[2] * ww], n, c, leaf, t, flutter * t, ao);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = base + i * 2;
    g.q(a, a + 1, a + 3, a + 2);
  }
  const a = base + (segs - 1) * 2;
  g.t(a, a + 1, a + 2);
  return g;
}

// ---------------------------------------------------------------------------
// species
// ---------------------------------------------------------------------------

const PAL = {
  bark: lin('#6e5a4a'),
  barkDark: lin('#3a302a'),
  needle: lin('#33503a'),
  needleTip: lin('#5e8047'),
  needleFar: lin('#34503a'),
  pine: lin('#34522b'),
  pineTip: lin('#62833f'),
  pineBark: lin('#5a3f2e'),
  ghostBark: lin('#cfc8b8'),
  ghostBarkDark: lin('#7d776c'),
  ghostHair: lin('#78896f'),
  ghostHairTip: lin('#a4ae96'),
  giantBark: lin('#4a4038'),
  giantLichen: lin('#8f8a74'),
  giantLeaf: lin('#42633a'),
  giantLeafTip: lin('#7d984c'),
  giantMoss: lin('#4d5a34'),
  paleBark: lin('#b8ab96'),
  shrub: lin('#3a552e'),
  shrubTip: lin('#6a8544'),
  grass: lin('#ffffff'),
  reed: lin('#5b6b36'),
  reedTip: lin('#b6a767'),
  cattail: lin('#4a3222'),
  fern: lin('#2e4c21'),
  fernTip: lin('#5f8236'),
  deadWood: lin('#8a8176'),
  aspenBark: lin('#c4c1ae'),
  aspenBarkLow: lin('#5c564c'),
  aspenLeaf: lin('#4f6e2e'),
  aspenLeafTip: lin('#7a9442'),
  moss: lin('#5b6b32'),
  soil: lin('#4a3a2c'),
};

/**
 * Spire conifer, H = 34 m. The dominant forest tree: a narrow, dense spire of 16 drooping whorls
 * with upturned tips over a dark inner core (so the crown reads as one solid dark mass, not a
 * fishbone), and a bare needle-thin leader at the very top. Every branch spray / tier spike is a
 * PART, so each instance loses a different handful (ragged silhouettes), interior trees shed their
 * lower tiers (bare trunks with dead stubs) and a few have wind-broken tops (see the shader).
 */
export function spireConifer(N, rng) {
  const H = 34;
  const Rmax = 4.5;
  const profile = (u) => (u < 0.12 ? 0.8 + 0.2 * (u / 0.12) : Math.pow((1 - u) / 0.88, 0.95)) * 0.93 + 0.07 * (1 - u);
  const yOf = (u) => H * (0.16 + 0.78 * Math.pow(u, 0.96));
  const trunkR = (y) => 0.6 * Math.pow(1 - clamp01((y + 2.5) / (H + 2.5)), 1.1) + 0.025;
  const lods = [];
  const coreCol = mulc(PAL.needle, 0.78);
  // dark inner cone: blocks the sky between the tiers
  const core = (g, sides, rings, rs = 0.55) => {
    g.part(PART.CORE);
    const base = g.count;
    for (let r = 0; r <= rings; r++) {
      const u = r / rings;
      const y = yOf(u) - 1.2 * (1 - u);
      const rad = r === rings ? 0.05 : Rmax * profile(u) * rs;
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU + r * 0.4;
        g.v([Math.cos(a) * rad, y, Math.sin(a) * rad], norm3([Math.cos(a), 0.5, Math.sin(a)]), coreCol, 1, 0, 0, 0.4 + 0.35 * u);
      }
    }
    for (let r = 0; r < rings; r++) for (let k = 0; k < sides; k++) g.q(base + r * sides + k, base + (r + 1) * sides + k, base + (r + 1) * sides + ((k + 1) % sides), base + r * sides + ((k + 1) % sides));
    g.part();
  };
  // coarse LOD foliage: `n` drooping spikes scattered up the crown (phyllotaxis + jitter, no
  // regular whorls, so a stand never reads as a herringbone of identical chevrons). Each spike is a
  // PART anchored on the trunk; its normals lean out along its azimuth so the crown shades as one
  // cone (sunlit flank / shaded flank) instead of striped tiers.
  const spikes = (g, n, u0, u1, { width = 0.42, rs = 1.05, droopK = 0.55, hub = 0.7, flut = 0.3, kindTop = 0.88 } = {}) => {
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, Math.max(0, u0 + (u1 - u0) * ((i + 0.2 + 0.6 * rng()) / n)));
      const y = yOf(u);
      const R = Rmax * profile(u) * rs * (0.82 + 0.34 * rng());
      const a = i * 2.39996 + (rng() - 0.5) * 0.6;
      const w = width * (0.8 + 0.4 * rng());
      const droop = R * droopK * (0.75 + 0.5 * rng()) * (0.7 + 0.5 * (1 - u));
      g.part(u > kindTop ? PART.TIER : PART.PART, y, rng());
      // little contrast inside a spike (a light tip on every spike reads as rows of arrowheads);
      // one cone-like normal per spike
      const ao = 0.55 + 0.45 * Math.pow(u, 0.7);
      const sn = norm3([Math.cos(a), 0.6, Math.sin(a)]);
      const hubY = y + hub * (0.6 + 0.8 * (1 - u));
      const body = mulc(PAL.needle, 0.92 + 0.16 * rng());
      const c = g.v([Math.cos(a) * 0.3, hubY, Math.sin(a) * 0.3], sn, body, 1, 0, 0, ao * 0.78);
      const tipCol = mixc(PAL.needleTip, body, 0.72 + 0.2 * rng());
      const tip = g.v([Math.cos(a) * R, y - droop, Math.sin(a) * R], sn, tipCol, 1, 0, flut, ao);
      const vl = g.v([Math.cos(a - w) * R * 0.62, y - droop * 0.5, Math.sin(a - w) * R * 0.62], sn, body, 1, 0, flut * 0.4, ao * 0.88);
      const vr = g.v([Math.cos(a + w) * R * 0.62, y - droop * 0.5, Math.sin(a + w) * R * 0.62], sn, body, 1, 0, flut * 0.4, ao * 0.88);
      g.t(c, tip, vl);
      g.t(c, vr, tip);
    }
    g.part();
  };
  const barkCol = (t) => mixc(PAL.barkDark, PAL.bark, sstep(0, 0.3, t));
  // dead, self-pruned branch stubs up the trunk (seen where the crown is lifted, and on snags);
  // inside a living crown they hide in the dark core
  const stubs = (g, n, sides) => {
    g.part(PART.RIGID);
    for (let i = 0; i < n; i++) {
      const u = Math.pow((i + rng()) / n, 0.85);
      const y = 2.5 + H * 0.86 * u;
      const az = i * 2.39996 + rng();
      const r0 = trunkR(y) * 0.7;
      const L = (0.5 + rng() * 1.6) * (1 - 0.6 * u);
      const dx = Math.cos(az), dz = Math.sin(az);
      tube(g, [[dx * r0, y, dz * r0], [dx * (r0 + L * 0.6), y - 0.12 * L, dz * (r0 + L * 0.6)], [dx * (r0 + L), y - 0.35 * L + 0.2, dz * (r0 + L)]], {
        sides,
        radius: (t) => 0.07 * (1 - t) + 0.015,
        color: () => mixc(PAL.deadWood, PAL.bark, 0.3 * rng()),
        ao: () => 0.6,
      });
    }
  };

  // LOD0 --------------------------------------------------------------------
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [[0, -2.5, 0], [0, H * 0.3, 0], [0, H * 0.7, 0], [0, H * 1.0, 0]], {
      sides: 7,
      radius: (t) => 0.6 * Math.pow(1 - t, 1.1) + 0.025,
      shape: (t, a) => 1 + 0.08 * Math.sin(a * 7 + t * 9),
      color: barkCol,
      ao: (t) => 0.5 + 0.4 * t,
    });
    stubs(g, 18, 3);
    core(g, 7, 5);
    const nT = 16;
    for (let i = 0; i < nT; i++) {
      const u = i / (nT - 1);
      const y = yOf(u);
      const R = Rmax * profile(u);
      const K = Math.max(4, Math.round(8 - 4 * u));
      const off = i * 2.39996 + rng() * 0.5;
      for (let k = 0; k < K; k++) {
        const az = off + (k / K) * TAU + (rng() - 0.5) * 0.5;
        const L = R * (0.82 + rng() * 0.3) * (rng() < 0.1 ? 1.2 : 1);
        const segs = 4;
        const br = 0.82 + 0.36 * rng();
        // whorls are jittered (interwhorl branches) so the tiers don't read as regular stripes
        const oy = y + (rng() - 0.35) * 0.9 * (1 - 0.5 * u);
        // the top two tiers are never gaps (keeps the leader's silhouette crisp)
        g.part(u > 0.9 ? PART.TIER : PART.PART, oy, rng());
        frond(g, [Math.cos(az) * 0.25, oy, Math.sin(az) * 0.25], az, L, 0.5 + 0.55 * (L / Rmax), L * (0.42 + 0.3 * (1 - u)) * (0.75 + 0.5 * rng()), segs, {
          base: mulc(mixc(PAL.needle, PAL.barkDark, 0.12), br),
          tip: mulc(mixc(PAL.needleTip, PAL.needle, 0.5 + 0.35 * rng()), br),
          serr: 0.45,
          rnd: rng,
          blunt: 0.6,
          aoIn: 0.5 + 0.25 * u,
          aoOut: 0.78 + 0.22 * u,
          flutter: 0.5,
          curl: 0.14 + 0.1 * (1 - u),
          roof: 0.75,
          lift: u > 0.88 ? L * 0.35 : 0,
          crown: [0, y + 1.5, 0],
        });
      }
    }
    g.part();
    lods.push(g.swayByHeight(H, 1.7).build());
  }

  // LOD1: 46 scattered drooping spikes over the core ----------------------------------------
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [[0, -2.5, 0], [0, H * 0.5, 0], [0, H, 0]], {
      sides: 5,
      radius: (t) => 0.6 * (1 - t) + 0.03,
      color: barkCol,
      ao: (t) => 0.5 + 0.4 * t,
    });
    stubs(g, 4, 3);
    core(g, 5, 3);
    spikes(g, 46, 0, 1, { width: 0.45, flut: 0.35 });
    lods.push(g.swayByHeight(H, 1.7).build());
  }

  // LOD2: 15 coarse spikes (for the 250..700 m band) + a stick of a trunk ---------------------
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [[0, -2, 0], [0, H * 0.6, 0]], { sides: 3, radius: (t) => 0.5 * (1 - t) + 0.1, color: barkCol, ao: () => 0.6 });
    core(g, 3, 2, 0.6);
    spikes(g, 15, 0, 0.97, { width: 0.7, rs: 1.15, droopK: 0.62, hub: 1.1, flut: 0.2, kindTop: 0.8 });
    lods.push(g.swayByHeight(H, 1.7).build());
  }

  // LOD3: three overlapping 5-sided cones — a stepped, fir-like silhouette for 25 triangles --------
  {
    const g = new VegGeo();
    g.part(PART.CONE);
    const S = 5;
    const cone = (y0, r0, y1, r1, rot, ao0, ao1) => {
      const base = g.count;
      for (const [y, r, ao] of [[y0, r0, ao0], [y1, r1, ao1]]) {
        for (let k = 0; k < S; k++) {
          const a = rot + (k / S) * TAU;
          g.v([Math.cos(a) * r, y, Math.sin(a) * r], norm3([Math.cos(a), 0.6, Math.sin(a)]), mixc(PAL.needleFar, PAL.needleTip, 0.3 * ao), 1, 0, 0, ao);
        }
      }
      if (r1 > 0) for (let k = 0; k < S; k++) g.q(base + k, base + S + k, base + S + ((k + 1) % S), base + ((k + 1) % S));
      else for (let k = 0; k < S; k++) g.t(base + k, base + S + k, base + ((k + 1) % S));
    };
    cone(H * 0.1, Rmax * 0.95, H * 0.56, Rmax * 0.3, 0.0, 0.45, 0.62);
    cone(H * 0.36, Rmax * 0.8, H * 0.8, Rmax * 0.16, 0.6, 0.6, 0.8);
    cone(H * 0.6, Rmax * 0.56, H * 1.0, 0, 1.3, 0.75, 1.0);
    lods.push(g.swayByHeight(H, 1.7).build());
  }
  return { lods, H, R: Rmax, trunkR: 0.6 };
}

/** Parasol (umbrella) pine, H = 22 m: bare curving trunk, forked limbs, a flat-topped cloud canopy. */
export function parasolPine(N, rng) {
  const H = 22;
  const lods = [];
  const lean = [1.6, 0, 0.6];
  const trunkPath = bezier([0, -2, 0], [0.3, H * 0.3, 0.2], [lean[0] * 0.3, H * 0.55, lean[2]], [lean[0], H * 0.72, lean[2]], 10);
  const top = trunkPath[trunkPath.length - 1];
  const limbs = [];
  const nL = 6;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * TAU + rng() * 0.6;
    const r = 3.4 + rng() * 3.4;
    const end = [top[0] + Math.cos(a) * r, top[1] + 2.2 + rng() * 2.2, top[2] + Math.sin(a) * r];
    const mid = [top[0] + Math.cos(a) * r * 0.35, top[1] + 2.0 + rng(), top[2] + Math.sin(a) * r * 0.35];
    limbs.push({ a, r, end, path: bezier(top, mid, [end[0], end[1] - 1.2, end[2]], end, 5), r0: 0.26, r1: 0.1 });
  }
  const barkCol = (t) => mixc(PAL.barkDark, PAL.pineBark, sstep(0.05, 0.5, t));
  const crownC = [top[0], top[1] + 3.4, top[2]];
  const padCol = (p, gn, ly) => mixc(mulc(PAL.pine, 0.7), PAL.pineTip, clamp01(0.5 + 0.5 * ly) * 0.75 + 0.25 * clamp01(gn[1]));
  const padAo = (p, gn, ly) => 0.3 + 0.7 * clamp01(0.4 + 0.6 * ly) * (0.55 + 0.45 * clamp01(Math.hypot(p[0] - crownC[0], p[2] - crownC[2]) / 7));
  const pads = [];
  pads.push({ c: [crownC[0], crownC[1], crownC[2]], r: [5.0, 1.9, 5.0], d: 2 });
  for (const L of limbs) {
    const s = 2.9 + rng() * 1.4;
    pads.push({ c: [L.end[0], L.end[1] + 0.4, L.end[2]], r: [s, 1.45 + rng() * 0.4, s * (0.8 + rng() * 0.3)], d: 2 });
    const a2 = L.a + (rng() - 0.5) * 0.8;
    pads.push({ c: [top[0] + Math.cos(a2) * L.r * 0.55, L.end[1] + 1.1, top[2] + Math.sin(a2) * L.r * 0.55], r: [2.4, 1.2, 2.2], d: 1 });
  }
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU;
    const r = 1 + rng() * 2;
    pads.push({ c: [crownC[0] + Math.cos(a) * r, crownC[1] + 1.4, crownC[2] + Math.sin(a) * r], r: [2.8, 1.2, 2.5], d: 1 });
  }

  // LOD0
  {
    const g = new VegGeo();
    tube(g, trunkPath, { sides: 8, radius: (t) => 0.55 * (1 - t * 0.55) + (t < 0.05 ? 0.25 * (1 - t / 0.05) : 0), color: barkCol, ao: (t) => 0.5 + 0.4 * t, shape: (t, a) => 1 + 0.05 * Math.sin(a * 5 + t * 30) });
    for (const L of limbs) tube(g, L.path, { sides: 6, radius: (t) => L.r0 * (1 - t) + L.r1 * t, color: () => PAL.pineBark, ao: () => 0.5 });
    let seed = 1;
    // the central pad is always there; limb pads and rim tufts come and go per instance
    pads.forEach((p, i) => {
      g.part(i === 0 ? PART.RIGID : PART.PART, p.c[1], rng());
      blob(g, p.c, p.r, p.d, N, { seed: seed++, amp: 0.36, freq: 2.3, color: padCol, ao: padAo, crown: crownC, flatTop: 0.5, under: 0.5, flutter: 0.2 });
    });
    // tufts breaking the rim of the canopy
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU;
      const r = 5.5 + rng() * 3.2;
      const cy = crownC[1] + 0.2 + rng() * 1.6;
      g.part(PART.PART, cy, rng());
      blob(g, [crownC[0] + Math.cos(a) * r, cy, crownC[2] + Math.sin(a) * r], [1.3 + rng() * 0.6, 0.8, 1.2 + rng() * 0.6], 1, N, { seed: seed++, amp: 0.3, freq: 2.5, color: padCol, ao: padAo, crown: crownC, flatTop: 0.3, flutter: 0.3 });
    }
    g.part();
    lods.push(g.swayByHeight(H, 2.0).build());
  }
  // LOD1: the central pad + the three biggest limb pads (each can drop out, like LOD0)
  const bigPads = pads.slice(1, 1 + nL * 2).filter((_, i) => i % 2 === 0).sort((a, b) => b.r[0] - a.r[0]).slice(0, 4);
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [trunkPath[0], trunkPath[4], trunkPath[7], top], { sides: 5, radius: (t) => 0.55 * (1 - t * 0.5), color: barkCol, ao: () => 0.6 });
    for (const L of limbs.slice(0, 4)) tube(g, [L.path[0], L.path[3], L.end], { sides: 3, radius: () => 0.2, color: () => PAL.pineBark, ao: () => 0.55 });
    blob(g, [crownC[0], crownC[1] + 0.2, crownC[2]], [5.6, 2.1, 5.3], 1, N, { seed: 1, amp: 0.22, freq: 1.4, color: padCol, ao: padAo, crown: crownC, flatTop: 0.55 });
    bigPads.forEach((p, i) => {
      g.part(PART.PART, p.c[1], rng());
      blob(g, p.c, [p.r[0] * 1.15, p.r[1] * 1.1, p.r[2] * 1.15], 0, N, { seed: 20 + i, amp: 0.2, freq: 1.4, color: padCol, ao: padAo, crown: crownC, flatTop: 0.5, under: 0.5 });
    });
    lods.push(g.swayByHeight(H, 2.0).build());
  }
  // LOD2: a lobed umbrella (three flat pads) on a forked stick, not a disc on a pole
  {
    const g = new VegGeo();
    tube(g, [trunkPath[0], trunkPath[6], top], { sides: 3, radius: (t) => 0.6 * (1 - 0.4 * t), color: barkCol, ao: () => 0.6 });
    blob(g, [crownC[0], crownC[1] + 0.3, crownC[2]], [5.6, 2.2, 5.2], 0, N, { seed: 1, amp: 0.1, freq: 1, color: padCol, ao: padAo, crown: crownC, flatTop: 0.6, soft: 0.8 });
    bigPads.slice(0, 2).forEach((p, i) => {
      g.part(PART.PART, p.c[1], rng());
      blob(g, p.c, [p.r[0] * 1.25, p.r[1] * 1.2, p.r[2] * 1.25], 0, N, { seed: 30 + i, amp: 0.1, freq: 1, color: padCol, ao: padAo, crown: crownC, flatTop: 0.6, soft: 0.8 });
    });
    lods.push(g.swayByHeight(H, 2.0).build());
  }
  return { lods, H, R: 8, trunkR: 0.55 };
}

/**
 * Aspen, H = 19 m: a slender pale trunk with dark scars, a few ascending limbs and an upright ovoid
 * crown of small leaf clusters. Aspens grow in clonal groves on forest margins and around clearings:
 * their lighter, rounder crowns break the conifer comb, and they glow when backlit.
 */
export function aspen(N, rng) {
  const H = 19;
  const lods = [];
  const lean = [(rng() - 0.5) * 1.4, 0, (rng() - 0.5) * 1.4];
  const trunk = bezier([0, -1, 0], [0.25, H * 0.3, -0.15], [lean[0] * 0.55, H * 0.62, lean[2] * 0.55], [lean[0], H * 0.96, lean[2]], 10);
  const at = (t) => {
    const f = t * (trunk.length - 1);
    const k = Math.min(trunk.length - 2, Math.floor(f));
    const r = f - k;
    const a = trunk[k], b = trunk[k + 1];
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r, a[2] + (b[2] - a[2]) * r];
  };
  // pale bark with dark horizontal scars (lenticels, old branch scars), darker and rougher at the foot
  const barkCol = (t, a) => {
    const n = N.noise3(Math.cos(a) * 1.3, t * 38, Math.sin(a) * 1.3);
    const scar = sstep(0.3, 0.55, n) * (0.5 + 0.5 * sstep(0.1, 0.3, t));
    const base = mixc(PAL.aspenBarkLow, PAL.aspenBark, sstep(0.02, 0.2, t));
    return mixc(base, PAL.barkDark, scar * 0.7);
  };
  const crownC = [lean[0] * 0.8, H * 0.67, lean[2] * 0.8];
  const cr = [2.9, 5.8, 2.9];
  const limbs = [];
  const nL = 6;
  for (let i = 0; i < nL; i++) {
    const t = 0.42 + 0.4 * (i / (nL - 1)) + (rng() - 0.5) * 0.05;
    const s0 = at(t);
    const a = i * 2.39996 + rng() * 0.5;
    const len = (2.0 + 2.6 * (1 - Math.abs(t - 0.6) * 2)) * (0.8 + 0.4 * rng());
    const e = [s0[0] + Math.cos(a) * len, s0[1] + len * (0.9 + 0.5 * rng()), s0[2] + Math.sin(a) * len];
    const path = bezier(s0, [s0[0] + Math.cos(a) * len * 0.4, s0[1] + len * 0.3, s0[2] + Math.sin(a) * len * 0.4], [e[0], e[1] - 0.6, e[2]], e, 4);
    limbs.push({ e, a, path });
  }
  // leaf clusters: one on each limb end, the rest filling the ovoid, a tuft on the leader
  const clusters = limbs.map((L) => ({ c: L.e, r: 1.5 + rng() * 0.6 }));
  for (let i = 0; i < 12; i++) {
    const u = rng() * 1.8 - 0.8, th = rng() * TAU, rr = Math.cbrt(0.3 + 0.7 * rng()) * 0.78;
    const sq = Math.sqrt(1 - u * u);
    clusters.push({ c: [crownC[0] + cr[0] * rr * sq * Math.cos(th), crownC[1] + cr[1] * rr * u * 0.85 + 0.4, crownC[2] + cr[2] * rr * sq * Math.sin(th)], r: 1.3 + rng() * 0.8 });
  }
  clusters.push({ c: [crownC[0] + lean[0] * 0.2, H * 0.96, crownC[2] + lean[2] * 0.2], r: 1.25 });
  const leafCol = (p, gn, ly) => mixc(mulc(PAL.aspenLeaf, 0.72), PAL.aspenLeafTip, clamp01(0.4 + 0.35 * ly + 0.3 * ((p[1] - crownC[1]) / cr[1])));
  const leafAo = (p) => {
    const d = Math.hypot((p[0] - crownC[0]) / cr[0], (p[1] - crownC[1]) / cr[1], (p[2] - crownC[2]) / cr[2]);
    return (0.42 + 0.58 * clamp01(d)) * (0.72 + 0.28 * sstep(crownC[1] - cr[1], crownC[1] + cr[1], p[1]));
  };
  const trunkR = (t) => 0.3 * (1 - 0.8 * t) + 0.03 + (t < 0.04 ? 0.12 * (1 - t / 0.04) : 0);
  // LOD0
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, trunk, { sides: 7, radius: trunkR, color: barkCol, ao: (t) => 0.55 + 0.45 * sstep(0, 0.4, t) });
    for (const L of limbs) tube(g, L.path, { sides: 4, radius: (t) => 0.11 * (1 - t) + 0.025, color: (t, a) => barkCol(0.7, a), ao: () => 0.7 });
    let seed = 50;
    clusters.forEach((c, i) => {
      g.part(i < limbs.length ? PART.RIGID : PART.PART, c.c[1], rng());
      blob(g, c.c, [c.r, c.r * 0.85, c.r], 1, N, { seed: seed++, amp: 0.4, freq: 2.6, color: leafCol, ao: leafAo, crown: crownC, flutter: 0.35, soft: 0.6, under: 0.8 });
    });
    lods.push(g.swayByHeight(H, 1.6).build());
  }
  // LOD1: five big lobes
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [trunk[0], trunk[3], trunk[6], trunk[10]], { sides: 4, radius: trunkR, color: (t) => barkCol(t, 0.5), ao: () => 0.7 });
    const lobes = [[0, -0.35, 0, 1.0], [0.9, 0.15, 0.5, 0.8], [-0.8, 0.2, -0.4, 0.8], [0.2, 0.55, -0.7, 0.72], [-0.3, 0.75, 0.5, 0.62]];
    let seed = 80;
    lobes.forEach(([dx, dy, dz, k], i) => {
      g.part(i === 0 ? PART.RIGID : PART.PART, crownC[1] + dy * cr[1], rng());
      blob(g, [crownC[0] + dx * cr[0] * 0.55, crownC[1] + dy * cr[1], crownC[2] + dz * cr[2] * 0.55], [cr[0] * 0.72 * k, cr[1] * 0.55 * k, cr[2] * 0.72 * k], 0, N, { seed: seed++, amp: 0.25, freq: 1.5, color: leafCol, ao: leafAo, crown: crownC, flutter: 0.2, soft: 0.65, under: 0.8 });
    });
    lods.push(g.swayByHeight(H, 1.6).build());
  }
  // LOD2: two lobes on a stick
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, [trunk[0], trunk[6]], { sides: 3, radius: () => 0.25, color: () => PAL.aspenBark, ao: () => 0.7 });
    blob(g, [crownC[0], crownC[1] - 0.8, crownC[2]], [cr[0] * 0.95, cr[1] * 0.62, cr[2] * 0.95], 0, N, { seed: 90, amp: 0.15, freq: 1, color: leafCol, ao: leafAo, crown: crownC, flutter: 0, soft: 0.75, under: 0.8 });
    blob(g, [crownC[0] + 0.3, crownC[1] + cr[1] * 0.55, crownC[2] - 0.2], [cr[0] * 0.62, cr[1] * 0.45, cr[2] * 0.62], 0, N, { seed: 91, amp: 0.15, freq: 1, color: leafCol, ao: leafAo, crown: crownC, flutter: 0, soft: 0.75 });
    lods.push(g.swayByHeight(H, 1.6).build());
  }
  return { lods, H, R: 4, trunkR: 0.3 };
}

/** Ghost tree, H = 16 m: pale leaning trunk, arching limbs, long curtains of hair-like strands. */
export function ghostTree(N, rng) {
  const H = 16;
  const lods = [];
  // the trunk leans toward +x (instances are yawed so +x points at the water)
  const trunk = bezier([0, -1.5, 0], [0.4, 4, 0], [1.6, 7.5, 0.3], [2.6, 9.6, 0.2], 8);
  const top = trunk[trunk.length - 1];
  const limbs = [];
  const nL = 6;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * TAU + rng() * 0.6 + 0.3;
    const reach = 5 + rng() * 3.5;
    const up = 2.4 + rng() * 2.2;
    const end = [top[0] + Math.cos(a) * reach, top[1] + up * 0.2, top[2] + Math.sin(a) * reach];
    const c1 = [top[0] + Math.cos(a) * reach * 0.25, top[1] + up, top[2] + Math.sin(a) * reach * 0.25];
    const c2 = [top[0] + Math.cos(a) * reach * 0.75, top[1] + up * 1.05, top[2] + Math.sin(a) * reach * 0.75];
    limbs.push({ a, path: bezier(top, c1, c2, end, 8) });
  }
  const barkC = (t) => mixc(PAL.ghostBarkDark, PAL.ghostBark, sstep(0.0, 0.35, t));
  const hairTop = PAL.ghostHair;
  const hairTip = PAL.ghostHairTip;
  const cen = [top[0], top[1] + 2.5, top[2]];
  const onLimb = (t) => {
    const L = limbs[Math.floor(rng() * limbs.length)];
    const f = t * (L.path.length - 1);
    const k = Math.min(L.path.length - 2, Math.floor(f));
    const fr = f - k;
    const p0 = L.path[k], p1 = L.path[k + 1];
    return [p0[0] + (p1[0] - p0[0]) * fr, p0[1] + (p1[1] - p0[1]) * fr, p0[2] + (p1[2] - p0[2]) * fr];
  };
  const hang = (g, count, width, segs, minL, maxL) => {
    for (let i = 0; i < count; i++) {
      const t = 0.12 + 0.88 * rng();
      const q = onLimb(t);
      const p = [q[0] + (rng() - 0.5) * 0.9, q[1] + 0.1, q[2] + (rng() - 0.5) * 0.9];
      const out = norm3([p[0] - top[0] + (rng() - 0.5) * 2, 0, p[2] - top[2] + (rng() - 0.5) * 2]);
      const len = Math.min(p[1] - 0.6, minL + (maxL - minL) * Math.pow(rng(), 0.8));
      g.part(PART.PART, p[1], rng());
      strand(g, p, len, width * (0.8 + 0.4 * rng()), segs, out, {
        colTop: mixc(hairTop, PAL.ghostBarkDark, 0.2),
        colTip: mixc(hairTip, hairTop, rng() * 0.5),
        aoTop: 0.5 + 0.2 * t,
        aoTip: 1,
        flutter: 1,
        curl: 0.06 + 0.1 * rng(),
        twist: (rng() - 0.5) * 1.2,
      });
    }
  };
  // a mop of shorter strands over the arches: hides the limbs and gives the crown a soft top
  const cap = (g, count, width, segs) => {
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * 6.5;
      const y = cen[1] + 1.2 * (1 - (r / 6.5) ** 2) + rng() * 0.6;
      const p = [cen[0] + Math.cos(a) * r, y, cen[2] + Math.sin(a) * r];
      g.part(PART.PART, y, rng());
      strand(g, p, 1.6 + rng() * 2.6 + r * 0.25, width, segs, norm3([Math.cos(a), 0, Math.sin(a)]), { colTop: mixc(hairTop, hairTip, 0.35), colTip: hairTip, aoTop: 0.85, aoTip: 1, flutter: 0.8, curl: 0.35 });
    }
  };
  // LOD0
  {
    const g = new VegGeo();
    tube(g, trunk, { sides: 8, radius: (t) => 0.62 * (1 - 0.5 * t) + (t < 0.08 ? 0.35 * (1 - t / 0.08) : 0), color: barkC, ao: (t) => 0.55 + 0.45 * t, shape: (t, a) => 1 + 0.1 * Math.sin(a * 3 + t * 12) });
    for (const L of limbs) tube(g, L.path, { sides: 5, radius: (t) => 0.24 * (1 - t) + 0.04, color: () => PAL.ghostBark, ao: () => 0.8 });
    hang(g, 220, 0.3, 4, 3.0, 11);
    cap(g, 70, 0.5, 2);
    lods.push(g.swayByHeight(H, 1.5).build());
  }
  // LOD1
  {
    const g = new VegGeo();
    tube(g, [trunk[0], trunk[3], trunk[6], top], { sides: 5, radius: (t) => 0.62 * (1 - 0.5 * t), color: barkC, ao: () => 0.7 });
    hang(g, 70, 1.0, 2, 4, 10);
    cap(g, 22, 1.3, 1);
    lods.push(g.swayByHeight(H, 1.5).build());
  }
  // LOD2: a weeping bell whose hem hangs in uneven curtains (long / short alternate)
  {
    const g = new VegGeo();
    tube(g, [trunk[0], top], { sides: 3, radius: () => 0.5, color: barkC, ao: () => 0.7 });
    const S = 10;
    const cx = top[0] * 0.8, cz = top[2];
    const rows = [
      () => [0.4, H * 0.97, mulc(hairTop, 0.7), 0.8],
      (k) => [4.6 + (k % 3) * 0.3, H * 0.87, mulc(hairTop, 0.85), 0.9],
      (k) => [7.3 + (k % 2) * 0.5, H * 0.6, hairTop, 0.8],
      (k) => [k % 2 ? 6.4 : 7.1, k % 2 ? 5.6 : 1.8 + (k % 4) * 0.5, mixc(hairTop, hairTip, 0.45), 0.62],
    ];
    const base = g.count;
    for (const row of rows) {
      for (let k = 0; k < S; k++) {
        const a = (k / S) * TAU;
        const [r, y, c, ao] = row(k);
        g.v([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], norm3([Math.cos(a), 0.4, Math.sin(a)]), c, 1, 0, 0.15, ao);
      }
    }
    for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < S; k++) g.q(base + j * S + k, base + (j + 1) * S + k, base + (j + 1) * S + ((k + 1) % S), base + j * S + ((k + 1) % S));
    lods.push(g.swayByHeight(H, 1.5).build());
  }
  return { lods, H, R: 7, trunkR: 0.62 };
}

/**
 * Ancient giant, H ~ 75 m. Two forms:
 *   'spread'  a colossal cedar: a gnarled, twisting trunk ~14 m thick on buttress fins and snaking
 *             surface roots; six vast limbs leave it at staggered heights (long below, short above)
 *             and fork twice into horizontal tiers of cloud-plates (each plate a cluster of lumps)
 *             — a layered, pagoda-like silhouette; lianas hang from the limbs; one limb long dead
 *   'crown'   a dragon-tree: a pale fluted column that forks and forks again (2 -> 4 -> 8) into a
 *             dense, flat-topped dome of foliage — an umbrella the size of a cathedral
 * Every plate lump is a PART, so the canopy is never a perfect dome.
 */
export function giantTree(N, rng, form = 'spread') {
  const H = 80;
  const spread = form === 'spread';
  const split = spread ? 0.62 : 0.4;
  const baseR = spread ? 7.0 : 5.4;
  const topR = spread ? 2.4 : 3.0;
  const fins = spread ? 7 : 11;
  const finPh = rng() * TAU;
  const barkA = spread ? PAL.giantBark : PAL.paleBark;
  const barkB = spread ? PAL.giantLichen : lin('#d8cfbf');
  const trunkTop = spread ? [2.2, H * split, -1.2] : [1.2, H * split, -0.6];
  const trunkPath = bezier([0, -4, 0], [1.8, H * split * 0.3, 0.9], [trunkTop[0] * 0.1 - 1.2, H * split * 0.72, trunkTop[2] * 0.4 + 1.1], trunkTop, 18);
  // the trunk swells again where the limbs leave it
  const radius = (t) => (spread ? baseR * Math.pow(1 - t, 0.8) + topR * t : baseR * (1 - t) + topR * t + 0.8 * sstep(0.75, 1, t));
  const finShape = (t, a) => {
    const y = t * (H * split + 4) - 4;
    const flare = 1.35 * Math.exp(-Math.max(0, y) / 6.5) + 0.06;
    const tw = a - finPh - y * 0.035;
    const lobe = Math.pow(Math.max(0, Math.cos(tw * fins * 0.5)), 6);
    // gnarl: slow bulges and burls, twisting up the trunk; flutes on the dragon tree
    const gn = 0.13 * N.noise3(Math.cos(tw) * 1.3, y * 0.09, Math.sin(tw) * 1.3) + 0.06 * N.noise3(Math.cos(a) * 3.1, y * 0.3, Math.sin(a) * 3.1);
    const ridge = 0.035 * Math.sin(a * 31 + y * 0.4) + 0.025 * Math.sin(a * 13 - y * 0.2);
    const flute = spread ? 0 : 0.07 * Math.cos(a * 14 + y * 0.05);
    return 1 + flare * lobe * (0.8 + 0.4 * Math.sin(Math.floor((tw / TAU) * fins + 100) * 12.9898)) + gn + ridge + flute;
  };
  const barkCol = (t, a) => {
    const n = 0.5 + 0.5 * N.noise3(Math.cos(a) * 2.2, t * 9, Math.sin(a) * 2.2);
    return mixc(mixc(barkA, PAL.barkDark, 0.35 * (1 - t)), barkB, sstep(0.55, 0.85, n) * 0.8);
  };
  const barkAo = (t) => 0.4 + 0.6 * sstep(0, 0.35, t);

  // ---- skeleton: limbs fork into branches; terminal branches carry foliage plates ----------------
  const limbs = [];
  const plates = []; // { c, r, flat, lumps: [{ c, r }] }
  const norm = (v) => norm3(v);
  const rot = (d, yaw, pitch) => {
    // turn a direction by yaw (around y) and tilt it up/down by pitch
    const h = Math.hypot(d[0], d[2]);
    let az = Math.atan2(d[2], d[0]) + yaw;
    let el = Math.atan2(d[1], h) + pitch;
    el = Math.max(-0.3, Math.min(1.35, el));
    return [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
  };
  const branch = (p0, dir, len, r0, depth, dead = false) => {
    const bend = spread ? -0.12 : 0.1; // cedar limbs level out, dragon-tree limbs keep rising
    const d1 = rot(dir, (rng() - 0.5) * 0.3, bend);
    const e = [p0[0] + (dir[0] * 0.5 + d1[0] * 0.5) * len, p0[1] + (dir[1] * 0.5 + d1[1] * 0.5) * len, p0[2] + (dir[2] * 0.5 + d1[2] * 0.5) * len];
    const c1 = [p0[0] + dir[0] * len * 0.35, p0[1] + dir[1] * len * 0.35, p0[2] + dir[2] * len * 0.35];
    const c2 = [e[0] - d1[0] * len * 0.3 + (rng() - 0.5) * len * 0.1, e[1] - d1[1] * len * 0.3, e[2] - d1[2] * len * 0.3 + (rng() - 0.5) * len * 0.1];
    // a dead limb ends in a splintered snag instead of a cut
    const r1 = dead ? r0 * 0.12 : depth === 0 ? r0 * 0.35 : r0 * 0.55;
    limbs.push({ path: bezier(p0, c1, c2, e, depth >= 2 ? 10 : depth === 1 ? 6 : 4), r0, r1, depth, dead });
    if (dead) return;
    if (depth === 0) {
      // a plate: flat cluster of lumps around the branch tip
      const pr = spread ? 7.5 + rng() * 3 : 7 + rng() * 2.5;
      const c = [e[0], e[1] + (spread ? 1.2 : 1.8), e[2]];
      const lumps = [{ c, r: pr * 0.55 }];
      const n = 4;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng() * 0.8;
        const rr = pr * (0.5 + 0.25 * rng());
        lumps.push({ c: [c[0] + Math.cos(a) * rr, c[1] + (rng() - 0.6) * 1.6, c[2] + Math.sin(a) * rr], r: pr * (0.4 + 0.16 * rng()) });
      }
      plates.push({ c, r: pr, lumps });
      return;
    }
    const kids = spread ? (depth === 2 ? 2 + (rng() < 0.35 ? 1 : 0) : 2 + (rng() < 0.4 ? 1 : 0)) : 2;
    for (let k = 0; k < kids; k++) {
      const yaw = (k - (kids - 1) / 2) * (spread ? 0.75 : 0.9) + (rng() - 0.5) * 0.3;
      const nd = rot(d1, yaw, spread ? (rng() - 0.5) * 0.25 : 0.15 + (rng() - 0.5) * 0.2);
      branch(e, nd, len * (spread ? 0.58 : 0.66), r1, depth - 1);
    }
  };
  const onTrunk = (t) => {
    const f = t * (trunkPath.length - 1);
    const k = Math.min(trunkPath.length - 2, Math.floor(f));
    const r = f - k, a = trunkPath[k], b = trunkPath[k + 1];
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r, a[2] + (b[2] - a[2]) * r];
  };
  if (spread) {
    // tiers: long, nearly level limbs low down, shorter and steeper ones higher up, and a leader
    const nL = 6;
    for (let i = 0; i < nL; i++) {
      const u = i / (nL - 1);
      const p0 = onTrunk(0.5 + 0.44 * u);
      const a = i * 2.39996 + rng() * 0.4;
      const el = 0.28 + 0.3 * u + rng() * 0.1;
      const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      branch(p0, dir, (21 - 8 * u) * (0.9 + 0.2 * rng()), 2.3 - 0.8 * u, 2, i === 1);
    }
    branch(trunkTop, norm([0.12, 1, 0.05]), 15, 1.5, 1);
  } else {
    // three limbs fork twice (2 -> 4 -> 8): the forks show under a wide, low dome
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + (rng() - 0.5) * 0.5;
      const el = 0.72 + rng() * 0.12;
      const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      const p0 = [trunkTop[0] + Math.cos(a) * topR * 0.3, trunkTop[1] - 1.5, trunkTop[2] + Math.sin(a) * topR * 0.3];
      branch(p0, dir, 15 + rng() * 4, 2.5, 2);
    }
  }
  if (!spread) {
    // the dome top: big lumpy plates closing the umbrella
    let top = 0;
    for (const p of plates) top = Math.max(top, p.c[1]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rng();
      const r = 4 + rng() * 9;
      const c = [trunkTop[0] + Math.cos(a) * r, top + 1.5 + rng() * 2, trunkTop[2] + Math.sin(a) * r];
      plates.push({ c, r: 8, lumps: [{ c, r: 5.5 + rng() * 2 }, { c: [c[0] + 3, c[1] - 0.5, c[2] + 2], r: 4.5 }, { c: [c[0] - 2.5, c[1] - 0.3, c[2] - 3], r: 4.5 }] });
    }
  }
  let topY = 0;
  for (const p of plates) for (const l of p.lumps) topY = Math.max(topY, l.c[1] + l.r * 0.6);
  const crownC = [trunkTop[0], (H * split + topY) * 0.5 + 6, trunkTop[2]];
  let crownR = 0;
  for (const p of plates) for (const l of p.lumps) crownR = Math.max(crownR, Math.hypot(l.c[0] - crownC[0], l.c[2] - crownC[2]) + l.r);
  const leafCol = (p, gn, ly) => {
    const n = N.noise3(p[0] * 0.08, p[1] * 0.08, p[2] * 0.08);
    return mixc(mulc(PAL.giantLeaf, 0.8), PAL.giantLeafTip, clamp01(0.25 + 0.5 * ly + 0.35 * n));
  };
  const leafAo = (p, gn, ly) => {
    const rr = Math.hypot(p[0] - crownC[0], p[2] - crownC[2]) / crownR;
    return (0.45 + 0.55 * clamp01(0.5 + 0.5 * ly)) * (0.65 + 0.35 * clamp01(rr * 1.2)) * (0.75 + 0.25 * sstep(crownC[1] - 20, topY, p[1]));
  };
  const deadCol = () => mixc(PAL.deadWood, barkB, 0.3);

  // snaking surface roots from the buttress fins
  const roots = [];
  for (let i = 0; i < fins; i++) {
    const aa = finPh + ((i + 0.5) / fins) * TAU;
    const r0 = baseR * 1.9;
    const len = (spread ? 14 : 9) + rng() * (spread ? 16 : 10);
    const pts = [];
    for (let k = 0; k <= 7; k++) {
      const t = k / 7;
      const rr = r0 * 0.6 + len * t;
      const wob = Math.sin(t * 5 + i) * 1.8 * t;
      pts.push([Math.cos(aa) * rr - Math.sin(aa) * wob, 1.2 * (1 - t) - 0.7 * t + 0.35 * Math.sin(t * 7 + i), Math.sin(aa) * rr + Math.cos(aa) * wob]);
    }
    roots.push(pts);
  }
  const lods = [];

  const hangers = (g, count, segs, width) => {
    const live = limbs.filter((L) => !L.dead && L.depth >= 1);
    for (let i = 0; i < count; i++) {
      const L = live[Math.floor(rng() * live.length)];
      const t = 0.35 + 0.6 * rng();
      const k = Math.min(L.path.length - 1, Math.round(t * (L.path.length - 1)));
      const p = L.path[k];
      const out = norm([p[0] - trunkTop[0] + 0.01, 0, p[2] - trunkTop[2]]);
      const len = 4 + rng() * (spread ? 16 : 9);
      g.part(PART.PART, p[1], rng());
      strand(g, [p[0], p[1] - 0.5, p[2]], len, width, segs, out, { colTop: mulc(PAL.giantMoss, 0.8), colTip: mixc(PAL.giantMoss, PAL.ghostHairTip, 0.35), aoTop: 0.45, aoTip: 0.9, flutter: 0.8, curl: 0.04 });
    }
    g.part();
  };
  const limbTubes = (g, maxDepth, sidesFor, every) => {
    for (const L of limbs) {
      if (L.depth < maxDepth) continue;
      const lp = every > 1 ? L.path.filter((_, i) => i % every === 0 || i === L.path.length - 1) : L.path;
      tube(g, lp, {
        sides: sidesFor(L),
        radius: (t) => L.r0 * (1 - t) + L.r1 * t,
        color: L.dead ? deadCol : (t, a) => barkCol(0.5 + 0.5 * t, a),
        ao: (t) => 0.55 + 0.35 * t,
        shape: L.depth >= 2 ? (t, a) => 1 + 0.07 * Math.sin(a * 5 + t * 20) + 0.05 * Math.sin(a * 3 - t * 11) : null,
      });
    }
  };

  // LOD0
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    tube(g, trunkPath, { sides: 56, radius, shape: finShape, color: barkCol, ao: barkAo });
    for (const pts of roots) tube(g, pts, { sides: 7, radius: (t) => (spread ? 1.8 : 1.3) * (1 - t) + 0.25, color: (t) => mixc(barkA, PAL.barkDark, 0.3 + 0.3 * t), ao: (t) => 0.5 + 0.2 * t });
    limbTubes(g, 0, (L) => (L.depth === 2 ? 12 : L.depth === 1 ? 7 : 5), 1);
    let seed = 1;
    for (const p of plates) {
      p.lumps.forEach((l, i) => {
        // the plate's main lump is finer (it carries the silhouette up close); soft normals keep the
        // lumps from reading as faceted rocks
        g.part(i === 0 ? PART.RIGID : PART.PART, l.c[1], rng());
        blob(g, l.c, [l.r, l.r * (spread ? 0.6 : 0.7), l.r], i === 0 ? 2 : 1, N, { seed: seed++, amp: 0.42, freq: 2.3, color: leafCol, ao: leafAo, crown: crownC, flatTop: spread ? 0.4 : 0.5, under: 0.5, flutter: 0.15, soft: 0.78 });
      });
    }
    g.part();
    hangers(g, spread ? 110 : 45, 3, 0.45);
    lods.push(g.swayByHeight(H, 2.2, 10).build());
  }
  // LOD1: one squashed lump per plate, limbs down to the second order
  {
    const g = new VegGeo();
    g.part(PART.RIGID);
    const tp = trunkPath.filter((_, i) => i % 2 === 0);
    tube(g, tp, { sides: 22, radius, shape: finShape, color: barkCol, ao: barkAo });
    for (const pts of roots.filter((_, i) => i % 2 === 0)) tube(g, [pts[0], pts[3], pts[7]], { sides: 4, radius: (t) => (spread ? 1.8 : 1.3) * (1 - t) + 0.3, color: () => mixc(barkA, PAL.barkDark, 0.4), ao: () => 0.55 });
    limbTubes(g, 1, (L) => (L.depth === 2 ? 6 : 4), 2);
    let seed = 1;
    for (const p of plates) {
      g.part(PART.PART, p.c[1], rng());
      blob(g, p.c, [p.r * 1.1, p.r * (spread ? 0.5 : 0.6), p.r * 1.1], 1, N, { seed: seed++, amp: 0.3, freq: 1.3, color: leafCol, ao: leafAo, crown: crownC, flatTop: 0.45, under: 0.4, flutter: 0.1, soft: 0.6 });
    }
    g.part();
    hangers(g, 25, 1, 1.0);
    lods.push(g.swayByHeight(H, 2.2, 10).build());
  }
  // LOD2: trunk, primary limbs, a handful of merged plate clouds
  {
    const g = new VegGeo();
    tube(g, [trunkPath[0], trunkPath[6], trunkPath[12], trunkTop], { sides: 8, radius: (t) => radius(t) * (t < 0.1 ? 1.4 : 1.05), color: (t) => barkCol(t, 0), ao: () => 0.6 });
    for (const L of limbs.filter((l) => l.depth === 2)) tube(g, [L.path[0], L.path[5], L.path[10]], { sides: 3, radius: () => L.r0 * 0.75, color: () => (L.dead ? deadCol() : barkA), ao: () => 0.6 });
    // cluster the plates into ~8 clouds
    const groups = [];
    for (const p of plates) {
      let best = null, bd = 1e9;
      for (const q of groups) {
        const d = Math.hypot(q.c[0] - p.c[0], (q.c[1] - p.c[1]) * 2, q.c[2] - p.c[2]);
        if (d < bd) { bd = d; best = q; }
      }
      if (best && bd < (spread ? 16 : 14)) {
        best.n++;
        for (let k = 0; k < 3; k++) best.c[k] += (p.c[k] - best.c[k]) / best.n;
        best.r = Math.max(best.r, p.r + bd * 0.5);
      } else groups.push({ c: [...p.c], r: p.r, n: 1 });
    }
    let seed = 1;
    for (const q of groups) blob(g, q.c, [q.r * 1.15, q.r * (spread ? 0.45 : 0.55), q.r * 1.15], 0, N, { seed: seed++, amp: 0.15, freq: 1, color: leafCol, ao: leafAo, crown: crownC, flatTop: 0.5, under: 0.45, flutter: 0, soft: 0.7 });
    lods.push(g.swayByHeight(H, 2.2, 10).build());
  }
  return { lods, H: topY, R: crownR, trunkR: baseR, form };
}

/**
 * Fallen log, ~18 m: a windthrown spire lying along +x — the torn-up root plate standing on edge at
 * the foot (earth and root stubs), snapped branch stubs, moss on the upper side, a splintered top.
 * They lie in the forest's clearings, where the trees went down.
 */
export function fallenLog(N, rng) {
  const lods = [];
  const L = 18;
  const x0 = -L * 0.45;
  const r0 = 0.72;
  const path = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    path.push([x0 + L * t, r0 * (1 - 0.45 * t) - 0.12 + 0.15 * Math.sin(t * 3.1), 0.25 * Math.sin(t * 2.3)]);
  }
  const R = (t) => r0 * (1 - 0.5 * t);
  // splintered top: the last ring is ragged
  const shape = (t, a) => (t > 0.99 ? 0.55 + 0.6 * Math.abs(Math.sin(a * 3.7 + 1.3)) : 1 + 0.06 * Math.sin(a * 7 + t * 20));
  // tube frames here put world-up at angle 3pi/2: moss grows where the log faces the sky
  const col = (t, a) => {
    const up = clamp01(-Math.sin(a) * 1.4 - 0.2);
    const n = 0.5 + 0.5 * N.noise3(Math.cos(a) * 2, t * 12, Math.sin(a) * 2);
    return mixc(mixc(PAL.deadWood, PAL.bark, 0.5 * n), PAL.moss, up * (0.55 + 0.45 * n));
  };
  const ao = (t, a) => 0.45 + 0.4 * clamp01(-Math.sin(a) + 0.3);
  const plate = (g, detail) => {
    // the root plate: a thick disc of earth and roots, on edge, taller than a person
    blob(g, [x0 - 0.5, 1.35, 0], [0.75, 2.4, 2.6], detail, N, { seed: 5, amp: 0.3, freq: 1.4, color: (p, gn) => mixc(PAL.soil, PAL.barkDark, clamp01(0.5 + 0.5 * gn[0])), ao: (p) => 0.5 + 0.5 * clamp01((p[1] + 0.5) / 3.5), leaf: 0, flutter: 0, soft: 0.2, under: 1 });
  };
  // LOD0
  {
    const g = new VegGeo();
    tube(g, path, { sides: 9, radius: R, shape, color: col, ao });
    plate(g, 1);
    // root stubs radiating from the plate
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rng() * 0.4;
      const len = 0.8 + rng() * 1.6;
      const c = [x0 - 0.9, 1.35 + Math.sin(a) * 1.9, Math.cos(a) * 2.1];
      tube(g, [c, [c[0] - len * 0.4, c[1] + Math.sin(a) * len * 0.8, c[2] + Math.cos(a) * len * 0.8]], { sides: 3, radius: (t) => 0.14 * (1 - t) + 0.03, color: () => PAL.barkDark, ao: () => 0.6 });
    }
    // snapped branch stubs, mostly on the upper side
    for (let i = 0; i < 10; i++) {
      const t = 0.15 + 0.8 * rng();
      const k = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
      const p = path[k];
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.4;
      const d = [0.25, -Math.sin(a) * 0 + Math.cos(a) * 0 + 0.9 * Math.abs(Math.cos(a)) + 0.1, Math.sin(a)];
      const len = 0.6 + rng() * 1.8;
      const r = R(t);
      tube(g, [[p[0], p[1] + d[1] * r * 0.6, p[2] + d[2] * r * 0.6], [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len]], { sides: 3, radius: (tt) => 0.09 * (1 - tt) + 0.02, color: () => PAL.deadWood, ao: () => 0.7 });
    }
    lods.push(g.build());
  }
  // LOD1
  {
    const g = new VegGeo();
    tube(g, [path[0], path[4], path[8]], { sides: 5, radius: R, color: col, ao });
    plate(g, 0);
    lods.push(g.build());
  }
  return { lods, H: 4, R: L * 0.55, trunkR: r0 };
}

/** Shrub: a clump of lumpy lobes, ~2.4 m wide at scale 1. */
export function shrub(N, rng) {
  const lods = [];
  const lobes = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.8;
    const r = i === 0 ? 0 : 0.7 + rng() * 0.5;
    const s = i === 0 ? 1.15 : 0.7 + rng() * 0.35;
    lobes.push({ c: [Math.cos(a) * r, 0.5 + s * 0.45 + (i === 0 ? 0.25 : 0), Math.sin(a) * r], r: [s * 0.95, s * 0.8, s * 0.95] });
  }
  const crown = [0, 0.4, 0];
  const col = (p, gn, ly) => mixc(PAL.shrub, PAL.shrubTip, clamp01(0.35 + 0.4 * ly + 0.25 * gn[1]));
  const ao = (p) => 0.35 + 0.65 * clamp01((p[1] + 0.1) / 1.6) * (0.7 + 0.3 * clamp01(Math.hypot(p[0], p[2]) / 1.2));
  {
    const g = new VegGeo();
    let seed = 30;
    lobes.forEach((l, i) => {
      g.part(i === 0 ? PART.RIGID : PART.PART, l.c[1], rng());
      blob(g, l.c, l.r, 1, N, { seed: seed++, amp: 0.35, freq: 2.2, color: col, ao, crown, flutter: 0.12, soft: 0.6 });
    });
    lods.push(g.swayByHeight(2.2, 1.5).build());
  }
  {
    const g = new VegGeo();
    blob(g, [0, 0.75, 0], [1.25, 0.95, 1.25], 0, N, { seed: 30, amp: 0.25, freq: 1.6, color: col, ao, crown, flutter: 0, soft: 0.7 });
    lods.push(g.swayByHeight(2.2, 1.5).build());
  }
  return { lods, H: 2.0, R: 1.3, trunkR: 0 };
}

/** Reed clump at the waterline: ~20 thin leaves + a few cattail heads, ~2 m tall. */
export function reeds(N, rng) {
  const lods = [];
  {
    const g = new VegGeo();
    for (let i = 0; i < 20; i++) {
      const a = rng() * TAU;
      const r = rng() * 0.45;
      const h = 1.2 + rng() * 1.3;
      blade(g, [Math.cos(a) * r, -0.3, Math.sin(a) * r], a + (rng() - 0.5), h, 0.07 + rng() * 0.04, 0.25 + rng() * 0.55, 3, { colBase: mulc(PAL.reed, 0.7), colTip: PAL.reedTip, aoBase: 0.45, flutter: 0.6, upN: 0.45 });
    }
    for (let i = 0; i < 4; i++) {
      const a = rng() * TAU;
      const r = rng() * 0.3;
      const h = 1.7 + rng() * 0.8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      tube(g, [[x, -0.3, z], [x + 0.05, h * 0.7, z], [x + 0.1, h, z]], { sides: 3, radius: () => 0.012, color: () => PAL.reed, ao: () => 0.7 });
      tube(g, [[x + 0.1, h - 0.05, z], [x + 0.1, h + 0.25, z], [x + 0.11, h + 0.3, z]], { sides: 5, radius: (t) => (t < 0.85 ? 0.045 : 0.02), color: () => PAL.cattail, ao: () => 0.9, cap: true });
    }
    lods.push(g.swayByHeight(2.4, 1.4, -0.3).build());
  }
  {
    const g = new VegGeo();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI;
      blade(g, [0, -0.3, 0], a, 2.1, 0.9, 0.5, 1, { colBase: mulc(PAL.reed, 0.8), colTip: PAL.reedTip, aoBase: 0.5, flutter: 0.4, upN: 0.5 });
    }
    lods.push(g.swayByHeight(2.4, 1.4, -0.3).build());
  }
  return { lods, H: 2.4, R: 0.8, trunkR: 0 };
}

/** Grass tuft ~0.55 m: 7 bending blades. White vertex colour: the grass tint comes per instance. */
export function grassTuft(N, rng) {
  const g = new VegGeo();
  const nb = 8;
  const dark = [0.55, 0.62, 0.5];
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rng() * 0.7;
    const r = rng() * 0.12;
    const h = 0.35 + rng() * 0.35;
    g.part(i < 3 ? PART.RIGID : PART.PART, 0, rng());
    blade(g, [Math.cos(a) * r, -0.05, Math.sin(a) * r], a, h, 0.07 + rng() * 0.03, 0.12 + rng() * 0.22, 2, { colBase: dark, colTip: [1.05, 1.02, 0.95], aoBase: 0.5, flutter: 1, upN: 0.8 });
  }
  // two seed stalks standing above the tuft: they catch the low sun
  for (let i = 0; i < 2; i++) {
    const a = rng() * TAU;
    g.part(PART.PART, 0, rng());
    blade(g, [Math.cos(a) * 0.05, -0.05, Math.sin(a) * 0.05], a, 0.75 + rng() * 0.3, 0.025, 0.08 + rng() * 0.12, 3, { colBase: dark, colTip: [1.2, 1.1, 0.8], tipCol: [1.5, 1.3, 0.85], aoBase: 0.55, flutter: 1.2, upN: 0.7 });
  }
  return g.swayByHeight(0.9, 1.3).build();
}

/** A few wildflowers on thin stems; heads carry a white vertex colour (tinted per instance). */
export function flowers(N, rng) {
  const g = new VegGeo();
  const stem = lin('#4c5e2c');
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    const r = rng() * 0.2;
    const h = 0.3 + rng() * 0.35;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.part(i === 0 ? PART.RIGID : PART.PART, 0, rng());
    blade(g, [x, -0.03, z], a, h, 0.025, 0.05, 1, { colBase: stem, colTip: stem, aoBase: 0.6, flutter: 0.6, upN: 0.6, leaf: 0 });
    // head: a 5-petal star, tilted a little
    const cx = x + Math.cos(a) * 0.05, cy = h, cz = z + Math.sin(a) * 0.05;
    const hr = 0.055 + rng() * 0.045;
    const up = [0, 1, 0];
    const c = g.v([cx, cy + 0.01, cz], up, [0.95, 0.85, 0.45], 1, 1, 0.6, 1);
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const aa = (k / 10) * TAU;
      const rr = k % 2 === 0 ? hr : hr * 0.35;
      pts.push(g.v([cx + Math.cos(aa) * rr, cy - rr * 0.25, cz + Math.sin(aa) * rr], up, [1, 1, 1], 1, 1, 0.6, 1));
    }
    for (let k = 0; k < 10; k++) g.t(c, pts[(k + 1) % 10], pts[k]);
  }
  return g.swayByHeight(0.7, 1.2).build();
}

/** Fern: arching serrated fronds from a crown, ~0.9 m. */
export function fern(N, rng) {
  const g = new VegGeo();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.5;
    const L = 0.8 + rng() * 0.35;
    g.part(i < 3 ? PART.RIGID : PART.PART, 0, rng());
    frond(g, [0, 0.05, 0], a, L, 0.16, -0.05, 5, { base: PAL.fern, tip: PAL.fernTip, aoIn: 0.4, aoOut: 1, flutter: 0.7, lift: 0.55, curl: -0.1, roof: 0.2, serr: 0.65, crown: [0, -0.3, 0] });
  }
  return g.swayByHeight(0.9, 1.2).build();
}
