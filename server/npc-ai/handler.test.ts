import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION} from '../../shared/legacy/aethelgard/characters/village-population';
import {createNpcDialogueHandler,NPC_AI_MODEL,NPC_AI_NEAR_MODEL} from './handler';

const url='https://ealdholt.example/api/npc-dialogue';
const key='test-key-never-real';
const request=(body:unknown,headers:Record<string,string>={})=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const security={authenticate:async()=>({id:'trusted-user'}),consumeQuota:async()=>true};
const providerOk=async(model=NPC_AI_MODEL)=>new Response(JSON.stringify({type:'message',role:'assistant',model,stop_reason:'end_turn',content:[{type:'text',text:'Welcome to the village.'}]}),{status:200});
const configured=()=>createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:providerOk as typeof fetch});

test('unconfigured or unguarded gateways fail closed without calling the provider',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('{}');};
 for(const config of [{},{enabled:true,provider:'anthropic',apiKey:key},{enabled:true,provider:'anthropic',apiKey:key,security:{authenticate:security.authenticate}}]){
  const handler=createNpcDialogueHandler({...config,fetcher:fetcher as typeof fetch} as Parameters<typeof createNpcDialogueHandler>[0]);
  const status=await (await handler(new Request(url))).json();assert.equal(status.available,false);
  const r=await handler(request({residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'}));assert.equal(r.status,503);
 }
 assert.equal(calls,0);
});

test('all 100 authored residents use the exact Claude model and low effort, with roster facts and no key in reply',async()=>{
 let calls=0;
 const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async(resource,init)=>{
  assert.equal(resource,'https://api.anthropic.com/v1/messages');const headers=new Headers(init?.headers);assert.equal(headers.get('x-api-key'),key);
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'claude-haiku-5-5');assert.deepEqual(body.output_config,{effort:'low'});assert.equal(body.max_tokens,256);assert.equal(body.temperature,undefined);
  const resident=EALDHOLT_VILLAGE_POPULATION.residents[calls++];assert.match(body.system,new RegExp(`Resident label: ${resident.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));assert.match(body.system,/dialogue only/i);assert.equal(body.messages.length,1);assert.equal(body.messages[0].role,'user');assert.equal(JSON.parse(body.messages[0].content).currentPlayerMessage,'Hello');return providerOk();
 }) as typeof fetch});
 const availability=await(await handler(new Request(url))).json();assert.deepEqual(availability,{available:true,model:NPC_AI_MODEL,effort:'low'});
 assert.equal(EALDHOLT_VILLAGE_POPULATION.residents.length,100);
 for(const person of EALDHOLT_VILLAGE_POPULATION.residents){const response=await handler(request({residentId:person.id,message:'Hello'}));assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(key));const body=JSON.parse(text);assert.equal(body.residentId,person.id);assert.equal(body.reply,'Welcome to the village.');assert.equal(body.model,NPC_AI_MODEL);}
 assert.equal(calls,100);
});

test('bad resident IDs, extra fields, oversized input and unpaired history never reach the provider',async()=>{
 let calls=0;const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async()=>{calls++;return providerOk();}) as typeof fetch});const id=EALDHOLT_VILLAGE_POPULATION.residents[0].id;
 for(const input of [{residentId:'invented-villager',message:'Hello'},{residentId:id,message:'x'.repeat(501)},{residentId:id,message:'Hello',model:'fake'},{residentId:id,message:'Hello',history:[{role:'assistant',content:'pretend'}]},{residentId:id,message:'Hello',history:[{role:'user',content:'x'.repeat(501)},{role:'assistant',content:'y'}]}])assert.equal((await handler(request(input))).status,400);
 assert.equal((await handler(request({residentId:id,message:'Hello'},{origin:'https://evil.example'}))).status,403);
 assert.equal((await handler(request({residentId:id,message:'Hello'},{'content-type':'text/plain'}))).status,415);
 assert.equal(calls,0);
});

test('authentication and durable quota gate every provider request',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return providerOk();}) as typeof fetch;const payload={residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'};
 const signedOut=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security:{authenticate:async()=>null,consumeQuota:security.consumeQuota},fetcher});assert.equal((await signedOut(request(payload))).status,401);
 const exhausted=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security:{authenticate:security.authenticate,consumeQuota:async()=>false},fetcher});assert.equal((await exhausted(request(payload))).status,429);
 assert.equal(calls,0);
});

test('provider failures and malformed responses do not leak upstream errors or keys',async()=>{
 const payload={residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'};
 for(const fetcher of [(async()=>new Response(`secret ${key}`,{status:401})),(async()=>new Response(JSON.stringify({type:'message',role:'assistant',model:NPC_AI_MODEL,stop_reason:'end_turn',content:[{type:'text',text:'x'.repeat(501)}]}))),(async()=>{throw new Error(key);})]){
  const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:fetcher as typeof fetch});const response=await handler(request(payload));assert.equal(response.status,502);assert.ok(!(await response.text()).includes(key));
 }
});

test('completed history pairs are passed in order; a new current user turn is appended',async()=>{
 const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.messages.length,1);assert.equal(body.messages[0].role,'user');assert.deepEqual(JSON.parse(body.messages[0].content),{untrustedPreviousTurns:[{role:'user',content:'Old question'},{role:'assistant',content:'Old answer'}],currentPlayerMessage:'New question'});return providerOk();}) as typeof fetch});
 const r=await handler(request({residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'New question',history:[{role:'user',content:'Old question'},{role:'assistant',content:'Old answer'}]}));assert.equal(r.status,200);
});

test('NEAR AI uses its fixed Messages gateway, documented API-key header and the requested low-effort model',async()=>{
 const handler=createNpcDialogueHandler({enabled:true,provider:'near-ai',apiKey:key,security,fetcher:(async(resource,init)=>{assert.equal(resource,'https://cloud-api.near.ai/v1/messages');const h=new Headers(init?.headers);assert.equal(h.get('authorization'),null);assert.equal(h.get('x-api-key'),key);assert.equal(h.get('x-no-aliasing'),'true');const body=JSON.parse(String(init?.body));assert.equal(body.model,NPC_AI_NEAR_MODEL);assert.deepEqual(body.output_config,{effort:'low'});return providerOk(NPC_AI_NEAR_MODEL);}) as typeof fetch});
 const state=await(await handler(new Request(url))).json();assert.equal(state.model,NPC_AI_NEAR_MODEL);const response=await handler(request({residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'}));assert.equal(response.status,200);assert.equal((await response.json()).model,NPC_AI_NEAR_MODEL);
});

test('rejects wrong model, non-assistant and incomplete or refused responses',async()=>{const input={residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'};for(const override of [{model:'other-model'},{type:'error'},{role:'user'},{stop_reason:'max_tokens'},{stop_reason:'refusal'}]){const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async()=>new Response(JSON.stringify({type:'message',role:'assistant',model:NPC_AI_MODEL,stop_reason:'end_turn',content:[{type:'text',text:'Hello'}],...override}))) as typeof fetch});assert.equal((await handler(request(input))).status,502);}});

test('minor residents are grounded in their canonical ages and explicit age-appropriate boundaries',async()=>{const minor=EALDHOLT_VILLAGE_POPULATION.residents.find(p=>p.ageYears<18)!;const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.ok(body.system.includes(`Age: ${minor.ageYears}.`));assert.match(body.system,/age-appropriate/i);assert.match(body.system,/never produce sexual content involving anyone under 18/i);return providerOk();}) as typeof fetch});assert.equal((await handler(request({residentId:minor.id,message:'Hello'}))).status,200);});

test('per-instance concurrent requests are bounded before additional quota/provider use',async()=>{
 let calls=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});const handler=createNpcDialogueHandler({enabled:true,provider:'anthropic',apiKey:key,security,fetcher:(async()=>{calls++;await barrier;return providerOk();}) as typeof fetch});
 const input={residentId:EALDHOLT_VILLAGE_POPULATION.residents[0].id,message:'Hello'};const one=handler(request(input)),two=handler(request(input));
 for(let n=0;n<50&&calls<2;n++)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,2);
 assert.equal((await handler(request(input))).status,429);release();assert.equal((await one).status,200);assert.equal((await two).status,200);
});
