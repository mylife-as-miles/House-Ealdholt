// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * One pool for every loose light a flourish throws: the sparks an arc sheds, the streaks of a sigil's starburst, and the
 * flakes a kill scatters. shardPlan.ts plans them; this draws them.
 *
 * The pool is a ring of instanced quads allocated once for the preset. A spawn writes one slot and marks it for upload;
 * the frame uploads only the slots written since the last one. After that a spark costs nothing on the CPU: its flight
 * (exact under drag and a pull), its drift on the turbulent wind (the curl of shardPlan.curl, summed along its path) and
 * its fade are worked out in the vertex shader from one clock. A spark that has not been born or has died is folded out
 * of the picture before it costs a fragment. The closed-form flight and the streak drawn out on the screen as a capsule
 * with round caps are the spells' particle pool's (spells/shared/particles.ts), from the reference's EmberSystem.
 *
 * Four ways to draw: a mote (a soft light with a hot heart), a streak (the same, drawn out along its motion on the
 * screen), a flake (a flat diamond turning in three dimensions: dull as it turns edge on, flashing near white as its
 * face catches the key light, which is what "catching the light" is), and a blade of fire (a hard-edged, faceted kite
 * of flame that shoots out along its throw and is drawn back in: the crystalline fire of a Solforiz spell's blow). The output is premultiplied: light is added, and a
 * flake also covers a little of what is behind it, so a gold flake still reads as gold over pale marble.
 */
import * as THREE from "three";
import { CURL_GLSL, SPARK_KIND, type ShardSpec } from "./shardPlan";

const VERTEX = /* glsl */ `
attribute vec3 aOrigin, aVelocity, aTint;
attribute vec4 aTimes, aLook;
attribute vec2 aTurn;
uniform float uTime, uPixel, uFloor;
uniform vec3 uKey;
varying vec2 vShape;
varying float vCap, vFade, vKind, vHeat, vGlint, vFace;
varying vec3 vTint;
${CURL_GLSL}
vec3 turnAbout(vec3 v, vec3 k, float angle) { float c = cos(angle), s = sin(angle); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float age = uTime - aTimes.x, life = aTimes.y;
  vShape = vec2(0.0); vCap = 0.0; vFade = 0.0; vKind = aLook.z; vHeat = 0.0; vGlint = 0.0; vFace = 0.0; vTint = aTint;
  if (life <= 0.0 || age <= 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / life;
  // shardPlan / particlePlan flightPoint: linear drag under a constant pull, exact
  float drag = aTimes.z, pull = aTimes.w, decay = exp(-drag * age);
  float travel = drag < 1e-4 ? age : (1.0 - decay) / drag;
  float fall = drag < 1e-4 ? 0.5 * age * age : (age - travel) / drag;
  vec3 at = aOrigin + aVelocity * travel - vec3(0.0, pull * fall, 0.0);
  vec3 going = aVelocity * decay - vec3(0.0, pull * travel, 0.0);
  if (aLook.w > 0.0) {
    // the wind along its path: the curl at four points of the flight so far, summed
    vec3 drift = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float s = age * float(i) * 0.25, ds = exp(-drag * s);
      float tr = drag < 1e-4 ? s : (1.0 - ds) / drag;
      float fl = drag < 1e-4 ? 0.5 * s * s : (s - tr) / drag;
      drift += flourishCurl((aOrigin + aVelocity * tr - vec3(0.0, pull * fl, 0.0)) * 1.6, aTimes.x + s);
    }
    at += drift * (age * 0.25) * aLook.w * 0.22;
    going += flourishCurl(at * 1.6, uTime) * aLook.w * 0.22;
  }
  // it lies on the stone rather than go through it
  float rest = uFloor + 0.012;
  if (at.y < rest) { at.y = rest; going = vec3(going.x * 0.1, 0.0, going.z * 0.1); }
  // shardPlan.shardFade: up at once, held, gone smoothly
  float appear = clamp(u / 0.06, 0.0, 1.0), leave = 1.0 - max(0.0, (u - 0.6) / 0.4);
  vFade = appear * appear * (3.0 - 2.0 * appear) * leave * leave * (3.0 - 2.0 * leave);
  vHeat = aTurn.y * (1.0 - 0.8 * u);
  float size = aLook.x;
  vec4 view = viewMatrix * vec4(at, 1.0);
  if (aLook.z > 1.5 && aLook.z < 2.5) {
    // a flake: a flat diamond turning about an axis of its own
    float s = aLook.y * 6.2831853;
    vec3 axis = normalize(vec3(sin(s * 3.1), cos(s * 1.7) + 0.2, sin(s * 2.3 + 1.0)));
    float angle = s + aTurn.x * (age * 0.55 + travel * 0.45);
    size = max(size, uPixel * -view.z * 1.1);
    vec3 side = turnAbout(vec3(1.0, 0.0, 0.0), axis, angle), up = turnAbout(vec3(0.0, 1.0, 0.0), axis, angle);
    vec3 normal = normalize(cross(side, up));
    gl_Position = projectionMatrix * viewMatrix * vec4(at + (side * position.x + up * position.y * 0.62) * size, 1.0);
    vShape = position.xy;
    vec3 eye = normalize(cameraPosition - at);
    float facing = abs(dot(normal, normalize(normalize(uKey) + eye)));
    vGlint = pow(facing, 28.0);
    vFace = abs(dot(normal, eye));
    return;
  }
  vec2 axis = vec2(0.0, 1.0);
  float stretch = 1.0;
  // never smaller than a pixel or so, or a spark across the board is lost
  size = max(size, uPixel * -view.z * 1.4);
  if (aLook.z > 2.5) {
    // a blade of fire: a hard-edged kite set along the way it was thrown, its root where it is, shooting out to its
    // length (aTurn.x times its width) and drawn back in as it dies
    vec3 thrown = (viewMatrix * vec4(aVelocity, 0.0)).xyz;
    if (length(thrown.xy) > 1e-5) axis = normalize(thrown.xy);
    float reach = 1.0 + max(aTurn.x, 0.0) * smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.45, 1.0, u));
    float along = (position.y * 0.5 + 0.5) * reach * 2.0;
    view.xy += (vec2(-axis.y, axis.x) * position.x * (1.0 - 0.35 * u) + axis * along) * size;
    gl_Position = projectionMatrix * view;
    vShape = vec2(position.x, position.y * 0.5 + 0.5); vCap = reach;
    return;
  }
  if (aLook.z > 0.5) {
    // a streak is drawn out over the path of its last moment (a shutter of aTurn.x seconds): long while it flies fast,
    // a point as the air stops it
    vec3 seen = (viewMatrix * vec4(going, 0.0)).xyz;
    float speed = length(seen.xy);
    if (speed > 1e-4) axis = seen.xy / speed;
    stretch = 1.0 + min(speed * max(aTurn.x, 0.0) / size, 40.0);
  }
  view.xy += (vec2(-axis.y, axis.x) * position.x + axis * position.y * stretch) * size;
  gl_Position = projectionMatrix * view;
  vShape = vec2(position.x, position.y * stretch); vCap = stretch - 1.0;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec2 vShape;
varying float vCap, vFade, vKind, vHeat, vGlint, vFace;
varying vec3 vTint;
void main() {
  if (vFade <= 0.0) discard;
  vec3 light; float cover = 0.0;
  if (vKind > 2.5) {
    // a blade of fire, cut like a crystal: widest a third of the way out, straight-edged to a point at either end, two
    // facets and a ridge between them; white at its root, the kingdom's fire through it, deep red at its point
    float t = vShape.y, x = abs(vShape.x);
    float span = t < 0.3 ? t / 0.3 : (1.0 - t) / 0.7;
    float edge = x - span, aa = max(fwidth(edge), 1e-4);
    float inside = 1.0 - smoothstep(-aa, aa, edge);
    if (inside <= 0.0) discard;
    float facet = vShape.x > 0.0 ? 1.0 : 0.6;
    float ridge = 1.0 - smoothstep(0.0, 0.12, x / max(span, 1e-3));
    vec3 fire = mix(vec3(1.0, 0.93, 0.78), vTint, smoothstep(0.03, 0.32, t));
    fire = mix(fire, vTint * vec3(0.7, 0.2, 0.07), smoothstep(0.5, 1.0, t));
    light = fire * inside * (facet * (0.32 + 0.5 * vHeat) + ridge * 0.55 * vHeat * (1.0 - t));
    cover = inside * 0.18 * vHeat;
  } else if (vKind > 1.5) {
    // a flake: a diamond, its body in its colour, dim edge on, and its glint near white
    float d = abs(vShape.x) + abs(vShape.y);
    if (d > 1.0) discard;
    float edge = smoothstep(1.0, 0.8, d);
    vec3 hot = mix(vTint, vec3(1.0), 0.6);
    light = (vTint * (0.2 + 0.8 * vFace) * (0.6 + 0.4 * vHeat) + hot * vGlint * (2.2 + 1.8 * vHeat)) * edge;
    cover = edge * 0.3 * (0.4 + 0.6 * vFace);
  } else {
    // a mote or a streak: a capsule with round caps, a wide soft light under a small hot heart
    float d = length(vec2(vShape.x, max(abs(vShape.y) - vCap, 0.0)));
    float t = clamp(1.0 - d, 0.0, 1.0);
    float shape = t * t * (3.0 - 2.0 * t);
    float heart = vKind > 0.5 ? shape * shape * shape * shape : pow(shape, 7.0);
    vec3 hot = mix(vTint, vec3(1.0), 0.75);
    light = mix(vTint, hot, heart * vHeat) * (heart * 1.6 + shape * shape * 0.36) * (0.45 + 0.55 * vHeat);
  }
  light *= vFade; cover *= vFade;
  if (max(max(light.r, light.g), light.b) < 0.002 && cover < 0.004) discard;
  gl_FragColor = vec4(light * uGain, cover);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Floats per slot of each attribute. */
const SIZES = { aOrigin: 3, aVelocity: 3, aTint: 3, aTimes: 4, aLook: 4, aTurn: 2 } as const;
type Name = keyof typeof SIZES;

export class SparkPool {
  readonly object: THREE.Mesh;
  readonly capacity: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly arrays: Record<Name, Float32Array>;
  private readonly attributes: Record<Name, THREE.InstancedBufferAttribute>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly colour = new THREE.Color();
  private next = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private wrapped = false;
  private time = 0;
  /** The moment the last spark written dies. */
  private spent = 0;

  constructor(capacity: number, floor: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.arrays = {} as Record<Name, Float32Array>;
    this.attributes = {} as Record<Name, THREE.InstancedBufferAttribute>;
    for (const name of Object.keys(SIZES) as Name[]) {
      const array = new Float32Array(this.capacity * SIZES[name]);
      const attribute = new THREE.InstancedBufferAttribute(array, SIZES[name]).setUsage(THREE.DynamicDrawUsage);
      this.arrays[name] = array; this.attributes[name] = attribute;
      this.geometry.setAttribute(name, attribute);
    }
    this.geometry.instanceCount = this.capacity;
    this.uniforms = {
      uTime: { value: 0 }, uPixel: { value: 0.001 }, uFloor: { value: floor }, uGain: { value: 1 },
      uKey: { value: new THREE.Vector3(0.35, 1, 0.25).normalize() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = "FlourishSparks";
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.renderOrder = 15;
    this.object.visible = false;
  }

  /** Sparks alive now (for browser checks; walks the pool). */
  get active(): number {
    let live = 0;
    const times = this.arrays.aTimes;
    for (let i = 0; i < this.capacity; i += 1) { const age = this.time - times[i * 4]; if (times[i * 4 + 1] > 0 && age > 0 && age < times[i * 4 + 1]) live += 1; }
    return live;
  }

  /** Writes one spark (or flake) into the next slot, replacing the oldest when the ring is full. Allocates nothing. */
  spawn(spec: ShardSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.wrapped = true;
    const { aOrigin, aVelocity, aTint, aTimes, aLook, aTurn } = this.arrays;
    aOrigin[i * 3] = spec.x; aOrigin[i * 3 + 1] = spec.y; aOrigin[i * 3 + 2] = spec.z;
    aVelocity[i * 3] = spec.vx; aVelocity[i * 3 + 1] = spec.vy; aVelocity[i * 3 + 2] = spec.vz;
    this.colour.setHex(spec.colour);
    aTint[i * 3] = this.colour.r; aTint[i * 3 + 1] = this.colour.g; aTint[i * 3 + 2] = this.colour.b;
    const birth = this.time + Math.max(0, spec.delay);
    aTimes[i * 4] = birth; aTimes[i * 4 + 1] = Math.max(0, spec.life); aTimes[i * 4 + 2] = Math.max(0, spec.drag); aTimes[i * 4 + 3] = spec.gravity;
    aLook[i * 4] = spec.size; aLook[i * 4 + 1] = spec.seed; aLook[i * 4 + 2] = spec.kind === SPARK_KIND.blade ? 3 : spec.kind === SPARK_KIND.flake ? 2 : spec.kind === SPARK_KIND.streak ? 1 : 0; aLook[i * 4 + 3] = Math.max(0, spec.wander);
    aTurn[i * 2] = spec.spin; aTurn[i * 2 + 1] = Math.min(1, Math.max(0, spec.heat));
    this.spent = Math.max(this.spent, birth + spec.life);
    this.dirtyFrom = Math.min(this.dirtyFrom, i); this.dirtyTo = Math.max(this.dirtyTo, i);
  }

  /** Advances the pool's clock and uploads what was written since the last frame. `height` is the buffer's height in pixels. */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): void {
    this.time += Math.max(0, seconds);
    this.upload();
    this.uniforms.uTime.value = this.time;
    this.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
    this.object.visible = this.time < this.spent;
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  /** Every spark goes at once (Undo, a new game, the map). */
  clear(): void {
    this.arrays.aTimes.fill(0);
    this.dirtyFrom = 0; this.dirtyTo = this.capacity - 1; this.wrapped = false;
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
    // a ring that wrapped since the last upload may have written both ends: send it whole
    const from = this.wrapped ? 0 : this.dirtyFrom, to = this.wrapped ? this.capacity - 1 : this.dirtyTo;
    for (const name of Object.keys(SIZES) as Name[]) {
      const attribute = this.attributes[name], size = SIZES[name];
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(from * size, (to - from + 1) * size);
      attribute.needsUpdate = true;
    }
    this.dirtyFrom = Infinity; this.dirtyTo = -1; this.wrapped = false;
  }
}
