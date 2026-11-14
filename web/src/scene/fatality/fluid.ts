/**
 * The fluid blood of a cinematic fatality (gore tier 3), on the GPU, in WebGL2 (the plan is fatality/fluidPlan.ts).
 *
 * The method of the creator's references (dgreenheck/threejs-particle-fluids, MIT; APS4087/spill, no licence), not
 * their code: both run on WebGPU compute, and the match draws with WebGL.
 *
 * - The particles: each one's launch (where, when, how fast, how big) in two float textures, written once a pour;
 *   its state (where it is, how it moves, whether it is in the air, hopping, running on the stone or still) in two
 *   more, ping-ponged between two render targets drawn together (multiple render targets), a step at a time on the
 *   scene's own delta, so the slow motion slows it. In the air it follows the closed form the plan lands it by;
 *   on the stone it splashes, some of it hops once, and it runs and slows.
 * - The surface, in screen space: the particles drawn as spheres into a depth target (the nearest surface) and,
 *   added up, into a thickness target, at half the frame's size; both smoothed (depth-aware, so separate streams
 *   do not run together); then one quad in the scene rebuilds the surface from the smoothed depth, takes its normals
 *   from the depth's slopes, and shades it wet and dark red, thin where it is thin, lit by the scene's lamp and its
 *   ambient light. It writes its own depth, so whatever stands in front of the blood hides it.
 * - The marks: the plan's stains and pool are handed to the gore system (its stain and pool calls, as a burst does)
 *   at the moment each lands; Undo takes them back with the ply.
 * - A second pour: a fatality that also takes a limb off pours from the stump too (fatality/stumpPlan.ts), into the
 *   particles the wound left free (the one budget, shared), from the moment the limb comes off, on its own clock and
 *   riding on its own bone; the particles in the air and on the stone are not touched.
 *
 * Off where the GPU cannot render to float textures, and on the Low preset (the plain sprays stand in).
 */
import * as THREE from "three";
import { GORE_GRAVITY } from "../gore/ballistics";
import type { GorePlan, PoolPlan, StainPlan } from "../gore/GoreTypes";
import { FLUID, fluidLaunch, fluidLevel, fluidMarks, type FluidLaunch, type FluidMarks, type FluidWound } from "./fluidPlan";
import { stumpLaunch } from "./stumpPlan";

/** The part of the gore system the fluid hands its marks to. GoreSystem is one. */
export interface FluidSink {
  stain(plan: GorePlan, stain: StainPlan): void;
  pool(plan: GorePlan, pool: PoolPlan, at: { x: number; z: number }): void;
  remove(impactId: string): void;
}

export interface FluidBurst extends FluidWound {
  /**
   * A stump's pour (fatality/stumpPlan.ts stumpLaunch): out of the cut's face at `entry`, as wide as this radius, along
   * `direction`, the way the limb went; `depth` is not used. Without it, a wound through the body (fluidPlan.ts).
   */
  stump?: { radius: number };
  /** How many particles pour (at most the capacity, or what the pour before it left). */
  count: number;
  /**
   * Where the wound it pours from is now (it was at `entry` when the pour began), asked each frame: a body carried
   * off or falling takes its wound with it, and the drops leave from where it is. Null or none: it stays put.
   */
  follow?: () => { x: number; y: number; z: number } | null;
  /** The capture's ply, and the gore plan its marks are filed under (its impact id is what Undo takes back). */
  ply: number;
  plan: GorePlan;
}

export interface FluidLight {
  /** The way to the light (world, unit), its colour, the ambient light, and the exposure's gain for what is lit. */
  direction: THREE.Vector3;
  colour: THREE.Color;
  ambient: THREE.Color;
  gain: number;
}

export interface FluidStats {
  supported: boolean; capacity: number;
  /** Particles pouring now (both pours), scene seconds since the first began, the first's level, and the impacts marked. */
  pouring: number; seconds: number; level: number; marks: number;
  /** A stump's pour: its particles (0 for none), and when it began on the fluid's clock (-1 for none). */
  stump: number; stumpAt: number;
}

/** One wound pouring into the fluid: the fatality's own, and a stump's after it (fatality/stumpPlan.ts). */
interface Pour {
  burst: FluidBurst;
  /** Its particles: `count` of them from `first`. */
  first: number;
  count: number;
  /** Scene seconds on the fluid's clock it began to pour: its drops leave, its marks land and it thins, on its own clock from then. */
  start: number;
  marks: FluidMarks;
  laid: Set<number>;
  pooled: boolean;
  /** How far its wound has moved since it began to pour, at each moment it was asked (its own seconds): what moves its marks. */
  moved: { at: number; x: number; y: number; z: number }[];
}

/** The longest step the particles take on the stone (scene seconds): a frame's delta is cut into steps no longer. */
const STEP = 1 / 90;
/** The share of the frame's size the surface is drawn at, and how many times it is smoothed (each across and down). */
const SURFACE_SCALE = 0.5, SMOOTHING = 2;

const SIM_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SIM_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform sampler2D uLaunchA;
uniform sampler2D uLaunchB;
uniform float uTime;
uniform float uDt;
uniform float uReset;
uniform float uGravity;
uniform float uDrag;
uniform float uTop;
uniform float uHop;
uniform float uCarry;
uniform float uFriction;
uniform vec3 uShift;
uniform vec3 uShiftB;
uniform float uSplit;
layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;
float fluidHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// gore/ballistics.ts: gravity and linear drag, in closed form.
vec3 flight(vec3 origin, vec3 v0, float t) {
  float decay = (1.0 - exp(-uDrag * t)) / uDrag, fall = -uGravity / uDrag;
  return vec3(origin.x + v0.x * decay, origin.y + (v0.y - fall) * decay + fall * t, origin.z + v0.z * decay);
}
vec3 flightVelocity(vec3 v0, float t) {
  float e = exp(-uDrag * t), fall = -uGravity / uDrag;
  return vec3(v0.x * e, fall + (v0.y - fall) * e, v0.z * e);
}
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uLaunchA, cell, 0), b = texelFetch(uLaunchB, cell, 0);
  vec4 p = texelFetch(uPosition, cell, 0), v = texelFetch(uVelocity, cell, 0);
  float birth = a.w, size = b.w, ground = uTop + size * 0.5;
  // The state, in p.w: 0 still in the wound, 1 in the air, 2 hopping, 3 running on the stone, 4 still on it.
  if (uReset > 0.5 || size <= 0.0 || uTime < birth) { outPosition = vec4(a.xyz, 0.0); outVelocity = vec4(b.xyz, 0.0); return; }
  // A drop leaves the wound where the wound is as it leaves (uShift: how far the wound has moved since the pour
  // began), and keeps that in its velocity's place while it flies, its flight the closed form from there. A stump's
  // pour has the particles from uSplit on, and moves by its own (uShiftB).
  bool leaving = p.w < 0.5;
  float state = max(p.w, 1.0);
  if (state < 1.5) {
    vec3 own = float(cell.y * textureSize(uLaunchA, 0).x + cell.x) < uSplit ? uShift : uShiftB;
    vec3 shift = leaving ? own : v.xyz;
    float t = uTime - birth;
    vec3 at = flight(a.xyz + shift, b.xyz, t);
    vec3 moving = flightVelocity(b.xyz, t);
    if (at.y > ground) { outPosition = vec4(at, 1.0); outVelocity = vec4(shift, 0.0); return; }
    // It lands: some of it hops, the rest runs on along the stone with part of its speed.
    vec3 along = vec3(moving.x, 0.0, moving.z) * uCarry * (0.55 + 0.9 * fluidHash(vec2(cell) + 1.9));
    at.y = ground;
    if (fluidHash(vec2(cell) + 0.37) < uHop) { outPosition = vec4(at, 2.0); outVelocity = vec4(along.x, abs(moving.y) * 0.24, along.z, uTime); }
    else { outPosition = vec4(at, 3.0); outVelocity = vec4(along, uTime); }
    return;
  }
  if (state < 2.5) {
    v.y -= uGravity * uDt;
    v.xyz *= exp(-uDrag * uDt);
    p.xyz += v.xyz * uDt;
    if (p.y <= ground) { p.y = ground; v.y = 0.0; v.xz *= 0.55; state = 3.0; }
    outPosition = vec4(p.xyz, state); outVelocity = v;
    return;
  }
  v.xz *= exp(-uFriction * uDt);
  p.xz += v.xz * uDt;
  p.y = ground;
  if (dot(v.xz, v.xz) < 1e-6) state = 4.0;
  outPosition = vec4(p.xyz, state); outVelocity = v;
}`;

/** The particles as spheres, for the depth and thickness targets. */
const POINT_VERTEX = /* glsl */ `
precision highp float;
uniform sampler2D uPosition;
uniform sampler2D uLaunchB;
uniform float uProjScale;
uniform float uLevel;
uniform float uLevelB;
uniform float uSplit;
in vec2 cell;
out float vRadius;
out vec3 vCentre;
void main() {
  ivec2 c = ivec2(cell);
  vec4 p = texelFetch(uPosition, c, 0);
  // Each pour thins away on its own clock: the wound's, and a stump's from uSplit on.
  float level = float(c.y * textureSize(uPosition, 0).x + c.x) < uSplit ? uLevel : uLevelB;
  // A drop that runs flattens and spreads on the stone, into the drops beside it.
  float size = texelFetch(uLaunchB, c, 0).w * (p.w > 2.5 ? 2.1 : 1.0) * level;
  if (p.w < 0.5 || size <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vRadius = 0.0; vCentre = vec3(0.0); return; }
  vec4 view = viewMatrix * vec4(p.xyz, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(size * uProjScale / max(1e-3, -view.z), 2.0, 256.0);
  vRadius = size;
  vCentre = view.xyz;
}`;

const DEPTH_FRAGMENT = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
in float vRadius;
in vec3 vCentre;
layout(location = 0) out vec4 outDepth;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (r2 > 1.0 || vRadius <= 0.0) discard;
  vec3 surface = vCentre + vec3(q * vRadius, sqrt(1.0 - r2) * vRadius);
  vec4 clip = projectionMatrix * vec4(surface, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  outDepth = vec4(-surface.z, 0.0, 0.0, 1.0);
}`;

const THICKNESS_FRAGMENT = /* glsl */ `
precision highp float;
in float vRadius;
in vec3 vCentre;
layout(location = 0) out vec4 outThickness;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0 || vRadius <= 0.0) discard;
  outThickness = vec4(0.0, 2.0 * sqrt(1.0 - r2) * vRadius, 0.0, 1.0);
}`;

const QUAD_VERTEX = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * One pass of the smoothing, along `uStep`: the depth (red) by a bilateral filter that keeps separate streams apart,
 * the thickness (green) by a plain one. The first pass reads the two targets the particles were drawn into.
 */
const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uDepth;
uniform sampler2D uThickness;
uniform vec2 uStep;
uniform float uRange;
in vec2 vUv;
layout(location = 0) out vec4 outSurface;
// Whole texels, whatever the targets' filtering: depth is never blended across an edge here.
ivec2 texel(sampler2D map, int i) { ivec2 size = textureSize(map, 0); return clamp(ivec2(gl_FragCoord.xy) + ivec2(uStep) * i, ivec2(0), size - 1); }
void main() {
  float d0 = texelFetch(uDepth, texel(uDepth, 0), 0).r;
  float tSum = 0.0, tWeight = 0.0, dSum = 0.0, dWeight = 0.0, near = 0.0, all = 0.0;
  // The nearest of what is here, for the range weights of an empty pixel filled from its neighbours.
  float ref = d0;
  if (ref <= 0.0) { ref = 1e9; for (int i = -7; i <= 7; i++) { float d = texelFetch(uDepth, texel(uDepth, i), 0).r; if (d > 0.0) ref = min(ref, d); } }
  for (int i = -7; i <= 7; i++) {
    float spatial = exp(-float(i * i) / 18.0);
    all += spatial;
    tSum += texelFetch(uThickness, texel(uThickness, i), 0).g * spatial; tWeight += spatial;
    float d = texelFetch(uDepth, texel(uDepth, i), 0).r;
    if (d <= 0.0 || ref >= 1e9) continue;
    float range = (d - ref) / uRange;
    float w = spatial * exp(-range * range);
    dSum += d * w; dWeight += w; near += spatial;
  }
  // A pixel between drops close enough together is filled: the drops run into one surface.
  float depth = dWeight > 0.0 && (d0 > 0.0 || near > all * 0.3) ? dSum / dWeight : 0.0;
  outSurface = vec4(depth, tSum / tWeight, 0.0, 1.0);
}`;

/** The surface, in the scene: rebuilt from the smoothed depth, wet and dark red, writing its own depth. */
const SURFACE_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SURFACE_FRAGMENT = /* glsl */ `
uniform mat4 projectionMatrix;
uniform sampler2D uSurface;
uniform vec2 uTexel;
uniform vec2 uViewport;
uniform mat4 uProjectionInverse;
uniform vec3 uLightDir;
uniform vec3 uLightColour;
uniform vec3 uAmbient;
uniform vec3 uBlood;
uniform vec3 uDeep;
uniform float uGain;
uniform float uCliff;
vec3 viewAt(vec2 uv, float depth) {
  vec4 ray = uProjectionInverse * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  ray.xyz /= ray.w;
  return ray.xyz * (depth / -ray.z);
}
// The depth at a whole texel (never blended across an edge); the thickness is read filtered, for soft edges.
float depthAt(vec2 uv) { ivec2 size = textureSize(uSurface, 0); return texelFetch(uSurface, clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1), 0).r; }
void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float thick = texture2D(uSurface, uv).g;
  float depth = depthAt(uv);
  // Where the drops are too few to run together, nothing is drawn: a thin spray is the ordinary droplets' to show.
  if (thick < 0.004) discard;
  // Just outside the drops' own texels the filtered thickness still shows: a fringe, at its neighbour's depth.
  if (depth <= 0.0) depth = max(max(depthAt(uv + vec2(uTexel.x, 0.0)), depthAt(uv - vec2(uTexel.x, 0.0))), max(depthAt(uv + vec2(0.0, uTexel.y)), depthAt(uv - vec2(0.0, uTexel.y))));
  if (depth <= 0.0) discard;
  vec3 p = viewAt(uv, depth);
  // The slope each way from the nearer neighbour, two texels off so the surface's small bumps do not glitter, and
  // the nearer so an edge does not bend the normal. A neighbour more than a drop's depth away (uCliff) is another
  // drop in front of or behind this one, not this surface going on: it is left out, as an empty one is.
  vec2 dx = vec2(uTexel.x * 2.0, 0.0), dy = vec2(0.0, uTexel.y * 2.0);
  float r = depthAt(uv + dx), l = depthAt(uv - dx), u = depthAt(uv + dy), d = depthAt(uv - dy);
  if (abs(r - depth) > uCliff) r = 0.0;
  if (abs(l - depth) > uCliff) l = 0.0;
  if (abs(u - depth) > uCliff) u = 0.0;
  if (abs(d - depth) > uCliff) d = 0.0;
  vec3 sx = r > 0.0 ? viewAt(uv + dx, r) - p : vec3(1e-4, 0.0, 0.0);
  vec3 sx2 = l > 0.0 ? p - viewAt(uv - dx, l) : sx;
  if (r <= 0.0 || (l > 0.0 && abs(sx2.z) < abs(sx.z))) sx = sx2;
  vec3 sy = u > 0.0 ? viewAt(uv + dy, u) - p : vec3(0.0, 1e-4, 0.0);
  vec3 sy2 = d > 0.0 ? p - viewAt(uv - dy, d) : sy;
  if (u <= 0.0 || (d > 0.0 && abs(sy2.z) < abs(sy.z))) sy = sy2;
  vec3 c = cross(sx, sy);
  vec3 n = dot(c, c) > 1e-20 ? normalize(c) : vec3(0.0, 0.0, 1.0);
  if (n.z < 0.0) n = -n;
  // Where it is thin its slopes are mostly noise: it is shaded as facing the eye, so it reads as a dark wet film.
  n = normalize(mix(vec3(0.0, 0.0, 1.0), n, smoothstep(0.006, 0.03, thick)));
  vec3 v = normalize(-p);
  float diffuse = max(dot(n, uLightDir), 0.0);
  float spec = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 36.0) * smoothstep(0.006, 0.04, thick);
  // The sheen at grazing angles is taken on a calmer normal, halfway back to the eye: on the rebuilt one, every drop
  // the smoothing leaves standing tips edge-on somewhere and lit grey, a speckle all over a pool seen from afar.
  vec3 calm = normalize(mix(v, n, 0.5));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(calm, v), 0.0), 5.0);
  // Thin blood lets light through and glows red; thick blood is nearly black.
  float through = exp(-thick * 55.0);
  vec3 body = mix(uDeep, uBlood, through);
  vec3 colour = body * (uAmbient + uLightColour * diffuse * 0.85) + uLightColour * (spec * 0.35) + uAmbient * fresnel * 0.35;
  float alpha = clamp(1.0 - exp(-thick * 160.0), 0.0, 1.0);
  gl_FragColor = vec4(colour * uGain, alpha);
  vec4 clip = projectionMatrix * vec4(p, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BLOOD = new THREE.Color(0.42, 0.012, 0.01), DEEP = new THREE.Color(0.075, 0.002, 0.002);

/** The texture side for `capacity` particles: a power of two wide, as tall as needed. */
function sides(capacity: number): [number, number] {
  const width = Math.max(8, 2 ** Math.ceil(Math.log2(Math.sqrt(Math.max(1, capacity)))));
  return [width, Math.max(1, Math.ceil(capacity / width))];
}

export class FluidBlood {
  /** The surface, drawn in the scene: the engine adds it once. */
  readonly object: THREE.Mesh;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly top: number;
  private readonly sink: FluidSink | null;
  private readonly light: () => FluidLight;
  private capacity = 0;
  private width = 0;
  private height = 0;
  private launchA: THREE.DataTexture | null = null;
  private launchB: THREE.DataTexture | null = null;
  private state: THREE.WebGLRenderTarget[] = [];
  private current = 0;
  private readonly simScene = new THREE.Scene();
  private readonly simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly simMaterial: THREE.ShaderMaterial;
  private readonly quad = new THREE.PlaneGeometry(2, 2);
  private points: THREE.Points | null = null;
  private readonly pointScene = new THREE.Scene();
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly thicknessMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blurScene = new THREE.Scene();
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private depthTarget: THREE.WebGLRenderTarget | null = null;
  private thicknessTarget: THREE.WebGLRenderTarget | null = null;
  private blurTargets: THREE.WebGLRenderTarget[] = [];
  /** What pours now: the wound's pour, and a stump's after it; scene seconds since the first began. */
  private pouring: { pours: Pour[]; seconds: number; reset: boolean } | null = null;
  /** The marks laid, by ply: Undo takes back what the plies taken back left. */
  private readonly laid: { ply: number; impactId: string }[] = [];
  private readonly size = new THREE.Vector2();
  private readonly viewport = new THREE.Vector4();
  private readonly clear = new THREE.Color();
  private readonly toLight = new THREE.Vector3();
  readonly supported: boolean;
  /** Set if the GPU refused a pass: the fluid stays off for the match, and the plain sprays stand in. */
  private broken = false;

  /** Whether this renderer can draw the fluid: WebGL2 with float render targets. */
  static supports(renderer: THREE.WebGLRenderer): boolean {
    return renderer.capabilities.isWebGL2 && renderer.extensions.has("EXT_color_buffer_float");
  }

  constructor(renderer: THREE.WebGLRenderer, options: { capacity: number; top: number; sink: FluidSink | null; light: () => FluidLight }) {
    this.renderer = renderer;
    this.top = options.top;
    this.sink = options.sink;
    this.light = options.light;
    this.supported = FluidBlood.supports(renderer);
    this.simMaterial = new THREE.ShaderMaterial({
      name: "FluidStep", glslVersion: THREE.GLSL3, vertexShader: SIM_VERTEX, fragmentShader: SIM_FRAGMENT, depthTest: false, depthWrite: false,
      uniforms: {
        uPosition: { value: null }, uVelocity: { value: null }, uLaunchA: { value: null }, uLaunchB: { value: null },
        uTime: { value: 0 }, uDt: { value: 0 }, uReset: { value: 1 }, uGravity: { value: GORE_GRAVITY }, uDrag: { value: FLUID.drag },
        uTop: { value: options.top }, uHop: { value: FLUID.hop }, uCarry: { value: FLUID.carry }, uFriction: { value: FLUID.friction },
        uShift: { value: new THREE.Vector3() }, uShiftB: { value: new THREE.Vector3() }, uSplit: { value: 0 },
      },
    });
    const simQuad = new THREE.Mesh(this.quad, this.simMaterial);
    simQuad.frustumCulled = false;
    this.simScene.add(simQuad);
    const pointUniforms = () => ({ uPosition: { value: null }, uLaunchB: { value: null }, uProjScale: { value: 1 }, uLevel: { value: 1 }, uLevelB: { value: 0 }, uSplit: { value: 0 } });
    this.depthMaterial = new THREE.ShaderMaterial({ name: "FluidDepth", glslVersion: THREE.GLSL3, vertexShader: POINT_VERTEX, fragmentShader: DEPTH_FRAGMENT, uniforms: pointUniforms() });
    this.thicknessMaterial = new THREE.ShaderMaterial({
      name: "FluidThickness", glslVersion: THREE.GLSL3, vertexShader: POINT_VERTEX, fragmentShader: THICKNESS_FRAGMENT, uniforms: pointUniforms(),
      depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      name: "FluidSmooth", glslVersion: THREE.GLSL3, vertexShader: QUAD_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false,
      uniforms: { uDepth: { value: null }, uThickness: { value: null }, uStep: { value: new THREE.Vector2() }, uRange: { value: 0.02 } },
    });
    const blurQuad = new THREE.Mesh(this.quad, this.blurMaterial);
    blurQuad.frustumCulled = false;
    this.blurScene.add(blurQuad);
    this.surfaceMaterial = new THREE.ShaderMaterial({
      name: "FluidSurface", vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT, transparent: true, depthWrite: false, depthTest: true,
      uniforms: {
        uSurface: { value: null }, uTexel: { value: new THREE.Vector2() }, uViewport: { value: new THREE.Vector2(1, 1) }, uProjectionInverse: { value: new THREE.Matrix4() },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightColour: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.2, 0.2, 0.2) },
        uBlood: { value: BLOOD.clone() }, uDeep: { value: DEEP.clone() }, uGain: { value: 1 }, uCliff: { value: 0.08 },
      },
    });
    this.object = new THREE.Mesh(this.quad, this.surfaceMaterial);
    this.object.name = "fluid-blood";
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.object.visible = false;
    this.object.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(this.viewport);
      this.surfaceMaterial.uniforms.uViewport.value.set(Math.max(1, this.viewport.z), Math.max(1, this.viewport.w));
      this.surfaceMaterial.uniforms.uProjectionInverse.value.copy((camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    };
    this.setCapacity(options.capacity);
  }

  get stats(): FluidStats {
    const p = this.pouring, stump = p?.pours[1];
    return {
      supported: this.supported, capacity: this.capacity, pouring: p ? p.pours.reduce((sum, pour) => sum + pour.count, 0) : 0, seconds: p?.seconds ?? 0,
      level: p ? fluidLevel(p.seconds) : 0, marks: this.laid.length, stump: stump?.count ?? 0, stumpAt: stump ? stump.start : -1,
    };
  }

  /** Scene seconds since the fluid now running began to pour, or null when none runs. */
  get clock(): number | null { return this.pouring?.seconds ?? null; }

  /** The most particles one pour may have (the preset's fluid budget, gore/goreTiers.ts); 0 turns the fluid off. */
  setCapacity(capacity: number): void {
    const wanted = this.supported ? Math.max(0, Math.floor(capacity)) : 0;
    if (wanted === this.capacity) return;
    this.stop();
    this.releaseParticles();
    this.capacity = wanted;
    if (!wanted) return;
    [this.width, this.height] = sides(wanted);
    const texels = this.width * this.height;
    const data = () => { const t = new THREE.DataTexture(new Float32Array(texels * 4), this.width, this.height, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
    this.launchA = data(); this.launchB = data();
    const target = () => new THREE.WebGLRenderTarget(this.width, this.height, { count: 2, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.state = [target(), target()];
    const cells = new Float32Array(texels * 2);
    for (let i = 0; i < texels; i += 1) { cells[i * 2] = i % this.width; cells[i * 2 + 1] = Math.floor(i / this.width); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(texels * 3), 3));
    geometry.setAttribute("cell", new THREE.BufferAttribute(cells, 2));
    this.points = new THREE.Points(geometry, this.depthMaterial);
    this.points.frustumCulled = false;
    this.pointScene.add(this.points);
  }

  /** The wound pours: the fluid of one fatality, from now on the scene's clock. False when there is no fluid here. */
  burst(burst: FluidBurst): boolean {
    if (this.broken || !this.capacity || !this.launchA || !this.launchB) return false;
    const count = Math.min(this.capacity, Math.max(0, Math.floor(burst.count)));
    if (!count) return false;
    (this.launchA.image.data as Float32Array).fill(0); (this.launchB.image.data as Float32Array).fill(0);
    this.pouring = { pours: [], seconds: 0, reset: true };
    this.write(this.pouring, burst, 0, count);
    this.object.visible = true;
    return true;
  }

  /**
   * A second wound pours into the fluid already running, from now on its clock: a stump, its limb just come off
   * (fatality/stumpPlan.ts). Its particles are those the first pour left free, so the two never pour more than the
   * budget; what is in the air or on the stone is not touched. False when no fluid of this ply runs, a second already
   * pours, or nothing is left for it.
   */
  pour(burst: FluidBurst): boolean {
    const p = this.pouring;
    if (!p || this.broken || p.pours.length !== 1 || p.pours[0].burst.ply !== burst.ply) return false;
    const first = p.pours[0].count, count = Math.min(this.capacity - first, Math.max(0, Math.floor(burst.count)));
    if (count <= 0) return false;
    this.write(p, burst, first, count);
    return true;
  }

  /** One pour's launches into the particles from `first`, born on its own clock from the fluid's now, and its marks planned. */
  private write(p: NonNullable<FluidBlood["pouring"]>, burst: FluidBurst, first: number, count: number): void {
    if (!this.launchA || !this.launchB) return;
    const a = this.launchA.image.data as Float32Array, b = this.launchB.image.data as Float32Array;
    const stump = burst.stump ? { entry: burst.entry, direction: burst.direction, radius: burst.stump.radius, height: burst.height, seed: burst.seed } : null;
    const start = p.seconds, launches: FluidLaunch[] = [];
    for (let i = 0; i < count; i += 1) {
      const launch = stump ? stumpLaunch(stump, i, count) : fluidLaunch(burst, i, count);
      launches.push(launch);
      a.set([launch.origin.x, launch.origin.y, launch.origin.z, start + launch.birth], (first + i) * 4);
      b.set([launch.velocity.x, launch.velocity.y, launch.velocity.z, launch.size], (first + i) * 4);
    }
    this.launchA.needsUpdate = true; this.launchB.needsUpdate = true;
    p.pours.push({ burst, first, count, start, marks: fluidMarks(launches, this.top, burst.height, burst.seed), laid: new Set(), pooled: false, moved: [{ at: 0, x: 0, y: 0, z: 0 }] });
    // Its wound has not moved yet: the first pour's from 0, the second's from uSplit on.
    const u = this.simMaterial.uniforms;
    (p.pours.length > 1 ? u.uShiftB : u.uShift).value.set(0, 0, 0);
    if (this.points) this.points.geometry.setDrawRange(0, first + count);
  }

  /** Moves the fluid on by the scene's delta (the slow motion's), and hands the gore system the marks that land in it. */
  update(delta: number): void {
    const p = this.pouring;
    if (!p) return;
    const step = Math.max(0, delta);
    const from = p.seconds;
    p.seconds += step;
    // Where each wound is now, while it still pours: the first's moves its drops by uShift, a stump's by uShiftB.
    p.pours.forEach((pour, index) => {
      const own = p.seconds - pour.start;
      const now = own <= FLUID.pour + 0.05 ? pour.burst.follow?.() ?? null : null;
      if (!now) return;
      const e = pour.burst.entry, moved = { at: own, x: now.x - e.x, y: now.y - e.y, z: now.z - e.z };
      pour.moved.push(moved);
      (index === 0 ? this.simMaterial.uniforms.uShift : this.simMaterial.uniforms.uShiftB).value.set(moved.x, moved.y, moved.z);
    });
    this.lay(p);
    if (p.pours.every(pour => p.seconds - pour.start >= FLUID.gone)) { this.stop(); return; }
    try { this.simulate(p, from, step); } catch (error) { this.fail(error); }
  }

  /** The first particle of a stump's pour, or past every particle while the wound pours alone. */
  private split(p: NonNullable<FluidBlood["pouring"]>): number {
    return p.pours[1]?.first ?? this.width * this.height;
  }

  private simulate(p: NonNullable<FluidBlood["pouring"]>, from: number, step: number): void {
    // The particles: in steps no longer than STEP, each a draw into the other state target.
    const renderer = this.renderer, previous = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const steps = Math.max(1, Math.ceil(step / STEP)), dt = step / steps, u = this.simMaterial.uniforms;
    u.uLaunchA.value = this.launchA; u.uLaunchB.value = this.launchB; u.uTop.value = this.top; u.uSplit.value = this.split(p);
    for (let i = 0; i < steps; i += 1) {
      const read = this.state[this.current], write = this.state[1 - this.current];
      u.uPosition.value = read.textures[0]; u.uVelocity.value = read.textures[1];
      u.uTime.value = from + dt * (i + 1); u.uDt.value = dt; u.uReset.value = p.reset ? 1 : 0;
      p.reset = false;
      renderer.setRenderTarget(write);
      renderer.render(this.simScene, this.simCamera);
      this.current = 1 - this.current;
    }
    renderer.setRenderTarget(previous);
    renderer.autoClear = autoClear;
  }

  /**
   * Before the frame is drawn, with the camera as it will draw it: the particles into the depth and thickness
   * targets, both smoothed, for the surface in the scene to read.
   */
  prepare(camera: THREE.PerspectiveCamera): void {
    const p = this.pouring;
    if (!p || !this.points) { this.object.visible = false; return; }
    try { this.draw(p, camera); } catch (error) { this.fail(error); }
  }

  private draw(p: NonNullable<FluidBlood["pouring"]>, camera: THREE.PerspectiveCamera): void {
    if (!this.points) return;
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, Math.round(this.size.x * SURFACE_SCALE)), h = Math.max(2, Math.round(this.size.y * SURFACE_SCALE));
    this.ensureTargets(w, h);
    camera.updateMatrixWorld();
    // Each pour thins away on its own clock: a stump that began late runs on after the wound's blood has gone.
    const [wound, stump] = p.pours, state = this.state[this.current];
    const level = fluidLevel(p.seconds - wound.start), levelB = stump ? fluidLevel(p.seconds - stump.start) : 0;
    for (const material of [this.depthMaterial, this.thicknessMaterial]) {
      material.uniforms.uPosition.value = state.textures[0];
      material.uniforms.uLaunchB.value = this.launchB;
      material.uniforms.uProjScale.value = h * camera.projectionMatrix.elements[5];
      material.uniforms.uLevel.value = level;
      material.uniforms.uLevelB.value = levelB;
      material.uniforms.uSplit.value = this.split(p);
    }
    const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear, alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    // The nearest surface of the spheres...
    this.points.material = this.depthMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear(true, true, false);
    renderer.render(this.pointScene, camera);
    // ...how much of them there is, added up...
    this.points.material = this.thicknessMaterial;
    renderer.setRenderTarget(this.thicknessTarget);
    renderer.clear(true, false, false);
    renderer.render(this.pointScene, camera);
    // ...and both smoothed, across and then down, twice: the drops run together and the surface calms.
    const blur = this.blurMaterial.uniforms;
    blur.uRange.value = wound.burst.height * FLUID.radius * 3;
    let depth = this.depthTarget!.texture, thickness = this.thicknessTarget!.texture;
    for (let pass = 0; pass < SMOOTHING * 2; pass += 1) {
      const target = this.blurTargets[pass % 2];
      blur.uDepth.value = depth; blur.uThickness.value = thickness;
      blur.uStep.value.set(pass % 2 === 0 ? 1 : 0, pass % 2 === 0 ? 0 : 1);
      renderer.setRenderTarget(target);
      renderer.render(this.blurScene, this.simCamera);
      depth = thickness = target.texture;
    }
    renderer.setRenderTarget(previous);
    renderer.setClearColor(this.clear, alpha);
    renderer.autoClear = autoClear;
    // The surface reads the smoothed targets, lit by the scene's lamp and ambient.
    const s = this.surfaceMaterial.uniforms, light = this.light();
    s.uSurface.value = this.blurTargets[1].texture;
    s.uTexel.value.set(1 / w, 1 / h);
    s.uCliff.value = blur.uRange.value;
    s.uLightDir.value.copy(this.toLight.copy(light.direction).transformDirection(camera.matrixWorldInverse));
    s.uLightColour.value.copy(light.colour);
    s.uAmbient.value.copy(light.ambient);
    s.uGain.value = light.gain;
    this.object.visible = level > 0 || levelB > 0;
  }

  private fail(error: unknown): void {
    console.warn("[fatality] the fluid could not be drawn here; the plain sprays stand in", error);
    this.broken = true;
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = true;
    this.stop();
  }

  /** The fluid goes (a rebuilt board, the end of its run); its marks stay. */
  stop(): void {
    this.pouring = null;
    this.object.visible = false;
  }

  /** Undo: what the plies taken back left goes, and a pour of theirs stops. */
  undoTo(ply: number): void {
    if (this.pouring && this.pouring.pours[0].burst.ply > ply) this.stop();
    for (let i = this.laid.length - 1; i >= 0; i -= 1) {
      if (this.laid[i].ply <= ply) continue;
      this.sink?.remove(this.laid[i].impactId);
      this.laid.splice(i, 1);
    }
  }

  /** A new game: nothing remains (the gore system clears its own marks). */
  reset(): void {
    this.stop();
    this.laid.length = 0;
  }

  dispose(): void {
    this.reset();
    this.releaseParticles();
    for (const target of [this.depthTarget, this.thicknessTarget, ...this.blurTargets]) target?.dispose();
    this.depthTarget = this.thicknessTarget = null; this.blurTargets = [];
    for (const material of [this.simMaterial, this.depthMaterial, this.thicknessMaterial, this.blurMaterial, this.surfaceMaterial]) material.dispose();
    this.quad.dispose();
    this.object.removeFromParent();
  }

  // ---- inside

  /**
   * Each pour's stains and pool, handed to the gore system as their blood lands (on that pour's own clock), moved as
   * far as its wound had moved when their drops left it.
   */
  private lay(p: NonNullable<FluidBlood["pouring"]>): void {
    const sink = this.sink;
    if (!sink) return;
    for (const pour of p.pours) {
      const { plan, ply } = pour.burst, own = p.seconds - pour.start;
      const movedAt = (t: number) => { let best = pour.moved[0]; for (const item of pour.moved) if (item.at <= t) best = item; return best; };
      pour.marks.stains.forEach((stain, i) => {
        if (pour.laid.has(i) || own < stain.at) return;
        pour.laid.add(i);
        const moved = movedAt(stain.born);
        sink.stain(plan, { ...stain, x: stain.x + moved.x, z: stain.z + moved.z });
        this.file(ply, plan.impactId);
      });
      const pool = pour.marks.pool;
      if (pool && !pour.pooled && own >= pool.at) {
        pour.pooled = true;
        const moved = movedAt(pool.born);
        sink.pool(plan, { ...pool, x: pool.x + moved.x, z: pool.z + moved.z }, { x: pool.x + moved.x, z: pool.z + moved.z });
        this.file(ply, plan.impactId);
      }
    }
  }

  private file(ply: number, impactId: string): void {
    if (!this.laid.some(entry => entry.impactId === impactId)) this.laid.push({ ply, impactId });
  }

  private ensureTargets(w: number, h: number): void {
    if (this.depthTarget && this.depthTarget.width === w && this.depthTarget.height === h) return;
    for (const target of [this.depthTarget, this.thicknessTarget, ...this.blurTargets]) target?.dispose();
    // Filtered (the surface reads its thickness smoothly); every depth is read by whole texels.
    const make = (depth: boolean) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, generateMipmaps: false });
    this.depthTarget = make(true);
    this.thicknessTarget = make(false);
    this.blurTargets = [make(false), make(false)];
  }

  private releaseParticles(): void {
    this.launchA?.dispose(); this.launchB?.dispose(); this.launchA = this.launchB = null;
    for (const target of this.state) target.dispose();
    this.state = [];
    if (this.points) { this.points.geometry.dispose(); this.points.removeFromParent(); this.points = null; }
    this.capacity = 0;
  }
}
