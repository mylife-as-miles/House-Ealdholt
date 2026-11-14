// Geometry sink for the Drowned Observatory: writes transformed vertices straight into growable
// typed arrays, one bucket per material, and merges each bucket into a single Mesh at the end.
// (GeometryBuilder clones + normalises every piece; with ~20 k pieces that alone would blow the
// build budget.)
//
// Every emit goes through the current matrix (setMatrix / pushMatrix) and gets a per-vertex tint.
// A "waterline" option darkens + greens vertices in a band just above y = 0 (world) so every
// wet surface carries the same algae/tide stain — the waterline reads as deliberate.

import * as THREE from 'crownfall-world-three';

class GrowF32 {
  constructor(n = 4096) {
    this.a = new Float32Array(n);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  view() {
    return this.a.slice(0, this.n);
  }
}

class GrowU32 {
  constructor(n = 8192) {
    this.a = new Uint32Array(n);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Uint32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _col = new THREE.Color();

// unit cube corners (-0.5..0.5); faces as corner index quads (CCW from outside)
const CUBE = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
export const HEX_FACES = [
  [4, 5, 6, 7], // +z
  [1, 0, 3, 2], // -z
  [5, 1, 2, 6], // +x
  [0, 4, 7, 3], // -x
  [7, 6, 2, 3], // +y
  [0, 1, 5, 4], // -y
];

export class Sink {
  constructor() {
    this.buckets = new Map();
    this.matrix = new THREE.Matrix4();
    this.stack = [];
    this.tint = [1, 1, 1];
    /** world-y band that receives the tide stain; null = off */
    this.waterline = { top: 3.2, dark: [0.42, 0.47, 0.36] };
    this.tris = 0;
  }

  bucket(mat) {
    let b = this.buckets.get(mat);
    if (!b) {
      b = { pos: new GrowF32(), nrm: new GrowF32(), col: new GrowF32(), idx: new GrowU32(), v: 0 };
      this.buckets.set(mat, b);
    }
    return b;
  }

  setMatrix(m) {
    this.matrix.copy(m);
    return this;
  }
  pushMatrix(m) {
    this.stack.push(this.matrix.clone());
    this.matrix.multiply(m);
    return this;
  }
  popMatrix() {
    this.matrix.copy(this.stack.pop());
    return this;
  }
  setTint(t) {
    if (typeof t === 'number') this.tint = [t, t, t];
    else if (Array.isArray(t)) this.tint = t;
    else {
      _col.set(t);
      this.tint = [_col.r, _col.g, _col.b];
    }
    return this;
  }

  _vert(b, p, n, tint) {
    // p, n already in world space
    const i3 = b.pos.n;
    b.pos.a[i3] = p.x;
    b.pos.a[i3 + 1] = p.y;
    b.pos.a[i3 + 2] = p.z;
    b.nrm.a[i3] = n.x;
    b.nrm.a[i3 + 1] = n.y;
    b.nrm.a[i3 + 2] = n.z;
    let r = tint[0], g = tint[1], bl = tint[2];
    const wl = this.waterline;
    if (wl && p.y < wl.top && p.y > -30) {
      // tide stain: strongest right at the surface, fading upward; submerged parts stay dark
      const k = p.y > 0 ? 1 - p.y / wl.top : 1;
      const s = k * k * (3 - 2 * k);
      r *= 1 + (wl.dark[0] - 1) * s;
      g *= 1 + (wl.dark[1] - 1) * s;
      bl *= 1 + (wl.dark[2] - 1) * s;
    }
    b.col.a[i3] = r;
    b.col.a[i3 + 1] = g;
    b.col.a[i3 + 2] = bl;
    b.pos.n += 3;
    b.nrm.n += 3;
    b.col.n += 3;
    return b.v++;
  }

  _reserve(b, verts, idx) {
    b.pos.reserve(verts * 3);
    b.nrm.reserve(verts * 3);
    b.col.reserve(verts * 3);
    b.idx.reserve(idx);
  }

  /**
   * Flat-shaded polygon (convex, 3..n points, CCW seen from the front) in the CURRENT matrix
   * space. pts: array of Vector3 (local). Normal from the first three points.
   */
  poly(mat, pts, tint = this.tint) {
    tint = tintArr(tint);
    const b = this.bucket(mat);
    const n = pts.length;
    this._reserve(b, n, (n - 2) * 3);
    const m = this.matrix;
    _a.copy(pts[0]).applyMatrix4(m);
    _b.copy(pts[1]).applyMatrix4(m);
    _c.copy(pts[2]).applyMatrix4(m);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    if (_n.lengthSq() < 1e-12 && n > 3) {
      _d.copy(pts[3]).applyMatrix4(m);
      _e2.subVectors(_d, _a);
      _n.crossVectors(_e1, _e2);
    }
    _n.normalize();
    const base = b.v;
    for (let i = 0; i < n; i++) {
      _v.copy(pts[i]).applyMatrix4(m);
      this._vert(b, _v, _n, tint);
    }
    for (let i = 1; i < n - 1; i++) {
      b.idx.a[b.idx.n++] = base;
      b.idx.a[b.idx.n++] = base + i;
      b.idx.a[b.idx.n++] = base + i + 1;
    }
    this.tris += n - 2;
  }

  /** Hexahedron from 8 local corners (same order as CUBE), flat shaded. Faces can be skipped by mask bits. */
  hexa(mat, c, tint = this.tint, skip = 0) {
    for (let f = 0; f < 6; f++) {
      if (skip & (1 << f)) continue;
      const q = HEX_FACES[f];
      QUAD[0] = c[q[0]];
      QUAD[1] = c[q[1]];
      QUAD[2] = c[q[2]];
      QUAD[3] = c[q[3]];
      this.poly(mat, QUAD, tint);
    }
  }

  /** Unit cube transformed by `m` (local to the current matrix). */
  box(mat, m, tint = this.tint, skip = 0) {
    for (let i = 0; i < 8; i++) BOXC[i].set(CUBE[i][0], CUBE[i][1], CUBE[i][2]).applyMatrix4(m);
    this.hexa(mat, BOXC, tint, skip);
  }

  /** Append an arbitrary BufferGeometry (indexed or not) under local matrix `m`. Smooth normals kept. */
  geo(mat, geometry, m = null, tint = this.tint) {
    tint = tintArr(tint);
    const b = this.bucket(mat);
    const pa = geometry.attributes.position;
    let na = geometry.attributes.normal;
    if (!na) {
      geometry.computeVertexNormals();
      na = geometry.attributes.normal;
    }
    const idx = geometry.index;
    const count = pa.count;
    const icount = idx ? idx.count : count;
    this._reserve(b, count, icount);
    const full = _full.copy(this.matrix);
    if (m) full.multiply(m);
    _nm.getNormalMatrix(full);
    const base = b.v;
    for (let i = 0; i < count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(full);
      _n.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      this._vert(b, _v, _n, tint);
    }
    // a mirrored matrix flips winding
    const flip = full.determinant() < 0;
    if (idx) {
      for (let i = 0; i < icount; i += 3) {
        const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
        b.idx.a[b.idx.n++] = base + i0;
        b.idx.a[b.idx.n++] = base + (flip ? i2 : i1);
        b.idx.a[b.idx.n++] = base + (flip ? i1 : i2);
      }
    } else {
      for (let i = 0; i < icount; i += 3) {
        b.idx.a[b.idx.n++] = base + i;
        b.idx.a[b.idx.n++] = base + (flip ? i + 2 : i + 1);
        b.idx.a[b.idx.n++] = base + (flip ? i + 1 : i + 2);
      }
    }
    this.tris += icount / 3;
  }

  /**
   * Beam between two local points with a rectangular section: `up` is the direction of the
   * section's height (h), width w perpendicular to both. Optional end scale for taper.
   */
  beam(mat, p0, p1, up, w, h, tint = this.tint, taper = 1) {
    _e1.subVectors(p1, p0);
    const len = _e1.length();
    if (len < 1e-4) return;
    _e1.divideScalar(len);
    _e2.crossVectors(_e1, up).normalize(); // side
    _d.crossVectors(_e2, _e1).normalize(); // true up
    // (side, up, -along) is right-handed, so the +z cube face sits at p0
    for (let i = 0; i < 8; i++) {
      const cx = CUBE[i][0], cy = CUBE[i][1], cz = CUBE[i][2];
      const end = cz > 0 ? p0 : p1;
      const s = cz > 0 ? 1 : taper;
      BOXC[i].copy(end).addScaledVector(_e2, cx * w * s).addScaledVector(_d, cy * h * s);
    }
    this.hexa(mat, BOXC, tint);
  }

  /** Merge every bucket into one Mesh per material. */
  build(name, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, b] of this.buckets) {
      if (!b.v) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos.view(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.nrm.view(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(b.col.view(), 3));
      g.setIndex(new THREE.BufferAttribute(b.idx.a.slice(0, b.idx.n), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}:${mat.userData?.preset ?? mat.type}`;
      mesh.castShadow = castShadow && !mat.isMeshBasicMaterial;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

const QUAD = [null, null, null, null];
const TINT = [1, 1, 1];
/** Tints may be a brightness number or an [r, g, b] multiplier. */
function tintArr(t) {
  if (typeof t !== 'number') return t;
  TINT[0] = TINT[1] = TINT[2] = t;
  return TINT;
}
const BOXC = Array.from({ length: 8 }, () => new THREE.Vector3());
const _full = new THREE.Matrix4();
