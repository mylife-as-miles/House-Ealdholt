// The Long Conduit — a ruined three-tier aqueduct that emerges from the northern escarpment and
// strides ~2.7 km south across the western hills, skirting the Choir plain, to vanish into the
// flank of the Orrery crater.
//
// Construction logic (like a real aqueduct): the channel (specus) runs at a fixed level that steps
// down gently every few bays, so every tier line is horizontal in absolute height; only the piers
// stretch down to find the ground. Where the land dips, a third (bottom) tier appears. Tiers:
//   bottom  round arches, deep piers with cutwaters and basalt footings (only where needed)
//   middle  tall pointed lancets with dark voussoir archivolts and pilaster strips
//   top     a small triple arcade under the deck
//   channel walls with a continuous inscribed glyph frieze (a thin amber thread across the land
//           at night), cover slabs, many missing
// The rule it breaks: every dozen bays a tower-pier ("castellum") carries a colossal inscribed
// stone wheel standing across the channel — a mechanism with no conceivable hydraulic purpose.
// Three stretches have collapsed: broken pier stubs, arch springers, rubble, fallen arch rings.

import * as THREE from 'crownfall-world-three';
import { mat, sub, tp, archPoints, voussoirs, arcadeGeometry, rubble, glyphRow, fracturedSlab } from './ruins-parts.js';
import { doorFrame } from './ruins-sites.js';

// Route control points [x, z], north (escarpment) -> south (Orrery crater flank).
const ROUTE = [
  [-2372, -1336], [-2330, -1262], [-2180, -1060], [-1980, -880], [-1720, -760], [-1420, -640],
  [-1200, -420], [-1140, -150], [-1150, 150], [-1260, 430], [-1420, 680], [-1470, 760],
];

const BAY = 25; // pier spacing (m)
// Deck levels are multiples of 3.6 m so the channel frieze always sits on a glyph row.
const DECK0 = 111.6; // channel floor at the north end
const STEP = 3.6; // drop per step
const STEP_BAYS = 26;

// Collapsed stretches (bay index ranges, inclusive) and towers (pier indices).
const GAPS = [[21, 23], [47, 49], [75, 76]];
const TOWERS = [9, 34, 60, 88];

export function buildAqueduct(ctx, b, M, rng) {
  const { heightAt } = ctx;
  const curve = new THREE.CatmullRomCurve3(ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = curve.getLength();
  const deckOf = (bay) => DECK0 - STEP * Math.floor(Math.max(0, bay) / STEP_BAYS);
  const at = (s) => {
    const p = curve.getPointAt(Math.min(1, Math.max(0, s / L)));
    return { x: p.x, z: p.z, g: heightAt(p.x, p.z) };
  };
  // Tunnel mouths: where the land rises above the channel at either end.
  let sN = 0;
  while (sN < L * 0.3 && at(sN).g > deckOf(0) + 3) sN += 2;
  const dEnd = deckOf(Math.floor((L - sN) / BAY));
  let sS = L;
  while (sS > L * 0.7 && at(sS).g > dEnd + 3) sS -= 2;
  const s0 = sN + 9;
  const nBays = Math.max(1, Math.floor((sS - 9 - s0) / BAY));
  const spacing = (sS - 9 - s0) / nBays;
  const piers = [];
  for (let i = 0; i <= nBays; i++) piers.push({ ...at(s0 + i * spacing), i });
  const yawOf = (ax, az, bx, bz) => Math.atan2(-(bz - az), bx - ax);
  for (let i = 0; i <= nBays; i++) {
    const a = piers[Math.max(0, i - 1)];
    const c = piers[Math.min(nBays, i + 1)];
    piers[i].yaw = yawOf(a.x, a.z, c.x, c.z);
  }
  const inGap = (bay) => GAPS.some(([a, c]) => bay >= a && bay <= c);
  const info = { bays: 0, piers, towers: [], length: sS - sN };
  // damage per bay: 0 intact, 1 channel partly broken, 2 upper arcade + channel gone
  const drng = ctx.noise.createRng('ruins:aqueduct:damage');
  const dmgOf = [];
  for (let i = 0; i < nBays; i++) {
    const u = drng();
    dmgOf.push(TOWERS.includes(i) || TOWERS.includes(i + 1) ? (u < 0.15 ? 1 : 0) : u < 0.1 ? 2 : u < 0.28 ? 1 : 0);
  }
  const topGone = (bay) => bay < 0 || bay >= nBays || inGap(bay) || dmgOf[bay] === 2;

  for (let i = 0; i < nBays; i++) {
    const p0 = piers[i];
    const p1 = piers[i + 1];
    const D = deckOf(i);
    const gm = Math.min(p0.g, p1.g, heightAt((p0.x + p1.x) / 2, (p0.z + p1.z) / 2));
    const W = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const yaw = yawOf(p0.x, p0.z, p1.x, p1.z);
    const frame = mat((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2, yaw);
    if (inGap(i)) {
      gapBay(ctx, b, M, rng, frame, W, D, gm, i, p0, p1, yaw);
      continue;
    }
    info.bays++;
    bay(ctx, b, M, rng, frame, W, D, gm, i, p0, p1, dmgOf[i]);
  }

  // piers (drawn per pier so pilasters/cutwaters/footings line up across bays)
  for (let i = 0; i <= nBays; i++) {
    const p = piers[i];
    const leftGone = i === 0 || inGap(i - 1);
    const rightGone = i === nBays || inGap(i);
    const D = deckOf(Math.min(i, nBays - 1));
    const broken = inGap(i - 1) && inGap(i);
    const tower = TOWERS.includes(i) && !broken;
    const gapSide = i > 0 && i < nBays ? (inGap(i - 1) && !inGap(i) ? -1 : inGap(i) && !inGap(i - 1) ? 1 : 0) : 0;
    pier(ctx, b, M, rng, p, D, { broken, tower, gapSide, end: leftGone && rightGone ? false : i === 0 || i === nBays, topL: !topGone(i - 1), topR: !topGone(i) });
    if (tower) info.towers.push(p);
  }

  info.gaps = GAPS.map(([a, c]) => {
    const p = piers[Math.min(nBays, Math.round((a + c + 1) / 2))];
    return [Math.round(p.x), Math.round(p.z)];
  });
  info.towerPos = TOWERS.map((t) => piers[Math.min(nBays, t)]).map((p) => [Math.round(p.x), Math.round(p.g), Math.round(p.z)]);
  b.setTint(1);
  // Tunnel mouths where the conduit enters the escarpment and the crater flank.
  const mN = at(sN);
  const mS = at(sS);
  info.mouths = [[Math.round(mN.x), Math.round(mN.g), Math.round(mN.z)], [Math.round(mS.x), Math.round(mS.g), Math.round(mS.z)]];
  portal(ctx, b, M, rng, mN, piers[0], deckOf(0), true);
  portal(ctx, b, M, rng, mS, piers[nBays], deckOf(nBays - 1));
  return info;
}

// ---------------------------------------------------------------------------

function levels(D) {
  return {
    D,
    topBase: D - 9.2, // triple arcade base
    midTop: D - 10.2, // middle tier cornice base
    M0: D - 31.4, // middle tier base
    midSpring: D - 31.4 + 7.2,
    botCrown: D - 31.4 - 2.8,
  };
}

const DEPTH = { bot: 8.4, mid: 6.6, top: 5.0 };
const PIERW = { bot: 8.0, mid: 6.2 };

/** Per-bay stone tone: repairs and quarries of different ages read as patches along the line. */
function toneOf(i) {
  const h = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  const f = h - Math.floor(h);
  const t = 0.84 + 0.2 * f;
  return f > 0.55 ? [t * 1.03, t, t * 0.95] : [t * 0.97, t, t * 1.02];
}

function bay(ctx, b, M, rng, frame, W, D, gm, i, p0, p1, dmg) {
  const Lv = levels(D);
  const Wq = Math.round(W * 4) / 4;
  b.setTint(toneOf(i));

  // ----- bottom tier -----
  const midSpan = Wq - PIERW.mid;
  const midRise = 12.6;
  if (gm < Lv.M0 - 6) {
    const span = Wq - PIERW.bot;
    const r = span / 2;
    const spring = Lv.botCrown - r;
    // wall bases are buried: quantise them so bays share cached arcade shapes
    let yb = Math.min(gm - 3, spring - 0.5);
    yb = 4 * Math.floor(yb / 4);
    const H = Lv.M0 - 1 - yb;
    b.setGround(gm, 7);
    b.geo(M.stone, arcadeGeometry(Wq, H, [{ cx: 0, span, spring: spring - yb, kind: 'round' }], DEPTH.bot), sub(frame, 0, yb, 0));
    // archivolt
    voussoirs(b, M.smooth, sub(frame, 0, spring, 0), archPoints('round', span - 0.5, r - 0.25, 15), { thick: 1.7, depth: DEPTH.bot + 0.5, gap: 0.1, rng, slip: 0.25, key: 1.25 });
    // bottom cornice
    b.setGround(gm, 4);
    b.box(M.stone, sub(frame, 0, Lv.M0 - 1, 0), Wq, 1.0, DEPTH.bot + 1.2);
  }
  // ----- middle tier -----
  if (gm < Lv.midTop - 2) {
    const yb = gm < Lv.M0 - 6 ? Lv.M0 : Math.min(Lv.M0, 4 * Math.floor((gm - 3) / 4));
    const H = Lv.midTop - yb;
    const spring = Lv.midSpring - yb;
    b.setGround(gm, 7);
    if (spring > 0.6) {
      b.geo(M.stone, arcadeGeometry(Wq, H, [{ cx: 0, span: midSpan, spring, rise: midRise, kind: 'pointed' }], DEPTH.mid), sub(frame, 0, yb, 0));
      const pts = archPoints('pointed', midSpan - 0.4, midRise - 0.2, 18);
      voussoirs(b, M.smooth, sub(frame, 0, Lv.midSpring, 0), pts, { thick: 1.4, depth: DEPTH.mid + 0.4, gap: 0.09, rng, slip: 0.2, key: 1.3 });
    } else {
      b.box(M.stone, sub(frame, 0, yb, 0), Wq, H, DEPTH.mid);
    }
    // cornice (with a slight drip overhang)
    b.box(M.stone, sub(frame, 0, Lv.midTop, 0), Wq + 0.02, 1.0, DEPTH.mid + 1.4, { taper: [1, 1.04] });
  }
  // ----- top triple arcade -----
  if (dmg === 2) {
    // the upper storeys fell: a ragged stump of the triple arcade on the cornice
    b.setGround(-1e9);
    // only the piers of the little arcade survive, each snapped at its own height
    const span = (Wq - 2 * 1.6 - 2 * 1.8) / 3;
    const xs = [-Wq / 2 + 0.8, -Wq / 2 + 1.6 + span + 0.9, Wq / 2 - 1.6 - span - 0.9, Wq / 2 - 0.8];
    const ws = [1.6, 1.8, 1.8, 1.6];
    for (let k = 0; k < 4; k++) {
      if (rng() < 0.2) continue;
      const h1 = 1.5 + rng() * 6;
      fracturedSlab(b, M.stone, sub(frame, xs[k], Lv.topBase, 0), ws[k], DEPTH.top, h1, h1 * (0.4 + rng() * 0.6), rng, { jag: 0.3, loose: false });
    }
    b.setTint(1);
    return;
  }
  {
    const n = 3;
    const pierEnd = 1.6;
    const pierIn = 1.8;
    const span = (Wq - 2 * pierEnd - (n - 1) * pierIn) / n;
    const ops = [];
    for (let k = 0; k < n; k++) ops.push({ cx: -Wq / 2 + pierEnd + span / 2 + k * (span + pierIn), span, spring: 4.2, kind: 'round' });
    if (gm >= Lv.midTop - 2) {
      // land is high here: the arcade sits on a plain wall down to the ground
      b.setGround(gm, 6);
      b.box(M.stone, sub(frame, 0, gm - 2.5, 0), Wq, Lv.topBase - gm + 2.5, DEPTH.top + 0.6);
    }
    b.setGround(gm, 6);
    b.geo(M.stone, arcadeGeometry(Wq, 8.0, ops, DEPTH.top), sub(frame, 0, Lv.topBase, 0));
    // deck slab
    b.box(M.stone, sub(frame, 0, D - 1.2, 0), Wq + 0.02, 1.2, DEPTH.top + 1.0);
  }
  // ----- channel -----
  if (dmg === 1) {
    const cut = -Wq / 2 + Wq * (0.2 + 0.5 * rng());
    const keepLeft = rng() < 0.5;
    channel(b, M, rng, frame, Wq, D, i, keepLeft ? [-Wq / 2, cut] : [cut, Wq / 2]);
    const rest = keepLeft ? [cut, Wq / 2] : [-Wq / 2, cut];
    const rw = rest[1] - rest[0];
    const hEdge = 2.4;
    const hFar = 0.3 + rng() * 0.6;
    fracturedSlab(b, M.stone, sub(frame, (rest[0] + rest[1]) / 2, D, 0), rw, 5.0, keepLeft ? hEdge : hFar, keepLeft ? hFar : hEdge, rng, { jag: 0.4 });
  } else {
    channel(b, M, rng, frame, Wq, D, i);
  }
  b.setTint(1);
}

function channel(b, M, rng, frame, W, D, i, cut = null) {
  // cut: [x0, x1] local range to keep (broken ends); default all
  const x0 = cut ? cut[0] : -W / 2;
  const x1 = cut ? cut[1] : W / 2;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cell = 1.2;
  const fy0 = glyphRow(D + 1.2, cell);
  const wallT = 0.9;
  const off = 2.5 - wallT / 2; // wall centre from axis (outer width 5.0)
  for (const s of [-1, 1]) {
    const z = s * off;
    b.box(M.stone, sub(frame, cx, D, z), w, fy0 - D, wallT);
    b.box(M.glyph, sub(frame, cx, fy0, z), w, cell, wallT + 0.08);
    b.box(M.smooth, sub(frame, cx, fy0 + cell, z), w, 0.45, wallT + 0.3);
  }
  // cover slabs (lintels across the channel), many lost or slipped
  const top = fy0 + cell + 0.45;
  const nS = Math.floor(w / 2.6);
  for (let k = 0; k < nS; k++) {
    if (rng() < 0.45) continue;
    const x = x0 + 1.3 + k * 2.6;
    const slip = rng() < 0.15;
    b.box(M.smooth, sub(frame, x + (slip ? (rng() - 0.5) * 0.8 : 0), top, (slip ? (rng() - 0.5) * 1.2 : 0), (rng() - 0.5) * 0.05, slip ? (rng() - 0.5) * 0.15 : 0, slip ? (rng() - 0.5) * 0.12 : 0), 2.3, 0.45, 5.4, { jit: 0.05 });
  }
}

function pier(ctx, b, M, rng, p, D, { broken, tower, gapSide, end, topL = true, topR = true }) {
  const Lv = levels(D);
  b.setTint(toneOf(p.i + 0.5));
  const g = p.g;
  const f = mat(p.x, 0, p.z, p.yaw);
  const hasBottom = g < Lv.M0 - 6;
  b.setGround(g, 7);
  // basalt footing: two stepped slabs half buried
  const fw = hasBottom ? PIERW.bot + 2.4 : PIERW.mid + 2.2;
  const fd = hasBottom ? DEPTH.bot + 5.5 : DEPTH.mid + 3.2;
  b.box(M.stone, sub(f, 0, g - 3.5, 0), fw, 4.3, fd, { taper: 0.94, jit: 0.15 }, 0.78);
  b.box(M.stone, sub(f, 0, g + 0.8, 0), fw - 1.4, 1.1, fd - 1.4, { taper: 0.96, jit: 0.1 }, 0.85);

  if (broken) {
    // a free-standing stub in a collapsed stretch
    const top = hasBottom ? Lv.M0 - rng() * 22 : Lv.midSpring - rng() * 12;
    const h = Math.max(4, top - g);
    const w = hasBottom ? PIERW.bot : PIERW.mid;
    const d = hasBottom ? DEPTH.bot : DEPTH.mid;
    fracturedSlab(b, M.stone, sub(f, 0, g - 1, 0), w, d, h * (0.6 + rng() * 0.5) + 1, h * (0.6 + rng() * 0.5) + 1, rng, { jag: 1.5 });
    if (hasBottom) cutwaters(b, M, f, g, Math.min(Lv.M0 - 4, g + h * 0.6));
    return;
  }

  if (hasBottom) {
    // pier mass through the bottom tier (proud of the arcade face), cutwaters both faces
    const botSpring = Lv.botCrown - (BAY - PIERW.bot) / 2;
    if (botSpring - g > 1.5) {
      b.box(M.stone, sub(f, 0, g - 1, 0), PIERW.bot + 0.5, botSpring - 0.9 - (g - 1), DEPTH.bot + 0.6);
      b.box(M.smooth, sub(f, 0, botSpring - 0.9, 0), PIERW.bot + 1.2, 0.9, DEPTH.bot + 1.0); // impost
    }
    cutwaters(b, M, f, g, Lv.M0 - 4);
  }
  // pilaster strip through the middle tier + impost at the lancet springing
  const mb = hasBottom ? Lv.M0 : g - 2;
  b.setGround(g, 7);
  if (Lv.midTop - mb > 2) b.box(M.stone, sub(f, 0, mb, 0), 3.4, Lv.midTop - mb, DEPTH.mid + 0.9);
  if (Lv.midSpring - mb > 2) {
    b.box(M.stone, sub(f, 0, mb, 0), PIERW.mid + 0.5, Lv.midSpring - mb - 0.9, DEPTH.mid + 0.5);
    b.box(M.smooth, sub(f, 0, Lv.midSpring - 0.9, 0), PIERW.mid + 1.3, 0.9, DEPTH.mid + 1.1);
  }

  // putlog holes: rows of small dark sockets left by the builders' scaffolding (scale cue)
  if (Lv.midSpring - mb > 6) {
    b.setGround(-1e9);
    for (let y = mb + 3.5; y < Lv.midSpring - 2; y += 4.4) {
      for (const zs of [-1, 1]) {
        for (const xs of [-1, 1]) b.box(M.basalt, sub(f, xs * 2.5, y, zs * (DEPTH.mid / 2 + 0.26)), 0.6, 0.6, 0.1, null, 0.04);
      }
    }
    b.setGround(g, 7);
  }
  if (gapSide !== 0) springers(b, M, rng, f, Lv, gapSide, hasBottom);

  if (tower) castellum(ctx, b, M, rng, p, f, Lv, g);
  else if (!end) {
    // pier strip through the little arcade, up to the deck — snapped if a neighbour fell
    b.setGround(g, 7);
    if (topL && topR) b.box(M.stone, sub(f, 0, Lv.topBase, 0), 2.2, 9.2, DEPTH.top + 0.6);
    else if (topL || topR) {
      const hi = 9.2;
      const lo = 2 + rng() * 4;
      fracturedSlab(b, M.stone, sub(f, 0, Lv.topBase, 0), 2.2, DEPTH.top + 0.6, topL ? hi : lo, topL ? lo : hi, rng, { jag: 0.3, loose: false });
    }
  }
}

/** Triangular cutwater buttresses on both faces of a pier (plan: wedge), with a sloped cap. */
function cutwaters(b, M, f, g, top) {
  const c = new Float32Array(24);
  const base = g - 2;
  for (const side of [1, -1]) {
    const m = sub(f, 0, 0, 0, side > 0 ? 0 : Math.PI);
    const face = DEPTH.bot / 2 + 0.2;
    const proj = 3.6;
    const hw = 3.2;
    const capDrop = 3.5;
    const P = [
      [-hw, base, face], [hw, base, face], [0, base, face + proj], [0, base, face + proj],
      [-hw, top, face], [hw, top, face], [0, top - capDrop, face + proj], [0, top - capDrop, face + proj],
    ];
    // reorder into hexa convention: 0(-,-,-) 1(+,-,-) 2(+,-,+) 3(-,-,+) with z- = wall face
    for (let k = 0; k < 8; k++) tp(m, P[k][0], P[k][1], P[k][2], c, k * 3);
    b.hexa(M.stone, c);
  }
}

/** Arch springers left on a pier whose neighbouring bay has fallen: stubs of each tier. */
function springers(b, M, rng, f, Lv, side, hasBottom) {
  // midde tier: first ~30% of the lancet ring + a wedge of spandrel
  const midSpan = BAY - PIERW.mid;
  const pts = archPoints('pointed', midSpan - 0.4, 12.4, 18);
  const m = sub(f, side * (BAY / 2), Lv.midSpring, 0, side > 0 ? 0 : Math.PI);
  // ring points are relative to the bay centre; the pier is at x = -BAY/2 of that bay
  voussoirs(b, M.smooth, m, pts, { thick: 1.4, depth: DEPTH.mid + 0.4, gap: 0.09, to: 0.22 + rng() * 0.12, rng, slip: 0.3 });
  // spandrel remnant over the springer, snapped along a line falling into the gap
  const fm = sub(f, side * 0.8, Lv.midSpring, 0, side > 0 ? 0 : Math.PI);
  fracturedSlab(b, M.stone, sub(fm, 3.0, 0, 0), 4.2, DEPTH.mid, 10 + rng() * 5, 2 + rng() * 3, rng, { jag: 0.8 });
  if (hasBottom) {
    const span = BAY - PIERW.bot;
    const bp = archPoints('round', span - 0.5, span / 2 - 0.25, 15);
    const mb = sub(f, side * (BAY / 2), Lv.botCrown - span / 2, 0, side > 0 ? 0 : Math.PI);
    voussoirs(b, M.smooth, mb, bp, { thick: 1.7, depth: DEPTH.bot + 0.5, gap: 0.1, to: 0.2 + rng() * 0.1, rng, slip: 0.3 });
  }
}

/**
 * Tower pier: rises ~35 m above the deck, the channel threads through it, and on top stands a
 * colossal openwork wheel of black obsidian with an inscribed hub, set in a slot.
 */
function castellum(ctx, b, M, rng, p, f, Lv, g) {
  const D = Lv.D;
  const TW = 10.5; // along
  const TD = 12.5; // across
  b.setGround(g, 8);
  const start = Math.min(Lv.M0, g - 2);
  const shaftH = Lv.midTop - start;
  b.box(M.stone, sub(f, 0, start, 0), TW, shaftH, TD, { taper: [0.96, 0.96] });
  // buttress fins on the long faces, battered
  for (const s of [-1, 1]) {
    for (const x of [-1, 1]) {
      b.box(M.stone, sub(f, x * (TW / 2 - 1.5), start, s * (TD / 2 + 0.9)), 2.6, shaftH - 3, 2.2, { taper: [0.9, 0.35], shift: [0, -s * 0.7] });
    }
    // slit windows (dark insets) between the fins
    for (let k = 0; k < 2; k++) {
      const y = Lv.midTop - 9 - k * 13;
      if (y - 7 < g + 2) continue;
      b.setGround(-1e9);
      b.box(M.basalt, sub(f, 0, y - 7, s * (TD / 2 - 0.2)), 1.0, 7, 0.6, null, 0.05);
      b.box(M.smooth, sub(f, 0, y, s * (TD / 2 - 0.1)), 2.2, 0.7, 0.9);
    }
    b.setGround(g, 8);
  }
  b.box(M.stone, sub(f, 0, Lv.midTop, 0), TW + 1.6, 1.2, TD + 1.6);
  // upper body with the channel tunnel through it (arcade across the route)
  const ub = Lv.midTop + 1.2;
  const upperH = D + 9 - ub;
  const tunnel = arcadeGeometry(TD, upperH, [{ cx: 0, span: 3.4, spring: D - ub + 2.2, kind: 'round' }], TW - 0.6);
  b.setGround(-1e9);
  b.geo(M.stone, tunnel, sub(f, 0, ub, 0, Math.PI / 2));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(M.stone, sub(f, x * (TW / 2 - 0.6), ub, z * (TD / 2 - 0.6)), 1.6, upperH, 1.6);
  // obsidian inscription storey + cornice
  // a black storey carrying a single line of cyan runes at its middle
  const gy = glyphRow(D + 10.5, 1.0);
  b.box(M.obsidian, sub(f, 0, D + 9, 0), TW - 0.4, gy + 2 - (D + 9), TD - 0.4);
  const ct = gy + 2;
  b.box(M.stone, sub(f, 0, ct, 0), TW + 1.2, 1.1, TD + 1.2);
  // stepped crown
  b.box(M.stone, sub(f, 0, ct + 1.1, 0), TW - 0.8, 2.2, TD - 0.8, { taper: 0.9 });
  b.box(M.smooth, sub(f, 0, ct + 3.3, 0), TW - 2.6, 1.2, TD - 2.6);
  // the wheel: plane along the route so it reads as a full disc from the sides
  const R = 11;
  const wheelY = ct + 4.5 + R - 3.0;
  const tilt = (rng() - 0.5) * 0.06;
  const wm = sub(f, 0, wheelY, 0, 0, tilt, rng() * 0.8);
  b.geo(M.obsidianPlain, ringGeometry(R, R - 2.6, 2.2, 36), wm);
  b.geo(M.obsidian, ringGeometry(3.4, 1.3, 2.8, 0), wm);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI;
    const sp = sub(wm, 0, 0, 0, 0, 0, a);
    b.box(M.smooth, sp.multiply(mat(0, 3.2, 0)), 1.1, R - 2.6 - 3.2 + 0.4, 1.4);
    b.box(M.smooth, sub(wm, 0, 0, 0, 0, 0, a + Math.PI).multiply(mat(0, 3.2, 0)), 1.1, R - 2.6 - 3.2 + 0.4, 1.4);
  }
  // slot cheeks holding the wheel
  for (const s of [-1, 1]) b.box(M.stone, sub(f, 0, ct + 4.5, s * 1.75), TW - 2.5, 4.0, 1.2, { taper: [0.75, 1] });
}

const ringCache = new Map();
/** Annulus in XY extruded along z; `teeth` > 0 gives a crenellated outer rim. */
function ringGeometry(R, r, t, teeth) {
  const k = `${R}|${r}|${t}|${teeth}`;
  if (ringCache.has(k)) return ringCache.get(k);
  const shape = new THREE.Shape();
  const N = teeth > 0 ? teeth * 4 : 32;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = R + (teeth > 0 && i % 4 < 2 ? 0.8 : 0);
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const hole = new THREE.Path();
  for (let i = 0; i <= 28; i++) {
    const a = -(i / 28) * Math.PI * 2;
    if (i === 0) hole.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else hole.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t / 2);
  g.deleteAttribute('uv');
  ringCache.set(k, g);
  return g;
}

/** A collapsed bay: rubble mound, a fallen arch ring lying in the grass, maybe a fallen wheel. */
function gapBay(ctx, b, M, rng, frame, W, D, gm, i, p0, p1, yaw) {
  const mx = (p0.x + p1.x) / 2;
  const mz = (p0.z + p1.z) / 2;
  rubble(ctx, b, M.stone, mx, mz, 70, 16, rng, { size: [0.6, 3.4], rx: 14, rz: 20, yaw, sink: 0.4 });
  rubble(ctx, b, M.smooth, mx, mz, 14, 12, rng, { size: [1.5, 3.2], yaw, sink: 0.3 });
  // a run of voussoirs that fell together, lying tilted on the rubble
  if (rng() < 0.8) {
    const side = rng() < 0.5 ? -1 : 1;
    const ox = mx + Math.sin(yaw + Math.PI / 2) * side * (8 + rng() * 6);
    const oz = mz + Math.cos(yaw + Math.PI / 2) * side * (8 + rng() * 6);
    const gy = ctx.heightAt(ox, oz);
    b.setGround(gy, 4);
    const pts = archPoints('pointed', BAY - PIERW.mid - 0.4, 12.4, 18);
    const m = mat(ox, gy - 1.2, oz, yaw + (rng() - 0.5) * 0.6, -Math.PI / 2 + 0.25 + rng() * 0.2, (rng() - 0.5) * 0.3);
    const a0 = 0.15 + rng() * 0.2;
    voussoirs(b, M.smooth, m, pts, { thick: 1.4, depth: DEPTH.mid + 0.4, gap: 0.18, from: a0, to: a0 + 0.35 + rng() * 0.2, rng, slip: 0.6, jit: 0.1 });
  }
  // slabs of the channel frieze lying in the grass, still inscribed
  for (let k = 0; k < 3; k++) {
    const ox = mx + (rng() - 0.5) * 26;
    const oz = mz + (rng() - 0.5) * 26;
    const gy = ctx.heightAt(ox, oz);
    b.setGround(gy, 3);
    b.box(M.glyph, mat(ox, gy - 0.45, oz, rng() * 6.28, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25), 4 + rng() * 5, 1.25, 1.0, { jit: 0.08 });
  }
}

/** Monumental tunnel mouth where the conduit enters the land. */
function portal(ctx, b, M, rng, p, toward, D, grand = false) {
  const yaw = Math.atan2(-(toward.z - p.z), toward.x - p.x); // local +x points back along the aqueduct
  // facade plane faces +x (along the route); build in a frame rotated so the facade is XY
  const f = mat(p.x, 0, p.z, yaw + Math.PI / 2);
  const g = Math.min(ctx.heightAt(p.x, p.z), D - 6);
  b.setGround(g, 6);
  const base = g - 8;
  const top = D + 22;
  const Wf = 30;
  // facade slab with a tall recess (an arcade opening reaching down to the channel level)
  const recessSpring = D + 3;
  b.geo(M.stone, arcadeGeometry(Wf, top - base, [{ cx: 0, span: 12, spring: recessSpring - base, rise: 9, kind: 'pointed' }], 7), sub(f, 0, base, -2.5));
  // the recess interior: a deep dark void
  b.box(M.basalt, sub(f, 0, base, -7.5), 13, recessSpring + 9.2 - base, 3, null, 0.06);
  // three receding archivolts
  for (let k = 0; k < 3; k++) {
    const span = 12 + 3.4 * (k + 1);
    voussoirs(b, k === 1 ? M.basalt : M.smooth, sub(f, 0, recessSpring, 1.0 + 0.1 * k - 0.9 * k), archPoints('pointed', span - 3.0, 9 + 1.6 * (k + 1) - 1.4, 18), { thick: 1.5, depth: 1.8, gap: 0.08, rng, slip: 0.15 });
  }
  // raking buttresses: steep wedges leaning against the facade
  for (const s of [-1, 1]) {
    b.box(M.stone, sub(f, s * (Wf / 2 + 4), base, -1), 8, top - base - 4, 13, { taper: [0.55, 0.3], shift: [-s * 2, -3] });
  }
  // lintel crown with an inscription band
  const cell = 1.2;
  const gy = glyphRow(top + 1.8, cell);
  b.box(M.stone, sub(f, 0, top, -2.5), Wf + 1.5, gy - top, 8);
  b.box(M.glyph, sub(f, 0, gy, -2.4), Wf + 1.0, cell * 2, 7.8);
  b.box(M.smooth, sub(f, 0, gy + cell * 2, -2.5), Wf + 3, 1.4, 9, { taper: [1.02, 1.0] });
  // crown snapped off along one diagonal
  const hs = rng() < 0.5;
  fracturedSlab(b, M.stone, sub(f, 0, gy + cell * 2 + 1.4, -2.5), Wf - 2, 7, hs ? 12 : 2, hs ? 2 : 12, rng, { jag: 1.4 });
  if (grand) {
    // where it leaves the escarpment the conduit is framed by a colossal carved doorway, three
    // nested frames sunk into the cliff face — the whole cliff made into a threshold
    for (let k = 0; k < 3; k++) {
      const H = 74 - k * 11;
      const Wo = Wf + 14 - k * 5;
      doorFrame(b, M, sub(f, 0, base + 4, -9 - k * 2.5), H, Wo, 7 - k, 9, rng, { inner: k === 1 ? M.obsidian : M.smooth, body: k === 1 ? M.basalt : M.stone, plinth: false });
    }
  }
  // a short run of channel emerging from the mouth
  const cm = mat(p.x, 0, p.z, yaw);
  b.setGround(g, 6);
  b.box(M.stone, sub(cm, 6, g - 2, 0), 12, D - g + 2, 5.0);
  channel(b, M, rng, cm, 12, D, -1, [0, 12]);
}

export { ringGeometry };
