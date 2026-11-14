// Honeycomb Cloister — the constellation.
//
// Every lit cell, stair lamp and pavilion lantern also gets a soft additive point sprite whose
// on-screen size never drops below ~2.5 px: from the far side of the basin the cliff becomes a
// field of warm stars (bloom does the rest). Invisible by day, they swell in after dusk; each
// flickers on its own slow phase. One draw call, all animation in the shader.

import * as THREE from 'crownfall-world-three';

const VERT = /* glsl */ `
attribute vec3 aInfo; // world size (m), brightness, seed
uniform float uPxScale; // viewport height / (2 tan(fov/2))
uniform vec4 uAtmoTime;
varying float vB;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float d = max(1.0, -mvPosition.z);
  float px = aInfo.x * uPxScale / d;
  float night = uAtmoTime.y;
  // far away the sprite stays a few pixels wide but dims a little (it stands for a whole doorway)
  gl_PointSize = clamp(px, 2.6, 64.0);
  float t = uAtmoTime.x;
  float fl = 0.82 + 0.18 * sin(t * (0.9 + aInfo.z * 1.7) + aInfo.z * 40.0) * sin(t * 2.3 + aInfo.z * 17.0);
  vB = aInfo.y * fl * night * night * (0.55 + 0.45 * clamp(px / 2.6, 0.0, 1.0));
  vSeed = aInfo.z;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying float vB;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 7.0);
  float halo = (1.0 - r) * (1.0 - r) * 0.35;
  vec3 col = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.8, 0.52), core) * (core * 2.6 + halo);
  col *= vB;
  #ifdef USE_FOG
    vec4 f = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    col *= 1.0 - f.a * 0.92;
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildConstellation(ctx, lights) {
  const n = lights.length;
  const pos = new Float32Array(n * 3);
  const info = new Float32Array(n * 3);
  const rng = ctx.noise.createRng('monastery-stars');
  for (let i = 0; i < n; i++) {
    const l = lights[i];
    pos[i * 3] = l.x;
    pos[i * 3 + 1] = l.y;
    pos[i * 3 + 2] = l.z;
    info[i * 3] = l.size;
    info[i * 3 + 1] = l.b;
    info[i * 3 + 2] = rng();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  g.computeBoundingSphere();
  const uniforms = { ...ctx.fogUniforms(), uPxScale: { value: 500 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const setScale = () => {
    const h = ctx.renderer.domElement.height || window.innerHeight;
    uniforms.uPxScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
  };
  setScale();
  ctx.onResize(setScale);
  const pts = new THREE.Points(g, mat);
  pts.name = 'monastery:constellation';
  pts.frustumCulled = true;
  pts.renderOrder = 2;
  pts.matrixAutoUpdate = false;
  // fov may change (photo mode); cheap per-frame check without allocation
  let lastFov = ctx.camera.fov;
  const update = () => {
    if (ctx.camera.fov !== lastFov) {
      lastFov = ctx.camera.fov;
      setScale();
    }
  };
  return { object: pts, update };
}
