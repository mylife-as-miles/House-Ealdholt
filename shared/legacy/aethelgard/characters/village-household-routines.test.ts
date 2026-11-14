import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EALDHOLT_VILLAGE_POPULATION as POPULATION } from './village-population';
import { advanceVillageLife, createVillageLife, getVillageLifeResident, parseVillageLife } from './village-life';
import { createEaldholtVillageSite, resolveVillageSiteEndpoint, resolveVillageSitePath } from './village-site';

const KEY='test-existing-household-hearth-routine',ELDER='ealdholt-smithy-elder',SPINNER='ealdholt-smithy-spinner',CHILD='ealdholt-smithy-child';
const clear=()=>({weather:'clear' as const,daylight:1});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const resident=(state:ReturnType<typeof createVillageLife>,id:string)=>getVillageLifeResident(state,id)!;

test('the authored passive hearth slot remains indoors at its existing home and creates no work resource',()=>{
  const content=POPULATION.residents.find(r=>r.id===ELDER)!,slot=content.registry.routine.find(r=>r.activity==='Warms by the hearth.')!;
  assert.ok(slot);assert.equal(slot.placeId,content.homePlaceId);assert.equal(slot.startMinute,330);assert.equal(slot.endMinute,360);
  const state=advanceVillageLife(createVillageLife(POPULATION,329,KEY),POPULATION,330,{conditionsAt:clear});
  const elder=resident(state,ELDER);
  assert.equal(elder.intent.activity,slot.activity);assert.equal(elder.intent.activityKey,'rest');assert.equal(elder.intent.indoor,true);
  assert.equal(elder.intent.targetPlaceId,content.homePlaceId);assert.equal(elder.simulatedPlaceId,content.homePlaceId);
  assert.equal(elder.intent.reason,'routine');assert.equal(elder.counters.dutyMinutes,0);
  assert.equal(state.reservations.some(r=>r.residentId===ELDER),false);
  const child=resident(state,CHILD);
  assert.equal(child.intent.activity,'Wakes and dresses.');assert.equal(child.intent.activityKey,'home');
  assert.equal(child.intent.indoor,true);assert.equal(child.intent.targetPlaceId,child.homePlaceId);
  assert.equal(state.reservations.some(r=>r.residentId===CHILD),false);
});

test('real wool preparation keeps its household lease while passive warmth gains no duty credit',()=>{
  const initial=createVillageLife(POPULATION,329,KEY),state=advanceVillageLife(initial,POPULATION,359,{conditionsAt:clear});
  const spinner=resident(state,SPINNER),elder=resident(state,ELDER);
  assert.equal(spinner.intent.activity,'Sets wool to soak before breakfast.');assert.equal(spinner.intent.activityKey,'work');
  assert.equal(spinner.status,'active');assert.equal(spinner.counters.dutyMinutes,30);assert.equal(spinner.counters.completedDuties,1);
  assert.equal(elder.status,'active');assert.equal(elder.counters.dutyMinutes,0);assert.equal(elder.counters.completedDuties,0);
  assert.equal(resident(state,CHILD).counters.dutyMinutes,0);assert.equal(resident(state,CHILD).intent.activityKey,'home');
  assert.deepEqual(state.reservations.filter(r=>r.resourceId==='work:smithy-house'),[{
    resourceId:'work:smithy-house',residentId:SPINNER,placeId:'smithy-house',activityKey:'work',sinceMinute:330,scope:'simulation-only',
  }]);
  assert.ok(!state.journal.some(event=>event.kind==='duty-completed'&&event.actorIds.includes(ELDER)));
  assert.equal(initial.absoluteMinute,329);assert.equal(resident(initial,ELDER).counters.dutyMinutes,0);
});

test('a restored legacy warmth lease changes only at the next ordinary decision, keeping prior counters/history',()=>{
  const legacy=copy(advanceVillageLife(createVillageLife(POPULATION,329,KEY),POPULATION,335,{conditionsAt:clear})) as any;
  const elder=legacy.residents.find((r:any)=>r.residentId===ELDER),spinner=legacy.residents.find((r:any)=>r.residentId===SPINNER);
  const child=legacy.residents.find((r:any)=>r.residentId===CHILD);
  elder.intent.activityKey='work';elder.counters.dutyMinutes=6;elder.intentProgressMinutes=6;
  child.intent.activityKey='work';child.status='queued';child.intentProgressMinutes=0;
  spinner.status='queued';spinner.counters.dutyMinutes=0;spinner.counters.completedDuties=0;spinner.intentProgressMinutes=0;
  legacy.reservations=legacy.reservations.map((r:any)=>r.resourceId==='work:smithy-house'?{...r,residentId:ELDER}:r);
  const bytes=JSON.stringify(legacy),restored=parseVillageLife(legacy,POPULATION,{worldKey:KEY,absoluteMinute:335});
  assert.equal(resident(restored,ELDER).intent.activityKey,'work');assert.equal(advanceVillageLife(restored,POPULATION,335),restored);
  const next=advanceVillageLife(restored,POPULATION,336,{conditionsAt:clear});
  assert.equal(resident(next,ELDER).intent.activityKey,'rest');assert.equal(resident(next,ELDER).intent.issuedAbsoluteMinute,336);
  assert.equal(resident(next,ELDER).intent.indoor,true);assert.equal(resident(next,ELDER).counters.dutyMinutes,6,'retain recorded history');
  assert.equal(resident(next,CHILD).intent.activityKey,'home');assert.equal(resident(next,CHILD).intent.indoor,true);
  assert.equal(next.reservations.find(r=>r.resourceId==='work:smithy-house')?.residentId,SPINNER);
  for(const reservation of restored.reservations.filter(r=>r.residentId!==ELDER))assert.deepEqual(next.reservations.find(r=>r.resourceId===reservation.resourceId),reservation);
  assert.deepEqual(next.journal.slice(0,restored.journal.length),restored.journal);assert.equal(next.worldKey,restored.worldKey);
  assert.deepEqual(next.residents.map(r=>[r.residentId,r.homePlaceId,r.workPlaceId,r.relationships.map(t=>t.residentId)]),restored.residents.map(r=>[r.residentId,r.homePlaceId,r.workPlaceId,r.relationships.map(t=>t.residentId)]));
  assert.equal(JSON.stringify(legacy),bytes);assert.equal(resident(restored,ELDER).intent.activityKey,'work');
});

test('normal meals and shared household history still follow warmth and preserve save/offscreen determinism',()=>{
  const initial=createVillageLife(POPULATION,329,KEY),whole=advanceVillageLife(initial,POPULATION,370,{conditionsAt:clear,simulationLevel:'far'});
  let sliced=advanceVillageLife(initial,POPULATION,335,{conditionsAt:clear,simulationLevel:'deep'});
  sliced=parseVillageLife(copy(sliced),POPULATION,{worldKey:KEY,absoluteMinute:335});
  for(const minute of [344,359,360,370])sliced=advanceVillageLife(sliced,POPULATION,minute,{conditionsAt:clear,simulationLevel:'scheduled'});
  assert.deepEqual(sliced,whole);
  for(const id of [ELDER,SPINNER]){assert.equal(resident(whole,id).intent.activityKey,'meal');assert.equal(resident(whole,id).counters.mealCount,1);}
  assert.ok(whole.journal.some(event=>event.kind==='shared-meal'&&event.actorIds.includes(ELDER)&&event.actorIds.includes(SPINNER)));
});

test('explicit home closures retain their hold and do not grant warmth or work through an unavailable household',()=>{
  const initial=createVillageLife(POPULATION,329,KEY),state=advanceVillageLife(initial,POPULATION,335,{conditionsAt:()=>({...clear(),unavailablePlaceIds:['smithy-house']})});
  for(const id of [ELDER,SPINNER]){assert.equal(resident(state,id).status,'unavailable');assert.equal(resident(state,id).counters.dutyMinutes,0);}
  assert.equal(state.reservations.some(r=>r.placeId==='smithy-house'),false);
});

const PAIR='/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11/paired-patrol-allocation.json';
test('both actual reviewed source profiles retain the same person-bound home; passive rest grants no new place or route',{
  skip:!existsSync(PAIR)&&'Requires the private reviewed paired-v4 site artifacts; no stand-in geometry substitutes.',
},()=>{
  const manifestBytes=readFileSync(PAIR),manifest=JSON.parse(manifestBytes.toString()),sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
  assert.equal(sha(manifestBytes),'0f2f6a6d8227011cf8af6167d916fdf7cdcdd44113faf65d78d360cc050446ee');
  for(const profile of ['desktop','quest'] as const){
    const file=manifest.outputs.find((r:any)=>r.profile===profile).file,bytes=readFileSync(file),before=sha(bytes),raw=JSON.parse(bytes.toString());
    const site=createEaldholtVillageSite({profile,modelSha256:raw.binding.sourceSha256,binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
    const state=advanceVillageLife(createVillageLife(POPULATION,329,KEY),POPULATION,330,{conditionsAt:clear});
    for(const id of [ELDER,SPINNER,CHILD]){
      const r=resident(state,id),home=resolveVillageSiteEndpoint(site,r.homePlaceId,id);
      assert.ok(home);assert.equal(resolveVillageSiteEndpoint(site,r.intent.targetPlaceId,id),home);
      assert.equal(resolveVillageSitePath(site,r.homePlaceId,r.intent.targetPlaceId,id)?.lengthMetres,0);
      assert.equal(r.intent.indoor,true,'the exterior home certificate never grants an interior body/workstation');
    }
    assert.equal(sha(readFileSync(file)),before);
  }
  assert.deepEqual(readFileSync(PAIR),manifestBytes);
});
