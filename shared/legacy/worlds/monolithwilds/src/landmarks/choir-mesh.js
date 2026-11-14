// Choir geometry kernel.
//
// Mesher: an indexed accumulator (one per material) that writes position, normal, vertex tint,
// a glyph coordinate `choirUv` (u = metres around the stone's perimeter, v = metres below its
// crown, both divided by the stone's glyph scale — so inscription bands follow each stone even
// when it leans, sinks or floats) and, for moving stones, per-vertex animation parameters
// (`choirAnim` = pivot.xz, phase, yaw speed; `choirBob` = amplitude, angular frequency).
//
// slab(): the monolith generator. A stone is a stack of chamfered octagonal prisms: plain
// segments, recessed inscription channels (aligned with the shader's glyph bands), through-slots
// ("mouths" the wind sings through, built as two posts) and a crown (bevel, slant cut, ridge,
// point or a jagged break).

import * as THREE from 'crownfall-world-three';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Mesher {
  constructor(name, { anim = false } = {}) {
    this.name = name;
    this.P = [];
    this.N = [];
    this.C = [];
    this.U = [];
    this.I = [];
    this.A = anim ? [] : null;
    this.B = anim ? [] : null;
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.ident = true;
    this.tint = [1, 1, 1];
    this.anim = [0, 0, 0, 0];
    this.bob = [0, 0];
    this.vFn = null; // local y -> glyph v
    this.gs = 1;
  }

  get triangles() {
    return this.I.length / 3;
  }

  frame(m) {
    if (!m) {
      this.ident = true;
      return this;
    }
    this.m.copy(m);
    this.nm.getNormalMatrix(m);
    this.ident = false;
    return this;
  }

  setTint(r, g = r, b = r) {
    this.tint[0] = r;
    this.tint[1] = g;
    this.tint[2] = b;
    return this;
  }

  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    _p.set(x, y, z);
    _n.set(nx, ny, nz);
    if (!this.ident) {
      _p.applyMatrix4(this.m);
      _n.applyMatrix3(this.nm).normalize();
    }
    this.P.push(_p.x, _p.y, _p.z);
    this.N.push(_n.x, _n.y, _n.z);
    this.C.push(this.tint[0], this.tint[1], this.tint[2]);
    this.U.push(u, v);
    if (this.A) {
      this.A.push(this.anim[0], this.anim[1], this.anim[2], this.anim[3]);
      this.B.push(this.bob[0], this.bob[1]);
    }
    return this.P.length / 3 - 1;
  }

  gv(y) {
    return this.vFn ? this.vFn(y) : 0;
  }

  /**
   * Prism between two corresponding rings of [x, z] points. y0 / y1: number or per-point array.
   * jagTop / jagBottom != 0 turn that cap into a faceted break (centre raised/lowered by the value).
   */
  prism(r0, y0, r1, y1, { top = true, bottom = true, jagTop = 0, jagBottom = 0 } = {}) {
    const n = r0.length;
    const Y0 = typeof y0 === 'number' ? null : y0;
    const Y1 = typeof y1 === 'number' ? null : y1;
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += r0[i][0] + r1[i][0];
      cz += r0[i][1] + r1[i][1];
      cy += (Y0 ? Y0[i] : y0) + (Y1 ? Y1[i] : y1);
    }
    cx /= 2 * n;
    cz /= 2 * n;
    cy /= 2 * n;
    const gs = this.gs;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r0[i][0], az = r0[i][1], ay = Y0 ? Y0[i] : y0;
      const bx = r0[j][0], bz = r0[j][1], by = Y0 ? Y0[j] : y0;
      const qx = r1[j][0], qz = r1[j][1], qy = Y1 ? Y1[j] : y1;
      const dx = r1[i][0], dz = r1[i][1], dy = Y1 ? Y1[i] : y1;
      const len = Math.hypot(bx - ax, bz - az);
      _a.set(qx - ax, qy - ay, qz - az);
      _b.set(dx - bx, dy - by, dz - bz);
      _n.crossVectors(_a, _b);
      const l = _n.length();
      if (l < 1e-9) {
        u += len;
        continue;
      }
      _n.multiplyScalar(1 / l);
      const mx = (ax + bx + qx + dx) * 0.25 - cx;
      const my = (ay + by + qy + dy) * 0.25 - cy;
      const mz = (az + bz + qz + dz) * 0.25 - cz;
      const flip = _n.x * mx + _n.z * mz + _n.y * my * 0.05 < 0;
      if (flip) _n.negate();
      const nx = _n.x, ny = _n.y, nz = _n.z;
      const u0 = u / gs;
      const u1 = (u + len) / gs;
      const ia = this.vert(ax, ay, az, nx, ny, nz, u0, this.gv(ay));
      const ib = this.vert(bx, by, bz, nx, ny, nz, u1, this.gv(by));
      const ic = this.vert(qx, qy, qz, nx, ny, nz, u1, this.gv(qy));
      const id = this.vert(dx, dy, dz, nx, ny, nz, u0, this.gv(dy));
      if (!flip) this.I.push(ia, ib, ic, ia, ic, id);
      else this.I.push(ia, ic, ib, ia, id, ic);
      u += len;
    }
    if (bottom) this.cap(r0, y0, false, jagBottom);
    if (top) this.cap(r1, y1, true, jagTop);
    return this;
  }

  /** Convex cap. Planar fan with a shared normal, or (jag != 0) a faceted break around a centre. */
  cap(ring, ys, up, jag = 0) {
    const n = ring.length;
    const Y = typeof ys === 'number' ? null : ys;
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += ring[i][0];
      cz += ring[i][1];
      cy += Y ? Y[i] : ys;
    }
    cx /= n;
    cz /= n;
    cy /= n;
    if (!jag) {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const yi = Y ? Y[i] : ys;
        const yj = Y ? Y[j] : ys;
        nx += (yi - yj) * (ring[i][1] + ring[j][1]);
        ny += (ring[i][1] - ring[j][1]) * (ring[i][0] + ring[j][0]);
        nz += (ring[i][0] - ring[j][0]) * (yi + yj);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      if (ny > 0 !== up) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const base = this.P.length / 3;
      for (let i = 0; i < n; i++) this.vert(ring[i][0], Y ? Y[i] : ys, ring[i][1], nx, ny, nz, 0, 0);
      // fan (0, k, k+1) faces +y when the ring's (x, z) shoelace area is negative
      const keep = this.#faceUp(ring) === up;
      for (let k = 1; k < n - 1; k++) {
        if (keep) this.I.push(base, base + k, base + k + 1);
        else this.I.push(base, base + k + 1, base + k);
      }
      return;
    }
    const py = cy + jag;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i][0], az = ring[i][1], ay = Y ? Y[i] : ys;
      const bx = ring[j][0], bz = ring[j][1], by = Y ? Y[j] : ys;
      _a.set(ax - cx, ay - py, az - cz);
      _b.set(bx - cx, by - py, bz - cz);
      _n.crossVectors(_a, _b).normalize();
      let flip = false;
      if (_n.y > 0 !== up) {
        _n.negate();
        flip = true;
      }
      const i0 = this.vert(cx, py, cz, _n.x, _n.y, _n.z);
      const i1 = this.vert(ax, ay, az, _n.x, _n.y, _n.z);
      const i2 = this.vert(bx, by, bz, _n.x, _n.y, _n.z);
      if (!flip) this.I.push(i0, i1, i2);
      else this.I.push(i0, i2, i1);
    }
  }

  // true when the fan (0, k, k+1) over this ring has a +y geometric normal
  #faceUp(ring) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      s += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return s < 0;
  }

  /** Axis-aligned (in the current frame) box centred at (x, y, z), rotated by yaw. */
  box(x, y, z, sx, sy, sz, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = sx / 2, hz = sz / 2;
    const r = [[hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]].map(([px, pz]) => [x + px * c + pz * s, z - px * s + pz * c]);
    return this.prism(r, y - sy / 2, r, y + sy / 2);
  }

  /** Triangulated planar polygon (3D points + index triples) facing `want` (normal hint). */
  poly(pts, tris, want) {
    const base = this.P.length / 3;
    for (const p of pts) this.vert(p[0], p[1], p[2], want[0], want[1], want[2]);
    for (const [a, b, c] of tris) {
      const A = pts[a], B = pts[b], C = pts[c];
      _a.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      _b.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
      _n.crossVectors(_a, _b);
      if (_n.x * want[0] + _n.y * want[1] + _n.z * want[2] >= 0) this.I.push(base + a, base + b, base + c);
      else this.I.push(base + a, base + c, base + b);
    }
  }

  /** Quad strip with explicit per-vertex normals: a0,a1 bottom edge, b0,b1 top edge. */
  quadN(a0, a1, b1, b0, na0, na1, nb1, nb0) {
    const i0 = this.vert(a0[0], a0[1], a0[2], na0[0], na0[1], na0[2]);
    const i1 = this.vert(a1[0], a1[1], a1[2], na1[0], na1[1], na1[2]);
    const i2 = this.vert(b1[0], b1[1], b1[2], nb1[0], nb1[1], nb1[2]);
    const i3 = this.vert(b0[0], b0[1], b0[2], nb0[0], nb0[1], nb0[2]);
    _a.set(b1[0] - a0[0], b1[1] - a0[1], b1[2] - a0[2]);
    _b.set(b0[0] - a1[0], b0[1] - a1[1], b0[2] - a1[2]);
    _n.crossVectors(_a, _b);
    const want = na0[0] + na1[0] + nb0[0] + nb1[0];
    const wy = na0[1] + na1[1] + nb0[1] + nb1[1];
    const wz = na0[2] + na1[2] + nb0[2] + nb1[2];
    if (_n.x * want + _n.y * wy + _n.z * wz >= 0) this.I.push(i0, i1, i2, i0, i2, i3);
    else this.I.push(i0, i2, i1, i0, i3, i2);
  }

  toMesh(material, { castShadow = true, receiveShadow = true } = {}) {
    if (!this.I.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('choirUv', new THREE.Float32BufferAttribute(this.U, 2));
    if (this.A) {
      g.setAttribute('choirAnim', new THREE.Float32BufferAttribute(this.A, 4));
      g.setAttribute('choirBob', new THREE.Float32BufferAttribute(this.B, 2));
    }
    const count = this.P.length / 3;
    g.setIndex(new THREE.BufferAttribute(count > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `choir:${this.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    this.P = this.N = this.C = this.U = this.I = this.A = this.B = null;
    return mesh;
  }
}

/**
 * Rectangle a x b (half extents) with chamfered corners c0..c3 (+x+z, -x+z, -x-z, +x-z) and an
 * optional shallow ridge down the middle of both broad (±z) faces — the knapped-blade section.
 * Always 10 points, so any two sections can be joined by prism().
 */
export function oct(a, b, c0, c1 = c0, c2 = c0, c3 = c0, ridge = 0) {
  const k = Math.min(a, b) * 0.48;
  const f = (c) => Math.max(0.02, Math.min(c, k));
  c0 = f(c0);
  c1 = f(c1);
  c2 = f(c2);
  c3 = f(c3);
  return [[a, -b + c3], [a, b - c0], [a - c0, b], [0, b + ridge], [-a + c1, b], [-a, b - c1], [-a, -b + c2], [-a + c2, -b], [0, -b - ridge], [a - c3, -b]];
}

/**
 * A monolith in its own frame: base at y = 0, width along x, thickness along z (broad faces ±z).
 * S: { w, d, h, taper, taperD, chamfer, gs, vCap, top: 'flat'|'slant'|'ridge'|'point'|'broken',
 *      topH, slantDir, channels: [[y0,y1]], inset, slots: [[y0,y1,width]], brokenBase, rng, glyph }
 */
export function slab(M, S) {
  const { w, d, h } = S;
  const taper = S.taper || 0;
  const taperD = S.taperD || 0;
  const ch = S.chamfer ?? Math.min(0.14 * d, 0.9);
  const gs = S.gs || 1;
  const vCap = S.vCap ?? Infinity;
  M.gs = gs;
  M.vFn = S.glyph === false ? null : (y) => Math.min((h - y) / gs + 3.5, vCap);
  const sec = (y, ins = 0) => [
    Math.max(0.04, (w / 2) * (1 - (taper * y) / h) - ins),
    Math.max(0.04, (d / 2) * (1 - (taperD * y) / h) - ins),
  ];
  const rdg = S.ridge || 0;
  const ring = (y, ins = 0) => {
    const [a, b] = sec(y, ins);
    const c = Math.max(0.03, ch - ins * 0.6);
    return oct(a, b, c, c, c, c, rdg * (1 - taper * y / h));
  };
  const topH = Math.min(S.topH ?? Math.min(0.2 * d, 0.8), h * 0.6);
  const bodyTop = h - topH;
  const rng = S.rng;

  const iv = [];
  for (const c of S.channels || []) iv.push({ y0: c[0], y1: c[1], k: 'ch' });
  for (const s of S.slots || []) iv.push({ y0: s[0], y1: s[1], k: 'slot', sw: s[2] });
  if (S.yBreak > 0.2 && S.yBreak < bodyTop - 0.2) iv.push({ y0: S.yBreak, y1: S.yBreak, k: 'brk' });
  iv.sort((p, q) => p.y0 - q.y0);

  // broken base (fallen pieces): the bottom ring is jagged
  let y = 0;
  let first = true;
  const solid = (a, b) => {
    if (b - a < 1e-3) return;
    if (first && S.brokenBase && rng) {
      const r0 = ring(a);
      const ys = r0.map(() => a + rng() * Math.min(topH, (b - a) * 0.5));
      M.prism(r0, ys, ring(b), b, { jagBottom: -Math.min(topH, (b - a) * 0.4) * 0.5 });
    } else M.prism(ring(a), a, ring(b), b);
    first = false;
  };
  for (const s of iv) {
    if (s.y0 < y + 0.05 || s.y1 > bodyTop - 0.1) continue;
    solid(y, s.y0);
    if (s.k === 'ch') {
      M.prism(ring(s.y0, S.inset || 0.15), s.y0, ring(s.y1, S.inset || 0.15), s.y1);
      first = false;
    } else if (s.k === 'slot') {
      const [a0, b0] = sec(s.y0);
      const [a1, b1] = sec(s.y1);
      const c = Math.max(0.03, Math.min(ch, Math.min(a1, b1) * 0.45));
      const hw = Math.min(s.sw / 2, a1 - c - 0.3);
      if (hw > 0.2) {
        // posts follow the ridged face: its height at x = hw on the plane from the ridge to the chamfer
        const post = (a, b, y, sd) => {
          const zr = b + rdg * (1 - taper * y / h) * Math.max(0, 1 - hw / (a - c));
          return sd < 0
            ? [[-hw, -zr], [-hw, zr], [-a + c, b], [-a, b - c], [-a, -b + c], [-a + c, -b]]
            : [[hw, zr], [hw, -zr], [a - c, -b], [a, -b + c], [a, b - c], [a - c, b]];
        };
        M.prism(post(a0, b0, s.y0, -1), s.y0, post(a1, b1, s.y1, -1), s.y1);
        M.prism(post(a0, b0, s.y0, 1), s.y0, post(a1, b1, s.y1, 1), s.y1);
      } else M.prism(ring(s.y0), s.y0, ring(s.y1), s.y1);
      first = false;
    }
    y = s.y1;
  }
  solid(y, bodyTop);

  // crown
  const r0 = ring(bodyTop);
  const [at, bt] = sec(h);
  switch (S.top) {
    case 'slant': {
      const sd = S.slantDir || 1;
      const ys = r0.map(([x]) => bodyTop + topH * (0.06 + 0.94 * (0.5 + (0.5 * sd * x) / at)));
      M.prism(r0, bodyTop, r0, ys, { bottom: false });
      break;
    }
    case 'ridge':
      M.prism(r0, bodyTop, oct(at * 0.94, Math.max(0.04, bt * 0.07), 0.02), h, { bottom: false });
      break;
    case 'point':
      M.prism(r0, bodyTop, oct(Math.max(0.1, at * 0.16), Math.max(0.06, bt * 0.4), 0.02), h, { bottom: false });
      break;
    case 'broken': {
      const ys = r0.map(() => bodyTop + topH * (rng ? rng() : 0.5));
      M.prism(r0, bodyTop, r0, ys, { bottom: false, jagTop: topH * (rng ? rng.range(-0.3, 0.5) : 0.2) });
      break;
    }
    default:
      M.prism(r0, bodyTop, ring(h, Math.min(topH * 0.9, Math.min(at, bt) * 0.5)), h, { bottom: false });
  }
  M.vFn = null;
}

/** Two-tier weathered plinth in its own frame: grade at y = 0, lower tier from -sink. */
export function plinth(M, { a, b, h1, h2, sink, rng, step = 1.1 }) {
  const chip = () => (rng.chance(0.28) ? rng.range(0.4, 1.6) : rng.range(0.08, 0.25));
  const lo = oct(a + step, b + step, chip(), chip(), chip(), chip());
  M.prism(lo, -sink, lo, h1, { bottom: false });
  const up = oct(a, b, chip(), chip(), chip(), chip());
  M.prism(up, h1, up, h1 + h2, { bottom: false });
  return h1 + h2;
}
