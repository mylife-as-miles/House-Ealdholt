import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as hashes} from './population-asset-integrity';
import {parseVillageSiteEmergencyTraversals,validateVillageSiteEmergencyTraversals,scopedVillageEmergencyTraversalSite,type VillageSiteEmergencyTraversal} from './village-emergency-traversal';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,resolveVillageEmergencyTraversalPath,ownsUnusedVillageLifeEmergencyCarry,isUnusedVillageLifeEmergencyCarry} from './village-life-navigation';
import {resolveVillageSitePath,type VillageSiteLayout,type VillageSitePoint} from './village-site';
import {advanceResidentBuildingEmergency,createResidentBuildingEmergency,residentBuildingEmergencyIntents,residentBuildingEmergencyLocomotionPermits,type ResidentBuildingEmergencyFrame,type ResidentBuildingEmergencyStation} from './resident-building-emergency';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,createVillagePopulationObserver,advanceVillagePopulationEmergencyCheckpoint,parseVillagePopulationEmergencyCheckpoint,serializeVillagePopulationRuntime} from './village-population-runtime';
import {resolvePopulationPresentation} from './village-activity-presentation';
import {EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE as brewsterProfile} from './ealdholt-brewster-fire-response-candidate';
import {validateVillageSiteEmergencyTargets} from './village-emergency-targets';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from './population-motion-clearance';
import {preparePopulationVisualTravel} from './population-visual-travel';
import type {VillageLifeIntent} from './village-life';
import type {VillagePopulationResidentState} from './village-population-runtime';
import {buildingDamageKey} from '../observer/building-damage';
import type {SourceBuilding} from '../observer/building-damage-catalogue';
const swine=population.residents.find(p=>p.id==='ealdholt-swineherd')!,sha='a'.repeat(64),certificate='b'.repeat(64),worldKey='carry-route-unit';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
// Contract-only fixtures, not production geometry or replacement world assets.
function fixture(){
 const points:Record<string,VillageSitePoint>={home:[0,0,0],well:[3,0,3],fire:[4,0,3]};
 const anchors=Object.entries(points).map(([id,p])=>({id,sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]] as VillageSitePoint,standingOnly:true as const}));
 const line:readonly VillageSitePoint[]=[points.home,[0,0,3],points.well],body=line.map(p=>[p[0],p[1]+.02,p[2]] as VillageSitePoint);
 const route:VillageSiteEmergencyTraversal={id:'unit-source-carry-capability',residentId:swine.id,profile:'desktop',sourceSha256:sha,siteIdentity:'unit-site-artifact',certificateSha256:certificate,fromAnchorId:'home',toAnchorId:'well',reversible:true,requiredClip:'carry_bucket_walk',sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres:6,body:{radius:.6231633375592951,height:1.9020472484796265,margin:.005,lift:.02},files:{...hashes},proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false}};
 // Keep only the twelve actual source pins needed by the body/clip/kit contract.
 const fileKeys=Object.keys(route.files).filter(p=>p===`crowd-v1/residents/${swine.id}.glb`||p===`crowd-v1/residents/${swine.id}.json`||p==='crowd-v1/clips/crowd-clips-adult-male-v1.glb'||p==='crowd-v1/clips/manifest.json'||p==='crowd-v1/props/kits.json'||p.startsWith('crowd-v1/props/')&&p.endsWith('.glb'));
 const capability=parseVillageSiteEmergencyTraversals([{...route,files:Object.fromEntries(fileKeys.map(p=>[p,hashes[p]]))}])[0];
 const base=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors,routes:[{id:'unit-original-well-fire',from:'well',to:'fire',reversible:true,sourceGroundPolyline:[points.well,points.fire],capsuleBottomPolyline:[anchors[1].capsuleBottomPoint,anchors[2].capsuleBottomPoint],lengthMetres:1}],placeBindings:[{placeId:'well',anchorId:'well',status:'mapped-exterior'},{placeId:'fire',anchorId:'fire',status:'mapped-exterior'}],residentPlaceBindings:[{residentId:swine.id,placeId:swine.homePlaceId,anchorId:'home',status:'mapped-exterior'}]})as VillageSiteLayout;
 const site=freeze({...base,emergencyTraversals:[capability]})as VillageSiteLayout;
 const permit={residentId:swine.id,id:capability.id,certificateSha256:capability.certificateSha256,requiredClip:capability.requiredClip};
 const intent=(target=swine.homePlaceId):VillageLifeIntent=>({residentId:swine.id,targetPlaceId:target,activityKey:'home',activity:'Unit carry journey.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine'});
 const start=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[intent()],metresPerWorldMinute:1});
 return {site,base,capability,permit,intent,start};
}

test('source carry capability adds one private edge only for its actual adult/clip permit; canonical graph stays unchanged',()=>{
 const f=fixture(),before=JSON.stringify(f.site),input={absoluteMinute:0,site:f.site,intents:[f.intent('well')],metresPerWorldMinute:1};
 assert.equal(resolveVillageSitePath(f.site,swine.homePlaceId,'well',swine.id),null);
 assert.equal(resolveVillageEmergencyTraversalPath(f.site,swine.id,swine.homePlaceId,'well'),null);
 const plain=advanceVillageLifeNavigation(f.start,input);assert.equal(plain.residents[0].reason,'route-unmapped');
 let moving=advanceVillageLifeNavigation(f.start,{...input,locomotionPermits:[f.permit]});assert.ok(moving.residents[0].route);assert.equal(moving.residents[0].route!.lengthMetres,6);
 moving=advanceVillageLifeNavigation(moving,{...input,absoluteMinute:2,locomotionPermits:[f.permit]});assert.deepEqual(sampleVillageLifeNavigation(moving,f.site)[0].position,[0,0,2]);
 assert.throws(()=>advanceVillageLifeNavigation(f.start,{...input,locomotionPermits:[{...f.permit,requiredClip:'walk' as any}]}),/locomotion permit/);
 assert.throws(()=>advanceVillageLifeNavigation(f.start,{...input,locomotionPermits:[{...f.permit,residentId:'ealdholt-brewster'}]}),/locomotion permit/);
 assert.equal(JSON.stringify(f.site),before);assert.equal(f.site.routes,f.base.routes);assert.equal(f.site.capsule,f.base.capsule);assert.deepEqual(f.site.capsule,{radius:.85,height:3.5});
});

test('losing a carry permit holds the exact physical cursor; restore and reverse retain it until real home arrival',()=>{
 const f=fixture(),input={site:f.site,intents:[f.intent('well')],metresPerWorldMinute:1,locomotionPermits:[f.permit]};
 let s=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0});s=advanceVillageLifeNavigation(s,{...input,absoluteMinute:2});
 const at=sampleVillageLifeNavigation(s,f.site)[0].position,held=advanceVillageLifeNavigation(s,{...input,absoluteMinute:3,locomotionPermits:[]});
 assert.equal(held.residents[0].reason,'clip-locomotion-required');assert.deepEqual(sampleVillageLifeNavigation(held,f.site)[0].position,at);assert.equal(sampleVillageLifeNavigation(held,f.site)[0].moving,false);
 s=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(held)),{...input,absoluteMinute:3,intents:[f.intent()]});assert.equal(s.residents[0].direction,-1);
 s=advanceVillageLifeNavigation(s,{...input,absoluteMinute:5,intents:[f.intent()]});assert.equal(s.residents[0].route,null);assert.deepEqual(sampleVillageLifeNavigation(s,f.site)[0].position,[0,0,0]);
 s=advanceVillageLifeNavigation(s,{...input,absoluteMinute:5,intents:[f.intent()],locomotionPermits:[]});assert.equal(s.residents[0].emergencyTraversal,undefined);assert.equal(s.residents[0].arrivalEvidence,'certified-route-arrival');
});

test('canceling an unused carry inside its unchanged initial home grants no exterior pose or return arrival',()=>{
 const f=fixture(),initial=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[{...f.intent(),indoor:true}],metresPerWorldMinute:1});
 const intent=f.intent('woodland-edge');let waiting=advanceVillageLifeNavigation(initial,{absoluteMinute:0,site:f.site,intents:[intent],metresPerWorldMinute:1,locomotionPermits:[f.permit]});
 assert.equal(waiting.residents[0].status,'waiting');assert.equal(waiting.residents[0].inside,true);assert.equal(waiting.residents[0].route,null);assert.ok(waiting.residents[0].emergencyTraversal);
 const legacy=clone(waiting)as any;legacy.residents[0].reason='clip-locomotion-required';waiting=parseVillageLifeNavigation(legacy);
 assert.equal(isUnusedVillageLifeEmergencyCarry(waiting.residents[0],f.capability,swine.homePlaceId),true);assert.equal(ownsUnusedVillageLifeEmergencyCarry(waiting,f.site,swine.id),true);
 const recovered=advanceVillageLifeNavigation(waiting,{absoluteMinute:1,site:f.site,intents:[intent],metresPerWorldMinute:1});
 assert.equal(recovered.residents[0].emergencyTraversal,undefined);assert.equal(recovered.residents[0].inside,true);assert.deepEqual(recovered.residents[0].anchorPosition,[0,0,0]);assert.equal(recovered.residents[0].arrivalEvidence,'initial-placement');assert.equal(recovered.residents[0].arrivedAtAbsoluteMinute,null);assert.equal(recovered.residents[0].startedAbsoluteMinute,null);assert.equal(recovered.residents[0].route,null);assert.equal(sampleVillageLifeNavigation(recovered,f.site)[0].position,null);
 for(const change of[(r:any)=>r.anchorPosition[0]+=.0001,(r:any)=>r.startedAbsoluteMinute=0,(r:any)=>r.originPlaceId=swine.homePlaceId,(r:any)=>r.destinationPlaceId='well',(r:any)=>r.inside=false,(r:any)=>r.emergencyTraversal.certificateSha256='c'.repeat(64),(r:any)=>r.sourceSha256='c'.repeat(64),(r:any)=>r.residentId='ealdholt-brewster']){const bad=clone(waiting.residents[0]);change(bad);assert.equal(isUnusedVillageLifeEmergencyCarry(bad,f.capability,swine.homePlaceId),false);}
 const foreignHome=clone(waiting.residents[0]);assert.equal(isUnusedVillageLifeEmergencyCarry(foreignHome,f.capability,'proposed-home-captain'),false);
 const held=advanceVillageLifeNavigation(waiting,{absoluteMinute:1,site:f.site,intents:[intent],metresPerWorldMinute:1,sourceAllocationHold:true});assert.ok(held.residents[0].emergencyTraversal,'A source hold cannot consume even an unused permit.');
});

test('carry releases at a genuinely reached safe original courtyard, never a private stance or unsupported normal body',()=>{
 const f=fixture(),court:VillageSitePoint=[7,0,3],privatePoint:VillageSitePoint=[3,0,6];
 const anchor=(id:string,p:VillageSitePoint)=>({id,sourceActor:'unit-original-terrain',standingOnly:true as const,sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]]as VillageSitePoint});
 const edge=(id:string,from:string,to:string,a:VillageSitePoint,b:VillageSitePoint)=>({id,from,to,reversible:true as const,sourceGroundPolyline:[a,b],capsuleBottomPolyline:[[a[0],a[1]+.02,a[2]],[b[0],b[1]+.02,b[2]]]as readonly VillageSitePoint[],lengthMetres:Math.hypot(...a.map((v,k)=>v-b[k]))});
 const capability=parseVillageSiteEmergencyTraversals([{...f.capability,topology:{anchors:[anchor('unit-private-stance',privatePoint)],routes:[edge('unit-private-connector','well','unit-private-stance',[3,0,3],privatePoint)],residentPlaceBindings:[{residentId:swine.id,placeId:'unit-private-action',anchorId:'unit-private-stance',status:'mapped-exterior'}]}}])[0];
 const site=freeze({...f.base,anchors:[...f.base.anchors,anchor('courtyard',court)],routes:[...f.base.routes,edge('unit-original-court','well','courtyard',[3,0,3],court)],
  residentPlaceBindings:[...f.base.residentPlaceBindings,{residentId:swine.id,placeId:'village-courtyard',anchorId:'courtyard',status:'mapped-exterior' as const}],emergencyTraversals:[capability]});
 const input={site,metresPerWorldMinute:1,locomotionPermits:[f.permit]};
 let arrived=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0,intents:[f.intent('village-courtyard')]});arrived=advanceVillageLifeNavigation(arrived,{...input,absoluteMinute:10,intents:[f.intent('village-courtyard')]});
 assert.equal(arrived.residents[0].route,null);assert.equal(arrived.residents[0].anchorPlaceId,'village-courtyard');assert.equal(arrived.residents[0].arrivalEvidence,'certified-route-arrival');
 const released=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(arrived)),{...input,absoluteMinute:10,intents:[f.intent('village-courtyard')],locomotionPermits:[]});assert.equal(released.residents[0].emergencyTraversal,undefined);assert.deepEqual(released.residents[0].anchorPosition,court);assert.equal(released.residents[0].arrivalEvidence,'certified-route-arrival');
 const overhead={id:'unit-new-court-overhead',kind:'solid' as const,sourceSha256:sha,profile:'desktop' as const,activeFromAbsoluteMinute:10,bounds:{min:[6.9,2.5,2.9]as VillageSitePoint,max:[7.1,3,3.1]as VillageSitePoint}};
 const narrowOnly=advanceVillageLifeNavigation(arrived,{...input,absoluteMinute:10,intents:[f.intent('village-courtyard')],locomotionPermits:[],dynamicObstacles:[overhead]});assert.ok(narrowOnly.residents[0].emergencyTraversal,'A normal tall body cannot replace a carry under newly fallen overhead.');assert.equal(narrowOnly.residents[0].reason,'clip-locomotion-required');
 const forged=clone(arrived)as any;forged.residents[0].anchorPosition[0]+=.0001;const wrongPoint=advanceVillageLifeNavigation(parseVillageLifeNavigation(forged),{...input,absoluteMinute:10,intents:[f.intent('village-courtyard')],locomotionPermits:[]});assert.ok(wrongPoint.residents[0].emergencyTraversal);
 let privateArrival=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0,intents:[f.intent('unit-private-action')]});privateArrival=advanceVillageLifeNavigation(privateArrival,{...input,absoluteMinute:9,intents:[f.intent('unit-private-action')]});assert.equal(privateArrival.residents[0].anchorPlaceId,'unit-private-action');
 const held=advanceVillageLifeNavigation(privateArrival,{...input,absoluteMinute:9,intents:[f.intent('unit-private-action')],locomotionPermits:[]});assert.ok(held.residents[0].emergencyTraversal,'A new private stance never becomes an ordinary source anchor.');assert.equal(held.residents[0].reason,'clip-locomotion-required');
});

test('dynamic collision uses the actual certified carry body while normal global clearance stays conservative',()=>{
 const f=fixture(),overhead={id:'unit-overhead',kind:'solid' as const,sourceSha256:sha,profile:'desktop' as const,bounds:{min:[-.1,2.5,1] as VillageSitePoint,max:[.1,3,2] as VillageSitePoint},activeFromAbsoluteMinute:0};
 const input={site:f.site,intents:[f.intent('well')],metresPerWorldMinute:1,locomotionPermits:[f.permit]};
 let s=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0,dynamicObstacles:[overhead]});assert.ok(s.residents[0].route,'roof above actual carry head is not a fictitious tall-body contact');
 s=advanceVillageLifeNavigation(s,{...input,absoluteMinute:2,dynamicObstacles:[overhead]});assert.deepEqual(sampleVillageLifeNavigation(s,f.site)[0].position,[0,0,2]);
 const low={...overhead,bounds:{min:[-.1,1,1] as VillageSitePoint,max:[.1,1.5,2] as VillageSitePoint}};
 const blocked=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0,dynamicObstacles:[low]});assert.equal(blocked.residents[0].reason,'dynamic-obstacle');assert.equal(blocked.residents[0].route,null);
 const ordinary=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[{...f.intent('well'),residentId:'another-adult'}],metresPerWorldMinute:1});
 const ordinaryBlocked=advanceVillageLifeNavigation(ordinary,{absoluteMinute:0,site:f.site,intents:[{...f.intent('fire'),residentId:'another-adult'}],metresPerWorldMinute:1,dynamicObstacles:[{...overhead,bounds:{min:[3.4,2.5,2.9],max:[3.6,3,3.1]}}]});assert.equal(ordinaryBlocked.residents[0].reason,'dynamic-obstacle');
});

function physicalState(f:ReturnType<typeof fixture>):VillagePopulationResidentState{
 const nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent('well')],metresPerWorldMinute:1,locomotionPermits:[f.permit]}),journey=nav.residents[0],row=sampleVillageLifeNavigation(nav,f.site)[0];
 const intent={...f.intent('well'),reason:'safety' as const};
 return{residentId:swine.id,tier:swine.fidelityTier,activity:intent.activity,roleClip:null,availableRoleClips:swine.appearance.motion.roleClips,scheduledPlaceId:'well',placeId:row.placeId,fromPlaceId:swine.homePlaceId,slotIndex:0,slotStartMinute:0,slotEndMinute:1440,status:'travelling',reason:null,position:row.position,yawRadians:row.yawRadians,moving:true,presentable:true,navigationStatus:'travelling',navigationReason:null,lifeIntent:intent,emergency:{incidentId:'unit-fire',phase:'to-water',stationId:'unit-water',clip:'carry_bucket_walk',requiredLocomotionClip:'carry_bucket_walk',traversalId:f.capability.id,contactPoint:null,contactSourceActor:null,yawRadians:null,actionStartedAbsoluteMinute:null,actionElapsedSeconds:null,waterUnits:0,qualified:true},visualTravel:{journey,profile:f.site.profile,sourceSha256:sha,siteIdentity:nav.siteIdentity!,metresPerSecond:1,maximumAdvanceSeconds:1}};
}
test('presentation never substitutes ordinary walk, idle, starts or crossfades for certified outbound/return carry',()=>{
 const f=fixture(),s=physicalState(f),p=resolvePopulationPresentation(s);assert.equal(p.presentable,true);assert.equal(p.activity.roleClip,'carry_bucket_walk');assert.equal(p.fadeSeconds,0);assert.ok(preparePopulationVisualTravel(s,f.site));
 const raw={schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[swine.id]:{levels:{crowd:{files:{...hashes},clips:{carry_bucket_walk:{radiusMetres:.573163337559295,heightMetres:1.8520472484796264,minimumBodyYMetres:-.0006525555356455998,placedBelowGround:false}}}}}}};
 const proof=parsePopulationMotionEvidence(raw);assert.equal(qualifyPopulationMotion(s,p,f.site,proof,'desktop').presentable,true,'unmeasured idle/start/stop are deliberately unreachable');
 assert.equal(qualifyPopulationMotion(s,{...p,fadeSeconds:.1},f.site,proof,'desktop').presentable,false);
 assert.equal(qualifyPopulationMotion(s,{...p,activity:{}},f.site,proof,'desktop').presentable,false);
 assert.equal(preparePopulationVisualTravel({...s,emergency:{...s.emergency!,requiredLocomotionClip:undefined}},f.site),null);
 const returned={...s,emergency:{...s.emergency!,phase:'returning-home' as const}},returnPresentation=resolvePopulationPresentation(returned);assert.equal(returnPresentation.activity.roleClip,'carry_bucket_walk');assert.equal(returnPresentation.fadeSeconds,0);
 const held={...returned,moving:false},heldPresentation=resolvePopulationPresentation(held);assert.equal(heldPresentation.animationTimeMode,'seek');assert.equal(heldPresentation.animationTimeSeconds,0);assert.equal(heldPresentation.activity.roleClip,'carry_bucket_walk');
 assert.equal(qualifyPopulationMotion(held,heldPresentation,f.site,proof,'desktop').presentable,true);
 const bad=clone(raw);bad.residents[swine.id].levels.crowd.clips.carry_bucket_walk.radiusMetres=.64;assert.match(qualifyPopulationMotion(s,p,f.site,parsePopulationMotionEvidence(bad),'desktop').reason!,/carry-route-body/);
});

function worldFixture(){
 const f=fixture(),others=population.residents.filter(p=>p.id!==swine.id),anchors=[...f.base.anchors,...others.map((p,i)=>({id:`unit-home-${i}`,sourceActor:'unit-original-terrain',sourceGroundPoint:[100+i*10,0,0]as VillageSitePoint,capsuleBottomPoint:[100+i*10,.02,0]as VillageSitePoint,standingOnly:true as const}))];
 const original=freeze({...f.base,anchors,placeBindings:[],residentPlaceBindings:[...f.base.residentPlaceBindings,...others.map((p,i)=>({residentId:p.id,placeId:p.homePlaceId,anchorId:`unit-home-${i}`,status:'mapped-exterior' as const}))]});
 const building=freeze({binding:{catalogueId:'unit-source',sourceSha256:sha,profile:'desktop',buildingId:'unit-burned-building',siteIndex:0},bounds:{min:[4.5,0,2],max:[6,4,4]},position:[5,0,3],outward:[-1,0,0],bearing:'west',parts:[{id:'unit-original-wall',kind:'wall',sourceActor:'unit-original-wall',sourceOrdinal:0,bounds:{min:[4.5,0,2],max:[4.6,3,4]}}]})as SourceBuilding;
 const incident={id:'unit-fire',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:400,expiresAbsoluteMinute:2000,knownByResidentIds:[swine.id],affectedResidentIds:[]};
 const station=(kind:'water'|'fire'):ResidentBuildingEmergencyStation=>({id:`unit-${kind}-station`,disasterId:incident.id,residentId:swine.id,placeId:`unit-${kind}-action`,anchorId:kind==='water'?'well':'fire',kind,buildingKey:kind==='water'?null:buildingDamageKey(building.binding),sourceActor:'unit-original-terrain',contactPoint:kind==='water'?[3,1,3]:[4,1,3],yawRadians:0,clip:'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:'unit-site-artifact',originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:kind==='water'?'unit-source-well':'unit-original-wall',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}});
 const stations=[station('water'),station('fire')],targets=stations.map(({disasterId:_,...t})=>t);
 const site=freeze({...original,emergencyTraversals:[f.capability],emergencyTargets:targets,residentPlaceBindings:[...original.residentPlaceBindings,...targets.map(t=>({residentId:t.residentId,placeId:t.placeId,anchorId:t.anchorId,status:'mapped-exterior' as const}))]});
 const oldSite=freeze({...site,emergencyTraversals:[]});
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:'unit-site-artifact',buildings:[building],incidents:[incident],stations,shelterPlaceIds:[],obstacles:[]};
 const created=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'unit',createdAt:0,initialDayMinute:400,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:1});assert.equal(created.ok,true);if(!created.ok)throw Error(created.error);
 const bound=advanceVillagePopulationRuntime(created.snapshot,{expectedGeneration:created.snapshot.generation,worldKey,contentRevision:'unit',observedAt:0,maxAdvanceMinutes:1,site:original});assert.equal(bound.ok,true,bound.ok?'':bound.error);if(!bound.ok)throw Error(bound.error);
 const canonical=bound.snapshot,initialObserved=createVillagePopulationObserver().observe(canonical,0,{site:oldSite});
 return{...f,original,site,oldSite,frame,canonical,initialObserved};
}

test('an older physical checkpoint adopts unused source capabilities without rewriting canonical facts, then earns water and returns home through strict reload',()=>{
 const f=worldFixture(),canonicalBefore=serializeVillagePopulationRuntime(f.canonical),empty={...f.frame,incidents:[],stations:[]};
 let step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.oldSite,frame:empty,initialObserved:f.initialObserved});assert.deepEqual(step.checkpoint.emergencyTraversals,[]);
 const old=clone(step.checkpoint)as any;delete old.emergencyTraversals;
 step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,old,0,{site:f.site,frame:empty});assert.deepEqual(step.checkpoint.navigation,old.navigation);assert.deepEqual(step.checkpoint.emergencyTraversals,[],'unused declarations need no old save migration');
 step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,step.checkpoint,0,{site:f.site,frame:f.frame});assert.equal(step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===swine.id)?.phase,'to-water');
 assert.equal(step.checkpoint.emergencyTraversals.length,1);assert.equal(step.sample.residents.find(r=>r.residentId===swine.id)?.emergency?.requiredLocomotionClip,'carry_bucket_walk');
 let firstDelivery:number|null=null;
 for(let n=1;n<=20;n++){
  const frame=firstDelivery===null?f.frame:empty;
  step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint)),n*1000,{site:f.site,frame});
  const duty=step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===swine.id),person=step.sample.residents.find(r=>r.residentId===swine.id)!;
  if(n<8)assert.equal(step.checkpoint.buildingEmergency.waterDeliveries.length,0,'a path label never earns a water receipt');
  if(step.checkpoint.buildingEmergency.waterDeliveries.length&&firstDelivery===null)firstDelivery=n;
  if(duty){assert.equal(person.emergency?.requiredLocomotionClip,'carry_bucket_walk');if(person.presentable)assert.equal(resolvePopulationPresentation(person).activity.roleClip,'carry_bucket_walk');}
  if(firstDelivery!==null&&!duty)break;
 }
 assert.equal(firstDelivery,9);const nav=step.checkpoint.navigation.residents.find(r=>r.residentId===swine.id)!;
 assert.equal(step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===swine.id),undefined);assert.equal(nav.route,null);assert.equal(nav.anchorPlaceId,swine.homePlaceId);assert.deepEqual(nav.anchorPosition,[0,0,0]);assert.equal(nav.emergencyTraversal,undefined);assert.equal(nav.arrivalEvidence,'certified-route-arrival');
 assert.deepEqual(serializeVillagePopulationRuntime(f.canonical),canonicalBefore);assert.equal(f.site.routes,f.original.routes);assert.equal(f.site.capsule,f.original.capsule);
});

test('active carry checkpoint rejects missing or changed source geometry/body/clip/certificate and preserves the owned raw cursor',()=>{
 const f=worldFixture(),step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame,initialObserved:f.initialObserved});
 const raw=JSON.stringify(step.checkpoint),source=step.checkpoint.emergencyTraversals[0];assert.ok(source);assert.doesNotThrow(()=>parseVillagePopulationEmergencyCheckpoint(raw));
 const absent=freeze({...f.site,emergencyTraversals:[]});assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,raw,1000,{site:absent,frame:f.frame}),/carry route source proof changed/);
 for(const edit of [(r:any)=>{r.sourceGroundPolyline[1][0]+=.001;r.capsuleBottomPolyline[1][0]+=.001;r.lengthMetres=r.sourceGroundPolyline.slice(1).reduce((n:number,p:number[],i:number)=>n+Math.hypot(...p.map((v,k)=>v-r.sourceGroundPolyline[i][k])),0);},(r:any)=>r.certificateSha256='c'.repeat(64),(r:any)=>r.body.radius-=.001,(r:any)=>r.files['crowd-v1/clips/crowd-clips-adult-male-v1.glb']='c'.repeat(64),(r:any)=>r.requiredClip='walk',(r:any)=>r.residentId='ealdholt-brewster',(r:any)=>r.profile='quest']){
  const saved=clone(step.checkpoint);edit(saved.emergencyTraversals[0]);assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,saved,1000,{site:f.site,frame:f.frame}));
 }
 const pathTamper=clone(step.checkpoint),journey=pathTamper.navigation.residents.find(p=>p.residentId===swine.id)!;assert.ok(journey.route);
 (journey.route!.sourceGroundPolyline[1]as number[])[0]+=.001;(journey.route!.capsuleBottomPolyline[1]as number[])[0]+=.001;(journey.route as any).lengthMetres=journey.route!.sourceGroundPolyline.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-journey.route!.sourceGroundPolyline[i][k])),0);
 assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,pathTamper,1000,{site:f.site,frame:f.frame}),/carry journey geometry/);
 assert.equal(JSON.stringify(step.checkpoint),raw,'failed restore never mutates original saved data');
});


test('an all-clear during the source carry leg reverses the real cursor and keeps the bucket until home; no contact receipt is invented',()=>{
 const f=worldFixture();let step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame,initialObserved:f.initialObserved});
 for(let n=1;n<=2;n++)step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,step.checkpoint,n*1000,{site:f.site,frame:f.frame});
 const prior=step.sample.residents.find(r=>r.residentId===swine.id)!.position;assert.deepEqual(prior,[0,0,2]);
 const empty={...f.frame,incidents:[],stations:[]};step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,step.checkpoint,2000,{site:f.site,frame:empty});
 assert.equal(step.checkpoint.buildingEmergency.duties[0].kind,'return');assert.equal(step.checkpoint.navigation.residents.find(r=>r.residentId===swine.id)!.direction,-1);assert.deepEqual(step.sample.residents.find(r=>r.residentId===swine.id)!.position,prior);
 for(let n=3;n<=5;n++)step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint)),n*1000,{site:f.site,frame:empty});
 assert.equal(step.checkpoint.buildingEmergency.duties.length,0);assert.equal(step.checkpoint.buildingEmergency.waterDeliveries.length,0);const journey=step.checkpoint.navigation.residents.find(r=>r.residentId===swine.id)!;assert.equal(journey.anchorPlaceId,swine.homePlaceId);assert.deepEqual(journey.anchorPosition,[0,0,0]);assert.equal(journey.emergencyTraversal,undefined);
});


test('a second measured responder keeps its narrower action topology private to the exact carry permit',()=>{
 const f=fixture(),brewster=population.residents.find(p=>p.id==='ealdholt-brewster')!,anchor={id:'unit-private-brewster-fire',sourceActor:'unit-original-terrain',sourceGroundPoint:[4.1,0,3]as VillageSitePoint,capsuleBottomPoint:[4.1,.02,3]as VillageSitePoint,standingOnly:true as const};
 const connector={id:'unit-brewster-fire-connector',from:'fire',to:anchor.id,reversible:true as const,sourceGroundPolyline:[f.base.anchors[2].sourceGroundPoint,anchor.sourceGroundPoint],capsuleBottomPolyline:[f.base.anchors[2].capsuleBottomPoint,anchor.capsuleBottomPoint],lengthMetres:.1};
 const alias={residentId:brewster.id,placeId:'disaster-unit-brewster-fire',anchorId:anchor.id,status:'mapped-exterior' as const};
 const capability=parseVillageSiteEmergencyTraversals([{...f.capability,id:'unit-second-carry-capability',residentId:brewster.id,body:brewsterProfile.body,files:brewsterProfile.files,topology:{anchors:[anchor],routes:[connector],residentPlaceBindings:[alias]}}])[0];
 const original=freeze({...f.base,residentPlaceBindings:[...f.base.residentPlaceBindings,{residentId:brewster.id,placeId:brewster.homePlaceId,anchorId:'home',status:'mapped-exterior' as const}]}),site=freeze({...original,emergencyTraversals:[f.capability,capability]});
 assert.equal(validateVillageSiteEmergencyTraversals(site).length,2);assert.strictEqual(site.anchors,original.anchors);assert.strictEqual(site.routes,original.routes);assert.equal(site.anchors.some(a=>a.id===anchor.id),false);
 assert.equal(resolveVillageSitePath(site,brewster.homePlaceId,alias.placeId,brewster.id),null);
 const ref={id:capability.id,certificateSha256:capability.certificateSha256,requiredClip:capability.requiredClip};
 const path=resolveVillageEmergencyTraversalPath(site,brewster.id,brewster.homePlaceId,alias.placeId,ref);assert.ok(path);assert.ok(Math.abs(path.lengthMetres-7.1)<1e-12);
 assert.equal(resolveVillageEmergencyTraversalPath(site,swine.id,swine.homePlaceId,alias.placeId,ref),null,'Another resident cannot borrow the narrow body or operation stand.');
 const scope=scopedVillageEmergencyTraversalSite(site,ref,brewster.id)!;assert.equal(validateVillageSiteEmergencyTraversals(scope).length,2);assert.equal(scope.capsule.radius,brewsterProfile.body.radius+.005);assert.equal(scope.anchors.length,original.anchors.length+1);
 const target={id:'unit-private-fire-target',residentId:brewster.id,placeId:alias.placeId,anchorId:anchor.id,kind:'fire' as const,buildingKey:'unit-source-building',sourceActor:anchor.sourceActor,contactPoint:[4.6,1,3]as VillageSitePoint,yawRadians:0,clip:'carry_bucket_walk' as const,operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop' as const,siteIdentity:'unit-site-artifact',originalTriangleClearance:true as const,wholeFootprintSupported:true as const,sweptClipAndPropsClear:true as const,contactSourceActor:'unit-original-wall',maximumContactDistanceMetres:2,clip:'carry_bucket_walk' as const}};
 assert.equal(validateVillageSiteEmergencyTargets(freeze({...site,emergencyTargets:[target]})).length,1);
 for(const change of[(c:any)=>c.body.radius-=.001,(c:any)=>c.residentId='ealdholt-hall-groom',(c:any)=>c.topology.residentPlaceBindings[0].residentId=swine.id,(c:any)=>delete c.files['crowd-v1/residents/ealdholt-brewster.glb']]){const bad=clone(capability);change(bad);assert.throws(()=>parseVillageSiteEmergencyTraversals([bad]));}
 for(const change of[(c:any)=>c.topology.anchors[0].id='fire',(c:any)=>c.topology.routes[0].sourceGroundPolyline[0][0]+=.01,(c:any)=>c.topology.residentPlaceBindings[0].placeId=brewster.homePlaceId]){const bad=clone(capability);change(bad);assert.throws(()=>validateVillageSiteEmergencyTraversals(freeze({...site,emergencyTraversals:[f.capability,bad]})));}
});


test('a real structural warning cancels close contact and preserves a reachable interrupted exterior routine for source-scoped retreat',()=>{
 const f=worldFixture();let step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame,initialObserved:f.initialObserved});
 for(let n=1;n<=2;n++)step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,step.checkpoint,n*1000,{site:f.site,frame:f.frame});
 const site=freeze({...f.site,residentPlaceBindings:[...f.site.residentPlaceBindings,{residentId:swine.id,placeId:'unit-interrupted-courtyard',anchorId:'well',status:'mapped-exterior' as const}]}),state=clone(step.checkpoint.buildingEmergency),duty=state.duties.find(d=>d.residentId===swine.id)!;
 assert.ok(step.checkpoint.navigation.residents.find(r=>r.residentId===swine.id)!.route);
 const interrupted={...duty.interruptedIntent,targetPlaceId:'unit-interrupted-courtyard',indoor:false};(duty as any).interruptedIntent=interrupted;
 const frame={...f.frame,incidents:f.frame.incidents.map(i=>({...i,unsafeForCloseWork:true}))},navigationBytes=JSON.stringify(step.checkpoint.navigation);
 const result=advanceResidentBuildingEmergency(state,{absoluteMinute:402,worldKey,residents:[swine],routineIntents:[interrupted],navigation:step.checkpoint.navigation,site,frame});
 assert.equal(result.duties[0].kind,'return');assert.equal(result.duties[0].targetPlaceId,'unit-interrupted-courtyard');assert.equal(result.duties[0].waterUnits,0);assert.deepEqual(result.waterDeliveries,[]);
 assert.equal(JSON.stringify(step.checkpoint.navigation),navigationBytes,'The warning changes a goal, never the physical cursor or route progress.');
 const unbound=clone(state);(unbound.duties[0]as any).interruptedIntent.targetPlaceId='unit-no-source-binding';
 const held=advanceResidentBuildingEmergency(unbound,{absoluteMinute:402,worldKey,residents:[swine],routineIntents:[interrupted],navigation:step.checkpoint.navigation,site,frame});assert.equal(held.duties[0].targetPlaceId,swine.homePlaceId,'A label alone cannot grant a return endpoint.');
 const empty=advanceResidentBuildingEmergency(createResidentBuildingEmergency(worldKey,402),{absoluteMinute:402,worldKey,residents:[swine],routineIntents:[interrupted],navigation:step.checkpoint.navigation,site,frame});assert.equal(empty.duties.length,0,'Unsafe close work cannot immediately assign another water duty.');
});


test('neutral carry return pins the actual resident, every reachable neutral clip, body and published files',()=>{
 const f=fixture(),capability={...f.capability,id:'unit-brewster-neutral-return',residentId:brewsterProfile.residentId,body:brewsterProfile.body,files:brewsterProfile.files,neutralReturn:brewsterProfile.neutralReturn};
 assert.equal(parseVillageSiteEmergencyTraversals([capability])[0].neutralReturn!.body.radius,.5587732253678103);
 for(const change of[(c:any)=>c.neutralReturn.body.radius-=.001,(c:any)=>c.neutralReturn.motionEvidence.residents[brewsterProfile.residentId].levels.crowd.clips.walk_b.radiusMetres-=.001,(c:any)=>delete c.neutralReturn.motionEvidence.residents[brewsterProfile.residentId].levels.crowd.clips.walk_b_start,(c:any)=>c.neutralReturn.motionEvidence.residents[brewsterProfile.residentId].levels.crowd.files['crowd-v1/residents/ealdholt-brewster.glb']='0'.repeat(64),(c:any)=>c.neutralReturn.originalTriangleClearance=false,(c:any)=>c.residentId=swine.id]){const bad=clone(capability);change(bad);assert.throws(()=>parseVillageSiteEmergencyTraversals([bad]));}
 const tinyBase=freeze({...f.base,capsule:{radius:.55,height:3.5},residentPlaceBindings:[...f.base.residentPlaceBindings,{residentId:brewsterProfile.residentId,placeId:'unit-brewster-home',anchorId:'home',status:'mapped-exterior' as const}],emergencyTraversals:parseVillageSiteEmergencyTraversals([capability])});
 assert.throws(()=>validateVillageSiteEmergencyTraversals(tinyBase),/cannot contain.*neutral return body/,'A carry fit cannot prove room for the distinct neutral body.');
});
