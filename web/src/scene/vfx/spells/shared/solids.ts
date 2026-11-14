// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Solid matter a spell raises out of the stone and breaks: ice spikes and the pieces they shatter into, or grit
 * thrown hot off a scorched square. shared/solidPlan.ts holds the arithmetic and its tests; the vertex shader here
 * evaluates the same rise and the same flight.
 *
 * It is the lit, occluding layer a spell's light is sized against: a standard material, so it takes the scene's
 * own lamps, its environment and its fog, writes depth, and is tone-mapped with everything else. On top of that
 * it glows from within, through the gain, so it still reads where there is no bloom.
 *
 * From the reference's ice material: the idea of patching a standard material so the crystals belong to the
 * scene's light, a heart that darkens where the eye looks deepest in, crack planes fixed in the world, frost at
 * the foot, and a flash at birth. Ours: every spike and piece is placed in the vertex shader from a few numbers
 * written once (the reference rebuilds each matrix each frame on the CPU); the inside is a refracted look into a
 * broken mirror, so its glints move with the camera; the cracks light up under strain before a spike goes; a
 * spike ends by being broken away from its tip downward or by sinking, never by fading; nothing is drawn under
 * the board; and a second look (`cinder`) makes the same pieces hot stone that cools.
 */
import * as THREE from "three";
import { BLOOD_ON_BLADE } from "./blood";
import { CHUNK_FLIGHT, packSolids, type Solid } from "./solidPlan";

/** The colours of a solid: its dark heart, its body, its pale edge, and the light inside it. */
export interface SolidLook { deep: number; body: number; rim: number; glow: number }

export interface SolidFieldOptions {
  solids: readonly Solid[];
  /** The most the field may hold: the tier's budget. Put what matters first. */
  capacity: number;
  /** Cuts to share the solids between (solidPlan.crystalGeometry, chunkGeometry): one draw each. */
  shapes: readonly Float32Array[];
  look: SolidLook;
  /** `ice` is clear and cold; `cinder` is dark stone whose cracks are hot when it is thrown and cool as it lies. */
  matter: "ice" | "cinder";
  /** The height of the stone. Nothing is drawn under it. */
  floor: number;
  /** How far a rising spike overshoots its height: 0 in the brief form. */
  bounce: number;
  /** True breaks a spike away from its tip downward; false lets it sink back into the stone. */
  crumble: boolean;
  /** Seconds before it breaks that a spike's cracks begin to light: 0 for none. */
  creak: number;
  renderOrder?: number;
}

const PARS_VERTEX = /* glsl */ `
attribute vec3 aRoot, aSize, aFling;
attribute vec4 aLean, aLife;
attribute vec2 aBlood;
uniform float uSolidTime, uSolidFloor, uSolidBounce, uSolidCrumble, uSolidCreak, uSolidCool;
varying vec3 vSolidLocal, vSolidWorld;
varying vec2 vSolidBlood;
// seed, the heat it was born with, the strain on it, and the height above which it has broken away (2 whole, 3 a loose piece)
varying vec4 vSolidData;
float solidHidden;
// solidPlan.emergence: the step response of a sprung mass
float solidEmergence(float age, float rise) {
  if (age <= 0.0) return 0.0;
  float s = age / max(rise, 0.02);
  if (uSolidBounce < 0.005) return smoothstep(0.0, 1.0, s);
  float damping = -log(uSolidBounce) * 3.6 / 3.14159265;
  return 1.0 - exp(-damping * s) * (cos(3.6 * s) + (damping / 3.6) * sin(3.6 * s));
}
vec3 solidTurn(vec3 v, vec3 axis, float angle) { float c = cos(angle), s = sin(angle); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
vec3 solidPlace(vec3 p) {
  float age = uSolidTime - aLife.x, seed = aLean.w;
  solidHidden = age <= 0.0 ? 1.0 : 0.0;
  vSolidLocal = p;
  vSolidBlood = aBlood;
  if (aSize.z < 0.5) {
    // rooted: it slides up its own leaning axis out of the stone, thickening as it comes, and stretches past its height
    float e = solidEmergence(age, aLife.y), up = min(e, 1.0);
    float since = uSolidTime - aLife.z, gone = clamp(since / max(aLife.w, 0.01), 0.0, 1.0);
    if (since >= aLife.w) solidHidden = 1.0;
    float girth = aSize.x * 2.0 * (0.5 + 0.5 * up);
    vec3 q = solidTurn(vec3(p.x * girth, p.y * aSize.y * max(e, 1.0), p.z * girth), vec3(0.0, 1.0, 0.0), aLean.z);
    q.y += (up - 1.0) * aSize.y - (uSolidCrumble > 0.5 ? 0.0 : gone * gone * aSize.y * 1.08);
    float tilt = length(aLean.xy);
    if (tilt > 1e-4) q = solidTurn(q, normalize(vec3(aLean.y, 0.0, -aLean.x)), tilt);
    float strain = uSolidCreak > 0.0 ? smoothstep(aLife.z - uSolidCreak, aLife.z, uSolidTime) : 0.0;
    vSolidData = vec4(seed, exp(-max(age, 0.0) / uSolidCool), strain, uSolidCrumble > 0.5 && since > 0.0 ? 1.0 - gone : 2.0);
    return aRoot + q;
  }
  // loose: solidPlan.chunkFlight. It flies, lands, hops once, skids, lies, and melts where it lies
  float t = max(age, 0.0), g = ${CHUNK_FLIGHT.gravity.toFixed(2)}, rest = uSolidFloor + aSize.x * 0.6;
  float landing = (aFling.y + sqrt(aFling.y * aFling.y + 2.0 * g * max(0.0, aRoot.y - rest))) / g;
  vec3 c; float turned;
  if (t < landing) { c = aRoot + aFling * t - vec3(0.0, 0.5 * g * t * t, 0.0); turned = t; }
  else {
    float since = t - landing, hop = (g * landing - aFling.y) * ${CHUNK_FLIGHT.restitution.toFixed(2)}, aloft = 2.0 * hop / g;
    float slide = (1.0 - exp(-${CHUNK_FLIGHT.friction.toFixed(2)} * since)) / ${CHUNK_FLIGHT.friction.toFixed(2)};
    c = vec3(aRoot.x + aFling.x * (landing + slide), rest + (since < aloft ? hop * since - 0.5 * g * since * since : 0.0), aRoot.z + aFling.z * (landing + slide));
    turned = landing + slide;
  }
  float melt = 1.0 - smoothstep(aLife.w - aLife.y, aLife.w, uSolidTime);
  if (uSolidTime >= aLife.w) solidHidden = 1.0;
  c.y -= aSize.x * 0.6 * (1.0 - melt);
  vec3 axis = normalize(vec3(sin(seed * 12.9898), 0.35 + cos(seed * 78.233), sin(seed * 37.719)));
  vSolidData = vec4(seed, exp(-t / uSolidCool), 0.0, 3.0);
  return c + solidTurn(p * vec3(aSize.x, aSize.y, aSize.x) * 2.0 * melt, axis, aLean.z + aLean.x * turned);
}
`;

const PARS_FRAGMENT = /* glsl */ `
uniform vec3 uSolidDeep, uSolidBody, uSolidRim, uSolidGlow;
uniform float uSolidFloor, uSolidGain, uSolidBlood, uSolidBloodSince;
varying vec3 vSolidLocal, vSolidWorld;
varying vec4 vSolidData;
varying vec2 vSolidBlood;
${BLOOD_ON_BLADE}
float solidHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float solidNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(solidHash(i), solidHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(solidHash(i + vec3(0.0, 1.0, 0.0)), solidHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(solidHash(i + vec3(0.0, 0.0, 1.0)), solidHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(solidHash(i + vec3(0.0, 1.0, 1.0)), solidHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

/** Nothing is drawn under the board, and a spike that is breaking is gone above a ragged line that comes down it. */
const CUT_FRAGMENT = /* glsl */ `
if (vSolidWorld.y < uSolidFloor - 0.004) discard;
float solidCut = vSolidData.w + (solidNoise(vSolidLocal * vec3(13.0, 4.0, 13.0) + vSolidData.x * 13.0) - 0.5) * 0.16 + (solidNoise(vSolidLocal * vec3(41.0, 9.0, 41.0)) - 0.5) * 0.05;
if (vSolidData.w < 1.5 && vSolidLocal.y > solidCut) discard;
`;

const ICE_FRAGMENT = /* glsl */ `
{
  vec3 solidN = normalize(normal), solidV = normalize(vViewPosition);
  float ndv = clamp(dot(solidN, solidV), 0.0, 1.0), rim = pow(1.0 - ndv, 2.4), seed = vSolidData.x;
  // looking into a face: the ray bends on its way in, and what it meets is the broken inside of the crystal,
  // which changes as the eye moves. This is what makes it something seen into and not painted.
  vec3 into = (vec4(refract(-solidV, solidN, 0.76), 0.0) * viewMatrix).xyz;
  float inner = smoothstep(0.3, 0.85, solidNoise(into * 3.4 + vSolidWorld * 2.1 + seed * 19.0));
  // fracture planes through the body, fixed in the world and barely warped, so they cross a facet as a straight
  // line and carry on across the next; a finer set shows only once the spike is under strain
  vec3 planeA = normalize(vec3(sin(seed * 41.0), 0.35, cos(seed * 41.0))), planeB = normalize(vec3(cos(seed * 23.0 + 1.0), -0.9, sin(seed * 23.0 + 1.0)));
  float warp = solidNoise(vSolidWorld * 2.2 + seed * 7.0) * 0.14, strain = vSolidData.z, loose = step(2.5, vSolidData.w);
  float sheetA = abs(fract(dot(vSolidWorld, planeA) * 2.6 + warp + seed) - 0.5) * 2.0, sheetB = abs(fract(dot(vSolidWorld, planeB) * 1.9 - warp * 0.7 + seed * 3.0) - 0.5) * 2.0;
  float sheetC = abs(fract(dot(vSolidWorld, planeA.zxy) * 5.5 + warp * 1.3) - 0.5) * 2.0;
  float fine = 0.035 + 0.03 * strain;
  float cracks = (smoothstep(fine, 0.0, sheetA) + smoothstep(fine * 0.75, 0.0, sheetB) * 0.8 + smoothstep(0.08, 0.0, sheetC) * strain) * (0.35 + 0.65 * solidNoise(vSolidWorld * 9.0));
  // frost whitens the foot, where it left the stone
  float foot = (1.0 - loose) * smoothstep(0.45, 0.0, vSolidLocal.y) * (0.55 + 0.45 * solidNoise(vSolidLocal * 9.0 + seed * 5.0));
  // dark where the eye looks deepest in, pale at the edges
  vec3 body = mix(uSolidBody, uSolidDeep, smoothstep(0.15, 0.95, ndv) * (1.0 - 0.65 * inner));
  diffuseColor.rgb = mix(body, uSolidRim, clamp(rim * 0.85 + cracks * 0.3 + foot * 0.75, 0.0, 1.0));
  roughnessFactor = mix(roughnessFactor, 0.9, foot);
  // pinpoints that come and go as the camera moves
  float glint = pow(solidNoise(vSolidWorld * 37.0 + into * 7.0), 30.0) * 26.0;
  // the edge of a break is the brightest thing on it
  float broken = vSolidData.w < 1.5 ? smoothstep(0.07, 0.0, solidCut - vSolidLocal.y) : 0.0;
  vec3 within = uSolidGlow * (rim * 0.6 + inner * 0.2) + uSolidRim * (cracks * (0.05 + 2.4 * strain) + glint * (0.25 + 0.75 * rim) + vSolidData.y * (0.8 - 0.55 * loose) + broken * 1.3);
  // a spike that ran a body through comes out coated, and its blood runs down it (shared/blood.ts); none unless asked
  float blood = uSolidBlood > 0.0 ? bloodOn(vSolidLocal, vSolidBlood, uSolidBloodSince, uSolidBlood, seed * 13.0) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, bloodColour(uSolidBlood), blood);
  roughnessFactor = mix(roughnessFactor, 0.3, blood);
  totalEmissiveRadiance += (within * (1.0 - blood) + bloodGlow(within, uSolidBlood) * blood) * uSolidGain;
}
`;

const CINDER_FRAGMENT = /* glsl */ `
{
  vec3 solidN = normalize(normal), solidV = normalize(vViewPosition);
  float ndv = clamp(dot(solidN, solidV), 0.0, 1.0), heat = vSolidData.y;
  float sheet = abs(solidNoise(vSolidLocal * 5.0 + vSolidData.x * 7.0) - 0.5) * 2.0;
  float seams = smoothstep(0.22, 0.0, sheet);
  diffuseColor.rgb = mix(uSolidDeep, uSolidBody, solidNoise(vSolidLocal * 11.0) * 0.6);
  roughnessFactor = 0.92;
  // hot in its seams and on its thin edges when it is thrown; the seams are the last to go dark
  vec3 within = mix(uSolidGlow, uSolidRim, heat * heat) * (seams * heat * 2.4 + pow(1.0 - ndv, 2.0) * heat * heat * 0.5 + heat * heat * heat * 0.8);
  totalEmissiveRadiance += within * uSolidGain;
}
`;

export class SolidField {
  readonly object = new THREE.Group();
  /** The number of solids the field holds, and the moment the last of them is gone. */
  readonly count: number;
  readonly spent: number;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometries: THREE.InstancedBufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;

  constructor(options: SolidFieldOptions) {
    const kept = options.solids.slice(0, Math.max(0, options.capacity));
    this.count = kept.length;
    this.spent = packSolids(kept, kept.length).spent;
    const { look, matter } = options;
    this.uniforms = {
      uSolidTime: { value: 0 }, uSolidFloor: { value: options.floor }, uSolidBounce: { value: options.bounce }, uSolidCrumble: { value: options.crumble ? 1 : 0 },
      uSolidCreak: { value: options.creak }, uSolidCool: { value: matter === "ice" ? 0.22 : 1.1 }, uSolidGain: { value: 1 }, uSolidBlood: { value: 0 }, uSolidBloodSince: { value: -1 },
      uSolidDeep: { value: new THREE.Color(look.deep) }, uSolidBody: { value: new THREE.Color(look.body) }, uSolidRim: { value: new THREE.Color(look.rim) }, uSolidGlow: { value: new THREE.Color(look.glow) },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: matter === "ice" ? 0.14 : 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${PARS_VERTEX}`)
        .replace("#include <begin_vertex>", "vec3 transformed = solidPlace(position);\nvSolidWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;")
        // not yet out of the stone, or gone: folded out of the picture
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (solidHidden > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${matter === "ice" ? ICE_FRAGMENT : CINDER_FRAGMENT}`);
    };
    // three keys a compiled program on the patch's source; say which matter this is so two looks never share one
    this.material.customProgramCacheKey = () => `spell-solid:${matter}`;

    const shapes = options.shapes.length > 0 ? options.shapes : [new Float32Array(9)];
    shapes.forEach((shape, at) => {
      const mine = kept.filter((_, i) => i % shapes.length === at);
      if (mine.length === 0) return;
      const packed = packSolids(mine, mine.length);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(shape, 3));
      geometry.computeVertexNormals();
      geometry.setAttribute("aRoot", new THREE.InstancedBufferAttribute(packed.root, 3));
      geometry.setAttribute("aLean", new THREE.InstancedBufferAttribute(packed.lean, 4));
      geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(packed.size, 3));
      geometry.setAttribute("aLife", new THREE.InstancedBufferAttribute(packed.life, 4));
      geometry.setAttribute("aFling", new THREE.InstancedBufferAttribute(packed.fling, 3));
      geometry.setAttribute("aBlood", new THREE.InstancedBufferAttribute(packed.blood, 2));
      geometry.instanceCount = packed.count;
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false; mesh.renderOrder = options.renderOrder ?? 4;
      this.object.add(mesh);
    });
  }

  /** The spell's clock, in seconds since the cast. */
  update(time: number): void {
    this.uniforms.uSolidTime.value = time;
    this.object.visible = this.count > 0 && time < this.spent;
  }
  /** Scales the light inside it, so it does not clip to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.uniforms.uSolidGain.value = gain; }
  /**
   * Blood on the ice of any spike that ran a body through (Solid.blood): how much the Violence setting shows (0 for
   * none, the default; shared/piercePlan.bloodOf), and seconds since it went through (negative before).
   */
  setBlood(amount: number, since: number): void { this.uniforms.uSolidBlood.value = amount; this.uniforms.uSolidBloodSince.value = since; }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}
