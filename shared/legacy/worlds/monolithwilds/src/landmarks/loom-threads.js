// The Loom of Hours — thread system.
//
// Thousands of hanging threads/cables rendered as ONE mesh of camera-facing ribbons:
//   * each thread is a polyline; every point becomes two vertices (left/right of the axis),
//   * the vertex shader turns the ribbon toward the camera around the thread axis, gives it a
//     round-looking normal, and widens it to at least ~1 px while fading its alpha by the true
//     coverage (so a 30 cm cable 2 km away becomes a faint, stable hairline instead of aliasing),
//   * a per-vertex sway weight + per-thread phase drives a slow wind sway (same GLSL function as
//     the hanging weights, so bobbins follow their threads exactly),
//   * a few threads carry an amber emissive core that wakes at night.
// Lighting is the stock MeshStandardMaterial (sun, hemi, env map, fog) — only the vertex stage
// and a little of the fragment stage are patched.

import * as THREE from 'crownfall-world-three';

/** Shared sway function (GLSL). w = sway amplitude (m), ph = phase, y = rest height. */
export const LOOM_SWAY_GLSL = /* glsl */ `
uniform vec4 uLoomTime; // x seconds, y night, z wind 0..1, w hour
vec3 loomSway(float w, float ph, float y) {
  float t = uLoomTime.x;
  float k = w * (0.55 + 1.3 * uLoomTime.z);
  float a = t * 0.19 + ph;
  float b = t * 0.31 + ph * 1.7 - y * 0.012;
  return k * vec3(sin(a) + 0.35 * sin(b), 0.0, 0.55 * sin(a * 0.77 + 1.3 + ph * 0.5) + 0.25 * sin(b * 1.21 + 0.4));
}
`;

const THREAD_VERT_PARS = /* glsl */ `
${LOOM_SWAY_GLSL}
attribute vec3 aTan;   // rest tangent
attribute vec4 aThr;   // x side (-1|1), y sway weight, z radius, w phase
attribute vec3 aRope;  // x twist coordinate, y glow, z along (m)
uniform float uLoomPx; // world size of one pixel at 1 m distance
varying float vLoomCov;
varying vec3 vLoomRope;
`;

// Replaces <beginnormal_vertex>: computes the displaced ribbon vertex and its normal.
const THREAD_VERT_MAIN = /* glsl */ `
  vec3 loomP = position + loomSway(aThr.y, aThr.w, position.y);
  vec3 loomT = normalize(aTan);
  vec3 loomW = (modelMatrix * vec4(loomP, 1.0)).xyz;
  vec3 loomV = cameraPosition - loomW;
  float loomD = length(loomV);
  loomV /= max(loomD, 1e-3);
  vec3 loomS = cross(loomT, loomV);
  float loomSl = length(loomS);
  loomS = loomSl > 1e-4 ? loomS / loomSl : vec3(1.0, 0.0, 0.0);
  float loomR = aThr.z;
  float loomRR = max(loomR, 0.62 * uLoomPx * loomD);
  vLoomCov = clamp(loomR / loomRR, 0.015, 1.0);
  vLoomRope = vec3(aThr.x, aRope.x, aRope.y);
  vec3 loomVp = loomV - loomT * dot(loomV, loomT);
  loomVp = length(loomVp) > 1e-4 ? normalize(loomVp) : loomV;
  loomP += loomS * (aThr.x * loomRR);
  vec3 objectNormal = normalize(loomS * aThr.x * 0.8 + loomVp * 0.6);
`;

const THREAD_FRAG_PARS = /* glsl */ `
varying float vLoomCov;
varying vec3 vLoomRope;
uniform vec4 uLoomTime;
`;

const THREAD_FRAG_COLOR = /* glsl */ `
  {
    // helical rope twist, only up close
    float lx = vLoomRope.x;
    float tw = fract(vLoomRope.y + lx * 0.3);
    float groove = smoothstep(0.0, 0.22, tw) * smoothstep(1.0, 0.72, tw);
    float nearF = 1.0 - smoothstep(25.0, 160.0, length(vViewPosition));
    diffuseColor.rgb *= mix(1.0, 0.55 + 0.45 * groove, nearF);
    diffuseColor.rgb *= 0.78 + 0.22 * sqrt(max(0.0, 1.0 - lx * lx));
    diffuseColor.a *= vLoomCov;
  }
`;

const THREAD_FRAG_EMISSIVE = /* glsl */ `
  if (vLoomRope.z > 0.0) {
    // light slowly travelling down the glowing threads at night
    float pulse = 0.55 + 0.45 * sin(uLoomTime.x * 0.45 - vLoomRope.y * 0.02 + vLoomRope.z * 17.0);
    float night = uLoomTime.y;
    totalEmissiveRadiance += vec3(1.0, 0.58, 0.26) * vLoomRope.z * pulse * (0.04 + 2.6 * night) * (0.35 + 0.65 * vLoomCov);
  }
`;

/**
 * Thread material: MeshStandardMaterial with the ribbon vertex stage.
 * Returns { material, uniforms } — uniforms.uLoomPx must be kept up to date (see update()).
 */
export function createThreadMaterial(ctx, { roughness = 0.5, metalness = 0.35 } = {}) {
  const uniforms = {
    uLoomTime: { value: ctx.atmo.time },
    uLoomPx: { value: 0.0015 },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    vertexColors: true,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  material.name = 'loom-threads';
  material.defaultAttributeValues = { color: [1, 1, 1] };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${THREAD_VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', THREAD_VERT_MAIN)
      .replace('#include <begin_vertex>', 'vec3 transformed = loomP;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${THREAD_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${THREAD_FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${THREAD_FRAG_EMISSIVE}`);
  };
  material.customProgramCacheKey = () => 'loom-threads-v1';
  return { material, uniforms };
}

/**
 * Accumulates thread polylines and bakes them into one ribbon BufferGeometry.
 * Points are world-space [x, y, z]; `sway` is a per-point amplitude array (m) or a function
 * s(0..1 along) -> amplitude.
 */
export class ThreadSet {
  constructor() {
    this.pos = [];
    this.tan = [];
    this.thr = [];
    this.rope = [];
    this.col = [];
    this.index = [];
    this.vcount = 0;
    this.threads = 0;
  }

  add(points, { radius = 0.3, phase = 0, sway = null, color = [0.3, 0.28, 0.26], glow = 0, twist = null } = {}) {
    const n = points.length;
    if (n < 2) return;
    // cumulative length
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const a = points[i - 1];
      const b = points[i];
      cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const L = cum[n - 1] || 1;
    const pitch = twist ?? Math.max(0.6, radius * 4.5);
    const base = this.vcount;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const pa = points[Math.max(0, i - 1)];
      const pb = points[Math.min(n - 1, i + 1)];
      let tx = pb[0] - pa[0];
      let ty = pb[1] - pa[1];
      let tz = pb[2] - pa[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const w = typeof sway === 'function' ? sway(cum[i] / L, i) : Array.isArray(sway) ? sway[i] : 0;
      for (let s = -1; s <= 1; s += 2) {
        this.pos.push(p[0], p[1], p[2]);
        this.tan.push(tx, ty, tz);
        this.thr.push(s, w, radius, phase);
        this.rope.push(cum[i] / pitch, glow, cum[i]);
        this.col.push(color[0], color[1], color[2]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      this.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.vcount += n * 2;
    this.threads++;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aThr', new THREE.Float32BufferAttribute(this.thr, 4));
    g.setAttribute('aRope', new THREE.Float32BufferAttribute(this.rope, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vcount > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    // sway can push vertices a few metres out
    g.boundingSphere.radius += 12;
    return g;
  }
}

/**
 * Patch an (instanced) library material so each instance is displaced by loomSway() using the
 * per-instance attribute aSway = (weight, phase, restY). Used for bobbins / loom weights.
 */
export function makeSwayingMaterial(ctx, material, key) {
  const base = material.onBeforeCompile;
  const uniforms = { uLoomTime: { value: ctx.atmo.time } };
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LOOM_SWAY_GLSL}\nattribute vec3 aSway;`)
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition.xyz += loomSway(aSway.x, aSway.y, aSway.z);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const prevKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${prevKey}-loomsway-${key}`;
  return material;
}

/** Attach the per-instance sway attribute to an InstancedMesh. data = [w, phase, restY] per instance. */
export function setInstanceSway(mesh, data) {
  const arr = new Float32Array(data.length * 3);
  for (let i = 0; i < data.length; i++) {
    arr[i * 3] = data[i][0];
    arr[i * 3 + 1] = data[i][1];
    arr[i * 3 + 2] = data[i][2];
  }
  mesh.geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(arr, 3));
}
