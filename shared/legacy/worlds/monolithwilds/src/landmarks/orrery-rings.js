// The six rings and their furniture, each built in its own ring-local frame (ring in the local XZ
// plane, rotation axis = local Y; parent pins at local ±X, child axles at local ±Z).
//
// Construction system: every ring is a chain of voussoirs (swept cross-sections separated by
// recessed joints), banded with bronze clamps at sector boundaries, a glyph belt running round a
// recessed face, tick marks on the flat faces (1 degree / 5 / sector) and one bronze sign per
// sector of a vanished calendar. Each ring breaks the system somewhere: missing voussoirs whose
// fragments still hover in place, a tooth-rim, an openwork lattice, a crown of gnomons.
//
// Radial shells (centre distance, including everything attached) never overlap, so the nested
// rings can turn freely without touching (see SHELLS in orrery.js).

import * as THREE from 'crownfall-world-three';
import { makeProfile, scaleProfile, sweep, ringFrame, h1, UNIT_BOX } from './orrery-mesh.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _Yup = new THREE.Vector3(0, 1, 0);

// shared primitive geometries (never disposed; tiny)
const G = {
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cyl20: new THREE.CylinderGeometry(1, 1, 1, 20, 1),
  cyl32: new THREE.CylinderGeometry(1, 1, 1, 32, 1),
  tri: new THREE.CylinderGeometry(1, 1, 1, 3, 1),
  sph: new THREE.SphereGeometry(1, 28, 18),
  sphLo: new THREE.SphereGeometry(1, 14, 10),
  ico: new THREE.IcosahedronGeometry(1, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  cone6: new THREE.ConeGeometry(1, 1, 6, 1),
};
// faceted primitives: split normals
for (const k of ['cyl6', 'cyl8', 'tri', 'cone6', 'ico', 'ico0']) G[k] = G[k].index ? G[k].toNonIndexed() : G[k];
for (const k of ['cyl6', 'cyl8', 'tri', 'ico', 'ico0', 'cone6']) G[k].computeVertexNormals();

/** Tapered strut from a to b (Vector3-like arrays), radii r0 -> r1, `geo` = cylinder of radius 1, height 1. */
export function strut(sink, a, b, r0, r1, geo = G.cyl8, tint = 1) {
  _v0.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _v0.length();
  if (len < 1e-3) return;
  _v0.divideScalar(len);
  _q.setFromUnitVectors(_Yup, _v0);
  // taper: scale a unit cylinder, then pinch the top by editing a temp copy is costly; instead
  // build from CylinderGeometry with explicit radii when tapered.
  if (Math.abs(r0 - r1) > 1e-3) {
    const key = `${geo.parameters?.radialSegments ?? 8}`;
    const g = taperCache(key, r1 / r0, geo);
    _m.compose(_v1.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r0, len, r0));
    sink.add(g, _m, tint);
  } else {
    _m.compose(_v1.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r0, len, r0));
    sink.add(geo, _m, tint);
  }
}
const _taper = new Map();
function taperCache(key, ratio, geo) {
  const k = `${key}|${ratio.toFixed(2)}`;
  let g = _taper.get(k);
  if (!g) {
    const segs = geo.parameters?.radialSegments ?? 8;
    g = new THREE.CylinderGeometry(ratio, 1, 1, segs, 1);
    if (segs <= 8) {
      g = g.toNonIndexed();
      g.computeVertexNormals();
    }
    _taper.set(k, g);
  }
  return g;
}

/** Add a primitive with a local frame matrix F and a local TRS (pos, euler, scale). */
function put(sink, geo, F, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = 1) {
  _m2.makeRotationFromEuler(_eul.set(rx, ry, rz, 'YXZ'));
  _m2.scale(_s.set(sx, sy, sz));
  _m2.setPosition(x, y, z);
  _m.multiplyMatrices(F, _m2);
  sink.add(geo, _m, tint);
}
const _eul = new THREE.Euler();

// ---------------------------------------------------------------------------
// Calendar signs: bronze reliefs built from discs, rings, arcs, bars and dots. Each sector's sign
// is derived from a hash, so the calendar has an internal grammar (a frame + a core + satellites +
// rays) but no two signs repeat.
// ---------------------------------------------------------------------------

const _sigF = new THREE.Matrix4();
/** Relief sign in the XZ plane of frame F (F's +Y = out of the face). size = overall diameter. */
export function sigil(sink, F, size, seed, tint = 1, h = 0.7) {
  const r = size / 2;
  const k = (i) => h1(seed * 31 + i, 977);
  _sigF.copy(F);
  const arcRect = (rad, w, a0, a1, hh = h) => {
    // flat arc band in the frame's XZ plane: sweep a small rectangle around the frame's Y
    const pr = arcProfile(w, hh);
    const start = sink.nv;
    const steps = Math.max(3, Math.ceil(((a1 - a0) * rad) / (size * 0.08)));
    const tmp = { s: sink };
    sweep(tmp, pr, rad, a0, a1, steps, { tint, capMat: 's', caps: a1 - a0 < TAU - 1e-3 });
    sink.transformFrom(start, _sigF);
  };
  const frame = k(0);
  if (frame < 0.45) arcRect(r * 0.92, r * 0.1, 0, TAU);
  else if (frame < 0.65) {
    arcRect(r * 0.95, r * 0.06, 0, TAU);
    arcRect(r * 0.78, r * 0.05, 0, TAU);
  } else if (frame < 0.8) {
    // broken frame: a C
    const a0 = k(1) * TAU;
    arcRect(r * 0.9, r * 0.1, a0, a0 + TAU * 0.78);
  }
  const core = Math.floor(k(2) * 6);
  if (core === 0) put(sink, G.cyl20, _sigF, 0, h * 0.6, 0, r * 0.32, h * 1.2, r * 0.32, 0, 0, 0, tint);
  else if (core === 1) {
    // crescent
    const a0 = k(3) * TAU;
    arcRect(r * 0.34, r * 0.16, a0, a0 + Math.PI * 1.1, h * 1.3);
  } else if (core === 2) {
    put(sink, G.tri, _sigF, 0, h * 0.6, 0, r * 0.42, h * 1.2, r * 0.42, 0, k(4) * TAU, 0, tint);
  } else if (core === 3) {
    put(sink, UNIT_BOX, _sigF, 0, h * 0.6, 0, r * 1.3, h * 1.2, r * 0.12, 0, k(5) * Math.PI, 0, tint);
    put(sink, UNIT_BOX, _sigF, 0, h * 0.6, 0, r * 0.12, h * 1.2, r * 0.9, 0, k(5) * Math.PI, 0, tint);
  } else if (core === 4) {
    arcRect(r * 0.3, r * 0.1, 0, TAU, h * 1.3);
    put(sink, G.cyl12, _sigF, 0, h * 0.8, 0, r * 0.1, h * 1.6, r * 0.1, 0, 0, 0, tint);
  } else {
    // two interlocked discs (a binary)
    put(sink, G.cyl20, _sigF, -r * 0.18, h * 0.6, 0, r * 0.2, h * 1.2, r * 0.2, 0, 0, 0, tint);
    put(sink, G.cyl20, _sigF, r * 0.22, h * 0.5, 0, r * 0.13, h, r * 0.13, 0, 0, 0, tint);
  }
  // satellites: dots on an orbit, sometimes with the orbit drawn
  const nSat = Math.floor(k(6) * 5);
  const orbit = r * (0.55 + 0.18 * k(7));
  if (nSat > 0 && k(8) > 0.5) arcRect(orbit, r * 0.035, 0, TAU, h * 0.6);
  const sa = k(9) * TAU;
  for (let i = 0; i < nSat; i++) {
    const a = sa + (i / Math.max(nSat, 1)) * TAU * (k(10) > 0.5 ? 1 : 0.5);
    const sr = r * (0.06 + 0.07 * k(11 + i));
    put(sink, G.cyl12, _sigF, Math.cos(a) * orbit, h * 0.7, Math.sin(a) * orbit, sr, h * 1.4, sr, 0, 0, 0, tint);
  }
  // rays
  const nRay = k(20) > 0.55 ? 3 + Math.floor(k(21) * 6) : 0;
  const ra = k(22) * TAU;
  for (let i = 0; i < nRay; i++) {
    const a = ra + (i / nRay) * TAU;
    const rr = r * (0.7 + 0.15 * (i % 2));
    put(sink, UNIT_BOX, _sigF, Math.cos(a) * rr, h * 0.5, Math.sin(a) * rr, r * 0.26, h, r * 0.06, 0, -a, 0, tint);
  }
}
const _arcProfiles = new Map();
function arcProfile(w, hh) {
  const k = `${w.toFixed(2)}|${hh.toFixed(2)}`;
  let p = _arcProfiles.get(k);
  if (!p) {
    p = makeProfile(
      [
        [-w / 2, 0],
        [w / 2, 0],
        [w / 2, hh * 0.7],
        [w * 0.3, hh],
        [-w * 0.3, hh],
        [-w / 2, hh * 0.7],
      ],
      null,
      's',
    );
    _arcProfiles.set(k, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Generic voussoir ring
// ---------------------------------------------------------------------------

/**
 * Lay a ring of voussoirs.
 *   S: sinks; pr: profile; R: mean radius; n: voussoir count; joint: half joint width (m)
 *   opts.skip(i) -> true to leave voussoir i out; opts.profileAt(i) -> alternative profile
 *   opts.tint(i) -> tint; opts.off(i) -> [dr, dy, twist]
 */
export function voussoirs(S, pr, R, n, joint, opts = {}) {
  const step = TAU / n;
  const ja = joint / R;
  const core = scaleProfile(pr, 0.84, 0.86);
  const rib = opts.ribEvery ? scaleProfile(pr, opts.ribScale ?? 1.08, opts.ribScale ?? 1.08, 0, 0) : null;
  const seg = opts.segDeg ?? 1.2;
  const steps = Math.max(2, Math.ceil(step / DEG / seg));
  const phase = opts.phase ?? 0;
  for (let i = 0; i < n; i++) {
    if (opts.skip && opts.skip(i)) continue;
    const a0 = phase + i * step + ja;
    const a1 = phase + (i + 1) * step - ja;
    const p = (opts.profileAt && opts.profileAt(i)) || pr;
    const off = opts.off ? opts.off(i) : null;
    sweep(S, p, R, a0, a1, steps, {
      tint: opts.tint ? opts.tint(i) : 1,
      dr: off ? off[0] : 0,
      dy: off ? off[1] : 0,
      twist: off ? off[2] : 0,
      capMat: opts.capMat,
    });
    // recessed joint core to the next voussoir (only when both sides exist)
    const nx = (i + 1) % n;
    if (!(opts.skip && opts.skip(nx))) {
      sweep(S, core, R, a1 - ja * 0.2, a1 + ja * 2.2, 1, { tint: 0.62, caps: false });
      // raised rib straddling every k-th joint: a stone band that makes the ring read as a
      // segmented spine from a distance
      if (opts.ribEvery && (i + 1) % opts.ribEvery === 0 && !(opts.ribSkip && opts.ribSkip(i))) {
        const rw = (opts.ribWidth ?? 1.8) / 2 / R;
        sweep(S, rib, R, a1 + ja - rw, a1 + ja + rw, 1, { tint: opts.ribTint ?? 0.9 });
      }
    }
  }
}

/** Same profile with every edge in sink `from` moved to sink `to` (two-tone masonry). */
export function recolor(pr, from, to) {
  return makeProfile(pr.pts, pr.edges.map((e) => (e.mat === from ? to : e.mat)), pr.defaultMat === from ? to : pr.defaultMat);
}

/** Tick marks on a flat face (side = +1 / -1 local Y) between radial offsets r0..r1 at height y. */
function ticks(S, mat, R, y, side, r0, r1, every, big, huge, opts = {}) {
  const n = Math.round(360 / every);
  const sink = S[mat];
  const skip = opts.skip;
  for (let i = 0; i < n; i++) {
    const a = (i * every + (opts.phaseDeg ?? 0)) * DEG;
    if (skip && skip(a)) continue;
    const isHuge = huge && i % huge === 0;
    const isBig = !isHuge && big && i % big === 0;
    const len = isHuge ? r1 - r0 : isBig ? (r1 - r0) * 0.62 : (r1 - r0) * 0.34;
    const w = isHuge ? 1.4 : isBig ? 0.9 : 0.55;
    const hh = isHuge ? 1.4 : isBig ? 0.9 : 0.5;
    ringFrame(R, a, r1 - len / 2, y, side, _fr);
    put(sink, UNIT_BOX, _fr, 0, hh / 2, 0, w, hh, len, 0, 0, 0, opts.tint ?? 1);
  }
}
const _fr = new THREE.Matrix4();
const _fr2 = new THREE.Matrix4();

/** Bronze strap wrapping the ring section at angle a (sector boundary). */
function clamp(S, pr, R, a, widthM, scale = 1.1, tint = 1) {
  const cl = scaleProfile(pr, scale, scale, pr.cr, pr.cy);
  const half = widthM / 2 / R;
  const tmp = { b: S.bronze };
  const clB = makeProfile(cl.pts, null, 'b');
  sweep(tmp, clB, R, a - half, a + half, 2, { tint, capMat: 'b' });
}

/** A hub (boss) coaxial with the local ±X or ±Z axis where an axle meets the ring. */
function hub(S, mat, R, dirAngle, rIn, rOut, radius, tint = 1) {
  // cylinder along the radial direction at angle dirAngle, spanning radial distance rIn..rOut
  const c = Math.cos(dirAngle);
  const s = Math.sin(dirAngle);
  strut(S[mat], [c * rIn, 0, s * rIn], [c * rOut, 0, s * rOut], radius, radius, G.cyl20, tint);
}

/** Axle from this ring's inner face (rFrom) inward to the child hub (rTo) at local angle dirAngle. */
function axle(S, dirAngle, rFrom, rTo, radius) {
  const c = Math.cos(dirAngle);
  const s = Math.sin(dirAngle);
  // stone shaft
  strut(S.stone, [c * rFrom, 0, s * rFrom], [c * (rTo - 1), 0, s * (rTo - 1)], radius, radius * 0.8, G.cyl12, 0.92);
  // bearing block where it leaves the ring (flared)
  strut(S.stone, [c * (rFrom + 1.5), 0, s * (rFrom + 1.5)], [c * (rFrom - 5), 0, s * (rFrom - 5)], radius * 2.1, radius * 1.3, G.cyl8, 0.85);
  // bronze collars along the shaft
  const L = rFrom - rTo;
  for (const t of [0.22, 0.5, 0.8]) {
    const r = rFrom - L * t;
    strut(S.bronze, [c * (r + 0.8), 0, s * (r + 0.8)], [c * (r - 0.8), 0, s * (r - 0.8)], radius * 1.18, radius * 1.18, G.cyl20);
  }
}

// ---------------------------------------------------------------------------
// Planets on arms / riders
// ---------------------------------------------------------------------------

/** Radial arm from the outer face at angle a, tilted `lift` out of the ring plane, ending in a planet. */
function planetArm(S, R, rFace, a, len, lift, planetR, kind, rng) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cl = Math.cos(lift);
  const sl = Math.sin(lift);
  // direction: radial * cos(lift) + Y * sin(lift)
  const dx = c * cl;
  const dy = sl;
  const dz = s * cl;
  const base = [c * (R + rFace - 2), 0, s * (R + rFace - 2)];
  const tip = [base[0] + dx * len, base[1] + dy * len, base[2] + dz * len];
  // arm: tapered stone shaft + bronze sleeve at base + knuckle at tip
  strut(S.stone, base, tip, 3.4, 1.8, G.cyl8, 0.95);
  strut(S.bronze, base, [base[0] + dx * 7, base[1] + dy * 7, base[2] + dz * 7], 4.3, 3.8, G.cyl12);
  // bracing fins
  for (const f of [-1, 1]) {
    const fb = [base[0] - s * f * 6, base[1], base[2] + c * f * 6];
    const ft = [base[0] + dx * len * 0.45, base[1] + dy * len * 0.45, base[2] + dz * len * 0.45];
    strut(S.stone, fb, ft, 1.1, 0.7, G.cyl6, 0.85);
  }
  const pc = [tip[0] + dx * planetR * 0.92, tip[1] + dy * planetR * 0.92, tip[2] + dz * planetR * 0.92];
  _m.compose(_v1.set(pc[0], pc[1], pc[2]), _q.identity(), _s.set(planetR, planetR, planetR));
  if (kind === 'marble') {
    S.marble.add(G.sph, _m, 1);
    // a thin tilted ring around the planet
    const ringPr = makeProfile(
      [
        [-planetR * 0.1, -0.35],
        [planetR * 0.1, -0.35],
        [planetR * 0.1, 0.35],
        [-planetR * 0.1, 0.35],
      ],
      null,
      'bronze',
    );
    const start = S.bronze.nv;
    sweep({ bronze: S.bronze }, ringPr, planetR * 1.75, 0, TAU, 64, { caps: false });
    _m2.makeRotationFromEuler(_eul.set(0.45, a, 0.3, 'YXZ'));
    _m2.setPosition(pc[0], pc[1], pc[2]);
    S.bronze.transformFrom(start, _m2);
    // spokes holding the ring
    for (let i = 0; i < 3; i++) {
      const aa = (i / 3) * TAU + 0.4;
      _v0.set(Math.cos(aa) * planetR * 1.7, 0, Math.sin(aa) * planetR * 1.7).applyMatrix4(_m2);
      _v1.set(Math.cos(aa) * planetR * 0.9, 0, Math.sin(aa) * planetR * 0.9).applyMatrix4(_m2);
      strut(S.bronze, [_v1.x, _v1.y, _v1.z], [_v0.x, _v0.y, _v0.z], 0.5, 0.5, G.cyl6);
    }
  } else if (kind === 'dark') {
    // a cracked dark planet, one slice missing, glowing inside
    S.dark.add(G.sph, _m, 0.9);
    _m.compose(_v1.set(pc[0], pc[1], pc[2]), _q.identity(), _s.set(planetR * 0.93, planetR * 0.93, planetR * 0.93));
    // crack bands: thin glowing belts slightly proud, reads as seams
    for (let i = 0; i < 3; i++) {
      const start = S.glow.nv;
      const pr = makeProfile(
        [
          [-0.2, -0.25],
          [0.35, -0.25],
          [0.35, 0.25],
          [-0.2, 0.25],
        ],
        null,
        'glow',
      );
      const aa = rng.range(0, TAU);
      sweep({ glow: S.glow }, pr, planetR, aa, aa + rng.range(1.2, 2.6), 24, { caps: false });
      _m2.makeRotationFromEuler(_eul.set(rng.range(-1, 1), rng.range(0, TAU), rng.range(-1, 1)));
      _m2.setPosition(pc[0], pc[1], pc[2]);
      S.glow.transformFrom(start, _m2);
    }
  } else {
    // binary: two planets on a crossbar
    const off = planetR * 1.1;
    const px = -s;
    const pz = c;
    const p1 = [pc[0] + px * off, pc[1], pc[2] + pz * off];
    const p2 = [pc[0] - px * off, pc[1], pc[2] - pz * off];
    strut(S.bronze, p1, p2, 1.0, 1.0, G.cyl8);
    _m.compose(_v1.set(p1[0], p1[1], p1[2]), _q.identity(), _s.setScalar(planetR * 0.72));
    S.stone.add(G.sph, _m, 1.08);
    _m.compose(_v1.set(p2[0], p2[1], p2[2]), _q.identity(), _s.setScalar(planetR * 0.5));
    S.marble.add(G.sph, _m, 1);
  }
  // knuckle
  _m.compose(_v1.set(tip[0], tip[1], tip[2]), _q.identity(), _s.setScalar(2.6));
  S.bronze.add(G.sphLo, _m);
  return { tip, pc, reach: Math.hypot(pc[0], pc[1], pc[2]) + planetR };
}

// ---------------------------------------------------------------------------
// The rings
// ---------------------------------------------------------------------------

const stoneTint = (seed) => (i) => {
  const a = h1(i, seed);
  const b = h1(i, seed + 7);
  const t = 0.86 + 0.2 * a;
  // occasional warmer/ruddier or cooler voussoir
  if (b < 0.12) return [t * 1.06, t * 0.96, t * 0.88];
  if (b > 0.9) return [t * 0.92, t * 0.95, t * 1.0];
  return t;
};

/**
 * Ring A — "the Ecliptic": the widest (Ø ≈ 690 m), a flat rimmed band carrying the 13-sector
 * calendar, three planets on out-of-plane arms, and a breach where three voussoirs are missing and
 * their fragments still hover in formation, turning with it.
 */
export function buildRingA(S, spec, rng) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-16, -6.2], [-15.2, -7], [-12.8, -7], [-12, -6.2], [-12, -5],
      [12, -5], [12, -6.2], [12.8, -7], [15.2, -7], [16, -6.2],
      [16, -3.4], [15, -3.4], [15, 3.4], [16, 3.4],
      [16, 6.2], [15.2, 7], [12.8, 7], [12, 6.2], [12, 5],
      [-12, 5], [-12, 6.2], [-12.8, 7], [-15.2, 7], [-16, 6.2],
      [-16, 2.4], [-15.3, 2.4], [-15.3, -2.4], [-16, -2.4],
    ],
    { 11: 'glyph', 25: 'marble' },
  );
  // damaged: outer upper rim knocked off
  const prD = makeProfile(
    [
      [-16, -6.2], [-15.2, -7], [-12.8, -7], [-12, -6.2], [-12, -5],
      [12, -5], [12, -6.2], [12.8, -7], [15.2, -7], [16, -6.2],
      [16, -3.4], [15, -3.4], [15, 1.2], [13.6, 3.6], [11, 5],
      [-12, 5], [-12, 6.2], [-12.8, 7], [-15.2, 7], [-16, 6.2],
      [-16, 2.4], [-15.3, 2.4], [-15.3, -2.4], [-16, -2.4],
    ],
    { 11: 'glyph', 23: 'marble' },
  );
  const n = 90;
  const gapStart = 61; // voussoirs 61..63 missing
  const inGap = (i) => i >= gapStart && i < gapStart + 3;
  const prDark = recolor(pr, 'stone', 'dark');
  voussoirs(S, pr, R, n, 0.5, {
    skip: inGap,
    profileAt: (i) => (h1(i, 5) < 0.09 || i === gapStart - 1 || i === gapStart + 3 ? prD : i % 5 === 2 ? prDark : null),
    ribEvery: 2,
    ribScale: 1.07,
    ribWidth: 2.2,
    tint: stoneTint(11),
    off: (i) => (h1(i, 3) < 0.18 ? [(h1(i, 4) - 0.5) * 0.9, (h1(i, 6) - 0.5) * 0.9, (h1(i, 8) - 0.5) * 0.03] : null),
    segDeg: 1,
  });
  // hovering fragments in the breach: broken chunks of the missing voussoirs, still in formation
  const step = TAU / n;
  for (let j = 0; j < 7; j++) {
    const a = (gapStart + 0.3 + j * 0.37) * step;
    const cs = rng.range(3, 7);
    ringFrame(R, a, rng.range(-9, 9), rng.range(-2, 2), 1, _fr);
    put(S.stone, G.ico, _fr, 0, 0, 0, cs * 1.3, cs * 0.8, cs, rng.range(0, 3), rng.range(0, 3), rng.range(0, 3), 0.9);
  }
  {
    // one big fragment that still shows its glyph face
    const a = (gapStart + 1.5) * step;
    const sub = makeProfile(
      [
        [4, -5.5], [15, -6], [16, -3.4], [15, -3.4], [15, 3.4], [16, 3.4], [15.5, 5], [7, 5.5],
      ],
      { 3: 'glyph' },
    );
    sweep(S, sub, R, a - step * 0.28, a + step * 0.22, 3, { dr: 1.2, dy: 1.5, twist: 0.08, tint: 0.95 });
  }

  // sectors: bronze clamps + calendar signs on both flat faces
  const sectors = 13;
  for (let k = 0; k < sectors; k++) {
    const a0 = (k / sectors) * TAU + 0.06;
    const vi = Math.floor(a0 / step);
    if (inGap(vi) || inGap((vi + n - 1) % n)) continue;
    clamp(S, pr, R, a0, 2.6, 1.09);
    const am = a0 + (0.5 / sectors) * TAU;
    const mi = Math.floor(am / step);
    if (inGap(mi)) continue;
    for (const side of [1, -1]) {
      ringFrame(R, am, -3.5, side * 5, side, _fr2);
      sigil(S.bronze, _fr2, 13.5, k * 2 + (side > 0 ? 0 : 1) + 3, 1, 0.8);
    }
  }
  const gapSkip = (a) => {
    const i = Math.floor((((a % TAU) + TAU) % TAU) / step);
    return inGap(i) || h1(i, 21) < 0.04;
  };
  for (const side of [1, -1]) ticks(S, 'bronze', R, side * 5, side, 4.5, 11.5, 1, 5, 15, { skip: gapSkip, tint: 0.9 });

  // planets
  const arms = [];
  for (const p of spec.planets) arms.push(planetArm(S, R, 16, p.a, p.len, p.lift, p.r, p.kind, rng));

  // moss cushions on the upper channel near the breach (the ring has been turning for ages)
  for (let j = 0; j < 40; j++) {
    const a = (gapStart - 6 + rng.range(0, 15)) * step;
    if (inGap(Math.floor(a / step))) continue;
    ringFrame(R, a, rng.range(-11, 11), 5, 1, _fr);
    const s = rng.range(0.8, 2.4);
    put(S.moss, G.ico, _fr, 0, s * 0.2, 0, s * 1.6, s * 0.55, s * 1.2, 0, rng.range(0, 3), 0, rng.range(0.8, 1.1));
  }
  return { arms };
}

/**
 * Ring B — "the Meridian": steeply tilted (Ø ≈ 540 m), a heavy octagonal section with a running
 * groove on its outer face and a glyph belt on its inner face (seen from below as it passes over).
 * Carries two riders (carriages clamped in the groove, each lifting a planet) and the axles that
 * hold ring C.
 */
export function buildRingB(S, spec, rng) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-11, -5], [-8, -8], [8, -8], [11, -5],
      [11, -2.4], [8.4, -1.7], [8.4, 1.7], [11, 2.4],
      [11, 5], [8, 8], [-8, 8], [-11, 5],
      [-11, 3.2], [-10.1, 3.2], [-10.1, -3.2], [-11, -3.2],
    ],
    { 5: 'dark', 13: 'glyph' },
  );
  const n = 72;
  const prDark = recolor(pr, 'stone', 'dark');
  voussoirs(S, pr, R, n, 0.45, {
    profileAt: (i) => (i % 3 === 0 ? prDark : null),
    ribEvery: 3,
    ribScale: 1.09,
    ribWidth: 2.0,
    tint: stoneTint(23),
    off: (i) => (h1(i, 13) < 0.14 ? [(h1(i, 14) - 0.5) * 0.7, (h1(i, 16) - 0.5) * 0.7, 0] : null),
    segDeg: 1.2,
    skip: (i) => i === 17, // one voussoir gone — a window of sky in the meridian
  });
  const sectors = 9;
  const step = TAU / n;
  for (let k = 0; k < sectors; k++) {
    const a0 = (k / sectors) * TAU + 0.21;
    if (Math.abs(a0 / step - 17.5) < 1.6) continue;
    clamp(S, pr, R, a0, 2.2, 1.1);
    const am = a0 + (0.5 / sectors) * TAU;
    for (const side of [1, -1]) {
      ringFrame(R, am, 0, side * 8, side, _fr2);
      sigil(S.bronze, _fr2, 11, 40 + k * 2 + (side > 0 ? 0 : 1), 1, 0.7);
    }
  }
  const skipAxle = (a) => {
    const d = Math.min(Math.abs(Math.atan2(Math.sin(a), Math.cos(a))), Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))));
    return d < 0.05 || Math.abs(a / step - 17.5) < 0.7;
  };
  for (const side of [1, -1]) ticks(S, 'bronze', R, side * 8, side, 2, 7.5, 2, 5, 20, { skip: skipAxle, tint: 0.85 });

  // riders: carriage clamped round the section, a pedestal, a planet
  for (const rd of spec.riders) {
    const a = rd.a;
    const car = makeProfile(scaleProfile(pr, 1.22, 1.22, 0, 0).pts, null, 'bronze');
    sweep({ bronze: S.bronze }, car, R, a - 5 / R, a + 5 / R, 3, { capMat: 'bronze', tint: 0.95 });
    const inner = makeProfile(scaleProfile(pr, 1.12, 1.12, 0, 0).pts, null, 'dark');
    sweep({ dark: S.dark }, inner, R, a - 9 / R, a + 9 / R, 4, { capMat: 'dark' });
    const c = Math.cos(a);
    const s = Math.sin(a);
    const b0 = [c * (R + 12), 0, s * (R + 12)];
    const b1 = [c * (R + 12 + rd.stem), 0, s * (R + 12 + rd.stem)];
    strut(S.stone, b0, b1, 3.6, 2.2, G.cyl8, 0.9);
    _m.compose(_v1.set(c * (R + 12 + rd.stem + rd.r * 0.9), 0, s * (R + 12 + rd.stem + rd.r * 0.9)), _q.identity(), _s.setScalar(rd.r));
    S[rd.kind].add(G.sph, _m, 1);
    // bronze meridian lines on the rider planet
    const start = S.bronze.nv;
    const band = makeProfile([[-0.2, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.2, 0.3]], null, 'bronze');
    sweep({ bronze: S.bronze }, band, rd.r, 0, TAU, 40, { caps: false });
    _m2.makeRotationFromEuler(_eul.set(Math.PI / 2, a, 0.2, 'YXZ'));
    _m2.setPosition(c * (R + 12 + rd.stem + rd.r * 0.9), 0, s * (R + 12 + rd.stem + rd.r * 0.9));
    S.bronze.transformFrom(start, _m2);
  }

  // axles to ring C at local ±X
  for (const a of [0, Math.PI]) axle(S, a, R - 10.5, spec.childHubR, spec.axleR);

  // hanging roots / vines from the lower voussoirs — long thin strands (weathering)
  for (let j = 0; j < 26; j++) {
    const a = rng.range(0, TAU);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const L = rng.range(6, 22);
    const r0 = R + rng.range(-9, 9);
    strut(S.moss, [c * r0, -7.5, s * r0], [c * (r0 + rng.range(-1, 1)), -7.5 - L, s * (r0 + rng.range(-1, 1))], 0.35, 0.08, G.cyl6, 0.8);
  }
}

/**
 * Ring C — "the Toothed Wheel" (Ø ≈ 410 m): a squared section with 116 gear teeth on its outer rim
 * (a clockwork that meshes with nothing), a glyph belt on the inner face, hubs where ring B's
 * axles enter, and the axles that hold ring D.
 */
export function buildRingC(S, spec, rng) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-9, -5.2], [-8.2, -6], [8.2, -6], [9, -5.2],
      [9, 5.2], [8.2, 6], [-8.2, 6], [-9, 5.2],
      [-9, 2.6], [-8.2, 2.6], [-8.2, -2.6], [-9, -2.6],
    ],
    { 9: 'glyph' },
  );
  const n = 60;
  const prDark = recolor(pr, 'stone', 'dark');
  voussoirs(S, pr, R, n, 0.4, { tint: stoneTint(37), segDeg: 1.5, profileAt: (i) => (i % 4 === 1 ? prDark : null), ribEvery: 4, ribScale: 1.1, ribWidth: 1.6 });
  // teeth (skip near the hubs at 0 / PI)
  const tooth = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1).toNonIndexed();
  tooth.computeVertexNormals();
  const nT = 120;
  for (let i = 0; i < nT; i++) {
    const a = ((i + 0.5) / nT) * TAU;
    const d = Math.min(Math.abs(Math.sin(a)), 1);
    if (d < 0.1) continue;
    if (h1(i, 91) < 0.06) continue; // a few teeth broken off
    const broken = h1(i, 92) < 0.1;
    ringFrame(R, a, 9 + (broken ? 1.3 : 2.3), 0, 0, _fr);
    // square frustum: rotate 45° so faces align with tangent/axis
    put(S.stone, tooth, _fr, 0, 0, 0, 3.4, broken ? 2.6 : 4.6, 7.4, 0, Math.PI / 4, 0, 0.9 + 0.1 * h1(i, 93));
  }
  // bronze clamps every 30°, hubs
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + 0.26;
    clamp(S, pr, R, a, 1.8, 1.12);
  }
  for (const side of [1, -1]) ticks(S, 'bronze', R, side * 6, side, -6, 6, 2, 3, 15, { tint: 0.85, skip: (a) => Math.abs(Math.sin(a)) < 0.06 });
  for (let k = 0; k < 8; k++) {
    const am = (k / 8) * TAU + Math.PI / 8;
    for (const side of [1, -1]) {
      ringFrame(R, am, 0, side * 6, side, _fr2);
      sigil(S.bronze, _fr2, 10, 80 + k * 2 + (side > 0 ? 0 : 1), 1, 0.6);
    }
  }
  for (const a of [0, Math.PI]) {
    hub(S, 'stone', R, a, R - 7, R + 15.5, 11, 0.95);
    hub(S, 'bronze', R, a, R + 12, R + 16.5, 12.5, 1);
  }
  for (const a of [Math.PI / 2, -Math.PI / 2]) axle(S, a, R - 8.5, spec.childHubR, spec.axleR);
}

/**
 * Ring D — "the Lattice" (Ø ≈ 310 m): an openwork truss ring, two chords joined by a zig-zag of
 * struts, stiffened by solid panels carrying signs. Light shows through it.
 */
export function buildRingD(S, spec) {
  const R = spec.R;
  const chord = makeProfile(
    [
      [-2.2, -1.6], [2.2, -1.6], [2.2, 1.6], [-2.2, 1.6],
    ],
    { 1: 'marble' },
  );
  const n = 48;
  for (const y of [-7, 7]) {
    const tmp = { stone: S.stone, marble: S.marble };
    voussoirs(tmp, makeProfile(chord.pts.map(([r, yy]) => [r, yy + y]), { 1: 'marble' }), R, n, 0.3, { tint: stoneTint(51), segDeg: 2 });
  }
  // inner flange ring (thin)
  const fl = makeProfile([[-3.2, -0.8], [-2.2, -0.8], [-2.2, 0.8], [-3.2, 0.8]], null, 'stone');
  sweep(S, fl, R, 0, TAU, 180, { caps: false, tint: 0.85 });
  // struts
  const nS = 96;
  for (let i = 0; i < nS; i++) {
    const a0 = (i / nS) * TAU;
    const a1 = ((i + 1) / nS) * TAU;
    const up = i % 2 === 0;
    const ya = up ? -5.6 : 5.6;
    const yb = -ya;
    strut(S.stone, [Math.cos(a0) * R, ya, Math.sin(a0) * R], [Math.cos(a1) * R, yb, Math.sin(a1) * R], 0.75, 0.75, G.cyl6, 0.9);
  }
  // panels + signs every 45°, avoiding the hubs/axles
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + Math.PI / 8;
    const pan = makeProfile([[-1.4, -5.8], [1.4, -5.8], [1.4, 5.8], [-1.4, 5.8]], { 1: 'glyph' });
    sweep(S, pan, R, a - 9 / R, a + 9 / R, 3, { tint: 0.9 });
    for (const side of [0, 2]) {
      ringFrame(R, a, side === 0 ? 1.4 : -1.4, 0, side, _fr2);
      _fr2.multiply(_m2.makeRotationX(0));
      sigil(S.bronze, _fr2, 8.5, 120 + k * 2 + side, 1, 0.5);
    }
  }
  for (const a of [0, Math.PI]) {
    hub(S, 'stone', R, a, R - 4, R + 7, 7.5, 0.95);
    hub(S, 'bronze', R, a, R + 5, R + 8.5, 8.5, 1);
    // solid block around the hub so the truss visibly carries it
    const blk = makeProfile([[-2.6, -8], [2.6, -8], [2.6, 8], [-2.6, 8]], null, 'stone');
    sweep(S, blk, R, a - 8 / R, a + 8 / R, 2, { tint: 0.92 });
  }
  for (const a of [Math.PI / 2, -Math.PI / 2]) {
    const blk = makeProfile([[-2.6, -8], [2.6, -8], [2.6, 8], [-2.6, 8]], null, 'stone');
    sweep(S, blk, R, a - 7 / R, a + 7 / R, 2, { tint: 0.92 });
    axle(S, a, R - 2.5, spec.childHubR, spec.axleR);
  }
}

/**
 * Ring E — "the Glyph Wheel" (Ø ≈ 225 m): a dark band inscribed all round (the calendar's
 * running text), rimmed with pale stone, hubs + axles like the others.
 */
export function buildRingE(S, spec) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-5, -6.4], [5, -6.4], [5.6, -5.6],
      [5.6, 5.6], [5, 6.4], [-5, 6.4], [-5.6, 5.6], [-5.6, -5.6],
    ],
    { 3: 'glyph', 7: 'glyph' },
  );
  const n = 40;
  voussoirs(S, pr, R, n, 0.35, { tint: stoneTint(61), segDeg: 2 });
  // pale rims (raised lips at both edges of the glyph faces)
  for (const y of [-6.9, 6.9]) {
    const lip = makeProfile([[-6.1, -0.7], [6.1, -0.7], [6.1, 0.7], [-6.1, 0.7]].map(([r, yy]) => [r, yy + y]), null, 'marble');
    sweep({ marble: S.marble }, lip, R, 0, TAU, 160, { caps: false, tint: 0.95 });
  }
  for (let k = 0; k < 6; k++) clamp(S, pr, R, (k / 6) * TAU + Math.PI / 6, 1.4, 1.14);
  for (const a of [0, Math.PI]) {
    hub(S, 'stone', R, a, R - 5, R + 8, 6.5, 0.95);
    hub(S, 'bronze', R, a, R + 6, R + 9.5, 7.4, 1);
  }
  for (const a of [Math.PI / 2, -Math.PI / 2]) axle(S, a, R - 5.2, spec.childHubR, spec.axleR);
}

/**
 * Ring F — "the Crown" (Ø ≈ 160 m): the innermost ring, bristling with 22 gnomons that point at
 * the sphere, each tipped with bronze; its axles hold the sphere's poles.
 */
export function buildRingF(S, spec) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-3.6, -4], [3.6, -4], [4.2, -3], [4.2, 3], [3.6, 4], [-3.6, 4], [-4.2, 3], [-4.2, -3],
    ],
    { 3: 'glyph' },
  );
  voussoirs(S, pr, R, 32, 0.3, { tint: stoneTint(71), segDeg: 2 });
  const nG = 24;
  for (let i = 0; i < nG; i++) {
    const a = ((i + 0.5) / nG) * TAU;
    if (Math.abs(Math.cos(a)) < 0.2) continue; // leave room for the sphere's axles at ±Z
    const c = Math.cos(a);
    const s = Math.sin(a);
    const L = i % 2 ? 9 : 13;
    const r0 = R - 4;
    const r1 = r0 - L;
    strut(S.stone, [c * r0, 0, s * r0], [c * r1, 0, s * r1], 2.1, 0.5, G.cyl6, 0.92);
    _m.compose(_v1.set(c * r1, 0, s * r1), _q.identity(), _s.setScalar(1.1));
    S.bronze.add(G.sphLo, _m);
  }
  for (const a of [0, Math.PI]) {
    hub(S, 'stone', R, a, R - 3, R + 6.5, 5.2, 0.95);
    hub(S, 'bronze', R, a, R + 4.5, R + 7.5, 6, 1);
  }
  for (const a of [Math.PI / 2, -Math.PI / 2]) axle(S, a, R - 3.8, spec.childHubR, spec.axleR);
}

export { G as ORRERY_PRIMS, put as putPrim, planetArm };

/**
 * The shattered eighth ring: a level belt of broken voussoir runs and loose blocks orbiting far
 * outside the Ecliptic (r ≈ 440–490 m, well above the crater rim). It fell apart ages ago and never
 * fell down; the pieces keep formation, turning slowest of all.
 */
export function buildBelt(S, spec, rng) {
  const R = spec.R;
  const pr = makeProfile(
    [
      [-9, -4.2], [-8.2, -5], [8.2, -5], [9, -4.2], [9, -1.8], [8.3, -1.8], [8.3, 1.8], [9, 1.8],
      [9, 4.2], [8.2, 5], [-8.2, 5], [-9, 4.2],
    ],
    { 6: 'glyph' },
  );
  const prDark = recolor(pr, 'stone', 'dark');
  let a = 0;
  let k = 0;
  while (a < TAU - 0.05) {
    const runs = 1 + Math.floor(rng() * rng() * 5);
    const dr = rng.range(-10, 10);
    const dy = rng.range(-6, 6);
    const roll = rng.range(-0.25, 0.25);
    const segA = 11 / R;
    for (let j = 0; j < runs; j++) {
      const a0 = a + j * (segA + 0.5 / R);
      const p = (k + j) % 4 === 1 ? prDark : pr;
      sweep(S, p, R, a0, a0 + segA, 3, { dr: dr + j * rng.range(-0.8, 0.8), dy: dy + j * rng.range(-0.8, 0.8), twist: roll + j * rng.range(-0.05, 0.05), tint: rng.range(0.8, 1.0) });
    }
    // loose blocks trailing each run
    const nb = 2 + Math.floor(rng() * 5);
    for (let j = 0; j < nb; j++) {
      const aa = a + runs * segA + rng.range(0, 30 / R);
      const s = rng.range(1.2, 3.6);
      ringFrame(R, aa, dr + rng.range(-8, 8), dy + rng.range(-6, 6), 1, _fr);
      put(rng() < 0.3 ? S.dark : S.stone, G.ico, _fr, 0, 0, 0, s * 1.5, s, s * 1.2, rng.range(0, 3), rng.range(0, 3), rng.range(0, 3), rng.range(0.75, 0.95));
    }
    k += runs;
    a += runs * segA + rng.range(18, 70) / R;
  }
}
