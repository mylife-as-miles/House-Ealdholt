import assert from 'node:assert/strict';
import test from 'node:test';
import {Color,Data3DTexture,Matrix4,Vector3,Vector4,type Mesh,type ShaderMaterial,type Texture,type WebGLRenderer,type WebGLRenderTarget} from 'three';
import {createVoxelRadiancePass,type VoxelCloudField,type VoxelLiveLight,type VoxelGpuVolume} from './voxel-radiance';
import {buildStaticVoxelVolume,type StaticVoxelVolume} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

type Draw={texture:Texture;coverage:number;offset:number[];enabled:number;matrix:number[];worldSun:number[];sourceSun:number[];local:number[];localPosition:number[];target:WebGLRenderTarget;read:Texture;seed:Texture};
const light:VoxelLiveLight={sunDirection:[0,1,0],sunRadiance:[2,2,2],skyRadiance:[.2,.2,.2],cloudTransmission:1,local:[]};
const small=()=>buildStaticVoxelVolume({grid:{resolution:[4,4,4],min:[0,0,0],size:[4,4,4]},terrainHeights:new Float32Array(16).fill(1),proxies:[]});
function harness(){
 const queue=createWorldPreparationQueue(()=>{}),draws:Draw[]=[],uploads:Texture[]=[];
 let target:WebGLRenderTarget|null=null,viewportWrites=0,empty:Texture|undefined,emptyDisposals=0;
 let onDraw:((draw:Draw)=>void)|null=null,throwAt=-1;
 const renderer={capabilities:{maxTextureSize:2048},xr:{enabled:true},shadowMap:{enabled:true},toneMapping:4,autoClear:false,
  initTexture(texture:Texture){uploads.push(texture);},async compileAsync(scene:{children:Mesh[]}){const uniforms=(scene.children[0].material as ShaderMaterial).uniforms;if(!empty){empty=uniforms.cfCloudDensity.value;empty!.addEventListener('dispose',()=>emptyDisposals++);}},
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getClearColor:(v:Color)=>v.set(0),getClearAlpha:()=>1,getViewport:(v:Vector4)=>v.set(0,0,320,180),getScissor:(v:Vector4)=>v.set(0,0,320,180),getScissorTest:()=>false,
  setRenderTarget(v:WebGLRenderTarget|null){target=v;},setViewport(){viewportWrites++;},setScissor(){},setScissorTest(){},setClearColor(){},
  render(scene:{children:Mesh[]}){const u=(scene.children[0].material as ShaderMaterial).uniforms,draw:Draw={texture:u.cfCloudDensity.value,coverage:u.cfCloudCoverage.value,offset:u.cfCloudOffset.value.toArray(),enabled:u.cfSurfaceWeatherEnabled.value,matrix:u.cfCloudSourceToWorld.value.toArray(),worldSun:u.cfWorldSun.value.toArray(),sourceSun:u.cfSunDirection.value.toArray(),local:u.cfLocalRadiance.value[0].toArray(),localPosition:u.cfLocalPositionRadius.value[0].toArray(),target:target!,read:u.cfSourceRadiance.value,seed:u.cfBounceSeed.value};draws.push(draw);onDraw?.(draw);if(draws.length===throwAt)throw Error('Relight failure');},
  getContext:()=>({NO_ERROR:0,getError:()=>0}),
 }as unknown as WebGLRenderer;
 const pass=createVoxelRadiancePass(renderer,queue);
 async function pump<T>(promise:Promise<T>){let done=false,result!:T,error:unknown;promise.then(v=>{result=v;done=true;},e=>{error=e;done=true;});for(let i=0;!done&&i<128;i++){queue.step();await new Promise<void>(resolve=>setImmediate(resolve));}assert.equal(done,true,'Bounded renderer queue must settle.');if(error)throw error;return result;}
 async function close(){pass.dispose();await queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));queue.dispose();}
 return{pass,queue,renderer,draws,uploads,pump,close,get empty(){return empty;},get emptyDisposals(){return emptyDisposals;},get viewportWrites(){return viewportWrites;},set onDraw(value:typeof onDraw){onDraw=value;},set throwAt(value:number){throwAt=value;}};
}

test('fire/cloud requests own numeric snapshots and publish only after both indirect steps and final gather',async()=>{
 const h=harness(),borrowed=new Data3DTexture(new Uint8Array([255,128]),1,1,1);let borrowedDisposals=0;borrowed.addEventListener('dispose',()=>borrowedDisposals++);
 try{
  const gpu=await h.pump(h.pass.prepare(small(),new AbortController().signal)),offset:[number,number]=[100,200],matrix=new Matrix4().makeRotationY(Math.PI/2).scale(new Vector3(2,3,.5)).setPosition(200,40,300).elements,expectedMatrix=matrix.slice();
  const cloud:VoxelCloudField={texture:borrowed,revision:'rg8-v3',coverage:.22,globalTransmission:1-.22*.48,offset,enabled:true,sourceToWorld:matrix,sunDirection:[.3,1,.2]};
  const fire={position:[1,2,3]as[number,number,number],radius:10,radiance:[4,2,.3]as[number,number,number]},old=gpu.radiance,oldSun=gpu.sunlight;
  h.onDraw=()=>{assert.equal(gpu.radiance,old);assert.equal(gpu.sunlight,oldSun);assert.equal(gpu.stats.ready,false);};
  const pending=gpu.relight({...light,local:[fire]},cloud);offset[0]=999;matrix[12]=999;fire.radiance[0]=32;fire.position[0]=999;await h.pump(pending);
  assert.equal(h.draws.length,4);assert.notEqual(gpu.radiance,old);assert.notEqual(gpu.sunlight,oldSun);
  for(const row of h.draws){assert.equal(row.texture,borrowed);assert.equal(row.coverage,.22);assert.deepEqual(row.offset,[100,200]);assert.equal(row.enabled,1);assert.deepEqual(row.matrix,expectedMatrix);assert.deepEqual(row.worldSun,new Vector3(.3,1,.2).normalize().toArray());assert.deepEqual(row.sourceSun,[0,1,0]);assert.deepEqual(row.local,[4,2,.3]);assert.deepEqual(row.localPosition,[1,2,3,10]);}
  assert.equal(h.draws[1].read,h.draws[0].target.texture);assert.equal(h.draws[2].read,h.draws[1].target.texture);assert.equal(h.draws[3].read,h.draws[2].target.texture);
  for(const row of h.draws.slice(1)){assert.equal(row.seed,h.draws[0].target.texture);assert.notEqual(row.read,row.target.texture,'Every transport draw reads a different attachment.');}
  assert.equal(gpu.stats.indirectSteps,2);assert.equal(gpu.stats.localLights,1);assert.equal(gpu.stats.encoding,'sqrt-rgba8');
  h.onDraw=null;await h.pump(gpu.relight(light,null));assert.equal(h.draws[h.draws.length-1].texture,h.empty);assert.equal(h.draws[h.draws.length-1].enabled,0);
  assert.equal(h.uploads.length,2,'Day/fire changes never upload new occupancy or static transport.');
  assert.equal(h.viewportWrites,8);assert.equal(h.renderer.xr.enabled,true);assert.equal(h.renderer.shadowMap.enabled,true);assert.equal(h.renderer.toneMapping,4);assert.equal(h.renderer.autoClear,false);
  await assert.rejects(gpu.relight(light,{...cloud,coverage:NaN}),/Invalid bounded voxel cloud field/);
  assert.equal(borrowedDisposals,0);
 }finally{await h.close();assert.equal(h.emptyDisposals,1);assert.equal(borrowedDisposals,0);borrowed.dispose();}
});

test('failure in either indirect step or final gather keeps the previous complete lighting and permits a fresh retry',async()=>{
 for(const failedStage of[2,3,4]){
  const h=harness();try{
   const gpu=await h.pump(h.pass.prepare(small(),new AbortController().signal));await h.pump(gpu.relight(light));const previous=gpu.radiance,sun=gpu.sunlight,completed=gpu.stats.relights;
   h.throwAt=h.draws.length+failedStage;await assert.rejects(h.pump(gpu.relight({...light,local:[{position:[2,2,2],radius:8,radiance:[5,1,.1]}]})),/Relight failure/);
   assert.equal(gpu.radiance,previous);assert.equal(gpu.sunlight,sun);assert.equal(gpu.stats.ready,true);assert.equal(gpu.stats.relights,completed);assert.equal(gpu.stats.localLights,0);
   assert.equal(h.renderer.xr.enabled,true);assert.equal(h.renderer.shadowMap.enabled,true);assert.equal(h.renderer.autoClear,false);
   h.throwAt=-1;await h.pump(gpu.relight(light));assert.notEqual(gpu.radiance,previous);assert.equal(gpu.stats.relights,completed+1);assert.equal(h.uploads.length,2);
  }finally{await h.close();}
 }
});

test('retiring a volume during a transport step prevents late publication and releases owned targets after queue idle',async()=>{
 const h=harness();try{
  const gpu=await h.pump(h.pass.prepare(small(),new AbortController().signal));await h.pump(gpu.relight(light));const previous=gpu.radiance,sun=gpu.sunlight;let disposed=0;
  for(const texture of h.uploads)texture.addEventListener('dispose',()=>disposed++);
  h.onDraw=()=>{gpu.dispose();assert.equal(disposed,0,'An in-flight queue operation still owns its textures.');};
  await assert.rejects(h.pump(gpu.relight(light)));assert.equal(gpu.radiance,previous);assert.equal(gpu.sunlight,sun);assert.equal(gpu.stats.relights,1);assert.equal(gpu.stats.ready,false);
  await h.queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(disposed,2);await assert.rejects(gpu.relight(light),/Invalid bounded/);
 }finally{await h.close();}
});

test('volume and total-owner memory caps include the two scratch fields and retain credit while retirement is pending',async()=>{
 const h=harness(),grid={resolution:[64,64,64]as const,min:[0,0,0]as const,size:[64,64,64]as const},volume:StaticVoxelVolume={grid,albedoOpacity:new Uint8Array(64**3*4),transport:new Uint8Array(64**3*4),occupiedVoxels:0};
 let a:VoxelGpuVolume|undefined,b:VoxelGpuVolume|undefined;
 try{
  a=await h.pump(h.pass.prepare(volume,new AbortController().signal));b=await h.pump(h.pass.prepare(volume,new AbortController().signal));assert.equal(a.stats.bytes,8*1024**2);assert.equal(b.stats.bytes,8*1024**2);
  await assert.rejects(h.pass.prepare(volume,new AbortController().signal),/memory budget/);assert.equal(h.uploads.length,4);
  const blocker=new AbortController();let release!:()=>void;const pending=h.queue.enqueue({bytes:0,signal:blocker.signal,priority:()=>0,work:()=>new Promise<void>(resolve=>{release=resolve;})});h.queue.step();a.dispose();
  await assert.rejects(h.pass.prepare(volume,new AbortController().signal),/memory budget/,'Retiring storage remains budgeted while queue work owns it.');
  release();await pending;await h.queue.whenIdle();await new Promise<void>(resolve=>setImmediate(resolve));
  const replacement=await h.pump(h.pass.prepare(volume,new AbortController().signal));replacement.dispose();
  const large={...volume,grid:{...grid,resolution:[128,64,64]as const},albedoOpacity:new Uint8Array(128*64*64*4),transport:new Uint8Array(128*64*64*4)};
  await assert.rejects(h.pass.prepare(large,new AbortController().signal),/memory budget/);
 }finally{a?.dispose();b?.dispose();await h.close();}
});
