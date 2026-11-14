/** Observed Unreal-export defect, not a general material brightening rule.
 * Source materials 14 and 26 both reference image44: a 70-byte, 1x1 black
 * RGBA PNG. Its zero AO red channel and default strength1 eliminate all
 * indirect illumination, unlike the source reference appearance.
 * Other active AO maps were inspected and contain useful nonuniform data.
 */
export const EALDHOLT_ZERO_AO_SOURCE = Object.freeze({
  imageName: "MI_Mossy_Stone_Wall_ukhgdfyga_2K_Occlusion",
  imagePngSha256: "4d17e4d1ba1915f55196d1f9c135d2b6cc5cd3a4fd867b02f48e39bb5b37877e",
  imageBytes: 70,
  width: 1,
  height: 1,
  rgba: [0, 0, 0, 255] as readonly number[],
  diagnosis: "Uniform-zero fallback AO suppresses all indirect illumination.",
});

export interface EaldholtMaterialFingerprint {
  readonly materialName: string;
  readonly baseImageName: string;
  readonly normalImageName: string;
  readonly roughnessImageName: string;
  readonly metalnessImageName: string;
  readonly aoImageName: string;
  readonly channels: readonly number[];
  readonly aoIntensity: number;
  readonly sheen?: {
    readonly amount: number; readonly roughness: number;
    readonly color: readonly number[];
    readonly colorImageName: string; readonly roughnessImageName: string;
    readonly channels: readonly number[];
  };
}

interface AuditedBinding {
  readonly materialNames: readonly string[];
  readonly base: string;
  readonly normal: string;
  readonly roughness: string;
  readonly ao: string;
}

const sourceBinding = (materialName: string): AuditedBinding => ({
  materialNames: [materialName], base: `${materialName}_BaseColor`,
  normal: `${materialName}_Normal`, roughness: `${materialName}_MetallicRoughness`,
  ao: EALDHOLT_ZERO_AO_SOURCE.imageName,
});

/** Generated names cover the audited Desktop and Quest derivatives. Every map
 * name and UV channel must also match, and the runtime confirms the 1x1 pixel.
 * A reordered/new asset safely opts out until its binding is audited again. */
export const EALDHOLT_ZERO_AO_DEFECTS = [
  {
    id: "mossy-stone-wall",
    sourceMaterialIndex: 14,
    sourceMaterialName: "MI_Mossy_Stone_Wall_ukhgdfyga_2K",
    sourceMeshName: "S_Mossy_Stone_Wall_ukhgdfyga_lod3_Var1",
    bindings: [sourceBinding("MI_Mossy_Stone_Wall_ukhgdfyga_2K"), {
      materialNames: ["Elderbloom_material_14", "Elderbloom_material_13"],
      base: "Elderbloom_surface_41", normal: "Elderbloom_surface_43",
      roughness: "Elderbloom_surface_42", ao: "Elderbloom_surface_44",
    }],
  },
  {
    id: "mossy-gravestone",
    sourceMaterialIndex: 26,
    sourceMaterialName: "MI_Mossy_Gravestone_wjuvdeuqx_2K",
    sourceMeshName: "S_Mossy_Gravestone_wjuvdeuqx_lod3_Var1",
    bindings: [sourceBinding("MI_Mossy_Gravestone_wjuvdeuqx_2K"), {
      materialNames: ["Elderbloom_material_26", "Elderbloom_material_25"],
      base: "Elderbloom_surface_79", normal: "Elderbloom_surface_81",
      roughness: "Elderbloom_surface_80", ao: "Elderbloom_surface_44",
    }],
  },
] as const;

export function matchesEaldholtZeroAoDefect(meshName: string, f: EaldholtMaterialFingerprint): boolean {
  if (f.aoIntensity !== 1 || f.channels.length !== 5 || f.channels.some(channel => channel !== 0)) return false;
  return EALDHOLT_ZERO_AO_DEFECTS.some(defect => {
    const suffix = meshName.slice(defect.sourceMeshName.length);
    if (!meshName.startsWith(defect.sourceMeshName) || !(suffix === "" || /^_cell_-?\d+_-?\d+(?:_\d+)?$/.test(suffix) || /^_\d+$/.test(suffix))) return false;
    return defect.bindings.some(binding => (binding.materialNames as readonly string[]).includes(f.materialName)
      && binding.base === f.baseImageName && binding.normal === f.normalImageName
      && binding.roughness === f.roughnessImageName && binding.roughness === f.metalnessImageName
      && binding.ao === f.aoImageName);
  });
}

/** The audited wall14 and gravestone26 masks contain exact zero alpha.
 * Three r185 clamps the uniform before sampling that alpha, then D_Charlie
 * divides by the squared result. Preserve sheen and its masks; floor only the
 * final sampled roughness for these fully identified, runtime-checked maps.
 * Audited derivatives: Desktop256px / Native128px (images46 and83).
 */
export function matchesEaldholtZeroSheenRoughnessDefect(meshName: string, f: EaldholtMaterialFingerprint): boolean {
  const sheen = f.sheen;
  if (!matchesEaldholtZeroAoDefect(meshName, f) || !sheen || sheen.amount !== 1 || sheen.roughness !== 1
    || sheen.color.length !== 3 || sheen.color.some(value => value !== 1)
    || sheen.channels.length !== 2 || sheen.channels.some(channel => channel !== 0)) return false;
  return f.baseImageName === "Elderbloom_surface_41"
    && sheen.colorImageName === "Elderbloom_surface_45" && sheen.roughnessImageName === "Elderbloom_surface_46"
    || f.baseImageName === "Elderbloom_surface_79"
    && sheen.colorImageName === "Elderbloom_surface_82" && sheen.roughnessImageName === "Elderbloom_surface_83";
}
