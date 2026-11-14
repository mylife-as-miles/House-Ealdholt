/** Restrained dielectric surface adaptation for the verified exported pond and
 * trough repair materials. This is not recovered Unreal water shading: the
 * surrounding trees are absent from static sky IBL reflections. No extra
 * reflection/refraction render pass is requested. Values are linear RGB. */
export const EALDHOLT_WATER_LOOK = Object.freeze({
  linearBaseColor: [0.012, 0.028, 0.048] as const,
  metalness: 0,
  roughness: 0.24,
  ior: 1.333,
  specularIntensity: 1,
  // Static sky lacks the surrounding canopy. Limit its grazing-angle energy
  // until a local baked reflection probe is available; direct glints remain.
  envMapIntensity: 0.16,
  opacity: 1,
});

/** Open regional water reflects the daylight sky at its full authored energy.
 * The reduced pond/trough fallback gain compensates for missing local canopy
 * and must not darken the sea's grazing-angle reflection. */
export const EALDHOLT_REGIONAL_WATER_ENV_INTENSITY = 1;

/** Names are assigned only by repair-elderbloom-water.mjs after its numeric
 * source-material map and original colour guards have passed. Other water,
 * stone, trough bodies and unknown materials are deliberately excluded. */
export function isVerifiedEaldholtWater(name: string): boolean {
  return name === 'Crownfall_Pond_Water_Review' || name === 'Crownfall_Trough_Water_Review';
}
