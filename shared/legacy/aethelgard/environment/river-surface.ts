/** Outside-valley PBR material only. Source village maps, geometry, palette
 * attributes and placements remain borrowed and unchanged. */
import { EALDHOLT_VALLEY_GRASS_CACHE_KEY } from './grass-maps';
import { patchEaldholtWoodlandValleySurface, type EaldholtWoodlandValleyOptions } from './woodland-ground';
export const EALDHOLT_BANK_ART_VERSION = 'grounded-bank-earth-grass-rock-v2';
export { EALDHOLT_VALLEY_GRASS_CACHE_KEY } from './grass-maps';
export interface EaldholtRiverSurfaceShader { uniforms:Record<string,{value:unknown}>;vertexShader:string;fragmentShader:string }
export interface EaldholtRiverSurfaceOptions {
  readonly earthNormal?:unknown;readonly earthOrm?:unknown;
  readonly rock?:{readonly albedo:unknown;readonly normal?:unknown;readonly orm?:unknown;readonly meanLuminance?:number};
  readonly grass?:{readonly albedo:unknown;readonly normal?:unknown;readonly orm?:unknown;readonly meanLuminance?:number;readonly tileMetres?:number};
  readonly waterHeight?:number;
  /** Explicit paired bank/meadow contract; legacy callers retain the v2 palette blend. */
  readonly woodland?:EaldholtWoodlandValleyOptions;
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const smooth=(low:number,high:number,value:number)=>{const t=clamp((value-low)/(high-low));return t*t*(3-2*t);};
/** Semantic classification of the linear base palette, not RGB-as-weights.
 * Used by CPU material checks; the shader uses the same continuous rules. */
export function ealdholtRiverMaterialWeights(palette:readonly number[],normalY:number,heightAboveWater:number,wetness:number){
  if(palette.length!==3||![...palette,normalY,heightAboveWater,wetness].every(Number.isFinite)||palette.some(v=>v<0))throw Error('Invalid river material sample.');
  const mean=palette[0]*.2126+palette[1]*.7152+palette[2]*.0722,maximum=Math.max(...palette,.001),neutral=1-(Math.max(...palette)-Math.min(...palette))/maximum;
  const wet=clamp(wetness),slope=clamp(1-normalY),exposure=smooth(.25,3,heightAboveWater);
  const rock=clamp(Math.max(smooth(.10,.38,slope)*exposure,.75*smooth(.68,.9,neutral)*exposure)*(1-.5*wet));
  const grass=smooth(.08,.30,(palette[1]-palette[0])/Math.max(mean,.001))*(1-rock)*(1-.85*wet);
  return{earth:1-rock-grass,grass,rock,wet};
}

export function patchEaldholtRiverSurface(shader:EaldholtRiverSurfaceShader,meanLuminance:number,sourceMaxZ:number,margin:number,
  wetness:'river'|'attribute'='river',options:EaldholtRiverSurfaceOptions={}):void {
  if(options.woodland){patchEaldholtWoodlandValleySurface(shader,meanLuminance,wetness,options);return;}
  const waterHeight=options.waterHeight??0,rockMean=options.rock?.meanLuminance??meanLuminance,grassMean=options.grass?.meanLuminance??meanLuminance,grassTileMetres=options.grass?.tileMetres??2,hasGrass=!!options.grass?.albedo;
  if(![meanLuminance,sourceMaxZ,margin,waterHeight,rockMean].every(Number.isFinite)||meanLuminance<=0||meanLuminance>1||rockMean<=0||rockMean>1||margin<=0)throw Error('Invalid river surface parameters.');
  if(options.grass&&(!hasGrass||!Number.isFinite(grassMean)||grassMean<=0||grassMean>1||!Number.isFinite(grassTileMetres)||grassTileMetres<.25||grassTileMetres>16))throw Error('Invalid grass surface parameters.');
  if(shader.fragmentShader.includes('CROWNFALL_OUTER_VALLEY_SURFACE'))return;
  for(const[source,seam]of [[shader.vertexShader,'#include <common>'],[shader.vertexShader,'#include <begin_vertex>'],
    [shader.fragmentShader,'#include <common>'],[shader.fragmentShader,'#include <map_fragment>'],[shader.fragmentShader,'#include <color_fragment>'],
    [shader.fragmentShader,'#include <roughnessmap_fragment>'],[shader.fragmentShader,'#include <normal_fragment_maps>']]){
    if(source.split(seam).length!==2)throw Error('River surface requires the standard PBR surface path.');
  }
  Object.assign(shader.uniforms,{uEaldholtValleyPhotoMean:{value:meanLuminance},uEaldholtValleyRockMean:{value:rockMean},uEaldholtValleyWaterHeight:{value:waterHeight}});
  if(hasGrass)Object.assign(shader.uniforms,{uEaldholtValleyGrassMean:{value:grassMean},uEaldholtValleyGrassTileMetres:{value:grassTileMetres}});
  const samplers=[['EarthNormal',options.earthNormal],['EarthOrm',options.earthOrm],['RockAlbedo',options.rock?.albedo],['RockNormal',options.rock?.normal],['RockOrm',options.rock?.orm],['GrassAlbedo',options.grass?.albedo],['GrassNormal',options.grass?.normal],['GrassOrm',options.grass?.orm]]as const;
  for(const[name,value]of samplers)if(value)shader.uniforms['uEaldholtValley'+name]={value};
  if(wetness==='river')Object.assign(shader.uniforms,{uEaldholtValleySourceMaxZ:{value:sourceMaxZ},uEaldholtValleyMargin:{value:margin}});
  const attribute=wetness==='attribute'?'attribute float ealdholtShoreWetness;\nvarying float vEaldholtShoreWetness;':'';
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec3 vEaldholtValleySourcePosition;
varying vec3 vEaldholtValleySourceNormal;
${attribute}`);
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vEaldholtValleySourcePosition = position;
vEaldholtValleySourceNormal = normal;
${wetness==='attribute'?'vEaldholtShoreWetness = ealdholtShoreWetness;':''}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
#define CROWNFALL_OUTER_VALLEY_SURFACE
varying vec3 vEaldholtValleySourcePosition;
varying vec3 vEaldholtValleySourceNormal;
uniform float uEaldholtValleyPhotoMean;
uniform float uEaldholtValleyRockMean;
uniform float uEaldholtValleyWaterHeight;
${hasGrass?'uniform float uEaldholtValleyGrassMean;\nuniform float uEaldholtValleyGrassTileMetres;\n// '+EALDHOLT_VALLEY_GRASS_CACHE_KEY:''}
${samplers.filter(([,value])=>value).map(([name])=>'uniform sampler2D uEaldholtValley'+name+';').join('\n')}
${wetness==='attribute'?`varying float vEaldholtShoreWetness;
float ealdholtValleyWetness() { return clamp(vEaldholtShoreWetness, 0., 1.); }`:`uniform float uEaldholtValleySourceMaxZ;
uniform float uEaldholtValleyMargin;
float ealdholtValleyWetness() {
  float x=vEaldholtValleySourcePosition.x;
  float centre=uEaldholtValleySourceMaxZ+uEaldholtValleyMargin*.6+uEaldholtValleyMargin/70.*(5.*sin(x*.035)+1.6*sin(x*.087+1.1));
  float halfWidth=5.5+.75*sin(x*.043+.8);
  return 1.-smoothstep(0.,2.2+.9*sin(x*.17+.8)+.4*sin(x*.43),abs(vEaldholtValleySourcePosition.z-centre)-halfWidth);
}`}
// Derivatives use unwrapped source metres; wrapping cannot sharpen mip choice.
vec4 ealdholtValleyPhoto(sampler2D sourceMap,vec2 uv,float minimumLod) {
  vec2 size=vec2(textureSize(sourceMap,0));
  vec2 dx=dFdx(uv)*size,dy=dFdy(uv)*size;
  float lod=.5*log2(max(max(dot(dx,dx),dot(dy,dy)),.0001));
  return textureLod(sourceMap,fract(uv),max(minimumLod,max(0.,lod)));
}
vec3 ealdholtValleyWeights(vec3 palette,float wet) {
  float luminance=dot(palette,vec3(.2126,.7152,.0722));
  float maximum=max(max(palette.r,palette.g),max(palette.b,.001));
  float neutral=1.-(maximum-min(min(palette.r,palette.g),palette.b))/maximum;
  float slope=clamp(1.-normalize(vEaldholtValleySourceNormal).y,0.,1.);
  float exposure=smoothstep(.25,3.,vEaldholtValleySourcePosition.y-uEaldholtValleyWaterHeight);
  float rock=clamp(max(smoothstep(.10,.38,slope)*exposure,.75*smoothstep(.68,.9,neutral)*exposure)*(1.-.5*wet),0.,1.);
  float grass=smoothstep(.08,.30,(palette.g-palette.r)/max(luminance,.001))*(1.-rock)*(1.-.85*wet);
  return vec3(1.-rock-grass,grass,rock);
}
`);
  // The generated land is opaque. Its photo colour is sampled once at source
  // metre scales below, rather than multiplied by a dark palette then cancelled.
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','// Grounded valley photo layers are evaluated after the linear palette.');
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
#ifdef USE_MAP
  vec3 ealdholtPalette=vec3(uEaldholtValleyPhotoMean);
  #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
    ealdholtPalette=vColor.rgb;
  #endif
  vec2 ealdholtEarthUv=vEaldholtValleySourcePosition.xz*vec2(.5,-.5);
  vec2 ealdholtRockUv=vEaldholtValleySourcePosition.xz*vec2(.3125,-.3125);
  ${hasGrass?'vec2 ealdholtGrassUv=vEaldholtValleySourcePosition.xz*vec2(1./uEaldholtValleyGrassTileMetres,-1./uEaldholtValleyGrassTileMetres);':''}
  vec3 ealdholtEarthPhoto=ealdholtValleyPhoto(map,ealdholtEarthUv,0.).rgb;
  vec3 ealdholtTurfPhoto=ealdholtValleyPhoto(map,ealdholtEarthUv*.55,1.4).rgb;
  vec3 ealdholtMacroPhoto=ealdholtValleyPhoto(map,vEaldholtValleySourcePosition.xz*vec2(1./18.,-1./18.),5.).rgb;
  float ealdholtMacro=clamp(dot(ealdholtMacroPhoto,vec3(.2126,.7152,.0722))/uEaldholtValleyPhotoMean,.65,1.35);
  float ealdholtWet=ealdholtValleyWetness();
  // Only the transition shifts with coarse photographic structure. This is
  // not an added noise blanket over dry ground or a wider wet band.
  ealdholtWet=clamp(ealdholtWet+(ealdholtMacro-1.)*.15*ealdholtWet*(1.-ealdholtWet),0.,1.);
  vec3 ealdholtWeights=ealdholtValleyWeights(ealdholtPalette,ealdholtWet);
  float ealdholtPaletteMean=max(dot(ealdholtPalette,vec3(.2126,.7152,.0722)),.005);
  float ealdholtEarthReflectance=clamp(ealdholtPaletteMean/uEaldholtValleyPhotoMean,.45,1.8);
  vec3 ealdholtGrassChroma=ealdholtPalette/ealdholtPaletteMean;
  ${hasGrass?'// Actual CC0 grass RGB is retained; only scalar reflectance is normalized.':'// Fallback turf uses the source vegetation palette over quiet earth structure.'}
  vec3 ealdholtGrassPhoto=${hasGrass?'ealdholtValleyPhoto(uEaldholtValleyGrassAlbedo,ealdholtGrassUv,0.).rgb':'mix(ealdholtTurfPhoto,dot(ealdholtTurfPhoto,vec3(.2126,.7152,.0722))*ealdholtGrassChroma,.82)'};
  ${hasGrass?'float ealdholtGrassReflectance=clamp(ealdholtPaletteMean/uEaldholtValleyGrassMean,.45,1.8);':''}
  vec3 ealdholtRockPhoto=${options.rock?.albedo?'ealdholtValleyPhoto(uEaldholtValleyRockAlbedo,ealdholtRockUv,0.).rgb':'ealdholtEarthPhoto'};
  float ealdholtRockReflectance=clamp(mix(ealdholtPaletteMean,.085,.7)/uEaldholtValleyRockMean,.35,1.8);
  vec3 ealdholtSurface=ealdholtWeights.x*ealdholtEarthPhoto*ealdholtEarthReflectance
    +ealdholtWeights.y*ealdholtGrassPhoto*${hasGrass?'ealdholtGrassReflectance':'ealdholtEarthReflectance'}
    +ealdholtWeights.z*ealdholtRockPhoto*ealdholtRockReflectance;
  diffuseColor.rgb=ealdholtSurface*mix(1.,ealdholtMacro,.45)*mix(vec3(1.),vec3(.64,.67,.65),ealdholtWet);
#endif`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness;
#ifdef USE_MAP
  vec3 ealdholtEarthOrm=${options.earthOrm?'ealdholtValleyPhoto(uEaldholtValleyEarthOrm,ealdholtEarthUv,0.).rgb':'vec3(1.,.88,0.)'};
  vec3 ealdholtGrassOrm=${options.grass?.orm?'ealdholtValleyPhoto(uEaldholtValleyGrassOrm,ealdholtGrassUv,0.).rgb':options.earthOrm?'ealdholtValleyPhoto(uEaldholtValleyEarthOrm,ealdholtEarthUv*.55,1.4).rgb':'ealdholtEarthOrm'};
  vec3 ealdholtRockOrm=${options.rock?.orm?'ealdholtValleyPhoto(uEaldholtValleyRockOrm,ealdholtRockUv,0.).rgb':'ealdholtEarthOrm'};
  float ealdholtDryRoughness=ealdholtWeights.x*ealdholtEarthOrm.g+ealdholtWeights.y*${options.grass?.orm?'ealdholtGrassOrm.g':'max(.90,ealdholtGrassOrm.g)'}+ealdholtWeights.z*ealdholtRockOrm.g;
  roughnessFactor=clamp(mix(ealdholtDryRoughness,min(ealdholtDryRoughness,.42),ealdholtWet),.12,1.);
#endif`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
#ifdef USE_MAP
  vec3 ealdholtEarthNormal=${options.earthNormal?'ealdholtValleyPhoto(uEaldholtValleyEarthNormal,ealdholtEarthUv,0.).xyz*2.-1.':'vec3(0.,0.,1.)'};
  vec3 ealdholtGrassNormal=${options.grass?.normal?'ealdholtValleyPhoto(uEaldholtValleyGrassNormal,ealdholtGrassUv,0.).xyz*2.-1.':options.earthNormal?'ealdholtValleyPhoto(uEaldholtValleyEarthNormal,ealdholtEarthUv*.55,1.4).xyz*2.-1.':'ealdholtEarthNormal'};
  vec3 ealdholtRockNormal=${options.rock?.normal?'ealdholtValleyPhoto(uEaldholtValleyRockNormal,ealdholtRockUv,0.).xyz*2.-1.':'ealdholtEarthNormal'};
  vec3 ealdholtSurfaceNormal=normalize(vec3(ealdholtEarthNormal.xy*ealdholtWeights.x*.35+ealdholtGrassNormal.xy*ealdholtWeights.y*.10
    +ealdholtRockNormal.xy*ealdholtWeights.z*.60,max(.2,ealdholtEarthNormal.z*ealdholtWeights.x+ealdholtGrassNormal.z*ealdholtWeights.y+ealdholtRockNormal.z*ealdholtWeights.z)));
  // Derivative tangent frame follows the same source-metre projection as RGB
  // and ORM. View-space derivatives retain the Native root's actual pose.
  vec3 ealdholtQ0=dFdx(-vViewPosition),ealdholtQ1=dFdy(-vViewPosition);
  vec2 ealdholtSt0=dFdx(ealdholtEarthUv),ealdholtSt1=dFdy(ealdholtEarthUv);
  vec3 ealdholtN=normalize(normal),ealdholtQ1Perp=cross(ealdholtQ1,ealdholtN),ealdholtQ0Perp=cross(ealdholtN,ealdholtQ0);
  vec3 ealdholtT=ealdholtQ1Perp*ealdholtSt0.x+ealdholtQ0Perp*ealdholtSt1.x;
  vec3 ealdholtB=ealdholtQ1Perp*ealdholtSt0.y+ealdholtQ0Perp*ealdholtSt1.y;
  float ealdholtBasisSize=max(dot(ealdholtT,ealdholtT),dot(ealdholtB,ealdholtB));
  float ealdholtBasisScale=ealdholtBasisSize>0.?inversesqrt(ealdholtBasisSize):0.;
  normal=normalize((ealdholtT*ealdholtSurfaceNormal.x+ealdholtB*ealdholtSurfaceNormal.y)*ealdholtBasisScale+ealdholtN*ealdholtSurfaceNormal.z);
#else
  #include <normal_fragment_maps>
#endif`);
  if(shader.fragmentShader.includes('#include <aomap_fragment>'))shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`
#ifdef USE_MAP
  float ealdholtSurfaceAo=ealdholtEarthOrm.r*ealdholtWeights.x+ealdholtGrassOrm.r*ealdholtWeights.y+ealdholtRockOrm.r*ealdholtWeights.z;
  reflectedLight.indirectDiffuse*=mix(1.,ealdholtSurfaceAo,.8);
#else
  #include <aomap_fragment>
#endif`);
}
