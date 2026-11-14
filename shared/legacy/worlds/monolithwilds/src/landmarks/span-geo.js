// Geometry helpers for the Vertebral Span: organic "bone" sweeps, blobs, shells and small
// utilities. Everything returns indexed BufferGeometry with smooth normals, ready for the
// GeometryBuilder (which clones + normalises + transforms).

import * as THREE from 'crownfall-world-three';
import { mergeVertices } from '../core/geometry-utils.js';
import { worldNoise } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** Sample `fn(t) -> Vector3` at n points over [0,1]. */
export function curvePts(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i / (n - 1)));
  return out;
}

/** Cubic bezier through 4 Vector3 control points. */
export function bezier3(p0, p1, p2, p3) {
  return (t) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return new THREE.Vector3(
      a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      a * p0.z + b * p1.z + c * p2.z + d * p3.z,
    );
  };
}

/** Superellipse profile multiplier: p=2 ellipse, p>2 squarer. */
export function superellipse(p) {
  return (th) => {
    const c = Math.abs(Math.cos(th));
    const s = Math.abs(Math.sin(th));
    return Math.pow(Math.pow(c, p) + Math.pow(s, p), -1 / p);
  };
}

/**
 * Generalised tube along a polyline of centres ("bone" sweep).
 *   pts       Vector3[] centres (>= 2)
 *   radius    (t, k) -> [a, b]  semi-axes along the frame side S and frame up U
 *   opts.up   hint for the initial frame: S = T x up, U = S x T (parallel transported after)
 *   opts.radial      ring segments
 *   opts.profile     (theta, t) -> multiplier (non-elliptic sections)
 *   opts.lump        radial noise amplitude (fraction of radius); lumpFreq, lumpSeed
 *   opts.capStart / capEnd  close ends with a fan; capBulge pushes the cap centre outward (x radius)
 * Winding is outward (checked: T x dRing/dtheta = outward).
 */
export function sweep(pts, radius, opts = {}) {
  const {
    up = UP, radial = 12, profile = null, lump = 0, lumpFreq = 0.12, lumpSeed = 0,
    capStart = true, capEnd = true, capBulge = 0.35, twist = null, frames = null,
  } = opts;
  const n = pts.length;
  const T = [];
  const S = [];
  const U = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(n - 1, k + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  let s = new THREE.Vector3().crossVectors(T[0], up);
  if (s.lengthSq() < 1e-8) s.crossVectors(T[0], X);
  s.normalize();
  for (let k = 0; k < n; k++) {
    if (frames) {
      // explicit frames (e.g. the twisting deck): side/up supplied per point
      S.push(frames.S[k]);
      U.push(frames.U[k]);
      continue;
    }
    if (k > 0) {
      s = s.clone().addScaledVector(T[k], -s.dot(T[k]));
      if (s.lengthSq() < 1e-10) s = S[k - 1].clone();
      s.normalize();
    }
    S.push(s);
    U.push(new THREE.Vector3().crossVectors(s, T[k]).normalize());
  }

  const vCount = n * radial + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const pos = new Float32Array(vCount * 3);
  const ringA = new Float32Array(n);
  let vi = 0;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? k / (n - 1) : 0;
    const r = radius(t, k);
    const a = r[0];
    const b = r[1];
    ringA[k] = Math.max(a, b);
    const tw = twist ? twist(t) : 0;
    const P = pts[k];
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2 + tw;
      const ca = Math.cos(th);
      const sa = Math.sin(th);
      const m = profile ? profile(th, t) : 1;
      let dx = (S[k].x * ca * a + U[k].x * sa * b) * m;
      let dy = (S[k].y * ca * a + U[k].y * sa * b) * m;
      let dz = (S[k].z * ca * a + U[k].z * sa * b) * m;
      if (lump) {
        const f = 1 + lump * worldNoise.noise3((P.x + dx) * lumpFreq + lumpSeed, (P.y + dy) * lumpFreq, (P.z + dz) * lumpFreq - lumpSeed);
        dx *= f;
        dy *= f;
        dz *= f;
      }
      pos[vi++] = P.x + dx;
      pos[vi++] = P.y + dy;
      pos[vi++] = P.z + dz;
    }
  }
  let c0 = -1;
  let c1 = -1;
  if (capStart) {
    c0 = vi / 3;
    const P = pts[0];
    const d = ringA[0] * capBulge;
    pos[vi++] = P.x - T[0].x * d;
    pos[vi++] = P.y - T[0].y * d;
    pos[vi++] = P.z - T[0].z * d;
  }
  if (capEnd) {
    c1 = vi / 3;
    const P = pts[n - 1];
    const d = ringA[n - 1] * capBulge;
    pos[vi++] = P.x + T[n - 1].x * d;
    pos[vi++] = P.y + T[n - 1].y * d;
    pos[vi++] = P.z + T[n - 1].z * d;
  }

  const idx = [];
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = k * radial + j;
      const b = (k + 1) * radial + j;
      const c = k * radial + j1;
      const d = (k + 1) * radial + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capStart) for (let j = 0; j < radial; j++) idx.push(c0, j, (j + 1) % radial);
  if (capEnd) {
    const base = (n - 1) * radial;
    for (let j = 0; j < radial; j++) idx.push(c1, base + (j + 1) % radial, base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * Smooth lumpy ellipsoid ("blob") centred at the origin.
 * deform(v) may move the unit-sphere point (Vector3, mutated) before scaling.
 */
export function blob(rx, ry, rz, { ws = 20, hs = 14, lump = 0.08, freq = 0.15, seed = 0, deform = null } = {}) {
  let g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    if (deform) deform(v);
    let x = v.x * rx;
    let y = v.y * ry;
    let z = v.z * rz;
    if (lump) {
      const f = 1 + lump * worldNoise.fbm3(x * freq + seed, y * freq, z * freq - seed, 2);
      x *= f;
      y *= f;
      z *= f;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Thick parametric shell: surface(u, v) -> Vector3 over [0,1]^2, thickness th(u, v) along the
 * surface normal (both sides, half each). Produces top, bottom and the four rim strips.
 * Used for bone blades (pelvic wings, the sacral plate). Winding picks itself via a flip test.
 */
export function shell(surface, nu, nv, th) {
  const P = [];
  const N = [];
  const eps = 1e-3;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = surface(u, v);
      const pu = surface(Math.min(1, u + eps), v).sub(surface(Math.max(0, u - eps), v));
      const pv = surface(u, Math.min(1, v + eps)).sub(surface(u, Math.max(0, v - eps)));
      const n = new THREE.Vector3().crossVectors(pu, pv).normalize();
      P.push(p);
      N.push(n);
    }
  }
  const W = nu + 1;
  const pos = [];
  const idx = [];
  const addV = (p) => {
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  // top (+n) and bottom (-n) layers share nothing with the rims so edges stay crisp-ish
  const top = [];
  const bot = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const k = j * W + i;
      const h = th(i / nu, j / nv) * 0.5;
      top.push(addV(P[k].clone().addScaledVector(N[k], h)));
      bot.push(addV(P[k].clone().addScaledVector(N[k], -h)));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      // pu x pv = n  => (a, b, c) is CCW seen from +n
      idx.push(top[a], top[b], top[c], top[b], top[d], top[c]);
      idx.push(bot[a], bot[c], bot[b], bot[b], bot[c], bot[d]);
    }
  }
  // rims: walk the boundary and stitch top to bottom (outward winding by construction)
  const rim = (list) => {
    for (let q = 0; q < list.length - 1; q++) {
      const k0 = list[q];
      const k1 = list[q + 1];
      const t0 = top[k0];
      const t1 = top[k1];
      const b0 = bot[k0];
      const b1 = bot[k1];
      idx.push(t0, b0, t1, t1, b0, b1);
    }
  };
  const edgeV0 = [];
  const edgeU1 = [];
  const edgeV1 = [];
  const edgeU0 = [];
  for (let i = 0; i <= nu; i++) edgeV0.push(i);
  for (let j = 0; j <= nv; j++) edgeU1.push(j * W + nu);
  for (let i = nu; i >= 0; i--) edgeV1.push(nv * W + i);
  for (let j = nv; j >= 0; j--) edgeU0.push(j * W);
  rim(edgeV0);
  rim(edgeU1);
  rim(edgeV1);
  rim(edgeU0);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flip a geometry inside-out (for concave sockets seen from outside). */
export function invert(g) {
  const index = g.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Lathe around +Y from [[r, y], ...] with indexed smooth normals (no seam split). */
export function smoothLathe(profile, segments = 16) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  let g = new THREE.LatheGeometry(pts, segments);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

/** Deterministic hash in [0,1) for integer-ish inputs. */
export function h1(a, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Lean merge-by-material builder (same add()/build() API as core GeometryBuilder, but it never
 * clones: pieces are transformed straight into one preallocated buffer set per material at
 * build time). Shared piece geometries (boxes, cones...) can be added thousands of times.
 */
export class SpanBuilder {
  constructor() {
    this.buckets = new Map();
  }

  add(geometry, material, matrix = null, tint = null) {
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push({ g: geometry, m: matrix ? matrix.clone() : null, tint });
    return this;
  }

  build({ name = 'span', castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    group.name = name;
    const nm = new THREE.Matrix3();
    const col = new THREE.Color();
    for (const [material, list] of this.buckets) {
      let vCount = 0;
      let iCount = 0;
      for (const it of list) {
        const g = it.g;
        if (!g.attributes.normal) g.computeVertexNormals();
        vCount += g.attributes.position.count;
        iCount += g.index ? g.index.count : g.attributes.position.count;
      }
      const pos = new Float32Array(vCount * 3);
      const nor = new Float32Array(vCount * 3);
      const clr = new Float32Array(vCount * 3);
      const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
      let vo = 0;
      let io = 0;
      for (const it of list) {
        const g = it.g;
        const P = g.attributes.position;
        const N = g.attributes.normal;
        const C = g.attributes.color && g.attributes.color.itemSize === 3 ? g.attributes.color : null;
        const n = P.count;
        const e = it.m ? it.m.elements : null;
        if (e) nm.getNormalMatrix(it.m);
        const ne = nm.elements;
        let tr = 1;
        let tg = 1;
        let tb = 1;
        if (it.tint !== null && it.tint !== undefined) {
          if (typeof it.tint === 'number' && it.tint <= 4) {
            tr = tg = tb = it.tint;
          } else {
            col.set(it.tint);
            tr = col.r;
            tg = col.g;
            tb = col.b;
          }
        }
        // direct array access (all pieces use plain, non-interleaved attributes)
        const pa = P.array;
        const na = N.array;
        const ca = C ? C.array : null;
        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          const x = pa[i3];
          const y = pa[i3 + 1];
          const z = pa[i3 + 2];
          const nx = na[i3];
          const ny = na[i3 + 1];
          const nz = na[i3 + 2];
          const o = (vo + i) * 3;
          if (e) {
            pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
            pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
            const ax = ne[0] * nx + ne[3] * ny + ne[6] * nz;
            const ay = ne[1] * nx + ne[4] * ny + ne[7] * nz;
            const az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
            const l = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
            nor[o] = ax * l;
            nor[o + 1] = ay * l;
            nor[o + 2] = az * l;
          } else {
            pos[o] = x;
            pos[o + 1] = y;
            pos[o + 2] = z;
            nor[o] = nx;
            nor[o + 1] = ny;
            nor[o + 2] = nz;
          }
          if (ca) {
            clr[o] = ca[i3] * tr;
            clr[o + 1] = ca[i3 + 1] * tg;
            clr[o + 2] = ca[i3 + 2] * tb;
          } else {
            clr[o] = tr;
            clr[o + 1] = tg;
            clr[o + 2] = tb;
          }
        }
        // a mirroring matrix flips the winding; keep faces outward
        const flip = e ? it.m.determinant() < 0 : false;
        if (g.index) {
          const I = g.index.array;
          for (let k = 0; k < I.length; k += 3) {
            idx[io++] = I[k] + vo;
            idx[io++] = (flip ? I[k + 2] : I[k + 1]) + vo;
            idx[io++] = (flip ? I[k + 1] : I[k + 2]) + vo;
          }
        } else {
          for (let k = 0; k < n; k += 3) {
            idx[io++] = vo + k;
            idx[io++] = vo + (flip ? k + 2 : k + 1);
            idx[io++] = vo + (flip ? k + 1 : k + 2);
          }
        }
        vo += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vCount * 2), 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.name = `${name}:${material.userData?.preset ?? material.type}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}
