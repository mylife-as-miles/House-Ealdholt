import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtVillageSite,type VillageSiteLayout} from './village-site';
import type {VillageLifeIntent} from './village-life';
import {createVillageLifeNavigation,advanceVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,
  type VillageLifeNavigationState,type VillageLifeNavigationObstacle,villageLifeObstacleContainsPoint,villageLifeFireSegmentInterval} from './village-life-navigation';

// Contract fixtures only; these coordinates/proofs are never source assets.
function map(options:{blockedAlternate?:boolean;longSearch?:boolean;changedLeg?:boolean;profile?:'desktop'|'quest'}={}):VillageSiteLayout {
  const points:Record<string,number[]>={home:[0,0,0],begin:[3,0,0],middle:[6,0,0],end:[9,0,0],work:[12,0,0],
    upper:[3,0,3],upper2:[9,0,3],cross:[6,0,-2],cross2:[6,0,2]};
  const edges=[['departure','home','begin'],['middle-a','begin','middle'],['middle-b','middle','end'],['arrival','end','work']];
  if(options.longSearch){
    // More than the shared edge budget. The otherwise safe path remains held.
    for(let i=0;i<600;i++){points[`side${i}`]=[3,0,3+i*.01];edges.push([`side-${i}`,'begin',`side${i}`]);}
  }
  edges.push(['upper-a','begin','upper'],['upper-b','upper','upper2'],['upper-c','upper2','end'],['crossing','cross','cross2']);
  const anchors=Object.fromEntries(Object.entries(points).map(([id,p])=>[id,{sourceActor:`fixture-${id}`,sourceGroundPoint:p,capsuleBottomPoint:[p[0],.02,p[2]],standingOnly:true}]));
  const routes:any={},proofs:any[]=[];
  for(const[id,from,to]of edges){
    if(options.blockedAlternate&&id==='upper-b')continue;
    const line=options.changedLeg&&id==='upper-b'?[points[from],[6,0,4],points[to]]:[points[from],points[to]],body=line.map(p=>[p[0],.02,p[2]]),lengthMetres=line.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((x,k)=>x-line[i][k])),0);
    routes[id]={from,to,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:[1,2]};
    proofs.push({from,to,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,
      allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02});
  }
  const profile=options.profile??'desktop',sourceSha256='a'.repeat(64),capsule={height:1.8,radius:.28};
  return createEaldholtVillageSite({profile,modelSha256:sourceSha256,binding:{schema:1,profile,sourceSha256,frame:'source-root-local-metres',capsule,anchors,routes},
    certificate:{schema:1,profile,sourceSha256,frame:'source-root-local-metres',capsule,qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:1e-8,routes:proofs},
    placeBindings:Object.keys(points).map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior'}))});
}
const intent=(targetPlaceId:string,residentId='resident-a',indoor=false):VillageLifeIntent=>({residentId,targetPlaceId,indoor,activityKey:targetPlaceId==='home'?'home':'work',activity:'Fixture duty.',
  priority:residentId==='resident-a'?2:1,issuedAbsoluteMinute:0,companionIds:[],reason:'routine'});
const step=(state:VillageLifeNavigationState,absoluteMinute:number,intents:VillageLifeIntent[],site:VillageSiteLayout)=>advanceVillageLifeNavigation(state,{absoluteMinute,site,intents,metresPerWorldMinute:1});
const row=(state:VillageLifeNavigationState)=>state.residents.find(r=>r.residentId==='resident-a')!;
const sample=(state:VillageLifeNavigationState,site:VillageSiteLayout)=>sampleVillageLifeNavigation(state,site).find(r=>r.residentId==='resident-a')!;
function departure(site:VillageSiteLayout,blocker='middle'){
  const home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true),intent(blocker,'hidden-peer')],site);
  return step(home,0,[intent('work'),intent(blocker,'hidden-peer')],site);
}
const alternateIds=['departure','upper-a','upper-b','upper-c','arrival'];

test('a hidden intermediate stand permits only an existing certified alternative with unchanged terminal legs',()=>{
  for(const profile of ['desktop','quest']as const){
    const site=map({profile}),state=departure(site),journey=row(state);
    assert.equal(journey.status,'travelling');assert.equal(journey.reason,null);
    assert.deepEqual(journey.route!.legs.map(l=>l.id),alternateIds);
    assert.deepEqual(journey.route!.sourceGroundPolyline,[[0,0,0],[3,0,0],[3,0,3],[9,0,3],[9,0,0],[12,0,0]]);
    assert.equal(journey.route!.lengthMetres,18);assert.equal(journey.arrivalEvidence,'none');assert.equal(journey.arrivedAtAbsoluteMinute,null);
    assert.deepEqual(sample(state,site).position,[0,0,0]);assert.equal(sample(state,site).moving,true);
    const noBlocker=step(step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site),0,[intent('work')],site);
    assert.deepEqual(row(noBlocker).route!.legs.map(l=>l.id),['departure','middle-a','middle-b','arrival'],'clear original paths retain their original selection');
  }
});

test('chosen source legs persist through save/reload, offscreen continuation and a complete duty/home roundtrip',()=>{
  const site=map(),started=departure(site),go=[intent('work'),intent('middle','hidden-peer')];
  const observed=step(started,4,go,site),loaded=parseVillageLifeNavigation(JSON.stringify(observed));
  assert.deepEqual(sample(loaded,site).position,[3,0,1]);
  const advanced=step(loaded,11,[intent('work'),intent('middle','hidden-peer',true)],site);
  assert.deepEqual(row(advanced).route!.legs,row(started).route!.legs,'a vacated shortcut cannot reroute an active journey');
  const reached=step(advanced,18,go,site);assert.equal(row(reached).arrivedAtAbsoluteMinute,18);assert.equal(row(reached).arrivalEvidence,'certified-route-arrival');
  assert.equal(sample(reached,site).yawRadians,Math.PI/2);assert.deepEqual(sample(reached,site).position,[12,0,0]);
  assert.deepEqual(step(loaded,18,go,site),step(observed,18,go,site));
  const homeward=step(parseVillageLifeNavigation(JSON.stringify(reached)),19,[intent('home','resident-a',true),intent('middle','hidden-peer')],site);
  assert.equal(row(homeward).status,'travelling');assert.equal(row(homeward).arrivalEvidence,'none');
  assert.deepEqual(row(homeward).route!.legs.map(l=>l.id),[...alternateIds].reverse());
  const home=step(parseVillageLifeNavigation(JSON.stringify(homeward)),37,[intent('home','resident-a',true),intent('middle','hidden-peer')],site);
  assert.equal(row(home).status,'indoors');assert.equal(row(home).anchorPlaceId,'home');assert.equal(row(home).arrivedAtAbsoluteMinute,37);
  assert.equal(sample(home,site).position,null,'the actual reached home becomes an abstract interior');
});

test('an interruption reverses the saved alternate arc without replacing points or moving at the decision',()=>{
  const site=map(),go=[intent('work'),intent('middle','hidden-peer')],started=departure(site),moving=step(started,5,go,site),before=sample(moving,site).position;
  const back=[intent('home','resident-a',true),intent('middle','hidden-peer')],reversed=step(parseVillageLifeNavigation(JSON.stringify(moving)),5,back,site);
  assert.equal(row(reversed).direction,-1);assert.deepEqual(row(reversed).route,row(started).route);assert.deepEqual(sample(reversed,site).position,before);
  const home=step(reversed,10,back,site);assert.equal(row(home).anchorPlaceId,'home');assert.equal(row(home).arrivedAtAbsoluteMinute,10);assert.equal(row(home).status,'indoors');
});

test('blocked terminals, missing certified legs and bounded search exhaustion keep the original reservation hold',()=>{
  for(const[site,blocker]of [[map(),'begin'],[map(),'end'],[map({blockedAlternate:true}),'middle'],[map({longSearch:true}),'middle']]as const){
    const state=departure(site,blocker);assert.equal(row(state).status,'waiting');assert.equal(row(state).reason,'corridor-reserved');
    assert.equal(row(state).route,null);assert.equal(row(state).inside,true);assert.equal(sample(state,site).position,null);
  }
  const reserved=departure(map(),'work');assert.equal(row(reserved).reason,'destination-reserved');
});

test('whole moving corridors remain reserved while an independent certified alternative can depart',()=>{
  const site=map(),initial=step(createVillageLifeNavigation(0),0,[intent('cross','hidden-peer',true),intent('home','resident-a',true)],site);
  const peerMoving=step(initial,0,[intent('cross2','hidden-peer'),intent('home','resident-a',true)],site);
  const state=step(peerMoving,1,[intent('cross2','hidden-peer'),intent('work')],site);
  assert.equal(state.residents.find(r=>r.residentId==='hidden-peer')!.status,'travelling');
  assert.deepEqual(row(state).route!.legs.map(l=>l.id),alternateIds);
});

test('alternate qualification rejects forged points, wrong terminal legs, removed source edges and changed certificates',()=>{
  const site=map(),state=departure(site),before=JSON.stringify(state);
  for(const mutate of [(s:any)=>s.residents[0].route.legs[2].reverse=true,(s:any)=>s.residents[0].route.legs[2].id='absent',
    (s:any)=>s.residents[0].route.legs.reverse(),(s:any)=>s.residents[0].route.capsuleBottomPolyline[2][1]+=.01]){
    const value=JSON.parse(before);mutate(value);assert.equal(sample(parseVillageLifeNavigation(value),site).position,null);
  }
  for(const changed of [map({blockedAlternate:true}),map({changedLeg:true}),map({profile:'quest'})]){
    const held=step(parseVillageLifeNavigation(before),1,[intent('work'),intent('middle','hidden-peer')],changed);
    assert.equal(sample(held,changed).position,null);assert.equal(row(held).progressMetres,0);
  }
  assert.equal(JSON.stringify(state),before);
});

test('alternate choices and ordinary decision cadence are deterministic after reload',()=>{
  const site=map(),started=departure(site),go=[intent('work'),intent('middle','hidden-peer')];let live=started,coarse=parseVillageLifeNavigation(JSON.stringify(started));
  for(let i=1;i<=72;i++)live=step(live,i/4,go,site);
  for(let i=1;i<=18;i++)coarse=step(coarse,i,go,site);
  assert.deepEqual(live,coarse);assert.deepEqual(departure(site),parseVillageLifeNavigation(JSON.stringify(started)));
});

test('dated fire or collapse exclusions reroute only over unchanged certified intermediate legs',()=>{
 const site=map(),home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site);
 const obstacle={id:'fallen-source-roof',sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:0,bounds:{min:[5.5,0,-.2]as const,max:[6.5,2,.2]as const}};
 const state=advanceVillageLifeNavigation(home,{absoluteMinute:0,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});
 assert.deepEqual(row(state).route!.legs.map(l=>l.id),alternateIds);assert.equal(state.siteIdentity,home.siteIdentity);assert.equal(state.navigationRevision,home.navigationRevision);
 const loaded=parseVillageLifeNavigation(JSON.stringify(state));const reached=advanceVillageLifeNavigation(loaded,{absoluteMinute:18,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});assert.equal(row(reached).anchorPlaceId,'work');assert.equal(row(reached).arrivalEvidence,'certified-route-arrival');
});

test('a newly obstructed active route retreats on its exact saved arc without entering rubble, then takes a safe graph alternative',()=>{
 const site=map(),home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site),started=step(home,0,[intent('work')],site);
 const obstacle={id:'falling-source-roof',sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:2,bounds:{min:[5.5,0,-.2]as const,max:[6.5,2,.2]as const}};
 const before=step(started,2,[intent('work')],site),held=advanceVillageLifeNavigation(started,{absoluteMinute:2,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});
 assert.deepEqual(sample(held,site).position,sample(before,site).position);assert.deepEqual(row(held).route,row(started).route);assert.equal(row(held).direction,-1);assert.equal(row(held).progressMetres,2);
 const next=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(held)),{absoluteMinute:3,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});assert.deepEqual(sample(next,site).position,[1,0,0]);
 const rerouted=advanceVillageLifeNavigation(next,{absoluteMinute:4,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});assert.deepEqual(sample(rerouted,site).position,[0,0,0]);assert.deepEqual(row(rerouted).route!.legs.map(l=>l.id),alternateIds);
});

test('an obstacle covering the current cursor holds it exactly and excluded terminal routes never invent a connector',()=>{
 const site=map(),home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site),started=step(home,0,[intent('work')],site);
 const obstacle={id:'current-source-debris',sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:2,bounds:{min:[1.9,0,-.2]as const,max:[2.1,2,.2]as const}};
 const held=advanceVillageLifeNavigation(started,{absoluteMinute:2,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});assert.equal(row(held).reason,'dynamic-obstacle');assert.deepEqual(sample(held,site).position,[2,0,0]);assert.equal(sample(held,site).moving,false);
 const later=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(held)),{absoluteMinute:20,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});assert.deepEqual(sample(later,site).position,[2,0,0]);assert.equal(row(later).arrivalEvidence,'none');
 const resumed=advanceVillageLifeNavigation(later,{absoluteMinute:20,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[]});assert.deepEqual(sample(resumed,site).position,[2,0,0]);assert.equal(sample(resumed,site).moving,true);const moving=step(resumed,21,[intent('work')],site);assert.deepEqual(sample(moving,site).position,[3,0,0]);
 const terminal={...obstacle,id:'blocked-source-arrival',activeFromAbsoluteMinute:0,bounds:{min:[10,0,-1]as const,max:[13,2,1]as const}};const blocked=advanceVillageLifeNavigation(home,{absoluteMinute:0,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[terminal]});assert.equal(row(blocked).reason,'dynamic-obstacle');assert.equal(row(blocked).route,null);assert.equal(row(blocked).inside,true);
 const foreign=advanceVillageLifeNavigation(home,{absoluteMinute:0,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[{...terminal,sourceSha256:'b'.repeat(64)}]});assert.deepEqual(row(foreign).route!.legs.map(l=>l.id),['departure','middle-a','middle-b','arrival']);
});

test('a burning exclusion permits only monotonic escape on a certified route; rubble and return-entry remain blocked',()=>{
 const site=map(),home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site);
 const fire={id:'burning-home',kind:'fire' as const,sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:0,bounds:{min:[-1,0,-1]as const,max:[.2,2,1]as const}};
 const run=(state:VillageLifeNavigationState,at:number,target:string,obstacle:VillageLifeNavigationObstacle=fire)=>advanceVillageLifeNavigation(state,{absoluteMinute:at,site,intents:[intent(target)],metresPerWorldMinute:1,dynamicObstacles:[obstacle]});
 const escaped=run(home,0,'work');assert.equal(row(escaped).status,'travelling');assert.equal(row(escaped).reason,null);assert.deepEqual(sample(escaped,site).position,[0,0,0]);
 const walking=run(parseVillageLifeNavigation(JSON.stringify(escaped)),1,'work');assert.deepEqual(sample(walking,site).position,[1,0,0]);assert.equal(sample(walking,site).moving,true);
 const reached=run(walking,12,'work'),blockedReturn=run(reached,13,'home');assert.equal(row(blockedReturn).reason,'dynamic-obstacle');assert.equal(row(blockedReturn).route,null);
 const solid=run(home,0,'work',{...fire,kind:'solid'});assert.equal(row(solid).reason,'dynamic-obstacle');assert.equal(row(solid).route,null);assert.equal(row(solid).inside,true);
 const deepening={...fire,bounds:{min:[-.1,0,-1]as const,max:[2,2,1]as const}};assert.equal(row(run(home,0,'work',deepening)).reason,'dynamic-obstacle','a route through the deeper part of a fire is never an exit');
});

test('fire appearing around an already moving body allows its actual outward arc without teleporting or spending stopped time',()=>{
 const site=map(),home=step(createVillageLifeNavigation(0),0,[intent('home','resident-a',true)],site),started=step(home,0,[intent('work')],site);
 const fire={id:'appeared-fire',kind:'fire' as const,sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:2,bounds:{min:[1,0,-2]as const,max:[2.1,2,2]as const}};
 const at=advanceVillageLifeNavigation(started,{absoluteMinute:2,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[fire]});assert.deepEqual(sample(at,site).position,[2,0,0]);assert.equal(row(at).reason,null);
 const later=advanceVillageLifeNavigation(parseVillageLifeNavigation(JSON.stringify(at)),{absoluteMinute:3,site,intents:[intent('work')],metresPerWorldMinute:1,dynamicObstacles:[fire]});assert.deepEqual(sample(later,site).position,[3,0,0]);assert.equal(row(later).arrivalEvidence,'none');
});


test('fire volumes use the unchanged round cylinder, including an actual source vertex square-expansion counterexample',()=>{
 const site={...map(),capsule:{radius:.85,height:3.5}},vertex=[12.1624730693,2.59052440493,34.11753811734]as const,centre=[13.0124730693,1,34.96653378068]as const;
 const fire={id:'source-gable-ordinal1-vertex224',kind:'fire' as const,sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:0,bounds:{min:vertex,max:vertex}};
 assert.ok(Math.hypot(centre[0]-vertex[0],centre[2]-vertex[2])>1.20);assert.equal(villageLifeObstacleContainsPoint(centre,site,fire),false);
 assert.equal(villageLifeObstacleContainsPoint(centre,site,{...fire,kind:'solid'}),true,'rubble keeps its conservative square broadphase');
 assert.equal(villageLifeFireSegmentInterval(centre,[centre[0]+.1,1,centre[2]+.1],site,fire),null);
 const hit=[vertex[0]+.4,1,vertex[2]+.4]as const;assert.equal(villageLifeObstacleContainsPoint(hit,site,fire),true);assert.ok(villageLifeFireSegmentInterval(hit,centre,site,fire));
 assert.equal(villageLifeObstacleContainsPoint([hit[0],-2,hit[2]],site,fire),false,'unchanged vertical slab excludes a body entirely below the source vertex');
});

test('round fire segment intervals include sides, tangent corners and vertical crossings without square corner falsepositives',()=>{
 const site={...map(),capsule:{radius:1,height:2}},fire={id:'exact-round',kind:'fire' as const,sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:0,bounds:{min:[0,0,0]as const,max:[1,2,1]as const}};
 assert.equal(villageLifeFireSegmentInterval([1.8,0,1.8],[3,0,3],site,fire),null);
 const side=villageLifeFireSegmentInterval([-2,0,.5],[3,0,.5],site,fire)!;assert.ok(Math.abs(side[0]-.2)<1e-9);assert.ok(Math.abs(side[1]-.8)<1e-9);
 const tangent=villageLifeFireSegmentInterval([-1,0,2],[2,0,2],site,fire)!;assert.ok(tangent);assert.ok(Math.abs(tangent[0]-1/3)<1e-9);assert.ok(Math.abs(tangent[1]-2/3)<1e-9);
 const vertical=villageLifeFireSegmentInterval([.5,-4,.5],[.5,4,.5],site,fire)!;assert.deepEqual(vertical,[.25,.75]);
 assert.equal(villageLifeFireSegmentInterval([.5,3,.5],[.5,4,.5],site,fire),null);
});
