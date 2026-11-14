// Terrain bakes for the water module.
//
//   createCoarseSampler(ctx)   fast bilinear ground height: the terrain module's world grid when it
//                              exists (free), otherwise a 24 m heightAt grid of the water basin.
//   bakeWaterData(ctx, coarse) the water map over every place below y = 0 (the Mirror + the canyon
//                              river) at 4 m, baked only in 64 m tiles that come near the waterline
//                              (dry tiles hold constants): RGBA half-float
//                                R  ground height (m)       -> depth, absorption, shoreline fade
//                                G  signed distance to the shore (m, > 0 over water) -> foam lines
//                                BA river flow (m/s)         -> advected ripples / foam streaks
//                              Only texels near the waterline call heightAt (min/max of the coarse
//                              cell straddles it); the rest are bilinear from the coarse grid.
//   bakeWorldHeight(ctx, coarse)  single-channel world height texture (+-4600 m) that the surface
//                              shader ray-marches for reflections of shores, cliffs and mountains.

import * as THREE from 'crownfall-world-three';
import { createCoarseSampler as coreSampler, bakeWaterCore, toHalf } from './water-bake-core.js';

export function createCoarseSampler(ctx) {
  return coreSampler(ctx.heightAt, ctx.terrain?.grid);
}

/** Wrap the plain bake result: the data texture, its transform and a ground-height query. */
function wrapBake(r, hs) {
  const { x0, z0, nx, nz, step, TS, ntx, active, height } = r;
  const tex = new THREE.DataTexture(r.px, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'water-data';
  tex.needsUpdate = true;
  // uv = (xz - origin) * inv + half texel (texel centres sit on the sample points)
  const xf = new THREE.Vector4(x0 - step * 0.5, z0 - step * 0.5, 1 / (nx * step), 1 / (nz * step));
  return {
    tex,
    xf,
    x0,
    z0,
    nx,
    nz,
    step,
    height,
    sdf: r.sdf,
    /** bilinear ground height from the bake (exact near the shore; coarse over dry tiles) */
    groundAt(x, z) {
      const fx = (x - x0) / step;
      const fz = (z - z0) / step;
      if (fx < 0 || fz < 0 || fx > nx - 1.001 || fz > nz - 1.001) return hs(x, z);
      const i = fx | 0;
      const jj = fz | 0;
      if (!active[((jj / TS) | 0) * ntx + ((i / TS) | 0)]) return hs(x, z);
      const tx = fx - i;
      const tz = fz - jj;
      const o = jj * nx + i;
      const a = height[o] + (height[o + 1] - height[o]) * tx;
      const b = height[o + nx] + (height[o + nx + 1] - height[o + nx]) * tx;
      return a + (b - a) * tz;
    },
    stats: r.stats,
  };
}

function coarseStep(coarse) {
  return coarse.grid ? coarse.grid.step : coarse.own ? coarse.own.step : 24;
}

/** The water map, baked on this thread. */
export function bakeWaterData(ctx, coarse, opts) {
  return wrapBake(bakeWaterCore(ctx.heightAt, coarse.sample, coarseStep(coarse), opts), coarse.sample);
}

/**
 * The water map, baked in a worker while the main thread builds the falls and streams.
 * Returns { result: Promise, started(): boolean, local() }: once the main thread is free it asks
 * started() — a worker already computing is awaited, one still loading its modules (slow on a dev
 * server or a busy machine) is dropped and local() bakes on the main thread instead. Any worker
 * failure also falls back to the main thread.
 */
export function bakeWaterDataAsync(ctx, coarse) {
  let worker = null;
  try {
    worker = new Worker(new URL('./water-bake-worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  ctx.onDispose?.(() => { worker?.terminate(); worker = null; });
  let started = false;
  let settled = false;
  let resolveFn;
  const result = new Promise((r) => (resolveFn = r));
  const finish = (value) => {
    if (settled) return;
    settled = true;
    worker?.terminate();
    resolveFn(value);
  };
  const local = () => {
    if (!settled) finish(Object.assign(bakeWaterData(ctx, coarse), { by: 'main' }));
    return result;
  };
  if (!worker) {
    return { result, started: () => false, local };
  }
  worker.onmessage = (e) => {
    const d = e.data;
    if (d?.started) {
      started = true;
      return;
    }
    if (!d?.ok) {
      if (ctx.params.debug) console.warn('[water] bake worker failed:', d?.error);
      local();
      return;
    }
    finish(Object.assign(wrapBake(d.r, coarse.sample), { by: 'worker' }));
  };
  worker.onerror = (e) => {
    if (ctx.params.debug) console.warn('[water] bake worker error:', e.message);
    local();
  };
  const g = coarse.grid;
  const grid = g ? { data: g.data.slice(), n: g.n, x0: g.x0, z0: g.z0, step: g.step } : null;
  worker.postMessage({ grid }, grid ? [grid.data.buffer] : []);
  return { result, started: () => started || settled, local };
}

/** World height texture for reflection ray-marching (R channel, half float). */
export function bakeWorldHeight(ctx, coarse) {
  let data;
  let n;
  let x0;
  let step;
  const g = coarse.grid;
  if (g) {
    ({ data, n, x0, step } = g);
  } else {
    // coarse 36 m grid over the whole world (fallback path only)
    n = 257;
    x0 = -4600;
    step = 9200 / (n - 1);
    data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = coarse.sample(x0 + i * step, x0 + j * step);
  }
  const px = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) px[k] = toHalf(data[k]);
  const tex = new THREE.DataTexture(px, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'water-world-height';
  tex.needsUpdate = true;
  const xf = new THREE.Vector4(x0 - step * 0.5, x0 - step * 0.5, 1 / (n * step), 1 / (n * step));
  return { tex, xf };
}
