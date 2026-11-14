// Adapted from zulubo/SkinGore (MIT). Copyright (c) 2020 zulubo. See public/licenses/SkinGore-MIT.txt.
/**
 * How a figure's own materials show its wound mask (gore/WoundMasks.ts paints it, woundMaskPlan.ts plans it).
 *
 * Like the char (death/burn/charShader.ts) this is no material of its own: it is more uniforms in the figure's one
 * shared block and more lines in the one patch pieces.ts's `installDissolve` gives the sculpt's materials, so there
 * is still a single program per material and the burn-away, the Claiming's dissolve and opacity, the side's rim
 * light, the hit flash and the char all run on what this produces. It comes before the char in every chunk, so a
 * burning husk with wounds still chars over them. With `uWoundOn` at 0 every line below is skipped. The props
 * (spear, shield) are patched without it: their UVs are not the body's.
 *
 * SkinGore's gore material masks blood and flesh by its damage texture and darkens and insets the edge; here the
 * look is procedural and the creator's: blood soaked dark into skin and cloth round the wound, a torn dark rim, the
 * cloth frayed across it, torn wet flesh inside, and a near-black core; at tier 2 on Full (opened interiors) a pale
 * ring of fat inside the edge, muscle, bone glimpsed at the bottom, and the deepest part of the surface sunk in.
 * The detail comes from noise fixed to the sculpt's rest pose, at full resolution, so a 64-texel mask still tears
 * cleanly and nothing swims as the body moves; the mask is read through a cubic B-spline, so it keeps round shapes
 * when a close shot magnifies it.
 *
 * The mask is shown only inside capsules round its strokes in the rest pose (`uWoundGates`, per fragment from the
 * rest position): the figures' UV islands are packed so tightly that at 64 texels the seam dilation and the bilinear
 * filter would otherwise carry a wound onto a far part, and the capsules give the soak a smooth, torn outline where
 * the mask's texels would give it facets. See woundMaskPlan.ts `WOUND_GATES`.
 *
 * No Three.js in here, so the node tests reach the uniform block (shared/play/wound-mask.test.ts).
 */
import { WOUND_GATES, WOUND_GATE_FLOATS } from "./woundMaskPlan";

export interface WoundUniforms {
  /** The figure's mask, or null. */
  uWoundMap: { value: unknown };
  /** 1 while the figure wears a mask, else 0 (every wound line is skipped). */
  uWoundOn: { value: number };
  /** x: how wet (0..1), y: opened interiors (0 or 1), z: how deep the deepest part sinks (sculpt units), w: torn cloth (0 or 1). */
  uWoundLook: { value: [number, number, number, number] };
  /** Prisms round the strokes, in the sculpt's rest space: (a, radius), (b, back), (normal, front), {@link WOUND_GATES} of them. */
  uWoundGates: { value: Float32Array };
  uWoundGateCount: { value: number };
}

export function createWoundUniforms(): WoundUniforms {
  return {
    uWoundMap: { value: null },
    uWoundOn: { value: 0 },
    uWoundLook: { value: [0, 0, 0, 0] },
    uWoundGates: { value: new Float32Array(WOUND_GATES * WOUND_GATE_FLOATS) },
    uWoundGateCount: { value: 0 },
  };
}

/** What a figure is told to wear. `gates` is read, not kept. */
export interface WoundWearState {
  map: unknown;
  wet: number;
  interiors: boolean;
  /** Sculpt units. */
  sink: number;
  fabric: boolean;
  gates: Float32Array;
  gateCount: number;
}

/** Writes what the figure wears into its block. Allocates nothing. */
export function applyWounds(uniforms: WoundUniforms, state: WoundWearState): void {
  uniforms.uWoundMap.value = state.map;
  uniforms.uWoundOn.value = 1;
  const look = uniforms.uWoundLook.value;
  look[0] = Math.min(1, Math.max(0, state.wet)); look[1] = state.interiors ? 1 : 0; look[2] = Math.max(0, state.sink); look[3] = state.fabric ? 1 : 0;
  const count = Math.min(WOUND_GATES, Math.max(0, state.gateCount));
  uniforms.uWoundGates.value.set(state.gates.subarray(0, count * WOUND_GATE_FLOATS));
  uniforms.uWoundGateCount.value = count;
}

/** Back to an unwounded figure: the block exactly as {@link createWoundUniforms} made it. */
export function clearWounds(uniforms: WoundUniforms): void {
  uniforms.uWoundMap.value = null;
  uniforms.uWoundOn.value = 0;
  uniforms.uWoundLook.value.fill(0);
  uniforms.uWoundGates.value.fill(0);
  uniforms.uWoundGateCount.value = 0;
}

/** The mask's UV set: the second where a mesh has one (SkinGore's choice), else the first. Every figure has only the first. */
export function woundUvSet(hasSecond: boolean): "uv" | "uv1" { return hasSecond ? "uv1" : "uv"; }

/**
 * The gates, as both shaders read them: how far inside the prisms round the strokes a rest-space point lies (0..1).
 * Across the surface a capsule with a soft edge (`ragged` stretches the distance, for a torn outline); along the
 * stroke's normal, from its anchor bone to a little in front of it, as the bake reached.
 */
const GATES = /* glsl */ `uniform vec4 uWoundGates[${WOUND_GATES * 3}];
uniform int uWoundGateCount;
float wdGate(vec3 p, float ragged) {
  float g = 0.0;
  for (int i = 0; i < ${WOUND_GATES}; i++) {
    if (i >= uWoundGateCount) break;
    vec4 g0 = uWoundGates[i * 3], g1 = uWoundGates[i * 3 + 1], g2 = uWoundGates[i * 3 + 2];
    vec3 d = p - g0.xyz, ab = g1.xyz - g0.xyz;
    float t = dot(d, g2.xyz);
    vec3 across = d - g2.xyz * t, line = ab - g2.xyz * dot(ab, g2.xyz);
    float h = clamp(dot(across, line) / max(dot(line, line), 1e-10), 0.0, 1.0);
    float side = 1.0 - smoothstep(g0.w * 0.62, g0.w, length(across - line * h) * ragged);
    float depth = dot(g2.xyz, g2.xyz) > 0.25 ? smoothstep(-g1.w - g0.w * 0.4, -g1.w, t) * (1.0 - smoothstep(g2.w, g2.w + g0.w * 0.4, t)) : 1.0;
    g = max(g, side * depth);
  }
  return g;
}`;

/** Vertex: declared after `#include <common>`. `uvSet` is {@link woundUvSet}'s answer. */
export function woundVertexPars(uvSet: "uv" | "uv1"): string {
  return /* glsl */ `${uvSet === "uv1" ? "#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n" : ""}#define WOUND_UV ${uvSet}
uniform sampler2D uWoundMap;
uniform float uWoundOn;
uniform vec4 uWoundLook;
varying vec2 vWoundUv;
${GATES}`;
}

/**
 * Vertex: before `#include <skinning_vertex>`, where `transformed` is still the sculpt's rest position (its units
 * are the ones `uWoundLook.z` is given in; after skinning a figure's local units can be a hundred times smaller).
 * With opened interiors the deepest part of the wound sinks along the rest normal, and skinning carries it with the
 * body; inside the gates only, so a far part sharing the wound's texels never sinks.
 */
export const WOUND_VERTEX = /* glsl */ `vWoundUv = WOUND_UV;
if (uWoundOn > 0.5 && uWoundLook.y > 0.5) {
  float wdIn = wdGate(position, 1.0);
  if (wdIn > 0.001) {
    float wdDeep = textureLod(uWoundMap, WOUND_UV, 0.0).b * wdIn;
    transformed -= normalize(normal) * smoothstep(0.3, 1.0, wdDeep) * uWoundLook.z;
  }
}`;

/** Fragment: declared after `#include <common>` and pieces.ts's own noise. */
export const WOUND_FRAGMENT_PARS = /* glsl */ `uniform sampler2D uWoundMap;
uniform float uWoundOn;
uniform vec4 uWoundLook;
varying vec2 vWoundUv;
${GATES}
// The mask through a cubic B-spline (four bilinear taps): a 64-texel mask magnified on a close shot keeps round shapes
// instead of its texels' diamonds.
vec4 wdSample(vec2 uv) {
  vec2 size = vec2(textureSize(uWoundMap, 0));
  vec2 st = uv * size - 0.5, i = floor(st), f = st - i, e = 1.0 - f;
  vec2 w0 = e * e * e / 6.0, w3 = f * f * f / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 lo = (i - 0.5 + w1 / g0) / size, hi = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * texture2D(uWoundMap, lo) + g1.x * texture2D(uWoundMap, vec2(hi.x, lo.y)))
       + g1.y * (g0.x * texture2D(uWoundMap, vec2(lo.x, hi.y)) + g1.x * texture2D(uWoundMap, hi));
}
// A height's screen-space slope turned into a bent normal (bump mapping on an unparametrised surface).
vec3 wdBend(vec3 at, vec3 normal, vec2 slope, float facing) {
  vec3 across = dFdx(at), down = dFdy(at);
  vec3 r1 = cross(down, normal), r2 = cross(normal, across);
  float det = dot(across, r1) * facing;
  return normalize(abs(det) * normal - sign(det) * (slope.x * r1 + slope.y * r2));
}`;

/**
 * Fragment: after the char's mask (CHAR_FRAGMENT_MASK), so `dvNoise`, `uDissolveScale` and `vCharRest` are in
 * scope. What the mask says here: flesh, its core, the torn rim, frayed threads, the soak, and with opened
 * interiors the fat and the bone; `wdH` is the height the normal is bent by.
 */
export const WOUND_FRAGMENT_MASK = /* glsl */ `float wdFlesh = 0.0, wdCore = 0.0, wdRim = 0.0, wdFray = 0.0, wdSoak = 0.0, wdThick = 0.0;
float wdFat = 0.0, wdBone = 0.0, wdH = 0.0, wdN1 = 0.5, wdN2 = 0.5, wdN3 = 0.5, wdN4 = 0.5;
if (uWoundOn > 0.5) {
  vec3 wdP = vCharRest * uDissolveScale;
  wdN1 = dvNoise(wdP * 2.1 + 3.7);
  // Inside the gates only, their edge wandering a little: the soak's outline is round and torn, not the mask's texels.
  float wdIn = wdGate(vCharRest, 1.0 + (wdN1 - 0.5) * 0.5);
  vec4 wdM = wdIn > 0.002 ? wdSample(vWoundUv) * wdIn : vec4(0.0);
  if (wdM.r + wdM.g > 0.003) {
    wdN2 = dvNoise(wdP * 5.3 + 11.1);
    wdN3 = dvNoise(wdP * 12.7 + 5.3);
    // The opening, torn: its edge wanders by the sculpt's own noise at three scales.
    float wdO = wdM.r + (wdN1 - 0.5) * 0.3 + (wdN2 - 0.5) * 0.16 + (wdN3 - 0.5) * 0.08;
    wdFlesh = smoothstep(0.3, 0.4, wdO);
    // The core: one dark hole where the wound goes deepest (the deep channel), torn only a little. A crush is mostly
    // pulped flesh round a small core; a stab's core is about half its opening.
    wdCore = smoothstep(0.55, 0.8, wdM.r * 0.45 + wdM.b * 0.7 + (wdN2 - 0.5) * 0.14 + (wdN3 - 0.5) * 0.06);
    // Threads and fibres: one stretched noise, frayed cloth at the edge and the grain of the meat inside.
    wdN4 = dvNoise(vec3(wdP.x * 34.0, wdP.y * 5.0, wdP.z * 34.0));
    // The torn edge just outside the flesh: a dark rim, and on cloth threads frayed across it.
    wdRim = smoothstep(0.15, 0.28, wdO) * (1.0 - wdFlesh);
    wdFray = wdRim * smoothstep(0.52, 0.78, wdN4) * uWoundLook.w;
    // Blood soaked into skin and cloth round it, and the runs, with a mottled edge; thick where it is most.
    float wdG = wdM.g + (wdN2 - 0.5) * 0.22 + (wdN1 - 0.5) * 0.18;
    wdSoak = smoothstep(0.12, 0.46, wdG);
    wdThick = smoothstep(0.5, 0.95, wdG);
    if (uWoundLook.y > 0.5) {
      // Opened: a pale ring of fat just inside the edge, and bone glimpsed where it is deepest.
      wdFat = smoothstep(0.3, 0.35, wdO) * (1.0 - smoothstep(0.37, 0.45, wdO)) * (0.55 + 0.45 * wdN3);
      wdBone = smoothstep(0.76, 0.94, wdM.b + (wdN3 - 0.5) * 0.24) * smoothstep(0.42, 0.62, wdN1);
    }
    wdH = wdRim * 0.12 - wdFlesh * 0.45 - wdCore * 0.55 + (wdN3 - 0.5) * 0.2 * wdFlesh + wdBone * 0.25;
  }
}`;

/** Fragment: after `#include <color_fragment>`, before the char's. */
export const WOUND_FRAGMENT_ALBEDO = /* glsl */ `if (wdSoak + wdFlesh + wdRim > 0.001) {
  vec3 wdBase = diffuseColor.rgb;
  // Soaked: the paint darkened by blood, deep crimson going to near black where it lies thick, the weave and the
  // metal still under it. (Brighter and redder read as wet red paint in the arena's warm light.)
  vec3 wdSoaked = wdBase * vec3(0.16, 0.035, 0.03) + vec3(0.036, 0.0024, 0.0018);
  diffuseColor.rgb = mix(wdBase, mix(wdSoaked, vec3(0.016, 0.0012, 0.001), wdThick * 0.8), wdSoak * 0.88);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.002, 0.0015), wdRim * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, wdBase * 0.4 + vec3(0.02, 0.002, 0.0015), wdFray * 0.65);
  vec3 wdMeat = mix(vec3(0.07, 0.007, 0.006), vec3(0.2, 0.03, 0.026), wdN2 * 0.6 + wdN4 * 0.4) * (0.55 + 0.8 * wdN3);
  diffuseColor.rgb = mix(diffuseColor.rgb, wdMeat, wdFlesh);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.6, 0.36) * (0.8 + 0.3 * wdN2), wdFat * wdFlesh);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.002, 0.002), wdCore * (1.0 - 0.6 * wdBone));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.75, 0.64) * (0.75 + 0.3 * wdN3), wdBone * wdCore);
}`;

/** Fragment: after `#include <roughnessmap_fragment>`, before the char's. Fresh blood and flesh shine; they dull as they dry. */
export const WOUND_FRAGMENT_ROUGHNESS = /* glsl */ `roughnessFactor = mix(roughnessFactor, mix(0.66, 0.3, uWoundLook.x) - 0.12 * wdThick * uWoundLook.x, wdSoak * 0.85);
roughnessFactor = mix(roughnessFactor, mix(0.55, 0.2, uWoundLook.x) + 0.12 * wdN3, max(wdFlesh, wdRim * 0.6));
roughnessFactor = mix(roughnessFactor, 0.42, wdBone * wdCore);`;

/** Fragment: after `#include <metalnessmap_fragment>`. Blood over steel does not shine like steel. */
export const WOUND_FRAGMENT_METALNESS = /* glsl */ `metalnessFactor *= 1.0 - max(wdSoak, max(wdFlesh, wdRim));`;

/** How deep the bent normal makes the wound look, in view units per unit of `wdH`. */
export const WOUND_BUMP_DEPTH = 0.006;

/** Fragment: after `#include <normal_fragment_maps>`. Uniform control flow only: the slope is a screen derivative. */
export const WOUND_FRAGMENT_NORMAL = /* glsl */ `if (uWoundOn > 0.5) {
  normal = wdBend(-vViewPosition, normal, vec2(dFdx(wdH), dFdy(wdH)) * ${WOUND_BUMP_DEPTH.toFixed(4)}, faceDirection);
}`;
