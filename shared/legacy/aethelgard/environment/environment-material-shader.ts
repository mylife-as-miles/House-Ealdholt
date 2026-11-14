import {CLOUD_SAMPLE_GLSL} from './cloud-volume';
interface Shader{uniforms:Record<string,{value:unknown}>;vertexShader:string;fragmentShader:string}
/** Live material program identity only; static cloud/terrain bakes are unchanged. */
export const WORLD_ENVIRONMENT_SHADER_VERSION='queued-world-environment-v8';
/** Compose with imported PBR and existing GI/HLOD shader patches. All live
 * changes are uniform updates; no per-frame shader rebuilding or geometry upload. */
export function patchWorldEnvironmentMaterial(shader:Shader,uniforms:Record<string,{value:unknown}>,vegetation:boolean,water=false,directionalChunk?:string){
 if(shader.fragmentShader.includes('CROWNFALL_WORLD_ENVIRONMENT'))return;
 Object.assign(shader.uniforms,uniforms);
 // A source material may already own wind before this weather clone wraps
 // its compile hook. Share that vertex declaration and keep the live weather
 // uniform objects assigned above, just as in the weather-first patch order.
 const windUniforms=shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND')?'':'uniform mat4 cfEnvironmentToSource;uniform float cfEnvironmentSeconds;uniform float cfWindStrength;uniform vec2 cfWindDirection;';
 shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
 #define CROWNFALL_WORLD_ENVIRONMENT_VERTEX
 varying vec3 cfEnvironmentPoint;${windUniforms}uniform float cfSurfaceWeatherEnabled;`);
 if(vegetation)shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
  mat4 cfWindFrame=cfEnvironmentToSource*modelMatrix;
  #ifdef USE_INSTANCING
   cfWindFrame=cfWindFrame*instanceMatrix;
  #endif
  vec3 cfWindPoint=(cfWindFrame*vec4(transformed,1.)).xyz;
  float cfHeight=abs(transformed.y)*length(cfWindFrame[1].xyz);
  float cfBend=sin(dot(cfWindPoint.xz,vec2(.083,.061))-cfEnvironmentSeconds*.9)*.07*cfWindStrength*cfSurfaceWeatherEnabled*clamp(cfHeight*.12,0.,1.);
  if(abs(determinant(mat3(cfWindFrame)))>.0000000001)transformed+=inverse(mat3(cfWindFrame))*vec3(cfWindDirection.x*cfBend,0.,cfWindDirection.y*cfBend);`);
 shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
  vec4 cfEnvironmentWorld=vec4(transformed,1.);
  #ifdef USE_INSTANCING
   cfEnvironmentWorld=instanceMatrix*cfEnvironmentWorld;
  #endif
  cfEnvironmentPoint=(cfEnvironmentToSource*modelMatrix*cfEnvironmentWorld).xyz;`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
 #define CROWNFALL_WORLD_ENVIRONMENT
 varying vec3 cfEnvironmentPoint;uniform float cfWorldWetness;uniform float cfRain;uniform vec3 cfSkyHorizon;uniform vec3 cfSkyZenith;uniform float cfDaylight;uniform mat4 cfEnvironmentToSource;
 ${CLOUD_SAMPLE_GLSL}`);
 if(water)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
 float cfDrops=sin(cfEnvironmentPoint.x*23.+cfEnvironmentSeconds*8.)*cos(cfEnvironmentPoint.z*21.-cfEnvironmentSeconds*6.);
 normal=normalize(normal+vec3(cfDrops*.025*cfRain,cfDrops*.018*cfRain,0.));`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
  ${water?'roughnessFactor=mix(roughnessFactor,.31,cfRain*.6);':'roughnessFactor=max(.08,roughnessFactor*mix(1.,.61,cfWorldWetness));diffuseColor.rgb*=mix(1.,.85,cfWorldWetness);'}`);
 const seam='getDirectionalLightInfo( directionalLight, directLight );';
 if(shader.fragmentShader.includes('#include <lights_fragment_begin>')||shader.fragmentShader.includes(seam)){
  if(shader.fragmentShader.includes('#include <lights_fragment_begin>')){
   if(!directionalChunk?.includes(seam))throw Error('Unsupported directional cloud-light seam.');
   shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',directionalChunk);
  }
  // Point lights, hearths and the opposite moon are not sunlight. Match the
  // authoritative source-space sun before applying its cloud transmittance.
  // Three unrolls this loop without an iteration scope. Keep the temporary
  // local to this light so two or more directional lights compile correctly.
  shader.fragmentShader=shader.fragmentShader.replace(seam,seam+`
  {
   vec3 cfDirectionalWorld=inverseTransformDirection(directLight.direction,viewMatrix);
   if(dot(cfDirectionalWorld,cfWorldSun)>.9999)directLight.color*=cfCloudSunGain(cfCloudWorldPoint(cfEnvironmentPoint));
  }
  `);
 }
 shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
  ${water?`vec3 cfReflect=normalize(transpose(mat3(viewMatrix))*reflect(-normalize(vViewPosition),normal));
  vec3 cfWaterWorld=cfCloudWorldPoint(cfEnvironmentPoint);
  vec3 cfReflectedSky=mix(cfSkyHorizon,cfSkyZenith,sqrt(clamp(cfReflect.y,0.,1.)));
  if(cfReflect.y>.04){vec2 cfCloudXZ=cfWaterWorld.xz+cfReflect.xz*(900.-cfWaterWorld.y)/cfReflect.y+cfCloudOffset;
    float cfReflectionCloud=cfCloudSample(vec3(cfCloudXZ.x/6000.,.5,cfCloudXZ.y/6000.));cfReflectedSky=mix(cfReflectedSky,vec3(.7,.73,.74)*mix(.04,1.,cfDaylight),cfReflectionCloud*.8);}
  float cfFresnel=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),5.);
  float cfWaterSkyMix=.25+cfFresnel*.45;
  #ifdef CROWNFALL_COASTAL_WATER_SHORE_COLOR
   // The regional shore patch owns this source-distance scalar, even without
   // textures. Do not paint a flat sky-colour rim over its wet bank contact.
   cfWaterSkyMix*=1.-ealdholtShoreContact;
  #endif
  reflectedLight.indirectSpecular=mix(reflectedLight.indirectSpecular,cfReflectedSky*.55,cfWaterSkyMix);`:''}`);
}
