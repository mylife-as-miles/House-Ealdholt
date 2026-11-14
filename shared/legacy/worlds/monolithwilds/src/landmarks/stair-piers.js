// The stilts. Each pier is a single impossibly thin octagonal shaft (2–3 m across, up to ~550 m
// tall) standing on a footing drum in the lake or a plinth on the islet/shore, capped by a
// flared capital, a saddle beam under the stringers and two knee braces (a tuning-fork head).
// Bronze collars every ~30 m mark the scale. Spacing grows with height; the last
// STAIR.unsupported metres of the climb have none at all. Where the stair runs low over the
// podium the piers become solid cross-walls instead.

import { STAIR } from './stair-path.js';

const ZONE_CUTS = [190, 440];

export function planPiers(P, breaches) {
  const yCut = P.yTop - STAIR.unsupported;
  // spacing opens up with height: ~40 m low down, ~150 m under the last supported turn
  const maxGap = (y) => 34 + 0.3 * (y - P.yBase);
  const anchors = [];
  for (const g of P.landings) {
    if (g.feature === 'gate' || g.feature === 'door') continue;
    if (g.y0 > yCut) continue;
    anchors.push((g.s0 + g.s1) / 2);
  }
  const avoid = (s) => {
    for (const b of breaches) {
      if (s > b.s0 - 4 && s < b.s1 + 4) return s < (b.s0 + b.s1) / 2 ? b.s0 - 4 : b.s1 + 4;
    }
    return s;
  };
  // walk the path: over the podium a cross-wall every ~13 m; above, piers at landings where
  // possible, dropping landings while the gap they leave stays within maxGap
  const out = [];
  let prev = 8;
  while (P.yLine(prev) - P.yBase < 12 && prev < 200) {
    prev += 13;
    out.push(prev);
  }
  let k = 0;
  while (k < anchors.length && anchors[k] <= prev + 5) k++;
  while (k < anchors.length) {
    const lim = maxGap(P.yLine(prev));
    // furthest landing within reach
    let j = k - 1;
    while (j + 1 < anchors.length && anchors[j + 1] - prev <= lim) j++;
    if (j >= k) {
      out.push(avoid(anchors[j]));
      prev = anchors[j];
      k = j + 1;
    } else {
      // no landing in reach: split the way to the next one evenly
      const n = Math.ceil((anchors[k] - prev) / lim);
      const a = prev + (anchors[k] - prev) / n;
      out.push(avoid(a));
      prev = a;
    }
  }
  return out;
}

export function buildPiers(ctx, P, W, zoneOf, weather, breaches) {
  const list = planPiers(P, breaches);
  const piers = [];
  const f = {};
  for (const s of list) {
    P.plan(s, f);
    const y = P.yLine(s);
    const d = P.depth(s);
    const hw = P.width(s) / 2;
    const top = y - d; // underside of the stringers
    const g = ctx.heightAt(f.x, f.z);
    const yaw = Math.atan2(f.tx, f.tz);
    const H = top - 1.2 - g;
    if (H < 0.6) continue;
    const zoneW = (yy) => W[zoneOf(yy)];
    if (H < 15) {
      // low over the podium: a solid cross-wall with a stepped foot
      const w = zoneW(y);
      const t0 = w.tint;
      const k = weather(y) * 0.95;
      w.tint = [t0[0] * k, t0[1] * k, t0[2] * k];
      w.block(f.x, (top + g - 1) / 2, f.z, 2 * hw - 0.2, top - g + 1, 1.5, yaw);
      w.block(f.x, g + 0.4, f.z, 2 * hw + 0.6, 1.8, 2.4, yaw);
      w.tint = t0;
      piers.push({ s, x: f.x, z: f.z, g, top, wall: true });
      continue;
    }
    const inWater = g < 1.0;
    const baseTop = inWater ? 1.4 : g + 1.6;
    // footing
    {
      const w = W.low;
      const t0 = w.tint;
      w.tint = [t0[0] * 0.72, t0[1] * 0.74, t0[2] * 0.72];
      if (inWater) {
        const hT = baseTop - (g - 0.5);
        w.lathe(f.x, g - 0.5, f.z, [[3.4, 0], [3.0, hT - 1.0], [2.75, hT - 0.7], [2.75, hT - 0.25], [2.3, hT]], 10, yaw);
      } else {
        w.block(f.x, g + 0.3, f.z, 5.2, 2.4, 5.2, yaw);
        w.block(f.x, baseTop - 0.3, f.z, 4.2, 0.9, 4.2, yaw);
      }
      w.tint = t0;
    }
    // shaft, split where the material zone changes (a collar hides each seam)
    const capH = 3.2;
    const shaftTop = top - 1.2 - capH;
    const rb = 0.98 + Math.min(0.4, H * 0.0007);
    const rt = 0.8;
    const rAt = (yy) => rb + (rt - rb) * ((yy - baseTop) / (shaftTop - baseTop));
    const cuts = [baseTop];
    for (const c of ZONE_CUTS) if (c > baseTop + 2 && c < shaftTop - 2) cuts.push(c);
    cuts.push(shaftTop);
    const ph = yaw + Math.PI / 8;
    for (let k = 0; k < cuts.length - 1; k++) {
      const y0 = cuts[k], y1 = cuts[k + 1];
      const w = zoneW((y0 + y1) / 2 - 1);
      const t0 = w.tint;
      const kk = weather((y0 + y1) / 2);
      w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
      // water-stained lower courses
      if (y0 < 12) {
        w.tint = [t0[0] * kk * 0.8, t0[1] * kk * 0.82, t0[2] * kk * 0.8];
        const ym = Math.min(y1, 14);
        w.lathe(f.x, y0, f.z, [[rAt(y0), 0], [rAt(ym), ym - y0]], 8, ph, { capTop: false });
        w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
        if (y1 > ym + 0.1) w.lathe(f.x, ym, f.z, [[rAt(ym), 0], [rAt(y1), y1 - ym]], 8, ph, { capTop: false });
      } else {
        w.lathe(f.x, y0, f.z, [[rAt(y0), 0], [rAt(y1), y1 - y0]], 8, ph, { capTop: false });
      }
      w.tint = t0;
    }
    // capital: flares from the shaft into a cushion under the saddle
    {
      const w = zoneW(top);
      const t0 = w.tint;
      const kk = weather(top);
      w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
      w.lathe(f.x, shaftTop, f.z, [[rt, 0], [rt + 0.15, capH * 0.45], [rt + 0.55, capH * 0.8], [1.9, capH]], 8, ph, { capTop: true });
      // saddle beam under both stringers
      w.block(f.x, top - 0.6, f.z, 2 * hw + 0.5, 1.2, 1.9, yaw);
      // knee braces from the shaft to the saddle ends
      const kH = Math.min(11, H * 0.3);
      const yk = shaftTop - kH * 0.55;
      for (const sd of [-1, 1]) {
        const u = sd * (hw - 0.55);
        w.strut([f.x + f.nx * sd * rt * 0.6, yk, f.z + f.nz * sd * rt * 0.6], [f.x + f.nx * u, top - 1.15, f.z + f.nz * u], 0.34, 0.28, 4, yaw);
      }
      w.tint = t0;
    }
    // bronze collars: at each zone seam, under the capital and every ~30 m
    const collars = new Set(cuts.slice(1, -1).map((c) => Math.round(c * 10) / 10));
    collars.add(Math.round((shaftTop - 0.9) * 10) / 10);
    for (let yy = baseTop + 26; yy < shaftTop - 12; yy += 30) collars.add(Math.round(yy * 10) / 10);
    for (const yc of collars) {
      const r = rAt(yc);
      W.bronze.lathe(f.x, yc - 0.4, f.z, [[r + 0.02, 0], [r + 0.16, 0.12], [r + 0.16, 0.72], [r + 0.02, 0.84]], 8, ph, { capTop: false });
    }
    piers.push({ s, x: f.x, z: f.z, g, top, base: baseTop, r: rb, inWater });
  }
  return piers;
}
