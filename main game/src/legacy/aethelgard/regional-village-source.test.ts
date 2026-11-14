import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PlaneGeometry} from 'three';
import {collectRegionalVillageSource} from './regional-village-source';
test('planting protects measured fixtures rather than the Landscape, including hidden source instances',()=>{
 const root=new Group();root.position.set(40,10,-20);root.scale.setScalar(.4);
 const geometry=new BoxGeometry(4,4,4),material=new MeshStandardMaterial(),building=new InstancedMesh(geometry,material,2);building.userData.crownfallElderbloom={kind:'architecture'};
 building.setMatrixAt(0,new Matrix4().makeTranslation(10,2,10));building.setMatrixAt(1,new Matrix4().makeTranslation(60,2,60));building.count=1;root.add(building);
 const ground=new Mesh(new PlaneGeometry(100,100),material);ground.name='LandscapeComponent_0';ground.rotation.x=-Math.PI/2;ground.userData.crownfallElderbloom={kind:'terrain'};root.add(ground);
 const tree=new Mesh(geometry,material);tree.position.set(200,0,200);tree.userData.crownfallElderbloom={kind:'tree'};root.add(tree);
 const positions=Array.from(geometry.attributes.position.array),result=collectRegionalVillageSource(root);
 for(const key of ['minX','minZ']as const)assert.ok(Math.abs(result.village![key]-6)<.00001);
 for(const key of ['maxX','maxZ']as const)assert.ok(Math.abs(result.village![key]-64)<.00001);
 assert.equal(result.villageLand.length,1);assert.equal(building.count,1);assert.deepEqual(Array.from(geometry.attributes.position.array),positions);assert.equal(geometry.boundingBox,null);
 geometry.dispose();ground.geometry.dispose();material.dispose();
});
