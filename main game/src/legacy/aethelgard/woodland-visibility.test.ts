import assert from 'node:assert/strict';import test from 'node:test';
import {BoxGeometry,Group,InstancedMesh,Matrix4,MeshStandardMaterial,OrthographicCamera,PerspectiveCamera,Vector3} from 'three';
import {createEaldholtWoodlandVisibility,readAuthoredWoodlandMatrix} from './woodland-visibility';
function fixture(){const root=new Group(),material=new MeshStandardMaterial(),geometries=[new BoxGeometry(.3,3,.3).translate(0,1.5,0),new BoxGeometry(3,3,3).translate(0,4,0),new BoxGeometry(.1,2,.1).translate(.2,2,0)];const points=[[0,0,-10],[0,0,10],[30,0,-10],[-30,0,-10]];
 const parts=geometries.map((geometry,part)=>{const mesh=new InstancedMesh(geometry,material,4);for(let i=0;i<4;i++)mesh.setMatrixAt(i,new Matrix4().makeTranslation(points[i][0]+part*.05,points[i][1],points[i][2]));root.add(mesh);return mesh;});
 root.userData.crownfallRiverWoodland={wholeTree:true};root.userData.crownfallFoliageDensity={counts:{low:2,medium:3,high:4}};
 const original=parts.map(p=>new Float32Array(p.instanceMatrix.array)),camera=new PerspectiveCamera(60,1,.001,100);camera.position.set(0,2,0);camera.lookAt(0,2,-1);camera.updateMatrixWorld(true);
 return{root,parts,material,geometries,original,camera,cleanup(){for(const p of parts)p.dispose();for(const g of geometries)g.dispose();material.dispose();}};
}
test('whole-tree compaction preserves every component transform and restores original source ordinals',()=>{const f=fixture(),visibility=createEaldholtWoodlandVisibility(f.root);visibility.update([f.camera],'high');assert.equal(visibility.stats.visibleActors,1);assert.ok(f.parts.every(p=>p.count===1));const uploads=visibility.stats.instanceUploads;
 visibility.update([f.camera],'high');assert.equal(visibility.stats.instanceUploads,uploads,'stable membership never reuploads instance matrices');f.camera.lookAt(0,2,1);f.camera.updateMatrixWorld(true);visibility.update([f.camera],'high');assert.equal(visibility.sourceOrdinalForDrawSlot(0),1);assert.equal(visibility.sourceOrdinalForDrawSlot(1),null);
 f.parts.forEach((p,i)=>{assert.deepEqual(Array.from(p.instanceMatrix.array).slice(0,16),Array.from(f.original[i]).slice(16,32));const source=readAuthoredWoodlandMatrix(p,0,new Matrix4());assert.deepEqual(source.elements,Array.from(f.original[i]).slice(0,16));});
 visibility.restore('high');assert.equal(visibility.sourceOrdinalForDrawSlot(3),3);f.parts.forEach((p,i)=>assert.deepEqual(p.instanceMatrix.array,f.original[i]));visibility.dispose();visibility.dispose();f.cleanup();});
test('quality prefixes and external density writes cannot lose or resurrect source actors',()=>{const f=fixture(),v=createEaldholtWoodlandVisibility(f.root);f.camera.lookAt(30,2,-10);f.camera.updateMatrixWorld(true);v.update([f.camera],'low');assert.equal(v.stats.visibleActors,0);
 v.update([f.camera],'high');assert.equal(v.stats.visibleActors,1);for(const p of f.parts)p.count=4;const uploads=v.stats.instanceUploads;v.update([f.camera],'high');assert.equal(v.stats.instanceUploads,uploads);assert.ok(f.parts.every(p=>p.count===1));v.dispose();f.cleanup();});
test('source-root scale/rotation/translation are applied once and two eye frusta are unioned',()=>{const f=fixture();f.root.position.set(5,2,-3);f.root.rotation.y=.7;f.root.scale.set(-.02,.03,.04);f.root.updateMatrixWorld(true);
 const eye=f.root.localToWorld(new Vector3(0,2,0)),front=f.root.localToWorld(new Vector3(0,2,-1)),back=f.root.localToWorld(new Vector3(0,2,1));f.camera.position.copy(eye);f.camera.lookAt(front);f.camera.updateMatrixWorld(true);
 const other=f.camera.clone();other.lookAt(back);other.updateMatrixWorld(true);const before=f.camera.matrixWorld.clone(),v=createEaldholtWoodlandVisibility(f.root);v.update([f.camera,other],'high');assert.equal(v.stats.visibleActors,2);assert.ok(f.camera.matrixWorld.equals(before),'eye world matrices must never be rebuilt from local XR TRS');v.dispose();f.cleanup();});
test('a canopy remains when its trunk centre lies beyond a frustum edge',()=>{const f=fixture();f.camera.position.set(7,4,0);f.camera.lookAt(7,4,-10);f.camera.updateMatrixWorld(true);const v=createEaldholtWoodlandVisibility(f.root);v.update([f.camera],'high');assert.equal(v.stats.visibleActors,1,'complete crown bounds overlap although root x=0 is outside the view');v.dispose();f.cleanup();});
test('borrowed geometry/materials and their bounds remain untouched; shadow casting families fail closed',()=>{const f=fixture(),bounds=f.geometries.map(g=>g.boundingBox),v=createEaldholtWoodlandVisibility(f.root);let borrowedDisposals=0;for(const g of f.geometries)g.addEventListener('dispose',()=>borrowedDisposals++);f.material.addEventListener('dispose',()=>borrowedDisposals++);v.update([f.camera],'high');v.dispose();assert.equal(borrowedDisposals,0);f.geometries.forEach((g,i)=>assert.equal(g.boundingBox,bounds[i]));f.parts[0].castShadow=true;assert.throws(()=>createEaldholtWoodlandVisibility(f.root),/non-shadow/);f.cleanup();});

test('runtime shadow casters retain offscreen actors in the light view; missing light coverage restores the full pool',()=>{
 const f=fixture(),v=createEaldholtWoodlandVisibility(f.root);
 v.update([f.camera],'high');assert.equal(v.stats.visibleActors,1);
 f.parts[0].castShadow=true;
 v.update([f.camera],'high');assert.equal(v.stats.coverage,'full-quality-fallback');assert.equal(v.stats.visibleActors,4);
 f.parts.forEach((p,i)=>assert.deepEqual(p.instanceMatrix.array,f.original[i]));
 const fullUploads=v.stats.instanceUploads;v.update([f.camera],'high');assert.equal(v.stats.instanceUploads,fullUploads);
 const light=new OrthographicCamera(-4,4,5,-5,.001,100);light.position.set(0,2,0);light.lookAt(0,2,10);light.updateMatrixWorld(true);
 v.update([f.camera,light],'high',true);assert.equal(v.stats.coverage,'camera-and-shadow');assert.equal(v.stats.visibleActors,2);
 assert.equal(v.sourceOrdinalForDrawSlot(0),0);assert.equal(v.sourceOrdinalForDrawSlot(1),1);
 f.parts.forEach((p,i)=>assert.deepEqual(Array.from(p.instanceMatrix.array).slice(0,32),Array.from(f.original[i]).slice(0,32)));
 const uploads=v.stats.instanceUploads;v.update([f.camera,light],'high',true);assert.equal(v.stats.instanceUploads,uploads);
 f.parts[0].castShadow=false;v.update([f.camera,light],'high',true);assert.equal(v.stats.coverage,'camera-only');assert.equal(v.stats.visibleActors,1,'non-casters do not retain trees for a light view');
 v.restore();const restored=v.stats.instanceUploads;v.restore();assert.equal(v.stats.instanceUploads,restored,'probe/reflection fallback does not upload unchanged buffers');
 v.dispose();f.cleanup();
});
