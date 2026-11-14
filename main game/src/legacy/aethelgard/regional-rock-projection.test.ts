import assert from 'node:assert/strict';
import test from 'node:test';
import {ArrayCamera,BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,OrthographicCamera,PerspectiveCamera,Quaternion,Vector2,Vector3,Vector4,type Camera} from 'three';
import {createRegionalRocks} from './regional-rocks';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {REGIONAL_ROCK_LOD} from '../../../../shared/legacy/aethelgard/environment/regional-rock-lod';

async function fixture(rows=[0,-.09,0,.7,.75,0],native=false){
 const root=new Group(),camera=new PerspectiveCamera(60,1.6,.1,2000),abort=new AbortController(),material=new MeshStandardMaterial(),near=new BoxGeometry(2,1,2,2,2,2).translate(0,.5,0),far=new BoxGeometry(2,1,2).translate(0,.5,0);
 const arrays=[near,far].map(g=>new Float32Array(g.getAttribute('position').array)),models={near:new Group(),far:new Group()};let sourceDisposals=0,height=300,clock=0;
 for(const resource of [near,far,material])resource.addEventListener('dispose',()=>sourceDisposals++);
 for(const detail of ['near','far']as const)for(const id of ['02','04','06']){const group=new Group();group.name='namaqualand_boulder_'+id;group.add(new Mesh(detail==='near'?near:far,material));models[detail].add(group);}
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:Float32Array.from(rows),cells:[],landmarks:[],species:[],attempts:0,rejected:{}};
 let cameras:readonly Camera[]|null=null;
 const rocks=createRegionalRocks({sourceRoot:root,camera,native,signal:abort.signal,renderer:{getDrawingBufferSize(target:Vector2){return target.set(480,height);}},cameras:current=>cameras??[current],load:async detail=>models[detail],changed(){}});root.add(rocks.object);
 camera.position.set(0,3,50);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);await Promise.resolve();await Promise.resolve();await Promise.resolve();
 const step=(quality:'low'|'medium'|'high'='low',view:Camera=camera)=>{clock+=200;rocks.update(layout,view,clock,quality);};
 const matrices=()=>{const out:number[][]=[];for(const node of rocks.object.children)if(node instanceof InstancedMesh)for(let i=0;i<node.count;i++){const m=new Matrix4();node.getMatrixAt(i,m);out.push(m.elements);}return out;};
 return{root,camera,abort,rocks,layout,near,far,models,material,native,step,matrices,set height(value:number){height=value;},set cameras(value:readonly Camera[]|null){cameras=value;},get sourceDisposals(){return sourceDisposals;},
  dispose(){rocks.dispose();assert.equal(sourceDisposals,0,'Loader templates remain borrowed.');assert.deepEqual(near.getAttribute('position').array,arrays[0]);assert.deepEqual(far.getAttribute('position').array,arrays[1]);near.dispose();far.dispose();material.dispose();}};
}
test('only small projected rocks use the resident far mesh; placements, PBR and instance capacity stay unchanged',async()=>{
 const f=await fixture([-2,-.03,0,.7,.25,0,2,-.24,0,1.2,2,1]),before=f.layout.rocks.slice();
 try{f.step();assert.equal(f.rocks.stats.status,'ready');assert.equal(f.rocks.stats.visible,2);assert.equal(f.rocks.stats.near,1);assert.equal(f.rocks.stats.far,1);assert.equal(f.rocks.stats.screenSizeDemotions,1);
  assert.equal(f.rocks.stats.triangles,60);assert.equal(f.rocks.stats.drawCalls,2);assert.equal(f.rocks.stats.instanceBufferBytes,2*2*16*4);assert.equal(f.rocks.stats.lodStateBytes,1);
  const expected=[];for(let at=0;at<before.length;at+=6)expected.push(new Matrix4().compose(new Vector3(before[at],before[at+1],before[at+2]),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),before[at+3]),new Vector3().setScalar(before[at+4])).elements.map(Math.fround));
  assert.deepEqual(f.matrices().sort((a,b)=>a[12]-b[12]),expected);assert.deepEqual(f.layout.rocks,before);
  for(const node of f.rocks.object.children)if(node instanceof InstancedMesh){assert.equal(node.material,f.material);assert.equal(node.geometry,node.name.endsWith(':near')?f.near:f.far);}
 }finally{f.dispose();assert.equal(f.rocks.stats.lodStateBytes,0);assert.equal(f.rocks.stats.instanceBufferBytes,0);}
});
test('real render height, camera FOV/zoom and source display scale drive detail without moving the local matrices',async()=>{
 const f=await fixture();try{
  f.step();assert.equal(f.rocks.stats.far,1);const original=f.matrices();f.height=600;f.step();assert.equal(f.rocks.stats.near,1);assert.deepEqual(f.matrices(),original);
  f.height=300;f.step();assert.equal(f.rocks.stats.far,1);f.camera.zoom=2;f.camera.updateProjectionMatrix();f.step();assert.equal(f.rocks.stats.near,1);
  f.camera.zoom=1;f.camera.fov=90;f.camera.updateProjectionMatrix();f.step();assert.equal(f.rocks.stats.far,1);
  f.camera.fov=60;f.camera.updateProjectionMatrix();f.step('high');assert.equal(f.rocks.stats.near,1);
  f.height=600;f.step();const nearCount=f.rocks.stats.near;const eye=f.camera.position.clone(),target=new Vector3(0,1,0);
  f.root.scale.setScalar(.02);f.root.position.set(2,3,-4);f.root.rotation.y=.4;f.root.updateMatrixWorld(true);
  f.camera.position.copy(f.root.localToWorld(eye));f.camera.lookAt(f.root.localToWorld(target));f.camera.updateMatrixWorld(true);f.step();
  assert.equal(f.rocks.stats.near,nearCount);assert.deepEqual(f.matrices(),original);
 }finally{f.dispose();}
});
test('actual per-actor state holds its level across the screen-size hysteresis band',async()=>{
 const f=await fixture();try{
  const p=new Vector3(0,-.09+.75,0).applyMatrix4(f.camera.matrixWorldInverse),depth=-p.z,radius=1.8*.75;
  const k=radius*Math.abs(f.camera.projectionMatrix.elements[5])/(depth-radius)*(1+Math.hypot(p.x,p.y)/depth),policy=REGIONAL_ROCK_LOD[f.native?'native':'desktop'].low;
  f.height=(policy.enterPixels+policy.exitPixels)/2/k;f.step();assert.equal(f.rocks.stats.far,1);
  f.height=(policy.enterPixels+.5)/k;f.step();assert.equal(f.rocks.stats.near,1);
  f.height=(policy.enterPixels+policy.exitPixels)/2/k;f.step();assert.equal(f.rocks.stats.near,1,'The existing near draw remains until its lower exit threshold.');
  f.height=(policy.exitPixels-.5)/k;f.step();assert.equal(f.rocks.stats.far,1);
 }finally{f.dispose();}
});
test('full population hysteresis stays within512bytes and cannot enlarge the existing instance budget',async()=>{
 const rows=Array.from({length:4096*6},(_,i)=>i%6===1?-.03:i%6===4?.25:i%6===5?Math.floor(i/6)%3:0),f=await fixture(rows),before=f.layout.rocks.slice();
 try{f.step();assert.equal(f.rocks.stats.lodStateBytes,512);assert.equal(f.rocks.stats.instanceBufferBytes,4096*2*16*4);assert.deepEqual(f.layout.rocks,before);
  f.rocks.dispose();f.rocks.dispose();f.step();assert.equal(f.rocks.stats.lodStateBytes,0);assert.equal(f.rocks.stats.instanceBufferBytes,0);assert.equal(f.rocks.object.children.length,0);
 }finally{f.dispose();}
 const overflow=await fixture(Array.from({length:4097*6},()=>0));try{overflow.step();assert.equal(overflow.rocks.stats.status,'held-error');assert.match(overflow.rocks.stats.error,/budget/);assert.equal(overflow.rocks.stats.instanceBufferBytes,0);}finally{overflow.dispose();}
});
test('stereo uses actual eye viewports and union visibility without rewriting authoritative eye transforms',async()=>{
 const f=await fixture([0,-.06,0,.7,.5,0],true),left=new PerspectiveCamera(60,1,.1,2000),right=new PerspectiveCamera(60,1,.1,2000);
 try{left.position.set(-.03,3,50);right.position.set(.03,3,50);left.lookAt(0,3,100);right.lookAt(0,1,0);left.updateMatrixWorld(true);right.updateMatrixWorld(true);
  Object.assign(left,{viewport:new Vector4(0,0,600,1200)});Object.assign(right,{viewport:new Vector4(600,0,600,1200)});
  const before=[left.matrixWorld.elements.slice(),right.matrixWorld.elements.slice()];left.updateWorldMatrix=right.updateWorldMatrix=()=>{throw Error('XR eye TRS must remain owned by the world.');};
  f.cameras=[left,right];f.step();assert.equal(f.rocks.stats.projectionViews,2);assert.equal(f.rocks.stats.visible,1);assert.equal(f.rocks.stats.near,1);assert.equal(f.rocks.stats.projectionFallbacks,0);assert.deepEqual([left.matrixWorld.elements,right.matrixWorld.elements],before);
  f.cameras=null;f.step('low',new ArrayCamera([left,right]));assert.equal(f.rocks.stats.projectionViews,2);assert.equal(f.rocks.stats.near,1);
  (left as PerspectiveCamera&{viewport:Vector4}).viewport.w=(right as PerspectiveCamera&{viewport:Vector4}).viewport.w=0;
  f.step('low',new ArrayCamera([left,right]));assert.equal(f.rocks.stats.near,1);assert.equal(f.rocks.stats.projectionFallbacks,1,'Missing eye pixels must not borrow the desktop canvas height.');
 }finally{f.dispose();}
});
test('orthographic, invalid viewport/projection and near-plane cases retain visibility and the original distance fallback',async()=>{
 const f=await fixture([0,-.12,0,.7,1,0]);try{
  const ortho=new OrthographicCamera(-100,100,100,-100,.1,2000);ortho.position.set(0,3,50);ortho.lookAt(0,1,0);ortho.updateMatrixWorld(true);
  f.step('low',ortho);assert.equal(f.rocks.stats.far,1);ortho.zoom=10;ortho.updateProjectionMatrix();f.step('low',ortho);assert.equal(f.rocks.stats.near,1);
  f.height=0;f.step();assert.equal(f.rocks.stats.near,1);assert.equal(f.rocks.stats.projectionFallbacks,1);
  f.height=300;f.camera.projectionMatrix.elements[5]=0;f.step();assert.equal(f.rocks.stats.near,1);assert.equal(f.rocks.stats.visible,1);assert.equal(f.rocks.stats.projectionFallbacks,1);
  f.camera.updateProjectionMatrix();f.camera.position.set(0,.5,0);f.camera.lookAt(0,.5,-1);f.camera.updateMatrixWorld(true);f.step();assert.equal(f.rocks.stats.visible,1);assert.equal(f.rocks.stats.near,1);
  f.camera.position.set(0,.5,-10);f.camera.lookAt(0,.5,-20);f.camera.updateMatrixWorld(true);f.step();assert.equal(f.rocks.stats.visible,0);
  f.camera.position.set(0,3,50);f.camera.lookAt(0,1,0);f.camera.updateMatrixWorld(true);f.cameras=[];f.step();assert.equal(f.rocks.stats.visible,1,'An empty camera adapter falls back to the current camera.');
 }finally{f.dispose();}
});
test('aborted late model loads cannot allocate rock batches or alter borrowed resources',async()=>{
 const root=new Group(),camera=new PerspectiveCamera(),abort=new AbortController(),pending:((value:Group)=>void)[]=[];
 const rocks=createRegionalRocks({sourceRoot:root,camera,signal:abort.signal,load:()=>new Promise(resolve=>pending.push(resolve)),changed(){}});root.add(rocks.object);abort.abort();
 pending.forEach(resolve=>resolve(new Group()));await Promise.resolve();await Promise.resolve();assert.equal(rocks.stats.status,'disposed');assert.equal(rocks.object.children.length,0);assert.equal(rocks.stats.instanceBufferBytes,0);assert.equal(rocks.stats.lodStateBytes,0);rocks.dispose();
});
