// Honeycomb Cloister — geometry plumbing.
//
// Acc: a flat-array accumulator (position / normal / colour + index) that thousands of pieces are
// written into directly, one per material, then turned into a single mesh (one draw call).
// Templates are plain typed arrays of a geometry (optionally with a per-vertex shade), so emitting
// a piece is just a matrix multiply in a tight loop — no BufferGeometry clones.
//
// Also: the hexagon helpers the whole landmark is built from (pointy-top hexagons: vertices at
// top and bottom, flat vertical flanks left and right).

import * as THREE from 'crownfall-world-three';

export const SQ3 = Math.sqrt(3);

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

/**
 * Geometry -> template { pos, nrm, col (per-vertex shade 0..1 or null), idx, count }.
 * `shade(x, y, z, nx, ny, nz)` optionally bakes a brightness per vertex (fake AO, dark interiors).
 */
export function toTemplate(geometry, shade = null) {
  const g = geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = Float32Array.from(g.attributes.position.array);
  const nrm = Float32Array.from(g.attributes.normal.array);
  const count = g.attributes.position.count;
  let idx;
  if (g.index) idx = Uint32Array.from(g.index.array);
  else {
    idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
  }
  let col = null;
  if (shade) {
    col = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      col[i] = shade(pos[o], pos[o + 1], pos[o + 2], nrm[o], nrm[o + 1], nrm[o + 2]);
    }
  } else if (g.attributes.color) {
    const c = g.attributes.color;
    col = new Float32Array(count);
    for (let i = 0; i < count; i++) col[i] = c.getX(i);
  }
  return { pos, nrm, col, idx, count };
}

/** Merge several templates into one (keeps per-vertex shade; missing shade = 1). */
export function mergeTemplates(list) {
  let nv = 0, ni = 0;
  for (const t of list) { nv += t.count; ni += t.idx.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv), idx = new Uint32Array(ni);
  let v = 0, i = 0;
  for (const t of list) {
    pos.set(t.pos, v * 3);
    nrm.set(t.nrm, v * 3);
    if (t.col) col.set(t.col, v);
    else col.fill(1, v, v + t.count);
    for (let k = 0; k < t.idx.length; k++) idx[i + k] = t.idx[k] + v;
    v += t.count;
    i += t.idx.length;
  }
  return { pos, nrm, col, idx, count: nv };
}

/** Template -> indexed BufferGeometry with position / normal / color (for instancing). */
export function templateGeometry(t, tint = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(t.pos.slice(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.nrm.slice(), 3));
  const c = new Float32Array(t.count * 3);
  for (let i = 0; i < t.count; i++) {
    const s = (t.col ? t.col[i] : 1) * tint;
    c[i * 3] = s; c[i * 3 + 1] = s; c[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setIndex(new THREE.BufferAttribute(t.count > 65535 ? t.idx.slice() : Uint16Array.from(t.idx), 1));
  g.computeBoundingSphere();
  return g;
}

export const T_BOX = toTemplate(new THREE.BoxGeometry(1, 1, 1));
/** Unit box with its base at y = 0. */
export const T_BOXB = toTemplate(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

/** Hexagonal prism (pointy-top in XY), circumradius 1, z in [-1, 0] (front at z=0), front cap only. */
export function hexPrismXY(capFront = true, capBack = false) {
  const P = [], N = [], I = [];
  const corners = hexCorners(1);
  let v = 0;
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = corners[k];
    const [bx, by] = corners[(k + 1) % 6];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const l = Math.hypot(mx, my);
    const nx = mx / l, ny = my / l;
    P.push(ax, ay, 0, bx, by, 0, bx, by, -1, ax, ay, -1);
    for (let q = 0; q < 4; q++) N.push(nx, ny, 0);
    I.push(v, v + 3, v + 2, v, v + 2, v + 1);
    v += 4;
  }
  const cap = (z, nz) => {
    const c0 = v;
    P.push(0, 0, z);
    N.push(0, 0, nz);
    v++;
    for (let k = 0; k < 6; k++) {
      P.push(corners[k][0], corners[k][1], z);
      N.push(0, 0, nz);
      v++;
    }
    for (let k = 0; k < 6; k++) {
      const a = c0 + 1 + k, b = c0 + 1 + ((k + 1) % 6);
      if (nz > 0) I.push(c0, a, b);
      else I.push(c0, b, a);
    }
  };
  if (capFront) cap(0, 1);
  if (capBack) cap(-1, -1);
  return rawGeometry(P, N, I);
}

/** Corners of a pointy-top hexagon of circumradius r, counter-clockwise from the right-top. */
export function hexCorners(r) {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Normalised hexagonal distance of (x, y) for a pointy-top hexagon of circumradius r (1 on the edge). */
export function hexDist(x, y, r) {
  const ax = Math.abs(x), ay = Math.abs(y);
  return Math.max(ax, ax * 0.5 + ay * (SQ3 / 2)) / (r * (SQ3 / 2));
}

export function rawGeometry(P, N, I, C = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (C) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

// ---------------------------------------------------------------------------
// matrices
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose into `out` (default: a shared scratch matrix — copy it if you keep it). */
const _scratch = new THREE.Matrix4();
export function mtx(x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1, out = _scratch) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

// ---------------------------------------------------------------------------
// accumulator
// ---------------------------------------------------------------------------

function grow(arr, need) {
  if (need <= arr.length) return arr;
  let n = arr.length * 2;
  while (n < need) n *= 2;
  const out = new arr.constructor(n);
  out.set(arr);
  return out;
}

const _nm = new THREE.Matrix3();

export class Acc {
  constructor(name) {
    this.name = name;
    this.P = new Float32Array(3 * 8192);
    this.N = new Float32Array(3 * 8192);
    this.C = new Float32Array(3 * 8192);
    this.I = new Uint32Array(3 * 8192);
    this.vc = 0;
    this.ic = 0;
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

  /**
   * Emit a template transformed by matrix `m` (THREE.Matrix4). `tint` = number or [r,g,b].
   * The template's per-vertex shade multiplies the tint.
   */
  put(t, m, tint = 1) {
    const base = this.reserve(t.count, t.idx.length);
    const e = m.elements;
    _nm.getNormalMatrix(m);
    const n = _nm.elements;
    const tr = Array.isArray(tint) ? tint[0] : tint;
    const tg = Array.isArray(tint) ? tint[1] : tint;
    const tb = Array.isArray(tint) ? tint[2] : tint;
    const P = this.P, N = this.N, C = this.C;
    const sp = t.pos, sn = t.nrm, sc = t.col;
    for (let i = 0; i < t.count; i++) {
      const o = i * 3;
      const x = sp[o], y = sp[o + 1], z = sp[o + 2];
      const d = (base + i) * 3;
      P[d] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[d + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[d + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = sn[o], ny = sn[o + 1], nz = sn[o + 2];
      let ax = n[0] * nx + n[3] * ny + n[6] * nz;
      let ay = n[1] * nx + n[4] * ny + n[7] * nz;
      let az = n[2] * nx + n[5] * ny + n[8] * nz;
      const l = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
      N[d] = ax * l; N[d + 1] = ay * l; N[d + 2] = az * l;
      const s = sc ? sc[i] : 1;
      C[d] = tr * s; C[d + 1] = tg * s; C[d + 2] = tb * s;
    }
    const I = this.I;
    for (let k = 0; k < t.idx.length; k++) I[this.ic + k] = t.idx[k] + base;
    this.ic += t.idx.length;
    this.vc += t.count;
    return this;
  }

  /** Box centred at (x,y,z), size (sx,sy,sz), yaw about Y then pitch about X. */
  box(x, y, z, sx, sy, sz, yaw = 0, tint = 1, pitch = 0, roll = 0) {
    return this.put(T_BOX, mtx(x, y, z, yaw, pitch, roll, sx, sy, sz), tint);
  }

  /** Raw quad (4 corners in order, counter-clockwise seen from the front) with a flat normal. */
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, tint = 1) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= l; ny *= l; nz *= l;
    const base = this.reserve(4, 6);
    const P = this.P, N = this.N, C = this.C;
    const pts = [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz];
    const tr = Array.isArray(tint) ? tint[0] : tint;
    const tg = Array.isArray(tint) ? tint[1] : tint;
    const tb = Array.isArray(tint) ? tint[2] : tint;
    for (let i = 0; i < 4; i++) {
      const d = (base + i) * 3;
      P[d] = pts[i * 3]; P[d + 1] = pts[i * 3 + 1]; P[d + 2] = pts[i * 3 + 2];
      N[d] = nx; N[d + 1] = ny; N[d + 2] = nz;
      C[d] = tr; C[d + 1] = tg; C[d + 2] = tb;
    }
    const I = this.I;
    I[this.ic++] = base; I[this.ic++] = base + 1; I[this.ic++] = base + 2;
    I[this.ic++] = base; I[this.ic++] = base + 2; I[this.ic++] = base + 3;
    this.vc += 4;
    return this;
  }

  toGeometry() {
    if (!this.ic) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, this.vc * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, this.vc * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, this.vc * 3), 3));
    const I = this.vc > 65535 ? this.I.slice(0, this.ic) : Uint16Array.from(this.I.subarray(0, this.ic));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    setBounds(g, g.attributes.position.array, this.vc);
    return g;
  }

  toMesh(material, { castShadow = true, receiveShadow = true } = {}) {
    const g = this.toGeometry();
    if (!g) return null;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `monastery:${this.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** Bounding box + sphere from a flat position array. */
export function setBounds(g, P, nv = P.length / 3) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let o = 0; o < nv * 3; o += 3) {
    const x = P[o], y = P[o + 1], z = P[o + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
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
