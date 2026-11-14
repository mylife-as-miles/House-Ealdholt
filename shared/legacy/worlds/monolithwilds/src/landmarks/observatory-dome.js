// The dome of the Drowned Observatory, built in DOME-LOCAL space (y = dome axis, origin at the
// centre of the spring circle); the caller's frame matrix tilts it ~20° and sinks it.
//
// Construction logic:
//   * a sphere of bronze I-beam meridian ribs + latitude rings (meridians thin out toward the crown
//     the way real domes do), each cell filled with thick marble tiles;
//   * breaches (noise-edged cones), crack lines (noise ridges) and scattered losses remove tiles —
//     tiles at a breach edge are knocked loose (shifted / rotated); ribs mostly survive, some snap;
//   * the observation slot: two parallel rails (small circles, not meridians) from the spring over
//     the crown, with a gear rack, one shutter leaf still closed at the bottom and one hanging;
//   * a 40-bay arcaded drum on a stepped basalt plinth, interior galleries on corbels with
//     balustrades, freestanding stair flights, a flooded floor and the instrument's pier.
// Anything that ends up deeper than ~10 m below the lake surface is not built.

import * as THREE from 'crownfall-world-three';
import { archedWall, stairs as stairGeo, prism } from '../core/shapes.js';

const DEG = Math.PI / 180;
export const EL_EDGES = [0, 9, 18, 27, 36, 45, 54, 63, 72, 81].map((d) => d * DEG);
export const meridiansForBand = (j) => (j < 5 ? 40 : j < 8 ? 20 : 10);

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _ex = new THREE.Vector3();
const _ey = new THREE.Vector3();
const _ez = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function sph(out, az, el, r) {
  const ce = Math.cos(el);
  return out.set(ce * Math.cos(az) * r, Math.sin(el) * r, ce * Math.sin(az) * r);
}

/** Basis at a sphere point: x = east-ish (increasing az), y = radial, z = toward the pole. */
export function sphFrame(out, az, el, r) {
  const ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az), sa = Math.sin(az);
  _ex.set(-sa, 0, ca);
  _ey.set(ce * ca, se, ce * sa);
  _ez.set(-se * ca, ce, -se * sa);
  out.makeBasis(_ex, _ey, _ez);
  out.setPosition(_ey.x * r, _ey.y * r, _ey.z * r);
  return out;
}

/**
 * Emit one thick tile of the shell between (az0..az1, el0..el1), radii rIn..rOut.
 * `loose` = optional Matrix4 applied around the tile centre (knocked-loose tiles).
 */
const TC = Array.from({ length: 8 }, () => new THREE.Vector3());
const CUBE_SIGN = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
export function shellTile(S, mat, az0, az1, el0, el1, rIn, rOut, tint, loose = null) {
  for (let i = 0; i < 8; i++) {
    const s = CUBE_SIGN[i];
    sph(TC[i], s[0] ? az1 : az0, s[2] ? el1 : el0, s[1] ? rOut : rIn);
  }
  if (loose) {
    _u.set(0, 0, 0);
    for (let i = 0; i < 8; i++) _u.add(TC[i]);
    _u.multiplyScalar(1 / 8);
    for (let i = 0; i < 8; i++) TC[i].sub(_u).applyMatrix4(loose).add(_u);
  }
  S.hexa(mat, TC, tint);
}

/**
 * The shell patch generator, shared with the fallen fragments: tiles + ribs for a range of
 * bands/meridians, with a `keep(az, el)` predicate deciding which tiles exist.
 */
export function shellPatch(S, M, o) {
  const { R, rng, keepTile, keepRib, wy = null, tone = 1, looseAt = null } = o;
  const T = 1.5; // shell thickness
  const j0 = o.j0 ?? 0, j1 = o.j1 ?? EL_EDGES.length - 1;
  const states = [];
  for (let j = j0; j < j1; j++) {
    const nm = meridiansForBand(j);
    const dAz = (Math.PI * 2) / nm;
    const el0 = EL_EDGES[j], el1 = EL_EDGES[j + 1];
    const iList = o.meridians ? o.meridians(j, nm) : null;
    const count = iList ? iList.length : nm;
    for (let k = 0; k < count; k++) {
      const i = iList ? iList[k] : k;
      const a0 = o.az0 + i * dAz;
      const a1 = a0 + dAz;
      if (wy) {
        sph(_p, a0 + dAz / 2, (el0 + el1) / 2, R);
        if (wy(_p) < -12) continue;
      }
      const width = R * Math.cos((el0 + el1) / 2) * dAz;
      const nu = Math.max(1, Math.round(width / 5.6));
      const nv = 3;
      const gap = 0.16;
      // decide every tile of the cell first: an intact cell gets a backing slab so the joints
      // read as grooves instead of slits into the dark interior
      states.length = 0;
      let intact = true;
      for (let u = 0; u < nu; u++) {
        for (let v = 0; v < nv; v++) {
          const caz = a0 + (dAz * (u + 0.5)) / nu;
          const cel = el0 + ((el1 - el0) * (v + 0.5)) / nv;
          const st = keepTile(caz, cel, j, i, u, v);
          states.push(st);
          if (st !== 1) intact = false;
        }
      }
      const cellTone = tone * (0.9 + 0.12 * rng()) * (rng() < 0.1 ? 0.8 : 1);
      if (intact) {
        const ga = 1.3 / (R * Math.cos(el1) + 1e-3), ge = 1.3 / R;
        shellTile(S, M.shell, a0 + ga, a1 - ga, el0 + ge, el1 - ge, R - 1.6, R - 0.7, cellTone * 0.7);
      }
      let n = 0;
      for (let u = 0; u < nu; u++) {
        for (let v = 0; v < nv; v++) {
          const state = states[n++];
          if (!state) continue;
          const ta0 = a0 + (dAz * u) / nu, ta1 = a0 + (dAz * (u + 1)) / nu;
          const te0 = el0 + ((el1 - el0) * v) / nv, te1 = el0 + ((el1 - el0) * (v + 1)) / nv;
          const cel = (te0 + te1) / 2, caz = (ta0 + ta1) / 2;
          if (wy) {
            sph(_p, caz, cel, R);
            if (wy(_p) < -9) continue;
          }
          const ga = gap / (R * Math.cos(cel) + 1e-3);
          const ge = gap / R;
          const tint = cellTone * (0.9 + 0.12 * rng()) * (rng() < 0.05 ? 0.8 : 1);
          let loose = null;
          if (state === 2 && looseAt) loose = looseAt(caz, cel);
          const rOut = R + (rng() - 0.5) * 0.3;
          shellTile(S, M.shell, ta0 + ga, ta1 - ga, te0 + ge, te1 - ge, intact ? R - 0.75 : rOut - T, rOut, tint, loose);
        }
      }
    }
  }
  // ribs
  for (let j = j0; j < j1; j++) {
    const nm = meridiansForBand(j);
    const dAz = (Math.PI * 2) / nm;
    const el0 = EL_EDGES[j], el1 = EL_EDGES[j + 1];
    const iList = o.meridians ? o.meridians(j, nm) : null;
    const count = iList ? iList.length : nm;
    for (let k = 0; k < count; k++) {
      const i = iList ? iList[k] : k;
      const az = o.az0 + i * dAz;
      // meridian rib: two straight pieces per band (I-beam: outer flange, web, inner flange)
      for (let h = 0; h < 2; h++) {
        const e0 = el0 + ((el1 - el0) * h) / 2, e1 = el0 + ((el1 - el0) * (h + 1)) / 2;
        const r = keepRib ? keepRib('m', az, (e0 + e1) / 2, j, i) : 1;
        if (!r) continue;
        if (wy) {
          sph(_p, az, (e0 + e1) / 2, R);
          if (wy(_p) < -9) continue;
        }
        ribPiece(S, M.rib, az, az, e0, e1, R, r === 2 ? 0.6 : 1);
      }
      // latitude ring piece at el1 (the top edge of this band) toward the next meridian
      if (j + 1 < EL_EDGES.length) {
        const r = keepRib ? keepRib('l', az + dAz / 2, el1, j, i) : 1;
        if (r) {
          sph(_p, az + dAz / 2, el1, R);
          if (!wy || wy(_p) > -9) {
            sph(_p, az, el1, R + 0.4);
            sph(_q, az + dAz, el1, R + 0.4);
            sph(_u, az + dAz / 2, el1, 1);
            S.beam(M.rib, _p, _q, _u, 1.3, 2.8);
            // node boss where meridian meets ring
            sphFrame(_m, az, el1, R + 3.4);
            _m.multiply(_m2.makeScale(4.2, 1.4, 4.2));
            S.box(M.rib, _m, 0.9);
          }
        }
      }
    }
  }
}

const _rp0 = new THREE.Vector3();
const _rp1 = new THREE.Vector3();
const _rn = new THREE.Vector3();
function ribPiece(S, mat, az0, az1, e0, e1, R, scale = 1) {
  sph(_rn, (az0 + az1) / 2, (e0 + e1) / 2, 1);
  // outer flange
  sph(_rp0, az0, e0, R + 3.3);
  sph(_rp1, az1, e1, R + 3.3);
  S.beam(mat, _rp0, _rp1, _rn, 2.9 * scale, 0.8);
  // web
  sph(_rp0, az0, e0, R + 1.0);
  sph(_rp1, az1, e1, R + 1.0);
  S.beam(mat, _rp0, _rp1, _rn, 1.0 * scale, 4.0);
  // inner flange
  sph(_rp0, az0, e0, R - 1.9);
  sph(_rp1, az1, e1, R - 1.9);
  S.beam(mat, _rp0, _rp1, _rn, 2.2 * scale, 0.6);
}

/**
 * Build the whole dome. F = frame info from observatory.js:
 *   R, drumH, slot {az, w, alphaMax}, wy(localVec) -> world y, breaches [{dir, rad}], toSite (Matrix4)
 * Returns anchors for the other parts (lantern spots, tree spots, pier top, etc.).
 */
export function buildDome(ctx, S, M, F) {
  const rng = ctx.noise.createRng('observatory-dome');
  const N = ctx.noise.worldNoise;
  const { R, slot, wy } = F;
  const DH = F.drumH;
  const anchors = { trees: [], vines: [], lamps: [], railLamps: [] };

  // slot geometry (dome local)
  const uS = new THREE.Vector3(Math.cos(slot.az), 0, Math.sin(slot.az));
  const nG = new THREE.Vector3(-Math.sin(slot.az), 0, Math.cos(slot.az));
  const halfW = slot.w / 2;
  const inSlot = (p, margin = 0) => {
    const off = Math.abs(p.dot(nG));
    if (off > halfW + margin) return false;
    const alpha = Math.atan2(p.y, p.dot(uS));
    return alpha > -0.05 && alpha < slot.alphaMax;
  };

  // breach mask (dir: unit local vectors)
  const breachDist = (u) => {
    let best = 1e9;
    for (const b of F.breaches) {
      const ang = Math.acos(Math.min(1, Math.max(-1, u.dot(b.dir))));
      const edge = b.rad * (1 + 0.26 * N.noise3(u.x * 3.1 + b.seed, u.y * 3.1, u.z * 3.1) + 0.14 * N.noise3(u.x * 9, u.y * 9 + b.seed, u.z * 9));
      best = Math.min(best, ang - edge);
    }
    return best;
  };
  // crack lines: thin ridges of a low-frequency noise field
  const crack = (u) => Math.abs(N.noise3(u.x * 2.3 + 7.7, u.y * 2.3 - 3.1, u.z * 2.3 + 1.3));

  S.setMatrix(F.frame);

  // ---------------------------------------------------------------- shell tiles + ribs
  const tileState = (az, el) => {
    sph(_u, az, el, 1);
    sph(_p, az, el, R);
    if (inSlot(_p, 1.8)) return 0;
    const bd = breachDist(_u);
    if (bd < 0) return 0;
    const c = crack(_u);
    if (c < 0.018 && el > 0.15) return 0;
    if (rng() < 0.02) return 0;
    if (bd < 0.05 || c < 0.034) return rng() < 0.45 ? 2 : rng() < 0.6 ? 1 : 0;
    return 1;
  };
  const looseAt = (az, el) => {
    // knocked loose: sag inward / lift outward, rotated about a random axis a few degrees
    _u.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    _m.makeRotationAxis(_u, (rng() - 0.3) * 0.28);
    sph(_q, az, el, 1).multiplyScalar((rng() - 0.65) * 3.2);
    _m.setPosition(_q);
    return _m;
  };
  const ribState = (kind, az, el) => {
    sph(_p, az, el, R);
    if (inSlot(_p, -1.5)) return 0;
    sph(_u, az, el, 1);
    const bd = breachDist(_u);
    // inside a breach the skeleton is broken too: latitude rings mostly gone, meridians partly
    if (bd < -0.05) {
      if (kind === 'l') return rng() < 0.62 ? 0 : 1;
      return rng() < 0.42 ? 0 : rng() < 0.4 ? 2 : 1;
    }
    return 1;
  };
  shellPatch(S, M, { R, rng, az0: slot.az + (Math.PI * 2) / 80, keepTile: tileState, keepRib: ribState, wy, looseAt });

  // snapped rib ends hanging into the main breach: short bent pieces
  for (const b of F.breaches) {
    const n = b.hanging ?? 4;
    for (let k = 0; k < n; k++) {
      const az = Math.atan2(b.dir.z, b.dir.x) + (rng() - 0.5) * b.rad * 1.4;
      const el = Math.asin(b.dir.y) + (rng() - 0.5) * b.rad;
      sph(_p, az, el + b.rad * 0.6, R + 1);
      sph(_u, az, el, 1);
      _q.copy(_p).addScaledVector(_u, -6 - rng() * 8).add(_ex.set(0, -(4 + rng() * 10), 0));
      S.beam(M.rib, _p, _q, _u, 1.2, 3.2, 0.85, 0.6);
    }
  }

  // crown compression ring (oculus) at el 81°, broken by the slot
  {
    const el = EL_EDGES[EL_EDGES.length - 1];
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      sph(_p, (a0 + a1) / 2, el, R);
      if (inSlot(_p, 2)) continue;
      sph(_p, a0, el, R + 1.2);
      sph(_q, a1, el, R + 1.2);
      sph(_u, (a0 + a1) / 2, el, 1);
      S.beam(M.rib, _p, _q, _u, 4.5, 5.5);
      sph(_p, a0, el + 0.012, R + 4.4);
      sph(_q, a1, el + 0.012, R + 4.4);
      S.beam(M.rib, _p, _q, _u, 2.2, 1.2, 0.9);
    }
  }

  // ---------------------------------------------------------------- the slot rails
  const railPoint = (out, side, alpha, r) => {
    const rr = Math.sqrt(Math.max(1, r * r - halfW * halfW));
    return out.copy(uS).multiplyScalar(Math.cos(alpha) * rr).addScaledVector(UP, Math.sin(alpha) * rr).addScaledVector(nG, side * halfW);
  };
  const RAIL_STEPS = 64;
  for (const side of [-1, 1]) {
    for (let s = 0; s < RAIL_STEPS; s++) {
      const a0 = (s / RAIL_STEPS) * slot.alphaMax;
      const a1 = ((s + 1) / RAIL_STEPS) * slot.alphaMax;
      railPoint(_p, side, (a0 + a1) / 2, R);
      if (wy(_p) < -9) continue;
      _u.copy(_p).normalize();
      // main rail (tall box girder) + wide base flange
      railPoint(_p, side, a0, R + 2.2);
      railPoint(_q, side, a1, R + 2.2);
      S.beam(M.rib, _p, _q, _u, 3.4, 8.4);
      railPoint(_p, side, a0, R + 0.2);
      railPoint(_q, side, a1, R + 0.2);
      // flange shifted away from the slot so it covers the tile edges
      _p.addScaledVector(nG, side * 3.6);
      _q.addScaledVector(nG, side * 3.6);
      S.beam(M.rib, _p, _q, _u, 7.2, 0.9, 0.92);
      // gear rack teeth along the rail crest
      const len = (a1 - a0) * R;
      const teeth = Math.max(1, Math.round(len / 3.2));
      for (let t = 0; t < teeth; t++) {
        const a = a0 + ((t + 0.5) / teeth) * (a1 - a0);
        railPoint(_p, side, a, R + 6.9);
        railPoint(_q, side, a + 0.4 / R, R + 6.9);
        S.beam(M.rib, _p, _q, _u, 2.4, 1.3, 0.8);
      }
      // amber lamps along the inner lip of the slot (sparse; they light the slot at night)
      if (s % 5 === 2) {
        railPoint(_p, side, (a0 + a1) / 2, R - 2.5);
        _p.addScaledVector(nG, -side * 1.9);
        anchors.railLamps.push(_p.clone());
      }
      // transverse frames across the slot every few steps (the shutter carriage track)
      if (s % 8 === 0 && side === 1) {
        const a = (a0 + a1) / 2;
        // leave the opening the tube passes through
        if (a > slot.clearA0 && a < slot.clearA1) continue;
        railPoint(_p, -1, a, R - 1.5);
        railPoint(_q, 1, a, R - 1.5);
        S.beam(M.rib, _p, _q, _u, 1.6, 2.2, 0.85);
      }
    }
  }
  // shutter leaves: one still closed at the bottom, one hanging from a rail into the interior
  {
    const leaf = (alpha0, alpha1, hinge) => {
      const nA = 4, nT = 3;
      for (let a = 0; a < nA; a++) {
        for (let t = 0; t < nT; t++) {
          const al0 = alpha0 + ((alpha1 - alpha0) * a) / nA + 0.002;
          const al1 = alpha0 + ((alpha1 - alpha0) * (a + 1)) / nA - 0.002;
          const t0 = -1 + (2 * t) / nT + 0.02, t1 = -1 + (2 * (t + 1)) / nT - 0.02;
          const pts = TC;
          for (let i = 0; i < 8; i++) {
            const s = CUBE_SIGN[i];
            const al = s[2] ? al1 : al0;
            const tt = s[0] ? t1 : t0;
            const r = s[1] ? R + 1.2 : R - 0.2;
            const rr = Math.sqrt(r * r - (tt * halfW) ** 2);
            pts[i].copy(uS).multiplyScalar(Math.cos(al) * rr).addScaledVector(UP, Math.sin(al) * rr).addScaledVector(nG, tt * halfW);
            if (hinge) pts[i].sub(hinge.o).applyMatrix4(hinge.m).add(hinge.o);
          }
          if (!hinge && rng() < 0.12) continue;
          S.hexa(M.shell, pts, 0.8 + 0.12 * rng());
        }
      }
    };
    leaf(0.0, slot.clearA0 - 0.03, null);
    // hanging leaf hinged along the +side rail, swung inward
    const al0 = slot.clearA1 + 0.18, al1 = al0 + 0.2;
    const o = railPoint(new THREE.Vector3(), 1, (al0 + al1) / 2, R);
    const ax = railPoint(new THREE.Vector3(), 1, al1, R).sub(railPoint(new THREE.Vector3(), 1, al0, R)).normalize();
    leaf(al0, al1, { o, m: new THREE.Matrix4().makeRotationAxis(ax, 1.15) });
  }

  // ---------------------------------------------------------------- drum
  const NB = 40;
  const dA = (Math.PI * 2) / NB;
  const chord = 2 * R * Math.sin(dA / 2);
  const PIER_W = 5.6;
  const lowWall = archedWall({ width: chord - PIER_W + 0.2, height: DH - 11, span: 9.5, spring: DH - 21, rise: 4.75, depth: 2.4, segments: 12 });
  const upWall = archedWall({ width: chord - PIER_W + 0.2, height: 9.4, span: 5.2, spring: 3.6, rise: 2.6, depth: 1.8, segments: 8 });
  const openBay = archedWall({ width: chord - PIER_W + 0.2, height: DH - 11, span: 13, spring: DH - 22, rise: 6.5, depth: 2.4, segments: 12 });
  for (let b = 0; b < NB; b++) {
    const az = slot.az + b * dA; // pier on each meridian (slot centre is a pier)
    const azc = az + dA / 2;
    sph(_p, azc, 0, R);
    _p.y = -DH * 0.5;
    const wyMid = wy(_p);
    _p.y = 0;
    if (wy(_p) < -8) continue; // fully drowned bay
    // pier (pilaster) on the meridian: from plinth to spring, with a capital block
    {
      const ca = Math.cos(az), sa = Math.sin(az);
      _ex.set(sa, 0, -ca); // (-e_az, up, radial) is right-handed
      _ez.set(ca, 0, sa);
      _m.makeBasis(_ex, UP, _ez).setPosition(ca * (R + 0.4), -DH / 2, sa * (R + 0.4));
      S.box(M.base, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(PIER_W, DH, 4.8)), 0.95);
      _m.setPosition(ca * (R + 1.4), -1.6, sa * (R + 1.4));
      S.box(M.stone, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(PIER_W + 1.6, 3.2, 5.4)), 1.0);
      // pier buttress foot
      _m.setPosition(ca * (R + 2.6), -DH + 5, sa * (R + 2.6));
      S.box(M.base, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(PIER_W + 0.6, 10, 5.6)), 0.85);
    }
    if (wyMid < -12) continue;
    // the bay walls: chord plane between piers
    const ca = Math.cos(azc), sa = Math.sin(azc);
    _ex.set(sa, 0, -ca); // -e_az keeps the basis right-handed with z = radial
    _ez.set(ca, 0, sa);
    const rw = R * Math.cos(dA / 2) - 0.3;
    const big = Math.abs(((b % NB) + NB) % NB - 0) < 1 || b % 10 === 5; // wide portals (slot + 3 more)
    _m.makeBasis(_ex, UP, _ez).setPosition(ca * rw, -DH, sa * rw);
    S.geo(M.stone, big ? openBay : lowWall, _m, 0.97 + 0.06 * rng());
    // cornice band between tiers
    _m.makeBasis(_ex, UP, _ez).setPosition(ca * (rw + 0.9), -10.6, sa * (rw + 0.9));
    S.box(M.glyph, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(chord + 0.6, 1.6, 3.4)), 1.0);
    _m.makeBasis(_ex, UP, _ez).setPosition(ca * rw, -9.8, sa * rw);
    S.geo(M.stone, upWall, _m, 0.92 + 0.08 * rng());
    // lamp in some lower arches (sparse)
    if (rng() < 0.12) anchors.lamps.push(new THREE.Vector3(ca * (rw - 3), -DH + 3, sa * (rw - 3)));
  }
  // spring ring (wall plate) — a heavy basalt ring the ribs stand on
  for (let b = 0; b < NB; b++) {
    const a0 = slot.az + b * dA, a1 = a0 + dA;
    sph(_p, a0 + dA / 2, 0, R);
    if (wy(_p) < -9) continue;
    for (let i = 0; i < 8; i++) {
      const s = CUBE_SIGN[i];
      const r = s[1] ? R + 3.6 : R - 3.2;
      const a = s[0] ? a1 : a0;
      TC[i].set(Math.cos(a) * r, s[2] ? 1.2 : -3.4, Math.sin(a) * r);
    }
    // CUBE order is (x, y, z) = (az, radial, height); swap into the (az, height, radial) winding
    S.hexa(M.base, TC, 0.9);
  }

  // ---------------------------------------------------------------- plinth steps
  for (let k = 0; k < 4; k++) {
    const r0 = R + 3.5 + k * 5.5;
    const y1 = -DH - k * 4.2, y0 = y1 - 4.6;
    for (let b = 0; b < NB; b++) {
      const a0 = slot.az + b * dA, a1 = a0 + dA;
      _p.set(Math.cos(a0 + dA / 2) * r0, y1, Math.sin(a0 + dA / 2) * r0);
      if (wy(_p) < -8) continue;
      // broken step edges: chunks missing
      if (rng() < 0.1) continue;
      for (let i = 0; i < 8; i++) {
        const s = CUBE_SIGN[i];
        const r = s[1] ? r0 : R - 2;
        const a = s[0] ? a1 : a0;
        TC[i].set(Math.cos(a) * r, s[2] ? y1 : y0, Math.sin(a) * r);
      }
      S.hexa(M.base, TC, 0.82 + 0.1 * rng());
    }
  }

  // ---------------------------------------------------------------- interior
  // flooded floor with inlaid bronze meridian lines
  {
    const pts = [];
    for (let i = NB - 1; i >= 0; i--) {
      const a = slot.az + i * dA;
      pts.push(new THREE.Vector3(Math.cos(a) * (R - 1), -DH, Math.sin(a) * (R - 1)));
    }
    S.poly(M.base, pts, 0.8);
    for (let i = 0; i < NB; i += 2) {
      const a = slot.az + i * dA;
      _p.set(Math.cos(a) * 24, -DH + 0.2, Math.sin(a) * 24);
      _q.set(Math.cos(a) * (R - 4), -DH + 0.2, Math.sin(a) * (R - 4));
      S.beam(M.rib, _p, _q, UP, 0.8, 0.5, 0.9);
    }
  }
  // galleries: annular floors on corbels, balustrade on the inner edge
  const GAL = [-14, 12, 36, 58];
  const galleryR = (y) => (y < 0 ? R - 2.2 : Math.sqrt((R - 2.2) ** 2 - y * y));
  for (const gy of GAL) {
    const ro = galleryR(gy);
    const ri = ro - 9;
    const n = 40;
    let run = 0;
    for (let i = 0; i < n; i++) {
      const a0 = slot.az + (i / n) * Math.PI * 2, a1 = slot.az + ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      _p.set(Math.cos(am) * ro, gy, Math.sin(am) * ro);
      if (wy(_p) < -9) continue;
      if (inSlot(_p, 3) && gy > 0) continue;
      // collapsed stretches
      if (run > 0) {
        run--;
        continue;
      }
      if (rng() < 0.07) {
        run = 1 + Math.floor(rng() * 3);
        continue;
      }
      for (let k = 0; k < 8; k++) {
        const s = CUBE_SIGN[k];
        const r = s[1] ? ro : ri;
        const a = s[0] ? a1 : a0;
        TC[k].set(Math.cos(a) * r, s[2] ? gy : gy - 1.5, Math.sin(a) * r);
      }
      S.hexa(M.stone, TC, 0.9 + 0.08 * rng());
      // corbel under the floor
      _ex.set(Math.sin(a0), 0, -Math.cos(a0));
      _ez.set(Math.cos(a0), 0, Math.sin(a0));
      _m.makeBasis(_ex, UP, _ez).setPosition(Math.cos(a0) * (ro - 3), gy - 4.5, Math.sin(a0) * (ro - 3));
      S.box(M.stone, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(1.4, 6, 6)), 0.85);
      // balustrade: posts + rail
      const seg = (a1 - a0) * ri;
      const posts = Math.max(2, Math.round(seg / 2.6));
      for (let k = 0; k < posts; k++) {
        const a = a0 + ((k + 0.5) / posts) * (a1 - a0);
        _m.makeRotationY(-a).setPosition(Math.cos(a) * (ri + 0.5), gy + 0.7, Math.sin(a) * (ri + 0.5));
        S.box(M.stone, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(0.45, 1.4, 0.45)), 0.95);
      }
      _p.set(Math.cos(a0) * (ri + 0.5), gy + 1.55, Math.sin(a0) * (ri + 0.5));
      _q.set(Math.cos(a1) * (ri + 0.5), gy + 1.55, Math.sin(a1) * (ri + 0.5));
      S.beam(M.stone, _p, _q, UP, 0.7, 0.35, 0.95);
      if (rng() < 0.05) anchors.lamps.push(new THREE.Vector3(Math.cos(am) * (ri + 1.5), gy + 1.0, Math.sin(am) * (ri + 1.5)));
    }
  }
  // freestanding stair flights between the galleries (and one down into the water)
  {
    const flights = [
      { from: -14, to: 12, az: slot.az + 2.2 },
      { from: 12, to: 36, az: slot.az + 3.6 },
      { from: 36, to: 58, az: slot.az + 1.1 },
      { from: 12, to: 36, az: slot.az - 1.4 },
      { from: -14, to: 12, az: slot.az - 2.6 },
      { from: -DH + 2, to: -14, az: slot.az + 4.9 },
    ];
    for (const f of flights) {
      const rise = f.to - f.from;
      const steps = Math.round(rise / 0.62);
      const run = 0.95;
      const L = steps * run;
      const r = Math.min(galleryR(f.to), galleryR(f.from)) - 13;
      // flight runs tangentially, ending on the upper gallery
      const a = f.az;
      const pc = new THREE.Vector3(Math.cos(a) * r, f.from, Math.sin(a) * r);
      if (wy(pc) < -12 && wy(pc.clone().setY(f.to)) < -2) continue;
      const g = stairGeo({ width: 4.2, steps, rise: rise / steps, run, solid: false });
      _ex.set(Math.cos(a), 0, Math.sin(a)); // radial -> stair x (width)
      _ez.set(-Math.sin(a), 0, Math.cos(a)); // tangent -> stair run
      _ey.crossVectors(_ez, _ex);
      _m.makeBasis(_ex, UP, _ez).setPosition(pc.x - _ez.x * L * 0.5, f.from, pc.z - _ez.z * L * 0.5);
      S.geo(M.stone, g, _m, 0.9);
      g.dispose();
      // landing slab at the top
      _m.makeBasis(_ex, UP, _ez).setPosition(pc.x + _ez.x * (L * 0.5 + 3), f.to - 0.75, pc.z + _ez.z * (L * 0.5 + 3));
      S.box(M.stone, _m2.copy(_m).multiply(new THREE.Matrix4().makeScale(6, 1.5, 6)), 0.9);
    }
  }
  // the instrument's pier: a stepped 12-sided basalt tower with amber glyph belts
  {
    const top = F.pierTop;
    const tiers = [
      [26, 23, -DH, -DH + 14],
      [21, 19, -DH + 14, -2],
      [18, 16, -2, 8],
      [15.5, 14, 8, top],
    ];
    for (const [r0, r1, y0, y1] of tiers) {
      _m.makeTranslation(0, y0, 0);
      S.geo(M.base, prism(12, r0, r1, y1 - y0, 1), _m, 0.9);
      _m.makeTranslation(0, y1 - 2.2, 0);
      S.geo(M.glyph, prism(12, r1 + 0.9, r1 + 0.9, 2.2, 1), _m, 1);
    }
    anchors.lamps.push(new THREE.Vector3(0, top + 1.5, 16.5), new THREE.Vector3(14, top + 1.5, -8), new THREE.Vector3(-14, top + 1.5, -8));
  }

  // tree + vine anchors on the upper shell near breaches, cracks and ribs (world up growth)
  for (let k = 0; k < 90; k++) {
    const j = 1 + Math.floor(rng() * 7);
    const el = EL_EDGES[j] + rng() * (EL_EDGES[j + 1] - EL_EDGES[j]);
    const az = rng() * Math.PI * 2;
    sph(_u, az, el, 1);
    sph(_p, az, el, R + 1);
    if (inSlot(_p, 4)) continue;
    const bd = breachDist(_u);
    const c = crack(_u);
    const near = bd > 0 && bd < 0.12 ? 1 : c < 0.06 ? 0.8 : 0.12;
    if (rng() > near) continue;
    if (wy(_p) < 2) continue;
    anchors.trees.push({ p: _p.clone(), n: _u.clone(), s: 0.5 + rng() * 0.8 });
  }
  for (let k = 0; k < 160; k++) {
    // vines hang from the lower edges of breaches (tiles present just above empty space)
    const b = F.breaches[Math.floor(rng() * F.breaches.length)];
    const az = Math.atan2(b.dir.z, b.dir.x) + (rng() - 0.5) * b.rad * 2.4;
    const el = Math.asin(b.dir.y) + (rng() - 0.3) * b.rad * 1.6;
    if (el < 0.05 || el > 1.4) continue;
    sph(_u, az, el, 1);
    const bd = breachDist(_u);
    if (bd < 0 || bd > 0.06) continue;
    sph(_p, az, el, R - 1.2);
    if (wy(_p) < 4) continue;
    anchors.vines.push({ p: _p.clone(), len: 4 + rng() * 16 });
  }
  return anchors;
}
