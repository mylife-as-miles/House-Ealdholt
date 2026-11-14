import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population,type PopulationResident} from './village-population';
import type {VillageLifeIntent} from './village-life';
import type {VillageSiteLayout,VillageSitePoint} from './village-site';
import {advanceVillageLifeNavigation,createVillageLifeNavigation,parseVillageLifeNavigation,sampleVillageLifeNavigation,type VillageLifeNavigationState,type VillageLifeNavigationObstacle} from './village-life-navigation';
import {advanceResidentBuildingEmergency,createResidentBuildingEmergency,parseResidentBuildingEmergency,residentBuildingEmergencyIntents,residentBuildingPlaceBinding,acknowledgeResidentBuildingEmergency,qualifiedResidentBuildingStation,residentBuildingEmergencySafetySignals,type ResidentBuildingEmergencyFrame,type ResidentBuildingEmergencyStation,type ResidentBuildingEmergencyState} from './resident-building-emergency';
import {buildingDamageKey} from '../observer/building-damage';
import type {SourceBuilding} from '../observer/building-damage-catalogue';
import {resolvePopulationPresentation} from './village-activity-presentation';
import {createVillagePopulationRuntime,createVillagePopulationObserver,captureVillagePopulationEmergencyCheckpoint,sampleVillagePopulationRuntime,serializeVillagePopulationRuntime,advanceVillagePopulationEmergencyCheckpoint,advanceVillagePopulationRuntime,parseVillagePopulationEmergencyCheckpoint,restoreVillagePopulationEmergencyCheckpoint,serializeVillagePopulationEmergencyCheckpointRestore,reportVillagePopulationSafetySignals} from './village-population-runtime';
const sha='a'.repeat(64),worldKey='emergency-fixture';
const brewer=population.residents.find(r=>r.id==='ealdholt-brewster')!,mason=population.residents.find(r=>r.id==='ealdholt-master-mason')!,child=population.residents.find(r=>r.id==='ealdholt-reeve-daughter')!;
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
const building=freeze({binding:{catalogueId:'fixture',sourceSha256:sha,profile:'desktop',buildingId:'door:original-door:3',siteIndex:0},bounds:{min:[5,0,-1],max:[9,4,1]},position:[7,0,0],outward:[1,0,0],bearing:'east',parts:[{id:'original-door:3',kind:'door',sourceActor:'original-door',sourceOrdinal:3,bounds:{min:[5,0,-1],max:[5,2,1]}},{id:'original-wall:4',kind:'wall',sourceActor:'original-wall',sourceOrdinal:4,bounds:{min:[8,0,0],max:[8,3,1]}}]}) as SourceBuilding;
function siteFor(person:PopulationResident):VillageSiteLayout{
 const pts:Record<string,VillageSitePoint>={[person.homePlaceId]:[0,0,0],[person.workPlaceId]:[0,0,-3],water:[3,0,0],fire:[6,0,0],repair:[8,0,0],shelter:[0,0,6]};
 const edges=[[person.homePlaceId,'water'],['water','fire'],['fire','repair'],[person.homePlaceId,'shelter'],[person.homePlaceId,person.workPlaceId]];
 return freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:Object.entries(pts).map(([id,p])=>({id,sourceActor:'original-terrain',sourceGroundPoint:p,capsuleBottomPoint:p,standingOnly:true})),routes:edges.map(([from,to],i)=>({id:`edge-${i}`,from,to,reversible:true,sourceGroundPolyline:[pts[from],pts[to]],capsuleBottomPolyline:[pts[from],pts[to]],lengthMetres:Math.hypot(...pts[to].map((n,k)=>n-pts[from][k]))})),placeBindings:Object.keys(pts).map(placeId=>({placeId,anchorId:placeId,status:'mapped-exterior'})),residentPlaceBindings:Object.keys(pts).map(placeId=>({residentId:person.id,placeId,anchorId:placeId,status:'mapped-exterior'}))}) as VillageSiteLayout;
}
const routine=(p:PopulationResident):VillageLifeIntent=>({residentId:p.id,targetPlaceId:p.homePlaceId,activityKey:'home',activity:'Routine at home.',priority:1,issuedAbsoluteMinute:0,indoor:true,companionIds:[],reason:'routine'});
function fixture(person=brewer,options:{burning?:boolean;affected?:boolean;known?:boolean;homeAssociation?:boolean}={}){
 const site=siteFor(person),incident={id:'fixture-fire',binding:building.binding,burning:options.burning??true,requiresRepair:true,observedAbsoluteMinute:0,expiresAbsoluteMinute:1000,knownByResidentIds:options.known===false?[]:[person.id],affectedResidentIds:options.affected?[person.id]:[]};
 const station=(kind:'water'|'fire'|'repair'):ResidentBuildingEmergencyStation=>({id:`station-${kind}`,disasterId:incident.id,residentId:person.id,placeId:kind,anchorId:kind,kind,buildingKey:kind==='water'?null:buildingDamageKey(building.binding),sourceActor:'original-terrain',contactPoint:kind==='water'?[3,1,0]:kind==='fire'?[6,1,0]:[8,1,0],yawRadians:Math.PI/2,clip:kind==='repair'?'work_chisel':'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:`desktop:${sha}:source-site`,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:kind==='water'?'original-well':'original-wall',maximumContactDistanceMetres:2,clip:kind==='repair'?'work_chisel':'carry_bucket_walk'}});
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:`desktop:${sha}:source-site`,repairOrders:[{id:'repair-order',incidentId:incident.id,binding:building.binding,orderedAtMinute:0,workerIds:[person.id],reservedTimber:12,deliveredTimber:0,completedAtMinute:null}],buildings:[building],incidents:[incident],stations:[station('water'),station('fire'),station('repair')],shelterPlaceIds:['shelter'],obstacles:[],associations:options.homeAssociation?[{residentId:person.id,placeId:person.homePlaceId,anchorId:person.homePlaceId,binding:building.binding,sourceDoorActor:'original-door',sourceDoorOrdinal:3}]:[]};
 let navigation=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[routine(person)],metresPerWorldMinute:1});
 let emergency=createResidentBuildingEmergency(worldKey,0);
 function tick(now:number,nextFrame:ResidentBuildingEmergencyFrame|null=frame){
  navigation=advanceVillageLifeNavigation(navigation,{absoluteMinute:now,site,intents:residentBuildingEmergencyIntents(emergency,[routine(person)]),metresPerWorldMinute:1,dynamicObstacles:nextFrame?.obstacles});
  emergency=advanceResidentBuildingEmergency(emergency,{absoluteMinute:now,worldKey,residents:[person],routineIntents:[routine(person)],navigation,site,frame:nextFrame});
  navigation=advanceVillageLifeNavigation(navigation,{absoluteMinute:now,site,intents:residentBuildingEmergencyIntents(emergency,[routine(person)]),metresPerWorldMinute:1,dynamicObstacles:nextFrame?.obstacles});
  return emergency;
 }
 return{person,site,frame,tick,get navigation(){return navigation;},get emergency(){return emergency;},reload(){navigation=parseVillageLifeNavigation(JSON.stringify(navigation));emergency=parseResidentBuildingEmergency(JSON.stringify(emergency));},replaceNavigation(n:VillageLifeNavigationState){navigation=n;}};
}

test('exact verified door association evacuates a burning household through its existing graph and shelters children',()=>{
 const f=fixture(child,{homeAssociation:true});assert.equal(residentBuildingPlaceBinding(f.site,[building],child.id,child.homePlaceId),null,'terrain support actor is never guessed to be a door');
 assert.equal(residentBuildingPlaceBinding(f.site,[building],child.id,child.homePlaceId,f.frame.associations),building);
 const wrong={...f.frame.associations![0],sourceDoorOrdinal:99};assert.equal(residentBuildingPlaceBinding(f.site,[building],child.id,child.homePlaceId,[wrong]),null);
 f.tick(0);assert.equal(f.emergency.duties[0].kind,'evacuate');assert.equal(f.navigation.residents[0].status,'travelling');
 assert.deepEqual(sampleVillageLifeNavigation(f.navigation,f.site)[0].position,[0,0,0]);
 f.tick(2);assert.deepEqual(sampleVillageLifeNavigation(f.navigation,f.site)[0].position,[0,0,2]);f.reload();
 for(let i=3;i<=6;i++)f.tick(i);assert.equal(f.emergency.duties[0].phase,'sheltered');assert.equal(f.navigation.residents[0].status,'at-threshold');assert.equal(f.navigation.residents[0].inside,false);assert.deepEqual(sampleVillageLifeNavigation(f.navigation,f.site)[0].position,[0,0,6]);assert.equal(f.emergency.waterDeliveries.length,0);assert.equal(f.emergency.repairProgress.length,0);
 assert.equal(f.emergency.duties[0].interruptedIntent.activity,'Routine at home.');
 const resolved={...f.frame,incidents:[]};f.tick(7,resolved);assert.equal(f.emergency.duties.length,0);assert.equal(f.navigation.residents[0].targetPlaceId,child.homePlaceId);assert.equal(f.navigation.residents[0].status,'travelling');
});

test('residents receive no omniscient fire knowledge and children never become fire or repair workers',()=>{
 const unknown=fixture(brewer,{known:false});unknown.tick(0);assert.equal(unknown.emergency.duties.length,0);
 for(const burning of [true,false]){const c=fixture(child,{burning});c.tick(0);assert.equal(c.emergency.duties.length,0);}
 const apprentice=fixture(population.residents.find(r=>r.id==='ealdholt-mason-apprentice')!,{burning:false});apprentice.tick(0);assert.equal(apprentice.emergency.duties.length,0);
});

test('water requires actual well arrival, timed contact, carried journey and separate target contact before suppression',()=>{
 const f=fixture();f.tick(0);assert.equal(f.emergency.duties[0].phase,'to-water');
 for(let i=1;i<=3;i++)f.tick(i);assert.equal(f.emergency.duties[0].phase,'drawing-water');assert.equal(f.emergency.duties[0].waterUnits,0);assert.equal(f.navigation.residents[0].arrivalEvidence,'certified-route-arrival');
 f.reload();f.tick(4);assert.equal(f.emergency.duties[0].phase,'to-fire');assert.equal(f.emergency.duties[0].waterUnits,20);assert.equal(f.emergency.waterDeliveries.length,0);
 for(let i=5;i<=7;i++)f.tick(i);assert.equal(f.emergency.duties[0].phase,'delivering-water');assert.equal(f.emergency.waterDeliveries.length,0);
 f.reload();f.tick(8);assert.equal(f.emergency.waterDeliveries.length,1);assert.equal(f.emergency.waterDeliveries[0].water,20);assert.equal(f.emergency.waterDeliveries[0].atMinute,8);assert.equal(f.emergency.waterDeliveries[0].proof.operationId,'station-fire:0');assert.equal(f.emergency.duties[0].waterUnits,0);
 f.tick(8);assert.equal(f.emergency.waterDeliveries.length,1,'same clock cannot buy another operation');
 const loaded=parseResidentBuildingEmergency(JSON.stringify(f.emergency));assert.deepEqual(loaded,f.emergency);
 const ack=acknowledgeResidentBuildingEmergency(loaded,[loaded.waterDeliveries[0].id]);assert.equal(ack.waterDeliveries.length,0);assert.equal(ack.nextSequence,1);
});

test('initial placement, interrupted source contact and an invalid contact certificate never earn water',()=>{
 const f=fixture();f.tick(0);
 const stationary=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site:f.site,intents:residentBuildingEmergencyIntents(f.emergency,[routine(brewer)]),metresPerWorldMinute:1});
 f.replaceNavigation(stationary);for(let i=1;i<=3;i++)f.tick(i);assert.equal(f.emergency.duties[0].waterUnits,0,'initial well label cannot fill a bucket');assert.equal(f.emergency.waterDeliveries.length,0);
 const invalid=fixture();invalid.tick(0);for(let i=1;i<=3;i++)invalid.tick(i);const frame={...invalid.frame,stations:invalid.frame.stations.map(s=>({...s,proof:{...s.proof,sweptClipAndPropsClear:false as true}}))};
 invalid.tick(4,frame);assert.equal(invalid.emergency.duties[0].waterUnits,0);assert.equal(invalid.emergency.duties[0].reason,'emergency-contact-unqualified');
 invalid.tick(5,null);invalid.reload();invalid.tick(6);assert.equal(invalid.emergency.duties[0].waterUnits,0,'held source minutes cannot count as action');invalid.tick(7);assert.equal(invalid.emergency.duties[0].waterUnits,20);
});

test('adult repair labour accrues only after a certified station arrival and action duration, never en route or during fire',()=>{
 const f=fixture(mason,{burning:false});f.tick(0);assert.equal(f.emergency.duties[0].phase,'to-repair');
 for(let i=1;i<=8;i++){f.tick(i);assert.equal(f.emergency.repairProgress.length,0);}assert.equal(f.emergency.duties[0].phase,'repairing');
 f.tick(9);assert.equal(f.emergency.repairProgress[0].labourMinutes,1);assert.equal(f.emergency.repairProgress[0].timber,12);f.reload();f.tick(10);assert.equal(f.emergency.repairProgress.length,2);assert.notEqual(f.emergency.repairProgress[0].proof.operationId,f.emergency.repairProgress[1].proof.operationId);
 const flames={...f.frame,incidents:f.frame.incidents.map(i=>({...i,burning:true}))};f.tick(11,flames);assert.equal(f.emergency.repairProgress.length,2);assert.equal(f.emergency.duties.length,0,'unqualified firefighter resumes safety/routine instead of using a chisel as suppression');
});

test('published carry pose and repair action use the authoritative world clock; missing arrival or role art stays held',()=>{
 const state:any={residentId:brewer.id,tier:'persistent',activity:'Delivers water to the house fire.',roleClip:null,availableRoleClips:brewer.appearance.motion.roleClips,scheduledPlaceId:'fire',placeId:'fire',fromPlaceId:'water',slotIndex:0,slotStartMinute:0,slotEndMinute:1440,status:'at-place',reason:null,position:[6,0,0],yawRadians:0,moving:false,presentable:true,navigationStatus:'at-threshold',navigationReason:null,arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:7,lifeIntent:{...routine(brewer),targetPlaceId:'fire',activity:'Delivers water to the house fire.',activityKey:'work',reason:'safety',indoor:false},emergency:{incidentId:'fire',phase:'delivering-water',stationId:'fire',clip:'carry_bucket_walk',contactPoint:[6,1,0],contactSourceActor:'original-wall',yawRadians:0,actionStartedAbsoluteMinute:7,actionElapsedSeconds:1,waterUnits:20,qualified:true}};
 const p=resolvePopulationPresentation(state);assert.equal(p.presentable,true);assert.equal(p.activity.roleClip,'carry_bucket_walk');assert.equal(p.animationTimeSeconds,0);assert.equal(p.animationTimeMode,'seek');
 assert.equal(resolvePopulationPresentation({...state,arrivalEvidence:'initial-placement'}).presentable,false);
 assert.equal(resolvePopulationPresentation({...state,availableRoleClips:[]}).presentable,false);
 const repaired={...state,residentId:mason.id,availableRoleClips:mason.appearance.motion.roleClips,lifeIntent:{...state.lifeIntent,residentId:mason.id},emergency:{...state.emergency,phase:'repairing',clip:'work_chisel',waterUnits:0,actionElapsedSeconds:1.75}};
 assert.equal(resolvePopulationPresentation(repaired).animationTimeSeconds,1.75);assert.equal(resolvePopulationPresentation(repaired).motion,'work');assert.equal(resolvePopulationPresentation(repaired).animationTimeMode,'advance');
});

function completeHomeSite():VillageSiteLayout{
 return freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:population.residents.map((p,i)=>({id:`home-${i}`,sourceActor:'terrain',sourceGroundPoint:[i*10,0,0],capsuleBottomPoint:[i*10,0,0],standingOnly:true})),routes:[],placeBindings:[],residentPlaceBindings:population.residents.map((p,i)=>({residentId:p.id,placeId:p.homePlaceId,anchorId:`home-${i}`,status:'mapped-exterior'}))}) as VillageSiteLayout;
}
test('disaster observer checkpoint preserves physical navigation and duty clock through reload without replacing canonical saves',()=>{
 const created=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'fixture',createdAt:1000,initialDayMinute:400,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:1});assert.equal(created.ok,true);if(!created.ok)return;
 const canonical=created.snapshot,before=serializeVillagePopulationRuntime(canonical),site=completeHomeSite(),frame:ResidentBuildingEmergencyFrame={siteIdentity:`desktop:${sha}:source-site`,buildings:[],incidents:[],stations:[],shelterPlaceIds:[],obstacles:[]};
 const observer=createVillagePopulationObserver(),observed=observer.observe(canonical,2000,{site,buildingEmergencyAt:()=>frame}),checkpoint=captureVillagePopulationEmergencyCheckpoint(observed);assert.ok(checkpoint);assert.equal(checkpoint.clock.simulatedElapsedMilliseconds,2000);assert.equal(checkpoint.buildingEmergency.absoluteMinute,402);assert.equal(sampleVillagePopulationRuntime(observed,site).buildingEmergency?.absoluteMinute,402);
 assert.equal(serializeVillagePopulationRuntime(observed).ok,false,'read-only observation cannot replace canonical saves');assert.deepEqual(serializeVillagePopulationRuntime(canonical),before);
 const loaded=JSON.parse(JSON.stringify(checkpoint)),restored=createVillagePopulationObserver().observe(canonical,2000,{site,buildingEmergencyAt:()=>frame,emergencyCheckpoint:loaded});assert.deepEqual(restored.navigation,observed.navigation);assert.deepEqual(restored.buildingEmergency,observed.buildingEmergency);
 assert.throws(()=>createVillagePopulationObserver().observe(canonical,1000,{site,buildingEmergencyAt:()=>frame,emergencyCheckpoint:loaded}),/rewind|clock/);
 assert.throws(()=>createVillagePopulationObserver().observe(canonical,2000,{site,emergencyCheckpoint:{...loaded,worldKey:'foreign'}}),/canonical branch|checkpoint world/);
 const historyObserver=createVillagePopulationObserver();historyObserver.observe(canonical,2000,{site,buildingEmergencyAt:()=>frame,emergencyCheckpoint:loaded});const history=historyObserver.observe(canonical,0,{site});assert.equal(history.buildingEmergency,undefined,'a checkpoint is never rewound to manufacture history');
});

test('strict disaster save validation rejects hostile getters, contradictory phases and replayed sequence data without mutation',()=>{
 const f=fixture();for(let i=0;i<=8;i++)f.tick(i);const saved=JSON.stringify(f.emergency),copy=JSON.parse(saved);let calls=0;
 const hostile=Object.defineProperty({},'kind',{enumerable:true,get(){calls++;return'resident-building-emergency';}});assert.throws(()=>parseResidentBuildingEmergency(hostile));assert.equal(calls,0);
 copy.duties[0].waterUnits=10;assert.throws(()=>parseResidentBuildingEmergency(copy),/phase/);
 const replay=JSON.parse(saved);replay.nextSequence=0;assert.throws(()=>parseResidentBuildingEmergency(replay),/receipt/);
 const future=JSON.parse(saved);future.duties[0].actionStartedAbsoluteMinute=100;assert.throws(()=>parseResidentBuildingEmergency(future),/clock|arrival|phase/);
 assert.equal(JSON.stringify(f.emergency),saved);assert.throws(()=>advanceResidentBuildingEmergency(f.emergency,{absoluteMinute:7,worldKey,residents:[brewer],routineIntents:[routine(brewer)],navigation:f.navigation,site:f.site,frame:f.frame}),/clock/);
});


test('repair orders reserve real material; qualification, acknowledgements and reload cannot duplicate a timber delivery',()=>{
 const missing=fixture(mason,{burning:false});missing.tick(0,{...missing.frame,repairOrders:[]});assert.equal(missing.emergency.duties.length,0);
 const wrong=fixture(mason,{burning:false});wrong.tick(0,{...wrong.frame,repairOrders:wrong.frame.repairOrders!.map(o=>({...o,workerIds:[brewer.id]}))});assert.equal(wrong.emergency.duties.length,0);
 const f=fixture(mason,{burning:false});for(let i=0;i<=9;i++)f.tick(i);assert.equal(f.emergency.repairProgress[0].timber,12);assert.deepEqual(f.emergency.materialOrderIds,['repair-order']);
 const ack=acknowledgeResidentBuildingEmergency(f.emergency,f.emergency.repairProgress.map(r=>r.id));assert.equal(ack.repairProgress.length,0);assert.deepEqual(parseResidentBuildingEmergency(JSON.stringify(ack)).materialOrderIds,['repair-order']);
 f.reload();for(let i=10;i<=12;i++)f.tick(i);assert.equal(f.emergency.repairProgress.reduce((n,r)=>n+r.timber,0),12);assert.deepEqual(f.emergency.repairProgress.map(r=>r.labourMinutes),[1,1,1,1]);
});

test('a published repair workpiece needs the exact asset pin, clip and current verified source-site identity',()=>{
 const f=fixture(mason,{burning:false}),station=f.frame.stations.find(s=>s.kind==='repair')!,incident=f.frame.incidents[0];
 const piece={...station,proof:{...station.proof,contactKind:'published-workpiece' as const,contactSourceActor:'prop_stone_block',equipmentAssetPath:'crowd-v1/props/crowd-props-workplace-v1.glb',equipmentSha256:'e0fba22ea8442981124d53973427a37849c638d015c2de16288c53fcad394548'}};
 assert.equal(qualifiedResidentBuildingStation(piece,f.site,incident,f.frame,0),true);
 assert.equal(qualifiedResidentBuildingStation({...piece,proof:{...piece.proof,equipmentSha256:sha}},f.site,incident,f.frame,0),false);
 assert.equal(qualifiedResidentBuildingStation({...piece,clip:'work_hammer_bench'},f.site,incident,f.frame,0),false);
 assert.equal(qualifiedResidentBuildingStation(piece,f.site,incident,{...f.frame,siteIdentity:'foreign-source-site'},0),false);
});

test('a damaged home remains unavailable after the flame; an adult can respond only after reaching safety and dependants stay sheltered',()=>{
 const f=fixture(mason,{burning:false,homeAssociation:true});for(let i=0;i<=6;i++)f.tick(i);assert.equal(f.emergency.duties[0].phase,'sheltered');assert.equal(f.emergency.repairProgress.length,0);
 f.tick(7);assert.equal(f.emergency.duties[0].kind,'repair');assert.equal(f.navigation.residents[0].status,'travelling');assert.deepEqual(sampleVillageLifeNavigation(f.navigation,f.site)[0].position,[0,0,6]);
 const c=fixture(child,{burning:false,homeAssociation:true});for(let i=0;i<=8;i++)c.tick(i);assert.equal(c.emergency.duties[0].phase,'sheltered');assert.equal(c.emergency.repairProgress.length,0);
});

test('renewable disaster reports have minutely knowledge leases and disappear instead of holding life counters forever',()=>{
 const f=fixture(child,{homeAssociation:true});const input={worldKey,residents:[child],routineIntents:[routine(child)],navigation:f.navigation,site:f.site,frame:f.frame};
 const a=residentBuildingEmergencySafetySignals({...input,absoluteMinute:1})[0],b=residentBuildingEmergencySafetySignals({...input,absoluteMinute:2})[0];
 assert.notEqual(a.id,b.id);assert.equal(a.observedAbsoluteMinute,1);assert.equal(a.expiresAbsoluteMinute,3);assert.equal(b.expiresAbsoluteMinute,4);
 assert.deepEqual(residentBuildingEmergencySafetySignals({...input,absoluteMinute:3,frame:{...f.frame,incidents:[]}}),[]);
});

function completeRuntime(){
 const made=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'checkpoint-fixture',createdAt:1000,initialDayMinute:400,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:1});assert.equal(made.ok,true);if(!made.ok)throw Error(made.error);
 const site=completeHomeSite(),bound=advanceVillagePopulationRuntime(made.snapshot,{expectedGeneration:made.snapshot.generation,worldKey,contentRevision:made.snapshot.contentRevision,observedAt:1000,maxAdvanceMinutes:1,site});assert.equal(bound.ok,true);if(!bound.ok)throw Error(bound.error);
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:'verified-source-site',buildings:[],incidents:[],stations:[],shelterPlaceIds:[],obstacles:[]};return{canonical:bound.snapshot,site,frame};
}

test('pure disaster steps preserve physical state across natural canonical advancement and hold explicit changed facts',()=>{
 const {canonical,site,frame}=completeRuntime(),before=JSON.stringify(canonical);
 const seed=advanceVillagePopulationEmergencyCheckpoint(canonical,null,0,{site,frame}),a=advanceVillagePopulationEmergencyCheckpoint(canonical,seed.checkpoint,1000,{site,frame});
 assert.deepEqual(advanceVillagePopulationEmergencyCheckpoint(canonical,seed.checkpoint,1000,{site,frame}),a,'the same immutable inputs produce the same projection');
 assert.equal(a.checkpoint.buildingEmergency.absoluteMinute,401);assert.equal(a.sample.buildingEmergency?.absoluteMinute,401);assert.equal(JSON.stringify(canonical),before);assert.equal(serializeVillagePopulationRuntime(a.snapshot).ok,false);
 assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(canonical,a.checkpoint,3000,{site,frame}),/one monotonic/);
 const grown=advanceVillagePopulationRuntime(canonical,{expectedGeneration:canonical.generation,worldKey,contentRevision:canonical.contentRevision,observedAt:4000,maxAdvanceMinutes:3,site});assert.equal(grown.ok,true);if(!grown.ok)return;
 const b=advanceVillagePopulationEmergencyCheckpoint(grown.snapshot,a.checkpoint,2000,{site,frame});assert.equal(b.checkpoint.buildingEmergency.absoluteMinute,402);assert.deepEqual(b.snapshot.navigation,advanceVillagePopulationEmergencyCheckpoint(canonical,a.checkpoint,2000,{site,frame}).snapshot.navigation);
 const person=population.residents[0],report=reportVillagePopulationSafetySignals(grown.snapshot,{expectedGeneration:grown.snapshot.generation,worldKey,contentRevision:canonical.contentRevision,signals:[{id:'new-explicit-incident',kind:'hazard',channel:'report',knownByResidentIds:[person.id],affectedResidentIds:[person.id],placeId:person.homePlaceId,observedAbsoluteMinute:403,expiresAbsoluteMinute:405}]});assert.equal(report.ok,true);if(report.ok)assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(report.snapshot,b.checkpoint,3000,{site,frame}),/explicit facts|safety facts/);
});

test('adoption starts at an actual observed physical cursor and strict checkpoint restoration preserves unknown saves',()=>{
 const {canonical,site,frame}=completeRuntime(),observer=createVillagePopulationObserver(),observed=observer.observe(canonical,1500,{site});
 const currentObserved=createVillagePopulationObserver().observe(canonical,0,{site,preferCanonical:true});assert.doesNotThrow(()=>advanceVillagePopulationEmergencyCheckpoint(canonical,null,0,{site,frame,initialObserved:currentObserved}));
 const seed=advanceVillagePopulationEmergencyCheckpoint(canonical,null,1500,{site,frame,initialObserved:observed});assert.deepEqual(seed.snapshot.navigation,observed.navigation);assert.equal(seed.checkpoint.buildingEmergency.absoluteMinute,401.5);
 const round=parseVillagePopulationEmergencyCheckpoint(JSON.stringify(seed.checkpoint),worldKey);assert.deepEqual(round,seed.checkpoint);assert.equal(restoreVillagePopulationEmergencyCheckpoint(round,worldKey).status,'valid');
 assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(canonical,null,1500,{site,frame,initialObserved:canonical}),/actual matching/);
 const future={...JSON.parse(JSON.stringify(round)),schemaVersion:99,newField:{keep:'original'}};const unknown=restoreVillagePopulationEmergencyCheckpoint(future,worldKey);assert.equal(unknown.status,'invalid');assert.deepEqual(serializeVillagePopulationEmergencyCheckpointRestore(unknown),future);
 const changed=JSON.parse(JSON.stringify(round));changed.navigation.absoluteMinute++;assert.equal(restoreVillagePopulationEmergencyCheckpoint(changed,worldKey).status,'invalid');
});

test('evacuees retain real exterior refuge occupancy; a second child uses a certified alternative and capacity cannot become an invented room',()=>{
 const other=population.residents.find(p=>p.ageYears<18&&p.id!==child.id&&p.homePlaceId!==child.homePlaceId)!,people=[child,other];
 function run(secondStand:boolean){
  const points:Record<string,VillageSitePoint>={[child.homePlaceId]:[0,0,0],[other.homePlaceId]:[-4,0,0],shelter:[0,0,6],'shelter-b':[4,0,6]};
  const edges=people.flatMap(p=>(secondStand?['shelter','shelter-b']:['shelter']).map(place=>[p.homePlaceId,place]));
  const site=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:Object.entries(points).map(([id,p])=>({id,sourceActor:'original-terrain',sourceGroundPoint:p,capsuleBottomPoint:p,standingOnly:true})),routes:edges.map(([from,to],i)=>({id:`evac-${i}`,from,to,reversible:true,sourceGroundPolyline:[points[from],points[to]],capsuleBottomPolyline:[points[from],points[to]],lengthMetres:Math.hypot(...points[to].map((n,k)=>n-points[from][k]))})),placeBindings:[],residentPlaceBindings:people.flatMap(p=>[p.homePlaceId,'shelter',...(secondStand?['shelter-b']:[])].map(placeId=>({residentId:p.id,placeId,anchorId:placeId,status:'mapped-exterior'})))}) as VillageSiteLayout;
  const frame:ResidentBuildingEmergencyFrame={siteIdentity:'refuge-source',buildings:[building],incidents:[{id:'refuge-fire',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:0,expiresAbsoluteMinute:1000,knownByResidentIds:people.map(p=>p.id),affectedResidentIds:people.map(p=>p.id)}],stations:[],shelterPlaceIds:secondStand?['shelter','shelter-b']:['shelter'],obstacles:[]};
  let nav=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:people.map(routine),metresPerWorldMinute:1}),emergency=createResidentBuildingEmergency(worldKey,0);
  for(let now=0;now<=30;now++){
   const intents=()=>residentBuildingEmergencyIntents(emergency,people.map(routine));nav=advanceVillageLifeNavigation(nav,{absoluteMinute:now,site,intents:intents(),metresPerWorldMinute:1});
   emergency=advanceResidentBuildingEmergency(emergency,{absoluteMinute:now,worldKey,residents:people,routineIntents:people.map(routine),navigation:nav,site,frame});
   nav=advanceVillageLifeNavigation(nav,{absoluteMinute:now,site,intents:intents(),metresPerWorldMinute:1});
   if(now===0){assert.equal(emergency.duties.filter(d=>d.phase==='evacuating').length,secondStand?2:1);assert.equal(emergency.duties.filter(d=>d.phase==='held').length,secondStand?0:1);}
  }
  const sheltered=emergency.duties.filter(d=>d.phase==='sheltered');assert.equal(sheltered.length,secondStand?2:1);
  assert.equal(new Set(sheltered.map(d=>d.targetPlaceId)).size,sheltered.length);
  for(const duty of sheltered){const row=nav.residents.find(r=>r.residentId===duty.residentId)!;assert.equal(row.inside,false);assert.equal(row.status,'at-threshold');assert.equal(row.arrivalEvidence,'certified-route-arrival');assert.ok(sampleVillageLifeNavigation(nav,site).find(r=>r.residentId===row.residentId)!.position);}
  assert.ok(residentBuildingEmergencyIntents(emergency,people.map(routine)).every(i=>i.indoor===false));
  if(!secondStand){assert.equal(emergency.duties.find(d=>d.phase==='held')?.reason,'emergency-shelter-capacity');assert.equal(emergency.waterDeliveries.length,0);assert.equal(emergency.repairProgress.length,0);}
 }
 run(true);run(false);
});

test('a reached safe exterior refuge presents a neutral body without claiming a workstation, bed or interior',()=>{
 const state:any={residentId:child.id,tier:child.fidelityTier,activity:'Waits at a safe exterior refuge.',roleClip:null,availableRoleClips:child.appearance.motion.roleClips,scheduledPlaceId:'shelter',placeId:'shelter',fromPlaceId:child.homePlaceId,slotIndex:0,slotStartMinute:0,slotEndMinute:1440,status:'at-place',reason:null,position:[0,0,6],yawRadians:0,moving:false,presentable:true,navigationStatus:'at-threshold',navigationReason:null,arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:6,lifeIntent:{...routine(child),targetPlaceId:'shelter',activity:'Waits at a safe exterior refuge.',activityKey:'shelter',reason:'safety',indoor:false},emergency:{incidentId:'fire',phase:'sheltered',stationId:null,clip:null,contactPoint:null,contactSourceActor:null,yawRadians:null,actionStartedAbsoluteMinute:null,actionElapsedSeconds:null,waterUnits:0,qualified:true}};
 assert.equal(resolvePopulationPresentation(state).presentable,true);assert.equal(resolvePopulationPresentation(state).motion,'idle');assert.equal(resolvePopulationPresentation({...state,arrivalEvidence:'initial-placement'}).presentable,false);assert.equal(resolvePopulationPresentation({...state,lifeIntent:{...state.lifeIntent,indoor:true}}).presentable,false);
});

test('unregistered source action aliases work through observation, physical duties, strict save and restore without changing registry facts',()=>{
 const made=createVillagePopulationRuntime({population,confirmedEntry:true,worldKey,contentRevision:'alias-seam',createdAt:1000,initialDayMinute:400,millisecondsPerWorldMinute:1000,walkingSpeedMetresPerSecond:1});assert.ok(made.ok);if(!made.ok)return;
 const base=completeHomeSite(),home=base.anchors[population.residents.findIndex(p=>p.id===brewer.id)],x=home.sourceGroundPoint[0];
 const waterPoint:[number,number,number]=[x+3,0,0],firePoint:[number,number,number]=[x+6,0,0];
 const original=freeze({...base,anchors:[...base.anchors,{id:'source-water-stand',sourceActor:'terrain',sourceGroundPoint:waterPoint,capsuleBottomPoint:waterPoint,standingOnly:true},{id:'source-fire-stand',sourceActor:'terrain',sourceGroundPoint:firePoint,capsuleBottomPoint:firePoint,standingOnly:true}],routes:[{id:'source-well-path',from:home.id,to:'source-water-stand',reversible:true,sourceGroundPolyline:[home.sourceGroundPoint,waterPoint],capsuleBottomPolyline:[home.capsuleBottomPoint,waterPoint],lengthMetres:3},{id:'source-fire-path',from:'source-water-stand',to:'source-fire-stand',reversible:true,sourceGroundPolyline:[waterPoint,firePoint],capsuleBottomPolyline:[waterPoint,firePoint],lengthMetres:3}]})as VillageSiteLayout;
 const bound=advanceVillagePopulationRuntime(made.snapshot,{expectedGeneration:made.snapshot.generation,worldKey,contentRevision:'alias-seam',observedAt:1000,maxAdvanceMinutes:1,site:original});assert.ok(bound.ok);if(!bound.ok)return;
 const registered=JSON.stringify(bound.snapshot.population.registry),incident={id:'source-alias-fire',binding:building.binding,burning:true,requiresRepair:true,observedAbsoluteMinute:400,expiresAbsoluteMinute:1000,knownByResidentIds:[brewer.id],affectedResidentIds:[]};
 const station=(kind:'water'|'fire'):ResidentBuildingEmergencyStation=>({id:`exact-${kind}-action`,disasterId:incident.id,residentId:brewer.id,placeId:`unregistered-${kind}-action`,anchorId:`source-${kind}-stand`,kind,buildingKey:kind==='water'?null:buildingDamageKey(building.binding),sourceActor:'terrain',contactPoint:[x+(kind==='water'?3:6),1,0],yawRadians:0,clip:'carry_bucket_walk',operationWorldMinutes:1,waterUnits:20,proof:{sourceSha256:sha,profile:'desktop',siteIdentity:'exact-source-site-artifact',originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:kind==='water'?'original-well':'original-wall',maximumContactDistanceMetres:2,clip:'carry_bucket_walk'}});
 const stations=[station('water'),station('fire')],targets=stations.map(({disasterId:_,...target})=>target);
 const site=freeze({...original,residentPlaceBindings:[...original.residentPlaceBindings,...targets.map(t=>({residentId:t.residentId,placeId:t.placeId,anchorId:t.anchorId,status:'mapped-exterior'}))],emergencyTargets:targets})as VillageSiteLayout;
 const frame:ResidentBuildingEmergencyFrame={siteIdentity:'exact-source-site-artifact',buildings:[building],incidents:[incident],stations,shelterPlaceIds:[],obstacles:[]};
 assert.ok(targets.every(t=>!population.registry.places.some(p=>p.id===t.placeId)),'the fixture must not preregister action aliases');
 assert.doesNotThrow(()=>sampleVillagePopulationRuntime(bound.snapshot,site));
 const ordinary=createVillagePopulationObserver().observe(bound.snapshot,0,{site});assert.doesNotThrow(()=>sampleVillagePopulationRuntime(ordinary,site));
 let stepped=advanceVillagePopulationEmergencyCheckpoint(bound.snapshot,null,0,{site,frame,initialObserved:ordinary});assert.equal(stepped.checkpoint.buildingEmergency.duties.find(d=>d.residentId===brewer.id)?.targetPlaceId,'unregistered-water-action');
 assert.equal(stepped.checkpoint.emergencyTargets.length,2);assert.equal(stepped.sample.residents.find(r=>r.residentId===brewer.id)?.moving,true);
 const saved=parseVillagePopulationEmergencyCheckpoint(JSON.stringify(stepped.checkpoint),worldKey);for(let n=1;n<=8;n++)stepped=advanceVillagePopulationEmergencyCheckpoint(bound.snapshot,n===1?saved:stepped.checkpoint,n*1000,{site,frame});
 assert.equal(stepped.checkpoint.buildingEmergency.waterDeliveries.length,1);assert.equal(stepped.checkpoint.buildingEmergency.waterDeliveries[0].atMinute,408);
 assert.equal(JSON.stringify(bound.snapshot.population.registry),registered);assert.equal(serializeVillagePopulationRuntime(stepped.snapshot).ok,false);
 const undeclared=freeze({...site,emergencyTargets:undefined})as VillageSiteLayout;assert.throws(()=>sampleVillagePopulationRuntime(bound.snapshot,undeclared),/unknown roster/);
 const stripped=JSON.parse(JSON.stringify(saved));delete stripped.emergencyTargets;assert.throws(()=>parseVillagePopulationEmergencyCheckpoint(stripped,worldKey),/source action target/);
 const rawSaved=JSON.stringify(saved),portableSite=freeze({...site,emergencyTargets:targets.map(t=>({...t,yawRadians:t.yawRadians+Number.EPSILON}))})as VillageSiteLayout;
 const portableFrame={...frame,stations:stations.map(t=>({...t,yawRadians:t.yawRadians+Number.EPSILON}))};
 assert.doesNotThrow(()=>advanceVillagePopulationEmergencyCheckpoint(bound.snapshot,saved,1000,{site:portableSite,frame:portableFrame}));assert.equal(JSON.stringify(saved),rawSaved,'Cross-runtime yaw comparison never rewrites the durable input.');
 const changed=freeze({...site,emergencyTargets:targets.map(t=>({...t,yawRadians:.3}))})as VillageSiteLayout;assert.throws(()=>advanceVillagePopulationEmergencyCheckpoint(bound.snapshot,saved,1000,{site:changed,frame}),/target source proof changed/);
 const badFrame={...frame,stations:stations.map(s=>({...s,waterUnits:1000}))};assert.equal(advanceVillagePopulationEmergencyCheckpoint(bound.snapshot,saved,1000,{site,frame:badFrame}).checkpoint.buildingEmergency.duties[0].reason,'emergency-contact-unqualified');
});


test('repair allocation skips the first statically reachable doorway when real swept rubble blocks its route',()=>{
 const f=fixture(mason,{burning:false}),p=[0,0,-6]as VillageSitePoint,anchor={id:'unit-safe-repair',sourceActor:'original-terrain',sourceGroundPoint:p,capsuleBottomPoint:p,standingOnly:true as const},site=freeze({...f.site,anchors:[...f.site.anchors,anchor],routes:[...f.site.routes,{id:'unit-original-safe-repair-route',from:mason.homePlaceId,to:anchor.id,reversible:true as const,sourceGroundPolyline:[[0,0,0]as VillageSitePoint,p],capsuleBottomPolyline:[[0,0,0]as VillageSitePoint,p],lengthMetres:6}],residentPlaceBindings:[...f.site.residentPlaceBindings,{residentId:mason.id,placeId:'unit-safe-repair-action',anchorId:anchor.id,status:'mapped-exterior' as const}]});
 const original=f.frame.stations.find(s=>s.kind==='repair')!,safe={...original,id:'station-safe-repair',placeId:'unit-safe-repair-action',anchorId:anchor.id,contactPoint:[0,1,-5.5]as VillageSitePoint},obstacle={id:'unit-real-collapsed-wall',sourceSha256:sha,profile:'desktop' as const,activeFromAbsoluteMinute:0,bounds:{min:[3.9,0,-.2]as VillageSitePoint,max:[4.1,2,.2]as VillageSitePoint}};
 const navigation=advanceVillageLifeNavigation(createVillageLifeNavigation(0),{absoluteMinute:0,site,intents:[routine(mason)],metresPerWorldMinute:1}),allocate=(obstacles:readonly VillageLifeNavigationObstacle[])=>advanceResidentBuildingEmergency(createResidentBuildingEmergency(worldKey,0),{absoluteMinute:0,worldKey,residents:[mason],routineIntents:[routine(mason)],navigation,site,frame:{...f.frame,stations:[original,safe],obstacles}});
 assert.equal(allocate([]).duties[0].stationId,original.id,'The initial source station remains available when its actual route is clear.');
 const selected=allocate([obstacle]);assert.equal(selected.duties[0].stationId,safe.id);assert.equal(selected.duties[0].targetPlaceId,safe.placeId);assert.equal(selected.duties[0].phase,'to-repair');assert.deepEqual(selected.repairProgress,[],'Selecting a safe route grants no arrival, labour or timber.');
 assert.equal(site.capsule.radius,.85,'No body or physical obstacle is shrunk to reach the next station.');
});
