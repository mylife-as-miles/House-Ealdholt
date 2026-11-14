// Honeycomb Cloister — water: falls that spill from high cells, arc away from the face, thin into
// strands and spray over ~300 m, and land in rock-cut basins at the foot in a boil of mist.
//
// Falls + basins: one merged geometry (layer 0 core sheet, 1 crossed sheet for side views,
// 2 spray veil, 3 basin surface) with a shader that scrolls streak noise in "fall age" space
// (age = sqrt(2 d / g)) so the streaks accelerate as they drop. Mist: camera-facing puffs expanded
// in the vertex shader, drifting slowly. All motion is in the shaders.

import * as THREE from 'crownfall-world-three';

const NOISE = /* glsl */ `
float mwwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mwwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mwwHash(i), mwwHash(i + vec2(1.0, 0.0)), f.x), mix(mwwHash(i + vec2(0.0, 1.0)), mwwHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FALL_VERT = /* glsl */ `
attribute vec4 aInfo; // layer, drop (total), seed, unused
varying vec2 vUv;
varying vec4 vInfo;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vInfo = aInfo;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vInfo;
#include <fog_pars_fragment>
${NOISE}
void main() {
  float layer = vInfo.x;
  float drop = vInfo.y;
  float seed = vInfo.z;
  float t = uAtmoTime.x;
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 4.0);
  float night = uAtmoTime.y;
  vec3 lit = uAtmoFogColor * 0.55 + vec3(0.2, 0.22, 0.25) * (1.0 - night) + uAtmoSunColor * (0.45 + 2.2 * fwd) * (1.0 - night);
  lit += vec3(0.05, 0.07, 0.1) * night;
  float a;
  if (layer > 2.5) {
    // basin: dark water, churned white where the fall lands (uv = radial 0..1, angle)
    float r = vUv.x;
    float n = mwwNoise(vec2(vUv.y * 24.0 + seed, r * 9.0 - t * 1.6));
    float n2 = mwwNoise(vec2(vUv.y * 60.0 - seed, r * 21.0 - t * 2.3));
    float foam = smoothstep(0.75, 0.0, r) * (0.45 + 0.55 * n) + smoothstep(0.6, 0.9, n2) * 0.25 * (1.0 - r);
    vec3 water = mix(vec3(0.03, 0.05, 0.055), uAtmoFogColor * 0.35, 0.35 + 0.3 * pow(1.0 - abs(V.y), 3.0));
    vec3 col = mix(water, lit * 1.1, clamp(foam, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    return;
  }
  float d = vUv.y; // metres fallen
  float fall = clamp(d / drop, 0.0, 1.0);
  float age = sqrt(2.0 * max(d, 0.0) / 9.8);
  float s = age - t * 0.85;
  float x = vUv.x;
  float n1 = mwwNoise(vec2(x * 16.0 + seed, s * 1.6));
  float n2 = mwwNoise(vec2(x * 43.0 + seed * 3.1, s * 3.9 + 7.0));
  float n3 = mwwNoise(vec2(x * 6.0 - seed, s * 0.7 + 3.0));
  float streak = n1 * 0.5 + n2 * 0.3 + n3 * 0.34;
  float edgeW = 0.1 + 0.3 * fall;
  float edge = smoothstep(0.0, edgeW, x + (n3 - 0.5) * 0.14) * smoothstep(1.0, 1.0 - edgeW, x - (n1 - 0.5) * 0.14);
  if (layer < 1.5) {
    // the sheet: solid near the lip, parting into strands, fading into spray
    float thr = mix(0.1, 0.78, smoothstep(0.02, 0.8, fall));
    float body = smoothstep(thr - 0.18, thr + 0.2, streak);
    a = body * edge * (1.0 - smoothstep(0.55, 1.0, fall) * 0.75) * mix(0.95, 0.6, fall);
    if (layer > 0.5) a *= 0.8;
  } else {
    // spray veil: soft, widening, strongest in the lower half
    a = (0.25 + 0.55 * n3) * edge * smoothstep(0.05, 0.45, fall) * 0.42;
  }
  vec3 col = lit * (0.86 + 0.3 * n2);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

const MIST_VERT = /* glsl */ `
attribute vec4 aPuff;   // size, seed, rise speed, alpha
attribute vec2 aCorner;
uniform vec4 uAtmoTime;
varying vec2 vC;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float t = uAtmoTime.x;
  float cyc = fract(t * aPuff.z + aPuff.y);
  vec3 p = position;
  p.y += cyc * aPuff.x * 1.6;
  p.x += sin(t * 0.13 + aPuff.y * 30.0) * aPuff.x * 0.35;
  p.z += cos(t * 0.11 + aPuff.y * 17.0) * aPuff.x * 0.25;
  float size = aPuff.x * (0.7 + 0.6 * cyc);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  mvPosition.xy += aCorner * size;
  gl_Position = projectionMatrix * mvPosition;
  vC = aCorner;
  vA = aPuff.w * smoothstep(0.0, 0.2, cyc) * (1.0 - smoothstep(0.55, 1.0, cyc));
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
varying vec2 vC;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float r = length(vC);
  float a = vA * smoothstep(1.0, 0.1, r);
  if (a < 0.004) discard;
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 3.0);
  float night = uAtmoTime.y;
  vec3 col = uAtmoFogColor * 0.8 + vec3(0.16, 0.17, 0.19) * (1.0 - night) + uAtmoSunColor * (0.3 + 1.6 * fwd) * (1.0 - night);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

/**
 * falls: [{ x, y, z, yaw, width, drop, v0 (outward speed m/s), seed, groundY }]
 * Returns { objects, triangles }.
 */
export function buildWater(ctx, falls) {
  const P = [], UV = [], INFO = [], I = [];
  let v = 0;
  const quad = (a, b, c, d, uva, uvb, uvc, uvd, info) => {
    P.push(...a, ...b, ...c, ...d);
    UV.push(...uva, ...uvb, ...uvc, ...uvd);
    for (let k = 0; k < 4; k++) INFO.push(...info);
    I.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  const mist = [];
  const rng = ctx.noise.createRng('monastery-water');

  for (const f of falls) {
    const nx = Math.sin(f.yaw), nz = Math.cos(f.yaw); // outward
    const tx = Math.cos(f.yaw), tz = -Math.sin(f.yaw); // along the face
    const segs = 36;
    const drop = f.y - f.groundY;
    // trajectory: out = v0 * t, down = g t^2 / 2 (sampled uniformly in fallen distance)
    const pt = (d) => {
      const tt = Math.sqrt((2 * d) / 9.8);
      const out = f.v0 * tt;
      return [f.x + nx * out, f.y - d, f.z + nz * out];
    };
    for (const layer of [0, 1, 2]) {
      for (let s = 0; s < segs; s++) {
        const d0 = drop * Math.pow(s / segs, 1.3), d1 = drop * Math.pow((s + 1) / segs, 1.3);
        const p0 = pt(d0), p1 = pt(d1);
        const w0 = f.width * (1 + (d0 / drop) * (layer === 2 ? 3.2 : 1.1)) * (layer === 1 ? 0.45 : 1) * (layer === 2 ? 1.4 : 1);
        const w1 = f.width * (1 + (d1 / drop) * (layer === 2 ? 3.2 : 1.1)) * (layer === 1 ? 0.45 : 1) * (layer === 2 ? 1.4 : 1);
        // layer 1 is turned 90 degrees (seen from the sides); layer 2 sits slightly in front
        const ax = layer === 1 ? nx : tx, az = layer === 1 ? nz : tz;
        const off = layer === 2 ? 1.5 : 0;
        const a = [p0[0] - ax * w0 / 2 + nx * off, p0[1], p0[2] - az * w0 / 2 + nz * off];
        const b = [p0[0] + ax * w0 / 2 + nx * off, p0[1], p0[2] + az * w0 / 2 + nz * off];
        const c = [p1[0] + ax * w1 / 2 + nx * off, p1[1], p1[2] + az * w1 / 2 + nz * off];
        const d = [p1[0] - ax * w1 / 2 + nx * off, p1[1], p1[2] - az * w1 / 2 + nz * off];
        const info = [layer, drop, f.seed + layer * 3.1, 0];
        quad(a, b, c, d, [0, d0], [1, d0], [1, d1], [0, d1], info);
      }
    }
    // basin surface where the water lands (radial fan)
    const land = pt(drop);
    const br = f.width * 2.6 + 6;
    const segA = 18;
    const by = f.groundY + 0.15;
    for (let k = 0; k < segA; k++) {
      const a0 = (k / segA) * Math.PI * 2, a1 = ((k + 1) / segA) * Math.PI * 2;
      for (let r = 0; r < 2; r++) {
        const r0 = (r / 2) * br, r1 = ((r + 1) / 2) * br;
        const pA = [land[0] + Math.cos(a0) * r0, by, land[2] + Math.sin(a0) * r0];
        const pB = [land[0] + Math.cos(a0) * r1, by, land[2] + Math.sin(a0) * r1];
        const pC = [land[0] + Math.cos(a1) * r1, by, land[2] + Math.sin(a1) * r1];
        const pD = [land[0] + Math.cos(a1) * r0, by, land[2] + Math.sin(a1) * r0];
        quad(pA, pD, pC, pB, [r / 2, k / segA], [r / 2, (k + 1) / segA], [(r + 1) / 2, (k + 1) / segA], [(r + 1) / 2, k / segA], [3, drop, f.seed, 0]);
      }
    }
    f.land = land;
    f.basinR = br;
    // mist: a boil at the foot and a thinner veil drifting along the lower third
    for (let i = 0; i < 26; i++) {
      const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * br * 1.3;
      mist.push([land[0] + Math.cos(ang) * rr, f.groundY + 2 + rng() * 10, land[2] + Math.sin(ang) * rr, 9 + rng() * 14, rng(), 0.012 + rng() * 0.02, 0.22 + rng() * 0.18]);
    }
    for (let i = 0; i < 14; i++) {
      const dd = drop * (0.55 + rng() * 0.4);
      const p = pt(dd);
      mist.push([p[0] + (rng() - 0.5) * f.width * 2, p[1], p[2] + (rng() - 0.5) * 6, 6 + rng() * 9, rng(), 0.01 + rng() * 0.015, 0.1 + rng() * 0.1]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(INFO, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms() },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fallMesh = new THREE.Mesh(g, fallMat);
  fallMesh.name = 'monastery:falls';
  fallMesh.renderOrder = 1;
  fallMesh.matrixAutoUpdate = false;

  // mist puffs
  const mp = [], mc = [], mi = [], mI = [];
  let mv = 0;
  for (const m of mist) {
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      mp.push(m[0], m[1], m[2]);
      mc.push(cx, cy);
      mi.push(m[3], m[4], m[5], m[6]);
    }
    mI.push(mv, mv + 1, mv + 2, mv, mv + 2, mv + 3);
    mv += 4;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  mg.setAttribute('aCorner', new THREE.Float32BufferAttribute(mc, 2));
  mg.setAttribute('aPuff', new THREE.Float32BufferAttribute(mi, 4));
  mg.setIndex(mI);
  mg.computeBoundingSphere();
  mg.boundingSphere.radius += 40;
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms() },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const mistMesh = new THREE.Mesh(mg, mistMat);
  mistMesh.name = 'monastery:mist';
  mistMesh.renderOrder = 2;
  mistMesh.matrixAutoUpdate = false;

  return { objects: [fallMesh, mistMesh], triangles: I.length / 3 + mI.length / 3 };
}
