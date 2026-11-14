import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,DoubleSide,Matrix4,MeshStandardMaterial,type WebGLRenderer} from 'three';
import {createVegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {buildPackedVegetationGeometry} from '../../../../shared/legacy/aethelgard/environment/vegetation-packed-geometry';
import {FOREST01_DENSITY_LOD} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';

test('density uses a separate real-pool geometry lease and wrong source cannot restore default L1 or poison the primary',async()=>{
 const source=new BoxGeometry(2,8,2);source.clearGroups();const material=new MeshStandardMaterial({side:DoubleSide}),queue=createWorldPreparationQueue(()=>{}),profiles:(string|undefined)[]=[];
 let sourceDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);
 const worker={packed:async input=>{profiles.push(input.profile);return buildPackedVegetationGeometry(input,{ready:Promise.resolve(),simplifyWithAttributes:indices=>[indices,0]});},dispose(){}}as VegetationPreparationWorker;
 const gl={COPY_WRITE_BUFFER:1,COPY_WRITE_BUFFER_BINDING:2,STATIC_DRAW:3,FLOAT:4,UNSIGNED_SHORT:5,UNSIGNED_INT:6,VERTEX_ARRAY_BINDING:7,ELEMENT_ARRAY_BUFFER:8,createVertexArray:()=>({}),bindVertexArray(){},deleteVertexArray(){},createBuffer:()=>({}),deleteBuffer(){},getParameter(){return null;},bindBuffer(){},bufferData(){},bufferSubData(){}};
 const resources=createVegetationPrototypeResources({getContext:()=>gl}as unknown as WebGLRenderer,queue,worker,1024**2),part={geometry:source,material,frame:new Matrix4(),foliage:true};
 const run=async<T,>(promise:Promise<T>)=>{let settled=false;const result=promise.then(value=>({value}),error=>({error})).finally(()=>{settled=true;});for(let i=0;i<150&&!settled;i++){queue.step();await new Promise(resolve=>setTimeout(resolve,0));}assert.equal(settled,true);const out=await result;if('error'in out)throw out.error;return out.value;};
 const primary=resources.geometry(part);
 try{const first=await run(primary.ready);assert.equal(first.triangles,12);assert.equal(resources.stats.builds,1);
  const rejected=resources.geometry(part,'forest01-density');await assert.rejects(()=>run(rejected.ready),/Unqualified Forest01/);rejected.release();assert.deepEqual(profiles,[undefined,FOREST01_DENSITY_LOD.version]);assert.equal(resources.stats.failed,1);
  const retained=resources.geometry(part);assert.equal(await retained.ready,first);assert.equal(sourceDisposals,0);retained.release();primary.release();resources.trim();assert.equal(resources.stats.entries,0);assert.equal(sourceDisposals,0);
 }finally{primary.release();resources.dispose();queue.dispose();source.dispose();material.dispose();}
});
