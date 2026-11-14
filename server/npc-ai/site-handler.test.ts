import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createSiteNpcDialogueHandler} from './site-handler';
import type {NpcQuotaD1} from './d1-quota';
const url='https://example.site/api/npc-dialogue';
const db:NpcQuotaD1={prepare(){return {bind(){return {async first<T>(){return null as T|null;}}}}}};
test('public adapter fails closed without both a trusted identity resolver and durable quota binding',async()=>{
 for(const [env,auth] of [[{NPC_AI_ENABLED:'true',ANTHROPIC_API_KEY:'fake'},undefined],[{NPC_AI_ENABLED:'true',ANTHROPIC_API_KEY:'fake',NPC_AI_QUOTA_DB:db},undefined],[{NPC_AI_ENABLED:'true',ANTHROPIC_API_KEY:'fake'},async()=>({id:'owner'})]] as const){const h=createSiteNpcDialogueHandler(env,auth);const r=await h(new Request(url));assert.equal((await r.json()).available,false);}
});
test('public adapter never treats a caller-controlled identity header as authentication',async()=>{
 let quotaCalls=0;const quota:NpcQuotaD1={prepare(){quotaCalls++;return {bind(){return {async first<T>(){return {total:1} as T;}}}}}};
 const h=createSiteNpcDialogueHandler({NPC_AI_ENABLED:'true',ANTHROPIC_API_KEY:'fake',NPC_AI_QUOTA_DB:quota},async()=>null);
 const r=await h(new Request(url,{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'forged'},body:JSON.stringify({residentId:'ealdholt-village-smith',message:'Hello'})}));assert.equal(r.status,401);assert.equal(quotaCalls,0);
});
