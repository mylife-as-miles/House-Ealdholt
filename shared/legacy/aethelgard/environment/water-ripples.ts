/** Footprint attenuation adapted from ProceduralTerrains waterBandFilter;
 * provenance/licence: PROCEDURAL_TERRAINS_SOURCES.md. The quiet pond
 * bands and integration with the existing PBR surface are Crownfall code. */
export interface EaldholtRippleShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}
/** Source-space wind sampled from the authoritative world environment. */
export interface EaldholtWaterWind {
  readonly wind: readonly [number, number];
  readonly windStrength: number;
}
export interface EaldholtWaterMotion {
  readonly time: { value: number };
  readonly windDirection: { value: { x: number; y: number } };
  readonly windStrength: { value: number };
  update(elapsedSeconds: number, animated: boolean, wind?: EaldholtWaterWind | null): void;
}

/** Integrate only active, bounded presentation deltas. An observer catch-up,
 * late asset load, pause or clock rewind must not teleport the surface phase.
 * The independent time uniform also drives the river's authored current. */
export function createEaldholtWaterMotion(): EaldholtWaterMotion {
  const time = { value: 0 }, windDirection = { value: { x: 1, y: 0 } }, windStrength = { value: 0 };
  let previous: number | null = null, wasAnimated = false;
  return { time, windDirection, windStrength, update(elapsedSeconds, animated, wind) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) { previous = null; wasAnimated = false; return; }
    const delta = animated && wasAnimated && previous !== null ? Math.min(.1, Math.max(0, elapsedSeconds - previous)) : 0;
    previous = elapsedSeconds; wasAnimated = animated;
    if (delta === 0) return;
    time.value += delta;
    const x = wind?.wind[0] ?? 0, y = wind?.wind[1] ?? 0, length = Math.hypot(x, y);
    const valid = Number.isFinite(length) && length > 1e-6 && Number.isFinite(wind?.windStrength);
    const target = valid ? Math.max(0, Math.min(1, wind!.windStrength)) : 0;
    const response = 1 - Math.exp(-delta * 3);
    if (target > 0) {
      const direction = windDirection.value, angle = Math.atan2(y, x);
      // Adopt a new bearing while calm; otherwise ease its shortest turn.
      const current = Math.atan2(direction.y, direction.x);
      const difference = Math.atan2(Math.sin(angle - current), Math.cos(angle - current));
      const next = windStrength.value < 1e-5 ? angle : current + difference * response;
      direction.x = Math.cos(next); direction.y = Math.sin(next);
    }
    windStrength.value += (target - windStrength.value) * response;
  } };
}

export interface EaldholtRippleUniforms {
  time: { value: number }; metresPerWorldUnit: { value: number };
  worldToSource: { value: unknown }; sourceToWorldRotation: { value: unknown };
  windDirection?: EaldholtWaterMotion['windDirection']; windStrength?: EaldholtWaterMotion['windStrength'];
}
/** A2cm-height,7.39m-wavelength undulation remains resolvable at the measured
 * low-LOD pond footprint; fine ripple bands still fade before aliasing. */
export const EALDHOLT_POND_BROAD_WAVE = Object.freeze({ wavenumber: .85, slopeAmplitude: .018, phaseSpeed: .36 });
export function ealdholtWaterBandAttenuation(wavenumber: number, footprint: number): number {
  const t = Math.max(0, Math.min(1, (wavenumber * footprint - .45) / 1.15));
  return 1 - t * t * (3 - 2 * t);
}

/** Pond-only adaptation of Solstice's five gravity-wave slopes, in source metres.
 * https://github.com/SamG-Coder/solstice/blob/c2a081bdd5025f1292e24c783dde75801420dcea/crates/solstice-render/shaders/ocean/pond.wgsl#L67
 * Copyright (c) 2026 SamG-Coder, MIT; see LICENSE.solstice.txt and both public notices.
 * Keep the regional water's existing broad bands and downstream flow separate. */
export const EALDHOLT_POND_RIPPLE_PROGRAM_KEY = ':ealdholt-pond-ripples:v5-gravity';
export const EALDHOLT_POND_GRAVITY_WAVES = Object.freeze([
  { direction: [.966, .259] as const, wavelength: 1.9, height: .0022 },
  { direction: [.743, -.669] as const, wavelength: 1.1, height: .0013 },
  { direction: [.208, .978] as const, wavelength: .63, height: .0007 },
  { direction: [-.588, .809] as const, wavelength: .37, height: .0004 },
  { direction: [.951, -.309] as const, wavelength: .21, height: .00022 },
].map(wave => Object.freeze(wave)));

const pondGravityShader = `
// Fixed source-space phases prevent a changing bearing from sliding the wave field.
vec3 ealdholtPondGravityBand(vec2 point, float time, float footprint, vec2 wind, float strength, vec2 direction, float wavelength, float height) {
  float k = 6.283185307179586 / wavelength;
  float phase = dot(direction, point) * k - sqrt(9.81 * k) * time;
  float along = max(dot(direction, wind), 0.);
  float steepness = height * k * strength * (.25 + .75 * along * along);
  float shown = 1. - smoothstep(.25, .5, footprint / wavelength);
  return vec3(direction * (steepness * cos(phase) * shown), .5 * steepness * steepness * (1. - shown * shown));
}
vec3 ealdholtPondGravityRipples(vec2 point, float time) {
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  vec2 wind = uEaldholtWaterWindDirection / max(length(uEaldholtWaterWindDirection), .000001);
  // Use the existing dimensionless weather strength: one is the reference breeze.
  // Calm remains flat; bounded travelling gusts modulate amplitude, never phase.
  float gust = 1. + .2 * sin(dot(point, vec2(.083, .061)) - time * .9)
    + .08 * sin(dot(point, vec2(.027, -.049)) - time * .37);
  float breeze = clamp(uEaldholtWaterWindStrength, 0., 1.) * gust;
  float strength = min(breeze * breeze, 2.5);
  vec3 ripples = vec3(0.);
  ${EALDHOLT_POND_GRAVITY_WAVES.map(wave => `ripples += ealdholtPondGravityBand(point, time, footprint, wind, strength, vec2(${wave.direction.join(', ')}), ${wave.wavelength}, ${wave.height});`).join('\n  ')}
  return ripples;
}`;

export function patchEaldholtWaterRipples(shader: EaldholtRippleShader, uniforms: EaldholtRippleUniforms, options: { pond?: boolean } = {}): void {
  if (shader.fragmentShader.includes('CROWNFALL_POND_RIPPLES')) return;
  if (!shader.vertexShader.includes('#include <common>') || !shader.vertexShader.includes('#include <begin_vertex>')
    || !shader.fragmentShader.includes('#include <common>') || !shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
    throw Error('Pond ripple shader requires standard PBR position and normal chunks.');
  }
  shader.uniforms.uEaldholtRippleTime = uniforms.time;
  shader.uniforms.uEaldholtMetresPerWorldUnit = uniforms.metresPerWorldUnit;
  shader.uniforms.uEaldholtWaterWorldToSource = uniforms.worldToSource;
  shader.uniforms.uEaldholtWaterSourceRotation = uniforms.sourceToWorldRotation;
  // Existing shader callers without weather remain safely still.
  shader.uniforms.uEaldholtWaterWindDirection = uniforms.windDirection ?? { value: { x: 1, y: 0 } };
  shader.uniforms.uEaldholtWaterWindStrength = uniforms.windStrength ?? { value: 0 };
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vEaldholtWaterSourcePosition;
uniform mat4 uEaldholtWaterWorldToSource;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ealdholtWaterPosition = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  ealdholtWaterPosition = instanceMatrix * ealdholtWaterPosition;
#endif
vEaldholtWaterSourcePosition = (uEaldholtWaterWorldToSource * modelMatrix * ealdholtWaterPosition).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_POND_RIPPLES
varying vec3 vEaldholtWaterSourcePosition;
uniform float uEaldholtRippleTime;
uniform mat4 uEaldholtWaterSourceRotation;
uniform vec2 uEaldholtWaterWindDirection;
uniform float uEaldholtWaterWindStrength;
${options.pond ? `#define CROWNFALL_POND_GRAVITY_RIPPLES\n${pondGravityShader}` : `float ealdholtWaterBandFilter(float wavenumber, float footprint) {
  return 1. - smoothstep(.45, 1.6, wavenumber * footprint);
}
vec2 ealdholtPondSlope(vec2 point, float time) {
  vec2 wind = uEaldholtWaterWindDirection;
  vec2 acrossWind = vec2(-wind.y, wind.x);
  point = vec2(dot(point, wind), dot(point, acrossWind));
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  float fineVisibility = ealdholtWaterBandFilter(5.3, footprint);
  float driftA = dot(point, vec2(.31, .23)) - time * .09;
  float driftB = dot(point, vec2(-.19, .37)) + time * .07;
  float broad = dot(point, vec2(.870022, .493013)) * ${EALDHOLT_POND_BROAD_WAVE.wavenumber} - time * ${EALDHOLT_POND_BROAD_WAVE.phaseSpeed};
  // Long crests bend slowly across the source-space surface. Their exact
  // phase gradients retain a coherent normal field instead of straight rows.
  float a = dot(point, vec2(.928477, .371391)) * 5.3 + 1.1 * sin(driftA) + .6 * sin(driftB) - time * 1.25;
  float b = dot(point, vec2(-.242536, .970143)) * 10.7 + .8 * sin(driftB + .4) - time * 1.78;
  float c = dot(point, vec2(.707107, -.707107)) * 19.1 - time * 2.37;
  vec2 gradientA = vec2(.928477, .371391) + 1.1 / 5.3 * cos(driftA) * vec2(.31, .23) + .6 / 5.3 * cos(driftB) * vec2(-.19, .37);
  vec2 gradientB = vec2(-.242536, .970143) + .8 / 10.7 * cos(driftB + .4) * vec2(-.19, .37);
  // The broad fallback survives coarse pixels; close views retain subtler
  // broad motion while resolving the smaller, less coherent wind ripples.
  vec2 slope = vec2(.870022, .493013) * cos(broad) * ${EALDHOLT_POND_BROAD_WAVE.slopeAmplitude} * mix(1., .33, fineVisibility) * ealdholtWaterBandFilter(${EALDHOLT_POND_BROAD_WAVE.wavenumber}, footprint)
    + gradientA * cos(a) * .014 * fineVisibility
    + gradientB * cos(b) * .009 * ealdholtWaterBandFilter(10.7, footprint)
    + vec2(.707107, -.707107) * cos(c) * .005 * ealdholtWaterBandFilter(19.1, footprint);
  return (wind * slope.x + acrossWind * slope.y) * clamp(uEaldholtWaterWindStrength, 0., 1.);
}`}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${options.pond ? `vec3 ealdholtRipple = ealdholtPondGravityRipples(vEaldholtWaterSourcePosition.xz, uEaldholtRippleTime);
// Unresolved normal energy becomes roughness rather than subpixel shimmer.
roughnessFactor = min(1., sqrt(roughnessFactor * roughnessFactor + ealdholtRipple.z));
vec2 ealdholtSlope = ealdholtRipple.xy;` : 'vec2 ealdholtSlope = ealdholtPondSlope(vEaldholtWaterSourcePosition.xz, uEaldholtRippleTime);'}
normal = normalize(normal + mat3(viewMatrix) * mat3(uEaldholtWaterSourceRotation) * vec3(-ealdholtSlope.x, 0., -ealdholtSlope.y));`);
}
