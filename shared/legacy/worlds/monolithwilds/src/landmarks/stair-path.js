// The Stair's path: an expanding helix (Archimedean spiral in plan) that unwinds at the top
// into one straight flight thrown out over the lake, ending at the door.
//
// Construction logic: every turn lies ~17 m further out than the one below it, so each flight
// has its own clear column of air down to the ground/lake bed — that is what lets impossibly
// thin vertical piers carry it (no pier ever pierces a lower turn). In plan the radius grows as
// R(s) = sqrt(R0² + 2·K·s) (s = plan arclength), so the turns get longer and — at a constant
// stair slope — taller: tightly coiled at the islet, wide open and slow near the sky.
//
// Vertical profile: human-scale steps (rise 0.17, run 0.34 → 1:2, 26.6°) in flights of
// 118–176 steps, separated by flat landings. `yLine(s)` is the pitch line through the treads'
// back edges (= the landing floor on landings); every section (stringers, soffit, balustrade)
// hangs off it.

import { smoothstep, clamp } from '../core/noise.js';

export const STAIR = {
  rise: 0.17,
  run: 0.34,
  R0: 24, // radius of the first turn (m)
  turnGrowth: 19, // radial growth per turn (m): clear air between turns for the piers
  climb: 700, // total rise from the islet podium (m)
  tailSteps: 236, // the last straight flight, unwound from the helix
  stringer: 0.75, // width of the side stringers (m)
  curb: 0.45, // stringer curb above the pitch line (hides the steps' sawtooth)
  unsupported: 150, // the last metres of rise carry no piers
};

export function createPath(ctx, site, rng, { dir = -1, endDir = [0.9, -0.44], axisShift = [0, 0] } = {}) {
  const cx = site.x + axisShift[0];
  const cz = site.z + axisShift[1];
  const { rise, run, R0 } = STAIR;
  const K = STAIR.turnGrowth / (Math.PI * 2);

  // podium level: a little above the highest islet ground under it
  let gMax = -1e9;
  for (let r = 0; r <= 34; r += 5) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      gMax = Math.max(gMax, ctx.heightAt(cx + Math.cos(t) * r, cz + Math.sin(t) * r));
    }
  }
  const yBase = Math.max(9.5, Math.min(gMax + 0.4, 15));

  // ---- segments (flights / landings) along the plan arclength s
  const segs = [];
  let s = 0;
  let y = yBase;
  segs.push({ kind: 'landing', s0: 0, s1: 10, y0: y, y1: y, feature: 'gate', idx: 0 });
  s = 10;
  const spiralTop = yBase + STAIR.climb - STAIR.tailSteps * rise;
  let li = 1;
  const featureCycle = ['shrine', 'bench', 'shrine', 'arch', 'bench', 'shrine', 'lamp', 'arch'];
  while (spiralTop - y > 1) {
    let n = rng.int(118, 176);
    const rem = Math.round((spiralTop - y) / rise);
    if (rem < n + 70) n = rem;
    segs.push({ kind: 'flight', s0: s, s1: s + n * run, y0: y, y1: y + n * rise, n });
    s += n * run;
    y += n * rise;
    const feature = featureCycle[(li - 1) % featureCycle.length];
    const L = feature === 'arch' ? 14 : 9.5;
    segs.push({ kind: 'landing', s0: s, s1: s + L, y0: y, y1: y, feature, idx: li });
    s += L;
    li++;
  }
  const sSpiral = s; // the helix ends here; the tail flight leaves along its tangent
  segs.push({ kind: 'flight', s0: s, s1: s + STAIR.tailSteps * run, y0: y, y1: y + STAIR.tailSteps * rise, n: STAIR.tailSteps, tail: true });
  s += STAIR.tailSteps * run;
  y += STAIR.tailSteps * rise;
  const sTop0 = s;
  segs.push({ kind: 'landing', s0: s, s1: s + 12, y0: y, y1: y, feature: 'door', idx: li });
  s += 12;
  const sTotal = s;
  const yTop = y;

  // ---- plan: phase chosen so the tail flight points along endDir
  const Rend = Math.sqrt(R0 * R0 + 2 * K * sSpiral);
  const ed = Math.hypot(endDir[0], endDir[1]);
  const ex = endDir[0] / ed, ez = endDir[1] / ed;
  // tangent ≈ dir·(-sinθ, cosθ)  →  θ_end
  const thEnd = dir > 0 ? Math.atan2(-ex, ez) : Math.atan2(ex, -ez);
  const th0 = thEnd - (dir * (Rend - R0)) / K;

  const spiral = (ss, out) => {
    const R = Math.sqrt(R0 * R0 + 2 * K * ss);
    const th = th0 + (dir * (R - R0)) / K;
    const c = Math.cos(th), sn = Math.sin(th);
    out.x = cx + c * R;
    out.z = cz + sn * R;
    let tx = (K / R) * c - dir * sn;
    let tz = (K / R) * sn + dir * c;
    const tl = Math.hypot(tx, tz);
    tx /= tl;
    tz /= tl;
    out.tx = tx;
    out.tz = tz;
    // outward normal: perpendicular to T, pointing away from the axis
    let nx = tz, nz = -tx;
    if (nx * c + nz * sn < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.nx = nx;
    out.nz = nz;
    out.R = R;
    out.th = th;
    return out;
  };
  const endF = spiral(sSpiral, {});

  /** Plan frame at s: x, z, tx, tz (tangent), nx, nz (outward), R. */
  const plan = (ss, out = {}) => {
    if (ss <= sSpiral) return spiral(Math.max(0, ss), out);
    const d = ss - sSpiral;
    out.x = endF.x + endF.tx * d;
    out.z = endF.z + endF.tz * d;
    out.tx = endF.tx;
    out.tz = endF.tz;
    out.nx = endF.nx;
    out.nz = endF.nz;
    out.R = Math.hypot(out.x - cx, out.z - cz);
    out.th = endF.th;
    return out;
  };

  let lastSeg = segs[0];
  const segAt = (ss) => {
    if (ss >= lastSeg.s0 && ss < lastSeg.s1) return lastSeg;
    // binary search
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].s0 <= ss) lo = mid;
      else hi = mid - 1;
    }
    lastSeg = segs[lo];
    return lastSeg;
  };

  /** Pitch-line height at s. */
  const yLine = (ss) => {
    const g = segAt(ss);
    if (g.kind === 'landing') return g.y0;
    return g.y0 + ((clamp(ss, g.s0, g.s1) - g.s0) / (g.s1 - g.s0)) * (g.y1 - g.y0);
  };
  /** Slope dy/ds on the pitch line. */
  const slopeAt = (ss) => {
    const g = segAt(ss);
    return g.kind === 'landing' ? 0 : (g.y1 - g.y0) / (g.s1 - g.s0);
  };
  /** Height fraction 0 (podium) .. 1 (door). */
  const hfrac = (yy) => clamp((yy - yBase) / (yTop - yBase), 0, 1);
  /** Full width (m): broad and heavy at the islet, narrowing toward the sky. */
  const width = (ss) => 11.6 - 3.0 * smoothstep(0.02, 0.85, hfrac(yLine(ss)));
  /** Soffit depth below the pitch line (m): thinning with height. */
  const depth = (ss) => 2.4 - 1.15 * smoothstep(0.05, 0.9, hfrac(yLine(ss)));

  const _f = {};
  /** World point at (s, u across [outward +], v up from the pitch line). */
  const point = (ss, u, v, out = [0, 0, 0]) => {
    plan(ss, _f);
    out[0] = _f.x + _f.nx * u;
    out[1] = yLine(ss) + v;
    out[2] = _f.z + _f.nz * u;
    return out;
  };

  /**
   * Frames for sweeps over [s0, s1]: every `step` metres plus every segment boundary inside
   * (kinks between flights and landings stay sharp). Each: { s, o, n, hw, d }.
   */
  const frames = (s0, s1, step = 2, extra = null) => {
    const ss = [s0];
    for (const g of segs) {
      if (g.s0 > s0 + 1e-3 && g.s0 < s1 - 1e-3) ss.push(g.s0);
    }
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let k = 1; k < n; k++) ss.push(s0 + ((s1 - s0) * k) / n);
    ss.push(s1);
    ss.sort((a, b) => a - b);
    const out = [];
    let last = -1e9;
    for (const v of ss) {
      if (v - last < 0.05) continue;
      last = v;
      const f = plan(v, {});
      const fr = { s: v, o: [f.x, yLine(v), f.z], n: [f.nx, f.nz], hw: width(v) / 2, d: depth(v) };
      if (extra) extra(fr);
      out.push(fr);
    }
    return out;
  };

  return {
    cx, cz, yBase, yTop, sTotal, sSpiral, sTop0, segs, dir,
    plan, segAt, yLine, slopeAt, width, depth, point, frames, hfrac,
    landings: segs.filter((g) => g.kind === 'landing'),
    flights: segs.filter((g) => g.kind === 'flight'),
  };
}
