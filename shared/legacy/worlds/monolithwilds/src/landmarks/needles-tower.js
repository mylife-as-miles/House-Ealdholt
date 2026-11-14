// Needle City — one needle.
//
// Construction logic (tower-local space, y up from the top of the plinth, frame = position + lean):
//   shaft     telescoping n-gon drums between collars; each drum tapers to half-way toward the next
//             one, so the shaft steps inward at every collar (reads as segmented even far away)
//   collars   bronze / stone / iron rings at every drum joint; bridges spring from them
//   galleries every 3rd-5th collar: a corbelled ring deck with a railing and doors
//   loggias   an open floor of posts with lanterns replacing the top of a drum (inhabited needles)
//   pods      cantilevered dwellings on iron struts, sometimes stacked or ringed around the shaft
//   crown     spike / lantern chamber / fork / broken stump / blunt cap; hung needles end below in
//             an inverted spike with a glowing drop
// Lit windows are sparse (inhabited needles only); unlit ones are dark iron slits.

import { BOX, QUAD, prismTpl, SPIKE6, SPIKE4, ROD } from './needles-geo.js';
import { rAt } from './needles-plan.js';

const TAU = Math.PI * 2;
const qk = (k) => Math.round(Math.min(4, Math.max(0.02, k)) * 50) / 50;
const mul = (t, f) => [t[0] * f, t[1] * f, t[2] * f];
const DARKWIN = 0.2;

export function emitTower(t, A, rng, out, o = {}) {
  const frame = o.frame ?? t.frame;
  const y0 = o.y0 ?? 0;
  const y1 = o.y1 ?? (t.kind === 'snapped' ? t.snapY : t.H);
  const pods = o.pods ?? true;
  for (const k in A) A[k].setFrame(frame);
  const shaft = t.dark ? A.dark : A.pale;
  const n = t.n;
  const cosN = Math.cos(Math.PI / n);
  const sinN = Math.sin(Math.PI / n);
  const segs = t.segs;
  const litP = t.inhabited ? 0.2 : 0.02;
  const collarAcc = t.collar === 'bronze' ? A.bronze : t.collar === 'iron' ? A.iron : A.pale;
  const collarTint = t.collar === 'stone' ? mul(t.tint, 0.8) : t.collar === 'pale' ? [0.95, 0.93, 0.88] : t.collar === 'iron' ? 0.9 : 1;
  const win = (phi, y, dist, w, h, lit) => {
    const acc = lit ? A.glowF : A.iron;
    acc.put(QUAD, Math.sin(phi) * dist, y, Math.cos(phi) * dist, w, h, 1, phi, lit ? 1 : DARKWIN);
  };
  let cutTop = null;

  for (let i = 0; i < segs.length - 1; i++) {
    const sa = segs[i], sb = segs[i + 1];
    if (sb <= y0 || sa >= y1) continue;
    const ya = Math.max(sa, y0);
    const yb = Math.min(sb, y1);
    const cut = sb > y1 + 0.01;
    const rot = t.rot + i * t.twist;
    const rb = rAt(t, sa);
    const rtop = rb - (rb - rAt(t, sb)) * 0.5;
    const rOf = (y) => rb + (rtop - rb) * ((y - sa) / (sb - sa));
    const rA = rOf(ya), rB = rOf(yb);
    const grime = 0.86 + 0.14 * Math.min(1, sa / 70);
    const tint = mul(t.tint, grime * rng.range(0.93, 1.05));

    // loggia: an open floor at the top of the drum
    let solidTop = yb;
    if (!cut && i >= 2 && i < segs.length - 2 && t.inhabited && t.r0 > 2.3 && rng() < 0.12 && o.loggia !== false) {
      const lh = Math.min(0.45 * (yb - ya), 5 + rA * 0.8);
      solidTop = yb - lh;
      const rl = rOf(solidTop);
      shaft.put(prismTpl(n, 1, true), 0, solidTop - 0.25, 0, rl * 1.04, 0.5, rl * 1.04, rot, tint);
      for (let k = 0; k < n; k += n === 4 ? 1 : 2) {
        const a = rot + ((k + 0.5) / n) * TAU;
        shaft.put(BOX, Math.sin(a) * rl * 0.86, solidTop + lh / 2, Math.cos(a) * rl * 0.86, rl * 0.24, lh, rl * 0.24, a, tint);
      }
      shaft.put(prismTpl(n, 1, false), 0, solidTop, 0, rl * 0.38, lh, rl * 0.38, rot, mul(tint, 0.6));
      for (let k = 0; k < 2; k++) {
        const a = rot + rng() * TAU;
        A.glowF.box(Math.sin(a) * rl * 0.6, solidTop + lh * 0.55, Math.cos(a) * rl * 0.6, 1.0, 1.5, 1.0, a, 1);
      }
    }
    shaft.put(prismTpl(n, qk(rB / rA)), 0, ya, 0, rA, solidTop - ya, rA, rot, tint);

    // windows (rows of slits on random faces)
    const len = solidTop - ya;
    const rows = Math.max(1, Math.floor(len / 11));
    for (let r = 0; r < rows; r++) {
      if (rng() < 0.3) continue;
      const c = rng.int(1, Math.min(3, n));
      const y = ya + ((r + 0.5) / rows) * len + rng.range(-1.5, 1.5);
      const rr = rOf(y);
      const fw = 2 * rr * sinN;
      for (let k = 0; k < c; k++) {
        const phi = rot + (rng.int(0, n - 1) / n) * TAU;
        win(phi, y, rr * cosN + 0.06, Math.min(0.9, fw * 0.32), rng.range(1.6, 2.8), rng() < litP);
      }
    }
    // balconies
    if (len > 8 && rng() < 0.16) {
      const y = ya + len * rng.range(0.3, 0.7);
      const rr = rOf(y);
      const ap = rr * cosN;
      const phi = rot + (rng.int(0, n - 1) / n) * TAU;
      const bw = Math.min(3.2, 2 * rr * sinN * 1.1 + 0.5);
      const sx = Math.sin(phi), sz = Math.cos(phi);
      shaft.put(BOX, sx * (ap + 0.7), y, sz * (ap + 0.7), bw, 0.35, 1.5, phi, mul(tint, 0.9));
      A.iron.put(BOX, sx * (ap + 1.4), y + 0.55, sz * (ap + 1.4), bw, 0.9, 0.1, phi, 0.8);
      win(phi, y + 1.25, ap + 0.06, 0.9, 2.1, rng() < (t.inhabited ? 0.45 : 0.05));
    }

    if (cut) {
      cutTop = { y: yb, r: rB, rot, tint };
      break;
    }
    // collar at the joint
    if (i + 1 < segs.length - 1) {
      const rc = rAt(t, sb);
      const hc = 0.8 + rc * 0.3;
      const rotN = t.rot + (i + 1) * t.twist;
      collarAcc.put(prismTpl(n, 1, true), 0, sb - hc * 0.45, 0, rtop * 1.2 + 0.35, hc, rtop * 1.2 + 0.35, rotN, collarTint);
      // amber glass inlaid in a few collars: thin rings of light that wake up at night
      if (t.inhabited && rng() < 0.15) {
        const rr = (rtop * 1.2 + 0.35) * 1.02;
        A.glowS.put(prismTpl(n, 1, false), 0, sb - hc * 0.3, 0, rr, hc * 0.6, rr, rotN, '#ffb35c');
      }
      if (t.gal[i + 1]) {
        const rg = rc * 1.75 + 1.3;
        shaft.put(prismTpl(n, qk(rg / (rtop * 1.02))), 0, sb - 2.6, 0, rtop * 1.02, 2.6, rtop * 1.02, rotN, mul(tint, 0.95));
        shaft.put(prismTpl(n, 1, true), 0, sb, 0, rg, 0.55, rg, rotN, mul(tint, 0.9));
        A.iron.put(prismTpl(n, 1, false), 0, sb + 0.55, 0, rg * 0.97, 1.0, rg * 0.97, rotN, 0.7);
        const doors = rng.int(1, 3);
        for (let k = 0; k < doors; k++) {
          const phi = rotN + (rng.int(0, n - 1) / n) * TAU;
          win(phi, sb + 1.8, rc * cosN + 0.08, Math.min(1.2, 2 * rc * sinN * 0.4), 2.4, rng() < (t.inhabited ? 0.5 : 0.04));
        }
        if (t.inhabited && rng() < 0.35) {
          // a lantern hanging from the gallery rim
          const a = rotN + rng() * TAU;
          const lx = Math.sin(a) * (rg - 0.6), lz = Math.cos(a) * (rg - 0.6);
          A.iron.beamUp(ROD, lx, sb - 0.1, lz, lx, sb - 2.6, lz, 0.1, 0.1, 0.7);
          A.glowF.box(lx, sb - 3.1, lz, 0.6, 0.9, 0.6, a, 1);
        }
      }
    }
  }

  if (cutTop) brokenTop(t, A, rng, cutTop, shaft);

  // --- pods ---------------------------------------------------------------------------------
  if (pods) {
    const nPods = t.great ? rng.int(5, 9) : t.r0 < 1.8 ? rng.int(0, 1) : t.inhabited ? rng.int(1, 4) : rng.int(0, 2);
    for (let p = 0; p < nPods; p++) {
      const lo = Math.max(y0 + 8, t.Hs * 0.18), hi = Math.min(y1 - 10, t.Hs * 0.9);
      if (hi <= lo) break;
      const y = rng.range(lo, hi);
      const ring = rng() < 0.15 && t.r0 > 2.2;
      const k0 = rng.int(0, n - 1);
      const count = ring ? Math.min(n, rng.int(3, 4)) : 1;
      // a stack: dwellings piled up one face of the shaft, reads as a bulge from far away
      const stack = !ring && rng() < 0.25 ? rng.int(3, 6) : 1;
      const w = rng.range(3.8, 5.5 + t.r0 * 0.9), h = rng.range(3.2, 5.8), d = rng.range(4.5, 6.5 + t.r0 * 0.7);
      for (let st = 0; st < stack; st++) {
        const ys = y + st * (h + rng.range(0.4, 2.5));
        if (ys > hi + 10) break;
        for (let c = 0; c < count; c++) {
          const iseg = segIndex(segs, ys);
          const phi = t.rot + iseg * t.twist + (((k0 + Math.round((c * n) / count)) % n) / n) * TAU + (stack > 1 ? rng.range(-0.12, 0.12) : 0);
          pod(t, A, rng, phi, ys, w * rng.range(0.85, 1.1), h, d * rng.range(0.8, 1.15), win);
        }
      }
    }
  }

  // --- crown / hung tip -----------------------------------------------------------------------
  if (t.kind === 'hung' && y0 <= 0) {
    const r = t.r0;
    collarAcc.put(prismTpl(n, 1, true), 0, -0.8, 0, r * 1.3 + 0.3, 1.8, r * 1.3 + 0.3, t.rot, collarTint);
    const Ls = 16 + r * 5;
    (t.collar === 'iron' ? A.iron : A.bronze).standAlong(SPIKE6, 0, -0.8, 0, 0, -0.8 - Ls, 0, r * 1.05, 1, t.rot);
    A.glowS.box(0, -0.8 - Ls * 0.93, 0, 0.9, 1.4, 0.9, t.rot, 1);
  }
  if (!cutTop && y1 >= t.H - 0.01 && o.crown !== false) crown(t, A, rng, out, collarAcc, collarTint, shaft);
  if (!cutTop && o.rings !== false && t.H > 380 && t.kind !== 'snapped' && rng() < 0.3) {
    const iy = Math.max(1, Math.min(segs.length - 2, Math.round((segs.length - 1) * 0.8)));
    const y = segs[iy];
    const R = rAt(t, y) * 2.2 + rng.range(2.5, 5);
    const base = rng() * TAU;
    for (let k = 0; k < 2; k++) {
      out.rings.push({ frame, y, R: R * (k ? 0.86 : 1), tilt: rng.range(0.35, 0.95) * (k ? -1 : 1), speed: rng.range(0.018, 0.05) * (k ? -1 : 1), phase: base + k * 1.3 });
    }
  }
}

function segIndex(segs, y) {
  for (let i = 0; i < segs.length - 1; i++) if (y < segs[i + 1]) return i;
  return segs.length - 2;
}

function pod(t, A, rng, phi, y, w, h, d, win) {
  const r = rAt(t, y);
  const ap = r * Math.cos(Math.PI / t.n);
  const sx = Math.sin(phi), sz = Math.cos(phi);
  const dc = ap + d / 2 - 0.4;
  const cx = sx * dc, cz = sz * dc;
  const tint = [rng.range(0.85, 1.02), rng.range(0.8, 0.95), rng.range(0.72, 0.88)];
  A.plaster.put(BOX, cx, y, cz, w, h, d, phi, tint);
  // cantilever struts from the shaft below
  const yb = y - h / 2;
  const ys = yb - rng.range(4, 7);
  for (const s of [-1, 1]) {
    const ox = Math.cos(phi) * s * w * 0.38, oz = -Math.sin(phi) * s * w * 0.38;
    A.iron.beamUp(ROD, sx * (ap - 0.2) + ox * 0.5, ys, sz * (ap - 0.2) + oz * 0.5, cx + sx * d * 0.42 + ox, yb + 0.1, cz + sz * d * 0.42 + oz, 0.32, 0.32, 0.75);
  }
  // roof
  const roof = rng();
  let top = y + h / 2;
  if (rng() < 0.25) {
    const w2 = w * rng.range(0.55, 0.8), h2 = h * rng.range(0.6, 0.85), d2 = d * rng.range(0.55, 0.8);
    const off = rng.range(-0.25, 0.2) * d;
    A.plaster.put(BOX, cx + sx * off, top + h2 / 2, cz + sz * off, w2, h2, d2, phi, mul(tint, 0.95));
    win(phi, top + h2 * 0.5, dc + off + d2 / 2 + 0.04, 0.8, 1.4, rng() < (t.inhabited ? 0.45 : 0.05));
    top += h2;
    w = w2; d = d2;
  }
  if (roof < 0.6) A.terra.put(BOX, cx, top + 0.22, cz, w + 0.7, 0.45, d + 0.7, phi, [rng.range(0.85, 1.05), rng.range(0.8, 1), 0.85]);
  else if (roof < 0.82) A.bronze.put(SPIKE4, cx, top, cz, Math.max(w, d) * 0.74, rng.range(1.8, 3.2), Math.max(w, d) * 0.74, phi + Math.PI / 4, 1);
  // windows on the outer face (+ maybe a side)
  const nw = rng.int(1, 3);
  for (let k = 0; k < nw; k++) {
    const off = ((k + 0.5) / nw - 0.5) * w * 0.7;
    const px = cx + sx * (d / 2 + 0.04) + Math.cos(phi) * off;
    const pz = cz + sz * (d / 2 + 0.04) - Math.sin(phi) * off;
    const lit = rng() < (t.inhabited ? 0.5 : 0.05);
    (lit ? A.glowF : A.iron).put(QUAD, px, y + rng.range(-0.3, 0.4), pz, 0.9, 1.5, 1, phi, lit ? 1 : DARKWIN);
  }
  if (t.inhabited && rng() < 0.15) {
    const lx = cx + sx * d * 0.45, lz = cz + sz * d * 0.45;
    A.iron.beamUp(ROD, lx, yb, lz, lx, yb - 2.2, lz, 0.1, 0.1, 0.7);
    A.glowF.box(lx, yb - 2.7, lz, 0.6, 0.9, 0.6, phi, 1);
  }
}

function brokenTop(t, A, rng, c, shaft) {
  const { y, r, rot, tint } = c;
  A.iron.put(prismTpl(t.n, 1, true), 0, y - 0.6, 0, r * 0.88, 0.4, r * 0.88, rot, 0.25);
  const k = rng.int(4, 7);
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * TAU + rng.range(-0.3, 0.3);
    const hh = rng.range(0.8, 5.5);
    shaft.put(BOX, Math.sin(a) * r * 0.72, y + hh / 2 - 0.4, Math.cos(a) * r * 0.72, r * rng.range(0.45, 0.7), hh, r * 0.42, a, mul(tint, rng.range(0.85, 1)), rng.range(-0.1, 0.1), rng.range(-0.1, 0.1));
  }
}

function crown(t, A, rng, out, collarAcc, collarTint, shaft) {
  const Hs = t.Hs, H = t.H, Hc = H - Hs;
  const r = rAt(t, Hs);
  const n = t.n;
  const rot = t.rot + (t.segs.length - 2) * t.twist;
  const metal = t.collar === 'iron' ? A.iron : A.bronze;
  const tint = t.tint;
  switch (t.crown) {
    case 'spike': {
      collarAcc.put(prismTpl(n, 1, true), 0, Hs - 0.8, 0, r * 1.35 + 0.4, 1.6, r * 1.35 + 0.4, rot, collarTint);
      metal.put(SPIKE6, 0, Hs + 0.8, 0, r * 0.8, Hc, r * 0.8, rot, 1);
      for (const f of [0.22, 0.48]) {
        const rr = r * 0.8 * (1 - f) * 1.7 + 0.25;
        metal.put(prismTpl(6, 1, true), 0, Hs + 0.8 + Hc * f, 0, rr, 0.7, rr, rot, 1);
      }
      // a beacon threaded on the spike (the great needles all carry one)
      if (t.great || rng() < 0.2) {
        const f = t.great ? 0.8 : 0.62;
        const rb = Math.max(0.8, r * 0.8 * (1 - f) * 1.4);
        A.glowS.put(prismTpl(6, 1, true), 0, Hs + 0.8 + Hc * f, 0, rb, 2.8, rb, rot, [1, 0.62, 0.3]);
      }
      break;
    }
    case 'lantern': {
      const ch = Math.max(5, Hc * 0.42);
      const rl = r * 1.22 + 0.3;
      collarAcc.put(prismTpl(n, 1, true), 0, Hs - 0.6, 0, rl * 1.12 + 0.2, 1.2, rl * 1.12 + 0.2, rot, collarTint);
      shaft.put(prismTpl(n, 1, true), 0, Hs + 0.6, 0, rl, ch, rl, rot, tint);
      const lit = t.great || rng() < 0.35;
      const ap = rl * Math.cos(Math.PI / n);
      const fw = 2 * rl * Math.sin(Math.PI / n);
      for (let k = 0; k < n; k++) {
        const phi = rot + (k / n) * TAU;
        (lit ? A.glowS : A.iron).put(QUAD, Math.sin(phi) * (ap + 0.05), Hs + 0.6 + ch * 0.5, Math.cos(phi) * (ap + 0.05), fw * 0.42, ch * 0.62, 1, phi, lit ? [1, 0.82, 0.55] : DARKWIN);
      }
      const capH = Hc - ch - 0.6;
      metal.put(prismTpl(n, 0.02, false), 0, Hs + 0.6 + ch, 0, rl * 1.2, capH * 0.6, rl * 1.2, rot, 1);
      A.iron.beamUp(ROD, 0, Hs + 0.6 + ch + capH * 0.5, 0, 0, H, 0, 0.25, 0.25, 0.8);
      break;
    }
    case 'fork': {
      collarAcc.put(prismTpl(n, 1, true), 0, Hs - 0.8, 0, r * 1.3 + 0.4, 1.6, r * 1.3 + 0.4, rot, collarTint);
      const k = rng() < 0.5 ? 2 : 3;
      const s = Hc * 0.13;
      for (let i = 0; i < k; i++) {
        const a = rot + (i / k) * TAU;
        const hh = Hc * (i === 0 ? 1 : rng.range(0.6, 0.9));
        (rng() < 0.5 ? metal : shaft).standAlong(SPIKE4, Math.sin(a) * r * 0.4, Hs + 0.8, Math.cos(a) * r * 0.4, Math.sin(a) * s, Hs + hh, Math.cos(a) * s, r * 0.45, t.tint, a);
      }
      break;
    }
    case 'broken':
      brokenTop(t, A, rng, { y: Hs, r, rot, tint }, shaft);
      break;
    default:
      shaft.put(prismTpl(n, 0.8, true), 0, Hs, 0, r * 1.1, 1.4, r * 1.1, rot, mul(tint, 0.85));
  }
  // cyan glyph seams on a few collars of the great needles
  if (t.great) {
    for (let k = 0; k < 3; k++) {
      const i = t.segs.length - 3 - k * 2;
      if (i < 1) break;
      const y = t.segs[i];
      const rc = rAt(t, y) * 1.2 + 0.4;
      A.glowS.put(prismTpl(n, 1, false), 0, y - 0.6, 0, rc * 1.03, 1.2, rc * 1.03, t.rot + i * t.twist, '#5fe6ff');
    }
  }
}

/** Stepped plinth (world space, no lean) for a needle or a bundle. */
export function emitPlinth(A, rng, p) {
  const { x, z, pr, g0, g1, baseY, n, rot, tint } = p;
  for (const k in A) A[k].setFrame(null);
  const tiers = pr > 7 ? 3 : 2;
  const tplOf = (k) => (n === 4 ? prismTpl(4, k, true) : prismTpl(8, k, true));
  const top0 = g1 + 0.9;
  A.stone.put(tplOf(1), x, g0 - 2.5, z, pr, top0 - g0 + 2.5, pr, rot, tint);
  let yb = top0;
  let rr = pr;
  for (let i = 1; i < tiers; i++) {
    const h = (baseY - yb) * (i === tiers - 1 ? 1 : 0.55);
    rr *= rng.range(0.7, 0.8);
    A.stone.put(tplOf(0.96), x, yb, z, rr, h, rr, rot, tint);
    yb += h;
  }
  if (tiers === 1 || yb < baseY - 0.01) A.stone.put(tplOf(1), x, yb, z, rr * 0.8, baseY - yb, rr * 0.8, rot, tint);
  // steps up the plinth on one side
  const a = rot + (rng.int(0, 3) / 4) * TAU;
  const sx = Math.sin(a), sz = Math.cos(a);
  const steps = Math.max(2, Math.round((baseY - top0) / 0.6));
  const run = Math.min(0.9, (pr * 0.5) / steps + 0.3);
  for (let s = 0; s < steps; s++) {
    const d = pr * 0.62 + (steps - s) * run * 0.6;
    const y = top0 + (s + 1) * ((baseY - top0) / steps);
    A.stone.put(BOX, x + sx * d, (top0 + y) / 2, z + sz * d, 2.2, y - top0, run, a, mul(tint, 0.92));
  }
}
