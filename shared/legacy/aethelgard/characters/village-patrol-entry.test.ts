/** Synthetic source-certificate fixtures exercise route ownership/decisions;
 * they are never rendered or substituted for the authored village. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtVillageSite,type VillageSiteLayout} from './village-site';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,type VillageLifeNavigationState} from './village-life-navigation';
import type {VillageLifeIntent} from './village-life';
const ID='fixture-patrol',SHA='a'.repeat(64),REV='b'.repeat(64),PAIR={generation:'e'.repeat(64),desktopRevision:REV,questRevision:'d'.repeat(64)};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function site():VillageSiteLayout {
 const points:Record<string,number[]>={home:[0,0,0],goal:[0,0,4],turnA:[-8,0,8],turnB:[8,0,8],crossA:[-4,0,0],crossB:[-4,0,12]};
 const anchors=Object.fromEntries(Object.entries(points).map(([key,p])=>[key,{sourceActor:'fixture-'+key,sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]],standingOnly:true}]));
 const routes:any={},proofs:any[]=[];
 for(const[from,to]of[['home','goal'],['goal','turnA'],['turnA','turnB'],['home','turnA'],['home','turnB'],['crossA','crossB']]){
  const line=[points[from],points[to]],body=line.map(p=>[p[0],p[1]+.02,p[2]]),lengthMetres=Math.hypot(...line[0].map((n,i)=>n-line[1][i]));
  routes[from+'-'+to]={from,to,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:[1,2]};
  proofs.push({from,to,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02});
 }
 const patrols=[{id:'fixture-patrol-plan',residentId:ID,activity:'Patrols the declared lane.',routineTargetPlaceId:'goal',dwellWorldMinutes:1,
  waypoints:[{placeId:'lane-turn-a',anchorId:'turnA',purpose:'lane-patrol'},{placeId:'lane-turn-b',anchorId:'turnB',purpose:'lane-patrol'}]}];
 const source={schema:1,profile:'desktop',sourceSha256:SHA,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},navigationRevision:REV,navigationAllocation:PAIR,patrols};
 return createEaldholtVillageSite({profile:'desktop',modelSha256:SHA,binding:{...source,anchors,routes},
  certificate:{...source,qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:0,routes:proofs},
  placeBindings:Object.keys(points).map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior'})),residentPlaceBindings:[
   {residentId:ID,placeId:'home',anchorId:'home',status:'mapped-exterior'},
   {residentId:ID,placeId:'lane-turn-a',anchorId:'turnA',status:'mapped-exterior'},
   {residentId:ID,placeId:'lane-turn-b',anchorId:'turnB',status:'mapped-exterior'}]});
}
const patrol=(patch:Partial<VillageLifeIntent>={}):VillageLifeIntent=>({residentId:ID,targetPlaceId:'goal',activityKey:'patrol',activity:'Patrols the declared lane.',priority:60,issuedAbsoluteMinute:780,indoor:false,companionIds:[],reason:'routine',...patch});
const peer=(residentId='stationary-peer',targetPlaceId='goal'):VillageLifeIntent=>({...patrol(),residentId,targetPlaceId,activityKey:'rest',activity:'Waits outside.',priority:100});
function step(s:VillageLifeNavigationState,at:number,map:VillageSiteLayout|null,intents=[patrol(),peer()]){
 return advanceVillageLifeNavigation(s,{absoluteMinute:at,site:map,intents,metresPerWorldMinute:1});
}
function begin(map:VillageSiteLayout,extras:VillageLifeIntent[]=[]){
 const intents=[patrol(),peer(),...extras];
 return advanceVillageLifeNavigation(createVillageLifeNavigation(780),{absoluteMinute:780,site:map,intents,metresPerWorldMinute:1,
  initialPlaces:intents.map(i=>({residentId:i.residentId,placeId:i.residentId===ID?'home':i.targetPlaceId,indoor:i.residentId===ID}))});
}
const who=(s:VillageLifeNavigationState)=>s.residents.find(r=>r.residentId===ID)!;

test('three continuous ordinary decisions may select a clear authored entry; only real arrival starts the circuit and earns no leg',()=>{
 const map=site();let s=begin(map),originalPeer=clone(s.residents.find(r=>r.residentId==='stationary-peer')!);
 assert.equal(who(s).inside,true);assert.equal(who(s).patrolEntry?.blockedSinceAbsoluteMinute,780);
 for(const at of [781,782]){s=step(s,at,map);assert.equal(who(s).route,null);assert.equal(who(s).patrol,undefined);assert.equal(who(s).patrolEntry?.waypointIndex,null);}
 s=step(s,783,map);assert.equal(who(s).destinationPlaceId,'lane-turn-a');assert.equal(who(s).patrolEntry?.waypointIndex,0);
 assert.equal(who(s).targetPlaceId,'goal');assert.equal(who(s).patrol,undefined);assert.equal(who(s).arrivalEvidence,'none');assert.equal(who(s).inside,false);
 assert.deepEqual(sampleVillageLifeNavigation(s,map).find(r=>r.residentId===ID)!.position,[0,0,0]);
 for(let at=784;at<=795;at++)s=step(s,at,map);
 assert.equal(who(s).anchorPlaceId,'lane-turn-a');assert.equal(who(s).arrivalEvidence,'certified-route-arrival');assert.equal(who(s).patrolEntry,undefined);
 assert.equal(who(s).patrol?.completedLegs,0);assert.equal(who(s).patrol?.dwellUntilAbsoluteMinute,who(s).arrivedAtAbsoluteMinute!+1);
 s=step(s,796,map);assert.equal(who(s).destinationPlaceId,'lane-turn-b');assert.equal(who(s).patrol?.completedLegs,0);
 for(let at=797;at<=812;at++)s=step(s,at,map);assert.equal(who(s).patrol?.completedLegs,1);
 const actualPeer=s.residents.find(r=>r.residentId===originalPeer.residentId)!;
 assert.deepEqual({...actualPeer,lastAbsoluteMinute:originalPeer.lastAbsoluteMinute},originalPeer,'The original destination/body lease was never removed or moved.');
});
test('occupied authored turns, hidden exterior bodies and whole peer corridors remain real holds',()=>{
 const map=site(),a=peer('at-a','turnA'),b=peer('at-b','turnB');let held=begin(map,[a,b]);
 for(let at=781;at<=790;at++)held=step(held,at,map,[patrol(),peer(),a,b]);
 assert.equal(who(held).status,'waiting');assert.equal(who(held).reason,'destination-reserved');assert.equal(who(held).inside,true);assert.equal(who(held).route,null);
 assert.equal(who(held).patrolEntry?.waypointIndex,null);assert.equal(who(held).arrivalEvidence,'initial-placement');
 const hidden=clone(held) as any;const aBody=hidden.residents.find((r:any)=>r.residentId==='at-a');aBody.status='unmapped';aBody.reason='art-held';aBody.targetPlaceId='missing-future';
 const hiddenNext=step(parseVillageLifeNavigation(hidden),791,map,[patrol(),peer(),{...a,targetPlaceId:'missing-future'},b]);
 assert.equal(hiddenNext.residents.find(r=>r.residentId==='at-a')!.reason,'destination-unmapped');
 assert.equal(who(hiddenNext).route,null,'A real exterior body absent from the initial endpoint reservation table still occupies its source point.');
 const crossing=peer('crossing','crossA');let s=begin(map,[crossing,b]);
 const travels={...crossing,targetPlaceId:'crossB',activityKey:'travel' as const,issuedAbsoluteMinute:781};
 for(let at=781;at<=792;at++){s=step(s,at,map,[patrol(),peer(),travels,b]);assert.equal(who(s).route,null,'The entire active crossing remains reserved.');}
 s=step(s,793,map,[patrol(),peer(),travels,b]);assert.equal(who(s).destinationPlaceId,'lane-turn-a');assert.equal(who(s).startedAbsoluteMinute,793);
});
test('a blocked first authored turn may use the next already-authored clear turn in stable plan order',()=>{
 const map=site(),a=peer('at-a','turnA');let s=begin(map,[a]);
 for(let at=781;at<=783;at++)s=step(s,at,map,[patrol(),peer(),a]);
 assert.equal(who(s).destinationPlaceId,'lane-turn-b');assert.equal(who(s).patrolEntry?.waypointIndex,1);
 assert.equal(who(s).patrol,undefined);assert.equal(who(s).targetPlaceId,'goal');
 assert.deepEqual(s.residents.find(r=>r.residentId==='at-a')!.anchorPosition,[-8,0,8]);
});
test('a newly free ordinary target wins; source gaps and duty interruptions restart a continuous wait',()=>{
 const map=site();let s=step(begin(map),781,map),interior={...peer(),indoor:true};
 s=step(s,782,map,[patrol(),interior]);s=step(s,783,map,[patrol(),interior]);
 assert.equal(who(s).destinationPlaceId,'goal');assert.equal(who(s).patrolEntry,undefined,'Use the original authored destination as soon as it is free.');
 let missing=step(begin(map),781,null);assert.equal(who(missing).patrolEntry,undefined);
 for(const at of [782,783,784]){missing=step(missing,at,map);assert.equal(who(missing).route,null);}
 missing=step(missing,785,map);assert.equal(who(missing).destinationPlaceId,'lane-turn-a');
 const changed=Object.freeze({...map,sourceSha256:'f'.repeat(64)}),foreign=step(begin(map),781,changed);
 assert.equal(who(foreign).patrolEntry,undefined);assert.equal(who(foreign).reason,'source-site-changed');assert.equal(foreign.sourceSha256,SHA);
 let restored=step(foreign,782,map);assert.equal(who(restored).patrolEntry?.blockedSinceAbsoluteMinute,782);
 const rest=patrol({activityKey:'rest',activity:'Rests indoors.',targetPlaceId:'home',priority:85,reason:'needs',issuedAbsoluteMinute:783,indoor:true});
 restored=step(restored,783,map,[rest,peer()]);assert.equal(who(restored).patrolEntry,undefined);assert.equal(who(restored).inside,true);
 restored=step(restored,784,map,[patrol({issuedAbsoluteMinute:784}),peer()]);assert.equal(who(restored).patrolEntry?.blockedSinceAbsoluteMinute,784);
});
test('weather, family and safety cancel entry after departure without teleporting or awarding circuit progress',()=>{
 const map=site();let s=begin(map);for(let at=781;at<=785;at++)s=step(s,at,map);
 const before=sampleVillageLifeNavigation(s,map).find(r=>r.residentId===ID)!.position;
 for(const [reason,key]of[['weather','shelter'],['household-care','care'],['household-protection','protect'],['safety','shelter']] as const){
  const interrupted=patrol({activityKey:key,reason,activity:'Returns to the household.',targetPlaceId:'home',priority:100,issuedAbsoluteMinute:785,indoor:true});
  const next=step(s,785,map,[interrupted,peer()]);assert.equal(who(next).patrolEntry,undefined);assert.equal(who(next).patrol,undefined);
  assert.deepEqual(sampleVillageLifeNavigation(next,map).find(r=>r.residentId===ID)!.position,before);assert.deepEqual(who(next).route,who(s).route);assert.equal(who(next).direction,-1);
 }
 const nonPatrol=step(s,785,map,[patrol({activityKey:'travel',activity:'Runs errands.',issuedAbsoluteMinute:785}),peer()]);
 assert.equal(who(nonPatrol).patrolEntry,undefined);assert.equal(who(nonPatrol).patrol,undefined);
});
test('minutely, fractional, paused, saved/reloaded and hidden entry progress agree without extra source placement',()=>{
 const map=site();let live=begin(map),fractional=begin(map),reload=begin(map);
 for(let at=781;at<=820;at++){
  live=step(live,at,map);for(let q=1;q<=4;q++)fractional=step(fractional,at-1+q/4,map);
  reload=step(parseVillageLifeNavigation(JSON.stringify(reload)),at,map);
  assert.deepEqual(reload,live);assert.deepEqual(fractional,live);assert.equal(step(live,at,map),live,'A paused clock cannot age the wait or move a body.');
 }
 let offscreen=begin(map);for(let at=781;at<=784;at++)offscreen=step(offscreen,at,map);
 offscreen=step(offscreen,785,null);assert.equal(sampleVillageLifeNavigation(offscreen,null).find(r=>r.residentId===ID)!.position,null);
 const position=who(offscreen).progressMetres;offscreen=step(offscreen,785,map);assert.equal(who(offscreen).progressMetres,position);assert.equal(who(offscreen).patrolEntry?.waypointIndex,0);
 assert.ok(who(live).patrol);assert.equal(who(live).targetPlaceId,'goal');
});
test('entry saves retain strict fields; malformed or foreign cursors cannot become physical permission',()=>{
 const map=site(),s=begin(map),before=JSON.stringify(s);assert.deepEqual(parseVillageLifeNavigation(before),s);
 for(const edit of [(r:any)=>r.patrolEntry.extra=true,(r:any)=>r.patrolEntry.blockedSinceAbsoluteMinute=779,
  (r:any)=>r.patrolEntry.issuedAbsoluteMinute=779,(r:any)=>r.patrolEntry.waypointIndex=16,
  (r:any)=>r.patrolEntry.waypointIndex=0,(r:any)=>r.indoor=true,(r:any)=>r.patrol={planId:'other'}]){
  const bad=clone(s) as any;edit(bad.residents.find((r:any)=>r.residentId===ID));assert.throws(()=>parseVillageLifeNavigation(bad));
 }
 const foreign=clone(s) as any;foreign.residents.find((r:any)=>r.residentId===ID).patrolEntry.planId='other-plan';
 const next=step(parseVillageLifeNavigation(foreign),781,map);assert.equal(who(next).route,null);assert.equal(who(next).reason,'certified-binding-changed');
 assert.equal(JSON.stringify(s),before);
});
