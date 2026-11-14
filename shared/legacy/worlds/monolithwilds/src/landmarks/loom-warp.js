// The Loom of Hours — the warp: every thread, weight, tether and coil.
//
// Layout logic (ring-local frame, see loom-ring.js; converted to world by frame.toWorld):
//   * Threads hang from the heddle-tooth tips of the upper arc (θ 18°..162°), a small fan per
//     tooth. The upper arc is split into the ten hour-sectors between hour-blocks; each sector
//     has its own "state" of the unfinished work:
//       remnants  — short snapped threads with frayed ends
//       spools    — each tooth's fan ends in a hanging stone spool (warp-weighted loom)
//       bundles   — 10–20 threads converge into one great pyramidal loom weight
//       broken    — below the missing voussoir: sparse, snapped, the weights have fallen
//       woven     — the warp is gathered into one plane and carries the stone tapestry
//                   (loom-weave.js); below its ragged edge it continues to a row of weights
//   * The plumb line: a bundle hanging from the noon heddle straight down through the gap left
//     by the fallen midnight block, all the way to the valley floor, where it coils.
//   * A few heavy cables drape over the lower arc and pool on the ground in front.
//   * Eight taut tethers run from hour-block tips to anchor blocks on the valley walls/floor:
//     the ring does not rest on anything — it is tied down, as if it wanted to rise.

import * as THREE from 'crownfall-world-three';
import { RING, hourAngle } from './loom-ring.js';
import { WEAVE } from './loom-weave.js';

const COLORS = {
  iron: [0.16, 0.14, 0.13],
  ironWarm: [0.22, 0.16, 0.12],
  bone: [0.52, 0.47, 0.39],
  pale: [0.62, 0.58, 0.5],
  verdigris: [0.2, 0.34, 0.3],
};

function threadColor(rng) {
  const r = rng();
  if (r < 0.52) return COLORS.iron;
  if (r < 0.7) return COLORS.ironWarm;
  if (r < 0.9) return COLORS.bone;
  if (r < 0.96) return COLORS.pale;
  return COLORS.verdigris;
}

/** Pendulum sway profile: fixed at s=0, free end at s=1 with amplitude A. */
const hang = (A) => (s) => A * Math.pow(s, 1.6);

/** Straight polyline from a to b with n segments, optionally sagging by `sag` metres. */
function line(a, b, n, sag = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  return pts;
}

/**
 * @param ctx
 * @param frame  { toWorld(x,y,z) -> [x,y,z], yaw, cx, cy, cz }
 * @param ring   result of buildRingLocal
 * @param rng
 * @param threads ThreadSet
 * @param sinks  { stone, basalt, bronze } world-space Tris for anchors etc.
 */
export function buildWarp(ctx, frame, ring, rng, threads, sinks) {
  const W = frame.toWorld;
  const spools = []; // { pos:[x,y,z] top attach point (world), scale, rot, sway:[w,ph,y], glow }
  const weights = [];
  const coils = []; // ground coils / heaps for loom.js debris logic

  const upper = ring.teeth.filter((t) => t.ok && t.y > 0 && t.t > (18 * Math.PI) / 180 && t.t < (162 * Math.PI) / 180);
  const sectorOf = (t) => Math.floor(((t * 180) / Math.PI - 15) / 15); // 0..9
  const SECTOR = ['remnants', 'spools', 'broken', 'bundles', 'spools', 'bundles', 'woven', 'woven', 'woven', 'woven'];
  // bottom line of the free warp (local y): an inner arc, stepped per hour sector
  const sectorLevel = [0.2, 0.58, 0.35, 0.72, 0.9, 0.78, 0.6, 0.66, 0.55, 0.45];
  const bottomY = (x, m) => -sectorLevel[m] * Math.sqrt(Math.max(0, RING.R_TOOTH * RING.R_TOOTH - x * x)) * 0.72 - 8;
  const lowerLimit = (x) => -Math.sqrt(Math.max(0, 226 * 226 - x * x)) + 26; // stay clear of the lower comb

  const phaseAt = (x) => x * 0.011 + rng.range(-0.5, 0.5);
  // the Eye (loom.js) turns at the centre, radius 43: nothing may hang into its sweep
  const EYE_CLEAR = 64;

  // ---------------------------------------------------------------------------
  // helper: hang a fan of threads from a tooth down to a common end point
  // ---------------------------------------------------------------------------
  // low quality: roughly half the fine warp
  const density = ctx.quality?.level === 'low' ? 0.5 : 1;
  const fan = (tooth, endLocal, count, { radius = [0.12, 0.28], phase, A, glowChance = 0.03, spread = 0.9, color = null }) => {
    count = Math.max(1, Math.round(count * density));
    const start = [tooth.x, tooth.y, tooth.a];
    const endW = W(endLocal[0], endLocal[1], endLocal[2]);
    const L = start[1] - endLocal[1];
    const n = Math.max(3, Math.min(16, Math.ceil(L / 26)));
    for (let f = 0; f < count; f++) {
      const sx = start[0] + rng.range(-spread, spread);
      const sa = start[2] + rng.range(-spread, spread);
      const a = W(sx, start[1] - 0.5, sa);
      threads.add(line(a, endW, n), {
        radius: rng.range(radius[0], radius[1]),
        phase,
        sway: hang(A),
        color: color || threadColor(rng),
        glow: rng.chance(glowChance) ? rng.range(0.6, 1.0) : 0,
      });
    }
    return endW;
  };

  // ---------------------------------------------------------------------------
  // non-woven sectors
  // ---------------------------------------------------------------------------
  const bySector = new Map();
  for (const t of upper) {
    const m = sectorOf(t.t);
    if (m < 0 || m > 9) continue;
    if (!bySector.has(m)) bySector.set(m, []);
    bySector.get(m).push(t);
  }

  for (const [m, list] of bySector) {
    const kind = SECTOR[m];
    list.sort((p, q) => p.x - q.x);
    if (kind === 'woven') continue; // handled below with the tapestry

    if (kind === 'spools' || kind === 'remnants' || kind === 'broken') {
      for (const tooth of list) {
        const x = tooth.x;
        let yb = bottomY(x, m) + rng.range(-10, 10);
        if (kind === 'spools' && rng.chance(0.12)) yb -= rng.range(15, 45); // a few hang far lower
        const snapped = kind === 'remnants' ? rng.chance(0.75) : kind === 'broken' ? rng.chance(0.7) : rng.chance(0.04);
        if (snapped) {
          // frayed remnant: several short threads, no weight
          const len = rng.range(4, kind === 'broken' ? 70 : 38);
          const cnt = rng.int(2, 6);
          for (let f = 0; f < cnt; f++) {
            const l2 = len * rng.range(0.6, 1.1);
            const a = W(tooth.x + rng.range(-0.6, 0.6), tooth.y - 0.5, tooth.a + rng.range(-0.6, 0.6));
            const b = W(tooth.x + rng.range(-1.5, 1.5), tooth.y - l2, tooth.a + rng.range(-1.5, 1.5));
            threads.add(line(a, b, Math.max(2, Math.ceil(l2 / 12))), { radius: rng.range(0.1, 0.24), phase: phaseAt(x), sway: hang(Math.min(3, l2 * 0.05)), color: threadColor(rng) });
          }
          continue;
        }
        yb = Math.max(yb, lowerLimit(x) + 12);
        if (Math.abs(x) < 58) yb = Math.max(yb, EYE_CLEAR + rng.range(0, 40)); // keep the Eye's lane clear
        yb = Math.min(yb, tooth.y - 25);
        const L = tooth.y - yb;
        const A = Math.min(6.5, 0.014 * L);
        const ph = phaseAt(x);
        const endLocal = [x + rng.range(-0.8, 0.8), yb, tooth.a * 0.9 + rng.range(-0.8, 0.8)];
        // a fan of fine warp plus the odd heavier strand
        const endW = fan(tooth, endLocal, rng.int(8, 13), { phase: ph, A, radius: [0.05, 0.19] });
        if (rng.chance(0.3)) fan(tooth, endLocal, 1, { phase: ph, A, radius: [0.3, 0.45], spread: 0.3 });
        const s = rng.range(0.75, 1.35) * (kind === 'spools' ? 1 : 0.9);
        spools.push({ pos: endW, scale: s, rot: rng.range(0, Math.PI * 2), sway: [A, ph, endW[1]], glow: rng.chance(0.14) });
      }
    }

    if (kind === 'bundles') {
      // groups of consecutive teeth (both rows) converge into one great weight
      const groups = [];
      let cur = [];
      for (const tooth of list) {
        cur.push(tooth);
        if (cur.length >= rng.int(7, 12)) {
          groups.push(cur);
          cur = [];
        }
      }
      if (cur.length) groups.push(cur);
      for (const g of groups) {
        let mx = 0;
        let my = Infinity;
        for (const t of g) {
          mx += t.x;
          my = Math.min(my, t.y);
        }
        mx /= g.length;
        let yb = bottomY(mx, m) + rng.range(-14, 14);
        yb = Math.max(yb, lowerLimit(mx) + 30);
        if (Math.abs(mx) < 62) yb = Math.max(yb, EYE_CLEAR + 8 + rng.range(0, 30));
        const L = my - yb;
        const A = Math.min(6, 0.012 * L);
        const ph = phaseAt(mx);
        const endLocal = [mx + rng.range(-2, 2), yb, rng.range(-1.5, 1.5)];
        let endW = null;
        for (const t of g) endW = fan(t, endLocal, rng.int(3, 6), { phase: ph, A, spread: 0.6, radius: [0.07, 0.24], glowChance: 0.04 });
        weights.push({ pos: endW, scale: rng.range(1.0, 1.4), rot: rng.range(0, Math.PI * 2), sway: [A, ph, endW[1]] });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // woven sectors: warp gathered into the tapestry plane (z = 0), continuing below the edge
  // ---------------------------------------------------------------------------
  const woven = upper.filter((t) => SECTOR[sectorOf(t.t)] === 'woven');
  const cols = WEAVE.columns(); // [{x, top, edge}] (local)
  for (const c of cols) {
    // nearest tooth above this column
    let best = null;
    let bd = Infinity;
    for (const t of woven) {
      const d = Math.abs(t.x - c.x);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best || bd > 6) continue;
    const ph = phaseAt(c.x);
    // below the ragged edge the warp hangs free to a row of weights (or has snapped)
    const ybase = bottomY(c.x, sectorOf(best.t));
    let yb = Math.min(c.edge - rng.range(30, 70), ybase + rng.range(-10, 10));
    yb = Math.max(yb, lowerLimit(c.x) + 12);
    const snapped = rng.chance(0.18);
    if (snapped) yb = c.edge - rng.range(2, 14);
    const L = c.edge - yb;
    const A = Math.min(4.5, 0.03 * L);
    // one heavy pale warp exactly in the weave plane (it shows across the slats behind it),
    // plus a couple of fine dark threads beside it
    const strands = [{ dx: 0, r: rng.range(0.34, 0.46), col: rng.chance(0.75) ? COLORS.bone : COLORS.pale }];
    for (let f = rng.int(2, 3); f > 0; f--) strands.push({ dx: rng.range(-0.45, 0.45), r: rng.range(0.1, 0.18), col: threadColor(rng) });
    for (const st of strands) {
      const row = rng.chance(0.5) ? 0 : 1;
      const top = W(best.x + rng.range(-0.5, 0.5), best.y - 0.5, RING.TOOTH_ROWS[row] + rng.range(-0.5, 0.5));
      const xo = c.x + st.dx;
      const zo = st.dx === 0 ? 0 : st.dx * 0.3;
      const gather = W(xo, c.top, zo);
      const edgeP = W(xo, c.edge, zo);
      const endP = W(xo + rng.range(-0.4, 0.4), yb, zo + rng.range(-0.3, 0.3));
      const pts = [top, gather];
      // straight, held (static) through the weave
      const nWeave = Math.max(1, Math.ceil((c.top - c.edge) / 30));
      for (let i = 1; i <= nWeave; i++) pts.push(W(xo, c.top + ((c.edge - c.top) * i) / nWeave, zo));
      const nFree = Math.max(2, Math.ceil(L / 20));
      const sw = [];
      for (let i = 0; i < pts.length; i++) sw.push(0);
      for (let i = 1; i <= nFree; i++) {
        const t = i / nFree;
        pts.push([edgeP[0] + (endP[0] - edgeP[0]) * t, edgeP[1] + (endP[1] - edgeP[1]) * t, edgeP[2] + (endP[2] - edgeP[2]) * t]);
        sw.push(A * Math.pow(t, 1.6));
      }
      threads.add(pts, { radius: st.r, phase: ph, sway: sw, color: st.col, glow: rng.chance(0.03) ? 0.8 : 0 });
    }
    if (!snapped) {
      const endW = W(c.x, yb, 0);
      if (rng.chance(0.5)) spools.push({ pos: endW, scale: rng.range(0.8, 1.15), rot: rng.range(0, 6.28), sway: [A, ph, endW[1]], glow: rng.chance(0.1) });
      else weights.push({ pos: endW, scale: rng.range(0.5, 0.7), rot: rng.range(0, 6.28), sway: [A, ph, endW[1]] });
    }
  }

  // ---------------------------------------------------------------------------
  // the plumb line: from the noon heddle straight down through the missing midnight block
  // ---------------------------------------------------------------------------
  const groundLocal = (x, z) => {
    const w = W(x, 0, z);
    return ctx.heightAt(w[0], w[2]) - frame.cy;
  };
  {
    // The bundle runs through the bore of the Eye, the great disc at the ring's centre
    // (loom.js builds it); it is held still there, so it sways above and below only.
    const topY = 224;
    const heapX = 6;
    const heapZ = 26;
    const gy = groundLocal(heapX, heapZ);
    const WH_TOP = 46;
    const WH_BOT = -46;
    for (let i = 0; i < 16; i++) {
      const sx = rng.range(-2.5, 2.5);
      const sz = rng.range(-3, 3);
      const ha = rng.range(0, Math.PI * 2);
      const hr = rng.range(0, 2.6);
      const hx = Math.cos(ha) * hr;
      const hz = Math.sin(ha) * hr;
      const bx = heapX + rng.range(-4, 4);
      const bz = heapZ + rng.range(-5, 5);
      const pts = [];
      const sw = [];
      // above the whorl
      const nA = 12;
      for (let k = 0; k <= nA; k++) {
        const t = k / nA;
        pts.push(W(sx + (hx - sx) * t, topY + (WH_TOP - topY) * t, sz + (hz - sz) * t));
        sw.push(3.2 * Math.sin(Math.PI * t));
      }
      pts.push(W(hx, WH_BOT, hz));
      sw.push(0);
      // below: straight down, drifting forward near the ground where it piles up
      const nB = 14;
      const drop = WH_BOT - (gy + 3);
      for (let k = 1; k <= nB; k++) {
        const t = k / nB;
        const bend = Math.pow(t, 6);
        pts.push(W(hx + (bx - hx) * bend, WH_BOT - drop * t, hz + (bz - hz) * bend));
        sw.push(3.2 * Math.sin(Math.PI * Math.min(1, t / 0.95)) * (1 - Math.pow(t, 8)));
      }
      threads.add(pts, { radius: i < 3 ? rng.range(0.7, 1.0) : rng.range(0.25, 0.5), phase: 0.3 + rng.range(-0.15, 0.15), sway: sw, color: i % 4 === 0 ? COLORS.bone : COLORS.iron, glow: i === 5 || i === 9 ? 1.0 : 0 });
      coils.push({ local: [bx, bz], r: rng.range(5, 11), turns: rng.range(2.5, 4.5), radius: i < 3 ? 0.8 : 0.35, color: i % 4 === 0 ? COLORS.bone : COLORS.iron });
    }
  }

  // ---------------------------------------------------------------------------
  // heavy cables draped over the lower arc, pooling on the ground in front
  // ---------------------------------------------------------------------------
  const drapeXs = [-118, -96, -71, 58, 84, 109, 131];
  for (const dx of drapeXs) {
    // top: nearest upper tooth
    let best = null;
    let bd = Infinity;
    for (const t of upper) {
      const d = Math.abs(t.x - dx);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best) continue;
    const x = best.x;
    const tc = Math.atan2(-Math.sqrt(Math.max(0, 242.5 * 242.5 - x * x)), x); // contact angle on the lower arc
    const Pl = (r, a) => [r * Math.cos(tc), r * Math.sin(tc), a];
    const cables = rng.int(1, 3);
    for (let c = 0; c < cables; c++) {
      const a0 = best.a;
      const off = rng.range(-0.6, 0.6);
      const loc = [];
      loc.push([x + off, best.y - 0.5, a0]);
      const contact = Pl(240.5, 3 + c * 1.5);
      const n = 14;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        loc.push([x + off + (contact[0] - x) * t, best.y + (contact[1] - best.y) * t, a0 + (contact[2] - a0) * t]);
      }
      // wrap over the soffit, the face and the fillet (following the section profile)
      for (const [r, a] of [[240.8, 9], [241.6, 15.2], [245, 17.6], [248.5, 20.2], [258.8, 21.2], [268, 21.8], [274, 22.4], [276.5, 22.8]]) loc.push(Pl(r, a + c * 0.3));
      const last = loc[loc.length - 1];
      const wl = W(last[0], last[1], last[2]);
      const gy = ctx.heightAt(wl[0], wl[2]);
      const pts = loc.map((p) => W(p[0], p[1], p[2]));
      // free fall to the ground, drifting slightly forward
      const fall = wl[1] - gy;
      const nz = [Math.sin(frame.yaw), 0, Math.cos(frame.yaw)];
      const drift = rng.range(4, 14);
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        pts.push([wl[0] + nz[0] * drift * t * t, wl[1] - fall * t + 0.6, wl[2] + nz[2] * drift * t * t]);
      }
      const nUp = n; // sway only along the hanging span inside the ring
      const sw = pts.map((_, k) => (k < nUp ? 3.5 * Math.sin((Math.PI * k) / nUp) : 0));
      threads.add(pts, { radius: rng.range(0.55, 0.95), phase: phaseAt(x), sway: sw, color: c === 0 ? COLORS.ironWarm : COLORS.iron });
      const end = pts[pts.length - 1];
      coils.push({ world: [end[0] + nz[0] * 4, end[2] + nz[2] * 4], r: rng.range(6, 12), turns: rng.range(2, 4), radius: 0.7, color: COLORS.ironWarm });
    }
  }

  // ---------------------------------------------------------------------------
  // tethers: taut cables from hour-block tips to anchors on the valley walls / floor
  // ---------------------------------------------------------------------------
  const tethers = [
    { j: 18, to: [790, -1600] },
    { j: 18, to: [770, -1905] },
    { j: 6, to: [-60, -1590] },
    { j: 6, to: [-80, -1880] },
    { j: 14, to: [640, -1500] },
    { j: 10, to: [95, -1995] },
    { j: 15, to: [700, -2060] },
    { j: 9, to: [0, -1470] },
  ];
  const anchors = [];
  for (const tt of tethers) {
    const t = hourAngle(tt.j);
    const rt = (ring.hourTip[tt.j] ?? 292) - 2;
    const tip = W(rt * Math.cos(t), rt * Math.sin(t), 0);
    const gx = tt.to[0];
    const gz = tt.to[1];
    const gy = ctx.heightAt(gx, gz);
    const anchor = [gx, gy + 9, gz];
    const L = Math.hypot(anchor[0] - tip[0], anchor[1] - tip[1], anchor[2] - tip[2]);
    threads.add(line(tip, anchor, Math.max(4, Math.ceil(L / 60)), 0), { radius: 0.55, phase: 0, sway: () => 0, color: COLORS.ironWarm, twist: 2.6 });
    // a second, thinner strand beside it (reads as a braided pair up close)
    const o = 1.4;
    threads.add(line([tip[0] + o, tip[1], tip[2]], [anchor[0] + o * 0.6, anchor[1], anchor[2]], Math.max(4, Math.ceil(L / 60)), 0), { radius: 0.3, phase: 0, sway: () => 0, color: COLORS.iron, twist: 1.8 });
    anchors.push({ pos: anchor, dir: [tip[0] - anchor[0], tip[1] - anchor[1], tip[2] - anchor[2]], ground: gy });
  }

  // ---------------------------------------------------------------------------
  // hanging moss: clumps of dark olive strands dripping from the inner lip of the upper arc
  // (the ring has hung here long enough for things to grow on it)
  // ---------------------------------------------------------------------------
  {
    const mossCols = [[0.09, 0.11, 0.05], [0.12, 0.13, 0.06], [0.16, 0.15, 0.08]];
    for (let i = 0; i < 70; i++) {
      const t = rng.range(0.15, Math.PI - 0.15);
      const clump = rng.int(4, 11);
      const sg = rng.chance(0.5) ? 1 : -1;
      const r0 = 248.6;
      const lenBase = rng.range(3, 16);
      for (let k = 0; k < clump; k++) {
        const tt = t + rng.range(-0.012, 0.012);
        const x = r0 * Math.cos(tt);
        const y = r0 * Math.sin(tt) - 0.5;
        const a = sg * (19.3 + rng.range(-0.3, 0.9));
        const len = lenBase * rng.range(0.35, 1.2);
        const top = W(x, y, a);
        const bot = W(x + rng.range(-0.6, 0.6), y - len, a + sg * rng.range(0, 0.8));
        threads.add(line(top, bot, 3), { radius: rng.range(0.12, 0.35), phase: phaseAt(x), sway: hang(Math.min(1.5, len * 0.08)), color: mossCols[k % 3], twist: 0.7 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ground coils (spiral heaps of cable lying on the terrain)
  // ---------------------------------------------------------------------------
  for (const c of coils) {
    let wx;
    let wz;
    if (c.world) {
      wx = c.world[0];
      wz = c.world[1];
    } else {
      const w = W(c.local[0], 0, c.local[1]);
      wx = w[0];
      wz = w[2];
    }
    const pts = [];
    const n = Math.ceil(c.turns * 22);
    const a0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const ang = a0 + t * c.turns * Math.PI * 2;
      const rr = c.r * (1 - 0.75 * t) + rng.range(-0.4, 0.4);
      const x = wx + Math.cos(ang) * rr;
      const z = wz + Math.sin(ang) * rr;
      const y = ctx.heightAt(x, z) + c.radius * 0.8 + t * c.radius * 2.2 + 0.15 * Math.sin(k * 1.7);
      pts.push([x, y, z]);
    }
    threads.add(pts, { radius: c.radius, phase: 0, sway: () => 0, color: c.color, twist: 1.2 });
  }

  return { spools, weights, anchors, coils };
}

/** Spool bobbin: lathe profile, attach point (top) at y = 0, hangs down to y = -H. */
export function spoolGeometry() {
  const H = 9;
  const prof = [
    [0.0, -H], [2.4, -H], [2.5, -H + 0.7], [1.5, -H + 1.3], [1.9, -H + 2.2], [2.05, -H + 4.5],
    [1.9, -H + 6.8], [1.5, -H + 7.6], [2.4, -H + 8.0], [2.4, -H + 8.5], [0.6, -H + 8.7], [0.35, -0.2], [0.0, 0.0],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), 10);
  g.computeVertexNormals();
  return g;
}

/** Glowing band around a spool's wound core (same frame as spoolGeometry). */
export function spoolBandGeometry() {
  const g = new THREE.CylinderGeometry(2.12, 2.12, 1.1, 12, 1, true);
  g.translate(0, -9 + 4.5, 0);
  return g;
}

/** Pyramidal loom weight with a pierced collar, attach point at y = 0, hangs to y = -H. */
export function weightGeometry() {
  const H = 16;
  const parts = [];
  // tapered four-sided body (wider at the bottom, like an ancient loom weight)
  const body = new THREE.CylinderGeometry(3.4, 5.2, 12.5, 4, 1).toNonIndexed();
  body.rotateY(Math.PI / 4);
  body.translate(0, -H + 6.25, 0);
  parts.push(body);
  // cap: short pyramid
  const cap = new THREE.CylinderGeometry(1.2, 3.4, 2.4, 4, 1).toNonIndexed();
  cap.rotateY(Math.PI / 4);
  cap.translate(0, -H + 12.5 + 1.2, 0);
  parts.push(cap);
  // ring/eye at the top (a thick square frame)
  const eye = new THREE.TorusGeometry(0.9, 0.35, 4, 8).toNonIndexed();
  eye.translate(0, -0.9, 0);
  parts.push(eye);
  const merged = new THREE.BufferGeometry();
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    o += p.attributes.position.array.length;
    p.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}
