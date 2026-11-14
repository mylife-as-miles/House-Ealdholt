/**
 * The rime a frost line lays on the stone: one quad lying along the line, drawn by its shader alone.
 *
 * It is matter, not light: it whitens the stone it covers, and only its running edge and the blow glow. It runs
 * ahead of the spikes in fingers, follows the grooves between the squares further than it crosses the squares
 * themselves, spreads in a patch round the victim when the blow lands, and at the end draws back from its edges
 * inward and leaves the stone wet for a moment. Nothing fades: it is a threshold that moves. The blood of the body
 * on the great spike soaks into it (shared/blood.ts), under the body and at the spike's foot, running out along the
 * grooves and veins, dark red under the frost, and stays on the stone until the wet has dried.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import { BLOOD_IN_ICE, ICE_BLOOD_POOLS } from "../shared/blood";
import type { FrostLine, RimeBlood } from "./frostPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
uniform vec3 uFrom;
uniform vec2 uAlong;
uniform float uLength, uReach, uPad;
varying vec2 vPlace, vWorld;
void main() {
  // position.x runs the line, from a little behind its start to a little past the victim; position.y crosses it
  float s = mix(-0.45, uLength + uPad, position.x * 0.5 + 0.5), w = position.y * uReach;
  vec3 at = uFrom + vec3(uAlong.x * s - uAlong.y * w, 0.0, uAlong.y * s + uAlong.x * w);
  vPlace = vec2(s, w); vWorld = at.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
${BLOOD_IN_ICE}
uniform vec2 uStone;
uniform vec3 uFrostColour, uGlowColour, uCoreColour;
uniform float uLength, uNear, uFar, uRing, uTile, uSeed, uTime, uRime, uFrost, uBurst, uFlash, uThaw, uGain;
varying vec2 vPlace, vWorld;
void main() {
  float s = vPlace.x, w = vPlace.y;
  float broad = noise(vWorld * 2.7 + uSeed), mid = noise(vWorld * 8.0 - uSeed), fine = noise(vWorld * 26.0 + uSeed * 3.0);
  // the grooves between the squares: the stone under the victim is a square's centre, so the seams lie half a square off it
  vec2 seam = abs(fract((vWorld - uStone) / uTile) - 0.5) * uTile;
  float groove = smoothstep(0.05, 0.0, min(seam.x, seam.y));

  // the band: narrow at the caster's feet, wider toward the victim, ragged, and longer down the grooves
  float reachAcross = mix(uNear, uFar, smoothstep(0.0, uLength, s)) * (0.55 + 0.8 * broad) + groove * 0.1;
  float band = (1.0 - smoothstep(reachAcross * 0.55, reachAcross, abs(w))) * smoothstep(-0.3 - 0.15 * broad, 0.05, s) * (1.0 - smoothstep(uLength, uLength + 0.3, s));
  // its running edge: fingers reach ahead of it
  float edge = uRime * (uLength + 0.4) + (broad - 0.5) * 0.6 + groove * 0.3;
  float behind = 1.0 - smoothstep(edge - 0.3, edge, s);
  // the patch the blow throws round the victim: out fast, then slowing
  float r = length(vWorld - uStone);
  float spread = uBurst >= 0.0 ? uRing * (1.0 - exp(-uBurst * 6.0)) : 0.0;
  float around = uBurst >= 0.0 ? 1.0 - smoothstep(spread * (0.5 + 0.5 * broad), spread * (0.8 + 0.5 * broad) + 0.02, r + groove * -0.12) : 0.0;
  float cover = max(band * behind, around);

  // what frost is: plates with bright boundaries, feathered, and a grain that sparkles
  float veins = pow(max(0.0, 1.0 - abs(noise(vWorld * 13.0 + broad * 2.5) - 0.5) * 2.0), 7.0);
  float feathers = pow(max(0.0, 1.0 - abs(noise(vWorld * vec2(31.0, 29.0) + mid * 3.0) - 0.5) * 2.0), 4.0);
  float depth = cover * (0.4 + 0.6 * mid);
  // the thaw: it goes where it is thinnest first, so it draws back from its edges in patches
  float limit = uThaw * 1.15;
  float kept = smoothstep(limit - 0.12, limit + 0.02, depth);
  float thickness = cover * (0.26 + 0.3 * mid + 0.6 * veins + 0.38 * feathers + 0.3 * groove);
  float alpha = clamp(thickness, 0.0, 0.88) * kept * uFrost;
  // the stone it has left is wet, and dries
  float wet = cover * (1.0 - kept) * uFrost * (1.0 - smoothstep(0.7, 1.0, uThaw)) * 0.3;

  // light: the running edge, pinpoints that come and go, and the blow on the stone
  float fromEdge = (s - edge) / 0.2;
  float running = band * exp(-fromEdge * fromEdge) * step(uRime, 0.999) * step(0.001, uRime);
  vec2 cell = floor(vWorld * 64.0);
  float glitter = step(0.965, hash(cell + uSeed)) * pow(0.5 + 0.5 * sin(uTime * (5.0 + 9.0 * hash(cell * 1.7)) + hash(cell * 3.1) * 40.0), 6.0) * alpha;
  float blow = exp(-r * r * 1.6) * uFlash;
  vec3 light = uGlowColour * (running * 0.9 + blow * 0.8) + uCoreColour * (running * running * 0.6 + glitter * 1.6 + blow * blow * 0.9 + veins * alpha * 0.08);

  // blood soaked into the frost, along its grooves and veins; on the bare stone round it, a wet stain; gone as it dries
  float blood = bloodInIce(vWorld, max(groove, veins * 0.7)) * (0.7 + 0.3 * step(0.05, alpha)) * (1.0 - smoothstep(0.75, 1.0, uThaw));
  float frost = alpha * (1.0 - blood);
  float covered = min(frost + blood * 0.95 + wet * (1.0 - blood), 0.96);
  light *= 1.0 - 0.6 * blood;
  if (covered < 0.004 && max(max(light.r, light.g), light.b) < 0.004) discard;
  // premultiplied: the frost covers the stone and its light is added on top; the blood covers it dark red
  gl_FragColor = vec4(uFrostColour * (0.72 + 0.28 * fine) * frost + bloodInIceColour(uIceBloodAmount) * blood * 0.95 + light * uGain, covered);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface RimeOptions {
  line: FrostLine;
  /** Half the band's width at the caster's feet and at the victim, and how far the patch round the victim reaches. */
  near: number;
  far: number;
  ring: number;
  tile: number;
  /** The frost itself, the colour its edge glows, and the white of its brightest points. */
  frost: number;
  glow: number;
  core: number;
  seed: number;
}

export class Rime {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(options: RimeOptions) {
    const { line } = options;
    this.uniforms = {
      // lifted a hair off the stone so it never fights it for depth
      uFrom: { value: new THREE.Vector3(line.from.x, line.from.y + 0.012, line.from.z) }, uAlong: { value: new THREE.Vector2(line.along.x, line.along.z) },
      uStone: { value: new THREE.Vector2(line.to.x, line.to.z) }, uLength: { value: line.length }, uPad: { value: options.ring + 0.35 },
      uReach: { value: Math.max(options.far * 1.7, options.ring + 0.35) }, uNear: { value: options.near }, uFar: { value: options.far }, uRing: { value: options.ring },
      uTile: { value: options.tile }, uSeed: { value: (options.seed % 977) * 0.137 }, uTime: { value: 0 },
      uRime: { value: 0 }, uFrost: { value: 1 }, uBurst: { value: -1 }, uFlash: { value: 0 }, uThaw: { value: 0 }, uGain: { value: 1 },
      uFrostColour: { value: new THREE.Color(options.frost) }, uGlowColour: { value: new THREE.Color(options.glow) }, uCoreColour: { value: new THREE.Color(options.core) },
      uIceBlood: { value: Array.from({ length: ICE_BLOOD_POOLS }, () => new THREE.Vector4(0, 0, 0, 0)) }, uIceBloodAmount: { value: 0 }, uIceBloodSince: { value: -1 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 3;
  }

  /** How far the rime has run (0..1 of the line), how much of it there is, and how far it has thawed back. */
  set(rime: number, frost: number, thaw: number): void {
    this.uniforms.uRime.value = rime; this.uniforms.uFrost.value = frost; this.uniforms.uThaw.value = thaw;
    this.object.visible = frost > 0.002 && thaw < 0.999;
  }
  /** Seconds since the blow (negative before it), and the cold light it throws on the stone, 0..1. */
  setBlow(seconds: number, flash: number): void { this.uniforms.uBurst.value = seconds; this.uniforms.uFlash.value = flash; }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }
  /** The blood that will soak into it (frostPlan.frostBlood): how much the Violence setting shows, and its pools, on the board. */
  setBlood(amount: number, pools: readonly RimeBlood[]): void {
    this.uniforms.uIceBloodAmount.value = amount;
    (this.uniforms.uIceBlood.value as THREE.Vector4[]).forEach((pool, i) => {
      const at = pools[i];
      if (at) pool.set(at.x, at.z, at.delay, at.size); else pool.set(0, 0, 0, 0);
    });
  }
  /** Seconds since the blow, negative before it. */
  setBloodTime(since: number): void { this.uniforms.uIceBloodSince.value = since; }
  /** The stone under the victim, should the caller ever need to move it. */
  setStone(stone: Point): void { (this.uniforms.uStone.value as THREE.Vector2).set(stone.x, stone.z); }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
