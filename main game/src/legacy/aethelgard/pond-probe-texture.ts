import { EquirectangularReflectionMapping, Euler, FloatType, HalfFloatType, LinearSRGBColorSpace, Matrix4,
  Mesh, MeshStandardMaterial, type Material, type Object3D, type Texture } from 'three';
import { EALDHOLT_LOCAL_POND_PROBE_TAG, EALDHOLT_POND_PROBE, isEaldholtPondProbeSurface,
  validateEaldholtPondProbeIdentity, type EaldholtPondProbeIdentity } from '../../../../shared/legacy/aethelgard/environment/pond-probe';

export interface EaldholtPondProbeBinding {
  readonly materialCount: number;
  readonly normalScaleMultiplier: number;
  /** Actual clone scales at binding; immutable diagnostic values, not maps. */
  readonly normalScales: readonly (readonly [number, number])[];
  /** Call after miniature rotation/recentering and before rendering. The
   * material callback also refreshes it; neither path allocates each frame. */
  update(): void;
  dispose(): void;
}
export interface EaldholtPondProbeBindingOptions {
  readonly identity: EaldholtPondProbeIdentity;
  readonly expected: { profile: EaldholtPondProbeIdentity['profile']; modelSha256: string; lightingVersion: string };
  readonly intensity?: number;
  /** Isolated Desktop authoring control; never selected by normal gameplay. */
  readonly flatNormalControl?: boolean;
  /** Optional pond-only authored comparison; omitted preserves source/default
   * roughness, including mirror calibration materials. */
  readonly roughness?: number;
  /** Multiplies only the inherited normal-map scale on owned pond clones. */
  readonly normalScaleMultiplier?: number;
}

/** Use a root-owned/cached HDR texture. No texture setup, PMREM generation,
 * scene.environment change or borrowed-resource disposal occurs here. */
export function applyEaldholtBorrowedPondProbe(root: Object3D, texture: Texture,
  options: EaldholtPondProbeBindingOptions): EaldholtPondProbeBinding {
  validateEaldholtPondProbeIdentity(options.identity, options.expected);
  const size = EALDHOLT_POND_PROBE[options.expected.profile], image = texture.image as { width?: number; height?: number } | undefined;
  if (texture.mapping !== EquirectangularReflectionMapping || texture.colorSpace !== LinearSRGBColorSpace
    || (texture.type !== HalfFloatType && texture.type !== FloatType) || image?.width !== size.width || image?.height !== size.height) {
    throw Error('Pond probe must be the matching linear HDR equirectangular texture; shared texture settings are never changed.');
  }
  const intensity = options.intensity ?? 1;
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 4) throw Error('Invalid local pond-probe intensity.');
  const roughness = options.roughness;
  if (roughness !== undefined && (!Number.isFinite(roughness) || roughness < 0 || roughness > 1)) throw Error('Invalid local pond-probe roughness.');
  const normalScaleMultiplier = options.normalScaleMultiplier === undefined ? 1 : options.normalScaleMultiplier;
  if (!Number.isFinite(normalScaleMultiplier) || normalScaleMultiplier < 0 || normalScaleMultiplier > 1) throw Error('Invalid local pond-probe normal-scale multiplier.');
  const replacements = new Map<Material, MeshStandardMaterial>(), ownedMaterials: MeshStandardMaterial[] = [];
  const assignments: { mesh: Mesh; original: Material | Material[]; assigned: Material | Material[] }[] = [];
  const rotationMatrix = new Matrix4(), rotation = new Euler();
  let disposed = false;
  function update(): void {
    if (disposed) return;
    root.updateWorldMatrix(true, false); rotationMatrix.extractRotation(root.matrixWorld); rotation.setFromRotationMatrix(rotationMatrix, 'XYZ');
    for (let i = 0; i < ownedMaterials.length; i++) ownedMaterials[i].envMapRotation.copy(rotation);
  }
  function adapt(original: Material): Material {
    if (!(original instanceof MeshStandardMaterial) || !isEaldholtPondProbeSurface(original)) return original;
    const cached = replacements.get(original); if (cached) return cached;
    if (original.userData.crownfallNeutralIbl) throw Error('Bind the local pond probe before neutral fill; its radiance was already neutral-lit.');
    if (original.userData[EALDHOLT_LOCAL_POND_PROBE_TAG]) throw Error('Local pond probe is already bound.');
    const material = original.clone(), render = original.onBeforeRender;
    material.name = original.name + '_LocalBakedProbe'; material.envMap = texture; material.envMapIntensity = intensity;
    if (roughness !== undefined) material.roughness = roughness;
    if (normalScaleMultiplier !== 1) material.normalScale.multiplyScalar(normalScaleMultiplier);
    material.onBeforeCompile = original.onBeforeCompile;
    material.customProgramCacheKey = original.customProgramCacheKey;
    if (options.flatNormalControl) {
      const compile = original.onBeforeCompile, key = original.customProgramCacheKey;
      material.normalMap = null;
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        const seam = '#include <lights_physical_fragment>';
        if (!shader.uniforms.uEaldholtWaterSourceRotation || shader.fragmentShader.split(seam).length !== 2) {
          throw Error('Flat pond control requires the verified source-frame water shader.');
        }
        shader.fragmentShader = shader.fragmentShader.replace(seam, `
normal = normalize(mat3(viewMatrix) * mat3(uEaldholtWaterSourceRotation) * vec3(0., 1., 0.));
nonPerturbedNormal = normal;
${seam}`);
      };
      material.customProgramCacheKey = function () { return key.call(this) + ':desktop-flat-pond-control:v1'; };
    }
    material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
      render.call(this, renderer, scene, camera, geometry, object, group); update();
    };
    material.userData = { ...material.userData, crownfallWaterLook: { ...material.userData.crownfallWaterLook,
      sourceMaterialName: 'Crownfall_Pond_Water_Review', staticIblOnly: true, noRecoveredTreeReflections: false, localBakedPondProbe: true,
    }, [EALDHOLT_LOCAL_POND_PROBE_TAG]: {
      ...options.identity, kind: 'baked-local-pond', skipNeutralFill: true, borrowedTexture: true,
    } };
    material.needsUpdate = true; replacements.set(original, material); ownedMaterials.push(material); return material;
  }
  function release(): void {
    for (const { mesh, original, assigned } of assignments) if (mesh.material === assigned) mesh.material = original;
    for (const material of replacements.values()) material.dispose(); replacements.clear(); ownedMaterials.length = 0; assignments.length = 0;
  }
  try {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = object.material, assigned = Array.isArray(original) ? original.map(adapt) : adapt(original);
      const changed = Array.isArray(original) && Array.isArray(assigned) ? original.some((m, i) => m !== assigned[i]) : assigned !== original;
      if (changed) { object.material = assigned; assignments.push({ mesh: object, original, assigned }); }
    });
    if (!replacements.size) throw Error('Verified pond surface is absent; the local probe was not bound.');
    update();
  } catch (error) { release(); throw error; }
  const normalScales = Object.freeze(ownedMaterials.map(material => Object.freeze([material.normalScale.x, material.normalScale.y] as const)));
  return { materialCount: replacements.size, normalScaleMultiplier, normalScales, update, dispose() { if (disposed) return; disposed = true; release(); } };
}
