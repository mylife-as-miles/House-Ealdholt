/**
 * Where a thread of light comes down: a sigil that draws itself on the stone, a soft shaft of light standing over
 * the spot, motes rising off it, and the sparks and the ring thrown out when the thread first touches.
 *
 * Like the beam (mystic/beam.ts) it is placed and animated by uniforms alone: one spot, one clock, a few envelopes.
 */
import * as THREE from "three";
import type { BeamBudget, Point } from "./beamPlan";
import type { BeamLook } from "./beam";
import { RUNE_RING } from "./beam";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** The quad the sigil is drawn on reaches this many sigil radii out, so the ring thrown at contact has room to run. */
const REACH = 2.6;

const SIGIL_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius;
varying vec2 vPlace;
void main() {
  // position.xy is -1..1 across the quad; vPlace is in sigil radii from its centre
  vPlace = position.xy * ${REACH.toFixed(1)};
  vec3 at = uCentre + vec3(position.x, 0.0, position.y) * uRadius * ${REACH.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const SIGIL_FRAGMENT = /* glsl */ `
${NOISE}
${RUNE_RING}
uniform vec3 uCoreColour, uGlowColour;
uniform float uTime, uDraw, uGlow, uBurst, uGain;
varying vec2 vPlace;
vec2 turned(vec2 p, float angle) { float c = cos(angle), s = sin(angle); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
void main() {
  float r = length(vPlace);
  // two rings of script turning against each other, the inner one a little over half the size
  float outer = runeRing(turned(vPlace, uTime * 0.25) * 0.5 + 0.5, 3.0);
  float inner = runeRing(turned(vPlace, -uTime * 0.4) / 0.58 * 0.5 + 0.5, 11.0);
  // drawn round from one point, as by a pen: the angle already passed is inked, and the pen's tip is bright.
  // The tip is a nib of light on the outer rim, and the strokes it has just laid are still hot behind it. (It
  // was a band across the whole ring, hard-edged at half the radius and at the rim: from the match camera a
  // white card sweeping round the body.)
  float angle = atan(vPlace.y, vPlace.x) / 6.2831853 + 0.5;
  float inked = uDraw >= 1.0 ? 1.0 : 1.0 - smoothstep(uDraw - 0.02, uDraw + 0.005, angle);
  float behind = uDraw - angle, along = behind / 0.012, across = (r - 0.91) / 0.06;
  float pen = uDraw < 1.0 ? exp(-along * along - across * across) : 0.0;
  float fresh = uDraw < 1.0 ? step(0.0, behind) * exp(-max(behind, 0.0) / 0.06) : 0.0;
  float ink = (outer + inner * 0.8) * inked * (1.0 + 1.2 * fresh);
  // the stone under it takes the light
  float pool = exp(-r * r * 2.4) * 0.30 * uGlow;
  // the ring thrown out when the thread touches down
  float thrown = uBurst >= 0.0 && uBurst < 0.7 ? smoothstep(0.09, 0.0, abs(r - uBurst * 3.4)) * pow(1.0 - uBurst / 0.7, 1.5) : 0.0;
  float flicker = 0.85 + 0.15 * noise(vec2(uTime * 3.0, angle * 40.0));
  vec3 colour = mix(uGlowColour, uCoreColour, 0.35) * ink * (0.3 + 0.9 * uGlow) * flicker + uCoreColour * pen * 1.6 + uGlowColour * pool + uCoreColour * thrown * 1.4;
  float edge = 1.0 - smoothstep(${(REACH - 0.25).toFixed(2)}, ${REACH.toFixed(2)}, r);
  if (max(max(colour.r, colour.g), colour.b) * edge < 0.003) discard;
  gl_FragColor = vec4(colour * edge * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SHAFT_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius, uHeight;
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  // a unit cylinder, base at the stone: it narrows a little as it rises
  float taper = mix(1.0, 0.62, uv.y);
  vec3 at = uCentre + vec3(position.x * uRadius * 0.5 * taper, position.y * uHeight, position.z * uRadius * 0.5 * taper);
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * vec3(normal.x, 0.0, normal.z)), normalize(-here.xyz)));
  gl_Position = projectionMatrix * here;
}
`;

const SHAFT_FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uCoreColour, uGlowColour;
uniform float uTime, uShaft, uGain;
varying vec2 vUv;
varying float vFacing;
void main() {
  // light running up it in streaks, thinning with height
  // long thin streaks: fine across the shaft, drawn out along it
  float streaks = noise(vec2(vUv.x * 30.0, vUv.y * 1.5 - uTime * 1.4)) * 0.65 + noise(vec2(vUv.x * 64.0, vUv.y * 3.2 - uTime * 2.6)) * 0.35;
  float body = pow(1.0 - vUv.y, 1.5) * smoothstep(0.0, 0.04, vUv.y);
  // no outline: the shaft is air that is lit, thickest where the eye looks through its middle
  float alpha = body * (0.3 + 0.7 * streaks) * pow(vFacing, 1.6) * uShaft;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(mix(uGlowColour, uCoreColour, streaks * streaks * 0.7) * alpha * 0.55 * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RISE_VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCentre;
uniform float uTime, uRise, uRadius, uHeight, uScale;
varying float vAlpha, vWarm;
void main() {
  float phase = fract(aSeed.x + uTime * (0.22 + 0.32 * aSeed.w));
  // each leaves the stone inside the sigil, winds inward as it climbs, and is gone before the top of the shaft
  float angle = aSeed.z * 6.2831853 + uTime * (1.0 + aSeed.w) + phase * 5.0;
  float r = uRadius * 0.62 * sqrt(aSeed.y) * (1.0 - 0.7 * phase);
  vec4 here = modelViewMatrix * vec4(uCentre + vec3(cos(angle) * r, pow(phase, 0.85) * uHeight * 0.85, sin(angle) * r), 1.0);
  vAlpha = sin(3.14159265 * phase) * uRise * (0.6 + 0.4 * sin(uTime * (6.0 + 8.0 * aSeed.y) + aSeed.x * 50.0));
  vWarm = aSeed.y;
  gl_PointSize = max(1.5, (0.03 + 0.045 * aSeed.w) * uScale / -here.z);
  gl_Position = projectionMatrix * here;
}
`;

const SPARK_VERTEX = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aAway;
uniform vec3 uCentre;
uniform float uBurst, uScale;
varying float vAlpha, vWarm;
void main() {
  float life = 0.55 + 0.7 * aSeed.x, t = uBurst;
  // thrown up and out against the air, and falling back
  float drag = 2.4, travel = (1.0 - exp(-drag * t)) / drag;
  vec3 at = uCentre + vec3(0.0, 0.12, 0.0) + aAway * (2.2 + 3.6 * aSeed.w) * travel + vec3(0.0, -5.2, 0.0) * 0.5 * t * t;
  at.y = max(at.y, uCentre.y + 0.015);
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  vAlpha = t >= 0.0 && t < life ? pow(1.0 - t / life, 1.4) : 0.0;
  vWarm = aSeed.y;
  gl_PointSize = max(1.5, (0.025 + 0.04 * aSeed.z) * uScale / -here.z);
  gl_Position = projectionMatrix * here;
}
`;

const POINT_FRAGMENT = /* glsl */ `
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

function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface LandingOptions {
  budget: BeamBudget;
  look: BeamLook;
  /** The sigil's radius on the stone. */
  radius?: number;
  /** How tall the shaft of light stands. */
  height?: number;
  seed?: number;
}

export class MysticLanding {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly shaft: THREE.Mesh;

  constructor(options: LandingOptions) {
    const { budget, look } = options;
    this.uniforms = {
      uCentre: { value: new THREE.Vector3() }, uRadius: { value: options.radius ?? 0.62 }, uHeight: { value: options.height ?? 2.4 },
      uTime: { value: 0 }, uDraw: { value: 0 }, uGlow: { value: 0 }, uShaft: { value: 0 }, uRise: { value: 0 }, uBurst: { value: -1 },
      uScale: { value: 600 }, uGain: { value: 1 },
      uCoreColour: { value: new THREE.Color(look.core) }, uGlowColour: { value: new THREE.Color(look.glow) }, uEmberColour: { value: new THREE.Color(look.ember) },
    };
    const material = (vertexShader: string, fragmentShader: string) => {
      const made = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.materials.push(made);
      return made;
    };
    const add = <T extends THREE.Object3D>(node: T, order: number) => { node.frustumCulled = false; node.renderOrder = order; this.object.add(node); return node; };
    const keep = <T extends THREE.BufferGeometry>(geometry: T) => { this.geometries.push(geometry); return geometry; };

    add(new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2)), material(SIGIL_VERTEX, SIGIL_FRAGMENT)), 9);
    // a unit cylinder standing on its base, open at both ends
    this.shaft = add(new THREE.Mesh(keep(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0)), material(SHAFT_VERTEX, SHAFT_FRAGMENT)), 10);

    const random = sequence(options.seed ?? 0x1a2d1);
    const rising = Math.max(8, Math.round(budget.motes * 0.6));
    const riseSeeds = new Float32Array(rising * 4);
    for (let i = 0; i < riseSeeds.length; i += 1) riseSeeds[i] = random();
    const rise = keep(new THREE.BufferGeometry());
    rise.setAttribute("aSeed", new THREE.BufferAttribute(riseSeeds, 4)); rise.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rising * 3), 3));
    add(new THREE.Points(rise, material(RISE_VERTEX, POINT_FRAGMENT)), 13);

    const sparkSeeds = new Float32Array(budget.sparks * 4), away = new Float32Array(budget.sparks * 3);
    for (let i = 0; i < budget.sparks; i += 1) {
      for (let k = 0; k < 4; k += 1) sparkSeeds[i * 4 + k] = random();
      // thrown out low across the stone more than straight up
      const turn = random() * Math.PI * 2, lift = 0.15 + 0.75 * random() * random();
      const flat = Math.sqrt(1 - lift * lift);
      away[i * 3] = Math.cos(turn) * flat; away[i * 3 + 1] = lift; away[i * 3 + 2] = Math.sin(turn) * flat;
    }
    const sparks = keep(new THREE.BufferGeometry());
    sparks.setAttribute("aSeed", new THREE.BufferAttribute(sparkSeeds, 4)); sparks.setAttribute("aAway", new THREE.BufferAttribute(away, 3));
    sparks.setAttribute("position", new THREE.BufferAttribute(new Float32Array(budget.sparks * 3), 3));
    add(new THREE.Points(sparks, material(SPARK_VERTEX, POINT_FRAGMENT)), 14);
  }

  /** The spot on the stone it is drawn round. */
  setCentre(point: Point, lift = 0.012): void { (this.uniforms.uCentre.value as THREE.Vector3).set(point.x, point.y + lift, point.z); }
  /** How much of the sigil the pen has drawn (0..1), and how brightly it and the stone under it glow (0..1). */
  setSigil(drawn: number, glow: number): void { this.uniforms.uDraw.value = drawn; this.uniforms.uGlow.value = glow; }
  /** The shaft of light standing over the spot, 0..1. */
  setShaft(power: number): void { this.uniforms.uShaft.value = power; this.shaft.visible = power > 0.002; }
  /** The motes rising off the spot, 0..1. */
  setRise(power: number): void { this.uniforms.uRise.value = power; }
  /** Seconds since the thread touched down: the sparks and the ring thrown out. Negative puts them away. */
  setBurst(seconds: number): void { this.uniforms.uBurst.value = seconds; }
  setLook(look: BeamLook): void {
    (this.uniforms.uCoreColour.value as THREE.Color).setHex(look.core); (this.uniforms.uGlowColour.value as THREE.Color).setHex(look.glow);
    (this.uniforms.uEmberColour.value as THREE.Color).setHex(look.ember);
  }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  /** Starts it again from its first moment, for another claim (a pooled one), round `centre`. */
  restart(centre: Point, radius?: number): void {
    this.uniforms.uTime.value = 0;
    if (radius !== undefined) this.uniforms.uRadius.value = radius;
    this.setCentre(centre);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uTime.value += seconds;
    this.uniforms.uScale.value = Math.max(1, height) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const made of this.materials) made.dispose();
  }
}
