import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files} from './population-asset-integrity';
import {parsePopulationMotionEvidence} from './population-motion-clearance';
import {parseVillageSiteEmergencyRefuges,validateVillageSiteEmergencyRefuges,scopedVillageEmergencyRefugeSite,deriveVillageRefugeBody,requiredVillageRefugeMotionClips,villageRefugeClearOfOperations,type VillageSiteEmergencyRefuge} from './village-emergency-refuges';
import {resolveVillageSiteEndpoint,resolveVillageSitePath,type VillageSiteLayout,type VillageSitePoint} from './village-site';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,ownsExclusiveVillageLifeExteriorAnchor,villageLifeNavigationPeerBody} from './village-life-navigation';
import {advanceResidentBuildingEmergency,createResidentBuildingEmergency,residentBuildingEmergencyIntents,residentBuildingEmergencyRefugePermits,type ResidentBuildingEmergencyFrame} from './resident-building-emergency';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,advanceVillagePopulationEmergencyCheckpoint,parseVillagePopulationEmergencyCheckpoint,serializeVillagePopulationRuntime} from './village-population-runtime';
import {preparePopulationVisualTravel} from './population-visual-travel';
import type {VillageLifeIntent} from './village-life';
import type {SourceBuilding} from '../observer/building-damage-catalogue';
import {buildingDamageKey} from '../observer/building-damage';
import {EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE as brewsterProfile} from './ealdholt-brewster-fire-response-candidate';
import {parseVillageSiteEmergencyTraversals} from './village-emergency-traversal';
import type {ResidentBuildingEmergencyStation} from './resident-building-emergency';
const child=population.residents.find(p=>p.id==='ealdholt-east-daughter')!,sha='a'.repeat(64),worldKey='unit-source-refuge',artifact='unit-source-artifact';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
const body=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]];
/** Geometry-shaped unit contracts, never production source qualification. */
function fixture(person=child){
 const points:Record<string,VillageSitePoint>={home:[0,0,0],connection:[3,0,0],ordinary:[10,0,0]},anchors=Object.entries(points).map(([id,p])=>({id,sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:body(p),standingOnly:true as const}));
 const route=(id:string,from:string,to:string,g:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:g,capsuleBottomPolyline:g.map(body),lengthMetres:g.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-g[i][k])),0)});
 const base=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors,routes:[route('unit-original-a','home','connection',[points.home,points.connection]),route('unit-original-b','connection','ordinary',[points.connection,points.ordinary])],placeBindings:[{placeId:'unit-well',anchorId:'connection',status:'mapped-exterior'}],residentPlaceBindings:[{residentId:person.id,placeId:person.homePlaceId,anchorId:'home',status:'mapped-exterior'}]})as VillageSiteLayout;
 const clips=Object.fromEntries(requiredVillageRefugeMotionClips(person.id).map(name=>[name,{radiusMetres:.4,heightMetres:1.2,minimumBodyYMetres:-.01,placedBelowGround:false}]));
 const motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[person.id]:{levels:{crowd:{files:{...files},clips}}}}});
 const refugePoint:VillageSitePoint=[6,0,3],refuge=freeze({id:'unit-refuge-capability',residentId:person.id,placeId:'unit-physical-refuge',anchorId:'unit-refuge-anchor',sourceActor:'unit-original-terrain',certificateSha256:'b'.repeat(64),body:deriveVillageRefugeBody(motion,person.id),proof:{sourceSha256:sha,profile:'desktop',siteIdentity:artifact,sourceGroundPoint:refugePoint,capsuleBottomPoint:body(refugePoint),originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,motionEvidence:motion},topology:{anchor:{id:'unit-refuge-anchor',sourceActor:'unit-original-terrain',sourceGroundPoint:refugePoint,capsuleBottomPoint:body(refugePoint),standingOnly:true},route:route('unit-refuge-connector','connection','unit-refuge-anchor',[points.connection,[3,0,3],refugePoint])}})as VillageSiteEmergencyRefuge;
 const site=freeze({...base,emergencyRefuges:parseVillageSiteEmergencyRefuges([refuge])}),permit={residentId:person.id,ids:[refuge.id]};
 const intent=(target=person.homePlaceId):VillageLifeIntent=>({residentId:person.id,targetPlaceId:target,activityKey:'home',activity:'Unit real refuge journey.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine'});
 const start=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[intent()],metresPerWorldMinute:1});
 return{site,base,refuge,permit,intent,start,route,person};
}
test('a source refuge branch is private to a permitted actual journey; ordinary graph and homes stay unchanged',()=>{
 const f=fixture(),before=JSON.stringify(f.site);assert.equal(resolveVillageSiteEndpoint(f.site,f.refuge.placeId,child.id),null);assert.equal(resolveVillageSitePath(f.site,child.homePlaceId,f.refuge.placeId,child.id),null);
 assert.equal(validateVillageSiteEmergencyRefuges(f.site).length,1);const scoped=scopedVillageEmergencyRefugeSite(f.site,f.permit,child.id)!;
 assert.equal(scoped.anchors.length,f.base.anchors.length+1);assert.equal(scoped.capsule.radius,f.refuge.body.radius+.005);assert.equal(scoped.capsule.height,f.refuge.body.height+.025);
 const plain=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1});assert.equal(plain.residents[0].reason,'destination-unmapped');
 let actual=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[f.permit]});assert.equal(actual.residents[0].route!.lengthMetres,9);
 actual=advanceVillageLifeNavigation(actual,{absoluteMinute:5,site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[f.permit]});assert.deepEqual(sampleVillageLifeNavigation(actual,f.site)[0].position,[3,0,2]);
 assert.throws(()=>advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[{...f.permit,residentId:'ealdholt-baker'}]}),/refuge permit/);
 assert.equal(JSON.stringify(f.site),before);assert.equal(f.site.anchors,f.base.anchors);assert.equal(f.site.routes,f.base.routes);assert.deepEqual(f.site.capsule,{radius:.85,height:3.5});
});
test('scoped source loss holds the saved cursor and real return retains the capability until original home arrival',()=>{
 const f=fixture(),input={site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[f.permit]};
 let nav=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0});nav=advanceVillageLifeNavigation(nav,{...input,absoluteMinute:5});const before=nav.residents[0];
 const held=advanceVillageLifeNavigation(nav,{...input,absoluteMinute:6,site:freeze({...f.site,emergencyRefuges:[]}),refugePermits:[]});assert.equal(held.residents[0].progressMetres,before.progressMetres);assert.equal(held.residents[0].route,before.route);assert.match(held.residents[0].reason!,/refuge-/);
 nav=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(nav)),{...input,absoluteMinute:9});assert.equal(nav.residents[0].anchorPlaceId,f.refuge.placeId);assert.equal(ownsExclusiveVillageLifeExteriorAnchor(nav,f.site,child.id),true);
 nav=advanceVillageLifeNavigation(nav,{site:f.site,intents:[f.intent()],metresPerWorldMinute:1,refugePermits:[],absoluteMinute:10});assert.ok(nav.residents[0].emergencyRefuge);assert.ok(nav.residents[0].route);
 nav=advanceVillageLifeNavigation(nav,{site:f.site,intents:[f.intent()],metresPerWorldMinute:1,refugePermits:[],absoluteMinute:19});nav=advanceVillageLifeNavigation(nav,{site:f.site,intents:[f.intent()],metresPerWorldMinute:1,refugePermits:[],absoluteMinute:19});
 assert.equal(nav.residents[0].emergencyRefuge,undefined);assert.equal(nav.residents[0].anchorPlaceId,child.homePlaceId);assert.deepEqual(nav.residents[0].anchorPosition,[0,0,0]);assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');
});
test('an unavailable original source anchor never becomes a refuge placement or teleport',()=>{
 const f=fixture(),empty=createVillageLifeNavigation(0),held=advanceVillageLifeNavigation(empty,{absoluteMinute:0,site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[f.permit]});
 const row=held.residents[0];assert.equal(row.reason,'refuge-source-anchor-required');assert.equal(row.anchorPosition,null);assert.equal(row.route,null);assert.equal(row.arrivalEvidence,'none');assert.equal(row.emergencyRefuge,undefined);
});

test('proof changes, missing neutral transitions and unsupported floor samples cannot grant a refuge',()=>{
 const f=fixture();for(const edit of[(r:any)=>r.body.radius-=.001,(r:any)=>delete r.proof.motionEvidence.residents[child.id].levels.crowd.clips[requiredVillageRefugeMotionClips(child.id)[0]],(r:any)=>r.proof.motionEvidence.residents[child.id].levels.crowd.files[`crowd-v1/residents/${child.id}.glb`]='c'.repeat(64)]){const bad=clone(f.refuge);edit(bad);assert.throws(()=>parseVillageSiteEmergencyRefuges([bad]));}
 const bad=clone(f.refuge)as any;(Object.values(bad.proof.motionEvidence.residents[child.id].levels.crowd.clips)[0]as any).minimumBodyYMetres=-.031;assert.throws(()=>validateVillageSiteEmergencyRefuges(freeze({...f.site,emergencyRefuges:parseVillageSiteEmergencyRefuges([bad])})),/floor/);
 const shifted=clone(f.refuge);(shifted.topology!.route.sourceGroundPolyline[0]as unknown as number[])[0]+=.001;assert.throws(()=>validateVillageSiteEmergencyRefuges(freeze({...f.site,emergencyRefuges:parseVillageSiteEmergencyRefuges([shifted])})),/connector|arcs/);
});
test('operational stations remain reserved for operations, including static not-yet-funded source targets',()=>{
 const f=fixture(),site={...f.site,emergencyTargets:[{anchorId:'connection'}]}as unknown as VillageSiteLayout;
 assert.equal(villageRefugeClearOfOperations([3,0,0],site),false);assert.equal(villageRefugeClearOfOperations([4.5,0,0],site),false);assert.equal(villageRefugeClearOfOperations([6,0,3],site),true);
});
test('a legacy sheltered resident walks away from a newly declared operational stand without teleporting',()=>{
 const f=fixture(),legacySite=freeze({...f.site,residentPlaceBindings:[...f.site.residentPlaceBindings,{residentId:child.id,placeId:'unit-well',anchorId:'connection',status:'mapped-exterior' as const}]}),swine=population.residents.find(p=>p.id==='ealdholt-swineherd')!,building={binding:{catalogueId:'unit-source',sourceSha256:sha,profile:'desktop',buildingId:'unit-burning-home',siteIndex:0},bounds:{min:[-1,0,-1],max:[1,3,1]},position:[0,0,0],outward:[1,0,0],bearing:'east',parts:[]}as SourceBuilding;
 const incident={id:'unit-evacuation',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:0,expiresAbsoluteMinute:100,knownByResidentIds:[child.id],affectedResidentIds:[child.id]},frame:ResidentBuildingEmergencyFrame={siteIdentity:artifact,buildings:[building],incidents:[incident],stations:[],shelterPlaceIds:['unit-well'],refuges:f.site.emergencyRefuges,obstacles:[]};
 let nav=f.start,emergency=createResidentBuildingEmergency(worldKey,0);
 const tick=(minute:number,site=legacySite,nextFrame=frame)=>{
  const move=()=>{nav=advanceVillageLifeNavigation(nav,{absoluteMinute:minute,site,intents:residentBuildingEmergencyIntents(emergency,[f.intent()]),metresPerWorldMinute:1,refugePermits:residentBuildingEmergencyRefugePermits(emergency,site)});};
  move();emergency=advanceResidentBuildingEmergency(emergency,{absoluteMinute:minute,worldKey,residents:[child],routineIntents:[f.intent()],navigation:nav,site,frame:nextFrame});move();
 };
 for(let minute=0;minute<=3;minute++)tick(minute);assert.equal(emergency.duties[0].phase,'sheltered');assert.equal(nav.residents[0].anchorPlaceId,'unit-well');
 const target={id:'unit-water-template',residentId:swine.id,placeId:'unit-water-action',anchorId:'connection',kind:'water' as const,buildingKey:null,sourceActor:'unit-original-terrain',contactPoint:[3,1,0]as VillageSitePoint,yawRadians:0,clip:'carry_bucket_walk' as const,operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop' as const,siteIdentity:artifact,originalTriangleClearance:true as const,wholeFootprintSupported:true as const,sweptClipAndPropsClear:true as const,contactSourceActor:'unit-source-well',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}};
 const changed=freeze({...legacySite,emergencyTargets:[target],residentPlaceBindings:[...legacySite.residentPlaceBindings,{residentId:swine.id,placeId:target.placeId,anchorId:'connection',status:'mapped-exterior' as const}]})as VillageSiteLayout;
 tick(3,changed);assert.equal(emergency.duties[0].targetPlaceId,f.refuge.placeId);assert.equal(emergency.duties[0].phase,'evacuating');assert.deepEqual(sampleVillageLifeNavigation(nav,changed)[0].position,[3,0,0]);
 tick(4,changed);assert.deepEqual(sampleVillageLifeNavigation(nav,changed)[0].position,[3,0,1]);assert.equal(emergency.waterDeliveries.length,0);assert.equal(emergency.repairProgress.length,0);
});
function worldFixture(person=child){
 const f=fixture(person),others=population.residents.filter(p=>p.id!==person.id),anchors=[...f.base.anchors,...others.map((p,i)=>({id:'unit-home-'+i,sourceActor:'unit-original-terrain',sourceGroundPoint:[100+i*4,0,0]as VillageSitePoint,capsuleBottomPoint:[100+i*4,.02,0]as VillageSitePoint,standingOnly:true as const}))];
 const original=freeze({...f.base,anchors,placeBindings:[],residentPlaceBindings:[...f.base.residentPlaceBindings,...others.map((p,i)=>({residentId:p.id,placeId:p.homePlaceId,anchorId:'unit-home-'+i,status:'mapped-exterior' as const}))]});
 const site=freeze({...original,emergencyRefuges:f.site.emergencyRefuges});
 const building=freeze({binding:{catalogueId:'unit-source-building',sourceSha256:sha,profile:'desktop',buildingId:'unit-house-fire',siteIndex:0},bounds:{min:[-1,0,-1],max:[1,3,1]},position:[0,0,0],outward:[1,0,0],bearing:'east',parts:[]})as SourceBuilding;
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:artifact,buildings:[building],incidents:[{id:'unit-known-fire',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:0,expiresAbsoluteMinute:100,knownByResidentIds:[person.id],affectedResidentIds:[person.id]}],stations:[],shelterPlaceIds:[],refuges:site.emergencyRefuges,obstacles:[]};
 const made=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'unit-refuge',createdAt:1000,initialDayMinute:0,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:1});if(!made.ok)assert.fail(made.error);
 const bound=advanceVillagePopulationRuntime(made.snapshot,{expectedGeneration:made.snapshot.generation,worldKey,contentRevision:'unit-refuge',observedAt:1000,maxAdvanceMinutes:1,site:original});if(!bound.ok)assert.fail(bound.error);
 return{...f,site,original,frame,canonical:bound.snapshot};
}
test('the full100-resident checkpoint persists only used refuge proofs and completes actual evacuation and return',()=>{
 const f=worldFixture(),before=serializeVillagePopulationRuntime(f.canonical);let step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame});
 assert.equal(step.checkpoint.emergencyRefuges.length,1);assert.equal(step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===child.id)!.kind,'evacuate');
 for(let minute=1;minute<=9;minute++){step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,JSON.stringify(step.checkpoint),minute*1000,{site:f.site,frame:f.frame});if(minute<9)assert.notEqual(step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===child.id)!.phase,'sheltered');}
 assert.equal(step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===child.id)!.phase,'sheltered');assert.equal(step.checkpoint.navigation.residents.find(r=>r.residentId===child.id)!.arrivalEvidence,'certified-route-arrival');
 for(let minute=10;minute<=19;minute++)step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,JSON.stringify(step.checkpoint),minute*1000,{site:f.site,frame:{...f.frame,incidents:[]}});
 const row=step.checkpoint.navigation.residents.find(r=>r.residentId===child.id)!;assert.equal(row.anchorPlaceId,child.homePlaceId);assert.equal(row.emergencyRefuge,undefined);assert.equal(step.checkpoint.emergencyRefuges.length,0);assert.deepEqual(serializeVillagePopulationRuntime(f.canonical),before);assert.equal(step.checkpoint.buildingEmergency.waterDeliveries.length,0);
});
test('used refuge checkpoint rejects removed or changed source capability while an unused new branch may be adopted',()=>{
 const f=worldFixture(),step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame}),raw=JSON.stringify(step.checkpoint);assert.doesNotThrow(()=>parseVillagePopulationEmergencyCheckpoint(raw));
 assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,raw,1000,{site:freeze({...f.site,emergencyRefuges:[]}),frame:f.frame}),/refuge source proof changed/);
 const changed=freeze({...f.site,emergencyRefuges:[{...f.refuge,certificateSha256:'c'.repeat(64)}]});assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,raw,1000,{site:changed,frame:f.frame}),/refuge source proof changed/);
 const extra=freeze({...f.refuge,id:'unit-new-unused-refuge',placeId:'unit-new-unused-refuge-place'});assert.doesNotThrow(()=>advanceVillagePopulationEmergencyCheckpoint(f.canonical,raw,1000,{site:freeze({...f.site,emergencyRefuges:[f.refuge,extra]}),frame:f.frame}));assert.equal(JSON.stringify(step.checkpoint),raw);
});
test('no refuge capacity cannot materialize an indoor household outside into its burning doorway',()=>{
 const f=worldFixture(),frame={...f.frame,refuges:[],obstacles:[{id:'unit-door-fire',kind:'fire' as const,sourceSha256:sha,profile:'desktop' as const,activeFromAbsoluteMinute:0,bounds:{min:[-.2,0,-.2]as VillageSitePoint,max:[.2,2,.2]as VillageSitePoint}}]};
 const before=f.canonical.navigation.residents.find(r=>r.residentId===child.id)!,step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame});
 const row=step.checkpoint.navigation.residents.find(r=>r.residentId===child.id)!,duty=step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===child.id)!;
 assert.equal(duty.phase,'held');assert.equal(duty.reason,'emergency-shelter-capacity');assert.equal(row.inside,true);assert.equal(row.route,null);assert.deepEqual(row.anchorPosition,before.anchorPosition);assert.equal(row.arrivalEvidence,'initial-placement');assert.equal(row.arrivedAtAbsoluteMinute,null);assert.equal(row.reason,'dynamic-obstacle');
 assert.equal(step.checkpoint.buildingEmergency.waterDeliveries.length,0);assert.equal(step.checkpoint.buildingEmergency.repairProgress.length,0);assert.doesNotThrow(()=>parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint)));
});

test('a live refuge cursor pins its certificate and cannot continue through same-ID source drift',()=>{
 const f=fixture(),input={site:f.site,intents:[f.intent(f.refuge.placeId)],metresPerWorldMinute:1,refugePermits:[f.permit]};
 let nav=advanceVillageLifeNavigation(f.start,{...input,absoluteMinute:0});nav=advanceVillageLifeNavigation(nav,{...input,absoluteMinute:2});const before=nav.residents[0];
 assert.equal(before.emergencyRefuge!.certificates![f.refuge.id],f.refuge.certificateSha256);
 const changed=freeze({...f.site,emergencyRefuges:[{...f.refuge,certificateSha256:'c'.repeat(64)}]});
 const held=advanceVillageLifeNavigation(nav,{...input,site:changed,absoluteMinute:3});assert.equal(held.residents[0].reason,'refuge-source-permit-changed');assert.equal(held.residents[0].progressMetres,before.progressMetres);assert.strictEqual(held.residents[0].route,before.route);
 assert.deepEqual(villageLifeNavigationPeerBody(before,changed,nav.siteIdentity),f.base.capsule,'A stale capability never grants a smaller peer body.');
});

test('refuge route IDs match navigation contracts and exact terrain profiles remain bounded at256 points',()=>{
 const f=fixture();for(const invalid of['x'.repeat(193),'unqualified-\u00e9','constructor','prototype']){assert.throws(()=>parseVillageSiteEmergencyRefuges([{...f.refuge,id:invalid}]));}
 const route=f.refuge.topology!.route,points=Array.from({length:256},(_,i)=>{const t=i/255;return(t<=.5?[3,0,6*t]:[3+6*(t-.5),0,3])as VillageSitePoint;}),length=points.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-points[i][k])),0);
 const r=freeze({...f.refuge,topology:{...f.refuge.topology!,route:{...route,sourceGroundPolyline:points,capsuleBottomPolyline:points.map(body),lengthMetres:length}}});
 assert.equal(parseVillageSiteEmergencyRefuges(JSON.parse(JSON.stringify([r])))[0].topology!.route.sourceGroundPolyline.length,256);
 assert.throws(()=>parseVillageSiteEmergencyRefuges([{...r,topology:{...r.topology,route:{...r.topology.route,sourceGroundPolyline:[...points,points[255]],capsuleBottomPolyline:[...points.map(body),body(points[255])]}}}]),/supplemental geometry/);
});

test('only a currently source-qualified peer uses its measured refuge body in corridor reservations',()=>{
 const a=fixture(),adult=population.residents.find(p=>p.id==='ealdholt-baker')!,b=fixture(adult),point:VillageSitePoint=[6,0,4.2];
 const second=freeze({...b.refuge,id:'unit-second-refuge',placeId:'unit-second-refuge-place',anchorId:'unit-second-refuge-anchor',proof:{...b.refuge.proof,sourceGroundPoint:point,capsuleBottomPoint:body(point)},topology:{anchor:{...b.refuge.topology!.anchor,id:'unit-second-refuge-anchor',sourceGroundPoint:point,capsuleBottomPoint:body(point)},route:{...b.refuge.topology!.route,id:'unit-second-refuge-route',to:'unit-second-refuge-anchor',sourceGroundPolyline:[[3,0,0],[3,0,4.2],point]as readonly VillageSitePoint[],capsuleBottomPolyline:[[3,.02,0],[3,.02,4.2],body(point)]as readonly VillageSitePoint[],lengthMetres:7.2}}});
 const otherHome:VillageSitePoint=[0,0,-4],site=freeze({...a.base,anchors:[...a.base.anchors,{id:'unit-other-home',sourceActor:'unit-original-terrain',sourceGroundPoint:otherHome,capsuleBottomPoint:body(otherHome),standingOnly:true}],routes:[...a.base.routes,a.route('unit-other-home-route','unit-other-home','connection',[otherHome,[3,0,0]])],residentPlaceBindings:[...a.base.residentPlaceBindings,{residentId:adult.id,placeId:adult.homePlaceId,anchorId:'unit-other-home',status:'mapped-exterior'}],emergencyRefuges:parseVillageSiteEmergencyRefuges([a.refuge,second])})as VillageSiteLayout;
 const input=(minute:number,secondMoves:boolean)=>({absoluteMinute:minute,site,metresPerWorldMinute:1,intents:[a.intent(a.refuge.placeId),{...b.intent(secondMoves?second.placeId:adult.homePlaceId),indoor:!secondMoves}],refugePermits:[a.permit,...(secondMoves?[{residentId:adult.id,ids:[second.id]}]:[])]});
 let nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{...input(0,false),refugePermits:[],intents:[{...a.intent(),indoor:true},{...b.intent(),indoor:true}]});
 nav=advanceVillageLifeNavigation(nav,input(0,false));nav=advanceVillageLifeNavigation(nav,input(9,false));const parked=nav.residents.find(r=>r.residentId===child.id)!;
 assert.equal(parked.anchorPlaceId,a.refuge.placeId);assert.equal(villageLifeNavigationPeerBody(parked,site,nav.siteIdentity).radius,a.refuge.body.radius+.005);
 const unqualified=parseVillageLifeNavigation(JSON.stringify({...nav,residents:nav.residents.map(r=>r.residentId===child.id?{...r,emergencyRefuge:{...r.emergencyRefuge,certificates:{[a.refuge.id]:'c'.repeat(64)}}}:r)}));
 assert.deepEqual(villageLifeNavigationPeerBody(unqualified.residents.find(r=>r.residentId===child.id)!,site,nav.siteIdentity),site.capsule);
 const held=advanceVillageLifeNavigation(unqualified,input(9,true));assert.equal(held.residents.find(r=>r.residentId===adult.id)!.reason,'corridor-reserved');
 for(let minute=9;minute<=22;minute++)nav=advanceVillageLifeNavigation(nav,input(minute,true));
 const arrived=nav.residents.find(r=>r.residentId===adult.id)!;assert.equal(arrived.anchorPlaceId,second.placeId);assert.equal(arrived.arrivalEvidence,'certified-route-arrival');assert.deepEqual(site.capsule,{radius:.85,height:3.5});
});

test('neutral refuge evidence includes the actual archetype variant start and stop clips',()=>{
 for(const [residentId,walk]of [['ealdholt-guard-serjeant','walk_b'],['ealdholt-baker','walk_c'],['ealdholt-east-grandmother','walk_stick']]){
  const required=requiredVillageRefugeMotionClips(residentId);assert.ok(required.includes(walk));assert.ok(required.includes(`${walk}_start`));assert.ok(required.includes(`${walk}_stop`));
  const person=population.residents.find(p=>p.id===residentId)!,f=fixture(person),missing=clone(f.refuge)as any;
  delete missing.proof.motionEvidence.residents[residentId].levels.crowd.clips[`${walk}_start`];assert.throws(()=>parseVillageSiteEmergencyRefuges([missing]),/neutral idle\/walk transition/);
  const larger=clone(f.refuge)as any;larger.proof.motionEvidence.residents[residentId].levels.crowd.clips[`${walk}_start`].radiusMetres=.6;
  assert.throws(()=>parseVillageSiteEmergencyRefuges([larger]),/motion envelope/,'a larger start pose cannot be hidden behind a loop-only body');
 }
});

test('raw checkpoints enforce the UTF8 byte budget before admitting any trusted recovery state',()=>{
 const f=worldFixture(),step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site:f.site,frame:f.frame});
 const raw=JSON.stringify({...step.checkpoint,oversizedUnicode:Array.from({length:65},()=> 'é'.repeat(10_000))});
 assert.ok(raw.length<2*1024*1024,'UTF16 length alone would admit this payload');assert.ok(new TextEncoder().encode(raw).byteLength>2*1024*1024);
 assert.throws(()=>parseVillagePopulationEmergencyCheckpoint(raw),/data budget/);assert.throws(()=>parseVillagePopulationEmergencyCheckpoint(JSON.parse(raw)),/data budget/);
 assert.doesNotThrow(()=>parseVillagePopulationEmergencyCheckpoint(JSON.stringify(step.checkpoint)),'a failed admission does not poison valid recovery');
});

test('a saved adult walks neutrally from refuge to the real well before taking a bucket, earns contact water and returns home',()=>{
 const person=population.residents.find(p=>p.id==='ealdholt-swineherd')!,f=worldFixture(person),pins=Object.keys(files).filter(p=>p===`crowd-v1/residents/${person.id}.glb`||p===`crowd-v1/residents/${person.id}.json`||p==='crowd-v1/clips/crowd-clips-adult-male-v1.glb'||p==='crowd-v1/clips/manifest.json'||p==='crowd-v1/props/kits.json'||p.startsWith('crowd-v1/props/')&&p.endsWith('.glb'));
 const carry=parseVillageSiteEmergencyTraversals([{id:'unit-refuge-bucket-carry',residentId:person.id,profile:'desktop',sourceSha256:sha,siteIdentity:artifact,certificateSha256:'d'.repeat(64),fromAnchorId:'home',toAnchorId:'connection',reversible:true,requiredClip:'carry_bucket_walk',sourceGroundPolyline:[[0,0,0],[3,0,0]],capsuleBottomPolyline:[[0,.02,0],[3,.02,0]],lengthMetres:3,body:{radius:.6231633375592951,height:1.9020472484796265,margin:.005,lift:.02},files:Object.fromEntries(pins.map(p=>[p,files[p]])),proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false}}])[0];
 const building=freeze({...f.frame.buildings[0],bounds:{min:[-1,0,-1],max:[11,3,1]},parts:[{id:'unit-wall',kind:'wall',sourceActor:'unit-wall',sourceOrdinal:0,bounds:{min:[10,0,-1],max:[10.5,3,1]}}]})as SourceBuilding;
 const station=(kind:'water'|'fire'):ResidentBuildingEmergencyStation=>({id:`unit-refuge-${kind}-station`,disasterId:f.frame.incidents[0].id,residentId:person.id,placeId:`unit-refuge-${kind}-action`,anchorId:kind==='water'?'connection':'ordinary',kind,buildingKey:kind==='water'?null:buildingDamageKey(building.binding),sourceActor:'unit-original-terrain',contactPoint:kind==='water'?[3,.8,0]:[10.2,1,0],yawRadians:0,clip:'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:artifact,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:kind==='water'?'unit-source-well':'unit-wall',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}});
 const stations=[station('water'),station('fire')],targets=stations.map(({disasterId:_,...t})=>t),site=freeze({...f.site,emergencyTraversals:[carry],emergencyTargets:targets,residentPlaceBindings:[...f.site.residentPlaceBindings,...targets.map(t=>({residentId:t.residentId,placeId:t.placeId,anchorId:t.anchorId,status:'mapped-exterior' as const}))]}),frame:ResidentBuildingEmergencyFrame={...f.frame,buildings:[building],stations},empty={...frame,incidents:[],stations:[]},before=serializeVillagePopulationRuntime(f.canonical);
 let step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,null,0,{site,frame}),sawRefuge=false,sawNeutralReturn=false,sawCarry=false,firstDelivery:number|null=null;
 for(let minute=1;minute<=55;minute++){
  step=advanceVillagePopulationEmergencyCheckpoint(f.canonical,JSON.stringify(step.checkpoint),minute*1000,{site,frame:firstDelivery===null?frame:empty});
  const row=step.checkpoint.navigation.residents.find(r=>r.residentId===person.id)!,duty=step.checkpoint.buildingEmergency.duties.find(d=>d.residentId===person.id);
  assert.ok(!(row.emergencyRefuge&&row.emergencyTraversal),'neutral refuge geometry and carried props never overlap permissions');assert.notEqual(row.reason,'refuge-carry-conflict');
  if(row.anchorPlaceId===f.refuge.placeId){sawRefuge=true;assert.ok(minute>=9,'the real nine metre route must finish before the anchor can change');}
  if(duty?.kind==='water'&&row.emergencyRefuge){sawNeutralReturn=true;assert.equal(row.emergencyTraversal,undefined);assert.equal(step.checkpoint.buildingEmergency.waterDeliveries.length,0);}
  if(row.emergencyTraversal){sawCarry=true;assert.equal(row.emergencyRefuge,undefined);if(!row.route)assert.notEqual(row.anchorPlaceId,f.refuge.placeId);}
  if(step.checkpoint.buildingEmergency.waterDeliveries.length&&firstDelivery===null)firstDelivery=minute;
  if(firstDelivery!==null&&!duty)break;
 }
 assert.equal(sawRefuge,true);assert.equal(sawNeutralReturn,true);assert.equal(sawCarry,true);assert.notEqual(firstDelivery,null);assert.ok(firstDelivery!>=24,'nine metres out, six back, real drawing, seven metre carry and delivery precede credit');
 const final=step.checkpoint.navigation.residents.find(r=>r.residentId===person.id)!;assert.equal(step.checkpoint.buildingEmergency.duties.some(d=>d.residentId===person.id),false);assert.equal(final.anchorPlaceId,person.homePlaceId);assert.equal(final.route,null);assert.equal(final.emergencyTraversal,undefined);assert.equal(final.emergencyRefuge,undefined);assert.equal(final.arrivalEvidence,'certified-route-arrival');assert.deepEqual(serializeVillagePopulationRuntime(f.canonical),before);
});


test('private carry junctions, fire stands and supplemental corridors cannot become parked refuges',()=>{
 const f=fixture(),brewster=population.residents.find(p=>p.id==='ealdholt-brewster')!,anchor={id:'unit-private-carry-stand',sourceActor:'unit-original-terrain',sourceGroundPoint:[3,0,10]as VillageSitePoint,capsuleBottomPoint:[3,.02,10]as VillageSitePoint,standingOnly:true as const};
 const carry=parseVillageSiteEmergencyTraversals([{id:'unit-private-carry',residentId:brewster.id,profile:'desktop',sourceSha256:sha,siteIdentity:artifact,certificateSha256:'d'.repeat(64),fromAnchorId:'home',toAnchorId:'connection',reversible:true,requiredClip:'carry_bucket_walk',sourceGroundPolyline:[[0,0,0],[3,0,0]],capsuleBottomPolyline:[[0,.02,0],[3,.02,0]],lengthMetres:3,body:brewsterProfile.body,files:brewsterProfile.files,proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false},topology:{anchors:[anchor],routes:[{id:'unit-private-carry-connector',from:'connection',to:anchor.id,reversible:true,sourceGroundPolyline:[[3,0,0],[3,0,10]],capsuleBottomPolyline:[[3,.02,0],[3,.02,10]],lengthMetres:10}],residentPlaceBindings:[{residentId:brewster.id,placeId:'unit-private-carry-action',anchorId:anchor.id,status:'mapped-exterior'}]}}])[0];
 const site=freeze({...f.base,emergencyTraversals:[carry]}),padding=site.capsule.radius+carry.body.radius+carry.body.margin;
 assert.equal(site.anchors.some(a=>a.id===anchor.id),false,'The exclusion does not turn private action topology into base navigation.');
 assert.equal(villageRefugeClearOfOperations([3.5,0,7],site),false,'A supplemental corridor remains reserved even far from the primary home→well route.');
 assert.equal(villageRefugeClearOfOperations([3,0,10],site),false,'A private action/junction stand is reserved before live work begins.');
 assert.equal(villageRefugeClearOfOperations([3+padding-.0001,0,10],site),false);
 assert.equal(villageRefugeClearOfOperations([3+padding+.0001,0,7],site),true,'Use the exact declared carry envelope plus the refuge radius rather than an unrelated global body.');
 assert.equal(villageRefugeClearOfOperations([3,3,7],site),true,'A distinct elevation above the measured carry body is not inside its swept space.');
});
