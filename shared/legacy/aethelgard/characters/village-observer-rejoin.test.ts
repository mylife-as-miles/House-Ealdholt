/** CPU-only history/current-boundary regressions. Private source fixtures are
 * read unchanged; no test writes a saved village or supplies renderer proof. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {createEaldholtVillageSite,applyVillageSiteRigidClearance,validateVillageSiteRigidClearance,type VillageSiteLayout} from './village-site';
import type {ResidentSafetySignal} from './resident-safety';
import {createVillagePopulationObservationPump,type VillagePopulationObservationScheduler} from './village-population-observation-pump';
import {advanceVillagePopulationRuntime,createVillagePopulationObserver,createVillagePopulationRuntime,
  getVillagePopulationObservationStatus,parseVillagePopulationRuntime,reportVillagePopulationSafetySignals,
  sampleVillagePopulationRuntime,serializeVillagePopulationRuntime,type VillagePopulationObservationOptions,
  type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';

const CREATED=1800000000000,PACE=4000;
function accept(result:VillagePopulationRuntimeResult):VillagePopulationRuntime{assert.ok(result.ok,result.ok?'':result.error);return result.snapshot;}
function create(worldKey='observer-rejoin-fixture'){
  return accept(createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'observer-rejoin-test',createdAt:CREATED,
    initialDayMinute:540,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:.8,
    rosterFacts:population.residents.map(resident=>({residentId:resident.id,facts:[{id:'canonical-fact',value:true}]}))}));
}
function advance(snapshot:VillagePopulationRuntime,elapsedMinutes:number,maxAdvanceMinutes=Math.max(1,elapsedMinutes),site?:VillageSiteLayout){
  return accept(advanceVillagePopulationRuntime(snapshot,{expectedGeneration:snapshot.generation,worldKey:snapshot.worldKey,contentRevision:snapshot.contentRevision,
    observedAt:CREATED+elapsedMinutes*PACE,maxAdvanceMinutes,site}));
}
function saved(snapshot:VillagePopulationRuntime){const result=serializeVillagePopulationRuntime(snapshot);assert.ok(result.ok);return result.json;}
function analytic(snapshot:VillagePopulationRuntime,site:VillageSiteLayout|null=null){
  const sample=sampleVillagePopulationRuntime(snapshot,site);
  assert.equal(sample.observation?.mode,'analytic-history-unavailable');assert.equal(sample.life,undefined);
  assert.ok(sample.residents.every(row=>row.arrivalEvidence===undefined&&row.workPoseQualified!==true));
}
function readonly(snapshot:VillagePopulationRuntime){
  assert.equal(serializeVillagePopulationRuntime(snapshot).ok,false);
  assert.equal(advanceVillagePopulationRuntime(snapshot,{expectedGeneration:snapshot.generation,worldKey:snapshot.worldKey,contentRevision:snapshot.contentRevision,
    observedAt:snapshot.clock.lastObservedAt,maxAdvanceMinutes:1}).ok,false);
  assert.equal(reportVillagePopulationSafetySignals(snapshot,{expectedGeneration:snapshot.generation,worldKey:snapshot.worldKey,contentRevision:snapshot.contentRevision,signals:[]}).ok,false);
}
function drain(observer:ReturnType<typeof createVillagePopulationObserver>,canonical:VillagePopulationRuntime,requested:number,options:VillagePopulationObservationOptions={}){
  let snapshot=observer.observe(canonical,requested,options);
  for(let n=0;getVillagePopulationObservationStatus(snapshot)!.pendingMilliseconds;n++){
    assert.ok(n<1000,'bounded slices must finish');snapshot=observer.observe(canonical,requested,options);
  }
  return snapshot;
}

test('an unavailable past rejoins the exact settled canonical boundary and advances real lives read-only',()=>{
  const canonical=advance(create(),60),before=saved(canonical),observer=createVillagePopulationObserver();
  const past=observer.observe(canonical,15*PACE);analytic(past);
  const current=observer.observe(canonical,60*PACE,{preferCanonical:true});
  assert.equal(getVillagePopulationObservationStatus(current)?.mode,'forward-projection');
  for(const field of ['life','navigation','navigationOther','rosterFacts','safetySignals','safetySignalIds','population','clock'] as const)
    assert.equal(current[field],canonical[field],`${field} comes from the complete canonical boundary`);
  assert.equal(sampleVillagePopulationRuntime(current,null).life,canonical.life);readonly(current);
  analytic(past);assert.equal(past.clock.simulatedElapsedMilliseconds,15*PACE,'the old unknown history never acquires later facts');
  const next=observer.observe(canonical,65*PACE);
  assert.equal(next.clock.simulatedElapsedMilliseconds,62*PACE);assert.equal(getVillagePopulationObservationStatus(next)?.pendingMilliseconds,3*PACE);
  const future=drain(observer,canonical,65*PACE),control=advance(canonical,65,5);
  assert.deepEqual(future.life,control.life);assert.deepEqual(future.navigation,control.navigation);readonly(future);
  assert.equal(saved(canonical),before);
});

test('pending canonical catch-up never supplies a rejoin boundary, even for a request beyond its horizon',()=>{
  const pending=advance(create(),60,5),before=saved(pending),observer=createVillagePopulationObserver();
  assert.equal(pending.clock.pendingMilliseconds,55*PACE);
  analytic(observer.observe(pending,0));
  const later=observer.observe(pending,100*PACE);analytic(later);readonly(later);
  const canonical=advance(pending,60,60),settledBefore=saved(canonical);
  analytic(observer.observe(canonical,59*PACE));
  const current=observer.observe(canonical,60*PACE);
  assert.equal(current.life,canonical.life);assert.equal(current.navigation,canonical.navigation);
  assert.equal(getVillagePopulationObservationStatus(current)?.mode,'forward-projection');
  analytic(later);assert.equal(saved(pending),before);assert.equal(saved(canonical),settledBefore);
});

test('rejoin preserves the existing fifty-millisecond clock tolerance without exposing genuine earlier history',()=>{
  const canonical=advance(create(),60),before=saved(canonical);
  for(const lag of [0,1,20,50]){
    const observer=createVillagePopulationObserver();observer.observe(canonical,15*PACE);
    const current=observer.observe(canonical,60*PACE-lag);
    assert.equal(current.life,canonical.life);assert.equal(current.navigation,canonical.navigation);
    assert.equal(getVillagePopulationObservationStatus(current)?.requestedMilliseconds,60*PACE);
    assert.equal(getVillagePopulationObservationStatus(current)?.mode,'forward-projection');
  }
  const observer=createVillagePopulationObserver();observer.observe(canonical,15*PACE);
  const past=observer.observe(canonical,60*PACE-51);analytic(past);assert.equal(past.clock.simulatedElapsedMilliseconds,60*PACE-51);
  const pending=advance(create(),60,5),pendingObserver=createVillagePopulationObserver();pendingObserver.observe(pending,0);
  analytic(pendingObserver.observe(pending,5*PACE-20));
  const nearlySettled=advance(create(),61,60),settled=advance(nearlySettled,61,1),roundedObserver=createVillagePopulationObserver();
  roundedObserver.observe(nearlySettled,15*PACE);analytic(roundedObserver.observe(nearlySettled,61*PACE-20));
  // Cursor tolerance cannot extend the canonical tolerance.
  analytic(roundedObserver.observe(settled,61*PACE-51));
  assert.equal(saved(canonical),before);
});

test('weather and explicit safety commands start after rejoining, with no command or invented history replayed into canonical facts',()=>{
  const canonical=advance(create('rejoin-commands-1'),60),before=saved(canonical),observer=createVillagePopulationObserver();
  const issued=601,person=canonical.population.residents[0],reads:number[]=[];
  const signal:ResidentSafetySignal={id:'rejoin-issued-alarm',kind:'hazard',channel:'alarm',knownByResidentIds:[person.id],
    placeId:person.homePlaceId,observedAbsoluteMinute:issued,expiresAbsoluteMinute:620,affectedResidentIds:[person.id]};
  const options:VillagePopulationObservationOptions={environmentAt:minute=>{reads.push(minute);return minute>=issued?{weather:'rain',rain:1}:undefined;},
    signalsAt:minute=>{reads.push(minute);return minute>=issued?[signal]:[];}};
  analytic(observer.observe(canonical,15*PACE,options));reads.length=0;
  const current=observer.observe(canonical,60*PACE,options);
  assert.equal(current.life,canonical.life);assert.equal(current.navigation,canonical.navigation);
  assert.ok(reads.every(minute=>minute>=600),'commands are queried at the adopted boundary, never the discarded analytic minute');
  const future=drain(observer,canonical,65*PACE,options),control=drain(createVillagePopulationObserver(),canonical,65*PACE,options);
  assert.deepEqual(future.life,control.life);assert.deepEqual(future.navigation,control.navigation);
  const events=future.life.journal.filter(event=>event.sequence>=canonical.life.nextEventSequence);
  assert.ok(events.some(event=>event.kind==='weather-interrupted'));
  assert.ok(events.every(event=>event.atMinute>=issued));
  assert.ok(future.life.residents.find(row=>row.residentId===person.id)!.safety.knownSignals.some(row=>row.id===signal.id));
  assert.ok(canonical.life.residents.every(row=>row.safety.knownSignals.length===0));assert.equal(saved(canonical),before);
});

test('a known held forecast remains its own branch when canonical time passes it',()=>{
  const initial=create(),observer=createVillagePopulationObserver(),held=drain(observer,initial,10*PACE);
  const canonical=advance(initial,60),before=saved(canonical);
  const stillHeld=observer.observe(canonical,10*PACE);
  assert.equal(stillHeld.life,held.life);assert.deepEqual(stillHeld.navigation,held.navigation);
  assert.equal(getVillagePopulationObservationStatus(stillHeld)?.mode,'forward-projection');
  const next=observer.observe(canonical,65*PACE);
  assert.equal(next.clock.simulatedElapsedMilliseconds,12*PACE,'only unavailable analytic history rejoins; a known forecast is not overwritten');
  assert.equal(saved(canonical),before);
});

function queue(){
  const tasks:{callback():void;cancelled:boolean}[]=[];
  const scheduler:VillagePopulationObservationScheduler={schedule(callback){const task={callback,cancelled:false};tasks.push(task);return{cancel(){task.cancelled=true;}};}};
  return{scheduler,tasks,next(evenCancelled=false){const task=tasks.shift();assert.ok(task);if(evenCancelled||!task.cancelled)task.callback();},
    drain(){for(let n=0;tasks.length;n++){assert.ok(n<1000);this.next();}}};
}
test('repeated backward/forward requests retain history labels, and cancellation and owner changes reject obsolete rejoin work',()=>{
  const canonical=advance(create(),60),before=saved(canonical),tasks=queue();
  let owner={},requested=15*PACE,accepts=0;
  const pump=createVillagePopulationObservationPump({read:()=>({owner,snapshot:canonical,requestedMilliseconds:requested}),allowed:()=>true,
    accepted:()=>{accepts++;},scheduler:tasks.scheduler});
  for(let repeat=0;repeat<2;repeat++){
    requested=15*PACE;pump.step();const past=pump.snapshot!;analytic(past);
    requested=65*PACE;pump.step();assert.equal(pump.snapshot!.clock.simulatedElapsedMilliseconds,62*PACE);
    const accepted=accepts;pump.pause();tasks.next(true);assert.equal(accepts,accepted,'late cancelled callbacks cannot publish');
    pump.wake();tasks.drain();assert.equal(pump.snapshot!.clock.simulatedElapsedMilliseconds,65*PACE);analytic(past);
  }
  requested=15*PACE;pump.step();requested=70*PACE;pump.step();
  owner={};requested=15*PACE;tasks.next();analytic(pump.snapshot!);
  assert.equal(pump.snapshot!.clock.simulatedElapsedMilliseconds,15*PACE,'the new visit cannot inherit the old future');
  requested=70*PACE;pump.step();const accepted=accepts;pump.clear();tasks.next(true);
  assert.equal(accepts,accepted);assert.equal(pump.snapshot,null);
  pump.step();assert.equal(pump.snapshot!.clock.simulatedElapsedMilliseconds,62*PACE);
  pump.dispose();tasks.next(true);assert.equal(pump.snapshot,null);assert.equal(saved(canonical),before);
});

const DIR=process.env.CROWNFALL_PATROL_SOURCE_FIXTURES??'/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11';
const PAIRED=`${DIR}/desktop-guard-lane-patrol-v1.json`,QUEST=`${DIR}/quest-guard-lane-patrol-v1.json`;
const LEGACY='/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json';
const EXISTING='/workspace/private-assets/crownfall/task-v4-readonly-export-2026-11-11/saved-v4.json';
function source(file:string,alter?:(raw:any)=>void){
  const raw=JSON.parse(readFileSync(file,'utf8'));alter?.(raw);
  const site=createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,
    binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
  return raw.rigidSourceClearance?applyVillageSiteRigidClearance(site,validateVillageSiteRigidClearance(site,raw.rigidSourceClearance)):site;
}
function held(snapshot:VillagePopulationRuntime,site:VillageSiteLayout){
  const sample=sampleVillagePopulationRuntime(snapshot,site);assert.equal(sample.navigationAuthority,'resident-life');
  assert.ok(sample.residents.every(row=>row.position===null&&!row.presentable&&row.navigationReason==='source-site-changed'));
}
function preservedJourneys(before:VillagePopulationRuntime,after:VillagePopulationRuntime){
  for(const key of ['profile','sourceSha256','siteIdentity','navigationRevision','navigationAllocation'] as const)assert.deepEqual(after.navigation[key],before.navigation[key]);
  for(const prior of before.navigation.residents){const current=after.navigation.residents.find(row=>row.residentId===prior.residentId)!;
    for(const key of ['anchorPosition','route','progressMetres','sourceSha256','sourceSiteIdentity','arrivalEvidence','arrivedAtAbsoluteMinute'] as const)
      assert.deepEqual(current[key],prior[key],`${prior.residentId}:${key}`);
  }
}

test('actual paired source rejoins all 100 canonical life and journey records, then continues ordinary certified travel',
  {skip:!existsSync(PAIRED)&&'Requires the unchanged private paired source site.'},()=>{
    const bytes=readFileSync(PAIRED),site=source(PAIRED),canonical=advance(create(),245,245,site),before=saved(canonical),observer=createVillagePopulationObserver();
    assert.equal(canonical.life.residents.length,100);assert.equal(canonical.navigation.residents.length,100);
    assert.ok(canonical.navigation.residents.some(row=>row.arrivalEvidence==='certified-route-arrival'));
    assert.equal(canonical.navigation.sourceSha256,site.sourceSha256);
    const past=observer.observe(canonical,200*PACE,{site});analytic(past,site);
    const current=observer.observe(canonical,245*PACE,{site});
    assert.equal(current.life,canonical.life);assert.equal(current.navigation,canonical.navigation);readonly(current);
    assert.deepEqual(sampleVillagePopulationRuntime(current,site).residents,sampleVillagePopulationRuntime(canonical,site).residents);
    const future=drain(observer,canonical,251*PACE,{site}),control=advance(canonical,251,6,site);
    assert.deepEqual(future.life,control.life);assert.deepEqual(future.navigation,control.navigation);
    assert.deepEqual(future.navigation.navigationAllocation,canonical.navigation.navigationAllocation);
    assert.ok(future.navigation.residents.some(row=>row.patrol));
    assert.equal(sampleVillagePopulationRuntime(future,site).navigationAuthority,'resident-life');
    assert.ok(parseVillagePopulationRuntime(JSON.stringify(future),{worldKey:canonical.worldKey,contentRevision:canonical.contentRevision}).ok);
    analytic(past,site);assert.equal(saved(canonical),before);assert.deepEqual(readFileSync(PAIRED),bytes);
  });

test('rejoining preserves actual source, legacy allocation and missing-home holds without rebinding or inventing arrivals',
  {skip:![PAIRED,QUEST,LEGACY].every(existsSync)&&'Requires unchanged paired Desktop/Quest and legacy source controls.'},()=>{
    const paired=source(PAIRED),legacy=source(LEGACY),wrongGeneration=source(QUEST,raw=>{
      raw.binding.navigationAllocation.generation=raw.certificate.navigationAllocation.generation='f'.repeat(64);
    });
    const changedSource=source(PAIRED,raw=>{raw.binding.sourceSha256=raw.certificate.sourceSha256='a'.repeat(64);delete raw.rigidSourceClearance;});
    for(const [canonicalSite,other] of [[paired,legacy],[legacy,paired],[paired,wrongGeneration],[paired,changedSource]] as const){
      const canonical=advance(create(),30,30,canonicalSite),before=saved(canonical),observer=createVillagePopulationObserver();
      observer.observe(canonical,15*PACE,{site:other});
      const current=observer.observe(canonical,30*PACE,{site:other});assert.equal(current.navigation,canonical.navigation);held(current,other);
      const future=drain(observer,canonical,34*PACE,{site:other});held(future,other);preservedJourneys(canonical,future);
      assert.equal(future.navigationOther,null,'a refused allocation cannot create an alternate source cursor');assert.equal(saved(canonical),before);
    }
    const incomplete=source(PAIRED,raw=>{raw.residentPlaceBindings=raw.residentPlaceBindings.filter((binding:any)=>binding.placeId!==population.residents[0].homePlaceId);});
    const canonical=advance(create(),30,30,paired),before=saved(canonical),observer=createVillagePopulationObserver();
    observer.observe(canonical,15*PACE,{site:incomplete});
    const current=observer.observe(canonical,30*PACE,{site:incomplete});assert.equal(current.navigation,canonical.navigation);
    const future=drain(observer,canonical,34*PACE,{site:incomplete}),sample=sampleVillagePopulationRuntime(future,incomplete);
    assert.equal(sample.navigationCapability,'legacy-incomplete-homes');assert.ok(sample.missingHomeBindings!>0);
    assert.ok(sample.residents.every(row=>row.arrivalEvidence===undefined&&row.workPoseQualified!==true));preservedJourneys(canonical,future);
    assert.equal(saved(canonical),before);
  });

test('the exact existing canonical save remains byte-identical through pending history, settled rejoin and refused paired advancement',
  {skip:![EXISTING,QUEST,LEGACY].every(existsSync)&&'Requires the exact existing read-only village export and source controls.'},()=>{
    const bytes=readFileSync(EXISTING),raw=JSON.parse(bytes.toString()),original=accept(parseVillagePopulationRuntime(bytes.toString(),{worldKey:raw.worldKey,contentRevision:raw.contentRevision}));
    const site=source(QUEST),before=saved(original),observer=createVillagePopulationObserver(),completed=original.clock.simulatedElapsedMilliseconds;
    observer.observe(original,Math.max(0,completed-PACE),{site});
    assert.ok(original.clock.pendingMilliseconds>0,'the exact old export has unfinished canonical catch-up');
    analytic(observer.observe(original,original.clock.lastObservedAt-original.clock.createdAt,{site}),site);
    // Ordinary bounded CPU catch-up on a separate immutable snapshot, using
    // its existing source. The original save/export is never changed or saved.
    const canonical=accept(advanceVillagePopulationRuntime(original,{expectedGeneration:original.generation,worldKey:original.worldKey,contentRevision:original.contentRevision,
      observedAt:original.clock.lastObservedAt,maxAdvanceMinutes:10080,site:source(LEGACY)}));
    assert.equal(canonical.clock.pendingMilliseconds,0);const settledBefore=saved(canonical),boundary=canonical.clock.simulatedElapsedMilliseconds;
    const current=observer.observe(canonical,boundary,{site});assert.equal(current.life,canonical.life);assert.equal(current.navigation,canonical.navigation);held(current,site);
    const future=drain(observer,canonical,boundary+4*PACE,{site});held(future,site);preservedJourneys(canonical,future);readonly(future);
    assert.equal(saved(canonical),settledBefore);assert.equal(saved(original),before);assert.equal(before,bytes.toString());assert.deepEqual(readFileSync(EXISTING),bytes);
  });
