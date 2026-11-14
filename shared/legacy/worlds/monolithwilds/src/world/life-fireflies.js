// Fireflies: a pool of glow-points living in the forests around the camera at night.
// The CPU only recycles anchors (a few per frame) when they fall out of range: candidates are
// drawn in a disc around the camera and kept with a probability given by the shared forest
// density (biome.js, cached on a coarse grid so each cell costs one evaluation ever). The GPU does
// the rest: a slow wandering orbit around the anchor and a species-like blink (quick rise, slow
// fade, long dark pauses), with a soft halo that blooms.

import * as THREE from 'crownfall-world-three';
import { forestDensity } from '../core/biome.js';
import { LIFE_VERT_UNIFORMS, LIFE_FRAG_UNIFORMS } from './life-common.js';

const FLY_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
uniform float uStrength;
uniform float uRadius;
attribute vec4 aRand;
varying float vI;
varying float vCore;
#include <fog_pars_vertex>
void main() {
  float t = uLifeTime.x;
  vec4 r = aRand;
  vec3 wander = vec3(
    sin(t * (0.19 + 0.12 * r.x) + r.y * 6.28) * 2.4 + sin(t * 0.53 + r.z * 9.0) * 0.7,
    sin(t * (0.15 + 0.1 * r.y) + r.z * 6.28) * 0.8 + sin(t * 0.61 + r.x * 5.0) * 0.25,
    cos(t * (0.17 + 0.12 * r.z) + r.x * 6.28) * 2.4 + cos(t * 0.47 + r.y * 7.0) * 0.7);
  vec3 wp = position + wander;
  // blink: quick rise, slower fade, dark pause; a third of them double-flash
  float period = 2.6 + 4.2 * r.x;
  float f = fract(t / period + r.y);
  float flash = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.07, 0.3, f));
  float f2 = f - 0.36;
  flash += step(0.66, r.w) * smoothstep(0.0, 0.04, f2) * (1.0 - smoothstep(0.05, 0.22, f2)) * 0.8;
  float glow = 0.035 + flash;
  float dist = max(length(wp - cameraPosition), 1e-3);
  float fade = uStrength * (1.0 - smoothstep(uRadius * 0.55, uRadius, dist)) * smoothstep(0.8, 3.0, dist);
  float core = 0.05 * uProj / dist;           // body light size in px
  float size = clamp(core * 9.0, 3.0, 48.0);  // halo sprite
  gl_PointSize = size;
  vCore = clamp(core / size, 0.05, 0.5);
  // sub-pixel cores keep their energy
  vI = glow * fade * clamp(core * core, 0.35, 1.0);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FLY_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
uniform vec3 uColor;
varying float vI;
varying float vCore;
#include <fog_pars_fragment>
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(vCore * 0.6, vCore * 1.6 + 0.06, d);
  float halo = exp(-d * d * 7.0) * 0.22 + exp(-d * 3.5) * 0.06;
  gl_FragColor = vec4(uColor * vI * (core * 7.0 + halo * 4.0) * (1.0 - smoothstep(0.85, 1.0, d)), 1.0);
  #ifdef USE_FOG
    vec4 fogT = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    gl_FragColor.rgb *= 1.0 - fogT.a;
  #endif
}
`;

const CELL = 14; // forest-density cache cell (m)

export function buildFireflies(ctx, shared) {
  const rng = ctx.noise.createRng('life-fireflies');
  const q = ctx.quality.level;
  const N = q === 'low' ? 110 : q === 'medium' ? 240 : 380;
  const RADIUS = q === 'low' ? 85 : 120;

  const pos = new Float32Array(N * 3).fill(0);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -1e5; // dormant until spawned
  const rnd = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) rnd[i] = rng();
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));

  const uStrength = { value: 0 };
  const material = new THREE.ShaderMaterial({
    name: 'life-fireflies',
    uniforms: {
      ...ctx.fogUniforms(),
      ...shared,
      uStrength,
      uRadius: { value: RADIUS },
      uColor: { value: new THREE.Color('#d6ff7e') },
    },
    vertexShader: FLY_VS,
    fragmentShader: FLY_FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Points(geo, material);
  mesh.name = 'life-fireflies';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;

  // ------------------------------------------------------------------ forest cache
  const cache = new Map();
  let missBudget = 0;
  function forestAt(x, z) {
    const ix = Math.round(x / CELL);
    const iz = Math.round(z / CELL);
    const k = (ix + 20000) * 40000 + (iz + 20000);
    let v = cache.get(k);
    if (v === undefined) {
      if (missBudget <= 0) return -1; // unknown yet: try again next frame
      missBudget--;
      const cx = ix * CELL;
      const cz = iz * CELL;
      const h = ctx.heightAt(cx, cz);
      v = h < 0.8 ? 0 : forestDensity(cx, cz, h);
      if (cache.size > 60000) cache.clear();
      cache.set(k, v);
    }
    return v;
  }

  // ------------------------------------------------------------------ pool recycling
  const cam = ctx.camera.position;
  let cursor = 0;
  let dirty = false;
  function respawn(i) {
    const a = rng() * Math.PI * 2;
    const d = RADIUS * Math.sqrt(0.02 + 0.98 * rng());
    const x = cam.x + Math.cos(a) * d;
    const z = cam.z + Math.sin(a) * d;
    const f = forestAt(x, z);
    if (f < 0) return false; // cache miss over budget: leave as is
    // dense forest and its edges; a few stragglers in open meadows
    if (rng() > f * 0.95 + 0.03) {
      pos[i * 3 + 1] = -1e5;
      pos[i * 3] = x;
      pos[i * 3 + 2] = z;
      return true;
    }
    const h = ctx.heightAt(x, z);
    if (h < 0.5) return false;
    const r = rng();
    pos[i * 3] = x;
    pos[i * 3 + 1] = h + (r < 0.8 ? 0.6 + 3.2 * rng() : 4 + 7 * rng());
    pos[i * 3 + 2] = z;
    return true;
  }

  const R2 = RADIUS * RADIUS * 1.15 * 1.15;
  const last = new THREE.Vector3(1e9, 0, 0);
  let wasVisible = false;
  return {
    mesh,
    count: N,
    update() {
      const env = ctx.env;
      const hag = cam.y - ctx.surfaceAt(cam.x, cam.z);
      const s = THREE.MathUtils.smoothstep(env.night, 0.35, 0.75) * (1 - THREE.MathUtils.smoothstep(hag, 50, 150));
      uStrength.value = s;
      mesh.visible = s > 0.003;
      if (!mesh.visible) {
        wasVisible = false;
        return;
      }
      // recycle a slice of the pool: anchors out of range (or dormant ones whose cell has left
      // the disc) get a new place; never more than a handful of new density evaluations per
      // frame — except after a teleport / when night falls, where one burst refills the pool
      const burst = !wasVisible || last.distanceToSquared(cam) > RADIUS * RADIUS * 0.25;
      wasVisible = true;
      last.copy(cam);
      missBudget = burst ? 500 : 5;
      const K = burst ? N * 2 : Math.min(N, 28);
      for (let k = 0; k < K; k++) {
        const i = cursor;
        cursor = (cursor + 1) % N;
        const dx = pos[i * 3] - cam.x;
        const dz = pos[i * 3 + 2] - cam.z;
        const far = dx * dx + dz * dz > R2;
        const dormant = pos[i * 3 + 1] < -1e4;
        if (far || (dormant && (burst || (k & 3) === 0))) {
          if (respawn(i)) dirty = true;
        }
      }
      if (dirty) {
        posAttr.needsUpdate = true;
        dirty = false;
      }
    },
  };
}
