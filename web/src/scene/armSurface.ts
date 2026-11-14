import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * One material for every part of a hand-held prop (A-14).
 *
 * A primitive weapon is built from parts in several materials (steel, gold, wood, leather, a gem...), and each was
 * its own mesh: five to eight draws per figure, twice over with the shadow pass, about 400 of a match's 900 draws.
 * Here the parts that share a side (one-sided, or two-sided cloth and plumes) are merged into one geometry that
 * carries each part's material in its vertices: its colour, roughness, metalness, glow and reflection strength. The
 * shader reads them where the material's uniforms used to be, so each part looks as it did as a mesh of its own.
 *
 * The material's own uniforms stay the figure's controls over the whole prop: `color` and `envMapIntensity` scale every
 * part (the downfall's shade), `opacity` fades it, and the emissive intensity is the highlight's boost, added to each
 * part's own glow as the per-part materials took it (a part already glowing harder than 1 takes 0.6 of it).
 */

export interface ArmPart {
  geometry: THREE.BufferGeometry;
  /** sRGB hex, as the palette gives it. */
  color: number;
  roughness: number;
  metalness: number;
  emissive: number;
  emissiveIntensity: number;
  envMapIntensity: number;
}

const KEY = "arm-surface";

/** Merges the parts into one geometry with each part's material in its vertices (`color`, `aArmSurface`, `aArmEmissive`). */
export function mergeArmParts(parts: readonly ArmPart[]): THREE.BufferGeometry {
  const tinted = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    const count = geometry.attributes.position.count;
    const color = new THREE.Color(part.color), emissive = new THREE.Color(part.emissive);
    const colors = new Float32Array(count * 3), surface = new Float32Array(count * 4), glow = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors.set([color.r, color.g, color.b], i * 3);
      surface.set([part.roughness, part.metalness, part.emissiveIntensity, part.envMapIntensity], i * 4);
      glow.set([emissive.r, emissive.g, emissive.b], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aArmSurface", new THREE.BufferAttribute(surface, 4));
    geometry.setAttribute("aArmEmissive", new THREE.BufferAttribute(glow, 3));
    return geometry;
  });
  if (tinted.length === 1) return tinted[0];
  const merged = mergeGeometries(tinted, false);
  for (const geometry of tinted) geometry.dispose();
  if (!merged) throw new Error("arm parts could not be merged");
  return merged;
}

/** Writes the per-part material into a MeshStandardMaterial program (see the file's comment). */
export function patchArmSurface(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec4 aArmSurface;\nattribute vec3 aArmEmissive;\nvarying vec4 vArmSurface;\nvarying vec3 vArmEmissive;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvArmSurface = aArmSurface;\nvArmEmissive = aArmEmissive;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec4 vArmSurface;\nvarying vec3 vArmEmissive;")
    // The reflection strength, part by part: the macro does not expand inside itself, so the uniform is still read.
    .replace("#include <envmap_physical_pars_fragment>", "#define envMapIntensity (envMapIntensity * vArmSurface.w)\n#include <envmap_physical_pars_fragment>\n#undef envMapIntensity")
    .replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = vArmEmissive * (vArmSurface.z + emissive.r * (vArmSurface.z > 1.0 ? 0.6 : 1.0));")
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= vArmSurface.x;")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= vArmSurface.y;");
}

/**
 * The material a merged prop is drawn with. The name of its patch is kept in `userData.cfPatch`, so a figure that adds
 * its own (pieces.ts installDissolve) keeps this one under it. A name, not the function: userData is copied as JSON.
 */
export function armSurfaceMaterial(side: THREE.Side): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 1, side,
    // White, at no intensity: the parts' own glow is in their vertices, and the intensity is the highlight's boost.
    emissive: 0xffffff, emissiveIntensity: 0,
  });
  material.envMapIntensity = 1;
  material.userData.cfPatch = KEY;
  material.onBeforeCompile = patchArmSurface;
  material.customProgramCacheKey = () => KEY;
  return material;
}

/** A patch a material carries for others to keep (see {@link armSurfaceMaterial}). */
export interface CarriedPatch { key: string; apply(shader: { vertexShader: string; fragmentShader: string }): void }
const CARRIED: Record<string, CarriedPatch["apply"]> = { [KEY]: patchArmSurface };
export function carriedPatch(material: THREE.Material): CarriedPatch | null {
  const key = material.userData.cfPatch as string | undefined;
  const apply = key ? CARRIED[key] : undefined;
  return key && apply ? { key, apply } : null;
}
