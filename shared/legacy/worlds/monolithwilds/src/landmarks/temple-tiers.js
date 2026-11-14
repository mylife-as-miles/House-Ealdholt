// Descending Temple — the inverted ziggurat.
//
// Construction logic: a stack of square floor plates, each wider than the one below. Every plate
// carries a gallery (colonnade / arcade / niche wall / garden) around a solid core; the next,
// wider plate overhangs it like an eave, carried on stepped corbels. Because the builders worked
// from the sky downward, the stairs obey *their* gravity: zigzag flights hang in front of each
// gallery with their treads facing the ground. Obelisk pendants hang from every overhang corner.
// A few plate corners have broken away (their fragments lie on the mesa — see temple-base.js).
//
// Everything is emitted into per-material accumulators (temple-geo.js) in the site-local frame;
// the whole mass shares one "tilt" frame matrix.

import { BOX, BLOB_DOWN, frustumTemplate, prismTemplate, toTemplate, wallWithHoles, archHole, trapHole } from './temple-geo.js';
import * as THREE from 'crownfall-world-three';

export const TIER_TYPES = [
  'niche', 'colonnade', 'niche', 'colonnade', 'arcade', 'garden', 'colonnade', 'niche',
  'arcade', 'garden', 'colonnade', 'niche', 'arcade', 'garden', 'colonnade', 'arcade',
];

/** Broken plate corners / edges: tier-local {tier, x, z, r}. Pieces whose centre is inside are gone. */
export const BITES = [
  { tier: 9, x: 72, z: 78, r: 17 },
  { tier: 12, x: -104, z: 100, r: 15 },
  { tier: 6, x: 51, z: -20, r: 8 },
  { tier: 14, x: 126, z: -124, r: 19 },
  { tier: 4, x: -30, z: -34, r: 7 },
];
// a collapse scar running down the +z face (the outer ring has sheared off over five terraces)
for (let i = 7; i <= 11; i++) {
  const W = 18 + 264 * Math.pow(i / 15, 1.5);
  BITES.push({ tier: i, x: -38 - (i - 7) * 3, z: W / 2, r: 4 + (i - 7) * 2.2 });
}

/** Tier geometry plan. baseY = underside of tier 0 (just above the tip). */
export function makeTiers(baseY) {
  const N = TIER_TYPES.length;
  const tiers = [];
  let y = baseY;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const h = 13 + 15 * Math.pow(t, 1.2);
    const W = 18 + 264 * Math.pow(t, 1.5); // flared: slender stem, wide stepped crown
    const s = 2.6 + 0.14 * h;
    const type = TIER_TYPES[i];
    let g = Math.min(11, Math.max(3, 2 + 0.04 * W));
    if (type === 'niche') g = 2.2;
    if (type === 'garden') g = Math.min(13, g + 2);
    const bay = Math.min(7.5, Math.max(4.5, 3.2 + h * 0.16));
    tiers.push({
      i, type, h, W, hw: W / 2, s,
      yb: y, yf: y + s, yt: y + h,
      g, hc: W / 2 - g, bay,
      colD: 0.55 + 0.055 * h,
      entH: 1.2 + 0.07 * h,
      cw: Math.max(2.6, 1.2 + 0.1 * h), // corner pier width
    });
    y += h;
  }
  for (let i = 0; i < N; i++) tiers[i].d = i > 0 ? tiers[i].hw - tiers[i - 1].hw : tiers[i].hw - 1.75;
  return tiers;
}

// ---------------------------------------------------------------------------

/** Place a template in "side space": u along the side, y up, r outward. Side angle a. */
function sput(acc, tpl, a, u, y, r, su, sy, sr, tint = 1, extraRy = 0, rx = 0) {
  const s = Math.sin(a), c = Math.cos(a);
  acc.put(tpl, u * c + r * s, y, -u * s + r * c, su, sy, sr, a + extraRy, tint, rx);
}
function sideToXZ(a, u, r) {
  const s = Math.sin(a), c = Math.cos(a);
  return [u * c + r * s, -u * s + r * c];
}
const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

function bitten(tierIndex, x, z, pad = 0) {
  for (const b of BITES) {
    if (b.tier !== tierIndex) continue;
    const dx = x - b.x, dz = z - b.z;
    if (dx * dx + dz * dz < (b.r + pad) * (b.r + pad)) return true;
  }
  return false;
}

/** Stair zone on each face (hanging flights) — keep corbels / lanterns / vines clear of it. */
export function stairHalfWidth(t) {
  return t.h / 1.25 / 2 + 3;
}

// ---------------------------------------------------------------------------

export function buildTiers(ctx, A, tiers, rng, out) {
  const cap = frustumTemplate(1.45); // column capital (flares upward)
  const shaft = prismTemplate(8, 0.92);
  const pendant = toTemplate(new THREE.CylinderGeometry(Math.SQRT1_2, 0.03, 1, 4, 1, false, Math.PI / 4).translate(0, -0.5, 0).toNonIndexed());
  const collar = frustumTemplate(0.7);

  const stoneTint = (k = 1) => {
    const v = (0.95 + 0.1 * rng()) * k;
    return [1.24 * v, 1.18 * v, 1.07 * v];
  };

  for (const t of tiers) {
    const tint = stoneTint();
    buildSlab(A, t, tint, rng);
    if (t.i > 0) buildCorbels(A, t, tiers[t.i - 1], tint, rng);
    switch (t.type) {
      case 'colonnade': buildColonnade(A, t, tint, rng, shaft, cap); break;
      case 'arcade': buildArcade(A, t, tint, rng); break;
      case 'garden': buildGarden(A, t, tint, rng, out); break;
      default: buildNiche(A, t, tint, rng); break;
    }
    if (t.type !== 'niche') buildCore(A, t, rng);
    if (t.i > 0) buildPendants(A, t, tiers[t.i - 1], pendant, collar, out);
    if (t.i > 0) buildLanterns(A, t, tiers[t.i - 1], rng, out);
  }
  for (let k = tiers.length - 1; k >= 1; k--) buildFlights(A, tiers[k], tiers[k - 1], k);
}

// ---------------------------------------------------------------------------
// Floor plate: segmented ring (so corners can break away) + solid centre + mouldings.

function buildSlab(A, t, tint, rng) {
  const { hw, yb, yf, s, i } = t;
  const D = Math.min(7, hw * 0.5);
  const inner = hw - D;
  if (inner > 0.5) A.stone.aabb(-inner, yb, -inner, inner, yf, inner, tint);
  const co = 0.55 + 0.035 * t.h; // cornice projection
  const segL = 9;
  for (const a of SIDES) {
    const u0 = -hw, u1 = hw - D;
    const n = Math.max(1, Math.round((u1 - u0) / segL));
    for (let k = 0; k < n; k++) {
      let s0 = u0 + ((u1 - u0) * k) / n;
      let s1 = u0 + ((u1 - u0) * (k + 1)) / n;
      const um = (s0 + s1) / 2;
      const [x, z] = sideToXZ(a, um, hw - D / 2);
      if (bitten(i, x, z)) continue;
      // jagged break: neighbours of a bite lose a random bite of their own
      let top = yf, bot = yb, rOut = hw;
      if (bitten(i, x, z, 7)) {
        top -= rng() * s * 0.5;
        bot += rng() * s * 0.3;
        rOut -= rng() * D * 0.6;
      }
      sput(A.stone, BOX, a, um, (top + bot) / 2, (hw - D + rOut) / 2, s1 - s0 + 0.01, top - bot, rOut - (hw - D), tint);
      // mouldings on this segment (outermost pieces extend to the corner, pinwheel style)
      if (rOut < hw - 0.01) continue;
      const m0 = k === 0 ? -hw - co : s0;
      const m1 = k === n - 1 ? hw - 0.45 : s1;
      const mm = (m0 + m1) / 2, ml = m1 - m0;
      const lt = [tint[0] * 1.06, tint[1] * 1.05, tint[2] * 1.03];
      sput(A.stone, BOX, a, mm, yf - 0.45 + 0.12, hw - 0.45 + (co + 0.45) / 2, ml, 1.14, co + 0.45, lt); // cornice
      sput(A.stone, BOX, a, mm, yf - 1.35, hw - 0.4 + (co * 0.55 + 0.4) / 2, ml, 0.6, co * 0.55 + 0.4, tint); // bed moulding
      sput(A.stone, BOX, a, mm, yb + 0.35, hw - 0.4 + 0.75 / 2, ml, 0.7, 0.75, [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9]); // drip band
      // frieze: glyph band on some plates, carved bosses on the others
      const fy0 = yb + 1.0, fy1 = yf - 1.8;
      if (fy1 - fy0 > 0.8) {
        if (i % 3 === 1) {
          sput(A.glyph, BOX, a, mm, (fy0 + fy1) / 2, hw - 0.3 + 0.2, ml, fy1 - fy0, 0.8, [1.35, 1.2, 1.05]);
        } else {
          const nb = Math.max(1, Math.round((s1 - s0) / t.bay));
          for (let b = 0; b < nb; b++) {
            const ub = s0 + ((s1 - s0) * (b + 0.5)) / nb;
            const bs = Math.min(1.3, (fy1 - fy0) * 0.7);
            sput(A.stone, BOX, a, ub, (fy0 + fy1) / 2, hw + 0.15, bs, bs, 0.5, tint);
          }
        }
      }
    }
  }
}

// Stepped corbels under the overhang of plate t (springing from the gallery line of tier p below),
// with painted coffers between them: ochre panels, a gold boss in each, framed by stone ribs.
function buildCorbels(A, t, p, tint, rng) {
  const d = t.hw - p.hw;
  if (d < 1.5) return;
  const clearU = stairHalfWidth(p);
  const step = p.bay * (p.i < 6 ? 1 : 2);
  const n = Math.floor((2 * p.hw - 2 * p.cw) / step);
  const depth = Math.min(1.8, 0.6 + 0.06 * p.h);
  const lh = Math.min(1.6, 0.5 + p.entH * 0.35); // layer height
  const panel = [1.0, 0.56, 0.4];
  for (const a of SIDES) {
    // longitudinal rib along the outer edge of the band (segmented: broken corners take it away)
    {
      const L = 2 * t.hw - 2.4;
      const nr = Math.max(1, Math.round(L / 10));
      for (let q = 0; q < nr; q++) {
        const u = -L / 2 + ((q + 0.5) * L) / nr;
        const [x, z] = sideToXZ(a, u, t.hw - 1.0);
        if (bitten(t.i, x, z, 3)) continue;
        sput(A.stone, BOX, a, u, t.yb - 0.4, t.hw - 1.0, L / nr + 0.02, 0.8, 1.2, tint);
      }
    }
    for (let k = 0; k <= n; k++) {
      const u = -n * step * 0.5 + k * step;
      const [x, z] = sideToXZ(a, u, p.hw + d * 0.5);
      if (bitten(t.i, x, z, 2)) continue;
      const inStair = Math.abs(u) < clearU;
      const r0 = p.hw - 0.6;
      if (!inStair) {
        for (let L = 0; L < 3; L++) {
          const len = (d + 0.4) * (1 - L * 0.3) - 0.3;
          const y = t.yb - lh * (L + 0.5);
          sput(A.stone, BOX, a, u, y, r0 + len / 2, depth * (1 - L * 0.12), lh, len, tint);
        }
      } else {
        sput(A.stone, BOX, a, u, t.yb - 0.4, r0 + (d + 0.1) / 2, 0.9, 0.8, d + 0.1, tint);
      }
      // coffer between this corbel and the next
      if (k < n && d > 3) {
        const uc = u + step / 2;
        const pw = step - depth - 0.6;
        const pr = d - 2.8;
        if (pw > 1 && pr > 0.8) {
          const rc = p.hw + 0.3 + pr / 2;
          sput(A.plaster, BOX, a, uc, t.yb - 0.06, rc, pw, 0.1, pr, panel);
          if (rng() < 0.55) sput(A.ember, BLOB_DOWN, a, uc, t.yb - 0.13, rc, pw - 0.1, 1, pr - 0.1, 0.5 + rng() * 0.9);
          const bs = Math.min(1.1, pr * 0.35, pw * 0.3);
          sput(A.gold, BOX, a, uc, t.yb - 0.25, rc, bs, 0.4, bs, 1, Math.PI / 4);
        }
      }
    }
  }
}

// Door-pierced core wall (skin with trapezoid holes over a recessed solid core + glow panels).
function buildCore(A, t, rng) {
  const { yf, yt, hc } = t;
  const H = yt - yf;
  const skin = Math.min(1.6, 0.6 + 0.05 * t.h);
  const plasterTint = t.type === 'garden' ? [1.02, 0.82, 0.56] : t.type === 'arcade' ? [1.0, 0.74, 0.62] : [0.96, 0.6, 0.44];
  const v = 0.92 + 0.14 * rng();
  const pt = [plasterTint[0] * v, plasterTint[1] * v, plasterTint[2] * v];
  // solid core, recessed behind the skin
  const ci = hc - skin;
  A.plaster.aabb(-ci, yf, -ci, ci, yt, ci, [pt[0] * 0.8, pt[1] * 0.8, pt[2] * 0.8]);
  const doorH = Math.min(H * 0.58, 10);
  const doorW = doorH * 0.46;
  const every = t.type === 'garden' ? 2 : 3;
  const spacing = t.bay * every;
  const L = 2 * hc;
  const n = Math.max(1, Math.floor((L - 4) / spacing));
  const holes = [];
  const doorsU = [];
  for (let k = 0; k < n; k++) {
    const u = (-(n - 1) / 2 + k) * spacing;
    if (Math.abs(u) + doorW > hc - 1) continue;
    holes.push(trapHole(u, 0.001, doorW, doorH, 0.7));
    doorsU.push(u);
  }
  // small high windows between doors on tall galleries
  const win = [];
  if (H > 14) {
    for (let k = 0; k < n - 1; k++) {
      const u = (-(n - 1) / 2 + k + 0.5) * spacing;
      if (Math.abs(u) + 1 > hc - 1) continue;
      holes.push(trapHole(u, doorH + 1.2, 1.4, 2.6, 0.8));
      win.push(u);
    }
  }
  const geo = wallWithHoles(L, H, skin, holes);
  const tpl = toTemplate(geo);
  for (const a of SIDES) {
    const [x, z] = sideToXZ(a, 0, hc - skin / 2);
    A.plaster.put(tpl, x, yf, z, 1, 1, 1, a, pt);
    // lintels over doors (proud stone) + glow panels at the back of each opening
    // only some doorways are lit; the rest are dark recesses
    for (const u of doorsU) {
      sput(A.stone, BOX, a, u, yf + doorH + 0.55, hc + 0.25, doorW * 1.25, 1.1, 0.8, 1.08);
      if (rng() < 0.42) sput(A.glow, BOX, a, u, yf + doorH * 0.5, hc - skin - 0.05, doorW * 0.95, doorH, 0.12, 0.8 + rng() * 0.5);
      else sput(A.plaster, BOX, a, u, yf + doorH * 0.5, hc - skin - 0.05, doorW * 0.95, doorH, 0.12, 0.08);
    }
    for (const u of win) {
      if (rng() < 0.3) sput(A.glow, BOX, a, u, yf + doorH + 1.2 + 1.3, hc - skin - 0.05, 1.3, 2.6, 0.12, 0.7);
      else sput(A.plaster, BOX, a, u, yf + doorH + 1.2 + 1.3, hc - skin - 0.05, 1.3, 2.6, 0.12, 0.08);
    }
  }
}

function buildCornerPiers(A, t, tint) {
  const { hw, yf, yt, cw, i } = t;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (hw - cw / 2 - 0.3), z = sz * (hw - cw / 2 - 0.3);
    if (bitten(i, x, z, 3)) continue;
    A.stone.box(x, (yf + yt) / 2, z, cw, yt - yf, cw, 0, tint);
    // pier cap + base
    A.stone.box(x, yt - 0.5, z, cw + 0.6, 1.0, cw + 0.6, 0, tint);
    A.stone.box(x, yf + 0.4, z, cw + 0.5, 0.8, cw + 0.5, 0, tint);
  }
}

function colonnadeLine(t) {
  const e = t.colD * 0.5 + 0.9;
  const r = t.hw - e;
  const span = 2 * (t.hw - t.cw - 0.3) - t.colD;
  const n = Math.max(2, Math.round(span / t.bay));
  return { r, e, n, step: span / n, span };
}

function buildEntablature(A, t, r, tint) {
  const { yt, entH, hw } = t;
  const depth = t.colD + 0.9;
  for (const a of SIDES) {
    sput(A.stone, BOX, a, 0, yt - entH / 2, r, 2 * hw - 0.6, entH, depth, tint);
    sput(A.stone, BOX, a, 0, yt - entH - 0.2, r, 2 * hw - 0.6, 0.4, depth + 0.5, tint);
  }
}

function buildBalustrade(A, t, a, u0, u1, r, tint, rng) {
  const len = u1 - u0;
  if (len < 0.8) return;
  const um = (u0 + u1) / 2;
  const y = t.yf;
  sput(A.stone, BOX, a, um, y + 0.12, r, len, 0.24, 0.55, tint);
  sput(A.stone, BOX, a, um, y + 1.12, r, len, 0.2, 0.5, tint);
  const nb = Math.floor(len / 0.95);
  for (let b = 0; b < nb; b++) {
    if (rng() < 0.06) continue; // a few missing balusters
    const ub = u0 + ((b + 0.5) * len) / nb;
    sput(A.stone, BOX, a, ub, y + 0.63, r, 0.24, 0.78, 0.24, tint);
  }
}

function buildColonnade(A, t, tint, rng, shaft, cap) {
  const { yf, yt, entH, colD, i } = t;
  const { r, n, step } = colonnadeLine(t);
  const colH = yt - yf - entH;
  const baseH = Math.min(1.1, colH * 0.08);
  const capH = Math.min(1.4, colH * 0.1);
  buildEntablature(A, t, r, tint);
  buildCornerPiers(A, t, tint);
  const ct = [tint[0] * 1.04, tint[1] * 1.03, tint[2] * 1.02];
  for (const a of SIDES) {
    let prevU = null;
    for (let k = 0; k <= n; k++) {
      const u = -n * step * 0.5 + k * step;
      const [x, z] = sideToXZ(a, u, r);
      if (bitten(i, x, z, 1)) { prevU = null; continue; }
      // a few columns have broken: a stump remains, drums lie on the gallery floor
      const gone = rng() < 0.05;
      if (gone) {
        const stump = (colH - baseH) * (0.15 + rng() * 0.35);
        sput(A.stone, BOX, a, u, yf + baseH / 2, r, colD * 1.35, baseH, colD * 1.35, ct);
        sput(A.stone, shaft, a, u, yf + baseH, r, colD * 0.5, stump, colD * 0.5, ct, 0, (rng() - 0.5) * 0.08);
        const drums = 1 + Math.floor(rng() * 3);
        for (let q = 0; q < drums; q++) {
          const du = u + (rng() - 0.5) * 3, dr = r - 1.5 - rng() * (t.g - 3);
          sput(A.stone, shaft, a, du, yf + colD * 0.46, dr, colD * 0.46, colD * (1.2 + rng()), colD * 0.46, ct, rng() * 3, Math.PI / 2);
        }
      } else {
        sput(A.stone, BOX, a, u, yf + baseH / 2, r, colD * 1.35, baseH, colD * 1.35, ct);
        sput(A.stone, shaft, a, u, yf + baseH, r, colD * 0.5, colH - baseH - capH, colD * 0.5, ct);
        sput(A.stone, cap, a, u, yt - entH - capH, r, colD * 0.92, capH * 0.75, colD * 0.92, ct);
        sput(A.stone, BOX, a, u, yt - entH - capH * 0.125, r, colD * 1.45, capH * 0.25, colD * 1.45, ct);
      }
      if (prevU !== null) buildBalustrade(A, t, a, prevU + colD * 0.7, u - colD * 0.7, r, tint, rng);
      prevU = u;
    }
  }
}

function buildArcade(A, t, tint, rng) {
  const { yf, yt, hw, i } = t;
  const H = yt - yf;
  const depth = Math.min(2.4, 1.0 + 0.06 * t.h);
  const r = hw - depth / 2 - 0.5;
  const L = 2 * (hw - t.cw - 0.3);
  const n = Math.max(2, Math.round(L / (t.bay * 1.2)));
  const w = L / n;
  const openW = w * 0.64;
  const spring = H * 0.5;
  const holes = [];
  for (let k = 0; k < n; k++) holes.push(archHole(-L / 2 + (k + 0.5) * w, 0.001, openW, spring, 10, 0.35));
  const tpl = toTemplate(wallWithHoles(L, H, depth, holes));
  buildCornerPiers(A, t, tint);
  for (const a of SIDES) {
    // a side touched by a broken corner is rebuilt as free-standing piers
    let skip = false;
    for (const b of BITES) {
      if (b.tier === i && b.x * Math.sin(a) + b.z * Math.cos(a) > hw - b.r - 3) skip = true;
    }
    if (skip) {
      for (let k = 0; k <= n; k++) {
        const u = -L / 2 + k * w;
        const [x, z] = sideToXZ(a, u, r);
        if (bitten(i, x, z, 2)) continue;
        sput(A.stone, BOX, a, u, (yf + yt) / 2, r, w - openW, H, depth, tint);
      }
      continue;
    }
    const [x, z] = sideToXZ(a, 0, r);
    A.stone.put(tpl, x, yf, z, 1, 1, 1, a, tint);
    // impost band + parapet in each arch
    sput(A.stone, BOX, a, 0, yf + spring, r, L, 0.5, depth + 0.4, tint);
    for (let k = 0; k < n; k++) {
      const u = -L / 2 + (k + 0.5) * w;
      sput(A.stone, BOX, a, u, yf + 0.6, r, openW, 1.2, depth * 0.6, tint);
    }
  }
}

// Blind-niche wall. Unlit niches hold robed figures standing upside down on the niche ceiling —
// the saints of the builders, who took their gravity from the sky.
const ROBE = frustumTemplate(1.55);
const HOOD = toTemplate(new THREE.CylinderGeometry(Math.SQRT1_2, 0.18, 1, 4, 1, false, Math.PI / 4).translate(0, -0.5, 0).toNonIndexed());

function buildNiche(A, t, tint, rng) {
  const { yf, yt, hw } = t;
  const H = yt - yf;
  const skin = 1.4;
  const r = hw - 0.8 - skin / 2;
  const ci = hw - 0.8 - skin;
  A.stone.aabb(-ci, yf, -ci, ci, yt, ci, [tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85]);
  const L = 2 * (hw - 0.8);
  const bay = t.bay * 1.1;
  const n = Math.max(1, Math.round((L - 3) / bay));
  const nw = Math.min(bay * 0.5, 3.2);
  const nh = H * 0.62;
  const n0 = yf + H * 0.14;
  const holes = [];
  for (let k = 0; k < n; k++) holes.push(trapHole(-((n - 1) * bay) / 2 + k * bay, H * 0.14, nw, nh, 0.78));
  const tpl = toTemplate(wallWithHoles(L, H, skin, holes));
  const figTint = [tint[0] * 1.08, tint[1] * 1.05, tint[2] * 1.0];
  for (const a of SIDES) {
    const [x, z] = sideToXZ(a, 0, r);
    A.stone.put(tpl, x, yf, z, 1, 1, 1, a, tint);
    // pilasters between niches, sill course
    for (let k = 0; k <= n; k++) {
      const u = -((n - 1) * bay) / 2 + (k - 0.5) * bay;
      if (Math.abs(u) > hw - 1.5) continue;
      sput(A.stone, BOX, a, u, yf + H / 2, hw - 0.8 + 0.2, Math.min(1.2, bay - nw - 0.4), H, 0.6, tint);
    }
    sput(A.stone, BOX, a, 0, n0 - 0.25, hw - 0.8 + 0.25, L, 0.5, 0.7, tint);
    for (let k = 0; k < n; k++) {
      const u = -((n - 1) * bay) / 2 + k * bay;
      if (rng() < 0.2) {
        sput(A.glow, BOX, a, u, n0 + nh * 0.45, ci + 0.08, nw * 0.7, nh * 0.8, 0.1, 0.55);
        continue;
      }
      if (rng() < 0.12) continue; // an empty niche: its figure has fallen
      // inverted figure: hem against the niche ceiling, hooded head pointing at the ground
      const fh = nh * 0.78;
      const w = nw * 0.34;
      const top = n0 + nh - 0.02;
      const rr = ci + 0.75;
      sput(A.stone, ROBE, a, u, top - fh * 0.66, rr, w, fh * 0.66, w * 0.62, figTint);
      sput(A.stone, BOX, a, u, top - fh * 0.66 - w * 0.22, rr, w * 1.25, w * 0.44, w * 0.7, figTint);
      sput(A.stone, HOOD, a, u, top - fh * 0.66 - w * 0.4, rr + 0.05, w * 0.72, fh * 0.26, w * 0.62, figTint);
      sput(A.gold, BOX, a, u, top - fh * 0.66 - w * 0.4 - fh * 0.1, rr + w * 0.33, w * 0.34, fh * 0.1, 0.12, 1);
    }
  }
}

function buildGarden(A, t, tint, rng, out) {
  const { yf, yt, hw, entH, i } = t;
  const H = yt - yf;
  const pier = Math.max(2.0, t.colD * 1.25);
  const span = 2 * (hw - t.cw - 0.3);
  const step = t.bay * 3;
  const n = Math.max(2, Math.round(span / step));
  const st = span / n;
  const r = hw - pier / 2 - 0.9;
  buildEntablature(A, t, r, tint);
  buildCornerPiers(A, t, tint);
  const planterW = 2.2;
  const rp = hw - planterW / 2 - 0.35;
  for (const a of SIDES) {
    for (let k = 0; k <= n; k++) {
      const u = -span / 2 + k * st;
      const [x, z] = sideToXZ(a, u, r);
      if (!bitten(i, x, z, 1)) {
        sput(A.stone, BOX, a, u, yf + (H - entH) / 2, r, pier, H - entH, pier, tint);
      }
      if (k === n) continue;
      // planter trough between piers (terracotta), soil, and garden spots for trees / vines
      const u0 = u + pier * 0.7, u1 = u + st - pier * 0.7;
      const [mx, mz] = sideToXZ(a, (u0 + u1) / 2, rp);
      if (bitten(i, mx, mz, 3)) continue;
      sput(A.terra, BOX, a, (u0 + u1) / 2, yf + 0.75, rp, u1 - u0, 1.5, planterW, [1.0, 0.95, 0.9]);
      const nTrees = 1 + Math.floor(rng() * 2.2);
      for (let q = 0; q < nTrees; q++) {
        const uu = u0 + (u1 - u0) * (0.2 + 0.6 * rng());
        const [tx, tz] = sideToXZ(a, uu, rp);
        out.trees.push({ x: tx, y: yf + 1.4, z: tz, a, lean: 0.35 + rng() * 0.6, size: 0.8 + rng() * 0.7, reach: hw });
      }
    }
  }
}

// Inverted obelisks hanging from each overhang corner; a lamp at the tip.
function buildPendants(A, t, p, pendant, collar, out) {
  const d = t.hw - p.hw;
  const w = Math.min(3.2, 1.0 + d * 0.22);
  const len = p.h * 0.62;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (t.hw - w * 0.5 - 0.6), z = sz * (t.hw - w * 0.5 - 0.6);
    if (bitten(t.i, x, z, 4)) {
      out.fallenPendants.push({ tier: t.i, x, z, w, len });
      continue;
    }
    A.stone.put(collar, x, t.yb - 1.2, z, w * 1.5, 1.2, w * 1.5, Math.PI / 4, 1.05);
    A.stone.put(pendant, x, t.yb - 1.2, z, w, len, w, Math.PI / 4, 1.08);
    A.gold.box(x, t.yb - 1.2 - len * 0.18, z, w * 0.85, 0.5, w * 0.85, Math.PI / 4, 1);
    out.lamps.push({ x, y: t.yb - 1.2 - len - 0.6, z, s: 0.7 + w * 0.15 });
  }
}

// Lanterns on chains under the overhang bands.
function buildLanterns(A, t, p, rng, out) {
  const d = t.hw - p.hw;
  if (d < 3) return;
  const clearU = stairHalfWidth(p);
  const every = 19;
  const L = 2 * p.hw;
  const n = Math.floor(L / every);
  for (const a of SIDES) {
    for (let k = 0; k <= n; k++) {
      const u = -n * every * 0.5 + k * every + (rng() - 0.5) * 3;
      if (Math.abs(u) < clearU || Math.abs(u) > p.hw - 2) continue;
      if (rng() < 0.3) continue;
      const r = p.hw + d * (0.45 + rng() * 0.25);
      const [x, z] = sideToXZ(a, u, r);
      if (bitten(t.i, x, z, 2)) continue;
      const chain = 2 + rng() * p.h * 0.35;
      const y0 = t.yb;
      A.bronze.box(x, y0 - chain / 2, z, 0.12, chain, 0.12, 0, 1);
      const ly = y0 - chain - 0.8;
      A.bronze.box(x, ly + 0.95, z, 1.2, 0.3, 1.2, rng() * 3, 1);
      A.glow.box(x, ly, z, 0.75, 1.5, 0.75, rng() * 3, 0.9);
      A.bronze.box(x, ly - 0.9, z, 0.9, 0.25, 0.9, 0, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Hanging flights: from the underside of plate t down to the outer lower edge of plate p,
// running across the face in front of gallery p. Treads face DOWN; the smooth soffit is on top.

function buildFlights(A, t, p, k) {
  const d = t.hw - p.hw;
  const fw = Math.min(4.2, d - 0.9);
  if (fw < 1.6) return;
  const rIn = p.hw + 0.5;
  const rMid = rIn + fw / 2;
  const yTop = t.yb;
  const yBot = p.yb + 0.3;
  const dy = yTop - yBot;
  const L = Math.min(dy / 1.25, p.W * 0.8);
  const nSteps = Math.max(4, Math.round(dy / 0.85));
  const rise = dy / nSteps;
  const run = L / nSteps;
  const tint = [1.02, 0.98, 0.92];
  SIDES.forEach((a, si) => {
    const dir = (k + si) % 2 === 0 ? 1 : -1;
    const uTop = -dir * L / 2;
    const uBot = dir * L / 2;
    // step j: tread (facing down) at yTop-(j+1)rise, solid up to the soffit line
    for (let j = 0; j < nSteps; j++) {
      const uc = uTop + dir * (j + 0.5) * run;
      sput(A.stone, BOX, a, uc, yTop - (j + 0.5) * rise + 0.06, rMid, run + 0.02, rise + 0.12, fw, tint);
    }
    // soffit slab on top (bottom surface just above the inner corners), stringers both sides
    beamSide(A.stone, a, uTop, yTop + 0.55, uBot, yBot + 0.55, rMid, 1.0, fw + 0.2, tint);
    beamSide(A.stone, a, uTop, yTop - 0.2, uBot, yBot - 0.2, rIn + fw + 0.2, 1.8, 0.45, tint);
    beamSide(A.stone, a, uTop, yTop - 0.2, uBot, yBot - 0.2, rIn - 0.15, 1.8, 0.4, tint);
    // upside-down handrail hanging below the outer stringer
    const drop = 1.2;
    beamSide(A.stone, a, uTop, yTop - 1.1 - drop, uBot, yBot - 1.1 - drop, rIn + fw + 0.2, 0.22, 0.3, tint);
    const nPosts = Math.max(2, Math.floor(L / 2.2));
    for (let q = 1; q < nPosts; q++) {
      const f = q / nPosts;
      const u = uTop + (uBot - uTop) * f;
      const y = yTop + (yBot - yTop) * f - 1.1;
      sput(A.stone, BOX, a, u, y - drop / 2, rIn + fw + 0.2, 0.18, drop + 0.1, 0.18, tint);
    }
    // landings: hanging platform under plate t, bracket onto the lower edge of plate p
    sput(A.stone, BOX, a, uTop - dir * 1.4, yTop - 0.45, rMid, 3.2, 0.9, fw + 0.4, tint);
    const r0 = p.hw - 1.0, r1 = rIn + fw + 0.2;
    sput(A.stone, BOX, a, uBot + dir * 1.0, yBot - 0.3, (r0 + r1) / 2, 2.6, 1.2, r1 - r0, tint);
  });
}

/** Sloped beam in side space from (u0,y0) to (u1,y1) at radius r: section w (radial) x h (up). */
function beamSide(acc, a, u0, y0, u1, y1, r, h, w, tint) {
  const s = Math.sin(a), c = Math.cos(a);
  const x0 = u0 * c + r * s, z0 = -u0 * s + r * c;
  const x1 = u1 * c + r * s, z1 = -u1 * s + r * c;
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const pitch = Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0));
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  // box long axis = local z; rotate by yaw then pitch
  acc.put(BOX, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, w, h, len, yaw, tint, -pitch);
}
