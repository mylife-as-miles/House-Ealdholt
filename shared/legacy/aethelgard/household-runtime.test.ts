import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouseholdRuntime, parseHouseholdRuntimeSeed, type HouseholdRuntimeOptions, type HouseholdRuntimeSeed } from './household-runtime';
import { createHouseholdStore, HOUSEHOLD_SIDECAR_STORAGE_KEY as KEY, type HouseholdExclusiveOperation } from './household-storage';
import { createInheritedSession, type InheritedSession } from './inherited-session';
import { INHERITED_SESSION_STORAGE_KEY as ENTRY_KEY } from './inherited-storage';
import { chooseInheritedBannerDesign, createInheritedBannerDraft } from './entry-draft';
const START=1000000,STEP=10,A='test-runtime-a',B='test-runtime-b',HOME='test-runtime-home',WELL='test-runtime-well',REV='test-runtime-v1';
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function seed():HouseholdRuntimeSeed {
  const ids=[A,B];return{kind:'household-runtime-seed',schemaVersion:1,contentRevision:REV,stepMilliseconds:STEP,seed:23,
    registry:{places:[{id:HOME,label:'Synthetic home exterior'},{id:WELL,label:'Synthetic well'}],households:[{id:'test-runtime-household',label:'Synthetic household',homePlaceId:HOME,memberIds:ids}],residents:ids.map((id,i)=>({id,label:`Synthetic adult ${i}`,identityNote:'Ordinary synthetic resident.',influenceSensitivity:'occasional',role:{id:'test-runtime-role',label:'Synthetic duty',purpose:'Exercise a finite standing pilot.'},homeHouseholdId:'test-runtime-household',family:{kind:'local-kin',ties:[{residentId:ids[1-i],kind:'sibling',description:'Synthetic reciprocal sibling.'}]},socialTies:[{residentId:ids[1-i],description:'Synthetic reciprocal social tie.'}],routine:[{startMinute:0,endMinute:1440,activity:'Synthetic exterior plan',placeId:HOME,companionIds:[]}],decisionMemory:{source:'inherited-story-choices'}}))},
    model:{facts:[{id:'test-runtime-done',subjectIds:[A],initialValue:false,initiallyKnownTo:[]}],eventTypes:[{id:'test-runtime-event',factIds:['test-runtime-done'],allowsFamilyRevision:false}],familyRules:[]},
    definition:{revision:REV,proof:'abstract-route-fixture',catalog:{schema:1,anchors:['test-home-approach','test-well-approach'],residents:ids.map(id=>({id,householdId:'test-runtime-household'})),households:[{id:'test-runtime-household',homePlaceId:HOME}],places:[{id:HOME,kind:'home',anchorId:'test-home-approach',hours:[]},{id:WELL,kind:'service',anchorId:'test-well-approach',hours:[]}],resources:[{id:'test-runtime-stance',placeId:WELL,anchorId:'test-well-approach',kind:'service',capacity:1,access:{kind:'public'},hours:[]}],uses:[{id:'test-runtime-service',placeId:WELL,kind:'service',requires:[{resourceId:'test-runtime-stance',units:1}]}]},routes:[{id:'test-runtime-route',fromPlaceId:HOME,toPlaceId:WELL,travelMinutes:2}],initialPlaces:ids.map(residentId=>({residentId,placeId:HOME})),tasks:[{id:'test-runtime-duty',residentId:A,routeId:'test-runtime-route',useId:'test-runtime-service',startsAt:1,workMinutes:3,completion:{eventId:'test-runtime-completed',typeId:'test-runtime-event',effects:[{factId:'test-runtime-done',value:true}],witnesses:[{residentId:A,knowledgeId:'test-runtime-self'}]}}]},
  };
}
function confirmed():InheritedSession {
  const banner=chooseInheritedBannerDesign(createInheritedBannerDraft(),{division:'per-pale',field:['azure','argent'],ordinary:'none',ordinaryTincture:'or',charge:'key',chargeTincture:'sable'});assert.ok(banner.ok);
  const r=createInheritedSession({type:'enter-inherited-house',origin:'inherited',houseId:'house-ealdholt',nationId:'aethelgard',bannerDraft:banner.draft,bannerConfirmed:true,at:'2026-11-06T12:00:00.000Z',cast:[{id:A,relationshipFacts:[]}],storyFacts:[]});assert.ok(r.ok);return r.session;
}
function fixture(){
  const values=new Map<string,string>(),entry=confirmed();values.set(ENTRY_KEY,JSON.stringify(entry));values.set('crownfall.legacy','unchanged predecessor');let writes=0,clock=START,clockCalls=0,timerId=0;
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{assert.equal(key,KEY);writes++;values.set(key,value);}};
  let tail:Promise<unknown>=Promise.resolve();const exclusive:HouseholdExclusiveOperation=<T>(operation:()=>T)=>{const job=tail.then(operation);tail=job.then(()=>undefined,()=>undefined);return job;};
  const timers=new Map<number,()=>void>(),store=createHouseholdStore({storage,exclusive,contentRevision:REV});
  const options:HouseholdRuntimeOptions={mode:'inherited',seed:seed(),confirmedEntry:entry,store,at:()=>{clockCalls++;return clock;},yieldControl:async()=>undefined,schedule:callback=>{const id=++timerId;timers.set(id,callback);return()=>{timers.delete(id);};}};
  return{values,entry,store,storage,options,timers,writes:()=>writes,clockCalls:()=>clockCalls,setClock:(at:number)=>{clock=at;}};
}
async function drain(){for(let i=0;i<30;i++)await Promise.resolve();}
test('preview/no seed/unconfirmed remain inert; constructor alone never initializes or schedules',async()=>{
  const f=fixture();let touched=0;const hostile=new Proxy({},{get(){touched++;throw Error('Unexpected preview access');}});
  for(const options of [{...f.options,mode:'preview'as const,seed:hostile,store:hostile as never},{...f.options,seed:null,store:hostile as never},{...f.options,confirmedEntry:null,store:hostile as never}]){
    const runtime=createHouseholdRuntime(options);assert.equal(await runtime.run('visit'),false);assert.equal(runtime.scheduleRun('visit'),false);runtime.setVisible(false);runtime.setVisible(true);runtime.dispose();
  }
  const normal=createHouseholdRuntime(f.options);assert.equal(normal.getSnapshot().phase,'idle');assert.equal(f.writes(),0);assert.equal(f.clockCalls(),0);assert.equal(f.timers.size,0);assert.equal(touched,0);normal.dispose();
});
test('loaded seed validates/copies without fetching; unsupported work/seating/extra fields fail',()=>{
  const input=seed(),before=JSON.stringify(input),parsed=parseHouseholdRuntimeSeed(input);assert.ok(parsed.ok);assert.equal(JSON.stringify(input),before);assert.ok(Object.isFrozen(parsed.seed.definition.tasks[0]));assert.equal(Object.isFrozen(input),false);
  for(const change of [(v:any)=>v.schemaVersion=2,(v:any)=>v.startedAt=123,(v:any)=>v.url='https://invalid.example/seed.json',(v:any)=>v.definition.revision='other',(v:any)=>v.definition.catalog.uses[0].kind='work',(v:any)=>v.definition.catalog.resources[0].kind='seat',(v:any)=>v.definition.catalog.resources[0].capacity=2]){
    const bad=copy(input);change(bad);assert.equal(parseHouseholdRuntimeSeed(bad).ok,false);
  }
  let reads=0;const bad=copy(input)as any;Object.defineProperty(bad,'registry',{enumerable:true,get(){reads++;return input.registry;}});assert.equal(parseHouseholdRuntimeSeed(bad).ok,false);assert.equal(reads,0);
});
test('explicit run initializes current time once; restore/resume retain saved epoch and finite task progress',async()=>{
  const f=fixture(),runtime=createHouseholdRuntime(f.options);assert.equal(await runtime.run('visit'),true);let view=runtime.getSnapshot();assert.equal(view.phase,'ready');assert.equal(view.simulation?.events.world.startedAt,START);assert.equal(view.completedTasks,0);assert.equal(view.totalTasks,1);
  f.setClock(START+2*STEP);assert.equal(await runtime.run('resume'),true);assert.equal(runtime.getSnapshot().simulation?.actions[0].routeProgress,1);runtime.dispose();
  const reopened=createHouseholdRuntime(f.options);f.setClock(START+10*STEP);assert.equal(await reopened.run('visit'),true);view=reopened.getSnapshot();assert.equal(view.simulation?.events.world.startedAt,START);assert.equal(view.completedTasks,1);assert.equal(view.finite,true);assert.equal(view.simulation?.events.events.length,1);
  f.setClock(START+1440*STEP);assert.equal(await reopened.run('resume'),true);assert.equal(reopened.getSnapshot().completedTasks,1);assert.equal(reopened.getSnapshot().simulation?.events.events.length,1,'the authored one-day task never recurs automatically');assert.equal(f.values.get('crownfall.legacy'),'unchanged predecessor');reopened.dispose();
});
test('one-shot scheduling coalesces, visibility cancels pending work and visible return catches elapsed time',async()=>{
  const f=fixture(),runtime=createHouseholdRuntime(f.options);assert.equal(runtime.scheduleRun('visit'),true);assert.equal(runtime.scheduleRun('resume'),false);assert.equal(f.timers.size,1);runtime.setVisible(false);assert.equal(f.timers.size,0);assert.equal(f.writes(),0);
  runtime.setVisible(true);assert.equal(f.timers.size,1);const job=[...f.timers.values()][0];f.timers.clear();job();assert.equal(await runtime.run('visible'),true);assert.equal(f.timers.size,0);
  runtime.setVisible(false);const writes=f.writes();f.setClock(START+15*STEP);assert.equal(await runtime.run('resume'),false);assert.equal(f.writes(),writes);runtime.setVisible(true);const resumed=[...f.timers.values()][0];f.timers.clear();resumed();assert.equal(await runtime.run('visible'),true);assert.equal(runtime.getSnapshot().simulation?.events.world.elapsedSteps,15);runtime.dispose();
});
test('bounded runs leave visible debt and never schedule a hidden recurring drain',async()=>{
  const f=fixture(),runtime=createHouseholdRuntime({...f.options,maxStepsPerBatch:2,maxBatchesPerRun:2});assert.equal(await runtime.run('visit'),true);f.setClock(START+100*STEP);assert.equal(await runtime.run('resume'),true);
  const s=runtime.getSnapshot();assert.equal(s.phase,'deferred');assert.equal(s.deferredSteps,96);assert.equal(s.simulation?.events.world.elapsedSteps,4);assert.equal(f.timers.size,0);const writes=f.writes();await drain();assert.equal(f.writes(),writes);runtime.dispose();
});
test('changed seed or corrupt sidecar is read-only and never silently reseeds',async()=>{
  const f=fixture(),first=createHouseholdRuntime(f.options);assert.equal(await first.run('visit'),true);first.dispose();const bytes=f.values.get(KEY),writes=f.writes();
  const changed=copy(seed())as any;changed.definition.tasks[0].workMinutes=4;const mismatch=createHouseholdRuntime({...f.options,seed:changed});assert.equal(await mismatch.run('visit'),false);assert.equal(mismatch.getSnapshot().reason,'content-mismatch');assert.equal(f.values.get(KEY),bytes);assert.equal(f.writes(),writes);mismatch.dispose();
  f.values.set(KEY,'{corrupt');const corrupt=createHouseholdRuntime(f.options);assert.equal(await corrupt.run('visit'),false);assert.equal(corrupt.getSnapshot().reason,'corrupt');assert.equal(f.values.get(KEY),'{corrupt');assert.equal(f.writes(),writes);corrupt.dispose();
});
test('hiding/disposal cancels queued initialization and all later callbacks; a new visit can safely initialize',async()=>{
  for(const stop of ['hidden','disposed']as const){
    const f=fixture();let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const held:HouseholdExclusiveOperation=async callback=>{entered();await gate;return callback();},store=createHouseholdStore({storage:f.storage,exclusive:held,contentRevision:REV});let callbacks=0;
    const runtime=createHouseholdRuntime({...f.options,store,onState:()=>{callbacks++;}}),job=runtime.run('visit');await waiting;
    if(stop==='hidden')runtime.setVisible(false);else runtime.dispose();const count=callbacks;release();assert.equal(await job,false);assert.equal(f.writes(),0);assert.equal(f.values.has(KEY),false);assert.equal(callbacks,count);runtime.dispose();
    f.setClock(START+1000);const resumed=createHouseholdRuntime(f.options);assert.equal(await resumed.run('visit'),true);assert.equal(resumed.getSnapshot().simulation?.events.world.startedAt,START+1000);resumed.dispose();
  }
});
test('scheduler/clock failures remain visible and disposed or hidden work never self-restarts',async()=>{
  const f=fixture(),badClock=createHouseholdRuntime({...f.options,at:()=>NaN});assert.equal(await badClock.run('visit'),false);assert.equal(badClock.getSnapshot().phase,'unavailable');assert.equal(badClock.getSnapshot().reason,'seed-invalid');assert.ok(badClock.getSnapshot().error);assert.equal(f.writes(),0);badClock.dispose();
  const badScheduler=createHouseholdRuntime({...f.options,schedule:()=>{throw Error('No timer');}});assert.equal(badScheduler.scheduleRun('visit'),false);assert.equal(badScheduler.getSnapshot().reason,'unavailable');badScheduler.dispose();
  const runtime=createHouseholdRuntime(f.options);assert.equal(runtime.scheduleRun('visit'),true);runtime.dispose();assert.equal(f.timers.size,0);assert.equal(await runtime.run('retry'),false);assert.equal(f.writes(),0);
});
test('opt-in live cadence advances visible travel/work with one nonoverlapping timer and stops at finite completion',async()=>{
  const f=fixture(),liveSeed=copy(seed())as any;liveSeed.stepMilliseconds=1000;let lastDelay=0,maxTimers=0;
  const schedule:HouseholdRuntimeOptions['schedule']=(callback,delay)=>{lastDelay=delay;const cancel=f.options.schedule(callback,delay);maxTimers=Math.max(maxTimers,f.timers.size);return cancel;};
  const runtime=createHouseholdRuntime({...f.options,seed:liveSeed,live:true,schedule});assert.equal(await runtime.run('visit'),true);assert.equal(f.timers.size,1);assert.ok(lastDelay>=1000);
  for(let minute=1;minute<=6;minute++){
    f.setClock(START+minute*1000);const tick=[...f.timers.values()][0];assert.ok(tick);f.timers.clear();tick();tick();
    const a=runtime.run('tick'),b=runtime.run('tick');assert.equal(a,b,'a pending tick is one operation');assert.equal(await a,true);
    const state=runtime.getSnapshot();assert.equal(state.simulation?.events.world.elapsedSteps,minute);if(minute===2)assert.equal(state.simulation?.actions[0].routeProgress,1);if(minute===4)assert.equal(state.simulation?.actions[0].workProgress,1);
    assert.equal(f.timers.size,minute===6?0:1);
  }
  assert.equal(runtime.getSnapshot().completedTasks,1);assert.equal(runtime.getSnapshot().simulation?.events.events.length,1);assert.equal(maxTimers,1);assert.ok(lastDelay>=1000);runtime.dispose();
});
test('live pause/hidden/error/disposal cancel the next foreground tick without a new planner loop',async()=>{
  const f=fixture(),runtime=createHouseholdRuntime({...f.options,live:true});assert.equal(await runtime.run('visit'),true);assert.equal(f.timers.size,1);
  runtime.setVisible(false);assert.equal(f.timers.size,0);const writes=f.writes();f.setClock(START+50*STEP);await drain();assert.equal(f.writes(),writes);
  runtime.setVisible(true);assert.equal(f.timers.size,1);runtime.dispose();assert.equal(f.timers.size,0);await drain();assert.equal(f.writes(),writes);
  const next=fixture(),live=createHouseholdRuntime({...next.options,live:true});assert.equal(await live.run('visit'),true);next.values.set(KEY,'{corrupt');const tick=[...next.timers.values()][0];next.timers.clear();tick();assert.equal(await live.run('tick'),false);assert.equal(live.getSnapshot().phase,'unavailable');assert.equal(next.timers.size,0);live.dispose();
});
test('live finite completion still drains saved deferred time before retiring its foreground timer',async()=>{
  const f=fixture(),content=copy(seed())as any;content.stepMilliseconds=1000;
  const runtime=createHouseholdRuntime({...f.options,seed:content,live:true,maxStepsPerBatch:2,maxBatchesPerRun:1});assert.equal(await runtime.run('visit'),true);f.setClock(START+10000);assert.equal(await runtime.run('resume'),true);
  while(runtime.getSnapshot().deferredSteps){
    const tick=[...f.timers.values()][0];assert.ok(tick);f.timers.clear();tick();assert.equal(await runtime.run('tick'),true);
    if(runtime.getSnapshot().completedTasks===1&&runtime.getSnapshot().deferredSteps>0)assert.equal(f.timers.size,1,'completed tasks cannot hide unresolved world-time debt');
  }
  assert.equal(runtime.getSnapshot().simulation?.events.world.elapsedSteps,10);assert.equal(runtime.getSnapshot().completedTasks,1);assert.equal(runtime.getSnapshot().simulation?.events.events.length,1);assert.equal(f.timers.size,0);runtime.dispose();
});
