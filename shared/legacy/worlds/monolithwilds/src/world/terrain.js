// Terrain module: chunked, geomorphing quadtree LOD over the whole world (and the far mountain
// ring beyond it) + a procedural world-space ground shader.
//
// Build pipeline (all heavy work runs in module workers, see terrain-worker.js):
//   1. world grid: heightAt() on 1025² samples (8.98 m) over ±4600 m, split across workers
//   2. world maps: far normals, forest/meadow (same fields vegetation uses), sandstone share,
//      multi-scale cavity, drainage (MFD flow accumulation), talus aprons
//   3. sun visibility: heightfield shadow sweep for the current sun (recomputed on hour change)
//   4. LOD: chunks near the camera are refined (fine levels only compute samples the world grid
//      lacks); later refinement streams in over frames without main-thread hitches.
//
// Publishes ctx.terrain for other modules:
//   heightApprox(x,z)     fast bilinear height from the world grid (approximate)
//   lightVisibility(x,z)  0..1 basin-wide mountain shadow of the key light (sun / moon)
//   grid                  { data: Float32Array, n, x0, z0, step }  world height grid (±4600 m, 8.98 m)
//   maps                  { A, B, sun } DataTextures (A: nx,nz,cavity,flow  B: forest,meadow,talus,sandstone)
//   applyMountainShadows(material)  opt-in: a lit built-in material also gets the mountain shadows
//   material, uniforms    the terrain material (uTerrWorld maps world xz -> map uv), stats(), timings

import * as THREE from 'crownfall-world-three';
import { createTerrainPool } from './terrain-pool.js';
import { createTerrainMaterial, makeWorldTexture, makeMountainShadowPatch } from './terrain-material.js';
import { TerrainLOD } from './terrain-lod.js';
import { WG_N, WG_X0, WG_STEP, MAX_LEVEL, CG_N } from './terrain-jobs.js';
import { yieldToMain as yieldMain } from '../core/yield.js';

const ROW_BLOCK = 16;


/**
 * Run independent jobs on every worker and on the (otherwise idle) main thread, each pulling the
 * next job from a shared queue. `first` (optional) runs on worker 0 before it joins the queue.
 */
async function runQueue(pool, jobs, onResult, { first = null, onFirst = null } = {}) {
  let next = 0;
  const loops = [];
  for (let w = 0; w < pool.size; w++) {
    loops.push(
      (async () => {
        if (first && w === 0) onFirst(await pool.run(0, { ...first }));
        while (next < jobs.length) {
          const m = jobs[next++];
          onResult(m, await pool.run(w, { ...m }));
        }
      })(),
    );
  }
  if (pool.threaded) {
    loops.push(
      (async () => {
        await yieldMain();
        while (next < jobs.length) {
          const m = jobs[next++];
          onResult(m, pool.runLocal({ ...m }));
          await yieldMain();
        }
      })(),
    );
  }
  await Promise.all(loops);
}

export async function build(ctx) {
  const t0 = performance.now();
  const { quality, env, camera } = ctx;
  const detail = quality.terrainDetail ?? 1;
  const syncMode = !!ctx.params.shot;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const pool = createTerrainPool(ctx.profile === 'quest' ? 2 : Math.max(1, Math.min(4, hc - 1)));
  ctx.onDispose?.(() => pool.dispose());
  const W = pool.size;

  // ---- 1. world grid -------------------------------------------------------------
  const world = new Float32Array(WG_N * WG_N);
  const coarse = new Float32Array(CG_N * CG_N); // outer occluders for the sun sweep
  {
    const jobs = [];
    for (let j0 = 0; j0 < WG_N; j0 += ROW_BLOCK) jobs.push({ type: 'rows', j0, j1: Math.min(WG_N, j0 + ROW_BLOCK) });
    for (let j0 = 0; j0 < CG_N; j0 += 32) jobs.push({ type: 'crows', j0, j1: Math.min(CG_N, j0 + 32) });
    await runQueue(pool, jobs, (m, r) => (m.type === 'rows' ? world : coarse).set(r.data, m.j0 * (m.type === 'rows' ? WG_N : CG_N)));
  }
  const tGrid = performance.now();
  await pool.broadcast({ type: 'setWorld', world, coarse });

  // ---- 2. world maps -------------------------------------------------------------
  const A = new Uint8Array(WG_N * WG_N * 4);
  const B = new Uint8Array(WG_N * WG_N * 4);
  {
    const jobs = [];
    for (let j0 = 0; j0 < WG_N; j0 += ROW_BLOCK * 2) jobs.push({ type: 'maprows', j0, j1: Math.min(WG_N, j0 + ROW_BLOCK * 2) });
    // worker 0 starts with the whole-grid operators (cavity, drainage), then joins the row jobs
    let global = null;
    await runQueue(pool, jobs, (m, r) => {
      A.set(r.A, m.j0 * WG_N * 4);
      B.set(r.B, m.j0 * WG_N * 4);
    }, { first: { type: 'global' }, onFirst: (g) => (global = g) });
    for (let k = 0, n = WG_N * WG_N; k < n; k++) {
      A[k * 4 + 2] = global.cavity[k];
      A[k * 4 + 3] = global.flow[k];
    }
  }
  const tMaps = performance.now();

  // ---- 3. sun visibility ---------------------------------------------------------
  const sunData = new Uint8Array(WG_N * WG_N).fill(255);
  const sunTex = makeWorldTexture(sunData, THREE.RedFormat);
  let sunBusy = false, sunDirty = false;
  // the shadow-casting key light: the sun by day, the moon at night (env.keyDir)
  const keyDir = () => env.keyDir || env.sunDir;
  const sunVec = () => {
    const d = keyDir();
    return [d.x, d.y, d.z];
  };
  const applySun = (vis) => {
    sunData.set(vis);
    sunTex.needsUpdate = true;
  };
  const refreshSun = () => {
    if (syncMode) {
      applySun(pool.runLocal({ type: 'sun', dir: sunVec() }).vis);
      return;
    }
    if (sunBusy) {
      sunDirty = true;
      return;
    }
    sunBusy = true;
    pool.run(0, { type: 'sun', dir: sunVec() }).then((r) => {
      applySun(r.vis);
      sunBusy = false;
      if (sunDirty) {
        sunDirty = false;
        refreshSun();
      }
    });
  };
  applySun((await pool.run(0, { type: 'sun', dir: sunVec() })).vis);
  env.onChange(refreshSun);

  // ---- 4. material + LOD ---------------------------------------------------------
  const maps = { A: makeWorldTexture(A), B: makeWorldTexture(B), sun: sunTex };
  const mat = createTerrainMaterial(ctx, maps);
  mat.uniforms.uTerrSunDir.value.copy(keyDir());
  const high = quality.level === 'high';
  const lod = new TerrainLOD(ctx, pool, mat, {
    // split distance / chunk size (vertex spacing ≈ distance / (96 K)): 1.8 high, 1.5 medium/low
    K: ctx.profile === 'quest' ? 0.8 : high ? 1.8 : 1.5,
    maxLevel: ctx.profile === 'quest' ? MAX_LEVEL - 2 : detail >= 0.7 ? MAX_LEVEL : MAX_LEVEL - 1,
    // only the nearest chunks (~0.4 km medium, ~0.9 km high) cast into the shadow map; the
    // heightfield visibility map shadows the terrain (and opted-in materials) beyond that
    castMinLevel: high ? 7 : 8,
    // batch slots (~240 KB each; grown automatically if a view ever needs more)
    fineCapacity: high ? 240 : detail >= 0.7 ? 130 : 8,
    coarseCapacity: ctx.profile === 'quest' ? 120 : high ? 330 : detail >= 0.7 ? 390 : 300,
    world,
  });
  const cam = new THREE.Vector3();
  camera.getWorldPosition(cam);
  mat.uniforms.uTerrCam.value.copy(cam);
  await lod.refineAsync(cam);
  const tLod = performance.now();

  /** Bilinear sample of a WG_N² grid (clamped to the world square). */
  const sampleGrid = (arr, scale, x, z) => {
    let fx = (x - WG_X0) / WG_STEP, fz = (z - WG_X0) / WG_STEP;
    fx = fx < 0 ? 0 : fx > WG_N - 1.001 ? WG_N - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > WG_N - 1.001 ? WG_N - 1.001 : fz;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * WG_N + i;
    const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
    const b = arr[k + WG_N] + (arr[k + WG_N + 1] - arr[k + WG_N]) * tx;
    return (a + (b - a) * tz) * scale;
  };

  ctx.terrain = {
    /** ~20 ns approximate ground height from the 9 m world grid (use ctx.heightAt for placement). */
    heightApprox: (x, z) => sampleGrid(world, 1, x, z),
    /** 0..1 heightfield visibility of the key light (sun by day, moon at night) — mountain shadows. */
    lightVisibility: (x, z) => sampleGrid(sunData, 1 / 255, x, z),
    /** Opt-in: a lit built-in material also receives the basin-wide mountain shadows. */
    applyMountainShadows: makeMountainShadowPatch(mat.uniforms),
    material: mat.material,
    uniforms: mat.uniforms,
    grid: { data: world, n: WG_N, x0: WG_X0, z0: WG_X0, step: WG_STEP },
    maps,
    sunTexture: sunTex,
    stats: () => ({ ...lod.stats, ...lod.countVisible(), workers: pool.threaded ? W : 0 }),
    timings: {
      grid: Math.round(tGrid - t0),
      maps: Math.round(tMaps - tGrid),
      lod: Math.round(tLod - tMaps),
      total: Math.round(tLod - t0),
    },
  };
  if (ctx.params.debug) console.log('[terrain] build', ctx.terrain.timings, ctx.terrain.stats());

  return {
    order: 100, // after camera controls, so LOD + morph use this frame's camera
    update() {
      camera.getWorldPosition(cam);
      mat.uniforms.uTerrCam.value.copy(cam);
      mat.uniforms.uTerrSunDir.value.copy(keyDir());
      lod.update(cam, syncMode);
    },
  };
}
