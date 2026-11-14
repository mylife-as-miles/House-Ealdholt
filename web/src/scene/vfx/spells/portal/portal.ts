// Adapted from LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * A fire portal, drawn: the struck ring and the black way through inside it, on one quad in the portal's plane,
 * in two passes. portal/portalPlan.ts places it and gives its clock; whoever owns it (the Fire portal spell, later a
 * summon's arrival) tells it each frame how far round the spark has run, how open the way through is and how hot
 * the ring is. It owns nothing else and allocates nothing after it is made.
 *
 * The way through is drawn first, with normal blending, and writes depth: it takes the room behind it away rather
 * than glowing over it, and what is behind it does not show through. Inside it something stirs before anything
 * comes: a slow spiral of embers far down, and a heart of fire that grows as it comes, then the blaze of what is
 * coming through. The ring is drawn after, coplanar, adding light: a hot line with a long soft bleed outward and
 * almost none inward, the contour ahead of the running spark not there yet, the stroke behind it white-hot and
 * cooling. At the end the ring cools from white through orange and red, and breaks into pieces that go out one by
 * one.
 *
 * From the reference: the two passes, the asymmetric bleed (light past the contour is light in the hole, and the
 * hole is the portal), the gap feathered at both its ends so the bloom has no cliff at the seam, the stroke that is
 * hotter behind the head, the head as a blob of its own. Ours: colour is a temperature, the ring breaks up instead of
 * fading, the darkness has a depth with something in it, a Queen's has a second ring struck the other way round,
 * and three's tone mapping ends both passes, for the tier that draws straight to the canvas.
 */
import * as THREE from "three";
import type { PortalPlacement } from "./portalPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** A temperature as a colour: dark, then red, orange, gold, and white at the top, brighter the hotter. */
export const FIRE_RAMP = /* glsl */ `
uniform vec3 uWhite, uGold, uOrange, uRed;
vec3 fireColour(float heat) {
  vec3 c = mix(uRed * 0.4, uRed, smoothstep(0.0, 0.3, heat));
  c = mix(c, uOrange, smoothstep(0.25, 0.55, heat));
  c = mix(c, uGold, smoothstep(0.5, 0.8, heat));
  return mix(c, uWhite, smoothstep(0.82, 1.0, heat)) * (0.05 + 0.95 * heat * heat);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uCentre, uRight, uUp;
uniform float uQuad;
varying vec2 vPlace;
void main() {
  // vPlace is in board units in the portal's plane, x to its right and y to its top
  vPlace = position.xy * uQuad;
  vec3 at = uCentre + uRight * vPlace.x + uUp * vPlace.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
#define TAU 6.2831853
#define HALF_PI 1.5707963
${NOISE}
${FIRE_RAMP}
uniform vec3 uVoid;
uniform float uRadius, uScribe, uOpen, uAperture, uHead, uTrail, uCool, uCrumble, uStir, uBlaze, uOuter, uScribe2, uTime, uSeed, uGain;
varying vec2 vPlace;
// how much of a ring of radius R the spark has drawn, how hot the stroke is there, and the spark itself
vec3 stroke(float R, float scribe, float turn, float r) {
  float dm = r - R, behind = (scribe - turn) * TAU * R;
  // the gap ahead of the spark is feathered at both its ends, wider off the line, so the bleed has no cliff
  float feather = 0.03 * R + abs(dm) * 2.5;
  float gap = smoothstep(0.0, feather, -behind) * smoothstep(0.0, feather, (1.0 - turn) * TAU * R);
  float drawn = scribe >= 1.0 ? 1.0 : 1.0 - gap;
  float heat = scribe < 1.0 && behind >= 0.0 ? exp(-behind / (uTrail * R)) : 0.0;
  float headAngle = -HALF_PI + min(scribe, 1.0) * TAU;
  float head = exp(-length(vPlace - vec2(cos(headAngle), sin(headAngle)) * R) / (0.045 * R));
  return vec3(drawn, heat, head * (1.0 - step(1.0, scribe)));
}
void main() {
  float r = length(vPlace), R = uRadius;
  float angle = atan(vPlace.y, vPlace.x);
#ifdef APERTURE
  float aperture = uAperture * R * 0.98;
  if (aperture < 0.005) discard;
  float hole = smoothstep(aperture, aperture - 0.02 - 0.05 * R, r);
  if (hole < 0.01) discard;
  // a warm lip, and the middle very nearly black
  float lip = pow(clamp(r / max(aperture, 1e-3), 0.0, 1.0), 5.0);
  vec3 colour = mix(uVoid, uRed * 0.32, lip * 0.85 * (1.0 - uCool));
  // far down in it something stirs: a slow spiral of embers, and a heart of fire that grows as it comes
  float depth = r / max(aperture, 1e-3);
  float spiral = fract(angle / TAU * 3.0 + log(depth + 0.06) * 1.4 - uTime * 0.32);
  float embers = smoothstep(0.7, 1.0, spiral) * (0.4 + 0.6 * noise(vPlace / R * 6.0 + uTime * 0.4)) * (1.0 - depth) * (1.0 - depth);
  colour += fireColour(0.45) * embers * uStir * 1.6;
  colour += fireColour(0.55 + 0.4 * uStir) * exp(-depth * depth * mix(30.0, 8.0, uStir)) * uStir * uStir * 1.4;
  // and then what comes through fills it
  float churn = noise(vPlace / R * 4.0 + vec2(uTime * 3.0, -uTime * 2.3)) * 0.5 + noise(vPlace / R * 9.0 - vec2(uTime * 4.1, uTime * 1.7)) * 0.5;
  colour += fireColour(clamp(0.95 - 0.55 * depth + 0.15 * (churn - 0.5), 0.0, 1.0)) * uBlaze * (0.6 + 0.6 * churn) * 1.6;
  gl_FragColor = vec4(colour * uGain, hole * 0.97);
#else
  float turn = fract((angle + HALF_PI) / TAU);
  float dm = r - R;
  // a long soft bleed outward and nearly none inward: what leaks past the contour is light in the hole
  float band = exp(-abs(dm) / (dm >= 0.0 ? 0.075 * R : 0.022 * R));
  vec3 one = stroke(R, uScribe, turn, r);
  // at the end the ring breaks up and goes out a piece at a time
  float piece = hash(vec2(floor(turn * 40.0), uSeed));
  float kept = 1.0 - smoothstep(piece - 0.04, piece + 0.04, uCrumble * 1.08);
  float flicker = 0.86 + 0.14 * noise(vec2(turn * 60.0, uTime * 5.0));
  float temp = clamp((1.0 - uCool) * (0.62 + 0.38 * one.y) + 0.25 * uBlaze * (1.0 - uCool), 0.0, 1.0) * flicker;
  float glow = band * uOpen * (1.0 + 1.6 * one.y) * one.x * kept;
  float core = pow(band, 4.0) * uOpen * (1.0 + 1.3 * one.y) * one.x * kept;
  vec3 colour = fireColour(temp) * glow * 1.1 + fireColour(min(1.0, temp + 0.28)) * core * 1.3 + uWhite * (one.z * uHead * 2.2 + pow(one.z * uHead, 3.0));
  // the air round the ring takes its heat: drawn, because the lowest tier has no bloom to make it
  colour += fireColour(temp * 0.8) * (exp(-max(dm, 0.0) / (0.35 * R)) * 0.16 + exp(-max(dm, 0.0) / (1.1 * R)) * 0.07) * step(0.0, dm) * uOpen * one.x * kept * (1.0 - smoothstep(1.6 * R, 2.15 * R, r));
  // a Queen's second ring, outside the first, struck the other way round
  if (uOuter > 0.5) {
    float R2 = R * 1.22, band2 = exp(-abs(r - R2) / (r >= R2 ? 0.05 * R : 0.016 * R));
    vec3 two = stroke(R2, uScribe2, 1.0 - turn, r);
    float temp2 = clamp((1.0 - uCool) * (0.55 + 0.4 * two.y), 0.0, 1.0) * flicker;
    colour += fireColour(temp2) * band2 * uOpen * (1.0 + 1.4 * two.y) * two.x * kept * 0.9 + uWhite * two.z * uHead * 1.6;
  }
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The portal's colours: four temperatures of its fire, and the dark of the way through. */
export interface PortalLook { white: number; gold: number; orange: number; red: number; dark: number }

export interface PortalState {
  /** How far round the running spark has got, 0..1 (portalPlan.portalScribe), and the Queen's second, the other way round. */
  scribe: number;
  scribe2?: number;
  /** How lit the ring is, how bright the running spark is, and how open the way through is, each 0..1. */
  open: number;
  head: number;
  aperture: number;
  /** Something stirring in the dark, and the blaze of what comes through, each 0..1. */
  stir: number;
  blaze: number;
  /** How far the ring has cooled, and how far it has broken up, each 0..1. */
  cool: number;
  crumble: number;
}

export class FirePortal {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly meshes: THREE.Mesh[] = [];

  constructor(placement: PortalPlacement, look: PortalLook, options: { outer?: boolean; seed?: number; order?: number } = {}) {
    this.uniforms = {
      uCentre: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uQuad: { value: 1 }, uRadius: { value: 1 },
      uScribe: { value: 0 }, uScribe2: { value: 0 }, uOpen: { value: 0 }, uAperture: { value: 0 }, uHead: { value: 0 }, uTrail: { value: 1.1 }, uCool: { value: 0 }, uCrumble: { value: 0 },
      uStir: { value: 0 }, uBlaze: { value: 0 }, uOuter: { value: options.outer ? 1 : 0 }, uTime: { value: 0 }, uSeed: { value: ((options.seed ?? 1) % 433) * 0.31 }, uGain: { value: 1 },
      uWhite: { value: new THREE.Color(look.white) }, uGold: { value: new THREE.Color(look.gold) }, uOrange: { value: new THREE.Color(look.orange) }, uRed: { value: new THREE.Color(look.red) },
      uVoid: { value: new THREE.Color(look.dark) },
    };
    const order = options.order ?? 9;
    for (const aperture of [true, false]) {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: aperture ? { APERTURE: 1 } : {},
        // the way through writes depth, so what is behind it does not show through; the ring is coplanar and passes
        transparent: true, depthWrite: aperture, blending: aperture ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = aperture ? order : order + 1;
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
    this.place(placement);
    this.set({ scribe: 0, open: 0, head: 0, aperture: 0, stir: 0, blaze: 0, cool: 0, crumble: 0 });
  }

  /** Hangs it somewhere else: a summon's door may move with what it is for. */
  place(placement: PortalPlacement): void {
    const u = this.uniforms, { centre, right, up, radius } = placement, outer = (u.uOuter.value as number) > 0.5 ? 1.22 : 1;
    (u.uCentre.value as THREE.Vector3).set(centre.x, centre.y, centre.z);
    (u.uRight.value as THREE.Vector3).set(right.x, right.y, right.z); (u.uUp.value as THREE.Vector3).set(up.x, up.y, up.z);
    // room for the heat the ring throws on the air round it
    u.uRadius.value = radius; u.uQuad.value = radius * outer * 2.2;
  }

  set(state: PortalState): void {
    const u = this.uniforms;
    // once home the mask is put unmistakably out of the way: at exactly 1 the seam would feather back out
    u.uScribe.value = state.scribe >= 1 ? 2 : state.scribe; u.uScribe2.value = (state.scribe2 ?? 0) >= 1 ? 2 : state.scribe2 ?? 0;
    u.uOpen.value = state.open; u.uHead.value = state.head; u.uAperture.value = state.aperture;
    u.uStir.value = state.stir; u.uBlaze.value = state.blaze; u.uCool.value = state.cool; u.uCrumble.value = state.crumble;
    this.meshes[0].visible = state.aperture > 0.004;
    this.meshes[1].visible = (state.open > 0.004 || state.head > 0.004) && state.crumble < 0.999;
  }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
