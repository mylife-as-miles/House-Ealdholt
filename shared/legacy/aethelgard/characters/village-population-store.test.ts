import assert from 'node:assert/strict';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION} from './village-population';
import {createVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationRuntime} from './village-population-runtime';
import {createVillagePopulationStore,pruneVillagePopulationSaves,VILLAGE_POPULATION_SAVE_OPTIONS,VILLAGE_POPULATION_STORAGE_PREFIX,VILLAGE_POPULATION_CONTENT_REVISION as REV,VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES,type VillagePopulationStorage,type VillagePopulationCatchupScheduler,type VillagePopulationCatchupDeadline} from './village-population-store';

const START=1800000000000,PACE=4000,ENTRY='["test-house","test-entry",{"test-banner":true}]',KEY=VILLAGE_POPULATION_STORAGE_PREFIX+encodeURIComponent(ENTRY);
class Memory implements VillagePopulationStorage{
  values=new Map<string,string>();reads:string[]=[];writes:string[]=[];mode:'normal'|'drop'|'throw-before'|'throw-after'='normal';readError=false;
  getItem(key:string){this.reads.push(key);if(this.readError)throw Error('Storage reads unavailable');return this.values.get(key)??null;}
  setItem(key:string,value:string){this.writes.push(key);if(this.mode==='throw-before')throw Error('Quota exceeded');if(this.mode==='drop')return;this.values.set(key,value);if(this.mode==='throw-after')throw Error('Write outcome uncertain');}
}
class IdleQueue implements VillagePopulationCatchupScheduler{
  jobs:{callback:(deadline:VillagePopulationCatchupDeadline)=>void;cancelled:boolean}[]=[];maximumPending=0;
  schedule(callback:(deadline:VillagePopulationCatchupDeadline)=>void){const job={callback,cancelled:false};this.jobs.push(job);this.maximumPending=Math.max(this.maximumPending,this.pending);return{cancel:()=>{job.cancelled=true;}};}
  get pending(){return this.jobs.filter(job=>!job.cancelled).length;}
  run(timeRemaining=8,didTimeout=true){const job=this.jobs.shift();assert.ok(job,'a queued task is required');if(!job.cancelled)job.callback({didTimeout,timeRemaining:()=>timeRemaining});}
}
function fixture(){const storage=new Memory();storage.values.set('crownfall.legacy','unaltered original bytes');storage.values.set('crownfall.legacy.aethelgard.inherited-session','unaltered inherited bytes');storage.values.set('crownfall.legacy.aethelgard.household-sidecar.v1','unaltered private household bytes');let wall=START;return{storage,at:()=>wall,setClock:(value:number)=>{wall=value;}};}
function encoded(worldKey=ENTRY){const facts=POPULATION.residents.map((r,i)=>({residentId:r.id,facts:[{id:'test-authored-story-fact',value:i%2===0}]}));const s=createVillagePopulationRuntime({population:POPULATION,confirmedEntry:true,worldKey,contentRevision:REV,createdAt:START,initialDayMinute:540,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:.8,rosterFacts:facts});assert.ok(s.ok);const json=serializeVillagePopulationRuntime(s.snapshot);assert.ok(json.ok);return{snapshot:s.snapshot,json:json.json};}

test('persistent epoch and all 100 identities, kin, roles and personal facts survive reopening without ticks',()=>{
  const f=fixture(),authored=encoded();f.storage.values.set(KEY,authored.json);const before=new Map(f.storage.values),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at,maximumAdvanceMinutes:60});assert.equal(f.storage.writes.length,0);
  assert.deepEqual(store.getSnapshot(),authored.snapshot);assert.equal(store.getSnapshot().population.residents.length,100);assert.equal(store.getSnapshot().population.households.length,25);
  f.setClock(START+2*1440*PACE+2500);let current=store.advance();assert.ok(current.clock.pendingMilliseconds>0);while(current.clock.pendingMilliseconds>0)current=store.advance();assert.equal(current.clock.createdAt,START);assert.equal(current.clock.simulatedElapsedMilliseconds,2*1440*PACE+2500);assert.deepEqual(current.rosterFacts,authored.snapshot.rosterFacts);assert.deepEqual(current.population.registry,authored.snapshot.population.registry);
  store.dispose();const reopened=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.deepEqual(reopened.getSnapshot(),current);assert.equal(reopened.key,KEY);
  for(const [key,raw]of before)if(key!==KEY)assert.equal(f.storage.values.get(key),raw);assert.ok(f.storage.reads.every(k=>k===KEY));assert.ok(f.storage.writes.every(k=>k===KEY));reopened.dispose();
});
test('normal presentation pause/away time cannot freeze or reset the independent createdAt clock',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at,maximumAdvanceMinutes:60}),start=store.getSnapshot();
  // No renderer, visibility callback or advance occurs during this interval.
  f.setClock(START+60*PACE);assert.equal(store.getSnapshot(),start);const observed=store.advance();assert.equal(observed.clock.simulatedElapsedMilliseconds,60*PACE);assert.equal(observed.clock.initialDayMinute,540);assert.equal(observed.clock.millisecondsPerWorldMinute,PACE);store.dispose();
  f.setClock(START+61*PACE);const next=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(next.advance().clock.simulatedElapsedMilliseconds,61*PACE);assert.equal(next.getSnapshot().clock.createdAt,START);next.dispose();
});
test('frame-rate observation does not write the full roster before the 15-second flush cadence',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(f.storage.writes.length,1);
  for(let i=1;i<60;i++){f.setClock(START+i*250);store.advance();}assert.equal(f.storage.writes.length,1);
  f.setClock(START+15000);store.advance();assert.equal(f.storage.writes.length,2);assert.equal(store.flush(),true);assert.equal(f.storage.writes.length,2,'unchanged explicit flush is write-free');
  f.setClock(START+15250);store.advance();assert.equal(f.storage.writes.length,2);store.dispose();assert.equal(f.storage.writes.length,3,'dispose may flush the final dirty cursor');store.dispose();assert.equal(f.storage.writes.length,3);assert.throws(()=>store.advance(),/disposed/);
});
test('corrupt, future, incompatible and foreign-world saves are held without replacement',()=>{
  const good=encoded().json,other=encoded('another-confirmed-world').json;
  for(const raw of ['{bad',JSON.stringify({...JSON.parse(good),schemaVersion:3}),JSON.stringify({...JSON.parse(good),contentRevision:'another-content'}),other,JSON.stringify({kind:'household-sidecar',schemaVersion:1})]){
    const f=fixture();f.storage.values.set(KEY,raw);const before=new Map(f.storage.values);assert.throws(()=>createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}));assert.equal(f.storage.writes.length,0);assert.deepEqual(f.storage.values,before);
  }
  const f=fixture(),before=new Map(f.storage.values);assert.throws(()=>createVillagePopulationStore({entryIdentity:'',storage:f.storage,at:f.at}));assert.deepEqual(f.storage.values,before);assert.equal(f.storage.writes.length,0);
});
test('quota, unavailable storage and dropped writes remain honest memory state without advancing a saved baseline',()=>{
  for(const mode of ['drop','throw-before']as const){const f=fixture();f.storage.mode=mode;const before=new Map(f.storage.values),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(store.persistence,'memory');assert.match(store.error??'',/not be verified|readback|Quota/i);assert.deepEqual(f.storage.values,before);const count=f.storage.writes.length;assert.equal(store.flush(),false);assert.equal(f.storage.writes.length,count);store.dispose();}
  const f=fixture(),memory=createVillagePopulationStore({entryIdentity:ENTRY,storage:null,at:f.at});assert.equal(memory.persistence,'memory');f.setClock(START+PACE);assert.equal(memory.advance().clock.simulatedElapsedMilliseconds,PACE);assert.equal(memory.flush(),false);memory.dispose();assert.equal(f.storage.writes.length,0);
  f.storage.readError=true;const blocked=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(blocked.persistence,'memory');assert.match(blocked.error??'',/unavailable/);assert.equal(f.storage.writes.length,0);blocked.dispose();
});
test('an uncertain committed write is not called ready and reopening recovers its same epoch',()=>{
  const f=fixture();f.storage.mode='throw-after';const store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(store.persistence,'memory');assert.match(store.error??'',/may have committed/);assert.ok(f.storage.values.has(KEY));const written=f.storage.values.get(KEY),count=f.storage.writes.length;store.dispose();assert.equal(f.storage.writes.length,count);
  f.storage.mode='normal';const recovered=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(recovered.persistence,'ready');assert.equal(recovered.getSnapshot().clock.createdAt,START);assert.equal(f.storage.values.get(KEY),written);assert.equal(f.storage.writes.length,count);recovered.dispose();
});
test('best-effort stale-baseline conflict detection refuses an already changed save without claiming atomic CAS',()=>{
  const f=fixture(),one=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}),two=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});f.setClock(START+15000);one.advance();const current=f.storage.values.get(KEY),count=f.storage.writes.length;
  two.advance();assert.equal(two.persistence,'conflict');assert.match(two.error??'',/another tab/);assert.equal(f.storage.values.get(KEY),current);assert.equal(f.storage.writes.length,count);assert.equal(two.flush(),false);two.dispose();assert.equal(f.storage.values.get(KEY),current);one.dispose();
  // This proves stale-value refusal in a synchronous fake port. A separate
  // browser lock is still required before claiming atomic cross-tab writes.
});
test('rollback errors preserve current state and prior stored bytes',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});f.setClock(START+PACE);store.advance();assert.equal(store.flush(),true);const s=store.getSnapshot(),raw=f.storage.values.get(KEY),count=f.storage.writes.length;
  f.setClock(START);assert.throws(()=>store.advance(),/rewind/);assert.equal(store.getSnapshot(),s);assert.equal(f.storage.values.get(KEY),raw);assert.equal(f.storage.writes.length,count);store.dispose();
  const loaded=parseVillagePopulationRuntime(raw!,{worldKey:ENTRY,contentRevision:REV},VILLAGE_POPULATION_SAVE_OPTIONS);assert.ok(loaded.ok);assert.equal(loaded.snapshot.clock.createdAt,START);
});
test('default catch-up preserves debt and advances all 100 lives in small camera-independent slices',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});f.setClock(START+61*PACE+1234);
  let s=store.advance();assert.equal(s.clock.simulatedElapsedMilliseconds,VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES*PACE);
  assert.equal(s.life.absoluteMinute,540+VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES);assert.equal(s.navigation.absoluteMinute,s.life.absoluteMinute);
  assert.equal(s.clock.pendingMilliseconds,(61-VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES)*PACE+1234);assert.equal(s.life.residents.length,100);
  while(s.clock.pendingMilliseconds)s=store.advance();assert.equal(s.life.absoluteMinute,601);assert.equal(s.navigation.absoluteMinute,601+1234/PACE);assert.equal(s.clock.simulatedElapsedMilliseconds,61*PACE+1234);
  store.flush();const reopened=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.deepEqual(reopened.getSnapshot(),s);reopened.dispose();store.dispose();
});
test('old schema bytes are held until an explicit migration flush and retain their epoch and facts',()=>{
  const f=fixture(),old=JSON.parse(encoded().json);old.schemaVersion=1;delete old.life;delete old.navigation;delete old.navigationOther;delete old.safetySignals;delete old.safetySignalIds;
  old.generation=12;old.clock.simulatedElapsedMilliseconds=137*PACE+7;old.clock.lastObservedAt=START+140*PACE;old.clock.pendingMilliseconds=3*PACE-7;
  const raw=JSON.stringify(old);f.storage.values.set(KEY,raw);f.setClock(old.clock.lastObservedAt);
  const store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}),s=store.getSnapshot();assert.equal(f.storage.writes.length,0);assert.equal(f.storage.values.get(KEY),raw);
  assert.equal(s.schemaVersion,2);assert.deepEqual(s.clock,old.clock);assert.deepEqual(s.rosterFacts,old.rosterFacts);assert.equal(s.life.journal.length,0);assert.equal(s.life.absoluteMinute,677);
  assert.equal(store.flush(),true);assert.equal(JSON.parse(f.storage.values.get(KEY)!).schemaVersion,2);assert.deepEqual(store.getSnapshot(),s);store.dispose();
});
test('persisted incident reports survive reload and an already stale writer cannot overwrite them',()=>{
  const f=fixture(),one=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}),two=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}),person=POPULATION.residents[0];
  const signal={id:'test-witnessed-forge-fire',kind:'fire' as const,channel:'witness' as const,knownByResidentIds:[person.id],placeId:person.workPlaceId,
    observedAbsoluteMinute:540,expiresAbsoluteMinute:548,affectedResidentIds:[person.id],shelterPlaceId:person.homePlaceId};
  const entered=one.reportSafetySignals([signal]);assert.deepEqual(JSON.parse(f.storage.values.get(KEY)!).safetySignals,[signal]);const writes=f.storage.writes.length;
  assert.equal(one.reportSafetySignals([signal]),entered);assert.equal(f.storage.writes.length,writes,'idempotent reports do not write');assert.equal(one.flush(),true);
  const raw=f.storage.values.get(KEY);two.reportSafetySignals([{...signal,id:'test-other-incident'}]);assert.equal(two.flush(),false);assert.equal(two.persistence,'conflict');assert.equal(f.storage.values.get(KEY),raw);
  const reopened=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.deepEqual(reopened.getSnapshot().safetySignals,[signal]);f.setClock(START+PACE);
  const s=reopened.advance();assert.equal(s.life.residents[0].safety.mode,'shelter');assert.equal(s.clock.simulatedElapsedMilliseconds,PACE);assert.equal(s.life.absoluteMinute,541);
  reopened.dispose();two.dispose();one.dispose();
});
test('failed incident readback retains memory evidence without retrying or replacing the saved baseline',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at}),old=f.storage.values.get(KEY),person=POPULATION.residents[0];f.storage.mode='drop';
  const signal={id:'test-incident-dropped-write',kind:'hazard' as const,channel:'report' as const,knownByResidentIds:[person.id],placeId:person.workPlaceId,
    observedAbsoluteMinute:540,expiresAbsoluteMinute:550,affectedResidentIds:[person.id],shelterPlaceId:person.homePlaceId};
  const s=store.reportSafetySignals([signal]);assert.deepEqual(s.safetySignals,[signal]);assert.equal(store.persistence,'memory');assert.equal(f.storage.values.get(KEY),old);assert.match(store.error??'',/may have committed/);
  const writes=f.storage.writes.length;assert.equal(store.flush(),false);store.dispose();assert.equal(f.storage.writes.length,writes);
});
test('cooperative debt drain yields one world-minute per task and shares the normal polling clock',()=>{
  const f=fixture(),idle=new IdleQueue(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at,catchupScheduler:idle});assert.equal(idle.pending,0);
  f.setClock(START+7*PACE+1234);let s=store.advance();assert.equal(s.clock.simulatedElapsedMilliseconds,PACE);assert.equal(idle.pending,1);
  s=store.advance();assert.equal(s.clock.simulatedElapsedMilliseconds,2*PACE);assert.equal(idle.pending,1,'normal polling never starts a second drain loop');
  idle.run(0,false);assert.equal(store.getSnapshot(),s,'insufficient idle time yields without progressing');assert.equal(idle.pending,1);
  let turns=0;while(idle.pending){const before=store.getSnapshot();idle.run(0,true);s=store.getSnapshot();assert.ok(s.clock.simulatedElapsedMilliseconds-before.clock.simulatedElapsedMilliseconds<=PACE);assert.equal(s.clock.lastObservedAt,START+7*PACE+1234);assert.equal(s.life.absoluteMinute,Math.floor(540+s.clock.simulatedElapsedMilliseconds/PACE));assert.ok(++turns<10);}
  assert.equal(s.clock.simulatedElapsedMilliseconds,7*PACE+1234);assert.equal(s.clock.pendingMilliseconds,0);assert.equal(s.clock.createdAt,START);assert.equal(idle.maximumPending,1);assert.equal(s.navigation.absoluteMinute,547+1234/PACE);store.dispose();
});
test('disposing or a stale-writer conflict cancels queued catch-up and stale callbacks remain inert',()=>{
  const f=fixture(),idle=new IdleQueue(),one=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at,catchupScheduler:idle});f.setClock(START+3*PACE);one.advance();const callback=idle.jobs[0].callback;
  one.dispose();assert.equal(idle.pending,0);const disposed=one.getSnapshot();callback({didTimeout:true,timeRemaining:()=>8});assert.equal(one.getSnapshot(),disposed);
  const g=fixture(),q1=new IdleQueue(),q2=new IdleQueue(),a=createVillagePopulationStore({entryIdentity:ENTRY,storage:g.storage,at:g.at,catchupScheduler:q1}),b=createVillagePopulationStore({entryIdentity:ENTRY,storage:g.storage,at:g.at,catchupScheduler:q2});
  g.setClock(START+3*PACE);a.advance();b.advance();const staleCallback=q2.jobs[0].callback;assert.equal(q2.pending,1);assert.equal(a.flush(),true);assert.equal(b.flush(),false);assert.equal(b.persistence,'conflict');assert.equal(q2.pending,0);
  const held=b.getSnapshot(),raw=g.storage.values.get(KEY);staleCallback({didTimeout:true,timeRemaining:()=>8});assert.equal(b.getSnapshot(),held);assert.equal(g.storage.values.get(KEY),raw);a.dispose();b.dispose();
});
test('scheduler failure holds a valid save and normal polling can resume the same debt',()=>{
  const f=fixture(),raw=JSON.parse(encoded().json);raw.clock.lastObservedAt=START+4*PACE;raw.clock.pendingMilliseconds=4*PACE;f.storage.values.set(KEY,JSON.stringify(raw));f.setClock(START+4*PACE);
  const idle=new IdleQueue();let reject=true;
  const scheduler:VillagePopulationCatchupScheduler={schedule(callback){if(reject)throw Error('Idle scheduling unavailable');return idle.schedule(callback);}};
  const store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at,catchupScheduler:scheduler});assert.equal(store.persistence,'ready');assert.match(store.error??'',/catch-up paused.*unavailable/);assert.equal(store.getSnapshot().clock.pendingMilliseconds,4*PACE);assert.equal(f.storage.writes.length,0);
  reject=false;store.advance();assert.equal(store.error,null);assert.equal(idle.pending,1);while(idle.pending)idle.run();assert.equal(store.getSnapshot().clock.simulatedElapsedMilliseconds,4*PACE);assert.equal(store.getSnapshot().clock.createdAt,START);store.dispose();
});

/** A Storage-shaped port with a browser-like quota counted in UTF-16 units. */
class QuotaMemory implements VillagePopulationStorage{
  values=new Map<string,string>();constructor(readonly quota=5_000_000){}
  get used(){let n=0;for(const [k,v]of this.values)n+=k.length+v.length;return n;}
  get length(){return this.values.size;}
  key(index:number){return [...this.values.keys()][index]??null;}
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){const old=this.values.get(key);const next=this.used-(old===undefined?0:key.length+old.length)+key.length+value.length;if(next>this.quota)throw Error('QuotaExceededError');this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
}
const worldKey=(n:number)=>VILLAGE_POPULATION_STORAGE_PREFIX+encodeURIComponent(`world-${n}`);
test('saves name the authored roster instead of copying it, and reopen to the same population',()=>{
  const f=fixture(),store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});const raw=f.storage.values.get(KEY)!;
  assert.deepEqual(JSON.parse(raw).population,{reference:REV});assert.ok(raw.length<300_000,`compact save is ${raw.length} characters`);
  assert.ok(raw.length*3<encoded().json.length,'the compact save is a fraction of the inline one');
  f.setClock(START+90*PACE);let s=store.advance();while(s.clock.pendingMilliseconds)s=store.advance();store.flush();store.dispose();
  const reopened=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.deepEqual(reopened.getSnapshot(),s);assert.equal(reopened.getSnapshot().population.residents.length,100);reopened.dispose();
  // The plain runtime parser refuses a reference it is not given rather than inventing a roster.
  assert.equal(parseVillagePopulationRuntime(f.storage.values.get(KEY)!,{worldKey:ENTRY,contentRevision:REV}).ok,false);
  const foreign=JSON.parse(f.storage.values.get(KEY)!);foreign.population={reference:'another-roster'};const g=fixture();g.storage.values.set(KEY,JSON.stringify(foreign));
  assert.throws(()=>createVillagePopulationStore({entryIdentity:ENTRY,storage:g.storage,at:g.at}),/authored roster/);assert.equal(g.storage.writes.length,0);
});
test('an existing inline save is held on open and rewritten compactly by the next flush with the same epoch and facts',()=>{
  const f=fixture(),authored=encoded();f.storage.values.set(KEY,authored.json);
  const store=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.equal(f.storage.writes.length,0);assert.equal(f.storage.values.get(KEY),authored.json);
  assert.deepEqual(store.getSnapshot(),authored.snapshot);assert.equal(store.flush(),true);
  const raw=f.storage.values.get(KEY)!;assert.deepEqual(JSON.parse(raw).population,{reference:REV});assert.ok(raw.length<300_000);store.dispose();
  const reopened=createVillagePopulationStore({entryIdentity:ENTRY,storage:f.storage,at:f.at});assert.deepEqual(reopened.getSnapshot(),authored.snapshot);assert.deepEqual(reopened.getSnapshot().rosterFacts,authored.snapshot.rosterFacts);reopened.dispose();
});
test('opening a world prunes superseded worlds before writing and keeps the most recent other world',()=>{
  const storage=new QuotaMemory(Infinity);storage.values.set('crownfall.legacy','original bytes');storage.values.set('crownfall.ealdholt.observer.v1:x','observer bytes');
  for(let n=1;n<=4;n++){const raw=JSON.parse(encoded(`world-${n}`).json);raw.clock.lastObservedAt=START+n;storage.values.set(worldKey(n),JSON.stringify(raw));}
  storage.values.set(VILLAGE_POPULATION_STORAGE_PREFIX+'corrupt','{bad');
  const store=createVillagePopulationStore({entryIdentity:'world-9',storage,at:()=>START+10});
  assert.deepEqual([...store.pruned].sort(),[worldKey(1),worldKey(2),worldKey(3),VILLAGE_POPULATION_STORAGE_PREFIX+'corrupt'].sort());
  assert.ok(storage.values.has(worldKey(4)),'the most recently observed other world is kept');assert.ok(storage.values.has(worldKey(9)));
  assert.equal(storage.values.get('crownfall.legacy'),'original bytes');assert.equal(storage.values.get('crownfall.ealdholt.observer.v1:x'),'observer bytes');store.dispose();
  assert.deepEqual(pruneVillagePopulationSaves(storage,worldKey(9)),[],'nothing more to remove');
  assert.deepEqual(pruneVillagePopulationSaves({getItem:()=>null,setItem:()=>{}},worldKey(9)),[],'a port without enumeration removes nothing');
});
test('six worlds in turn under a 5 M quota already filled by old saves stay saved and leave room for other saves',()=>{
  const storage=new QuotaMemory(),inline=encoded('world-0').json;
  assert.ok(6*inline.length>storage.quota,'six old inline saves would not fit the quota');
  storage.values.set('crownfall.legacy','x'.repeat(600_000));
  for(let n=0;n<4;n++)storage.values.set(worldKey(n),encoded(`world-${n}`).json);
  assert.ok(storage.quota-storage.used<inline.length,'the quota is already nearly full');
  for(let n=10;n<16;n++){
    const store=createVillagePopulationStore({entryIdentity:`world-${n}`,storage,at:()=>START+n});
    assert.equal(store.persistence,'ready',store.error??'');assert.ok(storage.values.has(worldKey(n)));store.dispose();
    assert.ok([...storage.values.keys()].filter(k=>k.startsWith(VILLAGE_POPULATION_STORAGE_PREFIX)).length<=1+1);
  }
  assert.equal(storage.values.get('crownfall.legacy'),'x'.repeat(600_000),'other saves are untouched');
  assert.ok(storage.quota-storage.used>3_000_000,`room left for other saves: ${storage.quota-storage.used}`);
  storage.setItem('crownfall.legacy.other','y'.repeat(1_000_000));
});
