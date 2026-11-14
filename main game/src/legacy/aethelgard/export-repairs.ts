import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Material, type Object3D } from "three";
import {
  applyEaldholtExportRepairsToMeshes, EALDHOLT_SHEEN_FLOOR_CACHE_KEY, patchEaldholtSheenRoughnessShader,
  type EaldholtExportRepairHandle,
} from "../../../../shared/legacy/aethelgard/export-repairs";
export type { EaldholtExportRepairHandle } from "../../../../shared/legacy/aethelgard/export-repairs";

/** Call after other material setup; dispose this handle before those owners.
 * Only repaired material clones are owned here. Geometry, textures, ImageBitmaps
 * and AssetManager/cached materials remain borrowed and are never disposed. */
export function applyEaldholtExportRepairs(root: Object3D): EaldholtExportRepairHandle {
  const meshes: Mesh[] = [];
  root.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
  return applyEaldholtExportRepairsToMeshes<Material>(meshes, {
    fingerprint(material) {
      if (!(material instanceof MeshStandardMaterial)) return null;
      const { map, normalMap, roughnessMap, metalnessMap, aoMap } = material;
      if (!map || !normalMap || !roughnessMap || !metalnessMap || !aoMap) return null;
      return {
        materialName: material.name, baseImageName: map.name,
        normalImageName: normalMap.name, roughnessImageName: roughnessMap.name,
        metalnessImageName: metalnessMap.name, aoImageName: aoMap.name,
        channels: [map.channel, normalMap.channel, roughnessMap.channel, metalnessMap.channel, aoMap.channel],
        aoIntensity: material.aoMapIntensity,
        sheen: material instanceof MeshPhysicalMaterial && material.sheenColorMap && material.sheenRoughnessMap ? {
          amount: material.sheen, roughness: material.sheenRoughness, color: material.sheenColor.toArray(),
          colorImageName: material.sheenColorMap.name, roughnessImageName: material.sheenRoughnessMap.name,
          channels: [material.sheenColorMap.channel, material.sheenRoughnessMap.channel],
        } : undefined,
      };
    },
    aoImage(material) { return material instanceof MeshStandardMaterial ? material.aoMap?.image : null; },
    clone(material) {
      const clone = material.clone();
      // Three does not copy these public shader/render hooks in Material.copy.
      clone.onBeforeCompile = material.onBeforeCompile;
      clone.onBeforeRender = material.onBeforeRender;
      clone.customProgramCacheKey = material.customProgramCacheKey;
      return clone;
    },
    disableAo(material) {
      if (!(material instanceof MeshStandardMaterial)) throw new Error("Unsupported AO repair material.");
      material.aoMapIntensity = 0;
      material.needsUpdate = true;
    },
    sheenRoughnessImage(material) { return material instanceof MeshPhysicalMaterial ? material.sheenRoughnessMap?.image : null; },
    floorSheenRoughness(material) {
      if (!(material instanceof MeshPhysicalMaterial)) throw new Error("Unsupported sheen repair material.");
      const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
      material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        patchEaldholtSheenRoughnessShader(shader);
      };
      material.customProgramCacheKey = function() { return previousKey.call(this) + EALDHOLT_SHEEN_FLOOR_CACHE_KEY; };
      material.needsUpdate = true;
    },
    dispose(material) { material.dispose(); },
  });
}
