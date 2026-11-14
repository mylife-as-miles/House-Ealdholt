// Unmoored Isles — geometry accumulator + "isle slot" vertex transform.
//
// Every isle bobs, drifts and turns on its own, yet the whole landmark must stay ~11 draw calls.
// So all isles share one merged mesh per material, and every vertex carries `aIsle = (a, b, w)`:
// the vertex is moved by mix(uIsleM[a], uIsleM[b], w). Slot 0 is the ground (identity); bridges
// and tether chains blend between the two things they connect, so they stretch instead of tear.
// Library materials are patched (onBeforeCompile chained after the library's own patch) so the
// object-space detail (local: true) stays glued to the rock while the isle moves.

import * as THREE from 'crownfall-world-three';

export const NSLOT = 13;

const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _slot = new Float32Array(3);

/** Flat arrays of a geometry (indexed or not) for fast repeated emission. */
export function toTemplate(geometry) {
  const g = geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  let idx;
  if (g.index) idx = Uint32Array.from(g.index.array);
  else {
    idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
  }
  return { pos: Float32Array.from(g.attributes.position.array), nrm: Float32Array.from(g.attributes.normal.array), idx, count };
}

function prismGeo(sides, k = 1, caps = true) {
  const g = new THREE.CylinderGeometry(k, 1, 1, sides, 1, !caps);
  g.translate(0, 0.5, 0);
  return sides <= 8 ? g.toNonIndexed() : g;
}

/** Shared unit templates. */
export const T = {
  box: toTemplate(new THREE.BoxGeometry(1, 1, 1)),
  boxBase: toTemplate(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  cyl6: toTemplate(prismGeo(6)),
  cyl8: toTemplate(prismGeo(8)),
  cyl12: toTemplate(prismGeo(12, 1)),
  col12: toTemplate(prismGeo(12, 0.86)),
  cone6: toTemplate(prismGeo(6, 0.0001)),
  ico0: toTemplate(new THREE.IcosahedronGeometry(1, 0)),
  ico1: toTemplate(new THREE.IcosahedronGeometry(1, 1)),
  sphere: toTemplate(new THREE.SphereGeometry(1, 12, 8)),
  // chain link: an elongated ring in the XY plane, long axis = Y, length 1 (outer)
  link: toTemplate(new THREE.TorusGeometry(0.5, 0.11, 4, 10).scale(0.62, 1.0, 1.0)),
};

const frustumCache = new Map();
/** Square frustum, base 1x1 at y=0, top k x k at y=1. */
export function frustum4(k) {
  const key = Math.round(k * 1000);
  if (!frustumCache.has(key)) {
    const g = new THREE.CylinderGeometry(k * Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, false, Math.PI / 4);
    g.translate(0, 0.5, 0);
    frustumCache.set(key, toTemplate(g.toNonIndexed()));
  }
  return frustumCache.get(key);
}

function grow(arr, need) {
  if (need <= arr.length) return arr;
  let n = arr.length * 2;
  while (n < need) n *= 2;
  const out = new arr.constructor(n);
  out.set(arr);
  return out;
}

function tintRGB(tint, out) {
  if (tint == null) return out.setRGB(1, 1, 1);
  if (typeof tint === 'number') return out.setRGB(tint, tint, tint);
  if (Array.isArray(tint)) return out.setRGB(tint[0], tint[1], tint[2]);
  if (tint.isColor) return out.copy(tint);
  return out.set(tint);
}

export class IsleAcc {
  constructor(name) {
    this.name = name;
    this.P = new Float32Array(3 * 8192);
    this.N = new Float32Array(3 * 8192);
    this.C = new Float32Array(3 * 8192);
    this.S = new Float32Array(3 * 8192);
    this.I = new Uint32Array(3 * 16384);
    this.vc = 0;
    this.ic = 0;
    this.sa = 0;
    this.sb = 0;
    this.sw = 0;
    this.slotFn = null;
  }

  get triangles() {
    return this.ic / 3;
  }

  /** Constant slot for following pieces (b/w: blend toward slot b). */
  setSlot(a, b = a, w = 0) {
    this.slotFn = null;
    this.sa = a;
    this.sb = b;
    this.sw = w;
  }

  /** Per-vertex slot: fn(x, y, z, out[3]) writes (a, b, w). */
  setSlotFn(fn) {
    this.slotFn = fn;
  }

  _reserve(nv, ni) {
    const v = (this.vc + nv) * 3;
    this.P = grow(this.P, v);
    this.N = grow(this.N, v);
    this.C = grow(this.C, v);
    this.S = grow(this.S, v);
    this.I = grow(this.I, this.ic + ni);
  }

  _slotAt(x, y, z, o) {
    if (this.slotFn) {
      this.slotFn(x, y, z, _slot);
      this.S[o] = _slot[0];
      this.S[o + 1] = _slot[1];
      this.S[o + 2] = _slot[2];
    } else {
      this.S[o] = this.sa;
      this.S[o + 1] = this.sb;
      this.S[o + 2] = this.sw;
    }
  }

  /** Emit a template through matrix m. */
  putM(tpl, m, tint = null) {
    this._reserve(tpl.count, tpl.idx.length);
    tintRGB(tint, _c);
    _nm.getNormalMatrix(m);
    const e = m.elements;
    const n = _nm.elements;
    const base = this.vc;
    for (let i = 0; i < tpl.count; i++) {
      const x = tpl.pos[i * 3], y = tpl.pos[i * 3 + 1], z = tpl.pos[i * 3 + 2];
      const o = (base + i) * 3;
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      this.P[o] = wx;
      this.P[o + 1] = wy;
      this.P[o + 2] = wz;
      const nx = tpl.nrm[i * 3], ny = tpl.nrm[i * 3 + 1], nz = tpl.nrm[i * 3 + 2];
      let tx = n[0] * nx + n[3] * ny + n[6] * nz;
      let ty = n[1] * nx + n[4] * ny + n[7] * nz;
      let tz = n[2] * nx + n[5] * ny + n[8] * nz;
      const l = Math.hypot(tx, ty, tz) || 1;
      this.N[o] = tx / l;
      this.N[o + 1] = ty / l;
      this.N[o + 2] = tz / l;
      this.C[o] = _c.r;
      this.C[o + 1] = _c.g;
      this.C[o + 2] = _c.b;
      this._slotAt(wx, wy, wz, o);
    }
    for (let i = 0; i < tpl.idx.length; i++) this.I[this.ic + i] = tpl.idx[i] + base;
    this.vc += tpl.count;
    this.ic += tpl.idx.length;
    return this;
  }

  /** Emit a template with position / euler (YXZ) / scale. */
  put(tpl, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = null) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return this.putM(tpl, _m, tint);
  }

  /** Centred box. */
  box(x, y, z, sx, sy, sz, ry = 0, tint = null) {
    return this.put(T.box, x, y, z, sx, sy, sz, 0, ry, 0, tint);
  }

  /** Add an arbitrary geometry through matrix m (null = identity). */
  geo(geometry, m = null, tint = null) {
    return this.putM(toTemplate(geometry), m || _m.identity(), tint);
  }

  /** Raw arrays (already in root space). colors optional (Float32Array rgb). */
  raw(P, N, I, C = null) {
    const nv = P.length / 3;
    this._reserve(nv, I.length);
    const base = this.vc;
    this.P.set(P, base * 3);
    this.N.set(N, base * 3);
    if (C) this.C.set(C, base * 3);
    else this.C.fill(1, base * 3, (base + nv) * 3);
    for (let i = 0; i < nv; i++) {
      const o = (base + i) * 3;
      this._slotAt(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], o);
    }
    for (let i = 0; i < I.length; i++) this.I[this.ic + i] = I[i] + base;
    this.vc += nv;
    this.ic += I.length;
    return this;
  }

  /** Build the merged mesh (null if empty). */
  toMesh(material, { castShadow = true, receiveShadow = true, depth = null, margin = 40 } = {}) {
    if (!this.vc) return null;
    const nv = this.vc;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, nv * 3), 3));
    g.setAttribute('aIsle', new THREE.BufferAttribute(this.S.slice(0, nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.I.slice(0, this.ic), 1));
    setBounds(g, g.attributes.position.array, margin);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `isles:${this.name}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    if (depth && castShadow) mesh.customDepthMaterial = depth;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

/** Bounds from a flat position array, inflated by `margin` (isles move a few metres). */
export function setBounds(g, P, margin = 0) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let o = 0; o < P.length; o += 3) {
    const x = P[o], y = P[o + 1], z = P[o + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let o = 0; o < P.length; o += 3) {
    const dx = P[o] - cx, dy = P[o + 1] - cy, dz = P[o + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - margin, y0 - margin, z0 - margin), new THREE.Vector3(x1 + margin, y1 + margin, z1 + margin));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.sqrt(r2) + margin);
}

// ---------------------------------------------------------------------------------------------
// Slot transform shader patch
// ---------------------------------------------------------------------------------------------

export const ISLE_PARS = /* glsl */ `
attribute vec3 aIsle;
uniform mat4 uIsleM[${NSLOT}];
mat4 isleMatrix() {
  int ia = int(aIsle.x + 0.5);
  int ib = int(aIsle.y + 0.5);
  return uIsleM[ia] * (1.0 - aIsle.z) + uIsleM[ib] * aIsle.z;
}
`;

const ISLE_NORMAL = /* glsl */ `
transformedNormal = normalMatrix * (mat3(isleMatrix()) * objectNormal);
#ifdef FLIP_SIDED
  transformedNormal = - transformedNormal;
#endif
`;

const ISLE_PROJECT = /* glsl */ `
vec4 isleP = isleMatrix() * vec4( transformed, 1.0 );
vec4 mvPosition = modelViewMatrix * isleP;
gl_Position = projectionMatrix * mvPosition;
`;

const ISLE_WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = modelMatrix * isleP;
#endif
`;

function isleVertex(vs) {
  return vs
    .replace('#include <common>', `#include <common>\n${ISLE_PARS}`)
    .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\n${ISLE_NORMAL}`)
    .replace('#include <project_vertex>', ISLE_PROJECT)
    .replace('#include <worldpos_vertex>', ISLE_WORLDPOS);
}

/** Shared uniform: one Matrix4 per slot (slot 0 = ground, stays identity). */
export function makeIsleUniform() {
  const value = [];
  for (let i = 0; i < NSLOT; i++) value.push(new THREE.Matrix4());
  return { value };
}

/** Chain the slot transform after a material's own onBeforeCompile (library or glow). */
export function patchIsleMaterial(mat, U) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (base) base.call(mat, shader, renderer);
    shader.uniforms.uIsleM = U;
    shader.vertexShader = isleVertex(shader.vertexShader);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|isles-slot`;
  return mat;
}

/** Shadow depth material with the same per-vertex slot motion. */
export function makeIsleDepthMaterial(U) {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uIsleM = U;
    shader.vertexShader = isleVertex(shader.vertexShader);
  };
  mat.customProgramCacheKey = () => 'isles-depth-slot';
  return mat;
}
