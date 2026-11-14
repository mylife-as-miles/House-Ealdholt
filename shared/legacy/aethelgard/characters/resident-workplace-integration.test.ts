import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files} from './population-asset-integrity';
import {parsePopulationMotionEvidence} from './population-motion-clearance';
import {requiredVillageWorkplaceMotionClips,parseVillageSiteWorkplaceRoutes,type VillageSiteWorkplaceRoute} from './village-workplace-routes';
import {resolveVillageSiteEndpoint,type VillageSiteLayout,type VillageSitePoint} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,serializeVillagePopulationRuntime,parseVillagePopulationRuntime,
 sampleVillagePopulationRuntime,createVillagePopulationObserver,reportVillagePopulationSafetySignals,captureVillagePopulationEmergencyCheckpoint,
 parseVillagePopulationEmergencyCheckpoint,advanceVillagePopulationEmergencyCheckpoint,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';
import {parseVillageTimberCatalogue} from '../observer/village-timber-supply';
import type {ResidentWorkplaceFrame} from './resident-workplace-frame';
import type {ResidentWorkstation,ResidentWorkstationObservation} from './resident-workstations';
import {resolvePopulationPresentation} from './village-activity-presentation';

const START=1800000000000,PACE=4000,INITIAL=600,WORLD='workplace-integration-unit-world-1',REV='workplace-integration-unit-v1',sha='a'.repeat(64);
const mason=population.residents.find(p=>p.id==='ealdholt-master-mason')!,PLACE='woodland-edge',STATION='unit-community-chop',SOURCE='unit-original-raw-pile';
const sourceIdentity='desktop:'+sha+':source-site',source={profile:'desktop' as const,sha256:sha,siteIdentity:sourceIdentity};
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function accepted(result:VillagePopulationRuntimeResult):VillagePopulationRuntime{if(!result.ok)assert.fail(result.error);return result.snapshot;}
const bottom=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]];

/** Entirely synthetic source-contract fixture. Actual published file IDs and
 * clip names satisfy the same strict metadata path as source qualification;
 * numeric envelopes/terrain assertions here are mocks, not real GLB evidence.
 * No scene, image, private model, teleport or forged completed job is used. */
function fixture(options:{contacts?:boolean;release?:boolean;fullyWeighted?:boolean;pose?:boolean}={}){
 const anchors=population.residents.map((person,i)=>{const p:VillageSitePoint=person.id===mason.id?[0,0,0]:[100+i*10,0,100];return{id:'unit-home-'+i,sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const};});
 const home=anchors[population.residents.findIndex(p=>p.id===mason.id)],junction={id:'unit-junction',sourceActor:'unit-original-terrain',sourceGroundPoint:[3,0,0]as VillageSitePoint,capsuleBottomPoint:[3,.02,0]as VillageSitePoint,standingOnly:true as const};
 const route=(id:string,from:string,to:string,g:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:g,capsuleBottomPolyline:g.map(bottom),lengthMetres:g.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-g[i][k])),0)});
 const base=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:[...anchors,junction],routes:[route('unit-original-lane',home.id,junction.id,[home.sourceGroundPoint,junction.sourceGroundPoint])],placeBindings:[],residentPlaceBindings:population.residents.map((person,i)=>({residentId:person.id,placeId:person.homePlaceId,anchorId:anchors[i].id,status:'mapped-exterior'}))})as VillageSiteLayout;
 const neutral=requiredVillageWorkplaceMotionClips(mason.id),clips=Object.fromEntries(neutral.map(name=>[name,{radiusMetres:.4,heightMetres:1.2,minimumBodyYMetres:-.01,placedBelowGround:false}]));
 const motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[mason.id]:{levels:{crowd:{files:{...files},clips}}}}});
 const p:VillageSitePoint=[6,0,3],anchor={id:'unit-timber-stand',sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const};
 const cap=parseVillageSiteWorkplaceRoutes([{id:'unit-community-route',residentId:mason.id,purpose:'community-timber',placeId:PLACE,anchorId:anchor.id,sourceActor:anchor.sourceActor,certificateSha256:'b'.repeat(64),body:{radius:.67,height:2.1,margin:.005,lift:.02,zeroCrossfade:true},proof:{sourceSha256:sha,profile:'desktop',siteIdentity:'unit-source-artifact',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,publicExteriorOnly:true,motionEvidence:motion},topology:{anchor,route:route('unit-work-connector',junction.id,anchor.id,[junction.sourceGroundPoint,[3,0,3],p])}}])[0] as VillageSiteWorkplaceRoute;
 const site=freeze({...base,workplaceRoutes:[cap]});
 const measurement={radiusMetres:1.3,heightMetres:2.6,minimumBodyYMetres:0,placedBelowGround:false},marker='unit-authored-chop-contact',contactPoint:VillageSitePoint=[6,1,3];
 const station=freeze({station:{id:STATION,residentId:mason.id,placeId:PLACE,anchorId:anchor.id,source,clip:'work_chop_wood',certificateSha256:'c'.repeat(64),durationWorldMinutes:1,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-chopping-block'}},resourceId:'unit-shared-block',standPosition:p,yawRadians:Math.PI/2,maximumStandDistanceMetres:.05,maximumFacingErrorRadians:.05,contactPoint,maximumToolContactDistanceMetres:.05,markerIds:[marker]} satisfies ResidentWorkstation);
 const timberCatalogue=parseVillageTimberCatalogue({sources:[{id:SOURCE,profile:'desktop',sourceSha256:sha,siteIdentity:sourceIdentity,sourceActor:'unit-original-raw-pile',sourceInstance:'node:1298',transformSha256:'d'.repeat(64),certificateSha256:'e'.repeat(64),rawUnits:1,timberPerUnit:12}],operations:[{sourceId:SOURCE,residentId:mason.id,stationId:STATION,placeId:PLACE,stationCertificateSha256:'c'.repeat(64),clip:'work_chop_wood',contactSourceActor:'unit-original-chopping-block',requiredWorldMinutes:1}]});
 const observations:{at:number;phase:string;elapsed:number;contact:boolean;released:boolean}[]=[];
 const frame:ResidentWorkplaceFrame={source,catalog:[station],timberCatalogue,presentation:[{stationId:STATION,certificateSha256:'c'.repeat(64),body:{radius:1.35,height:2.65,margin:.005,lift:.02},clipMeasurement:measurement,clipMeasurements:{work_chop_wood_enter:measurement,work_chop_wood:measurement,work_chop_wood_exit:measurement},files:{...files}}],assignments:[{id:'unit-material-subtask',residentId:mason.id,placeId:PLACE,routeId:cap.id,sourceId:SOURCE,activity:'Prepares finite timber for the village repairs.',stockTargetTimber:12}],
  observe(context,entry,timing):ResidentWorkstationObservation|null{
   if(!entry||!context.queue)return null;assert.equal(timing.millisecondsPerWorldMinute,PACE);
   const phase=context.queue.current!,elapsed=(context.absoluteMinute-(entry.phaseStartedAtMinute??entry.lease.sinceMinute))*timing.millisecondsPerWorldMinute/1000;
   const performing=phase==='perform',releasing=phase==='release',released=releasing&&elapsed>=1.6&&options.release!==false,contact=performing&&elapsed>=1.12&&options.contacts!==false;
   const activeClip=released?'idle_a':releasing?'work_chop_wood_exit':performing?'work_chop_wood':'work_chop_wood_enter';
   observations.push({at:context.absoluteMinute,phase,elapsed,contact,released});
   return{residentId:mason.id,jobId:context.queue.jobId,stationId:STATION,atMinute:context.absoluteMinute,source,stationCertificateSha256:'c'.repeat(64),position:p,yawRadians:Math.PI/2,poseSourceQualified:options.pose!==false,fullyWeighted:options.fullyWeighted!==false&&elapsed>=.8,activeClip,
    contact:contact?{event:{ownerId:mason.id,requestId:100+Number(entry.lease.id.split(':')[1]),motion:'work',clipId:'work_chop_wood',kind:'marker',state:'playing',seconds:1.12,loop:Math.floor(elapsed/2),hold:'none',markerId:marker,markerName:'chop-contact',markerKind:'contact'},toolPoint:contactPoint,targetPoint:contactPoint,contactSourceActor:'unit-original-chopping-block'}:null,equipmentReleased:released};
  }};
 return{base,site,cap,frame,observations};
}
function create(){return accepted(createVillagePopulationRuntime({population,confirmedEntry:true,worldKey:WORLD,contentRevision:REV,createdAt:START,initialDayMinute:INITIAL,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:1}));}
function advance(s:VillagePopulationRuntime,minute:number,f:ReturnType<typeof fixture>,frame:ResidentWorkplaceFrame|null=f.frame,site:VillageSiteLayout=f.site){return accepted(advanceVillagePopulationRuntime(s,{expectedGeneration:s.generation,worldKey:WORLD,contentRevision:REV,observedAt:START+(minute-INITIAL)*PACE,maxAdvanceMinutes:10080,site,workplaceFrame:frame}));}
function through(f:ReturnType<typeof fixture>,minute:number,start=create()){let s=start;for(let at=s.life.absoluteMinute;at<=minute;at++)s=advance(s,at,f);return s;}
function loaded(s:VillagePopulationRuntime){const saved=serializeVillagePopulationRuntime(s);if(!saved.ok)assert.fail(saved.error);return accepted(parseVillagePopulationRuntime(saved.json,{worldKey:WORLD,contentRevision:REV}));}
const job=(s:VillagePopulationRuntime)=>s.routineActions.residents.find(q=>q.residentId===mason.id)!;
const nav=(s:VillagePopulationRuntime)=>s.navigation.residents.find(q=>q.residentId===mason.id)!;

test('100-resident production runtime reaches a private community station, enters, performs contacts, releases and earns finite timber',()=>{
 const f=fixture(),before=JSON.stringify(population),trace:{at:number;step:string|null;reason:string|null;arrival:string;timber:number}[]=[];let s=create(),sawWalking=false,sawEnter=false,sawWork=false,sawExit=false;
 assert.equal(resolveVillageSiteEndpoint(f.site,PLACE,mason.id),null,'Community branch is private, never a canonical initial endpoint.');
 for(let at=600;at<=620;at++){
  s=advance(s,at,f);const sample=sampleVillagePopulationRuntime(s,f.site),row=sample.residents.find(r=>r.residentId===mason.id)!;assert.equal(sample.residents.length,100);assert.equal(s.life.households.length,25);
  const plan=resolvePopulationPresentation(row);if(row.moving&&row.workplaceMotion){sawWalking=true;assert.equal(plan.motion,'walk');}
  if(row.ordinaryWork){assert.equal(row.arrivalEvidence,'certified-route-arrival');assert.equal(row.placeId,PLACE);assert.equal(row.ordinaryWork.qualified,true);assert.equal(row.workPoseQualified,true);if(row.ordinaryWork.phase==='face'){sawEnter=true;assert.equal(plan.motion,'workEnter');}if(row.ordinaryWork.phase==='perform'){sawWork=true;assert.equal(plan.motion,'work');}if(row.ordinaryWork.phase==='release'){sawExit=true;assert.equal(plan.motion,'workExit');}}
  trace.push({at,step:job(s).current,reason:job(s).wait?.reason??nav(s).reason,arrival:nav(s).arrivalEvidence,timber:s.timberSupply.availableTimber});
 }
 assert.equal(s.timberSupply.availableTimber,12,JSON.stringify(trace));assert.equal(s.timberSupply.sources[0].remainingUnits,0);assert.equal(s.timberSupply.producedTimber,12);assert.ok(sawWalking);assert.ok(sawEnter);assert.ok(sawWork);assert.ok(sawExit);
 assert.equal(f.observations.filter(o=>o.contact).length>=2,true);assert.equal(JSON.stringify(population),before);assert.deepEqual(loaded(s),s);
});


test('world-clock advancement never replaces missing contact, release or qualified pose evidence',()=>{
 for(const options of [{contacts:false},{release:false},{fullyWeighted:false},{pose:false}]){
  const f=fixture(options),s=through(f,620);
  assert.equal(s.timberSupply.availableTimber,0,JSON.stringify(options));assert.equal(s.timberSupply.producedTimber,0);
  assert.equal(s.timberSupply.sources[0].remainingUnits,1);assert.notEqual(job(s).current,null);
  if(options.contacts===false)assert.equal(job(s).proof.contactCount,0);
  assert.deepEqual(loaded(s).timberSupply,s.timberSupply);
 }
});

test('reload during work preserves the private journey, owner lease, contact history and one finite yield',()=>{
 const f=fixture(),s=through(f,606);assert.equal(job(s).current,'perform');assert.equal(job(s).proof.contactCount,1);
 const restored=loaded(s);assert.deepEqual(restored.routineActions,s.routineActions);assert.deepEqual(restored.workstations,s.workstations);
 assert.deepEqual(restored.timberSupply,s.timberSupply);assert.equal(nav(restored).workplaceRoute?.id,f.cap.id);
 let direct=s,resume=restored;
 for(let at=607;at<=620;at++){direct=advance(direct,at,f);resume=advance(resume,at,f);assert.deepEqual(resume,direct);}
 assert.equal(resume.timberSupply.availableTimber,12);assert.equal(resume.timberSupply.workWatermarks.length,1);
 const after=advance(loaded(resume),620,f);assert.equal(after.timberSupply.availableTimber,12);assert.equal(after.timberSupply.sources[0].remainingUnits,0);
 assert.equal(after.timberSupply.workWatermarks.length,1);
});

test('a real reported threat interrupts a material subtask, drops its lease and resumes without crediting absent contacts',()=>{
 const f=fixture(),s=through(f,606),id=job(s).jobId,signal={id:'unit-reported-woodland-threat',kind:'violence' as const,channel:'report' as const,knownByResidentIds:[mason.id],affectedResidentIds:[mason.id],placeId:PLACE,observedAbsoluteMinute:606,expiresAbsoluteMinute:610,shelterPlaceId:mason.homePlaceId};
 const reported=accepted(reportVillagePopulationSafetySignals(s,{expectedGeneration:s.generation,worldKey:WORLD,contentRevision:REV,signals:[signal]}));
 let direct=advance(reported,607,f),resume=loaded(direct);
 assert.equal(job(direct).interruption?.reason,'safety');assert.equal(job(direct).jobId,id);assert.equal(direct.workstations?.entries.some(e=>e.lease.residentId===mason.id),false);
 for(let at=608;at<=635;at++){direct=advance(direct,at,f);resume=advance(resume,at,f);assert.deepEqual(resume,direct);if(at<610){assert.equal(direct.timberSupply.availableTimber,0);assert.equal(job(direct).performedWorldMinutes,0);}}
 assert.equal(job(direct).interruption,null);assert.equal(direct.timberSupply.availableTimber,12);assert.equal(direct.timberSupply.sources[0].remainingUnits,0);assert.equal(direct.timberSupply.workWatermarks.length,1);
});

test('missing source capability or workplace owner cannot create arrival or material credit after restore',()=>{
 const f=fixture(),s=through(f,601),restored=loaded(s),without=freeze({...f.site,workplaceRoutes:[]})as VillageSiteLayout;
 let held=restored;for(let at=602;at<=612;at++)held=advance(held,at,f,f.frame,without);
 assert.equal(held.timberSupply.availableTimber,0);assert.equal(held.timberSupply.sources[0].remainingUnits,1);assert.equal(job(held).proof.contactCount,0);
 let noOwner=s;for(let at=602;at<=612;at++)noOwner=advance(noOwner,at,f,null);
 assert.equal(noOwner.timberSupply.availableTimber,0);assert.equal(noOwner.timberSupply.sources[0].remainingUnits,1);assert.notEqual(job(noOwner).current,null);
});

test('disaster checkpoint restores source capability, stock, animation-owner phase and queue without mutating canonical lives',()=>{
 const f=fixture(),canonical=create(),before=serializeVillagePopulationRuntime(canonical),frame={siteIdentity:sourceIdentity,buildings:[],incidents:[],stations:[],shelterPlaceIds:[],obstacles:[]};
 const drift=freeze({...f.site,workplaceRoutes:[{...f.cap,certificateSha256:'f'.repeat(64)}]})as VillageSiteLayout;
 let step=advanceVillagePopulationEmergencyCheckpoint(canonical,null,0,{site:f.site,frame,workplaceFrame:f.frame});
 for(let at=601;at<=620;at++){
  const checkpoint=parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint),WORLD);
  assert.deepEqual(checkpoint.timberSupply,step.snapshot.timberSupply);assert.deepEqual(checkpoint.workstations,step.snapshot.workstations);
  if(at===604){assert.equal(checkpoint.workplaceRoutes?.[0]?.id,f.cap.id);assert.equal(checkpoint.routineActions?.residents.find(r=>r.residentId===mason.id)?.current,'reserve');
   assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(canonical,checkpoint,(at-INITIAL)*PACE,{site:drift,frame,workplaceFrame:f.frame}),/workplace source proof changed/);}
  step=advanceVillagePopulationEmergencyCheckpoint(canonical,checkpoint,(at-INITIAL)*PACE,{site:f.site,frame,workplaceFrame:f.frame});
 }
 assert.equal(step.checkpoint.timberSupply?.availableTimber,12);assert.equal(step.snapshot.timberSupply.sources[0].remainingUnits,0);
 assert.deepEqual(serializeVillagePopulationRuntime(canonical),before);assert.deepEqual(captureVillagePopulationEmergencyCheckpoint(step.snapshot),step.checkpoint);
});

// A source interaction must run even when 1x observation and canonical time
// are identical; it remains a read-only branch, never a canonical store write.
test('zero-offset 1x observation prepares its physical workplace instead of skipping to canonical facts',()=>{
 const f=fixture(),canonical=create(),before=JSON.stringify(canonical),projected=createVillagePopulationObserver().observe(canonical,0,{site:f.site,workplaceFrame:f.frame,preferCanonical:true});
 assert.equal(projected.clock.simulatedElapsedMilliseconds,0);assert.equal(projected.timberSupply.sources.length,1);assert.equal(projected.timberSupply.availableTimber,0);
 assert.equal(nav(projected).targetPlaceId,PLACE);assert.equal(JSON.stringify(canonical),before);assert.equal(serializeVillagePopulationRuntime(projected).ok,false);
});
