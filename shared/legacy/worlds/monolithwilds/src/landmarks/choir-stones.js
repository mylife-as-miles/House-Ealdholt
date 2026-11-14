// Choir stones: every monolith with its plinth, in all its fates (standing, floating, leaning in
// pairs, split, sunk, fallen, crushed, gone), plus the hovering giant and its orbiting shards.
// Writes into the meshers K = { stones, float, dead, stone, glow }.

import * as THREE from 'crownfall-world-three';
import { slab, plinth, oct } from './choir-mesh.js';

const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function place(x, y, z, yaw, rx = 0, rz = 0) {
  _e.set(rx, yaw, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s);
}
const up = (m, dy, rx = 0, rz = 0) => {
  _e.set(rx, 0, rz, 'YXZ');
  _q.setFromEuler(_e);
  _t.compose(_v.set(0, dy, 0), _q, _s);
  return m.clone().multiply(_t);
};

/**
 * Glyph scale and the inscription layout for a stone of height h: recessed channels under the
 * crown (most stones carry one or two, a few are inscribed far down), then the mouths — a tall
 * slit below the inscription or a long thin horizontal cut through the stone.
 */
export function inscription(S, rng, { extent = null, slotChance = 0.38, slit = null } = {}) {
  const { h, w } = S;
  const gs = S.gs ?? Math.min(1.35, Math.max(0.42, 0.35 + h / 110));
  S.gs = gs;
  const bodyTop = h - Math.min(S.topH ?? Math.min(0.2 * S.d, 0.8), h * 0.6);
  let ext = extent;
  if (ext === null) {
    const k = rng();
    ext = k < 0.55 ? 0 : k < 0.85 ? rng.range(0.25, 0.5) : rng.range(0.6, 0.9);
  }
  const e = ext * h;
  const channels = [];
  let kmax = -1;
  let low = bodyTop;
  for (let k = 0; k < 20; k++) {
    const y0 = h - (5.45 + 14 * k) * gs;
    const y1 = h - (1.55 + 14 * k) * gs;
    if (h - y0 > e && k > 0) break;
    if (y0 < 0.8) break;
    kmax = k;
    low = y0;
    if (y1 < bodyTop - 0.15) channels.push([y0, y1]);
  }
  if (kmax < 0) kmax = 0;
  S.channels = channels;
  S.vCap = 14 * (kmax + 1);
  S.yBreak = h - (S.vCap - 3.5) * gs;
  S.inset = 0.08 + 0.13 * gs;
  S.slots = [];
  if (slit) {
    S.slots.push(slit);
  } else if (h > 16 && rng.chance(slotChance)) {
    const topY = Math.min(low, S.yBreak) - 1.5 * gs;
    if (rng.chance(0.6)) {
      const sh = h * rng.range(0.12, 0.3);
      const y1 = topY - rng.range(0, 0.15) * h;
      if (y1 - sh > 1.5) S.slots.push([y1 - sh, y1, Math.max(0.45, w * rng.range(0.07, 0.13))]);
    } else {
      const sh = rng.range(0.7, 1.8) * gs;
      const yc = rng.range(0.25, 0.8) * topY;
      if (yc - sh / 2 > 1.5) S.slots.push([yc - sh / 2, yc + sh / 2, w * rng.range(0.55, 0.75)]);
    }
  }
  return S;
}

function crownStyle(S, rng) {
  const k = rng();
  if (S.taper > 0.12) S.top = k < 0.35 ? 'point' : k < 0.8 ? 'slant' : 'flat';
  else if (S.h > 40) S.top = k < 0.22 ? 'flat' : k < 0.72 ? 'slant' : k < 0.86 ? 'ridge' : 'point';
  else S.top = k < 0.45 ? 'flat' : k < 0.82 ? 'slant' : k < 0.93 ? 'ridge' : 'point';
  S.slantDir = rng.sign();
  if (S.top === 'flat') S.topH = Math.min(0.2 * S.d, 0.8);
  else if (S.top === 'slant') S.topH = S.w * rng.range(0.15, 0.5);
  else if (S.top === 'ridge') S.topH = S.d * rng.range(0.5, 1.2);
  else S.topH = S.h * rng.range(0.06, 0.12);
}

function specFor(st, rng) {
  const tapered = rng.chance(0.26);
  const S = {
    w: st.w, d: st.d, h: st.h, rng,
    taper: tapered ? rng.range(0.15, 0.4) : rng.range(0, st.h > 40 ? 0.12 : 0.05),
    taperD: tapered ? rng.range(0, 0.25) : 0,
    ridge: rng.chance(0.7) ? st.w * rng.range(0.03, 0.075) : 0,
  };
  crownStyle(S, rng);
  return S;
}

export function buildStones(ctx, K, plan, rng) {
  const { gh, stones, amph } = plan;
  const stats = { standing: 0, floating: 0, fallen: 0 };
  const floaters = [];

  for (const st of stones) {
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    // ground under the plinth corners (plinth local x along width, z along thickness)
    let gMin = Infinity;
    let gMax = -Infinity;
    const pa = st.role === 'pair' ? 0.56 * st.w + 0.15 * st.h + 1.0 : st.pa;
    for (const [lx, lz] of [[0, 0], [pa + 1, st.pb + 1], [-pa - 1, st.pb + 1], [pa + 1, -st.pb - 1], [-pa - 1, -st.pb - 1]]) {
      const g = gh(st.x + lx * cy + lz * sy, st.z - lx * sy + lz * cy);
      gMin = Math.min(gMin, g);
      gMax = Math.max(gMax, g);
    }
    const tint = 0.84 + 0.22 * st.salt;
    const h1 = 0.45 + 0.018 * st.h;
    const h2 = 0.45 + 0.032 * st.h;
    const sink = gMax - gMin + 0.7;

    if (st.role === 'sunk') {
      const tilt = rng.range(0.09, 0.26);
      const ax = rng() * Math.PI * 2;
      const depth = Math.max(1.5, st.h * rng.range(0.1, 0.28));
      const F = place(st.x, gMin - depth, st.z, st.yaw, Math.cos(ax) * tilt, Math.sin(ax) * tilt);
      const S = specFor(st, rng);
      inscription(S, rng, { slotChance: 0.25 });
      K.stones.frame(F).setTint(0.92 + 0.1 * st.salt);
      slab(K.stones, S);
      // the buried plinth shows as a few heaved blocks
      K.stone.setTint(tint * 0.9);
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const rr = st.pa * rng.range(0.9, 1.4);
        const bx = st.x + Math.cos(a) * rr;
        const bz = st.z + Math.sin(a) * rr;
        const bs = Math.max(0.8, st.w * rng.range(0.15, 0.3));
        K.stone.frame(place(bx, gh(bx, bz) - bs * 0.35, bz, rng() * 6, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)));
        K.stone.prism(oct(bs, bs * 0.6, 0.15), -bs * 0.4, oct(bs, bs * 0.6, 0.15), bs * 0.45, { bottom: false });
      }
      stats.standing++;
      continue;
    }

    // plinth (every other fate stands on one)
    const P = place(st.x, gMax, st.z, st.yaw, rng.range(-0.01, 0.01), rng.range(-0.01, 0.01));
    K.stone.frame(P).setTint(tint);
    const pTop = plinth(K.stone, { a: pa, b: st.pb, h1, h2, sink, rng });

    if (st.role === 'empty') {
      // the singer is gone; its voice remains as a seam of light
      K.glow.frame(P).setTint(0.7);
      K.glow.box(0, pTop + 0.02, 0, st.w * 0.7, 0.07, Math.max(0.2, st.d * 0.25));
      continue;
    }
    if (st.role === 'crushed' || st.role === 'fallen') {
      const S = { w: st.w, d: st.d, h: st.role === 'fallen' ? st.fall.stumpH : st.h * rng.range(0.06, 0.2), top: 'broken', rng, glyph: false };
      S.topH = Math.min(S.h * 0.5, Math.max(0.6, st.d * rng.range(0.6, 1.5)));
      K.dead.frame(up(P, pTop)).setTint(0.95);
      slab(K.dead, S);
      if (st.role === 'fallen') fallen(K, plan, st, rng);
      shards(K, plan, st, rng, st.role === 'fallen' ? 10 : 7);
      stats.fallen++;
      continue;
    }
    if (st.role === 'pair') {
      // two half-width stones leaning together until their crowns touch: a pointed portal
      const ww = st.w * 0.55;
      const hh = st.h * 0.96;
      const a = rng.range(0.1, 0.15);
      const X = (ww / 2) * Math.cos(a) + hh * Math.sin(a) + 0.12;
      for (const sd of [-1, 1]) {
        const S = { w: ww, d: st.d, h: hh, rng, taper: 0.04, top: 'slant', slantDir: -sd, topH: ww * 0.35 };
        inscription(S, rng, { slotChance: 0 });
        K.stones.frame(up(P, pTop).multiply(_r.makeTranslation(sd * X, 0, 0)).multiply(_t.makeRotationZ(sd * a))).setTint(1);
        slab(K.stones, S);
      }
      stats.standing += 2;
      continue;
    }
    if (st.role === 'split') {
      const g = Math.max(0.35, st.w * rng.range(0.04, 0.12));
      const ww = (st.w - g) / 2;
      const S0 = specFor(st, rng);
      for (const sd of [-1, 1]) {
        const S = { ...S0, w: ww, h: sd > 0 ? st.h * rng.range(0.84, 0.97) : st.h, taper: S0.taper * 0.5 };
        if (S.top === 'point') S.top = 'slant';
        if (S.top === 'slant') S.topH = ww * rng.range(0.2, 0.5);
        inscription(S, rng, { slotChance: 0 });
        const lean = sd * rng.range(0.008, 0.035);
        K.stones.frame(up(P, pTop).multiply(_r.makeTranslation(sd * (g / 2 + ww / 2), 0, 0)).multiply(_t.makeRotationZ(-lean))).setTint(1);
        slab(K.stones, S);
      }
      stats.standing++;
      continue;
    }

    const S = specFor(st, rng);
    inscription(S, rng);
    if (st.role === 'float') {
      const gap = rng.range(2, 10);
      const tilt = rng.range(0, 0.07);
      const ta = rng() * Math.PI * 2;
      const F = up(P, pTop + gap, Math.cos(ta) * tilt, Math.sin(ta) * tilt);
      const speed = rng.range(0.006, 0.016) * rng.sign();
      K.float.anim[0] = st.x;
      K.float.anim[1] = st.z;
      K.float.anim[2] = rng() * Math.PI * 2;
      K.float.anim[3] = speed;
      K.float.bob[0] = rng.range(0.4, Math.min(1.6, gap * 0.3));
      K.float.bob[1] = (Math.PI * 2) / rng.range(24, 46);
      K.float.frame(F).setTint(1);
      slab(K.float, S);
      K.glow.frame(P).setTint(1);
      K.glow.box(0, pTop + 0.02, 0, st.w * 0.62, 0.07, Math.max(0.2, st.d * 0.32));
      floaters.push({ x: st.x, z: st.z, y: gMax + pTop + gap, h: st.h });
      stats.floating++;
      continue;
    }
    // old stones settle: a slight lean on many of them
    const lean = rng.chance(0.45) ? rng.range(0.008, 0.045) : 0;
    const la = rng() * Math.PI * 2;
    K.stones.frame(up(P, pTop, Math.cos(la) * lean, Math.sin(la) * lean)).setTint(0.93 + 0.12 * st.salt);
    slab(K.stones, S);
    stats.standing++;
  }

  giant(K, plan, rng);
  return { stats, floaters };
}

/** Broken lengths of a fallen stone lying along its fall direction. */
function fallen(K, plan, st, rng) {
  const { gh } = plan;
  const f = st.fall;
  let remain = f.len;
  const n = Math.max(1, Math.min(4, Math.round(f.len / Math.max(6, st.w * 1.2))));
  let s = st.foot + rng.range(0.3, 1.5);
  for (let i = 0; i < n && remain > 1; i++) {
    const L = i === n - 1 ? remain : Math.min(remain, (f.len / n) * rng.range(0.75, 1.25));
    remain -= L;
    const yawJ = rng.range(-0.12, 0.12);
    const c = Math.cos(yawJ), sn = Math.sin(yawJ);
    const dx = f.dx * c - f.dz * sn;
    const dz = f.dx * sn + f.dz * c;
    const x0 = st.x + f.dx * s;
    const z0 = st.z + f.dz * s;
    const g0 = gh(x0, z0);
    const g1 = gh(x0 + dx * L, z0 + dz * L);
    const onEdge = rng.chance(0.25);
    const lift = (onEdge ? st.w * 0.5 : st.d * 0.5) * rng.range(0.55, 0.8);
    _y.set(dx * L, g1 - g0, dz * L).normalize();
    _x.set(-dz, 0, dx).normalize();
    _z.crossVectors(_x, _y).normalize();
    const B = new THREE.Matrix4().makeBasis(_x, _y, _z).setPosition(x0, g0 + lift, z0);
    B.multiply(_r.makeRotationY((onEdge ? Math.PI / 2 : 0) + rng.range(-0.15, 0.15)));
    K.dead.frame(B).setTint(0.9 + 0.1 * rng());
    slab(K.dead, { w: st.w, d: st.d, h: L, top: 'broken', topH: Math.min(L * 0.3, st.d * 1.2), brokenBase: true, rng, glyph: false });
    s += L + rng.range(0.4, 3.5);
  }
}

function shards(K, plan, st, rng, n) {
  const { gh } = plan;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const rr = st.foot + rng.range(0.5, 8 + st.h * 0.1);
    let dx = Math.cos(a), dz = Math.sin(a);
    if (st.fall && rng.chance(0.6)) {
      dx = st.fall.dx + rng.range(-0.4, 0.4);
      dz = st.fall.dz + rng.range(-0.4, 0.4);
    }
    const x = st.x + dx * rr;
    const z = st.z + dz * rr;
    if (plan.pathDist(x, z) < 4.5) continue;
    const sz = Math.max(0.3, st.d * rng.range(0.25, 0.9));
    K.dead.frame(place(x, gh(x, z) - sz * 0.25, z, rng() * 6, rng.range(-1.2, 1.2), rng.range(-1.2, 1.2))).setTint(0.9);
    slab(K.dead, { w: sz * rng.range(1, 2.2), d: sz * 0.6, h: sz * rng.range(0.8, 1.8), top: 'broken', topH: sz * 0.5, brokenBase: true, rng, glyph: false });
  }
}

/** The giant hovering over the amphitheatre, and the broken shards circling beneath it. */
function giant(K, plan, rng) {
  const { amph } = plan;
  const h = 185;
  const S = { w: 54, d: 13, h, rng, taper: 0.06, taperD: 0.08, ridge: 2.2, top: 'slant', slantDir: 1, topH: 12, chamfer: 1.5, gs: 1.45 };
  // a 100 m slit through its heart: backlit, the setting sun shows through the giant
  inscription(S, rng, { extent: 0.3, slit: [h * 0.12, h * 0.64, 4.2] });
  const baseY = amph.floorY + 56;
  K.float.anim[0] = 0;
  K.float.anim[1] = 0;
  K.float.anim[2] = -0.57; // broad face toward the establishing view (SE) at load
  K.float.anim[3] = 0.0035;
  K.float.bob[0] = 1.5;
  K.float.bob[1] = (Math.PI * 2) / 80;
  K.float.frame(place(0, baseY, 0, 0)).setTint(1.05);
  slab(K.float, S);
  // shards: a slow ring of broken pieces orbiting under the giant
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const rr = rng.range(13, 24);
    const sz = rng.range(1.6, 4.5);
    K.float.anim[2] = rng() * 6;
    K.float.anim[3] = 0.011;
    K.float.bob[0] = rng.range(0.6, 1.8);
    K.float.bob[1] = (Math.PI * 2) / rng.range(18, 34);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    K.float.frame(place(x, amph.floorY + rng.range(10, 42), z, a, rng.range(-0.6, 0.6), rng.range(-0.6, 0.6)));
    const P = { w: sz * rng.range(1.2, 2.4), d: sz * 0.55, h: sz * rng.range(1.4, 3), top: 'broken', topH: sz * 0.6, brokenBase: true, rng, gs: 0.45 };
    inscription(P, rng, { extent: 0.9, slotChance: 0 });
    P.channels = [];
    slab(K.float, P);
  }
  K.float.anim[0] = K.float.anim[1] = K.float.anim[2] = K.float.anim[3] = 0;
  K.float.bob[0] = K.float.bob[1] = 0;
  return { baseY, h };
}
