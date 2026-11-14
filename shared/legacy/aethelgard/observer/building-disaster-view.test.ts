import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingDisasterIncidents,BUILDING_CLOSE_WORK_RETREAT_DAMAGE,createBuildingDisasterFrame,projectBuildingDisasterObstacles,type BuildingDisasterFrameInput} from './building-disaster-view';
import {buildSourceBuildingCatalogue} from './building-damage-catalogue';
import {createBuildingCollapse} from './building-collapse';
import {buildingDamageKey,createVillageBuildingDamage,settleVillageBuildingRaid} from './building-damage';
import {createBuildingConflagration,stepBuildingConflagration} from './building-conflagration';
import {buildingFireIncidentId} from './building-disaster-session';
import {EMPTY_OBSERVER_SAVE,type ObserverSave} from './observer-save';
import {EALDHOLT_VILLAGE_POPULATION as roster} from '../characters/village-population';
import {createVillagePopulationRuntime,type VillagePopulationRuntime,type VillagePopulationEmergencyCheckpoint} from '../characters/village-population-runtime';
import {createVillageLifeNavigation,advanceVillageLifeNavigation} from '../characters/village-life-navigation';
import {createResidentBuildingEmergency,type ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';
import type {VillageSiteLayout} from '../characters/village-site';
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
const sha='a'.repeat(64),world='disaster-frame-unit-fixture',brewer=roster.residents.find(r=>r.id==='ealdholt-brewster')!;
const catalogue=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[{id:'door',kind:'door',bounds:{min:[-2,0,0],max:[2,2,.2]}},{id:'wall',kind:'wall',bounds:{min:[-2,0,3],max:[2,2,3.2]}},{id:'roof',kind:'roof',bounds:{min:[-2.2,2,-.2],max:[2.2,2.5,3.4]}}]}),building=catalogue.buildings[0];
function fixture(){
 const result=createVillagePopulationRuntime({population:roster,confirmedEntry:true,worldKey:world,contentRevision:'frame-fixture',createdAt:1000,initialDayMinute:0,millisecondsPerWorldMinute:4000,walkingSpeedMetresPerSecond:1});assert.ok(result.ok,result.ok?'':result.error);const base=result.snapshot;
 const anchors=roster.residents.map((r,i)=>({id:`home-${i}`,sourceActor:'fixture-ground',sourceGroundPoint:(r.id===brewer.id?[0,0,-2]:[1000+i*10,0,1])as[number,number,number],capsuleBottomPoint:(r.id===brewer.id?[0,0,-2]:[1000+i*10,0,1])as[number,number,number],standingOnly:true as const}));
 const well={id:'well',sourceActor:'fixture-ground',sourceGroundPoint:[20,0,1]as const,capsuleBottomPoint:[20,0,1]as const,standingOnly:true as const};
 const bindings=roster.residents.map((r,i)=>({residentId:r.id,placeId:r.homePlaceId,anchorId:`home-${i}`,status:'mapped-exterior' as const}));
 const site:VillageSiteLayout={profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:[...anchors,well],routes:[],placeBindings:[{placeId:'village-well',anchorId:well.id,status:'mapped-exterior'}],residentPlaceBindings:[...bindings,{residentId:brewer.id,placeId:'village-well',anchorId:well.id,status:'mapped-exterior'}]};freeze(site);
 const navigation=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,metresPerWorldMinute:1,intents:roster.residents.map(r=>({residentId:r.id,targetPlaceId:r.homePlaceId,activityKey:'home',activity:'Resting.',priority:1,issuedAbsoluteMinute:0,indoor:true,companionIds:[],reason:'routine'}))});
 const snapshot:VillagePopulationRuntime={...base,navigation};
 const outcome={worldKey:world,raidId:'raid-0-0',startMinute:0,settledMinute:0,outcome:'burned' as const,binding:building.binding,targetLabel:'Fixture house'};
 const fire=stepBuildingConflagration(createBuildingConflagration({worldKey:world,absoluteMinute:0,seed:world,buildings:catalogue.buildings}),{absoluteMinute:0,damageOutcome:outcome}).state;
 const saved:ObserverSave={...EMPTY_OBSERVER_SAVE,buildingFire:{status:'valid',state:fire},buildingDamage:{status:'valid',state:createVillageBuildingDamage(world,0)}};
 const input:BuildingDisasterFrameInput={absoluteMinute:0,site,siteIdentity:'verified-artifact-fixture',buildings:catalogue.buildings,populationSnapshot:snapshot,associations:[{residentId:brewer.id,placeId:brewer.homePlaceId,anchorId:bindings.find(b=>b.residentId===brewer.id)!.anchorId,binding:building.binding,sourceDoorActor:'original-door',sourceDoorOrdinal:0}],stations:[],obstacles:[],groundHeight:()=>0};
 return{snapshot,saved,input,outcome};
}
function checkpoint(f:ReturnType<typeof fixture>,navigation=f.snapshot.navigation):VillagePopulationEmergencyCheckpoint{return{kind:'village-population-emergency-checkpoint',schemaVersion:1,worldKey:world,contentRevision:f.snapshot.contentRevision,canonicalGeneration:f.snapshot.generation,canonicalElapsedMilliseconds:0,clock:f.snapshot.clock,life:f.snapshot.life,navigation,navigationOther:null,buildingEmergency:createResidentBuildingEmergency(world,0),canonicalEvidence:{kind:'village-emergency-canonical-evidence',worldKey:world,contentRevision:f.snapshot.contentRevision,clockConfig:{createdAt:1000,initialDayMinute:0,millisecondsPerWorldMinute:4000},walkingSpeedMetresPerSecond:f.snapshot.walkingSpeedMetresPerSecond,population:roster,rosterFacts:f.snapshot.rosterFacts,safetySignals:[],safetySignalIds:[],sourceAllocationKey:'fixture',sourceBindings:[]}};}
function station(f:ReturnType<typeof fixture>,kind:'water'|'fire'|'repair'):ResidentBuildingEmergencyStation{return{id:kind,disasterId:buildingFireIncidentId(f.saved.buildingFire!.state!.buildings[0])!,residentId:brewer.id,placeId:'village-well',anchorId:'well',kind,buildingKey:kind==='water'?null:buildingDamageKey(building.binding),sourceActor:'fixture-ground',contactPoint:[20,1,1],yawRadians:0,clip:kind==='repair'?'work_chisel':'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:f.input.siteIdentity,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'original-contact',maximumContactDistanceMetres:2,clip:kind==='repair'?'work_chisel':'carry_bucket_walk'}};}

test('source-positioned alarm recipients and affected homes remain local; safe shelter uses existing non-home graph places',()=>{
 const f=fixture(),frame=createBuildingDisasterFrame(f.saved,f.input)!;assert.deepEqual(frame.incidents[0].knownByResidentIds,[brewer.id]);assert.deepEqual(frame.incidents[0].affectedResidentIds,[brewer.id]);assert.deepEqual(frame.shelterPlaceIds,['village-well']);assert.equal(frame.siteIdentity,f.input.siteIdentity);assert.equal(frame.obstacles[0].kind,'fire');assert.equal(frame.obstacles[0].activeFromAbsoluteMinute,0);
 const wrong={...f.input,associations:f.input.associations.map(a=>({...a,anchorId:'unmapped'}))};assert.deepEqual(createBuildingDisasterFrame(f.saved,wrong)!.incidents[0].affectedResidentIds,[]);
});
test('each coupled minute reads persisted staged navigation instead of the stale outer rendered snapshot',()=>{
 const f=fixture(),nav={...f.snapshot.navigation,residents:f.snapshot.navigation.residents.map(r=>r.residentId===brewer.id?{...r,inside:false,anchorPosition:[9000,0,9000]as const}:r)},cp=checkpoint(f,nav),saved={...f.saved,buildingEmergency:{status:'valid' as const,state:cp}};
 assert.deepEqual(createBuildingDisasterFrame(saved,f.input)!.incidents[0].knownByResidentIds,[]);assert.deepEqual(createBuildingDisasterFrame(f.saved,f.input)!.incidents[0].knownByResidentIds,[brewer.id]);
});
test('original wall contacts stop after collapse while source-qualified workpiece repairs require a funded named order',()=>{
 const f=fixture(),stations=[station(f,'water'),station(f,'fire'),station(f,'repair')];assert.deepEqual(createBuildingDisasterFrame(f.saved,{...f.input,stations})!.stations.map(s=>s.kind),['water','fire']);
 const fire=f.saved.buildingFire!.state!,collapsed={...f.saved,buildingFire:{status:'valid' as const,state:{...fire,buildings:fire.buildings.map(r=>({...r,collapsedAtMinute:0}))}}};
 const frame=createBuildingDisasterFrame(collapsed,{...f.input,stations,absoluteMinute:2})!;assert.deepEqual(frame.stations.map(s=>s.kind),['water']);assert.ok(frame.obstacles.some(o=>o.id.startsWith('building-debris:')));
 assert.deepEqual(projectBuildingDisasterObstacles(collapsed,{...f.input,absoluteMinute:2}),projectBuildingDisasterObstacles(collapsed,{...f.input,absoluteMinute:2}));
});
test('physical hazards project saved collapse independently of stale display obstacles and honour the saved clock pace',()=>{
 const f=fixture(),fire=f.saved.buildingFire!.state!,collapsed={...f.saved,buildingFire:{status:'valid' as const,state:{...fire,buildings:fire.buildings.map(r=>({...r,collapsedAtMinute:0}))}}};
 const input={...f.input,absoluteMinute:1,obstacles:[{id:'stale-display',profile:'desktop' as const,sourceSha256:sha,activeFromAbsoluteMinute:0,bounds:{min:[-999,-999,-999]as const,max:[999,999,999]as const}}]};
 const frame=createBuildingDisasterFrame(collapsed,input)!;assert.ok(!frame.obstacles.some(o=>o.id==='stale-display'));assert.ok(frame.obstacles.some(o=>o.id.startsWith('building-debris:')));assert.equal(JSON.stringify(f.snapshot).includes('stale-display'),false);
});
test('repaired fires do not resurrect a legacy ruin and invalid or future source state cannot produce a frame',()=>{
 const f=fixture(),fire=f.saved.buildingFire!.state!,damage=settleVillageBuildingRaid(createVillageBuildingDamage(world,0),f.outcome,0),repaired={...f.saved,buildingDamage:{status:'valid' as const,state:damage},buildingFire:{status:'valid' as const,state:{...fire,buildings:fire.buildings.map(r=>({...r,phase:'sound' as const,rebuiltAtMinute:0}))}}};
 assert.deepEqual(buildingDisasterIncidents(repaired,0),[]);assert.equal(createBuildingDisasterFrame(f.saved,{...f.input,site:{...f.input.site,sourceSha256:'f'.repeat(64)}}),null);
 assert.equal(createBuildingDisasterFrame({...f.saved,buildingEmergency:{status:'invalid',raw:{version:99},error:'future'}},f.input),null);
 assert.throws(()=>buildingDisasterIncidents({...f.saved,buildingFire:{status:'valid',state:{...fire,absoluteMinute:10}}},0),/Future fire/);
});

test('real-height source-part fire hazards admit a certified exterior approach beneath a high overhang without exempting the resident',()=>{
 const f=fixture(),source=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[{id:'tall-door',kind:'door',bounds:{min:[-2,0,0],max:[2,5,.2]}},{id:'tall-wall',kind:'wall',bounds:{min:[-2,0,3],max:[2,5,3.2]}},{id:'high-roof',kind:'roof',bounds:{min:[-4,5,-1],max:[4,5.5,4]}}]}),target=source.buildings[0];assert.ok(target);
 const water={id:'approach-water',sourceActor:'fixture-ground',sourceGroundPoint:[10,0,1.5]as const,capsuleBottomPoint:[10,0,1.5]as const,standingOnly:true as const},stand={...water,id:'approach-fire',sourceGroundPoint:[3,0,1.5]as const,capsuleBottomPoint:[3,0,1.5]as const};
 const site=freeze({...f.input.site,anchors:[...f.input.site.anchors,water,stand],residentPlaceBindings:[...f.input.site.residentPlaceBindings,{residentId:brewer.id,placeId:'source-water-approach',anchorId:water.id,status:'mapped-exterior' as const},{residentId:brewer.id,placeId:'source-fire-approach',anchorId:stand.id,status:'mapped-exterior' as const}],routes:[{id:'certified-exterior-approach',from:water.id,to:stand.id,reversible:true,sourceGroundPolyline:[water.sourceGroundPoint,stand.sourceGroundPoint],capsuleBottomPolyline:[water.capsuleBottomPoint,stand.capsuleBottomPoint],lengthMetres:7}]});
 const fire=stepBuildingConflagration(createBuildingConflagration({worldKey:world,absoluteMinute:0,seed:world,buildings:source.buildings}),{absoluteMinute:0,damageOutcome:{...f.outcome,binding:target.binding}}).state,saved={...f.saved,buildingFire:{status:'valid' as const,state:fire}};
 const frame=createBuildingDisasterFrame(saved,{...f.input,buildings:source.buildings,site,associations:[]})!;assert.equal(frame.obstacles.length,3);assert.ok(frame.obstacles.every(o=>o.kind==='fire'));assert.ok(frame.obstacles.some(o=>o.bounds.min[1]===5));
 const initial={residentId:brewer.id,targetPlaceId:'source-water-approach',activityKey:'work',activity:'Source water approach.',priority:90,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'safety'};
 const placed=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[initial]});
 const intent={...initial,targetPlaceId:'source-fire-approach'};
 const aggregate=advanceVillageLifeNavigation(placed,{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[intent],dynamicObstacles:[{...frame.obstacles[0],bounds:target.bounds}]});assert.equal(aggregate.residents[0].reason,'dynamic-obstacle');
 const admitted=advanceVillageLifeNavigation(placed,{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[intent],dynamicObstacles:frame.obstacles});assert.equal(admitted.residents[0].status,'travelling');
 const arrived=advanceVillageLifeNavigation(admitted,{absoluteMinute:7,site,metresPerWorldMinute:1,intents:[intent],dynamicObstacles:frame.obstacles});assert.equal(arrived.residents[0].arrivalEvidence,'certified-route-arrival');assert.equal(arrived.residents[0].anchorPlaceId,'source-fire-approach');
 const unsafe={...intent,targetPlaceId:brewer.homePlaceId};const noEntry=advanceVillageLifeNavigation(arrived,{absoluteMinute:7,site,metresPerWorldMinute:1,intents:[unsafe],dynamicObstacles:frame.obstacles});assert.notEqual(noEntry.residents[0].status,'travelling','No new path through the burning structure is manufactured.');
});

test('long Unicode source actor IDs keep their identity while fire and debris IDs satisfy bounded navigation contracts',()=>{
 const f=fixture(),parts=building.parts.map((p,i)=>({...p,id:'çatı-梁-'.repeat(80)+i})),source=[{...building,parts}],fire=f.saved.buildingFire!.state!,saved={...f.saved,buildingFire:{status:'valid' as const,state:{...fire,buildings:fire.buildings.map(r=>({...r,collapsedAtMinute:0}))}}};
 const frame=createBuildingDisasterFrame(saved,{...f.input,absoluteMinute:1,buildings:source})!;assert.ok(frame.obstacles.length>=6);assert.ok(frame.obstacles.every(o=>/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/u.test(o.id)));assert.equal(new Set(frame.obstacles.map(o=>o.id)).size,frame.obstacles.length);
 assert.doesNotThrow(()=>advanceVillageLifeNavigation(createVillageLifeNavigation(1),{absoluteMinute:1,site:f.input.site,metresPerWorldMinute:1,intents:[],dynamicObstacles:frame.obstacles}));assert.equal(source[0].parts[0].id,parts[0].id);
});


test('a clear exterior approach is held when a falling wall sweeps through it before the next causal minute',()=>{
 const f=fixture(),fire=f.saved.buildingFire!.state!,saved={...f.saved,buildingFire:{status:'valid' as const,state:{...fire,buildings:fire.buildings.map(r=>({...r,collapsedAtMinute:0}))}}};
 const swept=projectBuildingDisasterObstacles(saved,f.input),r=f.input.site.capsule.radius,h=f.input.site.capsule.height;
 const hit=(p:readonly number[],b:{min:readonly number[];max:readonly number[]})=>p[0]+r>=b.min[0]&&p[0]-r<=b.max[0]&&p[2]+r>=b.min[2]&&p[2]-r<=b.max[2]&&p[1]+h>=b.min[1]&&p[1]<=b.max[1];
 let point:readonly[number,number,number]|null=null,axis:0|2=0,sign=1;
 for(const a of[0,2]as const)for(const d of[-1,1])for(let along=-4;along<7&&!point;along+=.1)for(let beyond=.02;beyond<2&&!point;beyond+=.05){
  const values=[0,0,0];values[a]=(d>0?building.bounds.max[a]+r:building.bounds.min[a]-r)+d*beyond;values[a===0?2:0]=along;
  if(!hit(values,building.bounds)&&swept.some(o=>hit(values,o.bounds))){point=values as[number,number,number];axis=a;sign=d;}
 }
 assert.ok(point,'Falling fixture wall must reach an originally clear exterior approach.');
 const goal=point!,start=[...goal]as[number,number,number];start[axis]+=sign*3;
 const site=freeze({...f.input.site,anchors:[{id:'outside',sourceActor:'fixture-ground',sourceGroundPoint:start,capsuleBottomPoint:start,standingOnly:true as const},{id:'approach',sourceActor:'fixture-ground',sourceGroundPoint:goal,capsuleBottomPoint:goal,standingOnly:true as const}],routes:[{id:'authored-exterior-leg',from:'outside',to:'approach',reversible:true,sourceGroundPolyline:[start,goal],capsuleBottomPolyline:[start,goal],lengthMetres:3}],placeBindings:[],residentPlaceBindings:[{residentId:brewer.id,placeId:'outside',anchorId:'outside',status:'mapped-exterior' as const},{residentId:brewer.id,placeId:'approach',anchorId:'approach',status:'mapped-exterior' as const}]});
 const idle={residentId:brewer.id,targetPlaceId:'outside',activityKey:'work',activity:'Approach.',priority:90,issuedAbsoluteMinute:0,indoor:false,companionIds:[],reason:'safety'},placed=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[idle]}),intent={...idle,targetPlaceId:'approach'};
 const current=createBuildingCollapse({buildings:catalogue.buildings,groundHeight:()=>0,secondsPerWorldMinute:()=>4});current.update([{binding:building.binding,condition:'burned',rebuild:null,collapseAtMinute:0}],0);
 const oldObstacles=current.navigationObstacles().map(c=>({id:'old-'+c.sourcePartId,profile:c.binding.profile,sourceSha256:c.binding.sourceSha256,activeFromAbsoluteMinute:0,bounds:c.bounds}));
 assert.equal(advanceVillageLifeNavigation(placed,{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[intent],dynamicObstacles:oldObstacles}).residents[0].status,'travelling');
 const safe=advanceVillageLifeNavigation(placed,{absoluteMinute:0,site,metresPerWorldMinute:1,intents:[intent],dynamicObstacles:swept});assert.equal(safe.residents[0].reason,'dynamic-obstacle');assert.notEqual(safe.residents[0].status,'travelling');
});


test('actual structural damage withdraws close fire stations before the existing collapse threshold without inventing debris',()=>{
 const f=fixture(),stations=[station(f,'water'),station(f,'fire')],fire=f.saved.buildingFire!.state!;
 const savedAt=(damage:number):ObserverSave=>({...f.saved,buildingFire:{status:'valid',state:{...fire,buildings:fire.buildings.map(b=>({...b,structuralDamage:damage,collapsedAtMinute:null}))}}});
 const before=savedAt(BUILDING_CLOSE_WORK_RETREAT_DAMAGE-1),unsafe=savedAt(BUILDING_CLOSE_WORK_RETREAT_DAMAGE),bytes=JSON.stringify(unsafe);
 assert.equal(BUILDING_CLOSE_WORK_RETREAT_DAMAGE,574,'Existing collapse700 minus three maximum42-damage completed minutes supplies explicit warning headroom.');
 assert.equal(buildingDisasterIncidents(before,0)[0].unsafeForCloseWork,false);
 assert.equal(buildingDisasterIncidents(unsafe,0)[0].unsafeForCloseWork,true);
 assert.deepEqual(createBuildingDisasterFrame(before,{...f.input,stations})!.stations.map(s=>s.kind),['water','fire']);
 const warned=createBuildingDisasterFrame(unsafe,{...f.input,stations})!;assert.deepEqual(warned.stations.map(s=>s.kind),['water']);
 assert.equal(warned.obstacles.some(o=>o.id.startsWith('building-debris:')),false,'A risk warning does not collapse geometry early or alter actual obstacles.');
 assert.equal(JSON.stringify(unsafe),bytes,'Read-only warning derivation cannot change saved damage, fuel, collapse or receipts.');
});
