import test from 'node:test';
import assert from 'node:assert/strict';
import {createResidentActionQueues,advanceResidentActionQueues,type ResidentActionObservation} from '../characters/resident-action-queue';
import {createVillageTimberSupply,registerVillageTimberSources,consumeCompletedTimberWork,parseVillageTimberCatalogue,parseVillageTimberSupply} from './village-timber-supply';
import {planLocalBuildingRebuilds} from './automatic-building-rebuild';
import {buildSourceBuildingCatalogue} from './building-damage-catalogue';
import {createVillageBuildingDamage,settleVillageBuildingRaid,advanceVillageBuildingDamage,buildingDamageKey} from './building-damage';
import {createBuildingConflagration,stepBuildingConflagration} from './building-conflagration';
import {buildingFireIncidentId,advanceBuildingDisasterSession} from './building-disaster-session';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave,type ObserverSave} from './observer-save';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../characters/village-population';
import type {ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';

/** Source-shaped synthetic fixtures use real production action and resource
 * reducers. They establish planning/accounting, never real-village geometry. */
const world='automatic-source-repair-unit',sha='a'.repeat(64),siteIdentity='unit-current-site',source={profile:'desktop' as const,sha256:sha,siteIdentity};
const mason=population.residents.find(r=>r.id==='ealdholt-master-mason')!,carpenter=population.residents.find(r=>r.id==='ealdholt-carpenter')!;
const buildings=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[0,80].flatMap(x=>[
 {id:'door-'+x,kind:'door' as const,bounds:{min:[x,0,0]as const,max:[x+4,2,.2]as const}},
 {id:'wall-'+x,kind:'wall' as const,bounds:{min:[x,0,3]as const,max:[x+4,2,3.2]as const}},
 {id:'roof-'+x,kind:'roof' as const,bounds:{min:[x-.2,2,-.2]as const,max:[x+4.2,2.4,3.4]as const}}])}).buildings;
function fixture(two=true,burning=false){
 const first={worldKey:world,raidId:'raid-0-0',startMinute:0,settledMinute:0,outcome:'burned' as const,binding:buildings[0].binding,targetLabel:'Synthetic source house1'},second={...first,raidId:'raid-90-1',startMinute:90,settledMinute:90,binding:buildings[1].binding,targetLabel:'Synthetic source house2'};
 let fire=stepBuildingConflagration(createBuildingConflagration({worldKey:world,absoluteMinute:0,seed:world,buildings}),{absoluteMinute:70,damageOutcome:first}).state;
 let damage=settleVillageBuildingRaid(createVillageBuildingDamage(world,0),first,70);
 if(two){fire=stepBuildingConflagration(fire,{absoluteMinute:90,damageOutcome:second}).state;damage=settleVillageBuildingRaid(damage,second,90);}
 const at=burning?90:160;if(at!==fire.absoluteMinute)fire=stepBuildingConflagration(fire,{absoluteMinute:at}).state;damage=advanceVillageBuildingDamage(damage,at);
 const saved:ObserverSave={...EMPTY_OBSERVER_SAVE,raidSerial:two?2:1,buildingFire:{status:'valid',state:fire},buildingDamage:{status:'valid',state:damage}};
 const stations:ResidentBuildingEmergencyStation[]=fire.buildings.filter(b=>b.ignition).map((b,i)=>({id:'unit-repair-'+i,disasterId:buildingFireIncidentId(b)!,residentId:(i?carpenter:mason).id,placeId:(i?carpenter:mason).workPlaceId,anchorId:'unit-repair-anchor-'+i,kind:'repair',buildingKey:buildingDamageKey(b.binding),sourceActor:'unit-source-ground',contactPoint:[i*80+6,1,0],yawRadians:0,clip:'work_chisel',operationWorldMinutes:1,waterUnits:1,proof:{sourceSha256:sha,profile:'desktop',siteIdentity,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-workpiece',maximumContactDistanceMetres:1,clip:'work_chisel'}}));
 return{saved,input:{worldKey:world,atMinute:at,siteIdentity,population,buildings,stations}};
}
function earned(units=1){
 const residentId='unit-woodcutter',baseGoal={key:'woodcut-0',activityKey:'work',activity:'Processes finite source timber.',targetPlaceId:'unit-timber-yard',issuedAbsoluteMinute:0};
 const catalogue=parseVillageTimberCatalogue({sources:[{id:'unit-raw-pile',profile:'desktop',sourceSha256:sha,siteIdentity,sourceActor:'unit-original-pile',sourceInstance:'node:1',transformSha256:'c'.repeat(64),certificateSha256:'d'.repeat(64),rawUnits:units,timberPerUnit:12}],operations:[{sourceId:'unit-raw-pile',residentId,stationId:'unit-chop',placeId:baseGoal.targetPlaceId,stationCertificateSha256:'b'.repeat(64),clip:'work_chop_wood',contactSourceActor:'unit-original-block',requiredWorldMinutes:2}]});
 let queue=createResidentActionQueues(world,0,[{residentId,goal:baseGoal}],source),stock=registerVillageTimberSources(createVillageTimberSupply(world,0),catalogue);
 for(let at=1;at<=(units===1?7:16);at++){
  const job=queue.residents[0],goal=at===8?{...baseGoal,key:'woodcut-1',issuedAbsoluteMinute:8}:job.goal,issued=job.goal.issuedAbsoluteMinute,stationId='unit-chop',leaseId='unit-lease:'+job.jobId;
  const observation:ResidentActionObservation={residentId,source,destinationMapped:true,navigationReason:null,invalidatedTarget:false,
   arrival:at>=issued+1?{id:'unit-arrival:'+issued,residentId,placeId:baseGoal.targetPlaceId,anchorId:'unit-chop-anchor',atMinute:issued+1,source,kind:'certified-route-arrival',exclusivelyOwned:true}:null,
   station:{id:stationId,residentId,placeId:baseGoal.targetPlaceId,anchorId:'unit-chop-anchor',source,clip:'work_chop_wood',certificateSha256:'b'.repeat(64),durationWorldMinutes:2,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-block'}},
   lease:at>=issued+2?{id:leaseId,residentId,jobId:job.jobId,stationId,source,sinceMinute:issued+2,untilMinute:100}:null,
   facing:at>=issued+3?{id:'unit-facing:'+issued,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:issued+3,sourcePoseQualified:true}:null,
   contacts:[{id:'unit-contact:'+at,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:at,sequence:at,clip:'work_chop_wood',markerId:'unit-authored-contact',contactSourceActor:'unit-original-block',contactQualified:true}],
   releases:[{id:'unit-release:'+at,residentId,jobId:job.jobId,stationId,leaseId,source,atMinute:at}]};
  queue=advanceResidentActionQueues(queue,{worldKey:world,absoluteMinute:at,source,residents:[{residentId,goal,interruption:null}],observations:[observation]});stock=consumeCompletedTimberWork(stock,{queues:queue,catalogue,absoluteMinute:at}).state;
 }assert.equal(stock.availableTimber,12*units);return stock;
}
function nextMinute(saved:ObserverSave,at:number):ObserverSave{if(saved.buildingFire?.status!=='valid'||saved.buildingDamage?.status!=='valid')assert.fail();return{...saved,buildingFire:{status:'valid',state:stepBuildingConflagration(saved.buildingFire.state,{absoluteMinute:at}).state},buildingDamage:{status:'valid',state:advanceVillageBuildingDamage(saved.buildingDamage.state,at)}};}

test('a fresh unfunded village holds without orders, labour or material changes',()=>{
 const{saved,input}=fixture(),stock=createVillageTimberSupply(world,input.atMinute),before=JSON.stringify(saved),result=planLocalBuildingRebuilds(saved,stock,input);
 assert.strictEqual(result.save,saved);assert.strictEqual(result.supply,stock);assert.equal(result.orders.length,0);assert.ok(result.held.every(h=>h.reason==='Needs 12 earned local timber.'));assert.equal(JSON.stringify(saved),before);
});
test('real completed wood work automatically funds one eligible local repair without a player command',()=>{
 const{saved,input}=fixture(),stock=earned(),result=planLocalBuildingRebuilds(saved,stock,input);
 if(saved.buildingFire?.status!=='valid')assert.fail();assert.equal(result.orders.length,1);assert.equal(result.orders[0].incidentId,buildingFireIncidentId(saved.buildingFire.state.buildings[0]));assert.equal(result.supply.availableTimber,0);assert.equal(result.supply.allocatedTimber,12);assert.equal(result.orders[0].deliveredTimber,0);assert.equal(result.orders[0].completedAtMinute,null);
 const later=advanceBuildingDisasterSession(result.save,{worldKey:world,absoluteMinute:180,buildings});if(later.save.buildingFire?.status!=='valid')assert.fail();assert.equal(later.save.buildingFire.state.buildings[0].repairLabour,0);
});
test('repeated polls and save reload cannot allocate twice or bypass the per-minute reservation budget',()=>{
 const{saved,input}=fixture(),first=planLocalBuildingRebuilds(saved,earned(2),input);assert.equal(first.orders.length,1);assert.equal(first.supply.availableTimber,12);
 const savedAgain=parseObserverSave(serializeObserverSave(first.save),world),stockAgain=parseVillageTimberSupply(JSON.stringify(first.supply),world),repeat=planLocalBuildingRebuilds(savedAgain,stockAgain,input);
 assert.strictEqual(repeat.save,savedAgain);assert.strictEqual(repeat.supply,stockAgain);assert.equal(repeat.orders.length,0);assert.equal(repeat.held[0].reason,'rebuild-minute-order-budget');
 const forward=planLocalBuildingRebuilds(nextMinute(savedAgain,161),stockAgain,{...input,atMinute:161});assert.equal(forward.orders.length,1);assert.equal(forward.supply.availableTimber,0);assert.equal(forward.supply.allocations.length,2);
});
test('multiple damaged homes plan deterministically regardless of input station order',()=>{
 const{saved,input}=fixture(),stock=earned(2),a=planLocalBuildingRebuilds(saved,stock,{...input,maximumOrders:4}),b=planLocalBuildingRebuilds(saved,stock,{...input,maximumOrders:4,stations:[...input.stations].reverse()});
 assert.equal(a.orders.length,2);assert.deepEqual(a.orders,b.orders);assert.deepEqual(a.supply,b.supply);assert.equal(a.supply.availableTimber,0);assert.ok(a.orders[0].orderedAtMinute<=a.orders[1].orderedAtMinute);
});
test('an active local fire postpones rebuilding without spending material',()=>{
 const{saved,input}=fixture(true,true),stock=earned(2),result=planLocalBuildingRebuilds(saved,stock,{...input,maximumOrders:4});
 assert.strictEqual(result.save,saved);assert.strictEqual(result.supply,stock);assert.equal(result.orders.length,0);assert.equal(result.held[0].reason,'local-fire-still-active');
});
test('one resident cannot be reserved for simultaneous repairs in different buildings',()=>{
 const{saved,input}=fixture(),stock=earned(2),stations=input.stations.map(s=>({...s,residentId:mason.id})),first=planLocalBuildingRebuilds(saved,stock,{...input,stations,maximumOrders:4});
 assert.equal(first.orders.length,1);assert.equal(first.supply.availableTimber,12);assert.equal(first.held[0].reason,'no-available-source-qualified-repair-crew');
 const second=planLocalBuildingRebuilds(nextMinute(first.save,161),first.supply,{...input,atMinute:161,stations,maximumOrders:4});assert.equal(second.orders.length,0);assert.strictEqual(second.supply,first.supply);assert.equal(second.held[0].reason,'no-available-source-qualified-repair-crew');
});
test('a stale source station or child crew cannot spend stock; other independently qualified houses may proceed',()=>{
 const{saved,input}=fixture(),stock=earned(),stale=input.stations.map((s,i)=>i===0?{...s,proof:{...s.proof,sourceSha256:'e'.repeat(64)}}:s),result=planLocalBuildingRebuilds(saved,stock,{...input,stations:stale,maximumOrders:4});
 assert.equal(result.orders.length,1);assert.equal(result.orders[0].binding.buildingId,buildings[1].binding.buildingId);assert.equal(result.supply.availableTimber,0);assert.equal(result.held[0].reason,'no-available-source-qualified-repair-crew');
 const child=population.residents.find(p=>p.ageYears<18)!;for(const stations of [input.stations.map(s=>({...s,residentId:child.id})),input.stations.map(s=>({...s,proof:{...s.proof,siteIdentity:'stale-site'}}))]){const held=planLocalBuildingRebuilds(saved,stock,{...input,stations});assert.equal(held.orders.length,0);assert.strictEqual(held.save,saved);assert.strictEqual(held.supply,stock);}
});
test('foreign clocks, source catalogues and invalid budgets fail without changing either state',()=>{
 const{saved,input}=fixture(),stock=earned(),before=JSON.stringify(saved);
 for(const bad of [{...input,worldKey:'foreign'},{...input,atMinute:159},{...input,maximumOrders:0},{...input,maximumOrders:5},{...input,buildings:[]},{...input,siteIdentity:''}]){const result=planLocalBuildingRebuilds(saved,stock,bad);assert.strictEqual(result.save,saved);assert.strictEqual(result.supply,stock);assert.equal(result.orders.length,0);assert.equal(JSON.stringify(saved),before);}
});
