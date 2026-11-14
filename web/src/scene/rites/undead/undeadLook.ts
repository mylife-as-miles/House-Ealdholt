/**
 * A soldier of Kwind-09 as one of the dead, made in code over its own sculpt: its own colours drained to grey,
 * corroded green and rust in patches, its cloth torn (more at Full, a little at Cinematic, not at all at
 * Minimal), bone at the edges of the tears at Full only, and current crawling under the skin in veins of arc
 * light. Where it climbs out of the stone it is cut, and the cut burns with the arc.
 *
 * No reference has an undead look; this is ours, on the same patch of the lit surface the shadow uses
 * (shadow/shadowLook.ts), so it keeps the figure's own texture, relief, lights and shadows.
 */
import * as THREE from "three";

export interface UndeadSkinLook {
  /** The arc's colour, and its white-hot heart. */
  arc: number;
  hot: number;
  /** Verdigris and rust, the corrosion. */
  verdigris: number;
  rust: number;
  /** Bone, seen at the edge of a tear at Full. */
  bone: number;
}

export interface UndeadSkin { uniforms: Record<string, THREE.IUniform> }

/** One body's look: shared by its materials. `tear` and `bone` come from the Violence setting (undeadPlan UNDEAD_TORN). */
export function undeadSkin(look: UndeadSkinLook, seed: number, torn: { tear: number; bone: number }): UndeadSkin {
  return {
    uniforms: {
      uDeadTime: { value: 0 }, uDeadCut: { value: -100 }, uDeadCutGlow: { value: 1 }, uDeadTear: { value: torn.tear }, uDeadBone: { value: torn.bone },
      uDeadVeins: { value: 1 }, uDeadFade: { value: 1 }, uDeadGain: { value: 1 }, uDeadSeed: { value: (seed % 131) * 0.29 },
      uDeadArc: { value: new THREE.Color(look.arc) }, uDeadHot: { value: new THREE.Color(look.hot) }, uDeadVerdigris: { value: new THREE.Color(look.verdigris) },
      uDeadRust: { value: new THREE.Color(look.rust) }, uDeadBoneColour: { value: new THREE.Color(look.bone) },
    },
  };
}

const PARS_FRAGMENT = /* glsl */ `
uniform float uDeadTime, uDeadCut, uDeadCutGlow, uDeadTear, uDeadBone, uDeadVeins, uDeadFade, uDeadGain, uDeadSeed;
uniform vec3 uDeadArc, uDeadHot, uDeadVerdigris, uDeadRust, uDeadBoneColour;
varying vec3 vDeadWorld, vDeadLocal;
float deadHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float deadNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(deadHash(i), deadHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(deadHash(i + vec3(0.0, 1.0, 0.0)), deadHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(deadHash(i + vec3(0.0, 0.0, 1.0)), deadHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(deadHash(i + vec3(0.0, 1.0, 1.0)), deadHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// tears ride the body (its own space), so a rip stays where it is while it walks
float deadRip() { return deadNoise(vDeadLocal * 7.0 + uDeadSeed) * 0.65 + deadNoise(vDeadLocal * 19.0 - uDeadSeed) * 0.35; }
`;

const CUT_FRAGMENT = /* glsl */ `
if (vDeadWorld.y < uDeadCut) discard;
if (uDeadTear > 0.0 && deadRip() < uDeadTear) discard;
if (uDeadFade < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > uDeadFade) discard;
`;

const COLOUR_FRAGMENT = /* glsl */ `
{
  // drained: its own colour to a grey with a little green in it, darker
  float deadLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 dead = vec3(deadLum) * vec3(0.8, 0.86, 0.8);
  // corroded in patches, verdigris and rust, fixed on the body
  float patchA = smoothstep(0.55, 0.8, deadNoise(vDeadLocal * 5.0 + uDeadSeed * 3.0));
  float patchB = smoothstep(0.6, 0.88, deadNoise(vDeadLocal * 11.0 + 7.0 - uDeadSeed));
  dead = mix(dead, uDeadVerdigris * (0.6 + 0.6 * deadLum), patchA * 0.55);
  dead = mix(dead, uDeadRust * (0.5 + 0.5 * deadLum), patchB * 0.45);
  diffuseColor.rgb = dead * 0.55;
  // at the edge of a tear: bone at Full, the arc's scorch otherwise
  if (uDeadTear > 0.0) {
    float edge = 1.0 - smoothstep(uDeadTear, uDeadTear + 0.05, deadRip());
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.05, 0.04, 0.04), uDeadBoneColour, uDeadBone), edge * 0.85);
  }
}
`;

const EMISSIVE_FRAGMENT = /* glsl */ `
{
  // veins of current under the skin: ridges of noise, with surges running along them
  float ridge = 1.0 - abs(deadNoise(vDeadLocal * 6.0 + vec3(0.0, uDeadTime * 0.3, uDeadSeed)) * 2.0 - 1.0);
  float vein = pow(ridge, 10.0);
  float surge = pow(0.5 + 0.5 * sin(vDeadWorld.y * 18.0 - uDeadTime * 14.0 + uDeadSeed * 5.0), 6.0);
  float stutter = step(0.2, fract(sin(floor(uDeadTime * 21.0) + uDeadSeed) * 437.5));
  totalEmissiveRadiance += (uDeadArc * (0.6 + 2.2 * surge) + uDeadHot * surge * 0.8) * vein * uDeadVeins * stutter * uDeadGain;
  // a cold pallor on its rim (rounding can take the dot of two unit vectors a hair past 1: pow of a negative is undefined)
  vec3 deadN = normalize(normal), deadV = normalize(vViewPosition);
  totalEmissiveRadiance += uDeadArc * pow(max(1.0 - abs(dot(deadN, deadV)), 0.0), 2.6) * 0.45 * uDeadVeins * uDeadGain;
  // a tear's edge glows with the current when there is no bone to show
  if (uDeadTear > 0.0) {
    float edge = 1.0 - smoothstep(uDeadTear, uDeadTear + 0.035, deadRip());
    totalEmissiveRadiance += uDeadArc * edge * (1.0 - uDeadBone) * 1.2 * uDeadGain;
  }
  float fromCut = (vDeadWorld.y - uDeadCut) / 0.04;
  float crossing = exp(-fromCut * fromCut) * uDeadCutGlow;
  totalEmissiveRadiance += (uDeadArc * 2.2 + uDeadHot * crossing) * crossing * uDeadGain;
}
`;

/**
 * One of the figure's own materials, made dead: its texture and relief kept. `unit` turns the mesh's own units
 * into about one across the figure, so tears and corrosion are the same size whatever the sculpt was made in.
 */
export function undeadMaterial(original: THREE.MeshStandardMaterial, skin: UndeadSkin, unit = 1): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: original.map, color: original.color.clone(), normalMap: original.normalMap, normalScale: original.normalScale.clone(),
    roughness: Math.max(0.8, original.roughness), metalness: original.metalness * 0.5, side: original.side, flatShading: original.flatShading,
    aoMap: original.aoMap, aoMapIntensity: original.aoMapIntensity,
  });
  material.name = `dead:${original.name}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skin.uniforms, { uDeadUnit: { value: unit } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uDeadUnit;\nvarying vec3 vDeadWorld, vDeadLocal;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvDeadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvDeadLocal = position * uDeadUnit;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${COLOUR_FRAGMENT}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${EMISSIVE_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `rite-undead-skin:${original.map ? 1 : 0}${original.normalMap ? 1 : 0}${original.aoMap ? 1 : 0}`;
  return material;
}

export function setUndeadSkin(skin: UndeadSkin, state: { time: number; cut: number; cutGlow: number; veins: number; fade: number; gain: number }): void {
  const u = skin.uniforms;
  u.uDeadTime.value = state.time; u.uDeadCut.value = state.cut; u.uDeadCutGlow.value = state.cutGlow; u.uDeadVeins.value = state.veins;
  u.uDeadFade.value = state.fade; u.uDeadGain.value = state.gain;
}
