// Descending Temple — what stands on the mesa (not tilted): the stepped dais and the plinth the
// tip hovers above, the raised reflecting pool with its causeway, fallen fragments under every
// broken corner (and the pendants that dropped), a ring of toppled blocks, the worn processional
// way to the mesa edge, and a stair cut diagonally down the cliff.

import * as THREE from 'crownfall-world-three';
import { BOX, frustumTemplate, toTemplate } from './temple-geo.js';
import { BITES } from './temple-tiers.js';

const STONE = [1.18, 1.12, 1.02];

export function buildBase(ctx, A, P) {
  const { rng, groundAt, daisTop, plinthTop, gMin, out, tiers } = P;
  const res = { pools: [] };

  // --- dais (3 steps) and plinth ---------------------------------------------------------
  const daisW = [53, 42, 33];
  daisW.forEach((w, k) => {
    const top = daisTop - (2 - k) * 0.55;
    A.stone.aabb(-w / 2, gMin - 3, -w / 2, w / 2, top, w / 2, [STONE[0] * 0.97, STONE[1] * 0.97, STONE[2] * 0.97]);
  });
  const pw = 13;
  const pTop0 = plinthTop - 1.2;
  A.stone.aabb(-pw / 2, daisTop - 0.5, -pw / 2, pw / 2, pTop0, pw / 2, STONE);
  A.stone.aabb(-pw / 2 - 0.6, daisTop - 0.2, -pw / 2 - 0.6, pw / 2 + 0.6, daisTop + 1.0, pw / 2 + 0.6, STONE);
  A.stone.aabb(-pw / 2 - 0.5, pTop0 - 1.0, -pw / 2 - 0.5, pw / 2 + 0.5, pTop0, pw / 2 + 0.5, [1.14, 1.09, 1.0]);
  A.glyph.aabb(-pw / 2 - 0.08, daisTop + 3.2, -pw / 2 - 0.08, pw / 2 + 0.08, daisTop + 5.4, pw / 2 + 0.08, [1.35, 1.2, 1.05]);
  A.stone.aabb(-5.5, pTop0, -5.5, 5.5, pTop0 + 0.6, 5.5, STONE);
  A.stone.aabb(-4.2, pTop0 + 0.6, -4.2, 4.2, plinthTop, 4.2, [1.12, 1.07, 0.98]);
  // stairs up the dais on the processional side (-x)
  for (let j = 0; j < 5; j++) {
    const x0 = -daisW[0] / 2 - 4 + j * 0.8;
    A.stone.aabb(x0, gMin - 2, -4, x0 + 0.8 + (4 - j) * 0.02, daisTop - 1.65 + (j + 1) * 0.33, 4, STONE);
  }

  // --- raised reflecting pool (square ring) + causeway -----------------------------------
  const pIn = 27, pOut = 92;
  let gMax = -Infinity, gLow = Infinity;
  for (let x = -pOut; x <= pOut; x += 8) {
    for (let z = -pOut; z <= pOut; z += 8) {
      if (Math.max(Math.abs(x), Math.abs(z)) < pIn) continue;
      const g = groundAt(x, z);
      gMax = Math.max(gMax, g);
      gLow = Math.min(gLow, g);
    }
  }
  const wy = gMax + 0.35;
  res.pools.push({ kind: 'ring', rIn: pIn, rOut: pOut, y: wy, causeway: 5 });
  res.poolY = wy;
  // coping walls (outer + inner) down into the ground, with a lip
  for (const [r, th] of [[pOut + 1, 2.0], [pIn - 1, 2.0]]) {
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2;
      const len = 2 * r + th;
      const n = Math.ceil(len / 12);
      for (let k = 0; k < n; k++) {
        const u = -len / 2 + ((k + 0.5) * len) / n;
        const x = Math.cos(a) * u + Math.sin(a) * r;
        const z = -Math.sin(a) * u + Math.cos(a) * r;
        const g = Math.min(groundAt(x, z), gLow);
        A.stone.put(BOX, x, (g - 1.5 + wy + 0.45) / 2, z, len / n + 0.02, wy + 0.45 - (g - 1.5), th, a, STONE);
        A.stone.put(BOX, x, wy + 0.55, z, len / n + 0.02, 0.2, th + 0.5, a, [1.15, 1.1, 1.02]);
      }
    }
  }
  // pool floor (visible through shallow water where the ground dips)
  // causeway across the pool on the -x axis
  A.stone.aabb(-pOut - 2, gLow - 1, -5, -pIn + 1, wy + 0.6, 5, STONE);
  for (let k = 0; k < 9; k++) {
    const x = -pOut + 4 + k * 7.6;
    for (const sz of [-1, 1]) {
      A.stone.box(x, wy + 0.6 + 0.9, sz * 4.4, 0.8, 1.8, 0.8, 0, STONE);
      A.glow.box(x, wy + 0.6 + 2.05, sz * 4.4, 0.45, 0.5, 0.45, 0, 0.8);
    }
  }
  // stepping blocks half-drowned in the pool
  for (let k = 0; k < 16; k++) {
    const ang = rng() * Math.PI * 2;
    const r = pIn + 8 + rng() * (pOut - pIn - 14);
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (Math.abs(z) < 9 && x < 0) continue;
    const s = 2 + rng() * 4.5;
    A.stone.box(x, wy - s * 0.2, z, s * (1 + rng()), s * 0.7, s, rng() * 3, STONE, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.4);
  }

  // --- fallen fragments under each broken corner -----------------------------------------
  const chunk = (x, z, s, tint = STONE) => {
    const g = groundAt(x, z);
    if (Math.max(Math.abs(x), Math.abs(z)) < pOut + 3 && Math.max(Math.abs(x), Math.abs(z)) > pIn - 2) {
      // in the pool: sits on the (hidden) floor, breaks the surface
      A.stone.box(x, wy - 0.4 + s * 0.15, z, s * (0.8 + rng() * 0.9), s * (0.5 + rng() * 0.5), s * (0.7 + rng() * 0.6), rng() * 6, tint, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8);
      return;
    }
    const sy = s * (0.45 + rng() * 0.5);
    A.stone.box(x, g + sy * 0.3, z, s * (0.8 + rng() * 1.1), sy, s * (0.7 + rng() * 0.7), rng() * 6, tint, (rng() - 0.5) * 0.7, (rng() - 0.5) * 0.7);
  };
  for (const b of BITES) {
    const t = tiers[b.tier];
    const n = 10 + Math.round(b.r * 1.3);
    for (let k = 0; k < n; k++) {
      const r = Math.sqrt(rng()) * (b.r + 18);
      const ang = rng() * Math.PI * 2;
      const x = b.x + Math.cos(ang) * r;
      const z = b.z + Math.sin(ang) * r;
      if (Math.hypot(x, z) > 196) continue;
      chunk(x, z, 1.2 + rng() * (k < 5 ? 7 : 3.5));
    }
    // a slab-and-cornice fragment lying on its side
    const x = b.x * 0.94, z = b.z * 0.94;
    if (Math.hypot(x, z) < 190) {
      const g = groundAt(x, z);
      A.stone.box(x, g + 1.6, z, 11 + rng() * 5, t.s * 0.8, 5.5, rng() * 3, STONE, 0.08, 0.22);
      A.stone.box(x + 2, g + 0.5, z - 3, 7, 1.2, 1.6, rng() * 3, [1.14, 1.09, 1.0], 0, 0.1);
    }
  }
  // the pendants that dropped — broken in two, one piece stabbed into the ground
  const pendTpl = toTemplate(new THREE.CylinderGeometry(Math.SQRT1_2, 0.03, 1, 4, 1, false, Math.PI / 4).translate(0, -0.5, 0).toNonIndexed());
  for (const fp of out.fallenPendants) {
    if (fp.big) {
      // the great deck pendant: tip speared into the mesa, the shaft snapped in two across the rim
      const ang = Math.atan2(fp.z, fp.x);
      const r0 = 150;
      const x = Math.cos(ang) * r0, z = Math.sin(ang) * r0;
      const g = groundAt(x, z);
      A.stone.put(pendTpl, x, g + fp.len * 0.28, z, fp.w * 0.62, fp.len * 0.36, fp.w * 0.62, ang, 1.05, 0.38, 0.1);
      const yaw = -ang + Math.PI / 2 + 0.5;
      const x2 = Math.cos(ang - 0.12) * 168, z2 = Math.sin(ang - 0.12) * 168;
      const g2 = groundAt(x2, z2);
      A.stone.put(BOX, x2, g2 + fp.w * 0.32, z2, fp.w * 0.95, fp.w * 0.8, fp.len * 0.34, yaw, 1.04, 0.04, Math.PI / 4);
      const x3 = Math.cos(ang + 0.1) * 176, z3 = Math.sin(ang + 0.1) * 176;
      const g3 = groundAt(x3, z3);
      A.stone.put(BOX, x3, g3 + fp.w * 0.4, z3, fp.w * 1.35, fp.w * 1.1, fp.len * 0.26, yaw + 0.7, 1.04, -0.06, Math.PI / 4 + 0.2);
      A.gold.put(BOX, x3, g3 + fp.w * 0.45, z3, fp.w * 1.28, fp.w * 1.05, 0.8, yaw + 0.7, 1, -0.06, Math.PI / 4 + 0.2);
      for (let k = 0; k < 14; k++) chunk(x2 + (rng() - 0.5) * 30, z2 + (rng() - 0.5) * 30, 1 + rng() * 2.5);
      continue;
    }
    const x = fp.x * 0.97, z = fp.z * 0.97;
    if (Math.hypot(x, z) > 196) continue;
    const g = groundAt(x, z);
    const yaw = rng() * Math.PI * 2;
    // tip half stuck upside down into the ground, leaning
    A.stone.put(pendTpl, x, g + fp.len * 0.45, z, fp.w, fp.len * 0.6, fp.w, yaw, 1.05, 0.25, 0.12);
    // butt end lying nearby
    A.stone.put(BOX, x + 6, g + fp.w * 0.4, z + 4, fp.w * 1.2, fp.w * 0.9, fp.len * 0.35, yaw + 1.2, 1.02, 0, 0.05);
    A.gold.put(BOX, x + 6, g + fp.w * 0.5, z + 4, fp.w * 1.1, fp.w * 0.95, 0.5, yaw + 1.2, 1, 0, 0.05);
  }
  // ring of toppled blocks around the pool
  for (let k = 0; k < 44; k++) {
    const ang = (k / 44) * Math.PI * 2 + rng() * 0.08;
    const r = pOut + 18 + rng() * 26;
    const x = Math.cos(ang) * r * 1.08, z = Math.sin(ang) * r * 1.08;
    if (Math.abs(z) < 12 && x < 0) continue; // keep the processional way clear
    if (Math.hypot(x, z) > 196) continue;
    const g = groundAt(x, z);
    if (rng() < 0.3) {
      // still standing: a stele block
      const h = 4 + rng() * 5;
      A.stone.box(x, g + h / 2 - 0.6, z, 2.2, h, 1.3, -ang + Math.PI / 2, STONE, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12);
    } else chunk(x, z, 2 + rng() * 3.2);
  }

  // --- processional way to the mesa edge (-x axis) ---------------------------------------
  let edge = pOut + 5;
  for (let x = -pOut - 5; x > -330; x -= 2) {
    if (groundAt(x, 0) < gMin - 6) break;
    edge = -x;
  }
  res.edge = edge;
  {
    const x0 = -pOut - 2, x1 = -edge + 2;
    const n = Math.ceil((x0 - x1) / 3.2);
    for (let k = 0; k < n; k++) {
      const xa = x0 - k * ((x0 - x1) / n);
      for (let c = -2; c <= 2; c++) {
        if (rng() < 0.12) continue; // missing slabs
        const z = c * 1.9 + (rng() - 0.5) * 0.2;
        const g = groundAt(xa, z);
        A.stone.box(xa, g + 0.05, z, 3.0, 0.5, 1.75, (rng() - 0.5) * 0.05, [1.02, 0.98, 0.9], (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03);
      }
    }
    // flanking stelae / broken columns
    for (let k = 0; k < 12; k++) {
      const xa = x0 - 6 - k * ((x0 - x1 - 10) / 11);
      for (const sz of [-1, 1]) {
        const z = sz * 9;
        const g = groundAt(xa, z);
        const h = rng() < 0.3 ? 1.5 + rng() * 2 : 5 + rng() * 3;
        A.stone.box(xa, g + h / 2 - 0.5, z, 1.5, h, 1.5, 0, STONE, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1);
        if (h > 4) A.stone.box(xa, g + h, z, 2.1, 0.6, 2.1, 0, [1.14, 1.09, 1.0]);
        else chunk(xa + (rng() - 0.5) * 4, z + sz * (2 + rng() * 2), 1.2 + rng());
      }
    }
    // gate at the brink: two pylons
    for (const sz of [-1, 1]) {
      const x = -edge + 6, z = sz * 7.5;
      const g = groundAt(x, z);
      A.stone.put(frustumTemplate(0.78), x, g - 1, z, 5, 17, 5, 0, STONE);
      A.stone.box(x, g + 16.6, z, 5.2, 1.2, 5.2, 0, [1.14, 1.09, 1.0]);
      A.glyph.box(x, g + 9, z, 4.6, 1.6, 4.6, 0, [1.35, 1.2, 1.05]);
    }
  }

  // --- stair cut diagonally down the cliff -------------------------------------------------
  buildCliffStair(A, P, edge, rng);
  return res;
}

/** Radial distance (from site centre, along local angle) where the ground falls to height y. */
function radiusAtHeight(groundAt, ang, y, rMin = 150, rMax = 340) {
  const cx = Math.cos(ang), cz = Math.sin(ang);
  let a = rMin, b = rMax;
  if (groundAt(cx * a, cz * a) < y) return a;
  if (groundAt(cx * b, cz * b) > y) return b;
  for (let k = 0; k < 22; k++) {
    const m = (a + b) / 2;
    if (groundAt(cx * m, cz * m) > y) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function buildCliffStair(A, P, edge, rng) {
  const { groundAt } = P;
  // start on the -x axis at the brink, descend while sweeping around the mesa (two flights)
  const ang0 = Math.PI; // local -x
  const yTop = groundAt(-edge, 0) - 0.4;
  const flights = [
    { a0: ang0, a1: ang0 + 0.34, y0: yTop, y1: yTop - 62 },
    { a0: ang0 + 0.34, a1: ang0 + 0.02, y0: yTop - 62, y1: yTop - 120 },
  ];
  const rise = 0.55;
  const tint = [1.0, 0.95, 0.86];
  for (const f of flights) {
    const n = Math.round((f.y0 - f.y1) / rise);
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const ang = f.a0 + (f.a1 - f.a0) * t;
      const y = f.y0 - (f.y0 - f.y1) * t;
      const r = radiusAtHeight(groundAt, ang, y) + 0.6;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      const x = cx * r, z = cz * r;
      // tread: 4.5 m deep (mostly inside the rock), 1.2 m wide along the path
      A.stone.put(BOX, x - cx * 1.2, y - 0.6, z - cz * 1.2, 1.25, 1.2, 5.5, Math.atan2(cx, cz), tint);
      // outer retaining wall hanging down the face + parapet
      if (j % 2 === 0) {
        A.stone.put(BOX, x + cx * 1.6, y - 2.5, z + cz * 1.6, 2.6, 5.0 + (j % 4 === 0 ? 2 : 0), 0.9, Math.atan2(cx, cz), [0.95, 0.9, 0.82]);
        A.stone.put(BOX, x + cx * 1.6, y + 0.5, z + cz * 1.6, 2.6, 1.0, 0.7, Math.atan2(cx, cz), tint);
      }
    }
    // landing
    const ang = f.a1;
    const r = radiusAtHeight(groundAt, ang, f.y1) + 1.5;
    const cx = Math.cos(ang), cz = Math.sin(ang);
    A.stone.put(BOX, cx * r, f.y1 - 1.5, cz * r, 7, 3, 7, Math.atan2(cx, cz), tint);
  }
}
