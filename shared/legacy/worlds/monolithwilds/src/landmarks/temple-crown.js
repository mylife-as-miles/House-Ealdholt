// Descending Temple — the crown: the plaza deck that everything hangs from, its rim parapet and
// water spouts, the source basin and channels feeding the waterfalls, the small upright
// ziggurat (the only right-way-up stair on the whole structure) with its shrine, and the spire.

import * as THREE from 'crownfall-world-three';
import { BOX, frustumTemplate, prismTemplate, toTemplate } from './temple-geo.js';

const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
function sput(acc, tpl, a, u, y, r, su, sy, sr, tint = 1, extraRy = 0, rx = 0) {
  const s = Math.sin(a), c = Math.cos(a);
  acc.put(tpl, u * c + r * s, y, -u * s + r * c, su, sy, sr, a + extraRy, tint, rx);
}
export function sideToXZ(a, u, r) {
  const s = Math.sin(a), c = Math.cos(a);
  return [u * c + r * s, -u * s + r * c];
}

/**
 * Rim waterfalls: side angle index (0:+z 1:+x 2:-z 3:-x), tangential position u, width.
 * Tier falls pour from a gallery balustrade instead of the plaza rim.
 */
export const RIM_FALLS = [
  { side: 3, u: -30, w: 9 },
  { side: 3, u: 36, w: 6 },
  { side: 0, u: 22, w: 8 },
  { side: 2, u: -14, w: 10 },
  { side: 1, u: 30, w: 7 },
];
export const TIER_FALLS = [
  { tier: 13, side: 3, u: 76, w: 5 },
  { tier: 13, side: 1, u: -64, w: 4.5 },
  { tier: 10, side: 0, u: -58, w: 4 },
];

export function buildCrown(ctx, A, tiers, rng, out) {
  const top = tiers[tiers.length - 1];
  const deckW = top.W + 20;
  const dh = deckW / 2;
  const y0 = top.yt;
  const deckT = 10;
  const yp = y0 + deckT; // plaza level
  out.plazaY = yp;
  out.deckHalf = dh;
  const tint = [1.24, 1.18, 1.07];

  // --- deck slab with heavy cornice and a glyph frieze -------------------------------------
  A.stone.aabb(-dh + 0.01, y0, -dh + 0.01, dh - 0.01, yp, dh - 0.01, tint);
  for (const a of SIDES) {
    sput(A.stone, BOX, a, -0.6, yp - 0.6, dh + 0.3, 2 * dh + 1.2, 1.4, 1.8, [1.16, 1.11, 1.04]);
    sput(A.stone, BOX, a, -0.3, yp - 1.9, dh + 0.1, 2 * dh + 0.6, 1.2, 1.2, tint);
    sput(A.glyph, BOX, a, 0, y0 + 3.3, dh + 0.05, 2 * dh - 0.5, 3.0, 0.4, [1.35, 1.2, 1.05]);
    sput(A.stone, BOX, a, -0.4, y0 + 0.5, dh + 0.2, 2 * dh + 0.8, 1.0, 1.2, [0.95, 0.92, 0.88]);
  }
  // corbels under the deck overhang
  {
    const d = dh - top.hw;
    const step = top.bay * 2;
    const n = Math.floor((2 * top.hw - 8) / step);
    for (const a of SIDES) {
      for (let k = 0; k <= n; k++) {
        const u = -n * step * 0.5 + k * step;
        if (Math.abs(u) < top.h / 1.25 / 2 + 3) continue;
        for (let L = 0; L < 3; L++) {
          const len = (d + 0.5) * (1 - L * 0.3);
          sput(A.stone, BOX, a, u, y0 - 0.8 - L * 1.6, top.hw - 0.5 + len / 2, 2.0 - L * 0.25, 1.6, len, tint);
        }
      }
    }
  }
  // the four great pendants under the deck corners
  {
    const pendant = toTemplate(new THREE.CylinderGeometry(Math.SQRT1_2, 0.02, 1, 4, 1, false, Math.PI / 4).translate(0, -0.5, 0).toNonIndexed());
    const collar = frustumTemplate(0.7);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * (dh - 3.2), z = sz * (dh - 3.2);
      const len = 46 + rng() * 10;
      if (sx === 1 && sz === 1) {
        // this one fell: a stump of the collar remains, the obelisk lies broken on the mesa
        A.stone.put(collar, x, y0 - 2.5, z, 7, 2.5, 7, Math.PI / 4, 1.0);
        A.stone.put(pendant, x, y0 - 2.5, z, 4.6, 4, 4.6, Math.PI / 4, 0.9);
        out.fallenPendants.push({ x, z, w: 4.6, len, big: true });
        continue;
      }
      A.stone.put(collar, x, y0 - 2.5, z, 7, 2.5, 7, Math.PI / 4, 1.05);
      A.stone.put(pendant, x, y0 - 2.5, z, 4.6, len, 4.6, Math.PI / 4, 1.08);
      A.gold.box(x, y0 - 2.5 - len * 0.12, z, 4.1, 0.8, 4.1, Math.PI / 4, 1);
      A.gold.box(x, y0 - 2.5 - len * 0.3, z, 3.3, 0.5, 3.3, Math.PI / 4, 1);
      out.lamps.push({ x, y: y0 - 2.5 - len - 1.0, z, s: 1.6 });
    }
  }

  // --- rim parapet with pedestals; gaps at the spouts ------------------------------------------
  const spouts = [];
  RIM_FALLS.forEach((f) => spouts.push({ a: SIDES[f.side], u: f.u, w: f.w }));
  const rP = dh - 1.2;
  for (const a of SIDES) {
    const gaps = spouts.filter((s) => s.a === a).map((s) => [s.u - s.w / 2 - 1.5, s.u + s.w / 2 + 1.5]);
    const step = 7.5;
    const n = Math.floor((2 * rP) / step);
    for (let k = 0; k < n; k++) {
      const u0 = -rP + k * step, u1 = u0 + step;
      const inGap = gaps.some(([g0, g1]) => u1 > g0 && u0 < g1);
      if (inGap) continue;
      sput(A.stone, BOX, a, (u0 + u1) / 2, yp + 0.7, rP, step - 1.3, 1.4, 0.8, tint);
      sput(A.stone, BOX, a, (u0 + u1) / 2, yp + 1.5, rP, step - 1.3, 0.25, 1.0, tint);
      sput(A.stone, BOX, a, u0, yp + 1.0, rP, 1.4, 2.0, 1.4, tint);
      sput(A.stone, BOX, a, u0, yp + 2.2, rP, 0.9, 0.5, 0.9, [1.2, 1.1, 0.9]);
    }
  }

  // --- source basin around the crown ziggurat and channels to the spouts ------------------
  const bIn = 44, bOut = 63;
  const wy = yp + 0.45;
  out.waterQuads = [];
  // basin rim walls
  for (const a of SIDES) {
    sput(A.stone, BOX, a, 0, yp + 0.6, bOut + 0.8, 2 * bOut + 3.2, 1.2, 1.6, tint);
    sput(A.stone, BOX, a, 0, yp + 0.35, bIn - 0.2, 2 * bIn, 0.7, 0.8, tint);
  }
  out.waterQuads.push({ ring: true, rIn: bIn, rOut: bOut, y: wy });
  for (const s of spouts) {
    const cw = s.w * 0.55;
    // channel walls
    sput(A.stone, BOX, s.a, s.u - cw / 2 - 0.5, yp + 0.5, (bOut + dh) / 2, 1.0, 1.0, dh - bOut - 0.5, tint);
    sput(A.stone, BOX, s.a, s.u + cw / 2 + 0.5, yp + 0.5, (bOut + dh) / 2, 1.0, 1.0, dh - bOut - 0.5, tint);
    out.waterQuads.push({ a: s.a, u: s.u, w: cw, r0: bOut + 1.6, r1: dh + 0.6, y: wy - 0.1 });
    // spout lip projecting over the edge
    sput(A.stone, BOX, s.a, s.u, yp - 0.2, dh + 1.2, cw + 2.4, 1.0, 3.0, [1.0, 0.96, 0.9]);
    sput(A.stone, BOX, s.a, s.u - cw / 2 - 0.6, yp + 0.4, dh + 1.2, 1.0, 1.6, 3.0, tint);
    sput(A.stone, BOX, s.a, s.u + cw / 2 + 0.6, yp + 0.4, dh + 1.2, 1.0, 1.6, 3.0, tint);
    const [x, z] = sideToXZ(s.a, s.u, dh + 2.6);
    out.falls.push({ x, y: wy, z, a: s.a, w: s.w, drop: 250 + rng() * 40, v0: 5.5 });
  }

  // spout lips for the gallery falls (the water issues through the balustrade)
  for (const f of TIER_FALLS) {
    const t = tiers[f.tier];
    const a = SIDES[f.side];
    const cw = f.w * 0.6;
    sput(A.stone, BOX, a, f.u, t.yf - 0.1, t.hw + 1.0, cw + 1.8, 0.8, 2.4, [1.0, 0.96, 0.9]);
    sput(A.stone, BOX, a, f.u - cw / 2 - 0.5, t.yf + 0.5, t.hw + 1.0, 0.8, 1.4, 2.4, tint);
    sput(A.stone, BOX, a, f.u + cw / 2 + 0.5, t.yf + 0.5, t.hw + 1.0, 0.8, 1.4, 2.4, tint);
    sput(A.gold, BOX, a, f.u, t.yf + 1.4, t.hw + 1.9, cw + 2.4, 0.35, 0.6, 1);
  }

  // --- stelae along the axes and corner kiosks ---------------------------------------------
  for (const a of SIDES) {
    for (let k = 0; k < 7; k++) {
      const r = 76 + k * 10;
      for (const side of [-1, 1]) {
        const u = side * 9;
        const [x, z] = sideToXZ(a, u, r);
        if (spouts.some((s) => s.a === a && Math.abs(s.u - u) < s.w)) continue;
        const h = 4 + rng() * 3;
        if (rng() < 0.15) {
          A.stone.box(x, yp + 0.4, z, 1.4, 0.8, h, rng() * 3, tint, 0, Math.PI / 2 - 0.1); // toppled
          continue;
        }
        A.stone.box(x, yp + h / 2, z, 1.4, h, 0.7, a, tint);
        A.gold.box(x, yp + h + 0.2, z, 1.0, 0.4, 0.5, a, 1);
      }
    }
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = sx * (dh - 14), cz = sz * (dh - 14);
    A.stone.box(cx, yp + 0.6, cz, 14, 1.2, 14, 0, tint);
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) A.stone.box(cx + px * 5, yp + 1.2 + 5, cz + pz * 5, 1.4, 10, 1.4, 0, tint);
    A.stone.box(cx, yp + 11.7, cz, 13, 1.0, 13, 0, tint);
    A.terra.put(frustumTemplate(0.08), cx, yp + 12.2, cz, 12.4, 6.5, 12.4, 0, 1);
    A.gold.box(cx, yp + 18.9, cz, 0.6, 1.2, 0.6, 0, 1);
  }

  // --- pavement: raised bands in concentric squares and diagonal causeways; four sacred groves ---
  const bandT = [1.3, 1.24, 1.12];
  for (const r of [78, 108, 134]) {
    for (const a of SIDES) sput(A.stone, BOX, a, -0.9, yp + 0.12, r, 2 * r + 1.8, 0.24, 1.8, bandT);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    // grove: a raised bed with a terracotta kerb, trees handed to the garden module
    const gx = sx * 104, gz = sz * 104;
    const gw = 34;
    A.stone.box(gx, yp + 0.5, gz, gw, 1.0, gw, 0, [0.9, 0.85, 0.75]);
    for (const a of SIDES) {
      const s2 = Math.sin(a), c2 = Math.cos(a);
      A.terra.box(gx + s2 * (gw / 2), yp + 0.8, gz + c2 * (gw / 2), a % Math.PI === 0 ? gw + 1 : 1, 1.6, a % Math.PI === 0 ? 1 : gw + 1, 0, 1);
    }
    for (let k = 0; k < 9; k++) {
      const tx = gx + (rng() - 0.5) * (gw - 6), tz = gz + (rng() - 0.5) * (gw - 6);
      if (Math.abs(Math.abs(tx - gx) - Math.abs(tz - gz)) < 3 && rng() < 0.7) continue; // keep the diagonal clear
      out.plazaTrees.push({ x: tx, y: yp + 1.0, z: tz, size: 0.9 + rng() * 0.6 });
    }
  }

  // --- crown ziggurat (upright) -----------------------------------------------------------------
  const steps = [78, 66, 54, 43, 33, 24];
  const sh = 6.6;
  let y = yp;
  steps.forEach((w, k) => {
    const tt = [1.12 - k * 0.01, 1.07, 0.98];
    A.stone.box(0, y + sh / 2, 0, w, sh, w, 0, tt);
    for (const a of SIDES) {
      sput(A.stone, BOX, a, 0, y + sh - 0.3, w / 2 + 0.2, w + 0.8, 0.6, 0.8, [1.18, 1.12, 1.04]);
      if (k % 2 === 1) sput(A.glyph, BOX, a, 0, y + sh * 0.45, w / 2 + 0.05, w - 4, 1.8, 0.3, [1.35, 1.2, 1.05]);
    }
    y += sh;
  });
  const zTop = y;
  // front stair, facing +z (the right way up)
  {
    const rise = 0.5;
    const nS = Math.round((zTop - yp) / rise);
    const zFrom = steps[steps.length - 1] / 2;
    const zTo = steps[0] / 2 + 26;
    const run = (zTo - zFrom) / nS;
    for (let j = 0; j < nS; j++) {
      const z = zTo - (j + 0.5) * run;
      const yy = yp + (j + 1) * rise;
      A.stone.box(0, (yp + yy) / 2, z, 9, yy - yp, run + 0.02, 0, [1.06, 1.02, 0.95]);
    }
    for (const sx of [-1, 1]) {
      const pitch = Math.atan2(zTop - yp, zTo - zFrom);
      const len = Math.hypot(zTop - yp, zTo - zFrom);
      A.stone.put(BOX, sx * 5.2, (yp + zTop) / 2 + 0.6, (zFrom + zTo) / 2, 1.4, 1.6, len, 0, tint, pitch);
    }
  }
  // shrine
  const cella = 15;
  const ch = 11;
  A.plaster.box(0, zTop + ch / 2, 0, cella, ch, cella, 0, [1.05, 0.7, 0.5]);
  for (const a of SIDES) {
    sput(A.stone, BOX, a, 0, zTop + ch - 0.6, cella / 2 + 0.2, cella + 1.4, 1.2, 1.2, tint);
    for (const u of [-cella / 2 + 0.6, cella / 2 - 0.6]) sput(A.stone, BOX, a, u, zTop + ch / 2, cella / 2 + 0.1, 1.4, ch, 1.4, tint);
    sput(A.glow, BOX, a, 0, zTop + 3.4, cella / 2 + 0.03, 3.4, 6.4, 0.1, 1.2);
    sput(A.gold, BOX, a, 0, zTop + 7.2, cella / 2 + 0.2, 5, 0.6, 0.6, 1);
  }
  const roofY = zTop + ch;
  A.gold.put(frustumTemplate(0.18), 0, roofY, 0, cella + 1.6, 7, cella + 1.6, 0, 1);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    A.gold.put(frustumTemplate(0.05), sx * (cella / 2 + 0.2), roofY, sz * (cella / 2 + 0.2), 1.2, 4.5, 1.2, 0, 1);
  }

  // --- spire: a pale stone needle banded in gold, four minor needles at the shrine corners ----
  const sp0 = roofY + 6.2;
  const H = 172;
  const needle = frustumTemplate(0.1);
  const band = frustumTemplate(0.96);
  const w0 = 4.6;
  A.stone.put(frustumTemplate(0.62), 0, sp0 - 1.5, 0, 8, 6, 8, Math.PI / 4, [1.3, 1.25, 1.15]);
  A.stone.put(needle, 0, sp0 + 4, 0, w0, H, w0, Math.PI / 4, [1.35, 1.28, 1.16]);
  // flush gold bands where the needle's width is known: width(f) = w0 * (1 - 0.9 f)
  for (const f of [0.08, 0.2, 0.34, 0.5, 0.64, 0.76]) {
    const w = w0 * (1 - 0.9 * f) + 0.35;
    A.gold.put(band, 0, sp0 + 4 + H * f, 0, w, 1.2 + (1 - f) * 1.2, w, Math.PI / 4, 1);
  }
  // the top 16% sheathed in gold
  const fg = 0.84;
  A.gold.put(frustumTemplate(0.1 / (1 - 0.9 * fg) * 0.9), 0, sp0 + 4 + H * fg, 0, w0 * (1 - 0.9 * fg) + 0.12, H * (1 - fg), w0 * (1 - 0.9 * fg) + 0.12, Math.PI / 4, 1);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (cella / 2 + 0.2), z = sz * (cella / 2 + 0.2);
    A.stone.put(needle, x, roofY + 4, z, 1.5, 34, 1.5, Math.PI / 4, [1.3, 1.24, 1.12]);
    A.gold.put(band, x, roofY + 4 + 10, z, 1.2, 0.8, 1.2, Math.PI / 4, 1);
  }
  const tipY = sp0 + 4 + H;
  A.tip.put(toTemplate(new THREE.IcosahedronGeometry(1, 1)), 0, tipY + 3.2, 0, 1.9, 2.3, 1.9, 0, 1);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    A.gold.put(BOX, Math.cos(a) * 2.4, tipY + 3.2, Math.sin(a) * 2.4, 0.22, 6.2, 0.22, 0, 1);
  }
  A.gold.put(frustumTemplate(0.05), 0, tipY + 6.2, 0, 3.4, 5, 3.4, Math.PI / 4, 1);
  out.spireTip = [0, tipY + 3.2, 0];
  out.crownTop = zTop;
}
