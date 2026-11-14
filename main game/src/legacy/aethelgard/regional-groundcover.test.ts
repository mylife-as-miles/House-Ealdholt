import test from 'node:test';
import {ealdholtPlantTriangleBudget} from '../../../../shared/legacy/aethelgard/environment/plant-triangle-budget';
import assert from 'node:assert/strict';
import {BoxGeometry,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,OrthographicCamera,PerspectiveCamera} from 'three';
import {createRegionalGroundcover,measureRegionalGroundcoverSource} from './regional-groundcover';
import {collectRegionalVillageSource} from './regional-village-source';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';

test('clearing grass borrows a culled complete source family, keeps root contact and obeys Native triangle budgets',()=>{
 const root=new Group(),geometry=new BoxGeometry(.8,.2,.8).translate(0,.1,0);geometry.clearGroups();const material=new MeshStandardMaterial({side:DoubleSide});
 const source=new InstancedMesh(geometry,material,1);source.name='S_Grass_Clumps_original';source.count=0;root.add(source);let disposed=0;
 geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,12,20);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const grass=new Float32Array(3000*6);for(let i=0;i<3000;i++)grass.set([(i%30)/10-1.5,2,-Math.floor(i/30)/10,0,1,i%3],i*6);
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array(),groundcover:grass,cells:[],landmarks:[],attempts:0,rejected:{},species:[]};
 const cover=createRegionalGroundcover({sourceRoot:root,camera,native:true});root.add(cover.object);
 try{
  cover.update(layout,camera,0,'high');assert.equal(cover.stats.status,'ready');assert.ok(cover.stats.visible>0&&cover.stats.visible<3000);assert.ok(cover.stats.triangles<=24000);assert.equal(cover.stats.drawCalls,1);
  const mesh=cover.object.children[0] as InstancedMesh;
  assert.equal(mesh.userData.crownfallVegetationWind.grass,true);assert.ok(Math.abs(mesh.userData.crownfallVegetationWind.root[1])<1e-7);assert.ok(Math.abs(mesh.userData.crownfallVegetationWind.tip[1]-.2)<1e-7);
  assert.equal(source.userData.crownfallVegetationWind,undefined,'Added groundcover grants wind only to its owned draw; borrowed source metadata stays unchanged');
  assert.equal(mesh.geometry,geometry);assert.notEqual(mesh.material,material);const frame=new Matrix4();mesh.getMatrixAt(0,frame);assert.ok(Math.abs(frame.elements[13]-2.004)<1e-5);assert.equal(source.count,0);
  camera.position.set(1000,10,1000);camera.lookAt(1100,10,1100);camera.updateMatrixWorld();cover.update(layout,camera,200,'low');assert.equal(cover.stats.visible,0);assert.equal(mesh.visible,false);
 }finally{cover.dispose();assert.equal(disposed,0);source.dispose();geometry.dispose();material.dispose();}
});

test('worker measures the exact borrowed, hidden source families without changing their geometry/materials',()=>{
 const root=new Group(),material=new MeshStandardMaterial(),geometries=[new BoxGeometry(.8,.24,.6).translate(0,.1,0),new BoxGeometry(.4,.3,.4).translate(0,.2,0)];
 for(let i=0;i<geometries.length;i++){const geometry=geometries[i];geometry.clearGroups();const source=new InstancedMesh(geometry,material,1);source.name='S_Grass_Clumps_'+i;source.count=0;root.add(source);}
 const before=geometries.map(g=>Array.from(g.attributes.position.array)),source=measureRegionalGroundcoverSource(root)!;
 assert.deepEqual(collectRegionalVillageSource(root).groundcoverSource,source,'The existing worker packet carries measured source qualification.');
 assert.ok(Math.abs(source.radius-.5)<1e-6);assert.ok(Math.abs(source.minimumHeight-.24)<1e-6);assert.ok(Math.abs(source.maximumHeight-.3)<1e-6);assert.equal(source.families.length,2);assert.deepEqual(geometries.map(g=>Array.from(g.attributes.position.array)),before);assert.ok(root.children.every(n=>(n as InstancedMesh).count===0));assert.ok(geometries.every(g=>g.boundingBox===null));
 for(const g of geometries)g.dispose();material.dispose();
 const unsupported=new Group(),tall=new BoxGeometry(1,2,1);tall.clearGroups();const actor=new InstancedMesh(tall,new MeshStandardMaterial(),1);actor.name='S_Grass_Clumps_tall';unsupported.add(actor);assert.equal(measureRegionalGroundcoverSource(unsupported),undefined);tall.dispose();(actor.material as MeshStandardMaterial).dispose();
});

test('source-measured cell bounds retain a larger qualified grass patch intersecting the edge of the view',()=>{
 const root=new Group(),geometry=new BoxGeometry(1.3,.15,1.3).translate(0,.075,0);geometry.clearGroups();const material=new MeshStandardMaterial();
 const source=new InstancedMesh(geometry,material,1);source.name='S_Grass_Clumps_wide';source.count=0;root.add(source);
 const camera=new OrthographicCamera(-1,1,1,-1,.1,20);camera.position.set(0,.2,5);camera.lookAt(0,.2,0);camera.updateMatrixWorld();
 const grass=new Float32Array([2.2,0,0,0,2.4,0]);
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array(),groundcover:grass,cells:[],landmarks:[],attempts:0,rejected:{},species:[]};
 const cover=createRegionalGroundcover({sourceRoot:root,camera});root.add(cover.object);
 try{cover.update(layout,camera,0,'low');assert.equal(cover.stats.visible,1,'The patch reaches into the frustum beyond the old one-metre box.');
  assert.equal(cover.stats.triangles,12);assert.equal(cover.stats.triangleBudget,ealdholtPlantTriangleBudget('regionalGroundcover','low'));assert.equal(cover.stats.drawCalls,1);assert.equal(source.count,0);
 }finally{cover.dispose();source.dispose();geometry.dispose();material.dispose();}
});
