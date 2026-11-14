/** Private-source integration. These are the final measured Desktop v4 site
 * and unchanged sampled animation evidence, not synthetic scene replacements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as POPULATION} from './village-population';
import {createEaldholtVillageSite} from './village-site';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';
import {resolvePopulationPresentation} from './village-activity-presentation';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,createVillagePopulationObserver,
  sampleVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationRuntime,
  type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';

const root='/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11';
const siteFile=process.env.CROWNFALL_RESIDENT_PRESENCE_SITE_V4??`${root}/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json`;
const motionFile=process.env.CROWNFALL_RESIDENT_PRESENCE_MOTION??`${root}/fresh-routine-v1/commute-motion-evidence.json`;
const savedFile=process.env.CROWNFALL_RESIDENT_PRESENCE_SAVED_V4??'/workspace/private-assets/crownfall/task-v4-readonly-export-2026-11-11/saved-v4.json';
const accept=(r:VillagePopulationRuntimeResult):VillagePopulationRuntime=>{assert.ok(r.ok,r.ok?'':r.error);return r.snapshot;};

test('final Desktop v4 stands safely show real queued residents waiting, with unchanged life/source/observer evidence',{
  skip:(!existsSync(siteFile)||!existsSync(motionFile))&&'Requires the private final v4 Desktop source site and unchanged sampled motion evidence.'
},()=>{
  const siteBytes=readFileSync(siteFile),motionBytes=readFileSync(motionFile);
  assert.equal(createHash('sha256').update(siteBytes).digest('hex'),'fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475');
  assert.equal(createHash('sha256').update(motionBytes).digest('hex'),'09510d2cf4fdd1209e36322838cd11b023e8f26331fb0698c5dad9b792514b62');
  const raw=JSON.parse(siteBytes.toString()),site=createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,
    binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
  const evidence=parsePopulationMotionEvidence(JSON.parse(motionBytes.toString())),createdAt=1800000000000,pace=4000;
  let s=accept(createVillagePopulationRuntime({population:POPULATION,confirmedEntry:true,worldKey:'resource-queue-unit-fixture',contentRevision:'presence-v4-test',
    createdAt,initialDayMinute:540,millisecondsPerWorldMinute:pace,walkingSpeedMetresPerSecond:.8}));
  const advance=(elapsed:number)=>{const r=advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:s.worldKey,contentRevision:s.contentRevision,
    observedAt:createdAt+elapsed*pace,maxAdvanceMinutes:40,site});assert.ok(r.ok,r.ok?'':r.error);s=r.snapshot;};
  advance(0);
  for(const elapsed of [20,32]){
    advance(elapsed);
    const before=serializeVillagePopulationRuntime(s);assert.ok(before.ok);
    const sample=sampleVillagePopulationRuntime(s,site),waiting=sample.residents.filter(r=>r.waitingForResource);
    assert.ok(waiting.some(r=>r.residentId==='ealdholt-brewster'),'the known courtyard queue has a safe real exterior wait');
    for(const row of waiting){
      const plan=resolvePopulationPresentation(row);
      if(!plan.presentable){assert.equal(plan.reason,'waiting-activity-unqualified','unpublished work cannot borrow idle');continue;}
      assert.equal(plan.motion,'idle');assert.deepEqual(plan.activity,{});assert.equal(plan.waitingForResource,true);
      assert.equal(row.lifeStatus,'queued');assert.equal(row.workPoseQualified,false);
      assert.deepEqual(qualifyPopulationMotion(row,plan,site,evidence,'desktop'),{presentable:true,reason:null});
      assert.equal(qualifyPopulationMotion(row,plan,site,null,'desktop').presentable,false);
      assert.equal(qualifyPopulationMotion(row,plan,site,evidence,'quest').reason,'motion-site-unavailable','the Desktop wait is not Quest geometry proof');
    }
    // A fresh commute may still keep the basket weaver behind her reserved
    // doorway. Being queued never permits exposing an indoor anchor instead.
    const basket=sample.residents.find(r=>r.residentId==='ealdholt-basket-weaver')!;
    if(basket.position===null){assert.equal(basket.presentable,false);assert.equal(basket.waitingForResource,undefined);}
    assert.ok(sample.residents.filter(r=>r.navigationStatus==='waiting'&&r.position===null).every(r=>!r.presentable&&!r.waitingForResource));
    assert.deepEqual(serializeVillagePopulationRuntime(s),before,'sampling/qualification cannot change the live save');
    const restored=accept(parseVillagePopulationRuntime(before.json,{worldKey:s.worldKey,contentRevision:s.contentRevision}));
    assert.deepEqual(sampleVillagePopulationRuntime(restored,site),sample);
    const observer=createVillagePopulationObserver().observe(s,elapsed*pace,{site,preferCanonical:true});
    assert.deepEqual(sampleVillagePopulationRuntime(observer,site).residents,sample.residents);
    assert.equal(serializeVillagePopulationRuntime(observer).ok,false);
    assert.deepEqual(serializeVillagePopulationRuntime(s),before);
    assert.equal(s.population.residents.length,100);assert.equal(s.population.households.length,25);
  }
});

test('the exact existing saved v4 village restores unchanged and corrects exterior rest only on its next normal decision',{
  skip:(!existsSync(siteFile)||!existsSync(savedFile))&&'Requires the private final v4 site and read-only exported existing task save.'
},()=>{
  const savedBytes=readFileSync(savedFile),originalHash='1ab992ca5c3d45c0797d52478ac9316f46a2f04c305849bc8595562b2c47388f';
  assert.equal(createHash('sha256').update(savedBytes).digest('hex'),originalHash);
  const original=JSON.parse(savedBytes.toString()),loaded=accept(parseVillagePopulationRuntime(savedBytes.toString(),
    {worldKey:original.worldKey,contentRevision:original.contentRevision}));
  const restored=serializeVillagePopulationRuntime(loaded);assert.ok(restored.ok);
  assert.deepEqual(JSON.parse(restored.json),original,'restore does not migrate, reset or rewrite old indoor classification');
  const rests=loaded.life.residents.filter(r=>r.intent.activity==='Rests indoors.'&&r.intent.targetPlaceId===r.homePlaceId);
  assert.ok(rests.length>0);assert.ok(rests.every(r=>r.intent.indoor===false),'exercise the actual saved legacy bug');
  const raw=JSON.parse(readFileSync(siteFile,'utf8')),site=createEaldholtVillageSite({profile:raw.binding.profile,modelSha256:raw.binding.sourceSha256,
    binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
  const before=sampleVillagePopulationRuntime(loaded,site);
  const exteriorRests=rests.filter(r=>before.residents.find(row=>row.residentId===r.residentId)!.position!==null);
  assert.ok(exteriorRests.length>0,'the saved bug really owns exterior stands, not just text labels');
  assert.deepEqual(serializeVillagePopulationRuntime(loaded),restored,'sampling does not perform the repair');
  const next=accept(advanceVillagePopulationRuntime(loaded,{expectedGeneration:loaded.generation,worldKey:loaded.worldKey,contentRevision:loaded.contentRevision,
    observedAt:loaded.clock.lastObservedAt,maxAdvanceMinutes:1,site}));
  assert.equal(next.life.absoluteMinute,loaded.life.absoluteMinute+1);
  assert.equal(next.clock.simulatedElapsedMilliseconds,loaded.clock.simulatedElapsedMilliseconds+loaded.clock.millisecondsPerWorldMinute);
  assert.equal(next.clock.pendingMilliseconds,loaded.clock.pendingMilliseconds-loaded.clock.millisecondsPerWorldMinute);
  for(const field of ['createdAt','initialDayMinute','millisecondsPerWorldMinute'] as const)assert.equal(next.clock[field],loaded.clock[field]);
  assert.equal(next.worldKey,loaded.worldKey);assert.equal(next.contentRevision,loaded.contentRevision);
  assert.equal(next.walkingSpeedMetresPerSecond,loaded.walkingSpeedMetresPerSecond);
  assert.deepEqual(next.population,loaded.population);assert.deepEqual(next.rosterFacts,loaded.rosterFacts);
  assert.equal(next.navigation.sourceSha256,loaded.navigation.sourceSha256);assert.equal(next.navigation.siteIdentity,loaded.navigation.siteIdentity);
  const after=sampleVillagePopulationRuntime(next,site);
  for(const resident of rests){
    const corrected=next.life.residents.find(r=>r.residentId===resident.residentId)!,sample=after.residents.find(r=>r.residentId===resident.residentId)!;
    assert.equal(corrected.intent.indoor,true);assert.equal(sample.position,null);assert.equal(sample.presentable,false);assert.equal(sample.waitingForResource,undefined);
  }
  for(const resident of exteriorRests){
    const was=loaded.navigation.residents.find(r=>r.residentId===resident.residentId)!,now=next.navigation.residents.find(r=>r.residentId===resident.residentId)!;
    for(const field of ['anchorPlaceId','anchorPosition','sourceSha256','sourceSiteIdentity','route','progressMetres','arrivalEvidence','arrivedAtAbsoluteMinute'] as const)
      assert.deepEqual(now[field],was[field],`${resident.residentId}: ${field}`);
    assert.equal(now.inside,true);assert.equal(now.status,'indoors');
  }
  for(const prior of loaded.life.residents){
    const now=next.life.residents.find(r=>r.residentId===prior.residentId)!;
    for(const key of Object.keys(prior.counters) as (keyof typeof prior.counters)[])assert.ok(now.counters[key]>=prior.counters[key],`${prior.residentId}: no counter reset`);
  }
  const retained=next.life.journal.filter(e=>e.sequence<loaded.life.nextEventSequence);
  assert.deepEqual(retained,loaded.life.journal.slice(-retained.length));
  assert.ok(next.life.nextEventSequence>=loaded.life.nextEventSequence);
  const observer=createVillagePopulationObserver().observe(loaded,loaded.clock.simulatedElapsedMilliseconds+loaded.clock.millisecondsPerWorldMinute,{site});
  assert.deepEqual(observer.life,next.life);assert.deepEqual(observer.navigation,next.navigation);
  assert.equal(serializeVillagePopulationRuntime(observer).ok,false);
  assert.deepEqual(serializeVillagePopulationRuntime(loaded),restored);
  assert.equal(createHash('sha256').update(readFileSync(savedFile)).digest('hex'),originalHash,'the exact exported save remains byte-identical on disk');
});
