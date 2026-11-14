import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {projectVillagePopulationEndpoints} from './village-population-projection';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION,validateVillagePopulation,type VillagePopulation} from './village-population';
import {createEaldholtVillageSite,type VillageSiteOptions} from './village-site';
import type {ResidentSafetySignal} from './resident-safety';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,createVillagePopulationObserver,reportVillagePopulationSafetySignals,getVillagePopulationTime,sampleVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationRuntime,validateVillagePopulationRuntime,
  VILLAGE_POPULATION_RUNTIME_MAX_BYTES,VILLAGE_POPULATION_RUNTIME_MAX_FACTS_PER_RESIDENT,type VillagePopulationRuntime,type VillagePopulationCreateInput,type VillagePopulationRuntimeResult} from './village-population-runtime';

const START=1800000000000,PACE=4000,KEY='["test-house","test-confirmed-entry",{"test-banner":true}]',REV='test-population-v1';
const A=POPULATION.residents[0].id,B=POPULATION.residents[1].id,HOME=POPULATION.residents[0].homePlaceId,WORK=POPULATION.residents[0].workPlaceId;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function accepted(r:VillagePopulationRuntimeResult):VillagePopulationRuntime{assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;}
function create(overrides:Partial<VillagePopulationCreateInput>={}):VillagePopulationRuntime{return accepted(createVillagePopulationRuntime({population:POPULATION,confirmedEntry:true,worldKey:KEY,contentRevision:REV,createdAt:START,initialDayMinute:540,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:1,...overrides}));}
function advance(s:VillagePopulationRuntime,elapsed:number,budget=10080){const r=advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:KEY,contentRevision:REV,observedAt:START+elapsed,maxAdvanceMinutes:budget});assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;}
function roundtrip(s:VillagePopulationRuntime){const encoded=serializeVillagePopulationRuntime(s);assert.ok(encoded.ok,encoded.ok?'':encoded.error);return accepted(parseVillagePopulationRuntime(encoded.json,{worldKey:s.worldKey,contentRevision:s.contentRevision}));}
function controlled():VillagePopulation{
  const p=copy(POPULATION) as any;
  for(const r of p.residents){r.registry.routine=[{startMinute:0,endMinute:1440,activity:'Test activity.',placeId:r.homePlaceId,companionIds:[]}];p.registry.residents.find((x:any)=>x.id===r.id).routine=copy(r.registry.routine);}
  assert.equal(validateVillagePopulation(p),null);return p;
}
function travelling():VillagePopulation{
  const p=controlled() as any,r=p.residents[0];r.registry.routine=[{startMinute:0,endMinute:60,activity:'Test rest.',placeId:HOME,companionIds:[]},{startMinute:60,endMinute:120,activity:'Test activity.',placeId:WORK,companionIds:[]},{startMinute:120,endMinute:1440,activity:'Test rest.',placeId:HOME,companionIds:[]}];
  p.registry.residents.find((x:any)=>x.id===A).routine=copy(r.registry.routine);assert.equal(validateVillagePopulation(p),null);return p;
}
function siteOptions():VillageSiteOptions{
  // Synthetic static certificate-shaped inputs only, never actual village
  // coordinates or a claim of geometric/animation qualification.
  const points=[[0,0,0],[0,0,3],[4,0,3]],body=points.map(p=>[p[0],.02,p[2]]),anchors={home:{sourceActor:'test-home',sourceGroundPoint:points[0],capsuleBottomPoint:body[0],standingOnly:true},work:{sourceActor:'test-work',sourceGroundPoint:points[2],capsuleBottomPoint:body[2],standingOnly:true},other:{sourceActor:'test-other',sourceGroundPoint:[8,0,3],capsuleBottomPoint:[8,.02,3],standingOnly:true},other2:{sourceActor:'test-other2',sourceGroundPoint:[9,0,3],capsuleBottomPoint:[9,.02,3],standingOnly:true}};
  const route={from:'home',to:'work',reversible:true,sourceGroundPolyline:points,capsuleBottomPolyline:body,lengthMetres:7,corridorRefs:[1,2]},proof={from:'home',to:'work',sourceGroundPolyline:points,capsuleBottomPolyline:body,lengthMetres:7,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02};
  const island={...route,from:'other',to:'other2',sourceGroundPolyline:[[8,0,3],[9,0,3]],capsuleBottomPolyline:[[8,.02,3],[9,.02,3]],lengthMetres:1};
  return{profile:'desktop',modelSha256:'a'.repeat(64),binding:{schema:1,profile:'desktop',sourceSha256:'a'.repeat(64),frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},anchors,routes:{'test-bent':route,'test-island':island}},certificate:{schema:1,profile:'desktop',sourceSha256:'a'.repeat(64),frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:1e-8,routes:[proof,{...proof,from:'other',to:'other2',sourceGroundPolyline:island.sourceGroundPolyline,capsuleBottomPolyline:island.capsuleBottomPolyline,lengthMetres:1}]},
    placeBindings:[{placeId:HOME,anchorId:null,status:'unmapped'},{placeId:WORK,anchorId:null,status:'unmapped'}],residentPlaceBindings:[{residentId:A,placeId:HOME,anchorId:'home',status:'mapped-exterior'},{residentId:A,placeId:WORK,anchorId:'work',status:'mapped-exterior'}]};
}

function completeHomeOptions():VillageSiteOptions{
  // Synthetic capability fixture only: these shared test thresholds assert no
  // real village room geometry, route clearance or animation proof.
  const options=siteOptions() as any;
  for(const resident of POPULATION.residents)if(!options.residentPlaceBindings.some((binding:any)=>binding.residentId===resident.id&&binding.placeId===resident.homePlaceId))
    options.residentPlaceBindings.push({residentId:resident.id,placeId:resident.homePlaceId,anchorId:'home',status:'mapped-exterior'});
  return options;
}

function resourceQueueFixture(){
  // Two synthetic, independent exterior stands share one logical workplace.
  // This tests reservation/presentation separation, not real work geometry.
  const p=controlled() as any,options=copy(completeHomeOptions()) as any;
  for(const id of [A,B]){
    const r=p.residents.find((r:any)=>r.id===id);
    r.registry.routine=[{startMinute:0,endMinute:1440,activity:'Works at the test workplace.',placeId:WORK,companionIds:[]}];
    p.registry.residents.find((r:any)=>r.id===id).routine=copy(r.registry.routine);
  }
  options.residentPlaceBindings.find((b:any)=>b.residentId===B&&b.placeId===HOME).anchorId='other2';
  options.residentPlaceBindings.push({residentId:B,placeId:WORK,anchorId:'other',status:'mapped-exterior'});
  const site=createEaldholtVillageSite(options);
  const withSite=(s:VillagePopulationRuntime,elapsed:number)=>{
    const r=advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision,observedAt:START+elapsed,maxAdvanceMinutes:5,site});
    assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;
  };
  const start=withSite(create({population:p,initialDayMinute:600,worldKey:'resource-queue-unit-fixture'}),0),arrived=withSite(start,2*PACE);
  return{site,options,arrived};
}

test('a queued resource can present an explicit exclusive exterior wait without counting work or changing saves',()=>{
  const {site,arrived}=resourceQueueFixture(),before=serializeVillagePopulationRuntime(arrived),sample=sampleVillagePopulationRuntime(arrived,site);
  const waiting=sample.residents.find(r=>r.residentId===A)!;
  assert.equal(waiting.lifeStatus,'queued');assert.equal(waiting.navigationStatus,'at-threshold');assert.equal(waiting.presentable,true);
  assert.equal(waiting.waitingForResource,true);assert.equal(waiting.reason,'life-resource-unavailable');assert.equal(waiting.workPoseQualified,false);
  assert.deepEqual(waiting.position,[4,0,3]);assert.equal(waiting.arrivalEvidence,'certified-route-arrival');
  assert.equal(arrived.life.residents.find(r=>r.residentId===A)!.counters.dutyMinutes,0);
  assert.equal(arrived.life.residents.find(r=>r.residentId===A)!.intentProgressMinutes,0);
  assert.equal(arrived.life.reservations.some(r=>r.residentId===A),false,'the visible wait creates no logical resource lease');
  assert.equal(sample.residents.find(r=>r.residentId===B)!.waitingForResource,undefined);
  assert.deepEqual(sampleVillagePopulationRuntime(roundtrip(arrived),site),sample);
  assert.deepEqual(serializeVillagePopulationRuntime(arrived),before,'sampling writes no life, navigation, source cursor, epoch or history');
  const observed=createVillagePopulationObserver().observe(arrived,arrived.clock.simulatedElapsedMilliseconds,{site,preferCanonical:true});
  assert.equal(sampleVillagePopulationRuntime(observed,site).residents.find(r=>r.residentId===A)!.waitingForResource,true);
  assert.equal(serializeVillagePopulationRuntime(observed).ok,false,'a visible wait grants no observer write authority');
  assert.deepEqual(serializeVillagePopulationRuntime(arrived),before);
});

test('waiting presentation rejects unavailable life, source holds, changed person bindings and duplicate exterior owners',()=>{
  const {site,options,arrived}=resourceQueueFixture();
  const unavailable=copy(arrived) as any;unavailable.life.residents.find((r:any)=>r.residentId===A).status='unavailable';
  const sourceHeld=copy(arrived) as any;sourceHeld.navigation.residents.find((r:any)=>r.residentId===A).reason='source-site-changed';
  for(const s of [unavailable,sourceHeld]){
    const row=sampleVillagePopulationRuntime(roundtrip(s),site).residents.find(r=>r.residentId===A)!;
    assert.equal(row.presentable,false);assert.equal(row.waitingForResource,undefined);
  }
  const changed=copy(options) as any;changed.residentPlaceBindings.find((b:any)=>b.residentId===A&&b.placeId===WORK).anchorId='other';
  assert.equal(sampleVillagePopulationRuntime(arrived,createEaldholtVillageSite(changed)).residents.find(r=>r.residentId===A)!.presentable,false);
  const duplicateOptions=copy(options) as any;duplicateOptions.residentPlaceBindings.find((b:any)=>b.residentId===B&&b.placeId===WORK).anchorId='work';
  const duplicate=copy(arrived) as any;duplicate.navigation.residents.find((r:any)=>r.residentId===B).anchorPosition=[4,0,3];
  const row=sampleVillagePopulationRuntime(roundtrip(duplicate),createEaldholtVillageSite(duplicateOptions)).residents.find(r=>r.residentId===A)!;
  assert.equal(row.presentable,false);assert.equal(row.waitingForResource,undefined);assert.equal(row.reason,'anchor-conflict');
  const inside=sampleVillagePopulationRuntime(arrived,site).residents.filter(r=>r.navigationStatus==='indoors');
  assert.ok(inside.length>0);assert.ok(inside.every(r=>r.position===null&&!r.presentable&&!r.waitingForResource));
});

function guardArrivalFixture(){
  const p=controlled() as any,guard=p.residents.find((r:any)=>r.id==='ealdholt-guard-serjeant');
  for(const resident of p.residents){
    resident.registry.routine=resident.id===guard.id
      ?[{startMinute:0,endMinute:600,activity:'Asleep at home.',placeId:resident.homePlaceId,companionIds:[]},
        {startMinute:600,endMinute:720,activity:'Walks the rounds of the watch in the lanes.',placeId:'proposed-lanes',companionIds:[]},
        {startMinute:720,endMinute:1440,activity:'Asleep at home.',placeId:resident.homePlaceId,companionIds:[]}]
      :[{startMinute:0,endMinute:1440,activity:'Asleep at home.',placeId:resident.homePlaceId,companionIds:[]}];
    p.registry.residents.find((r:any)=>r.id===resident.id).routine=copy(resident.registry.routine);
  }
  assert.equal(validateVillagePopulation(p),null);
  const options=completeHomeOptions() as any;
  options.residentPlaceBindings.push({residentId:guard.id,placeId:'proposed-lanes',anchorId:'work',status:'mapped-exterior'});
  const site=createEaldholtVillageSite(options),initial=create({population:p,initialDayMinute:600,worldKey:'guard-certified-arrival-fixture'});
  const withSite=(s:VillagePopulationRuntime,elapsed:number)=>accepted(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,
    worldKey:s.worldKey,contentRevision:s.contentRevision,observedAt:START+elapsed,maxAdvanceMinutes:10,site}));
  const travelling=withSite(initial,0),arrived=withSite(travelling,2*PACE);
  const row=(s:VillagePopulationRuntime,where=site)=>sampleVillagePopulationRuntime(s,where).residents.find(r=>r.residentId===guard.id)!;
  return{guard,site,options,initial,travelling,arrived,row};
}

test('only a real exclusive routine guard arrival samples a neutral pause without changing life or saved journeys',()=>{
  const {guard,site,initial,travelling,arrived,row}=guardArrivalFixture(),before=serializeVillagePopulationRuntime(arrived);
  assert.equal(row(initial).pausingAtDestination,undefined,'the legacy schedule projection cannot grant this marker');
  assert.equal(row(travelling).moving,true);assert.equal(row(travelling).pausingAtDestination,undefined);
  const paused=row(arrived);assert.equal(paused.pausingAtDestination,true);assert.equal(paused.moving,false);
  assert.equal(paused.navigationStatus,'at-threshold');assert.equal(paused.arrivalEvidence,'certified-route-arrival');
  assert.equal(paused.placeId,paused.lifeIntent?.targetPlaceId);assert.deepEqual(paused.position,[4,0,3]);
  assert.equal(paused.lifeIntent?.activityKey,'patrol');assert.equal(paused.workPoseQualified,false);
  assert.equal(row(roundtrip(arrived)).pausingAtDestination,true);assert.deepEqual(serializeVillagePopulationRuntime(arrived),before);
  assert.ok(before.ok);assert.equal(before.json.includes('pausingAtDestination'),false,'the marker is sampled evidence, never a saved permission');
  const observed=createVillagePopulationObserver().observe(arrived,arrived.clock.simulatedElapsedMilliseconds,{site,preferCanonical:true});
  assert.equal(row(observed).pausingAtDestination,true);assert.equal(serializeVillagePopulationRuntime(observed).ok,false);
  const forged=copy(arrived) as any;forged.pausingAtDestination=true;
  assert.equal(parseVillagePopulationRuntime(JSON.stringify(forged),{worldKey:arrived.worldKey,contentRevision:arrived.contentRevision}).ok,false);
  assert.equal(arrived.life.residents.find(r=>r.residentId===guard.id)!.intent.activity,paused.activity);
});

test('neutral guard pauses reject initial placements, stale intents, source changes, active cursors and hidden peers or corridors',()=>{
  const {guard,site,options,travelling,arrived,row}=guardArrivalFixture();
  const reject=(mutate:(s:any)=>void,label:string)=>{const changed=copy(arrived) as any;mutate(changed);assert.equal(row(roundtrip(changed)).pausingAtDestination,undefined,label);};
  const journey=(s:any)=>s.navigation.residents.find((r:any)=>r.residentId===guard.id);
  reject(s=>{journey(s).arrivalEvidence='initial-placement';journey(s).arrivedAtAbsoluteMinute=null;},'initial placement');
  reject(s=>{journey(s).targetPlaceId=guard.homePlaceId;},'stale target');
  reject(s=>{journey(s).originPlaceId=null;journey(s).destinationPlaceId=null;},'forged arrival without a reached source path');
  reject(s=>{journey(s).destinationPlaceId=guard.homePlaceId;},'forged arrival at the wrong path endpoint');
  reject(s=>{journey(s).activityKey='work';},'stale activity');
  reject(s=>{journey(s).priority=40;},'stale priority');
  reject(s=>{journey(s).issuedAbsoluteMinute=599;},'stale issue time');
  reject(s=>{journey(s).issuedAbsoluteMinute=602;s.life.residents.find((r:any)=>r.residentId===guard.id).intent.issuedAbsoluteMinute=602;},'arrival predates the current duty');
  reject(s=>{journey(s).reason='source-site-changed';},'source hold');
  reject(s=>{s.life.residents.find((r:any)=>r.residentId===guard.id).status='unavailable';},'unavailable life');
  reject(s=>{journey(s).patrol={planId:'unpublished-patrol',issuedAbsoluteMinute:600,waypointIndex:0,completedLegs:1,dwellUntilAbsoluteMinute:603};},'active patrol cursor');
  reject(s=>{const moving=copy(travelling.navigation.residents.find(r=>r.residentId===guard.id));moving.lastAbsoluteMinute=s.navigation.absoluteMinute;s.navigation.residents[s.navigation.residents.findIndex((r:any)=>r.residentId===guard.id)]=moving;},'active route');
  const changed=copy(options) as any;changed.residentPlaceBindings.find((b:any)=>b.residentId===guard.id&&b.placeId==='proposed-lanes').anchorId='other';
  assert.equal(row(arrived,createEaldholtVillageSite(changed)).pausingAtDestination,undefined,'changed person-bound source anchor');
  const incomplete=copy(options) as any;incomplete.residentPlaceBindings=incomplete.residentPlaceBindings.filter((b:any)=>b.residentId!==B);
  assert.equal(row(arrived,createEaldholtVillageSite(incomplete)).pausingAtDestination,undefined,'incomplete-home legacy projection');
  reject(s=>{const other={...copy(journey(s)),residentId:A,targetPlaceId:WORK,anchorPlaceId:WORK,originPlaceId:HOME,destinationPlaceId:WORK};s.navigation.residents[s.navigation.residents.findIndex((r:any)=>r.residentId===A)]=other;},'hidden duplicate exterior body');
  reject(s=>{const other={...copy(travelling.navigation.residents.find(r=>r.residentId===guard.id)),residentId:A,targetPlaceId:WORK,anchorPlaceId:HOME,originPlaceId:HOME,destinationPlaceId:WORK,lastAbsoluteMinute:s.navigation.absoluteMinute};s.navigation.residents[s.navigation.residents.findIndex((r:any)=>r.residentId===A)]=other;},'hidden swept incoming corridor');
});

test('all 100 identities, 25 households, kin/social links and explicit per-resident facts survive round-trip',()=>{
  const rosterFacts=POPULATION.residents.map(r=>({residentId:r.id,facts:r.id===A?[{id:'test-personal-choice',value:true}]:[]})),s=create({rosterFacts}),restored=roundtrip(s);
  assert.deepEqual(restored,s);assert.deepEqual(restored.population,POPULATION);assert.equal(restored.rosterFacts.length,100);assert.equal(restored.rosterFacts.find(r=>r.residentId===A)?.facts[0].value,true);assert.equal(restored.rosterFacts.find(r=>r.residentId===B)?.facts.length,0);
  assert.equal(restored.population.households.length,25);assert.equal(restored.population.residents.filter(r=>r.fidelityTier==='major').length,20);assert.equal(restored.population.houseStandingEffect,'none');assert.ok(Object.isFrozen(restored.population.registry.residents[0].socialTies[0]));
  const projection=sampleVillagePopulationRuntime(s,null);assert.equal(projection.residents.length,100);assert.equal(projection.counts.unmapped,100);assert.ok(projection.residents.every(r=>r.position===null&&r.status==='unmapped'&&r.reason==='site-unavailable'));assert.equal('events'in s,false);
});
test('the persistent epoch advances without presentation, wraps days and reuses frozen content',()=>{
  const initial=create(),s=advance(initial,100*PACE+1234),time=getVillagePopulationTime(s);assert.equal(time.dayMinute,640);assert.equal(time.fractionalMinute,1234/PACE);assert.equal(time.elapsedWorldMinutes,100+1234/PACE);
  assert.equal(s.population,initial.population);assert.equal(s.rosterFacts,initial.rosterFacts);assert.equal(s.clock.createdAt,START);
  const later=advance(roundtrip(s),1440*PACE+4000);assert.equal(getVillagePopulationTime(later).dayIndex,1);assert.equal(getVillagePopulationTime(later).dayMinute,541);assert.equal(later.clock.createdAt,START);
  assert.deepEqual(later.rosterFacts,initial.rosterFacts,'schedule progress creates no personal facts');assert.equal(sampleVillagePopulationRuntime(later,null).residents.length,100);
});
test('large away time uses bounded life catch-up and preserves every deferred millisecond',()=>{
  const initial=create(),horizon=10_000_000*PACE+321,r=advanceVillagePopulationRuntime(initial,{expectedGeneration:0,worldKey:KEY,contentRevision:REV,observedAt:START+horizon,maxAdvanceMinutes:60});assert.ok(r.ok);
  assert.equal(r.advancedMilliseconds,60*PACE);assert.equal(r.deferredMilliseconds,horizon-60*PACE);assert.equal(r.snapshot.clock.pendingMilliseconds,r.deferredMilliseconds);
  const next=advance(roundtrip(r.snapshot),horizon,60);assert.equal(next.clock.simulatedElapsedMilliseconds,120*PACE);assert.equal(next.population.residents.length,100);
});
test('continuous observation and bounded elapsed jump agree on time, lives and all resident activities',()=>{
  let continuous=create();for(let i=1;i<=20;i++)continuous=advance(continuous,i*PACE);const away=advance(create(),20*PACE);
  assert.deepEqual(continuous.clock,away.clock);assert.deepEqual(sampleVillagePopulationRuntime(continuous,null).residents,sampleVillagePopulationRuntime(away,null).residents);
  assert.deepEqual(continuous.rosterFacts,away.rosterFacts);assert.deepEqual(continuous.population,away.population);assert.deepEqual(continuous.life,away.life);assert.deepEqual(continuous.navigation,away.navigation);
});
test('mapped movement follows bent measured polylines and stops at an endpoint without creating events',()=>{
  const site=createEaldholtVillageSite(siteOptions()),initial=create({population:travelling(),initialDayMinute:60});let s=advance(initial,1000),row=sampleVillagePopulationRuntime(s,site).residents.find(r=>r.residentId===A)!;
  assert.equal(row.status,'travelling');assert.equal(row.moving,true);assert.deepEqual(row.position,[0,0,1]);assert.equal(row.activity,'Test activity.');assert.equal(row.roleClip,null);
  s=advance(s,4000);row=sampleVillagePopulationRuntime(s,site).residents.find(r=>r.residentId===A)!;assert.deepEqual(row.position,[1,0,3],'arc length preserves the measured corner rather than cutting across');
  s=advance(s,7000);row=sampleVillagePopulationRuntime(s,site).residents.find(r=>r.residentId===A)!;assert.equal(row.status,'at-place');assert.equal(row.placeId,WORK);assert.deepEqual(row.position,[4,0,3]);assert.equal(row.moving,false);assert.equal(s.rosterFacts.find(r=>r.residentId===A)?.facts.length,0);
});
test('missing places, disconnected routes and impossible slot duration remain explicit instead of idle/teleport',()=>{
  const s=create({population:travelling(),initialDayMinute:60}),unmapped=siteOptions() as any;unmapped.residentPlaceBindings[1]={residentId:A,placeId:WORK,anchorId:null,status:'unmapped'};
  assert.equal(sampleVillagePopulationRuntime(s,createEaldholtVillageSite(unmapped)).residents[0].reason,'place-unmapped');
  const disconnected=siteOptions() as any;disconnected.residentPlaceBindings[1].anchorId='other';const row=sampleVillagePopulationRuntime(s,createEaldholtVillageSite(disconnected)).residents[0];assert.equal(row.reason,'route-unmapped');assert.equal(row.position,null);
  const tooFast=create({population:travelling(),initialDayMinute:60,millisecondsPerWorldMinute:1,walkingSpeedMetresPerSecond:.1});assert.equal(sampleVillagePopulationRuntime(tooFast,createEaldholtVillageSite(siteOptions())).residents[0].reason,'route-exceeds-slot');
  assert.equal(s.population.residents.length,100,'missing visual bindings never remove the life registry');
});
test('fixed personal stands prevent shared-anchor stacking; conflicts are not hidden as idle',()=>{
  const p=controlled(),options=siteOptions() as any;options.residentPlaceBindings=[{residentId:A,placeId:HOME,anchorId:'home',status:'mapped-exterior'},{residentId:B,placeId:HOME,anchorId:'home',status:'mapped-exterior'}];
  const s=create({population:p}),conflict=sampleVillagePopulationRuntime(s,createEaldholtVillageSite(options));assert.equal(conflict.counts.blocked,2);assert.equal(conflict.residents[0].reason,'anchor-conflict');assert.equal(conflict.residents[0].position,null);
  options.residentPlaceBindings[1].anchorId='other';const distinct=sampleVillagePopulationRuntime(s,createEaldholtVillageSite(options));assert.equal(distinct.counts.mapped,2);assert.equal(distinct.counts.blocked,0);assert.notDeepEqual(distinct.residents[0].position,distinct.residents[1].position);
});
test('different measured anchor IDs cannot disguise overlapping stationary proxy footprints',()=>{
  const options=siteOptions() as any,points=[[0,0,0],[0,0,.1],[.1,0,.1]],body=points.map(p=>[p[0],.02,p[2]]);
  options.binding.anchors.work.sourceGroundPoint=points[2];options.binding.anchors.work.capsuleBottomPoint=body[2];
  Object.assign(options.binding.routes['test-bent'],{sourceGroundPolyline:points,capsuleBottomPolyline:body,lengthMetres:.2});Object.assign(options.certificate.routes[0],{sourceGroundPolyline:points,capsuleBottomPolyline:body,lengthMetres:.2});
  options.residentPlaceBindings=[{residentId:A,placeId:HOME,anchorId:'home',status:'mapped-exterior'},{residentId:B,placeId:HOME,anchorId:'work',status:'mapped-exterior'}];
  const frame=sampleVillagePopulationRuntime(create({population:controlled()}),createEaldholtVillageSite(options));assert.equal(frame.counts.blocked,2);assert.ok(frame.residents.slice(0,2).every(r=>r.reason==='anchor-conflict'&&r.position===null));
});
test('coalesced same-place blocks remain continuous over midnight and source bindings reject unknown roster IDs',()=>{
  const site=createEaldholtVillageSite(siteOptions()),initial=create({population:travelling(),initialDayMinute:1439}),first=sampleVillagePopulationRuntime(initial,site).residents[0],next=sampleVillagePopulationRuntime(advance(initial,PACE),site).residents[0];assert.deepEqual(first.position,[0,0,0]);assert.deepEqual(next.position,first.position);assert.equal(next.status,'at-place');
  const unknown=siteOptions() as any;unknown.placeBindings.push({placeId:'test-invented-place',anchorId:'home',status:'mapped-exterior'});assert.throws(()=>sampleVillagePopulationRuntime(initial,createEaldholtVillageSite(unknown)),/unknown population place/);
});
test('wrong world/revision/generation, rollback, malformed clock/facts and mirror mismatches refuse without mutation',()=>{
  const s=create(),before=JSON.stringify(s),input={expectedGeneration:0,worldKey:KEY,contentRevision:REV,observedAt:START+PACE,maxAdvanceMinutes:10080};
  for(const change of [{expectedGeneration:2},{worldKey:'another-world'},{contentRevision:'another-v1'},{observedAt:START-1},{maxAdvanceMinutes:10081}])assert.equal(advanceVillagePopulationRuntime(s,{...input,...change}).ok,false);
  for(const change of [(v:any)=>v.schemaVersion=3,(v:any)=>v.clock.pendingMilliseconds=1,(v:any)=>v.population.residents[0].registry.routine[0].placeId='missing',
    (v:any)=>v.rosterFacts.pop(),(v:any)=>v.rosterFacts[1].residentId=A,(v:any)=>v.population.registry.residents[0].socialTies=[]]){const v=copy(s);change(v);assert.notEqual(validateVillagePopulationRuntime(v),null);}
  assert.equal(JSON.stringify(s),before);assert.equal(createVillagePopulationRuntime({...({} as any),population:POPULATION,confirmedEntry:false}).ok,false);
});
test('save budgets, expected identity and hostile getters/hooks are checked without execution',()=>{
  const s=create(),encoded=serializeVillagePopulationRuntime(s);assert.ok(encoded.ok);assert.ok(new TextEncoder().encode(encoded.json).byteLength<VILLAGE_POPULATION_RUNTIME_MAX_BYTES);assert.equal(parseVillagePopulationRuntime(encoded.json,{worldKey:'another',contentRevision:REV}).ok,false);
  assert.equal(parseVillagePopulationRuntime('{',{worldKey:KEY,contentRevision:REV}).ok,false);assert.equal(parseVillagePopulationRuntime(' '.repeat(VILLAGE_POPULATION_RUNTIME_MAX_BYTES+1),{worldKey:KEY,contentRevision:REV}).ok,false);
  const bad=copy(s) as any;bad.rosterFacts[0].facts=Array.from({length:VILLAGE_POPULATION_RUNTIME_MAX_FACTS_PER_RESIDENT+1},(_,i)=>({id:`test-${i}`,value:true}));assert.notEqual(validateVillagePopulationRuntime(bad),null);
  let reads=0;const poisoned=copy(s) as any;Object.defineProperty(poisoned.population.residents[0],'registry',{enumerable:true,get(){reads++;return{};}});assert.notEqual(validateVillagePopulationRuntime(poisoned),null);
  const hook=copy(s) as any;hook.toJSON=()=>{reads++;return{};};assert.equal(serializeVillagePopulationRuntime(hook).ok,false);assert.equal(reads,0);
});

test('v1 migration preserves every identity, epoch, fact and deferred millisecond without inventing prior lives',()=>{
  const original=copy(create({rosterFacts:POPULATION.residents.map(r=>({residentId:r.id,facts:[{id:'existing-memory',value:r.id===A}]}))})) as any;
  delete original.life;delete original.navigation;delete original.navigationOther;delete original.safetySignals;delete original.safetySignalIds;delete original.routineActions;delete original.workstations;delete original.timberSupply;original.schemaVersion=1;original.generation=37;
  const elapsed=(2*1440+17)*PACE+1234,deferred=9*PACE;
  Object.assign(original.clock,{lastObservedAt:START+elapsed+deferred,simulatedElapsedMilliseconds:elapsed,pendingMilliseconds:deferred});
  const parsed=parseVillagePopulationRuntime(JSON.stringify(original),{worldKey:KEY,contentRevision:REV});assert.ok(parsed.ok);assert.equal(parsed.migrated,true);
  const s=parsed.snapshot;assert.equal(s.schemaVersion,2);assert.equal(s.generation,37);assert.equal(s.worldKey,original.worldKey);assert.deepEqual(s.clock,original.clock);
  assert.deepEqual(s.population,original.population);assert.deepEqual(s.rosterFacts,original.rosterFacts);assert.equal(s.life.absoluteMinute,540+2*1440+17);
  assert.equal(s.navigation.absoluteMinute,s.life.absoluteMinute+1234/PACE);assert.equal(s.life.journal.length,0);assert.equal(s.life.nextEventSequence,0);
  assert.ok(s.life.residents.every(r=>Object.values(r.counters).every(value=>value===0)));assert.ok(s.navigation.residents.every(r=>r.arrivalEvidence==='none'&&r.anchorPosition===null));
  assert.deepEqual(s.safetySignals,[]);assert.deepEqual(s.safetySignalIds,[]);assert.deepEqual(roundtrip(s),s);
});
test('100 off-screen lives recur, save and resume identically across bounded catch-up slices',()=>{
  const start=create(),elapsed=480*PACE+1234,bulk=advance(start,elapsed);
  let sliced=start;for(let m=60;m<=480;m+=60){sliced=advance(sliced,m*PACE,60);if(m===180)sliced=roundtrip(sliced);}sliced=advance(sliced,elapsed,60);
  assert.deepEqual(sliced.life,bulk.life);assert.deepEqual(sliced.navigation,bulk.navigation);assert.deepEqual(sliced.clock,bulk.clock);
  assert.equal(bulk.life.residents.length,100);assert.equal(bulk.life.households.length,25);assert.ok(bulk.life.residents.every(r=>r.homePlaceId&&r.workPlaceId));
  assert.ok(bulk.life.residents.some(r=>r.counters.dutyMinutes>0));assert.ok(bulk.life.residents.some(r=>r.counters.mealCount>0));assert.ok(bulk.life.households.some(h=>h.sharedMeals>0));
  assert.ok(bulk.life.journal.length>0&&bulk.life.journal.length<=256);assert.ok(bulk.life.journal.every(e=>e.provenance==='simulated-routine'));
  assert.deepEqual(bulk.rosterFacts,start.rosterFacts,'off-screen duties do not fabricate witnessed personal facts or standing');
  const encoded=serializeVillagePopulationRuntime(bulk);assert.ok(encoded.ok);assert.ok(new TextEncoder().encode(encoded.json).byteLength<VILLAGE_POPULATION_RUNTIME_MAX_BYTES);assert.deepEqual(roundtrip(bulk),bulk);
});
test('invalid life, journey and safety cursors cannot overwrite a coherent world',()=>{
  const s=create(),before=JSON.stringify(s);
  for(const corrupt of [(v:any)=>v.life.worldKey='foreign',(v:any)=>v.life.absoluteMinute++,
    (v:any)=>v.life.residents.pop(),(v:any)=>v.life.residents[0].homePlaceId='invented-home',
    (v:any)=>v.navigation.absoluteMinute++,(v:any)=>v.navigation.residents.pop(),
    (v:any)=>v.navigation.residents[1].residentId=A,(v:any)=>v.safetySignalIds=['same','same']]){
    const bad=copy(s);corrupt(bad);assert.equal(parseVillagePopulationRuntime(JSON.stringify(bad),{worldKey:KEY,contentRevision:REV}).ok,false);
  }
  assert.equal(JSON.stringify(s),before);
});
test('shared night lighting conditions change an outdoor duty into a durable shelter intent',()=>{
  const s=advance(create({population:travelling(),initialDayMinute:59}),PACE),resident=s.life.residents[0];
  assert.equal(s.life.absoluteMinute,60);assert.equal(resident.intent.reason,'weather');assert.equal(resident.intent.activityKey,'shelter');
  assert.equal(resident.intent.targetPlaceId,HOME);assert.ok(resident.suspendedIntent);assert.equal(resident.suspendedIntent.targetPlaceId,WORK);
  assert.deepEqual(roundtrip(s).life,s.life);assert.equal(s.rosterFacts[0].facts.length,0);
});
test('attached source journeys retain physical progress across restore and platform switches',()=>{
  const site=createEaldholtVillageSite(completeHomeOptions()),p=copy(travelling()) as any;
  // A patrol remains a valid overnight journey; ordinary outdoor work at
  // 01:00 correctly seeks shelter under the shared environment sampler.
  p.residents[0].registry.routine[1].activity='Patrols the test route.';p.registry.residents.find((r:any)=>r.id===A).routine=copy(p.residents[0].registry.routine);
  let s=create({population:p,initialDayMinute:59});
  const withSite=(state:VillagePopulationRuntime,elapsed:number,geometry=site)=>{const result=advanceVillagePopulationRuntime(state,{expectedGeneration:state.generation,worldKey:KEY,contentRevision:REV,observedAt:START+elapsed,maxAdvanceMinutes:5,site:geometry});assert.ok(result.ok,result.ok?'':result.error);return result.snapshot;};
  s=withSite(s,0);assert.equal(s.navigation.residents[0].arrivalEvidence,'initial-placement');assert.equal(s.navigation.residents[0].anchorPlaceId,HOME);
  s=withSite(s,PACE);s=withSite(s,PACE+1000);const physical=sampleVillagePopulationRuntime(s,site),row=physical.residents[0];
  assert.equal(physical.navigationAuthority,'resident-life');assert.equal(row.moving,true,JSON.stringify(row));assert.deepEqual(row.position,[0,0,1]);assert.equal(row.workPoseQualified,false);
  const restored=roundtrip(s);assert.deepEqual(sampleVillagePopulationRuntime(restored,site),physical);
  // Saved logical availability cannot certify a stationary task, even when
  // the exterior route/threshold itself remains valid. This synthetic fixture
  // asserts a presentation hold, never proof of a real workstation/animation.
  const arrived=withSite(restored,PACE+7000);assert.equal(sampleVillagePopulationRuntime(arrived,site).residents[0].status,'at-place');
  for(const status of ['queued','unavailable']){const held=copy(arrived) as any;held.life.residents[0].status=status;const row=sampleVillagePopulationRuntime(roundtrip(held),site).residents[0];assert.equal(row.presentable,false);assert.equal(row.reason,'life-resource-unavailable');assert.equal(row.lifeStatus,status);}
  const questOptions=copy(completeHomeOptions()) as any;questOptions.profile='quest';questOptions.binding.profile='quest';questOptions.certificate.profile='quest';
  questOptions.modelSha256='b'.repeat(64);questOptions.binding.sourceSha256='b'.repeat(64);questOptions.certificate.sourceSha256='b'.repeat(64);
  const quest=createEaldholtVillageSite(questOptions),switched=withSite(restored,PACE+1000,quest);assert.equal(switched.navigation.profile,'quest');assert.equal(switched.navigationOther?.profile,'desktop');
  assert.equal(switched.navigationOther?.residents[0].progressMetres,1);assert.deepEqual(switched.life,restored.life);
  const back=withSite(roundtrip(switched),PACE+1000,site);assert.equal(back.navigation.profile,'desktop');assert.deepEqual(sampleVillagePopulationRuntime(back,site).residents[0].position,[0,0,1]);
  const fallback=withSite(back,PACE+1000,createEaldholtVillageSite(siteOptions())),legacy=sampleVillagePopulationRuntime(fallback,createEaldholtVillageSite(siteOptions()));
  assert.equal(legacy.navigationAuthority,'schedule-projection');assert.equal(fallback.navigation.profile,'desktop');assert.equal(fallback.navigation.residents[0].progressMetres,back.navigation.residents[0].progressMetres);
  assert.deepEqual(fallback.navigation.residents[0].route,back.navigation.residents[0].route);assert.deepEqual(fallback.life,back.life);assert.equal(legacy.residents[0].arrivalEvidence,undefined);
  const resumed=withSite(roundtrip(fallback),PACE+1000,site);assert.equal(sampleVillagePopulationRuntime(resumed,site).navigationAuthority,'resident-life');assert.deepEqual(sampleVillagePopulationRuntime(resumed,site).residents[0].position,[0,0,1]);
  const changed=copy(completeHomeOptions()) as any;changed.modelSha256='c'.repeat(64);changed.binding.sourceSha256='c'.repeat(64);changed.certificate.sourceSha256='c'.repeat(64);
  const held=withSite(back,PACE+1000,createEaldholtVillageSite(changed)),heldRow=sampleVillagePopulationRuntime(held,createEaldholtVillageSite(changed)).residents[0];
  assert.equal(heldRow.presentable,false);assert.equal(heldRow.position,null);assert.equal(heldRow.navigationReason,'source-site-changed');
});
test('explicit safety evidence persists interruption, deduplicates and expires on the same world clock',()=>{
  const start=create(),signal:ResidentSafetySignal={id:'test-fire-1',kind:'fire',channel:'witness',knownByResidentIds:[A],placeId:WORK,observedAbsoluteMinute:540,expiresAbsoluteMinute:548,affectedResidentIds:[A],shelterPlaceId:HOME};
  const report=(state:VillagePopulationRuntime,signals:readonly ResidentSafetySignal[])=>reportVillagePopulationSafetySignals(state,{expectedGeneration:state.generation,worldKey:KEY,contentRevision:REV,signals});
  const entered=accepted(report(start,[signal,signal]));assert.equal(entered.safetySignals.length,1);assert.equal(entered.clock,start.clock);assert.equal(entered.life,start.life);assert.equal(accepted(report(entered,[signal])),entered);
  assert.equal(report(entered,[{...signal,kind:'violence'}]).ok,false,'stable pending IDs cannot exchange evidence');
  for(const bad of [{...signal,id:'future',observedAbsoluteMinute:541},{...signal,id:'foreign',knownByResidentIds:['not-a-villager']},
    {...signal,id:'expired',observedAbsoluteMinute:530,expiresAbsoluteMinute:540},{...signal,id:'unknown-place',placeId:'somewhere'}])assert.equal(report(entered,[bad]).ok,false);
  const interrupted=advance(entered,PACE),life=interrupted.life.residents.find(r=>r.residentId===A)!;
  assert.equal(life.intent.reason,'safety');assert.equal(life.safety.mode,'shelter');assert.equal(life.safety.activeSignalId,signal.id);assert.ok(life.suspendedIntent);
  assert.ok(interrupted.life.residents.filter(r=>r.residentId!==A).every(r=>r.safety.knownSignals.length===0),'reports are not omniscient broadcasts');
  const saved=roundtrip(interrupted),continued=advance(saved,4*PACE),same=advance(interrupted,4*PACE);assert.deepEqual(continued.life,same.life);
  const expired=advance(continued,8*PACE);assert.equal(expired.safetySignals.length,0);assert.ok(expired.safetySignalIds.includes(signal.id));
  assert.equal(expired.life.residents.find(r=>r.residentId===A)!.safety.mode,'routine');assert.deepEqual(expired.rosterFacts,start.rosterFacts);assert.deepEqual(roundtrip(expired),expired);
  const large={...signal,id:'large-report',knownByResidentIds:POPULATION.residents.map(r=>r.id),affectedResidentIds:POPULATION.residents.map(r=>r.id)};
  assert.equal(report(start,[large]).ok,false,'recipient-copy budget rejects a report that cannot fit safely into every recipient save');
});

test('incomplete legacy homes retain labelled schedule presentation without physical bootstrap',()=>{
  const site=createEaldholtVillageSite(siteOptions()),before=create({population:travelling(),initialDayMinute:60}),baseline=sampleVillagePopulationRuntime(before,site);
  const result=advanceVillagePopulationRuntime(before,{expectedGeneration:before.generation,worldKey:KEY,contentRevision:REV,observedAt:START,maxAdvanceMinutes:1,site});assert.ok(result.ok);
  const sampled=sampleVillagePopulationRuntime(result.snapshot,site);assert.equal(sampled.navigationAuthority,'schedule-projection');assert.equal(sampled.navigationCapability,'legacy-incomplete-homes');assert.ok(sampled.missingHomeBindings!>0);
  assert.equal(sampled.counts.total,100);assert.deepEqual(sampled.residents,baseline.residents);assert.ok(sampled.residents.some(row=>row.presentable),'legacy route samples remain available to existing source-motion qualification');
  assert.equal(result.snapshot.navigation.profile,null);assert.ok(result.snapshot.navigation.residents.every(row=>row.anchorPosition===null&&row.arrivalEvidence==='none'));
  assert.deepEqual(result.snapshot.life,before.life);assert.deepEqual(result.snapshot.rosterFacts,before.rosterFacts);
});
const privateLegacyV3=process.env.CROWNFALL_POPULATION_SITE_V3??'/workspace/private-assets/crownfall/population-expanded-r3/ealdholt-population-desktop-public-destinations-v3.json';
test('installed actual v3 source preserves viable legacy projections while100 lives persist',{
  skip:!existsSync(privateLegacyV3)&&'Requires the private source-qualified v3 site artifact.'
},()=>{
  const raw=JSON.parse(readFileSync(privateLegacyV3,'utf8')),site=createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
  const before=create(),baseline=sampleVillagePopulationRuntime(before,site),candidatesBefore=projectVillagePopulationEndpoints(baseline,site).candidates.length;assert.ok(candidatesBefore>0,'actual old source has viable public endpoint projections');
  const result=advanceVillagePopulationRuntime(before,{expectedGeneration:before.generation,worldKey:KEY,contentRevision:REV,observedAt:START,maxAdvanceMinutes:1,site});assert.ok(result.ok);
  const sample=sampleVillagePopulationRuntime(result.snapshot,site);assert.equal(sample.navigationAuthority,'schedule-projection');assert.equal(sample.navigationCapability,'legacy-incomplete-homes');assert.equal(sample.missingHomeBindings,100);
  assert.equal(projectVillagePopulationEndpoints(sample,site).candidates.length,candidatesBefore);assert.deepEqual(sample.residents,baseline.residents);assert.equal(sample.life?.residents.length,100);assert.equal(result.snapshot.navigation.profile,null);
  assert.ok(result.snapshot.navigation.residents.every(row=>row.arrivalEvidence==='none'&&row.anchorPosition===null));assert.deepEqual(result.snapshot.life,before.life);
});
