// Geometry writer for the Stair to Nowhere.
//
// The stair is ~4000 steps, ~6000 balusters, dozens of piers and a long continuous sweep —
// far too many pieces to clone through GeometryBuilder one by one. A Writer appends raw
// triangles straight into flat arrays (one Writer per material) and becomes a single
// BufferGeometry at the end: one draw call per material, fast to build.
//
// Conventions: points are [x, y, z] arrays; quads are wound counter-clockwise seen from the
// front; `w.tint` ([r, g, b], multiplier baked into the vertex colour) applies to everything
// added until it is changed.

import * as THREE from 'crownfall-world-three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Writer {
  constructor(name = 'stair') {
    this.name = name;
    this.cap = 4096;
    this.p = new Float32Array(this.cap * 3);
    this.n = new Float32Array(this.cap * 3);
    this.c = new Float32Array(this.cap * 3);
    this.icap = 8192;
    this.idx = new Uint32Array(this.icap);
    this.ni = 0;
    this.v = 0;
    this.tint = [1, 1, 1];
    // index sink with the Array.push signature used throughout
    this.i = { push: (...a) => this.pushIdx(a) };
  }

  get triangles() {
    return this.ni / 3;
  }

  pushIdx(a) {
    if (this.ni + a.length > this.icap) {
      while (this.ni + a.length > this.icap) this.icap *= 2;
      const b = new Uint32Array(this.icap);
      b.set(this.idx.subarray(0, this.ni));
      this.idx = b;
    }
    for (let k = 0; k < a.length; k++) this.idx[this.ni++] = a[k];
  }

  setTint(r, g = r, b = r) {
    this.tint = [r, g, b];
    return this;
  }

  grow() {
    this.cap *= 2;
    for (const k of ['p', 'n', 'c']) {
      const b = new Float32Array(this.cap * 3);
      b.set(this[k]);
      this[k] = b;
    }
  }

  vert(x, y, z, nx, ny, nz) {
    if (this.v >= this.cap) this.grow();
    const o = this.v * 3;
    const P = this.p, N = this.n, C = this.c, t = this.tint;
    P[o] = x;
    P[o + 1] = y;
    P[o + 2] = z;
    N[o] = nx;
    N[o + 1] = ny;
    N[o + 2] = nz;
    C[o] = t[0];
    C[o + 1] = t[1];
    C[o + 2] = t[2];
    return this.v++;
  }

  /** Flat quad a-b-c-d (CCW from the front). */
  quad(a, b, c, d) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _c.crossVectors(_a, _b);
    // degenerate at a: try the opposite corner
    if (_c.lengthSq() < 1e-12) {
      _a.set(d[0] - c[0], d[1] - c[1], d[2] - c[2]);
      _b.set(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
      _c.crossVectors(_a, _b);
    }
    _c.normalize();
    const nx = _c.x, ny = _c.y, nz = _c.z;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz);
    this.vert(b[0], b[1], b[2], nx, ny, nz);
    this.vert(c[0], c[1], c[2], nx, ny, nz);
    this.vert(d[0], d[1], d[2], nx, ny, nz);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /** Quad facing (roughly) direction f = [x, y, z], whatever the vertex order. */
  quadN(a, b, c, d, f) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _c.crossVectors(_a, _b);
    if (_c.x * f[0] + _c.y * f[1] + _c.z * f[2] >= 0) this.quad(a, b, c, d);
    else this.quad(a, d, c, b);
  }

  /** Triangle facing (roughly) direction f. */
  triN(a, b, c, f) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b);
    if (_c.x * f[0] + _c.y * f[1] + _c.z * f[2] >= 0) this.tri(a, b, c);
    else this.tri(a, c, b);
  }

  tri(a, b, c) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b).normalize();
    const i0 = this.vert(a[0], a[1], a[2], _c.x, _c.y, _c.z);
    this.vert(b[0], b[1], b[2], _c.x, _c.y, _c.z);
    this.vert(c[0], c[1], c[2], _c.x, _c.y, _c.z);
    this.i.push(i0, i0 + 1, i0 + 2);
  }

  /**
   * Box from a centre and three half-axis vectors (need not be orthogonal: shear is fine for
   * sloping blocks). skip: bitmask of faces to omit (1 -x, 2 +x, 4 -y, 8 +y, 16 -z, 32 +z).
   */
  box(c, ax, ay, az, skip = 0) {
    const P = (sx, sy, sz) => [
      c[0] + ax[0] * sx + ay[0] * sy + az[0] * sz,
      c[1] + ax[1] * sx + ay[1] * sy + az[1] * sz,
      c[2] + ax[2] * sx + ay[2] * sy + az[2] * sz,
    ];
    const p000 = P(-1, -1, -1), p100 = P(1, -1, -1), p010 = P(-1, 1, -1), p110 = P(1, 1, -1);
    const p001 = P(-1, -1, 1), p101 = P(1, -1, 1), p011 = P(-1, 1, 1), p111 = P(1, 1, 1);
    // orientation: if the axes are left-handed, swap winding
    _a.set(ax[0], ax[1], ax[2]);
    _b.set(ay[0], ay[1], ay[2]);
    _c.crossVectors(_a, _b);
    const rh = _c.x * az[0] + _c.y * az[1] + _c.z * az[2] >= 0;
    const q = rh ? (a, b, cc, d) => this.quad(a, b, cc, d) : (a, b, cc, d) => this.quad(a, d, cc, b);
    if (!(skip & 1)) q(p000, p001, p011, p010);
    if (!(skip & 2)) q(p100, p110, p111, p101);
    if (!(skip & 4)) q(p000, p100, p101, p001);
    if (!(skip & 8)) q(p010, p011, p111, p110);
    if (!(skip & 16)) q(p000, p010, p110, p100);
    if (!(skip & 32)) q(p001, p101, p111, p011);
  }

  /** Axis-aligned-ish block: centre, size, yaw about Y. */
  block(x, y, z, sx, sy, sz, yaw = 0, skip = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.box([x, y, z], [c * sx * 0.5, 0, -s * sx * 0.5], [0, sy * 0.5, 0], [s * sz * 0.5, 0, c * sz * 0.5], skip);
  }

  /**
   * Vertical lathe with few sides (balusters, shafts, finials): profile [[r, y], ...] from the
   * bottom up, relative to (x, y, z). Faceted (flat quads). Caps close the ends when r > 0.
   */
  lathe(x, y, z, profile, sides = 6, phase = 0, { capTop = true, capBottom = false } = {}) {
    const ring = (r, yy, k) => {
      const a = phase + (k / sides) * Math.PI * 2;
      return [x + Math.cos(a) * r, y + yy, z + Math.sin(a) * r];
    };
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j];
      const [r1, y1] = profile[j + 1];
      if (r0 <= 0 && r1 <= 0) continue;
      for (let k = 0; k < sides; k++) {
        const a0 = ring(r0, y0, k), a1 = ring(r0, y0, k + 1);
        const b0 = ring(r1, y1, k), b1 = ring(r1, y1, k + 1);
        if (r1 <= 1e-4) this.tri(a0, b0, a1);
        else if (r0 <= 1e-4) this.tri(a0, b0, b1);
        else this.quad(a0, b0, b1, a1);
      }
    }
    const top = profile[profile.length - 1];
    if (capTop && top[0] > 1e-4) {
      const c = [x, y + top[1], z];
      for (let k = 0; k < sides; k++) this.tri(c, ring(top[0], top[1], k + 1), ring(top[0], top[1], k));
    }
    const bot = profile[0];
    if (capBottom && bot[0] > 1e-4) {
      const c = [x, y + bot[1], z];
      for (let k = 0; k < sides; k++) this.tri(c, ring(bot[0], bot[1], k), ring(bot[0], bot[1], k + 1));
    }
  }

  /**
   * Prism between two arbitrary points (struts, fallen shafts): n sides, radii r0 -> r1.
   */
  strut(p0, p1, r0, r1 = r0, sides = 4, phase = 0.785) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _a.length();
    _a.divideScalar(len);
    // perpendicular basis
    _b.set(0, 1, 0);
    if (Math.abs(_a.y) > 0.9) _b.set(1, 0, 0);
    _c.crossVectors(_a, _b).normalize();
    _b.crossVectors(_c, _a).normalize();
    const U = [_b.x, _b.y, _b.z], V = [_c.x, _c.y, _c.z];
    const ring = (p, r, k) => {
      const a = phase + (k / sides) * Math.PI * 2;
      const cu = Math.cos(a) * r, cv = Math.sin(a) * r;
      return [p[0] + U[0] * cu + V[0] * cv, p[1] + U[1] * cu + V[1] * cv, p[2] + U[2] * cu + V[2] * cv];
    };
    for (let k = 0; k < sides; k++) {
      this.quad(ring(p0, r0, k), ring(p0, r0, k + 1), ring(p1, r1, k + 1), ring(p1, r1, k));
    }
    // caps
    for (let k = 1; k < sides - 1; k++) {
      this.tri(ring(p1, r1, 0), ring(p1, r1, k), ring(p1, r1, k + 1));
      this.tri(ring(p0, r0, 0), ring(p0, r0, k + 1), ring(p0, r0, k));
    }
  }

  /**
   * Sweep a profile along a list of frames. frames: [{ o: [x,y,z], n: [nx, nz] (horizontal
   * across-direction), hw, d, t? }]; profile: [[ku, cu, kv, cv], ...] evaluated per frame as
   * u = ku·hw + cu (across, along n), v = kv·d + cv (up) — so a section can follow the stair's
   * changing width / depth. Each profile edge becomes a strip: flat across the profile, smooth
   * along the path. `closed` joins the last point back to the first; `edges` limits which
   * profile edges are emitted; frame.t (optional) scales the tint per frame; caps close the ends.
   */
  sweep(frames, profile, { closed = false, edges = null, capStart = false, capEnd = false } = {}) {
    const nf = frames.length;
    if (nf < 2) return;
    const np = profile.length;
    const ne = closed ? np : np - 1;
    const U = (f, e) => e[0] * f.hw + e[1];
    const V = (f, e) => e[2] * f.d + e[3];
    // profile winding (sign of area, from the first frame) decides which side is "outside"
    let area = 0;
    for (let i = 0; i < np; i++) {
      const a = profile[i], b = profile[(i + 1) % np];
      area += U(frames[0], a) * V(frames[0], b) - U(frames[0], b) * V(frames[0], a);
    }
    const ccw = area >= 0 ? 1 : -1;
    const W = (f, e, out) => {
      const u = U(f, e), v = V(f, e);
      out[0] = f.o[0] + f.n[0] * u;
      out[1] = f.o[1] + v;
      out[2] = f.o[2] + f.n[1] * u;
      return out;
    };
    const A = [0, 0, 0], B = [0, 0, 0], pa = [0, 0, 0], pb = [0, 0, 0];
    const tint0 = this.tint;
    for (let e = 0; e < ne; e++) {
      if (edges && !edges.includes(e)) continue;
      const e0 = profile[e], e1 = profile[(e + 1) % np];
      const base = this.v;
      for (let k = 0; k < nf; k++) {
        const f = frames[k];
        const fa = frames[Math.max(0, k - 1)], fb = frames[Math.min(nf - 1, k + 1)];
        W(f, e0, A);
        W(f, e1, B);
        const du = U(f, e1) - U(f, e0), dv = V(f, e1) - V(f, e0);
        const ou = dv * ccw, ov = -du * ccw;
        // along-path tangent at the edge midpoint
        W(fa, e0, pa);
        W(fb, e0, pb);
        _a.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).normalize();
        _b.set(f.n[0] * ou, ov, f.n[1] * ou);
        _b.addScaledVector(_a, -_b.dot(_a)).normalize();
        if (f.t !== undefined) this.tint = [tint0[0] * f.t, tint0[1] * f.t, tint0[2] * f.t];
        this.vert(A[0], A[1], A[2], _b.x, _b.y, _b.z);
        this.vert(B[0], B[1], B[2], _b.x, _b.y, _b.z);
      }
      this.tint = tint0;
      // winding check on the first segment
      const i0 = base, i1 = base + 1, i2 = base + 2;
      const P = this.p;
      _a.set(P[i1 * 3] - P[i0 * 3], P[i1 * 3 + 1] - P[i0 * 3 + 1], P[i1 * 3 + 2] - P[i0 * 3 + 2]);
      _b.set(P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]);
      _c.crossVectors(_a, _b);
      const flip = _c.x * this.n[i0 * 3] + _c.y * this.n[i0 * 3 + 1] + _c.z * this.n[i0 * 3 + 2] < 0;
      for (let k = 0; k < nf - 1; k++) {
        const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
        if (flip) this.i.push(a, c, b, b, c, d);
        else this.i.push(a, b, c, b, d, c);
      }
    }
    if (capStart) this.sweepCap(frames[0], frames[1], profile, U, V);
    if (capEnd) this.sweepCap(frames[nf - 1], frames[nf - 2], profile, U, V);
  }

  /** Planar cap of a swept section at frame f, facing away from `other`. */
  sweepCap(f, other, profile, U, V) {
    const pts2 = profile.map((e) => new THREE.Vector2(U(f, e), V(f, e)));
    const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
    const out = new THREE.Vector3(f.o[0] - other.o[0], 0, f.o[2] - other.o[2]).normalize();
    const w = pts2.map((p) => [f.o[0] + f.n[0] * p.x, f.o[1] + p.y, f.o[2] + f.n[1] * p.x]);
    const cr = new THREE.Vector3();
    for (const t of tris) {
      const [a, b, c] = t.map((i) => w[i]);
      _b.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _c.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      cr.crossVectors(_b, _c);
      if (cr.dot(out) >= 0) this.tri(a, b, c);
      else this.tri(a, c, b);
    }
  }

  /** Append a three.js geometry transformed by a matrix (normals transformed too). */
  addGeometry(geometry, matrix) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nrm = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.v;
    for (let k = 0; k < pos.count; k++) {
      _a.fromBufferAttribute(pos, k).applyMatrix4(matrix);
      _b.fromBufferAttribute(nrm, k).applyMatrix3(nm).normalize();
      this.vert(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
    }
    for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    if (g !== geometry) g.dispose();
  }

  /** Finish: a BufferGeometry (or null when empty). */
  geometry() {
    if (!this.v) return null;
    const nv = this.v * 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, nv), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.n.slice(0, nv), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, nv), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.v * 2), 2));
    const idx = this.v > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.p = this.n = this.c = this.idx = null;
    return g;
  }
}

/** Mesh from a writer (null when empty). */
export function writerMesh(w, material, { castShadow = true, receiveShadow = true } = {}) {
  const g = w.geometry();
  if (!g) return null;
  const m = new THREE.Mesh(g, material);
  m.name = `stair:${w.name}`;
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
