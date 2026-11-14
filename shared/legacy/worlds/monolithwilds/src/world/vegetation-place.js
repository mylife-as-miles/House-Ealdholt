// Where every plant grows. Deterministic (hash of the grid cell + world noise), no Math.random().
//
// The density fields are the shared biome fields (src/core/biome.js) — forestDensity / meadowDensity,
// the same numbers the terrain shader paints its forest floor and meadows with. When the terrain
// module is loaded they are read straight from its 9 m world maps (ctx.terrain.grid / maps.B);
// otherwise an 18 m grid is computed here with the same functions.
//
//   spire conifers   dominant forests: acceptance rises with forest density; trees are taller in the
//                    forest interior and younger/shorter at the edges; small clearings; a few rust
//                    crowns; ghost trees take over near the water
//   parasol pines    groves on convex ground (hilltops, ridges, spurs) in open land and forest edges
//   fallen logs      windthrown trunks (root plate on edge) lying along the contours in clearings
//   aspens           clonal groves on forest margins and ringing clearings (green / yellow / gold)
//   ghost trees      lowland shores (a few metres above the water), leaning toward the water
//   giants           a few dozen chosen sites: meadows, forest edges, shores, hilltops; spaced out
//   shrubs           forest edges, open woodland, meadows (heather patches on dry ground)
//   reeds            the waterline (-0.7 .. +0.9 m), clumped

import { forestDensity, meadowDensity } from '../core/biome.js';
import { yieldToMain } from '../core/yield.js';

const WG = { n: 1025, x0: -4600, step: 9200 / 1024 };

/** Bilinear sampler over a regular grid of `n` x `n` values (stride/offset for packed maps). */
function sampler(data, n, x0, step, stride = 1, off = 0, scale = 1) {
  const max = n - 1.001;
  return (x, z) => {
    let fx = (x - x0) / step, fz = (z - x0) / step;
    fx = fx < 0 ? 0 : fx > max ? max : fx;
    fz = fz < 0 ? 0 : fz > max ? max : fz;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = (j * n + i) * stride + off;
    const a = data[k] + (data[k + stride] - data[k]) * tx;
    const r = n * stride;
    const b = data[k + r] + (data[k + r + stride] - data[k + r]) * tx;
    return (a + (b - a) * tz) * scale;
  };
}

/**
 * Fields: h (bilinear ground height), forest, meadow (0..1), slope (1 - ny), convexity (m: + on
 * ridges / hilltops), grad(x,z) -> [dhdx, dhdz].
 */
export async function createFields(ctx) {
  const T = ctx.terrain;
  const tg = T?.grid;
  const B = T?.maps?.B?.image?.data;
  let h, forest, meadow, source, water, raw;
  let step;
  if (tg && tg.data && tg.n && B && B.length === tg.n * tg.n * 4) {
    h = sampler(tg.data, tg.n, tg.x0, tg.step);
    const W = waterDistance(tg.data, tg.n, tg.x0, tg.step, ctx.water?.ponds);
    water = sampler(W, tg.n, tg.x0, tg.step);
    raw = { n: tg.n, x0: tg.x0, step: tg.step, H: tg.data, W, forestAt: (k) => B[k * 4] / 255 };
    forest = sampler(B, tg.n, tg.x0, tg.step, 4, 0, 1 / 255);
    meadow = sampler(B, tg.n, tg.x0, tg.step, 4, 1, 1 / 255);
    step = tg.step;
    source = 'terrain';
  } else {
    // fallback: our own 18 m grid of heights + biome fields (same functions the terrain uses)
    const n = 513;
    const x0 = WG.x0;
    step = 9200 / (n - 1);
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = ctx.heightAt(x0 + i * step, x0 + j * step);
    await yieldToMain();
    const F = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = x0 + i * step, z = x0 + j * step;
        const hx = (H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)]) / (2 * step);
        const hz = (H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i]) / (2 * step);
        const ny = 1 / Math.sqrt(1 + hx * hx + hz * hz);
        F[k * 2] = forestDensity(x, z, H[k], ny);
        F[k * 2 + 1] = meadowDensity(x, z);
      }
    }
    h = sampler(H, n, x0, step);
    const W = waterDistance(H, n, x0, step, ctx.water?.ponds);
    water = sampler(W, n, x0, step);
    raw = { n, x0, step, H, W, forestAt: (k) => F[k * 2] };
    forest = sampler(F, n, x0, step, 2, 0);
    meadow = sampler(F, n, x0, step, 2, 1);
    source = 'own';
  }
  const e = step;
  const grad = (x, z, out) => {
    out[0] = (h(x + e, z) - h(x - e, z)) / (2 * e);
    out[1] = (h(x, z + e) - h(x, z - e)) / (2 * e);
    return out;
  };
  const g2 = [0, 0];
  const slope = (x, z) => {
    grad(x, z, g2);
    return 1 - 1 / Math.sqrt(1 + g2[0] * g2[0] + g2[1] * g2[1]);
  };
  const R = 70;
  const convexity = (x, z) => {
    const c = h(x, z);
    const m = (h(x + R, z) + h(x - R, z) + h(x, z + R) + h(x, z - R) + h(x + R * 0.7, z + R * 0.7) + h(x - R * 0.7, z - R * 0.7) + h(x + R * 0.7, z - R * 0.7) + h(x - R * 0.7, z + R * 0.7)) / 8;
    return c - m;
  };
  // forest density on the raw grid as one flat array (the loops below read it ~12 M times)
  const rn = raw.n;
  const fg = new Float32Array(rn * rn);
  for (let k = 0; k < rn * rn; k++) fg[k] = raw.forestAt(k);
  // coarse block mask (64 m): the densest forest value in each block, to skip empty land fast
  const BS = 64;
  const nb = Math.ceil(9200 / BS);
  const fmax = new Float32Array(nb * nb);
  const bOf = new Int32Array(rn);
  for (let i = 0; i < rn; i++) bOf[i] = Math.min(nb - 1, Math.floor((raw.x0 + i * raw.step + 4600) / BS));
  for (let j = 0; j < rn; j++) {
    const row = bOf[j] * nb;
    for (let i = 0; i < rn; i++) {
      const f = fg[j * rn + i];
      const b = row + bOf[i];
      if (f > fmax[b]) fmax[b] = f;
    }
  }
  // dilate by one block so a lookup covers its neighbours (one read per query)
  const fdil = new Float32Array(nb * nb);
  for (let bj = 0; bj < nb; bj++) {
    for (let bi = 0; bi < nb; bi++) {
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = bi + di, b = bj + dj;
          if (a >= 0 && b >= 0 && a < nb && b < nb && fmax[b * nb + a] > m) m = fmax[b * nb + a];
        }
      }
      fdil[bj * nb + bi] = m;
    }
  }
  const forestMax = (x, z) => {
    const bi = Math.floor((x + 4600) / BS), bj = Math.floor((z + 4600) / BS);
    if (bi < 0 || bj < 0 || bi >= nb || bj >= nb) return 0;
    return fdil[bj * nb + bi];
  };
  // forest interior: density eroded by ~2 grid cells (the thinnest forest within ~18 m), so trees
  // can tell a forest edge from the deep interior with one lookup
  const tmp = new Float32Array(rn * rn);
  const ero = new Float32Array(rn * rn);
  for (let j = 0; j < rn; j++) {
    const o = j * rn;
    for (let i = 0; i < rn; i++) {
      let m = 1;
      for (let d = -2; d <= 2; d++) {
        const ii = i + d < 0 ? 0 : i + d >= rn ? rn - 1 : i + d;
        const v = fg[o + ii];
        if (v < m) m = v;
      }
      tmp[o + i] = m;
    }
  }
  for (let j = 0; j < rn; j++) {
    for (let i = 0; i < rn; i++) {
      let m = 1;
      for (let d = -2; d <= 2; d++) {
        const jj = j + d < 0 ? 0 : j + d >= rn ? rn - 1 : j + d;
        const v = tmp[jj * rn + i];
        if (v < m) m = v;
      }
      ero[j * rn + i] = m;
    }
  }
  const interior = sampler(ero, rn, raw.x0, raw.step);
  const waterNear = (x, z) => {
    const i = Math.round((x - raw.x0) / raw.step), j = Math.round((z - raw.x0) / raw.step);
    if (i < 0 || j < 0 || i >= raw.n || j >= raw.n) return 1e9;
    return raw.W[j * raw.n + i];
  };
  return { h, forest, meadow, slope, grad, convexity, water, waterNear, raw, forestMax, interior, source };
}

/**
 * Horizontal distance (m) to the nearest water (lake/river below y = 0, and the water module's
 * ponds when present): two-pass chamfer distance transform over the height grid.
 */
function waterDistance(H, n, x0, step, ponds) {
  const d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = H[k] < 0 ? 0 : 1e9;
  if (Array.isArray(ponds)) {
    for (const p of ponds) {
      if (!(p && p.r > 0)) continue;
      const r = p.r, i0 = Math.max(0, Math.floor((p.x - r - x0) / step)), i1 = Math.min(n - 1, Math.ceil((p.x + r - x0) / step));
      const j0 = Math.max(0, Math.floor((p.z - r - x0) / step)), j1 = Math.min(n - 1, Math.ceil((p.z + r - x0) / step));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * step, z = x0 + j * step;
          if ((x - p.x) ** 2 + (z - p.z) ** 2 < r * r && H[j * n + i] < p.level + 0.5) d[j * n + i] = 0;
        }
      }
    }
  }
  const a = step, b = step * Math.SQRT2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0 && d[k - 1] + a < v) v = d[k - 1] + a;
      if (j > 0) {
        if (d[k - n] + a < v) v = d[k - n] + a;
        if (i > 0 && d[k - n - 1] + b < v) v = d[k - n - 1] + b;
        if (i < n - 1 && d[k - n + 1] + b < v) v = d[k - n + 1] + b;
      }
      d[k] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < n - 1 && d[k + 1] + a < v) v = d[k + 1] + a;
      if (j < n - 1) {
        if (d[k + n] + a < v) v = d[k + n] + a;
        if (i < n - 1 && d[k + n + 1] + b < v) v = d[k + n + 1] + b;
        if (i > 0 && d[k + n - 1] + b < v) v = d[k + n - 1] + b;
      }
      d[k] = v;
    }
  }
  return d;
}

// integer hash -> [0,1)
function hash(i, j, s) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// smoothstep that also works with reversed edges (a > b)
const sstep = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** Occupancy of the giants (cleared rings), so no conifer grows inside a giant's trunk. */
class ClearMask {
  constructor() {
    this.items = [];
  }

  add(x, z, r) {
    this.items.push([x, z, r * r]);
  }

  blocked(x, z) {
    const it = this.items;
    for (let i = 0; i < it.length; i++) {
      const dx = x - it[i][0], dz = z - it[i][1];
      if (dx * dx + dz * dz < it[i][2]) return true;
    }
    return false;
  }
}

/**
 * Scatter everything into the kinds' instance lists.
 *   K: { spire, parasol, ghost, giantS, giantC, shrub, reed } StaticKinds (with .list)
 *   q: quality.vegetation (0..1)
 */
export function scatter(ctx, F, K, q, rng) {
  const N = ctx.noise.worldNoise;
  const L = ctx.layout;
  const rocks = ctx.rocks && typeof ctx.rocks.blocked === 'function' ? ctx.rocks : null;
  const blockedByRock = (x, z, m) => {
    if (!rocks) return false;
    try {
      return rocks.blocked(x, z, m);
    } catch {
      return false;
    }
  };
  const TAU = Math.PI * 2;
  const counts = {};
  const ms = {};
  let tSec = performance.now();
  const lap = (k) => {
    const t = performance.now();
    ms[k] = Math.round(t - tSec);
    tSec = t;
  };
  counts.ms = ms;
  const clear = new ClearMask();
  const g2 = [0, 0];
  // lake-site landmarks without a clear radius still keep their footprint free of trees
  // ghost trees belong on the lake shores and the river banks, not on the canyon's red ledges
  const onCanyonLedge = (x, z, h) => {
    if (h < 6 || typeof ctx.canyonDistance !== 'function') return false;
    const c = ctx.canyonDistance(x, z);
    return c.d < 240 && c.t < 0.93;
  };
  const lakeSites = ['observatory'].map((id) => L.LANDMARK_BY_ID[id]).filter(Boolean);
  const nearLakeSite = (x, z, m) => {
    for (const s of lakeSites) if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.radius + m) ** 2) return true;
    return false;
  };

  // ---- giants ----------------------------------------------------------------------
  {
    const cand = [];
    const S = 50;
    for (let j = -64; j <= 64; j++) {
      for (let i = -64; i <= 64; i++) {
        const x = (i + hash(i, j, 901)) * S, z = (j + hash(i, j, 902)) * S;
        const r = Math.hypot(x, z);
        if (r > 3150) continue;
        const h = F.h(x, z);
        if (h < 5 || h > 470) continue;
        if (F.slope(x, z) > 0.1 || F.slope(x + 25, z) > 0.14 || F.slope(x - 25, z) > 0.14 || F.slope(x, z + 25) > 0.14 || F.slope(x, z - 25) > 0.14) continue;
        if (L.isReserved(x, z, 150) || nearLakeSite(x, z, 150)) continue;
        if (blockedByRock(x, z, 30)) continue;
        const f = F.forest(x, z);
        const cv = F.convexity(x, z);
        let score = hash(i, j, 903);
        if (f < 0.15) score += 0.3; // lone giant in open meadow
        score += 0.35 * sstep(0.1, 0.4, f) * (1 - sstep(0.6, 0.9, f)); // forest edge
        score += 0.3 * sstep(30, 8, h); // lake shore
        score += 0.35 * sstep(4, 16, cv); // hilltop
        cand.push([score, x, z, h]);
      }
    }
    cand.sort((a, b) => b[0] - a[0]);
    const want = q < 0.5 ? 18 : 28;
    const chosen = [];
    for (const c of cand) {
      if (chosen.length >= want) break;
      let ok = true;
      for (const o of chosen) if ((o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2 < 330 * 330) ok = false;
      if (ok) chosen.push(c);
    }
    for (let i = 0; i < chosen.length; i++) {
      const [, x, z] = chosen[i];
      const crown = hash(i, 7, 904) < 0.4;
      const kind = crown ? K.giantC : K.giantS;
      const s = 0.82 + 0.36 * hash(i, 8, 905);
      const y = ctx.heightAt(x, z) - kind.sink * s;
      kind.list.push(x, y, z, s, hash(i, 9, 906) * TAU, hash(i, 10, 907), 0, hash(i, 11, 908) < 0.2 ? 0.8 : 0.3 * hash(i, 12, 909));
      clear.add(x, z, 26 * s);
    }
    counts.giants = chosen.length;
    lap('giants');
  }

  // ---- forest: spire conifers (+ ghost trees in the lowland forest) -----------------
  {
    const S = ctx.profile === 'quest' ? 12 : 7.4;
    const n = Math.ceil(9200 / S);
    let spires = 0, ghosts = 0, aspens = 0, logs = 0;
    // the clearing noise on a 16 m grid (bilinear): read for ~1.5 M cells, far cheaper than simplex
    const CG = 16, cn = Math.ceil(9200 / CG) + 1;
    const clg = new Float32Array(cn * cn);
    for (let b = 0; b < cn; b++) for (let a = 0; a < cn; a++) clg[b * cn + a] = N.noise2((-4600 + a * CG) * 0.0105 + 3.1, (-4600 + b * CG) * 0.0105 - 7.7);
    const clearAt = sampler(clg, cn, -4600, CG);
    for (let j = 0; j < n; j++) {
      const z0 = -4600 + j * S;
      let skipTo = -1;
      for (let i = 0; i < n; i++) {
        if (i < skipTo) continue;
        const xc = -4600 + (i + 0.5) * S;
        if (F.forestMax(xc, z0) < 0.04) {
          // jump to the next 64 m block
          skipTo = Math.ceil(((Math.floor((xc + 4600) / 64) + 1) * 64) / S);
          continue;
        }
        const u = hash(i, j, 11);
        const x = -4600 + (i + hash(i, j, 12)) * S;
        const z = z0 + hash(i, j, 13) * S;
        const f = F.forest(x, z);
        if (f < 0.02) continue;
        let p = Math.pow(sstep(0.04, 0.55, f), 1.25) * 0.88;
        // clearings and glades inside the forest
        const cl = clearAt(x, z);
        // aspen groves (clonal, so they come in patches) on the forest margins and ringing the
        // clearings, where a conifer forest would regrow after a fall
        const margin = sstep(0.02, 0.16, f) * (1 - sstep(0.4, 0.7, f));
        const fringe = sstep(0.3, 0.44, cl) * (1 - sstep(0.52, 0.64, cl)) * sstep(0.3, 0.6, f);
        const ae = 0.75 * margin + 0.6 * fringe;
        if (ae > 0.02 && K.aspen) {
          const grove = sstep(0.18, 0.5, N.noise2(x * 0.0042 - 17.3, z * 0.0042 + 5.1));
          if (hash(i, j, 24) < ae * grove) {
            const wd = F.water(x, z);
            const h = F.h(x, z);
            if (wd > 25 && h > 2 && h < 650 && !clear.blocked(x, z) && !nearLakeSite(x, z, 10) && !blockedByRock(x, z, 2)) {
              const s = (0.72 + 0.45 * hash(i, j, 25)) * (0.85 + 0.3 * f) * (1 - 0.3 * sstep(400, 650, h));
              // whole groves turn together: fresh green, yellow-green or gold
              const gc = N.noise2(x * 0.0031 + 40.2, z * 0.0031 - 11.9);
              const c = Math.min(0.99, Math.max(0, 0.15 + 0.3 * sstep(-0.3, 0.3, gc) + 0.4 * sstep(0.3, 0.6, gc) + 0.16 * (hash(i, j, 26) - 0.5)));
              K.aspen.list.push(x, h - K.aspen.sink * s, z, s, hash(i, j, 27) * TAU, hash(i, j, 28), 0, c);
              aspens++;
              continue;
            }
          }
        }
        if (u > p) continue;
        const glade = sstep(0.4, 0.6, cl);
        p *= 1 - 0.92 * glade;
        if (u > p) {
          // the heart of a clearing: here and there the windthrown trunk that opened it
          if (K.log && glade > 0.7 && hash(i, j, 30) < 0.06) {
            const h = F.h(x, z);
            if (F.slope(x, z) < 0.3 && !clear.blocked(x, z) && !nearLakeSite(x, z, 20) && !L.isReserved(x, z, 20) && !blockedByRock(x, z, 6)) {
              F.grad(x, z, g2);
              const along = Math.atan2(g2[1], g2[0]) + Math.PI / 2 + (hash(i, j, 31) - 0.5) * 0.5;
              const s = 0.75 + 0.4 * hash(i, j, 32);
              K.log.list.push(x, h - K.log.sink * s, z, s, along, hash(i, j, 33), 0, hash(i, j, 34));
              logs++;
            }
          }
          continue;
        }
        const h = F.h(x, z);
        if (clear.blocked(x, z)) continue;
        if (nearLakeSite(x, z, 10)) continue;
        if (blockedByRock(x, z, 1.5)) continue;
        const v = hash(i, j, 14);
        const wd = F.water(x, z);
        const ghostShare = 0.7 * sstep(150, 30, wd) * sstep(60, 8, h);
        const yaw = hash(i, j, 15) * TAU;
        const seed = hash(i, j, 16);
        if (v < ghostShare && !onCanyonLedge(x, z, h)) {
          const s = 0.8 + 0.45 * hash(i, j, 17);
          F.grad(x, z, g2);
          const dh = Math.atan2(-g2[1], -g2[0]);
          K.ghost.list.push(x, h - K.ghost.sink * s, z, s, dh + (seed - 0.5) * 1.2, seed, 0, 0.5 * hash(i, j, 18));
          ghosts++;
          continue;
        }
        // taller in the interior, younger at the edges, shorter toward the tree line; stands of
        // different age (height) and hue (blue-green / olive) a few hundred metres across; a few
        // emergent veterans rise well above the canopy (a ragged skyline instead of a comb)
        const stand = N.noise2(x * 0.0042 + 13.1, z * 0.0042 - 6.4);
        const age = N.noise2(x * 0.0061 - 3.7, z * 0.0061 + 9.9);
        let s = (0.62 + 0.45 * sstep(0.1, 0.8, f)) * (0.8 + 0.4 * hash(i, j, 17)) * (0.88 + 0.24 * age);
        if (hash(i, j, 21) < 0.045 * f) s = Math.min(1.6, s * (1.28 + 0.2 * hash(i, j, 22)));
        s *= 1 - 0.35 * sstep(380, 720, h);
        const rust = hash(i, j, 19) < 0.015 + 0.025 * sstep(0.4, 0.7, stand);
        let c = rust ? 0.86 + 0.14 * hash(i, j, 20) : 0.3 + 0.24 * stand + 0.34 * (hash(i, j, 20) - 0.5);
        if (!rust) c -= 0.12 * sstep(250, 600, h);
        // crown base: trees deep in the forest have shed their lower tiers (bare trunks you can see
        // between); edge trees keep skirts to the ground. Interior = the thinnest forest nearby.
        const fi = Math.min(f, F.interior(x, z));
        let lift = Math.floor(sstep(0.4, 0.85, fi) * (0.5 + 0.5 * hash(i, j, 23)) * 7.99);
        // standing dead snags: a few everywhere, whole silver patches where a blight passed, more
        // toward the tree line
        const ud = hash(i, j, 29);
        if (ud < 0.14 && ud < 0.01 + 0.09 * sstep(0.52, 0.78, N.noise2(x * 0.0027 - 31.7, z * 0.0027 + 12.4)) + 0.04 * sstep(450, 700, h)) lift = 15;
        K.spire.list.push(x, h - K.spire.sink * s, z, s, yaw, seed, 0, lift + Math.max(0, c));
        spires++;
      }
    }
    counts.spires = spires;
    counts.aspens = aspens;
    counts.logs = logs;
    counts.forestGhosts = ghosts;
    lap('forest');
  }

  // ---- parasol pines: groves on ridges and hilltops ---------------------------------------
  {
    const S = 24;
    const n = Math.ceil(8000 / S);
    let c = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = hash(i, j, 31);
        if (u > 0.5) continue;
        const x = -4000 + (i + hash(i, j, 32)) * S, z = -4000 + (j + hash(i, j, 33)) * S;
        const h = F.h(x, z);
        if (h < 18 || h > 640) continue;
        const f = F.forest(x, z);
        if (f > 0.7) continue;
        const cv = F.convexity(x, z);
        const grove = sstep(-0.15, 0.35, N.noise2(x * 0.0023 + 1.7, z * 0.0023 - 4.2));
        let p = 0.5 * sstep(1.5, 12, cv) * (1 - 0.75 * f) * grove + 0.07 * sstep(0.12, 0.35, f) * (1 - sstep(0.4, 0.7, f));
        p *= 1 - sstep(0.22, 0.34, F.slope(x, z));
        if (u > p) continue;
        if (L.isReserved(x, z, 25) || clear.blocked(x, z) || nearLakeSite(x, z, 20)) continue;
        if (blockedByRock(x, z, 4)) continue;
        const s = 0.78 + 0.42 * hash(i, j, 34);
        const col = hash(i, j, 35) < 0.05 ? 0.9 : 0.15 + 0.5 * hash(i, j, 36);
        K.parasol.list.push(x, h - K.parasol.sink * s, z, s, hash(i, j, 37) * TAU, hash(i, j, 38), 0, col);
        c++;
      }
    }
    counts.parasols = c;
    lap('parasol');
  }

  // ---- ghost trees on the shores (and around ponds) -------------------------------------
  {
    const S = 10;
    const n = Math.ceil(8400 / S);
    let c = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = hash(i, j, 41);
        if (u > 0.5) continue;
        if (F.waterNear(-4200 + (i + 0.5) * S, -4200 + (j + 0.5) * S) > 125) continue;
        const x = -4200 + (i + hash(i, j, 42)) * S, z = -4200 + (j + hash(i, j, 43)) * S;
        const wd = F.water(x, z);
        if (wd < 4 || wd > 110) continue;
        const h = F.h(x, z);
        if (h < 1.2 || h > 90) continue;
        const clump = sstep(-0.25, 0.4, N.noise2(x * 0.006 - 2.3, z * 0.006 + 8.1));
        const p = 0.5 * sstep(110, 12, wd) * clump * (1 - 0.6 * F.forest(x, z)) * (1 - sstep(0.4, 0.62, F.slope(x, z)));
        if (u > p) continue;
        if (L.isReserved(x, z, 10) || clear.blocked(x, z) || nearLakeSite(x, z, 10) || onCanyonLedge(x, z, h)) continue;
        if (blockedByRock(x, z, 3)) continue;
        const s = 0.75 + 0.5 * hash(i, j, 44);
        F.grad(x, z, g2);
        const dh = Math.atan2(-g2[1], -g2[0]);
        const seed = hash(i, j, 45);
        K.ghost.list.push(x, h - K.ghost.sink * s, z, s, dh + (seed - 0.5) * 0.9, seed, 0, hash(i, j, 46) < 0.15 ? 0.85 : 0.45 * hash(i, j, 47));
        c++;
      }
    }
    counts.shoreGhosts = c;
    lap('ghost');
  }

  // ---- lone trees and copses in the open meadows ------------------------------------------
  {
    const S = 34;
    const n = Math.ceil(7600 / S);
    let c = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = hash(i, j, 71);
        if (u > 0.3) continue;
        const x = -3800 + (i + hash(i, j, 72)) * S, z = -3800 + (j + hash(i, j, 73)) * S;
        const f = F.forest(x, z);
        if (f > 0.3) continue;
        const h = F.h(x, z);
        if (h < 2 || h > 600) continue;
        const copse = sstep(0.05, 0.55, N.noise2(x * 0.0047 + 21.3, z * 0.0047 - 8.8));
        const p = (0.035 + 0.26 * copse) * (1 - sstep(0.26, 0.4, F.slope(x, z)));
        if (u > p) continue;
        if (L.isReserved(x, z, 20) || clear.blocked(x, z) || nearLakeSite(x, z, 10)) continue;
        if (blockedByRock(x, z, 3)) continue;
        // a copse: 1..6 conifers huddled together
        const m = 1 + Math.floor(copse * 5.5 * hash(i, j, 74));
        for (let k = 0; k < m; k++) {
          const a = hash(i * 7 + k, j, 75) * TAU, r = k === 0 ? 0 : 3 + 7 * hash(i * 7 + k, j, 76);
          const xx = x + Math.cos(a) * r, zz = z + Math.sin(a) * r;
          const hh = F.h(xx, zz);
          const s = (0.55 + 0.4 * hash(i * 7 + k, j, 77)) * (1 - 0.35 * sstep(380, 720, hh));
          const col = hash(i * 7 + k, j, 78) < 0.05 ? 0.9 : 0.2 + 0.45 * hash(i * 7 + k, j, 79);
          K.spire.list.push(xx, hh - K.spire.sink * s, zz, s, hash(i * 7 + k, j, 80) * TAU, hash(i * 7 + k, j, 81), 0, col);
          c++;
        }
      }
    }
    counts.meadowTrees = c;
    lap('meadow');
  }

  // ---- shrubs ------------------------------------------------------------------------------
  {
    const S = 8;
    const R = 3950;
    const n = Math.ceil((2 * R) / S);
    let c = 0;
    const dens = 0.55 + 0.45 * q;
    for (let j = 0; j < n; j++) {
      const z = -R + (j + 0.5) * S;
      for (let i = 0; i < n; i++) {
        const u = hash(i, j, 51);
        if (u > 0.47) continue;
        const x = -R + (i + hash(i, j, 52)) * S;
        const zz = z + (hash(i, j, 53) - 0.5) * S;
        if (x * x + zz * zz > R * R) continue;
        const f = F.forest(x, zz);
        const edge = 4 * f * (1 - f);
        let p = (0.026 + 0.29 * edge + 0.065 * f) * dens;
        if (u > p + 0.08) continue;
        const m = F.meadow(x, zz);
        p += 0.065 * m * (1 - f);
        const clump = sstep(-0.3, 0.5, N.noise2(x * 0.017 + 5.5, zz * 0.017 - 1.3));
        p *= 0.35 + 0.9 * clump;
        if (u > p) continue;
        const h = F.h(x, zz);
        if (h < 1.2 || h > 820) continue;
        if (F.slope(x, zz) > 0.42) continue;
        if (L.isReserved(x, zz, 8) || nearLakeSite(x, zz, 5) || blockedByRock(x, zz, 0.5)) continue;
        const s = 0.6 + 0.8 * hash(i, j, 54) * (0.6 + 0.4 * f);
        const dry = 0.78 - m + 0.5 * N.noise2(x * 0.004, zz * 0.004);
        let col = 0.4 * hash(i, j, 55);
        if (dry > 0.45 && hash(i, j, 56) < 0.55) col = 0.62 + 0.38 * hash(i, j, 57); // heather / rust scrub
        K.shrub.list.push(x, h - K.shrub.sink * s, zz, s, hash(i, j, 58) * TAU, hash(i, j, 59), 0, col);
        c++;
      }
    }
    counts.shrubs = c;
    lap('shrub');
  }

  // ---- reeds at the waterline (lake, river, ponds) ------------------------------------------
  {
    let c = 0;
    const ponds = Array.isArray(ctx.water?.ponds) ? ctx.water.ponds : [];
    const levelAt = (x, z) => {
      for (const p of ponds) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + 14) ** 2) return p.level;
      return 0;
    };
    const RW = F.raw;
    const rn = RW.n, rs = RW.step;
    for (let j = 1; j < rn - 1; j++) {
      const z0 = RW.x0 + j * rs;
      for (let i = 1; i < rn - 1; i++) {
        const kk = j * rn + i;
        if (RW.W[kk] > 16) continue;
        const hc = RW.H[kk];
        if (hc < -3 || hc > 40) continue;
        const x0 = RW.x0 + i * rs;
        const clump = N.noise2(x0 * 0.013 + 9.1, z0 * 0.013 - 3.3);
        if (clump < -0.45) continue;
        const lvl0 = levelAt(x0, z0);
        if (hc < lvl0 - 3 || hc > lvl0 + 4) continue;
        // the lake bowl is steep, so the reed band is only a few metres wide: many candidates
        for (let k = 0; k < 9; k++) {
          const u = hash(i * 9 + k, j, 61);
          if (u > 0.8 * sstep(-0.45, 0.15, clump) * (0.6 + 0.4 * q)) continue;
          const x = x0 + (hash(i * 9 + k, j, 62) - 0.5) * rs, z = z0 + (hash(i * 9 + k, j, 63) - 0.5) * rs;
          const ha = F.h(x, z);
          if (ha < lvl0 - 2 || ha > lvl0 + 2.2) continue;
          const h = ctx.heightAt(x, z);
          const lvl = lvl0;
          if (h < lvl - 1.1 || h > lvl + 1.0) continue;
          if (F.slope(x, z) > 0.5) continue;
          if (L.isReserved(x, z, 0) || nearLakeSite(x, z, 30)) continue;
          if (blockedByRock(x, z, 1)) continue;
          const s = 0.7 + 0.55 * hash(i * 9 + k, j, 64);
          K.reed.list.push(x, h - 0.1, z, s, hash(i * 9 + k, j, 65) * TAU, hash(i * 9 + k, j, 66), 0, hash(i * 9 + k, j, 67));
          c++;
        }
      }
    }
    counts.reeds = c;
    lap('reed');
  }
  return counts;
}

/**
 * Ground-cover densities (0..1) for the camera-following grass / flowers / ferns.
 * Returns an object with density functions sharing one lookup per point.
 */
export function groundDensity(ctx, F) {
  const N = ctx.noise.worldNoise;
  const L = ctx.layout;
  // landmark clear zones: no ground cover in the inner 70 % (plazas, foundations), fading back in
  const sites = L.LANDMARKS.filter((s) => s.clear > 0);
  const lakeSites = ['observatory', 'stair'].map((id) => L.LANDMARK_BY_ID[id]).filter(Boolean);
  const out = { grass: 0, flower: 0, fern: 0, dry: 0, h: 0, flowerCol: 0 };
  return (x, z) => {
    const h = F.h(x, z);
    out.h = h;
    out.grass = out.flower = out.fern = 0;
    if (h < 0.6) return out;
    let res = 1;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const d = Math.sqrt((x - s.x) ** 2 + (z - s.z) ** 2) / s.clear;
      if (d < 1.1) res = Math.min(res, sstep(0.72, 1.05, d));
    }
    for (const s of lakeSites) {
      const d = Math.sqrt((x - s.x) ** 2 + (z - s.z) ** 2);
      if (d < s.radius) res = Math.min(res, sstep(s.radius * 0.6, s.radius, d));
    }
    if (res <= 0) return out;
    const f = F.forest(x, z);
    const m = F.meadow(x, z);
    const sl = F.slope(x, z);
    const slopeK = 1 - sstep(0.24, 0.42, sl);
    const alt = 1 - sstep(700, 950, h);
    const shore = sstep(0.6, 1.8, h);
    const patch = N.noise2(x * 0.061 + 1.3, z * 0.061 - 2.9);
    const base = res * slopeK * alt * shore;
    out.grass = base * (0.5 + 0.5 * m) * (1 - 0.88 * sstep(0.25, 0.75, f)) * sstep(-0.55, 0.05, patch);
    const dry = 0.78 - m + 0.45 * N.noise2(x * 0.0019 + 0.31, z * 0.0019) + 0.2 * sstep(0.06, 0.2, sl);
    out.dry = dry < 0 ? 0 : dry > 1 ? 1 : dry;
    const fl = N.noise2(x * 0.021 - 4.1, z * 0.021 + 6.2);
    out.flower = base * sstep(0.1, 0.45, fl) * (1 - out.dry) * (1 - sstep(0.1, 0.5, f));
    out.flowerCol = 0.5 + 0.55 * N.noise2(x * 0.009 + 12.5, z * 0.009 - 3.1);
    out.fern = base * sstep(0.15, 0.6, f) * sstep(-0.3, 0.3, patch + 0.3 * N.noise2(x * 0.03, z * 0.03));
    return out;
  };
}
