/** GLTFLoader may resolve a scene after individual texture failures. Check
 * its declared core PBR (and supported extension) bindings before accepting
 * either verified preview template. This reads decoder data; it changes none. */
export function assertResidentPreviewTextures(asset: unknown): { readonly materials: number; readonly textureBindings: number } {
  const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  const root = object(asset), scene = object(root?.scene), parser = object(root?.parser), json = object(parser?.json);
  if (!scene || typeof scene.traverse !== 'function' || !parser || !(parser.associations instanceof Map)
    || !json || json.materials !== undefined && !Array.isArray(json.materials)) throw Error('Resident preview needs its original decoded GLTF material associations.');
  const definitions = (json.materials ?? []) as unknown[], materials = new Set<Record<string, unknown>>();
  (scene.traverse as (callback: (node: unknown) => void) => void).call(scene, node => {
    const mesh = object(node); if (mesh?.isMesh !== true) return;
    for (const value of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const material = object(value); if (!material) throw Error('Resident preview has an invalid decoded material.'); materials.add(material);
    }
  });
  if (!materials.size) throw Error('Resident preview has no decoded mesh materials.');
  let count = 0;
  for (const material of materials) {
    const association = object(parser.associations.get(material)), index = association?.materials;
    if (index === undefined && definitions.length === 0) continue; // Legitimate untextured GLTF default.
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || !object(definitions[index])) throw Error('Resident preview lost a decoded material association.');
    const definition = object(definitions[index])!, pbr = object(definition.pbrMetallicRoughness), extensions = object(definition.extensions);
    const pairs: Array<readonly [unknown, string]> = [
      [pbr?.baseColorTexture, 'map'], [pbr?.metallicRoughnessTexture, 'roughnessMap'],
      [pbr?.metallicRoughnessTexture, 'metalnessMap'], [definition.normalTexture, 'normalMap'],
      [definition.occlusionTexture, 'aoMap'], [definition.emissiveTexture, 'emissiveMap'],
    ];
    const extras: ReadonlyArray<readonly [string, string, string]> = [
      ['KHR_materials_sheen', 'sheenColorTexture', 'sheenColorMap'],
      ['KHR_materials_sheen', 'sheenRoughnessTexture', 'sheenRoughnessMap'],
      ['KHR_materials_specular', 'specularTexture', 'specularIntensityMap'],
      ['KHR_materials_specular', 'specularColorTexture', 'specularColorMap'],
      ['KHR_materials_clearcoat', 'clearcoatTexture', 'clearcoatMap'],
      ['KHR_materials_clearcoat', 'clearcoatRoughnessTexture', 'clearcoatRoughnessMap'],
      ['KHR_materials_clearcoat', 'clearcoatNormalTexture', 'clearcoatNormalMap'],
      ['KHR_materials_transmission', 'transmissionTexture', 'transmissionMap'],
      ['KHR_materials_volume', 'thicknessTexture', 'thicknessMap'],
      ['KHR_materials_iridescence', 'iridescenceTexture', 'iridescenceMap'],
      ['KHR_materials_iridescence', 'iridescenceThicknessTexture', 'iridescenceThicknessMap'],
      ['KHR_materials_anisotropy', 'anisotropyTexture', 'anisotropyMap'],
      ['EXT_materials_bump', 'bumpTexture', 'bumpMap'],
    ];
    for (const [extension, slot, property] of extras) pairs.push([object(extensions?.[extension])?.[slot], property]);
    for (const [declared, property] of pairs) {
      if (declared === undefined) continue;
      const info = object(declared), texture = object(material[property]);
      const image = object(texture?.image) ?? object(object(texture?.source)?.data);
      if (!info || typeof info.index !== 'number' || !Number.isSafeInteger(info.index) || info.index < 0
        || texture?.isTexture !== true || !image || typeof image.width !== 'number' || !Number.isFinite(image.width) || image.width <= 0
        || typeof image.height !== 'number' || !Number.isFinite(image.height) || image.height <= 0) throw Error('Resident preview has an undecoded required texture binding: ' + property + '.');
      count++;
    }
  }
  return Object.freeze({ materials: materials.size, textureBindings: count });
}
