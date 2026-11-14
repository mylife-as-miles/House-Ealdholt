// Orrery geometry kit: a fast growable triangle sink (positions / normals / colours / indices in
// typed arrays, no per-piece BufferGeometry clones) plus the few primitives the orrery is made of:
// transformed three.js geometries, swept ring profiles with voussoir joints, oriented boxes/beams.
//
// Everything is expressed in the frame of the object being built (ring-local, sphere-local or
// landmark-local); the caller turns a Mesh3 into one BufferGeometry per material.

import * as THREE from 'crownfall-world-three';

const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

export class Mesh3 {
  constructor(cap = 8192) {
    this.pos = new Float32Array(cap * 3);
    this.nrm = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.idx = new Uint32Array(cap * 3);
    this.nv = 0;
    this.ni = 0;
  }

  get triangles() {
    return this.ni / 3;
  }

  reserve(nv, ni) {
    if (this.nv + nv > this.pos.length / 3) {
      const cap = Math.max((this.nv + nv) * 3, this.pos.length * 2);
      for (const k of ['pos', 'nrm', 'col']) {
        const a = new Float32Array(cap);
        a.set(this[k]);
        this[k] = a;
      }
    }
    if (this.ni + ni > this.idx.length) {
      const a = new Uint32Array(Math.max(this.ni + ni, this.idx.length * 2));
      a.set(this.idx);
      this.idx = a;
    }
  }

  /** Append a vertex, returns its index. Normal must be unit length. */
  v(x, y, z, nx, ny, nz, r = 1, g = 1, b = 1) {
    const i = this.nv++;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.nrm[o] = nx;
    this.nrm[o + 1] = ny;
    this.nrm[o + 2] = nz;
    this.col[o] = r;
    this.col[o + 1] = g;
    this.col[o + 2] = b;
    return i;
  }

  t(a, b, c) {
    const o = this.ni;
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.ni += 3;
  }

  q(a, b, c, d) {
    this.t(a, b, c);
    this.t(a, c, d);
  }

  /**
   * Append a three.js BufferGeometry transformed by `m` (Matrix4, optional) with an RGB tint.
   * tint: number (grey multiplier) or [r,g,b].
   */
  add(geo, m = null, tint = 1) {
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const C = geo.attributes.color;
    const n = P.count;
    const index = geo.index;
    const ni = index ? index.count : n;
    this.reserve(n, ni);
    const tr = typeof tint === 'number' ? tint : tint[0];
    const tg = typeof tint === 'number' ? tint : tint[1];
    const tb = typeof tint === 'number' ? tint : tint[2];
    const e = m ? m.elements : null;
    if (m) _m3.getNormalMatrix(m);
    const ne = _m3.elements;
    const base = this.nv;
    const pa = P.array;
    const na = N ? N.array : null;
    for (let i = 0; i < n; i++) {
      let x = pa[i * 3];
      let y = pa[i * 3 + 1];
      let z = pa[i * 3 + 2];
      let nx = na ? na[i * 3] : 0;
      let ny = na ? na[i * 3 + 1] : 1;
      let nz = na ? na[i * 3 + 2] : 0;
      if (e) {
        const X = e[0] * x + e[4] * y + e[8] * z + e[12];
        const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
        const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
        x = X;
        y = Y;
        z = Z;
        const NX = ne[0] * nx + ne[3] * ny + ne[6] * nz;
        const NY = ne[1] * nx + ne[4] * ny + ne[7] * nz;
        const NZ = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const l = Math.hypot(NX, NY, NZ) || 1;
        nx = NX / l;
        ny = NY / l;
        nz = NZ / l;
      }
      let r = tr;
      let g = tg;
      let b = tb;
      if (C) {
        r *= C.getX(i);
        g *= C.getY(i);
        b *= C.getZ(i);
      }
      this.v(x, y, z, nx, ny, nz, r, g, b);
    }
    if (index) {
      const ia = index.array;
      for (let i = 0; i < ni; i++) this.idx[this.ni + i] = base + ia[i];
    } else {
      for (let i = 0; i < ni; i++) this.idx[this.ni + i] = base + i;
    }
    this.ni += ni;
    return this;
  }

  /** Apply a Matrix4 to every vertex appended since vertex index `from`. */
  transformFrom(from, m) {
    const e = m.elements;
    _m3.getNormalMatrix(m);
    const ne = _m3.elements;
    for (let i = from; i < this.nv; i++) {
      const o = i * 3;
      const x = this.pos[o];
      const y = this.pos[o + 1];
      const z = this.pos[o + 2];
      this.pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = this.nrm[o];
      const ny = this.nrm[o + 1];
      const nz = this.nrm[o + 2];
      _v.set(ne[0] * nx + ne[3] * ny + ne[6] * nz, ne[1] * nx + ne[4] * ny + ne[7] * nz, ne[2] * nx + ne[5] * ny + ne[8] * nz).normalize();
      this.nrm[o] = _v.x;
      this.nrm[o + 1] = _v.y;
      this.nrm[o + 2] = _v.z;
    }
  }

  /** Oriented box between two points (a beam / strut) with a rectangular section w x h. */
  beam(ax, ay, az, bx, by, bz, w, h, tint = 1, up = null) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const zAxis = _bz.set(dx / len, dy / len, dz / len);
    const u = up || (Math.abs(zAxis.y) > 0.95 ? _X : _Y);
    const xAxis = _bx.crossVectors(u, zAxis).normalize();
    const yAxis = _by.crossVectors(zAxis, xAxis);
    _bm.makeBasis(xAxis, yAxis, zAxis);
    _bm.scale(_bs.set(w, h, len));
    _bm.setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    this.add(UNIT_BOX, _bm, tint);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** Group of sinks keyed by material name. */
export function sinks(names) {
  const s = {};
  for (const n of names) s[n] = new Mesh3(4096);
  return s;
}

// ---------------------------------------------------------------------------
// Swept ring profiles
// ---------------------------------------------------------------------------

/**
 * A closed cross-section polygon in (r, y): r = radial offset from the ring's mean radius,
 * y = offset along the ring axis. Points counter-clockwise when viewed with r to the right and
 * y up (so edge normals point outward). `mats[i]` names the sink for edge i -> i+1.
 */
export function makeProfile(points, mats, defaultMat = 'stone') {
  const pts = points.map((p) => [p[0], p[1]]);
  const n = pts.length;
  const edges = [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // outward normal for a CCW polygon: (dy, -dx)
    const s = ccw ? 1 : -1;
    edges.push({ a, b, nr: (s * dy) / l, ny: (-s * dx) / l, mat: (mats && mats[i]) || defaultMat });
  }
  // cap triangles, normalised to counter-clockwise in (r, y)
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []).map((t) => {
    const [p0, p1, p2] = [pts[t[0]], pts[t[1]], pts[t[2]]];
    const sa = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    return sa >= 0 ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
  });
  let cr = 0;
  let cy = 0;
  for (const p of pts) {
    cr += p[0];
    cy += p[1];
  }
  return { pts, edges, tris, ccw, cr: cr / n, cy: cy / n, defaultMat };
}

/** Scale a profile about (cr, cy) — used for the recessed joints between voussoirs. */
export function scaleProfile(pr, sr, sy, cr = pr.cr, cy = pr.cy) {
  const pts = pr.pts.map(([r, y]) => [cr + (r - cr) * sr, cy + (y - cy) * sy]);
  return makeProfile(pts, pr.edges.map((e) => e.mat), pr.defaultMat);
}

/**
 * Sweep a profile around the local Y axis at mean radius R from angle a0 to a1 > a0 (radians,
 * measured from +X toward +Z) in `steps` segments. Hard edges across the profile, smooth along
 * the sweep. `capMat` names the sink for the end caps (null = no caps). `tint` per piece.
 * Optional offsets dr / dy shift the section (voussoirs slightly out of true).
 */
export function sweep(S, pr, R, a0, a1, steps, { tint = 1, capMat = undefined, caps = true, dr = 0, dy = 0, twist = 0 } = {}) {
  const tr = typeof tint === 'number' ? tint : tint[0];
  const tg = typeof tint === 'number' ? tint : tint[1];
  const tb = typeof tint === 'number' ? tint : tint[2];
  const cosA = new Float64Array(steps + 1);
  const sinA = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cosA[i] = Math.cos(a);
    sinA[i] = Math.sin(a);
  }
  const ct = Math.cos(twist);
  const st = Math.sin(twist);
  for (const e of pr.edges) {
    const m = S[e.mat];
    m.reserve((steps + 1) * 2, steps * 6);
    // rotate section by `twist` (small roll of a displaced voussoir)
    const ar = e.a[0] * ct - e.a[1] * st + dr;
    const ay = e.a[0] * st + e.a[1] * ct + dy;
    const br = e.b[0] * ct - e.b[1] * st + dr;
    const by = e.b[0] * st + e.b[1] * ct + dy;
    const nr = e.nr * ct - e.ny * st;
    const ny = e.nr * st + e.ny * ct;
    const base = m.nv;
    for (let i = 0; i <= steps; i++) {
      const c = cosA[i];
      const s = sinA[i];
      m.v((R + ar) * c, ay, (R + ar) * s, nr * c, ny, nr * s, tr, tg, tb);
      m.v((R + br) * c, by, (R + br) * s, nr * c, ny, nr * s, tr, tg, tb);
    }
    // (radial, Y, tangent) is right-handed: for a CCW profile swept toward +angle the quad
    // a(i), b(i), b(i+1), a(i+1) faces outward.
    const fwd = pr.ccw;
    for (let i = 0; i < steps; i++) {
      const k = base + i * 2;
      if (fwd) m.q(k, k + 1, k + 3, k + 2);
      else m.q(k, k + 2, k + 3, k + 1);
    }
  }
  if (caps) {
    const cm = S[capMat === undefined ? pr.defaultMat : capMat] || S[pr.defaultMat];
    for (const end of [0, 1]) {
      const a = end ? a1 : a0;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // cap at a1 faces +tangent (-s, 0, c); cap at a0 faces -tangent
      const dir = end ? 1 : -1;
      const tx = -s * dir;
      const tz = c * dir;
      cm.reserve(pr.pts.length, pr.tris.length * 3);
      const base = cm.nv;
      for (const p of pr.pts) {
        const r = p[0] * ct - p[1] * st + dr;
        const y = p[0] * st + p[1] * ct + dy;
        cm.v((R + r) * c, y, (R + r) * s, tx, 0, tz, tr, tg, tb);
      }
      for (const t of pr.tris) {
        if (end) cm.t(base + t[0], base + t[1], base + t[2]);
        else cm.t(base + t[0], base + t[2], base + t[1]);
      }
    }
  }
}

/**
 * Local frame on a ring: origin at angle a, radius R + r, height y; X = tangent (increasing a),
 * Y = `up` (+1: local +Y face normal, -1: -Y face, 0: radial outward, 2: radial inward),
 * Z completes a right-handed basis. Returns a Matrix4 (reused — copy if you keep it).
 */
const _fm = new THREE.Matrix4();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
export function ringFrame(R, a, r, y, up, out = _fm) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  _fx.set(-s, 0, c);
  if (up === 1) _fy.set(0, 1, 0);
  else if (up === -1) _fy.set(0, -1, 0);
  else if (up === 0) _fy.set(c, 0, s);
  else _fy.set(-c, 0, -s);
  _fz.crossVectors(_fx, _fy);
  out.makeBasis(_fx, _fy, _fz);
  out.setPosition((R + r) * c, y, (R + r) * s);
  return out;
}

/** Deterministic hash -> [0,1) for integers (per-voussoir / per-sector decisions). */
export function h1(i, seed = 0) {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
