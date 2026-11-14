import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {BufferAttribute,BufferGeometry,DataTexture,DoubleSide,LinearFilter,LinearMipmapLinearFilter,Matrix4,MeshStandardMaterial,RepeatWrapping,SRGBColorSpace,type WebGLRenderer} from 'three';
import {createGeneratedRegionalFoliageNormals,qualifyGeneratedRegionalFoliage} from './generated-foliage-normals';
import {createVegetationPrototypeResources} from './vegetation-prototype';
import {REGIONAL_VEGETATION_PROFILES} from '../../../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {GENERATED_FOLIAGE_MAPS,generatedFoliageMapForPrototype,prepareGeneratedFoliageNormals,type QualifiedGeneratedFoliageNormalInput} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {VegetationCapturePart} from './vegetation-atlas-capture';

async function waitFor(predicate:()=>boolean){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Expected bounded normal preparation stage was not reached.');await new Promise(r=>setTimeout(r,1));}}
const cardCounts=[373,533,573,453,613,693,413,573,613,247,338,377,240,330,300];
const pixelSources=Promise.all(Object.keys(GENERATED_FOLIAGE_MAPS).map(async key=>{const png=await readFile((process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR?resolve(process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR,key+'.png'):new URL('../../../public/assets/legacy/environment/aethelgard/regional-v1/textures/'+key+'.png',import.meta.url)));return[key,Uint8Array.from(await sharp(png).ensureAlpha().raw().toBuffer())] as const;}));
async function fixture(native=false){
 const textures=new Map<string,DataTexture>(),materials=new Map<string,MeshStandardMaterial>();
 for(const [key,data] of await pixelSources){const map=new DataTexture(data.slice(),512,512);map.colorSpace=SRGBColorSpace;map.wrapS=map.wrapT=RepeatWrapping;map.magFilter=LinearFilter;map.minFilter=LinearMipmapLinearFilter;map.flipY=false;map.needsUpdate=true;textures.set(key,map);const material=new MeshStandardMaterial({map,alphaTest:.4,side:DoubleSide,roughness:.86,vertexColors:true,color:0xf4f5ec});material.name=key+' foliage';materials.set(key,material);}
 const wood=new MeshStandardMaterial(),woodGeometry=new BufferGeometry(),variants=REGIONAL_VEGETATION_PROTOTYPES.map((prototype,i)=>{
  const count=cardCounts[i]*4,geometry=new BufferGeometry(),uv=new Float32Array(count*2),indices=new Uint32Array(cardCounts[i]*6);
  for(let k=0;k<count;k++){uv[k*2]=k%2;uv[k*2+1]=k%4<2?0:1;}
  for(let k=0;k<cardCounts[i];k++)indices.set([k*4,k*4+2,k*4+1,k*4+2,k*4+3,k*4+1],k*6);
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(count*3),3));geometry.setAttribute('uv',new BufferAttribute(uv,2));geometry.setIndex(new BufferAttribute(indices,1));
  const material=materials.get(generatedFoliageMapForPrototype(prototype.id)!)!;
  return{id:String(prototype.id),parts:[{geometry:woodGeometry,material:wood,frame:new Matrix4(),foliage:false},{geometry,material:prototype.id==='elder'?material.clone():material,frame:new Matrix4(),foliage:true}] as VegetationCapturePart[]};
 });
 let uploads=0,fences=0,borrowedRetired=0;const ownedTextures:DataTexture[]=[],originals=variants.map(v=>v.parts.slice());
 for(const resource of [...textures.values(),...new Set(variants.flatMap(v=>v.parts.map(p=>p.material))),...variants.flatMap(v=>v.parts.map(p=>p.geometry))])resource.addEventListener('dispose',()=>borrowedRetired++);
 const queue={enqueue:async(job:{signal?:AbortSignal;work:()=>unknown})=>{job.signal?.throwIfAborted();return job.work();},whenIdle:async()=>{},get pending(){return 0;}} as unknown as WorldPreparationQueue;
 const renderer={initTexture(texture:DataTexture){uploads++;ownedTextures.push(texture);}} as unknown as WebGLRenderer;
 const worker={foliageNormals:prepareGeneratedFoliageNormals} as unknown as VegetationPreparationWorker;
 const resources=createVegetationPrototypeResources(renderer,queue,worker,1024*1024),controller=new AbortController();
 const options={variants,profile:(native?'quest':'desktop') as 'desktop'|'quest',sourceSha256:REGIONAL_VEGETATION_PROFILES[native?'quest':'desktop'].sha256,native,renderer,queue,worker,resources,signal:controller.signal,retirementFence:async()=>{fences++;},changed(){}};
 return{variants,originals,textures,materials,worker,resources,controller,ownedTextures,options,get uploads(){return uploads;},get fences(){return fences;},get borrowedRetired(){return borrowedRetired;},
  cleanup(){resources.dispose();for(const texture of textures.values())texture.dispose();for(const material of new Set(variants.flatMap((_,i)=>originals[i].map(p=>p.material))))material.dispose();for(const geometry of new Set(variants.flatMap((_,i)=>originals[i].map(p=>p.geometry))))geometry.dispose();}};
}
test('only current generated profile/family/UV/material maps can allocate; authored or modified inputs keep originals',async()=>{
 const f=await fixture();assert.equal(qualifyGeneratedRegionalFoliage(f.variants,'desktop',f.options.sourceSha256).length,15);
 assert.throws(()=>qualifyGeneratedRegionalFoliage(f.variants,'desktop','f'.repeat(64)),/profile/);
 for(const change of ['name','uv','channel','flip','normal','family'] as const){
  const row=f.variants[0],part=row.parts[1],uv=part.geometry.getAttribute('uv'),map=part.material.map!,originalName=part.material.name;
  if(change==='name')part.material.name='Authored alder canopy';if(change==='uv')uv.setX(0,.5);if(change==='channel')map.channel=1;if(change==='flip')map.flipY=true;if(change==='normal')part.material.normalMap=map;if(change==='family')row.id='SM_BlackAlder_Forest_01';
  const handle=createGeneratedRegionalFoliageNormals(f.options);await handle.prepare();assert.equal(handle.stats.status,'fallback',change);assert.equal(f.uploads,0,change);assert.equal(row.parts[1],f.originals[0][1],change);handle.dispose();await handle.whenRetired();
  part.material.name=originalName;uv.setX(0,0);map.channel=0;map.flipY=false;part.material.normalMap=null;row.id=REGIONAL_VEGETATION_PROTOTYPES[0].id;
 }
 assert.equal(f.borrowedRetired,0);f.cleanup();
});
test('all source-pattern-aligned mips share six maps and preserve source PBR/UV/geometry through GPU-fenced restoration',async()=>{
 const f=await fixture(),sourceMap=f.textures.get('oak')!,sourceBytes=(sourceMap.image.data as Uint8Array).slice();let release!:()=>void,disposedMaps=0;const gate=new Promise<void>(r=>{release=r;});f.options.retirementFence=()=>gate;
 const handle=createGeneratedRegionalFoliageNormals(f.options);await handle.prepare();assert.equal(handle.stats.status,'ready',handle.stats.error);assert.equal(handle.stats.maps,6);assert.equal(handle.stats.materials,7);assert.equal(handle.stats.textureBytes,2097144);assert.equal(handle.stats.retainedBufferBytes,4194288);assert.equal(f.uploads,6);
 for(let i=0;i<f.variants.length;i++){
  const before=f.originals[i][1],after=f.variants[i].parts[1];assert.notEqual(after,before);assert.equal(after.geometry,before.geometry);assert.equal(after.frame,before.frame);assert.notEqual(after.material,before.material);assert.equal(after.material.map,before.material.map);assert.equal(before.material.normalMap,null);
  const normal=after.material.normalMap as DataTexture;assert.equal(normal.colorSpace,'');assert.equal(normal.flipY,sourceMap.flipY);assert.equal(normal.channel,sourceMap.channel);assert.equal(normal.generateMipmaps,false);assert.deepEqual(normal.mipmaps.map(m=>m.width),[256,128,64,32,16,8,4,2,1]);assert.deepEqual(normal.matrix.elements,sourceMap.matrix.elements);assert.deepEqual(after.material.normalScale.toArray(),[.25,.25]);
  assert.equal(f.variants[i].parts[0],f.originals[i][0]);assert.ok(after.material.userData.crownfallGeneratedFoliageNormalIdentity.includes('linear-alpha-v1'));
 }
 for(const map of f.ownedTextures)map.addEventListener('dispose',()=>disposedMaps++);
 handle.dispose();handle.dispose();await new Promise(r=>setTimeout(r,0));assert.equal(disposedMaps,0);assert.equal(f.borrowedRetired,0);for(let i=0;i<f.variants.length;i++)assert.equal(f.variants[i].parts[1],f.originals[i][1]);
 release();await handle.whenRetired();assert.equal(disposedMaps,6);assert.equal(handle.stats.retainedBufferBytes,0);assert.deepEqual(sourceMap.image.data,sourceBytes);assert.equal(f.borrowedRetired,0);f.cleanup();
});
test('Native uses its actual source profile and128px normals without a Desktop complete-source transplant',async()=>{
 const f=await fixture(true),handle=createGeneratedRegionalFoliageNormals(f.options);await handle.prepare();assert.equal(handle.stats.status,'ready',handle.stats.error);assert.equal(handle.stats.size,128);assert.equal(handle.stats.textureBytes,524280);assert.equal(handle.stats.retainedBufferBytes,1048560);assert.equal(handle.stats.maximumRetainedBufferBytes,1048576);handle.dispose();await handle.whenRetired();assert.equal(f.borrowedRetired,0);f.cleanup();
});
test('a changed source pixel fails closed before upload; no fallback can inherit a mismatched normal map',async()=>{
 const f=await fixture();(f.textures.get('oak')!.image.data as Uint8Array)[3]=255;const handle=createGeneratedRegionalFoliageNormals(f.options);await handle.prepare();assert.equal(handle.stats.status,'fallback');assert.match(handle.stats.error,/pinned regional map/);assert.equal(f.uploads,0);assert.equal(f.variants[0].parts[1],f.originals[0][1]);handle.dispose();await handle.whenRetired();f.cleanup();
});
test('cancellation of a pending worker cannot promote or leak a late normal chain',async()=>{
 const f=await fixture();let finish!:(input:Awaited<ReturnType<typeof prepareGeneratedFoliageNormals>>)=>void,received!:QualifiedGeneratedFoliageNormalInput;
 f.worker.foliageNormals=async input=>{received=input;return new Promise(resolve=>{finish=resolve;});};const handle=createGeneratedRegionalFoliageNormals(f.options),pending=handle.prepare();
 await waitFor(()=>!!finish);handle.dispose();finish(await prepareGeneratedFoliageNormals(received));await pending;await handle.whenRetired();assert.equal(f.uploads,0);assert.equal(handle.stats.status,'disposed');assert.equal(f.variants[0].parts[1],f.originals[0][1]);assert.equal(f.borrowedRetired,0);f.cleanup();
});
test('partial uploads and source mutation roll back atomically and remain fenced until no GPU user can observe them',async()=>{
 const f=await fixture();let release!:()=>void,failAt=0,disposals=0;const gate=new Promise<void>(r=>{release=r;});f.options.retirementFence=()=>gate;
 f.worker.foliageNormals=async input=>{if(++failAt===3)throw Error('worker rejected next source');return prepareGeneratedFoliageNormals(input);};const handle=createGeneratedRegionalFoliageNormals(f.options),pending=handle.prepare();
 await waitFor(()=>failAt>=3);for(const map of f.ownedTextures)map.addEventListener('dispose',()=>disposals++);assert.equal(f.uploads,2);assert.equal(disposals,0);assert.equal(f.variants[0].parts[1],f.originals[0][1]);release();await pending;assert.equal(handle.stats.status,'fallback');assert.equal(disposals,2);assert.equal(handle.stats.retainedBufferBytes,0);handle.dispose();await handle.whenRetired();assert.equal(f.borrowedRetired,0);f.cleanup();
});

test('foreign source changes during worker preparation cannot acquire stale mapped captures',async()=>{
 const f=await fixture();let n=0;f.worker.foliageNormals=async input=>{const result=await prepareGeneratedFoliageNormals(input);if(++n===6)f.textures.get('oak')!.needsUpdate=true;return result;};
 const handle=createGeneratedRegionalFoliageNormals(f.options);await handle.prepare();assert.equal(handle.stats.status,'fallback');assert.match(handle.stats.error,/changed during preparation/);assert.equal(f.variants[0].parts[1],f.originals[0][1]);assert.equal(handle.stats.retainedBufferBytes,0);handle.dispose();await handle.whenRetired();assert.equal(f.borrowedRetired,0);f.cleanup();
});
