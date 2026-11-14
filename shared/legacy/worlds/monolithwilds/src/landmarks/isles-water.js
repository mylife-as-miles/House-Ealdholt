// Unmoored Isles — falls that pour off the isles and dissolve into mist in mid-air, mist puffs
// where they give out, and soft cloud wisps clinging under the isles. All animation is in the
// shaders (uAtmoTime); every vertex follows its isle through the shared slot matrices.

import * as THREE from 'crownfall-world-three';
import { NSLOT, setBounds } from './isles-geo.js';

const NOISE_GLSL = /* glsl */ `
float iwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float iwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(iwHash(i), iwHash(i + vec2(1.0, 0.0)), f.x), mix(iwHash(i + vec2(0.0, 1.0)), iwHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FALL_VERT = /* glsl */ `
attribute vec4 aInfo; // layer, drop, seed, slot
uniform mat4 uIsleM[${NSLOT}];
varying vec2 vUv;
varying vec3 vInfo;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vInfo = aInfo.xyz;
  vec4 mvPosition = modelViewMatrix * (uIsleM[int(aInfo.w + 0.5)] * vec4(position, 1.0));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vInfo;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float d = vUv.y;
  float drop = vInfo.y;
  float layer = vInfo.x;
  float seed = vInfo.z;
  float t = uAtmoTime.x;
  float night = uAtmoTime.y;
  float fall = clamp(d / drop, 0.0, 1.0);
  float age = sqrt(2.0 * max(d, 0.0) / 9.8);
  float s = age - t * 0.85;
  float x = vUv.x;
  float n1 = iwNoise(vec2(x * 16.0 + seed, s * 1.6));
  float n2 = iwNoise(vec2(x * 41.0 + seed * 3.1, s * 3.9 + 7.0));
  float n3 = iwNoise(vec2(x * 6.0 - seed, s * 0.75 + 3.0));
  float streak = n1 * 0.5 + n2 * 0.28 + n3 * 0.34;
  // glassy sheet at the lip -> separate strands -> spray -> nothing
  float thr = mix(0.1, 0.86, smoothstep(0.0, 0.7, fall));
  float body = smoothstep(thr - 0.2, thr + 0.2, streak);
  float ew = 0.1 + 0.3 * fall;
  float edge = smoothstep(0.0, ew, x + (n3 - 0.5) * 0.14) * smoothstep(1.0, 1.0 - ew, x - (n1 - 0.5) * 0.14);
  float fade = 1.0 - smoothstep(0.32, 0.9, fall);
  float a = body * edge * fade * mix(0.95, 0.5, fall);
  if (layer > 0.5) a = (0.2 + 0.55 * n3) * edge * smoothstep(0.03, 0.3, fall) * (1.0 - smoothstep(0.45, 1.0, fall)) * 0.42;
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 4.0);
  float day = 1.0 - night;
  vec3 col = uAtmoFogColor * 0.55 + vec3(0.2, 0.23, 0.27) * day + uAtmoSunColor * (0.5 + 2.2 * fwd);
  // moonlit silver at night
  col += vec3(0.05, 0.075, 0.11) * night * (0.7 + 0.6 * n2);
  col *= 0.85 + 0.3 * n2;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

const MIST_VERT = /* glsl */ `
attribute vec4 aPuff;   // size, seed, phase, alpha
attribute vec3 aCorner; // corner xy, slot
uniform vec4 uAtmoTime;
uniform mat4 uIsleM[${NSLOT}];
varying vec2 vC;
varying vec2 vP;
#include <fog_pars_vertex>
void main() {
  vec3 c = position;
  float t = uAtmoTime.x;
  c.x += sin(t * 0.04 + aPuff.z) * aPuff.x * 0.25;
  c.y += sin(t * 0.027 + aPuff.z * 1.7) * aPuff.x * 0.12;
  c.z += cos(t * 0.035 + aPuff.z) * aPuff.x * 0.25;
  vec4 mvPosition = modelViewMatrix * (uIsleM[int(aCorner.z + 0.5)] * vec4(c, 1.0));
  float rot = (aPuff.y - 0.5) * 0.8 + t * 0.01 * (aPuff.y - 0.5);
  float cr = cos(rot), sr = sin(rot);
  vec2 k = vec2(cr * aCorner.x - sr * aCorner.y, sr * aCorner.x + cr * aCorner.y);
  mvPosition.xy += vec2(k.x * 1.25, k.y * 0.8) * aPuff.x;
  vC = aCorner.xy;
  vP = vec2(aPuff.y, aPuff.w);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
varying vec2 vC;
varying vec2 vP;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float r = length(vC);
  if (vP.y < 0.0) {
    // lantern halo: invisible by day, a soft warm bloom at night
    float h = exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r));
    gl_FragColor = vec4(vec3(1.0, 0.58, 0.26) * 1.6, h * -vP.y * smoothstep(0.2, 0.9, uAtmoTime.y));
    #include <fog_fragment>
    return;
  }
  float a = 1.0 - smoothstep(0.1, 1.0, r);
  float n = iwNoise(vC * 2.3 + vP.x * 17.0 + uAtmoTime.x * 0.01) * 0.6 + iwNoise(vC * 5.3 - vP.x * 9.0) * 0.4;
  a *= a * (0.4 + 0.8 * n) * vP.y;
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 3.0);
  float night = uAtmoTime.y;
  vec3 col = uAtmoFogColor * 0.6 + vec3(0.2, 0.22, 0.26) * (1.0 - night) + uAtmoSunColor * (0.5 + 1.6 * fwd);
  col += vec3(0.03, 0.045, 0.07) * night;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

/**
 * falls: [{slot, x, y, z, a (outward yaw), w, drop, v0}]; clouds: [{slot, x, y, z, size, alpha}]
 */
export function buildWater(ctx, U, rng, falls, clouds) {
  let triangles = 0;
  const P = [], UV = [], INFO = [], IDX = [];
  let vc = 0;
  const K = 48, COLS = 4;
  const mist = [];
  for (const f of falls) {
    const ox = Math.sin(f.a), oz = Math.cos(f.a);
    const tx = Math.cos(f.a), tz = -Math.sin(f.a);
    const seed = rng() * 50;
    for (let layer = 0; layer < 2; layer++) {
      const base0 = vc;
      for (let k = 0; k <= K; k++) {
        const fk = k / K;
        const d = f.drop * Math.pow(fk, 1.6);
        const hOff = f.v0 * Math.sqrt((2 * d) / 9.8) + (layer ? 1.0 + d * 0.025 : 0);
        const w = f.w * (1 + d / 90) * (layer ? 1.8 : 1) + (layer ? 2.5 : 0);
        const wob = Math.sin(d * 0.03 + seed) * d * 0.025;
        for (let c = 0; c <= COLS; c++) {
          const fc = c / COLS;
          const across = (fc - 0.5) * w;
          P.push(f.x + ox * hOff + tx * (across + wob), f.y - d, f.z + oz * hOff + tz * (across + wob));
          UV.push(fc, d);
          INFO.push(layer, f.drop, seed + layer * 13, f.slot);
          vc++;
        }
      }
      for (let k = 0; k < K; k++) {
        for (let c = 0; c < COLS; c++) {
          const a0 = base0 + k * (COLS + 1) + c;
          const b0 = a0 + COLS + 1;
          IDX.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        }
      }
    }
    // mist where the fall gives out
    for (let i = 0; i < 7; i++) {
      const fr = 0.35 + rng() * 0.55;
      const d = f.drop * fr;
      const hOff = f.v0 * Math.sqrt((2 * d) / 9.8) + 2;
      mist.push({ slot: f.slot, x: f.x + ox * hOff + (rng() - 0.5) * 10, y: f.y - d, z: f.z + oz * hOff + (rng() - 0.5) * 10, size: 8 + fr * 16 + rng() * 5, alpha: 0.34 * (1 - fr * 0.4) });
    }
    mist.push({ slot: f.slot, x: f.x + ox * 3, y: f.y - 4, z: f.z + oz * 3, size: 4 + f.w, alpha: 0.25 });
  }
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  fallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  fallGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(INFO, 4));
  fallGeo.setIndex(IDX);
  setBounds(fallGeo, fallGeo.attributes.position.array, 30);
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms(), uIsleM: U },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fallMesh = new THREE.Mesh(fallGeo, fallMat);
  fallMesh.name = 'isles:falls';
  fallMesh.renderOrder = 2;
  triangles += IDX.length / 3;

  // --- mist puffs + cloud wisps --------------------------------------------------------------
  for (const c of clouds) mist.push(c);
  const MP = [], MC = [], MA = [], MI = [];
  let mv = 0;
  for (const m of mist) {
    const seed = rng();
    const phase = rng() * 6.28;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      MP.push(m.x, m.y, m.z);
      MC.push(cx, cy, m.slot);
      MA.push(m.size, seed, phase, m.alpha);
    }
    MI.push(mv, mv + 1, mv + 2, mv, mv + 2, mv + 3);
    mv += 4;
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.Float32BufferAttribute(MP, 3));
  mistGeo.setAttribute('aCorner', new THREE.Float32BufferAttribute(MC, 3));
  mistGeo.setAttribute('aPuff', new THREE.Float32BufferAttribute(MA, 4));
  mistGeo.setIndex(MI);
  setBounds(mistGeo, mistGeo.attributes.position.array, 80);
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms(), uIsleM: U },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const mistMesh = new THREE.Mesh(mistGeo, mistMat);
  mistMesh.name = 'isles:mist';
  mistMesh.renderOrder = 3;
  triangles += MI.length / 3;
  return { meshes: [fallMesh, mistMesh], triangles };
}
