import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeStaticMeshes } from './merge.js';
const THREE=await import('../../../../main game/node_modules/three/build/three.module.js');
const box=(x,extra={})=>{const g=new THREE.BoxGeometry(1,1,1).translate(x,0,0);g.setAttribute('aux',new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(x),1));return Object.assign(g,extra);};
const material=new THREE.MeshStandardMaterial({name:'stone'});
const trianglesOf=mesh=>(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.getAttribute('position').count)/3;
test('static meshes of one material become one draw with every triangle and attribute intact',()=>{
 const group=new THREE.Group();for(let x=0;x<70;x++)group.add(new THREE.Mesh(box(x),material));
 const before=[...group.children].reduce((n,m)=>n+trianglesOf(m),0);
 const report=mergeStaticMeshes(THREE,[group]);
 assert.equal(group.children.length,1);assert.deepEqual([report.before,report.after],[70,1]);
 const merged=group.children[0],position=merged.geometry.getAttribute('position');
 assert.equal(trianglesOf(merged),before);assert.equal(merged.material,material);
 assert.equal(merged.geometry.index.array.constructor,Uint16Array);
 // the last box keeps its own positions and its own auxiliary channel, through a rebased index
 const last=merged.geometry.index.array[merged.geometry.index.count-1];
 assert.ok(position.getX(last)>68);assert.equal(merged.geometry.getAttribute('aux').getX(last),69);
 merged.geometry.computeBoundingBox();assert.ok(merged.geometry.boundingBox.max.x>69);
});
test('quantised chunks keep their world positions when their transform is baked',()=>{
 const group=new THREE.Group(),chunk=(cx,ext)=>{const g=new THREE.BoxGeometry(2,2,2);const raw=g.getAttribute('position');const q=new Int16Array(raw.count*3);for(let i=0;i<raw.count*3;i++)q[i]=Math.round(raw.array[i]*32767);g.setAttribute('position',new THREE.BufferAttribute(q,3,true));const m=new THREE.Mesh(g,material);m.position.set(cx,0,0);m.scale.setScalar(ext);return m;};
 const a=chunk(100,30),b=chunk(-40,10),plain=new THREE.Mesh(new THREE.BoxGeometry(1,1,1).translate(0,50,0),material);group.add(a,b,plain);
 mergeStaticMeshes(THREE,[group]);
 assert.equal(group.children.length,1);
 const merged=group.children[0];merged.geometry.computeBoundingBox();const {min,max}=merged.geometry.boundingBox;
 assert.ok(Math.abs(max.x-130)<.01&&Math.abs(min.x+50)<.01,`${min.x} ${max.x}`);assert.ok(Math.abs(max.y-50.5)<.01);
 assert.equal(merged.geometry.getAttribute('position').normalized,false);assert.equal(merged.scale.x,1);
});
test('a rotated quantised-looking mesh and a scaled plain mesh stay out',()=>{
 const group=new THREE.Group(),q=()=>{const g=new THREE.BoxGeometry(2,2,2);const raw=g.getAttribute('position');const a=new Int16Array(raw.count*3);for(let i=0;i<raw.count*3;i++)a[i]=Math.round(raw.array[i]*32767);g.setAttribute('position',new THREE.BufferAttribute(a,3,true));return g;};
 const rotated=new THREE.Mesh(q(),material);rotated.rotation.y=1;const uneven=new THREE.Mesh(q(),material);uneven.scale.set(1,2,1);const scaled=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);scaled.scale.setScalar(3);
 group.add(rotated,uneven,scaled,new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material));
 assert.equal(mergeStaticMeshes(THREE,[group]).after,0);assert.equal(group.children.length,4);
});
test('baked placements move positions and normals, and a mirror keeps triangles facing out',()=>{
 const group=new THREE.Group(),a=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),b=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),c=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
 a.position.set(10,0,0);a.rotation.y=Math.PI/2;b.position.set(0,5,0);b.rotation.x=-Math.PI/2;c.scale.z=-1;c.position.z=-7;
 group.add(a,b,c);
 const report=mergeStaticMeshes(THREE,[group],{bakeTransforms:true});
 assert.deepEqual([report.before,report.after],[3,1]);
 const g=group.children[0].geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),v=new THREE.Vector3();
 v.fromBufferAttribute(n,0);assert.ok(Math.abs(v.x-1)<1e-5,'a faces +x');assert.ok(Math.abs(p.getX(0)-10)<1e-5);
 v.fromBufferAttribute(n,4);assert.ok(Math.abs(v.y-1)<1e-5,'b faces +y');assert.ok(Math.abs(p.getY(4)-5)<1e-5);
 // Winding of the mirrored plane's first triangle still agrees with its stored normal.
 const i=g.index.array,o=12,A=new THREE.Vector3().fromBufferAttribute(p,i[o]),B=new THREE.Vector3().fromBufferAttribute(p,i[o+1]),C=new THREE.Vector3().fromBufferAttribute(p,i[o+2]);
 const face=B.sub(A).cross(C.sub(A)).normalize();v.fromBufferAttribute(n,i[o]);assert.ok(face.dot(v)>.99,`winding ${face.dot(v)}`);
});
test('without baking, a moved mesh stays even when its material matches',()=>{
 const group=new THREE.Group(),a=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),b=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);a.position.x=1;b.position.x=2;group.add(a,b);
 assert.equal(mergeStaticMeshes(THREE,[group]).after,0);
});
test('large merges use 32-bit indices rather than wrapping',()=>{
 const group=new THREE.Group();const dense=()=>new THREE.PlaneGeometry(1,1,180,180);
 group.add(new THREE.Mesh(dense(),material),new THREE.Mesh(dense(),material),new THREE.Mesh(dense(),material));
 mergeStaticMeshes(THREE,[group]);
 const geometry=group.children[0].geometry;
 assert.equal(geometry.index.array.constructor,Uint32Array);
 assert.equal(Math.max(...geometry.index.array.subarray(geometry.index.count-6)),geometry.getAttribute('position').count-1);
});
test('anything that moves, blends or cannot share a draw is left as it was',()=>{
 const group=new THREE.Group(),moved=new THREE.Mesh(box(0),material);moved.position.y=2;
 const childOfMoved=new THREE.Group();childOfMoved.position.x=4;childOfMoved.add(new THREE.Mesh(box(1),material));
 const glass=new THREE.Mesh(box(2),new THREE.MeshStandardMaterial({transparent:true})),glass2=new THREE.Mesh(box(3),glass.material);
 const forced=new THREE.Mesh(box(4),material);forced.frustumCulled=false;
 const ordered=new THREE.Mesh(box(5),material);ordered.renderOrder=3;
 const instanced=new THREE.InstancedMesh(box(6),material,3);
 const shader=new THREE.ShaderMaterial(),s1=new THREE.Mesh(box(7),shader),s2=new THREE.Mesh(box(8),shader);
 const other=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),another=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
 group.add(moved,childOfMoved,glass,glass2,forced,ordered,instanced,s1,s2,other,another);
 const count=group.children.length;
 const report=mergeStaticMeshes(THREE,[group]);
 // only the two plain boxes with the same vertex layout merge
 assert.deepEqual([report.before,report.after],[2,1]);assert.equal(group.children.length,count-1);
 for(const kept of [moved,childOfMoved,glass,glass2,forced,ordered,instanced,s1,s2])assert.equal(kept.parent,group);
});
test('shadow flags, materials and vertex layouts separate the groups',()=>{
 const group=new THREE.Group(),stone2=new THREE.MeshStandardMaterial({name:'stone2'});
 const a=new THREE.Mesh(box(0),material),b=new THREE.Mesh(box(1),material),c=new THREE.Mesh(box(2),material),d=new THREE.Mesh(box(3),material),e=new THREE.Mesh(box(4),stone2),f=new THREE.Mesh(box(5),stone2),g=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),h=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
 a.castShadow=b.castShadow=true;group.add(a,b,c,d,e,f,g,h);
 const report=mergeStaticMeshes(THREE,[group]);
 assert.deepEqual([report.before,report.after],[8,4]);
 assert.equal(group.children.filter(m=>m.castShadow).length,1);
});
test('shadow flags are ignored only where a profile draws no shadow pass',()=>{
 const group=new THREE.Group(),a=new THREE.Mesh(box(0),material),b=new THREE.Mesh(box(1),material);a.castShadow=true;group.add(a,b);
 assert.deepEqual((({before,after})=>[before,after])(mergeStaticMeshes(THREE,[group],{ignoreShadows:true})),[2,1]);
});
test('a finite cell keeps distant pieces in separate draws',()=>{
 const group=new THREE.Group();for(const x of [1,2,3,301,302])group.add(new THREE.Mesh(box(x),material));
 const report=mergeStaticMeshes(THREE,[group],{cell:256});
 assert.deepEqual([report.before,report.after],[5,2]);
});
test('a skip predicate protects a named mesh',()=>{
 const group=new THREE.Group(),a=new THREE.Mesh(box(0),material),b=new THREE.Mesh(box(1),material),c=new THREE.Mesh(box(2),material);a.name='keep';group.add(a,b,c);
 mergeStaticMeshes(THREE,[group],{skip:mesh=>mesh.name==='keep'});
 assert.equal(a.parent,group);assert.equal(group.children.length,2);
});
test('a geometry still used elsewhere is not disposed',()=>{
 const group=new THREE.Group(),shared=box(0);let disposed=0;shared.addEventListener('dispose',()=>{disposed++;});
 const a=new THREE.Mesh(shared,material),b=new THREE.Mesh(box(1),material),kept=new THREE.Mesh(shared,material);kept.position.x=3;group.add(a,b,kept);
 mergeStaticMeshes(THREE,[group]);
 assert.equal(kept.parent,group);assert.equal(disposed,0);
});
