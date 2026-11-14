// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The column of sunlight: a white-hot core in a golden sheath, the thread of light that comes down first, and a
 * Queen's corona of lesser shafts. One instanced draw of an open tube; every shaft is placed, masked and broken
 * up by the shader from a few uniforms.
 *
 * From the reference's LightPillar: an open tube is read as a column of lit air when it is shaded by the cosine
 * between its wall and the eye, which stands in for the length of the chord the eye looks through; and the
 * column is masked into being behind a head that travels. Ours: there are two bodies at two temperatures, so the
 * middle is white and the edge amber; heat climbs it as streaks while the light comes down; its wall boils, so
 * the silhouette is never a straight pipe; it flares where it pools on the stone; each shaft has its own moment
 * of falling; and it ends by coming apart into strands from the top down, not by fading.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import type { SunShaft } from "./sunPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
${NOISE}
attribute vec4 aShaft;
attribute float aKind;
uniform vec3 uCentre;
uniform float uHeight, uTime, uWidth, uFall, uFallTime, uBrief, uClear, uClearHeight;
varying vec2 vRound;
varying float vHigh, vFacing, vKind, vHead;
void main() {
  // kind 0 is the sheath, 1 the core, 2 the thread that comes first, 3 a shaft of the corona
  bool sheath = aKind < 0.5, core = aKind > 0.5 && aKind < 1.5, thread = aKind > 1.5 && aKind < 2.5;
  float high = position.y * uHeight;
  vRound = normalize(position.xz);
  // heat climbing the sheath pushes its wall in and out, so its edge boils upward and is never a straight pipe
  float boil = sheath ? 1.0 + 0.2 * (noise(vRound * 1.6 + vec2(high * 1.1 - uTime * 4.2, 7.0)) - 0.5) + 0.04 * sin(high * 6.0 - uTime * 12.0 + vRound.x * 3.0)
    : core ? 1.0 + 0.16 * (noise(vRound * 1.2 + vec2(3.0, high * 1.7 - uTime * 6.0)) - 0.5) : 1.0;
  // light pools where it lands: the foot flares. Once it has struck the foot thins, so the body burning in it is seen
  float low = uClear * (1.0 - smoothstep(uClearHeight * 0.7, uClearHeight, high));
  float flare = 1.0 + (sheath ? 0.6 : 0.3) * exp(-high * 2.4) * (1.0 - uClear);
  float radius = aShaft.z * (thread ? 1.0 : uWidth) * boil * flare * (1.0 - (sheath ? 0.5 : core ? 0.3 : 0.0) * low);
  vec3 at = uCentre + vec3(aShaft.x + position.x * radius, high, aShaft.y + position.z * radius);
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * vec3(position.x, 0.0, position.z)), normalize(-here.xyz)));
  // sunPlan.headFallen: each shaft has its own moment of falling
  float fell = clamp((uFall - aShaft.w) / uFallTime, 0.0, 1.0);
  vHead = uBrief > 0.5 || thread ? 1.0 : fell * fell;
  vHigh = high; vKind = aKind;
  gl_Position = projectionMatrix * here;
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uWhite, uGold, uAmber;
uniform float uHeight, uTime, uColumn, uThread, uErode, uFlash, uGain, uSeed, uClear, uClearHeight;
varying vec2 vRound;
varying float vHigh, vFacing, vKind, vHead;
void main() {
  bool sheath = vKind < 0.5, core = vKind > 0.5 && vKind < 1.5, thread = vKind > 1.5 && vKind < 2.5, corona = vKind > 2.5;
  // the column exists only above its head; the head itself is the brightest thing in the sky while it falls
  float front = (1.0 - vHead) * uHeight;
  float lit = smoothstep(front - 0.5, front + 0.7, vHigh);
  float fromHead = (vHigh - front) / 0.8;
  float head = vHead < 0.999 && vHead > 0.0 ? exp(-fromHead * fromHead) : 0.0;
  if (lit + head < 0.002) discard;
  // the chord the eye looks through: densest down the middle, nothing at the edge, so there is no outline
  float chord = pow(vFacing, sheath ? 2.3 : core ? 3.0 : 1.7);
  // heat climbs it while the light comes down: long streaks running upward, and a finer, faster grain
  float climb = vHigh * 0.55 - uTime * 2.8;
  float streaks = noise(vRound * 2.4 + vec2(climb * 0.3, climb) + uSeed) * 0.5 + noise(vRound * 5.2 + vec2(-climb * 0.8, climb * 2.4) + 9.0) * 0.3 + noise(vRound * 12.0 + vec2(4.0, climb * 0.5)) * 0.2;
  float surge = 0.8 + 0.2 * sin(uTime * 19.0 + vHigh * 0.7) * sin(uTime * 7.3 + 1.0);
  // lost in the sky at the top, brightest where it lands; once it has struck, dim round the body at its foot
  float top = 1.0 - smoothstep(uHeight * 0.4, uHeight, vHigh);
  float foot = 1.0 + 0.9 * exp(-vHigh * 1.8) * (1.0 - uClear);
  float low = sheath || core ? uClear * (1.0 - smoothstep(uClearHeight * 0.7, uClearHeight, vHigh)) : 0.0;
  // the collapse: a threshold climbs through it, the top's first, and what is left is strands that shorten
  float strand = noise(vRound * 3.6 + uSeed * 3.0) * 0.6 + noise(vRound * 8.0 + vec2(vHigh * 0.5, 2.0)) * 0.4;
  float limit = uErode * 1.45;
  float kept = smoothstep(limit - 0.14, limit + 0.04, 0.1 + strand * 0.55 + (1.0 - smoothstep(0.0, uHeight * 0.5, vHigh)) * 0.8);
  vec3 colour;
  if (thread) {
    colour = mix(uGold, uWhite, 0.2) * chord * (0.45 + 0.55 * streaks) * uThread * 0.42;
  } else {
    float body = core ? chord * (0.4 + 0.8 * streaks) : chord * (0.2 + 1.1 * streaks * streaks);
    // gold through the middle of the sheath, amber where it thins, white where the heat runs; the core is the sun itself
    vec3 tint = core ? mix(uGold, uWhite, 0.65) * 0.8 : mix(uAmber, uGold, pow(vFacing, 1.3)) * 0.6 + uWhite * smoothstep(0.6, 0.95, streaks) * 0.3;
    colour = tint * body * foot * uColumn * surge * kept * lit * (corona ? 0.6 : 1.0);
    colour += mix(uGold, uWhite, 0.6) * chord * (head * 1.1 * uColumn + uFlash * lit * (core ? 0.5 : 0.15));
  }
  colour *= top * (1.0 - 0.75 * low);
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const KIND: Readonly<Record<SunShaft["kind"], number>> = { sheath: 0, core: 1, thread: 2, corona: 3 };

export interface SunColumnOptions {
  shafts: readonly SunShaft[];
  centre: Point;
  height: number;
  /** Seconds the head takes to come down. */
  fall: number;
  brief: boolean;
  /** Faces round each shaft. */
  radial: number;
  /** How high the foot thins once it has struck (SunSizes.clear). */
  clear: number;
  /** White-hot, gold, and the amber of its thin edges. */
  white: number;
  gold: number;
  amber: number;
  seed: number;
}

export class SunColumn {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(options: SunColumnOptions) {
    // a unit tube standing on its base, open at both ends
    const tube = new THREE.CylinderGeometry(1, 1, 1, options.radial, 10, true).translate(0, 0.5, 0);
    this.geometry.setAttribute("position", tube.getAttribute("position"));
    this.geometry.setIndex(tube.getIndex());
    const shaft = new Float32Array(options.shafts.length * 4), kind = new Float32Array(options.shafts.length);
    options.shafts.forEach((one, i) => { shaft.set([one.x, one.z, one.radius, one.delay], i * 4); kind[i] = KIND[one.kind]; });
    this.geometry.setAttribute("aShaft", new THREE.InstancedBufferAttribute(shaft, 4));
    this.geometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kind, 1));
    this.geometry.instanceCount = options.shafts.length;
    this.uniforms = {
      uCentre: { value: new THREE.Vector3(options.centre.x, options.centre.y, options.centre.z) }, uHeight: { value: options.height }, uTime: { value: 0 },
      uWidth: { value: 1 }, uFall: { value: -1 }, uFallTime: { value: Math.max(0.01, options.fall) }, uBrief: { value: options.brief ? 1 : 0 },
      uColumn: { value: 0 }, uThread: { value: 0 }, uErode: { value: 0 }, uFlash: { value: 0 }, uGain: { value: 1 }, uSeed: { value: (options.seed % 613) * 0.21 }, uClear: { value: 0 }, uClearHeight: { value: options.clear },
      uWhite: { value: new THREE.Color(options.white) }, uGold: { value: new THREE.Color(options.gold) }, uAmber: { value: new THREE.Color(options.amber) },
    };
    // depth-tested, so the figure standing in it cuts the far wall and is wrapped by the near one
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 10;
  }

  /**
   * The column's strength and the thread's (0..1), a factor on its radius, how far it has come apart (0..1), and how far
   * its foot has thinned round the body (0..1).
   */
  set(column: number, thread: number, width: number, erode: number, clear: number): void {
    this.uniforms.uColumn.value = column; this.uniforms.uThread.value = thread; this.uniforms.uWidth.value = width; this.uniforms.uErode.value = erode;
    this.uniforms.uClear.value = clear;
    this.object.visible = column > 0.002 || thread > 0.002;
  }
  /** Seconds since the head left the sky (negative before), and the flash of the blow, 0..1. */
  setFall(seconds: number, flash: number): void { this.uniforms.uFall.value = seconds; this.uniforms.uFlash.value = flash; }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
