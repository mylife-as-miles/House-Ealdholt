/** Optional, exact-byte delivery for a large village model on static hosts with
 * per-file limits. The caller retains its original model URL and identity. */
export interface ChunkedVillageIdentity {readonly bytes:number;readonly sha256:string}
type Chunk={file:string;bytes:number;sha256:string};
type Manifest={version:1;model:string;bytes:number;sha256:string;chunkBytes:number;chunks:Chunk[]};
const MAX_TOTAL=200*1024*1024,MAX_CHUNK=16*1024*1024,MAX_MANIFEST=64*1024;
const hashPattern=/^[a-f0-9]{64}$/;
const safeLength=(n:unknown,max:number):n is number=>Number.isSafeInteger(n)&&(n as number)>0&&(n as number)<=max;
async function hash(bytes:BufferSource):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function manifestFor(value:unknown,filename:string,expected:ChunkedVillageIdentity):Manifest {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid village chunk manifest.');
 const m=value as Manifest;
 if(m.version!==1||m.model!==filename||m.bytes!==expected.bytes||m.sha256!==expected.sha256||!safeLength(m.bytes,MAX_TOTAL)||!hashPattern.test(m.sha256)||!safeLength(m.chunkBytes,MAX_CHUNK)||!Array.isArray(m.chunks)||m.chunks.length!==Math.ceil(m.bytes/m.chunkBytes)||m.chunks.length>1024)throw Error('Village chunk manifest identity or limits are invalid.');
 for(let i=0;i<m.chunks.length;i++){
  const c=m.chunks[i],size=Math.min(m.chunkBytes,m.bytes-i*m.chunkBytes),name=`${filename}.part-${String(i).padStart(3,'0')}`;
  if(!c||c.file!==name||c.bytes!==size||typeof c.sha256!=='string'||!hashPattern.test(c.sha256))throw Error('Village chunk list is invalid or out of order.');
 }
 return m;
}
async function boundedBody(response:Response,expected:number,signal:AbortSignal,onRead?:(count:number)=>void):Promise<Uint8Array<ArrayBuffer>>{
 if(!response.ok)throw Error(`Village chunk request failed (${response.status}).`);
 const header=response.headers.get('content-length');if(header!==null&&!response.headers.get('content-encoding')&&(!/^\d+$/.test(header)||Number(header)!==expected))throw Error('Village chunk content length is invalid.');
 const bytes=new Uint8Array(expected);let used=0;
 if(!response.body)throw Error('Village chunk response has no readable body.');
 const reader=response.body.getReader();try{for(;;){if(signal.aborted)throw Error('Village download cancelled.');const {done,value}=await reader.read();if(done)break;if(used+value.length>expected)throw Error('Village chunk exceeds its expected length.');bytes.set(value,used);used+=value.length;onRead?.(value.length);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(used!==expected)throw Error('Village chunk is incomplete.');return bytes;
}
async function readManifestBody(response:Response,signal:AbortSignal):Promise<string>{
 if(!response.body)throw Error('Village chunk manifest has no readable body.');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){if(signal.aborted)throw Error('Village download cancelled.');const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_MANIFEST)throw Error('Village chunk manifest is too large.');parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return new TextDecoder().decode(data);
}
export async function loadChunkedVillageModel(modelUrl:string,expected:ChunkedVillageIdentity,signal:AbortSignal,onProgress?:(fraction:number)=>void,fetcher:typeof fetch=fetch):Promise<ArrayBuffer>{
 if(signal.aborted)throw Error('Village download cancelled.');
 if(!safeLength(expected.bytes,MAX_TOTAL)||!hashPattern.test(expected.sha256))throw Error('Expected village identity is invalid.');
 const url=new URL(modelUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Village model URL is invalid.');
 const filename=url.pathname.split('/').pop()??'';if(!/^[a-zA-Z0-9._-]+\.glb$/.test(filename))throw Error('Village model filename is invalid.');
 const base=new URL('.',url), manifestUrl=new URL(`${filename}.chunks.json`,base);
 const res=await fetcher(manifestUrl.href,{signal,redirect:'error'});if(!res.ok)throw Error(`Village chunk manifest request failed (${res.status}).`);
 const length=res.headers.get('content-length');if(length!==null&&!res.headers.get('content-encoding')&&(!/^\d+$/.test(length)||Number(length)>MAX_MANIFEST))throw Error('Village chunk manifest is too large.');
 const raw=await readManifestBody(res,signal);if(raw.length>MAX_MANIFEST)throw Error('Village chunk manifest is too large.');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw Error('Village chunk manifest is invalid JSON.');}
 const manifest=manifestFor(parsed,filename,expected);const out=new Uint8Array(manifest.bytes);let received=0;
 for(const chunk of manifest.chunks){
  const chunkUrl=new URL(chunk.file,base);if(chunkUrl.origin!==url.origin||chunkUrl.pathname!==`${base.pathname}${chunk.file}`)throw Error('Village chunk path is invalid.');
  const response=await fetcher(chunkUrl.href,{signal,redirect:'error'});
  const part=await boundedBody(response,chunk.bytes,signal,n=>{received+=n;onProgress?.(received/manifest.bytes);});
  if(await hash(part)!==chunk.sha256)throw Error('Village chunk failed SHA-256 verification.');
  out.set(part,received-part.length);
 }
 if(signal.aborted)throw Error('Village download cancelled.');
 const digest=await hash(out);
 if(signal.aborted)throw Error('Village download cancelled.');
 if(received!==expected.bytes||digest!==expected.sha256)throw Error('Reassembled village failed SHA-256 verification.');
 return out.buffer;
}
