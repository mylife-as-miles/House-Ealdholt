// Needle City — site analysis and the city plan (where every needle stands, how tall, what kind).
//
// Plan order: specials first (the great needles, the fallen needle and its scar, the needle caught
// by a neighbour) reserve their ground; then dart-throwing fills the plateau with singles and
// bundles (denser and taller toward the centre, districts of dark stone); a few needles stand right
// on the cliff edge; some needles are HUNG between neighbours and never reach the ground; a few
// lean dangerously. Every needle gets its segment rhythm (collar heights) and a tower frame.

import * as THREE from 'crownfall-world-three';

const TAU = Math.PI * 2;

export function analyseSite(ctx, site) {
  const N = 180;
  const edge = new Float32Array(N);
  let topSum = 0, topN = 0;
  for (let x = -60; x <= 60; x += 30) for (let z = -60; z <= 60; z += 30) { topSum += ctx.heightAt(site.x + x, site.z + z); topN++; }
  const top = topSum / topN;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const dx = Math.cos(a), dz = Math.sin(a);
    let last = 300;
    for (let r = 300; r < 660; r += 3) {
      const h = ctx.heightAt(site.x + dx * r, site.z + dz * r);
      if (h < top - 12) break;
      last = r;
    }
    edge[i] = Math.min(last, 495); // no cliff to the north (the city spills onto the foothills): cap it
  }
  // conservative: min of neighbours
  const e2 = new Float32Array(N);
  for (let i = 0; i < N; i++) e2[i] = Math.min(edge[i], edge[(i + 1) % N], edge[(i + N - 1) % N]);
  const edgeAt = (x, z) => {
    let a = Math.atan2(z - site.z, x - site.x);
    if (a < 0) a += TAU;
    const f = (a / TAU) * N;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f);
    return e2[i0] * (1 - t) + e2[i1] * t;
  };
  // the waterfall feeder stream (water module) runs inward from its lip on the SW rim
  let lip = null;
  const f = ctx.water?.falls?.find((w) => w.id === 'needle-rim');
  if (f) lip = { x: f.lip.x, z: f.lip.z };
  else {
    // same search as the water module's rim lip, so the plan never depends on module order
    const dx = Math.cos(2.4), dz = Math.sin(2.4);
    const fx = site.x + dx * 380, fz = site.z + dz * 380;
    for (let s = 0; s < 300 && !lip; s += 2) {
      const x = fx + dx * s, z = fz + dz * s;
      const h = ctx.heightAt(x, z);
      if (h - ctx.heightAt(x + dx * 25, z + dz * 25) > 28) {
        let b = s;
        while (b > 0 && ctx.heightAt(fx + dx * b, fz + dz * b) < h - 1.0) b -= 1;
        lip = { x: fx + dx * b, z: fz + dz * b };
      }
    }
    if (!lip) lip = { x: fx, z: fz };
  }
  let fdx = lip.x - site.x, fdz = lip.z - site.z;
  const fl = Math.hypot(fdx, fdz) || 1;
  fdx /= fl; fdz /= fl;
  const fa = { x: lip.x - fdx * 95, z: lip.z - fdz * 95 };
  const fb = { x: lip.x + fdx * 15, z: lip.z + fdz * 15 };
  const feederDist = (x, z) => segDist2D(x, z, fa.x, fa.z, fb.x, fb.z);
  return { top, edge: e2, edgeAt, lip, fdir: { x: fdx, z: fdz }, feederDist };
}

export function segDist2D(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz || 1e-9;
  let t = ((px - ax) * vx + (pz - az) * vz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px, dz = az + vz * t - pz;
  return Math.sqrt(dx * dx + dz * dz);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Radius of the shaft at local height y (tapering, slightly convex). */
export function rAt(t, y) {
  const u = Math.min(1, Math.max(0, y / t.Hs));
  // concave taper (stout foot, long thin needle) with a flared pedestal drum
  const flare = 1 + 0.28 * Math.max(0, 1 - y / 24);
  return (t.r1 + (t.r0 - t.r1) * Math.pow(1 - u, 1.35)) * flare;
}

/** World position of the needle axis at local height y. */
const _v = new THREE.Vector3();
export function axisAt(t, y, out = _v) {
  return out.set(0, y, 0).applyMatrix4(t.frame);
}

export function planCity(ctx, site, S, opts = {}) {
  const rng = ctx.noise.createRng('needles');
  const { fbm2 } = ctx.noise.worldNoise;
  const target = opts.count ?? 400;
  const towers = [];
  const bundles = [];
  const corridors = []; // [{ax, az, bx, bz, w}] ground kept clear
  const CELL = 40;
  const grid = new Map();
  const key = (i, j) => i * 4096 + j;
  const addGrid = (t) => {
    const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(t);
  };
  const near = (x, z, R, fn) => {
    const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL);
    const j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = grid.get(key(i, j));
      if (l) for (const t of l) fn(t);
    }
  };
  const clearOf = (x, z, pr, alley) => {
    let ok = true;
    near(x, z, pr + 40, (t) => {
      if (!ok) return;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < pr + t.pr + alley) ok = false;
    });
    if (!ok) return false;
    for (const c of corridors) if (segDist2D(x, z, c.ax, c.az, c.bx, c.bz) < c.w + pr * 0.6) return false;
    return true;
  };
  const cityLimit = (x, z) => S.edgeAt(x, z) - (30 + 9 * fbm2(x * 0.01 + 7, z * 0.01, 2));
  const rOf = (x, z) => Math.hypot(x - site.x, z - site.z);
  const inCity = (x, z, pr) => rOf(x, z) + pr * 0.5 < cityLimit(x, z) && S.feederDist(x, z) > 30 + pr;

  // skyline: a dome of needles peaking a little north-east of centre, districts +-30 %, a few
  // spires far above the mass, and a low infill layer so the silhouette has depth
  const heightFor = (x, z) => {
    const du = Math.min(1, Math.hypot(x - site.x - 40, z - site.z + 60) / 450);
    const dome = 150 + 560 * Math.pow(1 - Math.pow(du, 1.3), 1.4);
    const dist = 1 + 0.2 * fbm2(x * 0.0045 + 1.7, z * 0.0045 - 3.1, 3);
    let H = dome * dist * rng.range(0.84, 1.1);
    const p = rng();
    if (p < 0.07 && du < 0.65) H *= rng.range(1.25, 1.45);
    else if (p < 0.27) H = Math.min(H, rng.range(120, 210));
    return Math.min(715, Math.max(120, H));
  };
  const darkAt = (x, z) => (fbm2(x * 0.007 + 3.3, z * 0.007 + 9.1, 2) > 0.02 ? rng() < 0.66 : rng() < 0.16);

  let nextId = 0;
  const mk = (x, z, H, r0, o = {}) => {
    const t = {
      id: nextId++, x, z, H, r0,
      r1: Math.max(0.85, r0 * rng.range(0.24, 0.38)),
      n: rng() < 0.55 ? 8 : rng() < 0.6 ? 6 : 4,
      rot: rng() * TAU,
      dark: darkAt(x, z),
      kind: 'tower', crown: null, lean: null, twist: 0, snapY: 0,
      inhabited: rng() < 0.5,
      pr: r0 * rng.range(1.7, 2.15) + 1.6,
      bundle: null, hangY: 0, plinth: true,
      ...o,
    };
    if (t.n === 4 && rng() < 0.45) t.twist = rng.range(0.1, 0.2) * rng.sign();
    return t;
  };
  const pushT = (t) => {
    towers.push(t);
    addGrid(t);
    return t;
  };

  // --- 1. the great needles near the centre -------------------------------------------------
  const greats = [];
  // the first one stands toward the west (sunward, facing the lake): the caught needle leans on it
  const caughtA = rng.range(2.85, 3.2);
  for (let tries = 0; greats.length < 7 && tries < 600; tries++) {
    let x, z;
    if (!greats.length) {
      // the sentinel: a great needle right on the western rim
      const e = cityLimit(site.x + Math.cos(caughtA) * 400, site.z + Math.sin(caughtA) * 400);
      const r = e - 22 - tries * 0.5;
      x = site.x + Math.cos(caughtA) * r;
      z = site.z + Math.sin(caughtA) * r;
    } else {
      const a = rng() * TAU, r = 25 + 210 * Math.sqrt(rng());
      x = site.x + 40 + Math.cos(a) * r;
      z = site.z - 60 + Math.sin(a) * r;
    }
    if (!inCity(x, z, 14)) continue;
    if (greats.some((g) => Math.hypot(g.x - x, g.z - z) < 70)) continue;
    const H = rng.range(640, 715);
    const t = mk(x, z, H, rng.range(5.0, 6.2), { crown: rng() < 0.5 ? 'lantern' : 'spike', great: true, n: 8, inhabited: true });
    t.pr = t.r0 * 2.3 + 3;
    greats.push(pushT(t));
  }

  // --- 2. the needle caught by its neighbour ---------------------------------------------------
  // S snapped at snapY; its upper part (length L) slid off the stump: the lower end rests on the
  // ground beside the stump, the upper end leans against great needle T at height yc.
  let caught = null;
  {
    // S stands along the rim from T, so the fallen length lies ALONG the city edge and is seen
    // side-on from outside the plateau
    const T = greats[0];
    const rT0 = Math.hypot(T.x - site.x, T.z - site.z);
    for (let tries = 0; tries < 80 && !caught; tries++) {
      const L = rng.range(250, 300);
      const dh = L * rng.range(0.64, 0.72);
      const rT = T.r0 * 0.85;
      const dST = dh + 7 + rT;
      const side = tries % 2 ? 1 : -1;
      const aS = caughtA + side * 2 * Math.asin(Math.min(0.9, dST / (2 * rT0)));
      const sx = site.x + Math.cos(aS) * rT0, sz = site.z + Math.sin(aS) * rT0;
      if (!inCity(sx, sz, 8)) continue;
      if (greats.some((g) => g !== T && (Math.hypot(g.x - sx, g.z - sz) < 40 || segDist2D(g.x, g.z, sx, sz, T.x, T.z) < 26))) continue;
      const snapY = rng.range(85, 125);
      // stout, pale and still inhabited: its pods and lamps rode it down
      const S = mk(sx, sz, snapY + L, 6.2, { n: 8, crown: 'blunt', kind: 'snapped', snapY, inhabited: true, dark: false });
      S.r1 = S.r0 * 0.42;
      S.pr = S.r0 * 2 + 2;
      pushT(S);
      caught = { S, T, L, dh, a: Math.atan2((sz + T.z) / 2 - site.z, (sx + T.x) / 2 - site.x) };
      corridors.push({ ax: sx, az: sz, bx: T.x, bz: T.z, w: 20 });
    }
  }

  // --- 3. the fallen needle and its scar -------------------------------------------------------
  let fallen = null;
  for (let tries = 0; tries < 120 && !fallen; tries++) {
    const a = rng() * TAU, r = rng.range(170, 270);
    const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
    if (!inCity(x, z, 12)) continue;
    if (!clearOf(x, z, 12, 20)) continue;
    const snapY = rng.range(55, 85);
    const H = rng.range(330, 380);
    const L = H - snapY;
    const fa = a + Math.PI + rng.sign() * rng.range(0.7, 1.1); // inward and sideways
    const dx = Math.cos(fa), dz = Math.sin(fa);
    const ex = x + dx * (L + 12), ez = z + dz * (L + 12);
    if (rOf(ex, ez) > cityLimit(ex, ez) - 10 || S.feederDist(ex, ez) < 40) continue;
    let bad = false;
    near((x + ex) / 2, (z + ez) / 2, L / 2 + 30, (t) => {
      if (segDist2D(t.x, t.z, x, z, ex, ez) < t.pr + 16) bad = true;
    });
    if (bad) continue;
    const F = mk(x, z, H, 5.4, { n: 6, crown: 'spike', kind: 'snapped', snapY, inhabited: false });
    F.r1 = F.r0 * 0.36;
    F.pr = F.r0 * 2 + 2;
    pushT(F);
    fallen = { F, dir: { x: dx, z: dz }, L };
    corridors.push({ ax: x + dx * 10, az: z + dz * 10, bx: ex, bz: ez, w: 13 });
  }

  // --- 4. the fill: singles and bundles ------------------------------------------------------
  // open plazas: a few voids in the forest (ground-level views, light wells)
  for (let k = 0, tries = 0; k < 3 && tries < 50; tries++) {
    const a = rng() * TAU, r = rng.range(120, 300);
    const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
    if (!inCity(x, z, 30) || !clearOf(x, z, 30, 4)) continue;
    corridors.push({ ax: x, az: z, bx: x, bz: z, w: rng.range(30, 44), plaza: true });
    k++;
  }
  const seeds = [];
  for (let k = 0; k < 40; k++) {
    const a = rng() * TAU, r = 430 * Math.sqrt(rng());
    seeds.push({ x: site.x + Math.cos(a) * r, z: site.z + Math.sin(a) * r, s: rng.range(22, 42) });
  }
  let attempts = 0;
  while (towers.length < target && attempts < 30000) {
    attempts++;
    let x, z, tight = false;
    if (rng() < 0.72) {
      // around a district seed: tight clumps with plazas between them
      const sd = seeds[Math.floor(rng() * seeds.length)];
      x = sd.x + rng.gauss() * sd.s;
      z = sd.z + rng.gauss() * sd.s;
      tight = true;
    } else {
      const a = rng() * TAU, r = 540 * Math.sqrt(rng());
      x = site.x + Math.cos(a) * r;
      z = site.z + Math.sin(a) * r;
    }
    const r = rOf(x, z);
    const edge = S.edgeAt(x, z);
    const u = r / edge;
    const dens = 0.12 + 0.88 * (1 - smooth(0.3, 1.0, u)) + 0.2 * fbm2(x * 0.009 - 5, z * 0.009 + 2, 2);
    if (rng() > dens) continue;
    const H = heightFor(x, z);
    if (rng() < 0.085) {
      // bundle: 3-5 thin shafts tied together by bands
      const m = rng.int(3, 5);
      const rm = rng.range(1.5, 2.3);
      const ro = rm * rng.range(1.9, 2.3) + 0.4;
      const pr = ro + rm * 1.8 + 2.2;
      if (!inCity(x, z, pr) || !clearOf(x, z, pr, tight ? 2 : rng.range(3, 6))) continue;
      const B = { id: bundles.length, x, z, ro, rm, members: [], pr, H };
      const a0 = rng() * TAU;
      const mrot = rng() * TAU;
      const hs = [];
      for (let k = 0; k < m; k++) hs.push(k === 0 ? 1 : rng.range(0.55, 0.95));
      for (let k = 0; k < m; k++) {
        const aa = a0 + (k / m) * TAU + rng.range(-0.15, 0.15);
        const mx = x + Math.cos(aa) * ro, mz = z + Math.sin(aa) * ro;
        const t = mk(mx, mz, Math.max(170, H * hs[k]), rm * rng.range(0.85, 1.1), { kind: 'member', bundle: B, rot: mrot, n: 8 });
        t.pr = 0; // the bundle carries the plinth
        t.twist = 0;
        towers.push(t);
        B.members.push(t);
      }
      bundles.push(B);
      // grid entry for the bundle as a whole (clearance)
      addGrid({ x, z, pr, H, isBundle: true });
      continue;
    }
    // widths: log-spread, loosely tied to height (a few fat drums among hair-thin needles)
    const r0 = Math.min(5.8, Math.max(1.2, (0.9 + H * 0.0045) * Math.exp(rng.gauss() * 0.28)));
    const t = mk(x, z, H, r0);
    if (!inCity(x, z, t.pr) || !clearOf(x, z, t.pr, tight ? rng.range(1.5, 3.5) : rng.range(3, 7))) continue;
    pushT(t);
  }

  // --- 5. needles right on the cliff edge ---------------------------------------------------
  let edgeCount = 0;
  for (let tries = 0; tries < 300 && edgeCount < 9; tries++) {
    const a = rng() * TAU;
    const dx = Math.cos(a), dz = Math.sin(a);
    const e = S.edgeAt(site.x + dx * 400, site.z + dz * 400);
    const r0 = rng.range(2.4, 3.6);
    const pr = r0 * 1.8 + 1.5;
    const r = e - pr - rng.range(2, 6);
    const x = site.x + dx * r, z = site.z + dz * r;
    if (S.feederDist(x, z) < 60) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const h = ctx.heightAt(x + Math.cos(k * 0.785) * pr, z + Math.sin(k * 0.785) * pr);
      if (h < S.top - 5) ok = false;
    }
    if (!ok || !clearOf(x, z, pr, 8)) continue;
    const t = mk(x, z, rng.range(240, 470), r0, { kind: 'edge' });
    t.pr = pr;
    pushT(t);
    edgeCount++;
  }

  // --- 6. hung needles: held aloft by their neighbours, never touching the ground -------------
  const hung = [];
  for (let tries = 0; tries < 900 && hung.length < 6; tries++) {
    const a = rng() * TAU, r = 60 + 300 * Math.sqrt(rng());
    const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
    if (!inCity(x, z, 8)) continue;
    let minD = Infinity;
    const nb = [];
    near(x, z, 80, (t) => {
      if (t.isBundle) { minD = Math.min(minD, Math.hypot(t.x - x, t.z - z) - t.pr); return; }
      const d = Math.hypot(t.x - x, t.z - z);
      minD = Math.min(minD, d - Math.max(t.pr, t.r0 + 2));
      if (d > 22 && d < 75 && t.kind !== 'snapped' && t.H > 300) nb.push(t);
    });
    if (minD < 14 || nb.length < 4) continue;
    if (hung.some((h) => Math.hypot(h.x - x, h.z - z) < 90)) continue;
    let blocked = false;
    for (const c of corridors) if (segDist2D(x, z, c.ax, c.az, c.bx, c.bz) < c.w + 6) blocked = true;
    if (blocked) continue;
    const hmin = Math.min(...nb.map((t) => t.H));
    const hangY = rng.range(45, 110);
    const H = Math.min(hmin - 40, rng.range(200, 330));
    if (H < 150) continue;
    const t = mk(x, z, H, rng.range(2.2, 3.2), { kind: 'hung', hangY, plinth: false, n: 8, inhabited: true, crown: 'spike' });
    t.pr = t.r0 + 3;
    t.anchors = nb;
    hung.push(pushT(t));
  }

  // --- 7. crowns, leaners, segment rhythm, frames ---------------------------------------------
  for (const t of towers) {
    if (!t.crown) {
      const tall = t.H > 500;
      const p = rng();
      t.crown = tall
        ? p < 0.45 ? 'spike' : p < 0.75 ? 'lantern' : 'fork'
        : p < 0.36 ? 'spike' : p < 0.56 ? 'lantern' : p < 0.68 ? 'fork' : p < 0.86 ? 'broken' : 'blunt';
    }
    const crownH = t.crown === 'spike' ? rng.range(0.07, 0.14) * t.H
      : t.crown === 'fork' ? rng.range(0.05, 0.09) * t.H
      : t.crown === 'lantern' ? 14 + t.r0 * 2 : t.crown === 'broken' ? 0 : 3;
    t.Hs = t.H - crownH;
    t.collar = t.dark ? (rng() < 0.45 ? 'bronze' : rng() < 0.7 ? 'pale' : 'iron') : (rng() < 0.55 ? 'bronze' : rng() < 0.65 ? 'stone' : 'iron');
    t.tint = t.dark
      ? [rng.range(0.85, 1.1), rng.range(0.85, 1.05), rng.range(0.85, 1.05)]
      : (() => { const b = rng.range(0.82, 1.04); const w = rng.range(-0.06, 0.06); return [b * (1 + w), b, b * (1 - w * 1.6)]; })();
  }
  // ground + base height
  for (const B of bundles) {
    let g0 = Infinity, g1 = -Infinity;
    for (let k = 0; k < 9; k++) {
      const rr = k === 0 ? 0 : B.pr;
      const h = ctx.heightAt(B.x + Math.cos(k * 0.785) * rr, B.z + Math.sin(k * 0.785) * rr);
      g0 = Math.min(g0, h); g1 = Math.max(g1, h);
    }
    B.g0 = g0; B.g1 = g1;
    B.baseY = g1 + rng.range(3, 6);
  }
  for (const t of towers) {
    if (t.bundle) { t.g0 = t.bundle.g0; t.g1 = t.bundle.g1; t.baseY = t.bundle.baseY; continue; }
    let g0 = Infinity, g1 = -Infinity;
    const R = Math.max(t.pr, t.r0 + 1);
    for (let k = 0; k < 9; k++) {
      const rr = k === 0 ? 0 : R;
      const h = ctx.heightAt(t.x + Math.cos(k * 0.785) * rr, t.z + Math.sin(k * 0.785) * rr);
      g0 = Math.min(g0, h); g1 = Math.max(g1, h);
    }
    t.g0 = g0; t.g1 = g1;
    if (t.kind === 'hung') t.baseY = g1 + t.hangY;
    else t.baseY = g1 + rng.range(2.5, 4.5) + t.r0 * 0.6;
  }
  // leaners: clear lean direction needed (the top may swing 30-60 m)
  const leanCands = towers.filter((t) => t.kind === 'tower' && !t.great && t.H > 230 && t.H < 560);
  let leaners = 0;
  for (let tries = 0; tries < 300 && leaners < 7 && leanCands.length; tries++) {
    const t = rng.pick(leanCands);
    if (t.lean) continue;
    const ang = rng.range(0.08, 0.16);
    let best = null;
    for (let k = 0; k < 12; k++) {
      const la = (k / 12) * TAU;
      const dx = Math.cos(la), dz = Math.sin(la);
      let clear = Infinity;
      // sample the leaning axis against every other axis (straight towers)
      near(t.x, t.z, t.H * ang + 60, (o) => {
        if (o === t || o.isBundle) return;
        for (let y = 60; y <= t.H; y += 40) {
          const off = Math.sin(ang) * y;
          const px = t.x + dx * off, pz = t.z + dz * off;
          if (y > (o.H ?? 0) + 5) continue;
          const d = Math.hypot(px - o.x, pz - o.z) - (o.r0 ?? o.pr) - t.r0 - (o.lean ? 30 : 4);
          clear = Math.min(clear, d);
        }
      });
      if (clear > 6 && (!best || clear > best.clear)) best = { dx, dz, clear };
    }
    if (!best) continue;
    t.lean = { dx: best.dx, dz: best.dz, ang };
    leaners++;
  }
  // segment rhythm: collars at every boundary; galleries every few; bridges spring from collars
  for (const t of towers) {
    const segs = [0];
    let y = rng.range(12, 24) + t.r0 * 1.5;
    const top = t.kind === 'snapped' ? t.H : t.Hs;
    while (y < top - 10) {
      segs.push(y);
      y += rng.range(15, 30) * (0.75 + t.r0 / 7);
    }
    segs.push(top);
    t.segs = segs;
    const every = rng.int(3, 5);
    const off = rng.int(1, every);
    t.gal = segs.map((_, i) => i > 0 && i < segs.length - 1 && (i + off) % every === 0 && t.r0 > 1.8);
    if (t.kind === 'snapped') t.Hs = t.H;
    // frame
    const m = new THREE.Matrix4().makeTranslation(t.x, t.baseY, t.z);
    if (t.lean) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(t.lean.dz, 0, -t.lean.dx).normalize(), t.lean.ang);
      m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
    }
    t.frame = m;
  }

  return { towers, bundles, greats, caught, fallen, hung, corridors, rng, near };
}
