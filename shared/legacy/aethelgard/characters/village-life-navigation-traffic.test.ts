import test from'node:test';
import assert from'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population}from'./village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files}from'./population-asset-integrity';
import {parsePopulationMotionEvidence}from'./population-motion-clearance';
import {parseVillageSiteEmergencyRefuges,deriveVillageRefugeBody,requiredVillageRefugeMotionClips}from'./village-emergency-refuges';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,ownsQualifiedVillageLifeTrafficHold,type VillageLifeNavigationState,type VillageLifeNavigationObstacle}from'./village-life-navigation';
import type{VillageSitePoint,VillageSiteLayout}from'./village-site';
import type{VillageLifeIntent}from'./village-life';
const ids=['ealdholt-baker','ealdholt-east-daughter'],sha='a'.repeat(64),body=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]],near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
/** Unit source-shaped contracts only: no production geometry is authored here. */
function fixture(){
 const people=ids.map(id=>population.residents.find(p=>p.id===id)!),points:Record<string,VillageSitePoint>={home:[0,0,0],connection:[4,0,0]};
 const route=(id:string,from:string,to:string,line:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:line,capsuleBottomPolyline:line.map(body),lengthMetres:line.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-line[i][k])),0)});
 const refuges=people.map((person,i)=>{const point:VillageSitePoint=[8,0,i?2:-2],clips=Object.fromEntries(requiredVillageRefugeMotionClips(person.id).map(name=>[name,{radiusMetres:.4,heightMetres:1.2,minimumBodyYMetres:-.01,placedBelowGround:false}])),motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[person.id]:{levels:{crowd:{files:{...files},clips}}}}}),anchor={id:`refuge-${i}`,sourceActor:'unit-terrain',sourceGroundPoint:point,capsuleBottomPoint:body(point),standingOnly:true as const};
  return{id:`cap-${i}`,residentId:person.id,placeId:`private-refuge-${i}`,anchorId:anchor.id,sourceActor:'unit-terrain',certificateSha256:'b'.repeat(64),body:deriveVillageRefugeBody(motion,person.id),proof:{sourceSha256:sha,profile:'desktop' as const,siteIdentity:'unit-artifact',sourceGroundPoint:point,capsuleBottomPoint:body(point),originalTriangleClearance:true as const,wholeFootprintSupported:true as const,sweptIdleAndWalkClear:true as const,motionEvidence:motion},topology:{anchor,route:route(`connector-${i}`,'connection',anchor.id,[points.connection,[4,0,i?2:-2],point])}};
 });
 const site=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:Object.entries(points).map(([id,p])=>({id,sourceActor:'unit-terrain',sourceGroundPoint:p,capsuleBottomPoint:body(p),standingOnly:true})),routes:[route('ordinary-source','home','connection',[points.home,points.connection])],placeBindings:[],residentPlaceBindings:people.map(p=>({residentId:p.id,placeId:p.homePlaceId,anchorId:'home',status:'mapped-exterior'})),emergencyRefuges:parseVillageSiteEmergencyRefuges(refuges)})as VillageSiteLayout;
 const intent=(i:number,home=false):VillageLifeIntent=>({residentId:ids[i],targetPlaceId:home?people[i].homePlaceId:refuges[i].placeId,activityKey:'home',activity:'Unit source evacuation.',priority:100,issuedAbsoluteMinute:0,indoor:home,companionIds:[],reason:'safety'}),permits=refuges.map(r=>({residentId:r.residentId,ids:[r.id]}));
 let state=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[intent(0,true),intent(1,true)],metresPerWorldMinute:1});
 const tick=(s:VillageLifeNavigationState,at:number,extra:Partial<Parameters<typeof advanceVillageLifeNavigation>[1]>={})=>advanceVillageLifeNavigation(s,{absoluteMinute:at,site,intents:[intent(0),intent(1)],metresPerWorldMinute:1,refugePermits:permits,...extra});
 state=tick(state,0);return{site,state,tick,intent,permits,people};
}
const row=(s:VillageLifeNavigationState,i:number)=>s.residents.find(r=>r.residentId===ids[i])!;
test('qualified residents follow the same source corridor with simultaneous clearance instead of waiting for whole-route arrival',()=>{
 const f=fixture();let s=f.state;assert.ok(row(s,0).route);assert.equal(row(s,1).reason,'corridor-reserved');s=f.tick(s,1);assert.equal(row(s,1).route,null,'corner timing still rejects a genuinely close future pass');s=f.tick(s,2);assert.ok(row(s,1).route);assert.equal(row(s,0).progressMetres,2);assert.equal(row(s,1).progressMetres,0);
 for(let at=3;at<=12;at++){s=f.tick(s,at);const positions=sampleVillageLifeNavigation(s,f.site).map(r=>r.position!);assert.ok(Math.hypot(positions[0][0]-positions[1][0],positions[0][2]-positions[1][2])>=.91-1e-7);}
 assert.equal(row(s,0).anchorPlaceId,'private-refuge-0');assert.equal(row(s,1).anchorPlaceId,'private-refuge-1');assert.equal(row(s,1).arrivalEvidence,'certified-route-arrival');assert.deepEqual(f.site.capsule,{radius:.85,height:3.5});
});
test('loss of a leading source permit stops a follower at physical clearance without elapsed travel credit',()=>{
 const f=fixture();let s=f.tick(f.tick(f.state,2),3);const reduced=freeze({...f.site,emergencyRefuges:[f.site.emergencyRefuges![1]]});s=f.tick(s,4,{site:reduced,refugePermits:[f.permits[1]]});assert.equal(row(s,0).progressMetres,3);assert.match(row(s,0).reason!,/refuge-source-permit/);assert.equal(row(s,1).reason,'traffic-peer-held');near(row(s,1).progressMetres,3-.85-.455-1e-6);
 const held=row(s,1).progressMetres;s=f.tick(parseVillageLifeNavigation(JSON.stringify(s)),5,{site:reduced,refugePermits:[f.permits[1]]});near(row(s,1).progressMetres,held);assert.equal(row(s,1).arrivedAtAbsoluteMinute,null);
});
test('a sudden downstream obstacle reverses the leader and batch-stops both actors before they intersect',()=>{
 const f=fixture();let s=f.tick(f.tick(f.state,2),3);const obstacle:VillageLifeNavigationObstacle={id:'fallen-source-object',kind:'solid',sourceSha256:sha,profile:'desktop',activeFromAbsoluteMinute:3,bounds:{min:[3.9,0,-1.2],max:[4.1,3,-.8]}};
 s=f.tick(s,4,{dynamicObstacles:[obstacle]});assert.equal(row(s,0).direction,-1);assert.equal(row(s,0).reason,'traffic-peer-held');assert.equal(row(s,1).reason,'traffic-peer-held');near(row(s,0).progressMetres-row(s,1).progressMetres,.910001);assert.equal(row(s,0).arrivalEvidence,'none');assert.equal(row(s,1).arrivalEvidence,'none');
});
test('an explicit mid-journey reversal cannot pass through a following resident',()=>{
 const f=fixture();let s=f.tick(f.tick(f.state,2),3);const intents=[{...f.intent(0,true),issuedAbsoluteMinute:3},f.intent(1)];s=f.tick(s,3,{intents});assert.equal(row(s,0).direction,-1);s=f.tick(s,4,{intents});assert.equal(row(s,0).reason,'traffic-peer-held');assert.equal(row(s,1).reason,'traffic-peer-held');near(row(s,0).progressMetres-row(s,1).progressMetres,.910001);
});
test('qualified following and collision stops survive reload and equivalent temporal subdivision',()=>{
 const f=fixture(),at3=f.tick(f.tick(f.state,2),3),intents=[{...f.intent(0,true),issuedAbsoluteMinute:3},f.intent(1)],reversed=f.tick(at3,3,{intents}),direct=f.tick(reversed,5,{intents}),restored=f.tick(parseVillageLifeNavigation(JSON.stringify(reversed)),5,{intents});assert.deepEqual(restored,direct);
 let sliced=reversed;for(const at of[3.25,3.5,3.75,4,4.5,5])sliced=f.tick(sliced,at,{intents});for(let i=0;i<2;i++){near(row(sliced,i).progressMetres,row(direct,i).progressMetres);assert.equal(row(sliced,i).reason,row(direct,i).reason);assert.equal(row(sliced,i).arrivedAtAbsoluteMinute,null);}
});


test('fractional observation intervals still process every interior decision and dated obstacle onset',()=>{
 const f=fixture(),atHalf=f.tick(f.state,.5),direct=f.tick(atHalf,2.4);let split=f.tick(f.tick(f.tick(atHalf,1),2),2.4);assert.deepEqual(direct,split);assert.ok(row(direct,1).route,'decision2 admits the safe follower even inside a fractional outer interval');
 const at3=f.tick(direct,3),obstacle:VillageLifeNavigationObstacle={id:'fractional-fall',kind:'solid',sourceSha256:sha,profile:'desktop',activeFromAbsoluteMinute:3.2,bounds:{min:[3.9,0,-1.2],max:[4.1,3,-.8]}};
 const once=f.tick(at3,3.9,{dynamicObstacles:[obstacle]});split=f.tick(f.tick(at3,3.2,{dynamicObstacles:[obstacle]}),3.9,{dynamicObstacles:[obstacle]});for(let i=0;i<2;i++){near(row(once,i).progressMetres,row(split,i).progressMetres);assert.equal(row(once,i).reason,row(split,i).reason);}
 const retarget=[{...f.intent(0,true),issuedAbsoluteMinute:3.2},f.intent(1)],changed=f.tick(at3,3.9,{intents:retarget}),partitioned=f.tick(f.tick(at3,3.2,{intents:retarget}),3.9,{intents:retarget});for(let i=0;i<2;i++)near(row(changed,i).progressMetres,row(partitioned,i).progressMetres);
});

test('neutral traffic-hold presentation requires the exact active source route, stopped cursor and non-overlapping current body',()=>{
 const f=fixture(),at3=f.tick(f.tick(f.state,2),3),intents=[{...f.intent(0,true),issuedAbsoluteMinute:3},f.intent(1)],s=f.tick(f.tick(at3,3,{intents}),4,{intents});assert.equal(ownsQualifiedVillageLifeTrafficHold(s,f.site,ids[0]),true);assert.equal(ownsQualifiedVillageLifeTrafficHold(s,f.site,ids[1]),true);
 for(const edit of[(r:any)=>delete r.emergencyRefuge,(r:any)=>r.reason='corridor-reserved',(r:any)=>r.inside=true,(r:any)=>r.progressAtDirectionStart+=.1,(r:any)=>r.arrivalEvidence='certified-route-arrival',(r:any)=>r.sourceSiteIdentity='foreign',(r:any)=>r.emergencyRefuge.certificates['cap-0']='c'.repeat(64)]){const raw=JSON.parse(JSON.stringify(s));edit(raw.residents.find((r:any)=>r.residentId===ids[0]));let allowed=false;try{allowed=ownsQualifiedVillageLifeTrafficHold(raw,f.site,ids[0]);}catch{}assert.equal(allowed,false);}
 const overlap=JSON.parse(JSON.stringify(s));overlap.residents[1].progressMetres=overlap.residents[0].progressMetres;assert.equal(ownsQualifiedVillageLifeTrafficHold(overlap,f.site,ids[0]),false);
 for(const edit of[(peer:any)=>peer.anchorPosition[2]+=100,(peer:any)=>{for(const p of peer.route.sourceGroundPolyline)p[2]+=100;for(const p of peer.route.capsuleBottomPolyline)p[2]+=100;peer.anchorPosition[2]+=100;}]){const raw=JSON.parse(JSON.stringify(s));edit(raw.residents.find((r:any)=>r.residentId===ids[1]));let allowed=false;try{allowed=ownsQualifiedVillageLifeTrafficHold(raw,f.site,ids[0]);}catch{}assert.equal(allowed,false,'same-SHA peer coordinates require the exact original source route and anchor');}
});
