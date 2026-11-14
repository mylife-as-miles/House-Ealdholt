import test from 'node:test';
import assert from 'node:assert/strict';
import {patchVegetationWind,vegetationWindBend,vegetationWindBindingKey,VEGETATION_WIND_SHADER_VERSION} from './vegetation-wind';
import {patchWorldEnvironmentMaterial} from './environment-material-shader';
import {patchVegetationImpostor} from './vegetation-shaders';

const binding={root:[0,.176,0] as const,tip:[0,8.176,0] as const,grass:false};
function shader(){return {uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <lights_fragment_end>'};}

test('binding cache identity ignores actor-inverse noise without rounding measured uniforms or merging distinct plants',()=>{
 const noisy={root:[-1e-14,.176+1e-14,2e-14] as const,tip:[1e-14,8.176-1e-14,-2e-14] as const,grass:false};
 assert.equal(vegetationWindBindingKey(noisy),vegetationWindBindingKey(binding));
 assert.notEqual(vegetationWindBindingKey({...binding,tip:[0,8.17601,0]}),vegetationWindBindingKey(binding));
 const draw=shader();patchVegetationWind(draw,{},noisy);
 assert.deepEqual(draw.uniforms.cfWindRoot.value,{x:-1e-14,y:.176+1e-14,z:2e-14});
 assert.deepEqual(draw.uniforms.cfWindTip.value,{x:1e-14,y:8.176-1e-14,z:-2e-14});
});

test('wind leaves roots and below-collar foliage fixed, with bounded canopy and grass movement',()=>{
 for(let second=0;second<20;second+=.5){
  assert.equal(vegetationWindBend(0,8,second,[15,20],1),0);
  assert.equal(vegetationWindBend(-.3,8,second,[15,20],1),0);
  assert.equal(vegetationWindBend(8,8,second,[15,20],0),0);
  assert.ok(Math.abs(vegetationWindBend(8,8,second,[15,20],1))<=.144);
  assert.ok(Math.abs(vegetationWindBend(.6,.6,second,[15,20],1,true))<=.066);
 }
 assert.notEqual(vegetationWindBend(8,8,0,[15,20],1),vegetationWindBend(8,8,.1,[15,20],1));
});

test('wind composes with captured-card reconstruction and preserves relit normal correction',()=>{
 const draw=shader();patchVegetationImpostor(draw);patchVegetationWind(draw,{},binding);
 assert.ok(draw.vertexShader.indexOf('transformed=crownfallAtlasCentre')<draw.vertexShader.indexOf('vec3 cfWindPoint'));
 assert.match(draw.vertexShader,/vCrownfallAtlasNormal=vCrownfallAtlasNormal\*cfWindNormalCorrection/);
 assert.deepEqual(draw.uniforms.cfWindRoot.value,{x:0,y:.176,z:0});
 assert.match(draw.vertexShader,/cfEnvironmentToSource\*modelMatrix/);
 assert.match(draw.vertexShader,/frame=frame\*instanceMatrix/);
});

test('wind-only colour, depth and distance programs need no cloud texture or fragment effects',()=>{
 for(const kind of ['colour','depth','distance']){
  const draw=shader(),fragment=draw.fragmentShader;patchVegetationWind(draw,{},binding);
  assert.equal(draw.fragmentShader,fragment,kind);
  assert.doesNotMatch(draw.vertexShader,/sampler3D|cfCloud/);
  assert.match(draw.vertexShader,/objectNormal=cfWindNormalCorrection/);
 }
});

test('full weather and wind share uniforms without redeclarations or duplicate patches',()=>{
 const draw=shader();patchWorldEnvironmentMaterial(draw,{},false);patchVegetationWind(draw,{},binding);
 assert.equal(draw.vertexShader.match(/uniform mat4 cfEnvironmentToSource;/g)?.length,1);
 assert.equal(draw.vertexShader.match(/uniform float cfEnvironmentSeconds;/g)?.length,1);
 assert.ok(draw.vertexShader.indexOf('uniform mat4 cfEnvironmentToSource;')<draw.vertexShader.indexOf('mat4 cfWindActorFrame()'));
 const before=draw.vertexShader;patchVegetationWind(draw,{},binding);assert.equal(draw.vertexShader,before);
});

test('weather clones compose after a source wind hook with one declaration and the current owner uniforms',()=>{
 const draw=shader(),source={cfEnvironmentToSource:{value:'source-frame'},cfEnvironmentSeconds:{value:12},cfWindStrength:{value:.3},cfWindDirection:{value:[1,0]}},
  weather={cfEnvironmentToSource:{value:'weather-frame'},cfEnvironmentSeconds:{value:24},cfWindStrength:{value:.6},cfWindDirection:{value:[0,1]}};
 patchVegetationWind(draw,source,binding);const root=draw.uniforms.cfWindRoot,tip=draw.uniforms.cfWindTip;
 patchWorldEnvironmentMaterial(draw,weather,false);
 for(const declaration of ['uniform mat4 cfEnvironmentToSource;','uniform float cfEnvironmentSeconds;','uniform float cfWindStrength;','uniform vec2 cfWindDirection;'])
  assert.equal(draw.vertexShader.split(declaration).length-1,1,declaration);
 for(const [name,uniform] of Object.entries(weather))assert.equal(draw.uniforms[name],uniform,name);
 assert.equal(draw.uniforms.cfWindRoot,root);assert.equal(draw.uniforms.cfWindTip,tip);
 assert.ok(draw.vertexShader.indexOf('uniform mat4 cfEnvironmentToSource;')<draw.vertexShader.indexOf('mat4 cfWindActorFrame()'));
 assert.match(draw.vertexShader,/objectNormal=cfWindNormalCorrection/);
 assert.match(draw.vertexShader,/varying vec3 cfEnvironmentPoint;/);
 const vertex=draw.vertexShader,fragment=draw.fragmentShader;
 patchWorldEnvironmentMaterial(draw,weather,false);patchVegetationWind(draw,source,binding);
 assert.equal(draw.vertexShader,vertex);assert.equal(draw.fragmentShader,fragment);
 for(const [name,uniform] of Object.entries(weather))assert.equal(draw.uniforms[name],uniform,name);
});


test('zero uniform wind bypasses actor frames, curves and normal corrections in every vertex seam',()=>{
 for(const captured of [false,true]){
  const draw=shader();if(captured)patchVegetationImpostor(draw);patchVegetationWind(draw,{},binding);
  const guarded=draw.vertexShader.split('if(cfWindStrength!=0.){');assert.equal(guarded.length,captured?2:3);
  assert.ok(guarded[guarded.length-1].startsWith('\n mat4 cfWindFrame=cfWindActorFrame();'));
  if(!captured)assert.ok(guarded[1].startsWith('\n mat4 cfNormalFrame=cfWindActorFrame();'));
  assert.ok(draw.vertexShader.indexOf('if(weight<=0.)return vec2(0.);')<draw.vertexShader.indexOf('float gust=sin('));
 }
 assert.equal(VEGETATION_WIND_SHADER_VERSION,'zero-strength-fast-path-v2');
});
