// Adapted from HandCastAbilityThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The phoenix's fire, as one rule every layer shares: fire is a temperature, not a palette.
 *
 * Every layer of the rite (the bird's body and feathers, the seal, the washed stone, the sun) computes a heat from
 * 0 (dark) to 1 (white-hot) and burns it through {@link FIRE}: the hue runs white, gold, amber, red as it cools, in
 * Solforiz's own colours (SPELL_LOOK.sun), and the light it gives falls steeply with it, so the white root of a
 * feather is many times brighter than its red tip and the two read as one fire at any exposure.
 *
 * From the reference's PhoenixMaterials.js (`FIRE_GLSL`): heat to kelvin, a Planckian radiator whose power goes
 * as a high power of its temperature, and an authored ramp blended over it. The radiator is Tanner Helland's fit,
 * as there. Ours: the ramp is the kingdom's look and carries most of the colour, the radiator only shades it, and
 * the noise is the kit's value noise (vfx/spells/shared/ribbon.ts), not the reference's simplex.
 */
import * as THREE from "three";
import type { SpellLook } from "../../spellLook";

/** Hashes and a smooth value noise, named apart from the kit's so both can sit in one shader. */
export const FIRE_NOISE = /* glsl */ `
#ifndef FIRE_NOISE
#define FIRE_NOISE
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
#endif
`;

/**
 * `vec3 fire(float heat)`: the light a flame at `heat` gives, in the kingdom's colours. `uWhite`, `uGold`,
 * `uAmber` and `uRed` are its four temperatures; `uDay` how the match shows the frame (see below).
 */
export const FIRE = /* glsl */ `
uniform vec3 uWhite, uGold, uAmber, uRed;
// How the match shows the frame, read off the gain it hands the rite: 1 where it is shown at an exposure near 1 through
// the 360 arenas' AgX grade (Eclipse and Violet Night alike), 0 at the baked fallback's exposure of 5.
uniform float uDay;
// A Planckian radiator (Tanner Helland's fit), returned linear.
vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 12000.0) * 0.01;
  vec3 c;
  if (t <= 66.0) {
    c.r = 1.0;
    c.g = 0.3900816 * log(t) - 0.6318414;
    c.b = t <= 19.0 ? 0.0 : 0.5432068 * log(t - 10.0) - 1.1962540;
  } else {
    c.r = 1.2929362 * pow(t - 60.0, -0.1332047);
    c.g = 1.1298909 * pow(t - 60.0, -0.0755148);
    c.b = 1.0;
  }
  c = clamp(c, 0.0, 1.0);
  return c * c * (0.6 + 0.4 * c);
}
vec3 fire(float heat) {
  float h = clamp(heat, 0.0, 1.25);
  // the kingdom's ramp: red where it dies, amber, gold, and white only at the very top
  vec3 tone = mix(uRed * 0.4, uRed, smoothstep(0.0, 0.22, h));
  tone = mix(tone, uAmber, smoothstep(0.2, 0.5, h));
  tone = mix(tone, uGold, smoothstep(0.48, 0.8, h));
  tone = mix(tone, uWhite, smoothstep(0.84, 1.05, h));
  // the radiator at that temperature only shades it, so the hue stays Solforiz's
  vec3 body = blackbody(mix(1150.0, 6500.0, clamp(h, 0.0, 1.0)));
  vec3 colour = mix(body * max(dot(tone, vec3(0.333)), 0.0) / max(dot(body, vec3(0.333)), 1e-3), tone, 0.75);
  // The arenas tone-map with AgX, which turns warm colour beige wherever it carries blue, and pastel as it
  // brightens: below white heat the blue is taken out, so gold stays gold and amber orange.
  colour.b *= mix(0.3, 1.0, smoothstep(0.86, 1.05, h));
  // A hotter flame is many times brighter. The bulk is held in AgX's colourful range (and a sum of a few layers
  // with it); only the hottest cores are driven hard enough to read white.
  vec3 night = colour * (0.04 + 0.75 * h * h + 1.4 * smoothstep(0.9, 1.15, h));
  // Through the 360 arenas' grade at an exposure near 1, AgX keeps only a deep red-orange as fire: gold there reads
  // khaki and amber tan (measured through their own LUT). So there the bulk burns from the kingdom's red toward its amber,
  // and the hottest goes to white from about 0.8: white is a level, not a hue, and comes through the grade as white, so
  // a flame has a range of brightness (a white heart in red-orange) and not one flat orange.
  vec3 dayTone = mix(uRed * 0.6, uRed, smoothstep(0.0, 0.35, h));
  dayTone = mix(dayTone, uAmber, smoothstep(0.42, 0.8, h));
  dayTone = mix(dayTone, uWhite, smoothstep(0.78, 1.02, h));
  vec3 day = dayTone * (0.08 + 1.6 * h * h + 3.0 * smoothstep(0.8, 1.15, h));
  return mix(night, day, uDay);
}
`;

/**
 * The seal's plane, while the bird comes through it: what is behind it (in a cone opening back from its middle, the
 * way the bird and its tail come) is not there yet, and what has just come through is molten. `bool behindSeal(vec3
 * world)` says which; `float sealCut(vec3 world)` returns how molten (0..1), and discards what is behind.
 */
export const SEAL_BEHIND = /* glsl */ `
uniform vec4 uCut;
uniform vec3 uCutCentre;
uniform float uCutRadius, uCutOn;
bool behindSeal(vec3 world) {
  if (uCutOn < 0.5) return false;
  float d = dot(uCut.xyz, world) - uCut.w;
  return d < 0.0 && d > -16.0 && length(world - uCut.xyz * d - uCutCentre) < uCutRadius * 1.7 - d * 1.1;
}
`;

/** {@link SEAL_BEHIND} and `float sealCut(vec3 world)`, for fragment shaders (it discards). */
export const SEAL_CUT = /* glsl */ `
${SEAL_BEHIND}
float sealCut(vec3 world) {
  if (uCutOn < 0.5) return 0.0;
  if (behindSeal(world)) discard;
  float d = dot(uCut.xyz, world) - uCut.w;
  float r = length(world - uCut.xyz * d - uCutCentre);
  return exp(-max(d, 0.0) / 0.055) * (1.0 - smoothstep(uCutRadius * 0.9, uCutRadius * 1.5, r));
}
`;

/** The four temperatures of Solforiz's fire, from its look, as hex colours. */
export function fireColours(look: SpellLook): { white: number; gold: number; amber: number; red: number } {
  return {
    white: new THREE.Color(look.core).lerp(new THREE.Color(0xffffff), 0.7).getHex(),
    gold: look.core,
    amber: look.ember,
    red: look.flame,
  };
}

/** The uniforms {@link FIRE} reads, shared by every material of the rite (the same objects, so one write reaches all). */
export function fireUniforms(look: SpellLook): Record<string, THREE.IUniform> {
  const colours = fireColours(look);
  return {
    uWhite: { value: new THREE.Color(colours.white) }, uGold: { value: new THREE.Color(colours.gold) },
    uAmber: { value: new THREE.Color(colours.amber) }, uRed: { value: new THREE.Color(colours.red) },
  };
}

/** The uniforms {@link SEAL_CUT} reads, shared by everything of the bird. */
export function cutUniforms(): Record<string, THREE.IUniform> {
  return { uCut: { value: new THREE.Vector4(0, 1, 0, -1e3) }, uCutCentre: { value: new THREE.Vector3() }, uCutRadius: { value: 1 }, uCutOn: { value: 0 } };
}
