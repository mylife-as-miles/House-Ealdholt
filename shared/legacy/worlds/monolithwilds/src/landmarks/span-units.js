// The vertebrae of the Vertebral Span.
//
// Construction logic (per unit, in its local frame: x' along the spine, y' up, z' to the side):
//   centrum   waisted spool of bone carrying the walkway on its back (concave ends)
//   arch      the neural arch — the processional walkway runs THROUGH it, like a colonnade
//   fin       the spinous process: a raked blade rising 12–70 m above the deck
//   wings     transverse processes flaring sideways; the ribs hang from their knobs
//   facets    articular lobes that overlap the neighbour's across each joint
// Anatomy drifts along the span: slender forked "neck" units by the skull (west), tall-finned
// rib-bearing "thoracic" units over the river, massive hatchet-finned "lumbar" units by the
// pelvis (east). One thoracic unit has been lost and replaced by a crude masonry patch.

import * as THREE from 'crownfall-world-three';
import { sweep, blob, bezier3, curvePts, superellipse, smoothLathe } from './span-geo.js';
import { trs } from '../core/builder.js';
import { worldNoise } from '../core/noise.js';

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (t, c, w) => Math.exp(-((t - c) / w) * ((t - c) / w));
/** Rounded end: 1 until e0, then a quarter-circle down to 0 at t=1. */
const roundEnd = (t, e0) => (t <= e0 ? 1 : Math.sqrt(Math.max(0.0, 1 - ((t - e0) / (1 - e0)) ** 2)));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// type, size (scales radius, pitch, processes)
const SPEC = [
  ['neck', 0.7], ['neck', 0.78], ['neck', 0.86],
  ['thor', 0.94], ['thor', 1.0], ['thor', 1.02], ['thor', 1.02], ['thor', 1.02], ['patch', 1.03], ['thor', 1.04],
  ['lumb', 1.1], ['lumb', 1.16], ['lumb', 1.22],
];

/** Fin height above the deck by unit index (a sail that peaks just west of centre). */
function finHeight(i, type, size) {
  if (type === 'neck') return 14 + 8 * i;
  if (type === 'lumb') return 44 + 8 * size;
  const k = (i - 3) / 6; // 0..1 across thoracic units
  return 48 + 50 * Math.sin(Math.PI * Math.min(1, Math.max(0, k * 0.86 + 0.1)));
}

export function layoutUnits(F) {
  const total = SPEC.reduce((a, [, s]) => a + s, 0);
  const base = F.len / total;
  const units = [];
  let s = F.sW;
  for (let i = 0; i < SPEC.length; i++) {
    const [type, size] = SPEC[i];
    const L = base * size;
    const c = s + L / 2;
    s += L;
    const Rc = 9.2 * size;
    const hw = Math.min(3.8, Rc * 0.5); // walkway half width
    units.push({
      i, type, size, s: c, L,
      Lc: L * 0.74,
      Rc,
      hw,
      deckTop: Rc + 0.5, // deck surface above the centrum axis
      finH: finHeight(i, type, size),
      t: F.tOf(c),
    });
  }
  return { units, base };
}

/** Local->world matrix for a unit (origin at the centrum axis). */
export function unitMatrix(F, u) {
  return F.matrixAt(u.s, -u.deckTop);
}

export function buildUnits(ctx, F, B, M, rng, units) {
  const info = [];
  for (const u of units) {
    const m = unitMatrix(F, u);
    u.matrix = m;
    if (u.type === 'patch') {
      buildPatch(B, M, rng, u, m);
      info.push(u);
      continue;
    }
    buildCentrum(B, M, u, m);
    buildArch(B, M, u, m);
    buildFin(B, M, rng, u, m);
    buildWings(B, M, u, m);
    buildFacets(B, M, u, m);
    info.push(u);
  }
  return info;
}

// ---------------------------------------------------------------------------

function buildCentrum(B, M, u, m) {
  const { Lc, Rc, i } = u;
  const pts = curvePts((t) => V(-Lc / 2 + Lc * t, 0, 0), 15);
  const g = sweep(pts, (t) => {
    const waist = 1 - 0.11 * Math.pow(Math.sin(Math.PI * t), 1.4);
    const lip = 1 + 0.05 * (bump(t, 0.04, 0.045) + bump(t, 0.96, 0.045));
    const r = Rc * waist * lip;
    return [r, r * 0.95];
  }, { radial: 30, up: V(0, 1, 0), lump: 0.03, lumpFreq: 0.11, lumpSeed: i * 7.1, capBulge: -0.08 });
  B.add(g, M.bone, m, u.tint ?? 1);
  // ventral keel ridge under the body (hypapophysis) — catches the light from below
  const kg = sweep(curvePts((t) => V(-Lc * 0.42 + Lc * 0.84 * t, -Rc * 0.9 - 0.8 * Math.sin(Math.PI * t), 0), 9),
    (t) => [1.1 * u.size * roundEnd(Math.abs(2 * t - 1), 0.6), 2.2 * u.size * roundEnd(Math.abs(2 * t - 1), 0.5)],
    { radial: 10, up: V(0, 0, 1), capBulge: 0.2 });
  B.add(kg, M.bone, m, 0.93);
}

function buildArch(B, M, u, m) {
  const { Lc, Rc, hw, size, deckTop, i } = u;
  const ai = hw + 1.0; // inner half width of the canal
  const at = 1.1 + 1.25 * size; // band thickness
  const zc = ai + at / 2;
  const yFoot = Math.sqrt(Math.max(1, Rc * Rc - zc * zc)) - 1.0;
  const ySpring = deckTop + 3.8;
  const rise = zc * 1.28;
  const pts = [];
  for (let k = 0; k <= 5; k++) pts.push(V(0, yFoot + (ySpring - yFoot) * (k / 5), -zc));
  for (let k = 1; k < 24; k++) {
    const th = (k / 24) * Math.PI;
    pts.push(V(0, ySpring + rise * Math.sin(th), -zc * Math.cos(th)));
  }
  for (let k = 5; k >= 0; k--) pts.push(V(0, yFoot + (ySpring - yFoot) * (k / 5), zc));
  const g = sweep(pts, (t) => {
    const foot = 1 - ss(0, 0.2, Math.min(t, 1 - t));
    return [at * 0.5 * (1 + 0.5 * foot), Lc * (0.27 + 0.13 * foot)];
  }, { radial: 16, up: V(1, 0, 0), lump: 0.04, lumpFreq: 0.2, lumpSeed: i * 3.3 });
  B.add(g, M.bone, m, u.tint ?? 1);
  u.crownY = ySpring + rise + at * 0.5;
  u.archZ = zc;
  u.archAt = at;
  u.ySpring = ySpring;
}

function buildFin(B, M, rng, u, m) {
  const { Lc, size, i, type, deckTop } = u;
  const H = u.finH; // measured from the deck
  const y0 = u.crownY - 1.2;
  const yTop = deckTop + H;
  const h = yTop - y0;
  let rake = type === 'thor' ? 0.42 : type === 'lumb' ? 0.1 : 0.26;
  rake *= h;
  const lean = (rng() - 0.5) * 0.04 * h; // tiny sideways irregularity
  const broken = u.brokenFin;
  const pathFn = bezier3(V(0, y0, 0), V(rake * 0.04, y0 + h * 0.35, 0), V(rake * 0.5, y0 + h * 0.72, lean * 0.5), V(rake, y0 + h, lean));
  const tEnd = broken ? broken : 1;
  const N = 30;
  const pts = curvePts((t) => pathFn(t * tEnd), N);
  let radius;
  if (type === 'lumb') {
    radius = (t0) => {
      const t = t0 * tEnd;
      // a straight-edged hatchet blade, widening slightly toward its squared top
      const fil = 1 + 0.35 * (1 - ss(0, 0.1, t));
      const a = Lc * (0.27 + 0.07 * t) * fil;
      const b = size * (1.3 - 0.4 * t) * fil;
      const e = broken ? 1 : roundEnd(t, 0.975);
      return [a * e, b * Math.max(0.35, e)];
    };
  } else {
    radius = (t0) => {
      const t = t0 * tEnd;
      const fil = 1 + 0.6 * (1 - ss(0, 0.14, t));
      const knob = bump(t, 0.93, 0.07);
      const a = Lc * (0.42 - 0.3 * ss(0.03, 0.72, t) + 0.1 * knob) * fil;
      const b = size * (1.45 - 0.85 * ss(0.03, 0.72, t) + 0.55 * knob) * fil;
      const e = broken ? 1 : roundEnd(t, 0.95);
      return [a * e, b * Math.max(0.3, e)];
    };
  }
  const g = sweep(pts, radius, {
    radial: 18, up: V(0, 0, 1), lump: 0.05, lumpFreq: 0.09, lumpSeed: i * 5.7,
    profile: type === 'lumb' ? superellipse(3) : null, capEnd: true, capBulge: broken ? 0.05 : 0.3,
  });
  B.add(g, M.bone, m, u.tint ?? 1);
  u.finTip = pts[N - 1].clone();
  u.finPath = pathFn;
  u.finTEnd = tEnd;
  if (broken) {
    // jagged shards around the break
    const tip = pts[N - 1];
    const a0 = radius(1)[0];
    for (let k = 0; k < 4; k++) {
      const sx = (k / 3 - 0.5) * a0 * 1.4;
      const hh = 2 + rng() * 5;
      const cg = new THREE.ConeGeometry(0.7 + rng() * 0.8, hh, 5);
      B.add(cg, M.bone, new THREE.Matrix4().multiplyMatrices(m, trs(tip.x + sx, tip.y + hh * 0.35, tip.z + (rng() - 0.5), (rng() - 0.5) * 0.4, rng() * 3, (rng() - 0.5) * 0.5)), u.tint ?? 1);
    }
  }
  if (type === 'neck') {
    // bifid tip: two short horns splay sideways
    const tip = pts[N - 1];
    for (const sd of [-1, 1]) {
      const hp = curvePts(bezier3(tip.clone().add(V(0, -1.5, 0)), tip.clone().add(V(0.5, 1.2, sd * 1.2)), tip.clone().add(V(1.2, 2.8, sd * 2.8)), tip.clone().add(V(2.0, 3.6, sd * 4.2))), 10);
      const hg = sweep(hp, (t) => {
        const r = (1.1 - 0.7 * t) * size * roundEnd(t, 0.8);
        return [r, r];
      }, { radial: 9, up: V(1, 0, 0) });
      B.add(hg, M.bone, m, u.tint ?? 1);
    }
  }
}

function buildWings(B, M, u, m) {
  const { Lc, Rc, size, type, i, L } = u;
  u.wingTip = [];
  for (const sd of [-1, 1]) {
    let p0, p1, p2, p3, a0, a1, b0, b1;
    const yb = Rc * 0.18;
    if (type === 'neck') {
      p0 = V(0, yb, sd * Rc * 0.7);
      p1 = V(-0.02 * L, yb - 1, sd * (Rc + 2.5));
      p2 = V(-0.04 * L, yb - 3, sd * (Rc + 5));
      p3 = V(-0.05 * L, yb - 5, sd * (Rc + 6.5));
      a0 = 0.3; a1 = 0.16; b0 = 1.8; b1 = 1.2;
    } else if (type === 'lumb') {
      p0 = V(0, yb, sd * Rc * 0.7);
      p1 = V(-0.02 * L, yb + 1.5, sd * (Rc + 7));
      p2 = V(-0.02 * L, yb + 3.5, sd * (Rc + 14));
      p3 = V(0.02 * L, yb + 6.5, sd * (Rc + 19 * size));
      a0 = 0.34; a1 = 0.22; b0 = 2.2; b1 = 1.1;
    } else {
      p0 = V(0, yb, sd * Rc * 0.7);
      p1 = V(-0.02 * L, yb + 3.5, sd * (Rc + 5));
      p2 = V(-0.04 * L, yb + 6.5, sd * (Rc + 11 * size));
      p3 = V(-0.05 * L, yb + 5.5, sd * (Rc + 16 * size));
      a0 = 0.28; a1 = 0.13; b0 = 2.1; b1 = 1.0;
    }
    const wpath = bezier3(p0, p1, p2, p3);
    const pts = curvePts(wpath, 18);
    const wr = (t) => {
      const fil = 1 + 0.6 * (1 - ss(0, 0.15, t));
      const knob = type === 'thor' ? bump(t, 0.9, 0.08) : type === 'lumb' ? bump(t, 0.92, 0.1) * 0.5 : 0.3 * bump(t, 0.9, 0.1);
      const e = roundEnd(t, 0.93);
      return [Lc * (a0 - (a0 - a1) * ss(0, 0.7, t) + 0.08 * knob) * fil * e, size * (b0 - (b0 - b1) * ss(0, 0.7, t) + 1.1 * knob) * fil * Math.max(0.3, e)];
    };
    (u.wingPath || (u.wingPath = [])).push({ path: wpath, r: wr });
    const g = sweep(pts, wr, { radial: 14, up: V(0, 1, 0), lump: 0.05, lumpFreq: 0.15, lumpSeed: i * 2.9 + sd, capStart: false });
    B.add(g, M.bone, m, u.tint ?? 1);
    u.wingTip.push(p3.clone());
  }
}

// Two shared lobe shapes (unit-sized); each unit scales them through its matrix.
let FACET_GEO = null;
function facetGeos() {
  if (!FACET_GEO) {
    FACET_GEO = [
      blob(1, 1, 1, { ws: 14, hs: 10, lump: 0.1, freq: 1.4, seed: 1 }),
      blob(1, 1, 1, { ws: 14, hs: 10, lump: 0.1, freq: 1.4, seed: 7 }),
    ];
  }
  return FACET_GEO;
}

function buildFacets(B, M, u, m) {
  const { Lc, L, size, hw, ySpring, i } = u;
  const gap = L - Lc;
  const [gA, gB] = facetGeos();
  for (const sd of [-1, 1]) {
    // post-zygapophysis (towards +x, outer) and pre-zygapophysis (towards -x, inner): the
    // neighbour's lobes sit beside these, so every joint shows two interlocking pairs.
    B.add((i + sd) & 1 ? gA : gB, M.bone, new THREE.Matrix4().multiplyMatrices(m, trs(Lc * 0.5 + gap * 0.2, ySpring - 1.5, sd * (hw + 3.1 * size), 0, 0, -0.12, gap * 0.55 + 2.4, 1.9 * size, 1.5 * size)), u.tint ?? 1);
    B.add((i + sd) & 1 ? gB : gA, M.bone, new THREE.Matrix4().multiplyMatrices(m, trs(-Lc * 0.5 - gap * 0.2, ySpring - 2.4, sd * (hw + 1.9 * size), 0, 0, 0.1, gap * 0.55 + 2.2, 1.7 * size, 1.4 * size)), u.tint ?? 1);
  }
}

// ---------------------------------------------------------------------------
// The missing vertebra: rough ashlar pier with a barrel-vaulted passage, clamped with iron.

function buildPatch(B, M, rng, u, m) {
  const { L, Rc, hw, deckTop } = u;
  const len = L * 0.97;
  const half = Rc + 1.2;
  const yBot = -Rc - 1.5;
  const yTop = deckTop + 0.2;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mm = new THREE.Matrix4();
  const add = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = 1) => {
    mm.multiplyMatrices(m, trs(x, y, z, rx, ry, rz, sx, sy, sz));
    B.add(box, M.stoneSmooth, mm, tint);
  };
  // core
  add(0, (yBot + yTop) / 2, 0, len * 0.94, yTop - yBot - 0.4, half * 1.9, 0, 0, 0, 0.8);
  // coursed facing blocks on the two long sides and the underside, crudely jittered
  let y = yBot;
  let row = 0;
  while (y < yTop - 0.4) {
    const hh = 1.6 + rng() * 1.2;
    const yy = Math.min(y + hh, yTop);
    let x = -len / 2 + (row % 2) * 1.3;
    while (x < len / 2) {
      const w = 2.2 + rng() * 2.6;
      const x1 = Math.min(x + w, len / 2);
      for (const sd of [-1, 1]) {
        if (rng() < 0.05) continue; // a missing block
        const out = 0.15 + rng() * 0.45;
        add((x + x1) / 2, (y + yy) / 2, sd * (half * 0.95 + out * 0.5), x1 - x - 0.12, yy - y - 0.12, out + 0.6,
          (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.04, 0.8 + rng() * 0.3);
      }
      x = x1;
    }
    y = yy;
    row++;
  }
  // underside blocks
  for (let x = -len / 2; x < len / 2; x += 3) {
    for (let z = -half; z < half; z += 3.2) {
      if (rng() < 0.12) continue;
      add(x + 1.5, yBot - 0.3 - rng() * 0.5, z + 1.6, 2.8, 1.2 + rng() * 0.6, 3, 0, 0, 0, 0.75 + rng() * 0.2);
    }
  }
  // barrel vault over the walkway: voussoirs in three rings
  const ai = hw + 0.6;
  for (let r = 0; r < 3; r++) {
    const x = -len / 2 + len * (0.18 + 0.32 * r);
    const ring = 11;
    for (let k = 0; k <= ring; k++) {
      const th = (k / ring) * Math.PI;
      const cz = -Math.cos(th) * (ai + 0.9);
      const cy = yTop + 3.4 + Math.sin(th) * (ai + 0.9);
      add(x + (rng() - 0.5) * 0.3, cy, cz, len * 0.26, 1.8, 2.3, th - Math.PI / 2, 0, 0, 0.85 + rng() * 0.2);
    }
    // piers under the vault
    for (const sd of [-1, 1]) add(x, yTop + 1.7, sd * (ai + 0.9), len * 0.28, 3.4, 1.9, 0, 0, 0, 0.8);
  }
  // rubble cap on the vault
  for (let k = 0; k < 14; k++) {
    add((rng() - 0.5) * len * 0.8, yTop + 3.4 + ai + 1.6 + rng() * 0.8, (rng() - 0.5) * 3, 1.5 + rng() * 2, 1 + rng(), 1.5 + rng() * 2, rng(), rng(), rng(), 0.7 + rng() * 0.3);
  }
  // iron clamp bands where the patch grips the neighbouring bones
  for (const ex of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const th = -Math.PI * 0.95 + (k / 6) * Math.PI * 0.95 * 2;
      if (Math.abs(th) < 0.5) continue;
      const zz = Math.cos(th) * (half + 0.7);
      const yy = Math.sin(th) * (half + 0.4) * 0.95;
      mm.multiplyMatrices(m, trs(ex * (len / 2 + 1.5), yy, zz, Math.PI / 2 - th, 0, 0, 6.5, 0.7, 1.1, 'XYZ'));
      B.add(box, M.iron, mm, 1);
    }
  }
  u.crownY = yTop + 3.4 + ai + 2.5;
  u.finTip = V(0, u.crownY + 1, 0);
  u.wingTip = [V(0, 0, -half), V(0, 0, half)];
  u.ySpring = yTop + 3;
}

// ---------------------------------------------------------------------------

/** Intervertebral discs (dark), marrow-glow seams, and bronze ligament straps across joints. */
export function buildJoints(F, B, M, units) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < units.length - 1; i++) {
    const a = units[i];
    const b = units[i + 1];
    const s = (a.s + a.L / 2 + b.s - b.L / 2) / 2;
    const R = Math.min(a.Rc, b.Rc);
    const gap = b.s - b.Lc / 2 - (a.s + a.Lc / 2);
    // neighbours keep their axis at deck - (Rc + 0.5); the joint sits at the mean depth
    const axisDrop = (a.deckTop + b.deckTop) / 2;
    const mj = F.matrixAt(s, -axisDrop);
    const len = gap + 3;
    const disc = smoothLathe([
      [0.01, -len / 2], [R * 0.8, -len / 2], [R * 0.86, -len * 0.3], [R * 0.8, -0.35], [R * 0.84, 0], [R * 0.8, 0.35],
      [R * 0.86, len * 0.3], [R * 0.8, len / 2], [0.01, len / 2],
    ], 28);
    disc.rotateZ(-Math.PI / 2); // lathe axis y -> x (along the spine)
    B.add(disc, M.basalt, mj, 0.9);
    // the glowing marrow seam
    const ring = new THREE.TorusGeometry(R * 0.845, 0.32, 6, 48);
    ring.rotateY(Math.PI / 2);
    B.add(ring, M.void, mj, 1.25);
    // bronze straps bridging the joint (not on top: the walkway is there)
    const mm = new THREE.Matrix4();
    for (let k = 0; k < 7; k++) {
      const th = Math.PI * 0.72 + (k / 6) * Math.PI * 1.56; // around the underside
      const r = R * 0.98;
      const zz = Math.cos(th) * r;
      const yy = Math.sin(th) * r;
      mm.multiplyMatrices(mj, trs(0, yy, zz, Math.PI / 2 - th, 0, 0, gap + 4.5, 0.55, 1.4, 'XYZ'));
      B.add(box, M.bronze, mm, 1);
    }
    a.jointS = s;
  }
}

// ---------------------------------------------------------------------------

/** Centrum radius profile (must match buildCentrum). */
function centrumR(u, x) {
  const t = (x + u.Lc / 2) / u.Lc;
  const waist = 1 - 0.11 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 1.4);
  const lip = 1 + 0.05 * (bump(t, 0.04, 0.045) + bump(t, 0.96, 0.045));
  return u.Rc * waist * lip;
}

/**
 * Cracks: wandering seams on the centra and up the fin flanks, rendered in the void material
 * (black by day, faint marrow light at night). Points follow the exact lumped surface.
 */
export function buildCracks(B, M, rng, units) {
  for (const u of units) {
    if (u.type === 'patch') continue;
    const nC = 2 + (rng() < 0.5 ? 1 : 0);
    for (let c = 0; c < nC; c++) {
      let x = (rng() - 0.5) * u.Lc * 0.8;
      let th = Math.PI * (0.9 + rng() * 1.2); // sides and underside (the top carries the deck)
      const dir = rng() < 0.5 ? -1 : 1;
      const pts = [];
      const steps = 14 + Math.floor(rng() * 10);
      for (let k = 0; k < steps; k++) {
        const r0 = centrumR(u, x);
        const ca = Math.cos(th);
        const sa = Math.sin(th);
        // same lump field as the sweep: noise in unit-local coords, seeded by unit index
        const lx = x;
        const ly = sa * r0 * 0.95;
        const lz = ca * r0;
        const f = 1 + 0.03 * worldNoise.noise3(lx * 0.11 + u.i * 7.1, ly * 0.11, lz * 0.11 - u.i * 7.1);
        pts.push(new THREE.Vector3(lx * 1, ly * f + sa * 0.14, lz * f + ca * 0.14));
        x += dir * (0.7 + rng() * 0.7);
        th += (rng() - 0.5) * 0.12;
        if (Math.abs(x) > u.Lc * 0.48) break;
      }
      if (pts.length < 4) continue;
      const g = sweep(pts, (t) => {
        const w = 0.2 * Math.sin(Math.PI * t) + 0.06;
        return [w, w];
      }, { radial: 4, capBulge: 0 });
      B.add(g, M.void, u.matrix, 0.75);
    }
    // a crack up one flank of the fin
    if (u.finPath && rng() < 0.75) {
      const sd = rng() < 0.5 ? -1 : 1;
      const t0 = 0.08 + rng() * 0.15;
      const t1 = Math.min(u.finTEnd, t0 + 0.25 + rng() * 0.2);
      const pts = [];
      let jx = 0;
      for (let k = 0; k <= 16; k++) {
        const t = t0 + (t1 - t0) * (k / 16);
        const c = u.finPath(t);
        jx += (rng() - 0.5) * 0.6;
        const tt = t;
        const fil = 1 + 0.6 * (1 - ss(0, 0.14, tt));
        const b = u.size * (u.type === 'lumb' ? (1.7 - 0.5 * tt) : (1.45 - 0.85 * ss(0.03, 0.72, tt))) * fil;
        pts.push(new THREE.Vector3(c.x + jx, c.y, c.z + sd * (b * 1.02 + 0.08)));
      }
      const g = sweep(pts, (t) => {
        const w = 0.22 * Math.sin(Math.PI * t) + 0.05;
        return [w, w];
      }, { radial: 4, capBulge: 0 });
      B.add(g, M.void, u.matrix, 0.75);
    }
  }
}

/** Moss cushions on up-facing ledges (bone material with a dark-olive tint: no extra draw call). */
export function buildMoss(F, B, M, rng, units) {
  const clump = blob(1, 1, 1, { ws: 10, hs: 6, lump: 0.35, freq: 1.2 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const tint = () => new THREE.Color(0.2 + 0.08 * rng(), 0.33 + 0.1 * rng(), 0.1 + 0.05 * rng());
  const put = (mat, p, sx, sy, sz) => {
    e.set((rng() - 0.5) * 0.2, rng() * 6.28, (rng() - 0.5) * 0.2);
    q.setFromEuler(e);
    m.compose(p, q, new THREE.Vector3(sx, sy, sz));
    if (mat) m.premultiply(mat);
    B.add(clump, M.bone, m, tint());
  };
  for (const u of units) {
    if (!u.wingPath) continue;
    for (const w of u.wingPath) {
      const n = u.type === 'neck' ? 1 : 3;
      for (let k = 0; k < n; k++) {
        const t = 0.15 + 0.6 * rng();
        const c = w.path(t);
        const [, b] = w.r(t);
        const sz = 1.4 + rng() * 2.2;
        put(u.matrix, c.clone().setY(c.y + b * 0.8), sz * 1.3, 0.35 + rng() * 0.5, sz);
      }
    }
    // on the arch shoulders
    if (u.crownY && rng() < 0.7) {
      const sd = rng() < 0.5 ? -1 : 1;
      put(u.matrix, V((rng() - 0.5) * u.Lc * 0.3, u.crownY - 1.2, sd * (u.hw + 2.2)), 2.4, 0.6, 1.8);
    }
  }
  // along the curbs of the walkway
  for (let s = F.sW + 6; s < F.sE - 6; s += 7 + rng() * 14) {
    const f = F.frameAt(s);
    const sd = rng() < 0.5 ? -1 : 1;
    const hw = units.find((u) => Math.abs(u.s - s) <= u.L / 2 + 0.01)?.hw ?? 3.5;
    const p = f.P.clone().addScaledVector(f.S, sd * (hw + 0.25)).addScaledVector(f.U, 0.1);
    const mb = new THREE.Matrix4().makeBasis(f.T, f.U, f.S);
    e.set(0, rng() * 6.28, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(), q, new THREE.Vector3(1.2 + rng() * 1.6, 0.35 + rng() * 0.3, 0.9 + rng()));
    m.premultiply(mb).setPosition(p);
    B.add(clump, M.bone, m, tint());
  }
}
