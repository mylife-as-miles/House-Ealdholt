import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadChunkedVillageModel} from './chunked-village-model';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const bytes=new TextEncoder().encode('abcdefghij'),file='village.glb',url=`https://game.example/legacy/${file}`;
const manifest=()=>({version:1,model:file,bytes:bytes.length,sha256:sha(bytes),chunkBytes:4,chunks:[0,1,2].map(i=>{const part=bytes.slice(i*4,i*4+4);return {file:`${file}.part-${String(i).padStart(3,'0')}`,bytes:part.length,sha256:sha(part)};})});
const identity={bytes:bytes.length,sha256:sha(bytes)};
function mock(m:unknown=manifest(),overrides:Record<string,Response>={}){let calls:string[]=[];const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{const u=String(input);calls.push(u);assert.equal(init?.redirect,'error');if(overrides[u])return overrides[u];if(u===`${url}.chunks.json`)return new Response(JSON.stringify(m));const index=[0,1,2].find(i=>u===`${url}.part-${String(i).padStart(3,'0')}`);return index===undefined?new Response(null,{status:404}):new Response(bytes.slice(index*4,index*4+4));};return {fetcher:fetcher as typeof fetch,calls};}
const signal=()=>new AbortController().signal;
test('reassembles exact verified bytes, keeps requests on the original origin and reports real progress',async()=>{
 const {fetcher,calls}=mock(),progress:number[]=[];const out=await loadChunkedVillageModel(url,identity,signal(),p=>progress.push(p),fetcher);
 assert.deepEqual(new Uint8Array(out),bytes);assert.equal(calls.length,4);assert.ok(calls.every(u=>new URL(u).origin==='https://game.example'));assert.equal(progress.at(-1),1);assert.ok(progress.every((p,i)=>p>0&&p<=1&&(i===0||p>=progress[i-1])));
});
test('rejects malformed identity, reordered and cross-origin chunk paths without fetching chunks',async()=>{
 for(const bad of [null,{...manifest(),sha256:'0'.repeat(64)},{...manifest(),chunks:[...manifest().chunks].reverse()},{...manifest(),chunks:manifest().chunks.map((c,i)=>i===0?{...c,file:'https://evil.test/stolen'}:c)},{...manifest(),chunkBytes:17*1024*1024}]){
  const {fetcher,calls}=mock(bad);await assert.rejects(()=>loadChunkedVillageModel(url,identity,signal(),undefined,fetcher));assert.equal(calls.length,1);
 }
});
test('missing, oversized, truncated or modified chunks fail closed',async()=>{
 const chunk=`${url}.part-000`;
 for(const bad of [new Response(null,{status:404}),new Response('abc'),new Response('abcde'),new Response('WXYZ'),new Response('abcd',{headers:{'content-length':'3'}})]){
  const {fetcher}=mock(manifest(),{[chunk]:bad});await assert.rejects(()=>loadChunkedVillageModel(url,identity,signal(),undefined,fetcher));
 }
});
test('rejects a self-consistent modified chunk when the final source SHA-256 differs',async()=>{
 const bad=new TextEncoder().encode('WXYZ'),m=manifest();m.chunks[0].sha256=sha(bad);
 const {fetcher}=mock(m,{[`${url}.part-000`]:new Response(bad)});await assert.rejects(()=>loadChunkedVillageModel(url,identity,signal(),undefined,fetcher),/Reassembled village/);
});
test('rejects missing and oversized manifests, unsafe model URLs and cancellation',async()=>{
 const missing=mock(manifest(),{[`${url}.chunks.json`]:new Response(null,{status:404})});await assert.rejects(()=>loadChunkedVillageModel(url,identity,signal(),undefined,missing.fetcher),/manifest request/);
 const tooBig=mock(manifest(),{[`${url}.chunks.json`]:new Response('x'.repeat(65537))});await assert.rejects(()=>loadChunkedVillageModel(url,identity,signal(),undefined,tooBig.fetcher),/too large/);
 await assert.rejects(()=>loadChunkedVillageModel(`${url}?other=1`,identity,signal()),/URL is invalid/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>loadChunkedVillageModel(url,identity,controller.signal),/cancelled/);
});

test('a cancelled in-progress fetch fails without moving on to later parts',async()=>{
 const controller=new AbortController(),base=mock();let parts=0;
 const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input).includes('.part-')){parts++;controller.abort();}return base.fetcher(input,init);};
 await assert.rejects(()=>loadChunkedVillageModel(url,identity,controller.signal,undefined,fetcher as typeof fetch),/cancelled|abort/i);assert.equal(parts,1);
});
test('does not compare compressed content-length with decoded chunk size',async()=>{
 const b=bytes.slice(0,4),{fetcher}=mock(manifest(),{[`${url}.part-000`]:new Response(b,{headers:{'content-length':'2','content-encoding':'gzip'}})});
 assert.deepEqual(new Uint8Array(await loadChunkedVillageModel(url,identity,signal(),undefined,fetcher)),bytes);
});

test('does not return verified bytes if cancellation occurs during the final digest',async()=>{
 const controller=new AbortController(),subtle=crypto.subtle,original=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest.bind(subtle);let count=0;
 Object.defineProperty(subtle,'digest',{configurable:true,writable:true,value:async (...args:Parameters<SubtleCrypto['digest']>)=>{const result=await digest(...args);if(++count===4)controller.abort();return result;}});
 try{const {fetcher}=mock();await assert.rejects(()=>loadChunkedVillageModel(url,identity,controller.signal,undefined,fetcher),/cancelled/);assert.equal(count,4);}
 finally{if(original)Object.defineProperty(subtle,'digest',original);else Reflect.deleteProperty(subtle,'digest');}
});
