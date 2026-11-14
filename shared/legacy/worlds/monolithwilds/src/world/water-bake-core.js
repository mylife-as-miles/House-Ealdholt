// The water bakes proper, free of three.js so they can run in a worker (water-bake-worker.js) as
// well as on the main thread. See water-bake.js for what the maps hold.

import { CANYON, LAKE } from '../core/layout.js';

const INF = 1e20;

/** Bilinear sampler over a terrain-style world grid { data, n, x0, z0, step } (or null). */
export function createCoarseSampler(heightAt, g) {
  if (g && g.data && g.n) {
    const { data, n, x0, z0, step } = g;
    const inv = 1 / step;
    const sample = (x, z) => {
      let fx = (x - x0) * inv;
      let fz = (z - z0) * inv;
      if (fx < 0) fx = 0;
      else if (fx > n - 1.001) fx = n - 1.001;
      if (fz < 0) fz = 0;
      else if (fz > n - 1.001) fz = n - 1.001;
      const i = fx | 0;
      const j = fz | 0;
      const tx = fx - i;
      const tz = fz - j;
      const o = j * n + i;
      const a = data[o] + (data[o + 1] - data[o]) * tx;
      const b = data[o + n] + (data[o + n + 1] - data[o + n]) * tx;
      return a + (b - a) * tz;
    };
    return { sample, grid: g, fromTerrain: true, calls: 0 };
  }
  // Fallback: our own grid over the basin (lake, canyon, the land between them and the falls).
  const step = 24;
  const x0 = -2600;
  const z0 = -3400;
  const nx = Math.ceil((3300 - x0) / step) + 1;
  const nz = Math.ceil((1600 - z0) / step) + 1;
  const data = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) data[j * nx + i] = heightAt(x0 + i * step, z0 + j * step);
  }
  const inv = 1 / step;
  const sample = (x, z) => {
    const fx = (x - x0) * inv;
    const fz = (z - z0) * inv;
    if (fx < 0 || fz < 0 || fx > nx - 1.001 || fz > nz - 1.001) return heightAt(x, z);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const o = j * nx + i;
    const a = data[o] + (data[o + 1] - data[o]) * tx;
    const b = data[o + nx] + (data[o + nx + 1] - data[o + nx]) * tx;
    return a + (b - a) * tz;
  };
  return { sample, grid: null, fromTerrain: false, calls: nx * nz, own: { data, nx, nz, x0, z0, step } };
}

// ---------------------------------------------------------------------------------------------
// canyon polyline helpers (arc length, smooth tangent)
// ---------------------------------------------------------------------------------------------
const segs = [];
let canyonLen = 0;
for (let i = 0; i < CANYON.length - 1; i++) {
  const [ax, az] = CANYON[i];
  const [bx, bz] = CANYON[i + 1];
  const len = Math.hypot(bx - ax, bz - az);
  segs.push({ ax, az, bx, bz, len, s0: canyonLen });
  canyonLen += len;
}
function pointAt(s, out) {
  s = Math.max(0, Math.min(canyonLen, s));
  for (const g of segs) {
    if (s <= g.s0 + g.len) {
      const t = (s - g.s0) / g.len;
      out[0] = g.ax + (g.bx - g.ax) * t;
      out[1] = g.az + (g.bz - g.az) * t;
      return out;
    }
  }
  out[0] = CANYON[CANYON.length - 1][0];
  out[1] = CANYON[CANYON.length - 1][1];
  return out;
}
const _pa = [0, 0];
const _pb = [0, 0];
/** Nearest point on the canyon: returns [distance, arc length s]. */
function canyonNearest(x, z, out) {
  let best = INF;
  let bs = 0;
  for (const g of segs) {
    const dx = g.bx - g.ax;
    const dz = g.bz - g.az;
    let t = ((x - g.ax) * dx + (z - g.az) * dz) / (g.len * g.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = g.ax + dx * t - x;
    const pz = g.az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) {
      best = d;
      bs = g.s0 + t * g.len;
    }
  }
  out[0] = Math.sqrt(best);
  out[1] = bs;
  return out;
}

// ---------------------------------------------------------------------------------------------

export function bakeWaterCore(heightAt, hs, cstep, { step = 5, margin = 100 } = {}) {
  const t0 = performance.now();

  // 1. extent of everything below the waterline (coarse scan at 20 m)
  let minx = INF;
  let maxx = -INF;
  let minz = INF;
  let maxz = -INF;
  for (let z = -4400; z <= 4400; z += 20) {
    for (let x = -4400; x <= 4400; x += 20) {
      if (hs(x, z) < 1.5) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (z < minz) minz = z;
        if (z > maxz) maxz = z;
      }
    }
  }
  if (minx > maxx) {
    // no water at all (should not happen): a token map around the lake
    minx = LAKE.x - 100;
    maxx = LAKE.x + 100;
    minz = LAKE.z - 100;
    maxz = LAKE.z + 100;
  }
  const TS = 16; // tile size (texels)
  const x0 = Math.floor((minx - margin) / step) * step;
  const z0 = Math.floor((minz - margin) / step) * step;
  const ntx = Math.ceil((Math.ceil((maxx + margin - x0) / step) + 1) / TS);
  const ntz = Math.ceil((Math.ceil((maxz + margin - z0) / step) + 1) / TS);
  const nx = ntx * TS;
  const nz = ntz * TS;
  const N = nx * nz;

  // 2. tiles: most of the rectangle (the canyon runs 4 km north) is dry land far above the water.
  //    A tile is active when the coarse ground anywhere in or around it comes near the waterline;
  //    only active tiles are baked, dry ones get constants (ground high above, far from shore).
  const DRY = 14;
  const active = new Uint8Array(ntx * ntz);
  const tm = TS * step; // tile size in metres
  for (let tj = 0; tj < ntz; tj++) {
    for (let ti = 0; ti < ntx; ti++) {
      let lo = INF;
      // 5 x 5 samples over the tile grown by half a tile on every side (steep walls, coarse error)
      for (let b = 0; b <= 4 && lo >= DRY; b++) {
        for (let a = 0; a <= 4; a++) {
          const h = hs(x0 + (ti - 0.5 + a * 0.5) * tm, z0 + (tj - 0.5 + b * 0.5) * tm);
          if (h < lo) lo = h;
        }
      }
      active[tj * ntx + ti] = lo < DRY ? 1 : 0;
    }
  }
  // active tile columns per tile row (the loops below run in raster order over these spans only)
  const rowTiles = [];
  let activeTiles = 0;
  for (let tj = 0; tj < ntz; tj++) {
    const list = [];
    for (let ti = 0; ti < ntx; ti++) if (active[tj * ntx + ti]) list.push(ti);
    rowTiles.push(list);
    activeTiles += list.length;
  }

  // 3. heights: exact near the waterline, coarse elsewhere. A texel is refined when the coarse
  //    cell around it (min/max of its corners) straddles the waterline band; steep canyon walls
  //    straddle it whatever the bilinear value says.
  const height = new Float32Array(N).fill(DRY + 6);
  const cn = Math.max(1, Math.ceil(cstep / step));
  let calls = 0;
  const cornerRow0 = new Float32Array(TS / cn + 3);
  const cornerRow1 = new Float32Array(TS / cn + 3);
  for (let tj = 0; tj < ntz; tj++) {
    const rt1 = rowTiles[tj];
    for (let q = 0; q < rt1.length; q++) {
      const ti = rt1[q];
      const i0 = ti * TS;
      const j0 = tj * TS;
      // coarse cells of cn x cn texels inside the tile
      for (let cj = 0; cj < TS; cj += cn) {
        const za = z0 + (j0 + cj) * step;
        const zb = za + cn * step;
        for (let ci = 0, c = 0; ci <= TS; ci += cn, c++) {
          const x = x0 + (i0 + ci) * step;
          cornerRow0[c] = hs(x, za);
          cornerRow1[c] = hs(x, zb);
        }
        for (let ci = 0, c = 0; ci < TS; ci += cn, c++) {
          const a = cornerRow0[c];
          const b = cornerRow0[c + 1];
          const d = cornerRow1[c];
          const e = cornerRow1[c + 1];
          const refine = Math.min(a, b, d, e) < 3 && Math.max(a, b, d, e) > -5;
          // steep cells (canyon walls): only the texels whose coarse height is near the waterline
          const steep = Math.max(a, b, d, e) - Math.min(a, b, d, e) > 8;
          const jEnd = Math.min(TS, cj + cn);
          const iEnd = Math.min(TS, ci + cn);
          for (let jj = cj; jj < jEnd; jj++) {
            const z = z0 + (j0 + jj) * step;
            const row = (j0 + jj) * nx + i0;
            const tz = (jj - cj) / cn;
            for (let ii = ci; ii < iEnd; ii++) {
              const x = x0 + (i0 + ii) * step;
              // bilinear from the cell corners (same as the coarse sampler, no call)
              const tx = (ii - ci) / cn;
              const top = a + (b - a) * tx;
              const bot = d + (e - d) * tx;
              const hc = top + (bot - top) * tz;
              if (refine && (!steep || (hc < 6 && hc > -8))) {
                height[row + ii] = heightAt(x, z);
                calls++;
              } else height[row + ii] = hc;
            }
          }
        }
      }
    }
  }
  const tHeights = performance.now();

  // 4. signed distance to the shoreline (metres, > 0 over water): two-pass chamfer seeded with the
  //    texels on the waterline (sub-texel distance to the zero crossing), in raster order over the
  //    active spans (a wet texel's nearest shore point is reached through water, i.e. through
  //    active tiles). The seeding runs inside the forward pass, the sign inside the backward one.
  const dist = new Float32Array(N).fill(1e9);
  const sdf = new Float32Array(N).fill(-250);
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let j = 0; j < nz; j++) {
    const tiles = rowTiles[(j / TS) | 0];
    for (let q = 0; q < tiles.length; q++) {
      const iEnd = tiles[q] * TS + TS;
      for (let i = tiles[q] * TS; i < iEnd; i++) {
        const k = j * nx + i;
        const h = height[k];
        let d = 1e9;
        const w = h < 0;
        if ((i > 0 && height[k - 1] < 0 !== w) || (i < nx - 1 && height[k + 1] < 0 !== w) ||
          (j > 0 && height[k - nx] < 0 !== w) || (j < nz - 1 && height[k + nx] < 0 !== w)) {
          let g = 0;
          if (i > 0) g = Math.max(g, Math.abs(h - height[k - 1]));
          if (i < nx - 1) g = Math.max(g, Math.abs(h - height[k + 1]));
          if (j > 0) g = Math.max(g, Math.abs(h - height[k - nx]));
          if (j < nz - 1) g = Math.max(g, Math.abs(h - height[k + nx]));
          d = g > 1e-4 ? Math.min(1, Math.abs(h) / g) : 0.5;
        }
        if (i > 0 && dist[k - 1] + D1 < d) d = dist[k - 1] + D1;
        if (j > 0) {
          if (dist[k - nx] + D1 < d) d = dist[k - nx] + D1;
          if (i > 0 && dist[k - nx - 1] + D2 < d) d = dist[k - nx - 1] + D2;
          if (i < nx - 1 && dist[k - nx + 1] + D2 < d) d = dist[k - nx + 1] + D2;
        }
        dist[k] = d;
      }
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    const tiles = rowTiles[(j / TS) | 0];
    for (let t = tiles.length - 1; t >= 0; t--) {
      const ti = tiles[t];
      for (let i = ti * TS + TS - 1; i >= ti * TS; i--) {
        const k = j * nx + i;
        let d = dist[k];
        if (i < nx - 1 && dist[k + 1] + D1 < d) d = dist[k + 1] + D1;
        if (j < nz - 1) {
          if (dist[k + nx] + D1 < d) d = dist[k + nx] + D1;
          if (i < nx - 1 && dist[k + nx + 1] + D2 < d) d = dist[k + nx + 1] + D2;
          if (i > 0 && dist[k + nx - 1] + D2 < d) d = dist[k + nx - 1] + D2;
        }
        dist[k] = d;
        const sd = (height[k] < 0 ? d : -d) * step;
        sdf[k] = sd > 250 ? 250 : sd < -250 ? -250 : sd;
      }
    }
  }
  const tSdf = performance.now();

  // 5. river flow along the canyon (downstream = toward the lake), a plume into the lake.
  //    Evaluated on a 16 m lattice (the polyline queries are the slow part) and interpolated;
  //    the per-texel shore distance then slows the current along the banks.
  const near = [0, 0];
  const mouth = CANYON[CANYON.length - 1];
  const last = CANYON[CANYON.length - 2];
  let mdx = mouth[0] - last[0];
  let mdz = mouth[1] - last[1];
  const ml = Math.hypot(mdx, mdz);
  mdx /= ml;
  mdz /= ml;
  const S = 4;
  const lnx = nx / S + 1;
  const lnz = nz / S + 1;
  const lfx = new Float32Array(lnx * lnz);
  const lfz = new Float32Array(lnx * lnz);
  for (let lj = 0; lj < lnz; lj++) {
    for (let li = 0; li < lnx; li++) {
      const i = Math.min(nx - 1, li * S);
      const j = Math.min(nz - 1, lj * S);
      if (!active[((j / TS) | 0) * ntx + ((i / TS) | 0)] || height[j * nx + i] > 12) continue;
      const x = x0 + li * S * step;
      const z = z0 + lj * S * step;
      canyonNearest(x, z, near);
      const d = near[0];
      const s = near[1];
      const tt = s / canyonLen;
      let fx = 0;
      let fz = 0;
      if (d < 260 && tt < 0.995) {
        // smooth tangent: chord over +-90 m of arc length
        pointAt(s - 90, _pa);
        pointAt(s + 90, _pb);
        let tx = _pb[0] - _pa[0];
        let tz = _pb[1] - _pa[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // faster in the narrows, slack toward the mouth
        const sp = 1.5 * (1 - 0.75 * smooth(0.82, 1.0, tt)) * (1 - smooth(200, 260, d));
        fx = tx * sp;
        fz = tz * sp;
      }
      // plume spreading into the Mirror from the canyon mouth
      const pmx = x - mouth[0];
      const pmz = z - mouth[1];
      const pd = Math.hypot(pmx, pmz);
      if (pd < 520 && Math.abs(fx) + Math.abs(fz) < 0.05) {
        const fall = Math.exp(-pd / 170) * 0.5 * smooth(520, 300, pd);
        fx += (mdx * 0.6 + (pmx / (pd + 1)) * 0.4) * fall;
        fz += (mdz * 0.6 + (pmz / (pd + 1)) * 0.4) * fall;
      }
      lfx[lj * lnx + li] = fx;
      lfz[lj * lnx + li] = fz;
    }
  }
  const tFlow = performance.now();

  // 6. pack into an RGBA half-float texture (dry tiles: one constant texel)
  const px = new Uint16Array(N * 4);
  const hDry = toHalf(DRY + 6);
  const sDry = toHalf(-250);
  for (let o = 0; o < N * 4; o += 4) {
    px[o] = hDry;
    px[o + 1] = sDry;
  }
  // (the flow is interpolated from the lattice right here: no full-size flow arrays)
  for (let j = 0; j < nz; j++) {
    const fj = j / S;
    const lj = Math.min(lnz - 2, fj | 0);
    const tz = fj - lj;
    const tiles = rowTiles[(j / TS) | 0];
    for (let q = 0; q < tiles.length; q++) {
      const i0 = tiles[q] * TS;
      for (let i = i0; i < i0 + TS; i++) {
        const k = j * nx + i;
        const o4 = k * 4;
        const h = height[k];
        px[o4] = toHalf(h);
        px[o4 + 1] = toHalf(sdf[k]);
        px[o4 + 2] = 0;
        px[o4 + 3] = 0;
        if (h >= 0) continue;
        const fi = i / S;
        const li = Math.min(lnx - 2, fi | 0);
        const tx = fi - li;
        const o = lj * lnx + li;
        if (lfx[o] === 0 && lfx[o + 1] === 0 && lfx[o + lnx] === 0 && lfx[o + lnx + 1] === 0 &&
          lfz[o] === 0 && lfz[o + 1] === 0 && lfz[o + lnx] === 0 && lfz[o + lnx + 1] === 0) continue;
        const bank = smooth(0, 38, sdf[k]);
        const ax = lfx[o] + (lfx[o + 1] - lfx[o]) * tx;
        const bx = lfx[o + lnx] + (lfx[o + lnx + 1] - lfx[o + lnx]) * tx;
        const az = lfz[o] + (lfz[o + 1] - lfz[o]) * tx;
        const bz = lfz[o + lnx] + (lfz[o + lnx + 1] - lfz[o + lnx]) * tx;
        px[o4 + 2] = toHalf((ax + (bx - ax) * tz) * bank);
        px[o4 + 3] = toHalf((az + (bz - az) * tz) * bank);
      }
    }
  }
  return {
    x0,
    z0,
    nx,
    nz,
    step,
    TS,
    ntx,
    ntz,
    active,
    height,
    sdf,
    px,
    stats: {
      texels: N,
      activeTexels: activeTiles * TS * TS,
      calls,
      ms: {
        heights: Math.round(tHeights - t0),
        sdf: Math.round(tSdf - tHeights),
        flow: Math.round(tFlow - tSdf),
        pack: Math.round(performance.now() - tFlow),
      },
    },
  };
}

// float -> half (truncating, denormals flushed): much faster than a table call per texel
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
export function toHalf(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | ((x & 0x7fffff) >>> 13);
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
