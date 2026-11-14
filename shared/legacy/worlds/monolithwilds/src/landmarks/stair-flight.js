// The stair body: stringers, soffit, steps, landing floors, balustrades, newels, soffit ribs,
// breaches (collapsed stretches where only the outer stringer still spans the gap) and the
// random missing railing sections / fallen steps.
//
// Cross-section (u across, + = outward from the helix axis; v up from the pitch line):
//
//        rail ▄▄                                   ▄▄ rail (bronze strip on top)
//   balusters ║║                                   ║║
//        curb ██ ▁▁▁▁ steps (sawtooth above v=0) ▁▁ ██ curb   (v 0 .. 0.45)
//    stringer ██▔▔▔▔▔▔▔▔▔▔▔▔ slab ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔██ stringer (v -d .. 0)
//             ▀▀        soffit (recessed 0.18)       ▀▀
//
// Everything is emitted into per-material Writers (see stair-geo.js).

import { STAIR } from './stair-path.js';

const ws = STAIR.stringer;
const CURB = STAIR.curb;
const HB = 0.86; // baluster height
const RAIL_H = 0.22;
const UP = [0, 1, 0];

// profiles: [ku, cu, kv, cv] → u = ku·hw + cu, v = kv·d + cv
const OUT_BODY = [[1, -ws, -1, 0], [1, 0, -1, 0], [1, 0, 0, 0], [1, -ws, 0, 0]];
const IN_BODY = [[-1, 0, -1, 0], [-1, ws, -1, 0], [-1, ws, 0, 0], [-1, 0, 0, 0]];
const OUT_CURB = [[1, -ws, 0, 0], [1, 0, 0, 0], [1, 0, 0, CURB], [1, -ws, 0, CURB]];
const IN_CURB = [[-1, 0, 0, 0], [-1, ws, 0, 0], [-1, ws, 0, CURB], [-1, 0, 0, CURB]];
const SOFFIT = [[-1, ws, -1, 0.18], [1, -ws, -1, 0.18]];
const FLOOR = [[1, -ws + 0.02, 0, 0], [-1, ws - 0.02, 0, 0]];
// drip moulding along the outer faces (a crisp shadow line readable from far)
const OUT_BAND = [[1, 0, -1, 0.3], [1, 0.16, -1, 0.36], [1, 0.16, -1, 0.58], [1, 0, -1, 0.64]];
const IN_BAND = [[-1, 0, -1, 0.64], [-1, -0.16, -1, 0.58], [-1, -0.16, -1, 0.36], [-1, 0, -1, 0.3]];
// cornice on the curb top, projecting outward
const OUT_CORN = [[1, 0, 0, CURB - 0.16], [1, 0.12, 0, CURB - 0.1], [1, 0.12, 0, CURB + 0.04], [1, -ws, 0, CURB + 0.04]];
const IN_CORN = [[-1, ws, 0, CURB + 0.04], [-1, -0.12, 0, CURB + 0.04], [-1, -0.12, 0, CURB - 0.1], [-1, 0, 0, CURB - 0.16]];
const railProfile = (side) => {
  const c = side > 0 ? -ws / 2 : ws / 2;
  const k = side;
  const v0 = CURB + HB, v1 = v0 + RAIL_H;
  return [[k, c - 0.27, 0, v0], [k, c + 0.27, 0, v0], [k, c + 0.29, 0, v1 - 0.06], [k, c + 0.24, 0, v1], [k, c - 0.24, 0, v1], [k, c - 0.29, 0, v1 - 0.06]];
};
const bronzeProfile = (side) => {
  const c = side > 0 ? -ws / 2 : ws / 2;
  const v = CURB + HB + RAIL_H;
  return [[side, c - 0.07, 0, v - 0.01], [side, c + 0.07, 0, v - 0.01], [side, c + 0.05, 0, v + 0.05], [side, c - 0.05, 0, v + 0.05]];
};

/** Subtract intervals from [[a, b], ...]. */
function subtract(runs, holes) {
  let out = runs;
  for (const [h0, h1] of holes) {
    const next = [];
    for (const [a, b] of out) {
      if (h1 <= a || h0 >= b) next.push([a, b]);
      else {
        if (h0 > a) next.push([a, h0]);
        if (h1 < b) next.push([h1, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 0.3);
}

export function buildFlights(ctx, P, W, rng, zoneOf, weather) {
  const { rise, run } = STAIR;
  const segs = P.segs;
  const sEnd = P.sTop0; // the door platform is built with the door
  const info = { breaches: [], steps: 0, missingSteps: [], balusters: 0, railGaps: [] };

  // ---- breaches: three collapsed stretches in mid-height flights
  const candidates = P.flights.filter((g) => !g.tail && g.y0 > 90 && g.y0 < 520);
  const picks = [];
  for (let k = 0; k < 3 && candidates.length; k++) {
    const idx = Math.floor(((k + 0.35 + rng() * 0.3) / 3) * candidates.length);
    const g = candidates[Math.min(candidates.length - 1, idx)];
    if (picks.includes(g)) continue;
    picks.push(g);
    const j0 = rng.int(24, Math.max(25, g.n - 40));
    const len = rng.int(9, 18);
    const b0 = g.s0 + j0 * run, b1 = b0 + len * run;
    info.breaches.push({ s0: b0, s1: b1, g, j0, j1: j0 + len });
  }
  const inBreach = (s) => info.breaches.some((b) => s > b.s0 - 1e-3 && s < b.s1 + 1e-3);
  const breachHoles = info.breaches.map((b) => [b.s0, b.s1]);

  // ---- landing features that interrupt the balustrade
  const bays = [];
  const pylons = [];
  const shrines = [];
  for (const g of P.landings) {
    const mid = (g.s0 + g.s1) / 2;
    if (g.feature === 'gate' || g.feature === 'door') continue;
    g.bay = [mid - 4.0, mid + 4.0];
    bays.push(g.bay);
    if (g.feature === 'arch') pylons.push([mid - 0.75, mid + 0.75]);
    if (g.feature === 'shrine') shrines.push([mid - 1.75, mid + 1.75]);
  }

  // ---- random missing railing sections (weathered lower flights lose more)
  const gaps = { 1: [], [-1]: [] };
  for (const side of [1, -1]) {
    for (let s = 14; s < sEnd - 6; s += 1) {
      const y = P.yLine(s);
      const p = y < 200 ? 0.0055 : y < 450 ? 0.0035 : 0.0045;
      if (rng() < p) {
        const len = rng.range(2.5, 13);
        gaps[side].push([s, s + len]);
        info.railGaps.push({ s0: s, s1: s + len, side });
        s += len + 20;
      }
    }
  }
  // the unwound tail: its outer rail gives out a third of the way up — the last metres are bare
  const tail = P.flights.find((g) => g.tail);
  if (tail) {
    const a = tail.s0 + (tail.s1 - tail.s0) * 0.62;
    gaps[1].push([a, sEnd + 1]);
    gaps[-1].push([tail.s0 + (tail.s1 - tail.s0) * 0.3, tail.s0 + (tail.s1 - tail.s0) * 0.41]);
    gaps[-1].push([tail.s0 + (tail.s1 - tail.s0) * 0.84, sEnd + 1]);
  }

  // ---- per-segment sweeps (zone = material by height)
  const weatherFrame = (fr) => {
    fr.t = weather(fr.o[1]);
  };
  for (const g of segs) {
    if (g.feature === 'door') continue;
    const w = W[zoneOf(g.y0)];
    const fr = P.frames(g.s0, g.s1, 2.2, weatherFrame);
    // outer body + drip band: continuous
    w.sweep(fr, OUT_BODY, { closed: true, edges: [0, 1, 2, 3] });
    w.sweep(fr, OUT_BAND, { edges: [0, 1, 2] });
    // inner body, soffit: interrupted by breaches
    const solid = subtract([[g.s0, g.s1]], breachHoles);
    for (const [a, b] of solid) {
      const f2 = a === g.s0 && b === g.s1 ? fr : P.frames(a, b, 2.2, weatherFrame);
      const capS = a > g.s0 + 1e-3;
      const capE = b < g.s1 - 1e-3;
      w.sweep(f2, IN_BODY, { closed: true, edges: [0, 1, 2, 3], capStart: capS, capEnd: capE });
      w.sweep(f2, IN_BAND, { edges: [0, 1, 2] });
      w.sweep(f2, SOFFIT);
      if (capS || capE) {
        // broken slab ends: the full section between the stringers
        const SLAB = [[-1, ws, -1, 0.18], [1, -ws, -1, 0.18], [1, -ws, 0, 0], [-1, ws, 0, 0]];
        if (capS) w.sweepCap(f2[0], f2[1], SLAB, (f, e) => e[0] * f.hw + e[1], (f, e) => e[2] * f.d + e[3]);
        if (capE) w.sweepCap(f2[f2.length - 1], f2[f2.length - 2], SLAB, (f, e) => e[0] * f.hw + e[1], (f, e) => e[2] * f.d + e[3]);
      }
      if (g.kind === 'landing') w.sweep(f2, FLOOR);
    }
    // curbs
    const outerCurb = g.bay ? subtract([[g.s0, g.s1]], [g.bay]) : [[g.s0, g.s1]];
    for (const [a, b] of outerCurb) {
      const f2 = P.frames(a, b, 2.2, weatherFrame);
      const cs = a > g.s0 + 1e-3, ce = b < g.s1 - 1e-3;
      w.sweep(f2, OUT_CURB, { closed: true, edges: [1, 3], capStart: cs, capEnd: ce });
      w.sweep(f2, OUT_CORN, { edges: [0, 1, 2] });
    }
    for (const [a, b] of solid) {
      const f2 = P.frames(a, b, 2.2, weatherFrame);
      w.sweep(f2, IN_CURB, { closed: true, edges: [1, 3], capStart: a > g.s0 + 1e-3, capEnd: b < g.s1 - 1e-3 });
      w.sweep(f2, IN_CORN, { edges: [0, 1, 2] });
    }
  }

  // ---- steps
  const fa = {}, fb = {};
  const pt = (f, u, y) => [f.x + f.nx * u, y, f.z + f.nz * u];
  for (const g of P.flights) {
    const w = W[zoneOf(g.y0)];
    const base = w.tint;
    for (let j = 0; j < g.n; j++) {
      const sa = g.s0 + j * run;
      const sb = sa + run;
      const sm = sa + run * 0.5;
      if (inBreach(sm)) continue;
      P.plan(sa - 0.035, fa);
      P.plan(sb, fb);
      const hw = P.width(sa) / 2 - ws + 0.03;
      const yt = g.y0 + (j + 1) * rise + (rng() - 0.5) * 0.012;
      const wth = weather(yt);
      const k = wth * (0.88 + rng() * 0.16) * (j % 11 === 5 ? 0.93 : 1);
      w.tint = [base[0] * k, base[1] * k, base[2] * k];
      const missing = j > 3 && j < g.n - 3 && rng() < 0.011;
      if (missing) {
        // a fallen tread: the rough bedding shows, the next riser stands taller
        const yb = yt - rise - 0.06;
        w.quadN(pt(fa, -hw, yb), pt(fa, hw, yb), pt(fb, hw, yb), pt(fb, -hw, yb), UP);
        info.missingSteps.push({ s: sm, y: yt });
        continue;
      }
      info.steps++;
      // each step is 2–3 stones laid across: own tone, a few mm of settlement each
      const ylo = yt - rise - 0.1;
      const fr = P.plan(sa, {});
      const back = [-fr.tx, 0, -fr.tz];
      const nStone = rng() < 0.45 ? 2 : 3;
      let ua = -hw;
      for (let q = 0; q < nStone; q++) {
        const ub = q === nStone - 1 ? hw : ua + (2 * hw * (0.75 + rng() * 0.5)) / nStone;
        const ys = yt + (rng() - 0.5) * 0.012;
        const kq = k * (0.86 + rng() * 0.2) * (rng() < 0.06 ? 0.85 : 1);
        w.tint = [base[0] * kq, base[1] * kq, base[2] * kq];
        w.quadN(pt(fa, ua, ys), pt(fa, ub, ys), pt(fb, ub, ys), pt(fb, ua, ys), UP);
        w.quadN(pt(fa, ub, ys), pt(fa, ua, ys), pt(fa, ua, ys - 0.055), pt(fa, ub, ys - 0.055), back);
        w.quadN(pt(fr, ub, ys - 0.055), pt(fr, ua, ys - 0.055), pt(fr, ua, ylo), pt(fr, ub, ylo), back);
        ua = ub;
      }
    }
    w.tint = base;
  }

  // ---- soffit ribs (heavier below; the upper stair is clean and smooth)
  for (let s = 12; s < sEnd - 2; s += 3.8) {
    if (inBreach(s) || inBreach(s + 0.6) || inBreach(s - 0.6)) continue;
    const y = P.yLine(s);
    if (y > 430) break;
    const w = W[zoneOf(y)];
    const f = P.plan(s, {});
    const hw = P.width(s) / 2 - ws;
    const d = P.depth(s);
    const slope = P.slopeAt(s);
    const yc = y - d + 0.18 - 0.2;
    const kk = weather(y);
    const t0 = w.tint;
    w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
    w.box([f.x, yc, f.z], [f.nx * hw, 0, f.nz * hw], [0, 0.22, 0], [f.tx * 0.28, slope * 0.28, f.tz * 0.28]);
    w.tint = t0;
  }

  // ---- balustrades
  const balRuns = {};
  for (const side of [1, -1]) {
    let runs = [[1.2, sEnd]];
    const holes = [...gaps[side], ...pylons];
    if (side > 0) holes.push(...bays);
    else holes.push(...breachHoles, ...shrines);
    runs = subtract(runs, holes);
    balRuns[side] = runs;
    for (const [a, b] of runs) {
      // rail + bronze strip, split per zone
      const cuts = [a];
      for (const g of segs) if (g.s0 > a && g.s0 < b && zoneOf(g.y0) !== zoneOf(P.yLine(g.s0 - 0.1))) cuts.push(g.s0);
      cuts.push(b);
      for (let c = 0; c < cuts.length - 1; c++) {
        const fr = P.frames(cuts[c], cuts[c + 1], 2.2, weatherFrame);
        const w = W[zoneOf(P.yLine((cuts[c] + cuts[c + 1]) / 2))];
        w.sweep(fr, railProfile(side), { closed: true, capStart: c === 0, capEnd: c === cuts.length - 2 });
        W.bronze.sweep(P.frames(cuts[c], cuts[c + 1], 2.2), bronzeProfile(side), { closed: true, edges: [1, 2, 3] });
      }
      // balusters
      const n = Math.max(1, Math.round((b - a) / 0.62));
      for (let k = 0; k <= n; k++) {
        const s = a + ((b - a) * k) / n;
        const y = P.yLine(s);
        const w = W[zoneOf(y)];
        const f = P.plan(s, {});
        const u = side * (P.width(s) / 2 - ws / 2);
        const x = f.x + f.nx * u, z = f.z + f.nz * u;
        const kk = weather(y) * (0.92 + rng() * 0.1);
        const t0 = w.tint;
        w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
        // a broken baluster at the lip of a gap
        const broken = (k === 0 && a > 1.3) || (k === n && b < sEnd - 0.1);
        const h = broken ? 0.35 + rng() * 0.3 : HB;
        const prof = broken
          ? [[0.085, 0], [0.05, 0.16], [0.09, h]]
          : [[0.085, 0], [0.05, 0.16], [0.1, 0.44], [0.05, 0.74], [0.085, HB]];
        w.lathe(x, y + CURB, z, prof, 4, Math.atan2(f.tz, f.tx) + Math.PI / 4, { capTop: broken });
        w.tint = t0;
        info.balusters++;
      }
    }
  }

  // ---- newels at every flight start/end and at run ends beside bays / arches
  const newel = (s, side, bronzeCap) => {
    const y = P.yLine(s);
    const w = W[zoneOf(y)];
    const f = P.plan(s, {});
    const u = side * (P.width(s) / 2 - ws / 2);
    const x = f.x + f.nx * u, z = f.z + f.nz * u;
    const yaw = Math.atan2(f.tx, f.tz);
    const kk = weather(y);
    const t0 = w.tint;
    w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
    const h = CURB + HB + RAIL_H + 0.3;
    w.block(x, y + h / 2 - 0.05, z, 0.66, h + 0.1, 0.66, yaw);
    w.block(x, y + h + 0.06, z, 0.84, 0.14, 0.84, yaw);
    w.block(x, y + h + 0.19, z, 0.6, 0.12, 0.6, yaw);
    w.tint = t0;
    if (bronzeCap) W.bronze.lathe(x, y + h + 0.25, z, [[0.16, 0], [0.24, 0.12], [0.2, 0.3], [0.08, 0.4], [0.03, 0.62], [0, 0.66]], 6, 0);
  };
  const onRun = (s, side) => balRuns[side].some(([a, b]) => s >= a - 0.4 && s <= b + 0.4);
  for (const g of P.flights) {
    for (const side of [1, -1]) {
      for (const s of [g.s0 + 0.2, g.s1 - 0.2]) {
        if (onRun(s, side)) newel(s, side, rng() < 0.45);
      }
    }
  }
  for (const [a, b] of [...bays]) {
    if (onRun(a - 0.5, 1)) newel(a - 0.3, 1, true);
    if (onRun(b + 0.5, 1)) newel(b + 0.3, 1, true);
  }

  // ---- bronze threshold strips across every landing
  for (const g of P.landings) {
    if (g.feature === 'door') continue;
    for (const s of [g.s0 + 0.25, g.s1 - 0.25]) {
      const f = P.plan(s, {});
      const y = g.y0 + 0.012;
      const hw = P.width(s) / 2 - ws;
      W.bronze.quadN(pt(f, hw, y), pt(f, -hw, y), [f.x - f.nx * hw + f.tx * 0.14, y, f.z - f.nz * hw + f.tz * 0.14], [f.x + f.nx * hw + f.tx * 0.14, y, f.z + f.nz * hw + f.tz * 0.14], UP);
    }
  }

  // ---- rubble teeth at the breach lips (the slab broke, it did not end)
  for (const b of info.breaches) {
    for (const s of [b.s0, b.s1]) {
      const sgn = s === b.s0 ? 1 : -1;
      const y = P.yLine(s);
      const w = W[zoneOf(y)];
      const f = P.plan(s, {});
      const hw = P.width(s) / 2 - ws;
      const d = P.depth(s);
      for (let k = 0; k < 6; k++) {
        const u = -hw + rng() * hw * 2;
        const len = 0.4 + rng() * 1.2;
        const cx = f.x + f.nx * u + f.tx * sgn * len * 0.4;
        const cz = f.z + f.nz * u + f.tz * sgn * len * 0.4;
        const hh = 0.3 + rng() * (d - 0.5);
        w.block(cx, y - 0.1 - hh / 2 - rng() * 0.4, cz, 0.5 + rng() * 1.1, hh, len, Math.atan2(f.tx, f.tz) + (rng() - 0.5) * 0.4);
      }
    }
  }

  return info;
}
