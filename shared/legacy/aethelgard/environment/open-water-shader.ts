/** Crownfall PBR integration of the MIT Open Water spectral surface fields.
 * Upstream: Leonxlnx/open-water@3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8,
 * Copyright (c) 2026 Leonxlnx. Existing authored water geometry stays unchanged. */
import { patchEaldholtWaterRipples, type EaldholtRippleShader, type EaldholtRippleUniforms } from './water-ripples';
export const EALDHOLT_OPEN_WATER_PROGRAM_KEY = ':ealdholt-open-water:3d1adaa:fft4-packed:v1';
export type EaldholtOpenWaterProfile = 'pond' | 'trough' | 'river' | 'inlet' | 'sea';
export interface EaldholtOpenWaterUniforms {
  readonly surface0: { value: unknown }; readonly surface1: { value: unknown };
  readonly surface2: { value: unknown }; readonly surface3: { value: unknown };
  readonly lengths: { value: Float32Array }; readonly resolution: { value: number };
  readonly ready: { value: number }; readonly slopeVariance: { value: Float32Array };
  readonly windStrength: { value: number };
}
/** Physical slopes are adapted to each existing water body's scale. Sea energy
 * is not applied to a trough; all five profiles borrow the same four textures. */
export const OPEN_WATER_PROFILE_WEIGHTS = Object.freeze({
  pond: Object.freeze({ slope: [.02, .055, .08, .065] as const, foam: 0 }),
  trough: Object.freeze({ slope: [0, .015, .04, .05] as const, foam: 0 }),
  river: Object.freeze({ slope: [.04, .16, .32, .22] as const, foam: .12 }),
  inlet: Object.freeze({ slope: [.3, .55, .7, .6] as const, foam: .7 }),
  sea: Object.freeze({ slope: [.8, .85, .85, .75] as const, foam: 1 }),
});
const normalApplication = 'normal = normalize(normal + mat3(viewMatrix) * mat3(uEaldholtWaterSourceRotation) * vec3(-ealdholtSlope.x, 0., -ealdholtSlope.y));';

/** Install after existing river-current/shore/PBR hooks. Idempotently reuses
 * the existing source-space position and source-to-world normal rotation. GPU
 * slopes replace analytic slopes when ready; ready=0 retains that exact fallback.
 * Packed RGBA = source slope X/Z, height metres, accumulated Jacobian foam.
 * Mips/derivative filtering remove unresolved normal detail; its measured band
 * energy becomes roughness. This is not a tessellated/displaced ocean mesh. */
export function patchEaldholtOpenWater(shader: EaldholtRippleShader, uniforms: EaldholtOpenWaterUniforms,
  sourceFrame: EaldholtRippleUniforms, profile: EaldholtOpenWaterProfile): void {
  if (shader.fragmentShader.includes('CROWNFALL_OPEN_WATER_FFT')) return;
  const weights = OPEN_WATER_PROFILE_WEIGHTS[profile];
  if (!weights) throw Error('Unknown Open Water surface profile.');
  patchEaldholtWaterRipples(shader, sourceFrame, { pond: profile === 'pond' || profile === 'trough' });
  if (!shader.fragmentShader.includes(normalApplication)) throw Error('Open Water requires the existing source-space PBR ripple normal application.');
  shader.uniforms.uEaldholtOpenWaterSurface0 = uniforms.surface0; shader.uniforms.uEaldholtOpenWaterSurface1 = uniforms.surface1;
  shader.uniforms.uEaldholtOpenWaterSurface2 = uniforms.surface2; shader.uniforms.uEaldholtOpenWaterSurface3 = uniforms.surface3;
  shader.uniforms.uEaldholtOpenWaterLengths = uniforms.lengths; shader.uniforms.uEaldholtOpenWaterResolution = uniforms.resolution;
  shader.uniforms.uEaldholtOpenWaterReady = uniforms.ready; shader.uniforms.uEaldholtOpenWaterVariance = uniforms.slopeVariance;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_OPEN_WATER_FFT
uniform sampler2D uEaldholtOpenWaterSurface0;
uniform sampler2D uEaldholtOpenWaterSurface1;
uniform sampler2D uEaldholtOpenWaterSurface2;
uniform sampler2D uEaldholtOpenWaterSurface3;
uniform vec4 uEaldholtOpenWaterLengths;
uniform vec4 uEaldholtOpenWaterVariance;
uniform float uEaldholtOpenWaterResolution;
uniform float uEaldholtOpenWaterReady;
vec4 ealdholtOpenWaterBand(sampler2D field, vec2 point, float lengthMetres, float slopeWeight, float foamWeight, float variance, float footprint) {
  vec4 surface = texture2D(field, point / lengthMetres);
  float texelMetres = lengthMetres / uEaldholtOpenWaterResolution;
  float shown = 1. - smoothstep(1., 4., footprint / texelMetres);
  // Height is used only for crest foam. Geometry and water geography are authored.
  float crest = mix(.65, 1.1, smoothstep(-.1, .1, surface.z));
  return vec4(surface.xy * (slopeWeight * shown), max(variance, 0.) * slopeWeight * slopeWeight * (1. - shown * shown), surface.w * foamWeight * shown * crest);
}
vec4 ealdholtOpenWaterSample(vec2 point) {
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  vec4 wave = vec4(0.);
  ${weights.slope.map((weight, i) => `wave += ealdholtOpenWaterBand(uEaldholtOpenWaterSurface${i}, point, uEaldholtOpenWaterLengths[${i}], ${weight.toFixed(4)}, ${[.15, 1, .75, .2][i].toFixed(2)}, uEaldholtOpenWaterVariance[${i}], footprint);`).join('\n  ')}
  return wave;
}`);
  // The pond fallback already converts unresolved analytic waves to roughness.
  // Disable that contribution with GPU fields to avoid counting the same energy twice.
  shader.fragmentShader = shader.fragmentShader.replace('roughnessFactor * roughnessFactor + ealdholtRipple.z)',
    'roughnessFactor * roughnessFactor + ealdholtRipple.z * (1. - uEaldholtOpenWaterReady))');
  shader.fragmentShader = shader.fragmentShader.replace(normalApplication, `if (uEaldholtOpenWaterReady > .5) {
  vec4 ealdholtSpectral = ealdholtOpenWaterSample(vEaldholtWaterSourcePosition.xz);
  ealdholtSlope = ealdholtSpectral.xy;
  roughnessFactor = min(1., sqrt(roughnessFactor * roughnessFactor + ealdholtSpectral.z));
  float ealdholtSpectralFoam = clamp(ealdholtSpectral.w * ${weights.foam.toFixed(3)}, 0., .68);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.72, .76, .74), ealdholtSpectralFoam);
  roughnessFactor = mix(roughnessFactor, .92, ealdholtSpectralFoam);
}
${normalApplication}`);
}
