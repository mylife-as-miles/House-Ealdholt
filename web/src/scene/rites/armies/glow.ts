/**
 * Points of light that ride on moving figures: the eyes of a shadow soldier or a risen corpse, a spark at a wound.
 * Unlike the particle pool (vfx/spells/shared/particles.ts), whose every flight is written once, these are placed
 * by the caller every frame, because what they ride on is animated by the match. Each is a square that faces the
 * eye, drawn as a small hot heart inside a wide soft halo and a thin level streak, so it reads with no bloom.
 */
import * as THREE from "three";

export interface GlowLook { core: number; glow: number }

const VERTEX = /* glsl */ `
attribute vec3 aAt;
attribute vec4 aLook;
uniform float uPixel;
varying vec2 vShape;
varying float vBright, vStreak;
void main() {
  vShape = position.xy; vBright = aLook.y; vStreak = aLook.z;
  vec4 here = modelViewMatrix * vec4(aAt, 1.0);
  // never smaller than a few pixels, or an eye across the board is lost
  float size = max(aLook.x, uPixel * 2.2 * -here.z);
  here.xy += position.xy * size * vec2(1.0 + 1.6 * aLook.z, 1.0);
  gl_Position = aLook.y > 0.002 ? projectionMatrix * here : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uCore, uGlow;
uniform float uGain;
varying vec2 vShape;
varying float vBright, vStreak;
void main() {
  vec2 p = vShape * vec2(1.0 + 1.6 * vStreak, 1.0);
  float r = length(vShape);
  float heart = exp(-r * r * 38.0), halo = exp(-r * 4.2) * 0.32 * (1.0 - smoothstep(0.7, 1.0, r));
  // a thin level streak through it, as a lamp seen through a wet pane
  float streak = exp(-abs(vShape.y) * 26.0) * exp(-abs(p.x) * 2.4) * 0.5 * vStreak;
  vec3 colour = (uCore * heart * 1.7 + uGlow * (halo + streak + heart * 0.6)) * vBright;
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GlowPoints {
  readonly object: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly at: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;

  constructor(capacity: number, look: GlowLook, order = 15) {
    this.capacity = Math.max(1, capacity);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.at = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aAt", this.at);
    this.geometry.setAttribute("aLook", this.look);
    this.geometry.instanceCount = this.capacity;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: new THREE.Color(look.core) }, uGlow: { value: new THREE.Color(look.glow) }, uGain: { value: 1 }, uPixel: { value: 0.001 } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = order;
  }

  /** Puts light `index` at `at`, `size` across (scene units, before the pixel floor), `bright` (0 hides it), with a level streak 0..1. */
  set(index: number, at: THREE.Vector3, size: number, bright: number, streak = 0): void {
    if (index < 0 || index >= this.capacity) return;
    this.at.setXYZ(index, at.x, at.y, at.z);
    this.look.setXYZW(index, size, Math.max(0, bright), streak, 0);
  }

  /** Hides every light from `index` on. */
  hideFrom(index: number): void {
    for (let i = Math.max(0, index); i < this.capacity; i += 1) this.look.setY(i, 0);
  }

  /** Sends this frame's places to the card, and fits the lights to the camera. */
  commit(camera: THREE.PerspectiveCamera, height: number): void {
    this.at.needsUpdate = true; this.look.needsUpdate = true;
    this.material.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
  }

  setGain(gain: number): void { this.material.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
