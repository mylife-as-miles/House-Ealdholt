// Needle City — geometry accumulator + templates.
//
// Hundreds of towers x dozens of pieces are emitted straight into flat typed arrays (one
// accumulator per material) and become ONE mesh per material. A per-tower "frame" matrix
// (position + lean) is set while a tower is emitted, so pieces are written in tower-local space.
//
// Oriented-beam convention (beamUp): template +Y runs along the beam, +X is the horizontal side,
// +Z is "up" (perpendicular to the beam in the vertical plane) — bridges keep their deck level.

import * as THREE from 'crownfall-world-three';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Template = flat arrays of a geometry (non-indexed input gets a trivial index). */
export function toTemplate(geometry) {
  const g = geometry;
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

/** Unit cube centred at the origin. */
export const BOX = toTemplate(new THREE.BoxGeometry(1, 1, 1));
/** Unit cube, base at y=0. */
export const BOX_BASE = toTemplate(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
/** Unit quad facing +Z, centred. */
export const QUAD = toTemplate(new THREE.PlaneGeometry(1, 1));

const prismCache = new Map();
/**
 * n-gon prism, circumradius 1 at y=0 -> k at y=1. Face 0 faces +Z (faces k at angle 2πk/n in the
 * (sin, cos) convention). Flat-shaded for n <= 8.
 */
export function prismTpl(n = 8, k = 1, caps = false) {
  const key = `${n}|${k.toFixed(3)}|${caps}`;
  let t = prismCache.get(key);
  if (!t) {
    const g = new THREE.CylinderGeometry(k, 1, 1, n, 1, !caps, -Math.PI / n);
    g.translate(0, 0.5, 0);
    t = toTemplate(n <= 8 ? g.toNonIndexed() : g);
    if (n <= 8) {
      // toNonIndexed keeps smooth normals; recompute flat ones per triangle
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
      gg.computeVertexNormals();
      t = toTemplate(gg);
    }
    prismCache.set(key, t);
  }
  return t;
}

/** Cone / spike: n-gon, radius 1 at y=0 to a point at y=1. */
export const SPIKE6 = prismTpl(6, 0.02, false);
export const SPIKE4 = prismTpl(4, 0.02, false);

/**
 * Extrude a closed 2D profile (points [x, z]) along Y from -0.5 to 0.5, sides only, flat normals
 * pointing outward. Used for the U-channel bridge decks.
 */
export function extrudeProfileY(profile) {
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const [x0, z0] = profile[i];
    const [x1, z1] = profile[(i + 1) % profile.length];
    area += x0 * z1 - x1 * z0;
  }
  const ccw = area > 0;
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let i = 0; i < profile.length; i++) {
    const [x0, z0] = profile[i];
    const [x1, z1] = profile[(i + 1) % profile.length];
    let nx = z1 - z0, nz = -(x1 - x0);
    if (!ccw) { nx = -nx; nz = -nz; }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const b = pos.length / 3;
    pos.push(x0, -0.5, z0, x1, -0.5, z1, x1, 0.5, z1, x0, 0.5, z0);
    for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
    // winding: check (v1-v0) x (v3-v0) against the normal
    const ax = x1 - x0, az = z1 - z0; // v1 - v0 (y 0)
    // v3 - v0 = (0, 1, 0); cross(a, (0,1,0)) = (-az, 0, ax)
    const cx = -az, cz = ax;
    if (cx * nx + cz * nz >= 0) idx.push(b, b + 1, b + 3, b + 1, b + 2, b + 3);
    else idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 2);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx), count: pos.length / 3 };
}

/** U-channel deck (x = width, z = up): floor 0.3 of the height, rails 0.12 of the width. */
export const CHANNEL = extrudeProfileY([
  [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.38, 0.5], [0.38, -0.2], [-0.38, -0.2], [-0.38, 0.5],
].reverse());
/** Thin 4-sided rod along Y (cables, hangers). */
export const ROD = extrudeProfileY([[0, 0.5], [0.5, 0], [0, -0.5], [-0.5, 0]]);

function tintRGB(tint, out) {
  if (tint == null) return out.setRGB(1, 1, 1);
  if (typeof tint === 'number') return out.setRGB(tint, tint, tint);
  if (Array.isArray(tint)) return out.setRGB(tint[0], tint[1], tint[2]);
  if (tint.isColor) return out.copy(tint);
  return out.set(tint);
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
  /** capV: expected vertex count (pre-sizing avoids repeated grow + GC during the build). */
  constructor(name = 'acc', capV = 8192) {
    this.name = name;
    this.P = new Float32Array(3 * capV);
    this.N = new Float32Array(3 * capV);
    this.C = new Float32Array(3 * capV);
    this.I = new Uint32Array(Math.ceil(1.6 * capV));
    this.vc = 0;
    this.ic = 0;
    this.frame = null;
  }

  setFrame(m) {
    this.frame = m;
  }

  get triangles() {
    return this.ic / 3;
  }

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

  /** Emit a template transformed by `m` (then by the current frame) with a tint. */
  emit(tpl, m, tint = 1) {
    const M = this.frame ? _m2.multiplyMatrices(this.frame, m) : m;
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
      C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
    }
    const idx = tpl.idx;
    let ic = this.ic;
    for (let k = 0; k < idx.length; k++) I[ic++] = base + idx[k];
    this.ic = ic;
    this.vc += tpl.count;
    return this;
  }

  /** Position / euler (YXZ) / scale. */
  put(tpl, x, y, z, sx, sy, sz, ry = 0, tint = 1, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return this.emit(tpl, _m, tint);
  }

  box(x, y, z, sx, sy, sz, ry = 0, tint = 1, rx = 0, rz = 0) {
    return this.put(BOX, x, y, z, sx, sy, sz, ry, tint, rx, rz);
  }

  /**
   * Template oriented from a to b (template Y along the segment, X horizontal side, Z up-ish),
   * section w (X) x h (Z). Template must span y in [-0.5, 0.5].
   */
  beamUp(tpl, ax, ay, az, bx, by, bz, w, h, tint = 1) {
    _ay.set(bx - ax, by - ay, bz - az);
    const len = _ay.length() || 1e-6;
    _ay.multiplyScalar(1 / len);
    _ax.crossVectors(_ay, UP);
    if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
    _ax.normalize();
    _az.crossVectors(_ax, _ay).normalize();
    _m.makeBasis(_ax.multiplyScalar(w), _ay.multiplyScalar(len), _az.multiplyScalar(h));
    _m.setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return this.emit(tpl, _m, tint);
  }

  /** Template with base at y=0 stood from a toward b (for prisms/spikes along an axis). */
  standAlong(tpl, ax, ay, az, bx, by, bz, r, tint = 1, yaw = 0) {
    _ay.set(bx - ax, by - ay, bz - az);
    const len = _ay.length() || 1e-6;
    _ay.multiplyScalar(1 / len);
    _q.setFromUnitVectors(UP, _ay);
    _e.set(0, yaw, 0);
    _q.multiply(_q2.setFromEuler(_e));
    _p.set(ax, ay, az);
    _s.set(r, len, r);
    _m.compose(_p, _q, _s);
    return this.emit(tpl, _m, tint);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    const nv = this.vc;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    const idx = nv > 65535 ? this.I.slice(0, this.ic) : Uint16Array.from(this.I.subarray(0, this.ic));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    // bounds in one pass (three's generic path is slow on half a million vertices)
    const P = this.P;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = 0; o < nv * 3; o += 3) {
      const x = P[o], y = P[o + 1], z = P[o + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  toMesh(material, { castShadow = true, receiveShadow = true, name } = {}) {
    if (!this.vc) return null;
    const mesh = new THREE.Mesh(this.toGeometry(), material);
    mesh.name = name || `needles:${this.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.P = this.N = this.C = this.I = null;
    return mesh;
  }
}
