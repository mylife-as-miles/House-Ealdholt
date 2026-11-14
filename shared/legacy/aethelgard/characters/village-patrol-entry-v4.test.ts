/** Actual-source CPU regression, not a prepared scene or a replacement save.
 * The exported original world and source packages remain immutable inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEaldholtVillageSite,applyVillageSiteRigidClearance,validateVillageSiteRigidClearance} from './village-site';
import {parseVillagePopulationRuntime,serializeVillagePopulationRuntime,advanceVillagePopulationRuntime,sampleVillagePopulationRuntime,type VillagePopulationRuntime} from './village-population-runtime';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';
import {resolvePopulationPresentation} from './village-activity-presentation';
const DIR=process.env.CROWNFALL_PATROL_SOURCE_FIXTURES??'/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11';
const RAW=process.env.CROWNFALL_PATROL_ENTRY_CANONICAL??'/workspace/private-assets/crownfall/patrol-forensic-readonly-export-2026-11-11-01/canonical.json';
const BASELINE=process.env.CROWNFALL_PATROL_ENTRY_BASELINE??'/workspace/private-assets/crownfall/patrol-liveness-audit-2026-11-11-02/full-day-canonical-liveness.json';
const SOURCE=DIR+'/desktop-guard-lane-patrol-v1.json',sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const available=existsSync(RAW)&&existsSync(SOURCE)&&existsSync(BASELINE);
const CHILDREN=['ealdholt-church-ward','ealdholt-archer-daughter','ealdholt-tanner-son','ealdholt-east-daughter'];
function accept(result:ReturnType<typeof advanceVillagePopulationRuntime>):VillagePopulationRuntime{assert.ok(result.ok,result.ok?'':result.error);return result.snapshot;}

test('the real blocked garrison may enter a clear authored lane without moving children or inventing work/circuit credit',
 {skip:!available&&'Requires exact private actual-world, source and pre-entry liveness evidence.',timeout:180000},()=>{
 const bytes=readFileSync(RAW),sourceBytes=readFileSync(SOURCE),baselineBytes=readFileSync(BASELINE),raw=JSON.parse(bytes.toString()),data=JSON.parse(sourceBytes.toString());
 assert.equal(sha(bytes),'63b432aabea31a6c9964fd9a0ca823c1f8a55f808748f8ae064f2f2f90ba71aa');
 assert.equal(sha(sourceBytes),'246616a1a26a0f07d7094b8268c14d8cfe1c141686c4d769ea20c87760504461');
 assert.equal(sha(baselineBytes),'ecbeeb7e736aa126448c04cb44d02314db4ed5fd412e7186e8080ce9291609ab');
 const baseline=JSON.parse(baselineBytes.toString());assert.equal(baseline.canonicalSha256,sha(bytes));assert.equal(baseline.siteSha256,sha(sourceBytes));assert.equal(baseline.fullWorldDayCompleted,true);
 assert.equal(baseline.guards.find((r:any)=>r.residentId==='ealdholt-garrison-spearman').arrivals,0,'The frozen pre-entry continuation reproduces the real zero-travel case.');
 const parsed=parseVillagePopulationRuntime(bytes.toString(),{worldKey:raw.worldKey,contentRevision:raw.contentRevision});assert.ok(parsed.ok);
 const initial=parsed.snapshot,before=serializeVillagePopulationRuntime(initial);assert.ok(before.ok);assert.equal(before.json,bytes.toString());
 const source=createEaldholtVillageSite({profile:'desktop',modelSha256:data.binding.sourceSha256,binding:data.binding,certificate:data.certificate,
  placeBindings:data.placeBindings,residentPlaceBindings:data.residentPlaceBindings});
 const site=applyVillageSiteRigidClearance(source,validateVillageSiteRigidClearance(source,data.rigidSourceClearance));
 const evidence=parsePopulationMotionEvidence(data.motionEvidence),id='ealdholt-garrison-spearman';
 let live=initial,abstract=initial,arrivals=0,entryMotionSamples=0,entryArrivals=0,maxCircuitLegs=0;
 const childPoints=new Map(CHILDREN.map(id=>[id,initial.navigation.residents.find(r=>r.residentId===id)!.anchorPosition]));
 for(let index=0;index<1440;index++){
  const at=Math.max(live.clock.lastObservedAt,live.clock.createdAt+live.clock.simulatedElapsedMilliseconds+live.clock.millisecondsPerWorldMinute);
  const prior=live.navigation.residents.find(r=>r.residentId===id)!;
  live=accept(advanceVillagePopulationRuntime(live,{expectedGeneration:live.generation,worldKey:live.worldKey,contentRevision:live.contentRevision,observedAt:at,maxAdvanceMinutes:1,site}));
  abstract=accept(advanceVillagePopulationRuntime(abstract,{expectedGeneration:abstract.generation,worldKey:abstract.worldKey,contentRevision:abstract.contentRevision,observedAt:at,maxAdvanceMinutes:1,site:null}));
  const journey=live.navigation.residents.find(r=>r.residentId===id)!;
  if(journey.arrivedAtAbsoluteMinute!==null&&journey.arrivedAtAbsoluteMinute!==prior.arrivedAtAbsoluteMinute)arrivals++;
  maxCircuitLegs=Math.max(maxCircuitLegs,journey.patrol?.completedLegs??0);
  for(const child of CHILDREN){
   const row=live.navigation.residents.find(r=>r.residentId===child)!;
   assert.deepEqual(row.anchorPosition,childPoints.get(child),'An exterior child is not moved to make room.');assert.equal(row.inside,false);
  }
  if(journey.patrolEntry?.waypointIndex!==undefined&&journey.patrolEntry.waypointIndex!==null&&journey.route){
   entryMotionSamples++;assert.equal(journey.patrol,undefined);assert.equal(journey.arrivalEvidence,'none');
   const state=sampleVillagePopulationRuntime(live,site).residents.find(r=>r.residentId===id)!,presentation=resolvePopulationPresentation(state);
   assert.equal(state.workPoseQualified,false);assert.equal(state.waitingForResource,undefined);assert.equal(state.moving,true);
   assert.equal(presentation.motion,'walk');assert.equal(presentation.activity.roleClip,'guard_patrol_walk');
   assert.deepEqual(qualifyPopulationMotion(state,presentation,site,evidence,'desktop'),{presentable:true,reason:null});
   const hour=((live.navigation.absoluteMinute%1440)+1440)%1440;assert.ok(hour>=780&&hour<960,'Only the real authored13–16 patrol duty selects an entry.');
  }
  if(prior.patrolEntry?.waypointIndex!==undefined&&prior.patrolEntry.waypointIndex!==null&&!journey.patrolEntry&&journey.patrol){
   entryArrivals++;assert.equal(journey.arrivalEvidence,'certified-route-arrival');assert.equal(journey.patrol.completedLegs,0,'A real entry arrival is not a recurring circuit leg.');
  }
  if(index%120===0||journey.patrolEntry||journey.patrol){
   assert.deepEqual(live.life,abstract.life,'Physical target choice creates no extra logical work/resources/family events or counters.');
  }
  if(index%240===0||entryArrivals===1&&prior.patrolEntry){
   const encoded=serializeVillagePopulationRuntime(live);assert.ok(encoded.ok);const restored=parseVillagePopulationRuntime(encoded.json,{worldKey:live.worldKey,contentRevision:live.contentRevision});assert.ok(restored.ok);assert.deepEqual(restored.snapshot.navigation,live.navigation);
  }
 }
 assert.ok(arrivals>0,'The same garrison which had zero real arrivals must actually travel.');
 assert.ok(entryMotionSamples>0);assert.ok(entryArrivals>0);assert.ok(maxCircuitLegs>0);
 assert.deepEqual(live.life,abstract.life);assert.equal(live.population,initial.population);assert.equal(live.clock.createdAt,initial.clock.createdAt);assert.deepEqual(live.navigation.navigationAllocation,initial.navigation.navigationAllocation);
 assert.deepEqual(serializeVillagePopulationRuntime(initial),before);assert.equal(sha(readFileSync(RAW)),sha(bytes));assert.equal(sha(readFileSync(SOURCE)),sha(sourceBytes));assert.equal(sha(readFileSync(BASELINE)),sha(baselineBytes));
});
