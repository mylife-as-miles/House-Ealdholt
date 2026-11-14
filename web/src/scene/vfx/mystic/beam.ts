/**
 * A thread of light between two points: a core, strands wound round it, rune rings travelling along it and motes
 * drawn down it. mystic/beamPlan.ts holds the arithmetic and its tests; the shaders here evaluate the same curve.
 *
 * Nothing is rebuilt per frame. The geometry is cut once along the parameter `u` (0 at the hand, 1 at the target)
 * and the vertex shaders place it on the curve from three points and a clock, so a beam whose ends move (a hand
 * that sways, a body that settles) costs a handful of uniforms.
 */
import * as THREE from "three";
import type { BeamBudget, Point } from "./beamPlan";
import { beamControl } from "./beamPlan";

/** The colours of a beam: its white-hot heart, the colour around it, and the motes it sheds. */
export interface BeamLook { core: number; glow: number; ember: number }

const CURVE = /* glsl */ `
uniform vec3 uFrom, uControl, uTo;
uniform float uTime, uReach, uPower, uFlow, uRadius, uTurns, uSpin, uFar;
// Everything round the core is drawn larger toward the hand: a cast from across the arena starts several times
// further from the eye than it lands, and would otherwise dwindle to nothing before it arrives.
float farScale(float u) { return mix(uFar, 1.0, smoothstep(0.0, 1.0, u)); }
vec3 curve(float u) { float a = 1.0 - u; return a * a * uFrom + 2.0 * a * u * uControl + u * u * uTo; }
vec3 curveTangent(float u) { return normalize(2.0 * (1.0 - u) * (uControl - uFrom) + 2.0 * u * (uTo - uControl)); }
// Two directions square to the curve at u.
void curveFrame(float u, out vec3 n, out vec3 b) {
  vec3 t = curveTangent(u);
  vec3 ref = abs(t.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  n = normalize(cross(t, ref)); b = cross(t, n);
}
// A strand stands off the core by a radius that is nothing at either end (beamPlan.strandRadius, strandAngle).
vec3 onStrand(float u, float strand, float phase) {
  vec3 p = curve(u);
  if (strand < 0.5) return p;
  vec3 n, b; curveFrame(u, n, b);
  float angle = phase + u * uTurns * 6.2831853 + uTime * uSpin;
  float r = uRadius * farScale(u) * sqrt(max(0.0, sin(3.14159265 * u))) * (1.0 + 0.22 * sin(uTime * 1.7 + phase * 3.0));
  return p + (n * cos(angle) + b * sin(angle)) * r;
}
`;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * A ring of script drawn from nothing but the pixel's place in the quad: two rims with ticks between them, an inner
 * rim, and a band of angular marks whose strokes are switched by a hash. The marks are abstract by construction;
 * they belong to no alphabet.
 */
export const RUNE_RING = /* glsl */ `
float runeBand(float r, float at, float width) { return smoothstep(width, 0.0, abs(r - at)); }
float runeRing(vec2 uv, float seed) {
  vec2 p = uv * 2.0 - 1.0;
  float r = length(p), a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float rims = runeBand(r, 0.955, 0.014) + runeBand(r, 0.865, 0.010) + runeBand(r, 0.56, 0.010);
  float ticks = step(0.875, r) * step(r, 0.945) * smoothstep(0.34, 0.5, abs(fract(a * 60.0) - 0.5) * 2.0 - 0.5);
  // the band of marks: twenty cells round the ring, each a 3 by 4 grid of strokes
  float cell = a * 20.0, across = (r - 0.615) / 0.215;
  float inside = step(0.0, across) * step(across, 1.0) * step(0.14, fract(cell)) * step(fract(cell), 0.86);
  vec2 grid = vec2((fract(cell) - 0.14) / 0.72 * 3.0, across * 4.0);
  vec2 id = floor(grid), f = fract(grid);
  float pick = hash(vec2(floor(cell) * 7.31 + id.x * 1.7 + seed * 13.1, id.y * 3.3 + seed));
  float upright = smoothstep(0.26, 0.10, abs(f.x - 0.5)) * step(0.08, f.y) * step(f.y, 0.92);
  float level = smoothstep(0.30, 0.12, abs(f.y - 0.5)) * step(0.06, f.x) * step(f.x, 0.94);
  float marks = inside * (pick > 0.62 ? upright : pick > 0.30 ? level : 0.0);
  return clamp(rims + ticks * 0.8 + marks, 0.0, 1.0) * step(r, 1.0);
}
`;

const RIBBON_VERTEX = /* glsl */ `
${CURVE}
attribute float aU, aSide, aKind, aPhase;
uniform float uWidth, uPixel, uMinPixels, uSoul;
varying float vU, vSide, vKind, vPhase;
void main() {
  vU = aU; vSide = aSide; vKind = aKind; vPhase = aPhase;
  // kind 0 is the core, 1 a strand wound round it, 2 the soft light around the core
  float strand = abs(aKind - 1.0) < 0.5 ? 1.0 : 0.0;
  vec4 here = modelViewMatrix * vec4(onStrand(aU, strand, aPhase), 1.0);
  vec3 before = (modelViewMatrix * vec4(onStrand(clamp(aU - 0.012, 0.0, 1.0), strand, aPhase), 1.0)).xyz;
  vec3 after = (modelViewMatrix * vec4(onStrand(clamp(aU + 0.012, 0.0, 1.0), strand, aPhase), 1.0)).xyz;
  // widened square to both the thread and the line of sight, so it always faces the eye
  vec3 square = cross(normalize(after - before), normalize(here.xyz));
  vec3 side = dot(square, square) > 1e-8 ? normalize(square) : vec3(1.0, 0.0, 0.0);
  bool core = aKind < 0.5, aura = aKind > 1.5;
  // it thickens along its length and flares where it lands
  float swell = 0.6 + 0.4 * sin(3.14159265 * aU) + 1.1 * smoothstep(0.82, 1.0, aU);
  float fromHead = (aU - uReach) / 0.05;
  float head = exp(-fromHead * fromHead) * step(uReach, 0.999);
  float fromSoul = (aU - uSoul) / 0.035;
  float soul = uSoul >= 0.0 ? exp(-fromSoul * fromSoul) : 0.0;
  float width = uWidth * swell * (core ? 1.0 + 1.6 * head + 2.4 * soul : aura ? 7.0 * (1.0 + 0.8 * head + 1.4 * soul) : 0.34);
  // never thinner than a pixel or so, or a cast from across the arena is lost before it arrives
  width = max(width * uPower, uPixel * uMinPixels * -here.z * (core ? 1.0 : aura ? 5.0 : 0.6));
  here.xyz += side * aSide * width;
  gl_Position = projectionMatrix * here;
}
`;

const RIBBON_FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uCoreColour, uGlowColour, uSoulColour;
uniform float uTime, uReach, uPower, uFlow, uGain, uSoul;
varying float vU, vSide, vKind, vPhase;
void main() {
  float across = 1.0 - abs(vSide);
  float hot = pow(across, 5.0), soft = pow(across, 1.5);
  // light running down the thread: a fine grain, and slower surges over it
  float run = vU * 26.0 - uTime * 3.2 * uFlow + vPhase * 5.0;
  float energy = mix(0.5 + 0.5 * noise(vec2(run, vPhase * 9.0 + vSide * 0.6)), 1.0, 0.35) + 0.6 * pow(noise(vec2(run * 0.33, 4.0 + vPhase)), 3.0);
  float lit = 1.0 - smoothstep(uReach * 1.03 - 0.012, uReach * 1.03 + 0.012, vU);
  float fromHead = (vU - uReach) / 0.05;
  float head = exp(-fromHead * fromHead) * step(uReach, 0.999);
  float fromSoul = (vU - uSoul) / 0.035;
  float soul = uSoul >= 0.0 ? exp(-fromSoul * fromSoul) : 0.0;
  bool core = vKind < 0.5, aura = vKind > 1.5;
  vec3 colour;
  if (aura) {
    // no hard edge anywhere: it is the air the thread lights
    float haze = pow(across, 2.6) * (0.75 + 0.25 * noise(vec2(run * 0.2, 2.0)));
    colour = uGlowColour * haze * 0.20 + uGlowColour * head * haze * 0.9 + uSoulColour * soul * haze * 0.9;
  } else {
    colour = mix(uGlowColour, uCoreColour, hot) * (soft * 0.5 + hot * 1.3) * energy * (core ? 1.0 : 0.55);
    colour += uCoreColour * head * soft * 2.2;
    colour += uSoulColour * soul * (soft * 1.5 + hot * 2.5);
  }
  float alpha = (lit + head) * smoothstep(0.0, 0.03, vU) * uPower;
  gl_FragColor = vec4(colour * alpha * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_VERTEX = /* glsl */ `
${CURVE}
attribute float aIndex;
attribute vec2 aCorner;
uniform float uRingCount, uRingSpeed, uRingSize;
varying vec2 vUv;
varying float vFade, vSeed;
void main() {
  // beamPlan.ringPosition, ringTravel, ringScale, ringFade, farScale
  float phase = fract(aIndex / uRingCount + uTime * uRingSpeed * uFlow);
  // they slow as they come down on the target, so they gather over it
  float u = 1.0 - (1.0 - phase) * (1.0 - phase);
  vec3 n, b; curveFrame(u, n, b);
  float turn = uTime * (0.6 + 0.35 * aIndex) * (mod(aIndex, 2.0) < 0.5 ? 1.0 : -1.0);
  vec2 corner = vec2(aCorner.x * cos(turn) - aCorner.y * sin(turn), aCorner.x * sin(turn) + aCorner.y * cos(turn));
  float size = uRingSize * farScale(u) * (0.55 + 0.45 * sin(3.14159265 * u));
  vUv = aCorner * 0.5 + 0.5; vSeed = aIndex;
  vFade = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.86, 1.0, u)) * (1.0 - smoothstep(uReach * 1.03 - 0.02, uReach * 1.03 + 0.02, u)) * uPower;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(curve(u) + (n * corner.x + b * corner.y) * size, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
${NOISE}
${RUNE_RING}
uniform vec3 uCoreColour, uGlowColour;
uniform float uGain;
varying vec2 vUv;
varying float vFade, vSeed;
void main() {
  float ink = runeRing(vUv, vSeed);
  if (ink * vFade < 0.004) discard;
  gl_FragColor = vec4(mix(uGlowColour, uCoreColour, 0.45) * ink * vFade * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOTE_VERTEX = /* glsl */ `
${CURVE}
attribute vec4 aSeed;
uniform float uMoteSize, uScale;
varying float vAlpha, vWarm;
void main() {
  float phase = fract(aSeed.x + uTime * (0.22 + 0.5 * aSeed.w));
  float u = uFlow > 0.0 ? phase : 1.0 - phase;
  vec3 n, b; curveFrame(u, n, b);
  float angle = aSeed.z * 6.2831853 + uTime * (0.6 + aSeed.w) + u * 5.0;
  float r = uRadius * farScale(u) * (0.3 + 1.9 * aSeed.y) * sqrt(max(0.0, sin(3.14159265 * u)));
  vec4 here = modelViewMatrix * vec4(curve(u) + (n * cos(angle) + b * sin(angle)) * r, 1.0);
  float life = smoothstep(0.0, 0.1, phase) * (1.0 - smoothstep(0.82, 1.0, phase));
  float twinkle = 0.55 + 0.45 * sin(uTime * (5.0 + 9.0 * aSeed.y) + aSeed.x * 40.0);
  vAlpha = life * twinkle * (1.0 - smoothstep(uReach * 1.03 - 0.02, uReach * 1.03 + 0.02, u)) * uPower;
  vWarm = aSeed.y;
  gl_PointSize = max(1.5, uMoteSize * farScale(u) * (0.5 + aSeed.w) * uScale / -here.z);
  gl_Position = projectionMatrix * here;
}
`;

const MOTE_FRAGMENT = /* glsl */ `
uniform vec3 uCoreColour, uEmberColour;
uniform float uGain;
varying float vAlpha, vWarm;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float body = smoothstep(1.0, 0.0, d);
  if (body * vAlpha < 0.004) discard;
  gl_FragColor = vec4(mix(uEmberColour, uCoreColour, pow(body, 3.0) * (0.5 + 0.5 * vWarm)) * body * vAlpha * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SOUL_VERTEX = /* glsl */ `
${CURVE}
uniform float uSoul, uScale;
void main() {
  float u = clamp(uSoul, 0.0, 1.0);
  vec4 here = modelViewMatrix * vec4(curve(u), 1.0);
  gl_PointSize = uSoul >= 0.0 ? max(6.0, 0.36 * farScale(u) * uScale / -here.z) : 0.0;
  gl_Position = projectionMatrix * here;
}
`;

const SOUL_FRAGMENT = /* glsl */ `
uniform vec3 uCoreColour, uSoulColour;
uniform float uTime, uSoul, uGain;
void main() {
  if (uSoul < 0.0) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  // a hard bright heart, a soft body round it, and four thin rays turning slowly
  float heart = exp(-d * d * 26.0), body = exp(-d * d * 5.0) * 0.55;
  float rays = pow(abs(cos((atan(p.y, p.x) + uTime * 0.6) * 2.0)), 24.0) * exp(-d * 3.2) * 0.9;
  float edge = smoothstep(1.0, 0.7, d);
  if ((heart + body + rays) * edge < 0.004) discard;
  gl_FragColor = vec4((uCoreColour * heart * 1.6 + uSoulColour * (body + rays)) * edge * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A seeded 0..1 sequence, so a beam's motes are the same on every machine and in every capture. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface BeamOptions {
  budget: BeamBudget;
  look: BeamLook;
  /** Half the core's width at its thickest, in scene units. */
  width?: number;
  /** How far the strands and motes stand off the core. */
  radius?: number;
  /** The radius of a rune ring at its widest. */
  ringSize?: number;
  /** Times the strands wind round the core over its length. */
  turns?: number;
  /** How much larger the strands, rings and motes are drawn at the hand than at the target: 1 for a cast between two figures on the board, 4 or so from across the arena. */
  far?: number;
  seed?: number;
}

export class MysticBeam {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3(0, 0, 1);
  private bow = 0.04;
  private readonly sway = new THREE.Vector3();

  constructor(options: BeamOptions) {
    const { budget, look } = options;
    this.uniforms = {
      uFrom: { value: new THREE.Vector3() }, uControl: { value: new THREE.Vector3() }, uTo: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uReach: { value: 1 }, uPower: { value: 1 }, uFlow: { value: 1 }, uSoul: { value: -1 },
      uRadius: { value: options.radius ?? 0.12 }, uTurns: { value: options.turns ?? 3 }, uSpin: { value: 1.4 }, uFar: { value: options.far ?? 1 },
      uWidth: { value: options.width ?? 0.035 }, uPixel: { value: 0.001 }, uMinPixels: { value: 1.1 }, uScale: { value: 600 },
      uRingCount: { value: Math.max(1, budget.rings) }, uRingSpeed: { value: 0.16 }, uRingSize: { value: options.ringSize ?? 0.3 },
      uMoteSize: { value: 0.05 }, uGain: { value: 1 },
      uCoreColour: { value: new THREE.Color(look.core) }, uGlowColour: { value: new THREE.Color(look.glow) },
      uEmberColour: { value: new THREE.Color(look.ember) }, uSoulColour: { value: new THREE.Color(look.core) },
    };
    const material = (vertexShader: string, fragmentShader: string) => {
      const made = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.materials.push(made);
      return made;
    };
    const add = (node: THREE.Object3D, order: number) => { node.frustumCulled = false; node.renderOrder = order; this.object.add(node); };

    // the light around the core, the core, and its strands: one strip each, cut along u. The haze is first so the
    // core is drawn over it.
    const kinds = [2, 0, ...Array.from({ length: budget.strands }, () => 1)];
    const ribbons = kinds.length, across = budget.segments + 1;
    const u = new Float32Array(ribbons * across * 2), side = new Float32Array(ribbons * across * 2);
    const kind = new Float32Array(ribbons * across * 2), phase = new Float32Array(ribbons * across * 2);
    const index: number[] = [];
    for (let r = 0; r < ribbons; r += 1) for (let i = 0; i < across; i += 1) for (let s = 0; s < 2; s += 1) {
      const at = (r * across + i) * 2 + s;
      u[at] = i / budget.segments; side[at] = s === 0 ? -1 : 1; kind[at] = kinds[r];
      phase[at] = kinds[r] === 1 ? ((r - 2) / Math.max(1, budget.strands)) * Math.PI * 2 : 0;
      if (s === 0 && i < budget.segments) { const a = (r * across + i) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute("aU", new THREE.BufferAttribute(u, 1)); ribbon.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    ribbon.setAttribute("aKind", new THREE.BufferAttribute(kind, 1)); ribbon.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    // three.js wants a position to count vertices by; the shader places them
    ribbon.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ribbons * across * 2 * 3), 3));
    ribbon.setIndex(index);
    this.geometries.push(ribbon);
    add(new THREE.Mesh(ribbon, material(RIBBON_VERTEX, RIBBON_FRAGMENT)), 12);

    if (budget.rings > 0) {
      const ringIndex = new Float32Array(budget.rings * 4), corner = new Float32Array(budget.rings * 8), faces: number[] = [];
      for (let r = 0; r < budget.rings; r += 1) {
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], c) => { ringIndex[r * 4 + c] = r; corner[(r * 4 + c) * 2] = x; corner[(r * 4 + c) * 2 + 1] = y; });
        faces.push(r * 4, r * 4 + 1, r * 4 + 2, r * 4, r * 4 + 2, r * 4 + 3);
      }
      const rings = new THREE.BufferGeometry();
      rings.setAttribute("aIndex", new THREE.BufferAttribute(ringIndex, 1)); rings.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
      rings.setAttribute("position", new THREE.BufferAttribute(new Float32Array(budget.rings * 12), 3));
      rings.setIndex(faces);
      this.geometries.push(rings);
      add(new THREE.Mesh(rings, material(RING_VERTEX, RING_FRAGMENT)), 11);
    }

    if (budget.motes > 0) {
      const random = sequence(options.seed ?? 0x51f15e);
      const seeds = new Float32Array(budget.motes * 4);
      for (let i = 0; i < seeds.length; i += 1) seeds[i] = random();
      const motes = new THREE.BufferGeometry();
      motes.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
      motes.setAttribute("position", new THREE.BufferAttribute(new Float32Array(budget.motes * 3), 3));
      this.geometries.push(motes);
      add(new THREE.Points(motes, material(MOTE_VERTEX, MOTE_FRAGMENT)), 13);
    }
    // the knot of light that can travel the thread: one point, placed by the shader
    const soul = new THREE.BufferGeometry();
    soul.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    this.geometries.push(soul);
    add(new THREE.Points(soul, material(SOUL_VERTEX, SOUL_FRAGMENT)), 15);
    this.place();
  }

  /** Where it is cast from and where it lands. `bow` drops its middle by that fraction of its length. */
  setEnds(from: Point, to: Point, bow = this.bow): void {
    this.from.set(from.x, from.y, from.z); this.to.set(to.x, to.y, to.z); this.bow = bow;
    this.place();
  }
  /** Pushes the middle of the thread sideways, in scene units: what a slow wind does to it. */
  setSway(x: number, y: number, z: number): void { this.sway.set(x, y, z); this.place(); }
  /** How far it has reached, 0 at the hand to 1 at the target. */
  setReach(reach: number): void { this.uniforms.uReach.value = reach; }
  /** Its strength, 0..1: brightness and width together. */
  setPower(power: number): void { this.uniforms.uPower.value = power; this.object.visible = power > 0.002; }
  /** Which way the light runs: 1 from the hand to the target, -1 back up to the hand. */
  setFlow(direction: 1 | -1): void { this.uniforms.uFlow.value = direction; }
  /** A brighter knot of light travelling the thread at `u`, in `colour`; null puts it out. */
  setSoul(u: number | null, colour?: number): void {
    this.uniforms.uSoul.value = u ?? -1;
    if (colour !== undefined) (this.uniforms.uSoulColour.value as THREE.Color).setHex(colour);
  }
  setLook(look: BeamLook): void {
    (this.uniforms.uCoreColour.value as THREE.Color).setHex(look.core); (this.uniforms.uGlowColour.value as THREE.Color).setHex(look.glow);
    (this.uniforms.uEmberColour.value as THREE.Color).setHex(look.ember);
  }
  /** `gain` keeps its colour from clipping to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }
  /** The point at `u` on the thread, in scene space. */
  pointAt(u: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u, control = this.uniforms.uControl.value as THREE.Vector3;
    return out.set(a * this.from.x + b * control.x + c * this.to.x, a * this.from.y + b * control.y + c * this.to.y, a * this.from.z + b * control.z + c * this.to.z);
  }

  /** Starts it again from its first moment, for another cast (a pooled claim): its clock, and how much larger it is drawn at the hand. */
  restart(far: number): void {
    this.uniforms.uTime.value = 0; this.uniforms.uFar.value = far;
    this.sway.set(0, 0, 0);
    this.place();
  }

  /** Advances its clock and fits it to the camera drawing it: `height` is the drawing buffer's height in pixels. */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uTime.value += seconds;
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.uniforms.uPixel.value = span / Math.max(1, height);
    this.uniforms.uScale.value = Math.max(1, height) / span;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const made of this.materials) made.dispose();
  }

  private place(): void {
    (this.uniforms.uFrom.value as THREE.Vector3).copy(this.from); (this.uniforms.uTo.value as THREE.Vector3).copy(this.to);
    const control = beamControl(this.from, this.to, this.bow, this.sway);
    (this.uniforms.uControl.value as THREE.Vector3).set(control.x, control.y, control.z);
  }
}
