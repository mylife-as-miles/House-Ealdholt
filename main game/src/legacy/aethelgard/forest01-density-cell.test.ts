import assert from 'node:assert/strict';
import test from 'node:test';
import {BufferAttribute,BufferGeometry,DataTexture,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {createVegetationCellHlod} from './vegetation-cell-hlod';
import type {VegetationPrototypeResources} from './vegetation-prototype';
import {FOREST01_DENSITY_LOD} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
function fixture(){
 const root=new Group(),maps=[new DataTexture(),new DataTexture()]as const,materials:MeshStandardMaterial[]=[],derived:BufferGeometry[]=[],compileKeys:string[]=[],requests:string[]=[];
 const sourceCounts=[3941,3999,50471],counts=[1346,1398,31845],parts=sourceCounts.map((triangles,part)=>{
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(Float32Array.from([-1,0,-1,1,0,-1,0,14,1]),3));geometry.setIndex(new BufferAttribute(Uint32Array.from({length:triangles*3},(_,i)=>i%3),1));
  const material=new MeshStandardMaterial({side:part===2?DoubleSide:0}),mesh=new InstancedMesh(geometry,material,1);mesh.setMatrixAt(0,new Matrix4());root.add(mesh);return{mesh,geometry,material};
 });
 const resources={geometry(part:{geometry:BufferGeometry},detail:string){const i=parts.findIndex(p=>p.geometry===part.geometry);requests.push(detail);const geometry=part.geometry.clone();geometry.setIndex(new BufferAttribute(Uint32Array.from({length:counts[i]*3},(_,id)=>id%3),1));derived.push(geometry);return{ready:Promise.resolve({geometry,sourceTriangles:sourceCounts[i],triangles:counts[i],error:0,densityProof:i}),release(){}};},
 material:(_key:string,build:()=>MeshStandardMaterial)=>{const material=build();materials.push(material);return{ready:Promise.resolve({material}),release(){}};},
 atlas:(_p:unknown,_t:unknown,views:8|16)=>({ready:Promise.resolve({maps,bytes:1,record:{views,columns:4,rows:views/4,tileSize:64,centre:[0,7,0],extent:[6,14],mips:[{width:256,height:64*views/4}],coverage:Array(views).fill(.5)}}),release(){}}),
 compile:(key:string)=>{compileKeys.push(key);return{ready:Promise.resolve({}),release(){}};}}as unknown as VegetationPrototypeResources;
 const camera=new PerspectiveCamera(64,1.6,.1,2000);camera.position.set(0,3,8);camera.updateMatrixWorld();
 return{root,parts,resources,camera,compileKeys,requests,reservation:{ready:Promise.resolve({bytes:FOREST01_DENSITY_LOD.ownerBufferBytes,dispose(){}}),release(){}},dispose(){for(const p of parts){p.mesh.dispose();p.geometry.dispose();p.material.dispose();}derived.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());maps.forEach(m=>m.dispose());}};
}
test('fixed L1-only cell never prepares, compiles, selects, counts or falls back to L0, including pending and rapid teleports',async()=>{
 const f=fixture(),cell=createVegetationCellHlod(f.root,{resources:f.resources,renderer:{}as WebGLRenderer,scene:new Scene(),camera:f.camera,tileSize:64,representation:'forest01-density',ownedBufferReservation:f.reservation,signal:new AbortController().signal,changed(){}});
 try{assert.equal(cell.stats.allowedReadyMask,14);assert.equal(cell.stats.requiredReadyMask,14);assert.equal(cell.stats.readyMask,0);assert.equal(cell.triangleCost,0);assert.ok(f.parts.every(p=>!p.mesh.visible));cell.update(0,f.camera,'high',false);assert.equal(cell.stats.levels[0],0);
  await cell.preparation;assert.equal(cell.stats.readyMask,14);assert.equal(cell.stats.status,'ready');assert.deepEqual(f.requests,['l1','l1','forest01-density'],'exactly certified L1 wood also covers L2');
  assert.ok(f.compileKeys.every(k=>k.includes(FOREST01_DENSITY_LOD.version)&&!k.includes('level0')));
  for(let i=0;i<80;i++){f.camera.position.set(0,[3,35,250,3][i%4],[8,140,800,8][i%4]);f.camera.updateMatrixWorld();cell.update(i*10,f.camera,'medium',false);assert.equal(cell.stats.levels[0],0);assert.ok(cell.triangleCost<=37337);assert.ok(f.parts.every(p=>!p.mesh.visible));}
  assert.equal(f.parts[0].geometry.drawRange.count,Infinity,'borrowed source was never zeroed or mutated');
 }finally{cell.dispose();await cell.preparation;f.dispose();}
});

test('the actual worker preserves the profile field and rejects a wrong source without running a different fallback profile',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'self'),packets:any[]=[];
 const worker={onmessage:null as unknown as (message:MessageEvent)=>Promise<void>,postMessage(data:unknown,options?:{transfer:Transferable[]}){packets.push(structuredClone(data,{transfer:options?.transfer??[]}));}};
 Object.defineProperty(globalThis,'self',{configurable:true,value:worker});
 try{await import('./vegetation-prepare.worker');
  const data={id:73,kind:'packed',profile:FOREST01_DENSITY_LOD.version,positions:Float32Array.from([0,0,0,1,0,0,0,1,0]),indices:Uint32Array.from([0,1,2]),attributes:new Float32Array(6),stride:2,channels:[{name:'uv',size:2}],foliage:true,ratio:.6,error:.008,attributeWeights:[.2,.2]};
  await worker.onmessage({data:structuredClone(data)}as MessageEvent);assert.equal(packets.length,1);assert.equal(packets[0].id,73);assert.match(packets[0].error,/Unqualified Forest01/);assert.equal(packets[0].indices,undefined,'cannot silently use ordinary L1 for the cheap role');
 }finally{if(descriptor)Object.defineProperty(globalThis,'self',descriptor);else Reflect.deleteProperty(globalThis,'self');}
});

test('missing source-output proof leaves a density cell unready with zero drawable L0 and preserves borrowed art',async()=>{
 const f=fixture(),geometry=f.resources.geometry;
 f.resources.geometry=((...args:Parameters<typeof geometry>)=>{const lease=geometry(...args);return{...lease,ready:lease.ready.then(value=>({...value,densityProof:undefined}))};})as typeof geometry;
 const cell=createVegetationCellHlod(f.root,{resources:f.resources,renderer:{}as WebGLRenderer,scene:new Scene(),camera:f.camera,tileSize:64,representation:'forest01-density',ownedBufferReservation:f.reservation,signal:new AbortController().signal,changed(){}});
 try{await cell.preparation;assert.equal(cell.stats.status,'error');assert.equal(cell.stats.readyMask,0);cell.update(5,f.camera,'high',true);assert.equal(cell.triangleCost,0);assert.deepEqual(cell.stats.levels,[0,0,0,0]);assert.ok(f.parts.every(p=>!p.mesh.visible&&p.geometry.drawRange.count===Infinity));assert.equal(f.compileKeys.length,0);}finally{cell.dispose();f.dispose();}
});

test('required-ready contract retains atlas ownership through partial readiness and cancellation',async()=>{
 const f=fixture(),atlas=f.resources.atlas;let finish!:(value:Awaited<ReturnType<typeof atlas>['ready']>)=>void;
 f.resources.atlas=((...args:Parameters<typeof atlas>)=>{const lease=atlas(...args);if(args[2]!==16)return lease;return{...lease,ready:new Promise(resolve=>{finish=resolve;void lease.ready.then(value=>{finish=()=>resolve(value);});})};})as typeof atlas;
 const cell=createVegetationCellHlod(f.root,{resources:f.resources,renderer:{}as WebGLRenderer,scene:new Scene(),camera:f.camera,tileSize:64,representation:'forest01-density',ownedBufferReservation:f.reservation,signal:new AbortController().signal,changed(){}});
 try{for(let i=0;i<80;i++)await Promise.resolve();assert.equal(cell.stats.readyMask,2);cell.update(9,f.camera,'low',false);assert.deepEqual(cell.stats.levels,[0,0,0,0]);assert.equal(cell.triangleCost,0);assert.ok(f.parts.every(p=>!p.mesh.visible));cell.dispose();finish(undefined as never);await cell.preparation;assert.equal(cell.stats.readyMask,2,'cancelled output cannot acquire later readiness');assert.ok(f.parts.every(p=>p.mesh.geometry===p.geometry));}finally{cell.dispose();f.dispose();}
});

test('the cheap representation rejects multiple actors, Native or an unknown profile before ownership or preparation',()=>{
 for(const mode of['multiple','native','unknown']as const){const f=fixture();
  try{if(mode==='multiple')f.parts.forEach(p=>{p.mesh.count=2;});
   assert.throws(()=>createVegetationCellHlod(f.root,{resources:f.resources,renderer:{}as WebGLRenderer,scene:new Scene(),camera:f.camera,tileSize:64,representation:mode==='unknown'?'future' as 'forest01-density':'forest01-density',native:mode==='native',ownedBufferReservation:f.reservation,signal:new AbortController().signal,changed(){}}),/one canonical actor|Desktop|Unknown/);assert.equal(f.requests.length,0);assert.equal(f.compileKeys.length,0);assert.ok(f.parts.every(p=>p.mesh.visible&&p.mesh.geometry===p.geometry));
  }finally{f.dispose();}
 }
});

test('real pool keeps private bytes unavailable until the final CellHLOD cleanup fence and wrapper retirement',async()=>{
 const {createVegetationPrototypeResources}=await import('./vegetation-prototype'),{createWorldPreparationQueue}=await import('../../../../shared/legacy/aethelgard/environment/world-preparation-queue');
 const f=fixture(),queue=createWorldPreparationQueue(()=>{}),pool=createVegetationPrototypeResources({}as WebGLRenderer,queue,{}as never,FOREST01_DENSITY_LOD.ownerBufferBytes);
 const reservation=pool.ownerBuffers('optional-A',FOREST01_DENSITY_LOD.ownerBufferBytes);let finish!:()=>void;const fence=new Promise<void>(resolve=>{finish=resolve;});
 const cell=createVegetationCellHlod(f.root,{resources:f.resources,renderer:{}as WebGLRenderer,scene:new Scene(),camera:f.camera,tileSize:64,representation:'forest01-density',ownedBufferReservation:reservation,retirementFence:()=>fence,signal:new AbortController().signal,changed(){}});
 try{await cell.preparation;assert.equal(pool.stats.bytes,32768);assert.throws(()=>pool.ownerBuffers('optional-B',32768),/residency/);
  cell.dispose();let retired=false;const retirement=cell.whenRetired.then(()=>{for(const part of f.parts)part.mesh.dispose();f.root.clear();reservation.release();pool.trim();retired=true;});
  for(let i=0;i<20;i++)await Promise.resolve();assert.equal(retired,false);assert.equal(pool.stats.bytes,32768);assert.throws(()=>pool.ownerBuffers('optional-B',32768),/residency/,'no byte credit before final private-buffer cleanup');
  finish();await retirement;assert.equal(pool.stats.bytes,0);assert.equal(pool.stats.entries,0);
 }finally{finish();cell.dispose();await cell.whenRetired;reservation.release();pool.dispose();queue.dispose();f.dispose();}
});
