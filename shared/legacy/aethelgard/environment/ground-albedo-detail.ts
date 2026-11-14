/** Surface detail over the reconstructed atlas. Licensed photographs can replace
 * procedural grain; neither path recovers Unreal paint or invents paths/foliage. */
export type EaldholtGroundKind = 'earth' | 'rock';
export const EALDHOLT_GROUND_ALBEDO_STRENGTH = .7;
export const EALDHOLT_GROUND_ALBEDO_CACHE_KEY = ':ealdholt-owned-ground-albedo:v4';
const provenance = 'Original procedural textures generated from shared/legacy/environment/textures (no external images).';

export interface EaldholtGroundAlbedoEntry {
  file: string; meanLuminance: number; size: 512 | 1024; sha256: string;
  normal?: {file:string;size:256|1024;sha256:string};
  orm?: {file:string;size:256|1024;sha256:string};
  source?: string;
  photographic?: boolean;
}

/** Means come from the existing generator manifest, in linear luminance.
 * The512px albedo files are sRGB; configured texture samplers decode them once. */
export function readEaldholtGroundAlbedoManifest(input: unknown, profile:'desktop'|'quest'='quest'): Record<EaldholtGroundKind,EaldholtGroundAlbedoEntry> {
  const photographic=input as {version?:number;provenance?:string;licence?:string;sets?:Record<string,{
    assetId?:string;licence?:string;profiles?:Record<string,{meanLuminance?:number;files?:Record<string,{file?:string;size?:number;sha256?:string}>}>;
  }>}|null;
  if(photographic?.version===2){
    if(photographic.provenance!=='Poly Haven CC0 photographic terrain reconstruction for Crownfall'||photographic.licence!=='CC0-1.0')throw Error('Unrecognized photographic ground provenance.');
    const result={} as Record<EaldholtGroundKind,EaldholtGroundAlbedoEntry>;
    for(const kind of ['earth','rock']as const){
      const set=photographic.sets?.[kind],asset=kind==='earth'?'stony_dirt_path':'rock_surface',entry=set?.profiles?.[profile],mean=entry?.meanLuminance;
      if(set?.assetId!==asset||set.licence!=='CC0-1.0'||typeof mean!=='number'||!Number.isFinite(mean)||mean<=0||mean>1)throw Error(`Invalid photographic ${kind} provenance or mean.`);
      const albedoSize=profile==='desktop'?1024:512,dataSize=profile==='desktop'?1024:256;
      for(const [map,size,extension]of [['albedo',albedoSize,'webp'],['normal',dataSize,'png'],['orm',dataSize,'png']]as const){
        const file=entry?.files?.[map];if(file?.file!==`${kind}-${profile}-${map}-${size}.${extension}`||file.size!==size||!file.sha256||!/^[0-9a-f]{64}$/.test(file.sha256))throw Error(`Invalid photographic ${kind} ${map} file.`);
      }
      const albedo=entry!.files!.albedo,normal=entry!.files!.normal,orm=entry!.files!.orm;
      result[kind]={file:albedo.file!,size:albedoSize,sha256:albedo.sha256!,meanLuminance:mean,
        normal:{file:normal.file!,size:dataSize,sha256:normal.sha256!},orm:{file:orm.file!,size:dataSize,sha256:orm.sha256!},source:`Poly Haven CC0: ${asset}`,photographic:true};
    }
    return result;
  }
  const manifest = input as { version?: number; provenance?: string; sets?: Record<string,{
    meanLuminance?: number; files?: Record<string,{file?: string;size?: number;sha256?: string}>;
  }> } | null;
  if (manifest?.version !== 1 || manifest.provenance !== provenance) throw Error('Unrecognized owned ground texture manifest.');
  const result = {} as Record<EaldholtGroundKind,EaldholtGroundAlbedoEntry>;
  for (const kind of ['earth','rock'] as const) {
    const set = manifest.sets?.[kind], entry = set?.files?.albedo_512, mean = set?.meanLuminance;
    if (!entry || entry.file !== `${kind}-albedo-512.webp` || entry.size !== 512 || !entry.sha256 || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || typeof mean !== 'number' || !Number.isFinite(mean) || mean <= 0 || mean > 1) throw Error(`Invalid owned ${kind} albedo manifest entry.`);
    result[kind] = {file:entry.file,size:512,meanLuminance:mean,sha256:entry.sha256};
  }
  return result;
}

export interface EaldholtGroundDetailShader {
  uniforms: Record<string,{value: unknown}>;
  fragmentShader: string;
}

/** Uses the existing world-tiled roughness UV, including its transform. The
 * extra sampler is sRGB-configured, so applying another gamma conversion here
 * would be wrong. Procedural fallback changes luminance only. Photographic PBR
 * retains the atlas's broad coverage and uses actual photographed soil colour. */
export function patchEaldholtGroundAlbedoShader(shader: EaldholtGroundDetailShader, texture: unknown, meanLuminance: number, photographic = false, kind: EaldholtGroundKind = 'earth'): void {
  if (!Number.isFinite(meanLuminance) || meanLuminance <= 0 || meanLuminance > 1) throw Error('Invalid linear ground-detail luminance.');
  if (shader.fragmentShader.includes('CROWNFALL_GROUND_ALBEDO_DETAIL')) return;
  if (!shader.fragmentShader.includes('#include <common>') || !shader.fragmentShader.includes('#include <roughnessmap_fragment>')) throw Error('Ground-detail shader requires the standard PBR roughness path.');
  shader.uniforms.uEaldholtGroundAlbedoDetail = {value:texture};
  shader.uniforms.uEaldholtGroundAlbedoMean = {value:meanLuminance};
  shader.uniforms.uEaldholtGroundAlbedoStrength = {value:EALDHOLT_GROUND_ALBEDO_STRENGTH};
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
#define CROWNFALL_GROUND_ALBEDO_DETAIL
uniform sampler2D uEaldholtGroundAlbedoDetail;
uniform float uEaldholtGroundAlbedoMean;
uniform float uEaldholtGroundAlbedoStrength;`);
  const photograph = photographic ? `
  // Retain the atlas's broad, source-derived coverage, not its procedural grit.
  // Explicit coarse LOD filters grit even under magnification; a mere positive
  // bias can be cancelled by a negative implicit LOD in close views. Preserve
  // the larger derivative LOD at distance instead of sharpening minification.
  #ifdef USE_MAP
    vec3 ealdholtAtlasFine = texture2D(map, vMapUv).rgb;
    vec2 ealdholtAtlasSize = vec2(textureSize(map, 0));
    vec2 ealdholtAtlasDx = dFdx(vMapUv) * ealdholtAtlasSize;
    vec2 ealdholtAtlasDy = dFdy(vMapUv) * ealdholtAtlasSize;
    float ealdholtAtlasDerivativeLod = .5 * log2(max(max(dot(ealdholtAtlasDx, ealdholtAtlasDx), dot(ealdholtAtlasDy, ealdholtAtlasDy)), .0001));
    vec3 ealdholtAtlasMacro = textureLod(map, vMapUv, max(2.75, ealdholtAtlasDerivativeLod)).rgb;
    float ealdholtMacroLuminance = dot(ealdholtAtlasMacro, vec3(.2126, .7152, .0722));
    float ealdholtPhotoGain = clamp(mix(1., ealdholtGroundDetailLuminance / uEaldholtGroundAlbedoMean, .85), .38, 1.9);
    vec3 ealdholtPhotoChroma = clamp(ealdholtGroundDetailSample / max(ealdholtGroundDetailLuminance, .005), vec3(.55), vec3(1.6));
    vec3 ealdholtPhotographicSurface = ealdholtPhotoChroma * ealdholtMacroLuminance * ealdholtPhotoGain;
    ${kind==='earth' ? `// Keep the local soil palette while borrowing photographed grit, not a grey gravel hue.
    vec3 ealdholtSoilChroma = mix(ealdholtPhotoChroma, ealdholtAtlasMacro / max(ealdholtMacroLuminance, .001), .6);
    ealdholtSoilChroma /= max(dot(ealdholtSoilChroma, vec3(.2126, .7152, .0722)), .001);
    // Compacted earth gets quieter grit. Grass keeps its earlier photo gain;
    // rock takes the separate unchanged path outside this earth-only branch.
    float ealdholtSoilGain = clamp(mix(1., ealdholtGroundDetailLuminance / uEaldholtGroundAlbedoMean, .35), .7, 1.35);
    ealdholtPhotographicSurface = ealdholtSoilChroma * ealdholtMacroLuminance * ealdholtSoilGain;
    // Decode coverage already baked from real source grass placements.
    float ealdholtExistingGrass = smoothstep(.36, .44, ealdholtAtlasMacro.g / max(dot(ealdholtAtlasMacro, vec3(1.)), .001));
    ealdholtPhotographicSurface = mix(ealdholtPhotographicSurface, ealdholtAtlasMacro * ealdholtPhotoGain, ealdholtExistingGrass);` : ''}
    diffuseColor.rgb *= ealdholtPhotographicSurface / max(ealdholtAtlasFine, vec3(.001));
  #endif
  ` : `
  float ealdholtGroundDetailGain = clamp(mix(1., ealdholtGroundDetailLuminance / uEaldholtGroundAlbedoMean, uEaldholtGroundAlbedoStrength), .56, 1.55);
  diffuseColor.rgb *= ealdholtGroundDetailGain;`;
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
#ifdef USE_ROUGHNESSMAP
  vec3 ealdholtGroundDetailSample = texture2D(uEaldholtGroundAlbedoDetail, vRoughnessMapUv).rgb;
  float ealdholtGroundDetailLuminance = dot(ealdholtGroundDetailSample, vec3(.2126, .7152, .0722));${photograph}
#endif`);
}
