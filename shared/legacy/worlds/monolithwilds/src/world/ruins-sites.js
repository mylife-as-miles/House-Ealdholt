// Ruin archetypes. Each builder takes a placed site { x, z, g, yaw, id } (yaw: local +z = the
// site's "forward": passage axis for gates, downhill for rings) and writes into the RuinBuilder.
// Construction logic is noted per archetype; every one is weathered: tilted, sunk, broken, with
// fallen pieces and rubble at its feet.

import * as THREE from 'crownfall-world-three';
import {
  mat, sub, archPoints, voussoirs, arcadeGeometry, windowWallGeometry, column, fallenColumn,
  rubble, drumGeometry, frustumGeometry, glyphRow, fracturedSlab,
} from './ruins-parts.js';

const TAU = Math.PI * 2;

export function L2W(s, lx, lz) {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return [s.x + c * lx + sn * lz, s.z - sn * lx + c * lz];
}
function gAt(ctx, s, lx, lz) {
  const [wx, wz] = L2W(s, lx, lz);
  return ctx.heightAt(wx, wz);
}
/** Lowest ground over a local rectangle (samples a 3x3 grid). */
function minGround(ctx, s, cx, cz, hw, hd) {
  let m = Infinity;
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) m = Math.min(m, gAt(ctx, s, cx + i * hw, cz + k * hd));
  return m;
}
function frameOf(s) {
  return mat(s.x, 0, s.z, s.yaw);
}
/** Bottom of the amber glyph row nearest to y (see glyphRow). */
function snapCell(y) {
  return glyphRow(y, 1.2);
}

// ===========================================================================
// GATES
// ===========================================================================

/**
 * Pylon gate: two massive battered pylons with flared (cavetto) cornices; between them, lower, a
 * colossal lintel that cracked and sagged into a V (or lost one half, now leaning against a pylon
 * foot). Obsidian jamb panels line the passage; one pylon has lost its crown.
 */
export function gatePylon(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const H = 36 + rng() * 10;
  const open = 12 + rng() * 4;
  const pw = 25 + rng() * 6;
  const pd = 12 + rng() * 3;
  const tap = 0.64;
  const body = rng() < 0.35 ? M.basalt : M.stone;
  const x0 = open / 2 + pw / 2;
  const g = Math.min(minGround(ctx, s, -x0, 0, pw / 2, pd / 2), minGround(ctx, s, x0, 0, pw / 2, pd / 2));
  const base = g - 2.5;
  const brokenSide = rng() < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const px = side * x0;
    b.setGround(g, 6);
    b.box(M.basalt, sub(F, px, base, 0), pw + 3, 3.4, pd + 3, { taper: 0.94, jit: 0.2 });
    // inner face vertical, outer face and front/back battered
    const shift = [-side * pw * (1 - tap) * 0.5, 0];
    const Hs = side === brokenSide ? H * (0.78 + rng() * 0.1) : H;
    b.box(body, sub(F, px, base + 3.4, 0), pw, Hs, pd, { taper: [1 - (1 - tap) * (Hs / H), 1 - 0.2 * (Hs / H)], shift: [shift[0] * (Hs / H), 0] });
    // string courses at thirds, sized to the shaft at that height
    for (const t of [0.34, 0.67]) {
      if (t * H > Hs - 2) continue;
      const w = pw * (1 - (1 - tap) * t) + 1.0;
      const d = pd * (1 - 0.2 * t) + 1.0;
      b.box(M.smooth, sub(F, px + shift[0] * t, base + 3.4 + H * t, 0), w, 1.0, d);
    }
    const topY = base + 3.4 + Hs;
    const wt = pw * (1 - (1 - tap) * (Hs / H));
    const dt = pd * (1 - 0.2 * (Hs / H));
    const cx = px + shift[0] * (Hs / H);
    if (side === brokenSide) {
      fracturedSlab(b, body, sub(F, cx, topY - 0.5, 0), wt, dt, side < 0 ? 8 + rng() * 4 : 1, side < 0 ? 1 : 8 + rng() * 4, rng, { jag: 1.2 });
    } else {
      // cavetto cornice: a flaring crown and a thin cap slab
      b.box(M.smooth, sub(F, cx, topY, 0), wt, 2.6, dt, { taper: [1.22, 1.22] });
      b.box(M.smooth, sub(F, cx, topY + 2.6, 0), wt * 1.26, 0.9, dt * 1.26);
    }
    // obsidian jamb panel on the passage face
    const jx = px - side * (pw / 2 - 0.05);
    b.setGround(-1e9);
    b.box(M.obsidian, sub(F, jx, g + 1.5, 0), 0.5, H * 0.5, pd * 0.5, null);
    // front and back faces: a framed inscribed stele panel set into the batter, and a row of
    // small dark windows under the crown
    const faceTilt = Math.atan2(pd * 0.1, H);
    for (const fz of [-1, 1]) {
      const pwid = pw * 0.12;
      const ph = H * 0.55;
      const y0 = base + 3.4 + H * 0.12;
      const zf = fz * (pd / 2 - pd * 0.1 * 0.12);
      const P = sub(F, px + shift[0] * 0.3, y0, zf, 0, -fz * faceTilt, 0);
      b.box(M.smooth, P, pwid + 1.6, 0.9, 1.0);
      b.box(M.smooth, sub(P, 0, ph + 0.9, 0), pwid + 1.6, 1.1, 1.1);
      for (const e of [-1, 1]) b.box(M.smooth, sub(P, e * (pwid / 2 + 0.4), 0.9, 0), 0.8, ph, 0.9);
      b.box(M.glyph, sub(P, 0, 0.9, -fz * 0.1), pwid, ph, 0.6);
      if (Hs > H * 0.9) {
        const wy = base + 3.4 + H * 0.84;
        const zw = fz * (pd / 2 - pd * 0.1 * 0.84) + fz * 0.05;
        for (let k = -1; k <= 1; k++) b.box(M.basalt, sub(F, px + shift[0] * 0.84 + k * pw * 0.18, wy, zw, 0, -fz * faceTilt, 0), 1.4, 2.4, 0.3, null, 0.05);
      }
    }
    b.setGround(g, 6);
    // great blocks fallen from the crown, leaning against the foot
    for (let k = 0; k < 3; k++) {
      const [wx, wz] = L2W(s, px + side * (pw * 0.3 + rng() * pw * 0.4), (rng() < 0.5 ? -1 : 1) * (pd * 0.55 + rng() * 5));
      const gy = ctx.heightAt(wx, wz);
      const sz = 2.5 + rng() * 2.5;
      b.setGround(gy, 3);
      b.box(body, mat(wx, gy - sz * 0.25, wz, rng() * TAU, (rng() - 0.5) * 0.7, (rng() - 0.5) * 0.7), sz * 1.6, sz, sz * 1.1, { jit: 0.2 });
    }
    b.setGround(g, 6);
  }
  // lintel: spans the passage at ~70% height, its ends embedded in the pylons' inner faces
  const top = base + 3.4 + H * 0.68;
  const len = open + 5;
  const lh = 7 + rng() * 2;
  const ld = pd * 0.72;
  const mode = rng();
  b.setGround(g, 6);
  if (mode < 0.55) {
    // cracked in the middle: each half pivots on the pylon's inner edge, inner ends droop
    const crack = (rng() - 0.5) * open * 0.3;
    for (const side of [-1, 1]) {
      const pivotX = side * (open / 2);
      const theta = (0.07 + rng() * 0.07) * side;
      const outer = side * (len / 2);
      const hl = Math.abs(outer - crack);
      const cx = (outer + crack) / 2 - pivotX;
      const piv = sub(F, pivotX, top, 0, 0, 0, theta);
      b.box(M.stone, sub(piv, cx, 0, 0), hl - 0.3, lh, ld, { jit: 0.1 });
      const gy = snapCell(top + lh * 0.5) - top;
      b.box(M.glyph, sub(piv, cx, gy, 0), hl - 1.2, 1.2, ld + 0.16);
    }
    rubble(ctx, b, M.stone, s.x, s.z, 26, open * 0.8, rng, { size: [0.5, 2.2] });
  } else {
    // one half fell: the standing half cantilevers, the fallen half leans in the passage
    const keep = rng() < 0.5 ? -1 : 1;
    const hl = len * 0.55;
    const cx = keep * (len / 2 - hl / 2);
    b.box(M.stone, sub(F, cx, top, 0), hl, lh, ld, { jit: 0.1 });
    b.box(M.glyph, sub(F, cx, snapCell(top + lh * 0.5), 0), hl - 1.2, 1.2, ld + 0.16);
    const fx = -keep * (open / 2 - 1.5);
    const [wx, wz] = L2W(s, fx, 6);
    const fg = ctx.heightAt(wx, wz);
    b.setGround(fg, 4);
    b.box(M.stone, sub(F, fx, fg - 1.5, 6, 0.3 * keep, -1.05, keep * 0.35), len * 0.45, lh, ld, { jit: 0.15 });
    rubble(ctx, b, M.stone, wx, wz, 30, 10, rng, { size: [0.5, 2.5] });
  }
  // threshold slabs down the passage
  for (let k = -3; k <= 3; k++) {
    if (rng() < 0.3) continue;
    const z = k * 3.2;
    const tg = gAt(ctx, s, 0, z);
    b.setGround(tg, 2);
    b.box(M.basalt, sub(F, (rng() - 0.5) * 0.5, tg - 0.6, z, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.06), open - 0.8, 0.95, 3.0, { jit: 0.08 });
  }
}

/**
 * Slab gate: a single colossal monolith pierced by a tall pointed opening, fractured along one
 * great diagonal so it looks snapped rather than built down. A vertical inscription climbs from
 * the apex of the opening to the break; the pieces that fell lie at the foot of the low side.
 */
export function gateSlab(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const W = 44 + rng() * 12;
  const H = 54 + rng() * 16;
  const depth = 7 + rng() * 2;
  const span = 14 + rng() * 4;
  const spring = 13 + rng() * 5;
  const rise = H * 0.34;
  const g = minGround(ctx, s, 0, 0, W / 2, depth);
  const lean = (rng() - 0.5) * 0.06;
  const base = g - 3;
  const body = rng() < 0.55 ? M.smooth : M.basalt;
  const S = sub(F, 0, base, 0, 0, (rng() - 0.5) * 0.03, lean);
  // fractured top: high on one side, a jagged line falling to ~60% on the other
  const hiSide = rng() < 0.5 ? -1 : 1;
  const top = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const x = W / 2 - (W * i) / n; // right to left
    const t = hiSide > 0 ? (x + W / 2) / W : (W / 2 - x) / W; // 1 at the high side
    let y = H * (0.6 + 0.4 * Math.pow(t, 1.2));
    if (i > 0 && i < n) y += (rng() - 0.5) * 4.5 - (rng() < 0.2 ? 5 : 0);
    top.push([x, Math.max(spring + 3 + rise + 4, y)]);
  }
  b.setGround(g, 7);
  const op = [{ cx: 0, span, spring: spring + 3, rise, kind: 'pointed' }];
  b.geo(body, arcadeGeometry(W, H, op, depth, 20, top), S);
  // stepped reveals around the opening, each proud of the faces
  for (let k = 1; k <= 2; k++) {
    const fw = span + 3.0 * k + 1;
    const fh = spring + 3 + rise + 1.6 * k + 0.8;
    b.geo(k === 1 ? M.stone : body, arcadeGeometry(fw, fh, op, depth + 0.8 * k, 20), S);
  }
  // vertical inscription from the apex toward the break (both faces)
  const y0 = spring + 3 + rise + 1.6 * 2 + 1.5;
  const yTop = Math.min(top[Math.floor(n / 2)][1], top[Math.ceil(n / 2)][1]) - 3;
  if (yTop - y0 > 4) b.box(M.glyph, sub(S, 0, y0, 0), 2.6, yTop - y0, depth + 0.3);
  // plinth courses along the foot
  b.box(M.stone, sub(S, 0, 0, 0), W + 3, 4.2, depth + 3, { jit: 0.15 });
  // the fallen top: great fragments at the foot of the low side
  for (let k = 0; k < 4; k++) {
    const [wx, wz] = L2W(s, -hiSide * (W * 0.25 + rng() * W * 0.35), (rng() < 0.5 ? -1 : 1) * (depth + 3 + rng() * 10));
    const gy = ctx.heightAt(wx, wz);
    b.setGround(gy, 4);
    const sz = 5 + rng() * 6;
    b.box(body, mat(wx, gy - sz * 0.3, wz, rng() * TAU, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9), sz * 1.3, sz * 0.8, depth * 0.9, { jit: 0.4 });
  }
  for (const side of [-1, 1]) {
    const [wx, wz] = L2W(s, -hiSide * W * 0.3, side * (depth + 6));
    rubble(ctx, b, body, wx, wz, 26, 10, rng, { size: [0.8, 2.8], rx: W * 0.4, rz: 7, yaw: s.yaw });
  }
}

/**
 * Receding arches: three free-standing arches in a row, each smaller than the last — a forced
 * perspective aimed at something that is no longer there. The farthest has half-collapsed.
 */
export function gateTriple(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const n = 3;
  const base = 1.45;
  const kind = rng() < 0.5 ? 'pointed' : 'round';
  const body = rng() < 0.5 ? M.marble : M.stone;
  for (let k = 0; k < n; k++) {
    const sc = Math.pow(0.78, k) * base;
    const z = k * 30;
    const span = 14 * sc;
    const pier = 4.6 * sc;
    const springH = 13 * sc;
    const depth = 4.8 * sc;
    const g = minGround(ctx, s, 0, z, span / 2 + pier, depth);
    const A = sub(F, 0, g - 1.5, z, (rng() - 0.5) * 0.05);
    b.setGround(g, 5);
    for (const side of [-1, 1]) {
      const px = side * (span / 2 + pier / 2);
      b.box(M.basalt, sub(A, px, 0, 0), pier + 1.6, 2.0, depth + 1.6, { jit: 0.1 });
      b.box(body, sub(A, px, 2.0, 0), pier, springH, depth);
      b.box(M.smooth, sub(A, px, springH + 1.2, 0), pier + 0.8, 0.8, depth + 0.8);
    }
    const rise = kind === 'pointed' ? span * 0.72 : span / 2;
    const pts = archPoints(kind, span, rise, 15);
    const to = k === n - 1 ? 0.45 + rng() * 0.2 : 1;
    voussoirs(b, M.smooth, sub(A, 0, springH + 2.0, 0), pts, { thick: 1.9 * sc + 0.4, depth, gap: 0.1, rng, slip: 0.25, to, key: 1.3 });
    if (to >= 1) {
      // attic block with an inscription, spanning over the arch
      const aw = span + pier * 2;
      const ay = springH + 2.0 + rise + 1.9 * sc + 0.4;
      b.box(body, sub(A, 0, ay - 1.2, 0), aw, 3.2 * sc + 1.2, depth);
      b.box(M.glyph, sub(A, 0, snapCell(g - 1.5 + ay + 0.4) - (g - 1.5), 0), aw - 2, 1.2, depth + 0.16);
      fracturedSlab(b, body, sub(A, 0, ay + 3.2 * sc, 0), aw, depth, rng() * 3.5, rng() * 3.5, rng, { jag: 0.7 });
    } else {
      const [wx, wz] = L2W(s, 3, z + 5);
      rubble(ctx, b, M.smooth, wx, wz, 18, 8, rng, { size: [0.8, 2.2] });
    }
  }
}

/** Ring gate: a full circle of voussoirs standing on edge, half sunk, its crown broken open. */
export function gateRing(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const R = 19 + rng() * 6;
  const thick = 4.4;
  const depth = 6.5;
  const g = minGround(ctx, s, 0, 0, R, depth);
  const cy = g + R * 0.72;
  const tilt = (rng() - 0.5) * 0.12;
  const C = sub(F, 0, cy, 0, (rng() - 0.5) * 0.1, tilt, (rng() - 0.5) * 0.06);
  const N = 30;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = Math.PI * 0.5 - (i / N) * TAU; // start at the top
    pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const gapAt = rng() < 0.7 ? [0, 1 + Math.floor(rng() * 2)] : [N, 0];
  b.setGround(g, 6);
  voussoirs(b, rng() < 0.5 ? M.smooth : M.marbleSmooth, C, pts, {
    thick, depth, gap: 0.12, rng, slip: 0.35,
    skip: (i) => i < gapAt[1] || i >= N - gapAt[1] + 1 - (gapAt[1] > 1 ? 1 : 0),
  });
  // the missing crown stones still hover above the gap, a few metres up, slowly out of true —
  // as though the ring had never given up trying to close
  if (gapAt[1] > 0) {
    const lift = sub(C, 0, 3.2 + rng() * 2.5, 0, 0, 0, (rng() - 0.5) * 0.1);
    b.setGround(-1e9);
    voussoirs(b, M.smooth, lift, pts, { thick, depth: depth * 0.94, gap: 0.2, rng, slip: 0.4, skip: (i) => !(i < gapAt[1] || i >= N - gapAt[1] + 1 - (gapAt[1] > 1 ? 1 : 0)) });
    b.setGround(g, 6);
  }
  // a thin inner lining ring of inscribed obsidian
  const pin = pts.map(([x, y]) => [x * 0.985, y * 0.985]);
  voussoirs(b, M.obsidian, C, pin, { thick: 0.5, depth: depth * 0.6, gap: 0.05, skip: (i) => i < gapAt[1] + 2 || i >= N - gapAt[1] - 1 });
  // cradle blocks where it meets the ground
  for (const side of [-1, 1]) {
    const x = side * R * 0.78;
    const gg = gAt(ctx, s, x, 0);
    b.box(M.basalt, sub(F, x, gg - 2, 0), 7, 4.5, depth + 4, { taper: [0.7, 0.85], jit: 0.2 });
  }
  const [wx, wz] = L2W(s, 0, 8);
  rubble(ctx, b, M.smooth, wx, wz, 16, 10, rng, { size: [0.8, 2.4] });
}

// ===========================================================================
// COLONNADE
// ===========================================================================

/**
 * A broken peristyle fragment: one or two rows of fluted drum columns on a stepped stylobate.
 * Columns stand whole (with capitals and architraves), broken, as stumps, or lie where they fell.
 */
export function colonnade(ctx, b, M, rng, s, opts = {}) {
  const F = frameOf(s);
  const rows = opts.rows ?? (rng() < 0.55 ? 2 : 1);
  const n = opts.count ?? 6 + Math.floor(rng() * 6);
  const sp = 10 + rng() * 2;
  const H = opts.H ?? 21 + rng() * 8;
  const r = 1.45 + rng() * 0.4;
  const rowGap = 17 + rng() * 5;
  const shaft = opts.material ?? (rng() < 0.6 ? M.marbleSmooth : M.smooth);
  const hover = !!opts.hover;
  const plat = shaft === M.marbleSmooth ? M.marble : M.stone;
  const Lx = (n - 1) * sp;
  const Lz = (rows - 1) * rowGap;
  const hw = Lx / 2 + 5;
  const hd = Lz / 2 + 5;
  // stylobate: level top at a little above the median ground; steps descend to the lowest point
  const gs = [];
  for (let i = -2; i <= 2; i++) for (let k = -1; k <= 1; k++) gs.push(gAt(ctx, s, (i / 2) * hw, k * hd));
  gs.sort((a, c) => a - c);
  const gMin = gs[0];
  const top = opts.drowned ? Math.max(gs[Math.floor(gs.length * 0.5)] + 0.6, -6) : gs[Math.floor(gs.length * 0.6)] + 0.8;
  b.setGround(gMin, 5);
  const slab = 4.2;
  const foot = Math.min(gMin, top - 3) - 1.5;
  for (let step = 0; step < 3; step++) {
    const inset = step * 1.4;
    const yTop = top - (2 - step) * 0.55;
    const w = hw * 2 - inset * 2;
    const d = hd * 2 - inset * 2;
    const nx = Math.max(1, Math.round(w / slab));
    const nz = Math.max(1, Math.round(d / slab));
    if (step < 2) {
      // edge ring of blocks (the inner fill is the next step up)
      const hh = yTop - foot;
      for (let i = 0; i < nx; i++) {
        for (const e of [-1, 1]) {
          if (rng() < 0.1) continue;
          const x = -w / 2 + (i + 0.5) * (w / nx);
          b.box(plat, sub(F, x, foot - (rng() < 0.15 ? rng() * 0.4 : 0), e * (d / 2 - 0.7), (rng() - 0.5) * 0.03), w / nx - 0.08, hh, 1.4, { jit: 0.06 });
        }
      }
      for (let k = 0; k < nz; k++) {
        for (const e of [-1, 1]) {
          if (rng() < 0.1) continue;
          const z = -d / 2 + (k + 0.5) * (d / nz);
          b.box(plat, sub(F, e * (w / 2 - 0.7), foot - (rng() < 0.15 ? rng() * 0.4 : 0), z, (rng() - 0.5) * 0.03), 1.4, hh, d / nz - 0.08, { jit: 0.06 });
        }
      }
    } else {
      // paving: slabs with some missing, some heaved
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          if (rng() < 0.14) continue;
          const x = -w / 2 + (i + 0.5) * (w / nx);
          const z = -d / 2 + (k + 0.5) * (d / nz);
          const heave = rng() < 0.12 ? rng() * 0.3 : 0;
          b.box(plat, sub(F, x, yTop - 2.5 + heave, z, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.04), w / nx - 0.1, 2.5, d / nz - 0.1, { jit: 0.05 });
        }
      }
    }
  }
  // columns
  const state = [];
  for (let row = 0; row < rows; row++) {
    state.push([]);
    for (let i = 0; i < n; i++) {
      const u = rng();
      const st = opts.drowned ? (u < 0.5 ? 'full' : u < 0.85 ? 'broken' : 'stump')
        : hover ? (u < 0.22 ? 'full' : u < 0.85 ? 'broken' : 'stump')
        : u < 0.36 ? 'full' : u < 0.62 ? 'broken' : u < 0.77 ? 'stump' : u < 0.95 ? 'fallen' : 'gone';
      state[row].push(st);
      const x = -Lx / 2 + i * sp;
      const z = -Lz / 2 + row * rowGap;
      const [wx, wz] = L2W(s, x, z);
      const lean = st === 'full' ? [(rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03] : [(rng() - 0.5) * 0.05, (rng() - 0.5) * 0.05];
      if (st === 'gone') continue;
      const broken = st === 'full' ? 1 : st === 'broken' ? 0.3 + rng() * 0.55 : st === 'stump' ? 0.06 + rng() * 0.12 : 0.08;
      column(b, wx, top, wz, { H, r, rng, mat: shaft, capMat: plat, baseMat: plat, broken, lean, bury: 0.2, ry: s.yaw, hover: hover && st === 'broken' });
      if (st === 'fallen') {
        const dir = s.yaw + (row === 0 ? Math.PI : 0) + (rng() - 0.5) * 1.2;
        fallenColumn(ctx, b, wx, wz, { dir, count: 4 + Math.floor(rng() * 4), r, rng, mat: shaft, capMat: plat, spread: 0.6 });
      }
    }
  }
  // architraves spanning consecutive full columns
  const capTop = top + H - 0.2 + 0.2;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n - 1; i++) {
      if (state[row][i] !== 'full' || state[row][i + 1] !== 'full') continue;
      if (rng() < 0.2) continue;
      const x = -Lx / 2 + (i + 0.5) * sp;
      const z = -Lz / 2 + row * rowGap;
      b.setGround(-1e9);
      let gy = snapCell(capTop + 2.4);
      if (gy < capTop + 1.4) gy += 3.6;
      b.box(plat, sub(F, x, capTop, z, 0, 0, (rng() - 0.5) * 0.02), sp + r * 3.4 - 0.1, gy - capTop, r * 3.2, { jit: 0.05 });
      b.box(M.glyph, sub(F, x, gy, z), sp + r * 2.6, 1.2, r * 3.0);
      b.box(plat, sub(F, x, gy + 1.2, z), sp + r * 3.8, 0.7, r * 3.6);
    }
  }
  // a fallen architrave block leaning on the paving
  if (rng() < 0.7) {
    const [wx, wz] = L2W(s, (rng() - 0.5) * Lx, (rng() - 0.5) * (Lz + 8));
    b.setGround(top, 3);
    b.box(plat, mat(wx, top - 0.6, wz, rng() * TAU, (rng() - 0.5) * 0.3, 0.25), sp + 2, 2.1, 3.2, { jit: 0.1 });
  }
  rubble(ctx, b, plat, s.x, s.z, 22 + n * 2, Math.max(hw, hd) + 6, rng, { size: [0.4, 1.8], rx: hw + 8, rz: hd + 8, yaw: s.yaw });
  return { top, hw, hd };
}

// ===========================================================================
// OBELISKS
// ===========================================================================

function obeliskShaft(b, material, m, base, len, taper, cap = true) {
  b.box(material, m, base, len, base, { taper });
  if (cap) {
    const w = base * taper;
    b.box(material, sub(m, 0, len, 0), w, w * 1.1, w, { taper: 0.02 });
  }
}

/** Standing obelisk, leaning, cracked across with the upper section slipped. */
export function obeliskStanding(ctx, b, M, rng, s) {
  const H = 42 + rng() * 18;
  const base = 4.6 + rng() * 1.4;
  const taper = 0.62;
  const mat_ = rng() < 0.55 ? M.glyph : M.obsidian;
  const g = minGround(ctx, s, 0, 0, 5, 5);
  const F = frameOf(s);
  b.setGround(g, 4);
  b.box(M.basalt, sub(F, 0, g - 2, 0), base * 2.6, 2.8, base * 2.6, { jit: 0.15 });
  b.box(M.basalt, sub(F, 0, g + 0.8, 0), base * 2.0, 1.3, base * 2.0, { taper: 0.94 });
  b.box(M.smooth, sub(F, 0, g + 2.1, 0), base * 1.5, 1.0, base * 1.5);
  const leanX = (0.1 + rng() * 0.12) * (rng() < 0.5 ? -1 : 1);
  const leanZ = (rng() - 0.5) * 0.1;
  const S = sub(F, 0, g + 2.6, 0, rng() * 0.6, leanZ, leanX);
  const split = H * (0.45 + rng() * 0.2);
  const t1 = 1 - (1 - taper) * (split / H);
  b.setGround(g, 3);
  b.box(mat_, S, base, split, base, { taper: t1 });
  // slipped upper section
  const U = sub(S, (rng() - 0.5) * 0.4, split + 0.08, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.05);
  obeliskShaft(b, mat_, U, base * t1, H - split, taper / t1);
  rubble(ctx, b, M.basalt, s.x, s.z, 12, 9, rng, { size: [0.4, 1.4] });
}

/** Toppled obelisk: the stub on its pedestal, the shaft broken in two lying half-buried. */
export function obeliskToppled(ctx, b, M, rng, s) {
  const H = 44 + rng() * 18;
  const base = 4.8 + rng() * 1.4;
  const taper = 0.62;
  const mat_ = rng() < 0.6 ? M.smooth : M.marbleSmooth;
  const inscr = rng() < 0.5 ? M.glyph : M.obsidian;
  const F = frameOf(s);
  const g = minGround(ctx, s, 0, 0, 5, 5);
  b.setGround(g, 4);
  b.box(M.basalt, sub(F, 0, g - 2.2, 0, 0, 0.04, -0.05), base * 2.6, 3.0, base * 2.6, { jit: 0.2 });
  b.box(M.basalt, sub(F, 0, g + 0.7, 0, 0.02, 0.05, -0.04), base * 1.9, 1.2, base * 1.9, { taper: 0.94 });
  const stub = 3 + rng() * 4;
  b.box(inscr, sub(F, 0, g + 1.8, 0, 0.1, 0.06, -0.08), base, stub, base, { taper: 1 - (1 - taper) * (stub / H), jit: 0.12 });
  // the shaft fell along +z and broke in two: the first piece still rests its foot on the
  // pedestal's lip, its far end driven into the ground; the second lies further on, rolled
  const dir = s.yaw + (rng() - 0.5) * 0.4;
  const dx = Math.sin(dir);
  const dz = Math.cos(dir);
  const len1 = H * (0.46 + rng() * 0.1);
  const len2 = H - stub - len1 - 1;
  const wBase = base * (1 - (1 - taper) * (stub / H));
  const wMid = wBase - base * (1 - taper) * (len1 / H);
  const wTop = base * taper;
  {
    const footY = g + 2.4;
    const d0 = base * 1.1;
    const d1 = d0 + len1 * 0.97;
    const g1 = ctx.heightAt(s.x + dx * d1, s.z + dz * d1);
    const endY = g1 - wMid * 0.25;
    const pitch = Math.atan2(endY - footY, d1 - d0);
    b.setGround(g1, 4);
    const m = mat(s.x + dx * d0, footY, s.z + dz * d0, dir, Math.PI / 2 - pitch, (rng() - 0.5) * 0.2).multiply(mat(0, 0, -wBase * 0.1));
    obeliskShaft(b, mat_, m, wBase, len1, wMid / wBase, false);
  }
  let d = base * 1.1 + len1 + 2.5 + rng() * 3;
  {
    const midD = d + len2 / 2;
    const px = s.x + dx * midD + dz * (rng() - 0.5) * 4;
    const pz = s.z + dz * midD - dx * (rng() - 0.5) * 4;
    const g0 = ctx.heightAt(s.x + dx * d, s.z + dz * d);
    const g1 = ctx.heightAt(s.x + dx * (d + len2), s.z + dz * (d + len2));
    const pitch = Math.atan2(g1 - g0, len2) - 0.03;
    const gm = ctx.heightAt(px, pz);
    b.setGround(gm, 4);
    const m = mat(px, gm + wMid * 0.08, pz, dir + (rng() - 0.5) * 0.5, Math.PI / 2 - pitch, 0.3 + rng() * 0.5).multiply(mat(0, -len2 / 2, 0));
    obeliskShaft(b, mat_, m, wMid, len2, wTop / wMid, false);
    d += len2;
  }
  // the pyramidion broke off and rolled aside
  const px = s.x + Math.sin(dir + 0.25) * (d + 5);
  const pz = s.z + Math.cos(dir + 0.25) * (d + 5);
  const pg = ctx.heightAt(px, pz);
  b.setGround(pg, 3);
  const w = base * taper;
  b.box(mat_, mat(px, pg - w * 0.3, pz, rng() * TAU, 0.9 + rng() * 0.5, rng() * 0.6), w, w * 1.1, w, { taper: 0.02 });
  rubble(ctx, b, M.basalt, s.x + Math.sin(dir) * H * 0.3, s.z + Math.cos(dir) * H * 0.3, 20, H * 0.45, rng, { size: [0.4, 1.6], rx: 6, rz: H * 0.5, yaw: dir });
}

// ===========================================================================
// GREAT RING
// ===========================================================================

/**
 * A colossal stone wheel half-sunk into a hillside and lying back into the slope, as though it had
 * rolled out of the hill and stopped: a massive band of voussoirs with deep joints, an inscribed
 * amber band round its inner face, a few stones sprung loose and tumbled downhill.
 */
export function greatRing(ctx, b, M, rng, s) {
  const R = 30 + rng() * 12;
  const thick = R * (0.2 + rng() * 0.05);
  const depth = R * (0.26 + rng() * 0.06);
  const F = frameOf(s);
  const gc = gAt(ctx, s, 0, 0);
  const lean = -(0.5 + rng() * 0.35); // lie back into the hill (uphill is -z)
  const roll = (rng() - 0.5) * 0.25;
  const C = sub(F, 0, gc + R * (0.05 + rng() * 0.12), 0, 0, lean, roll);
  const N = 30;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = Math.PI * 0.5 - (i / N) * TAU;
    pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const missing = new Set();
  const m0 = Math.floor(rng() * N);
  missing.add(m0);
  if (rng() < 0.6) missing.add((m0 + 1) % N);
  if (rng() < 0.5) missing.add(Math.floor(rng() * N));
  const body = rng() < 0.5 ? M.stone : M.basalt;
  b.setGround(gc, 8);
  voussoirs(b, body, C, pts, { thick, depth, gap: 0.3, rng, slip: 0.6, jit: 0.15, skip: (i) => missing.has(i) });
  // outer rim band: a proud ring of smooth stone on the outer face (gives the edge a bevel)
  const pout = pts.map(([x, y]) => [x * (1 + thick / R), y * (1 + thick / R)]);
  voussoirs(b, M.smooth, C, pout, { thick: 1.2, depth: depth * 0.7, gap: 0.3, rng, slip: 0.3, skip: (i) => missing.has(i) });
  // inscribed band on the inner face
  const pin = pts.map(([x, y]) => [x * 0.99, y * 0.99]);
  voussoirs(b, M.glyph, C, pin, { thick: 0.6, depth: 1.2, gap: 0.12, skip: (i) => missing.has(i) });
  // the missing stones tumbled downhill
  for (let k = 0; k < missing.size; k++) {
    const [wx, wz] = L2W(s, (rng() - 0.5) * R, R * 0.6 + rng() * R);
    const gy = ctx.heightAt(wx, wz);
    b.setGround(gy, 3);
    b.box(body, mat(wx, gy - thick * 0.3, wz, rng() * TAU, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2), (TAU * R) / N, thick, depth * 0.9, { jit: 0.35 });
  }
  const [wx, wz] = L2W(s, 0, R * 0.7);
  rubble(ctx, b, body, wx, wz, 30, R * 0.9, rng, { size: [0.6, 2.8] });
}

// ===========================================================================
// DESCENT (stairway into the ground)
// ===========================================================================

/**
 * A stepped platform (tumulus of masonry) with a stair well cut into its top: a broad flight
 * descends between high walls to a black doorway at ground level — the door into the earth.
 * Twin door frames stand at the head of the stair.
 */
export function descent(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const Wp = 60 + rng() * 12; // platform width (x)
  const Lp = 92 + rng() * 20; // platform length (z)
  const Hp = 13 + rng() * 4; // platform height
  const g = minGround(ctx, s, 0, 0, Wp / 2, Lp / 2);
  const top = g + Hp;
  const body = M.stone;
  // battered stepped sides: 3 terraces
  b.setGround(g, 6);
  const well = { w: 20, z0: -Lp / 2 + 14, z1: Lp / 2 - 10 };
  const terr = 3;
  for (let k = 0; k < terr; k++) {
    const inset = k * 3.2;
    const y0 = g - 3 + k * (Hp + 3) / terr;
    const h = (Hp + 3) / terr;
    const w = Wp - 2 * inset;
    const l = Lp - 2 * inset;
    // four sides as separate walls (leaving the well open in the middle)
    const sideW = (w - well.w) / 2;
    for (const e of [-1, 1]) {
      b.box(body, sub(F, e * (well.w / 2 + sideW / 2), y0, 0), sideW, h + 0.05, l, { taper: [0.97, 0.99], jit: 0.08 });
    }
    // crisp ledge along the outer edge of each terrace
    for (const e of [-1, 1]) {
      b.box(M.smooth, sub(F, e * (w / 2 - 0.4), y0 + h - 0.2, 0), 1.6, 0.8, l + 0.8);
      b.box(M.smooth, sub(F, 0, y0 + h - 0.2, e * (l / 2 - 0.4)), w + 0.8, 0.8, 1.6);
    }
    // front (downhill end) and back walls across the well
    b.box(body, sub(F, 0, y0, -l / 2 + (well.z0 + Lp / 2 - inset) / 2), well.w + 0.1, h + 0.05, well.z0 + Lp / 2 - inset, { jit: 0.08 });
    b.box(body, sub(F, 0, y0, l / 2 - (Lp / 2 - well.z1 - inset) / 2), well.w + 0.1, h + 0.05, Math.max(0.5, Lp / 2 - well.z1 - inset), { jit: 0.08 });
  }
  // an inscribed band around the crown of the platform
  {
    const gy = glyphRow(top - 2.4);
    const w = Wp - 2 * 2 * 3.2;
    const l = Lp - 2 * 2 * 3.2;
    for (const e of [-1, 1]) {
      b.box(M.glyph, sub(F, e * (w / 2 - 0.3), gy, 0), 0.8, 1.2, l - 1.5);
      b.box(M.glyph, sub(F, 0, gy, e * (l / 2 - 0.3)), w - 1.5, 1.2, 0.8);
    }
  }
  // coping on the well rim
  for (const e of [-1, 1]) b.box(M.smooth, sub(F, e * (well.w / 2 + 0.9), top, (well.z0 + well.z1) / 2), 1.8, 0.8, well.z1 - well.z0 + 1.8);
  // the stair: from the platform top at z0 down toward z1 (door at the bottom, ground level)
  const run = 1.05;
  const rise = 0.5;
  const nSteps = Math.floor((top - g) / rise);
  const stairLen = nSteps * run;
  const zStart = well.z0;
  for (let i = 0; i < nSteps; i++) {
    const z = zStart + (i + 0.5) * run;
    const y = top - (i + 1) * rise;
    const broken = rng() < 0.08;
    b.setGround(g, 3);
    b.box(M.smooth, sub(F, (rng() - 0.5) * 0.1, g - 2, z, 0, broken ? (rng() - 0.5) * 0.1 : 0, broken ? (rng() - 0.5) * 0.1 : 0), well.w - 0.3, y - g + 2, run - 0.04, { jit: broken ? 0.1 : 0.02 });
  }
  // well floor between the stair foot and the door
  const floorZ0 = zStart + stairLen;
  if (well.z1 - floorZ0 > 1) b.box(M.basalt, sub(F, 0, g - 1.5, (floorZ0 + well.z1) / 2), well.w - 0.2, 1.6, well.z1 - floorZ0);
  // the doorway at the far end: a frame set into the end wall with a black void behind it
  const dz = well.z1 - 0.3;
  const dh = Math.min(Hp - 2, 10);
  b.setGround(-1e9);
  b.box(M.basalt, sub(F, 0, g - 0.5, dz + 1.2), 7.5, dh + 0.4, 1.4, null, 0.03);
  for (const e of [-1, 1]) b.box(M.smooth, sub(F, e * 4.6, g - 0.5, dz), 1.6, dh + 0.5, 1.4);
  b.box(M.smooth, sub(F, 0, g + dh, dz), 11.5, 1.6, 1.8);
  b.box(M.glyph, sub(F, 0, snapCell(g + dh + 1.8), dz + 0.1), 10, 1.2, 1.4);
  // the approach: a broad outer stair climbs the -z face to the head of the descent — you go up
  // to go down
  {
    const zf = -Lp / 2;
    const nUp = Math.ceil((top - g + 1) / 0.55);
    for (let i = 0; i < nUp; i++) {
      const y = top - i * 0.55;
      const z = zf - 0.6 - i * 1.1;
      const gz = gAt(ctx, s, 0, z);
      if (y < gz - 0.5) break;
      b.setGround(gz, 3);
      b.box(M.smooth, sub(F, (rng() - 0.5) * 0.1, gz - 1.5, z, 0, 0, (rng() - 0.5) * 0.01), well.w + 4 - (rng() < 0.08 ? rng() * 4 : 0), y - gz + 1.5, 1.14, { jit: 0.03 });
    }
    // cheek walls of the outer stair
    for (const e of [-1, 1]) {
      const len = nUp * 1.1;
      b.setGround(g, 5);
      b.box(body, sub(F, e * (well.w / 2 + 3), g - 2, zf - len / 2), 2.6, top - g + 2.8, len, { taper: [1, 0.2], shift: [0, len * 0.38], jit: 0.08 });
    }
  }
  // stumps of a colonnade that once ringed the well
  for (let k = 0; k < 8; k++) {
    for (const e of [-1, 1]) {
      if (rng() < 0.25) continue;
      const z = well.z0 + 4 + k * ((well.z1 - well.z0 - 8) / 7);
      const [wx, wz] = L2W(s, e * (well.w / 2 + 4.2), z);
      column(b, wx, top + 0.8, wz, { H: 14, r: 1.1, rng, mat: M.smooth, capMat: M.stone, baseMat: M.stone, broken: 0.08 + rng() * 0.5, bury: 0.1, ry: s.yaw });
    }
  }
  // twin door frames at the head of the stair
  for (const e of [-1, 1]) {
    doorFrame(b, M, sub(F, e * (well.w / 2 + 8), top, well.z0 - 4), 17 + rng() * 4, 4.4, 1.8, 3.0, rng, { inner: M.obsidian, body: M.marble });
  }
  // erosion: one corner of the platform slumped into a rubble slope
  const cx = (rng() < 0.5 ? -1 : 1) * Wp / 2;
  const cz = (rng() < 0.5 ? -1 : 1) * Lp / 2;
  const [wx, wz] = L2W(s, cx, cz);
  rubble(ctx, b, body, wx, wz, 50, 14, rng, { size: [0.8, 3.0], sink: 0.2 });
}

// ===========================================================================
// DOOR FRAMES
// ===========================================================================

/**
 * One free-standing door frame in frame m (base at local y=0, opening along z): nested reveals
 * receding inward, the innermost in inscribed obsidian, a stepped cap.
 */
export function doorFrame(b, M, m, H, Wo, t, d, rng, { inner = M.obsidian, body = M.marble, plinth = true } = {}) {
  if (plinth) {
    b.box(M.basalt, sub(m, 0, -1.2, 0), Wo + 2 * t + 3.2, 1.6, d + 3, { jit: 0.1 });
  }
  // outer posts + lintel
  for (const e of [-1, 1]) b.box(body, sub(m, e * (Wo / 2 + t / 2), 0.4, 0), t, H, d);
  b.box(body, sub(m, 0, H + 0.4, 0), Wo + 2 * t + 1.6, t * 1.1, d + 0.3);
  // reveal 1 (recessed)
  const r1 = 0.55;
  for (const e of [-1, 1]) b.box(body, sub(m, e * (Wo / 2 - r1 / 2), 0.4, 0), r1, H - r1, d - 0.7);
  b.box(body, sub(m, 0, H + 0.4 - r1, 0), Wo, r1, d - 0.7);
  // innermost inscribed reveal
  const r2 = 0.35;
  for (const e of [-1, 1]) b.box(inner, sub(m, e * (Wo / 2 - r1 - r2 / 2), 0.4, 0), r2, H - r1 - r2, d - 1.3);
  b.box(inner, sub(m, 0, H + 0.4 - r1 - r2, 0), Wo - 2 * r1, r2, d - 1.3);
  // stepped cap
  b.box(M.smooth, sub(m, 0, H + 0.4 + t * 1.1, 0), Wo + 2 * t + 0.4, 0.8, d - 0.2);
  b.box(M.smooth, sub(m, 0, H + 1.2 + t * 1.1, 0), Wo + t, 0.7, d - 0.9);
}

/**
 * A procession of door frames along an axis, each smaller than the last and turned a few degrees
 * further — a tunnel that twists as you walk it. One has sunk and tilted, one lies fallen.
 */
export function doorProcession(ctx, b, M, rng, s) {
  const n = 4 + Math.floor(rng() * 2);
  const H0 = 28 + rng() * 8;
  const twist = (0.08 + rng() * 0.06) * (rng() < 0.5 ? -1 : 1);
  const body = rng() < 0.6 ? M.marble : M.basalt;
  const inner = body === M.basalt ? M.glyph : M.obsidian;
  const fallenIdx = rng() < 0.7 ? n - 1 : -1;
  const sunkIdx = 1 + Math.floor(rng() * (n - 2));
  let z = 0;
  for (let k = 0; k < n; k++) {
    const sc = Math.pow(0.84, k);
    const H = H0 * sc;
    const Wo = 7.5 * sc + 2;
    const t = 3.0 * sc + 0.5;
    const d = 3.4 * sc + 0.8;
    const [wx, wz] = L2W(s, 0, z);
    const g = ctx.heightAt(wx, wz);
    b.setGround(g, 4);
    if (k === fallenIdx) {
      // lies flat on its back, half in the grass
      const m = mat(wx, g + 0.2, wz, s.yaw + twist * k, Math.PI / 2 - 0.04, (rng() - 0.5) * 0.1).multiply(mat(0, -0.4, 0));
      doorFrame(b, M, m, H, Wo, t, d, rng, { inner, body, plinth: false });
    } else {
      const sink = k === sunkIdx ? 2.5 + rng() * 2 : 0.3;
      const tilt = k === sunkIdx ? 0.12 + rng() * 0.08 : (rng() - 0.5) * 0.02;
      const m = mat(wx, g - sink, wz, s.yaw + twist * k, (rng() - 0.5) * 0.03, tilt * (rng() < 0.5 ? -1 : 1));
      doorFrame(b, M, m, H, Wo, t, d, rng, { inner, body });
    }
    z += 24 + 14 * sc;
  }
  const [wx, wz] = L2W(s, 0, z * 0.5);
  rubble(ctx, b, body, wx, wz, 24, z * 0.5, rng, { size: [0.4, 1.8], rx: 10, rz: z * 0.55, yaw: s.yaw });
}

// ===========================================================================
// STATUE FRAGMENTS (original, faceless, geometric)
// ===========================================================================


// The head: a faceted ellipsoid cranium sliced flat at the front; the cut is a disc of polished
// obsidian — the face is a mirror with nothing in it.
const FACE_CUT = 0.6; // fraction of the radius where the face plane cuts the sphere
let craniumCache = null;
let faceCache = null;
function craniumGeometry() {
  if (craniumCache) return craniumCache;
  let g = new THREE.SphereGeometry(1, 14, 11, 0, TAU, Math.acos(FACE_CUT), Math.PI - Math.acos(FACE_CUT));
  g.rotateX(Math.PI / 2); // the cut faces +z
  g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.computeVertexNormals(); // flat facets: carved, not moulded
  craniumCache = g;
  return g;
}
function faceGeometry() {
  if (faceCache) return faceCache;
  const r = Math.sqrt(1 - FACE_CUT * FACE_CUT);
  const g = new THREE.CylinderGeometry(r, r, 0.04, 28, 1).rotateX(Math.PI / 2).translate(0, 0, FACE_CUT);
  g.deleteAttribute('uv');
  faceCache = g;
  return g;
}

/**
 * Colossal faceless head: tall faceted cranium, a flat obsidian mirror for a face crossed by one
 * inscribed band where the eyes would be, a heavy neck, and a stepped crest running back over the
 * skull. Poses: surfacing (sunk to the jaw, face tipped to the sky) or fallen on its side.
 */
export function colossalHead(ctx, b, M, rng, s) {
  const S = 26 + rng() * 10; // head height
  const pose = [0, 1, 0][s.id % 3];
  const body = rng() < 0.5 ? M.marbleSmooth : M.smooth;
  const g = gAt(ctx, s, 0, 0);
  let H;
  if (pose === 0) H = mat(s.x, g - S * 0.06, s.z, s.yaw, -(0.4 + rng() * 0.25), (rng() - 0.5) * 0.25); // sunk to the jaw, face (+z) tipped up
  else H = mat(s.x, g + S * 0.3, s.z, s.yaw, -0.25, Math.PI / 2 - 0.2 + (rng() - 0.5) * 0.2); // lying on its side
  b.setGround(g, 6);
  // cranium: x width 0.62S, y height S, z depth 0.78S (radii are halves)
  const C = sub(H, 0, S * 0.5, 0, 0, 0, 0, S * 0.31, S * 0.5, S * 0.39);
  b.geo(body, craniumGeometry(), C);
  b.geo(M.obsidianPlain, faceGeometry(), C);
  // the eye band across the mirror
  b.box(M.obsidian, sub(H, 0, S * 0.55, S * 0.39 * FACE_CUT + 0.2), S * 0.44, 1.0, 0.6);
  // brow ledge: the cut's upper rim thickened
  b.box(body, sub(H, 0, S * 0.84, S * 0.39 * FACE_CUT - 0.8, 0, 0.35, 0), S * 0.36, S * 0.05, S * 0.12);
  // neck and a stepped collar where it meets the ground
  b.geo(body, frustumGeometry(0.82, 12), sub(H, 0, -S * 0.32, -S * 0.04, 0, 0, 0, S * 0.2, S * 0.4, S * 0.24));
  // crest: a stepped blade over the skull from brow to nape
  const crest = rng() < 0.5 ? M.basalt : M.stone;
  for (let k = 0; k < 3; k++) {
    b.box(crest, sub(H, 0, S * (0.94 - k * 0.18), -S * (0.08 + k * 0.1), 0, -0.25 - k * 0.35, 0), S * 0.07, S * 0.14, S * 0.3, { taper: [1, 0.8] });
  }
  // fallen fragments of the crest and collar
  for (let k = 0; k < 4; k++) {
    const [wx, wz] = L2W(s, (rng() - 0.5) * S * 1.8, (rng() - 0.5) * S * 1.8);
    const gy = ctx.heightAt(wx, wz);
    b.setGround(gy, 3);
    b.box(k < 2 ? crest : body, mat(wx, gy - 1.0, wz, rng() * TAU, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2), S * 0.1, S * 0.12, S * 0.2, { jit: 0.3 });
  }
  rubble(ctx, b, body, s.x, s.z, 22, S * 0.9, rng, { size: [0.6, 2.4] });
}

/**
 * Colossal hand rising out of the ground (or the lake), palm turned to the sky. Built like
 * architecture: every phalanx is a separate carved block with a collar at the joint, fingers
 * splayed and curling. One finger has broken at its first joint; its blocks lie at the wrist.
 */
export function colossalHand(ctx, b, M, rng, s) {
  const S = 1.3 + rng() * 0.4;
  const wet = s.type === 'drownedHand';
  const body = wet ? M.basalt : rng() < 0.6 ? M.smooth : M.marbleSmooth;
  const g = gAt(ctx, s, 0, 0);
  const F = frameOf(s);
  b.setGround(wet ? 0 : g, wet ? 2.5 : 5);
  // forearm: rises from deep underground, leaning back; the palm faces +z (up and forward)
  const lean = wet ? -0.12 : -0.35 - rng() * 0.15;
  const arm = sub(F, 0, (wet ? g : g) - 10 * S, 0, (rng() - 0.5) * 0.4, lean, (rng() - 0.5) * 0.12);
  const armL = wet ? 24 * S - g * 0.9 : 20 * S;
  b.box(body, arm, 7.2 * S, armL, 5.4 * S, { taper: [0.82, 0.86] });
  // wrist collar
  b.box(body, sub(arm, 0, armL - 0.6 * S, 0), 6.6 * S, 1.2 * S, 5.0 * S);
  // palm: slightly wider at the knuckles, tipped back a little more
  const P = sub(arm, 0, armL + 0.5 * S, 0, 0, -0.18, 0);
  b.box(body, P, 7.4 * S, 8.5 * S, 3.4 * S, { taper: [1.18, 0.92] });
  const broken = Math.floor(rng() * 4);
  const lens = [[4.6, 3.1, 2.3], [5.0, 3.4, 2.5], [4.7, 3.2, 2.3], [3.8, 2.6, 2.0]];
  const widths = [1.9, 2.0, 1.9, 1.6];
  const splay = [0.12, 0.04, -0.05, -0.14];
  for (let f = 0; f < 4; f++) {
    const fx = (-3.3 + f * 2.2) * S;
    const w = widths[f] * S;
    let m = sub(P, fx, 8.6 * S, 0, 0, 0.06 + rng() * 0.1, splay[f]);
    const nseg = f === broken ? 1 : 3;
    for (let k = 0; k < nseg; k++) {
      const len = lens[f][k] * S;
      const wk = w * (1 - k * 0.1);
      b.box(body, m, wk, len - 0.35 * S, wk * 1.08, { taper: 0.93 });
      // joint collar: a thin proud ring of stone between phalanges
      b.box(M.smooth, sub(m, 0, len - 0.45 * S, 0), wk * 1.08, 0.3 * S, wk * 1.16);
      m = sub(m, 0, len, 0, 0, 0.22 + rng() * 0.18, 0); // curl toward the palm
    }
    if (f === broken) {
      for (let k = 1; k < 3; k++) {
        const [wx, wz] = L2W(s, fx * 1.5 + (rng() - 0.5) * 10, -6 - rng() * 10);
        const gy = ctx.heightAt(wx, wz);
        b.setGround(wet ? 0 : gy, 3);
        b.box(body, mat(wx, gy - 0.5 * S, wz, rng() * TAU, Math.PI / 2 + (rng() - 0.5) * 0.5, rng()), w, lens[f][k] * S, w * 1.08, { taper: 0.93, jit: 0.1 });
      }
      b.setGround(wet ? 0 : g, wet ? 2.5 : 5);
    }
  }
  // thumb: from the side of the palm, angled out and across
  let tm = sub(P, -3.9 * S, 2.2 * S, 0.6 * S, 0, 0.35, 0.85);
  for (let k = 0; k < 2; k++) {
    const len = (k === 0 ? 4.2 : 3.2) * S;
    b.box(body, tm, 2.2 * S, len - 0.3 * S, 2.3 * S, { taper: 0.9 });
    b.box(M.smooth, sub(tm, 0, len - 0.4 * S, 0), 2.3 * S, 0.3 * S, 2.4 * S);
    tm = sub(tm, 0, len, 0, 0, 0.3, -0.25);
  }
  // an inscribed band around the wrist
  b.box(M.glyph, sub(arm, 0, armL - 3.4 * S, 0), 7.0 * S, 1.2, 5.3 * S);
  if (!wet) rubble(ctx, b, body, s.x, s.z, 18, 14 * S, rng, { size: [0.6, 2.2] });
}

// ===========================================================================
// WAYMARKERS
// ===========================================================================

export function stele(ctx, b, M, rng, s) {
  const g = minGround(ctx, s, 0, 0, 2, 2);
  const F = frameOf(s);
  const H = 8 + rng() * 7;
  const kind = rng();
  const m_ = kind < 0.45 ? M.obsidian : kind < 0.8 ? M.glyph : M.smooth;
  b.setGround(g, 3);
  b.box(M.basalt, sub(F, 0, g - 1.2, 0), 4.2, 1.8, 2.6, { jit: 0.15 });
  const S = sub(F, 0, g + 0.4, 0, 0, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.16);
  b.box(m_, S, 3.0, H, 0.9 + rng() * 0.5, { taper: [0.8, 0.9], shift: [(rng() - 0.5) * 0.6, 0] });
  // angled cap stone
  b.box(M.smooth, sub(S, 0, H, 0, 0, 0, (rng() - 0.5) * 0.3), 2.8, 0.8, 1.5, { taper: [0.5, 0.8] });
  rubble(ctx, b, M.stone, s.x, s.z, 5, 4, rng, { size: [0.3, 1.0] });
}

export function cairn(ctx, b, M, rng, s) {
  const g = gAt(ctx, s, 0, 0);
  let y = g - 0.6;
  let w = 3.6 + rng() * 1.2;
  const n = 5 + Math.floor(rng() * 4);
  let ox = 0;
  let oz = 0;
  b.setGround(g, 2.5);
  for (let i = 0; i < n; i++) {
    const h = 0.7 + rng() * 0.6;
    ox += (rng() - 0.5) * 0.35;
    oz += (rng() - 0.5) * 0.35;
    b.box(i % 3 === 2 ? M.basalt : M.stone, mat(s.x + ox, y, s.z + oz, rng() * TAU, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08), w, h, w * (0.7 + rng() * 0.3), { jit: 0.12 * w * 0.3 });
    y += h - 0.05;
    w *= 0.82;
  }
  // a thin upright finger stone on top
  b.box(M.glyph, mat(s.x + ox, y - 0.1, s.z + oz, rng() * TAU, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1), 0.6, 2.4 + rng() * 1.6, 0.5, { taper: 0.6 });
}

// ===========================================================================
// SUNKEN PLAZA
// ===========================================================================

/**
 * A square court sunk inside three stepped terraces (raised around it rather than dug), paved,
 * with a grid of column stumps and an inscribed obsidian altar at the centre.
 */
export function sunkenPlaza(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const half = 40;
  const g = minGround(ctx, s, 0, 0, half, half);
  const floor = g + 0.35;
  const terr = 3;
  const tw = 3.8;
  const th = 2.3;
  b.setGround(g, 4);
  for (let k = 0; k < terr; k++) {
    const r = half + k * tw;
    const y0 = g - 1.5;
    const h = floor + (k + 1) * th - y0;
    for (const e of [-1, 1]) {
      // segmented edges with a central stair gap on each side
      const segs = 10;
      for (let i = 0; i < segs; i++) {
        const a = -r - tw / 2 + ((i + 0.5) / segs) * (2 * r + tw);
        if (Math.abs(a) < 5) continue;
        if (rng() < 0.08) continue;
        const L = (2 * r + tw) / segs - 0.1;
        const hh = h - (rng() < 0.15 ? rng() * th : 0);
        b.box(M.stone, sub(F, a, y0, e * (r + tw / 2)), L, hh, tw, { jit: 0.1 });
        b.box(M.stone, sub(F, e * (r + tw / 2), y0, a), tw, hh, L, { jit: 0.1 });
      }
    }
  }
  // stairs into the court in the middle of each side
  for (let side = 0; side < 4; side++) {
    const ang = (side * Math.PI) / 2;
    const Sd = sub(F, 0, 0, 0, ang);
    for (let k = 0; k < terr * 3; k++) {
      const y = floor + (k + 1) * (th / 3);
      const z = half + (k + 0.5) * (tw / 3);
      b.box(M.smooth, sub(Sd, 0, g - 1.5, z), 9.6, y - g + 1.5, tw / 3 + 0.02, { jit: 0.03 });
    }
  }
  // paving
  const slab = 4;
  const nS = Math.floor((half * 2) / slab);
  for (let i = 0; i < nS; i++) {
    for (let k = 0; k < nS; k++) {
      if (rng() < 0.16) continue;
      const x = -half + (i + 0.5) * slab;
      const z = -half + (k + 0.5) * slab;
      const heave = rng() < 0.1 ? rng() * 0.25 : 0;
      b.box(M.basalt, sub(F, x, floor - 1.2 + heave, z, 0, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03), slab - 0.12, 1.2, slab - 0.12, { jit: 0.04 });
    }
  }
  // grid of stumps (7 x 7), a few taller broken columns, two whole ones with a lintel
  const n = 7;
  const spc = 9.5;
  const whole = [Math.floor(rng() * n), Math.floor(rng() * n)];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      if (i === 3 && k === 3) continue;
      const x = (i - 3) * spc;
      const z = (k - 3) * spc;
      const [wx, wz] = L2W(s, x, z);
      const u = rng();
      const isWhole = k === 1 && (i === whole[0] || i === whole[0] + 1) && whole[0] < n - 1;
      const broken = isWhole ? 1 : u < 0.45 ? 0.06 + rng() * 0.12 : u < 0.85 ? 0.2 + rng() * 0.35 : 0.5 + rng() * 0.3;
      column(b, wx, floor, wz, { H: 17, r: 1.15, rng, mat: M.smooth, capMat: M.stone, baseMat: M.stone, broken, lean: [(rng() - 0.5) * 0.04, (rng() - 0.5) * 0.04], bury: 0.1, ry: s.yaw });
    }
  }
  if (whole[0] < n - 1) {
    const x = (whole[0] - 3 + 0.5) * spc;
    const z = (1 - 3) * spc;
    b.setGround(-1e9);
    b.box(M.stone, sub(F, x, floor + 17 - 0.1, z), spc + 3.8, 2.2, 3.6);
  }
  // altar: stepped basalt dais with an inscribed obsidian block, and a shallow ring basin
  b.setGround(floor, 2);
  b.box(M.basalt, sub(F, 0, floor - 0.2, 0), 12, 1.0, 12);
  b.box(M.basalt, sub(F, 0, floor + 0.8, 0), 9, 0.8, 9);
  b.box(M.obsidian, sub(F, 0, floor + 1.6, 0, 0.3), 3.2, 4.8, 3.2, { taper: 0.9 });
  rubble(ctx, b, M.stone, s.x, s.z, 40, half + 8, rng, { size: [0.4, 1.6] });
}

// ===========================================================================
// BROKEN WALL WITH ARCHED WINDOWS
// ===========================================================================

export function brokenWall(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const bays = 6 + Math.floor(rng() * 5);
  const bw = 12 + rng() * 2;
  const H = 24 + rng() * 10;
  const T = 4 + rng();
  const body = rng() < 0.4 ? M.plaster : M.stone;
  const kind = rng() < 0.6 ? 'parabolic' : 'pointed';
  const span = 5.6;
  const sill = 4.5;
  const winH = H * 0.55;
  const rise = kind === 'pointed' ? span * 0.8 : span * 1.4;
  const gc = gAt(ctx, s, 0, 0);
  const top = gc + H;
  const L = bays * bw;
  // an L-return at one end
  const ret = rng() < 0.6;
  for (let i = 0; i < bays; i++) {
    const x = -L / 2 + (i + 0.5) * bw;
    const g = minGround(ctx, s, x, 0, bw / 2, T / 2);
    const base = g - 2;
    const u = rng();
    const state = i === 0 || i === bays - 1 ? (u < 0.5 ? 'full' : 'broken') : u < 0.35 ? 'full' : u < 0.82 ? 'broken' : 'gone';
    const Hb = top - base;
    const winSill = sill + (gc - base);
    b.setGround(g, 6);
    if (state === 'full') {
      b.geo(body, windowWallGeometry(bw, Hb, [{ cx: 0, sill: winSill, span, height: winH, kind, rise }], T), sub(F, x, base, 0));
      b.box(M.smooth, sub(F, x, top, 0), bw + 0.02, 0.9, T + 0.8);
      if (rng() < 0.6) fracturedSlab(b, body, sub(F, x, top + 0.9, 0), bw, T, rng() * 2.5, rng() * 2.5, rng, { jag: 0.6 });
      // voussoir hood over the window
      const pts = archPoints(kind, span + 0.2, rise + 0.1, 11);
      voussoirs(b, M.smooth, sub(F, x, base + winSill + winH - rise, 0), pts, { thick: 0.9, depth: T + 0.3, gap: 0.06 });
    } else if (state === 'broken') {
      const hk = (gc - base) + sill + winH * (0.3 + rng() * 0.9);
      b.box(body, sub(F, x, base, 0), bw, winSill, T);
      const jw = (bw - span) / 2;
      for (const e of [-1, 1]) {
        const hh = hk * (0.7 + rng() * 0.5) - winSill;
        if (hh > 1) {
          // the jamb snapped along a line falling toward the window
          const hOut = hh + 1 + rng() * 3;
          const hIn = hh * (0.55 + rng() * 0.3);
          fracturedSlab(b, body, sub(F, x + e * (span / 2 + jw / 2), base + winSill, 0), jw, T, e < 0 ? hOut : hIn, e < 0 ? hIn : hOut, rng, { jag: 0.5, loose: false });
        }
      }
      const [wx, wz] = L2W(s, x, (rng() < 0.5 ? -1 : 1) * (T + 3));
      rubble(ctx, b, body, wx, wz, 16, 6, rng, { size: [0.5, 2.0] });
    } else {
      const h0 = (gc - base) + 1 + rng() * 2;
      fracturedSlab(b, body, sub(F, x, base, 0), bw, T, h0 + rng() * 3, h0 + rng() * 3, rng, { jag: 0.8 });
      const [wx, wz] = L2W(s, x, 0);
      rubble(ctx, b, body, wx, wz, 30, 9, rng, { size: [0.6, 2.4] });
    }
    // buttress on the outer face between bays
    if (i < bays - 1 && state !== 'gone') {
      const bx = x + bw / 2;
      const bg = gAt(ctx, s, bx, T / 2 + 2);
      b.box(body, sub(F, bx, bg - 2, T / 2 + 1.2), 2.2, (top - bg) * 0.75, 2.6, { taper: [0.85, 0.3], shift: [0, -1.0] });
    }
  }
  if (ret) {
    const e = rng() < 0.5 ? -1 : 1;
    const rl = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < rl; i++) {
      const z = T / 2 + (i + 0.5) * bw;
      const x = e * (L / 2 - T / 2);
      const g = minGround(ctx, s, x, z, T / 2, bw / 2);
      const hk = i === 0 ? top - g + 2 : (top - g + 2) * (0.25 + rng() * 0.6);
      const R = sub(F, x, g - 2, z, Math.PI / 2);
      b.setGround(g, 6);
      const hNext = i === rl - 1 ? hk * 0.4 : hk * (0.6 + rng() * 0.3);
      fracturedSlab(b, body, R, bw, T, hk, hNext, rng, { jag: 1.0 });
    }
  }
}

// ===========================================================================
// SHORE / DROWNED
// ===========================================================================

/** A broad stair descending from the shore straight down into the lake, flanked by pylons. */
export function drownedStair(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const W = 26 + rng() * 8;
  const g0 = gAt(ctx, s, 0, 0);
  const top = Math.max(g0, 1) + 1.2;
  const run = 1.0;
  const rise = 0.45;
  const n = Math.ceil((top + 12) / rise);
  b.setGround(0, 2.5);
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * run;
    const y = top - (i + 1) * rise;
    const gz = gAt(ctx, s, 0, z);
    if (y < gz - 1) break;
    b.box(M.marble, sub(F, (rng() - 0.5) * 0.12, Math.min(gz, y) - 2, z, (rng() - 0.5) * 0.02), W - (rng() < 0.1 ? rng() * 3 : 0), y - Math.min(gz, y) + 2, run - 0.05, { jit: 0.04 });
  }
  // landing
  b.box(M.marble, sub(F, 0, g0 - 2, -4), W + 4, top - g0 + 2, 8, { jit: 0.05 });
  // side walls stepping down with the stair, flanking pylons at the head
  for (const e of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const z = k * 6 + 3;
      const y = top - (z / run) * rise;
      const gz = gAt(ctx, s, e * (W / 2 + 1), z);
      b.box(M.stone, sub(F, e * (W / 2 + 1), Math.min(gz, y) - 3, z), 2.2, y + 2.8 - Math.min(gz, y) + 3, 6.1, { jit: 0.08 });
    }
    b.setGround(g0, 4);
    b.box(M.stone, sub(F, e * (W / 2 + 4), g0 - 2, -4), 6.5, 18 + rng() * 6, 6.5, { taper: 0.75 });
    b.setGround(0, 2.5);
  }
}

/** A gate standing in the shallows, its feet drowned; a head lies in the water beside it. */
export function drownedGate(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const span = 18 + rng() * 5;
  const pier = 6.5;
  const depth = 6.5;
  const g = Math.min(gAt(ctx, s, -span / 2 - pier / 2, 0), gAt(ctx, s, span / 2 + pier / 2, 0));
  const springH = 18;
  b.setGround(0, 3);
  for (const e of [-1, 1]) {
    b.box(M.stone, sub(F, e * (span / 2 + pier / 2), g - 1, 0), pier, springH - g + 1 + 4, depth, { taper: [0.95, 0.95] });
  }
  const pts = archPoints('pointed', span, span * 0.7, 15);
  voussoirs(b, M.smooth, sub(F, 0, springH + 4, 0, 0, 0, (rng() - 0.5) * 0.03), pts, { thick: 2.0, depth, gap: 0.1, rng, slip: 0.3, key: 1.3, to: rng() < 0.4 ? 0.7 : 1 });
  const attY = springH + 4 + span * 0.7 + 2;
  b.box(M.stone, sub(F, 0, attY - 1.5, 0), span + pier * 2, 3.5, depth);
  fracturedSlab(b, M.stone, sub(F, 0, attY + 2, 0), span + pier * 2, depth, rng() * 4, rng() * 4, rng, { jag: 0.8 });
}

/** A tilted pavilion: four columns carrying a stepped stone roof, slumping into the water. */
export function drownedPavilion(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const g = gAt(ctx, s, 0, 0);
  const tiltX = 0.15 + rng() * 0.08;
  const tiltZ = (rng() < 0.5 ? -1 : 1) * (0.06 + rng() * 0.06);
  const P = sub(F, 0, g - 0.5, 0, 0, tiltX, tiltZ);
  const H = 16 + rng() * 4;
  const hw = 9.5;
  b.setGround(0, 2.5);
  const platH = Math.max(2, 1.4 - g);
  b.box(M.marble, P, hw * 2 + 5, platH, hw * 2 + 5, { jit: 0.1 });
  for (const e of [-1, 1]) {
    for (const f of [-1, 1]) {
      const cm = sub(P, e * hw, platH, f * hw);
      b.geo(M.marbleSmooth, drumGeometry(true), sub(cm, 0, 0, 0, rng(), 0, 0, 1.5, H, 1.5));
    }
  }
  const R = platH + H;
  b.box(M.marble, sub(P, 0, R, 0), hw * 2 + 4, 1.4, hw * 2 + 4);
  b.box(M.glyph, sub(P, 0, R + 1.4, 0), hw * 2 + 3.2, 1.2, hw * 2 + 3.2);
  b.box(M.marble, sub(P, 0, R + 2.6, 0), hw * 2 + 1, 1.2, hw * 2 + 1);
  b.box(M.stone, sub(P, 0, R + 3.8, 0), hw * 2 - 2, 4.5, hw * 2 - 2, { taper: 0.2 });
}

// ===========================================================================
// MINOR FRAGMENTS — the connective tissue between sites
// ===========================================================================

/**
 * One small fragment: a lone column, a trilith, an arc of voussoirs emerging from the grass like
 * a rib, a menhir with an inscribed band, or a fallen capital among drums.
 */
export function fragment(ctx, b, M, rng, s) {
  const F = frameOf(s);
  const g = gAt(ctx, s, 0, 0);
  const kind = s.kind ?? Math.floor(rng() * 5);
  b.setGround(g, 4);
  if (kind === 0) {
    const r = 1.3 + rng() * 0.5;
    const H = 18 + rng() * 10;
    const matS = rng() < 0.5 ? M.marbleSmooth : M.smooth;
    column(b, s.x, g, s.z, { H, r, rng, mat: matS, capMat: M.marble, baseMat: M.stone, broken: rng() < 0.5 ? 1 : 0.4 + rng() * 0.4, lean: [(rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08], bury: 1.2, ry: s.yaw });
    fallenColumn(ctx, b, s.x + 3, s.z + 2, { dir: rng() * TAU, count: 2 + Math.floor(rng() * 3), r, rng, mat: matS, capital: false, spread: 0.8 });
  } else if (kind === 1) {
    // trilith: two squat posts and a lintel, one post settled so the lintel slides
    const w = 7 + rng() * 4;
    const h = 7 + rng() * 4;
    const settle = rng() * 0.9;
    for (const e of [-1, 1]) b.box(M.stone, sub(F, e * w / 2, g - 1.5 - (e > 0 ? settle : 0), 0, 0, 0, e * 0.02), 2.6, h + 1.5, 2.4, { taper: 0.9, jit: 0.1 });
    b.box(M.smooth, sub(F, (rng() - 0.5) * 1.5, g + h - settle * 0.5, 0, 0, 0, Math.atan2(settle, w)), w + 4, 1.9, 2.8, { jit: 0.1 });
  } else if (kind === 2) {
    // a rib: part of a buried ring of voussoirs arcing out of the ground
    const R = 12 + rng() * 10;
    const C = sub(F, 0, g - R * (0.35 + rng() * 0.25), 0, 0, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.3);
    const pts = archPoints('round', R * 2, R, 20);
    voussoirs(b, rng() < 0.5 ? M.smooth : M.basalt, C, pts, { thick: 2.2, depth: 3, gap: 0.12, rng, slip: 0.3, from: 0.05 + rng() * 0.15, to: 0.55 + rng() * 0.4 });
  } else if (kind === 3) {
    // menhir: a rough standing slab with one inscribed band
    const H = 9 + rng() * 8;
    const S = sub(F, 0, g - 1.5, 0, 0, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15);
    b.box(M.basalt, S, 3.4, H, 1.8, { taper: [0.7, 0.8], shift: [(rng() - 0.5) * 0.8, 0], jit: 0.25 });
    const gy = glyphRow(g + H * 0.55) - (g - 1.5);
    b.box(M.glyph, sub(S, 0, gy, 0), 3.4 * (1 - 0.3 * gy / H) + 0.1, 1.2, 1.8 * (1 - 0.2 * gy / H) + 0.12);
  } else {
    // fallen capital among drums
    const r = 1.5 + rng() * 0.4;
    b.box(M.marble, mat(s.x, g - 0.8, s.z, rng() * TAU, 0.2 + rng() * 0.3, (rng() - 0.5) * 0.3), r * 3.7, 1.2, r * 3.7, { jit: 0.1 });
    b.geo(M.marble, frustumGeometry(1.75, 16), mat(s.x + 2, g + 0.4, s.z - 1, rng() * TAU, 1.3, 0.2, r * 0.9, 1.1, r * 0.9));
    fallenColumn(ctx, b, s.x - 2, s.z + 2, { dir: rng() * TAU, count: 3 + Math.floor(rng() * 3), r, rng, mat: M.marbleSmooth, capital: false, spread: 1.4 });
  }
  rubble(ctx, b, M.stone, s.x, s.z, 8, 8, rng, { size: [0.4, 1.4] });
}
