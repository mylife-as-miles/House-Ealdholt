// Water: the great lake ("The Mirror"), the canyon river, pools, streams and ponds above the
// waterline, and the landscape waterfalls. See water-surface.js for the look, water-bake*.js for
// the terrain bakes (the water map bakes in a worker while the falls and streams are built),
// water-falls.js / water-streams.js for the falls and the drainage, water-reflect.js for the
// planar reflections and water-contact.js for the foam around everything standing in the water.
//
// ctx.water (for other modules):
//   level                    0 — the water plane of the lake and the river
//   isUnderwater(pos)        true if pos (x, y, z) is below any water surface (lake, river, ponds)
//   depthAt(x, z)            water depth at (x, z) of the lake/river (0 on land)
//   falls                    [{ id, lip:{x,y,z}, base:{x,y,z}, drop }] the landscape falls
//   ponds                    [{ x, z, level, r, kind }] plunge pools, ponds and tarns above y = 0
//   viewpoints               curated shots of the water for the tour / photo mode
//   reflections              { enabled, available, mode } planar reflections: 'full' (q=high: sky,
//                            terrain, landmarks) or 'sky' (medium: the sky dome only); none on low
//   uniforms                 the shared surface uniforms (read-only please)

import * as THREE from 'crownfall-world-three';
import { createWaveNormalTexture, createWaterNoiseTexture } from './water-waves.js';
import { createCoarseSampler, bakeWaterDataAsync, bakeWorldHeight } from './water-bake.js';
import { createSurfaceMaterial, createSharedUniforms } from './water-surface.js';
import { buildFalls } from './water-falls.js';
import { buildStreams } from './water-streams.js';
import { createPlanarReflection } from './water-reflect.js';
import { bakeContact } from './water-contact.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


/** Lake + river surface: 32 m cells wherever the bake has water (no plane under the mountains). */
function buildLakeGeometry(bake, cell = 32) {
  const { nx, nz, step, x0, z0, height } = bake;
  const c = Math.round(cell / step);
  const cx = Math.ceil((nx - 1) / c);
  const cz = Math.ceil((nz - 1) / c);
  const use = new Uint8Array(cx * cz);
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cx; i++) {
      let lo = Infinity;
      const i0 = Math.max(0, i * c - 1);
      const i1 = Math.min(nx - 1, (i + 1) * c + 1);
      const j0 = Math.max(0, j * c - 1);
      const j1 = Math.min(nz - 1, (j + 1) * c + 1);
      for (let jj = j0; jj <= j1 && lo >= 0.6; jj++) {
        for (let ii = i0; ii <= i1; ii++) {
          const h = height[jj * nx + ii];
          if (h < lo) lo = h;
        }
      }
      use[j * cx + i] = lo < 0.6 ? 1 : 0;
    }
  }
  const vid = new Int32Array((cx + 1) * (cz + 1)).fill(-1);
  const pos = [];
  const idx = [];
  const v = (i, j) => {
    const k = j * (cx + 1) + i;
    if (vid[k] < 0) {
      vid[k] = pos.length / 3;
      pos.push(x0 + Math.min(i * c, nx - 1) * step, 0, z0 + Math.min(j * c, nz - 1) * step);
    }
    return vid[k];
  };
  const boxes = [];
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cx; i++) {
      if (!use[j * cx + i]) continue;
      const a = v(i, j);
      const b = v(i + 1, j);
      const d = v(i, j + 1);
      const e = v(i + 1, j + 1);
      idx.push(a, d, b, b, d, e);
    }
  }
  // coarse bounds (for the reflection pass visibility test): one box per 16x16 cell block
  const B = 16;
  for (let bj = 0; bj < cz; bj += B) {
    for (let bi = 0; bi < cx; bi += B) {
      let any = false;
      for (let j = bj; j < Math.min(cz, bj + B) && !any; j++) for (let i = bi; i < Math.min(cx, bi + B); i++) if (use[j * cx + i]) any = true;
      if (any) {
        boxes.push(new THREE.Box3(
          new THREE.Vector3(x0 + bi * c * step, -1, z0 + bj * c * step),
          new THREE.Vector3(x0 + Math.min(cx, bi + B) * c * step, 1, z0 + Math.min(cz, bj + B) * c * step),
        ));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return { geo, boxes };
}

const UNDER_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy + 0.5; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;
const UNDER_FS = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uDeep;
uniform float uDepth;
varying vec2 vUv;
void main() {
  float g = smoothstep(0.0, 1.0, vUv.y);
  vec3 c = mix(uDeep, uTop, g * exp(-uDepth * 0.08));
  gl_FragColor = vec4(c, 0.93);
}
`;

export async function build(ctx) {
  const { scene, quality, env } = ctx;
  const T = { start: performance.now() };
  const rng = ctx.noise.createRng('water');
  const level = ctx.layout.WORLD.waterLevel ?? 0;

  // ---- bakes and textures. The water map bakes in a worker meanwhile (the main thread goes on
  // with the textures, falls and streams, then waits for it before building the lake surface).
  const coarse = createCoarseSampler(ctx);
  const bakeJob = bakeWaterDataAsync(ctx, coarse);
  const waveTex = createWaveNormalTexture(rng, ctx.renderer);
  const noiseTex = createWaterNoiseTexture(rng);
  const world = bakeWorldHeight(ctx, coarse);
  T.textures = performance.now();

  // ---- the surface
  const shared = createSharedUniforms();
  shared.uWWaves.value = waveTex;
  shared.uWNoise.value = noiseTex;
  shared.uWHeight.value = world.tex;
  shared.uWHeightXf.value.copy(world.xf);
  // the sky's live uniforms (shared objects): the reflected sky follows the real one exactly
  const su = ctx.sky?.uniforms;
  if (su?.uSunColor && su.uSun && su.uBelt && su.uNight && su.uMoon && su.uMoonDir) {
    shared.uWSkySun = su.uSunColor;
    shared.uWSkyP = su.uSun;
    shared.uWSkyBelt = su.uBelt;
    shared.uWSkyNight = su.uNight;
    shared.uWSkyMoon = su.uMoon;
    shared.uWSkyMoonDir = su.uMoonDir;
  }
  const tu = ctx.terrain?.uniforms;
  const terrMaps = !!(ctx.terrain?.maps?.B && tu?.uTerrSun && tu?.uTerrWorld);
  if (terrMaps) {
    shared.uWTerrB.value = ctx.terrain.maps.B;
    shared.uWTerrSun = tu.uTerrSun; // live: follows the sun
    shared.uWTerrXf = tu.uTerrWorld;
  }
  if (tu?.uTerrFar) shared.uWMarch.value.w = tu.uTerrFar.value.w;
  const lvl = quality.level;
  const march = lvl === 'low' ? 14 : 26;
  shared.uWMarch.value.y = lvl === 'low' ? 1.7 : 1.36;
  // wind from the west-south-west; wave layers fan out around it
  const windA = Math.atan2(-0.43, 0.9);
  const dirs = [0, 0.55, -0.75, 1.45].map((o) => [Math.cos(windA + o), Math.sin(windA + o)]);
  shared.uWWind.value.set(dirs[0][0], dirs[0][1], 3, 1);
  shared.uWDirA.value.set(dirs[0][0], dirs[0][1], dirs[1][0], dirs[1][1]);
  shared.uWDirB.value.set(dirs[2][0], dirs[2][1], dirs[3][0], dirs[3][1]);

  // planar reflections: everything big on q=high, the sky alone on medium, none on low
  const devRefl = new URLSearchParams(window.location.search).get('wrefl'); // dev: wrefl=0 disables
  const planarOn = !!quality.reflections && devRefl !== '0';
  const planarMode = planarOn ? 'full' : quality.level === 'low' || !ctx.sky?.mesh || devRefl === '0' ? null : 'sky';
  // contact foam map: a 'far away' placeholder until the real one is baked once everything loaded
  const farTex = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  farTex.needsUpdate = true;
  shared.uWContact.value = farTex;
  shared.uWContactXf.value.set(0, 0, 1e-6, 1e-6);
  // dev: ?wdbg=1 reflection, 2 hit/fresnel/body, 3 mirror term, 4 diffuse, 5-7 env map probes
  const debug = Number(new URLSearchParams(window.location.search).get('wdbg') || 0);
  const lakeMat = createSurfaceMaterial(ctx, shared, { planar: planarMode, march, terrMaps, contact: true, name: 'water-lake', debug });
  ctx.terrain?.applyMountainShadows?.(lakeMat);

  // ---- waterfalls, pools, streams, ponds
  const fallsBuilt = buildFalls(ctx, { noiseTex, heightTex: world.tex, heightXf: world.xf });
  for (const m of fallsBuilt.meshes) scene.add(m);
  T.falls = performance.now();
  const streams = buildStreams(ctx, coarse, fallsBuilt.falls);
  const localMat = createSurfaceMaterial(ctx, shared, { local: true, march: lvl === 'low' ? 0 : 16, terrMaps, name: 'water-streams' });
  ctx.terrain?.applyMountainShadows?.(localMat);
  const local = new THREE.Mesh(streams.geometry, localMat);
  local.name = 'water-streams';
  local.receiveShadow = true;
  local.renderOrder = -1;
  scene.add(local);
  T.streams = performance.now();

  // ---- the lake + river surface (needs the bake)
  await nextFrame(); // yield once: lets the loader breathe and the worker's messages in
  const bake = await (bakeJob.started() ? bakeJob.result : bakeJob.local());
  T.bake = performance.now();
  shared.uWData.value = bake.tex;
  shared.uWDataXf.value.copy(bake.xf);
  const lakeGeo = buildLakeGeometry(bake);
  const lake = new THREE.Mesh(lakeGeo.geo, lakeMat);
  lake.name = 'water-lake';
  lake.receiveShadow = true;
  lake.castShadow = false;
  lake.renderOrder = -1;
  scene.add(lake);
  T.surface = performance.now();

  // churned water under every fall (river plunge + the pools)
  fallsBuilt.falls.slice(0, 4).forEach((f, i) => {
    shared.uWFoamPts.value[i].set(f.base.x, f.base.z, f.width * 1.1 + 12, 1);
  });

  // contact foam around everything standing in the lake / river (after all modules exist)
  ctx.events.on('ready', () => {
    try {
      const c = bakeContact(ctx, {
        x0: -600,
        z0: -600,
        x1: 1960,
        z1: 720,
        // Quest's relief uses a 256 px-wide contact map; keep all five shear
        // projections so vertical walls retain the source foam coverage.
        res: ctx.profile === 'quest' ? 10 : 2.5,
        skip: (o) => o.name === 'terrain' || o.name === 'sky' || (o.name || '').startsWith('water'),
      });
      shared.uWContact.value = c.tex;
      shared.uWContactXf.value.copy(c.xf);
      farTex.dispose();
      if (ctx.water?.stats) ctx.water.stats.contact = c.stats;
      if (ctx.params.debug) console.warn('[water] contact', JSON.stringify(c.stats));
    } catch (e) {
      console.warn('[water] contact foam bake failed', e);
    }
  });

  // ---- planar reflections
  let planar = null;
  if (planarMode) {
    planar = createPlanarReflection(ctx, planarMode === 'full' ? { level, scale: 0.5, keep: fallsBuilt.meshes } : { level, scale: 0.3, skyOnly: true });
    shared.uWPlanar.value = planar.texture;
    shared.uWPlanarMat.value = planar.textureMatrix;
  }

  // ---- underwater veil
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      name: 'water-under',
      uniforms: { uTop: { value: new THREE.Color(0.03, 0.09, 0.08) }, uDeep: { value: new THREE.Color(0.002, 0.008, 0.012) }, uDepth: { value: 0 } },
      vertexShader: UNDER_VS,
      fragmentShader: UNDER_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  under.name = 'water-under';
  under.frustumCulled = false;
  under.renderOrder = 9990;
  under.visible = false;
  scene.add(under);

  // ---- public API
  const pondList = streams.ponds;
  const pondLevel = (x, z) => {
    for (const p of pondList) {
      const i = Math.round((x - p.x) / p.s) + p.R;
      const j = Math.round((z - p.z) / p.s) + p.R;
      if (i < 0 || j < 0 || i >= p.n || j >= p.n) continue;
      if (p.inside[j * p.n + i]) return p.level;
    }
    return -Infinity;
  };
  // enabled: toggle at runtime (the surface falls back to the height-field march + analytic sky)
  const reflections = { enabled: !!planarMode, available: !!planarMode, mode: planarMode };
  ctx.water = {
    level,
    isUnderwater(pos) {
      const x = pos.x ?? pos[0];
      const y = pos.y ?? pos[1];
      const z = pos.z ?? pos[2];
      if (y < level && bake.groundAt(x, z) < level) return true;
      const pl = pondLevel(x, z);
      return y < pl && ctx.heightAt(x, z) < pl;
    },
    depthAt(x, z) {
      return Math.max(0, level - bake.groundAt(x, z));
    },
    falls: fallsBuilt.falls.map((f) => ({ id: f.id, lip: { x: f.lip.x, y: f.lip.y, z: f.lip.z }, base: { x: f.base.x, y: f.base.y, z: f.base.z }, drop: Math.round(f.drop) })),
    ponds: pondList.map((p) => ({ x: p.x, z: p.z, level: p.level, r: p.r, kind: p.kind })),
    viewpoints: [
      { pos: [662, 9, 44], look: [520, -2, -30], label: 'The Mirror at sundown', hour: 17.6 },
      { pos: [450, 20, -250], look: [-500, 5, -170], label: 'The sun path', hour: 17.6 },
      { pos: [600, 300, 900], look: [0, 0, -200], label: 'The Mirror' },
      { pos: [1835, 30, -360], look: [1720, 0, 0], label: 'The canyon river' },
      { pos: [-640, 150, -1060], look: [-800, 250, -1440], label: 'Falls of the escarpment' },
      { pos: [-1850, 180, -900], look: [-2050, 260, -1300], label: 'The western fall' },
      { pos: [2200, 50, -1300], look: [2330, 150, -1470], label: 'The fall at the canyon head' },
      { pos: [560, 95, -120], look: [-300, 0, 400], label: 'The Mirror by moonlight', hour: 1.5 },
    ],
    reflections,
    uniforms: shared,
    stats: null,
  };

  // ---- per frame
  const pal = env.palette;
  const tmpC = new THREE.Color();
  const camPos = new THREE.Vector3();
  const hideForReflection = [lake, local, under];
  let framesSeen = 0;

  function syncLight() {
    const sun = env.sun;
    shared.uWKeyCol.value.copy(sun.color).multiplyScalar(sun.intensity);
    shared.uWKeyDir.value.copy(env.keyDir);
    const hemiI = env.hemi.intensity;
    // ambient irradiance: the hemisphere fill + a share of the sky's IBL
    const ibl = env.iblActive ? pal.envIntensity : 0;
    shared.uWAmb.value.copy(pal.hemiSky).multiplyScalar(hemiI * 3.14159).add(tmpC.copy(pal.zenith).lerp(pal.horizon, 0.5).multiplyScalar(ibl * 2.2));
    shared.uWAmbGround.value.copy(pal.hemiGround).multiplyScalar(hemiI * 3.14159).add(tmpC.copy(pal.fog).multiplyScalar(ibl * 0.6));
    shared.uWReflBoost.value = env.iblActive ? 1 / Math.max(0.4, pal.envIntensity) : 1;
    shared.uWSkyZen.value.copy(pal.zenith);
    shared.uWSkyHor.value.copy(pal.horizon);
    const L = fallsBuilt.lightU;
    L.uKeyCol.value.copy(shared.uWKeyCol.value);
    L.uKeyDir.value.copy(env.keyDir);
    L.uAmb.value.copy(shared.uWAmb.value);
    L.uNight.value = env.night;
    // shallows glow a touch warmer at golden hour, depths go ink-black at night
    under.material.uniforms.uTop.value.setRGB(0.03, 0.09, 0.08).multiplyScalar(0.25 + 0.75 * (1 - env.night));
  }
  syncLight();
  env.onChange(syncLight);

  T.end = performance.now();
  ctx.water.stats = {
    ms: {
      total: Math.round(T.end - T.start),
      textures: Math.round(T.textures - T.start),
      falls: Math.round(T.falls - T.textures),
      streams: Math.round(T.streams - T.falls),
      bakeWait: Math.round(T.bake - T.streams),
      surface: Math.round(T.surface - T.bake),
    },
    bake: { ...bake.stats, by: bake.by },
    falls: fallsBuilt.stats,
    streams: streams.stats,
    lakeTriangles: lakeGeo.geo.index.count / 3,
    coarseFromTerrain: coarse.fromTerrain,
  };
  if (ctx.params.debug) console.warn('[water]', JSON.stringify(ctx.water.stats));

  return {
    order: 150, // after terrain LOD (100) so the reflection pass sees this frame's chunks
    update(dt, elapsed) {
      shared.uWTime.value = elapsed;
      fallsBuilt.timeU.value = elapsed;
      shared.uWWind.value.w = 0.75 + 0.5 * (ctx.atmo.time.z ?? 0.35);
      if (env.speed !== 0) syncLight();

      camPos.setFromMatrixPosition(ctx.camera.matrixWorld);
      const uw = ctx.water.isUnderwater(camPos);
      under.visible = uw;
      if (uw) under.material.uniforms.uDepth.value = Math.max(0, level - camPos.y);

      if (planar) {
        // not before the first main frame: the shadow maps the reflected materials sample are
        // only created by the main pass (the mirror pass never updates them)
        const ok = reflections.enabled && !uw && framesSeen++ > 0 && planar.render(lakeGeo.boxes, hideForReflection);
        shared.uWPlanarP.value.x = ok ? 1 : 0;
        shared.uWPlanarP.value.z = planar.maxMip;
      }
    },
  };
}
