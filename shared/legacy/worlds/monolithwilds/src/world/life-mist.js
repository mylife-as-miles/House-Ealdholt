// Low mist banks pooling on the lake, in the Loom's valley, down the canyon, in the Orrery's
// crater, over the Choir plain and among the eastern forest.
//
// Construction: each pool is a flat sheet at the mist's top height, tessellated coarsely over its
// area and draped with the ground height below every vertex. The sheet is drawn several times
// (instanced layers, one draw call) at stepped heights inside the pool's thickness; each layer
// only exists where the ground lies below it, so the mist thins out softly up every shore and
// valley side instead of cutting the terrain with a hard line. Per fragment: two drifting noise
// octaves shape banks and holes, the layer's optical depth grows as the view grazes it (slab
// path length), and the colour is the atmosphere's own in-scatter + sun forward scattering, so
// the mist glows warm toward a low sun and silver-blue under the moon. Strength and coverage
// follow the hour (thickest at dawn, rising again at dusk and through the night).

import * as THREE from 'crownfall-world-three';
import { LIFE_VERT_UNIFORMS, LIFE_FRAG_UNIFORMS } from './life-common.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


// Pools. disc: centre + radius, top = absolute height of the mist top.
// path: polyline + half-width; top = lowest ground across the section + thick (auto).
const POOLS = [
  { id: 'lake', type: 'disc', x: 80, z: 40, r: 1080, top: 16, thick: 16, dens: 0.4, step: 30 },
  { id: 'loom-valley', type: 'path', pts: [[250, -2950], [265, -2300], [300, -1750], [260, -1250], [170, -850]], half: 330, thick: 42, dens: 0.9, step: 30 },
  { id: 'canyon', type: 'path', pts: [[2750, -2950], [2300, -1600], [1950, -720], [1720, 0], [1610, 520], [1230, 810], [800, 520]], half: 170, thick: 38, dens: 1.0, step: 28 },
  { id: 'crater', type: 'disc', x: -1800, z: 1150, r: 470, top: 60, thick: 34, dens: 1.0, step: 26 },
  { id: 'choir-plain', type: 'disc', x: -1650, z: -330, r: 850, top: 56, thick: 12, dens: 0.35, step: 38 },
  { id: 'east-forest', type: 'disc', x: 1250, z: 1550, r: 820, top: 86, thick: 26, dens: 0.4, step: 38 },
];

const MIST_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
uniform float uLayers;
attribute vec4 aMist;   // ground height, thickness, edge fade, density
attribute float aLayer; // instance: layer index (0 = lowest)
varying vec3 vWorld;
varying float vDepth;
varying float vThick;
varying float vEdge;
varying float vLayer;
#include <fog_pars_vertex>
void main() {
  float thick = aMist.y;
  float lf = (aLayer + 0.5) / uLayers;
  // stepped layers inside the pool; a slow swell keeps them from reading as flat floors
  float y = position.y - thick * (1.0 - lf) * 0.92;
  y += 1.6 * sin(position.x * 0.006 + uLifeTime.x * 0.05 + aLayer * 2.1) * sin(position.z * 0.005 - uLifeTime.x * 0.04);
  vec3 wp = vec3(position.x, y, position.z);
  vWorld = wp;
  vDepth = y - aMist.x;
  vThick = thick;
  vEdge = aMist.z * aMist.w;
  vLayer = aLayer;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
uniform sampler2D uNoise;
uniform float uLayers;
uniform vec3 uMist; // x strength, y coverage threshold, z density scale
varying vec3 vWorld;
varying float vDepth;
varying float vThick;
varying float vEdge;
varying float vLayer;
#include <fog_pars_fragment>
void main() {
  if (vDepth <= 0.0) discard;
  float t = uAtmoTime.x;
  vec2 xz = vWorld.xz;
  vec2 w = vec2(1.0, -0.4) * (0.6 + uAtmoTime.z);
  float n1 = texture2D(uNoise, (xz + w * t * 1.3) / 1100.0 + vLayer * 0.37).r;
  float n2 = texture2D(uNoise, (xz - vec2(w.y, w.x) * t * 0.9) / 380.0 + vLayer * 0.61).g;
  float n3 = texture2D(uNoise, (xz + w * t * 2.2) / 120.0 + vLayer * 0.13).a;
  float n = n1 * 0.52 + n2 * 0.34 + n3 * 0.14;
  float cover = smoothstep(uMist.y - 0.16, uMist.y + 0.24, n);
  // thin up the shores: the layer fades in over a few metres of depth
  float shore = smoothstep(0.0, 3.0 + vThick * 0.3, vDepth);
  float dens = cover * shore * vEdge;
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  V /= dist;
  float slab = (vThick / uLayers) / max(abs(V.y), 0.08);
  float alpha = 1.0 - exp(-dens * slab * uMist.z * 0.03);
  // never a sheet in the camera's face or edge-on through the eye
  alpha *= smoothstep(15.0, 110.0, dist) * smoothstep(0.5, 7.0, abs(cameraPosition.y - vWorld.y));
  alpha *= uMist.x;
  if (alpha < 0.002) discard;
  // light: the atmosphere's in-scatter for this ray, sky from above, the sun scattering forward
  vec3 ins = atmoInscatter(V);
  float mu = dot(V, uKeyDir);
  float g = 0.55;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
  float top = 0.75 + 0.25 * smoothstep(0.0, 1.0, vDepth / max(vThick, 1.0));
  vec3 col = ins * 0.82 + uSkyLight * 0.22 * top + uSunLight * (0.035 + hg) * top;
  vec4 f = atmoFogTerm(cameraPosition, vWorld);
  col = mix(col, f.rgb, f.a * 0.85);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Resample a polyline into points `step` apart with unit tangents. */
function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n + (i === pts.length - 2 ? 1 : 0); k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len });
    }
  }
  // smooth tangents at the joints
  for (let i = 1; i < out.length - 1; i++) {
    const tx = out[i - 1].tx + out[i + 1].tx;
    const tz = out[i - 1].tz + out[i + 1].tz;
    const l = Math.hypot(tx, tz) || 1;
    out[i].tx = tx / l;
    out[i].tz = tz / l;
  }
  return out;
}

export async function buildMist(ctx, shared, noiseTex) {
  const surf = (x, z) => ctx.surfaceAt(x, z);
  const P = [];
  const M = [];
  const idx = [];
  let base = 0;

  for (const pool of POOLS) {
    const verts = []; // [x, top, z, ground, thick, edge, dens]
    let cols = 0;
    let rows = 0;
    if (pool.type === 'disc') {
      const n = Math.ceil((pool.r * 2) / pool.step) + 1;
      cols = rows = n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = pool.x - pool.r + i * pool.step;
          const z = pool.z - pool.r + j * pool.step;
          const rr = Math.hypot(x - pool.x, z - pool.z) / pool.r;
          const edge = 1 - THREE.MathUtils.smoothstep(rr, 0.72, 1.0);
          const g = rr < 1.05 ? surf(x, z) : 1e4;
          verts.push([x, pool.top, z, g, pool.thick, edge, pool.dens]);
        }
      }
    } else {
      const line = resample(pool.pts, pool.step);
      const across = Math.ceil((pool.half * 2) / pool.step) + 1;
      rows = line.length;
      cols = across;
      // top of the mist: lowest ground across the section + thickness, smoothed along the path
      const tops = line.map((p) => {
        let lo = Infinity;
        for (let k = -4; k <= 4; k++) lo = Math.min(lo, surf(p.x - p.tz * pool.half * 0.25 * k, p.z + p.tx * pool.half * 0.25 * k));
        return lo + pool.thick;
      });
      const sm = tops.map((_, i) => {
        let s = 0;
        let w = 0;
        for (let k = -3; k <= 3; k++) {
          const v = tops[Math.min(tops.length - 1, Math.max(0, i + k))];
          s += v;
          w++;
        }
        return s / w;
      });
      for (let j = 0; j < rows; j++) {
        const p = line[j];
        const endFade = THREE.MathUtils.smoothstep(Math.min(j, rows - 1 - j), 0, 6);
        for (let i = 0; i < cols; i++) {
          const a = -pool.half + i * pool.step;
          const x = p.x - p.tz * a;
          const z = p.z + p.tx * a;
          const edge = (1 - THREE.MathUtils.smoothstep(Math.abs(a) / pool.half, 0.7, 1.0)) * endFade;
          verts.push([x, sm[j], z, surf(x, z), pool.thick, edge, pool.dens]);
        }
      }
    }
    // keep cells where some corner has mist (ground below the top and inside the edge)
    const has = (v) => v[1] - v[3] > 0.5 && v[5] > 0.001;
    const used = new Int32Array(verts.length).fill(-1);
    const useV = (k) => {
      if (used[k] < 0) {
        const v = verts[k];
        used[k] = base++;
        P.push(v[0], v[1], v[2]);
        M.push(v[3], v[4], v[5], v[6]);
      }
      return used[k];
    };
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (!(has(verts[a]) || has(verts[b]) || has(verts[c]) || has(verts[d]))) continue;
        const ia = useV(a);
        const ib = useV(b);
        const ic = useV(c);
        const id = useV(d);
        idx.push(ia, ic, ib, ib, ic, id);
      }
    }
    await nextFrame();
  }

  const L = ctx.quality.level === 'low' ? 2 : 3;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aMist', new THREE.Float32BufferAttribute(M, 4));
  geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: L }, (_, i) => i)), 1));
  geo.setIndex(idx);
  geo.instanceCount = L;
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 60;

  const uMist = { value: new THREE.Vector3(1, 0.5, 1) };
  const material = new THREE.ShaderMaterial({
    name: 'life-mist',
    uniforms: { ...ctx.fogUniforms(), ...shared, uNoise: { value: noiseTex }, uLayers: { value: L }, uMist },
    vertexShader: MIST_VS,
    fragmentShader: MIST_FS,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'life-mist';
  mesh.renderOrder = 3;

  return {
    mesh,
    triangles: (idx.length / 3) * L,
    update() {
      const env = ctx.env;
      const h = env.hour;
      // evening build-up from late afternoon, dawn blanket, a steady night mist
      const evening = THREE.MathUtils.smoothstep(h, 15.5, 18.4) * (1 - THREE.MathUtils.smoothstep(h, 22.5, 24));
      const s = Math.max(env.morning, env.twilight * 0.9, env.night * 0.7, evening * 0.6);
      // kept light: the lake is The Mirror and must stay readable from above
      uMist.value.x = 0.18 + 0.55 * s;
      uMist.value.y = 0.66 - 0.18 * s; // lower threshold = more of the pool covered
      uMist.value.z = 0.45 + 0.55 * s;
    },
  };
}
