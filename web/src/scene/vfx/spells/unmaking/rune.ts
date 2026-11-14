// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The rune the Unmaking writes under its victim: one quad lying on the stone, drawn by its shader alone.
 *
 * It is written by a pen that leaves the side facing the caster and runs once round, the rune irising out as it
 * goes; it holds still through the beat while the stone inside it goes dark; in the inhale its light runs inward
 * from the rim and goes out; at the blow a ring is thrown across the stone; while the column stands its band of
 * script gives up its glyphs one by one (each cell that lifts is left empty: unmaking/unmaking.ts carries the glyph
 * up the column); and at the end it takes the last of the light, and its ink burns out from the rim inward, the
 * strokes cooling from gilt through red to dark in a charred disc.
 *
 * From the reference's SummonSeal: everything is arithmetic on the fragment's polar place, so the strokes stay
 * sharp at any distance; rims, ticks and a band of glyphs turning against an inner ring; and a pen with a bright
 * head, so the pattern arrives in the order a hand would cut it. Ours: the glyphs are the kit's (the same cells as
 * `RUNE_RING`, so a lifted glyph can be drawn again exactly), no figure in it belongs to any real faith, it darkens
 * the stone as well as lighting it (it is drawn premultiplied), and it ends by burning out, not by shrinking away.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import { RUNE_RING } from "../../mystic/beam";
import { RUNE_CELLS } from "./unmakingPlan";

/** The hash the rune's glyphs are chosen by. The glyphs carried up the column use the same one, so they match. */
export const GLYPH_HASH = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/**
 * The marks in cell `cell` of a band of script at grid place `grid` (x 0..3 along the band, y 0..4 across it), as
 * the kit's rune ring draws them: each of twelve places holds an upright stroke, a level one or nothing, by a hash.
 * `keep` takes strokes away one by one as it falls from 1 to 0, in an order of their own.
 */
export const GLYPH_MARKS = /* glsl */ `
float glyphMarks(float cell, vec2 grid, float seed, float keep) {
  vec2 id = floor(grid), f = fract(grid);
  if (id.x < 0.0 || id.x > 2.0 || id.y < 0.0 || id.y > 3.0) return 0.0;
  float pick = hash(vec2(cell * 7.31 + id.x * 1.7 + seed * 13.1, id.y * 3.3 + seed));
  float upright = smoothstep(0.26, 0.10, abs(f.x - 0.5)) * step(0.08, f.y) * step(f.y, 0.92);
  float level = smoothstep(0.30, 0.12, abs(f.y - 0.5)) * step(0.06, f.x) * step(f.x, 0.94);
  float mark = pick > 0.62 ? upright : pick > 0.30 ? level : 0.0;
  float order = hash(vec2(cell * 3.17 + id.x * 5.3, id.y * 2.9 + 17.0));
  return mark * smoothstep(order - 0.04, order + 0.04, keep);
}
`;

/** The seed the rune's band of glyphs is chosen with. */
export const GLYPH_SEED = 4.0;

const NOISE = /* glsl */ `
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius, uReach;
varying vec2 vPlace;
void main() {
  // position.xy is -1..1 across the quad; vPlace is in rune radii from its centre, x and z as on the board
  vPlace = position.xy * uReach;
  vec3 at = uCentre + vec3(position.x, 0.0, position.y) * uRadius * uReach;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
#define TAU 6.2831853
${GLYPH_HASH}
${NOISE}
${RUNE_RING}
${GLYPH_MARKS}
uniform vec3 uGold, uGoldHot, uGlow, uCore;
uniform float uTime, uTurn, uStart, uDrawn, uScale, uInk, uDark, uInhale, uSince, uFlash, uBurnt, uCold, uSwallow, uOuter, uShock, uReach, uGain, uSeed;
uniform float uPeel[${RUNE_CELLS}];
varying vec2 vPlace;
float line(float x, float centre, float width) { return smoothstep(width, width * 0.35, abs(x - centre)); }
vec2 turned(vec2 p, float angle) { float c = cos(angle), s = sin(angle); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
void main() {
  float R = length(vPlace);
  vec2 q = vPlace / max(uScale, 0.05);
  float r = length(q);
  // the rune's own frame: it turns, and the pen and the cells are fixed in it
  vec2 own = turned(q, -uTurn);
  float away = fract((atan(own.y, own.x) - uStart) / TAU);
  float inked = uDrawn >= 1.0 ? 1.0 : 1.0 - smoothstep(uDrawn - 0.012, uDrawn + 0.002, away);
  float fromPen = (away - uDrawn) * 40.0;
  float pen = uDrawn > 0.0 && uDrawn < 1.0 ? exp(-fromPen * fromPen) * smoothstep(1.06, 0.98, r) * smoothstep(0.5, 0.58, r) : 0.0;

  // rims, the scale of ticks, the band of glyphs between its rails, and an inner ring turning against it
  float rims = line(r, 0.975, 0.018) + line(r, 0.935, 0.008) * 0.6 + line(r, 0.865, 0.007) * 0.55 + line(r, 0.56, 0.007) * 0.55;
  float tick = away * 80.0, major = step(3.5, mod(floor(tick), 4.0));
  float ticks = step(mix(0.89, 0.875, major), r) * step(r, 0.928) * smoothstep(0.32, 0.12, abs(fract(tick) - 0.5)) * mix(0.55, 1.0, major);
  float cell = away * ${RUNE_CELLS.toFixed(1)}, index = floor(cell), across = (r - 0.615) / 0.215;
  float peel = uPeel[int(clamp(index, 0.0, ${(RUNE_CELLS - 1).toFixed(1)}))], lifted = peel >= 0.0 && uSince >= peel ? 1.0 : 0.0;
  float inBand = step(0.0, across) * step(across, 1.0) * step(0.14, fract(cell)) * step(fract(cell), 0.86);
  float glyph = inBand * glyphMarks(index, vec2((fract(cell) - 0.14) / 0.72 * 3.0, across * 4.0), ${GLYPH_SEED.toFixed(1)}, 1.0);
  // a cell flares as its glyph lifts out of it, and is left empty
  float lifting = peel >= 0.0 && uSince >= peel ? exp(-(uSince - peel) / 0.06) : 0.0;
  float inner = runeRing(turned(own, uTurn * 2.6) / 0.46 * 0.5 + 0.5, uSeed + 7.0) * step(r, 0.47);
  // a Queen's rune has a second ring outside it, turning the other way
  float outer = 0.0;
  if (uOuter > 0.5) {
    vec2 o = turned(q, uTurn * 1.7);
    float oa = fract(atan(o.y, o.x) / TAU), oc = oa * 36.0;
    outer = line(r, 1.08, 0.01) * 0.7 + line(r, 1.24, 0.016) + step(1.11, r) * step(r, 1.2) * step(0.5, fract(oc)) * smoothstep(0.32, 0.1, abs(fract(oc * 2.0) - 0.5)) * 0.8;
  }
  float strokes = (rims + ticks + glyph * (1.0 - lifted) + inner * 0.8 + outer) * inked;

  // the ink burns out from the rim inward at the end: behind the front a stroke is an ember that cools
  float front = 1.3 - 1.55 * uBurnt + (noise(q * 7.0 + uSeed) - 0.5) * 0.1;
  float burnt = uBurnt > 0.0 ? smoothstep(front - 0.02, front + 0.04, r) : 0.0;
  float fromFront = (r - front) / 0.035;
  float edge = uBurnt > 0.0 && uBurnt < 1.0 ? exp(-fromFront * fromFront) : 0.0;
  float flicker = 0.85 + 0.15 * noise(vec2(uTime * 3.0, away * 50.0));
  vec3 ink = mix(uGold, uGoldHot, 0.25 * uFlash + 0.5 * lifting) * strokes * (1.0 - burnt) * uInk * 1.35 * flicker;
  float heat = (1.0 - uCold) * (0.55 + 0.45 * noise(q * 13.0 + 3.0));
  vec3 ember = mix(uGlow * vec3(0.9, 0.25, 0.25), mix(uGold, uGoldHot, smoothstep(0.7, 1.0, heat)), smoothstep(0.25, 0.85, heat)) * heat * heat * strokes * burnt * 1.2;
  vec3 light = ink + ember + uGoldHot * (pen * 2.2 + edge * strokes * 1.6 + lifting * glyph * 1.5);

  // the stone inside it: violet light pooled while it is written and lit, drawn in and out in the inhale
  float mottle = 0.6 + 0.4 * noise(q * 3.1 + vec2(uTime * 0.3, -uTime * 0.2));
  light += uGlow * exp(-r * r * 2.6) * mottle * 0.32 * uInk * inked * (1.0 - burnt);
  // the inhale: a ring of light runs in from the rim, and what it gathers is a seed of light at the middle
  float runIn = uInhale > 0.0 ? line(r, 1.0 - uInhale, 0.09) * (0.8 + 1.2 * uInhale) : 0.0;
  float seed = uInhale * uInhale * (exp(-r * r * 90.0) * 2.4 + exp(-r * r * 14.0) * 0.5);
  light += mix(uGlow, uCore, 0.55) * (runIn * 1.4 + seed);

  // the blow: a pale flash on the stone, and a ring thrown out across it that slows and thins
  if (uSince >= 0.0) {
    float spent = clamp(uSince / 0.5, 0.0, 1.0), reach = uShock * (1.0 - (1.0 - spent) * (1.0 - spent));
    float wave = line(R / max(uScale, 0.05), reach, mix(0.16, 0.05, spent)) * pow(1.0 - spent, 1.4);
    light += mix(uGlow, uCore, 0.6) * (wave * 1.3 + exp(-r * r * 1.4) * uFlash * 0.8);
  }
  // the last of the light, taken in: a ring running out from the middle as the thread goes into the stone
  if (uSwallow >= 0.0 && uSwallow < 0.32) light += mix(uGold, uGoldHot, 0.5) * line(r, uSwallow / 0.32, 0.07) * (1.0 - uSwallow / 0.32) * 1.6 * smoothstep(1.04, 0.95, r);

  // dark: the void inside the rune before the blow, char after it, and soot down the burnt strokes
  float dark = uDark * smoothstep(1.02, 0.45, r) * (0.62 + 0.38 * noise(q * 4.3 + uSeed * 2.0)) + strokes * burnt * 0.45 * uDark;
  float fade = 1.0 - smoothstep(uReach - 0.35, uReach, R);
  light *= fade;
  if (dark < 0.004 && max(max(light.r, light.g), light.b) < 0.003) discard;
  // premultiplied: the dark covers the stone and the light is added on top
  gl_FragColor = vec4(light * uGain, min(dark, 0.85));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface RuneOptions {
  stone: Point;
  /** The rune's radius on the stone, and how far its thrown ring runs, in rune radii. */
  radius: number;
  shock: number;
  /** The bearing about the stone at which the pen starts (unmakingPlan.penStart). */
  start: number;
  /** Seconds after the blow at which each cell's glyph lifts (unmakingPlan.glyphPeels), -1 for those that stay. */
  peels: readonly number[];
  /** A Queen's rune: a second ring outside it. */
  outer: boolean;
  gold: number;
  goldHot: number;
  /** The kingdom's violet, and the white of its heart. */
  glow: number;
  core: number;
  seed: number;
}

export class UnmakingRune {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;

  constructor(options: RuneOptions) {
    const reach = options.shock + 0.3;
    this.uniforms = {
      // lifted a hair off the stone so it never fights it for depth
      uCentre: { value: new THREE.Vector3(options.stone.x, options.stone.y + 0.013, options.stone.z) }, uRadius: { value: options.radius }, uReach: { value: reach },
      uShock: { value: options.shock }, uStart: { value: options.start }, uOuter: { value: options.outer ? 1 : 0 }, uSeed: { value: (options.seed % 389) * 0.173 },
      uPeel: { value: Float32Array.from({ length: RUNE_CELLS }, (_, i) => options.peels[i] ?? -1) },
      uTime: { value: 0 }, uTurn: { value: 0 }, uDrawn: { value: 0 }, uScale: { value: 1 }, uInk: { value: 0 }, uDark: { value: 0 }, uInhale: { value: 0 },
      uSince: { value: -1 }, uFlash: { value: 0 }, uBurnt: { value: 0 }, uCold: { value: 0 }, uSwallow: { value: -1 }, uGain: { value: 1 },
      uGold: { value: new THREE.Color(options.gold) }, uGoldHot: { value: new THREE.Color(options.goldHot) }, uGlow: { value: new THREE.Color(options.glow) }, uCore: { value: new THREE.Color(options.core) },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 3;
  }

  /** How much the pen has written (0..1), a factor on the radius, how far round it has turned, and how brightly its ink burns. */
  setRune(drawn: number, scale: number, turn: number, ink: number): void {
    const u = this.uniforms;
    u.uDrawn.value = drawn; u.uScale.value = scale; u.uTurn.value = turn; u.uInk.value = ink;
  }
  /** How dark the stone inside it is, and how far the inhale has come, each 0..1. */
  setStone(dark: number, inhale: number): void { this.uniforms.uDark.value = dark; this.uniforms.uInhale.value = inhale; }
  /** Seconds since the blow (negative before), its flash, and seconds since the column was swallowed (negative before). */
  setBlow(since: number, flash: number, swallow: number): void { const u = this.uniforms; u.uSince.value = since; u.uFlash.value = flash; u.uSwallow.value = swallow; }
  /** How far the ink has burnt out from the rim (0..1), and how cold what is left is (0..1). */
  setBurn(burnt: number, cold: number): void { this.uniforms.uBurnt.value = burnt; this.uniforms.uCold.value = cold; }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
