// Geometry generators for the natural rock formations (boulders, pillars, arches, basalt columns).
//
// Everything writes into a MeshWriter: growable typed arrays that become ONE indexed BufferGeometry
// (position / normal / uv / color — the same layout GeometryBuilder produces, so library materials
// and their vertex-colour tint work). One writer per region x material = one draw call.
//
// Shapes are built from world-space noise, so two copies of the same recipe never look alike.

import * as THREE from 'crownfall-world-three';
import { worldNoise, createRng } from '../core/noise.js';

const { noise3 } = worldNoise;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// MeshWriter
// ---------------------------------------------------------------------------

export class MeshWriter {
  constructor(capVerts = 4096, detail = 1) {
    /** tessellation factor for procedural shapes written into this writer (quality scaling) */
    this.detail = detail;
    this.pos = new Float32Array(capVerts * 3);
    this.col = new Float32Array(capVerts * 3);
    this.idx = new Uint32Array(capVerts * 6);
    this.nv = 0;
    this.ni = 0;
  }

  _growV(min) {
    let cap = this.pos.length;
    while (cap < min) cap *= 2;
    const p = new Float32Array(cap);
    p.set(this.pos);
    this.pos = p;
    const c = new Float32Array(cap);
    c.set(this.col);
    this.col = c;
  }

  _growI(min) {
    let cap = this.idx.length;
    while (cap < min) cap *= 2;
    const n = new Uint32Array(cap);
    n.set(this.idx);
    this.idx = n;
  }

  /** Add a vertex with an rgb tint; returns its index. */
  v(x, y, z, r = 1, g = 1, b = 1) {
    const o = this.nv * 3;
    if (o + 3 > this.pos.length) this._growV(o + 3);
    const p = this.pos;
    const c = this.col;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
    return this.nv++;
  }

  t(a, b, c) {
    const o = this.ni;
    if (o + 3 > this.idx.length) this._growI(o + 3);
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.ni += 3;
  }

  q(a, b, c, d) {
    this.t(a, b, c);
    this.t(a, c, d);
  }

  /** Append an indexed geometry transformed by a Matrix4, tinted by (r,g,b). */
  append(geo, m, r = 1, g = 1, b = 1) {
    const src = geo.attributes.position.array;
    const e = m.elements;
    const base = this.nv;
    const n = src.length / 3;
    if ((base + n) * 3 > this.pos.length) this._growV((base + n) * 3);
    const p = this.pos;
    const c = this.col;
    const gc = geo.attributes.color ? geo.attributes.color.array : null;
    for (let i = 0; i < n; i++) {
      const x = src[i * 3];
      const y = src[i * 3 + 1];
      const z = src[i * 3 + 2];
      const o = (base + i) * 3;
      p[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (gc) {
        c[o] = gc[i * 3] * r;
        c[o + 1] = gc[i * 3 + 1] * g;
        c[o + 2] = gc[i * 3 + 2] * b;
      } else {
        c[o] = r;
        c[o + 1] = g;
        c[o + 2] = b;
      }
    }
    this.nv += n;
    const ix = geo.index.array;
    if (this.ni + ix.length > this.idx.length) this._growI(this.ni + ix.length);
    for (let i = 0; i < ix.length; i++) this.idx[this.ni + i] = ix[i] + base;
    this.ni += ix.length;
  }

  get triangles() {
    return this.ni / 3;
  }

  /** Lowest y of vertices [from, to). */
  minY(from = 0, to = this.nv) {
    let m = Infinity;
    for (let i = from; i < to; i++) m = Math.min(m, this.pos[i * 3 + 1]);
    return m;
  }

  /** Build the BufferGeometry (smooth normals where vertices are shared, flat where split). */
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.nv * 2), 2));
    const idx = this.nv > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('normal', new THREE.BufferAttribute(computeNormals(this.pos, this.idx, this.nv, this.ni), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Area-weighted smooth vertex normals from typed arrays (much faster than computeVertexNormals). */
export function computeNormals(pos, idx, nv, ni) {
  const nrm = new Float32Array(nv * 3);
  for (let i = 0; i < ni; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const ux = pos[b] - ax, uy = pos[b + 1] - ay, uz = pos[b + 2] - az;
    const vx = pos[c] - ax, vy = pos[c + 1] - ay, vz = pos[c + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let i = 0; i < nv * 3; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l;
    nrm[i + 1] /= l;
    nrm[i + 2] /= l;
  }
  return nrm;
}

// ---------------------------------------------------------------------------
// Indexed unit icosphere (cached per detail). three's IcosahedronGeometry is non-indexed and
// mergeVertices is slow (string keys); here shared vertices are deduplicated with numeric keys.
// ---------------------------------------------------------------------------

const _sphereCache = new Map();

function unitIcosphere(detail) {
  let c = _sphereCache.get(detail);
  if (c) return c;
  const src = new THREE.IcosahedronGeometry(1, detail).attributes.position.array;
  const nIn = src.length / 3;
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(nIn);
  const Q = 20000;
  for (let i = 0; i < nIn; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const key = (Math.round(x * Q) + Q) * 1.6e9 + (Math.round(y * Q) + Q) * 40001 + (Math.round(z * Q) + Q);
    let v = map.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      pos.push(x, y, z);
      map.set(key, v);
    }
    idx[i] = v;
  }
  c = { pos: new Float32Array(pos), idx: pos.length / 3 > 65535 ? idx : Uint16Array.from(idx) };
  _sphereCache.set(detail, c);
  return c;
}

// ---------------------------------------------------------------------------
// Grid / fan emission with automatic winding (outward = away from ring centre)
// ---------------------------------------------------------------------------

/**
 * Stitch `rings` rings of `segs` vertices (consecutive, starting at `base`) into a closed tube.
 * Winding is decided once from the middle ring so faces point away from the ring centre.
 */
function stitchTube(w, base, rings, segs) {
  const P = w.pos;
  const i = Math.max(0, Math.min(rings - 2, rings >> 1));
  const a = base + i * segs;
  const b = a + 1;
  const d = a + segs;
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < segs; j++) {
    cx += P[(a + j) * 3];
    cy += P[(a + j) * 3 + 1];
    cz += P[(a + j) * 3 + 2];
  }
  cx /= segs;
  cy /= segs;
  cz /= segs;
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const ux = P[d * 3] - ax, uy = P[d * 3 + 1] - ay, uz = P[d * 3 + 2] - az;
  const vx = P[b * 3] - ax, vy = P[b * 3 + 1] - ay, vz = P[b * 3 + 2] - az;
  // n = u x v  (order a, d, b)
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const outward = nx * (ax - cx) + ny * (ay - cy) + nz * (az - cz) > 0;
  for (let r = 0; r < rings - 1; r++) {
    const r0 = base + r * segs;
    const r1 = r0 + segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      if (outward) w.q(r0 + j, r1 + j, r1 + j1, r0 + j1);
      else w.q(r0 + j, r0 + j1, r1 + j1, r1 + j);
    }
  }
}

/** Close a ring (at `start`, `segs` verts) with a fan to vertex `apex`, facing along (apex - ring centre). */
function fanCap(w, start, segs, apex) {
  const P = w.pos;
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < segs; j++) {
    cx += P[(start + j) * 3];
    cy += P[(start + j) * 3 + 1];
    cz += P[(start + j) * 3 + 2];
  }
  cx /= segs;
  cy /= segs;
  cz /= segs;
  const dx = P[apex * 3] - cx, dy = P[apex * 3 + 1] - cy, dz = P[apex * 3 + 2] - cz;
  const a = start, b = start + 1;
  const ux = P[b * 3] - P[apex * 3], uy = P[b * 3 + 1] - P[apex * 3 + 1], uz = P[b * 3 + 2] - P[apex * 3 + 2];
  const vx = P[a * 3] - P[apex * 3], vy = P[a * 3 + 1] - P[apex * 3 + 1], vz = P[a * 3 + 2] - P[apex * 3 + 2];
  // normal of (apex, b, a) = u x v
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const ok = nx * dx + ny * dy + nz * dz > 0;
  for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    if (ok) w.t(apex, start + j1, start + j);
    else w.t(apex, start + j, start + j1);
  }
}

// ---------------------------------------------------------------------------
// Boulders: noise-displaced icospheres with planar fracture cuts
// ---------------------------------------------------------------------------

/**
 * A rock "recipe" independent of tessellation, so LOD levels share one silhouette.
 * kinds: round (glacial, soft), block (angular, fractured), slab (tabular), shard (tall, split)
 */
export function rockShape(seed, kind = 'block') {
  const r = createRng(seed);
  const s = {
    kind,
    o: [r.range(-80, 80), r.range(-80, 80), r.range(-80, 80)],
    amp: 0.12,
    freq: 1.3,
    amp2: 0.05,
    scale: [1, 0.8, 0.9],
    cuts: [],
  };
  const cut = (nx, ny, nz, off, hard = 1) => {
    const l = Math.hypot(nx, ny, nz);
    s.cuts.push([nx / l, ny / l, nz / l, off, hard]);
  };
  const jit = 0.45;
  if (kind === 'round') {
    s.amp = 0.17;
    s.freq = 0.9;
    s.amp2 = 0.06;
    s.scale = [1, r.range(0.7, 0.88), r.range(0.8, 1)];
    for (let k = 0; k < 3; k++) cut(r.range(-1, 1), r.range(-0.3, 1), r.range(-1, 1), r.range(0.7, 0.9), 0.75);
  } else if (kind === 'block') {
    s.amp = 0.09;
    s.freq = 1.5;
    s.amp2 = 0.035;
    s.scale = [1, r.range(0.72, 0.95), r.range(0.8, 1)];
    // near-orthogonal joint planes (like fractured bedrock) + a couple of oblique ones
    const yaw = r.range(0, TAU);
    for (let k = 0; k < 4; k++) {
      const a = yaw + (k * Math.PI) / 2 + r.range(-0.2, 0.2);
      cut(Math.cos(a), r.range(-jit, jit) * 0.5, Math.sin(a), r.range(0.55, 0.72));
    }
    cut(r.range(-0.25, 0.25), 1, r.range(-0.25, 0.25), r.range(0.5, 0.66));
    for (let k = 0; k < 3; k++) cut(r.range(-1, 1), r.range(0, 1), r.range(-1, 1), r.range(0.62, 0.8));
  } else if (kind === 'slab') {
    s.amp = 0.08;
    s.freq = 1.4;
    s.amp2 = 0.03;
    s.scale = [r.range(1.1, 1.35), r.range(0.42, 0.55), r.range(0.85, 1.05)];
    cut(r.range(-0.12, 0.12), 1, r.range(-0.12, 0.12), r.range(0.28, 0.38));
    cut(r.range(-0.12, 0.12), -1, r.range(-0.12, 0.12), r.range(0.3, 0.4));
    for (let k = 0; k < 5; k++) {
      const a = r.range(0, TAU);
      cut(Math.cos(a), r.range(-0.3, 0.3), Math.sin(a), r.range(0.72, 0.95));
    }
  } else {
    // shard: tall split block
    s.amp = 0.08;
    s.freq = 1.6;
    s.amp2 = 0.035;
    s.scale = [r.range(0.5, 0.65), r.range(1.25, 1.55), r.range(0.55, 0.7)];
    for (let k = 0; k < 6; k++) {
      const a = r.range(0, TAU);
      cut(Math.cos(a), r.range(-0.2, 0.6), Math.sin(a), r.range(0.4, 0.62));
    }
    cut(r.range(-0.6, 0.6), 1, r.range(-0.6, 0.6), r.range(0.9, 1.2));
  }
  return s;
}

/**
 * Tessellate a rock recipe. detail = icosphere edge subdivision: 20 * (detail + 1)^2 triangles
 * (1: 80, 3: 320, 7: 1280, 14: 4500).
 * Returns an indexed geometry roughly within the unit sphere scaled by shape.scale, base near y ~ -0.6.
 */
export function rockGeometry(shape, detail = 2) {
  const unit = unitIcosphere(detail);
  const arr = unit.pos.slice();
  const count = arr.length / 3;
  const [ox, oy, oz] = shape.o;
  const [sx, sy, sz] = shape.scale;
  const cuts = shape.cuts;
  for (let i = 0; i < count; i++) {
    const vx = arr[i * 3], vy = arr[i * 3 + 1], vz = arr[i * 3 + 2];
    const f = shape.freq;
    let rr = 1 + shape.amp * noise3(vx * f + ox, vy * f + oy, vz * f + oz);
    rr += shape.amp2 * noise3(vx * f * 3.1 - oz, vy * f * 3.1 + ox, vz * f * 3.1 - oy);
    let x = vx * rr * sx;
    let y = vy * rr * sy;
    let z = vz * rr * sz;
    for (let k = 0; k < cuts.length; k++) {
      const c = cuts[k];
      const d = x * c[0] + y * c[1] + z * c[2] - c[3];
      if (d > 0) {
        x -= c[0] * d * c[4];
        y -= c[1] * d * c[4];
        z -= c[2] * d * c[4];
      }
    }
    arr[i * 3] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(computeNormals(arr, unit.idx, count, unit.idx.length), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  g.setIndex(new THREE.BufferAttribute(unit.idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Pillars: hoodoos, sea stacks, spires, pedestals
// ---------------------------------------------------------------------------

/**
 * Write a vertical noisy pillar.
 *  o.x, o.z         base centre
 *  o.y0, o.h        bottom (sunk) and height
 *  o.rings, o.segs  tessellation
 *  o.radius(t, a, y)  radius profile (t in 0..1 along height, a = angle)
 *  o.lean [lx, lz]  top offset (bends quadratically)
 *  o.flute / o.lump   noise amplitudes (vertical fluting / general lumps), o.freq
 *  o.cap: 'dome' | 'point' | 'flat'; o.capH height of the closing cap
 *  o.tint(t, y) -> [r,g,b]
 * Returns { top: [x, y, z], topR, topY } — summit apex, mean radius and height of the last ring.
 * The tessellation is scaled by the writer's `detail` (quality).
 */
export function writePillar(w, o) {
  const segs = Math.max(6, Math.round(o.segs * Math.sqrt(w.detail)));
  const rings = Math.max(6, Math.round(o.rings * w.detail));
  const base = w.nv;
  const lx = o.lean ? o.lean[0] : 0;
  const lz = o.lean ? o.lean[1] : 0;
  const f = o.freq ?? 0.08;
  const flute = o.flute ?? 0;
  const lump = o.lump ?? 0;
  const seed = o.seed ?? 0;
  let topR = 0;
  let cxT = o.x, czT = o.z, yT = o.y0 + o.h;
  const cosA = new Float32Array(segs);
  const sinA = new Float32Array(segs);
  const aOff = o.angle ?? 0;
  for (let j = 0; j < segs; j++) {
    cosA[j] = Math.cos(aOff + (j / segs) * TAU);
    sinA[j] = Math.sin(aOff + (j / segs) * TAU);
  }
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const y = o.y0 + t * o.h;
    const bend = t * t;
    const cx = o.x + lx * bend;
    const cz = o.z + lz * bend;
    const tint = o.tint ? o.tint(t, y) : null;
    let rsum = 0;
    for (let j = 0; j < segs; j++) {
      const a = aOff + (j / segs) * TAU;
      let r = o.radius(t, a, y);
      const px = cx + cosA[j] * r;
      const pz = cz + sinA[j] * r;
      if (flute) r += flute * r * noise3(px * f * 1.7 + seed, y * f * 0.22, pz * f * 1.7 - seed);
      if (lump) r += lump * r * noise3(px * f * 0.8 - seed, y * f * 0.9 + seed, pz * f * 0.8);
      if (r < 0.05) r = 0.05;
      rsum += r;
      if (tint) w.v(cx + cosA[j] * r, y, cz + sinA[j] * r, tint[0], tint[1], tint[2]);
      else w.v(cx + cosA[j] * r, y, cz + sinA[j] * r);
    }
    if (i === rings - 1) {
      topR = rsum / segs;
      cxT = cx;
      czT = cz;
      yT = y;
    }
  }
  stitchTube(w, base, rings, segs);
  const last = base + (rings - 1) * segs;
  const cap = o.cap ?? 'dome';
  const capH = o.capH ?? topR * 0.35;
  const tintTop = o.tint ? o.tint(1, yT) : [1, 1, 1];
  if (cap === 'flat' || cap === 'dome') {
    // one inset ring then the apex: a gently domed, slightly lumpy summit
    const r2 = w.nv;
    const inset = cap === 'flat' ? 0.55 : 0.6;
    for (let j = 0; j < segs; j++) {
      const k = last + j;
      const px = w.pos[k * 3], pz = w.pos[k * 3 + 2];
      const x = cxT + (px - cxT) * inset;
      const z = czT + (pz - czT) * inset;
      const bump = (cap === 'flat' ? 0.08 : 0.2) * topR * (0.5 + 0.5 * noise3(x * 0.2 + seed, yT * 0.1, z * 0.2));
      w.v(x, yT + capH * (cap === 'flat' ? 0.35 : 0.7) + bump, z, tintTop[0], tintTop[1], tintTop[2]);
    }
    stitchPair(w, last, r2, segs, cxT, czT);
    const apex = w.v(cxT, yT + capH, czT, tintTop[0], tintTop[1], tintTop[2]);
    fanCap(w, r2, segs, apex);
  } else {
    const apex = w.v(cxT + lx * 0.04, yT + capH, czT + lz * 0.04, tintTop[0], tintTop[1], tintTop[2]);
    fanCap(w, last, segs, apex);
  }
  return { top: [cxT, yT + capH, czT], topR, topY: yT };
}

/** Stitch two rings (a -> b) so faces point away from the axis through (cx, *, cz) / upward. */
function stitchPair(w, a, b, segs, cx, cz) {
  const P = w.pos;
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
  const vx = P[(a + 1) * 3] - ax, vy = P[(a + 1) * 3 + 1] - ay, vz = P[(a + 1) * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  // outward/up reference: radial direction + up
  const rx = ax - cx, rz = az - cz;
  const ok = nx * rx + nz * rz + ny * Math.hypot(rx, rz) > 0;
  for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    if (ok) w.q(a + j, b + j, b + j1, a + j1);
    else w.q(a + j, a + j1, b + j1, b + j);
  }
}

// ---------------------------------------------------------------------------
// Natural arches: a noisy band swept along an arc, legs flaring into the ground
// ---------------------------------------------------------------------------

/**
 * o.a [x,y,z], o.b [x,y,z]   foot centres on the ground
 * o.crown                    crown centre-line height (absolute y)
 * o.n, o.segs                path samples / ring vertices
 * o.dCrown, o.dLeg           band thickness (in the arch plane) at crown / feet
 * o.wCrown, o.wLeg           band width (across the arch plane)
 * o.sink                     how far the legs continue underground
 * o.pw                       leg steepness exponent (smaller = more vertical legs)
 * o.lump, o.freq, o.seed     noise; o.ledges strata ledge amplitude (m); o.ledgeStep (m)
 * o.twist                    lateral sag of the crown (m), makes the span less planar
 */
export function writeArch(w, o) {
  const [ax, ay, az] = o.a;
  const [bx, by, bz] = o.b;
  const n = Math.max(24, Math.round((o.n ?? 90) * w.detail));
  const segs = Math.max(10, Math.round((o.segs ?? 28) * Math.sqrt(w.detail)));
  const legN = Math.max(4, Math.round(n * 0.08));
  const dx = bx - ax, dz = bz - az;
  const span = Math.hypot(dx, dz);
  const ux = dx / span, uz = dz / span;
  // horizontal normal of the arch plane
  const Bx = -uz, Bz = ux;
  const pw = o.pw ?? 0.6;
  const seed = o.seed ?? 0;
  const f = o.freq ?? 0.05;
  const ledgeStep = o.ledgeStep ?? 4.5;
  // centre-line samples (path), including vertical underground legs
  const pts = [];
  const sink = o.sink ?? 20;
  for (let i = legN; i >= 1; i--) pts.push([ax, ay - (sink * i) / legN, az, 0]);
  const midBase = (ay + by) * 0.5;
  const H = o.crown - midBase;
  const peak = o.peak ?? 0.5;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const base = ay + (by - ay) * u;
    // warp so the crown sits at u = peak (asymmetric arches look grown, not drawn)
    const uw = u < peak ? (0.5 * u) / peak : 0.5 + (0.5 * (u - peak)) / (1 - peak);
    const s = Math.sin(Math.PI * uw);
    const lift = H * Math.pow(s, pw);
    const sag = (o.twist ?? 0) * s * s;
    pts.push([ax + dx * u + Bx * sag, base + lift, az + dz * u + Bz * sag, u]);
  }
  for (let i = 1; i <= legN; i++) pts.push([bx, by - (sink * i) / legN, bz, 1]);
  const N = pts.length;
  const base = w.nv;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const pa = pts[Math.max(0, i - 1)];
    const pb = pts[Math.min(N - 1, i + 1)];
    let tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // in-plane normal N = B x T (B horizontal): up at the crown, outward along the legs
    let nx = -Bz * ty;
    let ny = Bz * tx - Bx * tz;
    let nz = Bx * ty;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const u = p[3];
    const sEnd = Math.abs(2 * u - 1); // 0 crown .. 1 feet
    const below = p[1] < (u < 0.5 ? ay : by) ? 1 : 0;
    const flare = Math.pow(sEnd, 2.2);
    // pinches and swellings along the band
    const pinch = 1 + (o.pinch ?? 0.25) * noise3(u * 4.1 + seed, seed * 0.37, 1.7);
    const d = (o.dCrown + (o.dLeg - o.dCrown) * flare) * (1 + 0.25 * below) * pinch;
    const wd = (o.wCrown + (o.wLeg - o.wCrown) * Math.pow(sEnd, 1.6)) * (1 + 0.25 * below) * (0.6 + 0.4 * pinch);
    const tint = o.tint ? o.tint(p[1]) : null;
    for (let j = 0; j < segs; j++) {
      const phi = (j / segs) * TAU;
      const c = Math.cos(phi), s = Math.sin(phi);
      // squarish cross-section (superellipse) reads as a rock band rather than a tube
      const sc = Math.sign(c) * Math.pow(Math.abs(c), 0.7);
      const ss = Math.sign(s) * Math.pow(Math.abs(s), 0.7);
      let ox = nx * sc * d * 0.5 + Bx * ss * wd * 0.5;
      let oy = ny * sc * d * 0.5;
      let oz = nz * sc * d * 0.5 + Bz * ss * wd * 0.5;
      const px = p[0] + ox, py = p[1] + oy, pz = p[2] + oz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      const rad = Math.min(d, wd) * 0.5;
      let disp = (o.lump ?? 0.25) * rad * (noise3(px * f + seed, py * f * 1.3, pz * f - seed) + 0.5 * noise3(px * f * 2.7, py * f * 2.7 + seed, pz * f * 2.7));
      if (o.ledges) {
        const lv = py / ledgeStep + 0.6 * noise3(px * 0.02, seed, pz * 0.02);
        const fr = lv - Math.floor(lv);
        disp += o.ledges * (fr < 0.18 ? -1 + fr / 0.18 : 0) * Math.min(1, rad / 6);
      }
      const k = 1 + disp / ol;
      ox *= k;
      oy *= k;
      oz *= k;
      if (tint) w.v(p[0] + ox, p[1] + oy, p[2] + oz, tint[0], tint[1], tint[2]);
      else w.v(p[0] + ox, p[1] + oy, p[2] + oz);
    }
  }
  stitchTube(w, base, N, segs);
  return { span };
}

// ---------------------------------------------------------------------------
// Basalt columns: irregular hexagonal prisms, flat-shaded
// ---------------------------------------------------------------------------

const _hx = new Float32Array(8);
const _hz = new Float32Array(8);

/**
 * Column with polygonal section (5–7 sides), from y0 up to y1 (top plane tilted by tx, tz slopes).
 * rot: section rotation; jit: 0..1 corner irregularity; rng: seeded RNG; tint [r,g,b].
 */
export function writeColumn(w, cx, cz, r, y0, y1, rot, rng, tint, sides = 6, tiltX = 0, tiltZ = 0) {
  for (let k = 0; k < sides; k++) {
    const a = rot + (k / sides) * TAU + rng.range(-0.1, 0.1);
    const rr = r * rng.range(0.9, 1.06);
    _hx[k] = cx + Math.cos(a) * rr;
    _hz[k] = cz + Math.sin(a) * rr;
  }
  const [tr, tg, tb] = tint;
  const topY = (x, z) => y1 + (x - cx) * tiltX + (z - cz) * tiltZ;
  // weathered top edge: a chamfer ring between the faces and an inset top (catches the light and
  // keeps prisms from reading as boxes)
  const bev = Math.min(r * 0.2, (y1 - y0) * 0.3);
  const ins = 0.8;
  // sides: separate verts per face -> crisp flat facets
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const x0 = _hx[k], z0 = _hz[k], x1 = _hx[k1], z1 = _hz[k1];
    // slight darkening per face for rhythm
    const fshade = 0.86 + 0.14 * ((k * 37) % 7) / 6;
    const a = w.v(x0, y0, z0, tr * fshade * 0.75, tg * fshade * 0.75, tb * fshade * 0.75);
    const b = w.v(x1, y0, z1, tr * fshade * 0.75, tg * fshade * 0.75, tb * fshade * 0.75);
    const c = w.v(x1, topY(x1, z1) - bev, z1, tr * fshade, tg * fshade, tb * fshade);
    const d = w.v(x0, topY(x0, z0) - bev, z0, tr * fshade, tg * fshade, tb * fshade);
    // outward winding: corners go counter-clockwise in (x,z) with increasing angle, which is
    // clockwise seen from above; (a, d, c, b) faces outward (see stitchTube notes)
    w.q(a, d, c, b);
    // chamfer
    const ix0 = cx + (x0 - cx) * ins, iz0 = cz + (z0 - cz) * ins;
    const ix1 = cx + (x1 - cx) * ins, iz1 = cz + (z1 - cz) * ins;
    const e = w.v(x0, topY(x0, z0) - bev, z0, tr * 1.1, tg * 1.1, tb * 1.1);
    const f = w.v(x1, topY(x1, z1) - bev, z1, tr * 1.1, tg * 1.1, tb * 1.1);
    const g = w.v(ix1, topY(ix1, iz1), iz1, tr * 1.1, tg * 1.1, tb * 1.1);
    const h = w.v(ix0, topY(ix0, iz0), iz0, tr * 1.1, tg * 1.1, tb * 1.1);
    w.q(e, h, g, f);
  }
  // top: slightly domed/dished fan on the inset ring
  const cy = topY(cx, cz) + r * rng.range(-0.06, 0.08);
  const ctr = w.v(cx, cy, cz, tr * 1.05, tg * 1.05, tb * 1.05);
  const first = w.nv;
  for (let k = 0; k < sides; k++) {
    const ix = cx + (_hx[k] - cx) * ins, iz = cz + (_hz[k] - cz) * ins;
    w.v(ix, topY(ix, iz), iz, tr, tg, tb);
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    w.t(ctr, first + k1, first + k);
  }
}

/** A fallen / lying column segment (prism along an arbitrary axis) — debris at the foot of colonnades. */
export function writeLyingColumn(w, x, y, z, r, len, yaw, pitch, rng, tint, sides = 6) {
  const ax = Math.cos(yaw) * Math.cos(pitch);
  const ay = Math.sin(pitch);
  const az = Math.sin(yaw) * Math.cos(pitch);
  // basis perpendicular to axis
  let ux = -az, uy = 0, uz = ax;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;
  const rot = rng.range(0, TAU);
  const cs = [];
  for (let k = 0; k < sides; k++) {
    const a = rot + (k / sides) * TAU;
    const rr = r * rng.range(0.92, 1.05);
    cs.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const [tr, tg, tb] = tint;
  const h = len / 2;
  const P = (k, s) => {
    const [cu, cv] = cs[k];
    return [x + ux * cu + vx * cv + ax * s, y + uy * cu + vy * cv + ay * s, z + uz * cu + vz * cv + az * s];
  };
  const base = w.nv;
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const p0 = P(k, -h), p1 = P(k1, -h), p2 = P(k1, h), p3 = P(k, h);
    const a = w.v(p0[0], p0[1], p0[2], tr, tg, tb);
    const b = w.v(p1[0], p1[1], p1[2], tr, tg, tb);
    const c = w.v(p2[0], p2[1], p2[2], tr, tg, tb);
    const d = w.v(p3[0], p3[1], p3[2], tr, tg, tb);
    // winding check against radial direction
    const mx = (p0[0] + p1[0]) / 2 - (x - ax * h), my = (p0[1] + p1[1]) / 2 - (y - ay * h), mz = (p0[2] + p1[2]) / 2 - (z - az * h);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nx * mx + ny * my + nz * mz > 0) w.q(a, b, c, d);
    else w.q(a, d, c, b);
  }
  // end caps
  for (const s of [-h, h]) {
    const c = w.v(x + ax * s, y + ay * s, z + az * s, tr, tg, tb);
    const st = w.nv;
    for (let k = 0; k < sides; k++) {
      const p = P(k, s);
      w.v(p[0], p[1], p[2], tr, tg, tb);
    }
    const p0 = P(0, s), p1 = P(1, s);
    const e1 = [p0[0] - (x + ax * s), p0[1] - (y + ay * s), p0[2] - (z + az * s)];
    const e2 = [p1[0] - (x + ax * s), p1[1] - (y + ay * s), p1[2] - (z + az * s)];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const ok = (nx * ax + ny * ay + nz * az) * s > 0;
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      if (ok) w.t(c, st + k, st + k1);
      else w.t(c, st + k1, st + k);
    }
  }
  return base;
}
