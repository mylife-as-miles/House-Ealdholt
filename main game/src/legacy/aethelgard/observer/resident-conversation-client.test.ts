import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDialogueService,requestResidentDialogue,NPC_DIALOGUE_ENDPOINT} from './resident-conversation-client';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('availability is honest when no service exists or the route returns an HTML fallback',async()=>{
 assert.deepEqual(await checkDialogueService(undefined,async()=>new Response('<html/>',{status:200,headers:{'Content-Type':'text/html'}})),{available:false});
 assert.deepEqual(await checkDialogueService(undefined,async()=>json({available:false,reason:'not configured'})),{available:false});
 assert.deepEqual(await checkDialogueService(undefined,async()=>json({available:true,model:'claude-haiku-5-5'})),{available:true,model:'claude-haiku-5-5'});
 assert.deepEqual(await checkDialogueService(undefined,async()=>json({available:true})),{available:false});
});
test('dialogue sends only the selected identity, user text and bounded history to same origin',async()=>{
 let received:any;const fetcher:typeof fetch=async(url,init)=>{received={url,init,body:JSON.parse(String(init?.body))};return json({residentId:'ealdholt-village-smith',reply:'The forge is warm.',model:'claude-haiku-5-5'});};
 const result=await requestResidentDialogue('ealdholt-village-smith','  Hello  ',[{role:'user',content:'Morning'},{role:'assistant',content:'Hello'}],undefined,fetcher);
 assert.equal(received.url,NPC_DIALOGUE_ENDPOINT);assert.equal(received.init.credentials,'same-origin');assert.deepEqual(received.body,{residentId:'ealdholt-village-smith',message:'Hello',history:[{role:'user',content:'Morning'},{role:'assistant',content:'Hello'}]});assert.equal(result.reply,'The forge is warm.');
});
test('rejects bad inputs, mismatched identities, malformed replies and service failure',async()=>{
 const ok:typeof fetch=async()=>json({residentId:'other',reply:'Not yours',model:'x'});
 await assert.rejects(()=>requestResidentDialogue('resident','x',[],undefined,ok),/invalid response/);
 await assert.rejects(()=>requestResidentDialogue('resident',' '.repeat(4),[],undefined,ok),/1–500/);
 await assert.rejects(()=>requestResidentDialogue('resident','x'.repeat(501),[],undefined,ok),/1–500/);
 await assert.rejects(()=>requestResidentDialogue('resident','x',Array.from({length:7},()=>({role:'user' as const,content:'x'})),undefined,ok),/1–500/);
 const unavailable:typeof fetch=async()=>json({error:'private provider error'},503);
 await assert.rejects(()=>requestResidentDialogue('resident','x',[],undefined,unavailable),/not configured/);
 const malformed:typeof fetch=async()=>new Response('not-json',{status:200,headers:{'Content-Type':'application/json'}});
 await assert.rejects(()=>requestResidentDialogue('resident','x',[],undefined,malformed),/invalid response/);
});
