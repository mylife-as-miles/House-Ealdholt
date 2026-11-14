// Ambient life & atmospheric motion — the slow things that make the basin feel inhabited by
// something: bird flocks wheeling around the landmarks, sunlit dust near the camera, fireflies
// in the night forests, mist banks pooling in the valleys and on the lake, and, very high up,
// a few colossal translucent drifting forms nobody can explain.
//
// Everything is GPU-animated from time + per-instance data (see the life-*.js files); the only
// per-frame JS is copying light colours into shared uniforms and recycling a few fireflies.
//
// ctx.life (for UI / tour / debugging): { birds, motes, fireflies, mist, skyforms } — each
// subsystem's object ({ mesh, ... }), or null if it failed or is disabled.

import * as THREE from 'crownfall-world-three';
import { createSharedUniforms, createNoiseTexture } from './life-common.js';
import { buildBirds } from './life-birds.js';
import { buildMotes } from './life-motes.js';
import { buildFireflies } from './life-fireflies.js';
import { buildMist } from './life-mist.js';
import { buildSkyforms } from './life-skyforms.js';
import { yieldToMain as nextFrame } from '../core/yield.js';

export async function build(ctx) {
  const { scene, env, camera, renderer } = ctx;
  const shared = createSharedUniforms(ctx);
  const t0 = performance.now();
  const life = { birds: null, motes: null, fireflies: null, mist: null, skyforms: null, stats: {} };
  ctx.life = life;

  const tryBuild = async (name, fn) => {
    const ts = performance.now();
    try {
      const sys = await fn();
      if (sys?.mesh) scene.add(sys.mesh);
      life[name] = sys;
      life.stats[name] = Math.round(performance.now() - ts);
    } catch (err) {
      console.error(`[life] ${name} failed:`, err);
      life[name] = null;
    }
  };

  await tryBuild('birds', () => buildBirds(ctx, shared));
  await tryBuild('motes', () => buildMotes(ctx, shared));
  await tryBuild('fireflies', () => buildFireflies(ctx, shared));
  const noiseTex = createNoiseTexture(ctx.noise.createRng('life-noise'), 128);
  await tryBuild('mist', () => buildMist(ctx, shared, noiseTex));
  await tryBuild('skyforms', () => buildSkyforms(ctx, shared));

  // ------------------------------------------------------------------ per-frame shared state
  const u = shared;
  const pal = env.palette;
  const drawSize = new THREE.Vector2();
  const systems = [];
  for (const k of ['birds', 'motes', 'fireflies', 'mist', 'skyforms']) if (life[k]?.update) systems.push(life[k]);

  function syncLight() {
    const e = u.uLifeEnv.value;
    e.x = env.night;
    e.y = env.twilight;
    e.z = env.morning;
    e.w = THREE.MathUtils.smoothstep(env.sunElevation, -3, 4);
    u.uKeyDir.value.copy(env.keyDir);
    // direct light = the key light as the environment sets it (sun by day, moon by night)
    u.uSunLight.value.copy(env.sun.color).multiplyScalar(env.sun.intensity);
    // ambient ≈ hemisphere sky colour, lifted a little so silhouettes are never pure black
    u.uSkyLight.value.copy(pal.hemiSky).multiplyScalar(pal.hemiIntensity * 0.9 + 0.05);
    renderer.getDrawingBufferSize(drawSize);
    u.uProj.value = drawSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  }
  syncLight();

  life.stats.buildMs = Math.round(performance.now() - t0);
  await nextFrame();

  return {
    order: 20,
    update(dt, elapsed) {
      syncLight();
      for (let i = 0; i < systems.length; i++) systems[i].update(dt, elapsed);
    },
  };
}
