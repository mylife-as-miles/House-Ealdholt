/** Material-local white balance for indirect environment light. All inputs are
 * scene-linear; preserve luminance and HDR energy rather than raising exposure.
 * The visible sky, direct lights, shadows, maps and scene geometry are untouched. */
export const EALDHOLT_NEUTRAL_FILL_STRENGTH = .7;
export const EALDHOLT_NEUTRAL_FILL_CACHE_KEY = ':ealdholt-neutral-ibl:v1';
export const EALDHOLT_NEUTRAL_HEMISPHERE_SKY = '#c5ccd2';
// Exact70%neutralization of the existing sRGB#b6cfe0 sky, before quantization.
export const EALDHOLT_NEUTRAL_HEMISPHERE_SKY_LINEAR = [.5600029826094404,.6068559612783155,.643289106637909] as const;

export function neutralizeEaldholtRadiance(rgb:readonly[number,number,number]):[number,number,number] {
  if(rgb.some(value=>!Number.isFinite(value)||value<0))throw Error('Expected finite nonnegative linear radiance.');
  const y=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  return rgb.map(c=>c*(1-EALDHOLT_NEUTRAL_FILL_STRENGTH)+y*EALDHOLT_NEUTRAL_FILL_STRENGTH) as [number,number,number];
}
export interface EaldholtNeutralFillShader {
  uniforms:Record<string,{value:unknown}>;
  fragmentShader:string;
}

/** Public Three r185 ShaderChunk contract: lights_fragment_maps populates only
 * IBL irradiance/radiance (lightmaps have a different accumulator). Gate every
 * accumulator exactly as its standard PBR declaration/use. No light-count,
 * renderer, global material prototype or SDK-internal changes are required. */
export function patchEaldholtNeutralFill(shader:EaldholtNeutralFillShader):void {
  if(shader.fragmentShader.includes('CROWNFALL_IBL_NEUTRAL_FILL'))return;
  if(!shader.fragmentShader.includes('#include <common>')||!shader.fragmentShader.includes('#include <lights_fragment_maps>'))throw Error('Neutral daylight fill requires standard PBR IBL chunks.');
  shader.uniforms.uEaldholtIblNeutralMix={value:EALDHOLT_NEUTRAL_FILL_STRENGTH};
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
#define CROWNFALL_IBL_NEUTRAL_FILL
uniform float uEaldholtIblNeutralMix;
vec3 ealdholtNeutralIbl(vec3 radiance) {
  float luminance=dot(radiance,vec3(.2126,.7152,.0722));
  return mix(radiance,vec3(luminance),uEaldholtIblNeutralMix);
}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',`#include <lights_fragment_maps>
#if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
  #if defined(RE_IndirectDiffuse) && (defined(STANDARD) || defined(LAMBERT) || defined(PHONG))
    iblIrradiance=ealdholtNeutralIbl(iblIrradiance);
  #endif
  #if defined(RE_IndirectSpecular)
    radiance=ealdholtNeutralIbl(radiance);
    #ifdef USE_CLEARCOAT
      clearcoatRadiance=ealdholtNeutralIbl(clearcoatRadiance);
    #endif
  #endif
#endif`);
}
