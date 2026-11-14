// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * One pool of particles for a spell: sparks, splinters of light, embers and glitter in a pool that adds light,
 * or mist, dust and smoke in a pool that covers what is behind it. shared/particlePlan.ts holds the arithmetic
 * and its tests; the vertex shader here evaluates the same flight.
 *
 * The pool is written once, when the spell is made, with every particle's birth time already in it. After that
 * it costs one clock uniform a frame: nothing is integrated, re-uploaded or sorted. A particle that has not been
 * born or has died is folded out of the picture in the vertex shader.
 *
 * From the reference's EmberSystem: the closed-form flight, and a sprite drawn out along its own velocity on the
 * screen as a capsule with round caps, so a fast spark is a streak and a slow one a point. Ours: the board as a
 * floor, a fade against it by height (we have no scene depth to soften an intersection with), a pixel floor so a
 * mote far from the eye is not lost, five kinds of sprite in one draw, and three's tone mapping at the end.
 */
import * as THREE from "three";
import { packParticles, type Particle, type Vec } from "./particlePlan";

/** The pool's colours: a particle sits between `cool` and `hot` by its tone, and cools as it ages. */
export interface ParticleLook { hot: number; mid: number; cool: number }

export interface ParticlePoolOptions {
  particles: readonly Particle[];
  /** The most the pool may hold: the tier's budget. Past it the list is thinned evenly. */
  capacity: number;
  look: ParticleLook;
  /** `add` is light; `cover` is matter that hides what is behind it and is lit from above. */
  blend: "add" | "cover";
  /** The height of the stone: nothing falls through it, and matter fades into it. */
  floor: number;
  seed: number;
  /** How opaque a covering pool is at its thickest. */
  opacity?: number;
  renderOrder?: number;
}

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
attribute vec3 aOrigin, aVelocity;
attribute vec4 aTimes, aLook, aExtra;
uniform float uTime, uFloor, uPixel, uStretch;
uniform vec3 uAnchor, uLightAt;
varying vec2 vShape;
varying float vCap, vFade, vKind, vTone, vSeed, vLift, vLit;
void main() {
  float age = uTime - aTimes.x, life = aTimes.y;
  vShape = vec2(0.0); vCap = 0.0; vFade = 0.0; vKind = aLook.z; vTone = 0.0; vSeed = aLook.y; vLift = 1.0; vLit = 0.0;
  // not yet born, or spent: folded out of the picture before it costs a fragment
  if (life <= 0.0 || age <= 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / life;
  // particlePlan.flightPoint, flightVelocity: linear drag under a constant pull, exact
  float drag = aTimes.z, decay = exp(-drag * age);
  float travel = drag < 1e-4 ? age : (1.0 - decay) / drag;
  float fall = drag < 1e-4 ? 0.5 * age * age : (age - travel) / drag;
  vec3 at = aOrigin + uAnchor * aExtra.y + aVelocity * travel - vec3(0.0, aTimes.w * fall, 0.0);
  vec3 going = aVelocity * decay - vec3(0.0, aTimes.w * travel, 0.0);
  // the air it moves through pushes it off its path: more, the longer it has been out
  float s = aLook.y * 6.2831853;
  at += vec3(sin(uTime * (1.3 + aLook.y) + s * 5.0), 0.5 * sin(uTime * (0.9 + aLook.y * 1.3) + s * 3.0), cos(uTime * (1.1 + aLook.y * 0.7) + s * 7.0)) * aExtra.w * u;
  bool streak = aLook.z > 0.5 && aLook.z < 1.5, puff = aLook.z > 2.5 && aLook.z < 3.5;
  float radius = aLook.x * mix(1.0, aExtra.x, u);
  // the stone stops it: light lies on it, matter rests on it
  float rest = uFloor + (puff ? radius * 0.3 : 0.015);
  if (at.y < rest) { at.y = rest; going = vec3(going.x * 0.15, 0.0, going.z * 0.15); }
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  vec2 axis = vec2(0.0, 1.0);
  float stretch = 1.0;
  if (streak) {
    vec3 seen = (modelViewMatrix * vec4(going, 0.0)).xyz;
    float speed = length(seen.xy);
    if (speed > 1e-4) axis = seen.xy / speed;
    stretch = 1.0 + min(uStretch * speed, 9.0);
  }
  // never smaller than a pixel or so, or a spark across the board is lost
  if (!puff) radius = max(radius, uPixel * -here.z * 1.4);
  vec2 offset = (vec2(-axis.y, axis.x) * position.x + axis * position.y * stretch) * radius;
  here.xy += offset;
  gl_Position = projectionMatrix * here;
  vShape = vec2(position.x, position.y * stretch); vCap = stretch - 1.0;
  // particlePlan.particleFade, and hangingFade for what hangs in the air
  float appear = clamp(u / max(aExtra.z, 1e-4), 0.0, 1.0);
  vFade = appear * appear * (3.0 - 2.0 * appear) * (aLook.z > 2.5 ? 1.0 - smoothstep(0.5, 1.0, u) : pow(1.0 - u, 1.5));
  // it cools as it ages
  vTone = aLook.w * (1.0 - 0.85 * u);
  // the height of this corner above the stone: the pool sits in the scene unturned, so the eye's axes are the view matrix's rows
  vLift = at.y + offset.x * viewMatrix[1][0] + offset.y * viewMatrix[1][1] - uFloor;
  vec3 away = at - uLightAt;
  vLit = 1.0 / (1.0 + dot(away, away) * 0.9);
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uHot, uMid, uCool, uLightColour;
uniform float uTime, uGain, uOpacity, uLight;
varying vec2 vShape;
varying float vCap, vFade, vKind, vTone, vSeed, vLift, vLit;
void main() {
  if (vFade <= 0.0) discard;
  // the distance to the sprite's axis, not to its centre: a drawn-out spark is a capsule with round caps
  float d = length(vec2(vShape.x, max(abs(vShape.y) - vCap, 0.0)));
  float t = clamp(1.0 - d, 0.0, 1.0);
  float shape = t * t * (3.0 - 2.0 * t);
  vec3 tint = vTone > 0.5 ? mix(uMid, uHot, (vTone - 0.5) * 2.0) : mix(uCool, uMid, vTone * 2.0);
  vec3 colour; float alpha;
  if (vKind < 0.5) {
    // a mote: a wide soft light under a small hot heart, so it reads with no bloom
    float heart = pow(shape, 7.0);
    // it dims as it cools, as anything hot does
    alpha = (heart * 1.5 + shape * shape * 0.42) * (0.4 + 0.6 * vTone);
    colour = mix(tint, uHot, heart * 0.7 * vTone);
  } else if (vKind < 1.5) {
    float heart = pow(shape, 4.0);
    alpha = (heart * 1.7 + shape * 0.3) * (0.4 + 0.6 * vTone);
    colour = mix(tint, uHot, heart * 0.8 * vTone);
  } else if (vKind < 2.5) {
    // a glint: a thin four-pointed star that flashes as the flake turns, and is nearly dark between flashes
    vec2 p = abs(vShape);
    float star = exp(-p.x * 16.0) * exp(-p.y * 2.8) + exp(-p.y * 16.0) * exp(-p.x * 2.8) + exp(-d * d * 42.0) * 1.4;
    float turn = 0.5 + 0.5 * sin(uTime * (7.0 + 15.0 * vSeed) + vSeed * 90.0);
    alpha = star * (0.12 + 1.9 * pow(turn, 5.0)) * smoothstep(1.0, 0.6, d);
    colour = mix(tint, uHot, 0.6);
  } else if (vKind > 3.5) {
    // a halo: the glow round something bright, drawn, because the lowest tier has no bloom to make it
    alpha = shape * shape * 0.3;
    colour = tint;
  } else {
    // a puff: a soft body, torn at its edge by noise that drifts through it, brighter on top
    float torn = noise(vShape * 1.9 + vSeed * 31.0 + vec2(uTime * 0.11, -uTime * 0.07)) * 0.65 + noise(vShape * 4.3 - vSeed * 17.0 + vec2(-uTime * 0.09, uTime * 0.05)) * 0.35;
    alpha = smoothstep(0.0, 0.8, t) * smoothstep(0.18, 0.62, torn * 0.7 + t * 0.55);
    colour = tint * (0.72 + 0.28 * clamp(vShape.y * 0.5 + 0.5, 0.0, 1.0)) + uLightColour * uLight * vLit;
    // no scene depth to soften where it meets the stone: it thins into the board by height instead
    alpha *= smoothstep(0.0, 0.16, vLift);
  }
  alpha *= vFade;
  #ifdef COVER
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(colour, min(alpha, 1.0) * uOpacity);
  #else
  vec3 light = colour * alpha * uGain;
  if (max(max(light.r, light.g), light.b) < 0.003) discard;
  gl_FragColor = vec4(light, 1.0);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticlePool {
  readonly object: THREE.Mesh;
  /** The number of particles the pool holds, and the moment the last of them dies. */
  readonly count: number;
  readonly spent: number;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(options: ParticlePoolOptions) {
    const packed = packParticles(options.particles, options.capacity, options.seed);
    this.count = packed.count; this.spent = packed.spent;
    // one quad, corners at -1..1, shared by every particle
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(packed.origin, 3));
    this.geometry.setAttribute("aVelocity", new THREE.InstancedBufferAttribute(packed.velocity, 3));
    this.geometry.setAttribute("aTimes", new THREE.InstancedBufferAttribute(packed.times, 4));
    this.geometry.setAttribute("aLook", new THREE.InstancedBufferAttribute(packed.look, 4));
    this.geometry.setAttribute("aExtra", new THREE.InstancedBufferAttribute(packed.extra, 4));
    this.geometry.instanceCount = packed.count;
    const cover = options.blend === "cover";
    this.uniforms = {
      uTime: { value: 0 }, uFloor: { value: options.floor }, uPixel: { value: 0.001 }, uStretch: { value: 0.09 }, uGain: { value: 1 },
      uOpacity: { value: options.opacity ?? 0.5 }, uAnchor: { value: new THREE.Vector3() },
      uLightAt: { value: new THREE.Vector3() }, uLightColour: { value: new THREE.Color(0xffffff) }, uLight: { value: 0 },
      uHot: { value: new THREE.Color(options.look.hot) }, uMid: { value: new THREE.Color(options.look.mid) }, uCool: { value: new THREE.Color(options.look.cool) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: cover ? { COVER: 1 } : {},
      transparent: true, depthWrite: false, blending: cover ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? (cover ? 8 : 14);
    this.object.visible = packed.count > 0;
  }

  /** The spell's clock, in seconds since the cast, and the camera drawing it: `height` is the buffer's height in pixels. */
  update(time: number, camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
    this.object.visible = this.count > 0 && time < this.spent;
  }
  /** Where anchored particles are born: a hand that moves carries them. */
  setAnchor(point: Vec): void { (this.uniforms.uAnchor.value as THREE.Vector3).set(point.x, point.y, point.z); }
  /** A light the spell throws on a covering pool: its dust and mist are lit by it. */
  setLight(point: Vec, colour: number, strength: number): void {
    (this.uniforms.uLightAt.value as THREE.Vector3).set(point.x, point.y, point.z);
    (this.uniforms.uLightColour.value as THREE.Color).setHex(colour); this.uniforms.uLight.value = strength;
  }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
