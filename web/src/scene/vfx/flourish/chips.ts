// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The dark chips of stone a kill tears up (shardPlan.ts planShatter), drawn: small solid shards, lit, turning as they
 * fly, so their faces catch the light in turn.
 *
 * One instanced mesh of one angular shard (an irregular double pyramid with flat faces), stretched and squashed per
 * chip by its own dice. Like the sparks, a chip is written once into a ring of slots and then costs nothing on the CPU:
 * its flight, its drift on the wind, its tumble and its life are worked out in the vertex shader. Chips are opaque and
 * write depth, so they need no sorting; a chip grows in over its first frames and shrinks away at the end of its life
 * instead of fading, so none pops in or out. The closed-form flight is the spells' particle pool's
 * (spells/shared/particles.ts), from the reference's EmberSystem.
 *
 * They are lit by a key light from above and a little behind the eye (not the arena's own lights: the same look in
 * every hall), scaled by the light gain lit sprites take (vfxLight), with a sheen on any face turned to the key, and the
 * kingdom's light of the blow glowing on their edges while they are hot.
 */
import * as THREE from "three";
import { CURL_GLSL, type ShardSpec } from "./shardPlan";

const VERTEX = /* glsl */ `
attribute vec3 aOrigin, aVelocity, aEdge;
attribute vec4 aTimes, aLook, aColour;
uniform float uTime, uFloor;
varying vec3 vNormal, vColour, vEdge, vWorld;
varying float vHeat;
${CURL_GLSL}
vec3 turnAbout(vec3 v, vec3 k, float angle) { float c = cos(angle), s = sin(angle); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float age = uTime - aTimes.x, life = aTimes.y;
  vNormal = vec3(0.0, 1.0, 0.0); vColour = aColour.rgb; vEdge = aEdge; vWorld = vec3(0.0); vHeat = 0.0;
  if (life <= 0.0 || age <= 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / life;
  float drag = aTimes.z, pull = aTimes.w, decay = exp(-drag * age);
  float travel = drag < 1e-4 ? age : (1.0 - decay) / drag;
  float fall = drag < 1e-4 ? 0.5 * age * age : (age - travel) / drag;
  vec3 at = aOrigin + aVelocity * travel - vec3(0.0, pull * fall, 0.0);
  if (aLook.w > 0.0) {
    vec3 drift = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float s = age * float(i) * 0.25, ds = exp(-drag * s);
      float tr = drag < 1e-4 ? s : (1.0 - ds) / drag;
      float fl = drag < 1e-4 ? 0.5 * s * s : (s - tr) / drag;
      drift += flourishCurl((aOrigin + aVelocity * tr - vec3(0.0, pull * fl, 0.0)) * 1.6, aTimes.x + s);
    }
    at += drift * (age * 0.25) * aLook.w * 0.22;
  }
  // its own shape, its own axis, and a tumble that slows as the air takes it
  float s = aLook.y * 6.2831853;
  vec3 shape = vec3(1.0, 0.42 + 0.4 * fract(aLook.y * 7.31), 0.58 + 0.42 * fract(aLook.y * 13.7));
  vec3 axis = normalize(vec3(sin(s * 2.7), cos(s * 1.9) + 0.3, sin(s * 4.1 + 2.0)));
  float angle = s + aLook.z * (age * 0.45 + travel * 0.55);
  // grows in, and shrinks away at the end
  float size = aLook.x * smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.72, 1.0, u));
  // it comes to rest on the stone
  at.y = max(at.y, uFloor + aLook.x * 0.4);
  vec3 world = at + turnAbout(position * shape * size, axis, angle);
  vWorld = world;
  vNormal = turnAbout(normalize(normal / shape), axis, angle);
  vHeat = aColour.a * exp(-age * 2.2);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uLight, uGain;
varying vec3 vNormal, vColour, vEdge, vWorld;
varying float vHeat;
void main() {
  vec3 n = normalize(vNormal), eye = normalize(cameraPosition - vWorld), key = normalize(uKey);
  if (dot(n, eye) < 0.0) n = -n;
  float lit = max(dot(n, key), 0.0);
  float sheen = pow(max(dot(n, normalize(key + eye)), 0.0), 20.0);
  float rim = 1.0 - max(dot(n, eye), 0.0);
  rim = rim * rim * rim;
  vec3 colour = (vColour * (0.3 + 0.95 * lit) + vec3(0.42) * sheen) * uLight + vEdge * (rim * 0.85 + lit * 0.2) * vHeat * uGain;
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** One angular shard: an irregular double pyramid, flat-faced (its normals are its faces'). */
function shardGeometry(): THREE.BufferGeometry {
  const top = [0.05, 1, 0.1], bottom = [-0.08, -0.85, -0.05];
  const ring = [[1, 0.05, 0.05], [0.12, -0.08, 0.92], [-0.9, 0.1, 0.18], [-0.05, 0.02, -0.95]];
  const positions: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = ring[i], b = ring[(i + 1) % 4];
    positions.push(...top, ...b, ...a, ...bottom, ...a, ...b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

const SIZES = { aOrigin: 3, aVelocity: 3, aEdge: 3, aTimes: 4, aLook: 4, aColour: 4 } as const;
type Name = keyof typeof SIZES;

export class ChipPool {
  readonly object: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly arrays: Record<Name, Float32Array>;
  private readonly attributes: Record<Name, THREE.InstancedBufferAttribute>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly colour = new THREE.Color();
  private next = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private time = 0;
  private spent = 0;

  constructor(capacity: number, floor: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const shard = shardGeometry();
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute("position", shard.getAttribute("position"));
    this.geometry.setAttribute("normal", shard.getAttribute("normal"));
    this.arrays = {} as Record<Name, Float32Array>;
    this.attributes = {} as Record<Name, THREE.InstancedBufferAttribute>;
    for (const name of Object.keys(SIZES) as Name[]) {
      const array = new Float32Array(this.capacity * SIZES[name]);
      const attribute = new THREE.InstancedBufferAttribute(array, SIZES[name]).setUsage(THREE.DynamicDrawUsage);
      this.arrays[name] = array; this.attributes[name] = attribute;
      this.geometry.setAttribute(name, attribute);
    }
    this.geometry.instanceCount = this.capacity;
    this.uniforms = { uTime: { value: 0 }, uFloor: { value: floor }, uKey: { value: new THREE.Vector3(0.3, 1, 0.45).normalize() }, uLight: { value: 1 }, uGain: { value: 1 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.FrontSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = "FlourishChips";
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  get active(): number {
    let live = 0;
    const times = this.arrays.aTimes;
    for (let i = 0; i < this.capacity; i += 1) { const age = this.time - times[i * 4]; if (times[i * 4 + 1] > 0 && age > 0 && age < times[i * 4 + 1]) live += 1; }
    return live;
  }

  /** Writes one chip into the next slot (the oldest gives way when the ring is full). Allocates nothing. */
  spawn(spec: ShardSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const { aOrigin, aVelocity, aEdge, aTimes, aLook, aColour } = this.arrays;
    aOrigin[i * 3] = spec.x; aOrigin[i * 3 + 1] = spec.y; aOrigin[i * 3 + 2] = spec.z;
    aVelocity[i * 3] = spec.vx; aVelocity[i * 3 + 1] = spec.vy; aVelocity[i * 3 + 2] = spec.vz;
    this.colour.setHex(spec.edge);
    aEdge[i * 3] = this.colour.r; aEdge[i * 3 + 1] = this.colour.g; aEdge[i * 3 + 2] = this.colour.b;
    const birth = this.time + Math.max(0, spec.delay);
    aTimes[i * 4] = birth; aTimes[i * 4 + 1] = Math.max(0, spec.life); aTimes[i * 4 + 2] = Math.max(0, spec.drag); aTimes[i * 4 + 3] = spec.gravity;
    aLook[i * 4] = spec.size; aLook[i * 4 + 1] = spec.seed; aLook[i * 4 + 2] = spec.spin; aLook[i * 4 + 3] = Math.max(0, spec.wander);
    this.colour.setHex(spec.colour);
    aColour[i * 4] = this.colour.r; aColour[i * 4 + 1] = this.colour.g; aColour[i * 4 + 2] = this.colour.b; aColour[i * 4 + 3] = Math.min(1, Math.max(0, spec.heat));
    this.spent = Math.max(this.spent, birth + spec.life);
    this.dirtyFrom = Math.min(this.dirtyFrom, i); this.dirtyTo = Math.max(this.dirtyTo, i);
  }

  update(seconds: number): void {
    this.time += Math.max(0, seconds);
    this.upload();
    this.uniforms.uTime.value = this.time;
    this.object.visible = this.time < this.spent;
  }

  /** `light` is the gain lit matter takes in this exposure (vfxLight), `gain` the one light takes (vfxGlow). */
  setLight(light: number, gain: number): void { this.uniforms.uLight.value = light; this.uniforms.uGain.value = gain; }

  clear(): void {
    this.arrays.aTimes.fill(0);
    this.dirtyFrom = 0; this.dirtyTo = this.capacity - 1;
    this.upload();
    this.spent = 0; this.next = 0;
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }

  private upload(): void {
    if (this.dirtyTo < this.dirtyFrom) return;
    for (const name of Object.keys(SIZES) as Name[]) {
      const attribute = this.attributes[name], size = SIZES[name];
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(this.dirtyFrom * size, (this.dirtyTo - this.dirtyFrom + 1) * size);
      attribute.needsUpdate = true;
    }
    this.dirtyFrom = Infinity; this.dirtyTo = -1;
  }
}
