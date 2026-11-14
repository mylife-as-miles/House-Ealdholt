// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * What the sun pillar does to the stone: one quad lying on the victim's square, drawn by its shader alone.
 *
 * Before the blow it is the warning: a ring with the sun's rays standing off it and a band of script turning
 * inside (the kit's rune ring), written by two pens that leave the side nearest the caster and meet at the far
 * side, then brightening in pulses while the stone inside it warms. At the blow it is the flash on the stone, the
 * shock that runs out along it, and the cracks the shock opens behind itself. Afterwards it is what is left: the
 * ring and the cracks cooling from white through gold and red to dark, on stone that is charred.
 *
 * From the reference's ShockRing: a wave that decelerates and thins as it spreads, with a wake, and radial
 * cracks that exist only behind the front and then cool. Ours: the cracks take their colour from a temperature
 * that falls, not from a fixed tint; the quad also chars (it is drawn premultiplied, so it can darken the stone
 * as well as light it); and the ring that warned is the thing that is left glowing.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import { RUNE_RING } from "../../mystic/beam";

/** The quad reaches this many ring radii out, so the shock and the light on the stone have room to run. */
const REACH = 4.6;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius;
varying vec2 vPlace;
void main() {
  // position.xy is -1..1 across the quad; vPlace is in ring radii from its centre, x and z as on the board
  vPlace = position.xy * ${REACH.toFixed(1)};
  vec3 at = uCentre + vec3(position.x, 0.0, position.y) * uRadius * ${REACH.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
${RUNE_RING}
uniform vec3 uWhite, uGold, uAmber, uRed;
uniform float uTime, uDrawn, uRing, uWarn, uBurst, uFlash, uHeat, uScorch, uColumn, uStart, uShock, uCracks, uSeed, uGain;
varying vec2 vPlace;
vec2 turned(vec2 p, float angle) { float c = cos(angle), s = sin(angle); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
// a temperature, not a tint: dark, then red, amber, gold, and white at the top
vec3 glowAt(float heat) {
  vec3 c = mix(uRed * 0.5, uRed, smoothstep(0.0, 0.3, heat));
  c = mix(c, uAmber, smoothstep(0.25, 0.55, heat));
  c = mix(c, uGold, smoothstep(0.5, 0.8, heat));
  return mix(c, uWhite, smoothstep(0.8, 1.0, heat)) * (0.04 + 0.96 * heat * heat);
}
void main() {
  float r = length(vPlace), angle = atan(vPlace.y, vPlace.x);
  float round = angle / 6.2831853 + 0.5;
  // two pens leave the side nearest the caster and meet at the far side
  float away = abs(mod(angle - uStart + 3.14159265, 6.2831853) - 3.14159265) / 3.14159265;
  float inked = uDrawn >= 1.0 ? 1.0 : 1.0 - smoothstep(uDrawn - 0.03, uDrawn + 0.004, away);
  float fromNib = (away - uDrawn) / 0.022, offRim = (r - 1.0) / 0.1;
  float nib = uDrawn < 1.0 && uDrawn > 0.0 ? exp(-fromNib * fromNib) * exp(-offRim * offRim) : 0.0;
  // the sun's ring: a heavy rim and a fine one, rays standing off it by turns long and short, and script inside
  float rim = smoothstep(0.035, 0.0, abs(r - 1.0)) + smoothstep(0.014, 0.0, abs(r - 0.9));
  float beat = round * 24.0 + uTime * 0.25;
  float reach = mod(floor(beat), 2.0) < 0.5 ? 0.3 : 0.16, along = (r - 1.06) / reach;
  float rays = step(0.0, along) * step(along, 1.0) * smoothstep(0.0, 0.07, (1.0 - along) * 0.4 - abs(fract(beat) - 0.5));
  float script = runeRing(turned(vPlace, -uTime * 0.3) / 0.84 * 0.5 + 0.5, 5.0 + uSeed) * step(r, 0.84);
  float ink = (rim + rays * 0.85 + script * 0.7) * inked;
  // the ring is as hot as the spell says: gold as it is written, white at the blow, red as it cools
  float flicker = 0.88 + 0.12 * noise(vec2(uTime * 4.0, round * 50.0));
  vec3 light = glowAt(clamp(0.66 + 0.3 * uWarn + 0.3 * max(uRing - 1.0, 0.0), 0.0, 1.0) * (uBurst >= 0.0 ? 0.25 + 0.75 * uHeat : 1.0)) * ink * uRing * 1.6 * flicker + mix(uGold, uWhite, 0.6) * nib * 1.5;
  // the stone inside the ring warms through the warning, and is molten for a moment after the blow
  float mottled = 0.6 + 0.4 * noise(vPlace * 4.0 + uSeed);
  light += glowAt(uBurst >= 0.0 ? uHeat * mottled : 0.45 + 0.3 * uWarn) * exp(-r * r * 1.5) * (uBurst >= 0.0 ? uHeat * 1.3 : uWarn * 0.55 * (0.75 + 0.25 * noise(vPlace * 3.0 - vec2(0.0, uTime * 0.8))));

  float wave = 0.0, crack = 0.0, front = 0.0;
  if (uBurst >= 0.0) {
    // the shock: out fast and slowing, thinning as the same blow is carried by a longer front, with a wake
    float spent = clamp(uBurst / 0.55, 0.0, 1.0);
    front = uShock * (1.0 - (1.0 - spent) * (1.0 - spent));
    float thick = mix(0.26, 0.08, spent);
    wave = (smoothstep(thick, 0.0, abs(r - front)) + smoothstep(front - 1.0, front, r) * step(r, front) * 0.22) * pow(1.0 - spent, 1.4) / (0.45 + 0.3 * front);
    // the cracks the shock opens behind itself: each its own length, wandering off its bearing, tapering to a point
    if (uCracks > 0.5) {
      float cell = round * uCracks + uSeed, index = floor(cell);
      float far = mix(1.25, 2.3, hash(vec2(index, uSeed)));
      float off = fract(cell) - 0.5 + (noise(vec2(r * 3.4, index * 3.7 + uSeed)) - 0.5) * 0.55;
      float thin = 0.022 * (1.0 - smoothstep(0.2, far, r)) / max(r, 0.06) / 6.2831853 * uCracks;
      crack = (1.0 - smoothstep(thin, thin * 2.0 + 0.004, abs(off))) * step(0.3, r) * step(r, far) * (1.0 - smoothstep(front - 0.35, front, r));
      light += glowAt(uHeat * (1.0 - 0.45 * r / far)) * crack * 1.7;
    }
    light += mix(uGold, uWhite, 0.5) * (wave * 1.2 + exp(-r * r * 0.7) * uFlash * 0.7);
  }
  // the stone round about takes the column's light
  light += uGold * exp(-r * r * 0.2) * (0.16 * uColumn + (uBurst >= 0.0 ? 0.0 : 0.06 * uWarn));

  // char: soot where the column stood, and down the cracks
  float soot = uScorch * (smoothstep(1.45, 0.4, r) * (0.42 + 0.3 * noise(vPlace * 5.0 + 3.0)) + crack * 0.5 + ink * 0.25);
  float edge = 1.0 - smoothstep(${(REACH - 0.6).toFixed(2)}, ${REACH.toFixed(2)}, r);
  light *= edge;
  if (soot < 0.004 && max(max(light.r, light.g), light.b) < 0.003) discard;
  // premultiplied: the soot darkens the stone and the light is added on top
  gl_FragColor = vec4(light * uGain, min(soot, 0.8));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SunSealOptions {
  stone: Point;
  /** The ring's radius, and how far the shock runs, on the stone. */
  ring: number;
  reach: number;
  /** The angle about the stone at which the pens start (sunPlan.penStart). */
  start: number;
  /** Heat cracks to draw: 0 for none. */
  cracks: number;
  white: number;
  gold: number;
  amber: number;
  red: number;
  seed: number;
}

export class SunSeal {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;

  constructor(options: SunSealOptions) {
    this.uniforms = {
      // lifted a hair off the stone so it never fights it for depth
      uCentre: { value: new THREE.Vector3(options.stone.x, options.stone.y + 0.014, options.stone.z) }, uRadius: { value: options.ring },
      uShock: { value: options.reach / options.ring }, uStart: { value: options.start }, uCracks: { value: options.cracks }, uSeed: { value: (options.seed % 389) * 0.173 },
      uTime: { value: 0 }, uDrawn: { value: 0 }, uRing: { value: 0 }, uWarn: { value: 0 }, uBurst: { value: -1 }, uFlash: { value: 0 }, uHeat: { value: 0 }, uScorch: { value: 0 }, uColumn: { value: 0 }, uGain: { value: 1 },
      uWhite: { value: new THREE.Color(options.white) }, uGold: { value: new THREE.Color(options.gold) }, uAmber: { value: new THREE.Color(options.amber) }, uRed: { value: new THREE.Color(options.red) },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 3;
  }

  /** How much of the ring is drawn (0..1), how brightly it burns, and how far the warning has built (0..1). */
  setRing(drawn: number, ring: number, warn: number): void { this.uniforms.uDrawn.value = drawn; this.uniforms.uRing.value = ring; this.uniforms.uWarn.value = warn; }
  /** Seconds since the blow (negative before it), its flash, and the column's strength, each 0..1. */
  setBlow(seconds: number, flash: number, column: number): void { this.uniforms.uBurst.value = seconds; this.uniforms.uFlash.value = flash; this.uniforms.uColumn.value = column; }
  /** How hot the stone is, and how charred, each 0..1. */
  setStone(heat: number, scorch: number): void { this.uniforms.uHeat.value = heat; this.uniforms.uScorch.value = scorch; }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
