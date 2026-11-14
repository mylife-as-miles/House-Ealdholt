import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { createVillageNightLights } from './village-night-lights';
import { sampleWorldEnvironment } from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
const at=(minute:number)=>sampleWorldEnvironment({absoluteWorldMinute:minute,fractionalMinute:0,dayIndex:0,dayMinute:minute,elapsedWorldMinutes:0,deferredMilliseconds:0},'doorway-lights-test');
function fixture(){
 const source=new Group(),geometry=new BoxGeometry(1,2,.1),material=new MeshStandardMaterial();
 const doors=new InstancedMesh(geometry,material,3);doors.name='S_Medieval_Modular_Door_cell_0_0';doors.position.set(40,1,0);
 for(const [i,x] of [-44,-36,-28].entries())doors.setMatrixAt(i,new Matrix4().makeTranslation(x,0,0));source.add(doors);
 const camera=new PerspectiveCamera(100,1,.01,1000);camera.position.set(0,6,24);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
 const lights=createVillageNightLights(source);source.add(lights.object);
 return{source,doors,geometry,material,camera,lights,dispose(){lights.dispose();geometry.dispose();material.dispose();}};
}
test('night enables actual instanced door positions across village; day fades off with stable program counts',()=>{
 const f=fixture();try{
  assert.equal(f.lights.stats.sourceDoors,3);assert.equal(f.lights.stats.pool,4);
  assert.equal(f.lights.update(at(720),f.camera,'high'),false);assert.equal(f.lights.stats.active,0);
  f.lights.update(at(0),f.camera,'high');assert.equal(f.lights.stats.active,3);
  const on=f.lights.lights.filter(l=>l.intensity>0);assert.ok(on.every(l=>[-4,4,12].includes(l.position.x)&&l.position.y===1.5));
  assert.ok(on.every(l=>l.castShadow===false&&l.visible&&l.distance===9));
  assert.equal(f.lights.update(at(0),f.camera,'high'),false,'paused/reloaded night requires no repeated mutation');
  f.lights.update(at(720),f.camera,'high');assert.ok(f.lights.lights.every(l=>l.intensity===0&&l.visible));
  f.lights.update(at(0),f.camera,'low');assert.equal(f.lights.stats.active,1);
  assert.equal(f.lights.lights.length,4);assert.equal(f.material.emissiveIntensity,1);assert.equal(f.material.emissive.getHex(),0);
 }finally{f.dispose();}
});
test('miniature transforms preserve source anchors and scale physical range and inverse-square power',()=>{
 const f=fixture();try{
  f.source.scale.setScalar(.02);f.source.rotation.y=.4;f.source.position.set(.2,.5,-2);f.source.updateMatrixWorld(true);
  const centre=new Vector3(0,1,0).applyMatrix4(f.source.matrixWorld);f.camera.position.copy(centre).add(new Vector3(0,.15,.5));f.camera.lookAt(centre);f.camera.updateMatrixWorld(true);
  f.lights.update(at(0),f.camera,'high');assert.ok(f.lights.stats.active>0);
  for(const l of f.lights.lights.filter(l=>l.intensity>0)){
   assert.ok(Math.abs(l.distance-.18)<1e-10);assert.ok(Math.abs(l.intensity-12*.02*.02)<1e-10);
   assert.ok(l.getWorldPosition(new Vector3()).distanceTo(l.position.clone().applyMatrix4(f.source.matrixWorld))<1e-10);
  }
  const original=new Box3().setFromObject(f.doors);assert.ok(new Box3().setFromObject(f.source).equals(original),'lights add no solid bounds');
  f.source.visible=false;f.lights.update(at(0),f.camera,'high');assert.equal(f.lights.stats.active,0);
 }finally{f.dispose();}
});
test('empty source falls back only to source hearth anchors; dispose never releases borrowed geometry/material',()=>{
 const f=fixture();let released=0;f.geometry.addEventListener('dispose',()=>released++);f.material.addEventListener('dispose',()=>released++);
 f.lights.dispose();f.lights.dispose();assert.equal(released,0);assert.equal(f.lights.object.parent,null);
 assert.equal(f.lights.update(at(0),f.camera,'high'),false);f.geometry.dispose();f.material.dispose();
 const empty=new Group(),fallback=createVillageNightLights(empty);assert.equal(fallback.stats.sourceDoors,0);assert.equal(fallback.stats.emitters,4);fallback.dispose();
});

test('destroyed-source emitter filter keeps a burned doorway dark without changing borrowed actors',()=>{
 const f=fixture();f.lights.dispose();
 const lights=createVillageNightLights(f.source,{isExtinguished:()=>true});f.source.add(lights.object);
 lights.update(at(0),f.camera,'high');assert.equal(lights.stats.active,0);assert.ok(lights.lights.every(l=>l.intensity===0));
 assert.equal(f.doors.count,3);lights.dispose();f.geometry.dispose();f.material.dispose();
});
