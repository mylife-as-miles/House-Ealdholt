import assert from 'node:assert/strict';
import test from 'node:test';
import {BufferAttribute,BufferGeometry,DataTexture,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3,type WebGLRenderer} from 'three';
import {borrowRealisticTreeSource,normalizeRealisticTreeSource,REALISTIC_TREE_FAMILY,REALISTIC_TREE_SOURCES} from './realistic-tree-source';
import {createRealisticRegionalTrees,realisticTreeDetailLimit,realisticTreeMemoryBudget} from './realistic-regional-trees';
import type {VegetationPrototypeResources,createVegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {REALISTIC_TREE_COHORT_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import {REALISTIC_TREE_WALKING_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-walking';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {REGIONAL_ROOT_CONTACTS} from '../../../../shared/legacy/aethelgard/environment/regional-root-contact-data';

// CPU owner/contract fixtures only. These do not create or capture a game scene.
function fixture(){
 const map=new DataTexture(),components=[1393,8345,145].map((triangles,part)=>{
  const geometry=new BufferGeometry(),points=part===1?[-3,2,-3,3,2,-3,0,11,3]:[-.2,0,-.2,.2,0,-.2,0,0,.2,0,9,0];
  // An unused extreme vertex must not influence the measured wood envelope.
  geometry.setAttribute('position',new BufferAttribute(Float32Array.from([...points,500,-50,500]),3));
  const count=geometry.getAttribute('position').count;
  for(const [name,size]of [['normal',3],['tangent',4],['uv',2],['uv1',2],['uv2',2]]as const)geometry.setAttribute(name,new BufferAttribute(new Float32Array(count*size),size));
  geometry.setIndex(new BufferAttribute(Uint32Array.from({length:triangles*3},(_,i)=>part===1?i%3:i%4),1));
  const material=new MeshStandardMaterial({side:part===1?DoubleSide:0,map,normalMap:map,aoMap:map,roughnessMap:map,alphaTest:.3333});
  const source=new InstancedMesh(geometry,material,1);source.count=0;source.setMatrixAt(0,new Matrix4());geometry.setDrawRange(0,0);
  return{source,frame:new Matrix4()};
 });
 const woodland={borrowedPrototype:{name:REALISTIC_TREE_FAMILY+'_ExteriorPrototype',components}};
 return{woodland,map,components,dispose(){for(const {source}of components){source.dispose();source.geometry.dispose();source.material.dispose();}map.dispose();}};
}

test('complete qualified source ignores visual counts/ranges, measures referenced wood and borrows original PBR without mutation',()=>{
 const f=fixture(),before=f.components.map(c=>({frame:c.frame.toArray(),instance:Array.from(c.source.instanceMatrix.array),material:c.source.material,geometry:c.source.geometry}));
 try{const source=borrowRealisticTreeSource(f.woodland,REALISTIC_TREE_SOURCES.desktop);assert.ok(source);assert.equal(source.triangles,9883);assert.equal(source.bounds.min.y,0);assert.equal(source.bounds.max.y,11);assert.ok(source.contact.radius<.3);assert.equal(source.parts.length,3);
  for(let i=0;i<3;i++){assert.equal(source.parts[i].geometry,before[i].geometry);assert.equal(source.parts[i].material,before[i].material);assert.deepEqual(f.components[i].frame.toArray(),before[i].frame);assert.deepEqual(Array.from(f.components[i].source.instanceMatrix.array),before[i].instance);assert.equal(f.components[i].source.count,0);assert.equal(f.components[i].source.geometry.drawRange.count,0);}
  assert.equal(borrowRealisticTreeSource(f.woodland,'a'.repeat(64)),null);assert.equal(borrowRealisticTreeSource({borrowedPrototype:{...f.woodland.borrowedPrototype,components:f.components.slice(0,2)}},REALISTIC_TREE_SOURCES.desktop),null);
  const material=f.components[1].source.material,normal=material.normalMap;material.normalMap=null;assert.equal(borrowRealisticTreeSource(f.woodland,REALISTIC_TREE_SOURCES.desktop),null);material.normalMap=normal;
  const normalized=normalizeRealisticTreeSource(source);assert.ok(normalized);const old=REGIONAL_VEGETATION_PROTOTYPES[2],contact=REGIONAL_ROOT_CONTACTS[old.id];assert.equal(normalized.variant,2);assert.ok(normalized.height<=old.height+1e-6);assert.ok(normalized.canopyRadius<=old.canopyRadius+1e-6);assert.ok(normalized.contact.radius<=contact.radius);assert.ok(normalized.trunkRadius<=contact.radius);assert.equal(normalized.contact.baseY,contact.baseY);assert.equal(normalized.parts,source.parts,'normalization belongs to owned wrappers, not borrowed source geometry or frames');
  const tooWide={...source,bounds:source.bounds.clone()};tooWide.bounds.max.x=100;assert.equal(normalizeRealisticTreeSource(tooWide),null);
 }finally{f.dispose();}
});

test('bounded near leases use same-source captures and preserve actor data; retirement fences dispose wrappers without borrowed art',async()=>{
 for(const native of [false,true]){
  const f=fixture();for(const component of f.components)component.source.geometry.setDrawRange(0,Infinity);
  const source=normalizeRealisticTreeSource(borrowRealisticTreeSource(f.woodland,native?REALISTIC_TREE_SOURCES.quest:REALISTIC_TREE_SOURCES.desktop)!)!;
  const count=20,placements=Float32Array.from(Array.from({length:count},(_,i)=>[10+i*.5,-.08,0,.3+i*.01,1,2]).flat()),before=placements.slice();
  const layout:RegionalWorldLayout={version:'v7-root-contact-test',treeCount:count,shrubCount:0,placements,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:{version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:source.sourceSha256,ids:Uint32Array.from({length:count},(_,i)=>i),examined:count,rejectedRoot:0}};
  let finish!:()=>void;const idle=new Promise<void>(resolve=>{finish=resolve;}),queue={whenIdle:()=>idle}as unknown as WorldPreparationQueue;
  const maps=[new DataTexture(),new DataTexture()]as const,materials=new Map<string,MeshStandardMaterial>(),captures:unknown[]=[];let disposedArt=0,poolDisposed=0,identity:unknown,maximum=0;
  for(const c of f.components){c.source.geometry.addEventListener('dispose',()=>disposedArt++);c.source.material.addEventListener('dispose',()=>disposedArt++);}
  const resources={stats:{},material:(key:string,build:()=>MeshStandardMaterial)=>{if(!materials.has(key))materials.set(key,build());return{ready:Promise.resolve({material:materials.get(key)!}),release(){}};},
   geometry:(part:typeof source.parts[number])=>({ready:Promise.resolve({geometry:part.geometry,triangles:part.geometry.index!.count/3,sourceTriangles:part.geometry.index!.count/3}),release(){}}),
   atlas:(parts:unknown,tile:unknown,views:8|16,canopyOnly:boolean,topDown:boolean)=>{captures.push({parts,views,canopyOnly,topDown});return{ready:Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5.5,0],extent:[7,11],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}};},
   compile:()=>({ready:Promise.resolve({}),release(){}}),trim(){},dispose(){poolDisposed++;}}as unknown as VegetationPrototypeResources;
  const prepareResources=((_renderer,_queue,_worker,bytes,persistent)=>{maximum=bytes;identity=persistent;return resources;})as typeof createVegetationPrototypeResources;
  const root=new Group(),camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,3,10);camera.updateMatrixWorld();
  const owner=createRealisticRegionalTrees({source,sourceRoot:root,renderer:{}as WebGLRenderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,native,retirementFence:()=>idle,changed(){}},prepareResources);root.add(owner.object);
  try{assert.equal(owner.owns(0),false);await owner.prepare(layout);assert.equal(owner.stats.status,'ready');assert.equal(owner.stats.walkingGuardVersion,REALISTIC_TREE_WALKING_VERSION);assert.equal(owner.owns(0),true);assert.ok(captures.length>=2);assert.equal(maximum,realisticTreeMemoryBudget(native));assert.deepEqual(identity,{worldRegion:REALISTIC_TREE_COHORT_VERSION+':'+source.family,sourceSha256:source.sourceSha256,backend:native?'iwsdk-r185-webgl2-complete-tree-v1':'three-r185-webgl2-complete-tree-v1'});
   const visible=new Set(Array.from({length:count},(_,i)=>i));
   for(let tick=0;tick<14;tick++){owner.update(camera,tick*250,'low',false,visible);for(let i=0;i<60;i++)await Promise.resolve();assert.ok(owner.stats.detailed+owner.stats.preparing<=realisticTreeDetailLimit(native));}
   assert.equal(owner.stats.detailed,realisticTreeDetailLimit(native));assert.equal(owner.stats.far,count-realisticTreeDetailLimit(native));assert.ok(captures.every((capture:any)=>capture.parts.every((part:any)=>source.parts.some(p=>p.geometry===part.geometry&&p.material===part.material))));
   const tree=owner.object.getObjectByName('Authored regional tree 0')!;assert.ok(tree);const expected=new Matrix4().compose(new Vector3(placements[0],placements[1],placements[2]),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),placements[3]),new Vector3().setScalar(placements[4])).multiply(source.normalization);assert.ok(tree.matrix.equals(expected));assert.deepEqual(placements,before);
   let wrapperDisposals=0,viewDisposals=0;owner.object.traverse(node=>{if(node instanceof InstancedMesh){node.addEventListener('dispose',()=>wrapperDisposals++);if(node.geometry.hasAttribute('crownfallLodRange'))node.geometry.addEventListener('dispose',()=>viewDisposals++);}});
   owner.dispose();owner.dispose();assert.equal(wrapperDisposals,0);assert.equal(viewDisposals,0);assert.equal(poolDisposed,0);assert.equal(disposedArt,0);finish();for(let i=0;i<60;i++)await Promise.resolve();assert.ok(wrapperDisposals>0);assert.ok(viewDisposals>0);assert.equal(poolDisposed,1);assert.equal(disposedArt,0);
  }finally{owner.dispose();finish();for(let i=0;i<60;i++)await Promise.resolve();materials.forEach(m=>m.dispose());maps.forEach(m=>m.dispose());f.dispose();}
 }
});

test('failed or mismatched source captures retain original regional ownership and never hot-swap later',async()=>{
 const f=fixture(),source=normalizeRealisticTreeSource(borrowRealisticTreeSource(f.woodland,REALISTIC_TREE_SOURCES.desktop)!)!,queue={whenIdle:()=>Promise.resolve()}as unknown as WorldPreparationQueue;
 const layout:RegionalWorldLayout={version:'v7-root-contact-test',treeCount:1,shrubCount:0,placements:Float32Array.from([20,-.08,0,0,1,2]),rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:{version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:source.sourceSha256,ids:Uint32Array.from([0]),examined:1,rejectedRoot:0}};
 let captures=0;const resources={stats:{},atlas:()=>{captures++;return{ready:Promise.reject(Error('Capture unavailable')),release(){}};},dispose(){}}as unknown as VegetationPrototypeResources;
 const factory=(()=>resources)as typeof createVegetationPrototypeResources,make=()=>createRealisticRegionalTrees({source,sourceRoot:new Group(),renderer:{}as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,retirementFence:()=>queue.whenIdle(),changed(){}},factory);
 const failed=make(),mismatched=make();
 try{await failed.prepare(layout);assert.equal(failed.stats.status,'fallback');assert.equal(failed.owns(0),false);assert.match(failed.stats.error,/Capture unavailable/);assert.equal(captures,1);
  await mismatched.prepare({...layout,realisticTrees:{...layout.realisticTrees!,sourceSha256:REALISTIC_TREE_SOURCES.quest}});assert.equal(mismatched.stats.status,'fallback');assert.equal(mismatched.owns(0),false);
  await mismatched.prepare(layout);assert.equal(mismatched.owns(0),false);assert.equal(captures,1,'an initial fallback cannot silently change actor sources after first presentation');
 }finally{failed.dispose();mismatched.dispose();for(let i=0;i<20;i++)await Promise.resolve();f.dispose();}
});


test('missing, old and unknown walking proofs keep original actors without captures or owned promotions',async()=>{
 const f=fixture(),source=normalizeRealisticTreeSource(borrowRealisticTreeSource(f.woodland,REALISTIC_TREE_SOURCES.desktop)!)!,queue={whenIdle:()=>Promise.resolve()}as unknown as WorldPreparationQueue;
 const placements=Float32Array.from([20,-.08,0,0,1,2]),before=placements.slice();
 const oldCohort:NonNullable<RegionalWorldLayout['realisticTrees']>={version:REALISTIC_TREE_COHORT_VERSION,sourceSha256:source.sourceSha256,ids:Uint32Array.from([0]),examined:1,rejectedRoot:0};
 let captures=0;const resources={stats:{},atlas(){captures++;throw Error('Unqualified cohorts must not request a capture.');},dispose(){}}as unknown as VegetationPrototypeResources;
 const factory=(()=>resources)as typeof createVegetationPrototypeResources;
 try{for(const native of [false,true])for(const guard of [undefined,'terrain-walk-volume-v0','terrain-walk-volume-v2']){
  const cohort=guard===undefined?oldCohort:{...oldCohort,walkingGuardVersion:guard};
  const layout:RegionalWorldLayout={version:'v7-root-contact-test',treeCount:1,shrubCount:0,placements,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:cohort};
  const owner=createRealisticRegionalTrees({source,sourceRoot:new Group(),renderer:{}as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,native,retirementFence:()=>queue.whenIdle(),changed(){}},factory);
  try{await owner.prepare(layout);assert.equal(owner.stats.status,'fallback');assert.equal(owner.stats.eligible,0);assert.equal(owner.owns(0),false);assert.equal(owner.object.children.length,0);assert.equal(captures,0);assert.deepEqual(placements,before);
   await owner.prepare({...layout,realisticTrees:{...oldCohort,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION}});assert.equal(owner.owns(0),false);assert.equal(captures,0,'an initial fallback cannot promote actors later');
  }finally{owner.dispose();for(let i=0;i<20;i++)await Promise.resolve();}
 }}finally{f.dispose();}
});
