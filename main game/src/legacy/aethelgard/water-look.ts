import type { createEaldholtOpenWater } from './open-water-runtime';
import { Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Material, type Object3D, type Texture } from 'three';
import { EALDHOLT_WATER_LOOK as LOOK, isVerifiedEaldholtWater } from '../../../../shared/legacy/aethelgard/environment/water-look';
import { createEaldholtWaterMotion, EALDHOLT_POND_RIPPLE_PROGRAM_KEY, patchEaldholtWaterRipples, type EaldholtWaterWind } from '../../../../shared/legacy/aethelgard/environment/water-ripples';

export interface EaldholtWaterLook { readonly materialCount: number; update(elapsedSeconds: number, animated: boolean, wind?: EaldholtWaterWind | null): void; dispose(): void }

/** Every replacement belongs to this model instance. Textures stay borrowed
 * from the source and are never mutated or disposed by this adapter. */
export function applyEaldholtWaterLook(root: Object3D, environment?: Texture | null, options: { metresPerWorldUnit?: number; openWater?: ReturnType<typeof createEaldholtOpenWater> } = {}): EaldholtWaterLook {
  const metresPerWorldUnit = options.metresPerWorldUnit ?? 1;
  if (!Number.isFinite(metresPerWorldUnit) || metresPerWorldUnit <= 0) throw Error('Invalid pond metre scale.');
  // The optional scale hint remains validated for compatibility. Actual source
  // metres and orientation come from the complete root matrix, including zoom.
  const motion = createEaldholtWaterMotion();
  const rippleUniforms = { time: motion.time, windDirection: motion.windDirection, windStrength: motion.windStrength, metresPerWorldUnit: { value: metresPerWorldUnit },
    worldToSource: { value: new Matrix4() }, sourceToWorldRotation: { value: new Matrix4() } };
  function refreshSourceFrame(): void {
    root.updateWorldMatrix(true, false);
    rippleUniforms.worldToSource.value.copy(root.matrixWorld).invert();
    rippleUniforms.sourceToWorldRotation.value.extractRotation(root.matrixWorld);
  }
  refreshSourceFrame();
  const replacements = new Map<Material, MeshPhysicalMaterial>();
  const assignments: { mesh: Mesh; original: Material | Material[]; assigned: Material | Material[] }[] = [];
  function adapt(original: Material): Material {
    if (!(original instanceof MeshStandardMaterial) || !isVerifiedEaldholtWater(original.name)) return original;
    const cached = replacements.get(original); if (cached) return cached;
    const material = new MeshPhysicalMaterial();
    // Copy the common standard surface only; Physical.copy(Standard) would
    // overwrite physical defaults with undefined IOR/transmission properties.
    MeshStandardMaterial.prototype.copy.call(material, original);
    material.defines = { ...material.defines, PHYSICAL: '' };
    material.name = original.name + '_DielectricLook';
    material.color.setRGB(...LOOK.linearBaseColor);
    material.metalness = LOOK.metalness; material.roughness = LOOK.roughness;
    material.ior = LOOK.ior; material.specularIntensity = LOOK.specularIntensity;
    material.envMapIntensity = LOOK.envMapIntensity;
    // Three r181/r185 uses scene.environmentIntensity for implicit scene IBL.
    // Borrowing the same explicit PMREM makes this material's own gain apply.
    if (environment) material.envMap = environment;
    material.transmission = 0; material.thickness = 0; material.clearcoat = 0;
    material.transparent = false; material.opacity = LOOK.opacity;
    material.depthWrite = true; material.depthTest = true;
    material.userData = { ...material.userData, crownfallWaterLook: {
      sourceMaterialName: original.name, staticIblOnly: true, noRecoveredTreeReflections: true,
    } };
    const sourceCompile = original.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      sourceCompile.call(material, shader, renderer);
      patchEaldholtWaterRipples(shader, rippleUniforms, { pond: true });
      options.openWater?.patchShader(shader, rippleUniforms, original.name === 'Crownfall_Trough_Water_Review' ? 'trough' : 'pond');
    };
    const sourceRender = original.onBeforeRender;
    material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
      sourceRender.call(this, renderer, scene, camera, geometry, object, group);
      refreshSourceFrame();
    };
    material.customProgramCacheKey = () => original.customProgramCacheKey() + EALDHOLT_POND_RIPPLE_PROGRAM_KEY + (options.openWater ? ':open-water-v1:' + (original.name === 'Crownfall_Trough_Water_Review' ? 'trough' : 'pond') : '');
    material.userData.crownfallWaterLook.analyticRipples = true;
    material.userData.crownfallWaterLook.openWater = options.openWater ? options.openWater.diagnostics : null;
    material.userData.crownfallWaterLook.sourceFrameFromRootMatrix = true;
    replacements.set(original, material); return material;
  }
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const original = object.material;
    const assigned = Array.isArray(original) ? original.map(adapt) : adapt(original);
    const changed = Array.isArray(original) && Array.isArray(assigned)
      ? original.some((material, index) => material !== assigned[index]) : assigned !== original;
    if (changed) { object.material = assigned; assignments.push({ mesh: object, original, assigned }); }
  });
  let disposed = false;
  return { materialCount: replacements.size, update(elapsedSeconds, animated, wind) {
    if (!disposed) motion.update(elapsedSeconds, animated, wind);
  }, dispose() {
    if (disposed) return; disposed = true;
    for (const { mesh, original, assigned } of assignments) if (mesh.material === assigned) mesh.material = original;
    for (const material of replacements.values()) material.dispose();
    replacements.clear(); assignments.length = 0;
  } };
}
