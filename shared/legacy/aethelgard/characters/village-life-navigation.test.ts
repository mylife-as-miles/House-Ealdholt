import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtVillageSite,type VillageSiteLayout,type VillageSiteOptions} from './village-site';
import type {VillageLifeIntent} from './village-life';
import {createVillageLifeNavigation,advanceVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,ownsExclusiveVillageLifeExteriorAnchor,ownsExclusiveVillageLifeRouteWaitAnchor,type VillageLifeNavigationState} from './village-life-navigation';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
// Certificate-shaped unit fixtures exercise navigation contracts only. They are
// never used as village geometry or claims of source/animation qualification.
function site(options:{sha?:string;disconnected?:boolean;workOffset?:number;radius?:number}={}):VillageSiteLayout {
  const points:Record<string,number[]>={home:[0,0,0],work:[4+(options.workOffset??0),0,3],shelter:[0,0,-4],island:[8,0,3],island2:[9,0,3],cross:[-3,0,2],cross2:[3,0,2]};
  const anchors=Object.fromEntries(Object.entries(points).map(([key,p])=>[key,{sourceActor:`fixture-${key}`,sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]],standingOnly:true}]));
  const definitions=[['home-work','home','work',[points.home,[0,0,3],points.work]],['home-shelter','home','shelter',[points.home,points.shelter]],['island-leg','island','island2',[points.island,points.island2]],['cross-leg','cross','cross2',[points.cross,points.cross2]]] as const;
  const routes:any={},proofs:any[]=[];
  for(const [key,from,to,line]of definitions){if(options.disconnected&&key==='home-work')continue;const body=line.map(p=>[p[0],p[1]+.02,p[2]]),lengthMetres=line.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((n,k)=>n-line[i][k])),0);routes[key]={from,to,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:[1,2]};proofs.push({from,to,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridor:[1,2],partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:2,slopeLipschitzUpperBound:0,capsuleBottomLiftMetres:.02});}
  const sha=options.sha??'a'.repeat(64),capsule={height:1.8,radius:options.radius??.28};
  return createEaldholtVillageSite({profile:'desktop',modelSha256:sha,binding:{schema:1,profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule,anchors,routes},certificate:{schema:1,profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule,qualified:true,sourceOriginalBuffersUnchanged:true,capsuleClearanceMargin:.005,groundBoundaryRoundingMaxMetres:1e-8,routes:proofs},placeBindings:Object.keys(points).map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior'}))} satisfies VillageSiteOptions);
}
function intent(targetPlaceId='home',overrides:Partial<VillageLifeIntent>={}):VillageLifeIntent{return{residentId:'resident-a',targetPlaceId,activityKey:'home',activity:'Return home.',priority:1,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'routine',...overrides};}
function step(s:VillageLifeNavigationState,absoluteMinute:number,intents:VillageLifeIntent[],map:VillageSiteLayout|null=site()){return advanceVillageLifeNavigation(s,{absoluteMinute,site:map,intents,metresPerWorldMinute:1});}
function sample(s:VillageLifeNavigationState,map:VillageSiteLayout|null=site()){return sampleVillageLifeNavigation(s,map)[0];}
function start(map=site(),at=0){return step(createVillageLifeNavigation(at),at,[intent()],map);}

function reachedRouteWait(options:{radius?:number;workOffset?:number}={}){
 const base=site(options),map=Object.freeze({...base,residentPlaceBindings:Object.freeze([
  {residentId:'resident-a',placeId:'home',anchorId:'home',status:'mapped-exterior' as const},
  {residentId:'resident-a',placeId:'work',anchorId:'work',status:'mapped-exterior' as const}])});
 let s=step(start(map),0,[intent('work')],map);s=step(s,7,[intent('work')],map);
 const peer=intent('home',{residentId:'resident-b'});s=step(s,7,[intent('work'),peer],map);
 const rest=intent('home',{activityKey:'rest',activity:'Rests indoors.',priority:85,issuedAbsoluteMinute:8,reason:'needs',indoor:true});
 return{map,peer,rest,state:step(s,8,[rest,peer],map)};
}

test('route waiting retains only its own real exterior arrival despite an indoor future intent',()=>{
 const{map,state}=reachedRouteWait(),before=JSON.stringify(state),resident=state.residents[0];
 assert.equal(resident.status,'waiting');assert.equal(resident.reason,'destination-reserved');assert.equal(resident.indoor,true);assert.equal(resident.inside,false);
 assert.equal(resident.arrivalEvidence,'certified-route-arrival');assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(state,map,'resident-a'),true);
 assert.equal(ownsExclusiveVillageLifeExteriorAnchor(state,map,'resident-a'),false,'The at-target work-resource permission stays strict.');
 assert.equal(JSON.stringify(state),before);assert.deepEqual(parseVillageLifeNavigation(before),state);
});
test('route-wait proof rejects indoor bodies, initial/stale/foreign points and any actual active journey',()=>{
 const{map,state,rest,peer}=reachedRouteWait();
 for(const edit of [(s:any)=>s.residents[0].inside=true,(s:any)=>{s.residents[0].arrivalEvidence='none';s.residents[0].arrivedAtAbsoluteMinute=null;},
  (s:any)=>{s.residents[0].arrivalEvidence='initial-placement';s.residents[0].arrivedAtAbsoluteMinute=null;},
  (s:any)=>s.residents[0].arrivedAtAbsoluteMinute=state.absoluteMinute+1,
  (s:any)=>s.residents[0].anchorPosition[0]++,
  (s:any)=>s.residents[0].destinationPlaceId='shelter',
  (s:any)=>s.residents[0].originPlaceId='island',
  (s:any)=>s.residents[0].originPlaceId=null,
  (s:any)=>{s.siteIdentity+=':foreign';for(const r of s.residents)r.sourceSiteIdentity=s.siteIdentity;},
  (s:any)=>s.residents[0].sourceSha256='b'.repeat(64)]){
  const bad=clone(state);edit(bad);let allowed=false;try{allowed=ownsExclusiveVillageLifeRouteWaitAnchor(bad,map,'resident-a');}catch{/* Strict parser rejection is also a hold. */}assert.equal(allowed,false);
 }
 assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(state,Object.freeze({...map,profile:'quest'}),'resident-a'),false);
 let moving=step(state,9,[rest,{...peer,indoor:true}],map);moving=step(moving,10,[rest,{...peer,indoor:true}],map);
 assert.equal(moving.residents[0].status,'travelling');assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(moving,map,'resident-a'),false,'A travelling resident cannot idle at its retained old anchor.');
});
test('hidden outside peers, overlapping different anchors and whole reserved corridors still block a route-wait body',()=>{
 const{map,state}=reachedRouteWait({radius:.6,workOffset:-1}),own=state.residents[0];
 const duplicate=clone(state) as any;duplicate.residents.push({...clone(own),residentId:'resident-c'});
 assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(duplicate,map,'resident-a'),false);
 const close=clone(state) as any;close.residents.push({...clone(own),residentId:'resident-c',anchorPlaceId:'cross2',anchorPosition:[3,0,2],targetPlaceId:'cross2',status:'at-threshold',reason:null});
 assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(close,map,'resident-a'),false,'Different certified anchor IDs do not prevent physical overlap.');
 const crossing=step(createVillageLifeNavigation(8),8,[intent('cross',{residentId:'resident-c',indoor:true})],map);
 const entering=step(crossing,8,[intent('cross2',{residentId:'resident-c'})],map),blocked=clone(state) as any;blocked.residents.push(clone(entering.residents[0]));
 assert.equal(ownsExclusiveVillageLifeRouteWaitAnchor(blocked,map,'resident-a'),false,'The whole source corridor remains owned even before its body reaches the waiting point.');
});

test('corrected indoor decisions release their own stale doorway, never another resident\'s lease',()=>{
  const map=site(),a=intent('home',{activity:'Rests indoors.',activityKey:'rest',priority:4}),
    b=intent('home',{residentId:'resident-b',indoor:true,priority:3}),
    c=intent('work',{residentId:'resident-c',priority:2}),
    d=intent('shelter',{residentId:'resident-d',indoor:true,priority:1});
  const before=step(createVillageLifeNavigation(0),0,[a,b,c,d],map);
  const corrected=[{...a,indoor:true,issuedAbsoluteMinute:1},{...b,indoor:false},c,{...d,targetPlaceId:'work'}];
  const next=step(before,1,corrected,map),rows=sampleVillageLifeNavigation(next,map);
  assert.equal(rows.find(r=>r.residentId==='resident-a')!.position,null);
  assert.equal(rows.find(r=>r.residentId==='resident-a')!.status,'indoors');
  assert.deepEqual(rows.find(r=>r.residentId==='resident-b')!.position,[0,0,0],'the vacated door is available at the normal decision boundary');
  assert.equal(rows.find(r=>r.residentId==='resident-d')!.reason,'destination-reserved','the unrelated work reservation stays owned');
  assert.deepEqual(next.residents.find(r=>r.residentId==='resident-c'),before.residents.find(r=>r.residentId==='resident-c')&&{...before.residents.find(r=>r.residentId==='resident-c')!,lastAbsoluteMinute:1});
  const again=step(next,2,[...corrected.slice(0,3),{...d,targetPlaceId:'home'}],map);
  assert.equal(sampleVillageLifeNavigation(again,map).find(r=>r.residentId==='resident-d')!.reason,'destination-reserved','an indoor resident cannot delete the new doorway owner');
  const own=next.residents.find(r=>r.residentId==='resident-a')!,old=before.residents.find(r=>r.residentId==='resident-a')!;
  for(const field of ['anchorPosition','anchorPlaceId','sourceSha256','sourceSiteIdentity','arrivalEvidence','arrivedAtAbsoluteMinute','route','progressMetres','startedAbsoluteMinute'] as const)assert.deepEqual(own[field],old[field],field);
  assert.deepEqual(step(parseVillageLifeNavigation(JSON.stringify(before)),1,corrected,map),next);
  assert.equal(sampleVillageLifeNavigation(before,map).find(r=>r.residentId==='resident-a')!.position!==null,true);
});

test('an exclusive wait stand requires a current person-bound exterior anchor and no other body or corridor owner',()=>{
  const original=site(),map=Object.freeze({...original,residentPlaceBindings:Object.freeze([
    {residentId:'resident-a',placeId:'home',anchorId:'home',status:'mapped-exterior' as const},
  ])});
  const before=start(map);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,map,'resident-a'),true);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(JSON.stringify(before)),map,'resident-a'),true);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,null,'resident-a'),false);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,original,'resident-a'),false,'a public stand is not a person-bound waiting certificate');
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,site({sha:'b'.repeat(64)}),'resident-a'),false);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,Object.freeze({...map,profile:'quest' as const}),'resident-a'),false,'another renderer profile cannot borrow a saved Desktop stand');
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(step(before,1,[intent('home',{indoor:true})],map),map,'resident-a'),false);
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(step(before,1,[intent('missing')],map),map,'resident-a'),false);
  const duplicate=clone(before) as any;duplicate.residents.push({...duplicate.residents[0],residentId:'resident-b'});
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(duplicate),map,'resident-a'),false);
  const entering=step(step(createVillageLifeNavigation(0),0,[intent('work',{residentId:'resident-b'})],map),0,[intent('home',{residentId:'resident-b'})],map);
  const occupied=clone(before) as any;occupied.residents.push(clone(entering.residents[0]));
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(occupied),map,'resident-a'),false,'a reserved incoming corridor keeps the stand unavailable');
  const changed=Object.freeze({...map,residentPlaceBindings:Object.freeze([{...map.residentPlaceBindings[0],anchorId:'work'}])});
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(before,changed,'resident-a'),false,'same model hash does not authorize changed binding coordinates');
  const wide=Object.freeze({...site({radius:.85}),residentPlaceBindings:Object.freeze([{residentId:'resident-a',placeId:'work',anchorId:'work',status:'mapped-exterior' as const}])});
  const a=step(createVillageLifeNavigation(0),0,[intent('work')],wide),b=step(createVillageLifeNavigation(0),0,[intent('cross2',{residentId:'resident-b'})],wide);
  const nearby=clone(a) as any;nearby.residents.push(clone(b.residents[0]));
  assert.equal(ownsExclusiveVillageLifeExteriorAnchor(parseVillageLifeNavigation(nearby),wide,'resident-a'),false,'different stand IDs cannot conceal overlapping body envelopes');
  assert.deepEqual(sample(before,map).position,[0,0,0]);
});

test('first measured threshold is initial placement, never witnessed arrival or indoor furniture evidence',()=>{const s=start();assert.equal(sample(s).arrivalEvidence,'initial-placement');assert.equal(sample(s).arrivedAtAbsoluteMinute,null);assert.deepEqual(sample(s).position,[0,0,0]);assert.equal(Object.isFrozen(s.residents[0]),true);const inside=step(s,0,[intent('home',{indoor:true})]);assert.equal(sample(inside).status,'indoors');assert.equal(sample(inside).position,null);});
test('saved arc-length progress follows the measured corner and reaches a source threshold',()=>{let s=step(start(),0,[intent('work')]);assert.equal(sample(s).moving,true);s=step(s,4,[intent('work')]);assert.deepEqual(sample(s).position,[1,0,3]);s=step(s,7,[intent('work')]);assert.deepEqual(sample(s).position,[4,0,3]);assert.equal(sample(s).arrivalEvidence,'certified-route-arrival');assert.equal(sample(s).arrivedAtAbsoluteMinute,7);assert.equal(sample(s).placeId,'work');});
test('weather/family interruptions reverse existing progress without teleporting to an intent target',()=>{let s=step(start(),0,[intent('work')]);s=step(s,1,[intent('work')]);const before=sample(s).position;s=step(s,1,[intent('shelter',{issuedAbsoluteMinute:1,reason:'weather',indoor:true})]);assert.deepEqual(sample(s).position,before);assert.equal(s.residents[0].direction,-1);s=step(s,2,[intent('shelter',{issuedAbsoluteMinute:1,indoor:true})]);assert.deepEqual(sample(s).position,[0,0,0]);s=step(s,3,[intent('shelter',{issuedAbsoluteMinute:1,indoor:true})]);assert.deepEqual(sample(s).position,[0,0,-1]);s=step(s,6,[intent('shelter',{issuedAbsoluteMinute:1,indoor:true})]);assert.equal(sample(s).position,null);assert.equal(sample(s).status,'indoors');assert.equal(s.residents[0].anchorPlaceId,'shelter');});
test('a changed target nearer the current destination finishes that leg before rerouting',()=>{let s=step(start(),0,[intent('work')]);s=step(s,5,[intent('work')]);const before=sample(s).position;s=step(s,5,[intent('shelter',{issuedAbsoluteMinute:5})]);assert.deepEqual(sample(s).position,before);assert.equal(s.residents[0].direction,1);s=step(s,7,[intent('shelter',{issuedAbsoluteMinute:5})]);assert.deepEqual(sample(s).position,[4,0,3]);assert.equal(s.residents[0].destinationPlaceId,'shelter');assert.equal(sample(s).arrivalEvidence,'none','new outgoing leg is not evidence of shelter arrival');});
test('inaccessible targets retain the previous physical threshold with explicit waiting',()=>{const map=site();let s=start(map);s=step(s,1,[intent('island')],map);assert.equal(sample(s,map).reason,'route-unmapped');assert.deepEqual(sample(s,map).position,[0,0,0]);s=step(s,2,[intent('missing')],map);assert.equal(sample(s,map).reason,'destination-unmapped');assert.deepEqual(sample(s,map).position,[0,0,0]);assert.equal(sample(s,map).placeId,'home');});
test('initial endpoint reservations use stable resident priority and permit logical shared interiors',()=>{let s=step(createVillageLifeNavigation(0),0,[intent('home',{residentId:'resident-b'}),intent()]);const rows=sampleVillageLifeNavigation(s,site());assert.equal(rows.find(r=>r.residentId==='resident-a')?.status,'at-threshold');assert.equal(rows.find(r=>r.residentId==='resident-b')?.position,null);assert.equal(rows.find(r=>r.residentId==='resident-b')?.reason,'destination-reserved');s=step(createVillageLifeNavigation(0),0,[intent('home',{residentId:'resident-b',indoor:true}),intent('home',{indoor:true})]);assert.equal(s.residents.filter(r=>r.status==='indoors').length,2);});
test('crossing whole-body corridors reserve shared ground before the second traveller departs',()=>{const map=site();let s=step(createVillageLifeNavigation(0),0,[intent('home',{indoor:true}),intent('cross',{residentId:'resident-b',indoor:true})],map);s=step(s,0,[intent('work',{priority:2}),intent('cross2',{residentId:'resident-b'})],map);assert.equal(s.residents.find(r=>r.residentId==='resident-a')?.status,'travelling');assert.equal(s.residents.find(r=>r.residentId==='resident-b')?.reason,'corridor-reserved');assert.equal(sampleVillageLifeNavigation(s,map).find(r=>r.residentId==='resident-b')?.position,null,'waiting resident remains inside');});
test('stationary residents block swept routes without invented avoidance offsets',()=>{const map=site();let s=step(createVillageLifeNavigation(0),0,[intent('work',{indoor:true}),intent('home',{residentId:'resident-b'})],map);s=step(s,0,[intent('shelter'),intent('home',{residentId:'resident-b'})],map);assert.equal(s.residents.find(r=>r.residentId==='resident-a')?.reason,'corridor-reserved');});
test('off-screen no-site progression, midnight and JSON reload preserve the same pinned journey',()=>{const map=site();let s=start(map,1438);s=step(s,1438,[intent('work')],map);s=step(s,1440,[intent('work')],null);assert.equal(sample(s,null).position,null);assert.equal(s.residents[0].progressMetres,2);const saved=parseVillageLifeNavigation(JSON.stringify(s));assert.deepEqual(saved,s);const live=step(s,1443,[intent('work')],map),restored=step(saved,1443,[intent('work')],map);assert.deepEqual(restored,live);assert.deepEqual(sample(restored,map).position,[2,0,3]);const finished=step(restored,1450,[intent('work')],null);assert.equal(finished.residents[0].arrivedAtAbsoluteMinute,1445);assert.equal(sample(finished,map).placeId,'work');});
test('source change and changed same-hash binding never move saved coordinates or admit stale poses',()=>{const map=site();let s=step(start(map),0,[intent('work')],map);s=step(s,2,[intent('work')],map);const position=sample(s,map).position;const changed=site({sha:'b'.repeat(64)}),held=step(s,3,[intent('work')],changed);assert.equal(sample(held,changed).position,null);assert.equal(held.residents[0].progressMetres,2);const resumed=step(held,3,[intent('work')],map);assert.deepEqual(sample(resumed,map).position,position);assert.equal(sample(s,site({workOffset:1})).position,null);});
test('copied model SHA cannot make forged route, reverse flag or anchor coordinates presentable',()=>{let s=step(start(),0,[intent('work')]);s=step(s,2,[intent('work')]);for(const mutation of [(v:any)=>v.residents[0].route.legs[0].reverse=true,(v:any)=>{v.residents[0].route.sourceGroundPolyline[1][0]=1;v.residents[0].route.lengthMetres=Math.hypot(1,3)+3;}]){const forged=clone(s);mutation(forged);assert.equal(sample(parseVillageLifeNavigation(forged)).position,null);}const forged=clone(start()) as any;forged.residents[0].anchorPosition=[200,0,0];assert.equal(sample(parseVillageLifeNavigation(forged)).position,null);});
test('strict save shape, hostile getters, incomplete identities and time rollback reject without mutation',()=>{const s=start(),before=JSON.stringify(s);for(const mutate of [(v:any)=>v.extra=true,(v:any)=>v.residents[0].extra=true,(v:any)=>v.residents[0].sourceSiteIdentity=null,(v:any)=>v.residents[0].lastAbsoluteMinute=1,(v:any)=>v.residents[0].anchorPosition=null,(v:any)=>v.residents[0].progressMetres=Infinity]){const bad=clone(s);mutate(bad);assert.throws(()=>parseVillageLifeNavigation(bad));}let reads=0;const bad=clone(s) as any;Object.defineProperty(bad.residents[0],'anchorPosition',{enumerable:true,get(){reads++;return[0,0,0];}});assert.throws(()=>parseVillageLifeNavigation(bad));assert.equal(reads,0);assert.throws(()=>step(s,-1,[intent()]));assert.equal(JSON.stringify(s),before);});

test('a reached threshold retains the actual certified arrival tangent after save/reload',()=>{let s=step(start(),0,[intent('work')]);s=step(s,7,[intent('work')]);assert.equal(sample(s).yawRadians,Math.PI/2);s=parseVillageLifeNavigation(JSON.stringify(s));assert.equal(sample(s).yawRadians,Math.PI/2);s=step(s,7,[intent('home')]);s=step(s,14,[intent('home')]);assert.ok(Math.abs(Math.abs(sample(s).yawRadians)-Math.PI)<1e-8);assert.equal(sample(start()).yawRadians,0,'initial placement makes no arrival-orientation assertion');});

test('quarter-minute observation does not give queued departures an advantage over boundary catch-up',()=>{const map=site(),go=[intent('work',{priority:2}),intent('cross2',{residentId:'resident-b'})];const initial=step(createVillageLifeNavigation(0),0,[intent('home',{indoor:true}),intent('cross',{residentId:'resident-b',indoor:true})],map);let live=step(initial,0,go,map),bulk=step(initial,0,go,map);for(let n=1;n<=52;n++)live=step(live,n/4,go,map);for(let n=1;n<=13;n++)bulk=step(bulk,n,go,map);assert.deepEqual(live,bulk);assert.equal(bulk.residents.find(r=>r.residentId==='resident-b')?.startedAbsoluteMinute,7);assert.equal(bulk.residents.find(r=>r.residentId==='resident-b')?.arrivedAtAbsoluteMinute,13);});
test('no-op navigation at an identical clock and semantic intents reuses the immutable cursor',()=>{const map=site(),s=start(map);assert.equal(step(s,0,[intent()],map),s);});

test('a fresh life profile starts at its measured family home and follows a real commute',()=>{const map=site(),initialPlaces=[{residentId:'resident-a',placeId:'home',indoor:true}];let s=advanceVillageLifeNavigation(createVillageLifeNavigation(540),{absoluteMinute:540,site:map,intents:[intent('work')],initialPlaces,metresPerWorldMinute:1});assert.equal(s.residents[0].anchorPlaceId,'home');assert.equal(s.residents[0].destinationPlaceId,'work');assert.equal(s.residents[0].status,'travelling');assert.deepEqual(sample(s,map).position,[0,0,0]);assert.equal(s.residents[0].arrivalEvidence,'none');s=advanceVillageLifeNavigation(s,{absoluteMinute:541,site:map,intents:[intent('work')],initialPlaces,metresPerWorldMinute:1});assert.deepEqual(sample(s,map).position,[0,0,1]);});
test('a missing initial home never bootstraps someone at a known job instead',()=>{const map=site();const s=advanceVillageLifeNavigation(createVillageLifeNavigation(540),{absoluteMinute:540,site:map,intents:[intent('work')],initialPlaces:[{residentId:'resident-a',placeId:'missing-home',indoor:true}],metresPerWorldMinute:1});assert.equal(s.residents[0].anchorPlaceId,null);assert.equal(sample(s,map).position,null);assert.equal(s.residents[0].arrivalEvidence,'none');assert.throws(()=>advanceVillageLifeNavigation(s,{absoluteMinute:541,site:map,intents:[intent('work')],initialPlaces:[],metresPerWorldMinute:1}));});

test('shared household bootstrap remains logically indoors and reserves outside-door capacity before exposure',()=>{const map=site(),intents=[intent('home'),intent('home',{residentId:'resident-b'})],initialPlaces=intents.map(r=>({residentId:r.residentId,placeId:'home',indoor:true}));let s=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:map,intents,initialPlaces,metresPerWorldMinute:1});assert.equal(s.residents.filter(r=>r.inside).length,2);assert.equal(s.residents.filter(r=>r.anchorPlaceId==='home').length,2);assert.ok(sampleVillageLifeNavigation(s,map).every(r=>r.position===null));s=advanceVillageLifeNavigation(s,{absoluteMinute:1,site:map,intents,initialPlaces,metresPerWorldMinute:1});assert.equal(s.residents.filter(r=>!r.inside).length,1);assert.equal(s.residents.find(r=>r.residentId==='resident-b')?.reason,'doorway-reserved');assert.equal(sampleVillageLifeNavigation(s,map).filter(r=>r.position!==null).length,1);});
