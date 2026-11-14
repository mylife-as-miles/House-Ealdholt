/**
 * The char: a burnt surface that spreads from the point of impact through every material of a figure.
 *
 * It is not a material effect of its own. A figure's materials are built once and patched once, by
 * `installDissolve` in pieces.ts (the burn-away and the side's rim light), and they share one uniform block
 * per figure. The char is more uniforms in that block and more lines in that one patch, so there is still a
 * single program per material and nothing is laid over the paint from outside: the texture, the side's glow
 * through it, the hit flash and the burn-away all still run, and the char is applied to what they produce.
 *
 * With `uCharFront` at 0 (every figure that is not burning) every line below is skipped: the surface is
 * exactly what it was. Clearing the state ({@link clearChar}) is therefore all Undo has to do to a figure's
 * materials, and nothing here ever writes to a material's own parameters.
 *
 * The front is a sphere growing from a world-space point that rides on the body, broken up by noise fixed
 * to the sculpt (the bind pose), so the burnt edge does not swim as the figure flails. Behind it the albedo
 * goes to black, the surface goes matt, the side's glow and rim go out, and a web of cracks glows in the
 * ember colour. The noise is pieces.ts's own (`dvNoise`), in the same units as the burn-away.
 *
 * No Three.js in here: the uniform values are plain arrays, which the renderer takes for a vec3, so the
 * node tests reach this (shared/play/burn-plan.test.ts).
 */
import { CHAR_ALBEDO, CHAR_EDGE, CHAR_JITTER } from "./burnPlan";

export interface CharUniforms {
  /** World point the front grows from. */
  uCharOrigin: { value: [number, number, number] };
  /** World radius of the front. 0: not burning. */
  uCharFront: { value: number };
  /** Ember brightness in the cracks, already scaled for the arena's exposure. */
  uCharHeat: { value: number };
  /** Brightness of the burning edge of the front (0 once the body is covered, and under reduced motion). */
  uCharEdgeGlow: { value: number };
  /** Linear RGB of the embers. */
  uCharEmber: { value: [number, number, number] };
  /** Seconds, for the flicker (held still under reduced motion). */
  uCharTime: { value: number };
}

export function createCharUniforms(): CharUniforms {
  return {
    uCharOrigin: { value: [0, 0, 0] },
    uCharFront: { value: 0 },
    uCharHeat: { value: 0 },
    uCharEdgeGlow: { value: 0 },
    uCharEmber: { value: [1, 0.36, 0.05] },
    uCharTime: { value: 0 },
  };
}

export interface CharState {
  origin: { x: number; y: number; z: number };
  front: number;
  heat: number;
  edgeGlow: number;
  ember: readonly [number, number, number];
  time: number;
  /** How bright the burn-away's edge is while the husk crumbles, as a multiple of the ember colour. */
  crumbleGlow: number;
}

/** Writes a burn into a figure's uniform block. Allocates nothing. */
export function applyChar(uniforms: CharUniforms, state: CharState): void {
  const origin = uniforms.uCharOrigin.value, ember = uniforms.uCharEmber.value;
  origin[0] = state.origin.x; origin[1] = state.origin.y; origin[2] = state.origin.z;
  uniforms.uCharFront.value = Math.max(0, state.front);
  uniforms.uCharHeat.value = Math.max(0, state.heat);
  uniforms.uCharEdgeGlow.value = Math.max(0, state.edgeGlow);
  ember[0] = state.ember[0]; ember[1] = state.ember[1]; ember[2] = state.ember[2];
  uniforms.uCharTime.value = state.time;
}

/** Back to an unburnt figure: the block is exactly as {@link createCharUniforms} made it. */
export function clearChar(uniforms: CharUniforms): void {
  const fresh = createCharUniforms();
  const origin = uniforms.uCharOrigin.value, ember = uniforms.uCharEmber.value;
  origin[0] = fresh.uCharOrigin.value[0]; origin[1] = fresh.uCharOrigin.value[1]; origin[2] = fresh.uCharOrigin.value[2];
  ember[0] = fresh.uCharEmber.value[0]; ember[1] = fresh.uCharEmber.value[1]; ember[2] = fresh.uCharEmber.value[2];
  uniforms.uCharFront.value = fresh.uCharFront.value;
  uniforms.uCharHeat.value = fresh.uCharHeat.value;
  uniforms.uCharEdgeGlow.value = fresh.uCharEdgeGlow.value;
  uniforms.uCharTime.value = fresh.uCharTime.value;
}

const f = (value: number): string => value.toFixed(4);

/** Vertex: declared after `#include <common>`. */
export const CHAR_VERTEX_PARS = /* glsl */ `varying vec3 vCharRest;
varying vec3 vCharWorld;`;

/** Vertex: before `#include <project_vertex>`, where `transformed` is the skinned position. */
export const CHAR_VERTEX = /* glsl */ `vCharRest = position;
vCharWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

/** Fragment: declared after `#include <common>` and pieces.ts's own noise. */
export const CHAR_FRAGMENT_PARS = /* glsl */ `uniform vec3 uCharOrigin;
uniform float uCharFront;
uniform float uCharHeat;
uniform float uCharEdgeGlow;
uniform vec3 uCharEmber;
uniform float uCharTime;
varying vec3 vCharRest;
varying vec3 vCharWorld;`;

/**
 * Fragment: how charred this fragment is, how close to the burning edge, and whether a crack runs through
 * it. After the burn-away's own block, so `dvNoise` and `uDissolveScale` are in scope.
 */
export const CHAR_FRAGMENT_MASK = /* glsl */ `float chAmount = 0.0;
float chEdge = 0.0;
float chCrack = 0.0;
float chGrain = 0.5;
if (uCharFront > 0.0005) {
  vec3 chP = vCharRest * uDissolveScale;
  chGrain = dvNoise(chP * 1.3) * 0.6 + dvNoise(chP * 3.1 + 5.7) * 0.4;
  float chD = distance(vCharWorld, uCharOrigin) + (chGrain - 0.5) * ${f(CHAR_JITTER * 2)};
  chAmount = 1.0 - smoothstep(uCharFront - ${f(CHAR_EDGE)}, uCharFront, chD);
  chEdge = chAmount * (1.0 - smoothstep(0.0, ${f(CHAR_EDGE * 2.2)}, uCharFront - chD));
  // Cracks: the thin lines where two noise fields cross their middle value, strongest in the patches where
  // the crust has split and faint between them, so the husk is black with embers showing through, not veined.
  float chA = abs(dvNoise(chP * 2.1 + 3.1) - 0.5);
  float chB = abs(dvNoise(chP * 4.7 + 9.2) - 0.5) * 1.6;
  float chLine = 1.0 - smoothstep(0.006, 0.028, min(chA, chB));
  float chPatch = smoothstep(0.4, 0.62, dvNoise(chP * 0.85 + 17.0));
  float chPulse = 0.72 + 0.28 * sin(uCharTime * 5.3 + chGrain * 19.0);
  chCrack = chLine * (0.18 + 0.82 * chPatch) * chPulse * chAmount;
}`;

/** Fragment: after `#include <color_fragment>`. The paint goes to char, a little uneven so it is not a flat black. */
export const CHAR_FRAGMENT_ALBEDO = /* glsl */ `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(CHAR_ALBEDO[0])}, ${f(CHAR_ALBEDO[1])}, ${f(CHAR_ALBEDO[2])}) * (0.55 + chGrain * 0.9), chAmount);`;

/** Fragment: after `#include <roughnessmap_fragment>`. Char is dead matt. */
export const CHAR_FRAGMENT_ROUGHNESS = /* glsl */ `roughnessFactor = mix(roughnessFactor, 0.96, chAmount);`;

/** Fragment: after `#include <metalnessmap_fragment>`. Burnt steel does not shine. */
export const CHAR_FRAGMENT_METALNESS = /* glsl */ `metalnessFactor *= 1.0 - chAmount;`;

/** Fragment: after `#include <emissivemap_fragment>`. The side's glow and the hit flash go out; the embers come on. */
export const CHAR_FRAGMENT_EMISSIVE = /* glsl */ `totalEmissiveRadiance *= 1.0 - chAmount;
totalEmissiveRadiance += uCharEmber * (chCrack * uCharHeat + chEdge * uCharEdgeGlow);`;

/** Fragment: what the side's rim light is multiplied by. A husk has no side. */
export const CHAR_RIM_FACTOR = "(1.0 - chAmount)";
