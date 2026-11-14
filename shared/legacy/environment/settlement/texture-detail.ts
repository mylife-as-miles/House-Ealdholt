/** Owned procedural textures supply fine luminance/normal detail while the
 * authored autumn palette stays intact. Local material hook; no global chunks. */
export function applySettlementTextureDetail(material:any,meanLuminance:number,strength=.65):void {
 if(!material?.map||material.userData.settlementTextureDetail)return;
 material.userData.settlementTextureDetail=true;
 const mean=Math.max(.006,Math.min(1,meanLuminance)),previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
 material.onBeforeCompile=function(shader:any,renderer:any){
  previous.call(this,shader,renderer);
  shader.uniforms.uSettlementDetailMean={value:mean};shader.uniforms.uSettlementDetailStrength={value:strength};
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uSettlementDetailMean;\nuniform float uSettlementDetailStrength;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec3 settlementBaseDiffuse=diffuseColor.rgb;
#include <map_fragment>
#ifdef USE_MAP
 float settlementDetail=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722))/uSettlementDetailMean;
 diffuseColor.rgb=settlementBaseDiffuse*clamp(mix(1.,settlementDetail,uSettlementDetailStrength),.56,1.55);
#endif`);
 };
 material.customProgramCacheKey=function(){return previousKey.call(this)+':settlement-owned-detail';};
}
