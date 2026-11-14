import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as DesktopThree from '../../../../main game/node_modules/three/build/three.module.js';
import * as QuestThree from '../../../../main-game-vr/node_modules/three/build/three.module.js';
import { CROWNFALL_WATER_SOURCE,createCrownfallEstateWater,createAlpineWater,ALPINE_COMMON_GLSL,ALPINE_WATER_GLSL } from './alpine.js';

test('public original water uses each consumer namespace and has no restricted source payload',async()=>{
  assert.equal(createAlpineWater,createCrownfallEstateWater);
  assert.equal(ALPINE_COMMON_GLSL,'');assert.equal(ALPINE_WATER_GLSL,'');
  assert.deepEqual(CROWNFALL_WATER_SOURCE.files,{});
  const code=await readFile(new URL('./alpine.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/waterNormalA|waterGust|W_ABS|W_SCA|7\.28e-5|float gnoised|uint hashu/);
  for(const [profile,T]of [['desktop',DesktopThree],['quest',QuestThree]]){
    const water=createCrownfallEstateWater({THREE:T,profile,waterLevel:.55}),mesh=water.root.children[0];
    assert.ok(mesh instanceof T.Mesh);assert.ok(mesh.material instanceof T.MeshPhysicalMaterial);
    assert.equal(mesh.geometry.index.count,6);assert.equal(mesh.geometry.boundingBox.max.x-mesh.geometry.boundingBox.min.x,profile==='quest'?176:1000);
    assert.equal(mesh.position.y,.55);assert.equal(water.getInfo().triangles,2);assert.equal(water.getInfo().drawCalls,1);
    assert.equal(water.getInfo().usesUpstreamAlpineCode,false);assert.equal(water.getInfo().permissionRecordPending,false);
    assert.equal(mesh.userData.sourceAsset.repository,'https://github.com/mylife-as-miles/Crownfall');
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <normal_fragment_maps>'};
    mesh.material.onBeforeCompile(shader,null);
    assert.equal(shader.uniforms.uEaldholtRippleTime,mesh.material.userData.crownfallWaterUniforms.time);
    assert.match(shader.fragmentShader,/CROWNFALL_POND_RIPPLES/);
    water.dispose();
  }
});

test('original water maintains source-frame waves/camera through miniature changes and disposes once',()=>{
  const T=DesktopThree,parent=new T.Group(),water=createCrownfallEstateWater({THREE:T,profile:'quest'}),mesh=water.root.children[0],camera=new T.PerspectiveCamera();
  parent.position.set(1,.9,-2);parent.rotation.set(.2,.8,.1);parent.scale.setScalar(.01);parent.add(water.root);camera.position.set(2,1.7,1);
  let geometryDisposals=0,materialDisposals=0;
  mesh.geometry.addEventListener('dispose',()=>geometryDisposals++);mesh.material.addEventListener('dispose',()=>materialDisposals++);
  water.update(.016,camera);parent.updateMatrixWorld(true);
  const inverse=water.root.matrixWorld.clone().invert(),uniforms=mesh.material.userData.crownfallWaterUniforms;
  assert.ok(mesh.material.userData.crownfallSourceCamera.distanceTo(camera.position.clone().applyMatrix4(inverse))<1e-8);
  const source=new T.Vector3(3,.55,7),world=source.clone().applyMatrix4(water.root.matrixWorld);
  assert.ok(world.applyMatrix4(uniforms.worldToSource.value).distanceTo(source)<1e-8);
  water.setReducedMotion(true);water.update(100,camera);assert.equal(water.getInfo().time,.016);
  parent.scale.setScalar(.017);water.update(.02,camera);parent.updateMatrixWorld(true);
  assert.ok(source.clone().applyMatrix4(water.root.matrixWorld).applyMatrix4(uniforms.worldToSource.value).distanceTo(source)<1e-8);
  water.setReducedMotion(false);water.update(100,camera);assert.equal(water.getInfo().time,.116);
  water.update(NaN,camera);water.update(-1,camera);assert.equal(water.getInfo().time,.116);
  water.dispose();water.dispose();water.update(1,camera);
  assert.deepEqual([geometryDisposals,materialDisposals],[1,1]);assert.equal(water.root.parent,null);assert.equal(water.getInfo().included,false);assert.equal(water.getInfo().time,.116);
});

test('original water validates bounded inputs and copies its supported colour override',()=>{
  const tint=[.08,.2,.3],water=createCrownfallEstateWater({THREE:DesktopThree,look:{inScatter:tint}});
  tint[0]=1;assert.deepEqual(water.root.children[0].material.color.toArray(),[.08,.2,.3]);assert.equal(water.getInfo().shader.hostLook.inScatter[0],.08);water.dispose();
  for(const options of [{extent:0},{extent:NaN},{extent:1001},{waterLevel:Infinity},{profile:'other'},{look:{inScatter:[NaN,0,0]}},{look:{bedLow:[1.1,0,0]}},{look:{opticalDepthSlope:0}},{look:{skyCloudMix:1.1}}])assert.throws(()=>createCrownfallEstateWater({THREE:DesktopThree,...options}),/Invalid/);
});
