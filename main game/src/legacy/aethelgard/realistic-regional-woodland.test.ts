import {FOREST01_DENSITY_WALKING} from '../../../../shared/legacy/aethelgard/environment/forest01-density-walking-data';
import assert from 'node:assert/strict';
import test from 'node:test';
import {BufferAttribute,BufferGeometry,DataTexture,DirectionalLight,DoubleSide,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {borrowForest01TreeSource,borrowRealisticTreeSource,normalizeRealisticTreeSource,REALISTIC_FOREST01_FAMILY,REALISTIC_TREE_FAMILY,REALISTIC_TREE_SOURCES} from './realistic-tree-source';
import {createRealisticRegionalWoodland,scopeRealisticTreeResources} from './realistic-regional-woodland';
import type {VegetationPrototypeResources,createVegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {REALISTIC_TREE_COHORT_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import {REALISTIC_TREE_WALKING_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-walking';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldEnvironment} from './world-environment';
import {createWorldVoxelGI} from './voxel-gi';

// CPU contract fixtures, never a generated or captured village/demo.
function fixture(forest=false){const map=new DataTexture(),root=new Group(),family=new Group();family.name=forest?REALISTIC_FOREST01_FAMILY+'_cell_0_0':REALISTIC_TREE_FAMILY+'_ExteriorPrototype';family.userData.crownfallElderbloom={kind:'tree'};root.add(family);
 const components=(forest?[3941,3999,50471]:[1393,145,8345]).map((triangles,part)=>{
  const foliage=part===2,height=forest?20.9:11,geometry=new BufferGeometry(),points=foliage?[-3,2,-3,3,2,-3,0,height,3]:[-.2,0,-.2,.2,0,-.2,0,0,.2,0,part===0?height*.9:height*.4,0];
  geometry.setAttribute('position',new BufferAttribute(Float32Array.from(points),3));const count=geometry.getAttribute('position').count;
  for(const[name,size]of[['normal',3],['tangent',4],['uv',2],['uv1',2],['uv2',2]]as const)geometry.setAttribute(name,new BufferAttribute(new Float32Array(count*size),size));
  geometry.setIndex(new BufferAttribute(Uint32Array.from({length:triangles*3},(_,i)=>i%count),1));const material=new MeshStandardMaterial({side:foliage?DoubleSide:0,map,normalMap:map,aoMap:map,roughnessMap:map,alphaTest:.3333}),source=new InstancedMesh(geometry,material,2);
  source.setMatrixAt(0,new Matrix4().makeTranslation(40,2,50));source.setMatrixAt(1,new Matrix4().makeTranslation(-20,1,-30));family.add(source);return{source,frame:new Matrix4()};
 });root.updateMatrixWorld(true);const borrowed=forest?borrowForest01TreeSource(root,REALISTIC_TREE_SOURCES.desktop):borrowRealisticTreeSource({borrowedPrototype:{name:family.name,components}},REALISTIC_TREE_SOURCES.desktop);assert.ok(borrowed);const source=normalizeRealisticTreeSource(borrowed);assert.ok(source);
 return{root,family,components,source,map,dispose(){components.forEach(({source})=>{source.dispose();source.geometry.dispose();source.material.dispose();});map.dispose();}};
}
const tick=async()=>{for(let i=0;i<120;i++)await Promise.resolve();};

test('Forest01 borrows all original primitives in validated canonical frames and fails closed for incomplete, divergent or Native sources',()=>{
 const f=fixture(true),before=f.components.map(p=>({geometry:p.source.geometry,material:p.source.material,matrix:Array.from(p.source.instanceMatrix.array)}));
 try{assert.equal(f.source.triangles,58411);assert.equal(f.source.variant,1);assert.equal(f.source.family,REALISTIC_FOREST01_FAMILY);assert.equal(f.source.parts.length,3);assert.ok(f.source.parts.every(p=>p.frame.equals(new Matrix4())));
  assert.equal(borrowForest01TreeSource(f.root,REALISTIC_TREE_SOURCES.quest),null,'the Quest asset is not a Desktop Forest01 transplant');
  for(let i=0;i<3;i++){assert.equal(f.source.parts[i].geometry,before[i].geometry);assert.equal(f.source.parts[i].material,before[i].material);assert.deepEqual(Array.from(f.components[i].source.instanceMatrix.array),before[i].matrix);}
  f.components[1].source.setMatrixAt(1,new Matrix4().makeTranslation(-19,1,-30));assert.equal(borrowForest01TreeSource(f.root,REALISTIC_TREE_SOURCES.desktop),null,'all actor component rows, not just actor zero, must agree');f.components[1].source.setMatrixAt(1,new Matrix4().makeTranslation(-20,1,-30));
  f.components[2].source.removeFromParent();assert.equal(borrowForest01TreeSource(f.root,REALISTIC_TREE_SOURCES.desktop),null);
 }finally{f.dispose();}
});

test('a shared resource scope retains ready and pending leases until compiler completion and a world GPU fence, including failed preparation',async()=>{
 let ready!:()=>void,finish!:()=>void,releases=0;const preparation=new Promise<void>(resolve=>{ready=resolve;}),fence=new Promise<void>(resolve=>{finish=resolve;});
 const base={stats:{},compile:()=>({ready:preparation,release(){releases++;}}),atlas:()=>({ready:Promise.reject(Error('Failed capture.')),release(){releases++;}})}as unknown as VegetationPrototypeResources;
 const scope=scopeRealisticTreeResources(base,()=>fence),a=scope.resources.compile('key',[],new PerspectiveCamera(),new Scene()),b=scope.resources.atlas([],64,8);a.release();a.release();b.release();scope.resources.dispose();await tick();assert.equal(releases,0);ready();await tick();assert.equal(releases,0);finish();await scope.disposed;assert.equal(releases,2);
});

test('Forest01 and PP3 share one16MiB pool and weighted pending/live/retiring detail allowance with separate same-source captures',async()=>{
 const p=fixture(),f=fixture(true),placements=Float32Array.from([...Array.from({length:12},(_,i)=>[10+i*.5,-.08,0,.3+i*.01,1,2]).flat(),...[12,-.08,0,.3,1,1,14,-.08,0,.3,1,1]]),before=placements.slice();
 const cohort=(ids:number[]):NonNullable<RegionalWorldLayout['realisticTrees']>=>({version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:p.source.sourceSha256,ids:Uint32Array.from(ids),examined:ids.length,rejectedRoot:0});
 const layout:RegionalWorldLayout={version:'same-source-test',treeCount:14,shrubCount:0,placements,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:cohort(Array.from({length:12},(_,i)=>i)),realisticForest01Trees:cohort([12,13])};
 let finish!:()=>void;const idle=new Promise<void>(resolve=>{finish=resolve;}),queue={whenIdle:()=>idle}as unknown as WorldPreparationQueue;
 const maps=[new DataTexture(),new DataTexture()]as const,materials=new Map<string,MeshStandardMaterial>(),captures:{parts:unknown;views:8|16}[]=[],compileKeys:string[]=[];let calls=0,maximum=0,identity:unknown,resolveIdentity:Parameters<typeof createVegetationPrototypeResources>[5],poolDisposed=0,disposedArt=0;
 for(const source of[p.source,f.source])for(const part of source.parts){part.geometry.addEventListener('dispose',()=>disposedArt++);part.material.addEventListener('dispose',()=>disposedArt++);}
 const resources={stats:{},material:(key:string,build:()=>MeshStandardMaterial)=>{if(!materials.has(key))materials.set(key,build());return{ready:Promise.resolve({material:materials.get(key)!}),release(){}};},
  geometry:(part:typeof p.source.parts[number])=>({ready:Promise.resolve({geometry:part.geometry,triangles:part.geometry.index!.count/3,sourceTriangles:part.geometry.index!.count/3,error:0}),release(){}}),
  atlas:(parts:unknown,_tile:unknown,views:8|16)=>{captures.push({parts,views});return{ready:Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5.5,0],extent:[7,11],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}};},
  compile:(key:string)=>{compileKeys.push(key);return{ready:Promise.resolve({}),release(){}};},trim(){},dispose(){poolDisposed++;}}as unknown as VegetationPrototypeResources;
 const factory=((_r,_q,_w,bytes,persistent,resolver)=>{calls++;maximum=bytes;identity=persistent;resolveIdentity=resolver;return resources;})as typeof createVegetationPrototypeResources;
 const root=new Group(),camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,3,10);camera.updateMatrixWorld();const owner=createRealisticRegionalWoodland({source:p.source,forest01Source:f.source,sourceRoot:root,renderer:{}as WebGLRenderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,retirementFence:()=>idle,changed(){}},factory);root.add(owner.object);
 try{await owner.prepare(layout);assert.equal(calls,1);assert.equal(maximum,16*1024**2);assert.equal(owner.owns(0),true);assert.equal(owner.owns(12),true);assert.equal(owner.stats.eligible,14);
  assert.deepEqual(identity,{worldRegion:REALISTIC_TREE_COHORT_VERSION+':'+p.source.family,sourceSha256:p.source.sourceSha256,backend:'three-r185-webgl2-complete-tree-v1'});assert.equal(resolveIdentity!(p.source.parts),undefined);assert.throws(()=>resolveIdentity!([f.source.parts[0],f.source.parts[0],f.source.parts[2]]),/Unqualified capture source/);assert.deepEqual(resolveIdentity!(f.source.parts),{worldRegion:REALISTIC_TREE_COHORT_VERSION+':'+f.source.family,sourceSha256:f.source.sourceSha256,backend:'three-r185-webgl2-complete-tree-v1'});
  assert.ok(compileKeys.includes('complete-alder-global-captures-v1'));assert.ok(compileKeys.includes('complete-alder-global-captures-v1:'+f.source.family));
  const pp3Visible=new Set(Array.from({length:12},(_,i)=>i));for(let i=0;i<14;i++){owner.update(camera,i*250,'low',false,pp3Visible);await tick();}assert.equal(owner.stats.budget.chargedSourceTriangles,79064);assert.equal(owner.stats.pp3.detailed,8);
  const allVisible=new Set([...pp3Visible,12,13]);for(let i=14;i<18;i++){owner.update(camera,i*250,'low',false,allVisible);await tick();}assert.equal(owner.stats.budget.chargedSourceTriangles,79064);assert.equal(owner.stats.budget.retiring,6);assert.equal(owner.stats.forest01!.detailed,0,'no heavy source slips into space still owned by retiring PP3 models');
  finish();await tick();for(let i=18;i<26;i++){owner.update(camera,i*250,'low',false,allVisible);await tick();assert.ok(owner.stats.budget.chargedSourceTriangles<=79064);}assert.equal(owner.stats.budget.chargedSourceTriangles,78177);assert.equal(owner.stats.forest01!.detailed,1);assert.equal(owner.stats.pp3.detailed,2);assert.ok(captures.some(c=>c.views===16&&(c.parts as typeof f.source.parts).every(part=>f.source.parts.some(original=>part.geometry===original.geometry&&part.material===original.material))));assert.deepEqual(placements,before);assert.equal(disposedArt,0);
  owner.dispose();await tick();assert.equal(owner.stats.budget.chargedSourceTriangles,0);assert.equal(poolDisposed,1);assert.equal(disposedArt,0);
 }finally{finish();owner.dispose();await tick();materials.forEach(m=>m.dispose());maps.forEach(m=>m.dispose());p.dispose();f.dispose();}
});

test('failed or stale Forest01 proof retains its original source while PP3 remains ready, and Native ignores the Desktop-only family',async()=>{
 for(const mode of ['failed-capture','missing-proof','combined-cohort-over-cap','native']as const){
  const p=fixture(),f=fixture(true),rows=mode==='combined-cohort-over-cap'?129:2,placements=Float32Array.from(Array.from({length:rows},(_,id)=>[10+id,-.08,0,0,1,id?1:2]).flat());
  const cohort=(ids:number[]):NonNullable<RegionalWorldLayout['realisticTrees']>=>({version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:p.source.sourceSha256,ids:Uint32Array.from(ids),examined:ids.length,rejectedRoot:0});
  const forestCohort=cohort(Array.from({length:rows-1},(_,id)=>id+1));if(mode==='missing-proof')delete (forestCohort as {walkingGuardVersion?:string}).walkingGuardVersion;
  const layout:RegionalWorldLayout={version:'source-failure-test',treeCount:rows,shrubCount:0,placements,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:cohort([0]),realisticForest01Trees:forestCohort};
  const queue={whenIdle:()=>Promise.resolve()}as unknown as WorldPreparationQueue,maps=[new DataTexture(),new DataTexture()]as const;let forestCaptures=0,pp3Captures=0,maximum=0,calls=0;
  const resources={stats:{},atlas:(parts:typeof p.source.parts,_tile:unknown,views:8|16)=>{const forest=parts.some(part=>f.source.parts.some(s=>s.geometry===part.geometry));if(forest)forestCaptures++;else pp3Captures++;return{ready:forest&&mode==='failed-capture'?Promise.reject(Error('Forest01 capture unavailable.')):Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5.5,0],extent:[7,11],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}};},compile:()=>({ready:Promise.resolve({}),release(){}}),dispose(){}}as unknown as VegetationPrototypeResources;
  const factory=((_r,_q,_w,bytes)=>{calls++;maximum=bytes;return resources;})as typeof createVegetationPrototypeResources;
  const owner=createRealisticRegionalWoodland({source:p.source,forest01Source:f.source,sourceRoot:new Group(),renderer:{}as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,native:mode==='native',retirementFence:()=>queue.whenIdle(),changed(){}},factory);
  try{await owner.prepare(layout);assert.equal(calls,1);assert.equal(maximum,(mode==='native'?8:16)*1024**2);assert.equal(owner.owns(0),true);assert.equal(owner.owns(1),false);assert.equal(owner.stats.budget.chargedSourceTriangles,0);assert.equal(pp3Captures,2);assert.equal(forestCaptures,mode==='failed-capture'?1:0);if(mode==='native')assert.equal(owner.stats.forest01,null);else assert.equal(owner.stats.forest01!.status,'fallback');
  }finally{owner.dispose();await tick();maps.forEach(m=>m.dispose());p.dispose();f.dispose();}
 }
});

for(const mode of['available','busy-pool','refused-bytes','no-extra-candidate']as const)test(`demand-driven Reduced Motion admits an optional tree after primary settlement without polling (${mode})`,async context=>{
 const p=fixture(),f=fixture(true),maps=[new DataTexture(),new DataTexture()]as const,materials:MeshStandardMaterial[]=[],derived:BufferGeometry[]=[];f.source.normalization.fromArray(FOREST01_DENSITY_WALKING.normalization);
 const placements=Float32Array.from([10,-.08,0,0,1,2,14,-.08,0,0,1,2,15,-.08,0,0,1,1,35,-.08,0,0,1,1]),before=placements.slice(),visible=new Set(mode==='no-extra-candidate'?[0,1,2]:[0,1,2,3]);
 const cohort=(ids:number[]):NonNullable<RegionalWorldLayout['realisticTrees']>=>({version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:f.source.sourceSha256,ids:Uint32Array.from(ids),examined:ids.length,rejectedRoot:0});
 const layout:RegionalWorldLayout={version:'demand-idle-fixture',placements,treeCount:4,shrubCount:0,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:cohort([0,1]),realisticForest01Trees:{...cohort([2,3]),density:{proofSha256:FOREST01_DENSITY_WALKING.sha256,proofTriangles:FOREST01_DENSITY_WALKING.triangles,producer:FOREST01_DENSITY_WALKING.producer,normalization:FOREST01_DENSITY_WALKING.normalization,version:'forest01-whole-leaf-clusters-v1',walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,ids:Uint32Array.from([2,3]),rejected:0,uncertain:0}}};
 const queue={whenIdle:()=>Promise.resolve()}as unknown as WorldPreparationQueue,memory={reservedBytes:mode==='busy-pool'?1:0};let byteAttempts=0,privateBytes=0,demand=true,frames=0,settledFollowups=0,releaseForest!:()=>void;const forestReady=new Promise<void>(resolve=>{releaseForest=resolve;});
 const resources={stats:memory,ownerBuffers:(_key:string,bytes:number)=>{byteAttempts++;if(mode==='refused-bytes')throw Error('Transient private-byte pressure.');privateBytes+=bytes;let released=false;return{ready:Promise.resolve({bytes}),release(){if(!released){released=true;privateBytes-=bytes;}}};},
  geometry:(part:typeof f.source.parts[number],detail:string)=>{const index=f.source.parts.findIndex(p=>p.geometry===part.geometry),density=detail==='forest01-density',triangles=index<0?part.geometry.index!.count/3:[1346,1398,density?31845:41589][index],geometry=part.geometry.clone();geometry.setIndex(new BufferAttribute(Uint32Array.from({length:triangles*3},(_,i)=>i%geometry.getAttribute('position').count),1));derived.push(geometry);return{ready:(index<0?Promise.resolve():forestReady).then(()=>({geometry,triangles,sourceTriangles:part.geometry.index!.count/3,error:0,densityProof:index<0?undefined:index})),release(){}};},
  material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return{ready:Promise.resolve({material}),release(){}};},atlas:(_parts:unknown,_tile:unknown,views:8|16)=>({ready:Promise.resolve({maps,bytes:1,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,7,0],extent:[7,14],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}}),compile:()=>({ready:Promise.resolve({}),release(){}}),trim(){},dispose(){}}as unknown as VegetationPrototypeResources;
 const camera=new PerspectiveCamera(64,1.6,.1,2000);camera.position.set(15,3,10);camera.updateMatrixWorld();
 const owner=createRealisticRegionalWoodland({source:p.source,forest01Source:f.source,sourceRoot:new Group(),renderer:{}as WebGLRenderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,retirementFence:()=>Promise.resolve(),changed(){demand=true;}},()=>resources);
 async function drain(){for(let turn=0;demand&&turn<24;turn++){demand=false;const before=owner.stats.forest01!.primarySettled,transition=owner.update(camera,frames++*250,'low',true,visible);if(transition){demand=true;if(!before&&owner.stats.forest01!.primarySettled)settledFollowups++;}await tick();}assert.equal(demand,false,'The static demand loop must quiesce, never poll an unadmitted optional role.');}
 try{await owner.prepare(layout);await drain();assert.equal(owner.stats.pp3.primarySettled,true);assert.equal(owner.stats.forest01!.primarySettled,false);assert.equal(owner.stats.preparing,1,'Only the Forest01 producer is still pending; no unrelated wake may hide its final settlement.');releaseForest();await tick();await drain();context.diagnostic(JSON.stringify({mode,frames,settledFollowups,densityActorIds:owner.stats.forest01!.densityActorIds,byteAttempts}));assert.deepEqual(owner.stats.forest01!.fullActorIds,[2]);assert.equal(owner.stats.pp3.detailed,2);assert.equal(owner.stats.forest01!.primarySettled,true);assert.equal(owner.stats.pp3.primarySettled,true);assert.equal(owner.stats.preparing,0);
  if(mode==='available'){assert.deepEqual(owner.stats.forest01!.densityActorIds,[3],'A primary-settlement update must leave one legitimate next frame for optional admission.');assert.equal(byteAttempts,1);assert.equal(settledFollowups,1);assert.equal(owner.stats.budget.chargedSourceTriangles,112766);}
  else{assert.deepEqual(owner.stats.forest01!.densityActorIds,[]);assert.equal(owner.stats.budget.forest01Density,0);assert.equal(byteAttempts,mode==='refused-bytes'?1:0);assert.equal(settledFollowups,mode==='refused-bytes'?1:0);}
  const idleFrames=frames;await tick();await drain();assert.equal(frames,idleFrames,'No timer, hidden wake or permanent pressure retry keeps the scene rendering.');assert.equal(owner.stats.forest01!.densityFailures,0);assert.deepEqual(placements,before);
  if(mode==='busy-pool'){memory.reservedBytes=0;demand=true;await drain();assert.deepEqual(owner.stats.forest01!.densityActorIds,[3],'A real later resource-change render can admit the valid fallback.');assert.equal(byteAttempts,1);}
 }finally{releaseForest();owner.dispose();await tick();assert.equal(privateBytes,0);maps.forEach(map=>map.dispose());materials.forEach(material=>material.dispose());derived.forEach(geometry=>geometry.dispose());p.dispose();f.dispose();}
});

test('one source owner preserves primary L0, defers optional readiness and fences both roles before promotion; optional failure does not poison full admission',async()=>{
 for(const mode of['valid','variant-failure','pool-pressure']as const){const failExtra=mode==='variant-failure';
  const p=fixture(),f=fixture(true),maps=[new DataTexture(),new DataTexture()]as const,materials:MeshStandardMaterial[]=[],derived:BufferGeometry[]=[],keys:string[]=[];f.source.normalization.fromArray(FOREST01_DENSITY_WALKING.normalization);
  const placements=Float32Array.from([10,-.08,0,0,1,2,14,-.08,0,0,1,2,15,-.08,0,0,1,1,35,-.08,0,0,1,1]),before=placements.slice();
  const cohort=(ids:number[]):NonNullable<RegionalWorldLayout['realisticTrees']>=>({version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:f.source.sourceSha256,ids:Uint32Array.from(ids),examined:ids.length,rejectedRoot:0});
  const forestCohort={...cohort([2,3]),density:{proofSha256:FOREST01_DENSITY_WALKING.sha256,proofTriangles:FOREST01_DENSITY_WALKING.triangles,producer:FOREST01_DENSITY_WALKING.producer,normalization:FOREST01_DENSITY_WALKING.normalization,version:'forest01-whole-leaf-clusters-v1',walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,ids:Uint32Array.from([2,3]),rejected:0,uncertain:0}};
  const layout:RegionalWorldLayout={version:'role-fixture',placements,treeCount:4,shrubCount:0,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:cohort([0,1]),realisticForest01Trees:forestCohort};
  let held=false,finish!:()=>void;const fence=new Promise<void>(resolve=>{finish=resolve;}),queue={whenIdle:()=>held?fence:Promise.resolve()}as unknown as WorldPreparationQueue;
  const {createVegetationPrototypeResources:makeMemoryPool}=await import('./vegetation-prototype'),memory=makeMemoryPool({}as WebGLRenderer,queue,{}as VegetationPreparationWorker,32768),blocker=mode==='pool-pressure'?memory.ownerBuffers('temporary-pressure',32768):null;await blocker?.ready;
  const resources={stats:memory.stats,ownerBuffers:memory.ownerBuffers,geometry:(part:typeof f.source.parts[number],detail:string)=>{
   const index=f.source.parts.findIndex(p=>p.geometry===part.geometry),density=detail==='forest01-density';if(density&&failExtra)return{ready:Promise.reject(Error('Only the optional variant failed.')),release(){}};
   const triangles=index<0?part.geometry.index!.count/3:[1346,1398,density?31845:41589][index],geometry=part.geometry.clone();geometry.setIndex(new BufferAttribute(Uint32Array.from({length:triangles*3},(_,i)=>i%geometry.getAttribute('position').count),1));derived.push(geometry);
   return{ready:Promise.resolve({geometry,triangles,sourceTriangles:part.geometry.index!.count/3,error:0,densityProof:index<0?undefined:index}),release(){}};},
   material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return{ready:Promise.resolve({material}),release(){}};},
   atlas:(_parts:unknown,_tile:unknown,views:8|16)=>({ready:Promise.resolve({maps,bytes:1,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,7,0],extent:[7,14],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}}),
   compile:(key:string)=>{keys.push(key);return{ready:Promise.resolve({}),release(){}};},trim(){memory.trim();},dispose(){memory.dispose();}}as unknown as VegetationPrototypeResources;
  const camera=new PerspectiveCamera(64,1.6,.1,2000);camera.position.set(15,3,10);camera.updateMatrixWorld();const owner=createRealisticRegionalWoodland({source:p.source,forest01Source:f.source,sourceRoot:new Group(),renderer:{}as WebGLRenderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,retirementFence:()=>held?fence:Promise.resolve(),changed(){}},()=>resources);
  const visible=new Set([0,1,2,3]);
  let presentationStep=0;const pump=async(count:number)=>{for(let i=0;i<count;i++){owner.update(camera,presentationStep++*250,'low',true,visible);await tick();}};
  try{await owner.prepare(layout);await pump(35);
   if(blocker){assert.deepEqual(owner.stats.forest01!.densityActorIds,[]);assert.equal(owner.stats.forest01!.densityFailures,0,'pool refusal is not invalid source');assert.equal(owner.stats.budget.forest01Density,0);blocker.release();memory.trim();await pump(20);assert.equal(owner.stats.forest01!.densityError,'');}
   assert.deepEqual(owner.stats.forest01!.fullActorIds,[2]);assert.equal(owner.stats.pp3.detailed,2);assert.ok(owner.stats.forest01!.levels[0]>=1,'nearest primary remains L0');
   if(failExtra){assert.equal(owner.stats.forest01!.error,'');assert.match(owner.stats.forest01!.densityError,/Only the optional/);assert.equal(owner.stats.forest01!.densityFailures,1);assert.equal(owner.stats.budget.forest01Density,0);assert.equal(owner.stats.budget.chargedSourceTriangles,78177);}else{assert.deepEqual(owner.stats.forest01!.densityActorIds,[3]);assert.equal(owner.stats.budget.chargedSourceTriangles,112766);assert.equal(owner.stats.forest01!.far,0);}
   held=true;camera.position.x=35;camera.updateMatrixWorld();await pump(4);
   assert.deepEqual(owner.stats.forest01!.fullActorIds,[]);assert.deepEqual(owner.stats.forest01!.densityActorIds,[]);assert.equal(owner.stats.forest01!.far,2,'matching atlas remains while roles retire');assert.ok(owner.stats.budget.retiring>=1);assert.ok(owner.stats.budget.chargedSourceTriangles<=112766);
   finish();held=false;await tick();for(let i=0;i<31;i++){await pump(1);assert.ok(owner.stats.budget.chargedSourceTriangles<=112766);assert.ok(owner.stats.budget.forest01<=1);assert.ok(owner.stats.budget.forest01Density<=1);assert.ok(owner.stats.budget.pp3<=2);}
   assert.deepEqual(owner.stats.forest01!.fullActorIds,[3],'a prior optional failure does not block later full admission');assert.deepEqual(placements,before);assert.ok(keys.filter(k=>k.includes('forest01-whole-leaf-clusters-v1')).every(k=>!k.includes('level0')));
  }finally{finish();held=false;blocker?.release();owner.dispose();await tick();memory.dispose();maps.forEach(m=>m.dispose());materials.forEach(m=>m.dispose());derived.forEach(g=>g.dispose());p.dispose();f.dispose();}
 }
});

test('actual near-tree wiring cancels complete producers and returns credit through a fresh GPU fence while unrelated global queue stays busy',async()=>{
 const f=fixture(),maps=[new DataTexture(),new DataTexture()]as const,materials:MeshStandardMaterial[]=[],borrowed=f.source.parts.flatMap(part=>[part.geometry,part.material]);let borrowedDisposed=0;
 borrowed.forEach(value=>value.addEventListener('dispose',()=>borrowedDisposed++));
 let finishQueue!:()=>void,finishCompile!:()=>void,queueCalls=0,gpuAllowed=false,gpuFences=0,rawRefs=0,poolDisposed=false;
 const busy=new Promise<void>(resolve=>{finishQueue=resolve;}),compile=new Promise<void>(resolve=>{finishCompile=resolve;}),queue={whenIdle(){queueCalls++;return busy;}}as unknown as WorldPreparationQueue;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,TIMEOUT_EXPIRED:3,WAIT_FAILED:4,isContextLost:()=>false,fenceSync(){gpuFences++;return{};},flush(){},clientWaitSync(){return gpuAllowed?2:3;},deleteSync(){}};
 const paid=<T,>(ready:Promise<T>)=>{rawRefs++;let released=false;return{ready,release(){if(released)return;released=true;rawRefs--;}};};
 const resources={stats:{reservedBytes:0},material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return paid(Promise.resolve({material}));},geometry:(part:typeof f.source.parts[number])=>{const lease=paid(Promise.resolve({geometry:part.geometry,triangles:part.geometry.index!.count/3,sourceTriangles:part.geometry.index!.count/3,error:0}));return{...lease,releaseUnsubmitted:lease.release};},
  atlas:(_parts:unknown,_tile:unknown,views:8|16)=>paid(Promise.resolve({maps,bytes:1,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5.5,0],extent:[7,11],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}})),
  compile:(key:string)=>paid(key.includes(':level:1')?compile.then(()=>({})):Promise.resolve({})),trim(){},dispose(){poolDisposed=true;}}as unknown as VegetationPrototypeResources;
 const placements=Float32Array.from(Array.from({length:16},(_,id)=>[10+id,-.08,0,0,1,2]).flat()),layout:RegionalWorldLayout={version:'owned-retirement-fixture',placements,treeCount:16,shrubCount:0,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:{version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:f.source.sourceSha256,ids:Uint32Array.from({length:16},(_,id)=>id),examined:16,rejectedRoot:0}};
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,3,10);camera.updateMatrixWorld();const root=new Group(),owner=createRealisticRegionalWoodland({source:f.source,sourceRoot:root,renderer:{getContext:()=>gl}as unknown as WebGLRenderer,scene:new Scene(),camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,changed(){}},()=>resources);root.add(owner.object);
 try{await owner.prepare(layout);for(let i=0;i<5;i++){owner.update(camera,i*250,'low',true,new Set([0,1]));await tick();}assert.equal(owner.stats.preparing,2);assert.equal(owner.stats.budget.leases,2);
  const before=rawRefs;owner.update(camera,1500,'low',true,new Set());await tick();assert.equal(owner.stats.budget.retiring,2);assert.equal(owner.stats.budget.leases,2);assert.equal(gpuFences,0,'no fence before complete pending compilation');assert.equal(rawRefs,before);assert.equal(owner.object.getObjectByName('Authored regional tree 0'),undefined,'stop synchronously detached the old draw');
  finishCompile();await tick();assert.ok(gpuFences>=2);assert.equal(owner.stats.budget.leases,2,'unsignalled GPU still owns credits');assert.equal(rawRefs,before);assert.equal(queueCalls,0,'related owner retirement never consulted the busy unrelated queue');
  gpuAllowed=true;await new Promise(resolve=>setTimeout(resolve,35));await tick();owner.update(camera,1750,'low',true,new Set());assert.equal(owner.stats.budget.leases,0);assert.equal(owner.stats.budget.retiring,0);assert.equal(owner.stats.retiring,0);assert.equal(borrowedDisposed,0);assert.equal(queueCalls,0);
  owner.dispose();await tick();assert.ok(queueCalls>0,'global capture/source teardown retains the whole-view barrier');assert.equal(poolDisposed,false);finishQueue();await new Promise(resolve=>setTimeout(resolve,35));await tick();assert.equal(poolDisposed,true);assert.equal(rawRefs,0);assert.equal(borrowedDisposed,0);
 }finally{gpuAllowed=true;finishCompile();finishQueue();owner.dispose();await new Promise(resolve=>setTimeout(resolve,35));await tick();maps.forEach(m=>m.dispose());materials.forEach(m=>m.dispose());f.dispose();}
});

for(const adapter of['weather','voxel']as const)for(const outcome of['complete','cancelled','compile-failure','context-lost']as const){
 test(`actual ${adapter} preview readers preserve retiring private tree geometry (${outcome})`,async()=>{
  const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  class SourceWorker{onmessage:((event:{data:{id:number;bytes:number}})=>void)|null=null;onerror=null;
   constructor(_url:unknown,options?:{name?:string}){if(options?.name!=='Crownfall static voxel transport')throw Error('Cloud generation is outside this CPU lifetime fixture.');}
   postMessage(message:{kind:string;id:number}){if(message.kind==='init')queueMicrotask(()=>this.onmessage?.({data:{id:message.id,bytes:0}}));}terminate(){}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:SourceWorker});
  const f=fixture(),maps=[new DataTexture(),new DataTexture()]as const,materials:MeshStandardMaterial[]=[],queue=createWorldPreparationQueue(()=>{}),scene=new Scene(),root=new Group(),sun=new DirectionalLight(),camera=new PerspectiveCamera(64,1.6,.1,2000);scene.add(root,sun);camera.position.set(0,3,10);camera.updateMatrixWorld();
  let rawRefs=0,globalWaits=0,contextLost=false,cleanedViews=0,relatedCalls=0;
  const originalIdle=queue.whenIdle;queue.whenIdle=()=>{globalWaits++;return originalIdle();};
  const paid=<T,>(value:T)=>{rawRefs++;let released=false;return{ready:Promise.resolve(value),release(){if(!released){released=true;rawRefs--;}}};};
  const resources={stats:{reservedBytes:0},geometry:(part:typeof f.source.parts[number])=>{const lease=paid({geometry:part.geometry,triangles:part.geometry.index!.count/3,sourceTriangles:part.geometry.index!.count/3,error:0});return{...lease,releaseUnsubmitted:lease.release};},
   material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return paid({material});},atlas:(_parts:unknown,_tile:unknown,views:8|16)=>paid({maps,bytes:1,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,5.5,0],extent:[7,11],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),compile:()=>paid({}),trim(){},dispose(){}}as unknown as VegetationPrototypeResources;
  const compiled:{position:boolean;normal:boolean;index:boolean}[]=[],gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,TIMEOUT_EXPIRED:3,WAIT_FAILED:4,isContextLost:()=>contextLost,fenceSync:()=>({}),flush(){},clientWaitSync:()=>2,deleteSync(){}};
  const renderer={debug:{onShaderError:undefined},getContext:()=>gl,async compileAsync(preview:Mesh|Group){const mesh=preview instanceof Mesh?preview:preview.children[0]as Mesh;
   relatedCalls++;compiled.push({position:!!mesh.geometry.getAttribute('position'),normal:!!mesh.geometry.getAttribute('normal'),index:!!mesh.geometry.index});if(outcome==='compile-failure')throw Error('Related shader failed.');}}as unknown as WebGLRenderer;
  const owner=createRealisticRegionalWoodland({source:f.source,sourceRoot:root,renderer,scene,camera,queue,worker:{}as VegetationPreparationWorker,signal:new AbortController().signal,changed(){}},()=>resources);root.add(owner.object);
  const layout:RegionalWorldLayout={version:'related-reader-fixture',placements:Float32Array.from([0,-.08,-10,0,1,2]),treeCount:1,shrubCount:0,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],realisticTrees:{version:REALISTIC_TREE_COHORT_VERSION,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,sourceSha256:f.source.sourceSha256,ids:Uint32Array.from([0]),examined:1,rejectedRoot:0}};
  let environment:ReturnType<typeof createWorldEnvironment>|ReturnType<typeof createWorldVoxelGI>|undefined,lateEnvironment:typeof environment;
  async function makeAdapter(sourceRoot:Group){
   if(adapter==='weather'){
    const value=createWorldEnvironment({sourceRoot,atmosphere:new Group(),scene,sun,camera,queue,renderer,signal:new AbortController().signal,quality:()=> 'medium',reducedMotion:()=>true,
     readClock:()=>({time:{absoluteWorldMinute:540,fractionalMinute:0,dayIndex:0,dayMinute:540,elapsedWorldMinutes:540,deferredMilliseconds:0},worldKey:'related-reader-fixture',animationSeconds:0}),changed(){},setSunDirection(){}});value.update(0);return value;
   }
   const value=createWorldVoxelGI({sourceRoot,renderer,scene,camera,queue,signal:new AbortController().signal,source:Promise.resolve({source:{worldRegion:'related-reader-fixture',sourceSha256:'a'.repeat(64),generatorVersion:'1',backend:'webgl2-rgba8',terrain:[],proxies:[]},diagnostics:{meshes:0,terrainChunks:0,vertices:0,proxies:0,materialFallbacks:0}}),active:()=>true,prepareEnabled:()=>true,preset:()=> 'medium',readSourceLighting:()=>({sunDirection:[0,1,0],sunRadiance:[1,1,1],skyRadiance:[.2,.2,.2],cloudTransmission:1,local:[]}),wake(){},service(){}});await value.sourceReady;value.update(camera,0);return value;
  }
  let unrelatedRan=false,finishUnrelated!:()=>void;const unrelatedSignal=new AbortController(),unrelatedReady=new Promise<void>(resolve=>{finishUnrelated=resolve;});let unrelated:Promise<unknown>|undefined;
  try{
   await owner.prepare(layout);for(let i=0;i<20;i++){owner.update(camera,i*250,'low',true,new Set([0]));await tick();}assert.equal(owner.stats.pp3.detailed,1);
   const near=owner.object.getObjectByName('Authored regional tree 0')as Group;assert.ok(near);const privateViews:BufferGeometry[]=[];near.traverse(node=>{if(node instanceof Mesh&&!f.source.parts.some(part=>part.geometry===node.geometry)){privateViews.push(node.geometry);node.geometry.addEventListener('dispose',()=>{cleanedViews++;});}});
   environment=await makeAdapter(near);
   await tick();assert.equal(environment.stats.materialProgramsPending,2);assert.equal(relatedCalls,0);assert.ok(privateViews.length>0);
   unrelated=queue.enqueue({bytes:0,signal:unrelatedSignal.signal,priority:()=>1000,work:()=>{unrelatedRan=true;return unrelatedReady;}});
   owner.update(camera,6000,'low',true,new Set());await tick();assert.equal(owner.stats.budget.leases,1,'Queued related readers must retain near credit.');assert.equal(cleanedViews,0);assert.equal(globalWaits,0,'Related waits are scoped, not a hidden global-idle barrier.');
   if(outcome==='cancelled')environment.dispose();if(outcome==='context-lost')contextLost=true;
   for(let step=0;environment.stats.materialProgramsPending>0&&step<4;step++){queue.step();await tick();}
   await tick();assert.equal(environment.stats.materialProgramsPending,0);assert.equal(unrelatedRan,outcome==='cancelled','A cancellation step may start the unrelated job; its unresolved work must not delay the owner.');assert.ok(queue.pending,'Unrelated work is still queued or running when the owner returns credit.');assert.equal(owner.stats.budget.leases,0);assert.ok(cleanedViews>0);if(outcome==='cancelled')assert.ok(globalWaits>=1,'Explicit adapter teardown retains its existing global barriers.');else assert.equal(globalWaits,0,'Near retirement itself never consults the unrelated global queue.');
   if(outcome==='cancelled')assert.equal(compiled.length,0);else{assert.equal(compiled.length,2);assert.ok(compiled.every(sample=>sample.position&&sample.normal&&sample.index),'Actual adapter previews retain every private attribute/index until their compile settles.');}
   assert.ok(f.source.parts.every(part=>part.geometry.getAttribute('position')&&part.geometry.getAttribute('normal')&&part.geometry.index));
   // Retain the detached subtree deliberately: a newly constructed external
   // adapter must refuse its still-tagged, already-cleaned private views.
   const lateGeometry=privateViews.find(geometry=>!geometry.getAttribute('position'));assert.ok(lateGeometry);
   const lateRoot=new Group(),lateMaterial=new MeshStandardMaterial(),clone=lateMaterial.clone.bind(lateMaterial);materials.push(lateMaterial);let lateClones=0;lateMaterial.clone=()=>{lateClones++;return clone();};lateRoot.add(new Mesh(lateGeometry,lateMaterial));
   const pendingBefore=queue.stats.pending;lateEnvironment=await makeAdapter(lateRoot);await tick();assert.equal(lateEnvironment.stats.materialProgramsPending,0);assert.equal(queue.stats.pending,pendingBefore);assert.equal(lateClones,0,'The actual adapter rejects a retained private view before material/mesh cloning or queue admission.');
  }finally{
   lateEnvironment?.dispose();environment?.dispose();finishUnrelated();queue.dispose();await unrelated?.catch(()=>{});await originalIdle();owner.dispose();await tick();assert.equal(rawRefs,0);maps.forEach(map=>map.dispose());materials.forEach(material=>material.dispose());f.dispose();
   if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else Reflect.deleteProperty(globalThis,'Worker');
  }
 });
}
