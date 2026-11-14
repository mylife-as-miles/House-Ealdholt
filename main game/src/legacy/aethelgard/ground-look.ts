import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { EALDHOLT_GROUND_AO_INTENSITY, isGeneratedEaldholtGroundDetail } from '../../../../shared/legacy/aethelgard/environment/ground-look';

export interface EaldholtGroundLook { readonly materialCount: number; dispose(): void }

/** UNWIRED: standard owned-cavity AO, no albedo/shader changes. Borrowed ORM
 * textures retain their source UV2/UV3 channel, repeat and transform. */
export function applyEaldholtGroundAo(root: Object3D): EaldholtGroundLook {
  const replacements = new Map<Material, MeshStandardMaterial>();
  const assignments: { mesh: Mesh; original: Material | Material[]; assigned: Material | Material[] }[] = [];
  function adapt(original: Material): Material {
    if (!(original instanceof MeshStandardMaterial) || !isGeneratedEaldholtGroundDetail(original.name)
      || !original.roughnessMap || original.aoMap) return original;
    const detail = original.userData.crownfallGroundDetail;
    if (!detail || !['earth','rock'].includes(detail.kind) || ![2,3].includes(detail.uvChannel)
      || original.roughnessMap.channel !== detail.uvChannel) return original;
    const cached = replacements.get(original); if (cached) return cached;
    const material = original.clone();
    material.onBeforeCompile = original.onBeforeCompile;
    material.customProgramCacheKey = original.customProgramCacheKey;
    material.name = original.name + '_CavityAo';
    material.aoMap = original.roughnessMap;
    material.aoMapIntensity = EALDHOLT_GROUND_AO_INTENSITY;
    material.needsUpdate = true;
    replacements.set(original,material); return material;
  }
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const original = object.material, assigned = Array.isArray(original) ? original.map(adapt) : adapt(original);
    const changed = Array.isArray(original) && Array.isArray(assigned)
      ? original.some((material,index) => material !== assigned[index]) : assigned !== original;
    if (changed) { object.material = assigned; assignments.push({ mesh:object, original, assigned }); }
  });
  let disposed = false;
  return { materialCount:replacements.size, dispose() {
    if (disposed) return; disposed = true;
    for (const {mesh,original,assigned} of assignments) if (mesh.material === assigned) mesh.material = original;
    for (const material of replacements.values()) material.dispose();
    replacements.clear(); assignments.length = 0;
  } };
}
