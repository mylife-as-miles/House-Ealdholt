// The crater floor under the Orrery: the dial-dais with the snapped pillar that once carried the
// sphere, eight causeway spokes and concentric curbs (the plaza is itself a calendar face), thirteen
// hour stones, the colossal cradle pylons that held the rings before they learned to float, two arcs
// of a fallen seventh ring half-buried in the floor, debris everywhere, and the processional stair
// that climbs the north-eastern crater wall to a gate on the rim.
//
// Coordinates: landmark-local — x, z relative to the site centre, y = world height.

import * as THREE from 'crownfall-world-three';
import { makeProfile, sweep, h1, UNIT_BOX } from './orrery-mesh.js';
import { voussoirs, sigil, strut, ORRERY_PRIMS as G } from './orrery-rings.js';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function boxAt(sink, x, y, z, sx, sy, sz, ry = 0, tint = 1, rx = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  sink.add(UNIT_BOX, _m, tint);
}

function geoAt(sink, geo, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  sink.add(geo, _m, tint);
}

const markAll = (S) => {
  const m = {};
  for (const k of Object.keys(S)) m[k] = S[k].nv;
  return m;
};
const xformAll = (S, marks, M) => {
  for (const k of Object.keys(S)) S[k].transformFrom(marks[k], M);
};

/** Annulus solid (absolute radii) swept round the local origin. */
function annulus(S, mat, rIn, rOut, y0, y1, segs, tint = 1) {
  const pr = makeProfile([[rIn, y0], [rOut, y0], [rOut, y1], [rIn, y1]], null, mat);
  sweep(S, pr, 0, 0, TAU, segs, { caps: false, tint });
}

export function buildFloor(S, env) {
  const { g, rng, clearance } = env;
  const info = { stairTop: null, stairBottom: null, pylons: [], fallen: [] };

  // ---------------------------------------------------------------------------
  // 1. the dial-dais
  // ---------------------------------------------------------------------------
  const g0 = g(0, 0);
  const steps = [
    [84, 74, 1.4],
    [74, 64, 1.4],
    [64, 54, 1.4],
    [54, 44, 1.4],
  ];
  let top = g0 - 3;
  for (let i = 0; i < steps.length; i++) {
    const [ro, ri, hgt] = steps[i];
    const y0 = g0 - 3;
    const y1 = g0 + (i + 1) * hgt;
    const pr = makeProfile([[ri, y0], [ro, y0], [ro, y1 - 0.25], [ro - 0.25, y1], [ri, y1]], null, 'stone');
    // block joints: voussoirs with profile expressed around mean radius
    const Rm = (ri + ro) / 2;
    const prm = makeProfile(pr.pts.map(([r, y]) => [r - Rm, y]), null, 'stone');
    voussoirs(S, prm, Rm, Math.round((TAU * Rm) / 7), 0.12, {
      tint: (k) => 0.84 + 0.18 * h1(k, 300 + i),
      skip: (k) => h1(k, 310 + i) < 0.03,
      segDeg: 3,
      off: (k) => (h1(k, 320 + i) < 0.1 ? [0, -0.25 - 0.4 * h1(k, 330), 0] : null),
    });
    top = y1;
  }
  // dial face: dark disc, glyph ring, marble hour-lines, bronze numerals
  annulus(S, 'dark', 0, 44, g0 - 3, top, 90, 0.9);
  annulus(S, 'glyph', 36, 40.5, top, top + 0.35, 120, 1);
  annulus(S, 'marble', 40.5, 43.2, top, top + 0.5, 120, 1);
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    boxAt(S.marble, c * 28, top + 0.2, s * 28, 16, 0.4, 0.9, -a, 1);
    _m2.makeRotationY(-a + Math.PI / 2);
    _m2.setPosition(c * 38.2, top + 0.35, s * 38.2);
    sigil(S.bronze, _m2, 4.2, 500 + k, 1, 0.4);
  }
  // the snapped pillar: a fluted drum stump with a jagged top, bronze collar
  {
    const stumpH = 21;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 36, 6, false);
    const pos = cyl.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = pos.getY(i);
      const a = Math.atan2(z, x);
      // flutes
      const fl = 1 - 0.05 * Math.pow(Math.abs(Math.cos(a * 12)), 3);
      // jagged break on the top
      if (y > 0.49) y += -0.28 + 0.22 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 7.3) + 0.06 * Math.sin(a * 17);
      pos.setXYZ(i, x * fl, y, z * fl);
    }
    cyl.computeVertexNormals();
    geoAt(S.stone, cyl, 0, top + stumpH / 2 - 0.2, 0, 13, stumpH, 13, 0, 0, 0, 0.95);
    cyl.dispose();
    geoAt(S.bronze, G.cyl32, 0, top + 3.5, 0, 14.2, 2.4, 14.2);
    geoAt(S.bronze, G.cyl32, 0, top + 9.5, 0, 13.8, 1.2, 13.8, 0, 0, 0, 0.9);
    // fallen drums rolled off across the dais and onto the floor
    const drums = [
      [30, 0.7, 7.5],
      [47, 2.3, 8],
      [66, -0.9, 7],
      [98, 3.9, 8.5],
      [120, 1.9, 6.5],
    ];
    for (const [r, a, len] of drums) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const gy = r < 44 ? top : g(x, z);
      geoAt(S.stone, G.cyl20, x, gy + 13 * 0.55, z, 13, len, 13, Math.PI / 2, a + 1.2, 0.08, 0.9);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. spokes and curbs (the plaza is a dial)
  // ---------------------------------------------------------------------------
  const nSpoke = 8;
  const spokeA = (k) => (k / nSpoke) * TAU + TAU / 16;
  for (let k = 0; k < nSpoke; k++) {
    const a = spokeA(k);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rEnd = k === 7 ? 330 : 300 + 25 * h1(k, 41);
    for (let r = 86; r < rEnd; r += 7.2) {
      if (h1(Math.round(r), 400 + k) < 0.05) continue; // missing slab
      const x = c * (r + 3.4);
      const z = s * (r + 3.4);
      const gy = Math.max(g(x, z), g(x + s * 4, z - c * 4), g(x - s * 4, z + c * 4));
      const sunk = h1(Math.round(r), 420 + k) < 0.12 ? 0.6 : 0;
      boxAt(S.stone, x, gy + 0.55 - sunk - 1.5, z, 9, 3.2, 6.9, -a + Math.PI / 2, 0.8 + 0.2 * h1(Math.round(r), 410 + k), (h1(Math.round(r), 430) - 0.5) * 0.04, (h1(Math.round(r), 431) - 0.5) * 0.04);
      // curbs
      for (const side of [-1, 1]) {
        boxAt(S.dark, x + s * side * 5.3, gy + 0.9 - 1.2, z - c * side * 5.3, 1.6, 3.8, 7, -a + Math.PI / 2, 0.85);
      }
    }
  }
  // concentric curbs, interrupted at the spokes
  for (const [Rc, hgt, wid, mat] of [[128, 1.6, 3, 'stone'], [196, 2.2, 3.6, 'dark'], [258, 1.4, 2.6, 'stone']]) {
    const nSeg = Math.round((TAU * Rc) / 6);
    for (let i = 0; i < nSeg; i++) {
      const a = ((i + 0.5) / nSeg) * TAU;
      let near = false;
      for (let k = 0; k < nSpoke; k++) {
        const d = Math.abs(Math.atan2(Math.sin(a - spokeA(k)), Math.cos(a - spokeA(k))));
        if (d * Rc < 9) near = true;
      }
      if (near || h1(i, 500 + Rc) < 0.06) continue;
      const x = Math.cos(a) * Rc;
      const z = Math.sin(a) * Rc;
      const gy = g(x, z);
      boxAt(S[mat], x, gy + hgt / 2 - 1, z, wid, hgt + 2, 5.7, -a, 0.8 + 0.2 * h1(i, 520 + Rc));
    }
  }

  // ---------------------------------------------------------------------------
  // 3. hour stones (13, aligned with the Ecliptic's sectors)
  // ---------------------------------------------------------------------------
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * TAU + 0.24;
    const r = 226;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const gy = g(x, z);
    let H = 13 + 6 * h1(k, 600);
    const room = clearance(x, gy + H, z);
    if (room < 12) H = Math.max(5, H - (12 - room));
    const fallen = k === 4 || k === 9;
    const yaw = -a;
    if (fallen) {
      // toppled outward, snapped
      const ox = Math.cos(a) * (H / 2 + 2);
      const oz = Math.sin(a) * (H / 2 + 2);
      boxAt(S.dark, x + ox * 0.55, gy + 1.6, z + oz * 0.55, H * 0.6, 3.2, 5.4, yaw, 0.85, 0, 0.1);
      boxAt(S.dark, x + ox * 1.35, gy + 1.2, z + oz * 1.35, H * 0.4, 3, 5.2, yaw + 0.3, 0.85, 0.2, -0.1);
      boxAt(S.dark, x, gy + 1.5, z, 3.4, 5, 5.6, yaw, 0.8);
      continue;
    }
    boxAt(S.dark, x, gy + H / 2 - 2, z, 3.4, H + 4, 5.6, yaw, 0.88);
    boxAt(S.glyph, x, gy + H * 0.62, z, 3.6, H * 0.34, 5.8, yaw, 1);
    boxAt(S.bronze, x, gy + H + 0.5, z, 4.4, 1.2, 6.6, yaw, 1);
    boxAt(S.stone, x, gy - 0.3, z, 7, 2.2, 9, yaw, 0.8);
    if (k % 2 === 0) boxAt(S.glow, x, gy + H + 1.6, z, 1.1, 1.1, 1.1, yaw + 0.78, 1);
  }

  // ---------------------------------------------------------------------------
  // 4. cradle pylons (they held the rings once; the saddles are empty)
  // ---------------------------------------------------------------------------
  const pylonAz = [0.35, 1.62, 2.75, 3.95, 5.2];
  for (let k = 0; k < pylonAz.length; k++) {
    const a = pylonAz[k];
    const r = 296 + 18 * h1(k, 700);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // footprint ground
    let gmin = Infinity;
    let gmax = -Infinity;
    for (const [dx, dz] of [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, 0]]) {
      const h = g(x + dx, z + dz);
      gmin = Math.min(gmin, h);
      gmax = Math.max(gmax, h);
    }
    let H = 70 + 26 * h1(k, 701);
    // stay well clear of anything that sweeps overhead
    for (let it = 0; it < 12 && clearance(x, gmax + H + 16, z) < 22; it++) H -= 6;
    const yaw = -a; // local X = radial outward, local Z = orbit tangent (the saddle's axis)
    const broken = k === 3;
    const lean = k === 1 ? 0.07 : 0;
    info.pylons.push({ x, z, gy: gmax, H, broken });
    const base = S.dark;
    const marks = markAll(S);
    // stepped plinth
    for (let i = 0; i < 3; i++) boxAt(S.stone, 0, -4 + i * 2.4 + 1.2, 0, 44 - i * 6, 2.4 + 4 * (i === 0), 34 - i * 5, 0, 0.82 + 0.05 * i);
    // shaft: four clustered piers with a spine, tapering, courses marked by projecting bands
    const shaftH = broken ? H * 0.52 : H;
    for (const [px, pz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) {
      geoAt(base, G.cyl8, px, 3 + shaftH / 2, pz, 6.2, shaftH, 6.2, 0, Math.PI / 8, 0, 0.9);
    }
    boxAt(base, 0, 3 + shaftH / 2, 0, 14, shaftH, 10, 0, 0.86);
    for (let y = 12; y < shaftH - 4; y += 11) boxAt(S.stone, 0, 3 + y, 0, 25, 1.4, 19, 0, 0.9);
    // glyph panel on the inner face
    boxAt(S.glyph, -7.2, 3 + shaftH * 0.45, 0, 0.8, shaftH * 0.5, 8, 0, 1);
    if (!broken) {
      // the saddle: an arc cradle (part of a ring profile) tangential to the orbit
      const saddle = makeProfile([[-22, 0], [22, 0], [22, 9], [18, 9], [13, 4], [-13, 4], [-18, 9], [-22, 9]], { 4: 'bronze' }, 'stone');
      // extrude along local X (tangent) by sweeping a very large radius arc
      const Rbig = 400;
      const ss = S.stone.nv;
      const sb = S.bronze.nv;
      sweep({ stone: S.stone, bronze: S.bronze }, makeProfile(saddle.pts.map(([u, v]) => [u, v]), { 4: 'bronze' }, 'stone'), Rbig, -14 / Rbig, 14 / Rbig, 3, { tint: 0.92 });
      // map: sweep frame (radial=x, y, tangent=z) around origin at radius Rbig -> shift to pylon top
      _m2.makeTranslation(-Rbig, 3 + shaftH, 0);
      S.stone.transformFrom(ss, _m2);
      S.bronze.transformFrom(sb, _m2);
      // bronze bearing roller in the saddle
      geoAt(S.bronze, G.cyl20, 0, 3 + shaftH + 5.5, 0, 3.4, 24, 3.4, 0, 0, Math.PI / 2);
      geoAt(S.glow, G.sphLo, 0, 3 + shaftH + 11, 0, 1.2, 1.2, 1.2);
    } else {
      // jagged top + the fallen crown lying at the foot
      for (let i = 0; i < 7; i++) {
        geoAt(base, G.ico, rng.range(-9, 9), 3 + shaftH + rng.range(-1, 3), rng.range(-6, 6), rng.range(3, 6), rng.range(2, 5), rng.range(3, 6), rng.range(0, 3), rng.range(0, 3), 0, 0.85);
      }
    }
    // transform this pylon's pieces into place (all sinks touched above)
    _m2.makeRotationFromEuler(_e.set(lean, yaw, lean * 0.5, 'YXZ'));
    _m2.setPosition(x, gmin - 2, z);
    xformAll(S, marks, _m2);
    if (broken) {
      // fallen crown + shaft pieces scattered inward
      const dir = a + Math.PI + 0.4;
      for (let i = 0; i < 3; i++) {
        const d = 30 + i * 22;
        const fx = x + Math.cos(dir) * d;
        const fz = z + Math.sin(dir) * d;
        const fy = g(fx, fz);
        boxAt(base, fx, fy + 4, fz, 14, 10, 20, dir + rng.range(-0.3, 0.3), 0.85, rng.range(-0.2, 0.2), Math.PI / 2 + rng.range(-0.2, 0.2));
      }
      // its saddle, overturned
      const fx = x + Math.cos(dir) * 100;
      const fz = z + Math.sin(dir) * 100;
      boxAt(S.bronze, fx, g(fx, fz) + 2, fz, 30, 4, 8, dir + 1, 0.9, 0.4, 0.2);
      boxAt(S.stone, fx + 3, g(fx, fz) + 4, fz - 2, 44, 9, 12, dir + 1.1, 0.85, 2.6, 0.2);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. the fallen seventh ring: two arcs half-buried in the floor
  // ---------------------------------------------------------------------------
  const fallenPr = makeProfile(
    [
      [-10, -6], [10, -6], [10, -2.5], [9, -2.5], [9, 2.5], [10, 2.5], [10, 6], [-10, 6],
    ],
    { 3: 'glyph' },
  );
  const arcs = [
    // centre (local x,z), ring radius, arc start/end, yaw, roll (tilt of the ring plane), sink depth
    { x: -150, z: 70, R: 150, a0: 0.35, a1: 2.2, yaw: 0.35, roll: -1.42, depth: 70 },
    { x: 165, z: -120, R: 160, a0: 3.55, a1: 4.55, yaw: -0.9, roll: 0.2, depth: 20 },
  ];
  for (const f of arcs) {
    const marks = markAll(S);
    voussoirs(S, fallenPr, f.R, 40, 0.4, {
      skip: (i) => {
        const a = ((i + 0.5) / 40) * TAU;
        return a < f.a0 || a > f.a1;
      },
      tint: (i) => 0.8 + 0.15 * h1(i, 800),
      off: (i) => (h1(i, 801) < 0.4 ? [(h1(i, 802) - 0.5) * 2, (h1(i, 803) - 0.5) * 2, (h1(i, 804) - 0.5) * 0.08] : null),
      segDeg: 2,
    });
    const gy = g(f.x, f.z);
    _m2.makeRotationFromEuler(_e.set(f.roll, f.yaw, 0, 'YXZ'));
    // sink so the arc emerges from the ground
    _m2.setPosition(f.x, gy - f.depth, f.z);
    xformAll(S, marks, _m2);
    info.fallen.push(f);
    // debris heap around where it broke through
    for (let i = 0; i < 60; i++) {
      const a = rng.range(0, TAU);
      const d = rng.range(10, 90);
      const px = f.x + Math.cos(a) * d * 1.3;
      const pz = f.z + Math.sin(a) * d;
      const s = rng.range(1.2, 5) * (1 - d / 140);
      geoAt(i % 3 ? S.stone : S.dark, G.ico, px, g(px, pz) + s * 0.3, pz, s * 1.4, s, s * 1.1, rng.range(0, 3), rng.range(0, 3), 0, rng.range(0.75, 0.95));
    }
  }

  // ---------------------------------------------------------------------------
  // 6. debris field: fragments that fell from the rings over the ages (under the orbits)
  // ---------------------------------------------------------------------------
  for (let i = 0; i < 240; i++) {
    const a = rng.range(0, TAU);
    const r = 90 + Math.pow(rng(), 0.8) * 260;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = rng.chance(0.08) ? rng.range(4, 8) : rng.range(0.8, 3.2);
    const gy = g(x, z);
    if (rng.chance(0.3)) boxAt(S.stone, x, gy + s * 0.3, z, s * 2.2, s, s * 1.3, rng.range(0, 3), rng.range(0.75, 0.95), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
    else geoAt(S.stone, G.ico, x, gy + s * 0.25, z, s * 1.5, s * 0.9, s * 1.2, rng.range(0, 3), rng.range(0, 3), 0, rng.range(0.72, 0.95));
  }

  // ---------------------------------------------------------------------------
  // 7. the processional stair up the north-east wall, gate on the rim
  // ---------------------------------------------------------------------------
  {
    const a = -Math.PI / 4 + 0.1; // toward the basin
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = -s; // perpendicular
    const pz = c;
    const W = 14;
    let lastTop = -Infinity;
    let rTop = 0;
    let gTop = 0;
    let flightStart = null;
    const obelisks = [];
    const treads = [];
    for (let r = 318; r < 520; r += 1.25) {
      const x = c * r;
      const z = s * r;
      const gy = Math.max(g(x, z), g(x + px * W * 0.5, z + pz * W * 0.5), g(x - px * W * 0.5, z - pz * W * 0.5));
      // stop at the rim crest
      if (r > 440 && gy < lastTop - 0.5) break;
      let y = Math.max(gy + 0.2, lastTop);
      if (y - lastTop < 0.12 && lastTop > -Infinity) y = lastTop; // same tread
      if (y !== lastTop) {
        const lowest = Math.min(g(x + px * W * 0.5, z + pz * W * 0.5), g(x - px * W * 0.5, z - pz * W * 0.5)) - 2;
        const hh = y - lowest;
        boxAt(S.stone, x, y - hh / 2, z, 1.35, hh, W, -a, 0.82 + 0.12 * h1(Math.round(r * 4), 900));
        lastTop = y;
        treads.push([x, y, z]);
      }
      if (!flightStart) flightStart = [x, y, z];
      // parapets
      if (Math.round(r * 4) % 6 === 0) {
        for (const side of [-1, 1]) {
          const bx = x + px * side * (W / 2 + 1);
          const bz = z + pz * side * (W / 2 + 1);
          const by = g(bx, bz);
          const top = Math.max(y + 1.6, by + 1.2);
          boxAt(S.dark, bx, (top + by - 3) / 2, bz, 1.5, top - by + 3, 2, -a, 0.85);
        }
      }
      if (Math.round(r) % 42 === 0 && obelisks.length < 6 && Math.abs(r - Math.round(r)) < 0.63) obelisks.push([x, y, z, r]);
      rTop = r;
      gTop = y;
    }
    info.stairBottom = [c * 318, g(c * 318, s * 318), s * 318];
    info.stairTop = [c * rTop, gTop, s * rTop];
    info.stairDir = a;
    info.treads = treads;
    for (const [x, y, z] of obelisks) {
      for (const side of [-1, 1]) {
        const bx = x + px * side * (W / 2 + 4);
        const bz = z + pz * side * (W / 2 + 4);
        const by = g(bx, bz);
        const H = 16;
        geoAt(S.dark, G.cone6, bx, by + H * 0.5 - 1, bz, 2.6, H + 2, 2.6, 0, a, 0, 0.9);
        geoAt(S.glow, G.sphLo, bx, by + H * 0.55, bz, 0.7, 0.7, 0.7);
      }
    }
    // the gate on the rim: two leaning monoliths and a lintel shaped like a ring fragment
    {
      const x = c * (rTop + 10);
      const z = s * (rTop + 10);
      const gy = g(x, z);
      for (const side of [-1, 1]) {
        const bx = x + px * side * 13;
        const bz = z + pz * side * 13;
        const by = g(bx, bz);
        boxAt(S.dark, bx, by + 18, bz, 5.5, 42, 7, -a, 0.9, 0, -side * 0.06);
        boxAt(S.glyph, bx, by + 24, bz, 5.9, 12, 7.4, -a, 1, 0, -side * 0.06);
      }
      const lin = makeProfile([[-3, -3.5], [3, -3.5], [3, 3.5], [-3, 3.5]], { 1: 'glyph' });
      const st = { stone: S.stone.nv, glyph: S.glyph.nv };
      sweep(S, lin, 26, Math.PI / 2 - 0.75, Math.PI / 2 + 0.75, 10, { tint: 0.92 });
      _m2.makeRotationFromEuler(_e.set(Math.PI / 2, -a + Math.PI / 2, 0, 'YXZ'));
      _m2.setPosition(x, gy + 14, z);
      // sweep lies in XZ around the origin; stand it upright facing along the stair
      S.stone.transformFrom(st.stone, _m2);
      S.glyph.transformFrom(st.glyph, _m2);
      geoAt(S.glow, G.sphLo, x, gy + 42.5, z, 1.3, 1.3, 1.3);
      info.gate = [x, gy, z];
    }
  }

  return info;
}
