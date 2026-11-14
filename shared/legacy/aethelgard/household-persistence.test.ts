import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouseholdStore, HOUSEHOLD_SIDECAR_STORAGE_KEY as KEY, type HouseholdExclusiveOperation, type HouseholdStoreResult } from './household-storage';
import { createHouseholdVisit } from './household-visit';
import { createBrowserHouseholdStore } from './household-browser-store';
import { createHouseholdSimulation, advanceHouseholdSimulation, type HouseholdSimulation } from './household-simulation';
import { createPeopleLifeEventsSnapshot } from './people-life-events';
import { createInheritedSession, applyInheritedStoryChoice, type InheritedSession } from './inherited-session';
import { INHERITED_SESSION_STORAGE_KEY as ENTRY_KEY } from './inherited-storage';
import { createInheritedBannerDraft, chooseInheritedBannerDesign } from './entry-draft';
import type { PeopleLifeRegistry } from './people-life';
const START=1000000,STEP=10,REV='test-persistence-v1',A='test-a',B='test-b',HOME='test-home',WORK='test-work';
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function entry(at='2026-11-06T12:00:00.000Z'):InheritedSession {
  const banner=chooseInheritedBannerDesign(createInheritedBannerDraft(),{division:'per-pale',field:['azure','argent'],ordinary:'none',ordinaryTincture:'or',charge:'key',chargeTincture:'sable'});assert.ok(banner.ok);
  const made=createInheritedSession({type:'enter-inherited-house',origin:'inherited',houseId:'house-ealdholt',nationId:'aethelgard',bannerDraft:banner.draft,bannerConfirmed:true,at,cast:[{id:A,relationshipFacts:[{id:'test-relationship',value:false}]}],storyFacts:[]});assert.ok(made.ok);return made.session;
}
function initial():HouseholdSimulation {
  // Entirely synthetic, coordinate-free test fixture; no production roster.
  const ids=[A,B],registry:PeopleLifeRegistry={places:[{id:HOME,label:'Synthetic home reference'},{id:WORK,label:'Synthetic exterior work'}],households:[{id:'test-household',label:'Synthetic household',homePlaceId:HOME,memberIds:ids}],residents:ids.map((id,i)=>({
    id,label:`Synthetic adult ${i}`,identityNote:'Ordinary test resident.',influenceSensitivity:'occasional',role:{id:'test-role',label:'Synthetic role',purpose:'Exercise household persistence.'},homeHouseholdId:'test-household',family:{kind:'local-kin',ties:[{residentId:ids[1-i],kind:'sibling',description:'Synthetic reciprocal sibling tie.'}]},socialTies:[{residentId:ids[1-i],description:'Synthetic reciprocal acquaintance.'}],decisionMemory:{source:'inherited-story-choices'},routine:[{startMinute:0,endMinute:1440,activity:'Synthetic exterior routine',placeId:HOME,companionIds:[]}],
  }))};
  const events=createPeopleLifeEventsSnapshot(registry,{facts:['test-work-done','test-returned'].map(id=>({id,subjectIds:[A],initialValue:false,initiallyKnownTo:[]})),eventTypes:[{id:'test-completion',factIds:['test-work-done','test-returned'],allowsFamilyRevision:false}],familyRules:[]},{startedAt:START,stepMilliseconds:STEP,seed:17});assert.ok(events.ok);
  const made=createHouseholdSimulation(events.snapshot,{revision:REV,proof:'abstract-route-fixture',catalog:{schema:1,anchors:['test-home-anchor','test-work-anchor'],residents:ids.map(id=>({id,householdId:'test-household'})),households:[{id:'test-household',homePlaceId:HOME}],places:[{id:HOME,kind:'home',anchorId:'test-home-anchor',hours:[]},{id:WORK,kind:'workplace',anchorId:'test-work-anchor',hours:[]}],resources:[{id:'test-home-stance',placeId:HOME,anchorId:'test-home-anchor',kind:'stance',capacity:1,access:{kind:'public'},hours:[]},{id:'test-work-stance',placeId:WORK,anchorId:'test-work-anchor',kind:'stance',capacity:1,access:{kind:'public'},hours:[]}],uses:[{id:'test-home-use',placeId:HOME,kind:'meet',requires:[{resourceId:'test-home-stance',units:1}]},{id:'test-work-use',placeId:WORK,kind:'work',requires:[{resourceId:'test-work-stance',units:1}]}]},routes:[{id:'test-out',fromPlaceId:HOME,toPlaceId:WORK,travelMinutes:2},{id:'test-back',fromPlaceId:WORK,toPlaceId:HOME,travelMinutes:2}],initialPlaces:ids.map(residentId=>({residentId,placeId:HOME})),tasks:[
    {id:'test-job',residentId:A,routeId:'test-out',useId:'test-work-use',startsAt:1,workMinutes:3,completion:{eventId:'test-work-event',typeId:'test-completion',effects:[{factId:'test-work-done',value:true}],witnesses:[{residentId:A,knowledgeId:'test-work-self'}]}},
    {id:'test-return',residentId:A,routeId:'test-back',useId:'test-home-use',startsAt:7,workMinutes:1,completion:{eventId:'test-return-event',typeId:'test-completion',effects:[{factId:'test-returned',value:true}],witnesses:[{residentId:A,knowledgeId:'test-return-self'},{residentId:B,knowledgeId:'test-return-seen'}]}},
  ]});assert.ok(made.ok);return made.snapshot;
}
class Memory {
  values=new Map<string,string>();writes:string[]=[];reads:string[]=[];writeMode:'normal'|'drop'|'throw-after'='normal';
  getItem(key:string){this.reads.push(key);return this.values.get(key)??null;}
  setItem(key:string,value:string){this.writes.push(key);if(this.writeMode==='drop')return;this.values.set(key,value);if(this.writeMode==='throw-after')throw Error('Uncertain write');}
}
function exclusive():HouseholdExclusiveOperation {let tail:Promise<unknown>=Promise.resolve();return<T>(operation:()=>T)=>{const job=tail.then(operation);tail=job.then(()=>undefined,()=>undefined);return job;};}
function accepted(r:HouseholdStoreResult):Extract<HouseholdStoreResult,{ok:true}>{assert.ok(r.ok,r.ok?'':r.error);return r;}
function fixture(){const storage=new Memory(),confirmed=entry(),seed=initial(),lock=exclusive();storage.values.set(ENTRY_KEY,JSON.stringify(confirmed));storage.values.set('crownfall.legacy','untouched original bytes');storage.values.set('crownfall.legacy.aethelgard.save','untouched prior bytes');return{storage,confirmed,seed,lock,store:createHouseholdStore({storage,exclusive:lock,contentRevision:REV})};}
async function initialized(){const f=fixture();accepted(await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed}));return f;}
function advance(s:HouseholdSimulation,minute:number){const r=advanceHouseholdSimulation(s,{expectedGeneration:s.generation,observedAt:START+minute*STEP,maxSteps:1440});assert.ok(r.ok);return r.snapshot;}

test('construction/load/preview are write-free; explicit initialization needs actual persisted confirmed entry',async()=>{
  const f=fixture(),old=new Map(f.storage.values);assert.equal(f.store.load().status,'empty');assert.deepEqual(f.storage.writes,[]);
  assert.equal((await f.store.initialize({confirmedEntry:null,initial:f.seed})).ok,false);assert.deepEqual(f.storage.values,old);
  f.storage.values.delete(ENTRY_KEY);assert.equal((await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed})).ok,false);assert.equal(f.storage.values.has(KEY),false);
  f.storage.values.set(ENTRY_KEY,JSON.stringify(f.confirmed));assert.equal(accepted(await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed})).status,'initialized');
  assert.equal(accepted(await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed})).status,'already-initialized');assert.deepEqual(f.storage.writes,[KEY]);
  for(const [key,raw]of old)assert.equal(f.storage.values.get(key),raw);
  let calls=0;const forbidden=new Proxy({},{get(){calls++;throw Error('Preview touched store');}});
  const preview=createHouseholdVisit({mode:'preview',store:forbidden as never,at:()=>START,yieldControl:async()=>undefined});assert.equal(preview.load(),true);assert.equal(await preview.initialize(f.confirmed,f.seed),false);assert.equal(await preview.catchUp(),false);assert.equal(await preview.command({id:'preview-command',kind:'interrupt',taskId:'test-job'}),false);assert.equal(calls,0);preview.dispose();
});
test('aggregate saves/reloads mid-travel and mid-work, then bounded offline batches equal continuous execution',async()=>{
  const f=await initialized();let s=accepted(await f.store.advance({expectedGeneration:0,observedAt:START+2*STEP,maxSteps:2})).simulation;assert.equal(s.actions[0].status,'travelling');assert.equal(s.actions[0].routeProgress,1);
  const reopened=createHouseholdStore({storage:f.storage,exclusive:f.lock,contentRevision:REV}),loaded=reopened.load();assert.equal(loaded.status,'loaded');if(loaded.status==='loaded')assert.deepEqual(loaded.simulation,s);
  s=accepted(await reopened.advance({expectedGeneration:s.generation,observedAt:START+4*STEP,maxSteps:2})).simulation;assert.equal(s.actions[0].status,'working');assert.equal(s.actions[0].workProgress,1);
  const roundtrip=reopened.load();assert.equal(roundtrip.status,'loaded');if(roundtrip.status==='loaded')assert.deepEqual(roundtrip.simulation,s);
  s=accepted(await reopened.advance({expectedGeneration:s.generation,observedAt:START+1440*STEP,maxSteps:13})).simulation;assert.equal(s.events.world.pendingMilliseconds,(1440-17)*STEP);
  while(s.events.world.elapsedSteps<1440)s=accepted(await reopened.advance({expectedGeneration:s.generation,observedAt:START+1440*STEP,maxSteps:113})).simulation;
  assert.deepEqual(s,advance(f.seed,1440));assert.equal(s.events.events.length,2);assert.deepEqual(f.storage.writes.filter(k=>k!==KEY),[]);
});
test('exclusive re-read rejects a concurrent stale generation and locks every atomic write',async()=>{
  const f=await initialized(),other=createHouseholdStore({storage:f.storage,exclusive:f.lock,contentRevision:REV}),writes=f.storage.writes.length;
  const results=await Promise.all([f.store.advance({expectedGeneration:0,observedAt:START+6*STEP,maxSteps:3}),other.advance({expectedGeneration:0,observedAt:START+6*STEP,maxSteps:3})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.reason==='conflict').length,1);assert.equal(f.storage.writes.length,writes+1);
});
test('corrupt/future/content/binding mismatches preserve original sidecar and every older save byte',async()=>{
  const f=await initialized(),good=f.storage.values.get(KEY)!;
  for(const raw of ['{bad',JSON.stringify({...JSON.parse(good),schemaVersion:2,futureField:true}),JSON.stringify({...JSON.parse(good),contentRevision:'other-revision'})]){
    f.storage.values.set(KEY,raw);const before=new Map(f.storage.values),writes=f.storage.writes.length;assert.equal(f.store.load().status,'invalid');assert.equal((await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed})).ok,false);assert.equal((await f.store.advance({expectedGeneration:0,observedAt:START+STEP,maxSteps:1})).ok,false);assert.deepEqual(f.storage.values,before);assert.equal(f.storage.writes.length,writes);
  }
  f.storage.values.set(KEY,good);f.storage.values.set(ENTRY_KEY,JSON.stringify(entry('2026-11-07T12:00:00.000Z')));const before=new Map(f.storage.values),writes=f.storage.writes.length;
  const loaded=f.store.load();assert.equal(loaded.status,'invalid');if(loaded.status==='invalid')assert.equal(loaded.reason,'entry-mismatch');assert.equal((await f.store.initialize({confirmedEntry:entry('2026-11-07T12:00:00.000Z'),initial:f.seed})).ok,false);assert.deepEqual(f.storage.values,before);assert.equal(f.storage.writes.length,writes);
});
test('ordinary inherited story updates retain the same confirmed-entry binding without household writes',async()=>{
  const f=await initialized(),raw=f.storage.values.get(KEY),updated=applyInheritedStoryChoice(f.confirmed,{type:'story-choice',choiceId:'test-existing-choice',optionId:'test-option',at:'2026-11-06T12:01:00.000Z',personIds:[A],relationshipEffects:[{personId:A,factId:'test-relationship',value:true}],storyEffects:[]});assert.ok(updated.ok);
  f.storage.values.set(ENTRY_KEY,JSON.stringify(updated.session));assert.equal(f.store.load().status,'loaded');assert.equal(f.storage.values.get(KEY),raw);
});
test('fresh wall-time debt blocks commands even when saved pending was zero; exact committed retries remain write-free',async()=>{
  const f=await initialized();let s=accepted(await f.store.advance({expectedGeneration:0,observedAt:START+4*STEP,maxSteps:4})).simulation;assert.equal(s.events.world.pendingMilliseconds,0);
  const writes=f.storage.writes.length,command={id:'test-stop',kind:'interrupt'as const,taskId:'test-job'};
  const pending=await f.store.command({expectedGeneration:s.generation,observedAt:START+100*STEP,command});assert.equal(pending.ok,false);if(!pending.ok){assert.equal(pending.reason,'catchup-required');assert.equal(pending.deferredSteps,96);}assert.equal(f.storage.writes.length,writes);
  s=accepted(await f.store.command({expectedGeneration:s.generation,observedAt:START+4*STEP,command})).simulation;const committed=f.storage.writes.length;
  const retried=accepted(await f.store.command({expectedGeneration:s.generation,observedAt:START+100*STEP,command}));assert.equal(retried.status,'already-applied');assert.equal(f.storage.writes.length,committed);
});
test('write/readback failures never claim success or rollback an uncertain commit',async()=>{
  const f=fixture(),before=new Map(f.storage.values);f.storage.writeMode='drop';const dropped=await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed});assert.equal(dropped.ok,false);if(!dropped.ok)assert.equal(dropped.reason,'verification-failed');assert.deepEqual(f.storage.values,before);
  f.storage.writeMode='throw-after';const uncertain=await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed});assert.equal(uncertain.ok,false);assert.equal(f.store.load().status,'loaded');const writes=f.storage.writes.length;f.storage.writeMode='normal';assert.equal(accepted(await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed})).status,'already-initialized');assert.equal(f.storage.writes.length,writes);
});
test('unavailable exclusive capability, malformed commands and fresh-seed refusal perform no mutation',async()=>{
  const f=fixture(),rejecting=createHouseholdStore({storage:f.storage,contentRevision:REV,exclusive:async()=>{throw Error('Lock rejected');}});assert.equal((await rejecting.initialize({confirmedEntry:f.confirmed,initial:f.seed})).ok,false);assert.deepEqual(f.storage.writes,[]);
  assert.equal((await f.store.initialize({confirmedEntry:f.confirmed,initial:advance(f.seed,2)})).ok,false);assert.deepEqual(f.storage.writes,[]);
  accepted(await f.store.initialize({confirmedEntry:f.confirmed,initial:f.seed}));let reads=0;const bad:any={id:'hostile',kind:'interrupt'};Object.defineProperty(bad,'taskId',{enumerable:true,get(){reads++;return'test-job';}});
  const before=new Map(f.storage.values);assert.equal((await f.store.command({expectedGeneration:0,observedAt:START,command:bad})).ok,false);assert.equal(reads,0);assert.deepEqual(f.storage.values,before);
});
test('arguments are owned before lock wait, so caller mutation cannot rewrite a queued operation',async()=>{
  const f=await initialized();let open!:(v?:unknown)=>void;const gate=new Promise(resolve=>{open=resolve;}),held:HouseholdExclusiveOperation=async operation=>{await gate;return operation();};
  const store=createHouseholdStore({storage:f.storage,exclusive:held,contentRevision:REV}),input={expectedGeneration:0,observedAt:START+2*STEP,maxSteps:2},job=store.advance(input);input.expectedGeneration=999;input.observedAt=START+1000*STEP;input.maxSteps=1440;open();
  const saved=accepted(await job);assert.equal(saved.simulation.events.world.elapsedSteps,2);assert.equal(saved.simulation.events.world.lastObservedAt,START+2*STEP);
});
test('controller yields between fixed-target bounded batches and exposes remaining time instead of swallowing it',async()=>{
  const f=await initialized();let wall=START+20*STEP,yields=0,announcements=0;
  const visit=createHouseholdVisit({mode:'inherited',store:f.store,at:()=>wall,yieldControl:async()=>{yields++;wall=START+100*STEP;},maxStepsPerBatch:2,maxBatchesPerRun:3});const unsubscribe=visit.subscribe(()=>{announcements++;});
  assert.equal(await visit.catchUp(),true);const state=visit.getSnapshot();assert.equal(state.busy,false);assert.equal(state.simulation?.events.world.elapsedSteps,6);assert.equal(state.simulation?.events.world.lastObservedAt,START+20*STEP);assert.equal(state.deferredSteps,14);assert.equal(yields,2);assert.ok(announcements>0);
  const writes=f.storage.writes.length;assert.equal(await visit.command({id:'too-early',kind:'interrupt',taskId:'test-job'}),false);assert.equal(visit.getSnapshot().reason,'catchup-required');assert.equal(f.storage.writes.length,writes);unsubscribe();visit.dispose();
});
test('controller disposal during yield stops all later writes/batches and notifications',async()=>{
  const f=await initialized();let entered!:()=>void,release!:()=>void;const yielded=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const visit=createHouseholdVisit({mode:'inherited',store:f.store,at:()=>START+100*STEP,yieldControl:()=>{entered();return gate;},maxStepsPerBatch:2,maxBatchesPerRun:4});let notifications=0;visit.subscribe(()=>{notifications++;});
  const job=visit.catchUp();await yielded;const writes=f.storage.writes.length,count=notifications;visit.dispose();release();assert.equal(await job,false);assert.equal(f.storage.writes.length,writes);assert.equal(notifications,count);assert.equal(visit.getSnapshot().busy,false);assert.equal(await visit.catchUp(),false);
  const loaded=f.store.load();assert.equal(loaded.status,'loaded');if(loaded.status==='loaded')assert.equal(loaded.simulation.events.world.elapsedSteps,2);
});
test('controller reports uncertain writes and storage conflicts without optimistic success',async()=>{
  const f=fixture(),visit=createHouseholdVisit({mode:'inherited',store:f.store,at:()=>START,yieldControl:async()=>undefined});f.storage.writeMode='throw-after';assert.equal(await visit.initialize(f.confirmed,f.seed),false);assert.equal(visit.getSnapshot().reason,'verification-failed');assert.equal(visit.getSnapshot().busy,false);assert.ok(visit.getSnapshot().simulation,'only the verified fresh recovery read may reveal a committed state');
  f.storage.writeMode='normal';assert.equal(await visit.initialize(f.confirmed,f.seed),true);visit.dispose();
});
test('browser adapter is inert and requires actual Web Locks, sharing the inherited-origin lock for commits',async()=>{
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),priorStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try{
    const f=fixture();let storageReads=0;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){storageReads++;return f.storage;}});
    assert.equal(createBrowserHouseholdStore(REV),null);assert.equal(storageReads,0);
    const lockNames:string[]=[];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(name:string,options:{mode:string},operation:()=>unknown)=>{assert.equal(options.mode,'exclusive');lockNames.push(name);return f.lock(operation);}}}});
    const one=createBrowserHouseholdStore(REV)!,two=createBrowserHouseholdStore(REV)!;assert.ok(one&&two);assert.deepEqual(lockNames,[]);assert.deepEqual(f.storage.writes,[]);
    const results=await Promise.all([one.initialize({confirmedEntry:f.confirmed,initial:f.seed}),two.initialize({confirmedEntry:f.confirmed,initial:f.seed})]);assert.deepEqual(results.map(r=>r.ok&&r.status),['initialized','already-initialized']);assert.deepEqual(f.storage.writes,[KEY]);assert.deepEqual(new Set(lockNames),new Set(['crownfall.legacy.inherited-and-archives']));
  }finally{if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else Reflect.deleteProperty(globalThis,'navigator');if(priorStorage)Object.defineProperty(globalThis,'localStorage',priorStorage);else Reflect.deleteProperty(globalThis,'localStorage');}
});
test('a disposed controller cannot commit initialization or catch-up still queued behind the exclusive lock',async()=>{
  for(const operation of ['initialize','catch-up']as const){
    const f=operation==='initialize'?fixture():await initialized();let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const held:HouseholdExclusiveOperation=async callback=>{entered();await gate;return callback();},store=createHouseholdStore({storage:f.storage,exclusive:held,contentRevision:REV});
    const visit=createHouseholdVisit({mode:'inherited',store,at:()=>START+100*STEP,yieldControl:async()=>undefined,maxStepsPerBatch:2,maxBatchesPerRun:4});
    const before=new Map(f.storage.values),writes=f.storage.writes.length,job=operation==='initialize'?visit.initialize(f.confirmed,f.seed):visit.catchUp();await waiting;visit.dispose();release();assert.equal(await job,false);assert.equal(f.storage.writes.length,writes);assert.deepEqual(f.storage.values,before);
  }
});
