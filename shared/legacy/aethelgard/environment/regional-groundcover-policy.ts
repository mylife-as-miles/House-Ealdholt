/** Changes only generated grass distribution. Authored models, terrain and the
 * tree/shrub/rock actor buffers keep their existing source identities. */
export const REGIONAL_GROUNDCOVER_PLACEMENT_VERSION='riparian-source-height-clusters-v3';
/** Measured from the same three borrowed source families used by the renderer.
 * Absence or invalid data holds shoreline redistribution, never guesses size. */
export interface RegionalGroundcoverSource {
 radius:number;minimumHeight:number;maximumHeight:number;families:string[];
}
export function validRegionalGroundcoverSource(source:RegionalGroundcoverSource|undefined):source is RegionalGroundcoverSource {
 return !!source&&[source.radius,source.minimumHeight,source.maximumHeight].every(Number.isFinite)
  &&source.radius>0&&source.radius<=2&&source.minimumHeight>0&&source.maximumHeight<=.7
  &&source.minimumHeight<=source.maximumHeight&&Array.isArray(source.families)&&source.families.length>0&&source.families.length<=3
  &&source.families.every(name=>typeof name==='string'&&/Grass_Clumps/i.test(name));
}
export const REGIONAL_RIPARIAN_GROUNDCOVER={
 maximumFraction:.1875,
 minimumDryMarginMetres:.25,
 maximumSlope:.52,
 minimumExposedHeightMetres:.25,
 maximumExposedHeightMetres:.45,
 maximumBurialFraction:.25,
 maximumBurialMetres:.08,
} as const;
/** One common scale must suit every borrowed family, including after the
 * existing worst-case burial. An incompatible source holds optional enlargement
 * while retaining the already-qualified small riparian plants. */
export function regionalRiparianSourceScaleRange(source:RegionalGroundcoverSource):{minimum:number;maximum:number}|null{
 if(!validRegionalGroundcoverSource(source))return null;
 const policy=REGIONAL_RIPARIAN_GROUNDCOVER;
 const minimum=policy.minimumExposedHeightMetres/(source.minimumHeight*(1-policy.maximumBurialFraction));
 const maximum=policy.maximumExposedHeightMetres/source.maximumHeight;
 return Number.isFinite(minimum)&&Number.isFinite(maximum)&&minimum<=maximum?{minimum,maximum}:null;
}
