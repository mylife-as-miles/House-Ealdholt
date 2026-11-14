// Adapted from SamuraiThirdPersonTemplateThreeJS and LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The fire that runs out across the victim's square when the phoenix lets the burning body fall onto it: a white
 * front thrown out round the body as it lands, the stone burning behind it and cooling, charred under the body,
 * and tongues of flame standing up off the stone as the front reaches them and dying down after.
 *
 * The stone is one quad lying on the board, drawn premultiplied so it can char the stone as well as light it.
 * The tongues are the kit's instanced ribbon (vfx/spells/shared/ribbon.ts), placed and lit by their shader from
 * one clock, so nothing is rebuilt per frame.
 *
 * From the reference's ShockRing (Samurai): what the blow does to the ground exists only behind its front, and
 * then cools. From its Pyre Crown (Ext): flames of uneven height rising out of burnt ground. Ours: the fire is a
 * temperature, the front is thrown by a falling body rather than a blow, and the char lifts at the end, because
 * the body's own burn mark (death/burn) is what the board keeps.
 */
import * as THREE from "three";
import type { Point } from "../../vfx/mystic/beamPlan";
import { sequence } from "../../vfx/spells/shared/particlePlan";
import { Ribbon } from "../../vfx/spells/shared/ribbon";
import { strandSeeds } from "../../vfx/spells/shared/ribbonPlan";
import type { PhoenixMoment } from "./phoenixPlan";
import { FIRE, FIRE_NOISE } from "./fire";

/** The burnt ground reaches this far from the victim's stone, in board units. */
const REACH = 1.6;
/** How far the front has run when it has run out (in board units), and how long it takes. */
export const WASH_FRONT = 1.35;
const RUN = 0.3;

const GROUND_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uScale;
varying vec2 vLocal;
void main() {
  // vLocal: across the board from the victim's stone, in board units
  vLocal = position.xy * ${REACH.toFixed(2)};
  vec3 at = uCentre + vec3(vLocal.x, 0.0, vLocal.y) * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const GROUND_FRAGMENT = /* glsl */ `
${FIRE_NOISE}
${FIRE}
uniform float uTime, uGain, uWash, uHeatW, uScorch, uSeed;
varying vec2 vLocal;
void main() {
  float r = length(vLocal), a = atan(vLocal.y, vLocal.x);
  float front = ${WASH_FRONT.toFixed(2)} * uWash;
  // a ragged ring of burnt ground round the body
  float ragged = fNoise(vec2(a * 2.6 + uSeed, r * 2.0)) - 0.5;
  float edge = 1.15 + ragged * 0.4;
  float inside = 1.0 - smoothstep(edge - 0.3, edge, r);
  float behind = front - r, passed = step(0.0, behind);
  // the stone burns behind the front, in patches that crawl, hottest just behind it
  float flames = fNoise(vec2(vLocal.x * 3.0 - uTime * 2.0, vLocal.y * 3.0 + uTime)) * 0.6 + fNoise(vec2(vLocal.x * 7.0 + uTime * 3.0, vLocal.y * 6.0 - uTime * 1.3)) * 0.4;
  float heat = uHeatW * passed * inside * (0.5 + 0.6 * flames) * (0.55 + 0.45 * exp(-behind * 1.6));
  float line = exp(-abs(behind) / 0.06) * inside * (1.0 - smoothstep(0.8, 1.0, uWash));
  vec3 light = fire(heat) * heat * 1.3 + fire(1.0) * line * 1.2;
  // char under the body and round it
  float soot = uScorch * (1.0 - smoothstep(0.35, 0.85 + ragged * 0.3, r)) * (0.5 + 0.35 * fNoise(vLocal * 4.0 + 7.0));
  light *= 1.0 - smoothstep(${(REACH - 0.3).toFixed(2)}, ${REACH.toFixed(2)}, r);
  if (soot < 0.004 && max(max(light.r, light.g), light.b) < 0.002) discard;
  // premultiplied: the char darkens the stone, and the fire is added over it
  gl_FragColor = vec4(light * uGain, min(soot, 0.75));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const TONGUE_CURVE = /* glsl */ `
attribute vec4 aRoot;
uniform vec3 uCentre;
uniform float uScale, uWashTime, uTime, uBoard, uLife;
// grown as the front reaches it, and dying down after, each in its own time
float flameGrow(vec4 strand) {
  float age = uWashTime - aRoot.z;
  return smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.15, uLife * (0.55 + 0.45 * strand.y), age));
}
vec3 ribbonPoint(float t, vec4 strand) {
  float grow = flameGrow(strand);
  float high = aRoot.w * uScale * grow * (0.75 + 0.35 * sin(uTime * (9.0 + 6.0 * strand.z) + strand.w * 30.0));
  float sway = sin(uTime * 6.0 + strand.w * 20.0 + t * 3.0) * 0.07 * t * uScale;
  vec3 base = uCentre + vec3(aRoot.x, 0.0, aRoot.y) * uScale;
  return vec3(base.x + sway, uBoard + 0.01 + t * high, base.z + sway * 0.6);
}
float ribbonWidth(float t, vec4 strand) {
  return 0.08 * uScale * (0.6 + 0.8 * strand.z) * flameGrow(strand) * pow(max(1.0 - t, 0.0), 0.6) * smoothstep(0.0, 0.15, t + 0.05);
}
`;

const TONGUE_SHADE = /* glsl */ `
${FIRE_NOISE}
${FIRE}
uniform float uTime, uHeatW;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float n = fNoise(vec2(t * 4.0 - uTime * 4.0 + strand.y * 13.0, side * 1.3));
  float heat = (1.0 - 0.72 * t) * (0.8 + 0.4 * n) * (0.4 + 0.6 * uHeatW);
#ifdef RIBBON_HALO
  return fire(heat * 0.8) * pow(max(0.0, 1.0 - abs(side)), 2.0) * 0.12;
#else
  float tear = smoothstep(0.0, 0.3, (1.0 - t) * 1.25 + (n - 0.5) * 0.8 - abs(side) * 0.4);
  return fire(heat) * pow(max(0.0, 1.0 - abs(side)), 1.5) * tear;
#endif
}
`;

export interface PhoenixWashOptions {
  stone: Point;
  unit: number;
  seed: number;
  /** Tongues of flame (PHOENIX_BUDGET.flames). */
  flames: number;
  brief: boolean;
}

/** How far the front has run (0..1) `seconds` after the body lands: out fast and slowing, as phoenixMoment's wash. */
function frontShare(seconds: number): number {
  const t = Math.min(1, Math.max(0, seconds / RUN));
  return t * t * (3 - 2 * t);
}

/** The moment, after the body lands, at which the front reaches `r` from its stone. */
function reachedAt(r: number): number {
  const want = r / WASH_FRONT;
  if (want <= 0) return 0;
  let low = 0, high = RUN;
  for (let i = 0; i < 24; i += 1) { const mid = (low + high) / 2; if (frontShare(mid) < want) low = mid; else high = mid; }
  return high;
}

export class PhoenixWash {
  readonly object = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly tongues: Ribbon | null;

  constructor(options: PhoenixWashOptions, shared: Record<string, THREE.IUniform>, boardTop: number) {
    const { stone, unit, seed } = options;
    const centre = new THREE.Vector3(stone.x, boardTop + 0.013, stone.z);
    this.uniforms = { ...shared, uCentre: { value: centre }, uScale: { value: unit }, uWash: { value: 0 }, uHeatW: { value: 0 }, uScorch: { value: 0 }, uSeed: { value: (seed % 131) * 0.53 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.ground = new THREE.Mesh(this.geometry, this.material);
    this.ground.frustumCulled = false; this.ground.renderOrder = 3; this.ground.visible = false;
    this.object.add(this.ground);

    // The tongues: rooted round the stone, taller near the body, each lit as the front reaches it.
    const count = options.flames;
    if (count > 0) {
      const dice = sequence((seed ^ 0x3a5) >>> 0), roots = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + dice() * 0.5, r = 0.18 + 0.85 * Math.pow(dice(), 1.4);
        roots.set([Math.cos(angle) * r, Math.sin(angle) * r, reachedAt(r) + 0.03 * dice(), (0.3 + 0.45 * Math.exp(-(r * r) / 0.35)) * (0.8 + 0.4 * dice())], i * 4);
      }
      this.tongues = new Ribbon({
        segments: 8, strands: strandSeeds(seed ^ 0x77, count), attributes: { aRoot: { array: roots, size: 4 } },
        uniforms: { ...shared, uCentre: { value: centre }, uScale: { value: unit }, uWashTime: { value: -1 }, uBoard: { value: boardTop }, uLife: { value: options.brief ? 0.8 : 0.9 }, uHeatW: this.uniforms.uHeatW },
        curve: TONGUE_CURVE, shade: TONGUE_SHADE, halo: 2.2, facing: "eye", order: 13,
      });
      this.tongues.object.visible = false;
      this.object.add(this.tongues.object);
    } else this.tongues = null;
  }

  set(moment: PhoenixMoment, camera: THREE.PerspectiveCamera, height: number): void {
    const on = moment.landed && (moment.washHeat > 0.002 || moment.scorch > 0.004);
    this.ground.visible = on;
    this.uniforms.uWash.value = moment.wash; this.uniforms.uHeatW.value = moment.washHeat; this.uniforms.uScorch.value = moment.scorch;
    if (this.tongues) {
      this.tongues.uniforms.uWashTime.value = moment.sinceLand;
      this.tongues.object.visible = moment.landed && moment.sinceLand < 1.2;
      this.tongues.fit(camera, height);
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
    this.tongues?.dispose();
  }
}
