import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files} from './population-asset-integrity';
import {parsePopulationMotionEvidence} from './population-motion-clearance';
import {requiredVillageWorkplaceMotionClips,parseVillageSiteWorkplaceRoutes,validateVillageSiteWorkplaceRoutes,scopedVillageWorkplaceRouteSite,type VillageSiteWorkplaceRoute} from './village-workplace-routes';
import {resolveVillageSiteEndpoint,type VillageSiteLayout,type VillageSitePoint} from './village-site';
import {createVillageLifeNavigation,advanceVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,villageLifeNavigationPeerBody,ownsExclusiveVillageLifeExteriorAnchor,ownsExclusiveVillageWorkplaceOperation,qualifiedVillageLifeVisualRoute} from './village-life-navigation';
import type {VillageLifeIntent} from './village-life';
import {deriveVillageRefugeBody,parseVillageSiteEmergencyRefuges} from './village-emergency-refuges';
const person=population.residents.find(p=>p.id==='ealdholt-woodcutter')!,peer=population.residents.find(p=>p.id==='ealdholt-baker')!,sha='a'.repeat(64);
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const bottom=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]];
function fixture(targetPerson=person){
 const person=targetPerson;
 const points:Record<string,VillageSitePoint>={home:[0,0,0],junction:[3,0,0],other:[10,0,0]};
 const anchor=(id:string,p:VillageSitePoint)=>({id,sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const});
 const route=(id:string,from:string,to:string,g:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:g,capsuleBottomPolyline:g.map(bottom),lengthMetres:g.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-g[i][k])),0)});
 const base=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:Object.entries(points).map(([id,p])=>anchor(id,p)),routes:[route('original-home-lane','home','junction',[points.home,points.junction])],placeBindings:[],residentPlaceBindings:[{residentId:person.id,placeId:person.homePlaceId,anchorId:'home',status:'mapped-exterior'},{residentId:person.id,placeId:person.workPlaceId,anchorId:null,status:'unmapped'},{residentId:peer.id,placeId:peer.homePlaceId,anchorId:'other',status:'mapped-exterior'}]})as VillageSiteLayout;
 const clips=Object.fromEntries(requiredVillageWorkplaceMotionClips(person.id).map(name=>[name,{radiusMetres:.4,heightMetres:1.2,minimumBodyYMetres:-.01,placedBelowGround:false}]));
 const motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[person.id]:{levels:{crowd:{files:{...files},clips}}}}});
 const work:VillageSitePoint=[6,0,3],cap=freeze({id:'unit-workplace-route',residentId:person.id,placeId:person.workPlaceId,anchorId:'unit-work-stand',sourceActor:'unit-original-terrain',certificateSha256:'b'.repeat(64),
  body:{radius:.67,height:2.1,margin:.005,lift:.02,zeroCrossfade:true},proof:{sourceSha256:sha,profile:'desktop',siteIdentity:'unit-source-artifact',sourceGroundPoint:work,capsuleBottomPoint:bottom(work),originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,publicExteriorOnly:true,motionEvidence:motion},
  topology:{anchor:anchor('unit-work-stand',work),route:route('unit-work-connector','junction','unit-work-stand',[points.junction,[3,0,3],work])}})as VillageSiteWorkplaceRoute;
 const site=freeze({...base,workplaceRoutes:parseVillageSiteWorkplaceRoutes([cap])});
 const intent=(target=person.homePlaceId,who=person.id,reason:VillageLifeIntent['reason']='routine'):VillageLifeIntent=>({residentId:who,targetPlaceId:target,activityKey:target===person.workPlaceId?'work':'home',activity:'Unit actual route.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason});
 const start=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[intent()],metresPerWorldMinute:1});
 return{base,site,cap,intent,start};
}
test('ordinary workplace route stays private and automatic admission requires its actual resident departure',()=>{
 const f=fixture(),before=JSON.stringify(f.site);assert.equal(validateVillageSiteWorkplaceRoutes(f.site).length,1);assert.equal(resolveVillageSiteEndpoint(f.site,person.workPlaceId,person.id),null);
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 assert.ok(nav.residents[0].workplaceRoute);assert.equal(nav.residents[0].workplaceRoute!.returnPlaceId,person.homePlaceId);assert.equal(nav.residents[0].route!.lengthMetres,9);assert.equal(qualifiedVillageLifeVisualRoute(nav.residents[0],f.site),true);
 assert.deepEqual(villageLifeNavigationPeerBody(nav.residents[0],f.site,nav.siteIdentity),{radius:.675,height:2.125});
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:5,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});assert.deepEqual(sampleVillageLifeNavigation(nav,f.site)[0].position,[3,0,2]);
 assert.equal(JSON.stringify(f.site),before);assert.strictEqual(f.site.anchors,f.base.anchors);assert.strictEqual(f.site.routes,f.base.routes);assert.deepEqual(f.site.capsule,{radius:.85,height:3.5});
 const stranger=scopedVillageWorkplaceRouteSite(f.site,nav.residents[0].workplaceRoute!,peer.id);assert.equal(stranger,null);
});
test('workplace arrival, reload and actual return retain source proof until an original anchor is reached',()=>{
 const f=fixture();let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 nav=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(nav)),{absoluteMinute:9,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 assert.equal(nav.residents[0].anchorPlaceId,person.workPlaceId);assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');assert.equal(ownsExclusiveVillageLifeExteriorAnchor(nav,f.site,person.id),true);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:10,site:f.site,intents:[f.intent()],metresPerWorldMinute:1});assert.ok(nav.residents[0].route);assert.ok(nav.residents[0].workplaceRoute);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:19,site:f.site,intents:[f.intent()],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:19,site:f.site,intents:[f.intent()],metresPerWorldMinute:1});
 assert.equal(nav.residents[0].workplaceRoute,undefined);assert.equal(nav.residents[0].anchorPlaceId,person.homePlaceId);assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');
});
test('missing or drifted workplace source holds physical cursor and cannot invent placement',()=>{
 const f=fixture();const absent=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,allowInitialPlacement:false});
 assert.equal(absent.residents[0].anchorPosition,null);assert.equal(absent.residents[0].workplaceRoute,undefined);
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:4,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 const held=advanceVillageLifeNavigation(nav,{absoluteMinute:5,site:freeze({...f.site,workplaceRoutes:[]}),intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 assert.equal(held.residents[0].progressMetres,nav.residents[0].progressMetres);assert.equal(held.residents[0].route,nav.residents[0].route);assert.equal(held.residents[0].reason,'workplace-source-permit-changed');
 assert.deepEqual(villageLifeNavigationPeerBody(held.residents[0],freeze({...f.site,workplaceRoutes:[]}),held.siteIdentity),f.base.capsule);
});
test('source capability rejects wrong work, source, undersized body, missing neutral clips and altered graph endpoints',()=>{
 const f=fixture();for(const edit of[(r:any)=>r.placeId=person.homePlaceId,(r:any)=>r.residentId=peer.id,(r:any)=>r.body.radius=.44,(r:any)=>delete r.proof.motionEvidence.residents[person.id].levels.crowd.clips[requiredVillageWorkplaceMotionClips(person.id)[0]]]){const bad=copy(f.cap);edit(bad);assert.throws(()=>parseVillageSiteWorkplaceRoutes([bad]));}
 const shifted=copy(f.cap);(shifted.topology.route.sourceGroundPolyline[0]as unknown as number[])[0]+=.001;assert.throws(()=>validateVillageSiteWorkplaceRoutes(freeze({...f.base,workplaceRoutes:parseVillageSiteWorkplaceRoutes([shifted])})));
 const changed=copy(f.cap);(changed.proof as any).sourceSha256='c'.repeat(64);assert.throws(()=>validateVillageSiteWorkplaceRoutes(freeze({...f.base,workplaceRoutes:parseVillageSiteWorkplaceRoutes([changed])})));
});
test('an unrelated resident retains original body and cannot acquire another person workplace branch',()=>{
 const f=fixture(),nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});
 const held=advanceVillageLifeNavigation(nav,{absoluteMinute:1,site:f.site,intents:[f.intent(person.workPlaceId,peer.id)],metresPerWorldMinute:1});assert.equal(held.residents[0].workplaceRoute,undefined);assert.equal(held.residents[0].reason,'destination-unmapped');assert.deepEqual(villageLifeNavigationPeerBody(held.residents[0],f.site,held.siteIdentity),f.base.capsule);
});

test('temporary community timber access requires exact explicit permit and never rewrites profession or home',()=>{
 const mason=population.residents.find(p=>p.id==='ealdholt-master-mason')!,f=fixture(mason),before=JSON.stringify(population);
 const cap=parseVillageSiteWorkplaceRoutes([{...f.cap,purpose:'community-timber',placeId:'woodland-edge'}])[0],site=freeze({...f.base,workplaceRoutes:[cap]}),intent=f.intent('woodland-edge',mason.id);
 const permit={residentId:mason.id,id:cap.id,certificateSha256:cap.certificateSha256};
 const denied=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[intent],metresPerWorldMinute:1});assert.equal(denied.residents[0].workplaceRoute,undefined);assert.equal(denied.residents[0].reason,'destination-unmapped');
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[intent],metresPerWorldMinute:1,workplacePermits:[permit]});assert.ok(nav.residents[0].workplaceRoute);assert.equal(nav.residents[0].targetPlaceId,'woodland-edge');
 assert.throws(()=>advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[intent],metresPerWorldMinute:1,workplacePermits:[{...permit,residentId:peer.id}]}),/community workplace permit/);
 const threatened=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[{...intent,reason:'safety'}],metresPerWorldMinute:1,workplacePermits:[permit]});assert.equal(threatened.residents[0].workplaceRoute,undefined);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:4,site,intents:[intent],metresPerWorldMinute:1,workplacePermits:[permit]});
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:5,site,intents:[intent],metresPerWorldMinute:1});assert.equal(nav.residents[0].direction,-1);assert.equal(nav.residents[0].targetPlaceId,mason.homePlaceId);assert.ok(nav.residents[0].workplaceRoute,'Revocation retains real source path for actual return.');
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:10,site,intents:[intent],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:10,site,intents:[intent],metresPerWorldMinute:1});assert.equal(nav.residents[0].workplaceRoute,undefined);assert.deepEqual(nav.residents[0].anchorPosition,[0,0,0]);assert.equal(JSON.stringify(population),before);
});

test('work operation requires actual source arrival and reserves a larger tool body against peers',()=>{
 const f=fixture(),body={radius:1.44,height:2.8};assert.equal(ownsExclusiveVillageWorkplaceOperation(f.start,f.site,person.id,body),false);
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:9,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});assert.equal(ownsExclusiveVillageWorkplaceOperation(nav,f.site,person.id,body),true);
 const nearSite=freeze({...f.site,anchors:f.site.anchors.map(a=>a.id==='other'?{...a,sourceGroundPoint:[7.8,0,3]as VillageSitePoint,capsuleBottomPoint:[7.8,.02,3]as VillageSitePoint}:a)});
 let pair=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:nearSite,intents:[f.intent(),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});
 pair=advanceVillageLifeNavigation(pair,{absoluteMinute:0,site:nearSite,intents:[f.intent(person.workPlaceId),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});pair=advanceVillageLifeNavigation(pair,{absoluteMinute:9,site:nearSite,intents:[f.intent(person.workPlaceId),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});
 assert.equal(pair.residents[0].arrivalEvidence,'certified-route-arrival');assert.equal(ownsExclusiveVillageWorkplaceOperation(pair,nearSite,person.id,body),false,'A neutral stand can fit while its operating tool envelope cannot.');
 const forged=copy(pair)as any;forged.residents[1].anchorPosition[0]+=100;const bad=parseVillageLifeNavigation(forged);assert.equal(ownsExclusiveVillageWorkplaceOperation(bad,nearSite,person.id,body),false,'Same-source forged peer geometry never becomes empty operating space.');
});

test('solid operation zones exclude only their named operator and cannot exempt actors from fire',()=>{
 const f=fixture(),zone={id:'unit-operation-zone',sourceSha256:sha,profile:'desktop' as const,activeFromAbsoluteMinute:0,kind:'solid' as const,exceptResidentId:person.id,bounds:{min:[2.5,-1,-.5]as VillageSitePoint,max:[3.5,3,.5]as VillageSitePoint}};
 let allowed=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,dynamicObstacles:[zone]});assert.ok(allowed.residents[0].route);
 allowed=advanceVillageLifeNavigation(allowed,{absoluteMinute:3,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,dynamicObstacles:[zone]});assert.deepEqual(sampleVillageLifeNavigation(allowed,f.site)[0].position,[3,0,0]);
 const {exceptResidentId:_,...ordinary}=zone;const denied=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,dynamicObstacles:[ordinary]});assert.equal(denied.residents[0].reason,'dynamic-obstacle');assert.equal(denied.residents[0].route,null);
 assert.throws(()=>advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,dynamicObstacles:[{...zone,kind:'fire'}]}),/dynamic obstacle/);
});

test('operation clearance rejects a future peer arc that fits past the smaller neutral body',()=>{
 const f=fixture(),start:VillageSitePoint=[10,0,1],end:VillageSitePoint=[0,0,1],site=freeze({...f.site,
  anchors:[...f.site.anchors.map(a=>a.id==='other'?{...a,sourceGroundPoint:start,capsuleBottomPoint:bottom(start)}:a),{id:'unit-peer-work',sourceActor:'unit-original-terrain',sourceGroundPoint:end,capsuleBottomPoint:bottom(end),standingOnly:true as const}],
  routes:[...f.site.routes,{id:'unit-peer-pass',from:'other',to:'unit-peer-work',reversible:true as const,sourceGroundPolyline:[start,end],capsuleBottomPolyline:[bottom(start),bottom(end)],lengthMetres:10}],
  residentPlaceBindings:[...f.site.residentPlaceBindings,{residentId:peer.id,placeId:peer.workPlaceId,anchorId:'unit-peer-work',status:'mapped-exterior' as const}]});
 let nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[f.intent(),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:0,site,intents:[f.intent(person.workPlaceId),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:9,site,intents:[f.intent(person.workPlaceId),f.intent(peer.homePlaceId,peer.id)],metresPerWorldMinute:1});
 assert.equal(ownsExclusiveVillageWorkplaceOperation(nav,site,person.id,{radius:1.44,height:2.8}),true,'Current separated bodies have enough operating space.');
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:9,site,intents:[f.intent(person.workPlaceId),f.intent(peer.workPlaceId,peer.id)],metresPerWorldMinute:1});assert.ok(nav.residents.find(r=>r.residentId===peer.id)!.route,'The path is valid around the smaller neutral body.');
 assert.equal(ownsExclusiveVillageWorkplaceOperation(nav,site,person.id,{radius:1.44,height:2.8}),false,'Starting work cannot capture a peer already travelling through the future operation zone.');
});

test('source-admitted work never becomes a new initial placement at its private endpoint',()=>{
 const f=fixture(),nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 assert.equal(nav.residents[0].anchorPosition,null);assert.equal(nav.residents[0].arrivalEvidence,'none');assert.equal(nav.residents[0].workplaceRoute,undefined);assert.equal(nav.residents[0].reason,'destination-unmapped');
});

test('a new work goal cannot shrink an already travelling ordinary source body mid-leg',()=>{
 const f=fixture(),site=freeze({...f.site,placeBindings:[{placeId:'unit-original-well',anchorId:'junction',status:'mapped-exterior' as const}]});
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[f.intent('unit-original-well')],metresPerWorldMinute:1});assert.ok(nav.residents[0].route);assert.equal(nav.residents[0].workplaceRoute,undefined);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:1,site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});assert.equal(nav.residents[0].workplaceRoute,undefined);assert.deepEqual(villageLifeNavigationPeerBody(nav.residents[0],site,nav.siteIdentity),f.base.capsule);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:2,site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});assert.equal(nav.residents[0].route,null);assert.equal(nav.residents[0].anchorPlaceId,person.homePlaceId);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:2,site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});assert.ok(nav.residents[0].workplaceRoute);assert.ok(nav.residents[0].route);
});

test('allocation holds never admit a private body and changed revisions cannot own an operation',()=>{
 const f=fixture(),held=advanceVillageLifeNavigation(f.start,{absoluteMinute:1,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1,sourceAllocationHold:true});
 assert.equal(held.residents[0].workplaceRoute,undefined);assert.equal(held.residents[0].route,null);assert.deepEqual(held.residents[0].anchorPosition,[0,0,0]);
 let nav=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:9,site:f.site,intents:[f.intent(person.workPlaceId)],metresPerWorldMinute:1});
 assert.equal(ownsExclusiveVillageWorkplaceOperation(nav,f.site,person.id,{radius:1.44,height:2.8}),true);
 assert.equal(ownsExclusiveVillageWorkplaceOperation(nav,freeze({...f.site,navigationRevision:'c'.repeat(64)}),person.id,{radius:1.44,height:2.8}),false);
});

function recoveryFixture(){
 const mason=population.residents.find(p=>p.id==='ealdholt-master-mason')!,f=fixture(mason),point:VillageSitePoint=[0,0,4],work=f.cap.proof.sourceGroundPoint;
 const route=(id:string,from:string,to:string,g:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:g,capsuleBottomPolyline:g.map(bottom),lengthMetres:g.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-g[i][k])),0)});
 const refuge=parseVillageSiteEmergencyRefuges([{...f.cap,id:'unit-mason-refuge',placeId:'unit-refuge-place',anchorId:'unit-refuge-anchor',certificateSha256:'c'.repeat(64),body:deriveVillageRefugeBody(f.cap.proof.motionEvidence,mason.id),
  proof:(({publicExteriorOnly:_,...proof})=>({...proof,sourceGroundPoint:point,capsuleBottomPoint:bottom(point)}))(f.cap.proof),
  topology:{anchor:{id:'unit-refuge-anchor',sourceActor:f.cap.sourceActor,sourceGroundPoint:point,capsuleBottomPoint:bottom(point),standingOnly:true},route:route('unit-refuge-connector','home','unit-refuge-anchor',[[0,0,0],point])}}])[0];
 const cap=parseVillageSiteWorkplaceRoutes([{...f.cap,purpose:'community-timber',placeId:'woodland-edge',recoveryApproach:{refugeId:refuge.id,certificateSha256:refuge.certificateSha256,route:route('unit-refuge-wood-connector',refuge.anchorId,f.cap.anchorId,[point,work])}}])[0];
 const site=freeze({...f.base,emergencyRefuges:[refuge],workplaceRoutes:[cap]}),refugePermit={residentId:mason.id,ids:[refuge.id]},permit={residentId:mason.id,id:cap.id,certificateSha256:cap.certificateSha256},safe=f.intent(refuge.placeId,mason.id,'safety'),workIntent=f.intent('woodland-edge',mason.id);
 let atRefuge=advanceVillageLifeNavigation(f.start,{absoluteMinute:0,site,intents:[safe],metresPerWorldMinute:1,refugePermits:[refugePermit]});
 atRefuge=advanceVillageLifeNavigation(atRefuge,{absoluteMinute:4,site,intents:[safe],metresPerWorldMinute:1,refugePermits:[refugePermit]});
 assert.equal(atRefuge.residents[0].anchorPlaceId,refuge.placeId);assert.equal(atRefuge.residents[0].arrivalEvidence,'certified-route-arrival');
 return{...f,mason,site,cap,refuge,refugePermit,permit,safe,workIntent,atRefuge};
}
test('recovery work starts at an actually reached pinned refuge and returns there without changing homes',()=>{
 const f=recoveryFixture(),before=JSON.stringify(f.site),length=f.cap.recoveryApproach!.route.lengthMetres,returnAt=Math.ceil(4+length);
 let nav=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(f.atRefuge)),{absoluteMinute:4,site:f.site,intents:[f.workIntent],metresPerWorldMinute:1,workplacePermits:[f.permit],refugePermits:[f.refugePermit]});
 assert.equal(nav.residents[0].emergencyRefuge,undefined);assert.equal(nav.residents[0].workplaceRoute!.returnPlaceId,f.refuge.placeId);assert.equal(nav.residents[0].workplaceRoute!.recoveryRefuge!.certificateSha256,f.refuge.certificateSha256);
 assert.equal(nav.residents[0].route!.lengthMetres,length);assert.deepEqual(nav.residents[0].route!.sourceGroundPolyline[0],f.refuge.proof.sourceGroundPoint);
 const scoped=scopedVillageWorkplaceRouteSite(f.site,nav.residents[0].workplaceRoute!,f.mason.id)!;assert.equal(scoped.routes.some(r=>r.id===f.refuge.topology!.route.id),false,'An unrelated older refuge corridor is not granted.');
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:4+length,site:f.site,intents:[f.workIntent],metresPerWorldMinute:1,workplacePermits:[f.permit]});assert.equal(nav.residents[0].anchorPlaceId,'woodland-edge');assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');
 nav=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(nav)),{absoluteMinute:returnAt,site:f.site,intents:[f.safe],metresPerWorldMinute:1,refugePermits:[f.refugePermit]});assert.ok(nav.residents[0].route);assert.ok(nav.residents[0].workplaceRoute);
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:returnAt+length,site:f.site,intents:[f.safe],metresPerWorldMinute:1,refugePermits:[f.refugePermit]});
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:returnAt+length,site:f.site,intents:[f.safe],metresPerWorldMinute:1,refugePermits:[f.refugePermit]});
 assert.equal(nav.residents[0].workplaceRoute,undefined);assert.deepEqual(nav.residents[0].emergencyRefuge!.ids,[f.refuge.id]);assert.deepEqual(nav.residents[0].anchorPosition,f.refuge.proof.sourceGroundPoint);assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');
 assert.equal(JSON.stringify(f.site),before);assert.equal(resolveVillageSiteEndpoint(f.site,f.refuge.placeId,f.mason.id),null);assert.equal(resolveVillageSiteEndpoint(f.site,'woodland-edge',f.mason.id),null);
});
test('recovery permission cannot invent arrival, override safety, cross actors or follow a drifted refuge',()=>{
 const f=recoveryFixture();
 for(const input of [{nav:f.atRefuge,intent:f.workIntent,permits:[]},{nav:f.atRefuge,intent:{...f.workIntent,reason:'safety' as const},permits:[f.permit]},{nav:f.start,intent:f.workIntent,permits:[]}]){
  const nav=advanceVillageLifeNavigation(input.nav,{absoluteMinute:4,site:f.site,intents:[input.intent],metresPerWorldMinute:1,workplacePermits:input.permits});assert.equal(nav.residents[0].workplaceRoute,undefined);
 }
 const ref={id:f.cap.id,certificateSha256:f.cap.certificateSha256,returnPlaceId:f.refuge.placeId,recoveryRefuge:{id:f.refuge.id,certificateSha256:f.refuge.certificateSha256}};
 assert.equal(scopedVillageWorkplaceRouteSite(f.site,ref,peer.id),null);assert.equal(scopedVillageWorkplaceRouteSite(f.site,{...ref,recoveryRefuge:{...ref.recoveryRefuge,certificateSha256:'d'.repeat(64)}},f.mason.id),null);
 const changed=copy(f.cap);(changed.recoveryApproach!.route.sourceGroundPolyline[0]as unknown as number[])[0]+=.001;
 assert.throws(()=>validateVillageSiteWorkplaceRoutes(freeze({...f.site,workplaceRoutes:parseVillageSiteWorkplaceRoutes([changed])})),/refuge/i);
 const initial=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:[f.workIntent],metresPerWorldMinute:1,workplacePermits:[f.permit]});assert.equal(initial.residents[0].workplaceRoute,undefined);assert.equal(initial.residents[0].anchorPosition,null);
});
