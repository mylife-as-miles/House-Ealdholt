export const BUILDING_DAMAGE_PROGRAM_KEY=':crownfall-building-burn:affine-char-v1';
const MARKER='#define CROWNFALL_SOURCE_BUILDING_DAMAGE';
interface DamageShader {vertexShader:string;fragmentShader:string}
const once=(source:string,seam:string,replacement:string)=>{
 if(source.split(seam).length!==2)throw Error('Building damage requires exactly one '+seam+' seam.');
 return source.replace(seam,replacement);
};
/** GPU presentation alone: CPU source positions/instance ordinals remain exact.
 * The affine has positive determinant; its cofactor preserves correct normals.
 * No new samplers, lighting ownership, time reads or geometry cache keys. */
export function patchBuildingDamageShader(shader:DamageShader,instanced:boolean,shadow:boolean):void {
 if(shader.vertexShader.includes(MARKER))return;
 const declarations=`${MARKER}
${instanced?'attribute':'uniform'} vec4 cfBuildingRow0;
${instanced?'attribute':'uniform'} vec4 cfBuildingRow1;
${instanced?'attribute':'uniform'} vec4 cfBuildingRow2;
${instanced?'attribute':'uniform'} float cfBuildingChar;
varying float vCfBuildingChar;
mat3 cfBuildingLinear(){return mat3(
 vec3(cfBuildingRow0.x,cfBuildingRow1.x,cfBuildingRow2.x),
 vec3(cfBuildingRow0.y,cfBuildingRow1.y,cfBuildingRow2.y),
 vec3(cfBuildingRow0.z,cfBuildingRow1.z,cfBuildingRow2.z));}
`;
 let vertex=once(shader.vertexShader,'#include <common>','#include <common>\n'+declarations);
 vertex=once(vertex,'#include <begin_vertex>',`#include <begin_vertex>
 if(cfBuildingChar>0.0){
 vec4 cfBuildingPoint=vec4(transformed,1.0);
 transformed=vec3(dot(cfBuildingRow0,cfBuildingPoint),dot(cfBuildingRow1,cfBuildingPoint),dot(cfBuildingRow2,cfBuildingPoint));
 }
 vCfBuildingChar=clamp(cfBuildingChar,0.0,1.0);`);
 if(!shadow)vertex=once(vertex,'#include <beginnormal_vertex>',`#include <beginnormal_vertex>
 if(cfBuildingChar>0.0){
 mat3 cfBuildingA=cfBuildingLinear();
 objectNormal=mat3(cross(cfBuildingA[1],cfBuildingA[2]),cross(cfBuildingA[2],cfBuildingA[0]),cross(cfBuildingA[0],cfBuildingA[1]))*objectNormal;
 #ifdef USE_TANGENT
 objectTangent=cfBuildingA*objectTangent;
 #endif
 }`);
 let fragment=shader.fragmentShader;
 if(!shadow){
  fragment=once(fragment,'#include <common>','#include <common>\nvarying float vCfBuildingChar;');
  fragment=once(fragment,'#include <color_fragment>',`#include <color_fragment>
 diffuseColor.rgb*=mix(vec3(1.0),vec3(.085,.072,.058),vCfBuildingChar);`);
  fragment=once(fragment,'#include <lights_physical_fragment>',`roughnessFactor=max(roughnessFactor,.94*vCfBuildingChar);
 metalnessFactor*=1.0-vCfBuildingChar;
 #include <lights_physical_fragment>`);
 }
 shader.vertexShader=vertex;shader.fragmentShader=fragment;
}
