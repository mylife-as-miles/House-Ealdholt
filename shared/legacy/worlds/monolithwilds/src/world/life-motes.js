// Drifting dust motes, pollen and seed fluff around the camera, glinting when the air between the
// eye and the sun is lit. The particles live in a box that wraps around the camera in the vertex
// shader (no CPU work): they drift with the wind and wobble; brightness follows a forward-
// scattering phase function (bright when looking toward the sun) plus rare twinkles from flat
// seeds turning in the light. Faded out high above the ground and when the camera stands in the
// shadow of the terrain (a few heightfield samples toward the sun, every few frames).

import * as THREE from 'crownfall-world-three';
import { LIFE_VERT_UNIFORMS, LIFE_FRAG_UNIFORMS } from './life-common.js';

const MOTE_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
uniform vec3 uBox;
uniform float uStrength;
attribute vec4 aRand; // x size, y twinkle rate, z phase, w kind (0 dust, 1 seed fluff)
varying vec3 vCol;
varying float vSoft;
#include <fog_pars_vertex>
void main() {
  float t = uLifeTime.x;
  float fluff = aRand.w;
  vec3 wind = vec3(0.5, 0.03, -0.2) * (0.5 + uLifeTime.z) * mix(1.0, 0.55, fluff);
  vec3 p = position * uBox + wind * t * (0.7 + 0.6 * aRand.x);
  p += vec3(sin(t * 0.31 + aRand.z * 6.28), 0.7 * sin(t * 0.23 + aRand.z * 17.0), sin(t * 0.27 + aRand.z * 11.0)) * (0.5 + aRand.x);
  p.y += fluff * 0.4 * sin(t * 0.11 + aRand.z * 5.0);
  vec3 rel = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 wp = cameraPosition + rel;
  float dist = max(length(rel), 1e-3);
  float fade = (1.0 - smoothstep(0.32 * uBox.x, 0.5 * uBox.x, dist)) * smoothstep(0.35, 1.6, dist);
  fade *= 1.0 - smoothstep(0.3 * uBox.y, 0.5 * uBox.y, abs(rel.y));
  vec3 V = rel / dist;
  float mu = max(dot(V, uKeyDir), 0.0);
  float mu2 = mu * mu;
  float mu8 = mu2 * mu2; mu8 *= mu8;
  float phase = 0.06 + 0.55 * mu2 * mu2 + 2.2 * mu8 * mu8 * mu;
  float tw = 0.5 + 0.5 * sin(t * aRand.y + aRand.z * 40.0);
  tw = tw * tw; tw *= tw; tw *= tw; tw *= tw;
  float bright = phase * (0.35 + mix(3.5, 1.2, fluff) * tw);
  float worldSize = mix(0.01, 0.045, fluff) * (0.6 + aRand.x);
  float px = worldSize * uProj / dist;
  float size = max(px, 1.0) + fluff * 1.6;
  // sub-pixel motes: keep their energy, not their size
  float cover = clamp(px * px, 0.06, 1.0);
  gl_PointSize = size;
  vSoft = fluff;
  vCol = uSunLight * (bright * cover * fade * uStrength * mix(0.55, 0.3, fluff));
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MOTE_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
varying vec3 vCol;
varying float vSoft;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = mix(1.0 - smoothstep(0.55, 1.0, r2), exp(-r2 * 3.5), vSoft);
  gl_FragColor = vec4(vCol * a, 1.0);
  #ifdef USE_FOG
    vec4 fogT = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    gl_FragColor.rgb *= 1.0 - fogT.a;
  #endif
}
`;

export function buildMotes(ctx, shared) {
  const rng = ctx.noise.createRng('life-motes');
  const q = ctx.quality.level;
  const N = q === 'low' ? 350 : q === 'medium' ? 800 : 1300;
  const pos = new Float32Array(N * 3);
  const rnd = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rng();
    pos[i * 3 + 1] = rng();
    pos[i * 3 + 2] = rng();
    rnd[i * 4] = rng();
    rnd[i * 4 + 1] = rng.range(0.4, 2.2);
    rnd[i * 4 + 2] = rng();
    rnd[i * 4 + 3] = rng() < 0.14 ? 1 : 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));

  const uStrength = { value: 1 };
  const material = new THREE.ShaderMaterial({
    name: 'life-motes',
    uniforms: { ...ctx.fogUniforms(), ...shared, uBox: { value: new THREE.Vector3(30, 16, 30) }, uStrength },
    vertexShader: MOTE_VS,
    fragmentShader: MOTE_FS,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Points(geo, material);
  mesh.name = 'life-motes';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  // ------------------------------------------------------------------ per-frame strength
  const cam = ctx.camera.position;
  const key = ctx.env.keyDir;
  const MARCH = [18, 40, 75, 120, 190, 290, 430, 620, 880, 1250, 1750];
  let lit = 1;
  let litTarget = 1;
  let frame = 0;
  function sunVisible() {
    for (let i = 0; i < MARCH.length; i++) {
      const d = MARCH[i];
      const y = cam.y + key.y * d;
      if (ctx.heightAt(cam.x + key.x * d, cam.z + key.z * d) > y) return 0;
    }
    return 1;
  }

  return {
    mesh,
    count: N,
    update(dt) {
      // re-check the sun every 6 frames (one heightfield ray ≈ 11 samples)
      if (frame++ % 6 === 0) litTarget = sunVisible();
      lit += (litTarget - lit) * Math.min(1, dt * 1.5);
      const hag = cam.y - ctx.surfaceAt(cam.x, cam.z);
      const low = 1 - THREE.MathUtils.smoothstep(hag, 45, 180);
      const env = ctx.env;
      // by day: sunlit dust; at night only a whisper of moonlit motes
      uStrength.value = low * (0.2 + 0.8 * lit) * (1 - 0.75 * env.night);
      mesh.visible = uStrength.value > 0.003;
    },
  };
}
