import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalDailyQuota} from './local-quota';

test('local global budget is serialized, durable across restarts, and resets only on a later UTC day',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ealdholt-quota-'));try{const file=join(dir,'quota.json');let day='2026-11-14T12:00:00Z';const quota=createLocalDailyQuota(file,3,()=>new Date(day));
 const results=await Promise.all(Array.from({length:10},()=>quota()));assert.equal(results.filter(Boolean).length,3);const record=JSON.parse(await readFile(file,'utf8'));assert.equal(record.day,'2026-11-14');assert.equal(record.used,3);assert.equal(record.windowUsed,3);
 assert.equal(await createLocalDailyQuota(file,3,()=>new Date(day))(),false);day='2026-11-15T00:00:00Z';assert.equal(await quota(),true);day='2026-11-14T00:00:00Z';await assert.rejects(()=>quota(),/clock is behind/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid local budget or corrupted stored quota fail closed',async()=>{assert.throws(()=>createLocalDailyQuota('/tmp/x',0));assert.throws(()=>createLocalDailyQuota('/tmp/x',101));const dir=await mkdtemp(join(tmpdir(),'ealdholt-quota-'));try{const file=join(dir,'quota.json');await writeFile(file,'{"day":"bad","used":0}');await assert.rejects(()=>createLocalDailyQuota(file,3)(),/invalid/);}finally{await rm(dir,{recursive:true,force:true});}});

test('the short-window cap survives a restart and resets after a minute',async()=>{const dir=await mkdtemp(join(tmpdir(),'ealdholt-rate-'));try{const file=join(dir,'quota.json');let t='2026-11-14T12:00:00Z';const quota=createLocalDailyQuota(file,20,()=>new Date(t));const results=await Promise.all(Array.from({length:8},()=>quota()));assert.equal(results.filter(Boolean).length,5);assert.equal(await createLocalDailyQuota(file,20,()=>new Date(t))(),false);t='2026-11-14T12:01:00Z';assert.equal(await quota(),true);}finally{await rm(dir,{recursive:true,force:true});}});

test('two independent server instances cannot overspend a shared daily budget',async()=>{const dir=await mkdtemp(join(tmpdir(),'ealdholt-global-'));try{const file=join(dir,'quota.json'),now=()=>new Date('2026-11-14T12:00:00Z');const one=createLocalDailyQuota(file,1,now),two=createLocalDailyQuota(file,1,now);const results=await Promise.all([one(),two()]);assert.equal(results.filter(Boolean).length,1);assert.equal(JSON.parse(await readFile(file,'utf8')).used,1);}finally{await rm(dir,{recursive:true,force:true});}});
