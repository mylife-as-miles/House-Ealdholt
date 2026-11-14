import assert from 'node:assert/strict';import test from 'node:test';
import {BoxGeometry,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial} from 'three';
import {readEaldholtMatureRegionalTree} from './regional-tree-source';
test('a mature source canopy is borrowed with its real scale/contact and no edits to source actors or buffers',()=>{
 const root=new Group(),tree=new Group();tree.name='SM_BlackAlder_Field_02_cell_0_0';tree.userData.crownfallElderbloom={kind:'tree'};root.add(tree);
 const geometry=[new BoxGeometry(1,12,1).translate(0,6,0),new BoxGeometry(12,16,12).translate(0,10,0),new BoxGeometry(1,2,1).translate(0,2,0)];
 geometry.forEach(g=>g.clearGroups());geometry[1].setIndex(Array.from({length:60000},(_,i)=>i%24));
 const mats=[new MeshStandardMaterial(),new MeshStandardMaterial({side:DoubleSide}),new MeshStandardMaterial()];
 const pose=new Matrix4().makeTranslation(12,1,30).multiply(new Matrix4().makeRotationY(.6)).multiply(new Matrix4().makeScale(1.2,1.2,1.2));
 const parts=geometry.map((g,i)=>{const part=new InstancedMesh(g,mats[i],1);part.setMatrixAt(0,pose);tree.add(part);return part;});
 const before=parts.map(p=>Array.from(p.instanceMatrix.array)),positions=geometry.map(g=>Array.from(g.getAttribute('position').array)),bounds=geometry.map(g=>g.boundingBox);
 const source=readEaldholtMatureRegionalTree(root);assert.ok(source);assert.equal(source.object,tree);assert.equal(source.placement.scale,1);assert.ok(Math.abs(source.placement.y-1)<1e-6);assert.ok(source.canopyRadius>10&&source.canopyRadius<25);
 parts.forEach((p,i)=>assert.deepEqual(Array.from(p.instanceMatrix.array),before[i]));geometry.forEach((g,i)=>{assert.deepEqual(Array.from(g.getAttribute('position').array),positions[i]);assert.equal(g.boundingBox,bounds[i]);});
 tree.userData.crownfallElderbloom.kind='architecture';assert.equal(readEaldholtMatureRegionalTree(root),null);
 parts.forEach(p=>p.dispose());geometry.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());
});
