import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const digest=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const sourceName=(value:string)=>decodeURIComponent(value).replaceAll('\\','/').split(/[?#]/,1)[0].split('/').at(-1);
export interface ServedSourceComparison {
 passed:boolean;responseSha256:string;sourceMapSha256:string;expectedSourceSha256:string;servedSourceSha256:string;sourceEntry:string;reason?:string;
}
/** Compare Vite's original inline-map bytes, not feature names in compiled JS.
 * This verifies served provenance, not browser evaluation or shader behaviour. */
export function compareServedTypeScript(transformed:string,expected:Uint8Array,fileName:string):ServedSourceComparison{
 const urls=[...transformed.matchAll(/(?:\/\/[#@]\s*|\/\*[#@]\s*)sourceMappingURL=(data:[^\s*]+)/g)],url=urls.at(-1)?.[1];
 if(!url)throw Error('Missing inline source map for '+fileName+'.');
 const comma=url.indexOf(','),metadata=url.slice(0,comma),payload=url.slice(comma+1);
 if(comma<0||!/^data:application\/json(?:;[^,]*)?$/i.test(metadata))throw Error('Unsupported inline source-map encoding for '+fileName+'.');
 const mapBytes=/;base64(?:;|$)/i.test(metadata)?Buffer.from(payload,'base64'):Buffer.from(decodeURIComponent(payload)),map=JSON.parse(mapBytes.toString('utf8'))as {version?:number;sources?:unknown[];sourcesContent?:unknown[]};
 if(map.version!==3||!Array.isArray(map.sources)||!Array.isArray(map.sourcesContent)||map.sources.length!==map.sourcesContent.length)throw Error('Incomplete inline source map for '+fileName+'.');
 const indices=map.sources.flatMap((value,index)=>typeof value==='string'&&sourceName(value)===sourceName(fileName)?[index]:[]);
 if(indices.length!==1)throw Error('Missing or ambiguous source entry for '+fileName+'.');
 const index=indices[0],content=map.sourcesContent[index];if(typeof content!=='string')throw Error('Missing original source bytes for '+fileName+'.');
 const expectedSourceSha256=digest(expected),servedSourceSha256=digest(Buffer.from(content)),passed=expectedSourceSha256===servedSourceSha256;
 return{passed,responseSha256:digest(transformed),sourceMapSha256:digest(mapBytes),expectedSourceSha256,servedSourceSha256,sourceEntry:map.sources[index]as string,...(passed?{}:{reason:'Served inline source-map bytes differ from current disk source.'})};
}

type FetchSource=(url:string)=>Promise<{ok:boolean;status:number;text():Promise<string>}>;
export interface ServedWorldWorkerCheck extends Partial<ServedSourceComparison> {role:'caller'|'worker'|'shared-layout';url:string;file:string;passed:boolean;error?:string}
export async function verifyServedWorldWorker(options:{baseUrl:string;repoRoot:string;app?:'desktop'|'native';fetchSource?:FetchSource}){
 const base=new URL(options.baseUrl),repoRoot=path.resolve(options.repoRoot),app=options.app??'desktop',appFolder=app==='native'?'main-game-vr':'main game';
 if(base.protocol!=='http:'&&base.protocol!=='https:')throw Error('A local HTTP development-server URL is required.');
 const fetchSource=options.fetchSource??(async url=>fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)})),checks:ServedWorldWorkerCheck[]=[];
 function localUrl(value:string,relative:string){const url=new URL(value,relative);if(url.origin!==base.origin)throw Error('Worker dependencies must use the requested development-server origin.');return url.href;}
 async function inspect(role:ServedWorldWorkerCheck['role'],url:string,file:string){
  const result:ServedWorldWorkerCheck={role,url,file,passed:false};checks.push(result);
  try{const response=await fetchSource(url);if(!response.ok)throw Error('HTTP '+response.status+' for '+role+'.');const body=await response.text(),expected=await readFile(path.join(repoRoot,file));Object.assign(result,compareServedTypeScript(body,expected,path.basename(file)));return body;}
  catch(cause){result.error=cause instanceof Error?cause.message:String(cause);return null;}
 }
 const callerUrl=localUrl('/src/legacy/aethelgard/regional-forest.ts',base.href),caller=await inspect('caller',callerUrl,appFolder+'/src/legacy/aethelgard/regional-forest.ts');
 if(caller!==null){
  const workerRefs=[...new Set([...caller.matchAll(/["']([^"'\r\n]*regional-world\.worker\.ts\?[^"'\r\n]*)["']/g)].map(match=>match[1]))];
  if(workerRefs.length!==1)checks.push({role:'worker',url:callerUrl,file:appFolder+'/src/legacy/aethelgard/regional-world.worker.ts',passed:false,error:'Caller must resolve exactly one actual worker URL.'});
  else{const workerUrl=localUrl(workerRefs[0],callerUrl),worker=await inspect('worker',workerUrl,appFolder+'/src/legacy/aethelgard/regional-world.worker.ts');
   if(worker!==null){const sharedRefs=[...new Set([...worker.matchAll(/(?:from\s*|import\s*)["']([^"']*regional-world-layout\.ts(?:\?[^"']*)?)["']/g)].map(match=>match[1]))];
    if(sharedRefs.length!==1)checks.push({role:'shared-layout',url:workerUrl,file:'shared/legacy/aethelgard/environment/regional-world-layout.ts',passed:false,error:'Worker must resolve exactly one shared layout import.'});
    else await inspect('shared-layout',localUrl(sharedRefs[0],workerUrl),'shared/legacy/aethelgard/environment/regional-world-layout.ts');
   }
  }
 }
 return{passed:checks.length===3&&checks.every(check=>check.passed),app,baseUrl:base.href,repoRoot,checks,scope:'HTTP-served inline source-map bytes versus current disk source before capture; not browser cache/evaluation, visual or device acceptance.'};
}
