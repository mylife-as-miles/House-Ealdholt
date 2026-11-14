// Global atmosphere: height fog + aerial perspective + sun/moon in-scattering, shared by EVERY material.
//
// How it works
// ------------
// three.js clones a built-in material's uniforms from ShaderLib when it compiles. The clone
// deep-copies Vector3/Color objects but copies *plain objects* ({x,y,z}) by reference. So we
// add uniforms whose values are plain objects to every ShaderLib entry; every built-in material
// (standard, physical, lambert, basic, points, ...) then shares these live objects, and we only
// mutate them in place. We also replace the fog shader chunks with a height-fog model.
//
// The model (see ATMO_FUNCTIONS_GLSL):
//   * two exponential height layers integrated analytically along the view ray:
//       ground fog  density uAtmoFog.x at height uAtmoFog.z, falloff uAtmoFog.y (valleys, lake mist)
//       haze        density uAtmoFog.w, falloff uAtmoFogAway.w (aerial perspective; 0 = uniform)
//   * direction-dependent in-scatter colour: base fog colour, a cooler tint away from the sun
//     (uAtmoFogAway.rgb), a tight + a broad forward-scattering glow toward the sun, and a soft
//     moon glow at night. The sky dome uses the very same colour at its horizon, so distant
//     terrain melts into the sky at every hour.
//
// Custom ShaderMaterials: spread `atmosphereUniforms` (and THREE.UniformsLib.fog) into your
// uniforms, set `fog: true`, and use the standard chunks in your shaders:
//   vertex:   #include <fog_pars_vertex>  ...  (after mvPosition exists)  #include <fog_vertex>
//   fragment: #include <fog_pars_fragment> ... #include <fog_fragment>   (applies to gl_FragColor)
// Or call atmoFog(color, worldPos) yourself (declared by fog_pars_fragment when USE_FOG).
// For a shader that needs the atmosphere data without fog (e.g. the sky), include
// ATMO_UNIFORMS_GLSL + ATMO_FUNCTIONS_GLSL and use the uniforms / functions directly.
//
// Uniforms added after the first version (uAtmoFogAway, uAtmoMoonDir) are "zero-safe": a shader
// that doesn't receive them still gets the plain height fog.
//
// IMPORTANT: never replace these uniform *value objects* — mutate them (atmo.sunDir.x = ...).

import * as THREE from 'crownfall-world-three';

/** Live atmosphere state. Plain objects on purpose — see header. Mutate in place only. */
export const atmo = {
  /** Unit vector pointing TOWARD the sun. */
  sunDir: { x: -0.8, y: 0.15, z: 0.35 },
  /** Linear RGB sun radiance tint used for in-scattering glow. */
  sunColor: { x: 1.0, y: 0.62, z: 0.34 },
  /** Linear RGB fog / horizon colour (side-on to the sun). */
  fogColor: { x: 0.55, y: 0.52, z: 0.55 },
  /**
   * x: density at base height (1/m)
   * y: height falloff (1/m)  — density = x * exp(-y * (h - z))
   * z: base height (m)
   * w: aerial-perspective haze density (1/m) at the base height (falloff in fogAway.w)
   */
  fog: { x: 0.00042, y: 0.0042, z: 0.0, w: 0.000055 },
  /** x: elapsed seconds, y: night factor 0..1, z: wind strength 0..1, w: hour of day 0..24 */
  time: { x: 0, y: 0, z: 0.35, w: 17.4 },
  /** x: sun in-scatter strength, y: sun in-scatter power, z: moon glow strength, w: broad sun glow strength */
  scatter: { x: 0.75, y: 10.0, z: 0.0, w: 0.0 },
  /** rgb: fog colour offset looking away from the sun (added, linear), w: haze height falloff (1/m) */
  fogAway: { x: 0.0, y: 0.0, z: 0.0, w: 0.0 },
  /** Unit vector toward the (main) moon. */
  moonDir: { x: 0.0, y: 0.6, z: 0.8 },
};

/** Uniform entries to spread into custom ShaderMaterials. Values are the shared live objects. */
export const atmosphereUniforms = {
  uAtmoSunDir: { value: atmo.sunDir },
  uAtmoSunColor: { value: atmo.sunColor },
  uAtmoFogColor: { value: atmo.fogColor },
  uAtmoFog: { value: atmo.fog },
  uAtmoTime: { value: atmo.time },
  uAtmoScatter: { value: atmo.scatter },
  uAtmoFogAway: { value: atmo.fogAway },
  uAtmoMoonDir: { value: atmo.moonDir },
};

export const ATMO_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uAtmoSunDir;
uniform vec3 uAtmoSunColor;
uniform vec3 uAtmoFogColor;
uniform vec4 uAtmoFog;
uniform vec4 uAtmoTime;
uniform vec4 uAtmoScatter;
uniform vec4 uAtmoFogAway;
uniform vec3 uAtmoMoonDir;
`;

/** GLSL: fog amount + colour for a ray from the camera to worldPos. */
export const ATMO_FUNCTIONS_GLSL = /* glsl */ `
// Optical depth of an exponential layer, density a*exp(-b*y), along y(t) = roy + rdy*t, t in [0, dist].
float atmoLayer(float a, float b, float roy, float rdy, float dist) {
  float base = a * exp(clamp(-b * roy, -60.0, 60.0));
  float k = rdy * b * dist;
  return (abs(k) < 1e-4) ? base * dist : base * (1.0 - exp(clamp(-k, -60.0, 60.0))) / (rdy * b);
}
// In-scattered light colour for a view direction (what fully fogged things / the horizon look like).
vec3 atmoInscatter(vec3 rd) {
  float mu = dot(rd, uAtmoSunDir);
  float away = 0.5 - 0.5 * mu;
  vec3 col = uAtmoFogColor + uAtmoFogAway.rgb * (away * away);
  float fwd = max(mu, 0.0);
  float fwd2 = fwd * fwd;
  col += uAtmoSunColor * (pow(fwd, uAtmoScatter.y) * uAtmoScatter.x + fwd2 * fwd2 * uAtmoScatter.w);
  float mm = max(dot(rd, uAtmoMoonDir), 0.0);
  col += vec3(0.42, 0.52, 0.78) * (uAtmoScatter.z * (mm * mm * mm * mm * 0.35 + pow(mm, 60.0)));
  return max(col, vec3(0.0));
}
// Total optical depth of the atmosphere between ro and ro + rd * dist.
float atmoOptical(vec3 ro, vec3 rd, float dist) {
  float roy = ro.y - uAtmoFog.z;
  return max(atmoLayer(uAtmoFog.x, uAtmoFog.y, roy, rd.y, dist) + atmoLayer(uAtmoFog.w, uAtmoFogAway.w, roy, rd.y, dist), 0.0);
}
// Returns rgb = fog colour, a = fog opacity (0..1) for a view ray from ro to wp.
vec4 atmoFogTerm(vec3 ro, vec3 wp) {
  vec3 rd = wp - ro;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  float fog = 1.0 - exp(-atmoOptical(ro, rd, dist));
  return vec4(atmoInscatter(rd), clamp(fog, 0.0, 1.0));
}
vec3 atmoFog(vec3 color, vec3 wp) {
  vec4 f = atmoFogTerm(cameraPosition, wp);
  return mix(color, f.rgb, f.a);
}
`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vAtmoWorldPos;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world position recovered from view space (works with instancing / batching / skinning)
  vAtmoWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vAtmoWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
// Explicit ambient-life haze calls also run in auxiliary passes without USE_FOG.
#ifndef CROWNFALL_MW_ATMOSPHERE_HELPERS
#define CROWNFALL_MW_ATMOSPHERE_HELPERS
${ATMO_UNIFORMS_GLSL}
${ATMO_FUNCTIONS_GLSL}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = atmoFog( gl_FragColor.rgb, vAtmoWorldPos );
#endif
`;

/** Local shader expansion: leaves the renderer's shared ShaderChunk table unchanged. */
export function expandAtmosphere(shader) {
  Object.assign(shader.uniforms, atmosphereUniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX).replace('#include <fog_vertex>', FOG_VERTEX);
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT).replace('#include <fog_fragment>', FOG_FRAGMENT);
}

/**
 * Uniforms for a custom ShaderMaterial that wants fog: fog uniforms + live atmosphere.
 * Use: new THREE.ShaderMaterial({ uniforms: { ...fogUniforms(), myU: {...} }, fog: true, ... })
 * (Do NOT pass these through UniformsUtils.merge/clone for the atmo entries — they would still
 *  be shared because they are plain objects, which is what we want.)
 */
export function fogUniforms() {
  return {
    fogColor: { value: new THREE.Color(0x000000) },
    fogDensity: { value: 0.00025 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    ...atmosphereUniforms,
  };
}
