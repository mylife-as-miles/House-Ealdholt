import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareServedTypeScript,verifyServedWorldWorker} from './served-world-worker';
const transformed=(name:string,source:string,body='export const compiled=true;')=>body+'\n//# sourceMappingURL=data:application/json;base64,'+Buffer.from(JSON.stringify({version:3,sources:[name],sourcesContent:[source],names:[],mappings:''})).toString('base64');

test('inline source-map bytes detect stale transforms even when compiled code contains every expected feature marker',()=>{
 const current='export const realisticForest01Trees = true;\nexport const scannedShrubs = true;\n',stale='export const realisticTrees = true;\n';
 const body='/* realisticForest01Source realisticForest01Trees scannedShrubSource scannedShrubs */';
 const result=compareServedTypeScript(transformed('regional-world-layout.ts',stale,body),Buffer.from(current),'regional-world-layout.ts');assert.equal(result.passed,false);assert.notEqual(result.expectedSourceSha256,result.servedSourceSha256);assert.match(result.reason!,/differ/);
 assert.equal(compareServedTypeScript(transformed('regional-world-layout.ts',current,body),Buffer.from(current),'regional-world-layout.ts').passed,true);
});

test('worker query suffixes are accepted, while changed line endings, missing or ambiguous original bytes fail closed',()=>{
 const source='// exact source\r\nself.onmessage = handle;\r\n';assert.equal(compareServedTypeScript(transformed('regional-world.worker.ts?worker_file&type=module',source),Buffer.from(source),'regional-world.worker.ts').passed,true);
 assert.equal(compareServedTypeScript(transformed('regional-world.worker.ts',source),Buffer.from(source.replaceAll('\r\n','\n')),'regional-world.worker.ts').passed,false);
 for(const value of ['export const noMap=true;',transformed('other.ts',source),'//# sourceMappingURL=data:application/json;base64,e30='])assert.throws(()=>compareServedTypeScript(value,Buffer.from(source),'regional-world.worker.ts'));
 const duplicate='//# sourceMappingURL=data:application/json;base64,'+Buffer.from(JSON.stringify({version:3,sources:['a/regional-world.worker.ts','b/regional-world.worker.ts'],sourcesContent:[source,source]})).toString('base64');assert.throws(()=>compareServedTypeScript(duplicate,Buffer.from(source),'regional-world.worker.ts'),/ambiguous/);
});

test('capture preflight follows the real caller worker URL and its exact shared import, refusing a stale dependency or missing map',async()=>{
 const repo=await mkdtemp(path.join(tmpdir(),'crownfall-served-worker-')),base='http://127.0.0.1:4191',callerFile='main game/src/legacy/aethelgard/regional-forest.ts',workerFile='main game/src/legacy/aethelgard/regional-world.worker.ts',sharedFile='shared/legacy/aethelgard/environment/regional-world-layout.ts';
 const caller='// current caller\n',worker='// current worker\n',shared='// current shared layout\n',workerUrl='/src/legacy/aethelgard/regional-world.worker.ts?worker_file&type=module',sharedUrl='/@fs/private/project/shared/legacy/aethelgard/environment/regional-world-layout.ts?t=old';
 try{for(const[file,bytes]of[[callerFile,caller],[workerFile,worker],[sharedFile,shared]]){await mkdir(path.dirname(path.join(repo,file)),{recursive:true});await writeFile(path.join(repo,file),bytes);}
  const bodies=new Map([[base+'/src/legacy/aethelgard/regional-forest.ts',transformed('regional-forest.ts',caller,'new Worker(new URL("'+workerUrl+'", import.meta.url));')],[base+workerUrl,transformed('regional-world.worker.ts?worker_file&type=module',worker,'import {createRegionalWorldLayout} from "'+sharedUrl+'";')],[base+sharedUrl,transformed('regional-world-layout.ts',shared)]]),requests:string[]=[];
  const fetchSource=async(url:string)=>{requests.push(url);return{ok:bodies.has(url),status:bodies.has(url)?200:404,text:async()=>bodies.get(url)??''};};
  const good=await verifyServedWorldWorker({baseUrl:base,repoRoot:repo,fetchSource});assert.equal(good.passed,true);assert.deepEqual(requests,[base+'/src/legacy/aethelgard/regional-forest.ts',base+workerUrl,base+sharedUrl]);
  bodies.set(base+sharedUrl,transformed('regional-world-layout.ts','// stale layout\n','/* realisticForest01Source scannedShrubSource */'));const stale=await verifyServedWorldWorker({baseUrl:base,repoRoot:repo,fetchSource});assert.equal(stale.passed,false);assert.equal(stale.checks[0].passed,true);assert.equal(stale.checks[1].passed,true);assert.equal(stale.checks[2].passed,false);
  bodies.set(base+sharedUrl,'export const noInlineMap = true;');const missing=await verifyServedWorldWorker({baseUrl:base,repoRoot:repo,fetchSource});assert.equal(missing.passed,false);assert.match(missing.checks[2].error!,/source map/);
 }finally{await rm(repo,{recursive:true,force:true});}
});
