// The instrument of the Drowned Observatory: a colossal segmented telescope that has slid in its
// fork and now juts out of the dome's slot toward the north-western sky, snapped ~240 m from its
// pivot. Construction, in TUBE SPACE (origin = pivot, +y = tube axis, x = trunnion axis):
//   * shell of 24 thick bronze staves per 18 m segment, tapering; staves missing here and there,
//     two segments near the end are open lattice (stringers + zig-zag braces + inner tube);
//   * collars at every joint, every third one a black rune collar (glows cyan at night);
//   * a walkway with railing along the top of the tube (a scale cue: the posts are 1.3 m);
//   * an armillary cage at s = ARM_S: a fixed collar ring on spokes, a fixed ring containing the
//     axis, and a third tilted ring that slowly precesses around the tube (the only motion);
//   * torn end: stave lengths jitter, stringers stick out and bend, a cracked lens glows inside;
//     cables hang from the break, one reaching the water;
//   * the lost end section lies in the shallows below, its mouth up, lens still glowing.

import * as THREE from 'crownfall-world-three';
import { prism } from '../core/shapes.js';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const TC = Array.from({ length: 8 }, () => new THREE.Vector3());
const CUBE_SIGN = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export const SCOPE = {
  back: -46,
  breakS: 238,
  seg: 18,
  sectors: 24,
  armS: 158,
  radius: (s) => (s < 0 ? 12.5 : 13 - (s / 240) * 4.4),
};

/** Tube-space point at axial s, angle th, radius r. (x = cos, z = sin) */
function tp(out, s, th, r) {
  return out.set(Math.cos(th) * r, s, Math.sin(th) * r);
}

/**
 * One tube section in the CURRENT sink matrix (tube space). opts:
 *   s0, s1           axial range
 *   staveMissing(k, seg) -> bool
 *   torn: {jag}      jagged far end (stave lengths vary)
 */
function staves(S, mat, s0, s1, r0, r1, rng, missing, torn = 0) {
  const n = SCOPE.sectors;
  const dT = (Math.PI * 2) / n;
  const gap = 0.012;
  for (let k = 0; k < n; k++) {
    if (missing && missing(k)) continue;
    const t0 = k * dT + gap, t1 = (k + 1) * dT - gap;
    const e1 = torn ? s1 - rng() * torn : s1;
    const re1 = r0 + ((r1 - r0) * (e1 - s0)) / (s1 - s0);
    for (let i = 0; i < 8; i++) {
      const c = CUBE_SIGN[i];
      const s = c[2] ? s0 : e1; // z-bit -> along -axis keeps (tangent, radial, -axis) right-handed
      const rr = (c[2] ? r0 : re1) - (c[1] ? 0 : 0.9);
      tp(TC[i], s, c[0] ? t0 : t1, rr);
    }
    S.hexa(mat, TC, 0.9 + 0.14 * rng());
  }
}

function ringBand(S, mat, s, w, rIn, rOut, n, tint = 1, skip = null) {
  const dT = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    if (skip && skip(k)) continue;
    const t0 = k * dT, t1 = (k + 1) * dT;
    for (let i = 0; i < 8; i++) {
      const c = CUBE_SIGN[i];
      tp(TC[i], c[2] ? s - w / 2 : s + w / 2, c[0] ? t0 : t1, c[1] ? rOut : rIn);
    }
    S.hexa(mat, TC, tint);
  }
}

/** A ring (torus-like, rectangular section) of radius r in the plane spanned by a, b around c. */
export function flatRing(S, mat, c, a, b, r, w, h, n, tint = 1, from = 0, to = Math.PI * 2) {
  const nrm = _u.crossVectors(a, b).normalize().clone();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const t0 = from + ((to - from) * k) / n, t1 = from + ((to - from) * (k + 1)) / n;
    p0.copy(c).addScaledVector(a, Math.cos(t0) * r).addScaledVector(b, Math.sin(t0) * r);
    p1.copy(c).addScaledVector(a, Math.cos(t1) * r).addScaledVector(b, Math.sin(t1) * r);
    S.beam(mat, p0, p1, nrm, h, w, tint);
  }
}

/**
 * Build the whole instrument. F: { pivot (site Vector3), dir (unit), frame info }.
 * Returns { update(dt,t), object for the moving ring, anchors }.
 */
export function buildScope(ctx, S, M, F) {
  const rng = ctx.noise.createRng('observatory-scope');
  const d = F.dir.clone().normalize();
  const X = new THREE.Vector3().crossVectors(d, UP).normalize(); // trunnion axis (horizontal)
  const Z = new THREE.Vector3().crossVectors(X, d).normalize(); // "top" of the tube (up-ish)
  const tube = new THREE.Matrix4().makeBasis(X, d, Z).setPosition(F.pivot);
  // tube-space basis: x = X, y = d, z = Z. (X, d, Z) right-handed: X x d = Z.
  const anchors = { vines: [], lamps: [], lenses: [], breakPts: [] };

  const toSite = (v) => v.clone().applyMatrix4(tube);
  S.setMatrix(tube);

  // ---------------------------------------------------------------- the tube
  const joints = [];
  for (let s = SCOPE.back; s < SCOPE.breakS; s += SCOPE.seg) joints.push(s);
  const lattice = new Set([joints.length - 3, joints.length - 2]);
  for (let j = 0; j < joints.length; j++) {
    const s0 = joints[j];
    const s1 = Math.min(joints[j] + SCOPE.seg, SCOPE.breakS);
    const r0 = SCOPE.radius(s0), r1 = SCOPE.radius(s1);
    const last = j === joints.length - 1;
    const isLattice = lattice.has(j);
    if (!isLattice) {
      const lossy = s0 > 80 ? 0.1 : 0.03;
      staves(S, M.rib, s0 + 1.3, s1 - 1.3, r0, r1, rng, () => rng() < lossy, last ? 9 : 0);
    } else {
      // open lattice: inner tube + zig-zag braces between the stringers
      _m.makeTranslation(0, s0, 0);
      S.geo(M.rib, prism(12, r0 * 0.36, r1 * 0.36, s1 - s0, 1), _m, 0.8);
      const n = 8;
      for (let k = 0; k < n; k++) {
        const ta = (k / n) * Math.PI * 2, tb = ((k + 1) / n) * Math.PI * 2;
        const flip = (k + j) % 2;
        tp(_p, s0 + 1, flip ? ta : tb, r0 + 0.2);
        tp(_q, s1 - 1, flip ? tb : ta, r1 + 0.2);
        _u.set(Math.cos((ta + tb) / 2), 0, Math.sin((ta + tb) / 2));
        S.beam(M.rib, _p, _q, _u, 0.9, 0.9, 0.85);
      }
      // baffle ring halfway (a stiffening wheel visible through the lattice)
      ringBand(S, M.rib, (s0 + s1) / 2, 1.2, r0 * 0.36, (r0 + r1) / 2 - 0.2, 16, 0.8);
    }
    // stringers on the outside (8), continue through lattice segments
    const ns = 8;
    for (let k = 0; k < ns; k++) {
      const th = (k / ns) * Math.PI * 2 + Math.PI / ns;
      let e = s1;
      if (last) e = s1 + (rng() - 0.3) * 14; // torn ends stick out
      tp(_p, s0, th, r0 + 0.9);
      tp(_q, e, th, SCOPE.radius(e) + 0.9);
      _u.set(Math.cos(th), 0, Math.sin(th));
      S.beam(M.rib, _p, _q, _u, 1.3, 1.6, 0.95);
      if (last && rng() < 0.6) {
        // bent-out continuation
        _p.copy(_q);
        tp(_q, e + 4 + rng() * 7, th + (rng() - 0.5) * 0.3, SCOPE.radius(e) + 3 + rng() * 6);
        S.beam(M.rib, _p, _q, _u, 1.1, 1.3, 0.85);
      }
    }
    // collar at the joint start
    const rune = j % 3 === 1 && s0 > 0;
    const rc = SCOPE.radius(s0);
    if (rune) {
      ringBand(S, M.runeStatic, s0, 3.4, rc - 0.2, rc + 3.2, 32, 1);
      ringBand(S, M.rib, s0 - 2.2, 1.0, rc, rc + 2.4, 32, 0.8);
      ringBand(S, M.rib, s0 + 2.2, 1.0, rc, rc + 2.4, 32, 0.8);
    } else {
      ringBand(S, M.rib, s0, 2.6, rc - 0.2, rc + 2.2, 32, 0.95);
      // rivet bosses on the collar
      for (let k = 0; k < 12; k++) {
        const th = (k / 12) * Math.PI * 2;
        tp(_p, s0, th, rc + 2.4);
        _m.makeRotationY(-th).setPosition(_p);
        S.box(M.rib, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(1.0, 3.6, 1.8)), 0.85);
      }
    }
    // lenses inside (glow): one per three segments, and the cracked one at the break
    if (j % 4 === 2 && s0 > 30 && !last) anchors.lenses.push({ s: s0, r: rc - 1.2, whole: true });
    // vines hang from the underside of the outer segments
    if (s0 > 110) {
      for (let k = 0; k < 3; k++) {
        const th = -Math.PI / 2 + (rng() - 0.5) * 1.6; // around -Z (the underside)
        const s = s0 + rng() * SCOPE.seg;
        anchors.vines.push({ p: toSite(tp(_p, s, th, SCOPE.radius(s) + 1)), len: 5 + rng() * 22 });
      }
    }
  }
  anchors.lenses.push({ s: SCOPE.breakS - 16, r: SCOPE.radius(SCOPE.breakS - 16) - 1.2, whole: false });
  // back end: cap + counterweight housing + eyepiece block
  {
    const s = SCOPE.back;
    const r = SCOPE.radius(s);
    _m.makeTranslation(0, s - 6, 0);
    S.geo(M.rib, prism(24, r + 1.5, r + 1.5, 6, 1), _m, 0.8);
    _m.makeTranslation(0, s - 16, 0);
    S.geo(M.rib, prism(8, r * 0.7, r + 1, 10, 1), _m, 0.75);
    _m.makeTranslation(0, s - 10, -r - 6).multiply(_m2.makeScale(9, 14, 8));
    S.box(M.rib, _m, 0.8);
  }
  // trunnions + fork to the pier top
  {
    const r = SCOPE.radius(0);
    for (const side of [-1, 1]) {
      _m.makeRotationZ(Math.PI / 2).setPosition(side * (r + 5), 0, 0);
      S.geo(M.rib, new THREE.CylinderGeometry(6.5, 6.5, 10, 20, 1), _m, 0.85);
      _m.makeRotationZ(Math.PI / 2).setPosition(side * (r + 10.5), 0, 0);
      S.geo(M.runeStatic, new THREE.CylinderGeometry(8.5, 8.5, 2, 24, 1), _m, 1);
    }
  }
  // walkway along the top of the tube (from the dome exit to the break)
  {
    const s0 = F.exitS + 6;
    const s1 = SCOPE.breakS - 22;
    const n = Math.round((s1 - s0) / 3);
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n, b = s0 + ((s1 - s0) * (i + 1)) / n;
      if (rng() < 0.06) continue; // missing planks
      const ra = SCOPE.radius(a) + 3.2, rb = SCOPE.radius(b) + 3.2;
      _p.set(0, a, ra);
      _q.set(0, b, rb);
      S.beam(M.stone, _p, _q, _u.set(0, 0, 1), 2.6, 0.5, 0.9);
      // posts both sides + rails
      for (const side of [-1, 1]) {
        _p.set(side * 1.2, a, ra + 0.9);
        _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_m2.makeScale(0.22, 0.22, 1.5));
        S.box(M.rib, _m, 0.8);
      }
    }
    for (const side of [-1, 1]) {
      _p.set(side * 1.2, s0, SCOPE.radius(s0) + 4.7);
      _q.set(side * 1.2, s1, SCOPE.radius(s1) + 4.7);
      S.beam(M.rib, _p, _q, _u.set(0, 0, 1), 0.25, 0.25, 0.8);
    }
    anchors.walk = { s0, s1 };
  }

  // ---------------------------------------------------------------- armillary cage
  const C = new THREE.Vector3(0, SCOPE.armS, 0); // tube space
  const rt = SCOPE.radius(SCOPE.armS);
  const RA = 31;
  const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3(0, 1, 0), ez = new THREE.Vector3(0, 0, 1);
  // ring 1: perpendicular to the tube, on 6 spokes
  flatRing(S, M.rib, C, ex, ez, RA, 3.2, 3.8, 48, 0.95);
  flatRing(S, M.runeStatic, C, ex, ez, RA - 2.4, 2.4, 1.4, 48, 1);
  for (let k = 0; k < 6; k++) {
    const th = (k / 6) * Math.PI * 2 + 0.26;
    tp(_p, SCOPE.armS, th, rt + 2);
    tp(_q, SCOPE.armS, th, RA - 1.5);
    S.beam(M.rib, _p, _q, ey, 1.4, 2.2, 0.85);
  }
  ringBand(S, M.rib, SCOPE.armS, 5, rt - 0.1, rt + 3, 32, 0.9);
  // ring 2: contains the axis (alidade ring), broken at one end
  flatRing(S, M.rib, C, ey, ex, RA + 4, 2.6, 3.2, 56, 0.9, 0.35, Math.PI * 2 - 0.1);
  // ring 3 (moving) is built separately below; its bearing blocks on ring 2
  for (const t of [Math.PI / 2, -Math.PI / 2]) {
    _p.copy(C).addScaledVector(ey, Math.cos(t) * (RA + 4)).addScaledVector(ex, Math.sin(t) * (RA + 4));
    _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_m2.makeScale(5, 5, 5));
    S.box(M.rib, _m, 0.8);
  }
  anchors.lamps.push(toSite(new THREE.Vector3(0, SCOPE.armS, rt + 3.8)));

  // the moving ring: precesses slowly around the tube axis (object-space rune material)
  const moving = new THREE.Group();
  moving.name = 'observatory-armillary';
  {
    const MS = new S.constructor();
    MS.waterline = null;
    const tilt = new THREE.Matrix4().makeRotationX(0.62);
    MS.setMatrix(tilt);
    flatRing(MS, M.runeLocal, new THREE.Vector3(), ex, ez, RA + 9, 2.2, 3.0, 64, 1);
    // little "planet" knobs on it
    for (let k = 0; k < 5; k++) {
      const th = (k / 5) * Math.PI * 2;
      _m.makeTranslation(Math.cos(th) * (RA + 9), 0, Math.sin(th) * (RA + 9)).multiply(_m2.makeScale(3.4, 3.4, 3.4));
      MS.box(M.runeLocal, _m, 1);
    }
    const g = MS.build('observatory-armillary-ring');
    moving.add(g);
    const inner = new THREE.Group();
    // pivot sits at C in site space, aligned with the tube
    moving.position.copy(toSite(C));
    moving.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, d, Z));
    moving.userData.spin = g;
    void inner;
  }

  // ---------------------------------------------------------------- lenses (glow)
  const lensGeo = new THREE.CircleGeometry(1, 40);
  for (const L of anchors.lenses) {
    // disc faces both ways: two discs back to back
    for (const f of [1, -1]) {
      _m.makeTranslation(0, L.s + f * 0.05, 0)
        .multiply(_m2.makeRotationX(-f * Math.PI / 2))
        .multiply(new THREE.Matrix4().makeScale(L.r, L.r, 1));
      if (L.whole) S.geo(M.lens, lensGeo, _m, 0.55);
      else {
        // cracked: a pie with a wedge missing
        const g = new THREE.CircleGeometry(1, 30, 0.9, Math.PI * 1.35);
        S.geo(M.lens, g, _m, 1);
        g.dispose();
      }
    }
    ringBand(S, M.rib, L.s, 1.6, L.r - 0.6, L.r + 1.4, 32, 0.8);
  }

  // ---------------------------------------------------------------- the great armillary inside
  // The tube is the sighting rod of a colossal armillary sphere that fills the dome: great rings
  // centred on the pivot, oriented to the (world) celestial pole, seen through breach and slot.
  S.setMatrix(new THREE.Matrix4());
  {
    const c = F.pivot;
    const pole = new THREE.Vector3(0, Math.sin(38 * Math.PI / 180), -Math.cos(38 * Math.PI / 180));
    const ew = new THREE.Vector3(1, 0, 0);
    const eqB = new THREE.Vector3().crossVectors(pole, ew).normalize(); // in the equatorial plane
    const RR = 50;
    // equator (+ graduation teeth and lamp nodes), meridian, colure, horizon, ecliptic (rune band)
    flatRing(S, M.rib, c, ew, eqB, RR, 2.6, 3.6, 80, 0.95);
    for (let k = 0; k < 72; k++) {
      const t = (k / 72) * Math.PI * 2;
      _p.copy(c).addScaledVector(ew, Math.cos(t) * (RR + 2.4)).addScaledVector(eqB, Math.sin(t) * (RR + 2.4));
      _q.copy(c).addScaledVector(ew, Math.cos(t) * (RR + (k % 6 ? 3.6 : 5.6))).addScaledVector(eqB, Math.sin(t) * (RR + (k % 6 ? 3.6 : 5.6)));
      S.beam(M.rib, _p, _q, pole, 0.7, 0.9, 0.8);
      if (k % 6 === 0) anchors.lamps.push(_q.clone().addScaledVector(pole, 0));
    }
    flatRing(S, M.rib, c, UP, pole.clone().cross(ew).cross(UP).normalize().negate(), RR + 5, 2.2, 3.2, 84, 0.9);
    const colB = new THREE.Vector3().crossVectors(pole, eqB).normalize();
    flatRing(S, M.rib, c, pole, eqB, RR - 5, 2.0, 2.8, 72, 0.88, 0.2, Math.PI * 2 - 0.9); // broken colure
    flatRing(S, M.rib, c, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), RR + 11, 3.0, 4.2, 88, 0.85, 0.5, Math.PI * 1.55);
    void colB;
    const ecl = eqB.clone().applyAxisAngle(ew, 23.4 * Math.PI / 180);
    flatRing(S, M.runeStatic, c, ew, ecl, RR - 1.5, 5.0, 2.2, 80, 1);
    flatRing(S, M.rib, c, ew, ecl, RR - 4.2, 5.4, 1.2, 80, 0.8);
    // hub around the pivot
    _m.makeTranslation(c.x, c.y, c.z);
    S.geo(M.rib, new THREE.IcosahedronGeometry(7, 1), _m, 0.7);
  }

  // ---------------------------------------------------------------- cables from the break
  S.setMatrix(new THREE.Matrix4());
  const cables = [];
  for (let k = 0; k < 9; k++) {
    const th = rng() * Math.PI * 2;
    const s = SCOPE.breakS - 2 - rng() * 6;
    const top = toSite(tp(_p, s, th, SCOPE.radius(s) + 0.5));
    anchors.breakPts.push(top);
    const reach = k === 0 ? top.y + 2 : k < 3 ? top.y * (0.55 + 0.3 * rng()) : 15 + rng() * 60;
    const drift = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize().multiplyScalar(4 + rng() * 10);
    const pts = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = top.clone();
      p.y -= reach * t;
      p.addScaledVector(drift, Math.sin(t * Math.PI * 0.5) * t);
      pts.push(p);
    }
    if (k === 0) {
      // the one that reaches the lake coils out on the surface
      const end = pts[pts.length - 1];
      for (let i = 1; i < 8; i++) pts.push(new THREE.Vector3(end.x + i * 3, -0.3, end.z + Math.sin(i) * 3));
    }
    cables.push(pts);
  }
  // swag cables: from the break down to the armillary ring and to the slot rails
  const sag = (a, b, depth, n = 16) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -depth * 4 * t * (1 - t), 0)));
    }
    return pts;
  };
  for (let k = 0; k < 4; k++) {
    const th = (k / 4) * Math.PI * 2 + 0.4;
    const a = toSite(tp(_p, SCOPE.breakS - 20, th, SCOPE.radius(SCOPE.breakS - 20) + 1));
    const b = toSite(C.clone().addScaledVector(ex, Math.cos(th) * RA).addScaledVector(ez, Math.sin(th) * RA));
    cables.push(sag(a, b, 6 + rng() * 8));
  }
  for (const st of F.stayAnchors || []) {
    const a = toSite(tp(_p, st.s, st.th, SCOPE.radius(st.s) + 2.2));
    cables.push(sag(st.p, a, 2 + rng() * 3, 10));
  }
  for (const pts of cables) {
    for (let i = 0; i < pts.length - 1; i++) S.beam(M.cable, pts[i], pts[i + 1], UP, 0.55, 0.55, 0.9);
  }

  // ---------------------------------------------------------------- the lost end section
  {
    const L = 44;
    const r0 = SCOPE.radius(SCOPE.breakS), r1 = r0 - 0.7;
    const fall = F.fallen; // {pos (site), dir}
    const fd = fall.dir.clone().normalize();
    const fx = new THREE.Vector3().crossVectors(fd, UP).normalize();
    const fz = new THREE.Vector3().crossVectors(fx, fd).normalize();
    const fm = new THREE.Matrix4().makeBasis(fx, fd, fz).setPosition(fall.pos);
    S.setMatrix(fm);
    const frng = ctx.noise.createRng('observatory-fallen');
    staves(S, M.rib, 0, L * 0.5 - 1, r0, (r0 + r1) / 2, frng, (k) => k % 7 === 3, 0);
    staves(S, M.rib, L * 0.5 + 1, L, (r0 + r1) / 2, r1, frng, (k) => k === 5 || k === 6, 0);
    ringBand(S, M.rib, 0, 2.2, r0 - 0.2, r0 + 1.6, 32, 0.8, (k) => k > 20 && k < 25);
    ringBand(S, M.runeStatic, L * 0.5, 3.2, (r0 + r1) / 2 - 0.2, (r0 + r1) / 2 + 2.8, 32, 1);
    ringBand(S, M.rib, L, 3.4, r1 - 0.3, r1 + 2.4, 32, 0.85); // the mouth lip
    for (const f of [1, -1]) {
      _m.makeTranslation(0, L - 3 + f * 0.05, 0).multiply(_m2.makeRotationX(-f * Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(r1 - 1, r1 - 1, 1));
      S.geo(M.lens, lensGeo, _m, 0.8);
    }
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2 + 0.2;
      tp(_p, -3 - frng() * 6, th, r0 + 0.9);
      tp(_q, L, th, r1 + 0.9);
      S.beam(M.rib, _p, _q, _u.set(Math.cos(th), 0, Math.sin(th)), 1.3, 1.6, 0.9);
    }
    S.setMatrix(new THREE.Matrix4());
    anchors.fallenMouth = new THREE.Vector3(0, L, 0).applyMatrix4(fm);
  }
  lensGeo.dispose();

  const spinSpeed = (Math.PI * 2) / 420; // one turn in 7 minutes
  return {
    moving,
    anchors,
    toSite,
    update(dt) {
      const g = moving.userData.spin;
      g.rotation.y += dt * spinSpeed;
      g.updateMatrix();
    },
  };
}
