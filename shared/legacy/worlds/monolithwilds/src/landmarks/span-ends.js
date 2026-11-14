// The abutments of the Vertebral Span.
//
// West: THE SKULL. A crested cranial vault (~90 m) half-sunk into the rising ground, facing away
// from the canyon; the spine enters its occiput at deck level. Its face is carved from the same
// sphere by dents (orbits, nasal aperture, mouth, temporal hollows) whose deepest parts are
// filled with "void" material — black by day, glowing amber by night. Upper teeth stand in the
// ground as a portico; brow ridge, cheek arches and a sagittal crest are separate bone sweeps.
//
// East: THE PELVIS. The spine fuses into a sloping sacral plate (paired foramina that glow at
// night) between two iliac wings — curved bone blades rising ~65 m like sails — with socket
// rings (acetabula), obturator loops half-buried in the rim, and a tail of shrinking caudal
// vertebrae that dives into the ground.
//
// Both ends: stairs cut into the canyon walls, following the cliff contour down to portals.

import * as THREE from 'crownfall-world-three';
import { mergeVertices } from '../core/geometry-utils.js';
import { sweep, blob, shell, bezier3, curvePts, h1 } from './span-geo.js';
import { trs } from '../core/builder.js';
import { worldNoise } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const roundEnd = (t, e0) => (t <= e0 ? 1 : Math.sqrt(Math.max(0.0, 1 - ((t - e0) / (1 - e0)) ** 2)));

/** Horizontal frame at station s (x' = bridge axis, y' = world up, z' = side), origin on y=y0. */
function flatMatrix(F, s, y0, off = 0) {
  const p = F.world(s, off, y0);
  const S = F.side;
  return new THREE.Matrix4().makeBasis(F.axis, V(0, 1, 0), S).setPosition(p);
}

// ---------------------------------------------------------------------------
// WEST — the skull

export function buildSkull(ctx, F, B, M, rng, units) {
  // Skull-local frame: origin on the ground under the occiput (station sW), x toward the canyon,
  // so the snout points west (-x). The whole skull is tilted to lie on the rising ground.
  const s0 = F.sW + 4;
  const G0 = F.groundAt(s0, 0);
  const len = 150;
  const Gf = (F.groundAt(s0 - 95, -15) + F.groundAt(s0 - 95, 15)) / 2;
  // follow the rising ground, then lift the muzzle a little more: the jaws gape at the sky
  const tilt = Math.atan2(Gf - G0, 95) * 0.8 + 0.13;
  const base = flatMatrix(F, s0, G0 - 5);
  const m = base.clone().multiply(new THREE.Matrix4().makeRotationZ(-tilt));
  const deckL = F.deckY(F.sW) - (G0 - 5);

  // longitudinal profile: centre height, half-height, half-width at station x (x in [-len, 6])
  const prof = (x) => {
    const t = ss(-len, 6, x); // 0 snout .. 1 occiput
    const cr = ss(-84, -36, x); // cranium weight
    const yc = 9 + 14 * t + 4 * cr;
    const b = 8 + 14 * t + 11 * cr;
    const a = 9 + 15 * t + 11 * cr - 3.5 * Math.exp(-(((x + 68) / 16) ** 2)); // waist at the orbits
    return { yc, b, a };
  };
  const N = 90;
  const radial = 72;
  const pts = [];
  for (let k = 0; k < N; k++) pts.push(V(-len + (len + 6) * (k / (N - 1)), 0, 0));
  const g = sweep(pts, (t, k) => {
    const x = pts[k].x;
    const P = prof(x);
    const e0 = roundEnd(1 - t, 0.94); // rounded snout tip
    const e1 = roundEnd(t, 0.9); // rounded occiput
    return [P.a * Math.max(0.05, e0 * e1), P.b * Math.max(0.05, e0 * e1)];
  }, {
    radial, up: V(0, 1, 0),
    profile: (th, t) => {
      // flat-ish belly, squarer flanks, a crest ridge on the crown of the cranium
      const s = Math.sin(th);
      const c = Math.abs(Math.cos(th));
      let mlt = Math.pow(Math.pow(c, 3) + Math.pow(Math.abs(s), 3), -1 / 3);
      if (s < 0) mlt *= 1 - 0.25 * (-s) ** 2;
      const x = -len + (len + 6) * t;
      const crest = ss(-96, -36, x) * (1 - ss(-6, 6, x));
      mlt *= 1 + 0.2 * crest * Math.exp(-(((th - Math.PI / 2) / 0.16) ** 2));
      return mlt;
    },
    capStart: true, capEnd: true, capBulge: 0.2,
  });
  // shift each ring to its centre height, carve the openings, paint the voids dark
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const holes = [
    // [x, y(rel. to yc), Rx, Ry, depth, darkness]
    [-67, 6, 13, 12, 11, 1], // orbit
    [-99, 0, 13, 6.5, 7, 0.9], // antorbital fenestra
    [-136, 1, 4, 3.5, 3.5, 0.9], // nostril
    [-29, 0, 13, 9.5, 9, 0.85], // lateral temporal opening
  ];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const P = prof(x);
    y += P.yc;
    const n = worldNoise.fbm3(x * 0.05 + 3, y * 0.05, z * 0.05, 3);
    let dark = 0;
    const side = Math.abs(z) / Math.max(1, P.a);
    for (const [hx, hy, rxh, ryh, dep, dk] of holes) {
      const d = Math.hypot((x - hx) / rxh, (y - P.yc - hy) / ryh);
      if (d < 1.3 && side > 0.45) {
        const k = Math.max(0, 1 - d * d);
        const w = ss(0.45, 0.8, side);
        z -= Math.sign(z) * dep * Math.sqrt(k) * w;
        z += Math.sign(z) * 1.2 * Math.exp(-(((d - 1.08) / 0.14) ** 2)) * w; // raised rim
        dark = Math.max(dark, ss(1, 0.6, d) * w * dk);
      }
    }
    // paired openings on the roof of the cranium
    for (const sd of [-1, 1]) {
      const d = Math.hypot((x + 24) / 11, (z - sd * 11) / 7);
      if (d < 1.3 && y > P.yc + P.b * 0.6) {
        const k = Math.max(0, 1 - d * d);
        y -= 7 * Math.sqrt(k);
        dark = Math.max(dark, ss(1, 0.6, d) * 0.9);
      }
    }
    // foramen at the occiput where the neck enters
    {
      const d = Math.hypot((y - (deckL - 4)) / 9, z / 8);
      if (d < 1.2 && x > -4) {
        x -= 6 * Math.sqrt(Math.max(0, 1 - d * d));
        dark = Math.max(dark, ss(1, 0.5, d));
      }
    }
    x += 0.8 * n;
    y += 1.0 * n;
    z *= 1 + 0.025 * n;
    p.setXYZ(i, x, y, z);
    const c = 1 - 0.85 * dark;
    const age = 0.9 + 0.1 * worldNoise.noise3(x * 0.03, y * 0.03, z * 0.03) - 0.12 * ss(8, -4, y);
    col[i * 3] = c * age;
    col[i * 3 + 1] = c * age * 0.97;
    col[i * 3 + 2] = c * age * 0.93;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  B.add(g, M.bone, m);

  // void fills deep in each opening: black by day, faint embers at night
  const vGeo = blob(1, 1, 1, { ws: 14, hs: 10, lump: 0.08, freq: 2 });
  const vm = new THREE.Matrix4();
  for (const sd of [-1, 1]) {
    for (const [hx, hy, rxh, ryh, dep] of holes) {
      const P = prof(hx);
      vm.compose(V(hx, P.yc + hy, sd * (P.a - dep + 0.8)), new THREE.Quaternion(), V(rxh * 0.72, ryh * 0.72, 1.6)).premultiply(m);
      B.add(vGeo, M.void, vm, hx === -67 ? 0.07 : 0.04);
    }
  }
  vm.compose(V(-2, deckL - 4, 0), new THREE.Quaternion(), V(2, 7.5, 7)).premultiply(m);
  B.add(vGeo, M.void, vm, 0.4);

  // cheek bar (jugal) bridging under the orbit and the temporal opening, standing proud
  for (const sd of [-1, 1]) {
    const cp = [];
    for (let k = 0; k <= 26; k++) {
      const x = -108 + 96 * (k / 26);
      const P = prof(x);
      const bow = Math.sin(Math.PI * (k / 26));
      cp.push(V(x, P.yc - P.b * 0.22 - 2 * bow, sd * (P.a * 0.96 + 2.4 * bow)));
    }
    B.add(sweep(cp, (t) => [2.8 + 0.9 * Math.sin(Math.PI * t), 4], { radial: 12, up: V(0, 1, 0), lump: 0.1, lumpFreq: 0.2, lumpSeed: sd }), M.bone, m, 0.95);
  }

  // upper teeth hanging from both jaw lines
  const canine = smoothLatheLocal([[0.01, -1.2], [1.25, -1.2], [1.45, 0], [1.4, 0.3], [1.15, 0.55], [0.75, 0.76], [0.3, 0.93], [0.01, 1]], 10);
  const molar = smoothLatheLocal([[0.01, -1.2], [1.2, -1.2], [1.4, 0.1], [1.36, 0.55], [1.1, 0.82], [0.7, 0.9], [0.45, 0.8], [0.01, 0.86]], 10);
  const tq = new THREE.Quaternion();
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 24; k++) {
      if ((k * 7 + (sd > 0 ? 3 : 0)) % 9 === 4) continue; // lost teeth
      const x = -138 + k * 4.3;
      const P = prof(x);
      const top = P.yc - P.b * 0.72;
      const canineT = k === 3 || k === 4;
      const h = (canineT ? 13 : 5.5 + 2.5 * h1(k, sd + 2)) * (k % 7 === 5 ? 0.5 : 1);
      tq.setFromEuler(new THREE.Euler(sd * 0.12, 0, Math.PI));
      vm.compose(V(x, top + 1.5, sd * (P.a * 0.82)), tq, V(canineT ? 1.9 : 1.6, h * 0.5, canineT ? 1.7 : 1.9)).premultiply(m);
      B.add(canineT ? canine : molar, M.bone, vm, 0.9 + 0.08 * h1(k, sd));
    }
  }

  // the lower jaw lies on the ground beneath, fallen open: two rami meeting at the chin, a row of
  // teeth still standing along their upper edge. Built in the un-tilted ground frame.
  {
    const jawPts = (sd) => {
      const out = [];
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const x = -12 - 142 * t;
        const z = sd * (26 * (1 - Math.pow(t, 2.2)) + 3);
        const w = F.world(s0 + x, z, 0);
        const g = ctx.heightAt(w.x, w.z) - (G0 - 5);
        out.push(V(x, g + 3.5 - 2 * t, z));
      }
      return out;
    };
    for (const sd of [-1, 1]) {
      const pts = jawPts(sd);
      B.add(sweep(pts, (t) => {
        const r = 1 - 0.35 * t;
        return [3.2 * r, 6 * r * (1 + 0.5 * Math.exp(-((t / 0.08) ** 2)))];
      }, { radial: 12, up: V(0, 1, 0), lump: 0.1, lumpFreq: 0.18, lumpSeed: sd * 5, capBulge: 0.5 }), M.bone, base, 0.86);
      for (let k = 2; k < 28; k += 1) {
        if ((k * 5 + (sd > 0 ? 2 : 0)) % 8 === 3) continue;
        const p = pts[k];
        const canineT = k === 26 || k === 25;
        const h = canineT ? 11 : 4.5 + 2 * h1(k, sd);
        vm.compose(V(p.x, p.y + 4.5, p.z), tq.setFromEuler(new THREE.Euler(-sd * 0.15, 0, 0)), V(canineT ? 1.7 : 1.5, h * 0.5, canineT ? 1.5 : 1.7)).premultiply(base);
        B.add(canineT ? canine : molar, M.bone, vm, 0.88);
      }
    }
    // a rock pedestal under the raised skull, the bone fused into it
    const rock = blob(1, 0.8, 1, { ws: 9, hs: 6, lump: 0.28, freq: 0.9, seed: 3 });
    for (let k = 0; k < 9; k++) {
      const x = -30 - 11 * k;
      const P = prof(x);
      const w = V(x, P.yc - P.b * 0.8, 0).applyMatrix4(m);
      const gy = ctx.heightAt(w.x, w.z);
      const h = Math.max(4, w.y - gy + 4);
      vm.compose(V(w.x, gy + h * 0.25, w.z), tq.setFromEuler(new THREE.Euler(0.2 * h1(k, 1), 6.28 * h1(k, 2), 0.2 * h1(k, 3))), V(9 + 5 * h1(k, 4), h * 0.75, 12 + 4 * h1(k, 5)));
      B.add(rock, M.rock, vm, 0.8 + 0.15 * h1(k, 6));
    }
  }

  // bony nodules in two rows along the snout and over the orbits (like a crocodile's back)
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 16; k++) {
      const x = -140 + k * 5.2 + 1.5 * h1(k, sd);
      const P = prof(x);
      const zf = 0.42 + 0.08 * Math.sin(k * 1.3);
      const r = 1.2 + 1.3 * h1(k * 3, sd) + 0.8 * ss(-140, -60, x);
      const nod = blob(r * 1.3, r, r, { ws: 8, hs: 6, lump: 0.2, freq: 0.9, seed: k + sd });
      vm.makeTranslation(x, P.yc + P.b * 0.95 * Math.pow(1 - zf ** 3, 1 / 3), sd * P.a * zf).premultiply(m);
      B.add(nod, M.bone, vm, 0.9);
    }
  }

  // suture seams wandering over the cranium (thin marrow light)
  for (let k = 0; k < 3; k++) {
    const sp = [];
    for (let j = 0; j <= 40; j++) {
      const t = j / 40;
      const x = -76 + 72 * t;
      const P = prof(x);
      const a = (k - 1) * 0.55 + 0.12 * Math.sin(t * 31 + k) + 0.06 * Math.sin(t * 83 + 2 * k);
      const ca = Math.cos(Math.PI / 2 + a);
      const sa = Math.sin(Math.PI / 2 + a);
      const mlt = Math.pow(Math.pow(Math.abs(ca), 3) + Math.pow(Math.abs(sa), 3), -1 / 3);
      const crest = ss(-96, -36, x) * (1 - ss(-6, 6, x)) * 0.2 * Math.exp(-((a / 0.16) ** 2));
      sp.push(V(x, P.yc + P.b * sa * mlt * (1 + crest) + 0.3, P.a * ca * mlt));
    }
    B.add(sweep(sp, () => [0.24, 0.24], { radial: 4, capBulge: 0 }), M.void, m, 0.45);
  }

  fuseRubble(ctx, B, M, rng, F, s0 - 72, 0, 84, 38, 26);
  return { s0, G: G0, top: G0 + 44 };
}

function smoothLatheLocal(profile, seg) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  let g = new THREE.LatheGeometry(pts, seg);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// EAST — the pelvis, sacrum and tail

export function buildPelvis(ctx, F, B, M, rng, units) {
  const s0 = F.sE; // spine end station
  const G = F.groundAt(s0 + 30, 0);
  const m = flatMatrix(F, s0, G);
  const yDk = F.deckY(s0) - G; // deck height (local)

  // sacrum: fused, tapering plate sloping from the deck down to the ground (follows the land)
  const gl = (x, z = 0) => F.groundAt(s0 + x, z) - G; // local ground height
  const sacLen = 46;
  const yEnd = gl(sacLen - 4) + 1.0;
  const sacY = (u) => yDk - 3.2 + (yEnd - (yDk - 3.2)) * u; // centre plane
  const sacTh = (u) => 6 - 3 * u; // thickness at the midline
  const sac = shell((u, v) => {
    const x = -4 + u * sacLen;
    const w = (1 - 0.62 * u) * 15;
    const z = (v - 0.5) * 2 * w;
    return V(x, sacY(u) - 0.02 * z * z, z);
  }, 24, 10, (u, v) => sacTh(u) * (0.6 + 0.4 * Math.sin(Math.PI * v)));
  B.add(sac, M.bone, m, 0.94);
  // a broad flight of steps down the back of the sacrum
  {
    const uA = 0.1;
    const uB = 0.86;
    const top = V(-4 + uA * sacLen, sacY(uA) + sacTh(uA) / 2, 0).applyMatrix4(m);
    const bot = V(-4 + uB * sacLen, sacY(uB) + sacTh(uB) / 2, 0).applyMatrix4(m);
    buildFlight(ctx, B, M, top, bot, 8, { rise: 0.4 });
  }
  // fused vertebral bodies under the plate + median crest knobs + paired foramina (void)
  const vm = new THREE.Matrix4();
  const hole = blob(1, 1, 1, { ws: 12, hs: 8, lump: 0.05, freq: 2 });
  for (let k = 0; k < 5; k++) {
    const u = (k + 0.5) / 5.5;
    const x = -4 + u * sacLen;
    const y = sacY(u) + 2;
    const r = (1 - 0.62 * u) * 8;
    const body = sweep(curvePts((t) => V(x - 4.5 + 9 * t, y - r * 0.7, 0), 6), () => [r, r * 0.8], { radial: 18, lump: 0.05, lumpSeed: k });
    B.add(body, M.bone, m, 0.9);
    const knob = blob(3.2, 2.2 + 1.2 * (1 - u), 1.4, { ws: 10, hs: 8, lump: 0.1, freq: 0.4, seed: k });
    vm.multiplyMatrices(m, trs(x, y + 2.5, 0));
    B.add(knob, M.bone, vm, 0.95);
    for (const sd of [-1, 1]) {
      const w = (1 - 0.62 * u) * 15;
      vm.multiplyMatrices(m, trs(x, y + 1.9 - 0.02 * (w * 0.45) ** 2, sd * w * 0.45, 0, 0, 0, 1.7, 0.6, 1.4));
      B.add(hole, M.void, vm, 0.8);
    }
  }

  // iliac wings: each a fan of bone struts radiating from a solid neck above the socket to a
  // rolled crest — the blade has weathered away between its ribs, so the sky shows through
  for (const sd of [-1, 1]) {
    const Bp = (uu) => V(12 + 4 * uu, yDk - 4, sd * 13);
    const Cp = (uu) => V(14 + 44 * uu, yDk + 44 + 16 * (1 - uu * uu) + 8 * uu, sd * (38 + 12 * (1 - uu * uu)));
    const surf = (u, v) => {
      const uu = u * 2 - 1;
      const b = Bp(uu);
      const c = Cp(uu);
      const vv = Math.pow(v, 0.8);
      const p = b.multiplyScalar(1 - vv).add(c.multiplyScalar(vv));
      const w = Math.sin(Math.PI * v) * Math.pow(1 - uu * uu, 0.6);
      p.y -= 5 * w;
      p.z += sd * 6 * w; // dished outward: concave on the inside
      return p;
    };
    // the fused neck: solid lower part of the blade, with a ragged upper margin
    const neckV = 0.42;
    const wing = shell((u, v) => surf(u, v * (neckV + 0.06 * Math.sin(u * 17 + sd)) + 0.001), 26, 9, (u, v) => 3 + 4.5 * (1 - v));
    B.add(wing, M.bone, m, 0.93);
    // struts: uneven, a little wavy; two have snapped and hang short of the crest
    const nS = 8;
    for (let k = 0; k < nS; k++) {
      const u = (k + 0.15 * (h1(k, sd) - 0.5)) / (nS - 1);
      const uc = Math.min(1, Math.max(0, u));
      const edge = k === 0 || k === nS - 1;
      const broken = !edge && (k * 3 + (sd > 0 ? 1 : 0)) % 5 === 2;
      const tEnd = broken ? 0.45 + 0.2 * h1(k, 7) : 1;
      const wav = (1.5 + 1.5 * h1(k, 2)) * sd;
      const pts = curvePts((t0) => {
        const t = t0 * tEnd;
        const p = surf(uc, neckV * 0.8 + (1 - neckV * 0.8) * t);
        p.z += wav * Math.sin(Math.PI * t);
        return p;
      }, 16);
      const rr = (edge ? 2.7 : 1.3 + 1.1 * h1(k, sd + 4));
      B.add(sweep(pts, (t) => {
        const r = rr * (1 - 0.3 * t) + 0.5 * Math.exp(-(((t - 1) / 0.1) ** 2)) * (broken ? 0 : 1);
        return [r * 1.2, r];
      }, { radial: 9, lump: 0.12, lumpFreq: 0.3, lumpSeed: k + sd * 20, capBulge: broken ? 0.05 : 0.2 }), M.bone, m, 0.88 + 0.08 * h1(k, sd));
      if (broken) {
        const tip = pts[pts.length - 1];
        const core = blob(0.9, 0.9, 0.9, { ws: 8, hs: 6, lump: 0.2, freq: 1 });
        B.add(core, M.glow, new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z).premultiply(m), 0.4);
      }
    }
    // a single irregular brace of trabecular bone across the middle
    {
      const pts = curvePts((t) => {
        const p = surf(0.04 + 0.92 * t, 0.66 + 0.06 * Math.sin(t * 9 + sd));
        return p;
      }, 30);
      B.add(sweep(pts, (t) => [0.8 + 0.4 * Math.sin(t * 13), 1.0], { radial: 7, lump: 0.15, lumpFreq: 0.35, lumpSeed: sd * 7 }), M.bone, m, 0.9);
    }
    // rolled crest along the top edge, knobbed at both ends
    const crest = curvePts((t) => surf(t, 1), 44);
    B.add(sweep(crest, (t) => {
      const r = 2.5 + 1.3 * Math.sin(Math.PI * t) + 1.4 * (Math.exp(-((t / 0.08) ** 2)) + Math.exp(-(((1 - t) / 0.08) ** 2)));
      return [r, r * 1.25];
    }, { radial: 12, lump: 0.08, lumpFreq: 0.2, lumpSeed: sd * 3, capBulge: 0.6 }), M.bone, m, 0.97);
    // acetabulum: a socket ring low on the outer face, just above the ground
    const ac = V(13, Math.max(yDk - 3, gl(13, sd * 20) + 7.5), sd * 20);
    const an = V(0.1, -0.25, sd).normalize();
    const ring = new THREE.TorusGeometry(7.5, 2.4, 10, 36);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), an);
    B.add(ring, M.bone, new THREE.Matrix4().compose(ac, q, V(1, 1, 1)).premultiply(m), 0.92);
    const cup = blob(7, 7, 3.2, { ws: 18, hs: 12, lump: 0.06, freq: 0.3 });
    B.add(cup, M.bone, new THREE.Matrix4().compose(ac.clone().addScaledVector(an, -1.8), q, V(1, 1, 1)).premultiply(m), 0.55);
    // the femoral head still sits in one socket: a colossal ball with a stub of thigh bone
    if (sd > 0) {
      const head = blob(6.2, 6.2, 6.2, { ws: 20, hs: 14, lump: 0.05, freq: 0.2 });
      B.add(head, M.bone, new THREE.Matrix4().makeTranslation(ac.x + an.x * 2, ac.y + an.y * 2, ac.z + an.z * 2).premultiply(m), 0.9);
      const neck = curvePts(bezier3(ac.clone().addScaledVector(an, 4), ac.clone().addScaledVector(an, 10).add(V(2, -2, 0)), ac.clone().addScaledVector(an, 13).add(V(6, -6, 0)), ac.clone().addScaledVector(an, 14).add(V(12, -12, 0))), 12);
      B.add(sweep(neck, (t) => [4.2 - 0.6 * t, 4.2 - 0.6 * t], { radial: 14, lump: 0.05, capBulge: 0.1 }), M.bone, m, 0.88);
    }
    // ischial knob breaking out of the ground behind the socket
    const isc = blob(7, 5, 5, { ws: 14, hs: 10, lump: 0.12, freq: 0.25, seed: sd });
    B.add(isc, M.bone, new THREE.Matrix4().makeTranslation(26, gl(26, sd * 17) + 1.5, sd * 17).premultiply(m), 0.85);
  }

  // tail: shrinking caudal vertebrae diving into the ground
  const tail = [];
  let x = sacLen - 1;
  for (let k = 0; k < 8; k++) {
    const r = 4.2 * Math.pow(0.82, k);
    const L = r * 2.4;
    const zc = 0.8 * Math.sin(k * 0.9) * k;
    // each caudal sits a little deeper in the ground than the last, until it disappears
    const y = gl(x, zc) + r * (0.55 - 0.16 * k);
    const y2 = gl(x + L, zc) + r * 0.82 * (0.55 - 0.16 * (k + 1));
    const dir = V(L + 1, y2 - y, 0.12 * Math.sin(k * 0.9) * L).normalize();
    const c = V(x, y, zc);
    const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir);
    const body = sweep(curvePts((t) => V(-L / 2 + L * t, 0, 0), 6), (t) => {
      const w = 1 - 0.12 * Math.sin(Math.PI * t);
      return [r * w, r * w];
    }, { radial: 14, capBulge: -0.05, lump: 0.04, lumpSeed: k });
    const tm = new THREE.Matrix4().compose(c, q, V(1, 1, 1)).premultiply(m);
    B.add(body, M.bone, tm, 0.9);
    const fin = sweep(curvePts((t) => V(0.4 * r * t, r * 0.8 + r * 1.2 * t, 0), 6), (t) => [r * 0.5 * (1 - 0.5 * t), r * 0.22], { radial: 8, up: V(0, 0, 1) });
    B.add(fin, M.bone, tm, 0.9);
    const disc = sweep(curvePts((t) => V(L / 2 - 0.3 + 1.2 * t, 0, 0), 3), () => [r * 0.8, r * 0.8], { radial: 12 });
    B.add(disc, M.basalt, tm, 0.8);
    tail.push(c);
    x += (L + 1.0) * dir.x;
  }
  fuseRubble(ctx, B, M, rng, F, s0 + 30, 0, 50, 45, 22);
  return { s0, G };
}

// ---------------------------------------------------------------------------

/** Basalt blocks and boulders where the bone meets the ground. */
function fuseRubble(ctx, B, M, rng, F, sC, offC, ra, rb, n) {
  const rock = blob(1, 0.7, 1, { ws: 7, hs: 5, lump: 0.3, freq: 1.1, seed: sC });
  const m = new THREE.Matrix4();
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2;
    const r = 0.85 + rng() * 0.3;
    const s = sC + Math.cos(a) * ra * r;
    const off = offC + Math.sin(a) * rb * r;
    const [x, z] = F.toXZ(s, off);
    const gy = ctx.heightAt(x, z);
    const sz = 2 + rng() * 5 + (rng() < 0.3 ? 5 : 0);
    m.copy(trs(x, gy - sz * 0.25, z, rng() * 0.5, rng() * 6.28, rng() * 0.5, sz * (1 + rng()), sz, sz * (1 + rng() * 0.6)));
    B.add(rock, M.rock, m, 0.85 + rng() * 0.3);
  }
}

/**
 * A stair cut into a canyon wall, found by following the cliff contour: each step sits where
 * the ground is just above the step (so it is carved into the rock) and is solid down to the
 * slope below. Flights run along the canyon (the side axis) and switch back at landings.
 * dir = -1 west wall, +1 east wall. Returns the landing points (for portals / lamps).
 */
export function buildCliffStair(ctx, F, B, M, rng, { dir, off0, yTop, yBot, flightDrop = 36, width = 6 }) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const rim = dir < 0 ? F.rimW : F.rimE;
  // station on the wall where the ground is at height h (searching from the rim into the canyon)
  const wallS = (h, off) => {
    let a = rim + dir * 10;
    let b = rim - dir * 120;
    for (let it = 0; it < 13; it++) {
      const mid = (a + b) / 2;
      if (F.groundAt(mid, off) > h) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  const landings = [];
  let off = off0;
  let heading = 1;
  let y = yTop;
  const rise = 0.55;
  const run = 0.95;
  let flightStart = y;
  while (y > yBot) {
    const s = wallS(y + 2.5, off) + dir * 0.8;
    const [x, z] = F.toXZ(s, off);
    const gy = ctx.heightAt(x, z);
    const bottom = Math.min(y - 1.5, gy - 1.5);
    const h = y - bottom;
    m.makeBasis(F.axis, V(0, 1, 0), F.side);
    m.multiply(trs(0, 0, 0, 0, 0, 0, width, h, run + 0.04));
    m.setPosition(x, bottom + h / 2, z);
    B.add(box, M.stoneSmooth, m, 0.85 + 0.1 * rng());
    // parapet on the canyon side
    const px = x - dir * F.axis.x * (width / 2 - 0.35);
    const pz = z - dir * F.axis.z * (width / 2 - 0.35);
    m.makeBasis(F.axis, V(0, 1, 0), F.side);
    m.multiply(trs(0, 0, 0, 0, 0, 0, 0.7, 1.3, run + 0.06));
    m.setPosition(px, y + 0.65, pz);
    B.add(box, M.stoneSmooth, m, 0.78 + 0.1 * rng());
    y -= rise;
    off += heading * run;
    if (flightStart - y > flightDrop && y > yBot + 6) {
      // landing, then switch back
      const ls = wallS(y + 2.5, off) + dir * 0.8;
      const [lx, lz] = F.toXZ(ls, off + heading * 3);
      const lg = ctx.heightAt(lx, lz);
      const lb = Math.min(y - 2, lg - 2);
      m.makeBasis(F.axis, V(0, 1, 0), F.side);
      m.multiply(trs(0, 0, 0, 0, 0, 0, width * 2.2, y - lb, 7));
      m.setPosition(lx, (y + lb) / 2, lz);
      B.add(box, M.stoneSmooth, m, 0.8);
      // a lamp on a short post at the landing's outer corner
      const lp = V(lx - dir * F.axis.x * (width - 0.8), y, lz - dir * F.axis.z * (width - 0.8));
      m.makeTranslation(lp.x, y + 1.4, lp.z);
      B.add(box, M.stoneSmooth, m.clone().multiply(trs(0, 0, 0, 0, 0, 0, 0.8, 2.8, 0.8)), 0.8);
      m.makeTranslation(lp.x, y + 3.2, lp.z);
      B.add(box, M.glow, m.clone().multiply(trs(0, 0, 0, 0, 0, 0, 0.6, 0.7, 0.6)), 1);
      landings.push({ s: ls, off: off + heading * 3, y, x: lx, z: lz });
      off += heading * 6;
      heading = -heading;
      flightStart = y;
    }
  }
  landings.push({ s: wallS(y + 2.5, off), off, y, x: F.toXZ(wallS(y + 2.5, off), off)[0], z: F.toXZ(wallS(y + 2.5, off), off)[1], bottom: true });
  return landings;
}

/** A doorway into the cliff: stone frame with an inscribed lintel and a void that glows at night. */
export function buildPortal(ctx, F, B, M, at, dir) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const base = new THREE.Matrix4().makeBasis(F.axis, V(0, 1, 0), F.side);
  // the portal faces into the canyon: its local +x points away from the wall
  const out = dir < 0 ? 1 : -1;
  const p = F.world(at.s + dir * 1.0, at.off, at.y);
  const m = base.clone().setPosition(p);
  const add = (mat, x, y, z, sx, sy, sz, tint = 1) => B.add(box, mat, new THREE.Matrix4().multiplyMatrices(m, trs(x * out, y, z, 0, 0, 0, sx, sy, sz)), tint);
  add(M.void, 0.4, 5, 0, 1, 9, 5, 0.9); // the dark opening
  add(M.stoneSmooth, 1.2, 4.5, -3.6, 2.4, 10, 2.2); // jambs
  add(M.stoneSmooth, 1.2, 4.5, 3.6, 2.4, 10, 2.2);
  add(M.glyph, 1.4, 10.6, 0, 2.8, 2.4, 9.8); // lintel
  add(M.stoneSmooth, 1.0, 12.6, 0, 3.2, 1.6, 11.4, 0.85); // cornice
}

/**
 * Straight flight of solid steps between two world points (top -> bottom), each step a block
 * reaching down into the ground so nothing floats.
 */
export function buildFlight(ctx, B, M, top, bottom, width, { rise = 0.5, tint = 0.86 } = {}) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const dir = V(bottom.x - top.x, 0, bottom.z - top.z);
  const run = dir.length();
  dir.normalize();
  const drop = top.y - bottom.y;
  const n = Math.max(2, Math.round(drop / rise));
  const tread = run / n;
  const yaw = Math.atan2(dir.x, dir.z);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const x = top.x + (bottom.x - top.x) * t;
    const z = top.z + (bottom.z - top.z) * t;
    const y = top.y - drop * (k / n);
    const gy = ctx.heightAt(x, z);
    const b = Math.min(gy - 1, y - 1.2);
    m.compose(V(x, (y + b) / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(width, y - b, tread + 0.05));
    B.add(box, M.stoneSmooth, m, tint + 0.06 * h1(k, width));
  }
}

/**
 * A gate obelisk of dark inscribed stone (amber glyph bands wake at night) on a stepped plinth,
 * with a bronze pyramidion. Stands on the ground at world (x, z), leaning a touch.
 */
export function buildGateObelisk(ctx, B, M, x, z, h, yaw, lean = 0) {
  const gy = ctx.heightAt(x, z);
  const base = new THREE.Matrix4().compose(V(x, gy - 1.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, lean * 0.4)), V(1, 1, 1));
  const w = h * 0.14;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (geo, mat, y, sx, sy, sz, tint = 1) => B.add(geo, mat, base.clone().multiply(trs(0, y, 0, 0, 0, 0, sx, sy, sz)), tint);
  add(box, M.stoneSmooth, 1.2, w * 2.3, 2.4, w * 2.3, 0.8);
  add(box, M.stoneSmooth, 3.1, w * 1.8, 1.6, w * 1.8, 0.85);
  const shaft = new THREE.CylinderGeometry(w * 0.62 * Math.SQRT2, w * Math.SQRT2 * 0.5 * 1.25, h, 4, 1);
  shaft.rotateY(Math.PI / 4);
  shaft.translate(0, h / 2, 0);
  B.add(shaft, M.glyph, base.clone().multiply(trs(0, 3.9, 0)), 1);
  const cap = new THREE.ConeGeometry(w * 0.62, w * 1.3, 4, 1);
  cap.rotateY(Math.PI / 4);
  B.add(cap, M.bronze, base.clone().multiply(trs(0, 3.9 + h + w * 0.65, 0)), 1);
}
