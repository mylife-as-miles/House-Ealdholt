import assert from 'node:assert/strict';
import test from 'node:test';
import {CLOUD_SAMPLE_GLSL} from './cloud-volume';
import {patchWorldEnvironmentMaterial} from './environment-material-shader';
import {patchVoxelMaterial,VOXEL_SOURCE_FRAGMENT,VOXEL_GATHER_FRAGMENT,VOXEL_BOUNCE_FRAGMENT} from './voxel-radiance-shaders';
const directional='getPointLightInfo( pointLight, geometryPosition, directLight );\ngetDirectionalLightInfo( directionalLight, directLight );';
function shader(){return{uniforms:{},vertexShader:'#include <common>\n#include <worldpos_vertex>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>\n#include <lights_fragment_end>'};}

test('cloud and voxel PBR patches compose in either order with one shared cloud sampler',()=>{
 for(const cloudsFirst of [true,false]){
  const s=shader();
  if(cloudsFirst){patchWorldEnvironmentMaterial(s,{},false,false,directional);patchVoxelMaterial(s,{},directional);}
  else{patchVoxelMaterial(s,{},directional);patchWorldEnvironmentMaterial(s,{},false,false,directional);}
  assert.equal((s.fragmentShader.match(/uniform highp sampler3D cfCloudDensity;/g)??[]).length,1);
  assert.equal((s.fragmentShader.match(/cfCloudSunGain\(cfCloudWorldPoint\(cfEnvironmentPoint\)\)/g)??[]).length,1);
  assert.equal((s.fragmentShader.match(/cfGiSample\(cfGiSunVisibility, cfGiReceiver\(geometryNormal\)\)/g)??[]).length,1);
  assert.match(s.fragmentShader,/getPointLightInfo\( pointLight, geometryPosition, directLight \);\ngetDirectionalLightInfo/,'Point lights keep their authored light info.');
  assert.doesNotMatch(s.fragmentShader,/reflectedLight\.direct(?:Diffuse|Specular)\s*\*=/,'Clouds must not dim every local light.');
  assert.ok(s.fragmentShader.includes('if(dot(cfDirectionalWorld,cfWorldSun)>.9999)'));
 }
});

test('GI samples the same moving cloud field only for bounced sun; source alpha stays geometric',()=>{
 assert.equal((VOXEL_SOURCE_FRAGMENT.match(/uniform highp sampler3D cfCloudDensity;/g)??[]).length,1);
 assert.equal((VOXEL_GATHER_FRAGMENT.match(/sampler3D/g)??[]).length,0,'Only the low-count source pass borrows the cloud sampler.');
 assert.equal((VOXEL_BOUNCE_FRAGMENT.match(/sampler3D/g)??[]).length,0,'Indirect iterations transport the seed; they never apply cloud shadow again.');
 assert.match(VOXEL_SOURCE_FRAGMENT,/cfSunRadiance\*sunlight\*cfSurfaceFacing\(cell,cfSunDirection\)\*cfCloudTransmission\*cfCloudSunGain\(cfCloudWorldPoint\(point\)\)/);
 assert.match(VOXEL_SOURCE_FRAGMENT,/cfEncodeRadiance\(surface.rgb\*surface.a\*illumination\/cfRadianceScale\),sunlight\)/,'Do not apply cloud shadow twice through direct-light visibility alpha.');
 assert.ok(VOXEL_SOURCE_FRAGMENT.indexOf('cfCloudSunGain(cfCloudWorldPoint(point))')<VOXEL_SOURCE_FRAGMENT.indexOf('illumination+=cfLocalRadiance'));
 assert.match(VOXEL_SOURCE_FRAGMENT,/height-point.y/,'Cloud shadow projection accounts for terrain altitude.');
 assert.match(VOXEL_SOURCE_FRAGMENT,/for\(int i=0;i<4;i\+\+\)/,'Cloud ray budget stays at four taps.');
});


test('relative cloud sunlight replaces the baseline only when a valid local field is enabled',()=>{
 assert.match(CLOUD_SAMPLE_GLSL,/cfCloudLightingEnabled<.5\?1\.:cfCloudSunTransmission\(point\)\/max\(\.01,cfCloudGlobalTransmission\)/);
 assert.doesNotMatch(CLOUD_SAMPLE_GLSL,/cfSurfaceWeatherEnabled<.5\?1\.:cfCloudSunTransmission/,'Rain/wetness availability must not enable missing cloud lighting.');
});
