// Kneeling Wardens — one colossus, built as architecture.
//
// Pose: the shins lie on the ground as long coursed halls, the pelvis sits on the heels, and the
// torso is a solid swept along a spine that rises from the pelvis and curls forward (see
// bodyModel). It is still laid in HORIZONTAL 3 m courses, so the bow is made by corbelling: a
// steep bow turns the back into terraces (with stairs up every riser and hanging gardens) and the
// chest into a stepped overhang. Shoulder towers rise either side of the bowed, faceless head;
// the arms come down like buttress-towers (elbows flared) to hands laid on the ground (or on the
// knees) as terraces with stairs; flying buttresses brace the upright backs.
//
// The back is a facade: pilasters and recessed panels (cut columns of the course stacks), string
// courses at irregular intervals, windows in the panels, loggias where the panels are cut deep,
// balconies, and a dark inscribed spine fin that wakes up cyan at night.
//
// Warden-local frame: +z = forward (toward the lake), +x = the warden's right, y = absolute height.
// Proportions are authored for a ~150 m figure and multiplied by W.s.

import * as THREE from 'crownfall-world-three';
import { stack, footPoint, footNormal, keyed, smooth } from './wardens-sink.js';

export const CH = 3; // course height (m) — two of the stone material's 1.5 m block rows
// The head slits share the amber lamp material; this vertex tint turns its #ffb56b into a cold
// cyan seam (dark by day, glowing at night) without another shader program.
export const SLIT_TINT = [0.07, 1.05, 4.2];
const HALF_PI = Math.PI / 2;
const BACK = Math.PI * 1.5;
const TAU = Math.PI * 2;

const _pt = { x: 0, z: 0, lx: 0, lz: 0 };
const _nr = { x: 0, z: 0 };
const _v = new THREE.Vector3();

// Torso cross-sections PERPENDICULAR to the spine: [t (0 pelvis .. 1 top of the shoulders), hx, hd].
// Broad, squared shoulders (widest just below the top) so a bowed head reads BELOW the shoulder
// line from the lake; a pinched waist; a deep pelvis sitting on the heels.
const SPINE_KEYS = [
  [0, 30, 24], [0.15, 26.5, 20.5], [0.3, 23, 18], [0.48, 25.5, 18.5], [0.64, 31.5, 20],
  [0.78, 37, 21], [0.88, 39, 20], [0.95, 37.5, 17], [1, 34, 13],
];
export { SPINE_KEYS };
// Leg keys: [r, hx, hz, cz]
const LEG_KEYS = [
  [-8, 12.5, 49, 14], [0, 13, 50, 14], [10, 14.2, 51, 15], [22, 14.5, 50, 15], [32, 13.2, 47, 13], [40, 10.2, 41, 10], [45, 5.5, 33, 7],
];

// Superellipse exponents: high = rectilinear plans with rounded corners (architecture, not flesh).
const E_TORSO = 4.2;
const E_LEG = 5;
const E_ARM = 4;

/**
 * Angle on a superellipse footprint for a relative position u in [-1, 1] across one face
 * (so facade panels are spaced evenly along the wall, not evenly in angle).
 */
function faceAngle(face, u, e) {
  const k = Math.sign(u) * Math.pow(Math.abs(u), e / 2);
  if (face === 'back') return 2 * Math.PI - Math.acos(k);
  if (face === 'front') return Math.acos(k);
  if (face === 'right') return Math.asin(k);
  return Math.PI - Math.asin(k); // left
}
/** n panels spread over [-span, span] of a face; pilaster fraction `pil`. Returns [centre, halfWidth]. */
function faceCuts(face, n, span, pil, e) {
  const out = [];
  const w = (2 * span) / n;
  for (let k = 0; k < n; k++) {
    const u0 = -span + w * k + w * pil * 0.5;
    const u1 = -span + w * (k + 1) - w * pil * 0.5;
    const a0 = faceAngle(face, u0, e);
    const a1 = faceAngle(face, u1, e);
    out.push([(a0 + a1) / 2, Math.abs(a1 - a0) / 2]);
  }
  return out;
}
// Back facade: 8 recessed panels between pilasters (the spine is the central pilaster).
const PANELS = 8;
const panelCuts = () => faceCuts('back', PANELS, 0.93, 0.26, E_TORSO);
// Chest facade: 6 tall shallow panels.
const FRONT_PANELS = 6;
const frontCuts = () => faceCuts('front', FRONT_PANELS, 0.74, 0.3, E_TORSO);

/**
 * The body as a swept solid: a spine curve rising from the pelvis and curling forward (tangent
 * angle from vertical lean0 -> lean1), with the SPINE_KEYS sections perpendicular to it. The
 * builder still lays HORIZONTAL courses (it is a building): slice(y) intersects the solid with a
 * horizontal plane using its back and front profile curves, and clips the front against the end
 * plane of the shoulders — so a deep bow becomes stepped terraces on the back, a corbelled
 * overhang under the chest and a stepped oblique shoulder top from which the neck leaves.
 * Warden-local metres; `t` of a slice is the spine fraction it belongs to.
 */
export function bodyModel(W) {
  const s = W.s;
  const wide = W.wide ?? 1;
  const L = (W.spineL ?? 126) * s;
  const n = Math.max(32, Math.ceil(L / 1.5));
  const du = L / n;
  const sp = [];
  const kv = [];
  let y = W.g0 + 22 * s;
  let z = -12 * s;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // a formal bow hinges at the hips with a straight back; only the upper back rounds over
    const th = W.lean0 + (W.lean1 - W.lean0) * smooth(W.curl ?? 0.4, 1, t);
    keyed(SPINE_KEYS, t, kv);
    sp.push({ t, y, z, th, hx: kv[0] * s * wide, hd: kv[1] * s });
    y += Math.cos(th) * du;
    z += Math.sin(th) * du;
  }
  // back (sgn +1) and front (-1) profile curves in the yz plane, kept monotone in y
  const profile = (sgn) => {
    const P = [];
    let yMax = -1e9;
    for (const p of sp) {
      const py = p.y + sgn * p.hd * Math.sin(p.th);
      if (py <= yMax + 1e-3) continue;
      yMax = py;
      P.push({ y: py, z: p.z - sgn * p.hd * Math.cos(p.th), t: p.t });
    }
    return P;
  };
  const back = profile(1);
  const front = profile(-1);
  const end = sp[n];
  const topY = back[back.length - 1].y;
  const out = { z: 0, t: 0 };
  const interp = (P, yy) => {
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (P[m].y > yy) hi = m;
      else lo = m;
    }
    const f = Math.min(1, Math.max(0, (yy - P[lo].y) / (P[hi].y - P[lo].y || 1)));
    out.z = P[lo].z + (P[hi].z - P[lo].z) * f;
    out.t = P[lo].t + (P[hi].t - P[lo].t) * f;
    return out;
  };
  const sinE = Math.max(0.05, Math.sin(end.th));
  const cosE = Math.cos(end.th);
  const frontTop = front[front.length - 1].y;
  /** Horizontal section at height y: { cz, hx, hz, t } or null above the shoulders. */
  function slice(yy) {
    if (yy >= topY) return null;
    let zb, tb, zf, tf;
    if (yy <= back[0].y) { zb = back[0].z; tb = 0; } else { interp(back, yy); zb = out.z; tb = out.t; }
    if (yy <= front[0].y) { zf = front[0].z; tf = 0; } else if (yy <= frontTop) { interp(front, yy); zf = out.z; tf = out.t; } else {
      zf = end.z + ((end.y - yy) / sinE) * cosE;
      tf = 1;
    }
    const hz = (zf - zb) / 2;
    if (hz < 1.2) return null;
    const t = Math.min(1, (tb + tf) / 2);
    keyed(SPINE_KEYS, t, kv);
    // the last courses of the shoulder top narrow a little: a rounded crest, not a knife edge
    const crest = 0.8 + 0.2 * smooth(0, 7 * s, hz);
    return { cz: (zb + zf) / 2, hz, hx: kv[0] * s * wide * crest, t };
  }
  /** Spine point at fraction t. */
  function at(t) {
    const f = Math.min(n, Math.max(0, t * n));
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const a = sp[i], b = sp[i + 1];
    return { y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, th: a.th + (b.th - a.th) * k, hx: a.hx + (b.hx - a.hx) * k, hd: a.hd + (b.hd - a.hd) * k };
  }
  return { slice, at, end, topY, L, s, pelvisY: sp[0].y };
}

/**
 * Courses of a torso section between spine fractions t0..t1, laid PERPENDICULAR to the spine
 * and re-centred so the section's axis runs from y=0 upward through x=z=0 (for fallen pieces).
 * Both ends are broken.
 */
export function torsoSection(W, t0, t1, rng) {
  const s = W.s;
  const B = W.body;
  const courses = [];
  const n = Math.max(3, Math.round(((t1 - t0) * B.L) / CH));
  const cuts = panelCuts();
  const nPanels = cuts.length;
  for (let k = 0; k < 6; k++) cuts.push([0.5 + k * 0.42, rng.range(0.12, 0.2)]);
  const kv = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + ((i + 0.5) / n) * (t1 - t0);
    const [hx, hd] = keyed(SPINE_KEYS, t, kv);
    const endK = Math.min(i, n - 1 - i);
    const band = i % 4 === 2;
    const cut = cuts.map((_, j) => {
      if (endK < 3 && rng() < 0.5) return rng.range(2, 8) * (1 - endK / 3) + 1;
      if (j < nPanels) return band ? 0 : 0.9;
      return 0;
    });
    courses.push({
      y0: i * CH, y1: (i + 1) * CH, cx: 0, cz: 0, hx: hx * s * (W.wide ?? 1) + (band ? 1.2 : 0), hz: hd * s + (band ? 1.2 : 0), e: E_TORSO, yaw: 0,
      tint: band ? 0.74 : rng.range(0.86, 1.0), cut, loft: !band,
    });
  }
  return { courses, cuts, len: n * CH };
}

/** Build grid-aligned courses between two absolute heights. */
function courseList(y0, y1) {
  const out = [];
  let y = Math.floor(y0 / CH) * CH;
  while (y < y1 - 0.01) {
    out.push([y, y + CH]);
    y += CH;
  }
  return out;
}

/**
 * Build one warden into `sink` (whose matrix must already place the warden-local frame).
 * W: { s, pose ('prostrate' = forehead on the altar), arms ('front'|'wide'|'sides'|'thighs'),
 *      lean0, lean1, curl, spineL (see bodyModel), neckA, bow, head, dark, neck, g0, groundAt,
 *      groundMin, rng, ruined, stumpT, armBreakR, loggias[] / chestLoggia / waist[] (spine
 *      fractions), bell, balconies, lampP, elbow, shoulderRise }
 */
export function buildWarden(sink, M, W) {
  const s = W.s;
  const rng = W.rng;
  const base = W.g0;
  const Y = (r) => base + r * s;
  const anchors = { plant: [], head: null, handTop: null };
  W.anchorsRef = anchors;
  const B = (W.body = bodyModel(W));
  // relative height of the torso top (the broken stump for the fallen one)
  const torsoTopR = ((W.ruined ? Math.min(B.topY - 3, B.at(W.stumpT).y) : B.topY) - base) / s;
  // storeys given as spine fractions -> relative heights
  const rAt = (t) => (B.at(t).y - base) / s;
  W.loggiaR = (W.loggias || []).map(rAt);
  W.chestLoggiaR = W.chestLoggia ? rAt(W.chestLoggia) : 0;
  W.waistR = W.waist ? W.waist.map(rAt) : null;

  // ---------------------------------------------------------------- legs (long coursed halls)
  for (const side of [-1, 1]) {
    const cxL = side * 17 * s;
    const yaw = side * 0.07;
    const gMin = W.groundMin(cxL, 14 * s, 50 * s);
    const cutsDef = [];
    // flank panels on the outer side, missing-block columns on the inner side
    cutsDef.push(...faceCuts(side > 0 ? 'right' : 'left', 6, 0.62, 0.3, E_LEG));
    for (let k = 0; k < 3; k++) cutsDef.push([faceAngle(side > 0 ? 'left' : 'right', rng.range(-0.6, 0.6), E_LEG), rng.range(0.012, 0.02)]);
    const courses = [];
    for (const [y0, y1] of courseList(gMin - 2, Y(45))) {
      const r = ((y0 + y1) / 2 - base) / s;
      const [hx, hz, cz] = keyed(LEG_KEYS, r);
      const band = Math.round(y0 / CH) % 4 === 0 && r > 6 && r < 38;
      const cut = cutsDef.map((_, j) => {
        if (j < 6) return band || r < 3 || r > 36 ? 0 : rng() < 0.06 ? 2.2 : 0.8;
        return rng() < 0.1 && r > 3 ? rng.range(1.2, 2.6) : 0;
      });
      courses.push({
        y0, y1, cx: cxL, cz: cz * s, hx: hx * s + (band ? 1.1 : 0), hz: hz * s + (band ? 1.1 : 0),
        e: E_LEG, yaw, tint: band ? 0.76 : rng.range(0.93, 1.05), cut, band, loft: !band,
      });
    }
    const res = stack(sink, M.stone, courses, { N: 36, cuts: cutsDef, groundY: base, loft: true });
    panelWindows(sink, M, courses, res, rng, { panels: [0, 1, 2, 3, 4, 5], rowEvery: 2, rowPhase: 1, lampP: W.lampP * 0.6, yMin: Y(4), yMax: Y(36) });
    const top = courses[courses.length - 1];
    anchors.plant.push({ x: cxL, y: top.y1, z: top.cz, rx: top.hx * 0.6, rz: top.hz * 0.7, n: Math.round(7 * s), kind: 'mix' });
    if (W.arms !== 'sides') legStair(sink, M, W, side, cxL, yaw, s, base);
  }

  // ---------------------------------------------------------------- feet (stepped wedges, soles up)
  for (const side of [-1, 1]) {
    const cxF = side * 15 * s;
    const gMin = W.groundMin(cxF, -56 * s, 22 * s);
    const courses = [];
    for (const [y0, y1] of courseList(gMin - 2, Y(22))) {
      const r = ((y0 + y1) / 2 - base) / s;
      const k = Math.max(0, r / 3);
      courses.push({
        y0, y1, cx: cxF, cz: (-56 + k * 2.2) * s, hx: (9.5 - k * 0.3) * s, hz: Math.max(3, 19 - k * 2.2) * s,
        e: 3, yaw: side * -0.05, tint: rng.range(0.88, 1.02),
      });
    }
    stack(sink, M.stone, courses, { N: 24, groundY: base });
    const top = courses[courses.length - 1];
    anchors.plant.push({ x: cxF, y: top.y1, z: top.cz, rx: top.hx * 0.5, rz: top.hz * 0.5, n: 2, kind: 'shrub' });
  }

  // ---------------------------------------------------------------- torso
  const torso = buildTorso(sink, M, W, { Y, torsoTopR, base, s, rng, anchors });

  // ---------------------------------------------------------------- flying buttresses (back)
  if (!W.ruined && W.pose !== 'prostrate' && W.lean0 < 0.35) flyers(sink, M, W, torso.courses, rng, anchors);

  // ---------------------------------------------------------------- arms + hands
  const sh = B.at(0.86);
  for (const side of [-1, 1]) {
    const hand = buildHand(sink, M, W, side, { Y, s, base, rng, anchors });
    const S = { x: side * sh.hx * 0.8, y: sh.y + 2, z: sh.z };
    if (W.pose === 'prostrate') {
      // elbows on the ground beside the chest, forearms lying flat forward to the hands,
      // upper arms as leaning piers
      const E = { x: side * (sh.hx * 0.8 + 14 * s), y: Y(3), z: sh.z + 8 * s };
      const Mid = { x: (S.x + E.x) / 2 + side * 3 * s, y: (S.y + E.y) / 2, z: (S.z + E.z) / 2 + 2 * s };
      buildArm(sink, M, W, side, [E, Mid, S], [10 * s, 10.5 * s, 12 * s], S.y, rng, anchors);
      forearm(sink, M, W, side, E, hand, rng);
      continue;
    }
    if (W.ruined && side > 0) continue; // the outer arm fell (see wardens-ruin.js)
    const Wr = { x: hand.wx, y: hand.wy, z: hand.wz };
    // elbow: flared outward and a little back, as if the arms still brace the bow
    const flare = (W.arms === 'wide' ? 17 : W.arms === 'sides' ? 7 : W.arms === 'thighs' ? 9 : 11) + W.elbow;
    const E = {
      x: (S.x + Wr.x) / 2 + side * flare * s,
      y: S.y * 0.48 + Wr.y * 0.52,
      z: (S.z + Wr.z) / 2 - (W.arms === 'thighs' ? 12 : W.arms === 'sides' ? 4 : 7) * s,
    };
    const topY = W.ruined ? Y(W.armBreakR) : S.y;
    buildArm(sink, M, W, side, [Wr, E, S], [7.8 * s, 9.4 * s, 12.5 * s], topY, rng, anchors);
  }

  // ---------------------------------------------------------------- hunched shoulders
  // Two coursed shoulder towers rise above the crest of the back, so from the lake the top of
  // every figure is a pair of humps with a notch between them where the head has bowed away.
  if (!W.ruined) shoulders(sink, M, W, sh, rng, anchors);

  // ---------------------------------------------------------------- neck + head
  if (W.pose === 'prostrate') proneHead(sink, M, W, { Y, s, anchors, rng });
  else if (!W.ruined) buildNeckHead(sink, M, W, anchors);

  // ---------------------------------------------------------------- the back: portal + central stair
  backPortal(sink, M, W, { Y, s, base, rng });

  // ---------------------------------------------------------------- fallen blocks at the base
  for (let i = 0; i < 34; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(1.0, 1.35);
    const lx = Math.cos(a) * 44 * s * rr;
    const lz = 8 * s + Math.sin(a) * 82 * s * rr;
    const size = rng.range(1.2, 3.8) * (rng() < 0.15 ? 1.8 : 1);
    const gy = W.groundAt(lx, lz);
    sink.box(M.stone, lx, gy + size * 0.3, lz, size * rng.range(1, 1.9), size * rng.range(0.6, 1), size, rng.range(0, 3), rng.range(0.8, 1), rng.range(-0.25, 0.25), rng.range(-0.2, 0.2));
  }

  anchors.torso = torso;
  return anchors;
}

// ---------------------------------------------------------------------------

function buildTorso(sink, M, W, o) {
  const { Y, torsoTopR, base, s, rng, anchors } = o;
  const B = W.body;
  const gMin = W.groundMin(0, -12 * s, 28 * s);
  const cutsDef = panelCuts();
  const nPanels = cutsDef.length;
  const front = frontCuts();
  const nFront = front.length;
  cutsDef.push(...front);
  // missing-block columns on the flanks (between the chest and back panel ranges)
  for (let k = 0; k < 4; k++) cutsDef.push([k < 2 ? faceAngle('right', rng.range(-0.5, 0.2), E_TORSO) : faceAngle('left', rng.range(-0.5, 0.2), E_TORSO), rng.range(0.012, 0.022)]);
  const courses = [];
  const list = courseList(gMin - 2, Y(torsoTopR)).filter(([y0, y1]) => B.slice((y0 + y1) / 2));
  const loggiaR = W.loggiaR;
  // string courses at irregular intervals (3-5 courses): less mechanical than a fixed rhythm
  const bandAt = new Set();
  for (let k = 2 + rng.int(0, 2); k < list.length; k += rng.int(3, 5)) bandAt.add(k);
  for (let i = 0; i < list.length; i++) {
    const [y0, y1] = list[i];
    const r = ((y0 + y1) / 2 - base) / s;
    const sl = B.slice((y0 + y1) / 2);
    const { hx, hz } = sl;
    const cz = sl.cz / s;
    const band = bandAt.has(i) && r > 14 && r < torsoTopR - 5;
    const isLoggia = !band && loggiaR.some((lr) => r > lr && r < lr + (2 * CH) / s + 0.01);
    const isChestLoggia = !band && W.chestLoggiaR && r > W.chestLoggiaR && r < W.chestLoggiaR + (2 * CH) / s + 0.01;
    const cut = cutsDef.map((_, j) => {
      if (j < nPanels) {
        if (band || r < 8 || r > torsoTopR - 7) return 0;
        if (isLoggia) return 4.4 * s;
        return rng() < 0.05 ? 2.3 : 0.9;
      }
      // the chest stays plain coursed stone, except for one gallery cut across it
      if (j < nPanels + nFront) return isChestLoggia ? 3.6 * s : 0;
      return rng() < 0.07 && r > 10 ? rng.range(1.2, 2.8) : 0;
    });
    if (W.ruined && r > torsoTopR - 16) {
      for (let j = 0; j < cut.length; j++) if (rng() < 0.5) cut[j] = 2 + rng.range(3, 12) * smooth(torsoTopR - 18, torsoTopR, r);
    }
    const grow = band ? 1.3 : 0;
    courses.push({
      y0, y1, cx: 0, cz: cz * s, hx: hx + grow, hz: hz + grow, e: E_TORSO, yaw: 0,
      tint: band ? 0.74 : rng.range(0.93, 1.05), cut, r, t: sl.t, band, isLoggia, isChestLoggia, loft: !band,
    });
  }
  // Where the bow is steep, walls are not battered but STEPPED: each course sets forward as a
  // terrace on the back and a corbel under the chest (loft only across small shifts).
  for (let i = 0; i + 1 < courses.length; i++) {
    const a = courses[i], b = courses[i + 1];
    if (Math.abs(b.cz - a.cz) > 1.3 || Math.abs(b.hz - a.hz) > 1.6) a.loft = false;
  }
  // an open waist: the torso is cut in two and the upper body stands on a ring of piers
  let res;
  if (W.waistR && !W.ruined) {
    const lower = courses.filter((c) => c.r < W.waistR[0]);
    const upper = courses.filter((c) => c.r > W.waistR[1]);
    for (const c of [lower[lower.length - 1], upper[0]]) {
      c.band = true;
      c.loft = false;
      c.hx += 1.8;
      c.hz += 1.8;
      c.tint = 0.72;
      c.cut = c.cut.map(() => 0);
    }
    res = stack(sink, M.stone, lower, { N: 48, cuts: cutsDef, groundY: base, loft: true });
    stack(sink, M.stone, upper, { N: 48, cuts: cutsDef, groundY: base, loft: true, capBottom: true });
    openWaist(sink, M, W, lower[lower.length - 1], upper[0], rng, anchors);
    courses.length = 0;
    courses.push(...lower, ...upper);
  } else {
    res = stack(sink, M.stone, courses, { N: 48, cuts: cutsDef, groundY: base, loft: true });
  }
  const top = courses[courses.length - 1];

  // cracks running down the flanks (between the chest and back facades)
  for (let k = 0; k < 4; k++) {
    let a = faceAngle(k < 2 ? 'right' : 'left', rng.range(-0.6, 0.3), E_TORSO);
    const i0 = Math.floor(rng.range(0.15, 0.7) * courses.length);
    const n = rng.int(5, 12);
    let u = 0;
    for (let i = i0; i < Math.min(courses.length - 1, i0 + n); i++) {
      const c = courses[i];
      const cn = courses[i + 1];
      if (c.band || cn.y0 !== c.y1) { a += rng.range(-0.02, 0.02); continue; }
      const du = rng.range(-0.8, 0.8);
      crackQuad(sink, M, c, cn, a, u, u + du, 0.22 + rng() * 0.25);
      u += du;
    }
  }

  // spine fin: dark inscribed stone down the back midline (glows cyan at night)
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (c.r < 22 || c.r > torsoTopR - 4) continue;
    // follow the lean of the (lofted) back so the fin hugs the wall
    const pitch = wallPitch(c, courses[i + 1], BACK);
    footPoint(c, BACK, _pt);
    footNormal(c, BACK, _nr);
    const depth = 3.2 * s;
    const h = c.y1 - c.y0;
    const out = depth * 0.5 - 0.6 + Math.tan(pitch) * h * 0.5;
    sink.box(M.spine, _pt.x + _nr.x * out, (c.y0 + c.y1) / 2, _pt.z + _nr.z * out, 2.6 * s, h / Math.cos(pitch) + 0.05, depth, Math.atan2(_nr.x, _nr.z), 1, pitch);
  }

  // Where the bow turns the back into terraces, short flights climb every riser on both sides of
  // the spine: from behind, a stair runs up the whole back like the stair of a ziggurat.
  {
    const q0 = { x: 0, z: 0 }, q1 = { x: 0, z: 0 }, n1 = { x: 0, z: 0 };
    const off = 1.3 * s + 2.4;
    for (let i = 0; i + 1 < courses.length; i++) {
      const c = courses[i], cn = courses[i + 1];
      if (c.loft !== false || c.r < 24 || cn.r > torsoTopR - 3 || cn.y0 !== c.y1) continue;
      footPoint(c, BACK, q0);
      footPoint(cn, BACK, q1);
      footNormal(cn, BACK, n1);
      const d = (q0.x - q1.x) * n1.x + (q0.z - q1.z) * n1.z; // ledge depth at the midline
      if (d < 2) continue;
      // hanging gardens: some terraces have been colonised by shrubs and small pines
      if (d > 3 && rng() < 0.35) {
        const a = BACK + rng.sign() * rng.range(0.25, 1.1);
        footPoint(c, a, _pt);
        footNormal(c, a, _nr);
        anchors.plant.push({ x: _pt.x - _nr.x * d * 0.45, y: c.y1, z: _pt.z - _nr.z * d * 0.45, rx: 1.5, rz: 1.5, n: rng.int(1, 3), kind: rng() < 0.5 ? 'mix' : 'shrub' });
      }
      const yaw = Math.atan2(-n1.x, -n1.z); // climbing inward
      const tx = -n1.z, tz = n1.x;
      const nStep = 10;
      const run = Math.min(d - 0.5, 7) / nStep;
      const w = 2.6;
      for (const sd of [-1, 1]) {
        for (let k = 0; k < nStep; k++) {
          const back = (nStep - k - 0.5) * run; // distance out from the riser
          const hh = (k + 1) * (CH / nStep);
          sink.box(M.stone, q1.x + n1.x * back + tx * off * sd, c.y1 + hh / 2, q1.z + n1.z * back + tz * off * sd, w, hh, run + 0.02, yaw, 0.8);
        }
      }
    }
  }

  // loggias: the pilasters stand free as piers; balustrades and dark doorways behind
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (!c.isLoggia || courses[i - 1]?.isLoggia) continue;
    for (let j = 0; j < nPanels; j++) {
      const C = res.cuts[j];
      footPoint(c, C.c, _pt);
      footNormal(c, C.c, _nr);
      const yaw = Math.atan2(_nr.x, _nr.z);
      const w = (C.a1 - C.a0) * (c.hx + c.hz) * 0.5;
      sink.box(M.stone, _pt.x - _nr.x * 0.4, c.y0 + 0.55, _pt.z - _nr.z * 0.4, w, 1.1, 0.45, yaw, 0.88);
      const lit = rng() < W.lampP * 4;
      const ix = _pt.x - _nr.x * (4.4 * s - 0.06), iz = _pt.z - _nr.z * (4.4 * s - 0.06);
      archOpening(sink, lit ? M.lamp : M.basalt, ix, c.y0, iz, yaw, Math.min(3.2, w * 0.45), 4.6, lit ? 1 : 0.08);
    }
  }

  // the chest gallery: balustrades between the piers, a row of doors behind (mostly lit at night)
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (!c.isChestLoggia || courses[i - 1]?.isChestLoggia) continue;
    for (let j = nPanels; j < nPanels + nFront; j++) {
      const C = res.cuts[j];
      footPoint(c, C.c, _pt);
      footNormal(c, C.c, _nr);
      const yaw = Math.atan2(_nr.x, _nr.z);
      const w = (C.a1 - C.a0) * (c.hx + c.hz) * 0.5;
      sink.box(M.stone, _pt.x - _nr.x * 0.4, c.y0 + 0.55, _pt.z - _nr.z * 0.4, w, 1.1, 0.45, yaw, 0.88);
      const lit = rng() < 0.65;
      const ix = _pt.x - _nr.x * (3.6 * s - 0.06), iz = _pt.z - _nr.z * (3.6 * s - 0.06);
      archOpening(sink, lit ? M.lamp : M.basalt, ix, c.y0, iz, yaw, Math.min(4.2, w * 0.6), 5.4, lit ? rng.range(1.0, 1.4) : 0.07);
    }
  }

  // windows in the panels (alternate courses)
  panelWindows(sink, M, courses, res, rng, { panels: [...Array(nPanels).keys()], rowEvery: 2, rowPhase: 0, lampP: W.lampP, yMin: Y(10), yMax: Y(torsoTopR - 8) });

  // the chest: plain coursed stone pierced by a few irregular slit windows, like a cliff dwelling
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (c.band || c.isChestLoggia || c.r < 30 || c.r > torsoTopR - 12 || rng() > 0.2) continue;
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const a = faceAngle('front', rng.range(-0.75, 0.75), E_TORSO);
      const pitch = wallPitch(c, courses[i + 1], a);
      footPoint(c, a, _pt);
      footNormal(c, a, _nr);
      const lean = Math.tan(pitch);
      const yaw = Math.atan2(_nr.x, _nr.z);
      const lit = rng() < W.lampP * 2.5;
      archOpening(sink, lit ? M.lamp : M.basalt, _pt.x + _nr.x * (0.06 + lean * 0.4), c.y0 + 0.4, _pt.z + _nr.z * (0.06 + lean * 0.4), yaw, 0.9, 2.2, lit ? 1 : 0.07, false, pitch);
      sink.box(M.stone, _pt.x + _nr.x * (0.25 + lean * 2.75), c.y0 + 2.75, _pt.z + _nr.z * (0.25 + lean * 2.75), 1.8, 0.4, 0.6, yaw, 0.82, pitch);
    }
  }

  // balconies projecting from random panels
  for (let k = 0; k < W.balconies; k++) {
    const c = courses[Math.floor(rng.range(0.22, 0.85) * courses.length)];
    if (c.isLoggia || c.band) continue;
    const j = rng.int(0, nPanels - 1);
    if (j === 3 || j === 4) continue; // not on the spine
    balcony(sink, M, c, res.cuts[j], c.cut[j], s, rng, W.lampP);
  }

  // shoulder terrace garden + shrubs on the back ledges
  if (!W.ruined) {
    anchors.plant.push({ x: top.cx, y: top.y1, z: top.cz - top.hz * 0.2, rx: top.hx * 0.75, rz: top.hz * 0.55, n: Math.round(8 * s), kind: 'mix' });
  } else {
    anchors.plant.push({ x: top.cx, y: top.y1 - 6, z: top.cz, rx: top.hx * 0.5, rz: top.hz * 0.5, n: 6, kind: 'mix' });
  }
  for (const c of courses) {
    if (c.band && c.r > 60 && rng() < 0.4) {
      footPoint(c, BACK + rng.range(-1.2, 1.2), _pt);
      footNormal(c, BACK, _nr);
      anchors.plant.push({ x: _pt.x - _nr.x * 0.3, y: c.y1, z: _pt.z - _nr.z * 0.3, rx: 0.3, rz: 0.3, n: 1, kind: 'shrub' });
    }
  }

  return {
    courses,
    top: { x: top.cx, y: top.y1, z: top.cz, hx: top.hx, hz: top.hz },
  };
}

/** One segment of a crack: a thin dark sliver on a lofted wall between two course rings. */
const _q0 = { x: 0, z: 0 }, _q1 = { x: 0, z: 0 }, _qn = { x: 0, z: 0 };
function crackQuad(sink, M, c, cn, a, u0, u1, w) {
  footPoint(c, a, _q0);
  footPoint(cn, a, _q1);
  footNormal(c, a, _qn);
  const tx = -_qn.z, tz = _qn.x; // tangent along the wall
  const o = 0.07;
  const p = (q, u, y, sgn) => [q.x + _qn.x * o + tx * (u + (sgn * w) / 2), y, q.z + _qn.z * o + tz * (u + (sgn * w) / 2)];
  // wound so the face points outward (+normal)
  sink.quad(M.basalt, p(_q0, u0, c.y0, 1), p(_q0, u0, c.y0, -1), p(_q1, u1, c.y1, -1), p(_q1, u1, c.y1, 1), 0.05);
}

/** Ring of leaning piers between two torso courses, with a core column and a spiral stair. */
function openWaist(sink, M, W, lo, up, rng, anchors) {
  const s = W.s;
  const y0 = lo.y1;
  const y1 = up.y0;
  const n = 9;
  const p0 = { x: 0, z: 0 }, p1 = { x: 0, z: 0 }, n0 = { x: 0, z: 0 }, n1 = { x: 0, z: 0 };
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const pierW = 2.9 * s;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.11;
    footPoint(lo, a, p0);
    footNormal(lo, a, n0);
    footPoint(up, a, p1);
    footNormal(up, a, n1);
    const inset = 1.8 + 2.2 * s;
    const ax = p0.x - n0.x * inset, az = p0.z - n0.z * inset;
    const bx = p1.x - n1.x * inset, bz = p1.z - n1.z * inset;
    dir.set(bx - ax, y1 - y0, bz - az);
    const len = dir.length();
    dir.normalize();
    qy.setFromAxisAngle(UP, Math.atan2(n0.x, n0.z));
    q.setFromUnitVectors(UP, dir).multiply(qy);
    m.compose(new THREE.Vector3((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2), q, new THREE.Vector3(pierW, len + 0.4, pierW * 1.3));
    sink.boxM(M.stone, m, rng.range(0.84, 0.98));
    // capital + base blocks
    sink.box(M.stone, bx, y1 - 0.9, bz, pierW * 1.5, 1.8, pierW * 1.8, Math.atan2(n1.x, n1.z), 0.8);
    sink.box(M.stone, ax, y0 + 0.9, az, pierW * 1.5, 1.8, pierW * 1.8, Math.atan2(n0.x, n0.z), 0.8);
  }
  const c0 = new THREE.Vector3(lo.cx, y0, lo.cz);
  const c1 = new THREE.Vector3(up.cx, y1, up.cz);
  if (W.bell) {
    // no core: a bronze bell hangs from the soffit (animated by wardens.js); the stair spirals
    // up the inside of the pier ring instead
    anchors.bell = { x: up.cx, y: y1 - 0.5, z: up.cz, s };
    const steps = Math.round((y1 - y0) / 0.5);
    const r = Math.min(lo.hx, lo.hz) - 7.5 * s;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const a = t * TAU * 0.85 + 2.2;
      const cx = c0.x + (c1.x - c0.x) * t, cz = c0.z + (c1.z - c0.z) * t;
      sink.box(M.basalt, cx + Math.sin(a) * r, y0 + t * (y1 - y0) + 0.25, cz + Math.cos(a) * r, 1.4, 0.5, 4.6 * s, a, 0.85);
    }
  } else {
    // core column, leaning with the body, with a spiral stair winding around it
    dir.subVectors(c1, c0);
    const len = dir.length();
    dir.normalize();
    q.setFromUnitVectors(UP, dir);
    const core = new THREE.CylinderGeometry(3.4 * s, 3.8 * s, len, 12, 1, true);
    m.compose(c0.clone().add(c1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    sink.geo(M.basalt, core, m, 0.8);
    core.dispose();
    const steps = Math.round((y1 - y0) / 0.55);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const a = t * TAU * 1.4;
      const cx = c0.x + (c1.x - c0.x) * t, cz = c0.z + (c1.z - c0.z) * t;
      const r = 6.4 * s;
      sink.box(M.basalt, cx + Math.sin(a) * r, y0 + t * (y1 - y0) + 0.25, cz + Math.cos(a) * r, 1.5, 0.5, 5.2 * s, a, 0.85);
    }
  }
  // lanterns hung inside, and moss/shrubs on the open floor
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4;
    sink.box(M.lamp, lo.cx + Math.sin(a) * 15 * s, y1 - 5 - k * 2, lo.cz + Math.cos(a) * 15 * s, 1.2, 1.8, 1.2, a, 1);
    sink.box(M.basalt, lo.cx + Math.sin(a) * 15 * s, y1 - 2 - k, lo.cz + Math.cos(a) * 15 * s, 0.25, 4 + k * 2, 0.25, 0, 0.6);
  }
  anchors.plant.push({ x: lo.cx, y: y0, z: lo.cz, rx: lo.hx * 0.8, rz: lo.hz * 0.8, n: 5, kind: 'shrub' });
  anchors.waist = { x: (lo.cx + up.cx) / 2, y: y0, z: (lo.cz + up.cz) / 2, y1, rx: lo.hx, rz: lo.hz };
}

// ---------------------------------------------------------------------------

/**
 * Two stepped piers stand behind the kneeling figure, either side of the back stair, and throw
 * flying buttresses (a high and a low flyer each) against the back — the chevet of a cathedral
 * built onto a body. Each flyer is a sloping coursed beam carried on a quarter arch.
 */
function flyers(sink, M, W, courses, rng, anchors) {
  const s = W.s;
  const base = W.g0;
  const a0 = { x: 0, z: 0 }, n0 = { x: 0, z: 0 };
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3();
  const courseAt = (r) => courses.find((c) => c.r >= r && !c.band && !c.isLoggia) || courses[courses.length - 1];
  for (const side of [-1, 1]) {
    const px = side * 27 * s, pz = -88 * s;
    const g = W.groundMin(px, pz, 8 * s);
    const top = base + 46 * s;
    // the pier: three stages, each set back and capped by a projecting coping
    const stages = [[g - 2, base + 18 * s, 14, 17], [base + 18 * s, base + 34 * s, 12, 14.5], [base + 34 * s, top, 10, 12]];
    for (const [y0, y1, w, d] of stages) {
      sink.box(M.stone, px, (y0 + y1) / 2, pz, w * s, y1 - y0, d * s, 0, rng.range(0.86, 0.96));
      sink.box(M.stone, px, y1 + 0.5, pz, w * s + 1.4, 1, d * s + 1.4, 0, 0.72);
    }
    // pinnacle: a slender obelisk with a lantern niche
    sink.box(M.stone, px, top + 1 + 8 * s, pz, 5 * s, 16 * s, 5 * s, 0, 0.9);
    sink.box(M.stone, px, top + 1 + 16 * s + 3 * s, pz, 3.4 * s, 6 * s, 3.4 * s, Math.PI / 4, 0.85, 0.62, 0.62);
    sink.box(M.lamp, px, top + 1 + 10 * s, pz + 2.55 * s, 1.3, 2, 0.12, 0, rng() < 0.6 ? 1 : 0.1);
    // arch opening through the lowest stage (the back stair passes between the piers)
    archOpening(sink, M.basalt, px + side * (7 * s + 0.05), g, pz, side * HALF_PI, 7 * s, 13 * s, 0.06);
    archOpening(sink, M.basalt, px - side * (7 * s + 0.05), g, pz, -side * HALF_PI, 7 * s, 13 * s, 0.06);
    // two flyers: from the pier top to the back wall high up, and from mid-pier to the lower back
    for (const [fy, r, thick] of [[top - 4 * s, 86, 5.2], [base + 28 * s, 58, 4.4]]) {
      const c = courseAt(r);
      const a = BACK + side * 0.46;
      footPoint(c, a, a0);
      footNormal(c, a, n0);
      const A = new THREE.Vector3(px, fy, pz + 3 * s);
      const Bw = new THREE.Vector3(a0.x - n0.x * 1.5, c.y0 + 1.5, a0.z - n0.z * 1.5);
      dir.subVectors(Bw, A);
      const len = dir.length();
      dir.normalize();
      q.setFromUnitVectors(Z, dir);
      // the beam (top of the flyer) with a coping
      m.compose(one.copy(A).add(Bw).multiplyScalar(0.5), q, new THREE.Vector3(thick * s, thick * 1.1 * s, len));
      sink.boxM(M.stone, m, 0.88, false);
      m.compose(one.copy(A).add(Bw).multiplyScalar(0.5).add(new THREE.Vector3(0, thick * 0.6 * s, 0)), q, new THREE.Vector3(thick * s + 0.8, 0.8, len));
      sink.boxM(M.stone, m, 0.72, false);
      // the quarter arch under it: voussoir blocks on a circular arc from the pier face to the beam
      const nV = 9;
      const rise = Math.max(8, (Bw.y - A.y) * 0.3 + 15 * s);
      for (let k = 0; k < nV; k++) {
        const t0 = k / nV, t1 = (k + 1) / nV;
        const p0 = A.clone().lerp(Bw, t0), p1 = A.clone().lerp(Bw, t1);
        // arc sags below the beam: deepest near the pier, meets the beam at the wall
        const sag = (t) => rise * Math.sin((1 - t) * HALF_PI) * (1 - t * 0.2);
        p0.y -= sag(t0);
        p1.y -= sag(t1);
        const dv = p1.clone().sub(p0);
        const L = dv.length();
        q.setFromUnitVectors(Z, dv.normalize());
        m.compose(p0.add(p1).multiplyScalar(0.5), q, new THREE.Vector3(thick * 0.9 * s, 4.4 * s, L + 0.3));
        sink.boxM(M.stone, m, k % 2 ? 0.8 : 0.9, false);
        // spandrel posts between the arc and the beam
        if (k % 3 === 1) {
          const tm = (t0 + t1) / 2;
          const pt = A.clone().lerp(Bw, tm);
          const h = sag(tm);
          sink.box(M.stone, pt.x, pt.y - h / 2, pt.z, thick * 0.7 * s, h, 1.4 * s, Math.atan2(dir.x, dir.z), 0.84);
        }
      }
    }
    anchors.plant.push({ x: px, y: top + 1, z: pz, rx: 2.5 * s, rz: 3 * s, n: 2, kind: 'shrub' });
  }
}

function shoulders(sink, M, W, sh, rng, anchors) {
  const s = W.s;
  const B = W.body;
  const rise = (W.shoulderRise ?? 7) * s;
  const yTop = Math.max(B.topY, sh.y + 6 * s) + rise;
  for (const side of [-1, 1]) {
    const cx = side * sh.hx * 0.8;
    // sit the tower on the arm's top, a little behind the shoulder joint
    const cz = sh.z - Math.cos(sh.th) * 3 * s;
    const courses = [];
    const y0 = sh.y - 10 * s;
    let k = 0;
    for (let y = Math.floor(y0 / CH) * CH; y < yTop - 0.01; y += CH, k++) {
      const u = Math.min(1, Math.max(0, (y + CH * 0.5 - y0) / (yTop - y0))); // 0 bottom .. 1 top
      // a corbelled dome, not a flat-topped turret: from above it must read as a shoulder
      const r = Math.max(4.5, 16 * Math.pow(Math.max(0, 1 - Math.pow(u, 3)), 0.32)) * s;
      const band = k % 4 === 1;
      courses.push({ y0: y, y1: y + CH, cx, cz: cz + side * 0, hx: r + (band ? 0.9 : 0), hz: r * 1.08 + (band ? 0.9 : 0), e: 3.2, yaw: side * 0.18, tint: band ? 0.74 : rng.range(0.9, 1.04), loft: !band });
    }
    const cuts = [[side > 0 ? 0 : Math.PI, 0.32], [BACK, 0.3]];
    for (const c of courses) {
      const inBand = c.tint < 0.8;
      c.cut = cuts.map(() => (inBand ? 0 : rng() < 0.3 ? 1.6 : 0.7));
    }
    stack(sink, M.stone, courses, { N: 28, cuts, groundY: W.g0, loft: true });
    // a lit window high in the outer face of each shoulder (a watch-room)
    const c = courses[Math.max(0, courses.length - 5)];
    footPoint(c, side > 0 ? 0 : Math.PI, _pt);
    footNormal(c, side > 0 ? 0 : Math.PI, _nr);
    const lit = rng() < 0.5;
    archOpening(sink, lit ? M.lamp : M.basalt, _pt.x + _nr.x * 0.1 - _nr.x * 0.7, c.y0 + 0.3, _pt.z + _nr.z * 0.1 - _nr.z * 0.7, Math.atan2(_nr.x, _nr.z), 1.6, 3.2, lit ? 1 : 0.07);
    const top = courses[courses.length - 1];
    anchors.plant.push({ x: cx, y: top.y1, z: cz, rx: top.hx * 0.5, rz: top.hz * 0.5, n: rng.int(1, 3), kind: 'mix' });
    // a watch-lantern on most shoulder tops: at night each figure shows two warm points above
    // its bowed head
    if (rng() < 0.75) {
      const ly = top.y1, lz = cz + top.hz * 0.35;
      sink.box(M.basalt, cx, ly + 0.6, lz, 3, 1.2, 3, 0, 0.8);
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sink.box(M.stone, cx + ox * 1.1, ly + 2.6, lz + oz * 1.1, 0.4, 2.8, 0.4, 0, 0.85);
      sink.box(M.lamp, cx, ly + 2.5, lz, 1.5, 2, 1.5, 0, 1.3);
      sink.box(M.stone, cx, ly + 4.3, lz, 3.2, 0.6, 3.2, 0, 0.8);
    }
  }
}

function buildArm(sink, M, W, side, path, radii, topY, rng, anchors) {
  const [A, B, C] = path; // wrist, elbow, shoulder (y increasing)
  const s = W.s;
  const courses = [];
  const at = (y, out) => {
    let P, Q, rP, rQ;
    if (y <= B.y) { P = A; Q = B; rP = radii[0]; rQ = radii[1]; }
    else { P = B; Q = C; rP = radii[1]; rQ = radii[2]; }
    const t = Math.min(1, Math.max(0, (y - P.y) / (Q.y - P.y)));
    out.x = P.x + (Q.x - P.x) * t;
    out.z = P.z + (Q.z - P.z) * t;
    out.r = rP + (rQ - rP) * t;
    return out;
  };
  const p0 = {}, p1 = {}, pm = {};
  // a deep slot up the back-outer face of the upper arm with a stair inside; missing blocks
  const slotA = side > 0 ? -0.55 : Math.PI + 0.55;
  const cutsDef = [[slotA, 0.2]];
  for (let k = 0; k < 3; k++) cutsDef.push([slotA + Math.PI * 0.7 + k * 0.9, rng.range(0.06, 0.1)]);
  const slotY0 = B.y + 8, slotY1 = C.y - 14;
  for (const [y0, y1] of courseList(A.y - CH, topY)) {
    const ym = (y0 + y1) / 2;
    at(ym, pm);
    at(ym - 6, p0);
    at(ym + 6, p1);
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const hd = Math.hypot(dx, dz);
    const elong = Math.min(2.2, Math.sqrt(1 + (hd / 12) * (hd / 12)));
    const yaw = hd > 0.01 ? Math.atan2(dx, dz) : 0;
    const gk = Math.round(y0 / CH);
    const band = gk % 4 === 0;
    const grow = band ? 0.8 : 0;
    const broken = W.ruined && topY - y1 < 12;
    const inSlot = !W.ruined && y0 >= slotY0 && y1 <= slotY1 && !band;
    courses.push({
      y0, y1, cx: pm.x, cz: pm.z, hx: pm.r + grow, hz: pm.r * elong + grow, e: E_ARM, yaw,
      tint: band ? 0.76 : rng.range(0.93, 1.05), band, loft: !band,
      cut: cutsDef.map((_, j) => {
        if (broken) return rng() < 0.6 ? rng.range(2, 6) : 0;
        if (j === 0) return inSlot ? 3.2 * s : 0;
        return rng() < 0.06 ? rng.range(1, 2) : 0;
      }),
    });
  }
  const res = stack(sink, M.stone, courses, { N: 28, cuts: cutsDef, groundY: W.g0, loft: true });
  // the stair inside the slot: short flights zig-zagging up, seen through the opening
  const C0 = res.cuts[0];
  let flip = 1;
  for (const c of courses) {
    if (!(c.cut[0] > 0)) continue;
    footPoint(c, C0.c, _pt);
    footNormal(c, C0.c, _nr);
    const yaw = Math.atan2(_nr.x, _nr.z);
    const tx = Math.cos(yaw), tz = -Math.sin(yaw); // tangent along the wall
    const d = 3.2 * s;
    archOpening(sink, M.basalt, _pt.x - _nr.x * (d - 0.05), c.y0, _pt.z - _nr.z * (d - 0.05), yaw, 3.6 * s, 3, 0.06, true);
    for (let k = 0; k < 6; k++) {
      const u = (k / 5 - 0.5) * 2.4 * s * flip;
      sink.box(M.basalt, _pt.x - _nr.x * d * 0.45 + tx * u, c.y0 + 0.25 + k * 0.5, _pt.z - _nr.z * d * 0.45 + tz * u, 0.55, 0.28, d * 0.8, yaw, 0.75);
    }
    flip = -flip;
  }
  // slit windows on the outer face
  for (const c of courses) {
    if (c.band || c.y0 < W.g0 + 40 * s || c.y1 > topY - 6 || Math.round(c.y0 / CH) % 2) continue;
    const a = side > 0 ? 0.25 : Math.PI - 0.25;
    footPoint(c, a, _pt);
    footNormal(c, a, _nr);
    const lit = rng() < W.lampP;
    archOpening(sink, lit ? M.lamp : M.basalt, _pt.x + _nr.x * 0.06, c.y0 + 0.5, _pt.z + _nr.z * 0.06, Math.atan2(_nr.x, _nr.z), 0.9, 2.1, lit ? 1 : 0.08);
  }
  const top = courses[courses.length - 1];
  if (W.ruined) anchors.plant.push({ x: top.cx, y: top.y1, z: top.cz, rx: top.hx * 0.4, rz: top.hz * 0.4, n: 3, kind: 'mix' });
}

/** A forearm lying flat on the ground from the elbow to the wrist (a long low coursed hall). */
function forearm(sink, M, W, side, E, hand, rng) {
  const s = W.s;
  const cx = (E.x + hand.wx) / 2, cz = (E.z + hand.wz) / 2;
  const len = Math.hypot(hand.wx - E.x, hand.wz - E.z);
  const yaw = Math.atan2(hand.wx - E.x, hand.wz - E.z);
  const gMin = W.groundMin(cx, cz, len * 0.5);
  const courses = [];
  const KEYS = [[-6, 9.5, 1], [0, 10, 1], [7, 10.2, 1], [13, 8.4, 0.95], [17, 5, 0.85]];
  for (const [y0, y1] of courseList(gMin - 2, W.g0 + 17 * s)) {
    const r = ((y0 + y1) / 2 - W.g0) / s;
    const [hx, kz] = keyed(KEYS, r);
    const band = Math.round(y0 / CH) % 4 === 0 && r > 2 && r < 14;
    courses.push({ y0, y1, cx, cz, hx: hx * s + (band ? 0.8 : 0), hz: (len * 0.5 + 4 * s) * kz + (band ? 0.8 : 0), e: E_LEG, yaw, tint: band ? 0.76 : rng.range(0.92, 1.04), band, loft: !band });
  }
  stack(sink, M.stone, courses, { N: 32, groundY: W.g0, loft: true });
  const top = courses[courses.length - 1];
  W.anchorsRef?.plant.push({ x: cx, y: top.y1, z: cz, rx: top.hx * 0.5, rz: top.hz * 0.6, n: 3, kind: 'mix' });
  // a doorway in the outer flank of each forearm
  const nx = Math.cos(yaw) * side, nz = -Math.sin(yaw) * side;
  archOpening(sink, M.basalt, cx + nx * (10 * s + 0.1), W.g0 + 0.2, cz + nz * (10 * s + 0.1), Math.atan2(nx, nz), 3 * s, 5 * s, 0.06);
}

/** The prostrate warden's head: resting on the ground between its forearms, crown to the lake. */
function proneHead(sink, M, W, o) {
  const { s, anchors, rng } = o;
  const H = headShape(W.head, s * 1.12);
  // The deepest bow: the forehead rests on a stepped altar raised in front of the chest, at the
  // end of the causeway. The head hangs almost vertically, crown down on the altar's top.
  const e = W.body.end;
  const zA = e.z + 16 * s;
  const gA = W.groundMin(0, zA, 20 * s);
  const altarTop = W.g0 + 24 * s;
  {
    const courses = [];
    for (const [y0, y1] of courseList(gA - 2, altarTop)) {
      const k = Math.max(0, (y0 - W.g0) / (altarTop - W.g0));
      const tier = Math.min(2, Math.floor(k * 3)); // three setbacks
      const coping = y1 >= altarTop - 0.01 || Math.floor(((y1 - W.g0) / (altarTop - W.g0)) * 3) !== tier;
      courses.push({ y0, y1, cx: 0, cz: zA, hx: (22 - tier * 4.5) * s + (coping ? 0.8 : 0), hz: (18 - tier * 3.5) * s + (coping ? 0.8 : 0), e: 7, yaw: 0, tint: coping ? 0.72 : rng.range(0.8, 0.92), loft: false });
    }
    stack(sink, M.basalt, courses, { N: 36, groundY: W.g0 });
    // stair up the lake face of the altar (the causeway arrives here)
    const zF = zA + 18 * s;
    const g = W.groundAt(0, zF + 4 * s);
    const rise = altarTop - g;
    const steps = Math.max(6, Math.round(rise / 0.32));
    const run = (18 * s - 7 * s + 4 * s) / steps;
    flight(sink, M, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, g - 0.3, zF + 4 * s), 8 * s, steps, rise / steps, run, { walls: [-1, 1], arches: [] });
    // inscribed threshold under the crown + four lanterns at the altar's corners
    sink.box(M.spine, 0, altarTop + 0.35, zA + 2 * s, 9 * s, 0.7, 7 * s, 0, 1);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = ox * 10 * s, lz = zA + oz * 8 * s;
      sink.box(M.stone, lx, altarTop + 2, lz, 1.2, 4, 1.2, 0, 0.85);
      sink.box(M.lamp, lx, altarTop + 4.7, lz, 1.2, 1.3, 1.2, 0, 1);
      sink.box(M.stone, lx, altarTop + 5.6, lz, 1.9, 0.5, 1.9, 0, 0.8);
    }
    anchors.altar = { zFront: zF + 4 * s + steps * run * 0 + 2, top: altarTop, z: zA };
  }
  // the head: crown resting on the altar, tipped toward the lake
  const tilt = 0.5;
  const dir = new THREE.Vector3(0, -Math.cos(tilt), Math.sin(tilt));
  const crown = new THREE.Vector3(0, altarTop + 0.6, zA + 1 * s);
  const P1 = crown.clone().addScaledVector(dir, -H.len);
  const headM = new THREE.Matrix4().makeTranslation(P1.x, P1.y, P1.z).multiply(new THREE.Matrix4().makeRotationX(Math.PI - tilt));
  sink.geo(W.dark ? M.headDark : M.head, H.shell, headM, W.dark ? 1 : 1.3);
  sink.geo(M.lamp, H.slit, headM, SLIT_TINT);
  H.shell.dispose();
  H.slit.dispose();
  // a short neck of drums from the end of the shoulders down to the head
  const P0 = new THREE.Vector3(0, e.y - Math.sin(e.th) * e.hd * 0.1, e.z + Math.cos(e.th) * e.hd * 0.1);
  const d = new THREE.Vector3().subVectors(P1, P0);
  const L = d.length();
  d.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const nV = Math.max(2, Math.round(L / 5));
  const drum = new THREE.CylinderGeometry(1, 0.96, 3.6, 24);
  const seam = new THREE.CylinderGeometry(0.74, 0.74, 0.6, 20);
  for (let k = 0; k < nV; k++) {
    const t = (k + 0.5) / nV;
    const r = (12.5 - k * 0.5) * s;
    sink.geo(M.stone, drum, new THREE.Matrix4().compose(P0.clone().addScaledVector(d, t * L), q, new THREE.Vector3(r, 1, r)), 0.93);
    if (k < nV - 1) sink.geo(M.lamp, seam, new THREE.Matrix4().compose(P0.clone().addScaledVector(d, (t + 0.5 / nV) * L), q, new THREE.Vector3(r, 1, r)), 1);
  }
  drum.dispose();
  seam.dispose();
  const core = new THREE.CylinderGeometry(5.5 * s, 5.5 * s, L, 10);
  sink.geo(M.basalt, core, new THREE.Matrix4().compose(P0.clone().addScaledVector(d, L * 0.5), q, new THREE.Vector3(1, 1, 1)), 0.8);
  core.dispose();
  const c = new THREE.Vector3(0, H.len * 0.5, 0).applyMatrix4(headM);
  anchors.head = { x: c.x, y: c.y, z: c.z, len: H.len };
  anchors.crown = { x: crown.x, y: crown.y, z: crown.z };
}

// ---------------------------------------------------------------------------

function buildHand(sink, M, W, side, o) {
  const { Y: Y0, s, rng, anchors } = o;
  let base = o.base;
  const Y = (r) => base + r * s;
  // 'front': hands laid together before the knees; 'sides': flat on the ground beside the knees
  const wide = W.arms === 'wide';
  const prone = W.pose === 'prostrate';
  const sides = W.arms === 'sides';
  // 'thighs': the hands rest on the knees — the hand terraces are raised on top of the thighs
  const thighs = W.arms === 'thighs';
  const hcx = side * (thighs ? 18 : prone ? 46 : sides ? 47 : wide ? 40 : 14.5) * s;
  const hcz = (thighs ? 24 : prone ? 118 : sides ? 40 : wide ? 92 : 100) * s;
  const yaw = thighs ? side * 0.06 : prone ? side * 0.08 : sides ? side * 0.12 : wide ? side * 0.1 : -side * 0.1;
  const gMin = thighs ? Y(42) : W.groundMin(hcx, hcz, 24 * s);
  if (thighs) base = Y(44.5); // the hand's own "ground" is the thigh top
  // fingers of a hand on the knee hang a little over the knee's front edge
  const floorAt = (x, z, r) => (thighs ? base - 9 * s : W.groundMin(x, z, r));
  const palm = [];
  const PALM = [[-6, 12.5, 15.5], [0, 13, 16], [5, 12.5, 15.5], [9, 10.8, 13.5], [12, 7.8, 10.5]];
  for (const [y0, y1] of courseList(gMin - 2, Y(11))) {
    const r = ((y0 + y1) / 2 - base) / s;
    const [hx, hz] = keyed(PALM, r);
    palm.push({ y0, y1, cx: hcx, cz: hcz, hx: hx * s, hz: hz * s, e: 4.2, yaw, tint: rng.range(0.9, 1.04) });
  }
  stack(sink, M.stone, palm, { N: 28, groundY: base, loft: true });
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const toL = (ux, uz) => [hcx + ux * cy + uz * sy, hcz - ux * sy + uz * cy];
  const fingers = [
    { u: -8.7, len: 11.5 }, { u: -3.0, len: 13.2 }, { u: 2.8, len: 12.8 }, { u: 8.5, len: 10.6 },
  ];
  for (const f of fingers) {
    const u = f.u * s * -side;
    const [fx, fz] = toL(u, (14.5 + f.len) * s);
    const courses = [];
    for (const [y0, y1] of courseList(floorAt(fx, fz, 13 * s) - 2, Y(6.5))) {
      const r = ((y0 + y1) / 2 - base) / s;
      const shrink = smooth(1, 6.5, r);
      courses.push({ y0, y1, cx: fx, cz: fz, hx: (2.7 - shrink * 0.7) * s, hz: (f.len - shrink * 1.8) * s, e: 2.3, yaw: yaw + side * f.u * -0.004, tint: rng.range(0.88, 1.02) });
    }
    stack(sink, M.stone, courses, { N: 16, groundY: base });
  }
  // thumb, turned inward toward the other hand
  {
    const [fx, fz] = toL(-side * 12.5 * s, 8 * s);
    const courses = [];
    for (const [y0, y1] of courseList(floorAt(fx, fz, 10 * s) - 2, Y(7.5))) {
      const r = ((y0 + y1) / 2 - base) / s;
      const shrink = smooth(1, 7.5, r);
      courses.push({ y0, y1, cx: fx, cz: fz, hx: (3.1 - shrink) * s, hz: (9.5 - shrink * 1.8) * s, e: 2.3, yaw: yaw - side * 1.05, tint: rng.range(0.88, 1.02) });
    }
    stack(sink, M.stone, courses, { N: 16, groundY: base });
  }
  const topY = palm[palm.length - 1].y1;
  // stair up the outer flank of the palm onto the hand terrace
  if (!thighs) {
    const [sx, sz] = toL(side * 14.3 * s, 5 * s);
    const g = W.groundAt(sx, sz + 8 * s);
    const rise = topY - g;
    const steps = Math.max(4, Math.round(rise / 0.32));
    const m = new THREE.Matrix4().makeRotationY(yaw + Math.PI).setPosition(sx + side * 1.7 * s * cy, g - 0.2, sz + 8 * s);
    flight(sink, M, m, 3.4 * s, steps, rise / steps, 0.42, { walls: [-side] });
  }
  anchors.plant.push({ x: hcx, y: topY, z: hcz - 2 * s, rx: 6 * s, rz: 7 * s, n: 2, kind: 'shrub' });
  // a lantern post on the hand terrace: a warm point at each warden's feet, seen from the lake
  {
    const [lx, lz] = toL(side * 4 * s, 6 * s);
    sink.box(M.basalt, lx, topY + 0.5, lz, 2.4, 1, 2.4, yaw, 0.8);
    sink.box(M.stone, lx, topY + 3.5, lz, 1.1, 5, 1.1, yaw, 0.85);
    sink.box(M.lamp, lx, topY + 6.6, lz, 1.2, 1.3, 1.2, yaw, 1);
    sink.box(M.stone, lx, topY + 7.5, lz, 1.8, 0.5, 1.8, yaw, 0.8);
  }
  if (side > 0) anchors.handTop = { x: hcx, y: topY, z: hcz };
  anchors.thumbY = Y(7.5);
  anchors.fingerZ = hcz + 28 * s;
  const [wx, wz] = toL(side * 1.5 * s, -4 * s);
  return { wx, wz, wy: Y(9), topY };
}

// ---------------------------------------------------------------------------

function buildNeckHead(sink, M, W, anchors) {
  const s = W.s;
  const rng = W.rng;
  const cyl = (r0, r1, h, seg) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, false);
    g.translate(0, h / 2, 0);
    return g;
  };
  // the neck leaves the oblique end of the shoulders (a little toward the chest), first along
  // the spine, then curls forward and down so the head hangs below the shoulder line
  const e = W.body.end;
  const start = new THREE.Vector3(0, e.y - Math.sin(e.th) * e.hd * 0.3, e.z + Math.cos(e.th) * e.hd * 0.3);
  const a0 = e.th + (W.neckA ?? 0.2);
  const a1 = W.bow;
  const L = 17 * s;
  const F = { pos: new THREE.Vector3(), th: 0 };
  const frame = (u) => {
    // integrate the curling path: tangent angle from vertical goes a0 -> a1
    const n = 12;
    let y = start.y, z = start.z;
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * u;
      const th = a0 + (a1 - a0) * (t / L);
      y += Math.cos(th) * (u / n);
      z += Math.sin(th) * (u / n);
    }
    F.pos.set(0, y, z);
    F.th = a0 + (a1 - a0) * (u / L);
    return F;
  };
  const matAt = (u, dy = 0) => {
    frame(u);
    return new THREE.Matrix4().makeTranslation(F.pos.x, F.pos.y, F.pos.z).multiply(new THREE.Matrix4().makeRotationX(F.th)).multiply(new THREE.Matrix4().makeTranslation(0, dy, 0));
  };
  // root collar sunk into the shoulders
  sink.geo(M.stone, cyl(13 * s, 11 * s, 5, 28), matAt(0, -4), 0.86);
  if (W.neck === 'colonnade') {
    // an open drum: piers around a core, a spiral stair visible between them, a lamp inside
    sink.push(matAt(L * 0.5, -L * 0.5));
    sink.geo(M.stone, cyl(12 * s, 12 * s, 2.2, 28), null, 0.9);
    sink.geo(M.basalt, cyl(3.8 * s, 3.8 * s, L, 12), null, 0.9);
    const nP = 10;
    for (let k = 0; k < nP; k++) {
      const a = (k / nP) * TAU + 0.3;
      sink.box(M.stone, Math.sin(a) * 9.4 * s, L / 2 + 1, Math.cos(a) * 9.4 * s, 2.1 * s, L - 2, 2.1 * s, a, rng.range(0.85, 1));
    }
    const nS = 30;
    for (let k = 0; k < nS; k++) {
      const a = (k / nS) * TAU * 1.25;
      sink.box(M.basalt, Math.sin(a) * 6.2 * s, 2.6 + (k / nS) * (L - 4), Math.cos(a) * 6.2 * s, 1.5 * s, 0.45, 4.2 * s, a, 0.8);
    }
    sink.box(M.lamp, 0, L * 0.6, 5 * s, 1.1, 1.7, 1.1, 0, 1);
    sink.box(M.lamp, 0, L * 0.35, -5 * s, 1.0, 1.4, 1.0, 0, 1);
    sink.geo(M.stone, cyl(11.5 * s, 12.5 * s, 2.4, 28), new THREE.Matrix4().makeTranslation(0, L - 1, 0), 0.88);
    sink.pop();
  } else if (W.neck === 'collar') {
    sink.push(matAt(L * 0.5, -L * 0.5));
    sink.geo(M.stone, cyl(10.5 * s, 9 * s, L, 20), null, 0.95);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const lit = k % 4 === 1;
      archOpening(sink, lit ? M.lamp : M.basalt, Math.sin(a) * (9.9 * s + 0.08), L * 0.35, Math.cos(a) * (9.9 * s + 0.08), a, 1.8, 3.2, lit ? 1 : 0.08);
    }
    sink.geo(M.stone, cyl(11 * s, 12 * s, 2.4, 24), new THREE.Matrix4().makeTranslation(0, L - 1, 0), 0.88);
    sink.pop();
  } else {
    // vertebrae: drums strung on a dark core, glowing seams between them
    const nV = 4;
    for (let k = 0; k < nV; k++) {
      const u = (k + 0.5) * (L / nV);
      const r = (10.5 - k * 0.6) * s;
      sink.geo(M.stone, cyl(r, r * 0.97, 3.1, 24), matAt(u, -1.55), 0.93);
      sink.geo(M.basalt, cyl(4.4 * s, 4.4 * s, L / nV, 10), matAt(u, -L / nV / 2), 0.8);
      if (k < nV - 1) sink.geo(M.lamp, cyl(r * 0.72, r * 0.72, 0.5, 20), matAt(u + L / nV / 2, -0.25), 1);
    }
  }

  // the head: two smooth halves split by a narrow inscribed slit, hanging low
  frame(L);
  const headM = new THREE.Matrix4().makeTranslation(F.pos.x, F.pos.y, F.pos.z).multiply(new THREE.Matrix4().makeRotationX(a1)).multiply(new THREE.Matrix4().makeTranslation(0, -2, 0));
  const H = headShape(W.head, s);
  sink.geo(W.dark ? M.headDark : M.head, H.shell, headM, W.dark ? 1 : 1.3);
  sink.geo(M.lamp, H.slit, headM, SLIT_TINT);
  H.shell.dispose();
  H.slit.dispose();
  _v.set(0, H.len * 0.5, 0).applyMatrix4(headM);
  anchors.head = { x: _v.x, y: _v.y, z: _v.z, len: H.len };
  _v.set(0, H.len, 0).applyMatrix4(headM);
  anchors.crown = { x: _v.x, y: _v.y, z: _v.z };
}

/**
 * Faceless heads: a smooth lathe body split down its sagittal plane into two halves with a
 * narrow slit between them (inscribed walls that glow at night). Types vary the silhouette.
 */
export function headShape(type, s) {
  let len = 39, R = 13, prof, seg = 20, kx = 0.86, gap = 1.8;
  if (type === 'spindle') {
    len = 44; R = 11.5; kx = 0.92;
    prof = [[0.34, 0], [0.62, 0.1], [0.9, 0.3], [1, 0.48], [0.9, 0.66], [0.62, 0.83], [0.3, 0.95], [0.02, 1]];
  } else if (type === 'facet') {
    len = 42; R = 14.5; seg = 5; kx = 0.9; gap = 2.0;
    prof = [[0.36, 0], [0.7, 0.12], [0.95, 0.32], [1, 0.52], [0.92, 0.74], [0.64, 0.92], [0.04, 1]];
  } else if (type === 'lens') {
    len = 40; R = 16; kx = 0.5; gap = 1.6;
    prof = [[0.3, 0], [0.6, 0.1], [0.88, 0.28], [1, 0.5], [0.9, 0.72], [0.6, 0.9], [0.03, 1]];
  } else {
    prof = [[0.36, 0], [0.64, 0.11], [0.9, 0.3], [1, 0.5], [0.96, 0.68], [0.8, 0.84], [0.5, 0.95], [0.03, 1]];
  }
  len *= s;
  R *= s;
  gap *= s;
  const nP = 22;
  const keys = prof.map(([r, t]) => [t, r]);
  const pts = [];
  for (let i = 0; i <= nP; i++) {
    const t = i / nP;
    const [r] = keyed(keys, t);
    pts.push(new THREE.Vector2(Math.max(0.02, r * R), t * len));
  }
  const halves = [];
  for (const side of [1, -1]) {
    const g = new THREE.LatheGeometry(pts, seg, side > 0 ? 0 : Math.PI, Math.PI);
    g.scale(kx, 1, 1);
    g.translate((side * gap) / 2, 0, 0);
    g.computeVertexNormals();
    halves.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
    // base cap (the neck end), facing -y
    const cap = [];
    const r0 = pts[0].x;
    for (let k = 0; k < seg; k++) {
      const p0 = (side > 0 ? 0 : Math.PI) + (k / seg) * Math.PI;
      const p1 = (side > 0 ? 0 : Math.PI) + ((k + 1) / seg) * Math.PI;
      const cx = (side * gap) / 2;
      cap.push(cx, 0, 0, Math.sin(p1) * r0 * kx + cx, 0, Math.cos(p1) * r0, Math.sin(p0) * r0 * kx + cx, 0, Math.cos(p0) * r0);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
    cg.computeVertexNormals();
    halves.push(cg);
  }
  // Raised lips run along both edges of the slit, over the crown and down the back of the head:
  // a seam that breaks the egg silhouette and reads as made, not grown.
  {
    const lipPos = [];
    const lip = 0.09 * R + 0.3 * s;
    const w = 0.06 * R + 0.5 * s;
    const quad = (a, b, c, d, nx, ny, nz) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * nx + cy * ny + cz * nz >= 0) lipPos.push(...a, ...b, ...c, ...a, ...c, ...d);
      else lipPos.push(...a, ...d, ...c, ...a, ...c, ...b);
    };
    for (let i = 0; i < nP; i++) {
      const r0 = pts[i].x, y0 = pts[i].y, r1 = pts[i + 1].x, y1 = pts[i + 1].y;
      if (r0 < 0.12 * R && r1 < 0.12 * R) continue;
      const l0 = lip * Math.min(1, r0 / (0.35 * R)), l1 = lip * Math.min(1, r1 / (0.35 * R));
      for (const sx of [1, -1]) {
        const xi = (sx * gap) / 2, xo = sx * (gap / 2 + w);
        for (const sz of [1, -1]) {
          quad([xi, y0, sz * r0], [xi, y1, sz * r1], [xi, y1, sz * (r1 + l1)], [xi, y0, sz * (r0 + l0)], -sx, 0, 0);
          quad([xi, y0, sz * (r0 + l0)], [xi, y1, sz * (r1 + l1)], [xo, y1, sz * (r1 + l1)], [xo, y0, sz * (r0 + l0)], 0, 0, sz);
          quad([xo, y0, sz * (r0 + l0)], [xo, y1, sz * (r1 + l1)], [xo, y1, sz * r1 * 0.9], [xo, y0, sz * r0 * 0.9], sx, 0, 0);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lipPos, 3));
    lg.computeVertexNormals();
    halves.push(lg);
  }
  const shell = mergeNonIndexed(halves);
  // flat cut faces facing each other across the slit
  const slitPos = [];
  const pushQ = (a, b, c, d) => slitPos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < nP; i++) {
    const r0 = pts[i].x, y0 = pts[i].y, r1 = pts[i + 1].x, y1 = pts[i + 1].y;
    for (const side of [1, -1]) {
      const x = (side * gap) / 2;
      const a = [x, y0, -r0], b = [x, y0, r0], c = [x, y1, r1], d = [x, y1, -r1];
      if (side > 0) pushQ(a, b, c, d);
      else pushQ(a, d, c, b);
    }
  }
  const slit = new THREE.BufferGeometry();
  slit.setAttribute('position', new THREE.Float32BufferAttribute(slitPos, 3));
  slit.computeVertexNormals();
  return { shell, slit, len, R, kx };
}

function mergeNonIndexed(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const p = new Float32Array(n * 3);
  const nn = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    p.set(g.attributes.position.array, o);
    nn.set(g.attributes.normal.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  return out;
}

// ---------------------------------------------------------------------------
// details

/** Solid straight flight rising along +z, width across x, base at y=0 (ExtrudeGeometry, flat normals). */
export function stairGeo(width, steps, rise, run) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    shape.lineTo(i * run, (i + 1) * rise);
    shape.lineTo((i + 1) * run, (i + 1) * rise);
  }
  shape.lineTo(steps * run, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * A flight built like masonry, not a black wedge: coursed stone body (the solid stair), coping
 * parapets and a row of blind relieving arches along each exposed flank. Local frame of `m`:
 * foot at the origin, rising along +z, width across x. opts: { walls: [-1, 1], arches: [-1, 1] }
 */
export function flight(sink, M, m, width, steps, rise, run, opts = {}) {
  const geo = stairGeo(width, steps, rise, run);
  sink.push(m);
  sink.geo(M.stone, geo, null, 0.8);
  geo.dispose();
  const L = steps * run, H = steps * rise;
  const slope = Math.atan2(H, L);
  const hyp = Math.hypot(L, H);
  for (const sx of opts.walls ?? [-1, 1]) {
    sink.box(M.stone, sx * (width / 2 - 0.35), H / 2 + 0.75, L / 2, 0.7, 1.5, hyp, 0, 0.72, -slope, 0, false);
  }
  for (const sx of opts.arches ?? []) {
    const pitch = 8.5;
    for (let z = pitch * 0.7; z < L - pitch * 0.5; z += pitch) {
      const hh = (z / L) * H; // flank height here
      if (hh < 7) continue;
      const w = pitch * 0.55;
      archOpening(sink, M.basalt, sx * (width / 2 + 0.05), 0.2, z, sx * HALF_PI, w, Math.min(hh * 0.62, w * 2.4), 0.06);
    }
  }
  sink.pop();
}

function legStair(sink, M, W, side, cxL, yaw, s, base) {
  // flight from the ground near the knee up the outer flank to the thigh top near the hip
  const zStart = 50 * s;
  const x = cxL + side * (14.6 * s + 2.2 * s) + (zStart - 14 * s) * Math.sin(yaw);
  const g = W.groundAt(x, zStart);
  const rise = base + 34 * s - g;
  const steps = Math.round(rise / 0.33);
  const run = (46 * s) / steps;
  const m = new THREE.Matrix4().makeRotationY(Math.PI + yaw).setPosition(x, g - 0.3, zStart);
  // the stair runs toward -z (rotated PI): the flank away from the leg is local -x... +x after the turn
  flight(sink, M, m, 4 * s, steps, rise / steps, run, { walls: [side], arches: [side] });
  const zTop = zStart - 46 * s;
  const xTop = x - 46 * s * Math.sin(yaw);
  sink.box(M.basalt, xTop, base + 34 * s - 0.6, zTop - 3 * s, 4.8 * s, 1.2, 7 * s, yaw, 0.9);
  archOpening(sink, M.basalt, xTop - side * 2.5 * s, base + 34 * s, zTop - 3 * s, side > 0 ? -HALF_PI : HALF_PI, 2.4 * s, 3.4, 0.08);
}

function backPortal(sink, M, W, o) {
  const { Y, s } = o;
  const sl = W.body.slice(Y(26));
  const zBack = sl.cz - sl.hz;
  // central stair between the feet up to the portal
  const zFoot = -82 * s;
  const g = W.groundAt(0, zFoot);
  const rise = Y(18) - g;
  const steps = Math.round(rise / 0.32);
  const run = (zBack - 6 * s - zFoot) / steps;
  flight(sink, M, new THREE.Matrix4().makeTranslation(0, g - 0.3, zFoot), 8 * s, steps, rise / steps, run, { walls: [-1, 1], arches: [-1, 1] });
  sink.box(M.basalt, 0, Y(18) - 0.8, zBack - 3 * s, 14 * s, 1.6, 9 * s, 0, 0.9);
  // portal: tall arch frame proud of the back wall + dark opening
  const w = 8 * s;
  const h = 14 * s;
  archOpening(sink, M.basalt, 0, Y(18), zBack - 0.4, Math.PI, w, h, 0.05);
  const ring = new THREE.Shape();
  const R0 = w / 2 + 2 * s, R1 = w / 2;
  ring.moveTo(-R0, 0);
  ring.lineTo(-R0, h - w / 2);
  ring.absarc(0, h - w / 2, R0, Math.PI, 0, true);
  ring.lineTo(R0, 0);
  ring.lineTo(R1, 0);
  ring.lineTo(R1, h - w / 2);
  ring.absarc(0, h - w / 2, R1, 0, Math.PI, false);
  ring.lineTo(-R1, 0);
  ring.closePath();
  const fr = new THREE.ExtrudeGeometry(ring, { depth: 2.4, bevelEnabled: false, curveSegments: 14 });
  sink.geo(M.stone, fr, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, Y(18), zBack + 0.6), 0.85);
  fr.dispose();
  for (const sx of [-1, 1]) {
    sink.box(M.stone, sx * (w / 2 + 4 * s), Y(18) + 1.5, zBack - 4 * s, 1.6, 3, 1.6, 0, 0.8);
    sink.box(M.lamp, sx * (w / 2 + 4 * s), Y(18) + 3.6, zBack - 4 * s, 1.1, 1.3, 1.1, 0, 1);
  }
}

/** Dark (or lit) arched opening facing yaw, bottom-centre at (x, y, z). `square` = no arch. */
let _archGeo = null;
let _rectGeo = null;
const _m4 = new THREE.Matrix4();
const _s3 = new THREE.Vector3();
export function archOpening(sink, mat, x, y, z, yaw, w, h, tint = 0.1, square = false, pitch = 0) {
  if (!_archGeo) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0);
    sh.lineTo(0.5, 0);
    sh.lineTo(0.5, 0.62);
    sh.absarc(0, 0.62, 0.5, 0, Math.PI, false);
    sh.lineTo(-0.5, 0);
    _archGeo = new THREE.ShapeGeometry(sh, 6);
    _archGeo.scale(1, 1 / 1.12, 1);
    _rectGeo = new THREE.PlaneGeometry(1, 1);
    _rectGeo.translate(0, 0.5, 0);
  }
  _m4.makeRotationY(yaw);
  if (pitch) _m4.multiply(_rx.makeRotationX(pitch));
  _m4.scale(_s3.set(w, h, 1));
  _m4.setPosition(x, y, z);
  sink.geo(mat, square ? _rectGeo : _archGeo, _m4, tint);
}
const _rx = new THREE.Matrix4();

/**
 * Lean of a lofted wall at angle a between course c and the next course: returns the pitch
 * (radians, + = top leans outward) so flat details can lie on battered walls.
 */
const _wq = { x: 0, z: 0 };
function wallPitch(c, cn, a, cutIndex = -1) {
  if (!cn || c.loft === false || cn.loft === false || Math.abs(cn.y0 - c.y1) > 1e-3) return 0;
  if (cutIndex >= 0 && Math.abs((c.cut?.[cutIndex] || 0) - (cn.cut?.[cutIndex] || 0)) > 1e-3) return 0;
  footPoint(c, a, _pt);
  footNormal(c, a, _nr);
  footPoint(cn, a, _wq);
  const dn = (_wq.x - _pt.x) * _nr.x + (_wq.z - _pt.z) * _nr.z;
  return Math.atan2(dn, c.y1 - c.y0);
}

/** Windows centred in recessed panels (cut columns) on alternate courses. */
function panelWindows(sink, M, courses, res, rng, opts) {
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (c.band || c.isLoggia || c.isChestLoggia) continue;
    if (c.y0 < opts.yMin || c.y1 > opts.yMax) continue;
    if ((Math.round(c.y0 / CH) + opts.rowPhase) % opts.rowEvery !== 0) continue;
    const rowType = rng();
    for (const j of opts.panels) {
      const depth = c.cut[j];
      if (!(depth > 0)) continue;
      if (rng() < 0.14) continue;
      const C = res.cuts[j];
      const pitch = wallPitch(c, courses[i + 1], C.c, j);
      footPoint(c, C.c, _pt);
      footNormal(c, C.c, _nr);
      const yaw = Math.atan2(_nr.x, _nr.z);
      const w = (C.a1 - C.a0) * (c.hx + c.hz) * 0.5;
      // start on the recessed wall; the sill height shifts the base along the wall's lean
      const lift = Math.tan(pitch);
      const base = (y0) => [_pt.x - _nr.x * (depth - 0.06 - lift * y0), _pt.z - _nr.z * (depth - 0.06 - lift * y0)];
      const lit = rng() < opts.lampP;
      const mat = lit ? M.lamp : M.basalt;
      const tint = lit ? rng.range(0.6, 1.1) : 0.07;
      if (rowType < 0.4) {
        const [ox, oz] = base(0.4);
        archOpening(sink, mat, ox, c.y0 + 0.4, oz, yaw, Math.min(1.3, w * 0.3), 2.2, tint, false, pitch);
      } else if (rowType < 0.75) {
        // paired slits
        const [ox, oz] = base(0.45);
        const tx = Math.cos(yaw), tz = -Math.sin(yaw);
        for (const u of [-0.9, 0.9]) archOpening(sink, mat, ox + tx * u, c.y0 + 0.45, oz + tz * u, yaw, 0.75, 2.1, tint, false, pitch);
      } else {
        const [ox, oz] = base(0.5);
        archOpening(sink, mat, ox, c.y0 + 0.5, oz, yaw, Math.min(2.4, w * 0.45), 1.9, tint, true, pitch);
      }
    }
  }
}

function balcony(sink, M, c, C, depthIn, s, rng, lampP) {
  footPoint(c, C.c, _pt);
  footNormal(c, C.c, _nr);
  const yaw = Math.atan2(_nr.x, _nr.z);
  const w = Math.min(7, (C.a1 - C.a0) * (c.hx + c.hz) * 0.5 - 0.6);
  const d = rng.range(2.4, 3.4) + depthIn;
  const y = c.y0;
  const bx = _pt.x - _nr.x * depthIn, bz = _pt.z - _nr.z * depthIn;
  sink.box(M.stone, bx + _nr.x * (d / 2), y - 0.35, bz + _nr.z * (d / 2), w, 0.7, d, yaw, 0.9, 0, 0, false);
  sink.box(M.stone, bx + _nr.x * (d - 0.2), y + 0.6, bz + _nr.z * (d - 0.2), w, 1.2, 0.35, yaw, 0.88);
  for (const u of [-w / 2 + 0.6, w / 2 - 0.6]) {
    const ux = Math.cos(yaw) * u, uz = -Math.sin(yaw) * u;
    sink.box(M.stone, bx + _nr.x * (depthIn + 0.9) + ux, y - 1.5, bz + _nr.z * (depthIn + 0.9) + uz, 0.6, 1.6, 1.8, yaw, 0.85, 0.5);
  }
  const lit = rng() < lampP * 3;
  archOpening(sink, lit ? M.lamp : M.basalt, bx + _nr.x * 0.06, y, bz + _nr.z * 0.06, yaw, 1.8, 2.6, lit ? 1 : 0.07);
}
