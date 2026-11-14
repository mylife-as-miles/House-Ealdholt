import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files} from './population-asset-integrity';
import {parsePopulationMotionEvidence} from './population-motion-clearance';
import {requiredVillageWorkplaceMotionClips,parseVillageSiteWorkplaceRoutes,type VillageSiteWorkplaceRoute} from './village-workplace-routes';
import type {VillageSiteLayout,VillageSitePoint} from './village-site';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from './village-population-runtime';
import {parseVillageTimberCatalogue} from '../observer/village-timber-supply';
import type {ResidentWorkplaceFrame} from './resident-workplace-frame';
import type {ResidentWorkstation,ResidentWorkstationObservation} from './resident-workstations';

import {advanceResidentBuildingEmergency,createResidentBuildingEmergency,residentBuildingEmergencyIntents,residentBuildingEmergencySafetySignals,qualifiedResidentBuildingRecoveryWork,residentBuildingEmergencyRefugePermits,type ResidentBuildingEmergencyFrame,type ResidentBuildingRecoveryWorkPermit,type ResidentBuildingEmergencyInput} from './resident-building-emergency';
import {advanceVillageLifeNavigation} from './village-life-navigation';
import {parseVillageSiteEmergencyRefuges,deriveVillageRefugeBody} from './village-emergency-refuges';
import type {VillageLifeIntent} from './village-life';
import type {SourceBuilding} from '../observer/building-damage-catalogue';

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
/** Synthetic qualification contracts, not an actual-source or rendered test. */
function recoveryFixture(privateRefuge=false){
 const f=fixture(),s=advance(create(),600,f,null),refuge=privateRefuge?'unit-private-refuge':'village-well',p:VillageSitePoint=[3,0,6];
 const anchor={id:'unit-public-refuge',sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const};
 const connector={id:'unit-refuge-connector',from:'unit-junction',to:anchor.id,reversible:true,sourceGroundPolyline:[[3,0,0],p],capsuleBottomPolyline:[[3,.02,0],bottom(p)],lengthMetres:6};
 const {publicExteriorOnly:_,...proof}=f.cap.proof;
 const privateCaps=privateRefuge?parseVillageSiteEmergencyRefuges([{id:refuge,residentId:mason.id,placeId:refuge,anchorId:anchor.id,sourceActor:anchor.sourceActor,certificateSha256:'f'.repeat(64),body:deriveVillageRefugeBody(f.cap.proof.motionEvidence,mason.id),proof:{...proof,sourceGroundPoint:p,capsuleBottomPoint:bottom(p)},topology:{anchor,route:connector}}]):[];
 const cap=privateRefuge?{...f.cap,recoveryApproach:{refugeId:refuge,certificateSha256:privateCaps[0].certificateSha256,route:{id:'unit-exact-refuge-wood-path',from:anchor.id,to:f.cap.anchorId,reversible:true,sourceGroundPolyline:[p,f.cap.proof.sourceGroundPoint],capsuleBottomPolyline:[bottom(p),f.cap.proof.capsuleBottomPoint],lengthMetres:Math.hypot(...f.cap.proof.sourceGroundPoint.map((v,k)=>v-p[k]))}}}:f.cap;
 const site=freeze({...f.site,anchors:[...f.site.anchors,...(privateRefuge?[]:[anchor])],routes:[...f.site.routes,...(privateRefuge?[]:[connector])],residentPlaceBindings:[...f.site.residentPlaceBindings,...(privateRefuge?[]:[{residentId:mason.id,placeId:refuge,anchorId:anchor.id,status:'mapped-exterior'}])],emergencyRefuges:privateCaps,workplaceRoutes:[cap]})as VillageSiteLayout;
 const building=freeze({binding:{catalogueId:'unit-recovery-catalogue',sourceSha256:sha,profile:'desktop',buildingId:'unit-burned-home',siteIndex:0},bounds:{min:[-1,0,-1],max:[1,3,1]},position:[0,0,0],outward:[1,0,0],bearing:'west',parts:[{id:'unit-home-door',kind:'door',sourceActor:'unit-original-terrain',sourceOrdinal:0,bounds:{min:[0,0,0],max:[1,2,.1]}}]})as SourceBuilding;
 const incident={id:'unit-home-fire',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:600,expiresAbsoluteMinute:1400,knownByResidentIds:[mason.id],affectedResidentIds:[mason.id]};
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:'unit-source-artifact',buildings:[building],incidents:[incident],stations:[],shelterPlaceIds:privateRefuge?[]:[refuge],refuges:privateCaps,obstacles:[]};
 const intents=s.life.residents.map(r=>r.intent);let nav=s.navigation,emergency=createResidentBuildingEmergency(WORLD,600);
 for(let at=600;at<=606;at++){
  const effective=()=>residentBuildingEmergencyIntents(emergency,intents);
  nav=advanceVillageLifeNavigation(nav,{absoluteMinute:at,site,intents:effective(),metresPerWorldMinute:4,refugePermits:residentBuildingEmergencyRefugePermits(emergency,site)});
  emergency=advanceResidentBuildingEmergency(emergency,{absoluteMinute:at,worldKey:WORLD,residents:population.residents,routineIntents:intents,navigation:nav,site,frame});
  nav=advanceVillageLifeNavigation(nav,{absoluteMinute:at,site,intents:effective(),metresPerWorldMinute:4,refugePermits:residentBuildingEmergencyRefugePermits(emergency,site)});
 }
 assert.equal(emergency.duties.find(d=>d.residentId===mason.id)?.phase,'sheltered');
 const clear={...frame,incidents:[{...incident,burning:false}]},slot=mason.registry.routine.find(slot=>606>=slot.startMinute&&606<slot.endMinute)!;
 const permit:ResidentBuildingRecoveryWorkPermit={residentId:mason.id,incidentId:incident.id,routeId:f.cap.id,routeCertificateSha256:f.cap.certificateSha256,station:f.frame.catalog[0].station,authoredWork:{...slot}};
 const input:ResidentBuildingEmergencyInput={absoluteMinute:606,worldKey:WORLD,residents:population.residents,routineIntents:intents,navigation:nav,site,frame:clear,recoveryWork:[permit]};
 return{f,site,clear,incident,permit,input,nav,emergency,intents};
}
function resumed(intents:readonly VillageLifeIntent[],reason:VillageLifeIntent['reason']='routine'):readonly VillageLifeIntent[]{return intents.map(i=>i.residentId!==mason.id?i:{...i,activityKey:reason==='routine'?'work':'shelter',reason,targetPlaceId:reason==='routine'?PLACE:mason.homePlaceId,indoor:false});}

test('only source-qualified finite recovery work suppresses the matching extinguished-home report',()=>{
 const f=recoveryFixture(),i=f.input;assert.equal(qualifiedResidentBuildingRecoveryWork(i,mason,f.clear.incidents[0]),true);
 assert.ok(residentBuildingEmergencySafetySignals({...i,recoveryWork:[]}).some(s=>s.knownByResidentIds.includes(mason.id)));
 assert.equal(residentBuildingEmergencySafetySignals(i).some(s=>s.knownByResidentIds.includes(mason.id)),false);
 for(const edit of [
  {recoveryWork:[{...f.permit,routeCertificateSha256:'f'.repeat(64)}]},
  {recoveryWork:[{...f.permit,authoredWork:{...f.permit.authoredWork,activity:'Unrelated unearned work.'}}]},
  {recoveryWork:[{...f.permit,station:{...f.permit.station,source:{...source,sha256:'f'.repeat(64)}}}]},
  {frame:{...f.clear,incidents:[{...f.clear.incidents[0],burning:true}]}},
  {frame:{...f.clear,incidents:[...f.clear.incidents,{...f.incident,id:'unit-other-house-fire',knownByResidentIds:[],affectedResidentIds:[]}]}},
  {frame:{...f.clear,obstacles:[{id:'unit-blocked-recovery-path',kind:'solid' as const,sourceSha256:sha,profile:'desktop' as const,activeFromAbsoluteMinute:600,bounds:{min:[2.7,0,-.3]as const,max:[3.3,3,.3]as const}}]}},
  {recoveryWork:[]},
 ]){const input={...i,...edit};assert.equal(qualifiedResidentBuildingRecoveryWork(input,mason,input.frame!.incidents[0]),false);assert.ok(residentBuildingEmergencySafetySignals(input).some(s=>s.knownByResidentIds.includes(mason.id)));}
 const child=population.residents.find(r=>r.ageYears<18)!;assert.equal(qualifiedResidentBuildingRecoveryWork(i,child,f.clear.incidents[0]),false);
});

test('a sheltered adult waits for genuine routine recovery; safety, weather and family duties are never overridden',()=>{
 const f=recoveryFixture();
 for(const reason of ['safety','weather','family-care']as const){const held=advanceResidentBuildingEmergency(f.emergency,{...f.input,routineIntents:resumed(f.intents,reason)});assert.equal(held.duties.find(d=>d.residentId===mason.id)?.phase,'sheltered');assert.equal(held.repairProgress.length,0);}
 const work=advanceResidentBuildingEmergency(f.emergency,{...f.input,routineIntents:resumed(f.intents)});assert.equal(work.duties.some(d=>d.residentId===mason.id),false);assert.equal(work.waterDeliveries.length,0);assert.equal(work.repairProgress.length,0);
 assert.equal(f.nav.residents.find(j=>j.residentId===mason.id)?.anchorPlaceId,'village-well','Eligibility does not teleport a worker or enter their ruined house.');
});

test('nightfall, renewed fire, a lost permit or changed source retains the actual refuge and never admits a ruined home',()=>{
 const f=recoveryFixture(),nightNav=advanceVillageLifeNavigation(f.nav,{absoluteMinute:1080,site:f.site,intents:residentBuildingEmergencyIntents(f.emergency,f.intents),metresPerWorldMinute:4});
 const night={...f.input,absoluteMinute:1080,navigation:nightNav,routineIntents:resumed(f.intents)};
 assert.equal(qualifiedResidentBuildingRecoveryWork(night,mason,f.clear.incidents[0]),false);
 const held=advanceResidentBuildingEmergency(f.emergency,night),duty=held.duties.find(d=>d.residentId===mason.id)!;assert.equal(duty.phase,'sheltered');assert.equal(duty.targetPlaceId,'village-well');
 for(const edit of [{recoveryWork:[]},{frame:{...f.clear,incidents:[f.incident]}},{site:freeze({...f.site,sourceSha256:'f'.repeat(64)})as VillageSiteLayout}]){
  const result=advanceResidentBuildingEmergency(f.emergency,{...f.input,...edit,routineIntents:resumed(f.intents)}),d=result.duties.find(d=>d.residentId===mason.id)!;assert.equal(d.targetPlaceId,'village-well');assert.notEqual(d.targetPlaceId,mason.homePlaceId);
 }
});

test('a recovery permit never waives the ruined home when weather interrupts a worker already away from the refuge',()=>{
 const f=recoveryFixture(),intent=resumed(f.intents),released=advanceResidentBuildingEmergency(f.emergency,{...f.input,routineIntents:intent});let nav=f.nav;
 for(let at=607;at<=611;at++)nav=advanceVillageLifeNavigation(nav,{absoluteMinute:at,site:f.site,intents:intent,metresPerWorldMinute:4,workplacePermits:[{residentId:mason.id,id:f.f.cap.id,certificateSha256:f.f.cap.certificateSha256}]});
 assert.equal(nav.residents.find(j=>j.residentId===mason.id)?.anchorPlaceId,PLACE);
 const interrupted=advanceResidentBuildingEmergency(released,{...f.input,absoluteMinute:611,navigation:nav,routineIntents:resumed(f.intents,'weather')}),duty=interrupted.duties.find(d=>d.residentId===mason.id);
 assert.equal(duty?.kind,'evacuate');assert.notEqual(duty?.targetPlaceId,mason.homePlaceId);
 assert.equal(interrupted.waterDeliveries.length,0);assert.equal(interrupted.repairProgress.length,0);
});


test('a genuine private source refuge composes recovery once from the original catalog without duplicating its anchor',()=>{
 const f=recoveryFixture(true),journey=f.nav.residents.find(j=>j.residentId===mason.id)!;
 assert.equal(journey.arrivalEvidence,'certified-route-arrival');assert.equal(journey.anchorPlaceId,'unit-private-refuge');assert.equal(journey.emergencyRefuge?.ids[0],'unit-private-refuge');
 assert.equal(f.site.anchors.some(a=>a.id==='unit-public-refuge'),false,'The private anchor is absent from the original source graph.');
 assert.equal(qualifiedResidentBuildingRecoveryWork(f.input,mason,f.clear.incidents[0]),true);
 assert.equal(residentBuildingEmergencySafetySignals(f.input).some(s=>s.knownByResidentIds.includes(mason.id)),false);
 const released=advanceResidentBuildingEmergency(f.emergency,{...f.input,routineIntents:resumed(f.intents)});assert.equal(released.duties.some(d=>d.residentId===mason.id),false);
 assert.equal(journey.anchorPlaceId,'unit-private-refuge','The qualification neither moves nor relabels the actual actor.');
});
