// Vegetation — forests to the horizon, meadows, shoreline reeds.
//
//   species (vegetation-geo.js, 2-4 LODs each, solid geometry)
//     spire conifers    tall dark whorled spires (25-45 m, a few emergent veterans) — the dominant
//                       forests; every instance loses different branches, interior trees have bare
//                       self-pruned trunks, some have wind-broken tops, and silver dead snags stand in
//                       blighted patches (per-instance form in the shader, one geometry)
//     parasol pines     lobed umbrella crowns on hills and ridges
//     aspens            clonal groves of pale-trunked, round-crowned trees on forest margins and
//                       around clearings (green / yellow / gold, per grove)
//     ghost trees       pale weeping trees with hair-like curtains, leaning over the water
//     giants            a few dozen ancient colossi (60-90 m): a gnarled cedar with buttress fins,
//                       snaking roots and tiers of cloud-plates, or a pale dragon-tree whose forking
//                       limbs hold a cathedral-sized dome — landmarks in their own right
//     fallen logs       windthrown trunks with their root plates, in the forest clearings
//     shrubs, reeds     forest edges / meadows / the waterline
//     ground cover      grass tufts, wildflowers and ferns in a patch that follows the camera
//   placement (vegetation-place.js)   the shared biome fields + slope/altitude/water/landmark zones
//   LOD + culling (vegetation-lod.js) 128 m cells, spiral near-to-far fill of one dynamic instance
//                                     buffer per (species, LOD); stochastic thinning far away
//   shading (vegetation-material.js)  wind sway + flutter, backlit translucency, AO, tints,
//                                     canopy / sky fill, camera squeeze, per-instance form
//
// Publishes ctx.vegetation = { giants: [{x, y, z, height, form}], counts, stats(), groundDensity(x, z) }.
// URL flag ?vegstats logs instance / triangle counts per buffer refresh (budget checks).

import * as THREE from 'crownfall-world-three';
import { spireConifer, parasolPine, aspen, ghostTree, giantTree, fallenLog, shrub, reeds, grassTuft, flowers, fern } from './vegetation-geo.js';
import { createVegShared, vegMaterial, LOOK } from './vegetation-material.js';
import { InstBuf, StaticKind, CellField } from './vegetation-lod.js';
import { createFields, scatter, groundDensity } from './vegetation-place.js';
import { GroundCover } from './vegetation-ground.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


/**
 * LOD bands per species for a quality preset: [geometry LOD, max distance, casts shadows]; near
 * bands cast into the sun's shadow map. `cull` = draw range, `thin` = [start, end, min keep] of the
 * stochastic far thinning. Exported for the look-dev / budget tools.
 */
export function vegBands(quality) {
  const lo = quality.level === 'low';
  const hi = quality.level === 'high';
  const pick = (l, m, h) => (lo ? l : hi ? h : m);
  const sh = quality.shadows;
  return {
      spire: { bands: [[0, pick(45, 60, 78), sh], [1, pick(0, 200, 250), sh], [1, pick(160, 0, 0), false], [2, pick(420, 600, 700), false], [3, 0, false]], cull: pick(2800, 5000, 6800), thin: [pick(300, 450, 520), pick(1800, 3200, 3800), pick(0.16, 0.28, 0.3)] },
      parasol: { bands: [[0, pick(100, 140, 180), sh], [1, pick(0, 400, 500), sh], [1, pick(500, 750, 950), false], [2, 0, false]], cull: pick(3200, 5000, 6800), thin: [pick(1200, 1800, 2400), pick(3000, 4600, 6200), 0.55] },
      aspen: { bands: [[0, pick(70, 100, 130), sh], [1, pick(0, 330, 420), sh], [1, pick(380, 550, 700), false], [2, 0, false]], cull: pick(2200, 3800, 5000), thin: [pick(500, 900, 1000), pick(1800, 3200, 3800), pick(0.3, 0.4, 0.4)] },
      ghost: { bands: [[0, pick(45, 90, 110), sh], [1, pick(0, 330, 420), sh], [1, pick(400, 550, 700), false], [2, 0, false]], cull: pick(2400, 3500, 4600), thin: [pick(800, 1200, 1500), pick(2200, 3200, 4200), 0.45] },
      giant: { bands: [[0, pick(260, 340, 420), sh], [1, pick(1000, 1400, 1800), sh], [2, 0, sh]], cull: 9000, thin: null },
      log: { bands: [[0, pick(60, 90, 120), sh], [1, 0, false]], cull: pick(350, 500, 650), thin: null },
      shrub: { bands: [[0, pick(55, 80, 110), hi], [1, 0, false]], cull: pick(420, 650, 900), thin: [pick(150, 220, 300), pick(400, 620, 860), 0.3] },
      reed: { bands: [[0, pick(60, 90, 120), false], [1, 0, false]], cull: pick(260, 380, 480), thin: [pick(100, 150, 200), pick(250, 360, 460), 0.35] },
  };
}

/** Instance-buffer capacity per band (overflow drops the farthest). */
export const CAP_BASE = { spire: [2500, 12000, 12000, 20000, 200000], parasol: [600, 2500, 4000, 30000], aspen: [1500, 6000, 9000, 40000], ghost: [1200, 5000, 8000, 40000], giantS: [60, 60, 60], giantC: [60, 60, 60], log: [1500, 6000], shrub: [9000, 60000], reed: [5000, 30000] };

export async function build(ctx) {
  const t0 = performance.now();
  const timings = {};
  let tp = t0;
  const mark = (k) => {
    const t = performance.now();
    timings[k] = Math.round(t - tp);
    tp = t;
  };
  const { quality, camera, noise } = ctx;
  const lvl = quality.level;
  const hi = lvl === 'high';
  const lo = lvl === 'low';
  const Qv = quality.vegetation ?? 1;
  const sync = !!ctx.params.shot;
  const N = noise.worldNoise;
  const R = (id) => noise.createRng(`vegetation-${id}`);
  const root = new THREE.Group();
  root.name = 'vegetation';
  ctx.scene.add(root);

  // ---- species geometry -------------------------------------------------------------
  const G = {
    spire: spireConifer(N, R('spire')),
    parasol: parasolPine(N, R('parasol')),
    aspen: aspen(N, R('aspen')),
    ghost: ghostTree(N, R('ghost')),
    giantS: giantTree(N, R('giant-spread'), 'spread'),
    giantC: giantTree(N, R('giant-crown'), 'crown'),
    log: fallenLog(N, R('log')),
    shrub: shrub(N, R('shrub')),
    reed: reeds(N, R('reed')),
  };
  const groundGeo = { grass: grassTuft(N, R('grass')), flower: flowers(N, R('flower')), fern: fern(N, R('fern')) };
  mark('geometry');
  await nextFrame();

  // ---- distances per quality --------------------------------------------------------
  const D = vegBands(quality);
  const pick = (l, m, h) => (lo ? l : hi ? h : m);
  const distVec = (d) => (d.thin ? [d.thin[0], d.thin[1], d.thin[2], d.cull] : [1e6, 2e6, 1, d.cull]);

  // ---- materials ----------------------------------------------------------------------
  const shared = createVegShared(ctx);
  shared.update();
  // crown centre (xz of the upper mesh), reach around it and top of the full-detail mesh, for the
  // camera squeeze (leaning trunks and long limbs put the crown well off the trunk base)
  const reach = (geo) => {
    const p = geo.lods[0].attributes.position.array;
    let top = 0, cx = 0, cz = 0, n = 0;
    for (let i = 0; i < p.length; i += 3) top = Math.max(top, p[i + 1]);
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < top * 0.35) continue;
      cx += p[i];
      cz += p[i + 2];
      n++;
    }
    cx /= n || 1;
    cz /= n || 1;
    let r = 0;
    for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 2] - cz));
    return [r, top, cx, cz];
  };
  const mat = (name, look, dist, dist2 = null, geo = null) => vegMaterial(shared, { name, ...LOOK[look], dist, dist2, near: geo ? reach(geo) : [0, 0] });
  const M = {
    spire: mat('spire', 'spire', distVec(D.spire), null, G.spire),
    parasol: mat('parasol', 'parasol', distVec(D.parasol), null, G.parasol),
    aspen: mat('aspen', 'aspen', distVec(D.aspen), null, G.aspen),
    ghost: mat('ghost', 'ghost', distVec(D.ghost), null, G.ghost),
    giant: mat('giant', 'giant', distVec(D.giant)),
    log: mat('log', 'log', distVec(D.log)),
    shrub: mat('shrub', 'shrub', distVec(D.shrub), null, G.shrub),
    reed: mat('reed', 'reed', distVec(D.reed), null, G.reed),
  };
  // ground cover: tier 0 (dense, near) / tier 1 (sparse clumps, to ~120 m)
  const gr0 = [pick(10, 14, 18), pick(22, 30, 36), 0, pick(26, 34, 40)];
  const gr1 = [pick(30, 40, 50), pick(70, 105, 125), 0.2, pick(80, 118, 135)];
  const GM = {
    grass: mat('grass', 'grass', gr0, gr1),
    flower: mat('flower', 'flower', gr0, gr1),
    fern: mat('fern', 'fern', gr0, gr1),
  };

  // ---- kinds (instance stores + LOD buffers) ------------------------------------------
  const field = new CellField({ half: 4608, cell: 128, rng: R('cells') });
  const K = {};
  const makeKind = (name, geo, mat, d, { sink = 0.3, refine = true } = {}) => {
    const bands = d.bands.filter((b, i) => b[1] > 0 || i === d.bands.length - 1);
    const lods = bands.map(([gi, max, cast], i) => ({ g: geo.lods[gi], max: i < bands.length - 1 ? max : Infinity, cast: !!cast }));
    const kind = new StaticKind({ name, lods, cull: d.cull, thin: d.thin, sink, H: geo.H, refine });
    kind.material = mat;
    K[name] = field.addKind(kind);
    return kind;
  };
  makeKind('spire', G.spire, M.spire, D.spire, { sink: 0.4 });
  makeKind('parasol', G.parasol, M.parasol, D.parasol, { sink: 0.5 });
  makeKind('aspen', G.aspen, M.aspen, D.aspen, { sink: 0.4 });
  makeKind('ghost', G.ghost, M.ghost, D.ghost, { sink: 0.4 });
  makeKind('giantS', G.giantS, M.giant, D.giant, { sink: 1.5 });
  makeKind('giantC', G.giantC, M.giant, D.giant, { sink: 1.5 });
  makeKind('log', G.log, M.log, D.log, { sink: 0.3 });
  makeKind('shrub', G.shrub, M.shrub, D.shrub, { sink: 0.35 });
  makeKind('reed', G.reed, M.reed, D.reed, { sink: 0.1, refine: false });

  // ---- placement ------------------------------------------------------------------------
  const F = await createFields(ctx);
  mark('fields');
  await nextFrame();
  const counts = scatter(ctx, F, K, Qv, R('scatter'));
  mark('scatter');
  await nextFrame();

  // giants list (before finalize consumes the lists)
  const giants = [];
  for (const name of ['giantS', 'giantC']) {
    const L = K[name].list;
    for (let i = 0; i < L.n; i++) {
      const o = i * 8;
      giants.push({ x: L.a[o], y: L.a[o + 1] + K[name].sink * L.a[o + 3], z: L.a[o + 2], height: G[name].H * L.a[o + 3], form: G[name].form });
    }
  }
  field.finalize();
  mark('finalize');

  // LOD buffers (capacity from the counts)
  // instance capacity per band: generous for what a view can hold (overflow drops the farthest)
  const capOf = (k, i) => {
    const far = i === k.lods.length - 1;
    const base = CAP_BASE[k.name];
    return Math.min(k.count, far ? base[base.length - 1] : base[Math.min(i, base.length - 2)]);
  };
  const meshes = [];
  for (const k of field.kinds) {
    k.lods.forEach((L, i) => {
      const cap = capOf(k, i);
      L.buf = new InstBuf(L.g, k.material.material, k.material.depth, cap, { castShadow: L.cast, receiveShadow: true, name: `veg:${k.name}:${i}` });
      root.add(L.buf.mesh);
      meshes.push(L.buf);
    });
  }

  // ground cover
  const gq = ctx.profile === 'quest' ? 0.12 : 0.55 + 0.45 * Qv;
  const groundBufs = {
    grass: new InstBuf(groundGeo.grass, GM.grass.material, GM.grass.depth, Math.round(26000 * gq), { castShadow: false, name: 'veg:grass' }),
    flower: new InstBuf(groundGeo.flower, GM.flower.material, GM.flower.depth, Math.round(5000 * gq), { castShadow: false, name: 'veg:flower' }),
    fern: new InstBuf(groundGeo.fern, GM.fern.material, GM.fern.depth, Math.round(6000 * gq), { castShadow: false, name: 'veg:fern' }),
  };
  for (const b of Object.values(groundBufs)) {
    root.add(b.mesh);
    meshes.push(b);
  }
  const density = groundDensity(ctx, F);
  const ground = new GroundCover(
    ctx,
    density,
    groundBufs,
    [
      { cell: 8, radius: gr0[3], dens: { grass: 3.4 * gq, flower: 0.4 * gq, fern: 0.35 * gq }, scale: [0.75, 1.25], thin: [gr0[0], gr0[1], 0] },
      { cell: 24, radius: gr1[3], dens: { grass: 0.5 * gq, flower: 0.05 * gq, fern: 0.07 * gq }, scale: [1.05, 1.6], thin: [gr1[0], gr1[1], 0.2] },
    ],
    { sync },
  );

  // first fill (exact heights near the camera)
  camera.updateMatrixWorld();
  const heightAt = ctx.heightAt;
  field.refresh(camera, { heightAt, sync: true });
  ground.update(camera, true);
  mark('fill');

  const tris = (bufs) => bufs.reduce((s, b) => s + b.n * b.tris * (b.mesh.visible ? 1 : 0), 0);
  ctx.vegetation = {
    giants,
    counts,
    fields: F.source,
    groundDensity: (x, z) => {
      const d = density(x, z);
      return { grass: d.grass, flower: d.flower, fern: d.fern };
    },
    stats() {
      const per = {};
      for (const b of meshes) if (b.n) per[b.mesh.name.slice(4)] = b.n;
      return {
        build: Math.round(tBuild),
        timings,
        counts,
        instancesInView: per,
        tris: tris(meshes),
        refreshMs: +field.stats.lastMs.toFixed(2),
        groundMs: +ground.stats.lastMs.toFixed(2),
        cells: field.stats.cells,
        groundCells: ground.stats.cells,
        overflow: meshes.filter((b) => b.overflow).map((b) => `${b.mesh.name}:${b.overflow}`),
      };
    },
  };
  const tBuild = performance.now() - t0;
  if (ctx.params.debug || sync) console.log(`[veg] build ${Math.round(tBuild)} ms ${JSON.stringify({ timings, counts, fields: F.source })}`);

  let dbgT = 0;
  let dbgN = 0;
  // ?vegstats: report instance / triangle counts after each buffer refresh (look-dev + budgets;
  // the screenshot harness prints console warnings)
  let statsFlag = false;
  try {
    statsFlag = new URLSearchParams(window.location.search).has('vegstats');
  } catch {
    statsFlag = false;
  }
  let statsSeen = -1;
  return {
    order: 60,
    update() {
      const tu = performance.now();
      shared.update();
      camera.updateMatrixWorld();
      field.work(heightAt, sync ? 1e9 : 1.0);
      if (field.needsRefresh(camera)) field.refresh(camera, { heightAt, sync });
      ground.update(camera);
      if (statsFlag && field.stats.refreshes !== statsSeen) {
        statsSeen = field.stats.refreshes;
        const st = ctx.vegetation.stats();
        console.warn(`[veg] tris ${st.tris} refresh ${st.refreshMs} ms view ${JSON.stringify(st.instancesInView)} build ${st.build} ${JSON.stringify(st.timings)}`);
        if (statsSeen === 1) {
          console.warn(`[veg] counts ${JSON.stringify(counts)}`);
          for (const f of ['crown', 'spread']) console.warn(`[veg] ${f} giants ${giants.filter((g) => g.form === f).map((g) => `${Math.round(g.x)},${Math.round(g.y)},${Math.round(g.z)}`).join(' ')}`);
        }
      }
      if (ctx.params.debug) {
        dbgN++;
        if (tu - dbgT > 2000) {
          dbgT = tu;
          console.log(`[veg] frame ${dbgN} update ${(performance.now() - tu).toFixed(2)} ms ${JSON.stringify(ctx.vegetation.stats())}`);
        }
      }
    },
  };
}
