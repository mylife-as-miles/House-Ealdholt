// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The disc the Snare burns into the stone: one quad on the victim's square, drawn by its shader alone.
 *
 * Its edge is the ring that snapped open, a hot band with marks stepping round inside it; the stone within is
 * charred, with veins of current crawling through it and rings of pressure running inward while the snare tightens.
 * When the cage collapses the ring contracts and goes out, and what is left is a scorched disc whose veins cool.
 *
 * From the reference's field: a band drawn by its distance from the centre, veins sampled in the plane and warped
 * (never on the angle, which would draw spokes), rings and ticks. Ours: the rings run inward, because this snare
 * closes on what is inside it; the disc darkens the stone (it is drawn premultiplied); and the burn outlasts the
 * light.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uReach;
varying vec2 vPlace;
void main() {
  // vPlace is in board units from the centre, x and z as on the board
  vPlace = position.xy * uReach;
  vec3 at = uCentre + vec3(vPlace.x, 0.0, vPlace.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
#define TAU 6.2831853
${NOISE}
uniform vec3 uGlow, uCore;
uniform float uRing, uBright, uScorch, uHeat, uSqueeze, uSnap, uTime, uSeed, uReach, uWidth, uGain;
varying vec2 vPlace;
void main() {
  float d = length(vPlace), ring = max(uRing, 0.001);
  // the ring: a hot band with a fine line inside it, and marks stepping round between them
  float band = smoothstep(uWidth, uWidth * 0.3, abs(d - ring));
  float fine = smoothstep(uWidth * 0.35, 0.0, abs(d - ring * 0.9));
  float angle = atan(vPlace.y, vPlace.x) / TAU + 0.5;
  float ticks = step(fract(angle * 28.0 - uTime * 0.5), 0.3) * step(ring * 0.9, d) * step(d, ring - uWidth * 0.5);
  float inside = smoothstep(ring + 0.02, ring - 0.05, d);
  // veins of current crawling through the stone inside it, sampled in the plane and warped
  vec2 p = vPlace * 5.0;
  float warp = noise(p * 0.35 + uSeed) * 2.2;
  float vein = pow(max(0.0, 1.0 - abs(noise(p + warp + vec2(uTime * 0.6, -uTime * 0.4)) - 0.5) * 2.0), 9.0);
  // rings of pressure running inward while it tightens
  float rings = pow(0.5 + 0.5 * cos((d / ring * 2.6 + uTime * 2.2) * TAU), 12.0) * inside * (0.3 + 0.7 * uSqueeze);
  // the snap: the ring is thrown out white-hot and cools onto its line
  float snapped = uSnap >= 0.0 ? exp(-uSnap / 0.12) : 0.0;
  vec3 light = uGlow * (band * 1.3 + fine * 0.6 + ticks * 0.5 + rings * 0.45) * uBright + uCore * (band * band * (0.5 + 1.5 * snapped)) * uBright;
  light += mix(uGlow, uCore, 0.35) * vein * inside * uHeat * 0.75;
  // the stone takes the cage's light, most under the victim
  light += uGlow * exp(-d * d / (ring * ring) * 2.0) * 0.12 * uBright;
  // char: the disc it burnt, and the scar of the ring itself
  float soot = uScorch * (inside * (0.5 + 0.4 * noise(vPlace * 7.0 + 3.0)) + band * 0.35);
  float edge = 1.0 - smoothstep(uReach * 0.8, uReach, d);
  light *= edge; soot *= edge;
  if (soot < 0.004 && max(max(light.r, light.g), light.b) < 0.003) discard;
  // premultiplied: the char darkens the stone and the light is added on top
  gl_FragColor = vec4(light * uGain, min(soot, 0.8));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SnareFieldOptions {
  stone: Point;
  /** The ring's radius at rest; the quad has room for its overshoot. */
  ring: number;
  /** Half the band's width. */
  width: number;
  glow: number;
  core: number;
  seed: number;
}

export class SnareField {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;
  private readonly rest: number;

  constructor(options: SnareFieldOptions) {
    this.rest = options.ring;
    this.uniforms = {
      // lifted a hair off the stone so it never fights it for depth
      uCentre: { value: new THREE.Vector3(options.stone.x, options.stone.y + 0.012, options.stone.z) }, uReach: { value: options.ring * 1.35 + 0.1 }, uWidth: { value: options.width },
      uRing: { value: 0 }, uBright: { value: 0 }, uScorch: { value: 0 }, uHeat: { value: 0 }, uSqueeze: { value: 0 }, uSnap: { value: -1 }, uTime: { value: 0 }, uSeed: { value: (options.seed % 541) * 0.19 }, uGain: { value: 1 },
      uGlow: { value: new THREE.Color(options.glow) }, uCore: { value: new THREE.Color(options.core) },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 3;
    this.object.visible = false;
  }

  /** A factor on the ring's radius (it overshoots as it snaps), how brightly it burns, and seconds since it snapped (negative before). */
  setRing(open: number, bright: number, sinceSnap: number): void {
    this.uniforms.uRing.value = this.rest * open; this.uniforms.uBright.value = bright; this.uniforms.uSnap.value = sinceSnap;
  }
  /** How charred the disc is, how hot its veins still are, and how far the snare has tightened, each 0..1. */
  setStone(scorch: number, heat: number, squeeze: number): void {
    this.uniforms.uScorch.value = scorch; this.uniforms.uHeat.value = heat; this.uniforms.uSqueeze.value = squeeze;
    this.object.visible = scorch > 0.003 || heat > 0.003 || (this.uniforms.uBright.value as number) > 0.003;
  }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
