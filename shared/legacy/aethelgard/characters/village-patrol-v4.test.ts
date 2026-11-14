/** Integration with the real private source candidates, original rig envelopes
 * and separately measured compact watch addon. CPU evidence, not a scene capture. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION} from './village-population';
import {createEaldholtVillageSite,resolveVillageSitePath,type VillageSiteLayout} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,createVillagePopulationObserver,parseVillagePopulationRuntime,serializeVillagePopulationRuntime,sampleVillagePopulationRuntime,type VillagePopulationRuntimeResult,type VillagePopulationRuntime} from './village-population-runtime';
import {resolvePopulationPresentation,displayPopulationActivity} from './village-activity-presentation';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';
const DIR=process.env.CROWNFALL_PATROL_SOURCE_FIXTURES??'/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11';
const MOTION='/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-routine-v1/commute-motion-evidence.json';
const BEFORE='/workspace/private-assets/crownfall/runtime-export-bound-fresh-2026-11-11-1794418478120/population-0.json';
const ORIGINAL='/workspace/private-assets/crownfall/task-v4-readonly-export-2026-11-11/saved-v4.json';
const START=1800000000000,PACE=4000,GUARDS=['ealdholt-spearman-husband','ealdholt-garrison-spearman'];
const accept=(r:VillagePopulationRuntimeResult):VillagePopulationRuntime=>{assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;};
function load(file:string){const raw=JSON.parse(readFileSync(file,'utf8'));return createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});}
function create(){return accept(createVillagePopulationRuntime({population:POPULATION,confirmedEntry:true,worldKey:'resource-queue-unit-fixture',contentRevision:'patrol-source-integration-test',createdAt:START,initialDayMinute:540,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:.8}));}
function step(s:VillagePopulationRuntime,elapsed:number,site:VillageSiteLayout){return accept(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision,observedAt:START+elapsed*PACE,maxAdvanceMinutes:360,site}));}
for(const profile of ['desktop','quest'] as const){
 const file=`${DIR}/${profile}-guard-lane-patrol-v1.json`,base=profile==='desktop'?'/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json':'/workspace/private-assets/crownfall/new-quest-tall-authoring-2026-11-11-01/motion-integration/quest-fresh-commute-sites.json';
 test(`real ${profile} source patrols repeat certified lane legs, qualify genuine walking and preserve abstract lives and restoration`,{skip:(!existsSync(file)||!existsSync(base)||!existsSync(MOTION))&&'Requires private original-source patrol candidates and unchanged sampled motion evidence.'},()=>{
  const site=load(file),legacy=load(base),motionBytes=readFileSync(MOTION);
  assert.equal(createHash('sha256').update(motionBytes).digest('hex'),'09510d2cf4fdd1209e36322838cd11b023e8f26331fb0698c5dad9b792514b62');
  const evidence=parsePopulationMotionEvidence(JSON.parse(motionBytes.toString()));assert.equal(site.patrols?.length,2);
  for(const plan of site.patrols!)for(let i=0;i<plan.waypoints.length;i++){
   const path=resolveVillageSitePath(site,plan.waypoints[i].placeId,plan.waypoints[(i+1)%plan.waypoints.length].placeId,plan.residentId);
   // The first Desktop turn is source-derived1.8m before the steward's
   // independently owned stand: an explicitly limited3.63m local-lane leg.
   const minimum=profile==='desktop'&&plan.id==='spearman-lane-patrol-v1'?3.5:4;
   assert.ok(path&&path.lengthMetres>=minimum,'a source circuit retains its declared, measured length and existing body reservations');
  }
  let s=step(create(),239,site),ordinary=step(create(),239,legacy),restored=s;
  const moving=new Set<string>(),cycles=new Set<string>(),watching=new Set<string>();
  for(let elapsed=240;elapsed<=300;elapsed++){
   s=step(s,elapsed,site);ordinary=step(ordinary,elapsed,legacy);
   const encoded=serializeVillagePopulationRuntime(restored);assert.ok(encoded.ok);
   restored=step(accept(parseVillagePopulationRuntime(encoded.json,{worldKey:restored.worldKey,contentRevision:restored.contentRevision})),elapsed,site);
   assert.deepEqual(restored.navigation,s.navigation,'reload cannot restart or accelerate a patrol phase');
   assert.deepEqual(s.life,ordinary.life,'physical circuits create no extra duty completions, memories, events or logical resource holds');
   const before=serializeVillagePopulationRuntime(s),sample=sampleVillagePopulationRuntime(s,site);
   for(const id of GUARDS){
    const row=sample.residents.find(r=>r.residentId===id)!,journey=s.navigation.residents.find(r=>r.residentId===id)!;
    if((journey.patrol?.completedLegs??0)>=3)cycles.add(id);
    if(row.patrol?.phase==='travelling'){
     const plan=resolvePopulationPresentation(row);assert.equal(row.moving,true);assert.equal(plan.motion,'walk');assert.equal(plan.activity.roleClip,'guard_patrol_walk');
     assert.equal(row.arrivalEvidence,'none');assert.equal(row.workPoseQualified,false);assert.equal(row.waitingForResource,undefined);
     assert.deepEqual(qualifyPopulationMotion(row,plan,site,evidence,profile),{presentable:true,reason:null});assert.equal(displayPopulationActivity(row),'Patrols the lane.');moving.add(id);
    }else if(row.patrol?.phase==='dwelling'){
     const plan=resolvePopulationPresentation(row);
     if(id==='ealdholt-garrison-spearman'&&row.presentable&&row.status==='at-place'){
      assert.equal(plan.presentable,true,'the published guard has its separately measured compact transitions');
      assert.equal(plan.guardWatch,true);assert.equal(plan.activity.roleClip,'guard_stand_watch_d');
      assert.ok(['workEnter','work','workExit'].includes(plan.motion!),'watching cannot borrow ordinary idle');
      assert.equal(row.workPoseQualified,false,'a patrol pose creates no generic workplace permission');
      assert.deepEqual(qualifyPopulationMotion(row,plan,site,evidence,profile),{presentable:true,reason:null});watching.add(id);
     }else assert.equal(plan.presentable,false,'unpublished or source-held watch transitions remain held');
     assert.equal(displayPopulationActivity(row),'Pauses on the lane.');assert.equal(row.arrivalEvidence,'certified-route-arrival');
    }
   }
   assert.deepEqual(serializeVillagePopulationRuntime(s),before,'presentation and qualification cannot rewrite the save');
  }
  assert.deepEqual([...moving].sort(),[...GUARDS].sort());assert.deepEqual([...cycles].sort(),[...GUARDS].sort());
  assert.deepEqual([...watching],['ealdholt-garrison-spearman'],'only the actual published guard gains watch presentation');
  assert.equal(s.population.residents.length,100);assert.equal(s.population.households.length,25);assert.ok(s.navigation.residents.filter(r=>r.patrol).every(r=>GUARDS.includes(r.residentId)));
  const observer=createVillagePopulationObserver().observe(s,s.clock.simulatedElapsedMilliseconds,{site,preferCanonical:true});
  assert.deepEqual(sampleVillagePopulationRuntime(observer,site).residents,sampleVillagePopulationRuntime(s,site).residents);assert.equal(serializeVillagePopulationRuntime(observer).ok,false);
 });
}
test('both exact existing task saves remain byte-identical and never adopt a new patrol allocation',{skip:(!existsSync(`${DIR}/desktop-guard-lane-patrol-v1.json`)||!existsSync(BEFORE)||!existsSync(ORIGINAL))&&'Requires private exact read-only exports and new source candidate.'},()=>{
 const site=load(`${DIR}/desktop-guard-lane-patrol-v1.json`);
 for(const [file,hash]of [[BEFORE,'6127961eb6daadd540289ec0783d5cc729bbd878e70a0dba65e81bb80ca9477a'],[ORIGINAL,'1ab992ca5c3d45c0797d52478ac9316f46a2f04c305849bc8595562b2c47388f']]){
  const bytes=readFileSync(file),text=bytes.toString(),raw=JSON.parse(text),s=accept(parseVillagePopulationRuntime(text,{worldKey:raw.worldKey,contentRevision:raw.contentRevision})),before=serializeVillagePopulationRuntime(s);assert.ok(before.ok);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.equal(before.json,text,'old save shape/keys remain exactly round-trippable');
  const sample=sampleVillagePopulationRuntime(s,site);assert.ok(sample.residents.every(r=>r.position===null&&!r.presentable&&!r.patrol&&!r.waitingForResource));
  const next=accept(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision,observedAt:s.clock.lastObservedAt,maxAdvanceMinutes:1,site}));
  assert.equal(next.navigation.siteIdentity,s.navigation.siteIdentity);assert.equal(next.navigation.sourceSha256,s.navigation.sourceSha256);assert.ok(next.navigation.residents.every(r=>r.patrol===undefined));
  for(const prior of s.navigation.residents){const now=next.navigation.residents.find(r=>r.residentId===prior.residentId)!;assert.deepEqual(now.anchorPosition,prior.anchorPosition);assert.deepEqual(now.route,prior.route);assert.equal(now.progressMetres,prior.progressMetres);}
  assert.deepEqual(serializeVillagePopulationRuntime(s),before);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
 }
});
