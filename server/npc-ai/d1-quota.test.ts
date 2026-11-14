import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createD1DailyQuota,NPC_AI_CONSUME_SQL,NPC_AI_QUOTA_SCHEMA,type NpcQuotaD1} from './d1-quota';

async function sqlite(){try{return await import('node:sqlite');}catch{return null;}}
function d1(db:any):NpcQuotaD1{return {prepare(query:string){return {bind(...args:(string|number)[]){return {async first<T>(){return (db.prepare(query).get(...args)??null) as T|null;}}}}}};}
test('D1 SQL enforces durable per-user and global quotas plus burst limits atomically',async t=>{
 const mod=await sqlite();if(!mod){t.skip('node:sqlite requires Node 22+');return;}const db=new mod.DatabaseSync(':memory:');try{db.exec(await readFile(new URL('./migrations/0001_npc_ai_quota.sql',import.meta.url),'utf8'));
 let time=Date.parse('2026-11-14T12:00:00Z');const quota=createD1DailyQuota(d1(db),()=>new Date(time));
 const burst=await Promise.all(Array.from({length:8},()=>quota({id:'alice'})));assert.equal(burst.filter(Boolean).length,3);
 for(const count of [3,3,1]){time+=60000;for(let i=0;i<count;i++)assert.equal(await quota({id:'alice'}),true);}
 assert.equal(await quota({id:'alice'}),false);assert.equal((db.prepare('SELECT total FROM npc_ai_daily_quota').get() as any).total,10);
 // Replaying the same minute through a second adapter does not reset the cap.
 assert.equal(await createD1DailyQuota(d1(db),()=>new Date(time))({id:'alice'}),false);
 // All identities share 100 daily credits and 10 per minute.
 let accepted=10;for(let minute=0;minute<10;minute++){time+=60000;const results=await Promise.all(Array.from({length:15},(_,i)=>quota({id:`user-${minute}-${i}`})));accepted+=results.filter(Boolean).length;}
 assert.equal(accepted,100);time+=60000;assert.equal(await quota({id:'another'}),false);
 time+=86400000;assert.equal(await quota({id:'alice'}),true);
 }finally{db.close();}
});
test('D1 quota rejects malformed identity and fails closed on database errors',async()=>{
 let calls=0;const bad:NpcQuotaD1={prepare(){calls++;throw Error('database unavailable');}};const quota=createD1DailyQuota(bad,()=>new Date('2026-11-14T12:00:00Z'));
 assert.equal(await quota({id:''}),false);assert.equal(await quota({id:' x '}),false);assert.equal(calls,0);await assert.rejects(()=>quota({id:'alice'}));
 assert.ok(NPC_AI_CONSUME_SQL.includes('?2'));assert.ok(!NPC_AI_CONSUME_SQL.includes('alice'));
});
