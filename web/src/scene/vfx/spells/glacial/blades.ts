// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Glacial crown's blades, drawn: glass that is seen by its edges and lit from within, which freezes upward out
 * of the stone in jumps and breaks away plate by plate. glacial/glacialPlan.ts says where each blade stands and when
 * it grows and breaks; the vertex shader here places and grows every blade from a few numbers written once.
 *
 * It is a standard material, patched, so the blades belong to the scene's own light, write depth and are the lit,
 * occluding layer the crown's glow is sized against. On that: almost nothing is diffuse. The silhouette carries a
 * fringe split three ways (red, green and blue each take the edge at a different power, as a prism splits a
 * highlight); light is piped up each blade to a bright point with a band climbing it; flow lines run its length;
 * the freeze front that cuts it off from above has a lit lip; and when it breaks, whole plates go one after another,
 * each break edge flaring.
 *
 * The impalers (glacialPlan.glacialThrusts) are the same glass, thrust: each slides up its own leaning axis out of the
 * stone, point first, fast and slowing (glacialPlan.bladeThrust), instead of freezing up in place. What of it went
 * through the body comes out coated in blood that runs down it (shared/blood.ts), as much as the Violence setting
 * shows; at Full they twist in the body during the hold, their cracks flaring.
 *
 * From the reference's crown material: glass carried by its edges with a split fringe, light piped up to the tip,
 * flow lines instead of frost, a freeze front up each blade, a shatter by plates. Ours: a patched standard material in
 * the scene's light, not a shader of its own (the blades take the arena's lamps and fog and are tone-mapped with it);
 * the front climbs in jumps; the cracks light under strain before a blade goes; nothing is drawn under the board.
 * The frost line's spikes (shared/solids.ts) are milky quarried ice; these are deliberately the other thing.
 */
import * as THREE from "three";
import { BLOOD_ON_BLADE } from "../shared/blood";
import type { GlacialBlade } from "./glacialPlan";

/** The colours of the glass: its dark heart, its body, its pale edge, and the witchfire piped up it. */
export interface BladeLook { deep: number; body: number; rim: number; glow: number }

export interface BladeFieldOptions {
  blades: readonly GlacialBlade[];
  /** Cuts to share the blades between (glacialPlan.bladeGeometry): one draw each. */
  shapes: readonly Float32Array[];
  look: BladeLook;
  /** The height of the stone: nothing is drawn under it. */
  floor: number;
  /** Jumps a blade freezes up in; 0 eases it up smoothly (the brief form). */
  steps: number;
  /** Seconds before it breaks that a blade's cracks begin to light: 0 for none. */
  creak: number;
  renderOrder?: number;
}

const PARS_VERTEX = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aShape, aTimes, aThrust;
attribute vec2 aTwist;
uniform float uBladeTime, uBladeSteps, uBladeCreak, uBladeTwistAt, uBladeTwist;
varying vec3 vBladeLocal, vBladeWorld;
// how far it has frozen up (2 for an impaler, which is whole as it comes), how far it has broken, the strain on it, its die
varying vec4 vBladeData;
// an impaler: where along it it entered and left the body, the moment its tip came out, and how far it has thrust
varying vec4 vBladeThrough;
float bladeHidden;
// glacialPlan.bladeThrust: a punch, fastest as it leaves the stone; the brief form eases up and stops
float bladeThrust(float age, float rise) {
  if (age <= 0.0) return 0.0;
  float u = clamp(age / max(rise, 0.02), 0.0, 1.0);
  if (uBladeSteps < 0.5) return u * u * (3.0 - 2.0 * u);
  float v = 1.0 - u;
  return 1.0 - v * v * v;
}
// glacialPlan.bladeGrowth: in jumps, holding between them
float bladeGrowth(float age, float rise) {
  if (age <= 0.0) return 0.0;
  float u = clamp(age / max(rise, 0.02), 0.0, 1.0);
  if (uBladeSteps < 0.5) return u * u * (3.0 - 2.0 * u);
  float at = u * uBladeSteps, whole = floor(at), part = at - whole;
  return min(1.0, (whole + smoothstep(0.55, 1.0, part)) / uBladeSteps);
}
vec3 bladeTurn(vec3 v, vec3 axis, float angle) { float c = cos(angle), s = sin(angle); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
vec3 bladePlace(vec3 p) {
  float age = uBladeTime - aTimes.x, since = uBladeTime - aTimes.z, thrust = step(0.5, aThrust.x);
  float grow = thrust > 0.5 ? 1.0 : bladeGrowth(age, aTimes.y), slide = thrust > 0.5 ? bladeThrust(age, aTimes.y) : 1.0;
  float broken = since > 0.0 ? clamp(since / max(aTimes.w, 0.01), 0.0, 1.0) : 0.0;
  float strain = uBladeCreak > 0.0 ? smoothstep(aTimes.z - uBladeCreak, aTimes.z, uBladeTime) : 0.0;
  // at Full the impalers twist in the body: a wrench, its cracks flaring and dying down
  float twisted = thrust * step(0.001, abs(uBladeTwist)) * step(uBladeTwistAt, uBladeTime);
  strain = max(strain, twisted * exp(-(uBladeTime - uBladeTwistAt) / 0.3));
  bladeHidden = age <= 0.0 || broken >= 1.0 ? 1.0 : 0.0;
  vBladeLocal = p;
  vBladeData = vec4(thrust > 0.5 ? 2.0 : grow, broken, strain, aTwist.y);
  vBladeThrough = vec4(aThrust.yzw, slide);
  // it thickens as it freezes; an impaler is whole, and slides up its own axis out of the stone
  float girth = aShape.x * 2.0 * (thrust > 0.5 ? 1.0 : 0.6 + 0.4 * grow);
  float turn = aTwist.x + twisted * uBladeTwist * smoothstep(uBladeTwistAt, uBladeTwistAt + 0.09, uBladeTime);
  vec3 q = bladeTurn(vec3(p.x * girth, (p.y + slide - 1.0) * aShape.y, p.z * girth), vec3(0.0, 1.0, 0.0), turn);
  float tilt = length(aShape.zw);
  if (tilt > 1e-4) q = bladeTurn(q, normalize(vec3(aShape.w, 0.0, -aShape.z)), tilt);
  return aRoot + q;
}
`;

const PARS_FRAGMENT = /* glsl */ `
uniform vec3 uBladeDeep, uBladeBody, uBladeRim, uBladeGlow;
uniform float uBladeFloor, uBladeGain, uBladeClock, uBladeTime, uBladeBlood;
varying vec3 vBladeLocal, vBladeWorld;
varying vec4 vBladeData, vBladeThrough;
${BLOOD_ON_BLADE}
float bladeHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float bladeNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bladeHash(i), bladeHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(bladeHash(i + vec3(0.0, 1.0, 0.0)), bladeHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(bladeHash(i + vec3(0.0, 0.0, 1.0)), bladeHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(bladeHash(i + vec3(0.0, 1.0, 1.0)), bladeHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

/** Nothing under the board; nothing above the freeze front, which is ragged; and no plate that has broken away. */
const CUT_FRAGMENT = /* glsl */ `
if (vBladeWorld.y < uBladeFloor - 0.004) discard;
float bladeFront = vBladeData.x * 1.05 - 0.03 + (bladeNoise(vBladeLocal * vec3(16.0, 3.0, 16.0) + vBladeData.w * 17.0) - 0.5) * 0.06;
if (vBladeLocal.y > bladeFront) discard;
// a plate is a cell of the blade's own space, so a break takes whole wedges and slabs, never a smooth wipe
float bladePlate = bladeHash(floor(vBladeLocal * vec3(4.0, 7.0, 4.0) + vBladeData.w * 23.0));
if (vBladeData.y > 0.0 && bladePlate < vBladeData.y * 1.06) discard;
`;

const GLASS_FRAGMENT = /* glsl */ `
{
  vec3 bladeN = normalize(normal), bladeV = normalize(vViewPosition);
  float ndv = clamp(dot(bladeN, bladeV), 0.0, 1.0), seed = vBladeData.w, up = clamp(vBladeLocal.y, 0.0, 1.0);
  // a split fringe: red, green and blue each take the edge at their own power, as a prism splits a highlight
  vec3 fringe = vec3(pow(1.0 - ndv, 2.0), pow(1.0 - ndv, 2.6), pow(1.0 - ndv, 3.3));
  // light piped up the blade to its point, a band of it climbing
  float pipe = pow(up, 2.0) * (0.55 + 0.45 * sin(up * 10.0 - uBladeClock * 3.4 + seed * 6.0));
  // flow lines along its length
  float stria = smoothstep(0.55, 0.95, bladeNoise(vec3(vBladeLocal.x * 26.0, vBladeLocal.y * 2.5, vBladeLocal.z * 26.0) + seed * 9.0));
  // the freeze front still travelling: its lip is lit
  float lip = vBladeData.x < 0.999 ? smoothstep(0.09, 0.0, bladeFront - vBladeLocal.y) : 0.0;
  // under strain its cracks light, along planes fixed in the world; a break's edge is the brightest thing on it
  float crack = abs(fract(dot(vBladeWorld, vec3(0.6, 1.7, 0.3)) * 3.0 + seed) - 0.5) * 2.0;
  float cracks = smoothstep(0.07, 0.0, crack) * vBladeData.z;
  float edge = vBladeData.y > 0.0 ? smoothstep(0.07, 0.0, bladePlate - vBladeData.y * 1.06) : 0.0;
  diffuseColor.rgb = mix(uBladeDeep, uBladeBody, 0.15 + 0.35 * stria);
  roughnessFactor = 0.1;
  vec3 within = uBladeGlow * (pipe * 0.75 + fringe.g * 0.3) + uBladeRim * (fringe * 1.5 + stria * 0.12 * up + lip * 1.5 + cracks * 1.8 + edge * 1.7);
  // an impaler comes out of the body coated, and its blood runs down it (shared/blood.ts); while it is still thrusting,
  // only what has already passed into the body is coated
  float blood = uBladeBlood > 0.0 ? bloodOn(vBladeLocal, vec2(vBladeThrough.x + 1.0 - vBladeThrough.w, vBladeThrough.y), uBladeTime - vBladeThrough.z, uBladeBlood, seed * 13.0) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, bloodColour(uBladeBlood), blood);
  roughnessFactor = mix(roughnessFactor, 0.3, blood);
  totalEmissiveRadiance += (within * (1.0 - blood) + bloodGlow(within, uBladeBlood) * blood) * uBladeGain;
}
`;

export class BladeField {
  readonly object = new THREE.Group();
  readonly count: number;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometries: THREE.InstancedBufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly spent: number;

  constructor(options: BladeFieldOptions) {
    const { blades, look } = options;
    this.count = blades.length;
    this.spent = blades.reduce((most, blade) => Math.max(most, blade.breakAt + blade.breakTime), 0);
    this.uniforms = {
      uBladeTime: { value: 0 }, uBladeClock: { value: 0 }, uBladeSteps: { value: options.steps }, uBladeCreak: { value: options.creak }, uBladeFloor: { value: options.floor }, uBladeGain: { value: 1 },
      uBladeBlood: { value: 0 }, uBladeTwistAt: { value: 1e6 }, uBladeTwist: { value: 0 },
      uBladeDeep: { value: new THREE.Color(look.deep) }, uBladeBody: { value: new THREE.Color(look.body) }, uBladeRim: { value: new THREE.Color(look.rim) }, uBladeGlow: { value: new THREE.Color(look.glow) },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${PARS_VERTEX}`)
        .replace("#include <begin_vertex>", "vec3 transformed = bladePlace(position);\nvBladeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;")
        // not yet frozen up, or broken away entirely: folded out of the picture
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (bladeHidden > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${GLASS_FRAGMENT}`);
    };
    // three keys a compiled program on the patch's source; say what this is so it never shares one by mistake
    this.material.customProgramCacheKey = () => "spell-glacial-blade";

    const shapes = options.shapes.length > 0 ? options.shapes : [new Float32Array(9)];
    shapes.forEach((shape, at) => {
      const mine = blades.filter((_, i) => i % shapes.length === at);
      if (mine.length === 0) return;
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(shape, 3));
      geometry.computeVertexNormals();
      geometry.setAttribute("aRoot", new THREE.InstancedBufferAttribute(Float32Array.from(mine.flatMap((b) => [b.root.x, b.root.y, b.root.z])), 3));
      geometry.setAttribute("aShape", new THREE.InstancedBufferAttribute(Float32Array.from(mine.flatMap((b) => [b.radius, b.height, b.lean.x, b.lean.z])), 4));
      geometry.setAttribute("aTimes", new THREE.InstancedBufferAttribute(Float32Array.from(mine.flatMap((b) => [b.birth, b.rise, b.breakAt, b.breakTime])), 4));
      geometry.setAttribute("aTwist", new THREE.InstancedBufferAttribute(Float32Array.from(mine.flatMap((b) => [b.yaw, b.seed])), 2));
      geometry.setAttribute("aThrust", new THREE.InstancedBufferAttribute(Float32Array.from(mine.flatMap((b) => (b.through ? [1, b.through.entry, b.through.exit, b.through.at] : [0, 0, 0, -1]))), 4));
      geometry.instanceCount = mine.length;
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false; mesh.renderOrder = options.renderOrder ?? 4;
      this.object.add(mesh);
    });
  }

  /** The spell's clock, in seconds since the cast; `clock` runs the light piped up them (slower in the brief form). */
  update(time: number, clock = time): void {
    this.uniforms.uBladeTime.value = time; this.uniforms.uBladeClock.value = clock;
    this.object.visible = this.count > 0 && time < this.spent;
  }
  /** Scales the light inside them, so it does not clip to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.uniforms.uBladeGain.value = gain; }
  /** Blood on the impalers that went through the body: as much as the Violence setting shows (shared/piercePlan.bloodOf), 0 for none. */
  setBlood(amount: number): void { this.uniforms.uBladeBlood.value = amount; }
  /** The impalers twist in the body at `at` (seconds since the cast) by `angle` radians: 0 for not at all. */
  setTwist(at: number, angle: number): void { this.uniforms.uBladeTwistAt.value = at; this.uniforms.uBladeTwist.value = angle; }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}
