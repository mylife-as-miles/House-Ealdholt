/** The owned earth/rock ORM R channel is already authored cavity occlusion.
 * Bind it as standard PBR AO; never reinterpret it as missing ground albedo. */
export const EALDHOLT_GROUND_AO_INTENSITY = 1;

export function isGeneratedEaldholtGroundDetail(name: string): boolean {
  return /^Crownfall_LAAS_BakedGround_Review_(earth|rock)_Microdetail$/.test(name);
}
