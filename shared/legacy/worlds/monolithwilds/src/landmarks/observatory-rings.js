// The drowned precinct around the dome (site-local, level — only the dome tipped):
//   * Ring gallery (r ~150–162): an outer two-storey arcade and an inner one-storey arcade whose
//     lower arches spring right at the waterline, so each arch and its reflection close into a
//     full circle; a walkway deck between them, an amber glyph frieze (glyphStone), cornices,
//     parapets. Whole sectors have collapsed — one where the lost end of the telescope fell.
//   * Ring of colossal drum columns (r ~212) rising from the lake bed; intact runs still carry an
//     architrave, others are snapped at random heights, a few lean, two lie in the water.
//   * Radial bridges from the gallery toward the dome, all broken short where the dome moved.
//   * Fragments of dome shell and rubble lying in the shallows.

import * as THREE from 'crownfall-world-three';
import { archedWall, prism } from '../core/shapes.js';
import { shellPatch, sphFrame, EL_EDGES, meridiansForBand } from './observatory-dome.js';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _ex = new THREE.Vector3();
const _ez = new THREE.Vector3();

/** Basis at azimuth a on a ring: x = -tangent, y = up, z = radial out (right-handed). */
function ringBasis(m, a, r, y) {
  const ca = Math.cos(a), sa = Math.sin(a);
  _ex.set(sa, 0, -ca);
  _ez.set(ca, 0, sa);
  return m.makeBasis(_ex, UP, _ez).setPosition(ca * r, y, sa * r);
}

function boxAt(S, mat, a, r, y, w, h, d, tint = 1) {
  ringBasis(_m, a, r, y);
  S.box(mat, _m.multiply(_s.makeScale(w, h, d)), tint);
}

export function buildRings(ctx, S, M, F) {
  const rng = ctx.noise.createRng('observatory-rings');
  const N = ctx.noise.worldNoise;
  const ground = (x, z) => ctx.heightAt(F.site.x + x, F.site.z + z);
  const anchors = { trees: [], vines: [], lamps: [] };
  S.setMatrix(new THREE.Matrix4());

  // ---------------------------------------------------------------- ring gallery
  const NBAY = 48;
  const RO = 162, RI = 148;
  const dA = (Math.PI * 2) / NBAY;
  const chordO = 2 * RO * Math.sin(dA / 2);
  const chordI = 2 * RI * Math.sin(dA / 2);
  const SPRING = 0.5; // lower arches spring just above the lake
  const wallO = archedWall({ width: chordO + 0.05, height: 16, span: chordO - 5, spring: SPRING + 3, rise: (chordO - 5) / 2, depth: 4.2, segments: 14 });
  const wallI = archedWall({ width: chordI + 0.05, height: 16, span: chordI - 5, spring: SPRING + 3, rise: (chordI - 5) / 2, depth: 3.6, segments: 14 });
  const upHalf = archedWall({ width: chordO / 2 + 0.05, height: 10, span: 5.4, spring: 4.2, rise: 2.7, depth: 2.6, segments: 8 });
  const upHalfBroken = archedWall({ width: chordO / 2 + 0.05, height: 6.2, span: 5.4, spring: 4.2, rise: 1.6, depth: 2.6, segments: 6 });
  // bay states: 0 gone, 1 lower only, 2 intact. Collapse sectors from the fallen tube + noise.
  const state = [];
  for (let b = 0; b < NBAY; b++) {
    const a = (b + 0.5) * dA;
    let st = 2;
    const n = N.noise2(Math.cos(a) * 3.1 + 11, Math.sin(a) * 3.1 - 4);
    if (n > 0.32) st = 1;
    if (n > 0.55) st = 0;
    for (const c of F.collapseAz) {
      let da = Math.abs(((a - c.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < c.half) st = 0;
      else if (da < c.half + dA * 1.5) st = Math.min(st, 1);
    }
    if (st === 2 && rng() < 0.1) st = 1;
    state.push(st);
  }
  for (let b = 0; b < NBAY; b++) {
    const a = (b + 0.5) * dA;
    const st = state[b];
    for (const [R, wall, chord, depth] of [[RO, wallO, chordO, 4.2], [RI, wallI, chordI, 3.6]]) {
      const inner = R === RI;
      // footing piers from the lake bed to just below the surface (both bay edges)
      for (const e of [0, 1]) {
        const ap = a + (e ? 0.5 : -0.5) * dA;
        const g = ground(Math.cos(ap) * R, Math.sin(ap) * R) - 2;
        const top = st === 0 && rng() < 0.6 ? -1.5 - rng() * 3 : -2.5;
        boxAt(S, M.base, ap, R, (g + top) / 2, 5.4, top - g, depth + 1.2, 0.85);
        if (st === 0 && top > -2.5) {
          // broken stumps poking out of the water
          if (rng() < 0.55) boxAt(S, M.stone, ap + (rng() - 0.5) * 0.01, R, 0.6 + rng() * 2, 4.8, 3 + rng() * 5, depth, 0.9);
        }
      }
      if (st === 0) continue;
      ringBasis(_m, a, R * Math.cos(dA / 2), -2.5);
      S.geo(M.stone, wall, _m, 0.93 + 0.08 * rng());
      // frieze with the glyph band (glyphStone bands are centred on y = 13.5)
      const fr = R * Math.cos(dA / 2);
      boxAt(S, M.glyph, a, fr + 0.4, 12.2 + 1.5, chord + 0.6, 3.0, depth + 0.6, 1);
      boxAt(S, M.stone, a, fr + 0.6, 15.8, chord + 1.2, 1.2, depth + 1.8, 0.95);
      // keystone blocks
      boxAt(S, M.stone, a, fr + 0.3, SPRING + (chord - 5) / 2 + 3.3, 2.2, 3.2, depth + 0.8, 1.02);
      if (inner) {
        // parapet on the inner ring
        for (let k = 0; k < 6; k++) {
          const ak = a + ((k + 0.5) / 6 - 0.5) * dA;
          boxAt(S, M.stone, ak, fr, 17.2, 1.2, 1.6, 0.9, 0.95);
        }
        boxAt(S, M.stone, a, fr, 18.2, chord, 0.5, 1.1, 0.95);
        continue;
      }
      if (st === 2) {
        // upper storey: two small arches per bay + cornice + crenellated parapet
        for (const h of [-0.25, 0.25]) {
          ringBasis(_m, a + h * dA, fr - 0.4, 16.4);
          S.geo(M.stone, upHalf, _m, 0.9 + 0.08 * rng());
        }
        boxAt(S, M.stone, a, fr + 0.3, 26.9, chord + 1.4, 1.2, 4.4, 0.95);
        for (let k = 0; k < 4; k++) {
          if (rng() < 0.2) continue;
          const ak = a + ((k + 0.5) / 4 - 0.5) * dA;
          boxAt(S, M.stone, ak, fr - 0.4, 28.4 + rng() * 0.3, 2.4, 1.8, 2.2, 0.9);
        }
        if (rng() < 0.3) anchors.trees.push({ p: new THREE.Vector3(Math.cos(a) * (fr - 0.5), 27.5, Math.sin(a) * (fr - 0.5)), s: 0.45 + rng() * 0.4 });
        if (rng() < 0.4) anchors.vines.push({ p: new THREE.Vector3(Math.cos(a) * (fr + 2.4), 26.2, Math.sin(a) * (fr + 2.4)), len: 5 + rng() * 14 });
      } else {
        // broken upper storey: stubs
        for (const h of [-0.25, 0.25]) {
          if (rng() < 0.4) continue;
          ringBasis(_m, a + h * dA, fr - 0.4, 16.4);
          S.geo(M.stone, upHalfBroken, _m, 0.88);
        }
        if (rng() < 0.4) anchors.vines.push({ p: new THREE.Vector3(Math.cos(a) * (fr + 1.5), 16, Math.sin(a) * (fr + 1.5)), len: 4 + rng() * 9 });
      }
      if (rng() < 0.16) anchors.lamps.push(new THREE.Vector3(Math.cos(a) * (fr - 1), 17.6, Math.sin(a) * (fr - 1)));
    }
    if (st === 0) continue;
    // walkway deck between the two arcades (the gallery floor), with paving joints
    {
      const r0 = RI + 1.5, r1 = RO - 1.8;
      const a0 = a - dA / 2, a1 = a + dA / 2;
      const TC = DECK;
      for (let i = 0; i < 8; i++) {
        const s = SIGN[i];
        const r = s[1] ? r1 : r0;
        const an = s[0] ? a1 : a0;
        TC[i].set(Math.cos(an) * r, s[2] ? 16.4 : 15.2, Math.sin(an) * r);
      }
      S.hexa(M.stone, TC, 0.85);
      if (rng() < 0.35) anchors.trees.push({ p: new THREE.Vector3(Math.cos(a) * (RI + 7), 16.4, Math.sin(a) * (RI + 7)), s: 0.5 + rng() * 0.5 });
    }
    // cross vault ribs below the deck (visible through the arches)
    boxAt(S, M.stone, a - dA / 2, (RI + RO) / 2, 13.6, 2.2, 3.2, RO - RI, 0.8);
  }

  // ---------------------------------------------------------------- radial bridges (broken)
  for (const bz of F.bridgeAz) {
    const len = 14 + rng() * 10;
    const r1 = RI - 1;
    const r0 = r1 - len;
    const a = bz;
    // deck and parapets
    ringBasis(_m, a, (r0 + r1) / 2, 15.8);
    S.box(M.stone, _m2.copy(_m).multiply(_s.makeScale(8, 1.4, len)), 0.9);
    for (const side of [-1, 1]) {
      ringBasis(_m, a, (r0 + r1) / 2, 17.2);
      _m.multiply(_m2.makeTranslation(side * 3.6, 0, 0));
      S.box(M.stone, _m.multiply(_s.makeScale(0.8, 1.4, len - rng() * 5)), 0.92);
    }
    // arch under it
    const g = archedWall({ width: 8, height: 14, span: 5.5, spring: 6, rise: 2.75, depth: len * 0.7, segments: 8 });
    ringBasis(_m, a, r1 - len * 0.35 - 0.5, 1.2);
    // rotate so the arch opening runs tangentially (the bridge spans radially)
    _m.multiply(_m2.makeRotationY(Math.PI / 2));
    S.geo(M.stone, g, _m, 0.88);
    g.dispose();
    // footing pier into the lake
    const gx = Math.cos(a) * (r1 - len * 0.35), gz = Math.sin(a) * (r1 - len * 0.35);
    const gy = ground(gx, gz) - 2;
    boxAt(S, M.base, a, r1 - len * 0.35, (gy + 1.5) / 2, 9, 1.5 - gy, len * 0.7 + 1, 0.8);
    // broken end: tumbled blocks
    for (let k = 0; k < 5; k++) {
      ringBasis(_m, a + (rng() - 0.5) * 0.04, r0 - 1 - rng() * 6, 0.3 + rng() * 1.5);
      _m.multiply(_m2.makeRotationFromEuler(new THREE.Euler(rng() * 0.8, rng() * 3, rng() * 0.8)));
      S.box(M.stone, _m.multiply(_s.makeScale(3 + rng() * 3, 2 + rng() * 2, 2 + rng() * 3)), 0.85);
    }
    anchors.vines.push({ p: new THREE.Vector3(Math.cos(a) * r0, 15, Math.sin(a) * r0), len: 6 + rng() * 8 });
  }

  // ---------------------------------------------------------------- colossal column ring
  const NC = 44;
  const RC = 214;
  const colH = 40;
  const drum = prism(18, 2.9, 2.85, 4.4, 1);
  const cap0 = prism(18, 2.9, 4.1, 2.6, 1);
  const colState = [];
  for (let c = 0; c < NC; c++) {
    const a = (c / NC) * Math.PI * 2 + 0.05;
    const n = N.noise2(Math.cos(a) * 2.2 - 7, Math.sin(a) * 2.2 + 3);
    let top = colH;
    let kind = 'intact';
    if (n > 0.18 || rng() < 0.22) {
      kind = 'broken';
      top = 4 + rng() * 30;
    }
    if (rng() < 0.05) kind = 'fallen';
    else if (kind === 'broken' && rng() < 0.18) kind = 'lean';
    colState.push({ a, top, kind });
  }
  for (let c = 0; c < NC; c++) {
    const { a, top, kind } = colState[c];
    const x = Math.cos(a) * RC, z = Math.sin(a) * RC;
    const g = ground(x, z) - 2;
    if (kind === 'fallen') {
      // stump + a toppled shaft lying half in the water toward the next column
      boxAt(S, M.base, a, RC, (g - 1) / 2, 8, -1 - g, 8, 0.85);
      _m.makeTranslation(x, g, z);
      S.geo(M.marbleCol, prism(18, 2.9, 2.9, 2 - g, 1), _m, 0.9);
      const dir = new THREE.Vector3(-Math.sin(a), -0.12, Math.cos(a)).normalize();
      const base = new THREE.Vector3(x, 1.5, z);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      for (let k = 0; k < 6; k++) {
        const p = base.clone().addScaledVector(dir, 3 + k * 4.6);
        _m.compose(p, q, new THREE.Vector3(1, 1, 1));
        _m.multiply(_m2.makeRotationY(rng() * 0.3));
        S.geo(M.marbleCol, drum, _m, 0.85 + 0.1 * rng());
      }
      continue;
    }
    // plinth below water + shaft (one long piece under water, drums above)
    boxAt(S, M.base, a, RC, (g - 3) / 2, 8, -3 - g, 8, 0.85);
    boxAt(S, M.base, a, RC, -1.2, 7.4, 3.6, 7.4, 0.8);
    const lean = kind === 'lean' ? 0.1 + rng() * 0.08 : 0;
    const leanM = new THREE.Matrix4().makeTranslation(x, 0.6, z).multiply(_m2.makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), lean));
    _m.makeTranslation(x, g, z);
    S.geo(M.marbleCol, prism(18, 2.9, 2.9, 0.6 - g, 1), _m, 0.8);
    let y = 0;
    let k = 0;
    while (y < top) {
      const h = Math.min(4.4, top - y);
      const m = leanM.clone().multiply(_m2.makeTranslation(0, y, 0));
      // last drum of a broken column is cocked and shortened
      if (kind !== 'intact' && y + 4.4 >= top) m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rng() - 0.5) * 0.25, rng(), (rng() - 0.5) * 0.25)));
      m.multiply(new THREE.Matrix4().makeScale(1, h / 4.4, 1));
      S.geo(M.marbleCol, drum, m, 0.86 + 0.14 * rng());
      y += 4.4;
      k++;
    }
    if (kind === 'intact') {
      const m = leanM.clone().multiply(_m2.makeTranslation(0, top, 0));
      S.geo(M.marbleCol, cap0, m, 0.95);
      _m.copy(leanM).multiply(_m2.makeTranslation(0, top + 3.6, 0)).multiply(_s.makeScale(9.4, 2, 9.4));
      S.box(M.stone, _m, 0.95);
      if (rng() < 0.4) anchors.trees.push({ p: new THREE.Vector3(x, top + 4.6, z), s: 0.35 + rng() * 0.3 });
    } else if (top > 12 && rng() < 0.5) {
      anchors.vines.push({ p: new THREE.Vector3(x + Math.cos(a) * 3, top - 0.5, z + Math.sin(a) * 3), len: 3 + rng() * 8 });
    }
    colState[c].x = x;
    colState[c].z = z;
  }
  // architrave over intact neighbours
  for (let c = 0; c < NC; c++) {
    const A = colState[c], B = colState[(c + 1) % NC];
    if (A.kind !== 'intact' || B.kind !== 'intact') continue;
    const am = (A.a + (B.a < A.a ? B.a + Math.PI * 2 : B.a)) / 2;
    const chord = 2 * RC * Math.sin(Math.PI / NC);
    boxAt(S, M.stone, am, RC * Math.cos(Math.PI / NC), colH + 6.4, chord + 8, 3.6, 5.6, 0.95);
    boxAt(S, M.glyph, am, RC * Math.cos(Math.PI / NC), colH + 8.9, chord + 8.6, 1.4, 6.2, 1);
  }

  // ---------------------------------------------------------------- shell fragments in the shallows
  const frags = F.fragments;
  for (const f of frags) {
    const j = f.j;
    const nm = meridiansForBand(j);
    const dAz = (Math.PI * 2) / nm;
    const first = f.i0 - Math.floor(f.cells / 2);
    const az = F.fragAz0 + (first + f.cells / 2) * dAz;
    const el = (EL_EDGES[j] + EL_EDGES[j + f.bands]) / 2;
    const B = sphFrame(new THREE.Matrix4(), az, el, F.R);
    const Binv = B.clone().invert();
    const fm = new THREE.Matrix4()
      .makeTranslation(f.x, f.y, f.z)
      .multiply(_m2.makeRotationY(f.yaw))
      .multiply(new THREE.Matrix4().makeRotationX(f.tilt))
      .multiply(new THREE.Matrix4().makeRotationZ(f.roll || 0))
      .multiply(Binv);
    S.setMatrix(fm);
    shellPatch(S, M, {
      R: F.R,
      rng,
      az0: F.fragAz0,
      j0: j,
      j1: j + f.bands,
      meridians: () => Array.from({ length: f.cells }, (_, k) => first + k),
      keepTile: () => (rng() < 0.82 ? 1 : 0),
      keepRib: () => (rng() < 0.85 ? 1 : 0),
      tone: 0.9,
    });
    S.setMatrix(new THREE.Matrix4());
    anchors.vines.push({ p: new THREE.Vector3(f.x, f.y + 6, f.z), len: 3 + rng() * 4 });
  }

  // ---------------------------------------------------------------- rubble at the waterline
  const rubbleMats = [M.stone, M.stone, M.shell, M.base];
  for (let k = 0; k < 170; k++) {
    let r, a;
    const which = rng();
    if (which < 0.45) {
      // around collapsed gallery bays
      const b = Math.floor(rng() * NBAY);
      if (state[b] === 2) continue;
      a = (b + rng()) * dA;
      r = RI - 4 + rng() * (RO - RI + 12);
    } else if (which < 0.8) {
      a = rng() * Math.PI * 2;
      r = F.domeFoot(a) + rng() * 14;
    } else {
      a = rng() * Math.PI * 2;
      r = RC + (rng() - 0.5) * 16;
    }
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 1.5 + rng() * rng() * 6;
    _m.makeRotationFromEuler(new THREE.Euler(rng() * 1.2, rng() * 6.3, rng() * 1.2));
    _m.setPosition(x, -s * 0.35 + rng() * s * 0.4, z);
    S.box(rubbleMats[Math.floor(rng() * rubbleMats.length)], _m.multiply(_s.makeScale(s * (1 + rng()), s * (0.5 + rng() * 0.6), s * (0.8 + rng()))), 0.8 + rng() * 0.2);
  }
  return anchors;
}

const DECK = Array.from({ length: 8 }, () => new THREE.Vector3());
const SIGN = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
