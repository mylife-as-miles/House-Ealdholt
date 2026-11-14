import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION,type VillagePopulation} from './village-population';
import {createEaldholtVillageSite,type VillageSiteLayout} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationRuntime,
 sampleVillagePopulationRuntime,reportVillagePopulationSafetySignals,createVillagePopulationObserver,captureVillagePopulationEmergencyCheckpoint,
 parseVillagePopulationEmergencyCheckpoint,advanceVillagePopulationEmergencyCheckpoint,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';

const START=1800000000000,PACE=4000,KEY='actual-runtime-queue-unit-world',REV='ordinary-queue-v1',A=POPULATION.residents[0].id,HOME=POPULATION.residents[0].homePlaceId,WORK=POPULATION.residents[0].workPlaceId;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function accepted(r:VillagePopulationRuntimeResult):VillagePopulationRuntime{if(!r.ok)assert.fail(r.error);return r.snapshot;}
function controlled():VillagePopulation{
 const p=copy(POPULATION) as any;for(const person of p.residents){person.registry.routine=[{startMinute:0,endMinute:1440,activity:person.id===A?'Mends household tools.':'Asleep at home.',placeId:person.id===A?WORK:person.homePlaceId,companionIds:[]}];p.registry.residents.find((r:any)=>r.id===person.id).routine=copy(person.registry.routine);}return p;
}
function create(population=POPULATION){return accepted(createVillagePopulationRuntime({population,confirmedEntry:true,worldKey:KEY,contentRevision:REV,createdAt:START,initialDayMinute:600,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:1}));}
function advance(s:VillagePopulationRuntime,elapsed:number,site:VillageSiteLayout|null=null,budget=10080){return accepted(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:KEY,contentRevision:REV,observedAt:START+elapsed,maxAdvanceMinutes:budget,site}));}
function roundtrip(s:VillagePopulationRuntime){const encoded=serializeVillagePopulationRuntime(s);if(!encoded.ok)assert.fail(encoded.error);return accepted(parseVillagePopulationRuntime(encoded.json,{worldKey:KEY,contentRevision:REV}));}
function row(s:VillagePopulationRuntime){return s.routineActions.residents.find(r=>r.residentId===A)!;}
/** Synthetic complete-home source-contract only: route and physical command
 * semantics, never a claim of real Elderbloom model/animation qualification. */
function site(){const sha='a'.repeat(64),line=[[0,0,0],[0,0,3],[4,0,3]],body=line.map(p=>[p[0],.02,p[2]]),route={from:'home',to:'work',reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres:7,corridorRefs:[1,2]};
 return createEaldholtVillageSite({profile:'desktop',modelSha256:sha,binding:{schema:1,profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},anchors:{home:{sourceActor:'unit-house',sourceGroundPoint:line[0],capsuleBottomPoint:body[0],standingOnly:true},work:{sourceActor:'unit-forge',sourceGroundPoint:line[2],capsuleBottomPoint:body[2],standingOnly:true}},routes:{'unit-bent-route':route}},
 certificate:{schema:1,profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{height:1.8,radius:.28},qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:1e-8,routes:[{from:'home',to:'work',sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres:7,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02}]},placeBindings:[],residentPlaceBindings:[...POPULATION.residents.map(p=>({residentId:p.id,placeId:p.homePlaceId,anchorId:'home',status:'mapped-exterior' as const})),{residentId:A,placeId:WORK,anchorId:'work',status:'mapped-exterior'}]});}

test('production runtime consumes all100 ordinary queues at creation, saves them and keeps all existing lives and personal facts',()=>{
 const start=create(),before=JSON.stringify(start),loaded=roundtrip(start);assert.deepEqual(loaded,start);assert.equal(start.routineActions.residents.length,100);
 assert.ok(start.routineActions.residents.every(q=>q.current==='approach'&&q.performedWorldMinutes===0&&q.wait?.reason==='source-unavailable'));
 const sample=sampleVillagePopulationRuntime(start,null);assert.equal(sample.residents.length,100);assert.ok(sample.residents.every(p=>p.routineAction?.step==='approach'));
 assert.equal(JSON.stringify(start),before);assert.equal(start.life.households.length,25);assert.deepEqual(start.population,loaded.population);assert.deepEqual(start.rosterFacts,loaded.rosterFacts);
});

test('outer save reports a nested ordinary queue migration while retaining all100 pending jobs and lives',()=>{
 const start=create(),legacy=copy(start) as any;legacy.routineActions.schemaVersion=1;
 for(const job of legacy.routineActions.residents){delete job.proof.stationBinding;delete job.proof.contactCount;delete job.goal.lineage;}
 const result=parseVillagePopulationRuntime(JSON.stringify(legacy),{worldKey:KEY,contentRevision:REV});
 if(!result.ok)assert.fail(result.error);
 assert.equal(result.migrated,true);assert.equal(result.snapshot.routineActions.schemaVersion,2);
 assert.deepEqual(result.snapshot.routineActions.residents.map(q=>[q.jobId,q.current,q.wait]),start.routineActions.residents.map(q=>[q.jobId,q.current,q.wait]));
 assert.deepEqual(result.snapshot.life,start.life);assert.deepEqual(result.snapshot.navigation,start.navigation);assert.deepEqual(result.snapshot.rosterFacts,start.rosterFacts);
 const encoded=serializeVillagePopulationRuntime(result.snapshot);if(!encoded.ok)assert.fail(encoded.error);
 const restored=parseVillagePopulationRuntime(encoded.json,{worldKey:KEY,contentRevision:REV});if(!restored.ok)assert.fail(restored.error);
 assert.equal(restored.migrated,false);assert.deepEqual(restored.snapshot,result.snapshot);
});

test('old schema2 saves acquire pending queues at the exact saved cursor without resetting100 lives, homes, kin, counters or clocks',()=>{
 const original=advance(create(),17*PACE+1234),raw=copy(original) as any;delete raw.routineActions;
 const loaded=accepted(parseVillagePopulationRuntime(JSON.stringify(raw),{worldKey:KEY,contentRevision:REV}));
 for(const name of ['life','navigation','navigationOther','clock','population','rosterFacts','safetySignals','safetySignalIds'] as const)assert.deepEqual(loaded[name],original[name],name);
 assert.equal(loaded.routineActions.absoluteMinute,original.life.absoluteMinute);assert.ok(loaded.routineActions.residents.every(q=>q.performedWorldMinutes===0&&q.proof.arrivalId===null));assert.deepEqual(roundtrip(loaded),loaded);
});

test('offscreen away catchup, minutely observation and saved subdivision produce identical ordinary front jobs and blocked reasons',()=>{
 const start=create(),bulk=advance(start,45*PACE+1234);let sliced=start;
 for(let m=1;m<=45;m++){sliced=advance(sliced,m*PACE);if(m===19)sliced=roundtrip(sliced);}sliced=advance(sliced,45*PACE+1234);
 assert.deepEqual(sliced.routineActions,bulk.routineActions);assert.deepEqual(sliced.life,bulk.life);assert.deepEqual(sliced.navigation,bulk.navigation);assert.deepEqual(sliced.rosterFacts,start.rosterFacts);
 assert.ok(bulk.routineActions.residents.every(q=>q.performedWorldMinutes===0),'Off-screen abstract duty counters never become physical work.');
});

test('real runtime routes consume approach after fractional arrival, then hold workstation qualification despite abstract duty reservations',()=>{
 const map=site(),start=advance(create(controlled()),0,map),walking=advance(start,PACE,map),arrived=advance(walking,2*PACE,map),held=advance(arrived,3*PACE,map);
 assert.equal(start.navigation.profile,'desktop');assert.equal(start.routineActions.source?.profile,'desktop');assert.equal(row(walking).current,'approach');
 assert.equal(arrived.navigation.residents.find(r=>r.residentId===A)!.arrivedAtAbsoluteMinute,601.75);assert.equal(row(arrived).current,'reserve');
 assert.equal(row(held).wait?.reason,'workstation-unqualified');assert.equal(row(held).performedWorldMinutes,0);assert.equal(row(held).proof.leaseId,null);
 assert.ok(held.life.reservations.some(r=>r.residentId===A&&r.scope==='simulation-only'),'An abstract duty lease exists and remains insufficient.');
 const before=serializeVillagePopulationRuntime(held),sample=sampleVillagePopulationRuntime(held,map);assert.equal(sample.residents.find(r=>r.residentId===A)!.routineAction?.blockedReason,'workstation-unqualified');
 assert.equal(sample.residents.find(r=>r.residentId===A)!.workPoseQualified,false);assert.deepEqual(serializeVillagePopulationRuntime(held),before);assert.deepEqual(roundtrip(held).routineActions,held.routineActions);
 const unchanged=advance(held,3*PACE,map);assert.equal(unchanged,held,'Repeated observations at an unchanged world minute keep the same generation.');
});

test('actual resident-local raid reports suspend the same ordinary job through save, leave unaware neighbours alone and resume without physical credit',()=>{
 const map=site(),start=advance(create(controlled()),3*PACE,map),job=row(start).jobId;
 const signal={id:'unit-reported-raid',kind:'violence' as const,channel:'report' as const,knownByResidentIds:[A],placeId:WORK,observedAbsoluteMinute:603,expiresAbsoluteMinute:608,affectedResidentIds:[A],shelterPlaceId:HOME};
 const reported=accepted(reportVillagePopulationSafetySignals(start,{expectedGeneration:start.generation,worldKey:KEY,contentRevision:REV,signals:[signal]})),paused=advance(reported,4*PACE,map);
 assert.equal(paused.life.residents.find(r=>r.residentId===A)!.intent.reason,'safety');assert.equal(row(paused).interruption?.reason,'safety');assert.equal(row(paused).jobId,job);
 assert.ok(paused.routineActions.residents.filter(r=>r.residentId!==A).every(r=>r.interruption===null));
 const restored=roundtrip(paused),later=advance(restored,10*PACE,map);assert.equal(row(later).jobId,job);assert.equal(row(later).interruption,null);assert.equal(row(later).performedWorldMinutes,0);assert.equal(row(later).proof.leaseId,null);
 assert.deepEqual(advance(paused,10*PACE,map).routineActions,later.routineActions);assert.deepEqual(later.rosterFacts,start.rosterFacts);
});

test('disaster checkpoint capture and JSON restore retain ordinary queues and old checkpoints start them at their own existing cursor',()=>{
 const canonical=create(controlled()),frame={siteIdentity:'unit-empty-disaster-frame',buildings:[],incidents:[],stations:[],shelterPlaceIds:[],obstacles:[]};
 let step=advanceVillagePopulationEmergencyCheckpoint(canonical,null,PACE,{site:null,frame});
 assert.ok(step.checkpoint.routineActions);assert.deepEqual(step.checkpoint.routineActions,step.snapshot.routineActions);
 const saved=parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint),KEY);assert.deepEqual(saved.routineActions,step.checkpoint.routineActions);
 const loaded=advanceVillagePopulationEmergencyCheckpoint(canonical,saved,2*PACE,{site:null,frame}),direct=advanceVillagePopulationEmergencyCheckpoint(canonical,step.checkpoint,2*PACE,{site:null,frame});
 assert.deepEqual(loaded.checkpoint,direct.checkpoint);assert.equal(loaded.checkpoint.routineActions!.residents.length,100);
 const old=copy(saved) as any;delete old.routineActions;const migrated=parseVillagePopulationEmergencyCheckpoint(JSON.stringify(old),KEY);
 assert.equal(migrated.routineActions!.absoluteMinute,migrated.life.absoluteMinute);assert.deepEqual(migrated.life,saved.life);assert.deepEqual(migrated.navigation,saved.navigation);assert.deepEqual(migrated.buildingEmergency,saved.buildingEmergency);
 const observer=createVillagePopulationObserver(),observed=observer.observe(canonical,2*PACE,{buildingEmergencyAt:()=>frame});assert.deepEqual(captureVillagePopulationEmergencyCheckpoint(observed)?.routineActions,observed.routineActions);
});

test('forged ordinary clocks, identities, source cursors and unknown queue fields reject without changing canonical state',()=>{
 const start=advance(create(),PACE),before=JSON.stringify(start);
 for(const mutate of [(s:any)=>s.routineActions.absoluteMinute++,(s:any)=>s.routineActions.residents.pop(),(s:any)=>s.routineActions.worldKey='foreign',
  (s:any)=>s.routineActions.residents[0].hiddenCommand=true,(s:any)=>s.routineActions.source={profile:'desktop',sha256:'d'.repeat(64),siteIdentity:'foreign-source'}]){
  const bad=copy(start);mutate(bad);assert.equal(parseVillagePopulationRuntime(JSON.stringify(bad),{worldKey:KEY,contentRevision:REV}).ok,false);
 }
 assert.equal(JSON.stringify(start),before);
});
