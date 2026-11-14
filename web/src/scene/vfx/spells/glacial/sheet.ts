// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The sheet of ice the Glacial crown stands on: one quad on the victim's square, drawn by its shader alone.
 *
 * It freezes outward from the victim's feet, its edge dragged out of round by fingers and lit while it travels. It
 * is plates, each its own tone, with rime piled bright in the seams between them, and frost feathering over them.
 * When the crown closes the inside goes white in an instant. The blood of the body run through on the crown soaks into
 * it (shared/blood.ts): a pool under the body and one at the foot of each blade that went through, running out along
 * the seams between the plates, dark red under the frost. At the end it draws back toward the middle, thinnest places
 * first, and leaves the stone it uncovers dark and wet for a while before that dries too; the blood stays on the wet
 * stone as long as the wet does.
 *
 * From the reference's sheet: plates with bright seams, frost fingers sampled in the plane and never on the angle,
 * a front that freezes outward and draws back inward. Ours: the stone it leaves is wet, the closing is a flash of
 * rime, and it is drawn premultiplied so the frost covers the stone and the wet darkens it.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import { BLOOD_IN_ICE, ICE_BLOOD_POOLS } from "../shared/blood";
import type { IceBlood } from "./glacialPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash22(vec2 p) { return vec2(hash(p), hash(p + vec2(17.3, 41.9))); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the distance to the nearest seam between plates, and which plate this is
vec2 plates(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  float first = 8.0, second = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 at = vec2(float(x), float(y)), seed = hash22(cell + at), d = at + seed - f;
    float dist = dot(d, d);
    if (dist < first) { second = first; first = dist; id = hash(cell + at + 3.1); }
    else if (dist < second) second = dist;
  }
  return vec2(sqrt(second) - sqrt(first), id);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uReach;
varying vec2 vPlace;
void main() {
  vPlace = position.xy * uReach;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uCentre + vec3(vPlace.x, 0.0, vPlace.y), 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
${BLOOD_IN_ICE}
uniform vec3 uFrost, uGlow, uCore;
uniform float uSheet, uReach, uFreeze, uRime, uFlash, uThaw, uWet, uTime, uSeed, uGain;
varying vec2 vPlace;
void main() {
  float d = length(vPlace);
  vec2 bearing = d > 1e-4 ? vPlace / d : vec2(1.0, 0.0);
  // the edge: frost never advances as a circle, it reaches; this is the one place an angular lookup belongs
  float fingers = 0.8 + 0.32 * noise(bearing * 3.3 + uSeed) + 0.12 * noise(bearing * 9.0 - uSeed);
  float reach = uFreeze * uSheet * fingers;
  float frozen = smoothstep(reach, reach - 0.05, d);
  // the thaw draws it back toward the middle, from where it is thinnest
  vec2 plate = plates(vPlace * 7.0 + uSeed);
  float thick = 0.45 + 0.35 * plate.y + 0.2 * noise(vPlace * 11.0);
  float back = uSheet * fingers * (1.0 - uThaw * (1.25 - 0.5 * thick));
  float kept = smoothstep(back, back - 0.06, d);
  float ice = frozen * kept;
  // rime piled in the seams, feathers of frost over the plates, and each plate its own tone
  float seams = smoothstep(0.09, 0.0, plate.x);
  float warp = noise(vPlace * 2.5 + uSeed) * 1.5;
  float feathers = pow(max(0.0, 1.0 - abs(noise(vPlace * 15.0 + warp) - 0.5) * 2.0), 6.0);
  float white = clamp(0.22 + 0.22 * plate.y + 0.5 * seams + 0.35 * feathers + 0.5 * uRime * (1.0 - smoothstep(0.0, uSheet * 0.75, d)), 0.0, 0.92);
  // light: the edge while it travels, pinpoints that come and go, the seams faintly, and the flash of the closing
  float fromReach = (d - reach) / 0.05;
  float lip = uFreeze < 0.999 ? exp(-fromReach * fromReach) * step(0.001, uFreeze) : 0.0;
  vec2 grain = floor(vPlace * 60.0);
  float glitter = step(0.97, hash(grain + uSeed)) * pow(0.5 + 0.5 * sin(uTime * (4.0 + 8.0 * hash(grain * 1.7)) + hash(grain * 2.9) * 40.0), 8.0) * ice;
  float flash = uFlash * exp(-d * d / (uSheet * uSheet) * 3.0);
  vec3 light = uGlow * (lip * 0.9 + seams * ice * 0.1 + flash * 0.9) + uCore * (glitter * 1.4 + lip * lip * 0.5 + flash * flash * 0.8);
  // the stone the thaw leaves is wet and dark, and dries
  float wet = frozen * (1.0 - kept) * uWet * 0.32;
  float edge = 1.0 - smoothstep(uReach * 0.85, uReach, d);
  // blood soaked into the ice, along its seams; once the ice has gone, on the wet stone while it stays wet
  float soaked = bloodInIce(vPlace, seams);
  float blood = soaked * max(ice, frozen * (1.0 - kept) * uWet * 0.8);
  float frost = white * ice * (1.0 - blood);
  float cover = (frost + blood * 0.95 + wet * (1.0 - blood)) * edge;
  light *= edge * (1.0 - 0.6 * blood);
  if (cover < 0.004 && max(max(light.r, light.g), light.b) < 0.003) discard;
  // premultiplied: the frost covers the stone and its light is added; the blood covers it dark red; the wet only darkens
  // the blood is darker where it lies thickest, toward the middle of each pool and in the seams
  vec3 gore = bloodInIceColour(uIceBloodAmount) * (0.75 + 0.25 * noise(vPlace * 23.0 + uSeed)) * (1.0 - 0.3 * seams);
  gl_FragColor = vec4((uFrost * frost + gore * blood * 0.95) * edge + light * uGain, min(cover, 0.96));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface FrostSheetOptions {
  stone: Point;
  /** How far the sheet reaches from the victim's feet. */
  sheet: number;
  frost: number;
  glow: number;
  core: number;
  seed: number;
}

export class FrostSheet {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;

  constructor(options: FrostSheetOptions) {
    this.uniforms = {
      // lifted a hair off the stone so it never fights it for depth
      uCentre: { value: new THREE.Vector3(options.stone.x, options.stone.y + 0.012, options.stone.z) }, uSheet: { value: options.sheet }, uReach: { value: options.sheet * 1.25 },
      uFreeze: { value: 0 }, uRime: { value: 0 }, uFlash: { value: 0 }, uThaw: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 }, uSeed: { value: (options.seed % 701) * 0.13 }, uGain: { value: 1 },
      uFrost: { value: new THREE.Color(options.frost) }, uGlow: { value: new THREE.Color(options.glow) }, uCore: { value: new THREE.Color(options.core) },
      uIceBlood: { value: Array.from({ length: ICE_BLOOD_POOLS }, () => new THREE.Vector4(0, 0, 0, 0)) }, uIceBloodAmount: { value: 0 }, uIceBloodSince: { value: -1 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 3;
    this.object.visible = false;
  }

  /** How far it has frozen out (0..1), how white the air inside the crown has made it, and the flash of the closing. */
  set(freeze: number, rime: number, flash: number): void {
    this.uniforms.uFreeze.value = freeze; this.uniforms.uRime.value = rime; this.uniforms.uFlash.value = flash;
  }
  /** How far it has drawn back (0..1), and how wet the stone it left is (0..1). */
  setThaw(thaw: number, wet: number): void {
    this.uniforms.uThaw.value = thaw; this.uniforms.uWet.value = wet;
    this.object.visible = (this.uniforms.uFreeze.value as number) > 0.002 && (thaw < 0.999 || wet > 0.003);
  }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }
  /** The blood that will soak into it (glacialPlan.glacialBlood): how much the Violence setting shows, and its pools. */
  setBlood(amount: number, pools: readonly IceBlood[]): void {
    this.uniforms.uIceBloodAmount.value = amount;
    (this.uniforms.uIceBlood.value as THREE.Vector4[]).forEach((pool, i) => {
      const at = pools[i];
      if (at) pool.set(at.x, at.z, at.delay, at.size); else pool.set(0, 0, 0, 0);
    });
  }
  /** Seconds since the blow, negative before it. */
  setBloodTime(since: number): void { this.uniforms.uIceBloodSince.value = since; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
