import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm,stat,link} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {splitVillageModel} from './split-village-model.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('splits a verified separate copy into bounded reassemblable chunks without overwriting source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'village-chunks-test-'));try{const src=join(root,'source.glb'),out=join(root,'out'),body=Buffer.from('abcdefghij'),expected={bytes:body.length,sha256:sha(body)};await writeFile(src,body);await (await import('node:fs/promises')).mkdir(out);await writeFile(join(out,'source.glb'),body);
 const r=await splitVillageModel({input:src,outputDir:out,expected,chunkBytes:4,removeModelCopy:true});assert.equal(r.parts,3);await assert.rejects(()=>stat(join(out,'source.glb')),{code:'ENOENT'});assert.deepEqual(await readFile(src),body);
 const m=JSON.parse(await readFile(r.manifest));const parts=await Promise.all(m.chunks.map(c=>readFile(join(out,c.file))));assert.ok(parts.every(b=>b.length<=4));assert.deepEqual(Buffer.concat(parts),body);
 await splitVillageModel({input:src,outputDir:out,expected,chunkBytes:4});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('mismatched sources, same-inode output and existing differing chunks are never overwritten',async()=>{
 const root=await mkdtemp(join(tmpdir(),'village-chunks-test-'));try{const src=join(root,'source.glb'),out=join(root,'out'),body=Buffer.from('abcdefghij'),expected={bytes:body.length,sha256:sha(body)};await writeFile(src,body);await (await import('node:fs/promises')).mkdir(out);
 await assert.rejects(()=>splitVillageModel({input:src,outputDir:out,expected:{...expected,sha256:'0'.repeat(64)},chunkBytes:4}),/does not match/);
 await link(src,join(out,'source.glb'));await assert.rejects(()=>splitVillageModel({input:src,outputDir:out,expected,chunkBytes:4,removeModelCopy:true}),/separate verified copy/);assert.deepEqual(await readFile(src),body);
 await writeFile(join(out,'source.glb.part-000'),'evil');await assert.rejects(()=>splitVillageModel({input:src,outputDir:out,expected,chunkBytes:4}),/Existing chunk differs/);assert.equal(await readFile(join(out,'source.glb.part-000'),'utf8'),'evil');await assert.rejects(()=>stat(join(out,'source.glb.chunks.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
