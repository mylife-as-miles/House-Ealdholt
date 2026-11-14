import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {BufferGeometry,Group,Mesh,MeshStandardMaterial,Texture,type WebGLRenderer} from 'three';
import {createRegionalForestFloor} from './regional-forest-floor';
import {EALDHOLT_FAR_LAND_FIELD,type EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

function canvas(t:TestContext){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');
 class PixelsCanvas{
  getContext(){let image:{data:Uint8ClampedArray};return{drawImage(value:typeof image){image=value;},getImageData(){return{data:image.data.slice()};}};}
 }
 Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:PixelsCanvas});
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'OffscreenCanvas',prior);else Reflect.deleteProperty(globalThis,'OffscreenCanvas');});
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 const sourceRoot=new Group(),owners=new Group(),original=new MeshStandardMaterial(),land=new Mesh(new BufferGeometry(),original),building=new Mesh(new BufferGeometry(),original);
 land.userData.crownfallElderbloom={kind:'terrain'};building.userData.crownfallElderbloom={kind:'building'};owners.add(land,building);sourceRoot.add(owners);
 const data=new Uint8ClampedArray(512*512*4);for(let i=0;i<data.length;i+=4)data.set([i%251,91,45,255],i);
 const source=new Texture();source.image={width:512,height:512,data};const sourceVersion=source.source.version;
 let sourceDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);
 const geography:EaldholtFarGeography={version:1,axes:'source:+X-east/-Z-north',landField:EALDHOLT_FAR_LAND_FIELD,coastSamples:new Float32Array(),channelSamples:new Float32Array(),seaLevel:0,sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},riverJoinX:100,riverFarX:200};
 const layout:RegionalWorldLayout={version:'test',treeCount:0,shrubCount:0,placements:new Float32Array(),rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[]};
 return{sourceRoot,owners,original,land,building,source,data,sourceVersion,geography,layout,get sourceDisposals(){return sourceDisposals;},retire(){land.geometry.dispose();building.geometry.dispose();original.dispose();source.dispose();}};
}
test('packed floor preserves borrowed image/source ownership and retires one texture after pending GPU work',async t=>{
 canvas(t);const f=fixture(),abort=new AbortController();let finish!:()=>void;
 const idle=new Promise<void>(resolve=>{finish=resolve;}),queue={whenIdle:()=>idle} as unknown as WorldPreparationQueue;
 const floor=createRegionalForestFloor({...f,owners:[f.owners],prototypes:[],queue,signal:abort.signal,borrowedSource:true,load:async()=>f.source,changed(){}});
 try{
  floor.update(f.layout);assert.equal(f.land.material,f.original);await flush();floor.update(f.layout);
  assert.equal(floor.stats.status,'ready');assert.equal(floor.stats.samplers,1);assert.equal(floor.stats.fieldBytes,512*512);
  assert.equal(floor.stats.textureBytes,512*512*4);assert.equal(floor.stats.coverageVersion,'canopy-area-v3');assert.notEqual(f.land.material,f.original);assert.equal(f.building.material,f.original);
  const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <metalnessmap_fragment>'};
  f.land.material.onBeforeCompile(shader as never,{} as WebGLRenderer);
  const packed=(shader.uniforms as Record<string,{value:Texture}>).cfForestLitterCover.value;
  assert.equal(packed.flipY,false);assert.equal(packed.premultiplyAlpha,false);assert.equal(packed.generateMipmaps,f.source.generateMipmaps);
  assert.equal(packed.minFilter,f.source.minFilter);assert.equal(packed.magFilter,f.source.magFilter);
  assert.equal(f.source.source.version,f.sourceVersion);assert.equal(f.sourceDisposals,0);assert.equal(f.data[3],255);
  let packedDisposals=0,materialDisposals=0;packed.addEventListener('dispose',()=>packedDisposals++);f.land.material.addEventListener('dispose',()=>materialDisposals++);
  floor.dispose();floor.dispose();assert.equal(f.land.material,f.original);assert.equal(floor.stats.status,'disposed');assert.equal(packedDisposals,0);assert.equal(materialDisposals,0);
  finish();await flush();assert.equal(packedDisposals,1);assert.equal(materialDisposals,1);assert.equal(f.sourceDisposals,0);assert.equal(f.source.source.version,f.sourceVersion);
 }finally{finish();floor.dispose();f.retire();}
});
test('late source completion after abort never publishes a floor or disposes a borrowed cache texture',async t=>{
 canvas(t);for(const borrowedSource of [false,true]){
  const f=fixture(),abort=new AbortController();let resolve!:(value:Texture)=>void;
  const loading=new Promise<Texture>(finish=>{resolve=finish;}),queue={whenIdle:async()=>{}} as unknown as WorldPreparationQueue;
  const floor=createRegionalForestFloor({...f,owners:[f.owners],prototypes:[],queue,signal:abort.signal,borrowedSource,load:()=>loading,changed(){}});
  abort.abort();resolve(f.source);await flush();floor.update(f.layout);
  assert.equal(floor.stats.status,'disposed');assert.equal(f.land.material,f.original);assert.equal(floor.stats.samplers,0);assert.equal(f.sourceDisposals,borrowedSource?0:1);assert.equal(f.source.source.version,f.sourceVersion);
  floor.dispose();f.retire();
 }
});
test('unsupported translucent litter reports failure and leaves the existing ground unchanged',async t=>{
 canvas(t);const f=fixture(),abort=new AbortController(),queue={whenIdle:async()=>{}} as unknown as WorldPreparationQueue;f.data[3]=0;
 const floor=createRegionalForestFloor({...f,owners:[f.owners],prototypes:[],queue,signal:abort.signal,load:async()=>f.source,changed(){}});
 try{await flush();floor.update(f.layout);assert.equal(floor.stats.status,'held-error');assert.match(floor.stats.error,/opaque/);assert.equal(f.land.material,f.original);assert.equal(floor.stats.samplers,0);assert.equal(f.sourceDisposals,1);assert.equal(f.source.source.version,f.sourceVersion);}
 finally{floor.dispose();f.retire();}
});
