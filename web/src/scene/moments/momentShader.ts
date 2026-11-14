/**
 * The moments' grade as GLSL (docs/play/MOMENTS.md), shared by the match's two pipelines:
 *
 * - the arena's look (main game/src/play/battlefield-look.ts), whose own grade pass carries it: the ripple and the
 *   fringe bend where the scene is read, the spell's darkness and the defeat's light work on the scene's own light
 *   before the exposure and the AgX table (`moScene`), and the colour work on the frame as shown, after the table
 *   (`moGrade`);
 * - the fallback chain (postfx.ts), where a pass after the output conversion does all of it on the frame as shown
 *   (`moDisplayLight` in place of `moScene`), and a multiplied overlay is the Low preset's cheap version.
 *
 * Every instruction sits behind `uMoOn` (or its own amount), so a neutral grade costs a uniform test and leaves the
 * frame exactly as it was drawn.
 */
import type { MomentGrade } from "./momentPlan";
import { MONO_EDGE } from "./momentPlan";

/** Uniforms, the helpers and the three stages. Needs nothing else declared. */
export const MOMENT_GLSL = /* glsl */ `
uniform float uMoOn, uMoVignette;
// centre (uv) and aspect; ripple front, width, bend and the fringe; black and white, its sweep, the hue kept and its
// half-width; darkness, far darkness, light and colour taken; the hue drained, its half-width, how far, the hue spared
uniform vec4 uMoCentre, uMoWave, uMoMono, uMoTone, uMoDrain;
const vec3 MO_LUMA = vec3(0.2126, 0.7152, 0.0722);

// From the contact point, in frame heights.
vec2 moOffset(vec2 uv) { return (uv - uMoCentre.xy) * vec2(uMoCentre.z, 1.0); }

// The ripple: round its front the frame is bent along the line from the contact point, pushed out ahead of the front
// and drawn in behind it (a lens-like ring, with no light of its own).
vec2 moWarp(vec2 uv) {
  if (uMoWave.z <= 0.0) return uv;
  vec2 d = moOffset(uv);
  float r = length(d);
  if (r < 1e-5) return uv;
  float x = (r - uMoWave.x) / max(uMoWave.y, 1e-4);
  float bend = 1.6487 * x * exp(-x * x);
  return uv - (d / r) * (bend * uMoWave.z) / vec2(uMoCentre.z, 1.0);
}

// The frame at uv, its red and blue drawn apart along the line from the contact point, more the further from it.
vec3 moFetch(sampler2D tex, vec2 uv) {
  if (uMoWave.w <= 0.0) return texture2D(tex, uv).rgb;
  vec2 shift = (uv - uMoCentre.xy) * uMoWave.w;
  return vec3(texture2D(tex, uv + shift).r, texture2D(tex, uv).g, texture2D(tex, uv - shift).b);
}

// The scene's own light, before the exposure: a spell's darkness presses shadows and mid-tones down and keeps the
// highlights, which are its own light, near the fight; far off (the hall, the sky) nothing is kept. The defeat
// drains all of it.
vec3 moScene(vec3 c, float metres) {
  if (uMoTone.x > 0.0) {
    float keep = smoothstep(0.45, 2.4, dot(c, MO_LUMA)) * (1.0 - uMoTone.y * smoothstep(40.0, 160.0, metres));
    c *= mix(1.0 - uMoTone.x, 1.0, keep);
  }
  return c * uMoTone.z;
}

// The same on a frame already shown (the fallback chain): its values are about the square root of the light's.
vec3 moDisplayLight(vec3 d) {
  if (uMoTone.x > 0.0) {
    float keep = smoothstep(0.62, 0.95, dot(d, MO_LUMA));
    d *= mix(pow(1.0 - uMoTone.x, 0.45), 1.0, keep);
  }
  return d * pow(uMoTone.z, 0.45);
}

vec3 moHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

// How near a hue is to a centre, inside a half-width: whole within a third of it, then a long soft edge, so the colour
// kept never breaks up across a figure's own shading.
float moNear(float hue, float centre, float width) {
  float d = abs(fract(hue - centre + 0.5) - 0.5);
  return 1.0 - smoothstep(width * 0.35, width, d);
}

// The colour work, on the frame as shown (0 to 1).
vec3 moGrade(vec3 d, vec2 uv) {
  vec3 hsv = moHsv(d);
  // Greys and the dark have no hue to keep or to drain: the hall's shadows are tinted warm by its lava and its eclipse,
  // and passed for Solforiz's fire as orange specks until only clear, lit colour counted.
  float chroma = smoothstep(0.2, 0.45, hsv.y) * smoothstep(0.08, 0.25, hsv.z);
  float y = dot(d, MO_LUMA);
  vec3 own = d;
  // Colour taken: the dread and a spell's darkness everywhere; the defeat drains the losing kingdom's colour and
  // takes some of the rest, sparing the winner's.
  float spare = uMoDrain.z > 0.0 ? moNear(hsv.x, uMoDrain.w, uMoDrain.y) * chroma : 0.0;
  float drained = uMoDrain.z * moNear(hsv.x, uMoDrain.x, uMoDrain.y) * chroma;
  float grey = 1.0 - (1.0 - uMoTone.w) * (1.0 - 0.55 * uMoDrain.z * (1.0 - spare)) * (1.0 - drained);
  d = mix(d, vec3(y), clamp(grey, 0.0, 1.0));
  // The killing blow: high-contrast black and white sweeping out from the contact point. Shadows and mid-tones are
  // crushed and highlights left where they were, so it is never brighter than the frame it replaces; the attacker's
  // kingdom colour burns through it, a little richer.
  if (uMoMono.x > 0.0) {
    float m = uMoMono.x * (1.0 - smoothstep(uMoMono.y - ${MONO_EDGE.toFixed(3)}, uMoMono.y, length(moOffset(uv))));
    // Over a hall a spell has already darkened the crush eases (uMoTone.x, the darkness), or the two together leave
    // the frame black but for the accent.
    float ink = y * smoothstep(0.02, 0.62 - 0.34 * uMoTone.x, y);
    float accent = moNear(hsv.x, uMoMono.z, uMoMono.w) * chroma;
    vec3 rich = clamp(mix(vec3(y), own, 1.3), 0.0, 1.0);
    d = mix(d, mix(vec3(ink) * vec3(1.0, 0.985, 0.955), rich, accent), m);
  }
  // The vignette closing in, round a point a little above the frame's middle.
  if (uMoVignette > 0.0) d *= 1.0 - 0.85 * uMoVignette * smoothstep(0.55, 1.35, length((uv - vec2(0.5, 0.46)) * 2.0));
  return d;
}
`;

/** The fallback chain's pass (postfx.ts): the whole grade on the frame the output conversion has just shown. */
export function momentPassShader(): { uniforms: MomentUniforms & { tDiffuse: { value: unknown } }; vertexShader: string; fragmentShader: string } {
  return {
    uniforms: { tDiffuse: { value: null }, ...momentUniforms() },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      ${MOMENT_GLSL}
      void main() {
        vec2 uv = moWarp(vUv);
        vec3 d = moDisplayLight(moFetch(tDiffuse, uv));
        gl_FragColor = vec4(moGrade(d, vUv), 1.0);
      }`,
  };
}

/**
 * The Low preset's cheap version in the fallback chain, where nothing reads the frame back (its composer is bypassed):
 * one quad multiplied over the frame while a moment shows. It can darken and close the vignette, not take colour, so
 * the blow is a brief dip of light, a spell's darkness and the defeat are darkness and vignette, the dread a vignette.
 */
export const MOMENT_OVERLAY = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uDark, uVignette;
    varying vec2 vUv;
    void main() {
      float edge = smoothstep(0.55, 1.35, length((vUv - vec2(0.5, 0.46)) * 2.0));
      gl_FragColor = vec4(vec3((1.0 - uDark) * (1.0 - 0.85 * uVignette * edge)), 1.0);
    }`,
};

export type MomentUniforms = {
  uMoOn: { value: number };
  uMoVignette: { value: number };
  uMoCentre: { value: number[] };
  uMoWave: { value: number[] };
  uMoMono: { value: number[] };
  uMoTone: { value: number[] };
  uMoDrain: { value: number[] };
};

/** A neutral set of the moment uniforms, to spread into a material's own. */
export function momentUniforms(): MomentUniforms {
  return {
    uMoOn: { value: 0 }, uMoVignette: { value: 0 },
    uMoCentre: { value: [0.5, 0.5, 16 / 9, 0] }, uMoWave: { value: [0, 0.05, 0, 0] }, uMoMono: { value: [0, 0, 0, 0.05] },
    uMoTone: { value: [0, 0, 1, 0] }, uMoDrain: { value: [0, 0.05, 0, 0] },
  };
}

/**
 * Writes a frame's grade into a material's moment uniforms. `aberration: false` drops the fringe (its two extra reads
 * of the frame per pixel), which the look leaves out of its low feature set. Returns whether anything shows.
 */
export function writeMomentUniforms(uniforms: MomentUniforms, grade: MomentGrade, options: { aberration?: boolean } = {}): boolean {
  const on = grade.on;
  uniforms.uMoOn.value = on ? 1 : 0;
  if (!on) return false;
  const centre = uniforms.uMoCentre.value, wave = uniforms.uMoWave.value, mono = uniforms.uMoMono.value;
  const tone = uniforms.uMoTone.value, drain = uniforms.uMoDrain.value;
  centre[0] = grade.centreX; centre[1] = grade.centreY; centre[2] = grade.aspect;
  wave[0] = grade.waveRadius; wave[1] = grade.waveWidth; wave[2] = grade.waveAmplitude; wave[3] = options.aberration === false ? 0 : grade.aberration;
  mono[0] = grade.mono; mono[1] = grade.sweep; mono[2] = grade.accentHue; mono[3] = grade.accentWidth;
  tone[0] = grade.darkness; tone[1] = grade.far; tone[2] = grade.light; tone[3] = grade.desaturation;
  drain[0] = grade.drainHue; drain[1] = grade.drainWidth; drain[2] = grade.drain; drain[3] = grade.spareHue;
  uniforms.uMoVignette.value = grade.vignette;
  return true;
}

/**
 * The Low overlay's two numbers for a grade (MOMENT_OVERLAY): how far the frame is darkened and how far the vignette
 * closes. The blow's black and white becomes a brief dip of light.
 */
export function overlayFor(grade: MomentGrade): { dark: number; vignette: number } {
  if (!grade.on) return { dark: 0, vignette: 0 };
  const lit = (1 - grade.darkness * 0.55) * Math.pow(Math.max(0, grade.light), 0.45) * (1 - 0.3 * grade.mono);
  return { dark: Math.min(0.9, Math.max(0, 1 - lit)), vignette: Math.min(1, grade.vignette + 0.25 * grade.mono) };
}
