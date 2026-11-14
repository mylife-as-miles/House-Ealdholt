import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEaldholtVillageSite,applyVillageSiteRigidClearance,validateVillageSiteRigidClearance} from './village-site';
import {parseVillagePopulationRuntime,serializeVillagePopulationRuntime,sampleVillagePopulationRuntime,createVillagePopulationObserver} from './village-population-runtime';
import {resolvePopulationPresentation,displayPopulationActivity} from './village-activity-presentation';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';
import {getPopulationArt} from './village-population-art';
const DIR=process.env.CROWNFALL_ROUTE_WAIT_FIXTURES??'/workspace/private-assets/crownfall/patrol-forensic-readonly-export-2026-11-11-01';
const SITE_DIR=process.env.CROWNFALL_PATROL_SOURCE_FIXTURES??'/workspace/private-assets/crownfall/fresh-lane-patrol-v4-paired-2026-11-11';
const CANONICAL=`${DIR}/canonical.json`,SOURCE=`${SITE_DIR}/desktop-guard-lane-patrol-v1.json`;
const available=existsSync(CANONICAL)&&existsSync(SOURCE),skip=!available&&'Requires the exact private read-only canonical export and reviewed paired source.';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function load(){
 const bytes=readFileSync(CANONICAL),sourceBytes=readFileSync(SOURCE),raw=JSON.parse(bytes.toString()),data=JSON.parse(sourceBytes.toString());
 assert.equal(sha(bytes),'63b432aabea31a6c9964fd9a0ca823c1f8a55f808748f8ae064f2f2f90ba71aa');
 assert.equal(sha(sourceBytes),'246616a1a26a0f07d7094b8268c14d8cfe1c141686c4d769ea20c87760504461');
 const parsed=parseVillagePopulationRuntime(bytes.toString(),{worldKey:raw.worldKey,contentRevision:raw.contentRevision});assert.ok(parsed.ok);
 const layout=createEaldholtVillageSite({profile:'desktop',modelSha256:data.binding.sourceSha256,binding:data.binding,certificate:data.certificate,
  placeBindings:data.placeBindings,residentPlaceBindings:data.residentPlaceBindings});
 const site=applyVillageSiteRigidClearance(layout,validateVillageSiteRigidClearance(layout,data.rigidSourceClearance));
 return{bytes,data,site,snapshot:parsed.snapshot,evidence:parsePopulationMotionEvidence(data.motionEvidence)};
}
test('the actual outside guard may visibly wait at his reached stand while his future home intent remains indoors', {skip},()=>{
 const f=load(),before=serializeVillagePopulationRuntime(f.snapshot),sample=sampleVillagePopulationRuntime(f.snapshot,f.site);
 const row=sample.residents.find(r=>r.residentId==='ealdholt-spearman-husband')!,journey=f.snapshot.navigation.residents.find(r=>r.residentId===row.residentId)!;
 assert.equal(journey.inside,false);assert.equal(journey.indoor,true);assert.equal(journey.route,null);assert.equal(journey.reason,'destination-reserved');
 assert.equal(row.waitingForRoute,true);assert.equal(row.status,'blocked');assert.equal(row.lifeIntent?.activity,'Rests indoors.');assert.equal(row.lifeIntent?.indoor,true);
 assert.equal(row.arrivalEvidence,'certified-route-arrival');assert.equal(row.arrivedAtAbsoluteMinute,2282.1402619460296);assert.deepEqual(row.position,journey.anchorPosition);
 const presentation=resolvePopulationPresentation(row);assert.equal(presentation.motion,'idle');assert.equal(presentation.waitingForRoute,true);assert.equal(presentation.waitingForResource,undefined);assert.deepEqual(presentation.activity,{});
 assert.deepEqual(qualifyPopulationMotion(row,presentation,f.site,f.evidence,'desktop'),{presentable:true,reason:null});
 assert.equal(row.workPoseQualified,false);assert.equal(row.patrol,undefined);assert.equal(displayPopulationActivity(row),'Waits to leave.');
 for(const overlay of [{alarm:true,activity:'Seeks shelter from raiders.'},{away:true,activity:'Is away.'}])assert.equal(displayPopulationActivity(row,{...overlay,residentId:row.residentId,scheduledPlaceId:row.scheduledPlaceId}),overlay.activity);
 const observer=createVillagePopulationObserver().observe(f.snapshot,f.snapshot.clock.simulatedElapsedMilliseconds,{site:f.site,preferCanonical:true});
 assert.equal(sampleVillagePopulationRuntime(observer,f.site).residents.find(r=>r.residentId===row.residentId)?.waitingForRoute,true);
 assert.equal(serializeVillagePopulationRuntime(observer).ok,false);assert.deepEqual(serializeVillagePopulationRuntime(f.snapshot),before);
 assert.equal(before.ok&&before.json,f.bytes.toString());assert.equal(sha(readFileSync(CANONICAL)),sha(f.bytes));
});
test('actual invisible physical peers still prevent stacking, and the genuinely indoor garrison stays indoors', {skip},()=>{
 const f=load(),rows=sampleVillagePopulationRuntime(f.snapshot,f.site).residents;
 for(const id of ['ealdholt-church-ward','ealdholt-archer-daughter','ealdholt-tanner-son','ealdholt-east-daughter']){
  const row=rows.find(r=>r.residentId===id)!;assert.ok(row.position);assert.equal(row.waitingForRoute,undefined);assert.equal(resolvePopulationPresentation(row).presentable,false);
 }
 const indoor=rows.find(r=>r.residentId==='ealdholt-garrison-spearman')!;assert.equal(indoor.position,null);assert.equal(indoor.waitingForRoute,undefined);assert.equal(resolvePopulationPresentation(indoor).presentable,false);
 for(const site of [Object.freeze({...f.site,sourceSha256:'f'.repeat(64)}),Object.freeze({...f.site,profile:'quest' as const}),
  Object.freeze({...f.site,navigationRevision:'f'.repeat(64)}),
  Object.freeze({...f.site,navigationAllocation:Object.freeze({...f.site.navigationAllocation!,generation:'f'.repeat(64)})}),
  Object.freeze({...f.site,navigationAllocation:Object.freeze({...f.site.navigationAllocation!,questRevision:'f'.repeat(64)})})]){
  assert.ok(sampleVillagePopulationRuntime(f.snapshot,site).residents.every(r=>!r.waitingForRoute&&!r.presentable));
 }
 const changedBinding=Object.freeze({...f.site,residentPlaceBindings:Object.freeze(f.site.residentPlaceBindings.map(b=>
  b.residentId==='ealdholt-spearman-husband'&&b.placeId==='spearman-lane-patrol-v1-turn-1'?Object.freeze({...b,anchorId:'candidate-v1-door-31-positive-1005'}):b))});
 const changed=sampleVillagePopulationRuntime(f.snapshot,changedBinding).residents.find(r=>r.residentId==='ealdholt-spearman-husband')!;
 assert.equal(changed.waitingForRoute,undefined);assert.equal(resolvePopulationPresentation(changed).presentable,false,'The same model identity cannot authorize a changed person-bound point.');
});
test('the route-wait flag grants neither at-target work/seat nor motion with missing or unsafe idle evidence', {skip},()=>{
 const f=load(),row=sampleVillagePopulationRuntime(f.snapshot,f.site).residents.find(r=>r.residentId==='ealdholt-spearman-husband')!,plan=resolvePopulationPresentation(row);
 for(const patch of [{waitingForRoute:undefined},{moving:true},{placeId:row.scheduledPlaceId},{status:'at-place' as const},
  {waitingForResource:true as const},{workPoseQualified:true},{navigationReason:'source-site-changed'},{arrivalEvidence:'none' as const},{position:null}]){
  assert.equal(resolvePopulationPresentation({...row,...patch}).presentable,false);
 }
 assert.equal(qualifyPopulationMotion(row,{...plan,waitingForRoute:undefined},f.site,f.evidence,'desktop').presentable,false,'A neutral route wait is not interchangeable with another idle permission.');
 const idle=getPopulationArt(row.residentId)!.motions.idle;
 for(const edit of [(e:any)=>delete e.residents[row.residentId].levels.crowd.clips[idle],
  (e:any)=>e.residents[row.residentId].levels.crowd.clips[idle].radiusMetres=f.site.capsule.radius+.01,
  (e:any)=>e.residents[row.residentId].levels.crowd.clips[idle].heightMetres=f.site.capsule.height+.01,
  (e:any)=>e.residents[row.residentId].levels.crowd.clips[idle].minimumBodyYMetres=-.031,
  (e:any)=>e.residents[row.residentId].levels.crowd.clips[idle].placedBelowGround=true]){
  const raw=copy(f.data.motionEvidence);edit(raw);assert.equal(qualifyPopulationMotion(row,plan,f.site,parsePopulationMotionEvidence(raw),'desktop').presentable,false);
 }
});
