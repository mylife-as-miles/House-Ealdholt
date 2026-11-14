import assert from 'node:assert/strict';
import test from 'node:test';
import { EALDHOLT_VILLAGE_POPULATION as POPULATION } from './village-population';
import { createVillageLife, advanceVillageLife, parseVillageLife, validateVillageLife, getVillageLifeResident,
  summarizeVillageLife, validateVillageLifeSafetySignal, VILLAGE_LIFE_MAX_EVENTS, type VillageLifeConditions } from './village-life';
import type { ResidentSafetySignal } from './resident-safety';

const key='test-ealdholt-life-world';
const clear=():VillageLifeConditions=>({weather:'clear',daylight:1});
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function homeActivityPopulation(activity:string){
  const p=copy(POPULATION) as any;
  for(const person of p.residents){
    person.registry.routine=[{startMinute:0,endMinute:1440,activity:person===p.residents[0]?activity:'Rests indoors.',placeId:person.homePlaceId,companionIds:[]}];
    p.registry.residents.find((r:any)=>r.id===person.id).routine=copy(person.registry.routine);
  }
  return p;
}

test('home indoor wording is not a doorway substring and explicit exterior words remain exterior',()=>{
  for(const [activity,indoor] of [
    ['Rests indoors.',true],['Rests indoor.',true],['Rests indoors beside the garden door.',true],
    ['Rests at the door.',false],['Rests at the doorstep.',false],['Rests in the doorway.',false],
    ['Rests in the yard.',false],['Rests in the garden.',false],['Rests outdoors.',false],['Rests outside.',false],
    ['Rests by the fire.',true],
  ] as const){
    const p=homeActivityPopulation(activity);
    const life=createVillageLife(p,600,key);
    assert.equal(life.residents[0].intent.indoor,indoor,activity);
  }
});

test('a restored legacy exterior rest corrects at its next normal decision without reset or invented history',()=>{
  const p=homeActivityPopulation('Rests indoors.');
  const legacy=copy(createVillageLife(p,600,key)) as any;
  legacy.residents[0].intent.indoor=false;
  const restored=parseVillageLife(legacy,p,{worldKey:key,absoluteMinute:600});
  assert.equal(advanceVillageLife(restored,p,600),restored,'load and same-minute observation do not rewrite an intent');
  const next=advanceVillageLife(restored,p,601,{conditionsAt:clear});
  assert.equal(next.residents[0].intent.indoor,true);
  assert.equal(next.residents[0].intent.issuedAbsoluteMinute,601,'ordinary reevaluation issues the corrected intent');
  assert.equal(next.worldKey,restored.worldKey);assert.deepEqual(next.residents.map(r=>r.residentId),restored.residents.map(r=>r.residentId));
  assert.equal(next.residents[0].counters.completedDuties,restored.residents[0].counters.completedDuties);
  assert.deepEqual(next.journal,restored.journal);assert.equal(next.nextEventSequence,restored.nextEventSequence);
  assert.equal(restored.residents[0].intent.indoor,false,'the saved input remains unchanged');
  assert.deepEqual(advanceVillageLife(parseVillageLife(copy(restored),p),p,601,{conditionsAt:clear}),next);
});

test('the unchanged authored roster classifies every home Rests indoors slot as an abstract interior',()=>{
  let checked=0;
  for(const person of POPULATION.residents)for(const slot of person.registry.routine){
    if(slot.activity!=='Rests indoors.'||slot.placeId!==person.homePlaceId)continue;
    const life=createVillageLife(POPULATION,slot.startMinute,key),intent=life.residents.find(r=>r.residentId===person.id)!.intent;
    assert.equal(intent.activity,'Rests indoors.');assert.equal(intent.indoor,true,person.id);checked++;
  }
  assert.ok(checked>0,'exercise real authored residents rather than only wording fixtures');
});

test('all100 retain their authored home, role workplace, household and relationship identities without fabricated history',()=>{
  const initial=createVillageLife(POPULATION,540,key);
  assert.equal(initial.residents.length,100);assert.equal(initial.households.length,25);assert.deepEqual(initial.journal,[]);
  assert.equal(initial.nextEventSequence,0);assert.equal(initial.absoluteMinute,540);
  for(const resident of initial.residents){
    const content=POPULATION.residents.find(r=>r.id===resident.residentId)!;
    assert.equal(resident.homePlaceId,content.homePlaceId);assert.equal(resident.workPlaceId,content.workPlaceId);
    assert.equal(resident.counters.completedDuties,0);assert.equal(resident.counters.mealCount,0);
    assert.equal(resident.safety.residentId,resident.residentId);
    assert.ok(Object.isFrozen(resident));assert.ok(Object.isFrozen(resident.needs));
  }
  assert.equal(validateVillageLife(initial,POPULATION,{worldKey:key,absoluteMinute:540}),null);
  assert.equal(getVillageLifeResident(initial,'nonexistent'),null);
});

test('recurring lives complete work, meals, household gatherings and sleep across repeated full days',()=>{
  const initial=createVillageLife(POPULATION,0,key),state=advanceVillageLife(initial,POPULATION,2880,{conditionsAt:clear});
  assert.equal(state.absoluteMinute,2880);assert.equal(state.residents.length,100);
  for(const resident of state.residents){
    assert.ok(resident.counters.sleepMinutes>0,`${resident.residentId} sleeps`);
    assert.ok(resident.counters.mealCount>=4,`${resident.residentId} eats repeatedly`);
    assert.ok(Object.values(resident.needs).every(n=>n>=0&&n<=1000));
  }
  const totals=summarizeVillageLife(state);
  assert.ok(totals.completedDuties>100);assert.ok(totals.sharedMeals>=50);
  assert.ok(state.households.every(h=>h.sharedMeals>0));
  const visitors=state.residents.filter(r=>r.counters.visits>0);
  assert.ok(visitors.length>0);assert.ok(visitors.every(r=>r.counters.visits>=2),'older-kin visits recur on later days');
  const smith=state.residents.find(r=>r.residentId==='ealdholt-village-smith')!;
  assert.ok(smith.counters.completedDuties>0);assert.ok(smith.relationships.some(r=>r.sharedMeals>0));
  assert.equal(initial.absoluteMinute,0);assert.ok(initial.residents.every(r=>r.counters.mealCount===0));
  assert.ok(state.journal.length<=VILLAGE_LIFE_MAX_EVENTS);
  assert.ok(state.journal.every(e=>e.provenance==='simulated-routine'));
  assert.equal(validateVillageLife(copy(state),POPULATION,{worldKey:key,absoluteMinute:2880}),null);
});

test('bulk, sliced and restored offline catchup have identical decisions, leases, needs and event histories',()=>{
  const initial=createVillageLife(POPULATION,330,key);
  const conditionsAt=(minute:number):VillageLifeConditions=>({weather:minute>=420&&minute<470?'rain':'clear',daylight:minute%1440>=360&&minute%1440<1200?1:0});
  const bulk=advanceVillageLife(initial,POPULATION,1770,{conditionsAt,simulationLevel:'far'});
  let sliced=initial;
  for(const end of [350,420,421,450,470,600,900,1200,1440,1770])sliced=advanceVillageLife(sliced,POPULATION,end,{conditionsAt,simulationLevel:'deep'});
  assert.deepEqual(sliced,bulk);
  const saved=parseVillageLife(copy(advanceVillageLife(initial,POPULATION,900,{conditionsAt})),POPULATION,{worldKey:key,absoluteMinute:900});
  assert.deepEqual(advanceVillageLife(saved,POPULATION,1770,{conditionsAt,simulationLevel:'scheduled'}),bulk);
});

test('rain interrupts an outdoor duty, holds its progress, and resumes it without resetting the resident',()=>{
  const initial=createVillageLife(POPULATION,600,key);
  const worker=initial.residents.find(r=>r.intent.activityKey==='work'&&!r.intent.indoor)!;assert.ok(worker);
  const worked=advanceVillageLife(initial,POPULATION,605,{conditionsAt:clear});
  const rainy=advanceVillageLife(worked,POPULATION,610,{conditionsAt:()=>({weather:'rain',daylight:1})});
  const sheltered=getVillageLifeResident(rainy,worker.residentId)!;
  assert.equal(sheltered.intent.activityKey,'shelter');assert.equal(sheltered.intent.targetPlaceId,sheltered.homePlaceId);
  assert.ok(sheltered.counters.shelterMinutes>0);assert.equal(sheltered.suspendedIntent?.targetPlaceId,worker.intent.targetPlaceId);
  const resumed=advanceVillageLife(rainy,POPULATION,615,{conditionsAt:clear});
  const restored=getVillageLifeResident(resumed,worker.residentId)!;
  assert.equal(restored.intent.activityKey,'work');assert.equal(restored.suspendedIntent,null);
  assert.ok(restored.counters.dutyMinutes>=getVillageLifeResident(worked,worker.residentId)!.counters.dutyMinutes);
  assert.ok(resumed.journal.some(e=>e.kind==='weather-interrupted'&&e.actorIds.includes(worker.residentId)));
  assert.ok(resumed.journal.some(e=>e.kind==='duty-resumed'&&e.actorIds.includes(worker.residentId)));
});

test('weather blocking the next routine suspends that new duty rather than the finished home slot',()=>{
  const initial=createVillageLife(POPULATION,329,key),id='ealdholt-village-smith';
  assert.equal(getVillageLifeResident(initial,id)!.intent.activityKey,'sleep');
  const blocked=advanceVillageLife(initial,POPULATION,330,{conditionsAt:()=>({weather:'rain',daylight:1})});
  const smith=getVillageLifeResident(blocked,id)!;
  assert.equal(smith.intent.activityKey,'shelter');assert.equal(smith.suspendedIntent?.targetPlaceId,'smithy-forge');
  assert.equal(smith.suspendedIntent?.activity,'Lights the forge before breakfast.');assert.equal(smith.suspendedProgressMinutes,0);
  const resumed=advanceVillageLife(blocked,POPULATION,331,{conditionsAt:clear});
  assert.equal(getVillageLifeResident(resumed,id)!.intent.targetPlaceId,'smithy-forge');
  assert.equal(getVillageLifeResident(resumed,id)!.suspendedIntent,null);
});

test('only explicitly informed residents interrupt for danger and protect kin, then resume across save and catchup',()=>{
  const smith=POPULATION.residents.find(r=>r.id==='ealdholt-village-smith')!,elder=POPULATION.residents.find(r=>r.id==='ealdholt-smithy-elder')!;
  const report:ResidentSafetySignal={id:'reported-forge-incident',kind:'fire',channel:'report',knownByResidentIds:[smith.id],
    placeId:smith.workPlaceId,observedAbsoluteMinute:601,expiresAbsoluteMinute:606,affectedResidentIds:[elder.id],shelterPlaceId:smith.homePlaceId};
  assert.equal(validateVillageLifeSafetySignal(report,POPULATION,601),null);
  const safetySignalsAt=(minute:number)=>minute>=601&&minute<606?[report]:[];
  const initial=createVillageLife(POPULATION,600,key),interrupted=advanceVillageLife(initial,POPULATION,603,{conditionsAt:clear,safetySignalsAt});
  const informed=getVillageLifeResident(interrupted,smith.id)!;
  assert.equal(informed.intent.reason,'safety');assert.equal(informed.intent.activityKey,'protect');assert.ok(informed.counters.protectMinutes>0);
  assert.deepEqual(informed.safety.knownSignals.map(s=>s.id),[report.id]);
  assert.ok(interrupted.residents.filter(r=>r.residentId!==smith.id).every(r=>!r.safety.knownSignals.length&&r.intent.reason!=='safety'));
  assert.ok(interrupted.journal.some(e=>e.kind==='safety-interrupted'&&e.actorIds.includes(smith.id)));
  const restored=parseVillageLife(copy(interrupted),POPULATION,{worldKey:key,absoluteMinute:603});
  const resumed=advanceVillageLife(restored,POPULATION,609,{conditionsAt:clear,safetySignalsAt});
  assert.notEqual(getVillageLifeResident(resumed,smith.id)!.intent.reason,'safety');
  assert.ok(resumed.journal.some(e=>e.kind==='duty-resumed'&&e.actorIds.includes(smith.id)));
  assert.deepEqual(resumed,advanceVillageLife(initial,POPULATION,609,{conditionsAt:clear,safetySignalsAt}));
});

test('report boundaries reject unbound places, invented people, future knowledge and expired facts',()=>{
  const resident=POPULATION.residents[0],report:ResidentSafetySignal={id:'bounded-report',kind:'hazard',channel:'witness',knownByResidentIds:[resident.id],
    placeId:resident.workPlaceId,observedAbsoluteMinute:601,expiresAbsoluteMinute:606,affectedResidentIds:[resident.id]};
  for(const invalid of [{...report,placeId:'unbound-temple'},{...report,shelterPlaceId:'invented-shelter'},
    {...report,knownByResidentIds:['invisible-player']},{...report,affectedResidentIds:['invented-person']},{...report,knownByResidentIds:[]}]){
    assert.ok(validateVillageLifeSafetySignal(invalid,POPULATION,601));
  }
  assert.ok(validateVillageLifeSafetySignal(report,POPULATION,600));assert.ok(validateVillageLifeSafetySignal(report,POPULATION,606));
  assert.throws(()=>advanceVillageLife(createVillageLife(POPULATION,600,key),POPULATION,601,{safetySignalsAt:()=>[{...report,placeId:'unbound-temple'}]}),/authored village places/);
});

test('full-village reports keep bounded personal knowledge and a complete population save below two MiB',()=>{
  const all=POPULATION.residents.map(r=>r.id),place=POPULATION.residents.find(r=>r.id==='ealdholt-village-smith')!.workPlaceId;
  const reports:ResidentSafetySignal[]=Array.from({length:16},(_,i)=>({id:`village-wide-incident-${i}`,kind:'hazard',channel:'alarm',
    knownByResidentIds:all,affectedResidentIds:all,placeId:place,observedAbsoluteMinute:601,expiresAbsoluteMinute:700}));
  const life=advanceVillageLife(createVillageLife(POPULATION,600,key),POPULATION,601,{safetySignalsAt:()=>reports});
  assert.ok(life.residents.every(r=>r.safety.knownSignals.length===16));
  assert.ok(life.residents.every(r=>r.safety.knownSignals.every(s=>s.knownByResidentIds.length===1&&s.knownByResidentIds[0]===r.residentId)));
  assert.ok(new TextEncoder().encode(JSON.stringify({population:POPULATION,life,reports})).byteLength<2*1024*1024);
  assert.equal(validateVillageLife(copy(life),POPULATION,{worldKey:key,absoluteMinute:601}),null);
});

test('authored family relationships change decisions and sustained care updates both perspectives',()=>{
  const initial=createVillageLife(POPULATION,650,key),elder=POPULATION.residents.find(r=>r.id==='ealdholt-smithy-elder')!;
  const state=advanceVillageLife(initial,POPULATION,670,{conditionsAt:()=>({weather:'clear',daylight:1,careNeededResidentIds:[elder.id]})});
  const carers=state.residents.filter(r=>r.counters.careMinutes>0&&r.relationships.some(t=>t.residentId===elder.id));
  assert.ok(carers.length>0);assert.ok(state.journal.some(e=>e.kind==='care'&&e.actorIds.includes(elder.id)));
  for(const carer of carers){
    assert.ok(carer.intent.reason==='family-care'||carer.counters.careMinutes>0);
    const relation=carer.relationships.find(t=>t.residentId===elder.id)!;
    const back=getVillageLifeResident(state,elder.id)!.relationships.find(t=>t.residentId===carer.residentId)!;
    assert.equal(relation.careMinutes,back.careMinutes);assert.ok(relation.careMinutes>0);
  }
});

test('shared simulated resources never have two holders and waiting residents cannot count queued work',()=>{
  const initial=createVillageLife(POPULATION,600,key),state=advanceVillageLife(initial,POPULATION,601,{conditionsAt:clear});
  assert.equal(new Set(state.reservations.map(r=>r.resourceId)).size,state.reservations.length);
  assert.equal(new Set(state.reservations.map(r=>r.residentId)).size,state.reservations.length);
  const queued=state.residents.filter(r=>r.status==='queued');assert.ok(queued.length>0);
  assert.ok(queued.every(r=>r.counters.dutyMinutes===0&&r.intentProgressMinutes===0));
  assert.ok(state.reservations.every(r=>r.scope==='simulation-only'));
});

test('explicit unavailable places suspend activity completion without erasing identities or inventing navigation',()=>{
  const initial=createVillageLife(POPULATION,600,key),closed=initial.residents.find(r=>r.intent.activityKey==='work')!.intent.targetPlaceId;
  const state=advanceVillageLife(initial,POPULATION,610,{conditionsAt:()=>({weather:'clear',daylight:1,unavailablePlaceIds:[closed]})});
  const affected=state.residents.filter(r=>r.intent.targetPlaceId===closed);assert.ok(affected.length>0);
  assert.ok(affected.every(r=>r.status==='unavailable'&&r.counters.dutyMinutes===0));
  assert.equal(state.residents.length,100);assert.equal(state.journal.some(e=>/arrival|death|raid|chess/.test(e.kind)),false);
});

test('strict restores reject incompatible worlds, corrupt counters, duplicate identities and getters without invoking them',()=>{
  const initial=createVillageLife(POPULATION,600,key),saved=copy(initial);
  assert.throws(()=>parseVillageLife(saved,POPULATION,{worldKey:'different'}),/identity/);
  assert.throws(()=>parseVillageLife(saved,POPULATION,{absoluteMinute:601}),/clock/);
  for(const alter of [
    (s:any)=>{s.schemaVersion=2;},(s:any)=>{s.residents[1].residentId=s.residents[0].residentId;},
    (s:any)=>{s.residents[0].needs.hunger=NaN;},(s:any)=>{s.residents[0].counters.completedDuties=99;},
    (s:any)=>{s.residents[0].intent.issuedAbsoluteMinute=601;},(s:any)=>{s.residents[0].playerAware=true;},
  ]){const bad=copy(saved);alter(bad);assert.notEqual(validateVillageLife(bad,POPULATION),null);}
  let reads=0;const accessor=copy(saved);Object.defineProperty(accessor.residents[0].needs,'hunger',{enumerable:true,get(){reads++;return 100;}});
  assert.notEqual(validateVillageLife(accessor,POPULATION),null);assert.equal(reads,0);
  assert.throws(()=>advanceVillageLife(initial,POPULATION,599),/monotonic/);
  assert.throws(()=>advanceVillageLife(initial,POPULATION,600+10081),/week/);
  assert.equal(advanceVillageLife(initial,POPULATION,600),initial);
  assert.ok(new TextEncoder().encode(JSON.stringify({population:POPULATION,life:initial})).byteLength<2*1024*1024);
});
