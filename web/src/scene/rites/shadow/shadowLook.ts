// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * A soldier of Korvenia as a shadow: the figure's own sculpt and arms, every lit surface replaced by one that is
 * nearly black and has no shine at all, a violet rim on every grazing angle so it reads as a body and not a hole in
 * the frame, smoke crawling up that rim, and a burn that eats it away upward with violet at its edge. Where it
 * crosses the stone it rises out of, it is cut, and the cut burns.
 *
 * From the reference's ShadowCharacter: the near-black lit surface patched for a rim and a burn that mixes noise
 * with height so it rises rather than wipes, by `discard` so nothing needs sorting. Ours: no specular at all (the
 * reference kept a matte highlight), the rim crawls like smoke, the burn and the cut are in the world rather than
 * the model's space (the figures are scaled and lent), a screen-door fade, and our gain instead of its exposure.
 */
import * as THREE from "three";

export interface ShadowSkinLook {
  /** The body: nearly black, a breath of violet in it. */
  body: number;
  /** The rim, and the burning edge and its white-hot heart. */
  rim: number;
  edge: number;
  hot: number;
}

/** One soldier's look: shared by all of its materials, set once a frame. */
export interface ShadowSkin {
  uniforms: Record<string, THREE.IUniform>;
}

export function shadowSkin(look: ShadowSkinLook, seed: number, rimStrength = 1.6): ShadowSkin {
  return {
    uniforms: {
      uShadowTime: { value: 0 }, uShadowCut: { value: -100 }, uShadowCutGlow: { value: 1 }, uShadowBurn: { value: 0 }, uShadowFeet: { value: 0 }, uShadowHeight: { value: 1 },
      uShadowFade: { value: 1 }, uShadowRimStrength: { value: rimStrength }, uShadowGain: { value: 1 }, uShadowSeed: { value: (seed % 113) * 0.37 },
      uShadowRim: { value: new THREE.Color(look.rim) }, uShadowEdge: { value: new THREE.Color(look.edge) }, uShadowHot: { value: new THREE.Color(look.hot) },
    },
  };
}

const PARS_FRAGMENT = /* glsl */ `
uniform float uShadowTime, uShadowCut, uShadowCutGlow, uShadowBurn, uShadowFeet, uShadowHeight, uShadowFade, uShadowRimStrength, uShadowGain, uShadowSeed;
uniform vec3 uShadowRim, uShadowEdge, uShadowHot;
varying vec3 vShadowWorld;
float shadowHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float shadowNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(shadowHash(i), shadowHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(shadowHash(i + vec3(0.0, 1.0, 0.0)), shadowHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(shadowHash(i + vec3(0.0, 0.0, 1.0)), shadowHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(shadowHash(i + vec3(0.0, 1.0, 1.0)), shadowHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float shadowBurnField() {
  // noise mixed with height, so the burn climbs the body rather than eating it at random or wiping it
  float rise = clamp((vShadowWorld.y - uShadowFeet) / max(uShadowHeight, 1e-3), 0.0, 1.0);
  float n = shadowNoise(vShadowWorld * (11.0 / max(uShadowHeight, 0.3)) + vec3(uShadowSeed, -uShadowTime * 0.8, 0.0)) * 0.7
    + shadowNoise(vShadowWorld * (29.0 / max(uShadowHeight, 0.3)) - vec3(0.0, uShadowTime * 1.3, uShadowSeed)) * 0.3;
  return mix(n, rise, 0.5);
}
`;

const CUT_FRAGMENT = /* glsl */ `
// below the stone it is coming up through, nothing of it is drawn
if (vShadowWorld.y < uShadowCut) discard;
if (uShadowBurn > 0.0 && shadowBurnField() < uShadowBurn * 1.06) discard;
// a screen-door fade, so a fading shadow needs no sorting either
if (uShadowFade < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > uShadowFade) discard;
`;

const EMISSIVE_FRAGMENT = /* glsl */ `
{
  vec3 shadowN = normalize(normal), shadowV = normalize(vViewPosition);
  // rounding can take the dot of two unit vectors a hair past 1, and pow of a negative base is undefined
  float grazing = max(1.0 - abs(dot(shadowN, shadowV)), 0.0);
  // smoke crawling up the rim
  float wisp = 0.55 + 0.45 * shadowNoise(vShadowWorld * vec3(9.0, 4.0, 9.0) + vec3(uShadowSeed, -uShadowTime * 1.7, 0.0));
  totalEmissiveRadiance += uShadowRim * pow(grazing, 3.4) * uShadowRimStrength * wisp * uShadowGain;
  if (uShadowBurn > 0.0) {
    float edge = 1.0 - smoothstep(uShadowBurn * 1.06, uShadowBurn * 1.06 + 0.09, shadowBurnField());
    totalEmissiveRadiance += mix(uShadowEdge, uShadowHot, edge * edge * edge) * edge * 3.2 * uShadowGain;
  }
  float fromCut = (vShadowWorld.y - uShadowCut) / 0.045;
  float crossing = exp(-fromCut * fromCut) * uShadowCutGlow;
  totalEmissiveRadiance += (uShadowEdge * 2.4 + uShadowHot * crossing) * crossing * uShadowGain;
}
`;

/** A shadow's surface for one of the figure's own materials: its sculpt's relief kept, its colour and shine taken away. */
export function shadowMaterial(original: THREE.MeshStandardMaterial, skin: ShadowSkin, look: ShadowSkinLook): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: look.body, roughness: 1, metalness: 0, envMapIntensity: 0, side: original.side,
    normalMap: original.normalMap, normalScale: original.normalScale.clone(), flatShading: original.flatShading,
  });
  material.name = `shadow:${original.name}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skin.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vShadowWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${EMISSIVE_FRAGMENT}`)
      // no shine of any kind: a shadow takes light in and gives none back
      .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);");
  };
  material.customProgramCacheKey = () => `rite-shadow-skin:${original.normalMap ? 1 : 0}`;
  return material;
}

/** Sets a soldier's look for this frame. */
export function setShadowSkin(skin: ShadowSkin, state: { time: number; cut: number; cutGlow?: number; burn: number; feet: number; height: number; fade: number; gain: number }): void {
  const u = skin.uniforms;
  u.uShadowTime.value = state.time; u.uShadowCut.value = state.cut; u.uShadowCutGlow.value = state.cutGlow ?? 1; u.uShadowBurn.value = state.burn;
  u.uShadowFeet.value = state.feet; u.uShadowHeight.value = state.height; u.uShadowFade.value = state.fade; u.uShadowGain.value = state.gain;
}
