/** Certificate-shaped fixtures verify ownership and deterministic progression;
 * they are never rendered or substituted for the real village source proof. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtVillageSite,type VillageSiteLayout} from './village-site';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,ownsExclusiveVillageLifePatrolDwellAnchor,type VillageLifeNavigationState} from './village-life-navigation';
import type {VillageLifeIntent} from './village-life';
const SHA='a'.repeat(64),REV='b'.repeat(64),ID='fixture-spearman';
const PAIR={generation:'e'.repeat(64),desktopRevision:REV,questRevision:'d'.repeat(64)};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function options(){
 const points:Record<string,number[]>={home:[0,0,0],goal:[0,0,4],turnA:[0,0,8],turnB:[8,0,8],shelter:[0,0,-8],cross:[4,0,4],cross2:[4,0,12]};
 const anchors=Object.fromEntries(Object.entries(points).map(([id,p])=>[id,{sourceActor:`fixture-ground-${id}`,standingOnly:true,sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]]}]));
 const routes:any={},proofs:any[]=[];
 for(const [from,to]of [['home','goal'],['goal','turnA'],['turnA','turnB'],['home','shelter'],['cross','cross2']]){
  const line=[points[from],points[to]],body=line.map(p=>[p[0],p[1]+.02,p[2]]),lengthMetres=Math.hypot(...line[0].map((n,i)=>n-line[1][i]));
  routes[`${from}-${to}`]={from,to,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:[1,2]};
  proofs.push({from,to,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02});
 }
 const patrols=[{id:'fixture-lane-patrol',residentId:ID,activity:'Patrols the registered lane.',routineTargetPlaceId:'goal',waypoints:[{placeId:'lane-turn-a',anchorId:'turnA',purpose:'lane-patrol'},{placeId:'lane-turn-b',anchorId:'turnB',purpose:'lane-patrol'}],dwellWorldMinutes:1}];
 return{profile:'desktop' as const,modelSha256:SHA,binding:{schema:1,profile:'desktop',sourceSha256:SHA,frame:'source-root-local-metres',capsule:{height:3.5,radius:.85},anchors,routes,navigationRevision:REV,navigationAllocation:PAIR,patrols},certificate:{schema:1,profile:'desktop',sourceSha256:SHA,frame:'source-root-local-metres',capsule:{height:3.5,radius:.85},qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:0,routes:proofs,navigationRevision:REV,navigationAllocation:PAIR,patrols},placeBindings:Object.keys(points).map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior' as const})),residentPlaceBindings:[{residentId:ID,placeId:'lane-turn-a',anchorId:'turnA',status:'mapped-exterior' as const},{residentId:ID,placeId:'lane-turn-b',anchorId:'turnB',status:'mapped-exterior' as const}]};
}
const patrol=(patch:Partial<VillageLifeIntent>={}):VillageLifeIntent=>({residentId:ID,targetPlaceId:'goal',activityKey:'patrol',activity:'Patrols the registered lane.',priority:60,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine',...patch});
const step=(s:VillageLifeNavigationState,at:number,map:VillageSiteLayout|null,intents=[patrol()])=>advanceVillageLifeNavigation(s,{absoluteMinute:at,site:map,intents,metresPerWorldMinute:1});
const begin=(map:VillageSiteLayout)=>advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:map,intents:[patrol()],metresPerWorldMinute:1,initialPlaces:[{residentId:ID,placeId:'home',indoor:true}]});
const who=(s:VillageLifeNavigationState)=>s.residents.find(r=>r.residentId===ID)!;

test('patrol authoring rejects aliases, absent person bindings, zero/noncertified circuits and mismatched source revisions',()=>{
 const input=options(),site=createEaldholtVillageSite(input);assert.equal(site.patrols?.length,1);assert.equal(site.navigationRevision,REV);
 for(const mutate of [(o:any)=>o.binding.navigationRevision='c'.repeat(64),(o:any)=>o.binding.patrols[0].waypoints[1].anchorId='turnA',
  (o:any)=>o.residentPlaceBindings.pop(),(o:any)=>o.binding.patrols[0].waypoints.pop(),(o:any)=>o.binding.patrols[0].dwellWorldMinutes=0,
  (o:any)=>{o.residentPlaceBindings[1].anchorId='cross';o.binding.patrols[0].waypoints[1].anchorId='cross';}]){
  const changed=copy(input);mutate(changed);assert.throws(()=>createEaldholtVillageSite(changed));
 }
});
test('only actual certified arrival activates a declared patrol; repeat legs and dwell use the same world clock',()=>{
 const map=createEaldholtVillageSite(options());let s=begin(map);
 assert.equal(who(s).patrol,undefined);assert.equal(who(s).destinationPlaceId,'goal');
 s=step(s,4,map);assert.equal(who(s).destinationPlaceId,'lane-turn-a');assert.equal(who(s).patrol?.completedLegs,0);assert.equal(who(s).arrivalEvidence,'none');
 s=step(s,8,map);assert.equal(who(s).route,null);assert.equal(who(s).anchorPlaceId,'lane-turn-a');assert.equal(who(s).patrol?.dwellUntilAbsoluteMinute,9);assert.equal(who(s).patrol?.completedLegs,1);
 s=step(s,8.75,map);assert.equal(who(s).status,'at-threshold');assert.equal(who(s).patrol?.completedLegs,1);
 s=step(s,9,map);assert.equal(who(s).destinationPlaceId,'lane-turn-b');assert.equal(who(s).arrivalEvidence,'none');
 s=step(s,17,map);assert.equal(who(s).arrivedAtAbsoluteMinute,17);assert.equal(who(s).patrol?.completedLegs,2);
 s=step(s,18,map);assert.equal(who(s).destinationPlaceId,'lane-turn-a');assert.equal(who(s).route?.legs[0].reverse,true);
 s=step(s,26,map);assert.equal(who(s).patrol?.completedLegs,3);assert.equal(who(s).anchorPlaceId,'lane-turn-a');
 assert.equal(who(s).targetPlaceId,'goal','the physical circuit does not rewrite the canonical responsibility');
 const initial=step(createVillageLifeNavigation(0),0,map);assert.equal(who(initial).arrivalEvidence,'initial-placement');assert.equal(who(step(initial,1,map)).patrol,undefined,'a registry placement cannot fabricate a patrol arrival');
});
test('watch dwell owns only the reached certified turn during its real dwell, with no navigation mutation',()=>{
 const map=createEaldholtVillageSite(options());let s=begin(map);for(let n=1;n<=8;n++)s=step(s,n,map);
 const before=JSON.stringify(s);assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(s,map,patrol()),true);
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(parseVillageLifeNavigation(before),map,patrol()),true);
 assert.equal(JSON.stringify(s),before);assert.equal(who(s).patrol?.completedLegs,1);
 for(const intent of [patrol({reason:'weather'}),patrol({reason:'family-care'}),patrol({indoor:true}),patrol({issuedAbsoluteMinute:8}),patrol({priority:100}),patrol({activity:'Watches an unmapped post.'})])
  assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(s,map,intent),false);
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(begin(map),map,patrol()),false,'initial placement is never dwell arrival');
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(step(s,9,map),map,patrol()),false,'a new travel leg retains no stationary pose');
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(s,null,patrol()),false);
 const changed=copy(options());changed.binding.navigationRevision=changed.certificate.navigationRevision='c'.repeat(64);
 changed.binding.navigationAllocation={...PAIR,desktopRevision:'c'.repeat(64)};changed.certificate.navigationAllocation={...changed.binding.navigationAllocation};
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(s,createEaldholtVillageSite(changed),patrol()),false);
 const inside=copy(s) as any;inside.residents[0].inside=true;assert.throws(()=>ownsExclusiveVillageLifePatrolDwellAnchor(inside,map,patrol()),/Invalid saved physical patrol/);
 const noArrival=copy(s) as any;noArrival.residents[0].arrivalEvidence='initial-placement';assert.throws(()=>ownsExclusiveVillageLifePatrolDwellAnchor(noArrival,map,patrol()),/Invalid navigation arrival provenance/);
});
test('a hidden exterior peer or whole crossing corridor still excludes the patrol watch body',()=>{
 const map=createEaldholtVillageSite(options());let s=begin(map);for(let n=1;n<=8;n++)s=step(s,n,map);
 const duplicate={...copy(who(s)),residentId:'hidden-person',activityKey:'rest',targetPlaceId:'turnA',anchorPlaceId:'turnA'} as any;
 delete duplicate.patrol;
 const peers={...copy(s),residents:[...copy(s.residents),duplicate]};
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(peers,map,patrol()),false);
 const peerIntent=patrol({residentId:'crossing-person',activityKey:'travel',targetPlaceId:'turnA',activity:'Travels.',priority:100});
 let crossing=advanceVillageLifeNavigation(createVillageLifeNavigation(5),{absoluteMinute:5,site:map,intents:[peerIntent],metresPerWorldMinute:1,initialPlaces:[{residentId:peerIntent.residentId,placeId:'goal',indoor:false}]});
 crossing=advanceVillageLifeNavigation(crossing,{absoluteMinute:8,site:map,intents:[peerIntent],metresPerWorldMinute:1});
 assert.ok(crossing.residents[0].route);
 const occupied={...copy(s),residents:[...copy(s.residents),copy(crossing.residents[0])]};
 assert.equal(ownsExclusiveVillageLifePatrolDwellAnchor(occupied,map,patrol()),false);
 assert.equal(JSON.stringify(s),JSON.stringify(parseVillageLifeNavigation(JSON.stringify(s))));
});
test('minutely, fractional observation, saved/reloaded and offscreen simulation agree on repeated patrol progress',()=>{
 const map=createEaldholtVillageSite(options());let live=begin(map),fractional=begin(map),restored=begin(map);
 for(let n=1;n<=60;n++){live=step(live,n,map);for(let q=1;q<=4;q++)fractional=step(fractional,n-1+q/4,map);restored=step(parseVillageLifeNavigation(JSON.stringify(restored)),n,map);}
 assert.deepEqual(fractional,live);assert.deepEqual(restored,live);assert.ok(who(live).patrol!.completedLegs>=6);
 const json=JSON.stringify(live);sampleVillageLifeNavigation(live,map);assert.equal(JSON.stringify(live),json,'sampling cannot advance a circuit');
});
test('occupied turns and crossing corridors keep their existing owners and cannot create patrol arrivals',()=>{
 const map=createEaldholtVillageSite(options()),peer=patrol({residentId:'other-person',activityKey:'rest',activity:'Waits.',targetPlaceId:'turnB',priority:100});
 let s=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:map,intents:[patrol(),peer],metresPerWorldMinute:1,initialPlaces:[{residentId:ID,placeId:'home',indoor:true},{residentId:peer.residentId,placeId:'turnB',indoor:false}]});
 for(let n=1;n<=12;n++)s=step(s,n,map,[patrol(),peer]);
 assert.equal(who(s).status,'waiting');assert.equal(who(s).reason,'destination-reserved');assert.equal(who(s).anchorPlaceId,'lane-turn-a');assert.equal(who(s).patrol?.completedLegs,1);assert.equal(who(s).arrivedAtAbsoluteMinute,8);
 const held=JSON.stringify(s.residents.find(r=>r.residentId===peer.residentId));
 assert.equal(JSON.stringify(parseVillageLifeNavigation(JSON.stringify(s)).residents.find(r=>r.residentId===peer.residentId)),held);
  const standing=patrol({residentId:'crossing-person',activityKey:'rest',activity:'Waits.',targetPlaceId:'cross',priority:100});
  let crossing=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:map,intents:[patrol(),standing],metresPerWorldMinute:1,initialPlaces:[{residentId:ID,placeId:'home',indoor:true},{residentId:standing.residentId,placeId:'cross',indoor:false}]});
  for(let n=1;n<=8;n++)crossing=step(crossing,n,map,[patrol(),standing]);
  const walking={...standing,targetPlaceId:'cross2',activityKey:'travel' as const,issuedAbsoluteMinute:9};
  for(let n=9;n<17;n++){
    crossing=step(crossing,n,map,[patrol(),walking]);assert.equal(who(crossing).reason,'corridor-reserved');assert.equal(who(crossing).patrol?.completedLegs,1);assert.equal(who(crossing).arrivedAtAbsoluteMinute,8);
  }
  crossing=step(crossing,17,map,[patrol(),walking]);assert.equal(who(crossing).status,'travelling');assert.equal(who(crossing).startedAbsoluteMinute,17,'the whole existing corridor remains owned until its real arrival');
});
test('weather and safety interruptions preserve the exact physical leg and never repeat a home commute as patrol',()=>{
 const map=createEaldholtVillageSite(options());let s=begin(map);for(let n=1;n<=12;n++)s=step(s,n,map);
 const before=sampleVillageLifeNavigation(s,map)[0].position,interrupted=patrol({activityKey:'shelter',activity:'Shelters indoors.',targetPlaceId:'shelter',indoor:true,reason:'weather',issuedAbsoluteMinute:12});
 const next=step(s,12,map,[interrupted]);assert.deepEqual(sampleVillageLifeNavigation(next,map)[0].position,before);assert.equal(who(next).patrol,undefined);assert.equal(who(next).direction,-1);assert.deepEqual(who(next).route,who(s).route);
 let restored=parseVillageLifeNavigation(JSON.stringify(next)),live=next;
 for(let n=13;n<=45;n++){live=step(live,n,map,[interrupted]);restored=step(restored,n,map,[interrupted]);}
 assert.deepEqual(restored,live);assert.equal(who(live).status,'indoors');assert.equal(who(live).anchorPlaceId,'shelter');assert.equal(who(live).patrol,undefined);
 const same=step(s,12,map,[patrol({activityKey:'travel',activity:'Runs errands.',issuedAbsoluteMinute:12})]);assert.equal(who(same).patrol,undefined,'generic errands are never promoted into a circuit');
});
test('old source allocations and changed candidate identities do not adopt or rewrite existing patrol cursors',()=>{
 const input=options(),map=createEaldholtVillageSite(input),legacy=copy(input) as any;delete legacy.binding.navigationRevision;delete legacy.certificate.navigationRevision;delete legacy.binding.patrols;delete legacy.certificate.patrols;delete legacy.binding.navigationAllocation;delete legacy.certificate.navigationAllocation;
 const oldMap=createEaldholtVillageSite(legacy);let old=begin(oldMap);for(let n=1;n<=12;n++)old=step(old,n,oldMap);
 assert.equal(who(old).patrol,undefined);const held=step(old,13,map);assert.equal(who(held).reason,'source-site-changed');assert.equal(who(held).patrol,undefined);assert.deepEqual(who(held).anchorPosition,who(old).anchorPosition);assert.equal(held.siteIdentity,old.siteIdentity);assert.equal(sampleVillageLifeNavigation(held,map)[0].position,null);
 let active=begin(map);for(let n=1;n<=12;n++)active=step(active,n,map);
  assert.equal(active.navigationRevision,REV);assert.equal(sampleVillageLifeNavigation(active,oldMap)[0].position,null,'a new allocation cannot silently downgrade into the legacy source either');
 const changed=copy(input);changed.binding.navigationRevision=changed.certificate.navigationRevision='c'.repeat(64);changed.binding.navigationAllocation={...PAIR,desktopRevision:'c'.repeat(64)};changed.certificate.navigationAllocation={...changed.binding.navigationAllocation};const other=createEaldholtVillageSite(changed),before=JSON.stringify(active);
 assert.equal(sampleVillageLifeNavigation(active,other)[0].position,null);const refused=step(active,13,other);assert.equal(who(refused).reason,'source-site-changed');assert.deepEqual(who(refused).route,who(active).route);assert.equal(who(refused).progressMetres,who(active).progressMetres);assert.deepEqual(who(refused).patrol,who(active).patrol);assert.equal(JSON.stringify(active),before);
});
test('unpaired offline candidates and explicit world allocation holds cannot bind or move any source cursor',()=>{
 const raw=copy(options()) as any;delete raw.binding.navigationAllocation;delete raw.certificate.navigationAllocation;const unpaired=createEaldholtVillageSite(raw);
 const neverBound=begin(unpaired);assert.equal(neverBound.sourceSha256,null);assert.equal(neverBound.profile,null);assert.equal(who(neverBound).anchorPosition,null);assert.equal(who(neverBound).patrol,undefined);
 const map=createEaldholtVillageSite(options());let active=begin(map);for(let n=1;n<=12;n++)active=step(active,n,map);
 const before=JSON.stringify(active),held=advanceVillageLifeNavigation(active,{absoluteMinute:13,site:map,intents:[patrol()],metresPerWorldMinute:1,sourceAllocationHold:true});
 assert.equal(who(held).progressMetres,who(active).progressMetres);assert.deepEqual(who(held).route,who(active).route);assert.deepEqual(who(held).patrol,who(active).patrol);assert.deepEqual(held.navigationAllocation,PAIR);assert.equal(JSON.stringify(active),before);
});
