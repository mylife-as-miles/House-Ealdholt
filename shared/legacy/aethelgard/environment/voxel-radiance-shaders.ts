import {CLOUD_SAMPLE_GLSL, CLOUD_SAMPLING_VERSION} from './cloud-volume';
import {VOXEL_INDIRECT_GAIN} from './voxel-indirect';
/** WebGL2 adaptation of the reference's split static transport/live volume
 * lighting. Fixed surface/air transport with two fresh-seed indirect steps; no path tracer or source rebake. */
export const VOXEL_RADIANCE_VERSION = 'webgl2-surface-air-multibounce-v3:' + CLOUD_SAMPLING_VERSION;
export const VOXEL_PASS_VERTEX = /* glsl */`
varying vec2 cfVolumeUv;
void main() {cfVolumeUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0);}
`;
export const VOXEL_PASS_COMMON = /* glsl */`
precision highp float;
uniform sampler2D cfOccupancy;
uniform sampler2D cfTransport;
uniform sampler2D cfSourceRadiance;
uniform sampler2D cfBounceSeed;
uniform vec3 cfResolution;
uniform vec3 cfGridMin;
uniform vec3 cfGridSize;
uniform vec2 cfAtlasSize;
uniform float cfColumns;
uniform float cfRadianceScale;
uniform vec3 cfSunDirection;
uniform vec3 cfSunRadiance;
uniform vec3 cfSkyRadiance;
uniform float cfCloudTransmission;
uniform vec4 cfLocalPositionRadius[16];
uniform vec3 cfLocalRadiance[16];
uniform int cfLocalCount;
vec2 cfVoxelUv(vec3 cell) {
  float z = floor(cell.z);
  return (vec2(mod(z, cfColumns) * cfResolution.x, floor(z / cfColumns) * cfResolution.y) + floor(cell.xy) + .5) / cfAtlasSize;
}
bool cfInside(vec3 cell) {return all(greaterThanEqual(cell, vec3(0.0))) && all(lessThan(cell, cfResolution));}
vec4 cfOccupant(vec3 cell) {if (!cfInside(cell)) return vec4(0.0); return texture2D(cfOccupancy, cfVoxelUv(cell));}
vec3 cfFragmentCell() {
  vec2 tile = floor(gl_FragCoord.xy / cfResolution.xy);
  return vec3(mod(gl_FragCoord.xy, cfResolution.xy), tile.y * cfColumns + tile.x);
}
float cfSunVisibility(vec3 start) {
  if (cfSunDirection.y < -.01) return 0.0;
  vec3 stride = cfSunDirection / (cfGridSize / cfResolution);
  stride /= max(.0001, max(abs(stride.x), max(abs(stride.y), abs(stride.z))));
  vec3 cell = floor(start) + .5; float transmission = 1.0;
  for (int i = 0; i < 32; i++) {
    cell += stride;
    if (!cfInside(cell)) break;
    transmission *= 1.0 - cfOccupant(cell).a;
    if (transmission < .005) break;
  }
  return transmission;
}
`;
/** Sources live on the EMPTY side of occupied faces. This prevents an opaque
 * isotropic wall voxel from emitting its front-face firelight through its back. */
export const VOXEL_SURFACE_GATHER = /* glsl */`
vec3 cfFaceDirection(int i) {
  if(i==0)return vec3(1,0,0);if(i==1)return vec3(-1,0,0);
  if(i==2)return vec3(0,1,0);if(i==3)return vec3(0,-1,0);
  if(i==4)return vec3(0,0,1);return vec3(0,0,-1);
}
vec4 cfSurface(vec3 cell) {
  vec3 albedo=vec3(0.0);float weight=0.0,coverage=0.0;
  for(int face=0;face<6;face++){vec4 neighbour=cfOccupant(cell+cfFaceDirection(face));albedo+=neighbour.rgb*neighbour.a;weight+=neighbour.a;coverage=max(coverage,neighbour.a);}
  return vec4(albedo/max(.0001,weight),coverage*(1.0-cfOccupant(cell).a));
}
float cfSurfaceFacing(vec3 cell,vec3 direction) {
  float sum=0.0,weight=0.0;
  for(int face=0;face<6;face++){vec3 d=cfFaceDirection(face);float a=cfOccupant(cell+d).a;sum+=a*max(0.0,dot(-d,direction));weight+=a;}
  return sum/max(.0001,weight);
}
vec3 cfRadiance(vec3 cell){vec3 encoded=texture2D(cfSourceRadiance,cfVoxelUv(cell)).rgb;return encoded*encoded;}
vec3 cfEncodeRadiance(vec3 linear){return sqrt(clamp(linear,0.0,1.0));}
vec3 cfGatherDirection(int i) {
  if(i<6)return cfFaceDirection(i);
  if(i==6)return normalize(vec3(1,1,0));if(i==7)return normalize(vec3(-1,1,0));
  if(i==8)return normalize(vec3(0,1,1));return normalize(vec3(0,1,-1));
}
vec3 cfGather(vec3 cell) {
  vec3 result=vec3(0.0),cellMetres=cfGridSize/cfResolution;
  for(int direction=0;direction<10;direction++){
    vec3 worldDirection=cfGatherDirection(direction),ray=worldDirection/cellMetres;
    ray/=max(.0001,max(abs(ray.x),max(abs(ray.y),abs(ray.z))));float transmission=1.0;
    for(int step=1;step<=8;step++){
      vec3 sampleCell=floor(cell)+.5+ray*float(step);if(!cfInside(sampleCell))break;
      vec3 reflected=cfRadiance(sampleCell);float outgoing=0.0;
      if(dot(reflected,vec3(1.0))>0.0)outgoing=cfSurfaceFacing(sampleCell,-worldDirection);
      // At most one visible oriented surface per ray. Empty-field energy does
      // not accumulate repeatedly along a row; opaque walls terminate transport.
      if(outgoing>0.0){float distance=length(ray*cellMetres*float(step));result+=reflected*outgoing*transmission/(1.0+distance*distance*.04);break;}
      transmission*=1.0-cfOccupant(sampleCell).a;if(transmission<.005)break;
    }
  }
  return result/10.0;
}
`;
export const VOXEL_SOURCE_FRAGMENT=VOXEL_PASS_COMMON+CLOUD_SAMPLE_GLSL+VOXEL_SURFACE_GATHER+/* glsl */`
float cfLocalVisibility(vec3 start,vec3 point){
  vec3 target=(point-cfGridMin)/cfGridSize*cfResolution,delta=target-(floor(start)+.5);
  float distance=max(abs(delta.x),max(abs(delta.y),abs(delta.z)));if(distance<1.0)return 1.0;
  vec3 stride=delta/distance;float transmission=1.0;
  for(int step=1;step<=128;step++){
    if(float(step)>=distance)break;vec3 sampleCell=floor(start)+.5+stride*float(step);
    if(!cfInside(sampleCell)||all(equal(floor(sampleCell),floor(target))))break;
    transmission*=1.0-cfOccupant(sampleCell).a;if(transmission<.005)break;
  }
  return transmission;
}
void main(){
  vec3 cell=cfFragmentCell();if(!cfInside(cell)){gl_FragColor=vec4(0.0);return;}
  float sunlight=cfSunVisibility(cell);vec4 surface=cfSurface(cell);
  if(surface.a<.0001){gl_FragColor=vec4(0.0,0.0,0.0,sunlight);return;}
  vec4 transport=texture2D(cfTransport,cfVoxelUv(cell));vec3 bent=transport.rgb*2.0-1.0;bent/=max(.0001,length(bent));
  vec3 point=cfGridMin+(floor(cell)+.5)*cfGridSize/cfResolution;
  vec3 illumination=cfSkyRadiance*transport.a*(.25+.75*cfSurfaceFacing(cell,bent))
    +cfSunRadiance*sunlight*cfSurfaceFacing(cell,cfSunDirection)*cfCloudTransmission*cfCloudSunGain(cfCloudWorldPoint(point));
  for(int i=0;i<16;i++){
    if(i>=cfLocalCount)break;vec3 delta=cfLocalPositionRadius[i].xyz-point;
    float distance=length(delta),radius=max(.01,cfLocalPositionRadius[i].w),falloff=max(0.0,1.0-distance/radius);
    if(falloff>0.0)illumination+=cfLocalRadiance[i]*falloff*falloff*cfLocalVisibility(cell,cfLocalPositionRadius[i].xyz)
      *cfSurfaceFacing(cell,delta/max(.0001,distance))/(1.0+distance*distance*.1);
  }
  gl_FragColor=vec4(cfEncodeRadiance(surface.rgb*surface.a*illumination/cfRadianceScale),sunlight);
}
`;
/** S[k+1]=S[0]+gain*albedo*surfaceCoverage*gather(S[k]). Fresh S[0]
 * is immutable throughout the relight; previous published fields are NEVER
 * reinjected. The operator norm is <=gain<1, including fractional occupancy. */
export const VOXEL_BOUNCE_FRAGMENT=VOXEL_PASS_COMMON+VOXEL_SURFACE_GATHER+/* glsl */`
void main(){
  vec3 cell=cfFragmentCell();if(!cfInside(cell)){gl_FragColor=vec4(0.0);return;}
  vec4 seed=texture2D(cfBounceSeed,cfVoxelUv(cell)),surface=cfSurface(cell);
  if(surface.a<.0001){gl_FragColor=seed;return;}
  vec3 direct=seed.rgb*seed.rgb;
  gl_FragColor=vec4(cfEncodeRadiance(direct+${VOXEL_INDIRECT_GAIN.toFixed(8)}*surface.rgb*surface.a*cfGather(cell)),seed.a);
}
`;
export const VOXEL_GATHER_FRAGMENT=VOXEL_PASS_COMMON+VOXEL_SURFACE_GATHER+/* glsl */`
void main(){
  vec3 cell=cfFragmentCell();if(!cfInside(cell)){gl_FragColor=vec4(0.0);return;}
  gl_FragColor=vec4(cfEncodeRadiance(cfGather(cell)),texture2D(cfTransport,cfVoxelUv(cell)).a);
}
`;

const MATERIAL_SAMPLE = /* glsl */`
uniform sampler2D cfGiRadiance;
uniform sampler2D cfGiSunVisibility;
uniform mat4 cfGiWorldToSource;
uniform vec3 cfGiMin;
uniform vec3 cfGiSize;
uniform vec3 cfGiResolution;
uniform vec2 cfGiAtlasSize;
uniform float cfGiColumns;
uniform float cfGiEnabled;
uniform float cfGiRadianceScale;
uniform float cfGiSunShadow;
uniform vec3 cfGiSunWorldDirection;
varying vec3 cfGiWorldPosition;
vec2 cfGiUv(vec3 cell) {
  cell = clamp(cell, vec3(0.0), cfGiResolution - 1.0);
  return (vec2(mod(cell.z, cfGiColumns) * cfGiResolution.x, floor(cell.z / cfGiColumns) * cfGiResolution.y) + cell.xy + .5) / cfGiAtlasSize;
}
vec4 cfGiFetch(sampler2D field,vec3 cell){vec4 value=texture2D(field,cfGiUv(cell));value.rgb*=value.rgb;return value;}
vec4 cfGiSample(sampler2D field, vec3 source) {
  vec3 grid = (source - cfGiMin) / cfGiSize * cfGiResolution - .5;
  vec3 base = floor(grid), f = fract(grid);
  vec4 a = mix(cfGiFetch(field, base), cfGiFetch(field, base + vec3(1,0,0)), f.x);
  vec4 b = mix(cfGiFetch(field, base + vec3(0,1,0)), cfGiFetch(field, base + vec3(1,1,0)), f.x);
  vec4 c = mix(cfGiFetch(field, base + vec3(0,0,1)), cfGiFetch(field, base + vec3(1,0,1)), f.x);
  vec4 d = mix(cfGiFetch(field, base + vec3(0,1,1)), cfGiFetch(field, base + vec3(1,1,1)), f.x);
  return mix(mix(a,b,f.y), mix(c,d,f.y), f.z);
}
float cfGiWeight(vec3 source) {
  vec3 p = (source - cfGiMin) / cfGiSize * cfGiResolution;
  vec3 edge = min(p, cfGiResolution - p);
  return cfGiEnabled * smoothstep(0.0, 2.0, min(edge.x, min(edge.y, edge.z)));
}
vec3 cfGiReceiver(vec3 viewNormal) {
  vec3 worldNormal = inverseTransformDirection(viewNormal, viewMatrix);
  vec3 sourceNormal = normalize(mat3(cfGiWorldToSource) * worldNormal);
  return (cfGiWorldToSource * vec4(cfGiWorldPosition,1.0)).xyz + sourceNormal * cfGiSize / cfGiResolution * .7;
}
`;
export interface VoxelMaterialShader {uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string;}
/** Preserve PBR/skinning/morph/cutout code. Replace the ambient term locally,
 * attenuate diffuse IBL under canopy and keep environment specular intact. */
export function patchVoxelMaterial(shader: VoxelMaterialShader, uniforms: Record<string, unknown>, directionalChunk: string): void {
  if (shader.fragmentShader.includes('uniform sampler2D cfGiRadiance;')) {Object.assign(shader.uniforms, uniforms); return;}
  const directSeam = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <lights_fragment_maps>')
    || (!shader.fragmentShader.includes('#include <lights_fragment_begin>') && !shader.fragmentShader.includes(directSeam)) || !directionalChunk.includes(directSeam)) throw Error('Unsupported voxel GI material shader seams.');
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 cfGiWorldPosition;')
    .replace('#include <project_vertex>', `#include <project_vertex>
vec4 cfGiWorld = vec4(transformed, 1.0);
#ifdef USE_BATCHING
cfGiWorld = batchingMatrix * cfGiWorld;
#endif
#ifdef USE_INSTANCING
cfGiWorld = instanceMatrix * cfGiWorld;
#endif
cfGiWorldPosition = (modelMatrix * cfGiWorld).xyz;`);
  const direct = (shader.fragmentShader.includes('#include <lights_fragment_begin>') ? directionalChunk : shader.fragmentShader).replace(directSeam, `getDirectionalLightInfo( directionalLight, directLight );
directLight.color *= mix(1.0, cfGiSample(cfGiSunVisibility, cfGiReceiver(geometryNormal)).a,
  cfGiWeight(cfGiReceiver(geometryNormal)) * cfGiSunShadow * step(.999, dot(inverseTransformDirection(directLight.direction, viewMatrix), cfGiSunWorldDirection)));`);
  if (shader.fragmentShader.includes('#include <lights_fragment_begin>')) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', direct);
  else shader.fragmentShader = direct;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + MATERIAL_SAMPLE)
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse )
vec3 cfGiPoint = cfGiReceiver(geometryNormal);
float cfGiBlend = cfGiWeight(cfGiPoint);
vec4 cfGiValue = cfGiSample(cfGiRadiance, cfGiPoint);
irradiance = mix(irradiance, cfGiValue.rgb * cfGiRadianceScale * PI, cfGiBlend);
iblIrradiance *= mix(1.0, cfGiValue.a, cfGiBlend);
#endif`);
}
