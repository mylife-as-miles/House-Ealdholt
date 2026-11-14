// Descending Temple — geometry accumulator.
//
// Thousands of boxes / columns / steps are emitted straight into flat arrays (no per-piece
// BufferGeometry clones), one accumulator per material, then turned into a single mesh each.
// A "frame" matrix can be set so the whole tilted tier mass is baked in the same site-local
// space as the untilted plinth — everything with one material stays one draw call.

import * as THREE from 'crownfall-world-three';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Template = flat arrays of a geometry, reusable by emit(). */
export function toTemplate(geometry) {
  let g = geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position.array;
  const nrm = g.attributes.normal.array;
  let idx;
  if (g.index) idx = g.index.array;
  else {
    idx = new Uint32Array(g.attributes.position.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx), count: g.attributes.position.count };
}

/** Unit cube centred at origin (flat normals). */
export const BOX = toTemplate(new THREE.BoxGeometry(1, 1, 1));
/** Unit cube with its base at y=0 (x,z centred). */
export const BOX_BASE = toTemplate(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

/** Downward-facing unit quad (3x3 verts) whose vertex brightness falls off from the centre. */
export const BLOB_DOWN = (() => {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(Math.PI / 2);
  const t = toTemplate(g);
  t.col = new Float32Array(t.count);
  for (let v = 0; v < t.count; v++) {
    const x = Math.abs(t.pos[v * 3]), z = Math.abs(t.pos[v * 3 + 2]);
    t.col[v] = x < 0.01 && z < 0.01 ? 1 : x < 0.01 || z < 0.01 ? 0.3 : 0.02;
  }
  return t;
})();

/** Square frustum (4-sided), base 1x1 at y=0, top `k`x`k` at y=1. Flat normals. */
export function frustumTemplate(k) {
  const g = new THREE.CylinderGeometry(k * Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, false, Math.PI / 4);
  g.translate(0, 0.5, 0);
  return toTemplate(g.toNonIndexed());
}

/** Octagonal (or n-gon) prism, radius 1 at base -> k at top, y in [0,1], no caps. */
export function prismTemplate(sides = 8, k = 1, caps = false) {
  const g = new THREE.CylinderGeometry(k, 1, 1, sides, 1, !caps);
  g.translate(0, 0.5, 0);
  return toTemplate(sides <= 8 ? g.toNonIndexed() : g);
}

function tintRGB(tint, out) {
  if (tint == null) return out.setRGB(1, 1, 1);
  if (typeof tint === 'number') return out.setRGB(tint, tint, tint);
  if (Array.isArray(tint)) return out.setRGB(tint[0], tint[1], tint[2]);
  if (tint.isColor) return out.copy(tint);
  return out.set(tint);
}

/** Bounding box + sphere straight from a flat position array (three's generic path is slow). */
export function setBounds(g, P, nv = P.length / 3) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let o = 0; o < nv * 3; o += 3) {
    const x = P[o], y = P[o + 1], z = P[o + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let o = 0; o < nv * 3; o += 3) {
    const dx = P[o] - cx, dy = P[o + 1] - cy, dz = P[o + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.sqrt(r2));
}

function grow(arr, need) {
  if (need <= arr.length) return arr;
  let n = arr.length * 2;
  while (n < need) n *= 2;
  const out = new arr.constructor(n);
  out.set(arr);
  return out;
}

export class Acc {
  constructor(name = 'acc') {
    this.name = name;
    this.P = new Float32Array(3 * 4096);
    this.N = new Float32Array(3 * 4096);
    this.C = new Float32Array(3 * 4096);
    this.I = new Uint32Array(6 * 4096);
    this.vc = 0;
    this.ic = 0;
    this.frame = null;
  }

  /** Set (or clear with null) a matrix applied after every piece's own transform. */
  setFrame(m) {
    this.frame = m;
  }

  get triangles() {
    return this.ic / 3;
  }

  /** Reserve room for nv more vertices / ni more indices; returns the first vertex index. */
  reserve(nv, ni) {
    const v = this.vc + nv;
    if (v * 3 > this.P.length) {
      this.P = grow(this.P, v * 3);
      this.N = grow(this.N, v * 3);
      this.C = grow(this.C, v * 3);
    }
    if (this.ic + ni > this.I.length) this.I = grow(this.I, this.ic + ni);
    return this.vc;
  }

  /** Raw vertex (already in final space). */
  vert(x, y, z, nx, ny, nz, r, g, b) {
    const o = this.vc * 3;
    const P = this.P, N = this.N, C = this.C;
    P[o] = x; P[o + 1] = y; P[o + 2] = z;
    N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
    C[o] = r; C[o + 1] = g; C[o + 2] = b;
    return this.vc++;
  }

  index(a) {
    this.I[this.ic++] = a;
  }

  /** Emit a template transformed by matrix `m` (Matrix4) with a tint. */
  emit(tpl, m, tint = 1) {
    let M = m;
    if (this.frame) M = _m2.multiplyMatrices(this.frame, m);
    const e = M.elements;
    _nm.getNormalMatrix(M);
    const n = _nm.elements;
    tintRGB(tint, _c);
    const cr = _c.r, cg = _c.g, cb = _c.b;
    const base = this.reserve(tpl.count, tpl.idx.length);
    const P = this.P, N = this.N, C = this.C, I = this.I;
    const pos = tpl.pos, nrm = tpl.nrm;
    let o = base * 3;
    for (let v = 0; v < tpl.count; v++, o += 3) {
      const k = v * 3;
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = nrm[k], ny = nrm[k + 1], nz = nrm[k + 2];
      const ox = n[0] * nx + n[3] * ny + n[6] * nz;
      const oy = n[1] * nx + n[4] * ny + n[7] * nz;
      const oz = n[2] * nx + n[5] * ny + n[8] * nz;
      const l = 1 / (Math.sqrt(ox * ox + oy * oy + oz * oz) || 1);
      N[o] = ox * l; N[o + 1] = oy * l; N[o + 2] = oz * l;
      if (tpl.col) {
        const f = tpl.col[v];
        C[o] = cr * f; C[o + 1] = cg * f; C[o + 2] = cb * f;
      } else {
        C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
      }
    }
    const idx = tpl.idx;
    let ic = this.ic;
    for (let k = 0; k < idx.length; k++) I[ic++] = base + idx[k];
    this.ic = ic;
    this.vc += tpl.count;
    return this;
  }

  /** Emit a template with position / euler rotation (YXZ) / scale. */
  put(tpl, x, y, z, sx, sy, sz, ry = 0, tint = 1, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return this.emit(tpl, _m, tint);
  }

  /** Centred box. */
  box(x, y, z, sx, sy, sz, ry = 0, tint = 1, rx = 0, rz = 0) {
    return this.put(BOX, x, y, z, sx, sy, sz, ry, tint, rx, rz);
  }

  /** Axis-aligned box from min/max corners (in the current frame). */
  aabb(x0, y0, z0, x1, y1, z1, tint = 1) {
    return this.put(BOX, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, tint);
  }

  /** Box oriented along the segment a->b (section w x d), e.g. trunks, chains. */
  beam(ax, ay, az, bx, by, bz, w, d, tint = 1, tpl = BOX) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    _p.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_s.set(0, 1, 0), _p);
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(w, len, d);
    _m.compose(_p, _q, _s);
    return this.emit(tpl, _m, tint);
  }

  /** Append an arbitrary BufferGeometry (converted once; cache the template yourself for repeats). */
  geo(geometry, m, tint = 1) {
    return this.emit(toTemplate(geometry), m, tint);
  }

  /** Build a THREE.BufferGeometry. */
  toGeometry() {
    const g = new THREE.BufferGeometry();
    const nv = this.vc;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    const idx = nv > 65535 ? this.I.slice(0, this.ic) : Uint16Array.from(this.I.subarray(0, this.ic));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    setBounds(g, this.P, nv);
    return g;
  }

  /** Mesh for this accumulator (null if empty). Frees the arrays. */
  toMesh(material, { castShadow = true, receiveShadow = true, name } = {}) {
    if (!this.vc) return null;
    const mesh = new THREE.Mesh(this.toGeometry(), material);
    mesh.name = name || `temple:${this.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    this.P = this.N = this.C = this.I = null;
    return mesh;
  }
}

/**
 * Wall slab in the XY plane (x across, y up) with polygonal holes, extruded along z (depth),
 * front face at z=+depth/2. holes: arrays of [x,y] points (any winding).
 */
export function wallWithHoles(width, height, depth, holes) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    path.moveTo(h[0][0], h[0][1]);
    for (let k = 1; k < h.length; k++) path.lineTo(h[k][0], h[k][1]);
    path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Points of an arched opening (semicircular or pointed head) for wallWithHoles. */
export function archHole(cx, y0, w, spring, segs = 8, pointed = 0) {
  const r = w / 2;
  const pts = [[cx - r, y0], [cx + r, y0], [cx + r, y0 + spring]];
  for (let k = 1; k < segs; k++) {
    const a = (Math.PI * k) / segs;
    let px = Math.cos(a) * r;
    let py = Math.sin(a) * r;
    if (pointed) py += pointed * r * 0.5 * (1 - Math.abs(Math.cos(a)));
    pts.push([cx + px, y0 + spring + py]);
  }
  pts.push([cx - r, y0 + spring]);
  return pts;
}

/** Trapezoidal (battered) doorway: bottom width w, top width w*k. */
export function trapHole(cx, y0, w, h, k = 0.72) {
  return [[cx - w / 2, y0], [cx + w / 2, y0], [cx + (w * k) / 2, y0 + h], [cx - (w * k) / 2, y0 + h]];
}
