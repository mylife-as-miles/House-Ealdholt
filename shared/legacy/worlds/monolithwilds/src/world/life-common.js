// Shared pieces for the ambient-life module (life.js): per-frame light/camera uniforms that all
// life shaders read, a tileable noise texture (mist, sky-forms), and small GLSL helpers.
//
// Every life shader is a ShaderMaterial with `fog: true` + ctx.fogUniforms(), so it gets the
// world's height fog / aerial perspective through the standard fog chunks.

import * as THREE from 'crownfall-world-three';

/**
 * Live uniforms shared by every life material (mutated in place each frame by life.js).
 *   uLifeTime   the atmosphere's time vec4 (x = elapsed s, y = night, z = wind, w = hour) — shared object
 *   uLifeEnv    x night, y twilight, z morning (dawn), w day (sun up 0..1)
 *   uSunLight   direct sun/moon radiance (linear rgb, intensity folded in)
 *   uSkyLight   ambient sky radiance (linear rgb)
 *   uKeyDir     direction toward the key light (sun by day, moon at night)
 *   uProj       pixels per radian-ish: drawing-buffer height / (2 tan(fov/2))
 */
export function createSharedUniforms(ctx) {
  return {
    uLifeTime: { value: ctx.atmo.time },
    uLifeEnv: { value: new THREE.Vector4(0, 0, 0, 1) },
    uSunLight: { value: new THREE.Color(1, 0.8, 0.6) },
    uSkyLight: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uProj: { value: 500 },
  };
}

/**
 * Tileable RGBA noise (value-noise fBm on a wrapped lattice, 4 independent channels).
 * R: soft fBm (period 8)  G: soft fBm (period 16, other seed)  B: billowy |fBm|  A: fine detail.
 */
export function createNoiseTexture(rng, size = 128) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
    return g;
  };
  const sample = (g, period, x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  // octave lattices per channel (period doubles each octave -> tiles exactly)
  const chans = [
    { base: 8, oct: 4 },
    { base: 16, oct: 4 },
    { base: 6, oct: 3 },
    { base: 32, oct: 2 },
  ].map((c) => ({ ...c, lat: Array.from({ length: c.oct }, (_, o) => lattice(c.base << o)) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (let k = 0; k < 4; k++) {
        const c = chans[k];
        let sum = 0;
        let amp = 1;
        let norm = 0;
        for (let o = 0; o < c.oct; o++) {
          const p = c.base << o;
          sum += amp * sample(c.lat[o], p, (x / size) * p, (y / size) * p);
          norm += amp;
          amp *= 0.5;
        }
        let v = sum / norm; // ~[-0.6, 0.6]
        v = k === 2 ? 1 - Math.abs(v) * 1.8 : 0.5 + v * 0.95;
        data[i + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Vertex-shader uniform declarations for the shared life uniforms. */
export const LIFE_VERT_UNIFORMS = /* glsl */ `
uniform vec4 uLifeTime;
uniform vec4 uLifeEnv;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform vec3 uKeyDir;
uniform float uProj;
`;

/**
 * Fragment-shader declarations. uAtmo* are declared by <fog_pars_fragment> (USE_FOG), so the
 * fragment only adds the life-specific ones.
 */
export const LIFE_FRAG_UNIFORMS = /* glsl */ `
uniform vec4 uLifeEnv;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform vec3 uKeyDir;
`;

/** Cheap hashes. */
export const LIFE_HASH_GLSL = /* glsl */ `
float lifeHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 lifeHash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
`;
