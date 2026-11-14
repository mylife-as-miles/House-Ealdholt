import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from './village-population';
import {EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE as profile} from './ealdholt-brewster-fire-response-candidate';
import {parseVillageSiteEmergencyTraversals} from './village-emergency-traversal';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,villageLifeNavigationPeerBody,qualifiedVillageNeutralReturnMotion,sampleVillageLifeNavigation,ownsExclusiveVillageLifeExteriorAnchor} from './village-life-navigation';
import type {VillageSiteLayout,VillageSitePoint} from './village-site';
import type {VillageLifeIntent} from './village-life';
const brewster=population.residents.find(p=>p.id===profile.residentId)!,peer=population.residents.find(p=>p.id==='ealdholt-woodcutter')!,sha='a'.repeat(64);
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
// Contract geometry only; real original-source clearance has separate evidence.
function fixture(){
 const points:Record<string,VillageSitePoint>={home:[0,0,0],well:[3,0,3],court:[7,0,3],peer:[8.6,0,3]},bottom=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]];
 const anchors=Object.entries(points).map(([id,point])=>({id,sourceActor:'unit-original-terrain',sourceGroundPoint:point,capsuleBottomPoint:bottom(point),standingOnly:true as const}));
 const line:readonly VillageSitePoint[]=[points.home,[0,0,3],points.well],cap=parseVillageSiteEmergencyTraversals([{id:'unit-neutral-carry',residentId:brewster.id,profile:'desktop',sourceSha256:sha,siteIdentity:'unit-site-artifact',certificateSha256:'b'.repeat(64),fromAnchorId:'home',toAnchorId:'well',reversible:true,requiredClip:'carry_bucket_walk',sourceGroundPolyline:line,capsuleBottomPolyline:line.map(bottom),lengthMetres:6,body:profile.body,files:profile.files,neutralReturn:profile.neutralReturn,proof:{sourceOriginalBuffersUnchanged:true,originalTriangleClearance:true,wholeFootprintSupported:true,publicExteriorOnly:true,carryLoopAndFixedPose0:true,unmeasuredTransitions:false}}])[0];
 const site=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors,routes:[{id:'unit-court-lane',from:'well',to:'court',reversible:true,sourceGroundPolyline:[points.well,points.court],capsuleBottomPolyline:[bottom(points.well),bottom(points.court)],lengthMetres:4}],placeBindings:[{placeId:'village-courtyard',anchorId:'court',status:'mapped-exterior'},{placeId:'well',anchorId:'well',status:'mapped-exterior'}],residentPlaceBindings:[{residentId:brewster.id,placeId:brewster.homePlaceId,anchorId:'home',status:'mapped-exterior'},{residentId:peer.id,placeId:peer.homePlaceId,anchorId:'peer',status:'mapped-exterior'}],emergencyTraversals:[cap]})as VillageSiteLayout;
 const intent=(residentId:string,targetPlaceId:string):VillageLifeIntent=>({residentId,targetPlaceId,activityKey:'home',activity:'Unit neutral carry return.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine'}),atHome=[intent(brewster.id,brewster.homePlaceId),intent(peer.id,peer.homePlaceId)],atCourt=[intent(brewster.id,'village-courtyard'),atHome[1]],permit={residentId:brewster.id,id:cap.id,certificateSha256:cap.certificateSha256,requiredClip:cap.requiredClip};
 let nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:atHome,metresPerWorldMinute:1});
 nav=advanceVillageLifeNavigation(nav,{absoluteMinute:0,site,intents:atCourt,metresPerWorldMinute:1,locomotionPermits:[permit]});nav=advanceVillageLifeNavigation(nav,{absoluteMinute:10,site,intents:atCourt,metresPerWorldMinute:1,locomotionPermits:[permit]});
 assert.equal(nav.residents[0].anchorPlaceId,'village-courtyard');assert.equal(nav.residents[0].arrivalEvidence,'certified-route-arrival');return{site,nav,cap,intent,atCourt,atHome};
}
test('actual carry arrival can retain a pinned neutral stand where the conservative global body does not fit',()=>{
 const f=fixture(),before=JSON.stringify(f.site),returned=advanceVillageLifeNavigation(f.nav,{absoluteMinute:10,site:f.site,intents:f.atCourt,metresPerWorldMinute:1});
 const r=returned.residents[0];assert.equal(r.emergencyTraversal,undefined);assert.ok(r.neutralReturn);assert.deepEqual(r.anchorPosition,[7,0,3]);assert.equal(r.arrivalEvidence,'certified-route-arrival');assert.equal(r.route,null);
 assert.equal(ownsExclusiveVillageLifeExteriorAnchor(returned,f.site,brewster.id),true,'The exact neutral stand remains owned despite its departure-clearance reason and public binding.');
 assert.deepEqual(villageLifeNavigationPeerBody(r,f.site,returned.siteIdentity),{radius:profile.neutralReturn.body.radius+.005,height:profile.neutralReturn.body.height+.025});
 assert.deepEqual(villageLifeNavigationPeerBody(returned.residents[1],f.site,returned.siteIdentity),f.site.capsule);assert.deepEqual(qualifiedVillageNeutralReturnMotion(r,f.site),profile.neutralReturn);
 const restored=parseVillageLifeNavigation(JSON.stringify(returned)),held=advanceVillageLifeNavigation(restored,{absoluteMinute:11,site:f.site,intents:[f.atHome[0],f.atCourt[1]],metresPerWorldMinute:1});
 assert.ok(held.residents[0].neutralReturn);assert.equal(held.residents[0].route,null);assert.deepEqual(sampleVillageLifeNavigation(held,f.site)[0].position,[7,0,3]);assert.equal(held.residents[0].reason,'neutral-return-clearance-required');assert.equal(JSON.stringify(f.site),before);
 assert.equal(ownsExclusiveVillageLifeExteriorAnchor(held,f.site,brewster.id),true,'A new home target does not erase the actual original courtyard position.');
});
test('neutral stand cannot be borrowed, moved, mixed with carry, or restored after source loss',()=>{
 const f=fixture(),nav=advanceVillageLifeNavigation(f.nav,{absoluteMinute:10,site:f.site,intents:f.atCourt,metresPerWorldMinute:1}),r=nav.residents[0];
 const wrongActor={...r,residentId:peer.id};assert.equal(qualifiedVillageNeutralReturnMotion(wrongActor,f.site),null);assert.deepEqual(villageLifeNavigationPeerBody(wrongActor,f.site,nav.siteIdentity),f.site.capsule);
 const wrongPoint=copy(r)as any;wrongPoint.anchorPosition[0]+=.0001;assert.equal(qualifiedVillageNeutralReturnMotion(wrongPoint,f.site),null);assert.deepEqual(villageLifeNavigationPeerBody(wrongPoint,f.site,nav.siteIdentity),f.site.capsule);
 const forged=copy(nav)as any;forged.residents[0].anchorPosition[0]+=.0001;assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(forged),f.site,brewster.id),false);
 const foreignPeer=copy(nav)as any;foreignPeer.residents[1].anchorPosition[0]+=1;assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(foreignPeer),f.site,brewster.id),false,'An unqualified peer cannot become empty stand space.');
 const bad=copy(nav)as any;bad.residents[0].emergencyTraversal={id:f.cap.id,certificateSha256:f.cap.certificateSha256,requiredClip:'carry_bucket_walk'};assert.throws(()=>parseVillageLifeNavigation(bad));
 const missing=freeze({...f.site,emergencyTraversals:[]}),held=advanceVillageLifeNavigation(nav,{absoluteMinute:11,site:missing,intents:f.atCourt,metresPerWorldMinute:1});assert.equal(held.residents[0].reason,'neutral-return-source-changed');assert.ok(held.residents[0].neutralReturn);assert.deepEqual(held.residents[0].anchorPosition,r.anchorPosition);assert.equal(qualifiedVillageNeutralReturnMotion(held.residents[0],missing),null);
 const blocked=advanceVillageLifeNavigation(f.nav,{absoluteMinute:10,site:f.site,intents:f.atCourt,metresPerWorldMinute:1,dynamicObstacles:[{id:'unit-fallen-overhead',sourceSha256:sha,profile:'desktop',kind:'solid',activeFromAbsoluteMinute:10,bounds:{min:[6.9,1,2.9],max:[7.1,2,3.1]}}]});assert.equal(blocked.residents[0].neutralReturn,undefined);assert.ok(blocked.residents[0].emergencyTraversal);
});
