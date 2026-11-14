import assert from 'node:assert/strict';
import test from 'node:test';
import {Box3,BufferAttribute,BufferGeometry,DataTexture,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,Scene,Vector3,type WebGLRenderer} from 'three';
import {createScannedRegionalShrubs} from './scanned-regional-shrubs';
import {createScannedUndergrowth} from './scanned-undergrowth';
import type {NormalizedScannedShrubSource} from './scanned-shrub-source';
import type {createVegetationPrototypeResources,VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {scannedShrubCohortSource} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import {SCANNED_SHRUB_COHORT_VERSION,scannedShrubSourceContract,scannedShrubDetailLimit,scannedShrubDerivativeBudget} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-policy';

// CPU lifetime/lease fixtures only. No fixture is rendered or substituted for
// Crownfall art; actual source geometry has a separate optional intake test.
function fixture(native=false){
 const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(Float32Array.from([-.2,0,0,.2,0,0,0,1.5,.2]),3));
 for(const [name,size]of [['normal',3],['uv',2]] as const)g.setAttribute(name,new BufferAttribute(new Float32Array(3*size),size));g.setIndex(new BufferAttribute(Uint16Array.from({length:5242*3},(_,i)=>i%3),1));
 const map=new DataTexture(),normal=new DataTexture(),orm=new DataTexture(),material=new MeshStandardMaterial({side:DoubleSide,map,normalMap:normal,roughnessMap:orm,metalnessMap:orm,aoMap:orm,alphaTest:.5});
 const descriptor=scannedShrubCohortSource(native),source:NormalizedScannedShrubSource={...descriptor,family:'unit-soft-shrub',originalBaseY:0,normalization:new Matrix4(),parts:[{geometry:g,material,frame:new Matrix4().makeRotationX(.7).setPosition(.1,.2,-.1),foliage:true}],bounds:new Box3(new Vector3(-.2,0,0),new Vector3(.2,1.5,.2)),triangles:5242,textureBytes:3,geometryBytes:12};
 const count=12,placements=Float32Array.from(Array.from({length:count},(_,i)=>[10+i*.5,-.25,0,.3+i*.01,.8,13]).flat()),before=placements.slice();
 const layout:RegionalWorldLayout={version:'unchanged-unit-placement',treeCount:0,shrubCount:count,placements,rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[],scannedShrubs:{version:SCANNED_SHRUB_COHORT_VERSION,sourceSha256:source.sourceSha256,sourceContract:scannedShrubSourceContract(source),ids:Uint32Array.from({length:count},(_,i)=>i),examined:count,rejectedRoot:0}};
 return{source,layout,before,dispose(){g.dispose();material.dispose();for(const t of [map,normal,orm])t.dispose();}};
}
function resourceFixture(reject=false){
 const maps=[new DataTexture(),new DataTexture()] as const,materials=new Map<string,MeshStandardMaterial>();let captures=0,disposed=0,maximum=0;const frames:Matrix4[]=[];
 const resources={stats:{},material(key:string,build:()=>MeshStandardMaterial){if(!materials.has(key))materials.set(key,build());return{ready:Promise.resolve({material:materials.get(key)!}),release(){}};},
  geometry(part:NormalizedScannedShrubSource['parts'][number]){return{ready:Promise.resolve({geometry:part.geometry,sourceTriangles:5242,triangles:5242}),release(){}};},
  atlas(parts:NormalizedScannedShrubSource['parts'],_tile:number,views:number){captures++;frames.push(...parts.map(p=>p.frame.clone()));assert.ok(parts.every(p=>p.foliage),'the entire scan stays soft foliage');return{ready:reject?Promise.reject(Error('Source capture held')):Promise.resolve({bytes:1,maps,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,.75,0],extent:[2,1.5],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}};},
  compile(){return{ready:Promise.resolve({}),release(){}};},trim(){},dispose(){disposed++;}} as unknown as VegetationPrototypeResources;
 return{factory:((_renderer,_queue,_worker,bytes)=>{maximum=bytes;return resources;}) as typeof createVegetationPrototypeResources,get frames(){return frames;},get captures(){return captures;},get disposed(){return disposed;},get maximum(){return maximum;},dispose(){maps.forEach(m=>m.dispose());materials.forEach(m=>m.dispose());}};
}
const drain=async()=>{for(let i=0;i<90;i++)await Promise.resolve();};

test('source HLOD ownership uses4/2near leases and matching-source far fallback without changing actor data or disposing borrowed PBR',async()=>{
 for(const native of [false,true]){
  const f=fixture(native),r=resourceFixture();let finish!:()=>void;const idle=new Promise<void>(resolve=>{finish=resolve;}),root=new Group(),camera=new PerspectiveCamera();camera.position.set(0,2,10);camera.lookAt(13,.75,0);camera.updateMatrixWorld();
  let artDisposals=0;for(const part of f.source.parts){part.geometry.addEventListener('dispose',()=>artDisposals++);part.material.addEventListener('dispose',()=>artDisposals++);}
  const owner=createScannedRegionalShrubs({source:f.source,sourceRoot:root,renderer:{} as WebGLRenderer,scene:new Scene(),camera,queue:{whenIdle:()=>idle} as unknown as WorldPreparationQueue,worker:{} as VegetationPreparationWorker,signal:new AbortController().signal,native,retirementFence:()=>idle,changed(){}},r.factory);root.add(owner.object);
  try{assert.equal(owner.owns(0),false);await owner.prepare(f.layout);assert.equal(owner.stats.status,'ready');assert.equal(owner.owns(0),true);assert.equal(r.maximum,scannedShrubDerivativeBudget(native));assert.equal(owner.stats.navigationAuthority,false);assert.equal(owner.stats.softFoliage,true);
   const visible=new Set(Array.from({length:12},(_,i)=>i));for(let tick=0;tick<16;tick++){owner.update(camera,tick*250,'low',false,visible);await drain();assert.ok(owner.stats.detailed+owner.stats.preparing+owner.stats.retiring<=scannedShrubDetailLimit(native));}
   assert.equal(owner.stats.detailed,scannedShrubDetailLimit(native));assert.equal(owner.stats.far,12-scannedShrubDetailLimit(native));assert.deepEqual(f.layout.placements,f.before);
   assert.ok(r.frames.length>2);for(const frame of r.frames)assert.ok(frame.elements.every((v,i)=>Math.abs(v-f.source.parts[0].frame.elements[i])<1e-6),'near and outer captures retain the imported node frame in the same source-up basis');
   let sourceAlignedCards=0;owner.object.traverse(node=>{if(node instanceof InstancedMesh&&node.parent?.name==='Authored cell source HLOD'&&node.geometry.index?.count===6){const frame=new Matrix4();node.getMatrixAt(0,frame);assert.ok(frame.equals(new Matrix4()),'near cards reconstruct in the source frame instead of applying the imported node rotation twice');sourceAlignedCards++;}});assert.ok(sourceAlignedCards>0);
   owner.dispose();owner.dispose();assert.equal(r.disposed,0);assert.equal(artDisposals,0);finish();await drain();assert.equal(r.disposed,1);assert.equal(artDisposals,0);
  }finally{owner.dispose();finish();await drain();r.dispose();f.dispose();}
 }
});

test('rejected source captures or mismatched measured contracts never claim original bramble IDs',async()=>{
 for(const mismatch of [false,true]){
  const f=fixture(),r=resourceFixture(!mismatch),queue={whenIdle:()=>Promise.resolve()} as unknown as WorldPreparationQueue;
  const owner=createScannedRegionalShrubs({source:f.source,sourceRoot:new Group(),renderer:{} as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue,worker:{} as VegetationPreparationWorker,signal:new AbortController().signal,retirementFence:()=>queue.whenIdle(),changed(){}},r.factory);
  try{await owner.prepare(mismatch?{...f.layout,scannedShrubs:{...f.layout.scannedShrubs!,sourceContract:'old-metrics'}}:f.layout);assert.equal(owner.stats.status,'fallback');assert.equal(owner.owns(0),false);assert.equal(r.captures,mismatch?0:1);assert.deepEqual(f.layout.placements,f.before);
  }finally{owner.dispose();await drain();r.dispose();f.dispose();}
 }
});

test('optional import never gates ordinary ownership, catches synchronous/async errors and ignores late models after disposal',async()=>{
 for(const synchronous of [false,true]){
  const f=fixture();const options={sourceRoot:new Group(),renderer:{} as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue:{} as WorldPreparationQueue,worker:{} as VegetationPreparationWorker,signal:new AbortController().signal,load:()=>{if(synchronous)throw Error('Decoder unavailable');return Promise.reject(Error('Model unavailable'));},changed(){}};
  const manager=createScannedUndergrowth(options);manager.setLayout(f.layout);assert.equal(manager.owns(0),false);await drain();assert.equal(manager.stats.status,'fallback');assert.match(manager.stats.error,/unavailable/);assert.deepEqual(f.layout.placements,f.before);manager.dispose();f.dispose();
 }
 let resolve!:(model:Group)=>void,borrowed=0;const delayed=new Promise<Group>(done=>{resolve=done;});
 const manager=createScannedUndergrowth({sourceRoot:new Group(),renderer:{} as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue:{} as WorldPreparationQueue,worker:{} as VegetationPreparationWorker,signal:new AbortController().signal,load:()=>delayed,changed(){}},undefined,()=>{borrowed++;return null;});
 await drain();manager.dispose();resolve(new Group());await drain();assert.equal(borrowed,0);assert.equal(manager.stats.status,'disposed');assert.equal(manager.owns(0),false);
});

test('source captures wait for the existing active preparation gate and start once on normal owner service',async()=>{
 const f=fixture();let active=false,prepares=0;
 const stats={status:'unavailable'};const fake={object:new Group(),stats,prepare(){prepares++;stats.status='ready';return Promise.resolve();},owns(){return stats.status==='ready';},update(){return false;},dispose(){stats.status='disposed';}} as unknown as ReturnType<typeof createScannedRegionalShrubs>;
 const factory=(()=>fake) as typeof createScannedRegionalShrubs;
 const manager=createScannedUndergrowth({sourceRoot:new Group(),renderer:{} as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue:{} as WorldPreparationQueue,worker:{} as VegetationPreparationWorker,signal:new AbortController().signal,active:()=>active,load:()=>Promise.resolve(new Group()),changed(){}},factory,()=>f.source);
 try{manager.setLayout(f.layout);await drain();manager.service();assert.equal(prepares,0);assert.equal(manager.owns(0),false);assert.equal(manager.stats.status,'awaiting-preparation');
  active=true;manager.service();manager.service();await drain();assert.equal(prepares,1);assert.equal(manager.owns(0),true);assert.equal(manager.stats.ownershipEpoch,1);
 }finally{manager.dispose();f.dispose();}
});

test('immediate disposal or abort never starts the optional source import',async()=>{
 for(const abort of [false,true]){
  let loads=0,borrowed=0;const controller=new AbortController();
  const manager=createScannedUndergrowth({sourceRoot:new Group(),renderer:{} as WebGLRenderer,scene:new Scene(),camera:new PerspectiveCamera(),queue:{} as WorldPreparationQueue,worker:{} as VegetationPreparationWorker,signal:controller.signal,load:()=>{loads++;return Promise.resolve(new Group());},changed(){}},undefined,()=>{borrowed++;return null;});
  if(abort)controller.abort();else manager.dispose();
  await drain();assert.equal(loads,0,'a retired view must not start even the network/decoder work');assert.equal(borrowed,0);assert.equal(manager.stats.status,'disposed');assert.equal(manager.owns(0),false);
 }
});
