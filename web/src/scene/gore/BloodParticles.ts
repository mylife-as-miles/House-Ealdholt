/**
 * Droplets in flight and a little impact mist: one InstancedMesh, one shared
 * quad and one material, fixed capacity per quality preset.
 *
 * Nothing is simulated on the CPU. A burst writes each droplet's launch state
 * into the pool's instance attributes once (no allocation), and the vertex
 * shader evaluates the closed-form flight of ballistics.ts at the particle
 * clock. A droplet is therefore at the same place at the same clock time on
 * any frame rate, and it disappears at exactly the planned landing time, where
 * the Gore Director has already planned its stain.
 *
 * {@link ParticleBackend} is the whole surface the rest of the system uses, so
 * a batched library (three.quarks) can stand in later without touching it.
 */
import * as THREE from "three";
import { GORE_GRAVITY } from "./ballistics";
import { ParticleBuffer } from "./GoreBuffers";
import type { Droplet } from "./GoreDirector";

export interface ParticleBackend {
  readonly object: THREE.Object3D;
  /** One droplet, leaving `delay` seconds from now. The droplet is copied. */
  emit(droplet: Droplet, delay: number): void;
  update(delta: number): void;
  /** Everything in the air is gone at once (Undo, reset). */
  clear(): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec4 aTiming; // birth, life, size, drag
attribute vec2 aLook;   // kind, shape
uniform float uTime;
uniform float uGravity;
varying vec2 vUv;
varying vec3 vLook;     // kind, shape, age 0..1
void main() {
  float t = uTime - aTiming.x;
  float life = aTiming.y;
  vUv = position.xy * 2.0;
  vLook = vec3(aLook, clamp(t / max(life, 1e-4), 0.0, 1.0));
  if (t < 0.0 || t >= life || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = aTiming.w;
  float e = exp(-k * t);
  vec3 terminal = vec3(0.0, -uGravity / k, 0.0);
  vec3 p = aOrigin + (aVelocity - terminal) * (1.0 - e) / k + terminal * t;
  vec3 v = terminal + (aVelocity - terminal) * e;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
  float size = aTiming.z;
  float along = length(vv.xy);
  vec2 dir = along > 1e-4 ? vv.xy / along : vec2(0.0, 1.0);
  // A drop is drawn out along its travel; mist is a soft round puff that swells.
  float stretch = aLook.x < 0.5 ? 1.0 + min(5.0, along * 1.1) : 1.0;
  float swell = aLook.x < 0.5 ? 1.0 : 1.0 + 1.6 * vLook.z;
  mv.xy += (dir * position.y * stretch + vec2(-dir.y, dir.x) * position.x) * size * 2.0 * swell;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vLook;
void main() {
  float r = length(vUv);
  float alpha;
  vec3 color = uColor * uLight;
  if (vLook.x < 0.5) {
    // A bead of liquid: dark body, a small wet glint off-centre.
    alpha = smoothstep(1.0, 0.72, r);
    float glint = smoothstep(0.26, 0.0, length(vUv - vec2(-0.28, 0.3)));
    color += uLight * glint * 0.22;
  } else {
    alpha = smoothstep(1.0, 0.0, r) * 0.26 * (1.0 - vLook.z) * smoothstep(0.0, 0.12, vLook.z);
    color *= 1.25;
  }
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class BloodParticles implements ParticleBackend {
  readonly object: THREE.InstancedMesh;
  readonly buffer: ParticleBuffer;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly attributes: THREE.InstancedBufferAttribute[];
  private clock = 0;
  private uploaded = -1;

  constructor(capacity: number) {
    this.buffer = new ParticleBuffer(capacity);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(quad.index);
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    const attribute = (name: string, array: Float32Array, size: number) => {
      const item = new THREE.InstancedBufferAttribute(array, size);
      item.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, item);
      return item;
    };
    this.attributes = [
      attribute("aOrigin", this.buffer.origin, 3), attribute("aVelocity", this.buffer.velocity, 3),
      attribute("aTiming", this.buffer.timing, 4), attribute("aLook", this.buffer.look, 2),
    ];
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uGravity: { value: GORE_GRAVITY },
        uColor: { value: new THREE.Color(0.1, 0.003, 0.004) }, uLight: { value: new THREE.Color(1, 1, 1) },
      },
    });
    this.object = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, capacity));
    this.object.name = "gore-droplets";
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.castShadow = false; this.object.receiveShadow = false;
    this.object.renderOrder = 6;
    this.object.visible = false;
  }

  /** Scene light on unlit droplets: the engine may pass its ambient level. */
  setLight(color: THREE.ColorRepresentation, level = 1): void {
    (this.material.uniforms.uLight.value as THREE.Color).set(color).multiplyScalar(level);
  }

  emit(droplet: Droplet, delay: number): void {
    this.buffer.emit(droplet, this.clock + Math.max(0, delay));
  }

  update(delta: number): void {
    const buffer = this.buffer;
    if (this.clock >= buffer.idleAt) {
      // Nothing in the air: rest the clock at zero so it keeps float precision over a long match.
      if (this.object.visible) { this.object.visible = false; buffer.clear(); this.clock = 0; }
      if (this.uploaded === buffer.version) return;
    }
    this.clock += Math.max(0, delta);
    if (this.uploaded !== buffer.version) {
      for (const attribute of this.attributes) attribute.needsUpdate = true;
      this.uploaded = buffer.version;
      this.object.count = buffer.used;
      this.object.visible = buffer.used > 0;
    }
    this.material.uniforms.uTime.value = this.clock;
  }

  clear(): void {
    this.buffer.clear();
    this.clock = 0; this.object.visible = false; this.object.count = 0;
    this.uploaded = this.buffer.version;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
