// The Processional Way — paired marble pillars marching down from a gate on the ridge crest to
// the Kneeling Wardens, along the lake's north shore. From the crest gate the Wardens first come
// into view; west of it only a few fallen pillars remain on the far slope.
//
// Rhythm: a pair every ~24 m, a lintelled gate every sixth pair, a terminal obsidian gate at the
// edge of the Wardens' terrace. Kerb walls and fragments of a paved causeway between the rows.
// Damage: some pillars broken, leaning, fallen across the way, or gone to their plinths.

import * as THREE from 'crownfall-world-three';
import { mat, sub, raggedTop, rubble, glyphRow } from './ruins-parts.js';

export const AVENUE = [
  [-1160, -640], [-1040, -665], [-960, -690], [-860, -715], [-760, -735], [-660, -758], [-578, -776],
];
const CREST = 2; // index of the crest gate control point
const HALF = 13; // half width between pillar rows
const STEP = 21;

export function buildAvenue(ctx, b, M, rng) {
  const { heightAt } = ctx;
  const curve = new THREE.CatmullRomCurve3(AVENUE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = curve.getLength();
  // arc length of the crest gate
  let sCrest = 0;
  {
    const c = AVENUE[CREST];
    let best = 1e9;
    for (let s = 0; s <= L; s += 2) {
      const p = curve.getPointAt(s / L);
      const d = Math.hypot(p.x - c[0], p.z - c[1]);
      if (d < best) {
        best = d;
        sCrest = s;
      }
    }
  }
  const tan = new THREE.Vector3();
  const pairs = [];
  // pairs start at the crest; the west slope keeps only a few fragments
  for (let s = sCrest % STEP; s <= L - 4; s += STEP) pairs.push(s);
  const pts = [];
  for (const s of pairs) {
    const p = curve.getPointAt(s / L);
    curve.getTangentAt(s / L, tan);
    const yaw = Math.atan2(tan.x, tan.z); // local +z along the avenue (toward the Wardens)
    pts.push({ s, x: p.x, z: p.z, yaw });
  }
  const iCrest = pts.findIndex((p) => Math.abs(p.s - sCrest) < STEP / 2);
  const last = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const west = i < iCrest;
    const isGate = i === iCrest || (i > iCrest && (i - iCrest) % 6 === 0 && i < last - 1);
    // gate pairs share a level top so their lintel can rest on both
    const gA = heightAt(p.x + Math.cos(p.yaw) * HALF, p.z - Math.sin(p.yaw) * HALF);
    const gB = heightAt(p.x - Math.cos(p.yaw) * HALF, p.z + Math.sin(p.yaw) * HALF);
    const gateTop = Math.max(gA, gB) + 1.4 + 19 * 1.35;
    for (const side of [-1, 1]) {
      const c = Math.cos(p.yaw);
      const sn = Math.sin(p.yaw);
      // local +x is to the right of the avenue direction
      const px = p.x + c * side * HALF;
      const pz = p.z - sn * side * HALF;
      const g = heightAt(px, pz);
      let state = 'full';
      const u = rng();
      if (west) state = u < 0.2 ? 'broken' : u < 0.75 ? 'fallen' : 'gone';
      else if (!isGate && i !== last) state = u < 0.7 ? 'full' : u < 0.8 ? 'broken' : u < 0.88 ? 'lean' : u < 0.97 ? 'fallen' : 'gone';
      if (i === last) terminalPylon(ctx, b, M, rng, px, g, pz, p.yaw, side);
      else pillar(ctx, b, M, rng, px, g, pz, p.yaw, side, state, isGate ? 1.35 : 1, isGate && !west ? gateTop - g - 1.4 : 0);
    }
    if (isGate && !west) {
      // lintel spanning the way between the taller gate pillars
      const F = mat(p.x, 0, p.z, p.yaw);
      b.setGround(-1e9);
      const y = gateTop + 0.6;
      let gy = glyphRow(y + 3.4);
      if (gy < y + 2.2) gy += 3.6;
      b.box(M.marble, sub(F, 0, y, 0, 0, 0, (rng() - 0.5) * 0.03), HALF * 2 + 5, gy - y, 3.2, { jit: 0.06 });
      b.box(M.glyph, sub(F, 0, gy, 0), HALF * 2 + 2, 1.2, 2.9);
      b.box(M.marble, sub(F, 0, gy + 1.2, 0), HALF * 2 + 6, 0.9, 3.8);
    }
  }
  // terminal lintel (cracked, one end dropped onto the terrace)
  {
    const p = pts[last];
    const [wx, wz] = [p.x + Math.sin(p.yaw) * 10, p.z + Math.cos(p.yaw) * 10];
    const fg = heightAt(wx, wz);
    b.setGround(fg, 4);
    b.box(M.obsidianPlain, mat(wx, fg - 1.5, wz, p.yaw + 0.3, 0.1, 0.35), HALF * 2 + 4, 3.4, 3.6, { jit: 0.05 });
    rubble(ctx, b, M.basalt, wx, wz, 24, 10, rng, { size: [0.5, 2.0] });
  }
  // kerb walls along both edges and fragments of the causeway paving
  for (let s = sCrest; s < L - 6; s += 8) {
    const p0 = curve.getPointAt(s / L);
    const p1 = curve.getPointAt(Math.min(L, s + 8) / L);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    for (const side of [-1, 1]) {
      if (rng() < 0.3) continue;
      const cx = (p0.x + p1.x) / 2 + Math.cos(yaw) * side * (HALF + 3.2);
      const cz = (p0.z + p1.z) / 2 - Math.sin(yaw) * side * (HALF + 3.2);
      const ga = heightAt(cx - Math.sin(yaw) * len / 2, cz - Math.cos(yaw) * len / 2);
      const gb = heightAt(cx + Math.sin(yaw) * len / 2, cz + Math.cos(yaw) * len / 2);
      const pitch = Math.atan2(gb - ga, len);
      b.setGround((ga + gb) / 2, 2);
      b.box(M.stone, mat(cx, (ga + gb) / 2 - 1.0, cz, yaw, -pitch, 0), 1.3, 1.9 + rng() * 0.4, len - 0.3, { jit: 0.1 });
    }
    // paving slabs down the middle
    for (let k = -1; k <= 1; k++) {
      if (rng() < 0.55) continue;
      const cx = (p0.x + p1.x) / 2 + Math.cos(yaw) * k * 3.1;
      const cz = (p0.z + p1.z) / 2 - Math.sin(yaw) * k * 3.1;
      const g = heightAt(cx, cz);
      b.setGround(g, 1.5);
      b.box(M.marble, mat(cx, g - 0.55, cz, yaw + (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08), 3.0, 0.8, 3.8, { jit: 0.05 });
    }
  }
  return { length: L, pairs: pts.length };
}

/**
 * Avenue pillar: basalt plinth, a tapering square marble shaft in three drums, an inscribed
 * panel on the face turned to the way, and a diamond-set cube capstone with a small pyramid.
 */
function pillar(ctx, b, M, rng, x, g, z, yaw, side, state, scale, gateH = 0) {
  const H = gateH || 19 * scale;
  const w = 2.9 * Math.sqrt(scale);
  const F = mat(x, 0, z, yaw);
  b.setGround(g, 4);
  b.box(M.basalt, sub(F, 0, g - 1.4, 0), w * 2.0, 2.0, w * 2.0, { jit: 0.12 });
  b.box(M.basalt, sub(F, 0, g + 0.6, 0), w * 1.55, 0.8, w * 1.55, { taper: 0.94 });
  if (state === 'gone') {
    rubble(ctx, b, M.marble, x, z, 6, 5, rng, { size: [0.5, 1.6] });
    return;
  }
  if (state === 'fallen') {
    // lies across the kerb, pointing out from the way, broken in two
    const dir = yaw + side * (Math.PI / 2) + (rng() - 0.5) * 0.9;
    let d = 1.5;
    for (let k = 0; k < 2; k++) {
      const len = k === 0 ? H * 0.55 : H * 0.35;
      const px = x + Math.sin(dir) * (d + len / 2);
      const pz = z + Math.cos(dir) * (d + len / 2);
      const gy = ctx.heightAt(px, pz);
      b.setGround(gy, 3);
      const m = mat(px, gy + w * 0.12, pz, dir + (rng() - 0.5) * 0.2, Math.PI / 2 + (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.3).multiply(mat(0, -len / 2, 0));
      b.box(M.marble, m, w, len, w, { taper: 0.92, jit: 0.08 });
      d += len + 1 + rng() * 2;
    }
    const px = x + Math.sin(dir) * (d + 1.5);
    const pz = z + Math.cos(dir) * (d + 1.5);
    const gy = ctx.heightAt(px, pz);
    b.setGround(gy, 3);
    b.box(M.marble, mat(px, gy - 0.6, pz, rng() * 6.28, 0.6, 0.4), w * 1.3, w * 1.3, w * 1.3, { jit: 0.1 });
    return;
  }
  const lean = state === 'lean' ? [(rng() - 0.5) * 0.12, side * (0.08 + rng() * 0.08)] : [(rng() - 0.5) * 0.015, (rng() - 0.5) * 0.015];
  const S = sub(F, 0, g + 1.4, 0, 0, lean[0], lean[1]);
  const Hs = state === 'broken' ? H * (0.3 + rng() * 0.4) : H;
  const drums = 3;
  const dh = H / drums;
  let y = 0;
  for (let k = 0; k < drums && y < Hs - 0.5; k++) {
    const h = Math.min(dh, Hs - y) - 0.08;
    const t0 = 1 - 0.18 * (y / H);
    const t1 = 1 - 0.18 * ((y + h) / H);
    b.box(M.marble, sub(S, 0, y, 0, (rng() - 0.5) * 0.02), w * t0, h, w * t0, { taper: t1 / t0, jit: state === 'broken' && y + dh >= Hs ? 0.15 : 0.02 });
    y += dh;
  }
  // inscribed panel on the face turned toward the way (-side along local x)
  const ph = Math.min(Hs - 2, H * 0.5);
  if (ph > 2) b.box(M.glyph, sub(S, -side * (w * 0.46), 2.2, 0), 0.2, ph, w * 0.5);
  if (state !== 'broken') {
    const wt = w * 0.82;
    b.box(M.smooth, sub(S, 0, H, 0), wt + 0.5, 0.6, wt + 0.5);
    if (gateH) return; // the lintel rests here
    // diamond-set cube capstone
    const cs = wt * 1.05;
    b.box(M.marble, sub(S, 0, H + 0.6 + 0.15, 0, Math.PI / 4, 0, 0), cs, cs, cs);
    b.box(M.marble, sub(S, 0, H + 0.6 + cs + 0.15, 0, Math.PI / 4), cs * 0.7, cs * 0.8, cs * 0.7, { taper: 0.02 });
  } else {
    raggedTop(b, M.marble, sub(S, 0, Hs - 0.5, 0), w * 0.9, w * 0.9, 0, 1.5, rng, { course: 0.7, blockW: 0.9 });
    rubble(ctx, b, M.marble, x, z, 8, 6, rng, { size: [0.4, 1.4] });
  }
}

/** Terminal pylon at the Wardens' terrace edge: black obsidian, inscribed, 30 m. */
function terminalPylon(ctx, b, M, rng, x, g, z, yaw, side) {
  const F = mat(x, 0, z, yaw);
  b.setGround(g, 5);
  b.box(M.basalt, sub(F, 0, g - 2.5, 0), 11, 3.5, 11, { jit: 0.15 });
  b.box(M.basalt, sub(F, 0, g + 1, 0), 9, 1.4, 9, { taper: 0.95 });
  const H = 38;
  b.box(M.obsidian, sub(F, 0, g + 2.4, 0, 0, 0, side * 0.012), 6.2, H, 6.2, { taper: 0.72 });
  b.box(M.smooth, sub(F, 0, g + 2.4 + H, 0), 5.4, 1.0, 5.4);
  raggedTop(b, M.obsidianPlain, sub(F, 0, g + 3.4 + H, 0), 4.2, 4.2, 0, 3.5, rng, { course: 1.0, blockW: 1.4 });
}
