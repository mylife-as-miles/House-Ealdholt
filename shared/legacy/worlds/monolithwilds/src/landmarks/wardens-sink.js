// Kneeling Wardens — geometry sink and the "coursed stack" generator.
//
// The Sink accumulates raw triangles per material (typed arrays at the end, one Mesh per
// material), with a current transform so body parts can be authored in a warden's local frame.
// It is much faster than cloning thousands of tiny BufferGeometries through GeometryBuilder.
//
// stack(): the construction system of the colossi. Every body part is a pile of HORIZONTAL
// masonry courses (3 m, aligned to the material's block rows), each course a superellipse
// footprint. Leaning / bending forms are made by corbelling — each course shifts a little —
// so backs become stepped ledges and chests become overhanging corbel tables, exactly like a
// building that happens to have the shape of a body. "Cuts" are angular columns that can be
// recessed per course: missing blocks, loggia recesses, portal niches, vertical slots.

import * as THREE from 'crownfall-world-three';

export class Sink {
  constructor() {
    this.buckets = new Map();
    this.matrix = new THREE.Matrix4();
    this.nmat = new THREE.Matrix3();
    this._pool = [];
    this._depth = 0;
    this.tris = 0;
    // colour multiplier applied to everything pushed (per-warden stone tone)
    this.tone = [1, 1, 1];
  }

  /** Replace the current transform. */
  setMatrix(m) {
    this.matrix.copy(m);
    this.nmat.getNormalMatrix(this.matrix);
  }

  /** Multiply a local transform onto the current one (pop() restores). */
  push(m) {
    const k = this._depth++;
    if (!this._pool[k]) this._pool[k] = { m: new THREE.Matrix4(), n: new THREE.Matrix3() };
    this._pool[k].m.copy(this.matrix);
    this._pool[k].n.copy(this.nmat);
    this.matrix.multiply(m);
    this.nmat.getNormalMatrix(this.matrix);
  }

  pop() {
    const e = this._pool[--this._depth];
    this.matrix.copy(e.m);
    this.nmat.copy(e.n);
  }

  // Buckets store vertices in fixed-size chunks (no copy-on-grow garbage: a doubling buffer
  // churned ~2x the final 600k vertices through the GC during the build).
  bucket(mat) {
    let b = this.buckets.get(mat);
    if (!b) {
      b = { chunks: [], ichunks: [], p: null, n: null, c: null, i: null, base: 0, ibase: 0, count: 0, ic: 0 };
      newChunk(b);
      newIChunk(b);
      this.buckets.set(mat, b);
    }
    return b;
  }

  /** Push one vertex in the current frame; returns its index within the bucket. */
  vert(b, x, y, z, nx, ny, nz, r, g, bl) {
    let o = (b.count - b.base) * 3;
    if (o >= CHUNK_V * 3) {
      newChunk(b);
      o = 0;
    }
    const e = this.matrix.elements;
    const q = this.nmat.elements;
    b.p[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    b.p[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    b.p[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const mx = q[0] * nx + q[3] * ny + q[6] * nz;
    const my = q[1] * nx + q[4] * ny + q[7] * nz;
    const mz = q[2] * nx + q[5] * ny + q[8] * nz;
    const l = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
    b.n[o] = mx / l;
    b.n[o + 1] = my / l;
    b.n[o + 2] = mz / l;
    b.c[o] = r * this.tone[0];
    b.c[o + 1] = g * this.tone[1];
    b.c[o + 2] = bl * this.tone[2];
    return b.count++;
  }

  /** Append triangle indices. */
  idx(b, a, c, d) {
    let o = b.ic - b.ibase;
    if (o + 3 > CHUNK_I) {
      newIChunk(b);
      o = 0;
    }
    b.i[o] = a;
    b.i[o + 1] = c;
    b.i[o + 2] = d;
    b.ic += 3;
  }

  /** Flat quad a-b-c-d (counter-clockwise seen from the front). Points are [x,y,z]. */
  quad(mat, a, bq, c, d, tint = 1) {
    const b = this.bucket(mat);
    const ux = bq[0] - a[0], uy = bq[1] - a[1], uz = bq[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const [r, g, bl] = tintRGB(tint);
    const i0 = this.vert(b, a[0], a[1], a[2], nx, ny, nz, r, g, bl);
    this.vert(b, bq[0], bq[1], bq[2], nx, ny, nz, r, g, bl);
    this.vert(b, c[0], c[1], c[2], nx, ny, nz, r, g, bl);
    this.vert(b, d[0], d[1], d[2], nx, ny, nz, r, g, bl);
    this.idx(b, i0, i0 + 1, i0 + 2);
    this.idx(b, i0, i0 + 2, i0 + 3);
    this.tris += 2;
  }

  /**
   * Box of size (sx, sy, sz) centred at (x, y, z), rotated by yaw about Y (and optional pitch about
   * local X, roll about local Z; Euler order YXZ). `skipBottom` drops the face resting on things.
   */
  box(mat, x, y, z, sx, sy, sz, yaw = 0, tint = 1, pitch = 0, roll = 0, skipBottom = true) {
    // local rotation R (Euler YXZ) applied by hand: no matrix push, no normal-matrix inverse
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz (columns)
    const r00 = cy * cr + sy_ * sp * sr, r01 = -cy * sr + sy_ * sp * cr, r02 = sy_ * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -sy_ * cr + cy * sp * sr, r21 = sy_ * sr + cy * sp * cr, r22 = cy * cp;
    const b = this.bucket(mat);
    const [tr, tg, tb] = tintRGB(tint);
    for (let f = 0; f < 6; f++) {
      if (skipBottom && f === 3) continue;
      const F = BOX_FACES[f];
      // normal of a scaled box face: R * (n / s)
      const nx0 = F.n[0] / sx, ny0 = F.n[1] / sy, nz0 = F.n[2] / sz;
      const nx = r00 * nx0 + r01 * ny0 + r02 * nz0;
      const ny = r10 * nx0 + r11 * ny0 + r12 * nz0;
      const nz = r20 * nx0 + r21 * ny0 + r22 * nz0;
      const i0 = b.count;
      for (let k = 0; k < 4; k++) {
        const v = F.v[k];
        const px = v[0] * sx, py = v[1] * sy, pz = v[2] * sz;
        this.vert(b, x + r00 * px + r01 * py + r02 * pz, y + r10 * px + r11 * py + r12 * pz, z + r20 * px + r21 * py + r22 * pz, nx, ny, nz, tr, tg, tb);
      }
      this.idx(b, i0, i0 + 1, i0 + 2);
      this.idx(b, i0, i0 + 2, i0 + 3);
      this.tris += 2;
    }
  }

  /** Unit box (±0.5) transformed by matrix m (in the current frame). */
  boxM(mat, m, tint = 1, skipBottom = true) {
    this.push(m);
    const b = this.bucket(mat);
    const [r, g, bl] = tintRGB(tint);
    for (let f = 0; f < 6; f++) {
      if (skipBottom && f === 3) continue;
      const F = BOX_FACES[f];
      const n = F.n;
      // normals need the scale-aware normal matrix: nmat handles it
      const i0 = b.count;
      for (let k = 0; k < 4; k++) {
        const v = F.v[k];
        this.vert(b, v[0], v[1], v[2], n[0], n[1], n[2], r, g, bl);
      }
      this.idx(b, i0, i0 + 1, i0 + 2);
    this.idx(b, i0, i0 + 2, i0 + 3);
      this.tris += 2;
    }
    this.pop();
  }

  /** Add an arbitrary BufferGeometry, transformed by m (in the current frame). */
  geo(mat, geometry, m = null, tint = 1) {
    if (m) this.push(m);
    const b = this.bucket(mat);
    const pos = geometry.attributes.position;
    let nrm = geometry.attributes.normal;
    if (!nrm) {
      geometry.computeVertexNormals();
      nrm = geometry.attributes.normal;
    }
    const col = geometry.attributes.color;
    const [r, g, bl] = tintRGB(tint);
    const base = b.count;
    const P = pos.array, Nn = nrm.array, C = col ? col.array : null;
    for (let i = 0, o = 0; i < pos.count; i++, o += 3) {
      if (C) this.vert(b, P[o], P[o + 1], P[o + 2], Nn[o], Nn[o + 1], Nn[o + 2], C[o] * r, C[o + 1] * g, C[o + 2] * bl);
      else this.vert(b, P[o], P[o + 1], P[o + 2], Nn[o], Nn[o + 1], Nn[o + 2], r, g, bl);
    }
    if (geometry.index) {
      const idx = geometry.index.array;
      for (let i = 0; i < idx.length; i += 3) this.idx(b, base + idx[i], base + idx[i + 1], base + idx[i + 2]);
      this.tris += idx.length / 3;
    } else {
      for (let i = 0; i < pos.count; i += 3) this.idx(b, base + i, base + i + 1, base + i + 2);
      this.tris += pos.count / 3;
    }
    if (m) this.pop();
  }

  /** Merge another sink into this one (its vertices are already in its own space). */
  addSink(other, m = null) {
    if (m) this.push(m);
    const tone = this.tone;
    this.tone = [1, 1, 1];
    for (const [mat, ob] of other.buckets) {
      const b = this.bucket(mat);
      const base = b.count;
      for (let k = 0; k < ob.chunks.length; k++) {
        const C = ob.chunks[k];
        const n = Math.min(CHUNK_V, ob.count - k * CHUNK_V);
        for (let i = 0; i < n; i++) {
          const o = i * 3;
          this.vert(b, C.p[o], C.p[o + 1], C.p[o + 2], C.n[o], C.n[o + 1], C.n[o + 2], C.c[o], C.c[o + 1], C.c[o + 2]);
        }
      }
      for (let k = 0; k < ob.ichunks.length; k++) {
        const I = ob.ichunks[k];
        const n = Math.min(CHUNK_I, ob.ic - k * CHUNK_I);
        for (let i = 0; i < n; i += 3) this.idx(b, base + I[i], base + I[i + 1], base + I[i + 2]);
      }
      this.tris += ob.ic / 3;
    }
    this.tone = tone;
    if (m) this.pop();
  }

  /** Build one Mesh per material into a Group. `noShadow` = Set of materials that never cast. */
  build(name, noShadow = new Set()) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, b] of this.buckets) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      const P = new Float32Array(b.count * 3), Nn = new Float32Array(b.count * 3), Cc = new Float32Array(b.count * 3);
      b.chunks.forEach((C, k) => {
        const n = Math.min(CHUNK_V, b.count - k * CHUNK_V) * 3;
        P.set(C.p.subarray(0, n), k * CHUNK_V * 3);
        Nn.set(C.n.subarray(0, n), k * CHUNK_V * 3);
        Cc.set(C.c.subarray(0, n), k * CHUNK_V * 3);
      });
      const I = new (b.count > 65535 ? Uint32Array : Uint16Array)(b.ic);
      b.ichunks.forEach((C, k) => I.set(C.subarray(0, Math.min(CHUNK_I, b.ic - k * CHUNK_I)), k * CHUNK_I));
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}:${mat.userData?.preset ?? mat.type}`;
      mesh.castShadow = !noShadow.has(mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

const CHUNK_V = 16384; // vertices per chunk
const CHUNK_I = 3 * 32768; // indices per chunk (multiple of 3)
function newChunk(b) {
  const C = { p: new Float32Array(CHUNK_V * 3), n: new Float32Array(CHUNK_V * 3), c: new Float32Array(CHUNK_V * 3) };
  b.base = b.chunks.length * CHUNK_V;
  b.chunks.push(C);
  b.p = C.p;
  b.n = C.n;
  b.c = C.c;
}
function newIChunk(b) {
  const C = new Uint32Array(CHUNK_I);
  b.ibase = b.ichunks.length * CHUNK_I;
  b.ichunks.push(C);
  b.i = C;
}
const BOX_FACES = [
  { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];

const _tint = [1, 1, 1];
export function tintRGB(t) {
  if (typeof t === 'number') {
    _tint[0] = t; _tint[1] = t; _tint[2] = t;
    return _tint;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Superellipse footprints
// ---------------------------------------------------------------------------

/** Point on a superellipse footprint (angle a: 0 = +x, PI/2 = +z front, 3PI/2 = -z back). */
export function footPoint(c, a, out) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const k = 2 / c.e;
  const lx = c.hx * Math.sign(ca) * Math.pow(Math.abs(ca), k);
  const lz = c.hz * Math.sign(sa) * Math.pow(Math.abs(sa), k);
  const cy = Math.cos(c.yaw || 0);
  const sy = Math.sin(c.yaw || 0);
  out.x = c.cx + lx * cy + lz * sy;
  out.z = c.cz - lx * sy + lz * cy;
  out.lx = lx;
  out.lz = lz;
  return out;
}

/** Outward unit normal (xz) of the footprint at angle a. */
export function footNormal(c, a, out) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const e = c.e;
  // gradient of |x/hx|^e + |z/hz|^e evaluated at the parametric point
  const ux = Math.pow(Math.abs(ca), (2 / e) * (e - 1)) * Math.sign(ca) / c.hx;
  const uz = Math.pow(Math.abs(sa), (2 / e) * (e - 1)) * Math.sign(sa) / c.hz;
  let nx = ux, nz = uz;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l; nz /= l;
  const cy = Math.cos(c.yaw || 0);
  const sy = Math.sin(c.yaw || 0);
  out.x = nx * cy + nz * sy;
  out.z = -nx * sy + nz * cy;
  return out;
}

const TAU = Math.PI * 2;
const mod = (a, m) => ((a % m) + m) % m;

/**
 * Build a stack of horizontal courses.
 *   courses: [{ y0, y1, cx, cz, hx, hz, e, yaw, tint, cut: [depth per cut] | null, loft }]
 *   opts: { N, cuts: [[center, halfWidthRadians]], capTop, capBottom, groundY, aoRange, loft }
 * Consecutive courses must share y (course[i].y1 === course[i+1].y0) to get ledges.
 * Returns the per-course polygons (for placing details).
 */
export function stack(sink, mat, courses, opts = {}) {
  const N = opts.N ?? 32;
  // the angular parameter window starts in the widest gap between cuts, so no cut wraps
  const raw = (opts.cuts || []).map(([c, hw]) => [mod(c - hw, TAU), 2 * hw]).sort((u, v) => u[0] - v[0]);
  let A0 = Math.PI / 4;
  if (raw.length) {
    let best = -1;
    for (let i = 0; i < raw.length; i++) {
      const end = raw[i][0] + raw[i][1];
      const next = i + 1 < raw.length ? raw[i + 1][0] : raw[0][0] + TAU;
      if (next - end > best) {
        best = next - end;
        A0 = mod(end + (next - end) * 0.5, TAU);
      }
    }
  }
  const norm = (a) => A0 + mod(a - A0, TAU);
  const cuts = (opts.cuts || []).map(([c, hw]) => {
    const a0 = norm(c - hw);
    return { a0, a1: a0 + 2 * hw, c: a0 + hw };
  });
  // sample descriptors
  const desc = [];
  for (let k = 0; k < N; k++) {
    const a = A0 + (TAU * k) / N;
    let cut = -1;
    let skip = false;
    for (let j = 0; j < cuts.length; j++) {
      const C = cuts[j];
      if (Math.abs(a - C.a0) < 1e-3 || Math.abs(a - C.a1) < 1e-3) skip = true;
      if (a > C.a0 && a < C.a1) cut = j;
    }
    if (!skip) desc.push({ a, key: a, cut });
  }
  cuts.forEach((C, j) => {
    desc.push({ a: C.a0, key: C.a0 - 1e-7, cut: -1 });
    desc.push({ a: C.a0, key: C.a0 + 1e-7, cut: j });
    desc.push({ a: C.a1, key: C.a1 - 1e-7, cut: j });
    desc.push({ a: C.a1, key: C.a1 + 1e-7, cut: -1 });
  });
  desc.sort((u, v) => u.key - v.key);
  const M = desc.length;

  const groundY = opts.groundY ?? -1e9;
  const aoRange = opts.aoRange ?? 16;
  const pt = { x: 0, z: 0 };
  const nr = { x: 0, z: 0 };
  const polys = [];
  for (const c of courses) {
    const P = new Float32Array(M * 2);
    const cutN = cuts.map((C) => {
      footNormal(c, C.c, nr);
      return [nr.x, nr.z];
    });
    for (let j = 0; j < M; j++) {
      const d = desc[j];
      footPoint(c, d.a, pt);
      let x = pt.x, z = pt.z;
      if (d.cut >= 0 && c.cut && c.cut[d.cut] > 0) {
        x -= cutN[d.cut][0] * c.cut[d.cut];
        z -= cutN[d.cut][1] * c.cut[d.cut];
      }
      P[j * 2] = x;
      P[j * 2 + 1] = z;
    }
    polys.push(P);
  }

  const b = sink.bucket(mat);
  const ao = (y) => {
    const t = Math.min(1, Math.max(0, (y - groundY) / aoRange));
    return 0.62 + 0.38 * t * t * (3 - 2 * t);
  };

  // --- top rings: with opts.loft, a course's top ring is the next course's bottom ring
  // wherever the cut state matches, so walls run continuously (battered) between string
  // courses instead of stepping at every course.
  const tops = polys.map((P, ci) => {
    const c = courses[ci];
    const nx = courses[ci + 1];
    if (!opts.loft || !nx || c.loft === false || nx.loft === false || Math.abs(nx.y0 - c.y1) > 1e-3) return P;
    const Q = polys[ci + 1];
    const T = new Float32Array(P.length);
    for (let j = 0; j < M; j++) {
      const d = desc[j];
      let same = true;
      if (d.cut >= 0) {
        const da = c.cut ? c.cut[d.cut] || 0 : 0;
        const db = nx.cut ? nx.cut[d.cut] || 0 : 0;
        same = Math.abs(da - db) < 1e-3;
      }
      T[j * 2] = same ? Q[j * 2] : P[j * 2];
      T[j * 2 + 1] = same ? Q[j * 2 + 1] : P[j * 2 + 1];
    }
    return T;
  });

  // --- risers
  const en = new Float32Array(M * 3); // face normals per edge
  const ok = new Uint8Array(M);
  for (let ci = 0; ci < courses.length; ci++) {
    const c = courses[ci];
    const P = polys[ci];
    const T = tops[ci];
    const h = c.y1 - c.y0;
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const bx = P[j1 * 2] - P[j * 2], bz = P[j1 * 2 + 1] - P[j * 2 + 1];
      const tx = T[j1 * 2] - T[j * 2], tz = T[j1 * 2 + 1] - T[j * 2 + 1];
      if (Math.abs(bx) + Math.abs(bz) < 1e-4 && Math.abs(tx) + Math.abs(tz) < 1e-4) {
        ok[j] = 0;
        continue;
      }
      ok[j] = 1;
      // e1 along the edge, e2 up the side; outward normal = e2 x e1
      const e1x = (bx + tx) * 0.5, e1z = (bz + tz) * 0.5;
      const e2x = (T[j * 2] + T[j1 * 2] - P[j * 2] - P[j1 * 2]) * 0.5;
      const e2z = (T[j * 2 + 1] + T[j1 * 2 + 1] - P[j * 2 + 1] - P[j1 * 2 + 1]) * 0.5;
      const e2y = h;
      let nx = e2y * e1z, ny = e2z * e1x - e2x * e1z, nz = -e2y * e1x;
      const l = Math.hypot(nx, ny, nz) || 1;
      en[j * 3] = nx / l;
      en[j * 3 + 1] = ny / l;
      en[j * 3 + 2] = nz / l;
    }
    const t = c.tint ?? 1;
    const t0 = t * ao(c.y0);
    const t1 = t * ao(c.y1);
    const tc = c.color;
    const r0 = tc ? tc[0] * t0 : t0, g0 = tc ? tc[1] * t0 : t0, b0 = tc ? tc[2] * t0 : t0;
    const r1 = tc ? tc[0] * t1 : t1, g1 = tc ? tc[1] * t1 : t1, b1 = tc ? tc[2] * t1 : t1;
    for (let j = 0; j < M; j++) {
      if (!ok[j]) continue;
      const j1 = (j + 1) % M;
      // vertex normals: smooth with the neighbouring face if the corner is gentle
      let jp = (j - 1 + M) % M;
      while (!ok[jp] && jp !== j) jp = (jp - 1 + M) % M;
      let jn = j1;
      while (!ok[jn] && jn !== j) jn = (jn + 1) % M;
      const ex = en[j * 3], ey = en[j * 3 + 1], ez = en[j * 3 + 2];
      let ax = ex, ay = ey, az = ez, cx = ex, cy = ey, cz = ez;
      if (ex * en[jp * 3] + ey * en[jp * 3 + 1] + ez * en[jp * 3 + 2] > 0.8) {
        ax += en[jp * 3]; ay += en[jp * 3 + 1]; az += en[jp * 3 + 2];
      }
      if (ex * en[jn * 3] + ey * en[jn * 3 + 1] + ez * en[jn * 3 + 2] > 0.8) {
        cx += en[jn * 3]; cy += en[jn * 3 + 1]; cz += en[jn * 3 + 2];
      }
      const i0 = sink.vert(b, P[j * 2], c.y0, P[j * 2 + 1], ax, ay, az, r0, g0, b0);
      sink.vert(b, P[j1 * 2], c.y0, P[j1 * 2 + 1], cx, cy, cz, r0, g0, b0);
      sink.vert(b, T[j1 * 2], c.y1, T[j1 * 2 + 1], cx, cy, cz, r1, g1, b1);
      sink.vert(b, T[j * 2], c.y1, T[j * 2 + 1], ax, ay, az, r1, g1, b1);
      // (x0,y0) -> (x0,y1) -> (x1,y1) faces outward for increasing angle
      sink.idx(b, i0, i0 + 3, i0 + 2);
      sink.idx(b, i0, i0 + 2, i0 + 1);
      sink.tris += 2;
    }
  }

  // --- ledges / overhang soffits between consecutive courses
  for (let ci = 0; ci + 1 < courses.length; ci++) {
    const A = tops[ci];
    const B = polys[ci + 1];
    const y = courses[ci].y1;
    if (Math.abs(courses[ci + 1].y0 - y) > 1e-3) continue;
    const t = (courses[ci].tint ?? 1) * ao(y);
    const tc = courses[ci].color;
    const rr = tc ? tc[0] * t : t, gg = tc ? tc[1] * t : t, bb = tc ? tc[2] * t : t;
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const ax0 = A[j * 2], az0 = A[j * 2 + 1], ax1 = A[j1 * 2], az1 = A[j1 * 2 + 1];
      const bx0 = B[j * 2], bz0 = B[j * 2 + 1], bx1 = B[j1 * 2], bz1 = B[j1 * 2 + 1];
      const d0 = Math.abs(ax0 - bx0) + Math.abs(az0 - bz0);
      const d1 = Math.abs(ax1 - bx1) + Math.abs(az1 - bz1);
      if (d0 < 1e-3 && d1 < 1e-3) continue;
      // two triangles: (A0, B1, A1) and (A0, B0, B1); normal from geometry (up = ledge, down = soffit)
      ledgeTri(sink, b, ax0, az0, bx1, bz1, ax1, az1, y, rr, gg, bb);
      ledgeTri(sink, b, ax0, az0, bx0, bz0, bx1, bz1, y, rr, gg, bb);
    }
  }

  // --- caps
  const capFan = (P, y, up, c) => {
    let cx = 0, cz = 0;
    for (let j = 0; j < M; j++) { cx += P[j * 2]; cz += P[j * 2 + 1]; }
    cx /= M; cz /= M;
    const t = (c.tint ?? 1) * ao(y);
    const tc = c.color;
    const rr = tc ? tc[0] * t : t, gg = tc ? tc[1] * t : t, bb = tc ? tc[2] * t : t;
    const ic = sink.vert(b, cx, y, cz, 0, up ? 1 : -1, 0, rr, gg, bb);
    const first = b.count;
    for (let j = 0; j < M; j++) sink.vert(b, P[j * 2], y, P[j * 2 + 1], 0, up ? 1 : -1, 0, rr, gg, bb);
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      if (up) sink.idx(b, ic, first + j1, first + j);
      else sink.idx(b, ic, first + j, first + j1);
      sink.tris++;
    }
  };
  if (opts.capTop !== false) capFan(tops[tops.length - 1], courses[courses.length - 1].y1, true, courses[courses.length - 1]);
  if (opts.capBottom) capFan(polys[0], courses[0].y0, false, courses[0]);

  return { polys, tops, desc, cuts, A0 };
}

function ledgeTri(sink, b, x0, z0, x1, z1, x2, z2, y, r, g, bl) {
  // cross((p1-p0),(p2-p0)).y  with p = (x, y, z):  (dz1*dx2 - dx1*dz2)
  const dx1 = x1 - x0, dz1 = z1 - z0, dx2 = x2 - x0, dz2 = z2 - z0;
  const ny = dz1 * dx2 - dx1 * dz2;
  if (Math.abs(ny) < 1e-6) return;
  const s = ny > 0 ? 1 : -1;
  const i0 = sink.vert(b, x0, y, z0, 0, s, 0, r, g, bl);
  sink.vert(b, x1, y, z1, 0, s, 0, r, g, bl);
  sink.vert(b, x2, y, z2, 0, s, 0, r, g, bl);
  sink.idx(b, i0, i0 + 1, i0 + 2);
  sink.tris++;
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

/** Catmull-Rom interpolation of keyframes [[y, v1, v2, ...], ...] at y (clamped). */
export function keyed(keys, y, out = []) {
  const n = keys.length;
  const w = keys[0].length - 1;
  if (y <= keys[0][0]) {
    for (let k = 0; k < w; k++) out[k] = keys[0][k + 1];
    return out;
  }
  if (y >= keys[n - 1][0]) {
    for (let k = 0; k < w; k++) out[k] = keys[n - 1][k + 1];
    return out;
  }
  let i = 0;
  while (i < n - 2 && y > keys[i + 1][0]) i++;
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)];
  const t = (y - p1[0]) / (p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  for (let k = 1; k <= w; k++) {
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    out[k - 1] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  return out;
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
