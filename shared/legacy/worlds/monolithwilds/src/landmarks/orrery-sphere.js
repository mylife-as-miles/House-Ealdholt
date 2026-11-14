// The core: a ~100 m masonry sphere split into drifting plates. The plates are Voronoi cells of
// a finely subdivided icosphere; triangles near cell borders are dropped (the cracks) and every
// exposed border gets a wall down into the sphere, so the seams read as deep fissures. A slightly
// smaller glowing core shows through them. Bronze hoops bind the broken world together and bronze
// bearings cap the poles (local ±X, where ring F's axles enter).

import * as THREE from 'crownfall-world-three';
import { makeProfile, sweep } from './orrery-mesh.js';

const TAU = Math.PI * 2;

export function buildSphere(S, RS, rng, noise) {
  // --- plates -------------------------------------------------------------
  const ico = new THREE.IcosahedronGeometry(1, 23); // non-indexed, 20 * 24^2 triangles
  const P = ico.attributes.position.array;
  const triCount = P.length / 9;

  // weld vertices so plates can share them and borders can be found: sort corner indices by a
  // quantised position key (no Map of non-integer keys — that is slow and GC-heavy)
  const nc = triCount * 3;
  const keys = new Float64Array(nc);
  for (let i = 0; i < nc; i++) {
    keys[i] = ((Math.round(P[i * 3] * 4000) + 4001) * 8003 + (Math.round(P[i * 3 + 1] * 4000) + 4001)) * 8003 + (Math.round(P[i * 3 + 2] * 4000) + 4001);
  }
  const order = new Uint32Array(nc);
  for (let i = 0; i < nc; i++) order[i] = i;
  order.sort((a, b) => keys[a] - keys[b]);
  const tri = new Int32Array(nc);
  const verts = [];
  let lastKey = -1;
  let id = -1;
  for (let j = 0; j < nc; j++) {
    const i = order[j];
    if (keys[i] !== lastKey) {
      lastKey = keys[i];
      id++;
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      verts.push(x / l, y / l, z / l);
    }
    tri[i] = id;
  }
  const nVerts = id + 1;
  ico.dispose();

  // seeds: fairly even (jittered Fibonacci sphere) so plates have similar sizes
  const NS = 46;
  const seeds = [];
  for (let i = 0; i < NS; i++) {
    const y = 1 - (2 * (i + 0.5)) / NS;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + rng.range(-0.35, 0.35);
    const v = new THREE.Vector3(Math.cos(a) * r, y + rng.range(-0.08, 0.08), Math.sin(a) * r).normalize();
    seeds.push(v);
  }
  // per-plate: radial offset (some plates lifted — the sphere is coming apart), tint, tilt
  const plate = seeds.map((s, i) => ({
    off: rng.chance(0.18) ? rng.range(1.4, 3.2) : rng.range(-0.6, 0.8),
    tint: rng.range(0.7, 0.98),
    tiltAxis: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(),
    tilt: rng.chance(0.25) ? rng.range(0.004, 0.018) : 0,
    seed: s,
    i,
  }));
  // poles are bearings: keep two plates centred there, never lifted
  seeds[0].set(1, 0, 0);
  seeds[1].set(-1, 0, 0);
  plate[0].off = 0.2;
  plate[1].off = 0.2;
  plate[0].tilt = plate[1].tilt = 0;

  const triPlate = new Int32Array(triCount).fill(-1);
  for (let t = 0; t < triCount; t++) {
    const a = tri[t * 3];
    const b = tri[t * 3 + 1];
    const c = tri[t * 3 + 2];
    const cx = (verts[a * 3] + verts[b * 3] + verts[c * 3]) / 3;
    const cy = (verts[a * 3 + 1] + verts[b * 3 + 1] + verts[c * 3 + 1]) / 3;
    const cz = (verts[a * 3 + 2] + verts[b * 3 + 2] + verts[c * 3 + 2]) / 3;
    const cl = Math.hypot(cx, cy, cz);
    let d1 = -2;
    let d2 = -2;
    let pi = 0;
    for (let i = 0; i < NS; i++) {
      const sd = seeds[i];
      const d = (sd.x * cx + sd.y * cy + sd.z * cz) / cl;
      if (d > d1) {
        d2 = d1;
        d1 = d;
        pi = i;
      } else if (d > d2) d2 = d;
    }
    // angular gap between the two nearest seeds; crack width varies along the seam (wider where
    // plates have lifted)
    const gap = Math.acos(Math.min(1, d2)) - Math.acos(Math.min(1, d1));
    const nn = 0.5 + 0.5 * noise.noise3(cx * 2.3, cy * 2.3, cz * 2.3);
    const w = 0.007 + 0.03 * nn * nn * nn + (plate[pi].off > 1.2 ? 0.014 : 0);
    if (gap < w) continue;
    triPlate[t] = pi;
  }

  // edge adjacency to find borders
  const edgeKey = (a, b) => (a < b ? a * nVerts + b : b * nVerts + a);
  const edgeOwner = new Map();
  for (let t = 0; t < triCount; t++) {
    if (triPlate[t] < 0) continue;
    for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e];
      const b = tri[t * 3 + ((e + 1) % 3)];
      const k = edgeKey(a, b);
      const o = edgeOwner.get(k);
      if (o === undefined) edgeOwner.set(k, t);
      else edgeOwner.set(k, -2 - (triPlate[o] === triPlate[t] ? 0 : 1)); // shared: -2 same plate, -3 different
    }
  }

  const sink = S.marble;
  const vPlateIdx = new Int32Array(nVerts * NS).fill(-1); // (vertex, plate) -> sink index
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const posOf = (vi, pl) => {
    _p.set(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
    if (pl.tilt) _p.applyQuaternion(_q.setFromAxisAngle(pl.tiltAxis, pl.tilt));
    // gentle hammered relief so each plate is not a perfect cap
    const n = noise.noise3(_p.x * 4.2 + pl.i, _p.y * 4.2, _p.z * 4.2) * 0.35 + noise.noise3(_p.x * 11, _p.y * 11, _p.z * 11) * 0.12;
    return RS + pl.off + n;
  };
  const outV = (vi, pi) => {
    const key = vi * NS + pi;
    let id = vPlateIdx[key];
    if (id >= 0) return id;
    const pl = plate[pi];
    const r = posOf(vi, pl);
    _p.set(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
    if (pl.tilt) _p.applyQuaternion(_q.setFromAxisAngle(pl.tiltAxis, pl.tilt));
    const x = _p.x;
    const y = _p.y;
    const z = _p.z;
    const t = pl.tint;
    id = sink.v(x * r, y * r, z * r, x, y, z, t, t * 0.98, t * 0.95);
    vPlateIdx[key] = id;
    return id;
  };
  sink.reserve(triCount * 2, triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const pi = triPlate[t];
    if (pi < 0) continue;
    sink.t(outV(tri[t * 3], pi), outV(tri[t * 3 + 1], pi), outV(tri[t * 3 + 2], pi));
  }
  // walls on borders
  const inner = RS - 5.5;
  const wall = (a, b, pi) => {
    const pa = sink.nv;
    const ia = outV(a, pi);
    const ib = outV(b, pi);
    const ax = sink.pos[ia * 3], ay = sink.pos[ia * 3 + 1], az = sink.pos[ia * 3 + 2];
    const bx = sink.pos[ib * 3], by = sink.pos[ib * 3 + 1], bz = sink.pos[ib * 3 + 2];
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const aix = (ax / la) * inner, aiy = (ay / la) * inner, aiz = (az / la) * inner;
    const bix = (bx / lb) * inner, biy = (by / lb) * inner, biz = (bz / lb) * inner;
    // face normal of (a_out, a_in, b_in)
    const e1x = aix - ax, e1y = aiy - ay, e1z = aiz - az;
    const e2x = bix - ax, e2y = biy - ay, e2z = biz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const tt = plate[pi].tint * 0.55;
    const v0 = sink.v(ax, ay, az, nx, ny, nz, tt, tt, tt);
    const v1 = sink.v(aix, aiy, aiz, nx, ny, nz, tt * 0.5, tt * 0.36, tt * 0.25);
    const v2 = sink.v(bix, biy, biz, nx, ny, nz, tt * 0.5, tt * 0.36, tt * 0.25);
    const v3 = sink.v(bx, by, bz, nx, ny, nz, tt, tt, tt);
    sink.q(v0, v1, v2, v3);
    return pa;
  };
  for (let t = 0; t < triCount; t++) {
    const pi = triPlate[t];
    if (pi < 0) continue;
    for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e];
      const b = tri[t * 3 + ((e + 1) % 3)];
      const o = edgeOwner.get(edgeKey(a, b));
      if (o >= 0 || o === -3) wall(a, b, pi);
    }
  }

  // --- glowing core ----------------------------------------------------------
  const m = new THREE.Matrix4();
  const core = new THREE.IcosahedronGeometry(1, 5);
  core.computeVertexNormals();
  m.makeScale(RS - 3.6, RS - 3.6, RS - 3.6);
  S.glow.add(core, m, [1.0, 0.8, 0.55]);
  core.dispose();

  // --- bronze hoops binding the plates -----------------------------------------
  const hoopPr = makeProfile(
    [
      [-0.2, -2.2], [1.6, -2.2], [2.2, -1.4], [2.2, 1.4], [1.6, 2.2], [-0.2, 2.2],
    ],
    null,
    'bronze',
  );
  const hoops = [
    // [rotation about X, rotation about Z, arc start, arc length] — one hoop is snapped
    [0, Math.PI / 2, 0, TAU],
    [0.9, Math.PI / 2 - 0.55, 0.3, TAU * 0.72],
    [-0.75, Math.PI / 2 + 0.45, 2.1, TAU],
  ];
  for (const [rx, rz, a0, len] of hoops) {
    const start = S.bronze.nv;
    sweep({ bronze: S.bronze }, hoopPr, RS + 1.4, a0, a0 + len, 160, { caps: len < TAU - 0.01 });
    // rivets
    for (let i = 0; i < 48; i++) {
      const a = a0 + (i / 48) * len;
      m.compose(new THREE.Vector3(Math.cos(a) * (RS + 3.7), 0, Math.sin(a) * (RS + 3.7)), new THREE.Quaternion(), new THREE.Vector3(0.9, 0.9, 0.9));
      S.bronze.add(RIVET, m);
    }
    // hoops lie in a plane containing the pole axis (X) or crossing it; rotate into place
    m.makeRotationFromEuler(new THREE.Euler(rx, 0, rz, 'XYZ'));
    S.bronze.transformFrom(start, m);
  }

  // --- pole bearings (local ±X) ----------------------------------------------
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  for (const sgn of [1, -1]) {
    m.compose(new THREE.Vector3(sgn * (RS + 1.2), 0, 0), q, new THREE.Vector3(10.5, 6, 10.5));
    S.bronze.add(cyl, m);
    m.compose(new THREE.Vector3(sgn * (RS + 3.8), 0, 0), q, new THREE.Vector3(7, 3, 7));
    S.stone.add(cyl, m, 0.9);
    // bearing ribs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      m.compose(
        new THREE.Vector3(sgn * (RS - 0.5), Math.cos(a) * 11, Math.sin(a) * 11),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)),
        new THREE.Vector3(7, 2.2, 1.6),
      );
      S.bronze.add(BOX, m, 0.9);
    }
  }
  cyl.dispose();

  // --- shards: fragments of lifted plates hanging a few metres off the surface -------------
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    if (Math.abs(d.x) > 0.8) continue; // keep the poles clear for the axles
    const r = RS + rng.range(3.5, 6);
    const s = rng.range(1.0, 2.4);
    m.compose(d.multiplyScalar(r), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0)), new THREE.Vector3(s * 1.6, s * 0.6, s));
    S.dark.add(SHARD, m, rng.range(0.8, 1.0));
  }
}

const RIVET = new THREE.IcosahedronGeometry(1, 0);
const SHARD = RIVET;
const BOX = new THREE.BoxGeometry(1, 1, 1);
