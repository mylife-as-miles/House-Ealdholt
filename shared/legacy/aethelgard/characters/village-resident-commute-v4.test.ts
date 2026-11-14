/** Original-source CPU journey evidence. This cannot establish a rendered body
 * or a filmed journey; no existing world/profile is opened or rebound. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {createEaldholtVillageSite,applyVillageSiteRigidClearance,validateVillageSiteRigidClearance,resolveVillageSitePath} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,sampleVillagePopulationRuntime,parseVillagePopulationRuntime,
  serializeVillagePopulationRuntime,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';
import {resolvePopulationPresentation} from './village-activity-presentation';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';

const file=process.env.CROWNFALL_RESIDENT_PRESENCE_SITE_V4??'/workspace/private-assets/crownfall/new-motion-evidence-2026-11-11/fresh-candidate-integration-v4-release-ready/desktop-fresh-commute-sites.json';
const accept=(result:VillagePopulationRuntimeResult):VillagePopulationRuntime=>{assert.ok(result.ok,result.ok?'':result.error);return result.snapshot;};

test('current source serjeant physically commutes home to his legitimate lane duty and home with normal-speed asset-qualified gait',{
  skip:!existsSync(file)&&'Requires the private exact fc60 source site and its original sampled rig evidence.'
},()=>{
  const bytes=readFileSync(file),beforeHash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(beforeHash,'fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475');
  const raw=JSON.parse(bytes.toString()),layout=createEaldholtVillageSite({profile:'desktop',modelSha256:raw.binding.sourceSha256,
    binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
  const site=applyVillageSiteRigidClearance(layout,validateVillageSiteRigidClearance(layout,raw.rigidSourceClearance)),motion=parsePopulationMotionEvidence(raw.motionEvidence);
  const id='ealdholt-guard-serjeant',resident=population.residents.find(r=>r.id===id)!,home=resident.homePlaceId,duty='proposed-lanes';
  const path=resolveVillageSitePath(site,home,duty,id)!;assert.ok(path.lengthMetres>6&&path.lengthMetres<7);
  // A source-qualified lane-round duty is a bounded minimum. The drill yard
  // and the smith's actual forge remain unqualified by this test.
  assert.equal(resolveVillageSitePath(site,home,'proposed-guard-yard',id),null);
  assert.equal(resolveVillageSitePath(site,'smithy-house','smithy-forge','ealdholt-village-smith'),null);
  const createdAt=1800000000000,pace=4000;
  let state=accept(createVillagePopulationRuntime({population,confirmedEntry:true,worldKey:'resident-route-source-audit',contentRevision:'source-route-audit',
    createdAt,initialDayMinute:540,millisecondsPerWorldMinute:pace,walkingSpeedMetresPerSecond:.8}));
  const advance=(snapshot:VillagePopulationRuntime,observedAt:number)=>accept(advanceVillagePopulationRuntime(snapshot,{expectedGeneration:snapshot.generation,
    worldKey:snapshot.worldKey,contentRevision:snapshot.contentRevision,observedAt,maxAdvanceMinutes:1,site}));
  const starts=new Map<string,number>(),arrivals=new Map<string,number>();let gaitFrames=0;
  for(let minute=540;minute<=723;minute++){
    const observedAt=createdAt+(minute-540)*pace;state=advance(state,observedAt);
    const journey=state.navigation.residents.find(r=>r.residentId===id)!;
    if(journey.route&&journey.status==='travelling'){
      const key=`${journey.originPlaceId}:${journey.destinationPlaceId}`;
      assert.ok(key===`${home}:${duty}`||key===`${duty}:${home}`);starts.set(key,journey.startedAbsoluteMinute!);
      assert.equal(journey.arrivalEvidence,'none');assert.equal(journey.arrivedAtAbsoluteMinute,null);
      let continuous=state;
      for(let tick=0;tick<16;tick++){
        continuous=advance(continuous,observedAt+tick*250);
        const row=sampleVillagePopulationRuntime(continuous,site).residents.find(r=>r.residentId===id)!,cursor=continuous.navigation.residents.find(r=>r.residentId===id)!;
        const presentation=resolvePopulationPresentation(row);assert.equal(row.moving,true);assert.equal(row.presentable,true);assert.equal(presentation.motion,'walk');
        assert.deepEqual(qualifyPopulationMotion(row,presentation,site,motion,'desktop',{profile:'desktop',sha256:site.sourceSha256}),{presentable:true,reason:null});
        assert.ok(Math.abs(cursor.progressMetres-((minute+tick/16)-cursor.startedAbsoluteMinute!)*3.2)<1e-6,'physical arc length advances at exactly0.8metres per normal second');
        const encoded=serializeVillagePopulationRuntime(continuous);assert.ok(encoded.ok);
        const restored=accept(parseVillagePopulationRuntime(encoded.json,{worldKey:state.worldKey,contentRevision:state.contentRevision}));
        assert.deepEqual(sampleVillagePopulationRuntime(restored,site),sampleVillagePopulationRuntime(continuous,site));
        gaitFrames++;
      }
    }
    if(journey.arrivalEvidence==='certified-route-arrival'&&journey.arrivedAtAbsoluteMinute!==null){
      const key=`${journey.originPlaceId}:${journey.destinationPlaceId}`;arrivals.set(key,journey.arrivedAtAbsoluteMinute);
    }
  }
  assert.equal(starts.get(`${home}:${duty}`),633);assert.equal(starts.get(`${duty}:${home}`),720);
  for(const key of [`${home}:${duty}`,`${duty}:${home}`])assert.ok(Math.abs(arrivals.get(key)!-starts.get(key)!-path.lengthMetres/3.2)<1e-7);
  assert.equal(gaitFrames,64);const final=state.navigation.residents.find(r=>r.residentId===id)!;
  assert.equal(final.anchorPlaceId,home);assert.equal(final.status,'indoors');assert.equal(final.inside,true);
  assert.equal(sampleVillagePopulationRuntime(state,site).residents.find(r=>r.residentId===id)!.position,null);
  assert.equal(state.population.residents.length,100);assert.equal(state.population.households.length,25);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),beforeHash);
});
