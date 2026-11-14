import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {GENERATED_FOLIAGE_MAPS} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';

test('actual preparation worker dispatches normal jobs, transports owned mip buffers and rejects unpinned map pixels',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'self'),packets:any[]=[];
 const worker={onmessage:null as unknown as (message:MessageEvent)=>Promise<void>,postMessage(data:unknown,options?:{transfer:Transferable[]}){packets.push(structuredClone(data,{transfer:options?.transfer??[]}));}};
 Object.defineProperty(globalThis,'self',{configurable:true,value:worker});
 try{
  await import('./vegetation-prepare.worker');
  const bytes=await readFile((process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR?resolve(process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR,'ash.png'):new URL('../../../public/assets/legacy/environment/aethelgard/regional-v1/textures/ash.png',import.meta.url))),pixels=Uint8Array.from(await sharp(bytes).ensureAlpha().raw().toBuffer());
  const source=pixels.slice(),data=structuredClone({id:41,kind:'foliage-normal',input:{map:'ash',rgba:source,width:512,height:512,size:128}},{transfer:[source.buffer]});assert.equal(source.byteLength,0);
  await worker.onmessage({data} as MessageEvent);assert.equal(packets.length,1);assert.equal(packets[0].id,41);assert.equal(packets[0].record.canonicalSha256,GENERATED_FOLIAGE_MAPS.ash.rgba);assert.equal(packets[0].record.bytes,87380);assert.deepEqual(packets[0].record.mips.map((m:any)=>m.width),[128,64,32,16,8,4,2,1]);assert.equal(data.input.rgba.byteLength,512*512*4,'worker owns its input; only output chains transfer');
  const invalid=pixels.slice();invalid[3]=255;await worker.onmessage({data:{id:42,kind:'foliage-normal',input:{map:'ash',rgba:invalid,width:512,height:512,size:128}}} as MessageEvent);assert.equal(packets[1].id,42);assert.match(packets[1].error,/pinned regional map/);
  assert.equal(pixels.byteLength,512*512*4,'borrowed source pixels never transfer');
 }finally{if(descriptor)Object.defineProperty(globalThis,'self',descriptor);else Reflect.deleteProperty(globalThis,'self');}
});
