import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,DoubleSide,Group,InstancedMesh,Mesh,MeshStandardMaterial,PerspectiveCamera,type Scene,type WebGLRenderer} from 'three';
import {createRegionalForest} from './regional-forest';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {EALDHOLT_FAR_LAND_FIELD,type EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';

// Owner-lifetime unit fixture only: no Scene, renderer, world or capture is
// constructed. The worker packet and GPU retirement fence are controlled data.
test('forest retirement owns grass instances/materials and waits for submitted work without disposing source geometry',async t=>{
 class LayoutWorker{
  static instances:LayoutWorker[]=[];
  onmessage:((event:{data:{layout:RegionalWorldLayout}})=>void)|null=null;
  onerror:((event:{message:string})=>void)|null=null;
  constructor(){LayoutWorker.instances.push(this);}
  postMessage(){}terminate(){}
 }
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');Object.defineProperty(globalThis,'Worker',{configurable:true,value:LayoutWorker});
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');});
 const root=new Group(),prototypes=new Group(),geometry=new BoxGeometry(.8,.2,.8).translate(0,.1,0);geometry.clearGroups();
 const material=new MeshStandardMaterial({side:DoubleSide}),source=new InstancedMesh(geometry,material,1);source.name='S_Grass_Clumps_original';source.count=0;root.add(source);
 for(const spec of REGIONAL_VEGETATION_PROTOTYPES){const family=new Group();family.name=spec.id;family.add(new Mesh(geometry,material));prototypes.add(family);}
 const camera=new PerspectiveCamera(60,1,.1,2000);camera.position.set(0,12,20);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const geography:EaldholtFarGeography={version:1,axes:'source:+X-east/-Z-north',landField:EALDHOLT_FAR_LAND_FIELD,coastSamples:new Float32Array(),channelSamples:new Float32Array(),seaLevel:0,sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},riverJoinX:100,riverFarX:200};
 const layout:RegionalWorldLayout={version:'unit-lifetime',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array(),groundcover:Float32Array.from([0,2,0,0,1,0]),cells:[],landmarks:[],attempts:0,rejected:{},species:[]};
 let finish!:()=>void,wakes=0,sourceDisposals=0;const idle=new Promise<void>(resolve=>{finish=resolve;}),queue={pending:false,whenIdle:()=>idle} as unknown as WorldPreparationQueue;
 geometry.addEventListener('dispose',()=>sourceDisposals++);material.addEventListener('dispose',()=>sourceDisposals++);
 const abort=new AbortController(),forest=createRegionalForest({sourceRoot:root,prototypes,geography,land:[],renderer:{} as WebGLRenderer,scene:{} as Scene,camera,queue,worker:{} as VegetationPreparationWorker,signal:abort.signal,active:()=>false,changed(){wakes++;}});root.add(forest.object);
 try{
  LayoutWorker.instances[0].onmessage!({data:{layout}});forest.update(camera,0,'low',true);
  const cover=forest.object.getObjectByName('Ealdholt clearing-edge source grass')!,mesh=cover.children[0] as InstancedMesh,owned=mesh.material as MeshStandardMaterial;
  assert.ok(mesh instanceof InstancedMesh);assert.equal(mesh.geometry,geometry);assert.notEqual(owned,material);assert.equal(source.count,0);
  let instanceDisposals=0,materialDisposals=0;mesh.addEventListener('dispose',()=>instanceDisposals++);owned.addEventListener('dispose',()=>materialDisposals++);
  const version=mesh.instanceMatrix.version;forest.suspend();assert.equal(forest.object.visible,false);forest.update(camera,1000,'low',true);assert.equal(mesh.instanceMatrix.version,version);
  const before=wakes;forest.resume();assert.equal(forest.object.visible,true);assert.equal(wakes,before+1,'resume uses the normal owner wake');forest.resume();assert.equal(wakes,before+1);
  forest.dispose();forest.dispose();forest.resume();assert.equal(forest.stats.status,'disposed');assert.equal(instanceDisposals,0);assert.equal(materialDisposals,0);
  finish();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(instanceDisposals,1);assert.equal(materialDisposals,1);assert.equal(sourceDisposals,0);assert.equal(forest.stats.groundcover.status,'disposed');assert.equal(source.material,material);
 }finally{forest.dispose();finish();await new Promise<void>(resolve=>setImmediate(resolve));source.dispose();geometry.dispose();material.dispose();prototypes.clear();root.clear();}
});
