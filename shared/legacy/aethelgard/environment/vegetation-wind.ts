/** Presentation only: source-space metres, shared by real foliage and captures.
 * Roots and collision data stay at rest. No placement or occupancy rebakes. */
export const VEGETATION_WIND_SHADER_VERSION='zero-strength-fast-path-v2';
export interface VegetationWindBinding {
 readonly root: readonly [number,number,number];
 readonly tip: readonly [number,number,number];
 readonly grass: boolean;
}
/** Cache identity only. Inverse actor frames carry ~1e-14 numerical noise;
 * match the existing HLOD prototype tolerance without rounding live uniforms. */
export function vegetationWindBindingKey(binding:VegetationWindBinding):string {
 const metric=(value:number)=>Math.round(value*1e7)/1e7;
 return JSON.stringify({root:binding.root.map(metric),tip:binding.tip.map(metric),grass:binding.grass});
}
export function vegetationWindBend(height:number,totalHeight:number,seconds:number,root:readonly[number,number],strength:number,grass=false):number {
 const weight=Math.max(0,Math.min(1,height/Math.max(.001,totalHeight)));
 if(weight===0||strength<=0)return 0;
 const gust=Math.sin(root[0]*.083+root[1]*.061-seconds*.9)*.75+Math.sin(root[0]*.027-root[1]*.049-seconds*.37)*.25;
 return Math.min(totalHeight,20)*(grass?.11:.018)*Math.max(0,Math.min(1,strength))*weight*weight*gust;
}
interface Shader {uniforms:Record<string,{value:unknown}>;vertexShader:string;fragmentShader:string}
/** Called after the source/impostor vertex patch, before weather. A single
 * source frame handles rotated/scaled GLBs and instancing without moving roots. */
export function patchVegetationWind(shader:Shader,uniforms:Record<string,{value:unknown}>,binding:VegetationWindBinding):void {
 if(shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND'))return;
 Object.assign(shader.uniforms,uniforms,{
  cfWindRoot:{value:{x:binding.root[0],y:binding.root[1],z:binding.root[2]}},
  cfWindTip:{value:{x:binding.tip[0],y:binding.tip[1],z:binding.tip[2]}},cfWindFlex:{value:binding.grass?.11:.018}
 });
 const weather=shader.vertexShader.includes('CROWNFALL_WORLD_ENVIRONMENT_VERTEX');
 const declarations=weather?'':'uniform mat4 cfEnvironmentToSource; uniform float cfEnvironmentSeconds; uniform float cfWindStrength; uniform vec2 cfWindDirection;';
 // GLSL globals must precede helpers that reference them. The full weather
 // patch owns those declarations; wind-only programs declare their own here.
 const common=weather?'uniform float cfSurfaceWeatherEnabled;':'#include <common>';
 shader.vertexShader=shader.vertexShader.replace(common,`${common}
 #define CROWNFALL_VEGETATION_WIND
 ${declarations}
 uniform vec3 cfWindRoot; uniform vec3 cfWindTip; uniform float cfWindFlex;
 mat4 cfWindActorFrame(){mat4 frame=cfEnvironmentToSource*modelMatrix;
 #ifdef USE_INSTANCING
 frame=frame*instanceMatrix;
 #endif
 return frame;}
 vec2 cfWindCurve(vec3 point,mat4 frame){
 vec3 anchor=(frame*vec4(cfWindRoot,1.)).xyz;
 float height=max(.001,abs((frame*vec4(cfWindTip,1.)).y-anchor.y));
 float weight=clamp((point.y-anchor.y)/height,0.,1.);
 if(weight<=0.)return vec2(0.);
 float gust=sin(dot(anchor.xz,vec2(.083,.061))-cfEnvironmentSeconds*.9)*.75+sin(dot(anchor.xz,vec2(.027,-.049))-cfEnvironmentSeconds*.37)*.25;
 float amplitude=min(height,20.)*cfWindFlex*cfWindStrength*gust;
 return vec2(amplitude*weight*weight,point.y>anchor.y&&point.y<anchor.y+height?amplitude*2.*weight/height:0.);}
 mat3 cfWindNormalCorrection(mat4 frame,float slope){
 return mat3(1.)-outerProduct(transpose(mat3(frame))*vec3(0.,1.,0.),inverse(mat3(frame))*vec3(cfWindDirection.x,0.,cfWindDirection.y))*slope;
 }`);
 const captured=shader.vertexShader.includes('vCrownfallAtlasNormal');
 if(!captured)shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>',`
 if(cfWindStrength!=0.){
 mat4 cfNormalFrame=cfWindActorFrame();
 if(abs(determinant(mat3(cfNormalFrame)))>.0000000001)objectNormal=cfWindNormalCorrection(cfNormalFrame,cfWindCurve((cfNormalFrame*vec4(position,1.)).xyz,cfNormalFrame).y)*objectNormal;
 }
 #include <defaultnormal_vertex>`);
 // At this seam captured cards have already been rebuilt in their actor frame.
 // Inserting before morphing/project also preserves existing thinning patches.
 shader.vertexShader=shader.vertexShader.replace('#include <morphtarget_vertex>',`
 if(cfWindStrength!=0.){
 mat4 cfWindFrame=cfWindActorFrame();
 vec3 cfWindPoint=(cfWindFrame*vec4(transformed,1.)).xyz;
 vec2 cfWindShape=cfWindCurve(cfWindPoint,cfWindFrame);
 if(abs(determinant(mat3(cfWindFrame)))>.0000000001){
 transformed+=inverse(mat3(cfWindFrame))*vec3(cfWindDirection.x*cfWindShape.x,0.,cfWindDirection.y*cfWindShape.x);
 ${captured?'vCrownfallAtlasNormal=vCrownfallAtlasNormal*cfWindNormalCorrection(cfWindFrame,cfWindShape.y);':''}
 }
 }
 #include <morphtarget_vertex>`);
}
